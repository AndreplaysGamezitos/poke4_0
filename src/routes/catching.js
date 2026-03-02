/**
 * @module routes/catching
 * @description Catching phase endpoints: catch, attack, set-active, and state.
 */

const express = require('express');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const { query, getConnection } = require('../db');
const { broadcast } = require('../websocket/broadcaster');
const { transitionTo } = require('../game/state-machine');
const {
  spawnWildPokemon,
  attemptCatch,
  calculateWildAttack,
  shouldEvolve,
} = require('../game/catching-logic');
const config = require('../config');

const router = express.Router();
router.use(authenticate);

/**
 * Helper: load the calling player + room in catching phase with FOR UPDATE lock.
 */
async function loadCatchingContext(conn, accountId) {
  const [rows] = await conn.execute(
    `SELECT p.*, r.room_code, r.game_state, r.current_route,
            r.current_player_turn, r.encounters_remaining,
            r.id AS room_id_ref
     FROM players p
     JOIN rooms r ON r.id = p.room_id
     WHERE p.account_id = ? AND r.game_state = 'catching'
     FOR UPDATE`,
    [accountId]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Helper: verify it's the player's turn.
 */
async function verifyTurn(conn, player) {
  const [allPlayers] = await conn.execute(
    'SELECT id, player_number FROM players WHERE room_id = ? ORDER BY player_number',
    [player.room_id]
  );
  const idx = player.current_player_turn;
  return allPlayers[idx]?.id === player.id ? allPlayers : null;
}

/**
 * Helper: advance turn, spawn next wild Pokémon or transition to town.
 * IMPORTANT: This function commits the open transaction on conn.
 */
async function advanceTurn(conn, player, allPlayers) {
  const newEncounters = player.encounters_remaining - 1;

  if (newEncounters <= 0) {
    // Commit the current transaction first
    await conn.execute(
      'UPDATE rooms SET encounters_remaining = 0 WHERE id = ?',
      [player.room_id]
    );
    await conn.commit();

    // Transition to town phase (creates its own transaction)
    await transitionTo(player.room_id, 'town', async (c, room) => {
      await c.execute(
        'UPDATE players SET money = money + ?, is_ready = FALSE WHERE room_id = ?',
        [config.TOWN_INCOME, room.id]
      );
      return {};
    });

    return { phaseEnded: true };
  }

  // Advance to next player
  const nextTurn = (player.current_player_turn + 1) % allPlayers.length;
  await conn.execute(
    'UPDATE rooms SET current_player_turn = ?, encounters_remaining = ? WHERE id = ?',
    [nextTurn, newEncounters, player.room_id]
  );

  // Spawn next wild Pokémon
  const wildData = await spawnWildPokemon(conn, player.room_id, player.current_route);

  await conn.commit();

  // Broadcast turn change and new wild Pokémon
  broadcast(player.room_code, 'turn_changed', {
    current_player_turn: nextTurn,
    current_player_id: allPlayers[nextTurn].id,
    current_player_name: allPlayers[nextTurn].player_name,
    encounters_remaining: newEncounters,
  });

  broadcast(player.room_code, 'wild_pokemon_appeared', {
    pokemon_id: wildData.pokemon_id,
    pokemon_name: wildData.pokemon_name,
    sprite_url: wildData.sprite_url,
    hp: wildData.hp,
    max_hp: wildData.max_hp,
    type_defense: wildData.type_defense,
    type_attack: wildData.type_attack,
    catch_rate: wildData.catch_rate,
  });

  return { phaseEnded: false, nextTurn, wildData };
}

/**
 * GET /api/catching/state
 * Get full catching phase state.
 */
router.get('/state', async (req, res) => {
  try {
    const { room_code } = req.query;
    if (!room_code) {
      return res.status(400).json({ success: false, error: 'room_code required', code: 'VALIDATION_ERROR' });
    }

    const [rooms] = await query('SELECT * FROM rooms WHERE room_code = ?', [room_code.toUpperCase()]);
    if (rooms.length === 0) {
      return res.status(404).json({ success: false, error: 'Room not found', code: 'ROOM_NOT_FOUND' });
    }
    const room = rooms[0];

    // Wild Pokémon
    const [wild] = await query(
      `SELECT wp.*, pd.name as pokemon_name, pd.sprite_url, pd.type_defense,
              pd.type_attack, pd.catch_rate
       FROM wild_pokemon wp
       JOIN pokemon_dex pd ON pd.id = wp.pokemon_id
       WHERE wp.room_id = ? AND wp.is_active = TRUE`,
      [room.id]
    );

    // Players with their teams
    const [players] = await query(
      `SELECT p.id, p.player_number, p.player_name, p.avatar_id,
              p.money, p.ultra_balls, p.badges, p.is_host
       FROM players p WHERE p.room_id = ? ORDER BY p.player_number`,
      [room.id]
    );

    // Load each player's team
    for (const p of players) {
      const [team] = await query(
        `SELECT pp.id, pp.pokemon_id, pp.current_exp, pp.is_active,
                pp.team_position, pp.bonus_hp, pp.bonus_attack, pp.bonus_speed,
                pd.name, pd.type_attack, pd.type_defense, pd.base_hp,
                pd.base_attack, pd.base_speed, pd.sprite_url, pd.evolution_id,
                pd.evolution_number, pd.catch_rate
         FROM player_pokemon pp
         JOIN pokemon_dex pd ON pd.id = pp.pokemon_id
         WHERE pp.player_id = ?
         ORDER BY pp.team_position`,
        [p.id]
      );
      p.team = team;
    }

    res.json({
      success: true,
      room: {
        game_state: room.game_state,
        current_route: room.current_route,
        current_player_turn: room.current_player_turn,
        encounters_remaining: room.encounters_remaining,
      },
      wild_pokemon: wild.length > 0 ? wild[0] : null,
      players,
    });
  } catch (err) {
    console.error('Catching state error:', err);
    res.status(500).json({ success: false, error: 'Failed to get state', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/catching/catch
 * Attempt to catch the active wild Pokémon.
 */
router.post('/catch', async (req, res) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    const player = await loadCatchingContext(conn, req.account.id);
    if (!player) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: 'Not in catching phase', code: 'INVALID_PHASE' });
    }

    const allPlayers = await verifyTurn(conn, player);
    if (!allPlayers) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: 'Not your turn', code: 'NOT_YOUR_TURN' });
    }

    // Get active wild Pokémon
    const [wildRows] = await conn.execute(
      `SELECT wp.*, pd.name as pokemon_name, pd.sprite_url, pd.catch_rate,
              pd.type_defense, pd.type_attack
       FROM wild_pokemon wp
       JOIN pokemon_dex pd ON pd.id = wp.pokemon_id
       WHERE wp.room_id = ? AND wp.is_active = TRUE
       FOR UPDATE`,
      [player.room_id]
    );
    if (wildRows.length === 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: 'No wild Pokémon', code: 'INVALID_ACTION' });
    }
    const wild = wildRows[0];

    const useUltraBall = !!req.body.use_ultra_ball;

    // Validate ultra ball usage
    if (useUltraBall && player.ultra_balls <= 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: 'No ultra balls', code: 'NOT_ENOUGH_MONEY' });
    }

    // Attempt catch
    const { caught, diceRoll } = attemptCatch(wild.catch_rate, useUltraBall);

    // Deduct ultra ball if used
    if (useUltraBall) {
      await conn.execute(
        'UPDATE players SET ultra_balls = ultra_balls - 1 WHERE id = ?',
        [player.id]
      );
    }

    let goldReward = 0;
    let caughtPokemonData = null;

    if (caught) {
      // Count team size
      const [teamRows] = await conn.execute(
        'SELECT COUNT(*) as cnt FROM player_pokemon WHERE player_id = ?',
        [player.id]
      );
      const teamSize = teamRows[0].cnt;

      if (teamSize >= config.MAX_TEAM_SIZE) {
        // Team full — gold reward instead
        goldReward = config.FULL_TEAM_CATCH_REWARD;
        await conn.execute(
          'UPDATE players SET money = money + ? WHERE id = ?',
          [goldReward, player.id]
        );
      } else {
        // Add to team
        const [insertResult] = await conn.execute(
          `INSERT INTO player_pokemon (player_id, pokemon_id, team_position)
           VALUES (?, ?, ?)`,
          [player.id, wild.pokemon_id, teamSize]
        );
        caughtPokemonData = {
          team_id: insertResult.insertId,
          pokemon_id: wild.pokemon_id,
          pokemon_name: wild.pokemon_name,
          sprite_url: wild.sprite_url,
        };
      }
    }

    // Deactivate wild Pokémon
    await conn.execute(
      'UPDATE wild_pokemon SET is_active = FALSE WHERE id = ?',
      [wild.id]
    );

    // Broadcast catch attempt
    broadcast(player.room_code, 'catch_attempt', {
      player_id: player.id,
      player_name: player.player_name,
      caught,
      dice_roll: diceRoll,
      catch_rate: wild.catch_rate,
      used_ultra_ball: useUltraBall,
      pokemon_name: wild.pokemon_name,
      pokemon_id: wild.pokemon_id,
      sprite_url: wild.sprite_url,
      gold_reward: goldReward,
      team_full: goldReward > 0,
    });

    // Advance turn
    const turnResult = await advanceTurn(conn, player, allPlayers);

    res.json({
      success: true,
      result: {
        caught,
        dice_roll: diceRoll,
        catch_rate: wild.catch_rate,
        used_ultra_ball: useUltraBall,
        pokemon_name: wild.pokemon_name,
        gold_reward: goldReward,
        team_full: goldReward > 0,
        caught_pokemon: caughtPokemonData,
        phase_ended: turnResult.phaseEnded,
      },
    });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* already committed */ }
    console.error('Catch error:', err);
    res.status(500).json({ success: false, error: err.message, code: err.code || 'INTERNAL_ERROR' });
  } finally {
    conn.release();
  }
});

/**
 * POST /api/catching/attack
 * Attack the active wild Pokémon for EXP.
 */
router.post('/attack', async (req, res) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    const player = await loadCatchingContext(conn, req.account.id);
    if (!player) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: 'Not in catching phase', code: 'INVALID_PHASE' });
    }

    const allPlayers = await verifyTurn(conn, player);
    if (!allPlayers) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: 'Not your turn', code: 'NOT_YOUR_TURN' });
    }

    // Get active wild Pokémon
    const [wildRows] = await conn.execute(
      `SELECT wp.*, pd.name as pokemon_name, pd.sprite_url, pd.catch_rate,
              pd.type_defense, pd.type_attack, pd.base_hp
       FROM wild_pokemon wp
       JOIN pokemon_dex pd ON pd.id = wp.pokemon_id
       WHERE wp.room_id = ? AND wp.is_active = TRUE
       FOR UPDATE`,
      [player.room_id]
    );
    if (wildRows.length === 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: 'No wild Pokémon', code: 'INVALID_ACTION' });
    }
    const wild = wildRows[0];

    // Get player's active Pokémon
    const [activeRows] = await conn.execute(
      `SELECT pp.*, pd.base_attack, pd.type_attack, pd.type_defense, pd.name,
              pd.evolution_id, pd.evolution_number, pd.sprite_url
       FROM player_pokemon pp
       JOIN pokemon_dex pd ON pd.id = pp.pokemon_id
       WHERE pp.player_id = ? AND pp.is_active = TRUE`,
      [player.id]
    );
    if (activeRows.length === 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: 'No active Pokémon', code: 'INVALID_ACTION' });
    }
    const activePokemon = activeRows[0];

    // Calculate attack
    const { damage, multiplier, newHp, defeated } = calculateWildAttack(activePokemon, wild);

    // Update wild Pokémon HP
    await conn.execute(
      'UPDATE wild_pokemon SET current_hp = ?, is_active = ? WHERE id = ?',
      [newHp, !defeated, wild.id]
    );

    // Grant +1 EXP to attacker
    await conn.execute(
      'UPDATE player_pokemon SET current_exp = current_exp + 1 WHERE id = ?',
      [activePokemon.id]
    );

    // Check for evolution
    let evolved = false;
    let evolvedInto = null;
    const newExp = activePokemon.current_exp + 1;
    if (newExp >= config.EXP_TO_EVOLVE && activePokemon.evolution_id !== null) {
      // Evolve!
      const [evoRows] = await conn.execute(
        'SELECT * FROM pokemon_dex WHERE id = ?',
        [activePokemon.evolution_id]
      );
      if (evoRows.length > 0) {
        evolved = true;
        evolvedInto = evoRows[0];
        await conn.execute(
          'UPDATE player_pokemon SET pokemon_id = ?, current_exp = 0 WHERE id = ?',
          [activePokemon.evolution_id, activePokemon.id]
        );
      }
    }

    // Broadcast attack
    broadcast(player.room_code, 'attack', {
      player_id: player.id,
      attacker_name: player.player_name,
      pokemon_name: activePokemon.name,
      wild_pokemon_name: wild.pokemon_name,
      damage,
      type_multiplier: multiplier,
      wild_hp: newHp,
      wild_max_hp: wild.max_hp,
      defeated,
      evolved,
      evolved_into: evolvedInto ? { name: evolvedInto.name, sprite_url: evolvedInto.sprite_url } : null,
    });

    // After attack (whether defeated or not), deactivate and advance turn
    if (!defeated) {
      // Deactivate the wild Pokémon (turn used up even if not defeated)
      await conn.execute(
        'UPDATE wild_pokemon SET is_active = FALSE WHERE id = ?',
        [wild.id]
      );
    }

    // Advance turn
    const turnResult = await advanceTurn(conn, player, allPlayers);

    res.json({
      success: true,
      damage,
      type_multiplier: multiplier,
      wild_hp: newHp,
      defeated,
      evolved,
      evolved_into: evolvedInto ? { name: evolvedInto.name, sprite_url: evolvedInto.sprite_url } : null,
      phase_ended: turnResult.phaseEnded,
    });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* already committed */ }
    console.error('Attack error:', err);
    res.status(500).json({ success: false, error: err.message, code: err.code || 'INTERNAL_ERROR' });
  } finally {
    conn.release();
  }
});

/**
 * POST /api/catching/set-active
 * Change the active Pokémon during catching phase.
 */
router.post(
  '/set-active',
  validate({
    pokemon_id: { type: 'number', required: true },
  }),
  async (req, res) => {
    const conn = await getConnection();
    try {
      await conn.beginTransaction();

      const { pokemon_id } = req.body;

      // Find player in catching phase
      const [playerRows] = await conn.execute(
        `SELECT p.*, r.room_code FROM players p
         JOIN rooms r ON r.id = p.room_id
         WHERE p.account_id = ? AND r.game_state = 'catching'`,
        [req.account.id]
      );
      if (playerRows.length === 0) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'Not in catching phase', code: 'INVALID_PHASE' });
      }
      const player = playerRows[0];

      // Verify the Pokémon belongs to this player
      const [pokemonRows] = await conn.execute(
        `SELECT pp.*, pd.name FROM player_pokemon pp
         JOIN pokemon_dex pd ON pd.id = pp.pokemon_id
         WHERE pp.player_id = ? AND pp.pokemon_id = ?`,
        [player.id, pokemon_id]
      );
      if (pokemonRows.length === 0) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'Pokémon not found in team', code: 'POKEMON_NOT_FOUND' });
      }

      // Deactivate all, then activate the chosen one
      await conn.execute(
        'UPDATE player_pokemon SET is_active = FALSE WHERE player_id = ?',
        [player.id]
      );
      await conn.execute(
        'UPDATE player_pokemon SET is_active = TRUE WHERE id = ?',
        [pokemonRows[0].id]
      );

      await conn.commit();

      broadcast(player.room_code, 'pokemon_switched', {
        player_id: player.id,
        player_name: player.player_name,
        pokemon_name: pokemonRows[0].name,
        pokemon_id,
      });

      res.json({ success: true, pokemon_name: pokemonRows[0].name });
    } catch (err) {
      await conn.rollback();
      console.error('Set active error:', err);
      res.status(500).json({ success: false, error: err.message, code: err.code || 'INTERNAL_ERROR' });
    } finally {
      conn.release();
    }
  }
);

module.exports = router;
