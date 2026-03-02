/**
 * @module websocket/broadcaster
 * @description Room-based WebSocket event broadcasting.
 * Events are pushed inline when state changes occur — no DB polling.
 */

/**
 * Map of room_code → Set<WebSocket>
 * @type {Map<string, Set<import('ws').WebSocket>>}
 */
const roomConnections = new Map();

/**
 * Register a WebSocket connection for a room.
 * @param {string} roomCode
 * @param {import('ws').WebSocket} ws
 */
function addConnection(roomCode, ws) {
  if (!roomConnections.has(roomCode)) {
    roomConnections.set(roomCode, new Set());
  }
  roomConnections.get(roomCode).add(ws);
}

/**
 * Remove a WebSocket connection from a room.
 * @param {string} roomCode
 * @param {import('ws').WebSocket} ws
 */
function removeConnection(roomCode, ws) {
  const conns = roomConnections.get(roomCode);
  if (conns) {
    conns.delete(ws);
    if (conns.size === 0) {
      roomConnections.delete(roomCode);
    }
  }
}

/**
 * Broadcast an event to all connected clients in a room.
 * @param {string} roomCode
 * @param {string} event   - Event type name
 * @param {Object} data    - Event payload
 */
function broadcast(roomCode, event, data = {}) {
  const conns = roomConnections.get(roomCode);
  if (!conns || conns.size === 0) return;

  const message = JSON.stringify({
    event,
    data,
    timestamp: Date.now(),
  });

  for (const ws of conns) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(message);
    }
  }
}

/**
 * Send an event to a specific player's WebSocket(s) in a room.
 * @param {string} roomCode
 * @param {number} accountId
 * @param {string} event
 * @param {Object} data
 */
function sendToPlayer(roomCode, accountId, event, data = {}) {
  const conns = roomConnections.get(roomCode);
  if (!conns) return;

  const message = JSON.stringify({
    event,
    data,
    timestamp: Date.now(),
  });

  for (const ws of conns) {
    if (ws.readyState === 1 && ws.accountId === accountId) {
      ws.send(message);
    }
  }
}

/**
 * Get the count of active connections in a room.
 * @param {string} roomCode
 * @returns {number}
 */
function getConnectionCount(roomCode) {
  const conns = roomConnections.get(roomCode);
  return conns ? conns.size : 0;
}

/**
 * Clean up all connections for a room (e.g., game ended, room expired).
 * @param {string} roomCode
 */
function cleanupRoom(roomCode) {
  const conns = roomConnections.get(roomCode);
  if (conns) {
    for (const ws of conns) {
      ws.close(1000, 'Room closed');
    }
    roomConnections.delete(roomCode);
  }
}

module.exports = {
  addConnection,
  removeConnection,
  broadcast,
  sendToPlayer,
  getConnectionCount,
  cleanupRoom,
  roomConnections,
};
