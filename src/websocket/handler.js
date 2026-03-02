/**
 * @module websocket/handler
 * @description WebSocket connection management.
 * Handles authentication on connect, room joining, heartbeat, and cleanup.
 */

const { WebSocketServer } = require('ws');
const url = require('url');
const { verifyToken } = require('../auth');
const { query } = require('../db');
const { addConnection, removeConnection, broadcast } = require('./broadcaster');

/** @type {WebSocketServer|null} */
let wss = null;

/**
 * Initialize the WebSocket server on an existing HTTP server.
 * Clients connect with: ws://host/?token=<jwt>&room_code=<code>
 *
 * @param {import('http').Server} server
 */
function initWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', async (ws, req) => {
    try {
      const params = new url.URL(req.url, 'http://localhost').searchParams;
      const token = params.get('token');
      const roomCode = params.get('room_code');

      if (!token || !roomCode) {
        ws.close(4001, 'Missing token or room_code');
        return;
      }

      // Verify JWT
      const decoded = verifyToken(token);
      if (!decoded) {
        ws.close(4002, 'Invalid or expired token');
        return;
      }

      // Verify account exists
      const [accounts] = await query('SELECT id, nickname FROM accounts WHERE id = ?', [decoded.accountId]);
      if (accounts.length === 0) {
        ws.close(4003, 'Account not found');
        return;
      }

      // Verify room exists
      const [rooms] = await query('SELECT id, room_code FROM rooms WHERE room_code = ?', [roomCode]);
      if (rooms.length === 0) {
        ws.close(4004, 'Room not found');
        return;
      }

      // Verify player is in this room
      const [players] = await query(
        'SELECT id, player_name, player_number FROM players WHERE room_id = ? AND account_id = ?',
        [rooms[0].id, decoded.accountId]
      );
      if (players.length === 0) {
        ws.close(4005, 'Not a member of this room');
        return;
      }

      // Attach metadata to the WebSocket
      ws.accountId = decoded.accountId;
      ws.roomCode = roomCode;
      ws.playerId = players[0].id;
      ws.playerName = players[0].player_name;
      ws.isAlive = true;

      // Register in room
      addConnection(roomCode, ws);

      // Send connected acknowledgement
      ws.send(JSON.stringify({
        event: 'connected',
        data: {
          status: 'connected',
          room_code: roomCode,
          player_id: players[0].id,
          player_name: players[0].player_name,
        },
        timestamp: Date.now(),
      }));

      // Handle messages (only ping expected)
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ping') {
            ws.isAlive = true;
            ws.send(JSON.stringify({ event: 'pong', data: {}, timestamp: Date.now() }));
          }
        } catch {
          // Ignore malformed messages
        }
      });

      // Handle close
      ws.on('close', () => {
        removeConnection(roomCode, ws);
      });

      // Handle errors
      ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
        removeConnection(roomCode, ws);
      });

    } catch (err) {
      console.error('WebSocket connection error:', err);
      ws.close(4000, 'Internal error');
    }
  });

  // Heartbeat interval — detect broken connections
  const heartbeatInterval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        if (ws.roomCode) removeConnection(ws.roomCode, ws);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  // Respond to pong frames
  wss.on('connection', (ws) => {
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  });

  console.log('WebSocket server initialized');
}

/**
 * Get the WebSocketServer instance.
 * @returns {WebSocketServer|null}
 */
function getWss() {
  return wss;
}

module.exports = { initWebSocket, getWss };
