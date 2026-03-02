/**
 * @module routes/room
 * @description Room creation, joining, leaving, and state retrieval.
 */

const express = require('express');
const crypto = require('crypto');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const { query, getConnection } = require('../db');
const { broadcast } = require('../websocket/broadcaster');
const config = require('../config');

const router = express.Router();

// All room endpoints require authentication
router.use(authenticate);

/**
 * POST /api/room/create
 * Create a new game room. The creating player becomes the host.
 */
router.post(
  '/create',
  validate({
    game_mode: { type: 'string', required: false, enum: ['casual', 'ranked'] },
  }),
  async (req, res) => {
    const conn = await getConnection();
    try {
      await conn.beginTransaction();

      const { game_mode = 'casual' } = req.body;
      const account = req.account;

      // Check player isn't already in a room
      const [existing] = await conn.execute(
        `SELECT p.id, r.room_code FROM players p
         JOIN rooms r ON r.id = p.room_id
         WHERE p.account_id = ? AND r.game_state != 'finished'`,
        [account.id]
      );
      if (existing.length > 0) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          error: 'Already in a room',
          code: 'GAME_IN_PROGRESS',
          room_code: existing[0].room_code,
        });
      }

      // Generate unique room code (6 uppercase alphanumeric)
      let roomCode;
      let attempts = 0;
      while (attempts < 10) {
        roomCode = crypto.randomBytes(3).toString('hex').toUpperCase();
        const [dup] = await conn.execute('SELECT id FROM rooms WHERE room_code = ?', [roomCode]);
        if (dup.length === 0) break;
        attempts++;
      }

      // Set timers based on game mode
      const turnTimer = game_mode === 'ranked' ? config.TURN_TIMER_RANKED : config.TURN_TIMER_CASUAL;
      const townTimer = game_mode === 'ranked' ? config.TOWN_TIMER_RANKED : config.TOWN_TIMER_CASUAL;

      // Insert room
      const [roomResult] = await conn.execute(
        `INSERT INTO rooms (room_code, game_mode, turn_timer, town_timer) VALUES (?, ?, ?, ?)`,
        [roomCode, game_mode, turnTimer, townTimer]
      );
      const roomId = roomResult.insertId;

      // Insert host player
      const [playerResult] = await conn.execute(
        `INSERT INTO players (room_id, account_id, player_number, player_name, avatar_id, is_host)
         VALUES (?, ?, 1, ?, ?, TRUE)`,
        [roomId, account.id, account.nickname, account.avatar_id]
      );

      await conn.commit();

      res.json({
        success: true,
        room_code: roomCode,
        room_id: roomId,
        player_id: playerResult.insertId,
        player_number: 1,
        is_host: true,
      });
    } catch (err) {
      await conn.rollback();
      console.error('Room create error:', err);
      res.status(500).json({ success: false, error: 'Failed to create room', code: 'INTERNAL_ERROR' });
    } finally {
      conn.release();
    }
  }
);

/**
 * POST /api/room/join
 * Join an existing room by room code.
 */
router.post(
  '/join',
  validate({
    room_code: { type: 'string', required: true, min: 1, max: 10 },
  }),
  async (req, res) => {
    const conn = await getConnection();
    try {
      await conn.beginTransaction();

      const { room_code } = req.body;
      const account = req.account;

      // Check player isn't already in a different room
      const [existing] = await conn.execute(
        `SELECT p.id, r.room_code FROM players p
         JOIN rooms r ON r.id = p.room_id
         WHERE p.account_id = ? AND r.game_state != 'finished'`,
        [account.id]
      );
      if (existing.length > 0) {
        // If already in THIS room, return success with current state
        if (existing[0].room_code === room_code.toUpperCase()) {
          const [playerRows] = await conn.execute(
            'SELECT * FROM players WHERE id = ?', [existing[0].id]
          );
          await conn.commit();
          const p = playerRows[0];
          return res.json({
            success: true,
            room_code: room_code.toUpperCase(),
            room_id: p.room_id,
            player_id: p.id,
            player_number: p.player_number,
            is_host: !!p.is_host,
          });
        }
        await conn.rollback();
        return res.status(400).json({
          success: false,
          error: 'Already in another room',
          code: 'GAME_IN_PROGRESS',
          room_code: existing[0].room_code,
        });
      }

      // Lock room row
      const [rooms] = await conn.execute(
        'SELECT * FROM rooms WHERE room_code = ? FOR UPDATE',
        [room_code.toUpperCase()]
      );
      if (rooms.length === 0) {
        await conn.rollback();
        return res.status(404).json({ success: false, error: 'Room not found', code: 'ROOM_NOT_FOUND' });
      }
      const room = rooms[0];

      if (room.game_state !== 'lobby') {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'Game already in progress', code: 'GAME_IN_PROGRESS' });
      }

      // Count current players
      const [players] = await conn.execute(
        'SELECT id, player_number FROM players WHERE room_id = ? ORDER BY player_number',
        [room.id]
      );

      const maxPlayers = room.game_mode === 'ranked' ? config.RANKED_PLAYERS : config.MAX_PLAYERS;
      if (players.length >= maxPlayers) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'Room is full', code: 'ROOM_FULL' });
      }

      // Assign next player number
      const takenNumbers = new Set(players.map((p) => p.player_number));
      let playerNumber = 1;
      while (takenNumbers.has(playerNumber)) playerNumber++;

      // Insert player
      const [playerResult] = await conn.execute(
        `INSERT INTO players (room_id, account_id, player_number, player_name, avatar_id)
         VALUES (?, ?, ?, ?, ?)`,
        [room.id, account.id, playerNumber, account.nickname, account.avatar_id]
      );

      await conn.commit();

      // Broadcast to room
      broadcast(room.room_code, 'player_joined', {
        player_id: playerResult.insertId,
        player_name: account.nickname,
        player_number: playerNumber,
        avatar_id: account.avatar_id,
      });

      res.json({
        success: true,
        room_code: room.room_code,
        room_id: room.id,
        player_id: playerResult.insertId,
        player_number: playerNumber,
        is_host: false,
      });
    } catch (err) {
      await conn.rollback();
      console.error('Room join error:', err);
      res.status(500).json({ success: false, error: 'Failed to join room', code: 'INTERNAL_ERROR' });
    } finally {
      conn.release();
    }
  }
);

/**
 * POST /api/room/leave
 * Leave the current room. If host leaves, transfer host to next player.
 */
router.post('/leave', async (req, res) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    const account = req.account;

    // Find the player's active room
    const [playerRows] = await conn.execute(
      `SELECT p.*, r.room_code, r.game_state FROM players p
       JOIN rooms r ON r.id = p.room_id
       WHERE p.account_id = ? AND r.game_state != 'finished'
       FOR UPDATE`,
      [account.id]
    );
    if (playerRows.length === 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: 'Not in a room', code: 'ROOM_NOT_FOUND' });
    }

    const player = playerRows[0];

    // Only allow leaving from lobby
    if (player.game_state !== 'lobby') {
      await conn.rollback();
      return res.status(400).json({ success: false, error: 'Cannot leave during a game', code: 'GAME_IN_PROGRESS' });
    }

    // Delete player
    await conn.execute('DELETE FROM players WHERE id = ?', [player.id]);

    // Check remaining players
    const [remaining] = await conn.execute(
      'SELECT * FROM players WHERE room_id = ? ORDER BY player_number',
      [player.room_id]
    );

    if (remaining.length === 0) {
      // No players left — delete room
      await conn.execute('DELETE FROM rooms WHERE id = ?', [player.room_id]);
    } else if (player.is_host) {
      // Transfer host
      const newHost = remaining[0];
      await conn.execute('UPDATE players SET is_host = TRUE WHERE id = ?', [newHost.id]);
      broadcast(player.room_code, 'host_changed', {
        player_id: newHost.id,
        player_name: newHost.player_name,
      });
    }

    await conn.commit();

    broadcast(player.room_code, 'player_left', {
      player_id: player.id,
      player_name: player.player_name,
    });

    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error('Room leave error:', err);
    res.status(500).json({ success: false, error: 'Failed to leave room', code: 'INTERNAL_ERROR' });
  } finally {
    conn.release();
  }
});

/**
 * GET /api/room/state
 * Get full room state including all players.
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

    const [players] = await query(
      `SELECT p.id, p.player_number, p.player_name, p.avatar_id,
              p.money, p.ultra_balls, p.badges, p.is_host, p.is_ready,
              p.has_used_mega_stone, p.account_id
       FROM players p WHERE p.room_id = ? ORDER BY p.player_number`,
      [room.id]
    );

    res.json({
      success: true,
      room: {
        id: room.id,
        room_code: room.room_code,
        game_mode: room.game_mode,
        game_state: room.game_state,
        current_route: room.current_route,
        current_player_turn: room.current_player_turn,
        encounters_remaining: room.encounters_remaining,
        turn_timer: room.turn_timer,
        town_timer: room.town_timer,
      },
      players,
    });
  } catch (err) {
    console.error('Room state error:', err);
    res.status(500).json({ success: false, error: 'Failed to get room state', code: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
