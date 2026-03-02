/**
 * @module index
 * @description Entry point: Express HTTP server + WebSocket server.
 * Both share the same port via the HTTP upgrade mechanism.
 */

require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const path = require('path');

const { initWebSocket } = require('./websocket/handler');
const config = require('./config');

// ── Express app ──────────────────────────────────────────
const app = express();

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Static files (frontend) ─────────────────────────────
// Serve the Reference frontend files for now (index.html, css, js, fonts)
const publicDir = process.env.PUBLIC_DIR || path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// ── API Routes ───────────────────────────────────────────
app.use('/api/account', require('./routes/account'));
app.use('/api/room', require('./routes/room'));
app.use('/api/game', require('./routes/game'));
app.use('/api/catching', require('./routes/catching'));
app.use('/api/town', require('./routes/town'));
app.use('/api/tournament', require('./routes/tournament'));
app.use('/api/battle', require('./routes/battle'));

// ── Health check ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

// ── 404 handler (API only) ───────────────────────────────
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found', code: 'NOT_FOUND' });
});

// ── Global error handler ─────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    code: 'INTERNAL_ERROR',
  });
});

// ── HTTP + WebSocket server ──────────────────────────────
const server = http.createServer(app);
initWebSocket(server);

const PORT = parseInt(process.env.PORT, 10) || 3000;
server.listen(PORT, () => {
  console.log(`PokeFodase v3.0 server running on port ${PORT}`);
  console.log(`  HTTP API:   http://localhost:${PORT}/api`);
  console.log(`  WebSocket:  ws://localhost:${PORT}`);
  console.log(`  Health:     http://localhost:${PORT}/api/health`);
});

// ── Room cleanup interval ────────────────────────────────
// Clean up finished rooms older than ROOM_CLEANUP_MS
setInterval(async () => {
  try {
    const { query } = require('./db');
    const [result] = await query(
      `DELETE FROM rooms WHERE game_state = 'finished'
       AND updated_at < DATE_SUB(NOW(), INTERVAL ? SECOND)`,
      [Math.floor(config.ROOM_CLEANUP_MS / 1000)]
    );
    if (result.affectedRows > 0) {
      console.log(`Cleaned up ${result.affectedRows} finished room(s)`);
    }
  } catch (err) {
    console.error('Room cleanup error:', err);
  }
}, config.ROOM_CLEANUP_MS);

// ── Graceful shutdown ────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down...');
  server.close(() => {
    process.exit(0);
  });
});

module.exports = { app, server };
