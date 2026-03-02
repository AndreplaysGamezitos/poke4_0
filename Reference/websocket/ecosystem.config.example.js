/**
 * PM2 Ecosystem Configuration for PokeFodase WebSocket Server
 * 
 * INSTRUCTIONS:
 * 1. Copy this file to: ecosystem.config.js
 * 2. Replace YOUR_STRONG_RANDOM_SECRET with a real secret (32+ chars)
 *    - Must match WS_BROADCAST_SECRET in api/broadcast.php
 * 3. Start with: pm2 start ecosystem.config.js
 * 4. Save: pm2 save && pm2 startup
 * 
 * NOTE: Uses port 3001 by default to avoid conflicts if another
 *       Node.js server is already running on port 3000.
 *       Change the PORT if needed — just keep it consistent with broadcast.php.
 * 
 * DO NOT commit ecosystem.config.js to git (it contains secrets).
 */
module.exports = {
  apps: [{
    name: 'pokefodase-ws',
    script: 'server.js',
    cwd: '/var/www/pokefodase/websocket',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      BROADCAST_SECRET: 'YOUR_STRONG_RANDOM_SECRET_32_CHARS'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: '/var/log/pokefodase-ws/error.log',
    out_file: '/var/log/pokefodase-ws/out.log',
    merge_logs: true
  }]
};
