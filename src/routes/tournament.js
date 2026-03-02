/**
 * @module routes/tournament
 * @description Tournament phase endpoints: state, start match, complete tournament.
 */

const express = require('express');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const { query, getConnection } = require('../db');
const { broadcast } = require('../websocket/broadcaster');
const { transitionTo } = require('../game/state-machine');
const {
  getGymLeader,
  buildGymLeaderTeam,
  checkWinCondition,
  generateBrackets,
} = require('../game/tournament-logic');
const { prepareBattlePokemon, runCombatLoop } = require('../game/battle-logic');
const { spawnWildPokemon } = require('../game/catching-logic');
const config = require('../config');

const router = express.Router();
router.use(authenticate);

/**
 * GET /api/tournament/state
 * Get tournament bracket and match info.
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

    // Get tournament matches
    const [matches] = await query(
      `SELECT tm.*,
              p1.player_name as player1_name, p1.avatar_id as player1_avatar, p1.badges as player1_badges,
              p2.player_name as player2_name, p2.avatar_id as player2_avatar, p2.badges as player2_badges
       FROM tournament_matches tm
       LEFT JOIN players p1 ON p1.id = tm.player1_id
       LEFT JOIN players p2 ON p2.id = tm.player2_id
       WHERE tm.room_id = ?
       ORDER BY tm.match_index`,
      [room.id]
    );

    // For NPC battles, inject gym leader data
    for (const match of matches) {
      if (match.is_npc_battle) {
        const leader = getGymLeader(match.npc_route || room.current_route);
        match.npc_leader = {
          name: leader.name,
          title: leader.title,
          avatar: leader.avatar,
          specialty: leader.specialty,
        };
      }
    }

    // Get players
    const [players] = await query(
      `SELECT p.id, p.player_number, p.player_name, p.avatar_id,
              p.money, p.ultra_balls, p.badges, p.is_host
       FROM players p WHERE p.room_id = ? ORDER BY p.player_number`,
      [room.id]
    );

    // Find the next pending match
    const nextPendingMatch = matches.find((m) => m.status === 'pending');
    const currentMatch = matches.find((m) => m.status === 'in_progress');

    res.json({
      success: true,
      tournament: {
        matches,
        current_route: room.current_route,
        current_match_index: room.current_match_index,
      },
      players,
      next_pending_match: nextPendingMatch || null,
      current_match: currentMatch || null,
    });
  } catch (err) {
    console.error('Tournament state error:', err);
    res.status(500).json({ success: false, error: 'Failed to get tournament state', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/tournament/start-match
 * Host starts the next match → transition to battle phase.
 */
router.post(
  '/start-match',
  validate({
    match_index: { type: 'number', required: true },
  }),
  async (req, res) => {
    const conn = await getConnection();
    try {
      await conn.beginTransaction();

      const { match_index } = req.body;

      // Find player and verify host
      const [playerRows] = await conn.execute(
        `SELECT p.*, r.room_code, r.game_state, r.current_route, r.game_mode
         FROM players p
         JOIN rooms r ON r.id = p.room_id
         WHERE p.account_id = ? AND r.game_state = 'tournament'
         FOR UPDATE`,
        [req.account.id]
      );
      if (playerRows.length === 0) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'Not in tournament phase', code: 'INVALID_PHASE' });
      }
      const player = playerRows[0];

      if (!player.is_host) {
        await conn.rollback();
        return res.status(403).json({ success: false, error: 'Only the host can start matches', code: 'NOT_HOST' });
      }

      // Find the match
      const [matchRows] = await conn.execute(
        'SELECT * FROM tournament_matches WHERE room_id = ? AND match_index = ? FOR UPDATE',
        [player.room_id, match_index]
      );
      if (matchRows.length === 0) {
        await conn.rollback();
        return res.status(404).json({ success: false, error: 'Match not found', code: 'MATCH_NOT_FOUND' });
      }
      const match = matchRows[0];

      if (match.status !== 'pending') {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'Match already started or completed', code: 'INVALID_ACTION' });
      }

      // Mark match as in_progress
      await conn.execute(
        "UPDATE tournament_matches SET status = 'in_progress' WHERE id = ?",
        [match.id]
      );

      // Set current_match_index on room
      await conn.execute(
        'UPDATE rooms SET current_match_index = ? WHERE id = ?',
        [match_index, player.room_id]
      );

      // Create battle_state
      const [battleResult] = await conn.execute(
        `INSERT INTO battle_state (match_id, room_id) VALUES (?, ?)`,
        [match.id, player.room_id]
      );
      const battleId = battleResult.insertId;

      // Prepare NPC team if needed
      let npcTeam = null;
      let npcLeader = null;
      if (match.is_npc_battle) {
        const route = match.npc_route || player.current_route;
        npcTeam = await buildGymLeaderTeam(route);
        npcLeader = getGymLeader(route);
      }

      // Prepare battle_pokemon snapshots
      await prepareBattlePokemon(conn, battleId, match.player1_id, match.player2_id, npcTeam);

      await conn.commit();

      // Transition to battle
      await transitionTo(player.room_id, 'battle', async (c, room) => {
        return {};
      });

      // Get player names for broadcast
      let player1Name = '';
      let player2Name = '';
      if (match.player1_id) {
        const [p1] = await query('SELECT player_name FROM players WHERE id = ?', [match.player1_id]);
        player1Name = p1.length > 0 ? p1[0].player_name : '';
      }
      if (match.player2_id) {
        const [p2] = await query('SELECT player_name FROM players WHERE id = ?', [match.player2_id]);
        player2Name = p2.length > 0 ? p2[0].player_name : '';
      }
      if (match.is_npc_battle && npcLeader) {
        player2Name = npcLeader.name;
      }

      broadcast(player.room_code, 'battle_started', {
        match_index: match.match_index,
        player1_id: match.player1_id,
        player2_id: match.player2_id,
        player1_name: player1Name,
        player2_name: player2Name,
        is_npc_battle: !!match.is_npc_battle,
        npc_leader: npcLeader ? {
          name: npcLeader.name,
          title: npcLeader.title,
          avatar: npcLeader.avatar,
          specialty: npcLeader.specialty,
          dialogue_win: npcLeader.dialogue_win,
          dialogue_lose: npcLeader.dialogue_lose,
        } : null,
        battle_id: battleId,
      });

      // For NPC battles, auto-select NPC's first Pokémon
      if (match.is_npc_battle) {
        const npcIndex = Math.floor(Math.random() * npcTeam.length);
        await query(
          'UPDATE battle_state SET player2_active_index = ?, player2_has_selected = TRUE WHERE id = ?',
          [npcIndex, battleId]
        );
      }

      res.json({
        success: true,
        battle_id: battleId,
        match_index: match.match_index,
        is_npc_battle: !!match.is_npc_battle,
      });
    } catch (err) {
      await conn.rollback();
      console.error('Start match error:', err);
      res.status(500).json({ success: false, error: err.message, code: err.code || 'INTERNAL_ERROR' });
    } finally {
      conn.release();
    }
  }
);

/**
 * POST /api/tournament/complete
 * Host completes the tournament phase → check win / next route.
 */
router.post('/complete', async (req, res) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    const [playerRows] = await conn.execute(
      `SELECT p.*, r.room_code, r.game_state, r.current_route, r.game_mode
       FROM players p
       JOIN rooms r ON r.id = p.room_id
       WHERE p.account_id = ? AND r.game_state = 'tournament'
       FOR UPDATE`,
      [req.account.id]
    );
    if (playerRows.length === 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: 'Not in tournament phase', code: 'INVALID_PHASE' });
    }
    const player = playerRows[0];

    if (!player.is_host) {
      await conn.rollback();
      return res.status(403).json({ success: false, error: 'Only the host can complete the tournament', code: 'NOT_HOST' });
    }

    // Check all matches are completed
    const [pendingMatches] = await conn.execute(
      "SELECT id FROM tournament_matches WHERE room_id = ? AND status != 'completed'",
      [player.room_id]
    );
    if (pendingMatches.length > 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: 'Not all matches completed', code: 'INVALID_ACTION' });
    }

    // Check win condition
    const [allPlayers] = await conn.execute(
      'SELECT * FROM players WHERE room_id = ? ORDER BY player_number',
      [player.room_id]
    );

    const badgesToWin = player.game_mode === 'ranked' ? config.RANKED_BADGES_TO_WIN : config.BADGES_TO_WIN;
    const { hasWinner, winners } = checkWinCondition(allPlayers, badgesToWin);

    await conn.commit();

    if (hasWinner) {
      if (winners.length === 1) {
        // Single winner!
        await transitionTo(player.room_id, 'finished', async (c, room) => {
          await c.execute('UPDATE rooms SET winner_player_id = ? WHERE id = ?', [winners[0].id, room.id]);

          // Update account stats
          if (winners[0].account_id) {
            await c.execute(
              'UPDATE accounts SET games_won = games_won + 1 WHERE id = ?',
              [winners[0].account_id]
            );
          }
          // Increment games_played for all
          for (const p of allPlayers) {
            if (p.account_id) {
              await c.execute(
                'UPDATE accounts SET games_played = games_played + 1 WHERE id = ?',
                [p.account_id]
              );
            }
          }

          // Handle ranked ELO
          if (room.game_mode === 'ranked') {
            await handleRankedPlacements(c, room.id, allPlayers);
          }

          return { winner_id: winners[0].id, winner_name: winners[0].player_name };
        });

        broadcast(player.room_code, 'game_finished', {
          winner_id: winners[0].id,
          winner_name: winners[0].player_name,
          badges: winners[0].badges,
        });

        return res.json({ success: true, game_finished: true, winner_name: winners[0].player_name });
      } else {
        // Tiebreaker — multiple winners, generate tiebreaker brackets
        const tiebreakers = generateBrackets(winners, player.current_route, true);

        const conn2 = await getConnection();
        try {
          await conn2.beginTransaction();
          // Delete old non-tiebreaker matches
          await conn2.execute(
            'DELETE FROM tournament_matches WHERE room_id = ? AND is_tiebreaker = FALSE',
            [player.room_id]
          );
          for (const match of tiebreakers) {
            await conn2.execute(
              `INSERT INTO tournament_matches
               (room_id, match_index, player1_id, player2_id, is_npc_battle, npc_route, is_tiebreaker)
               VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
              [player.room_id, match.match_index, match.player1_id, match.player2_id,
               match.is_npc_battle, match.npc_route]
            );
          }
          await conn2.commit();
        } catch (e) {
          await conn2.rollback();
          throw e;
        } finally {
          conn2.release();
        }

        broadcast(player.room_code, 'tournament_updated', {
          tiebreaker: true,
          matches: tiebreakers,
          tied_players: winners.map((w) => ({ id: w.id, name: w.player_name, badges: w.badges })),
        });

        return res.json({ success: true, game_finished: false, tiebreaker: true });
      }
    }

    // No winner — advance to next route
    const totalRoutes = player.game_mode === 'ranked' ? config.RANKED_TOTAL_ROUTES : config.TOTAL_ROUTES;
    const nextRoute = player.current_route + 1;

    if (nextRoute > totalRoutes) {
      // Game should have ended — force a winner (highest badges)
      const sorted = [...allPlayers].sort((a, b) => b.badges - a.badges);
      const topBadges = sorted[0].badges;
      const topPlayers = sorted.filter((p) => p.badges === topBadges);

      if (topPlayers.length === 1) {
        await transitionTo(player.room_id, 'finished', async (c, room) => {
          await c.execute('UPDATE rooms SET winner_player_id = ? WHERE id = ?', [topPlayers[0].id, room.id]);
          return { winner_id: topPlayers[0].id, winner_name: topPlayers[0].player_name };
        });
        broadcast(player.room_code, 'game_finished', {
          winner_id: topPlayers[0].id,
          winner_name: topPlayers[0].player_name,
          badges: topPlayers[0].badges,
        });
        return res.json({ success: true, game_finished: true });
      }

      // Still tied — tiebreaker
      const tiebreakers = generateBrackets(topPlayers, player.current_route, true);
      const conn3 = await getConnection();
      try {
        await conn3.beginTransaction();
        for (const match of tiebreakers) {
          await conn3.execute(
            `INSERT INTO tournament_matches
             (room_id, match_index, player1_id, player2_id, is_npc_battle, npc_route, is_tiebreaker)
             VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
            [player.room_id, match.match_index, match.player1_id, match.player2_id,
             match.is_npc_battle, match.npc_route]
          );
        }
        await conn3.commit();
      } catch (e) {
        await conn3.rollback();
        throw e;
      } finally {
        conn3.release();
      }
      broadcast(player.room_code, 'tournament_updated', { tiebreaker: true, matches: tiebreakers });
      return res.json({ success: true, game_finished: false, tiebreaker: true });
    }

    // Transition to catching phase for next route
    await transitionTo(player.room_id, 'catching', async (c, room) => {
      const encounters = allPlayers.length * config.TURNS_PER_PLAYER;

      // Clean up old data
      await c.execute('DELETE FROM wild_pokemon WHERE room_id = ?', [room.id]);
      await c.execute('DELETE FROM encountered_pokemon WHERE room_id = ?', [room.id]);
      await c.execute('DELETE FROM tournament_matches WHERE room_id = ? AND is_tiebreaker = FALSE', [room.id]);

      // Reset ready flags
      await c.execute('UPDATE players SET is_ready = FALSE WHERE room_id = ?', [room.id]);

      // Update route and encounters
      await c.execute(
        'UPDATE rooms SET current_route = ?, current_player_turn = 0, encounters_remaining = ?, current_match_index = NULL WHERE id = ?',
        [nextRoute, encounters, room.id]
      );

      // Spawn first wild Pokémon
      const wildData = await spawnWildPokemon(c, room.id, nextRoute);

      return {
        new_route: nextRoute,
        encounters_remaining: encounters,
        wild_pokemon: wildData,
        first_player_name: allPlayers[0].player_name,
      };
    });

    res.json({ success: true, game_finished: false, new_route: nextRoute });
  } catch (err) {
    await conn.rollback();
    console.error('Tournament complete error:', err);
    res.status(500).json({ success: false, error: err.message, code: err.code || 'INTERNAL_ERROR' });
  } finally {
    conn.release();
  }
});

/**
 * Handle ranked mode placements and ELO changes.
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {number} roomId
 * @param {Object[]} players
 */
async function handleRankedPlacements(conn, roomId, players) {
  // Sort by badges descending, then by money as tiebreaker
  const sorted = [...players].sort((a, b) => {
    if (b.badges !== a.badges) return b.badges - a.badges;
    return b.money - a.money;
  });

  for (let i = 0; i < sorted.length; i++) {
    const placement = i + 1;
    const p = sorted[i];

    const eloChange = config.ELO_PLACEMENT_CHANGES[placement] || 0;
    const goldReward = config.GOLD_PLACEMENT_REWARDS[placement] || 0;

    if (p.account_id) {
      // Get current ELO
      const [acctRows] = await conn.execute('SELECT elo FROM accounts WHERE id = ?', [p.account_id]);
      const currentElo = acctRows.length > 0 ? acctRows[0].elo : 0;
      const newElo = Math.max(0, currentElo + eloChange);

      // Update account ELO + gold
      await conn.execute(
        'UPDATE accounts SET elo = ?, gold = gold + ? WHERE id = ?',
        [newElo, goldReward, p.account_id]
      );

      // Record ELO history
      await conn.execute(
        `INSERT INTO elo_history (account_id, room_id, placement, elo_before, elo_after, elo_change)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [p.account_id, roomId, placement, currentElo, newElo, eloChange]
      );
    }

    // Record placement
    await conn.execute(
      `INSERT INTO game_placements (room_id, player_id, account_id, placement, gold_earned, elo_change)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [roomId, p.id, p.account_id, placement, goldReward, eloChange]
    );
  }
}

module.exports = router;
