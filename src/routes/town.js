/**
 * @module routes/town
 * @description Town phase endpoints: buy, sell, set-active, ready.
 */

const express = require('express');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const { query, getConnection } = require('../db');
const { broadcast } = require('../websocket/broadcaster');
const { transitionTo } = require('../game/state-machine');
const { validatePurchase, validateSell, getSellPrice, willEvolve, SHOP_ITEMS } = require('../game/town-logic');
const { generateBrackets } = require('../game/tournament-logic');
const config = require('../config');

const router = express.Router();
router.use(authenticate);

/**
 * Helper: find player in town phase.
 */
async function findTownPlayer(accountId, conn) {
  const source = conn || { execute: (s, p) => query(s, p) };
  const [rows] = await source.execute(
    `SELECT p.*, r.room_code, r.game_state, r.current_route, r.game_mode
     FROM players p
     JOIN rooms r ON r.id = p.room_id
     WHERE p.account_id = ? AND r.game_state = 'town'`,
    [accountId]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * GET /api/town/state
 * Get town phase state for the player.
 */
router.get('/state', async (req, res) => {
  try {
    const player = await findTownPlayer(req.account.id);
    if (!player) {
      return res.status(400).json({ success: false, error: 'Not in town phase', code: 'INVALID_PHASE' });
    }

    // Player's team
    const [team] = await query(
      `SELECT pp.id, pp.pokemon_id, pp.current_exp, pp.is_active, pp.is_mega,
              pp.team_position, pp.bonus_hp, pp.bonus_attack, pp.bonus_speed,
              pd.name, pd.type_attack, pd.type_defense, pd.base_hp, pd.base_attack,
              pd.base_speed, pd.sprite_url, pd.evolution_id, pd.evolution_number,
              pd.has_mega, pd.mega_evolution_id, pd.catch_rate
       FROM player_pokemon pp
       JOIN pokemon_dex pd ON pd.id = pp.pokemon_id
       WHERE pp.player_id = ?
       ORDER BY pp.team_position`,
      [player.id]
    );

    // All players (for ready status)
    const [allPlayers] = await query(
      `SELECT p.id, p.player_number, p.player_name, p.avatar_id,
              p.money, p.ultra_balls, p.badges, p.is_ready
       FROM players p WHERE p.room_id = ? ORDER BY p.player_number`,
      [player.room_id]
    );

    res.json({
      success: true,
      player: {
        id: player.id,
        money: player.money,
        ultra_balls: player.ultra_balls,
        badges: player.badges,
        is_ready: !!player.is_ready,
        has_used_mega_stone: !!player.has_used_mega_stone,
      },
      team,
      players: allPlayers,
      shop_prices: Object.fromEntries(
        Object.entries(SHOP_ITEMS).map(([k, v]) => [k, v.price])
      ),
    });
  } catch (err) {
    console.error('Town state error:', err);
    res.status(500).json({ success: false, error: 'Failed to get town state', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/town/buy
 * Purchase an item from the shop.
 */
router.post(
  '/buy',
  validate({
    item: { type: 'string', required: true, enum: Object.keys(SHOP_ITEMS) },
  }),
  async (req, res) => {
    const conn = await getConnection();
    try {
      await conn.beginTransaction();

      const { item } = req.body;

      // Lock player row
      const [playerRows] = await conn.execute(
        `SELECT p.*, r.room_code, r.game_state FROM players p
         JOIN rooms r ON r.id = p.room_id
         WHERE p.account_id = ? AND r.game_state = 'town'
         FOR UPDATE`,
        [req.account.id]
      );
      if (playerRows.length === 0) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'Not in town phase', code: 'INVALID_PHASE' });
      }
      const player = playerRows[0];

      // Get active Pokémon (needed for evo_soda, mega_stone, stat boosts)
      let activePokemon = null;
      const [activeRows] = await conn.execute(
        `SELECT pp.*, pd.name, pd.base_hp, pd.base_attack, pd.base_speed,
                pd.type_attack, pd.type_defense, pd.sprite_url,
                pd.evolution_id, pd.evolution_number, pd.has_mega,
                pd.mega_evolution_id
         FROM player_pokemon pp
         JOIN pokemon_dex pd ON pd.id = pp.pokemon_id
         WHERE pp.player_id = ? AND pp.is_active = TRUE`,
        [player.id]
      );
      if (activeRows.length > 0) {
        activePokemon = activeRows[0];
      }

      // Get team size
      const [teamCount] = await conn.execute(
        'SELECT COUNT(*) as cnt FROM player_pokemon WHERE player_id = ?',
        [player.id]
      );

      // Validate
      const error = validatePurchase(item, player, activePokemon, teamCount[0].cnt);
      if (error) {
        await conn.rollback();
        return res.status(400).json({ success: false, error, code: 'INVALID_ACTION' });
      }

      const price = SHOP_ITEMS[item].price;

      // Deduct money
      await conn.execute(
        'UPDATE players SET money = money - ? WHERE id = ?',
        [price, player.id]
      );

      const result = { new_money: player.money - price, item };

      // Apply item effects
      switch (item) {
        case 'ultra_ball':
          await conn.execute('UPDATE players SET ultra_balls = ultra_balls + 1 WHERE id = ?', [player.id]);
          result.ultra_balls = player.ultra_balls + 1;
          break;

        case 'evo_soda': {
          const newExp = activePokemon.current_exp + 1;
          const evolves = willEvolve(activePokemon.current_exp, activePokemon.evolution_id);

          if (evolves) {
            // Evolve! Swap pokemon_id, reset EXP
            const [evoRows] = await conn.execute(
              'SELECT * FROM pokemon_dex WHERE id = ?',
              [activePokemon.evolution_id]
            );
            if (evoRows.length > 0) {
              await conn.execute(
                'UPDATE player_pokemon SET pokemon_id = ?, current_exp = 0 WHERE id = ?',
                [activePokemon.evolution_id, activePokemon.id]
              );
              result.evolved = true;
              result.evolved_into = {
                name: evoRows[0].name,
                sprite_url: evoRows[0].sprite_url,
                pokemon_id: evoRows[0].id,
              };
            }
          } else {
            await conn.execute(
              'UPDATE player_pokemon SET current_exp = ? WHERE id = ?',
              [newExp, activePokemon.id]
            );
            result.new_exp = newExp;
          }
          break;
        }

        case 'mega_stone': {
          // Mega evolve: replace pokemon_id with mega_evolution_id
          const [megaRows] = await conn.execute(
            'SELECT * FROM pokemon_dex WHERE id = ?',
            [activePokemon.mega_evolution_id]
          );
          if (megaRows.length > 0) {
            await conn.execute(
              'UPDATE player_pokemon SET pokemon_id = ?, is_mega = TRUE WHERE id = ?',
              [activePokemon.mega_evolution_id, activePokemon.id]
            );
            await conn.execute(
              'UPDATE players SET has_used_mega_stone = TRUE WHERE id = ?',
              [player.id]
            );
            result.mega_evolved = true;
            result.mega_pokemon = {
              name: megaRows[0].name,
              sprite_url: megaRows[0].sprite_url,
              pokemon_id: megaRows[0].id,
            };
          }
          break;
        }

        case 'hp_boost':
          await conn.execute(
            'UPDATE player_pokemon SET bonus_hp = bonus_hp + ? WHERE id = ?',
            [config.HP_BOOST_VALUE, activePokemon.id]
          );
          result.new_bonus_hp = activePokemon.bonus_hp + config.HP_BOOST_VALUE;
          break;

        case 'attack_boost':
          await conn.execute(
            'UPDATE player_pokemon SET bonus_attack = bonus_attack + ? WHERE id = ?',
            [config.ATTACK_BOOST_VALUE, activePokemon.id]
          );
          result.new_bonus_attack = activePokemon.bonus_attack + config.ATTACK_BOOST_VALUE;
          break;

        case 'speed_boost':
          await conn.execute(
            'UPDATE player_pokemon SET bonus_speed = bonus_speed + ? WHERE id = ?',
            [config.SPEED_BOOST_VALUE, activePokemon.id]
          );
          result.new_bonus_speed = activePokemon.bonus_speed + config.SPEED_BOOST_VALUE;
          break;
      }

      await conn.commit();

      broadcast(player.room_code, 'town_purchase', {
        player_id: player.id,
        player_name: player.player_name,
        item,
        cost: price,
        label: SHOP_ITEMS[item].label,
        evolved: result.evolved || false,
        mega_evolved: result.mega_evolved || false,
      });

      res.json({ success: true, ...result });
    } catch (err) {
      await conn.rollback();
      console.error('Town buy error:', err);
      res.status(500).json({ success: false, error: err.message, code: err.code || 'INTERNAL_ERROR' });
    } finally {
      conn.release();
    }
  }
);

/**
 * POST /api/town/sell
 * Sell a Pokémon from the team.
 */
router.post(
  '/sell',
  validate({
    team_id: { type: 'number', required: true },
  }),
  async (req, res) => {
    const conn = await getConnection();
    try {
      await conn.beginTransaction();
      const { team_id } = req.body;

      // Lock player
      const [playerRows] = await conn.execute(
        `SELECT p.*, r.room_code FROM players p
         JOIN rooms r ON r.id = p.room_id
         WHERE p.account_id = ? AND r.game_state = 'town'
         FOR UPDATE`,
        [req.account.id]
      );
      if (playerRows.length === 0) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'Not in town phase', code: 'INVALID_PHASE' });
      }
      const player = playerRows[0];

      // Get team
      const [team] = await conn.execute(
        `SELECT pp.*, pd.name, pd.evolution_number, pd.sprite_url
         FROM player_pokemon pp
         JOIN pokemon_dex pd ON pd.id = pp.pokemon_id
         WHERE pp.player_id = ?`,
        [player.id]
      );

      // Validate
      const error = validateSell(team.length);
      if (error) {
        await conn.rollback();
        return res.status(400).json({ success: false, error, code: 'CANT_SELL_LAST' });
      }

      // Find the Pokémon to sell
      const toSell = team.find((t) => t.id === team_id);
      if (!toSell) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'Pokémon not found', code: 'POKEMON_NOT_FOUND' });
      }

      const price = getSellPrice(toSell.evolution_number);

      // Delete the Pokémon
      await conn.execute('DELETE FROM player_pokemon WHERE id = ?', [team_id]);

      // Add money
      await conn.execute('UPDATE players SET money = money + ? WHERE id = ?', [price, player.id]);

      // If the sold Pokémon was active, activate the first remaining one
      if (toSell.is_active) {
        const [remaining] = await conn.execute(
          'SELECT id FROM player_pokemon WHERE player_id = ? LIMIT 1',
          [player.id]
        );
        if (remaining.length > 0) {
          await conn.execute('UPDATE player_pokemon SET is_active = TRUE WHERE id = ?', [remaining[0].id]);
        }
      }

      // Re-number team positions
      const [remainingTeam] = await conn.execute(
        'SELECT id FROM player_pokemon WHERE player_id = ? ORDER BY team_position',
        [player.id]
      );
      for (let i = 0; i < remainingTeam.length; i++) {
        await conn.execute('UPDATE player_pokemon SET team_position = ? WHERE id = ?', [i, remainingTeam[i].id]);
      }

      await conn.commit();

      broadcast(player.room_code, 'town_sell', {
        player_id: player.id,
        player_name: player.player_name,
        pokemon_name: toSell.name,
        sell_price: price,
      });

      res.json({ success: true, new_money: player.money + price, sell_price: price });
    } catch (err) {
      await conn.rollback();
      console.error('Town sell error:', err);
      res.status(500).json({ success: false, error: err.message, code: err.code || 'INTERNAL_ERROR' });
    } finally {
      conn.release();
    }
  }
);

/**
 * POST /api/town/set-active
 * Change the active Pokémon during town phase.
 */
router.post(
  '/set-active',
  validate({
    slot: { type: 'number', required: true, min: 0 },
  }),
  async (req, res) => {
    const conn = await getConnection();
    try {
      await conn.beginTransaction();
      const { slot } = req.body;

      const [playerRows] = await conn.execute(
        `SELECT p.*, r.room_code FROM players p
         JOIN rooms r ON r.id = p.room_id
         WHERE p.account_id = ? AND r.game_state = 'town'`,
        [req.account.id]
      );
      if (playerRows.length === 0) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'Not in town phase', code: 'INVALID_PHASE' });
      }
      const player = playerRows[0];

      // Find Pokémon at this slot
      const [pokemonRows] = await conn.execute(
        `SELECT pp.*, pd.name FROM player_pokemon pp
         JOIN pokemon_dex pd ON pd.id = pp.pokemon_id
         WHERE pp.player_id = ? AND pp.team_position = ?`,
        [player.id, slot]
      );
      if (pokemonRows.length === 0) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'No Pokémon at that slot', code: 'POKEMON_NOT_FOUND' });
      }

      // Deactivate all, activate chosen
      await conn.execute('UPDATE player_pokemon SET is_active = FALSE WHERE player_id = ?', [player.id]);
      await conn.execute('UPDATE player_pokemon SET is_active = TRUE WHERE id = ?', [pokemonRows[0].id]);

      await conn.commit();

      res.json({ success: true, active_pokemon: pokemonRows[0].name });
    } catch (err) {
      await conn.rollback();
      console.error('Town set-active error:', err);
      res.status(500).json({ success: false, error: err.message, code: err.code || 'INTERNAL_ERROR' });
    } finally {
      conn.release();
    }
  }
);

/**
 * POST /api/town/ready
 * Toggle ready status. When all players are ready, transition to tournament.
 */
router.post('/ready', async (req, res) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    // Lock player + room
    const [playerRows] = await conn.execute(
      `SELECT p.*, r.room_code, r.game_state, r.current_route, r.game_mode,
              r.id AS room_id_ref
       FROM players p
       JOIN rooms r ON r.id = p.room_id
       WHERE p.account_id = ? AND r.game_state = 'town'
       FOR UPDATE`,
      [req.account.id]
    );
    if (playerRows.length === 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: 'Not in town phase', code: 'INVALID_PHASE' });
    }
    const player = playerRows[0];

    // Toggle ready
    const newReady = !player.is_ready;
    await conn.execute('UPDATE players SET is_ready = ? WHERE id = ?', [newReady, player.id]);

    // Re-count ready players after the update
    const [readyCount] = await conn.execute(
      'SELECT COUNT(*) as cnt FROM players WHERE room_id = ? AND is_ready = TRUE',
      [player.room_id]
    );
    const readyCnt = readyCount[0].cnt;

    const [totalPlayers] = await conn.execute(
      'SELECT COUNT(*) as cnt FROM players WHERE room_id = ?',
      [player.room_id]
    );
    const allReady = readyCnt >= totalPlayers[0].cnt;

    await conn.commit();

    broadcast(player.room_code, 'town_ready_toggle', {
      player_id: player.id,
      player_name: player.player_name,
      is_ready: newReady,
      ready_count: readyCnt,
      total_players: totalPlayers[0].cnt,
    });

    if (allReady) {
      // Transition to tournament
      await transitionTo(player.room_id, 'tournament', async (c, room) => {
        // Get all players for bracket generation
        const [players] = await c.execute(
          'SELECT id, player_name, badges, avatar_id FROM players WHERE room_id = ? ORDER BY player_number',
          [room.id]
        );

        // Generate brackets
        const brackets = generateBrackets(players, room.current_route);

        // Insert tournament matches
        for (const match of brackets) {
          await c.execute(
            `INSERT INTO tournament_matches
             (room_id, match_index, player1_id, player2_id, is_npc_battle, npc_route, is_tiebreaker)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [room.id, match.match_index, match.player1_id, match.player2_id,
             match.is_npc_battle, match.npc_route, match.is_tiebreaker || false]
          );
        }

        return { brackets };
      });
    }

    res.json({
      success: true,
      is_ready: newReady,
      ready_count: readyCnt,
      total_players: totalPlayers[0].cnt,
      all_ready: allReady,
    });
  } catch (err) {
    await conn.rollback();
    console.error('Town ready error:', err);
    res.status(500).json({ success: false, error: err.message, code: err.code || 'INTERNAL_ERROR' });
  } finally {
    conn.release();
  }
});

module.exports = router;
