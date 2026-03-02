/**
 * @module routes/battle
 * @description Battle endpoints: select Pokémon, get battle state.
 * The actual combat loop is server-driven (see battle-logic.js).
 */

const express = require('express');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const { query, getConnection } = require('../db');
const { broadcast } = require('../websocket/broadcaster');
const { runCombatLoop, sanitizeBattlePokemon, selectReplacementPokemon } = require('../game/battle-logic');
const { determineTurnOrder } = require('../game/formulas');

const router = express.Router();
router.use(authenticate);

/**
 * GET /api/battle/state
 * Get the current battle state.
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

    // Find the active battle
    const [battleRows] = await query(
      `SELECT bs.* FROM battle_state bs
       WHERE bs.room_id = ? AND bs.phase != 'finished'
       ORDER BY bs.id DESC LIMIT 1`,
      [room.id]
    );
    if (battleRows.length === 0) {
      return res.status(404).json({ success: false, error: 'No active battle', code: 'BATTLE_NOT_FOUND' });
    }
    const battle = battleRows[0];

    // Get match info
    const [matchRows] = await query(
      `SELECT tm.*,
              p1.player_name as player1_name, p1.avatar_id as player1_avatar,
              p2.player_name as player2_name, p2.avatar_id as player2_avatar
       FROM tournament_matches tm
       LEFT JOIN players p1 ON p1.id = tm.player1_id
       LEFT JOIN players p2 ON p2.id = tm.player2_id
       WHERE tm.id = ?`,
      [battle.match_id]
    );

    // Get all battle Pokémon
    const [battlePokemon] = await query(
      'SELECT * FROM battle_pokemon WHERE battle_id = ? ORDER BY player_side, team_index',
      [battle.id]
    );

    const player1Team = battlePokemon
      .filter((bp) => bp.player_side === 'player1')
      .map(sanitizeBattlePokemon);
    const player2Team = battlePokemon
      .filter((bp) => bp.player_side === 'player2')
      .map(sanitizeBattlePokemon);

    // Determine what the calling player can see
    const match = matchRows[0];
    let npcLeader = null;
    if (match && match.is_npc_battle) {
      const gymLeaders = require('../data/gym-leaders.json');
      const leader = gymLeaders.find((l) => l.route === match.npc_route) || gymLeaders[gymLeaders.length - 1];
      npcLeader = {
        name: leader.name,
        title: leader.title,
        avatar: leader.avatar,
        specialty: leader.specialty,
      };
    }

    res.json({
      success: true,
      battle: {
        id: battle.id,
        phase: battle.phase,
        current_turn: battle.current_turn,
        turn_number: battle.turn_number,
        player1_active_index: battle.player1_active_index,
        player2_active_index: battle.player2_active_index,
        player1_has_selected: !!battle.player1_has_selected,
        player2_has_selected: !!battle.player2_has_selected,
      },
      match: match ? {
        id: match.id,
        match_index: match.match_index,
        player1_id: match.player1_id,
        player2_id: match.player2_id,
        player1_name: match.player1_name,
        player2_name: match.is_npc_battle ? (npcLeader?.name || 'Gym Leader') : match.player2_name,
        player1_avatar: match.player1_avatar,
        player2_avatar: match.is_npc_battle ? null : match.player2_avatar,
        is_npc_battle: !!match.is_npc_battle,
        npc_leader: npcLeader,
      } : null,
      player1_team: player1Team,
      player2_team: player2Team,
    });
  } catch (err) {
    console.error('Battle state error:', err);
    res.status(500).json({ success: false, error: 'Failed to get battle state', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/battle/select-pokemon
 * Select a Pokémon for battle (initial selection or replacement after faint).
 */
router.post(
  '/select-pokemon',
  validate({
    team_index: { type: 'number', required: true, min: 0 },
  }),
  async (req, res) => {
    const conn = await getConnection();
    try {
      await conn.beginTransaction();

      const { team_index } = req.body;
      const account = req.account;

      // Find player's active room in battle phase
      const [playerRows] = await conn.execute(
        `SELECT p.*, r.room_code, r.game_state, r.game_mode
         FROM players p
         JOIN rooms r ON r.id = p.room_id
         WHERE p.account_id = ? AND r.game_state = 'battle'`,
        [account.id]
      );
      if (playerRows.length === 0) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'Not in battle phase', code: 'INVALID_PHASE' });
      }
      const player = playerRows[0];

      // Find the active battle
      const [battleRows] = await conn.execute(
        `SELECT bs.* FROM battle_state bs
         WHERE bs.room_id = ? AND bs.phase != 'finished'
         FOR UPDATE`,
        [player.room_id]
      );
      if (battleRows.length === 0) {
        await conn.rollback();
        return res.status(404).json({ success: false, error: 'No active battle', code: 'BATTLE_NOT_FOUND' });
      }
      const battle = battleRows[0];

      // Get match to determine which side the player is on
      const [matchRows] = await conn.execute(
        'SELECT * FROM tournament_matches WHERE id = ?',
        [battle.match_id]
      );
      if (matchRows.length === 0) {
        await conn.rollback();
        return res.status(404).json({ success: false, error: 'Match not found', code: 'MATCH_NOT_FOUND' });
      }
      const match = matchRows[0];

      let side;
      if (match.player1_id === player.id) {
        side = 'player1';
      } else if (match.player2_id === player.id) {
        side = 'player2';
      } else {
        await conn.rollback();
        return res.status(403).json({ success: false, error: 'Not a participant in this battle', code: 'INVALID_ACTION' });
      }

      // Verify the Pokémon exists and is not fainted
      const [pokemonRows] = await conn.execute(
        'SELECT * FROM battle_pokemon WHERE battle_id = ? AND player_side = ? AND team_index = ?',
        [battle.id, side, team_index]
      );
      if (pokemonRows.length === 0) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'Invalid Pokémon index', code: 'POKEMON_NOT_FOUND' });
      }
      if (pokemonRows[0].is_fainted) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'That Pokémon is fainted', code: 'INVALID_ACTION' });
      }

      const selectedPokemon = pokemonRows[0];

      if (battle.phase === 'selection') {
        // Initial Pokémon selection
        const hasSelectedCol = side === 'player1' ? 'player1_has_selected' : 'player2_has_selected';
        const activeCol = side === 'player1' ? 'player1_active_index' : 'player2_active_index';

        if (battle[hasSelectedCol]) {
          await conn.rollback();
          return res.status(400).json({ success: false, error: 'Already selected', code: 'INVALID_ACTION' });
        }

        await conn.execute(
          `UPDATE battle_state SET ${activeCol} = ?, ${hasSelectedCol} = TRUE WHERE id = ?`,
          [team_index, battle.id]
        );

        // Check if both have selected
        const otherSelected = side === 'player1' ? battle.player2_has_selected : battle.player1_has_selected;
        const bothSelected = !!otherSelected;

        await conn.commit();

        broadcast(player.room_code, 'battle_pokemon_selected', {
          side,
          player_name: player.player_name,
          pokemon_name: selectedPokemon.name,
          both_selected: bothSelected,
        });

        if (bothSelected) {
          // Both have selected — start combat loop
          // The combat loop runs asynchronously
          setImmediate(() => runCombatLoop(battle.id, player.room_code, battle.match_id));
        }

        res.json({
          success: true,
          both_selected: bothSelected,
          pokemon_name: selectedPokemon.name,
        });
      } else if (battle.phase === 'combat') {
        // Replacement selection after a faint
        await conn.commit();

        // Use selectReplacementPokemon which handles the logic
        await selectReplacementPokemon(battle.id, player.room_code, battle.match_id, side, team_index);

        res.json({
          success: true,
          replacement: true,
          pokemon_name: selectedPokemon.name,
        });
      } else {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'Battle is finished', code: 'INVALID_PHASE' });
      }
    } catch (err) {
      await conn.rollback();
      console.error('Select pokemon error:', err);
      res.status(500).json({ success: false, error: err.message, code: err.code || 'INTERNAL_ERROR' });
    } finally {
      conn.release();
    }
  }
);

module.exports = router;
