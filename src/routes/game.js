/**
 * @module routes/game
 * @description Game flow endpoints: start game, select starter, get full state.
 */

const express = require('express');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const { query, getConnection } = require('../db');
const { transitionTo } = require('../game/state-machine');
const { broadcast } = require('../websocket/broadcaster');
const { spawnWildPokemon } = require('../game/catching-logic');
const config = require('../config');

const router = express.Router();
router.use(authenticate);

/**
 * Helper: find the caller's player row in an active (non-finished) room.
 */
async function findPlayer(accountId, conn) {
  const source = conn || { execute: (s, p) => query(s, p) };
  const [rows] = await source.execute(
    `SELECT p.*, r.room_code, r.game_state, r.game_mode, r.id AS room_id_ref,
            r.current_route, r.current_player_turn, r.encounters_remaining
     FROM players p
     JOIN rooms r ON r.id = p.room_id
     WHERE p.account_id = ? AND r.game_state != 'finished'`,
    [accountId]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * POST /api/game/start
 * Host starts the game → transition lobby → initial (starter selection).
 */
router.post('/start', async (req, res) => {
  try {
    const player = await findPlayer(req.account.id);
    if (!player) {
      return res.status(400).json({ success: false, error: 'Not in a room', code: 'ROOM_NOT_FOUND' });
    }
    if (!player.is_host) {
      return res.status(403).json({ success: false, error: 'Only the host can start the game', code: 'NOT_HOST' });
    }

    // Count players
    const [players] = await query(
      'SELECT id, player_number, player_name FROM players WHERE room_id = ? ORDER BY player_number',
      [player.room_id]
    );
    const minPlayers = player.game_mode === 'ranked' ? config.RANKED_PLAYERS : config.MIN_PLAYERS;
    if (players.length < minPlayers) {
      return res.status(400).json({
        success: false,
        error: `Need at least ${minPlayers} players`,
        code: 'NOT_ENOUGH_PLAYERS',
      });
    }
    if (player.game_mode === 'ranked' && players.length !== config.RANKED_PLAYERS) {
      return res.status(400).json({
        success: false,
        error: `Ranked requires exactly ${config.RANKED_PLAYERS} players`,
        code: 'NOT_ENOUGH_PLAYERS',
      });
    }

    // Random first picker
    const firstPickerIndex = Math.floor(Math.random() * players.length);
    const firstPicker = players[firstPickerIndex];

    await transitionTo(player.room_id, 'initial', async (conn, room) => {
      // Store first picker as current_player_turn
      await conn.execute(
        'UPDATE rooms SET current_player_turn = ? WHERE id = ?',
        [firstPickerIndex, room.id]
      );
      return {
        first_picker: firstPicker.id,
        first_picker_name: firstPicker.player_name,
        first_picker_number: firstPicker.player_number,
      };
    });

    // Load starters
    const [starters] = await query(
      `SELECT sp.id as starter_id, sp.pokemon_id, sp.priority,
              pd.name, pd.type_attack, pd.type_defense,
              pd.base_hp, pd.base_attack, pd.base_speed,
              pd.sprite_url
       FROM starter_pokemon sp
       JOIN pokemon_dex pd ON pd.id = sp.pokemon_id
       ORDER BY sp.priority`
    );

    res.json({
      success: true,
      game_state: 'initial',
      first_picker: firstPicker.id,
      first_picker_name: firstPicker.player_name,
      starters,
    });
  } catch (err) {
    console.error('Game start error:', err);
    const status = err.code === 'INVALID_PHASE' ? 400 : 500;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/game/select-starter
 * Select a starter Pokémon during the initial phase.
 */
router.post(
  '/select-starter',
  validate({
    pokemon_id: { type: 'number', required: true },
  }),
  async (req, res) => {
    const conn = await getConnection();
    try {
      await conn.beginTransaction();
      const { pokemon_id } = req.body;

      // Find player + lock room
      const [playerRows] = await conn.execute(
        `SELECT p.*, r.room_code, r.game_state, r.game_mode, r.current_player_turn,
                r.id AS room_id_ref
         FROM players p
         JOIN rooms r ON r.id = p.room_id
         WHERE p.account_id = ? AND r.game_state = 'initial'
         FOR UPDATE`,
        [req.account.id]
      );
      if (playerRows.length === 0) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'Not in starter selection phase', code: 'INVALID_PHASE' });
      }
      const player = playerRows[0];

      // Check if already has a starter
      const [existing] = await conn.execute(
        'SELECT id FROM player_pokemon WHERE player_id = ?',
        [player.id]
      );
      if (existing.length > 0) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'Already selected a starter', code: 'INVALID_ACTION' });
      }

      // Verify it's this player's turn
      const [allPlayers] = await conn.execute(
        'SELECT id, player_number, player_name FROM players WHERE room_id = ? ORDER BY player_number',
        [player.room_id]
      );
      const currentTurnIndex = player.current_player_turn;
      if (allPlayers[currentTurnIndex]?.id !== player.id) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'Not your turn to pick', code: 'NOT_YOUR_TURN' });
      }

      // Verify the Pokémon is a valid starter
      const [starterRows] = await conn.execute(
        'SELECT sp.pokemon_id FROM starter_pokemon sp WHERE sp.pokemon_id = ?',
        [pokemon_id]
      );
      if (starterRows.length === 0) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'Not a valid starter', code: 'POKEMON_NOT_FOUND' });
      }

      // Check if another player already picked this starter in this room
      const [taken] = await conn.execute(
        `SELECT pp.id FROM player_pokemon pp
         JOIN players p ON p.id = pp.player_id
         WHERE p.room_id = ? AND pp.pokemon_id = ?`,
        [player.room_id, pokemon_id]
      );
      if (taken.length > 0) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'Starter already taken', code: 'INVALID_ACTION' });
      }

      // Get Pokémon info
      const [pokemonRows] = await conn.execute('SELECT * FROM pokemon_dex WHERE id = ?', [pokemon_id]);
      if (pokemonRows.length === 0) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'Pokémon not found', code: 'POKEMON_NOT_FOUND' });
      }
      const pokemon = pokemonRows[0];

      // Add to player's team
      await conn.execute(
        `INSERT INTO player_pokemon (player_id, pokemon_id, is_active, team_position)
         VALUES (?, ?, TRUE, 0)`,
        [player.id, pokemon_id]
      );

      // Advance turn
      const nextTurnIndex = (currentTurnIndex + 1) % allPlayers.length;
      await conn.execute(
        'UPDATE rooms SET current_player_turn = ? WHERE id = ?',
        [nextTurnIndex, player.room_id]
      );

      // Check how many players have selected (the INSERT above is visible within this transaction)
      const [selectedCount] = await conn.execute(
        `SELECT COUNT(DISTINCT pp.player_id) as cnt FROM player_pokemon pp
         JOIN players p ON p.id = pp.player_id
         WHERE p.room_id = ?`,
        [player.room_id]
      );
      const totalSelected = selectedCount[0].cnt;
      const phaseComplete = totalSelected >= allPlayers.length;

      await conn.commit();

      // Broadcast starter selection
      broadcast(player.room_code, 'starter_selected', {
        player_id: player.id,
        player_name: player.player_name,
        pokemon_name: pokemon.name,
        pokemon_id: pokemon.id,
        sprite_url: pokemon.sprite_url,
        next_picker: allPlayers[nextTurnIndex]?.id,
        next_picker_name: allPlayers[nextTurnIndex]?.player_name,
      });

      // If all have selected, transition to catching
      if (phaseComplete) {
        await transitionTo(player.room_id, 'catching', async (conn2, room) => {
          const encounters = allPlayers.length * config.TURNS_PER_PLAYER;
          await conn2.execute(
            'UPDATE rooms SET current_player_turn = 0, encounters_remaining = ? WHERE id = ?',
            [encounters, room.id]
          );

          // Spawn first wild Pokémon
          const wildData = await spawnWildPokemon(conn2, room.id, room.current_route);
          return {
            encounters_remaining: encounters,
            first_player_name: allPlayers[0].player_name,
            wild_pokemon: wildData,
          };
        });
      }

      res.json({
        success: true,
        pokemon: {
          id: pokemon.id,
          name: pokemon.name,
          sprite_url: pokemon.sprite_url,
          type_attack: pokemon.type_attack,
          type_defense: pokemon.type_defense,
        },
        phase_complete: phaseComplete,
      });
    } catch (err) {
      await conn.rollback();
      console.error('Select starter error:', err);
      res.status(500).json({ success: false, error: err.message, code: err.code || 'INTERNAL_ERROR' });
    } finally {
      conn.release();
    }
  }
);

/**
 * GET /api/game/state
 * Get the full current game state for the authenticated player.
 * Used for reconnection and initial page load.
 */
router.get('/state', async (req, res) => {
  try {
    const account = req.account;

    // Find player's active room
    const [playerRows] = await query(
      `SELECT p.*, r.room_code, r.game_state, r.game_mode, r.current_route,
              r.current_player_turn, r.encounters_remaining, r.turn_timer,
              r.town_timer, r.winner_player_id, r.current_match_index
       FROM players p
       JOIN rooms r ON r.id = p.room_id
       WHERE p.account_id = ? AND r.game_state != 'finished'`,
      [account.id]
    );

    if (playerRows.length === 0) {
      // Check for recently finished games
      const [finishedRows] = await query(
        `SELECT p.*, r.room_code, r.game_state, r.winner_player_id
         FROM players p
         JOIN rooms r ON r.id = p.room_id
         WHERE p.account_id = ? AND r.game_state = 'finished'
         ORDER BY r.updated_at DESC LIMIT 1`,
        [account.id]
      );
      const accountInfo = {
        id: account.id,
        nickname: account.nickname,
        code: account.account_code,
        avatar_id: account.avatar_id,
        elo: account.elo,
        gold: account.gold,
      };
      if (finishedRows.length > 0) {
        return res.json({ success: true, room: null, in_game: false, account: accountInfo, last_finished: finishedRows[0].room_code });
      }
      return res.json({ success: true, room: null, in_game: false, account: accountInfo });
    }

    const player = playerRows[0];

    // Get all players
    const [allPlayers] = await query(
      `SELECT p.id, p.player_number, p.player_name, p.avatar_id,
              p.money, p.ultra_balls, p.badges, p.is_host, p.is_ready,
              p.has_used_mega_stone, p.account_id
       FROM players p WHERE p.room_id = ? ORDER BY p.player_number`,
      [player.room_id]
    );

    // Get player's team
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

    const result = {
      success: true,
      in_game: true,
      account: {
        id: account.id,
        nickname: account.nickname,
        code: account.account_code,
        avatar_id: account.avatar_id,
        elo: account.elo,
        gold: account.gold,
      },
      room: {
        id: player.room_id,
        room_code: player.room_code,
        game_mode: player.game_mode,
        game_state: player.game_state,
        current_route: player.current_route,
        current_player_turn: player.current_player_turn,
        encounters_remaining: player.encounters_remaining,
        turn_timer: player.turn_timer,
        town_timer: player.town_timer,
      },
      player: {
        id: player.id,
        player_number: player.player_number,
        player_name: player.player_name,
        money: player.money,
        ultra_balls: player.ultra_balls,
        badges: player.badges,
        is_host: !!player.is_host,
        is_ready: !!player.is_ready,
        has_used_mega_stone: !!player.has_used_mega_stone,
      },
      players: allPlayers,
      team,
    };

    // Phase-specific data
    if (player.game_state === 'catching') {
      const [wild] = await query(
        `SELECT wp.*, pd.name as pokemon_name, pd.sprite_url, pd.type_defense,
                pd.type_attack, pd.catch_rate
         FROM wild_pokemon wp
         JOIN pokemon_dex pd ON pd.id = wp.pokemon_id
         WHERE wp.room_id = ? AND wp.is_active = TRUE`,
        [player.room_id]
      );
      result.wild_pokemon = wild.length > 0 ? wild[0] : null;
    }

    if (player.game_state === 'initial') {
      const [starters] = await query(
        `SELECT sp.pokemon_id, pd.name, pd.type_attack, pd.type_defense,
                pd.base_hp, pd.base_attack, pd.base_speed, pd.sprite_url
         FROM starter_pokemon sp
         JOIN pokemon_dex pd ON pd.id = sp.pokemon_id
         ORDER BY sp.priority`
      );
      // Find which starters are already taken
      const [takenStarters] = await query(
        `SELECT pp.pokemon_id FROM player_pokemon pp
         JOIN players p ON p.id = pp.player_id
         WHERE p.room_id = ?`,
        [player.room_id]
      );
      const takenIds = new Set(takenStarters.map((t) => t.pokemon_id));
      result.starters = starters.map((s) => ({ ...s, taken: takenIds.has(s.pokemon_id) }));
    }

    if (player.game_state === 'tournament' || player.game_state === 'battle') {
      const [matches] = await query(
        `SELECT tm.*, 
                p1.player_name as player1_name, p1.avatar_id as player1_avatar,
                p2.player_name as player2_name, p2.avatar_id as player2_avatar
         FROM tournament_matches tm
         LEFT JOIN players p1 ON p1.id = tm.player1_id
         LEFT JOIN players p2 ON p2.id = tm.player2_id
         WHERE tm.room_id = ?
         ORDER BY tm.match_index`,
        [player.room_id]
      );
      result.tournament = { matches };
    }

    if (player.game_state === 'battle') {
      const [battleRows] = await query(
        `SELECT bs.* FROM battle_state bs WHERE bs.room_id = ? AND bs.phase != 'finished'`,
        [player.room_id]
      );
      if (battleRows.length > 0) {
        const battle = battleRows[0];
        const [battlePokemon] = await query(
          'SELECT * FROM battle_pokemon WHERE battle_id = ? ORDER BY player_side, team_index',
          [battle.id]
        );
        result.battle = {
          ...battle,
          pokemon: battlePokemon,
        };
      }
    }

    res.json(result);
  } catch (err) {
    console.error('Game state error:', err);
    res.status(500).json({ success: false, error: 'Failed to get game state', code: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
