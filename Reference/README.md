# PokeFodase v2.0 - Web Game

A web-based Pokémon catching and battling game with real-time multiplayer support, ranked matchmaking, and ELO-based competitive play.

## What's New in v2.0

- **Account System**: Nickname + 8-digit code login (no password)
- **Ranked Mode**: 8-player solo queue with ELO-based matchmaking
- **5 Merged Routes**: Consolidated from 8 routes for tighter gameplay
- **Stat Items**: Buy HP Boost (+3 HP), Attack Boost (+1 ATK), Speed Boost (+3 SPD) for your Pokémon
- **HP-based Catch Rates**: Each Pokémon has a catch rate (15-40%) instead of dice rolls
- **ELO System**: Starting at 0, with placement-based gains/losses (+25 to -25)
- **Gold Rewards**: Top 4 players earn gold based on placement
- **8 Encounters per Player**: Round-robin catch turns

## Architecture

### Real-time Event System

The game uses a hybrid real-time communication system:

1. **Primary: WebSocket** (Node.js server) - For low-latency, instant event delivery
2. **Fallback: SSE** (PHP) - For environments where WebSocket is unavailable

```
┌─────────────┐      HTTP POST      ┌─────────────────┐
│  PHP APIs   │ ─────────────────► │  Node.js WS     │
│  (Events)   │                     │  Server         │
└─────────────┘                     └────────┬────────┘
       │                                     │
       │ Write to DB                         │ WebSocket push
       ▼                                     ▼
┌─────────────┐                     ┌─────────────────┐
│  Database   │ ◄── SSE polling ──  │  Game Clients   │
│  (Events)   │     (fallback)      │  (Browser)      │
└─────────────┘                     └─────────────────┘
```

### Event Flow

1. Game actions trigger PHP API calls
2. PHP APIs call `broadcastGameEvent()` which:
   - Writes event to database (history + SSE fallback)
   - POSTs event to WebSocket server
3. WebSocket server broadcasts to all connected clients in the room
4. Clients receive events instantly via WebSocket (or via SSE if WS unavailable)

## Setup

### Prerequisites

- PHP 7.4+ with PDO MySQL extension
- MySQL/MariaDB database
- Node.js 18+ (for WebSocket server)

### Database Setup

1. Import the initial database schema (if new install):
   ```sql
   source database_setup.sql;
   source routes_setup.sql;
   source pokemon_data.sql;
   ```

2. **Run the v2.0 migration** (required for all existing installs):
   ```sql
   source database/migration_v2.sql;
   ```
   This migration:
   - Creates `accounts`, `elo_history`, `ranked_queue`, `game_placements` tables
   - Adds `account_id` to players, `game_mode` to rooms
   - Adds `bonus_hp`, `bonus_attack`, `bonus_speed` to player_pokemon
   - Adds `catch_rate` to pokemon_dex with HP-based values
   - Merges 8 routes into 5 balanced routes

3. Update `config.php` with your database credentials.

### WebSocket Server Setup

1. Navigate to the WebSocket directory:
   ```bash
   cd websocket
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables (optional):
   ```bash
   # Windows PowerShell
   $env:PORT = "3000"
   $env:BROADCAST_SECRET = "your_secret_key"
   
   # Linux/Mac
   export PORT=3000
   export BROADCAST_SECRET=your_secret_key
   ```

4. Start the server:
   ```bash
   npm start
   # or for development with auto-reload:
   npm run dev
   ```

### Configuration

#### PHP Configuration (`api/broadcast.php`)

```php
define('WS_SERVER_URL', 'http://localhost:3000/broadcast'); // WebSocket server endpoint
define('WS_BROADCAST_SECRET', 'your_secret_key');           // Must match server secret
define('WS_ENABLED', true);                                  // Set false for SSE-only mode
```

#### Frontend Configuration (`js/game.js`)

```javascript
const WS_CONFIG = {
    enabled: true,                    // Set false to force SSE mode
    url: 'ws://localhost:3000',       // WebSocket server URL
    reconnectDelay: 3000,             // Reconnect delay in ms
    maxReconnectAttempts: 5           // Max reconnect attempts before SSE fallback
};
```

## Production Deployment

> **📖 Full deployment guide**: See **[DEPLOY.md](DEPLOY.md)** for a comprehensive step-by-step guide covering VPS setup, Nginx, SSL, PM2, database, GitHub CI/CD, and a launch checklist.

### Quick Summary

1. **Update URLs** for your production domain in `broadcast.php`, `game.js`
2. **Use WSS** (Secure WebSocket) via Nginx reverse proxy + SSL (Let's Encrypt)
3. **Set strong secrets** in `broadcast.php` and `ecosystem.config.js`
4. **Run with PM2**: `pm2 start ecosystem.config.js && pm2 save && pm2 startup`
5. **Disable error display** in `config.php`: `display_errors = 0`

### Key Files to Edit for Production

| File | What to change |
|------|---------------|
| `config.php` | DB credentials, `display_errors = 0` |
| `api/broadcast.php` | `WS_BROADCAST_SECRET`, `WS_ENABLED = true` |
| `js/game.js` | `WS_CONFIG.url = 'wss://poke.labzts.fun/ws'`, `enabled = true` |
| `websocket/ecosystem.config.js` | `BROADCAST_SECRET` (copy from `.example.js`) |

## API Endpoints

### WebSocket Server

- `ws://host:port/?room_code=XXX&player_id=N` - Client connection
- `POST /broadcast` - Event broadcast (PHP → WS server)
- `GET /health` - Health check endpoint
- `GET /stats` - Server statistics

### PHP APIs

- `api/room.php` - Room management (create, join, leave)
- `api/account.php` - Account creation, login, profile, leaderboard
- `api/ranked.php` - Ranked queue, matchmaking, ELO finalization
- `api/pokemon.php` - Pokémon data and catching
- `api/catching.php` - Catching phase logic (HP-based catch rates)
- `api/tournament.php` - Tournament/battle management (with stat bonuses)
- `api/town.php` - Town phase shop (Ultra Ball, Evo Soda, Mega Stone, Stat Items)
- `api/sse.php` - Server-Sent Events (fallback)

## Troubleshooting

### WebSocket Connection Issues

1. **Check server is running**: `curl http://localhost:3000/health`
2. **Check firewall**: Ensure port 3000 is open
3. **Check CORS**: Browser may block cross-origin WebSocket
4. **Check SSL**: WSS requires valid SSL certificate

### SSE Fallback

If WebSocket fails, the client automatically falls back to SSE after 5 reconnection attempts. Check browser console for connection status messages.

### Event Delivery Issues

1. **Check broadcast secret** matches between PHP and Node.js
2. **Check WebSocket server logs** for POST errors
3. **Verify database events** are being written (SSE will still work)

## Capacity Estimates

| Mode | Concurrent Players | Notes |
|------|-------------------|-------|
| SSE Only | ~60-100 | Limited by PHP processes |
| WebSocket | 200-500+ | Node.js is more efficient |
| Hybrid | 500+ | WS primary, SSE fallback |

## Files Structure

```
Web_Experiment_2.0/
├── api/
│   ├── account.php        # Account management (v2.0)
│   ├── broadcast.php      # Event broadcasting (DB + WS)
│   ├── catching.php       # Catching phase (HP-based rates)
│   ├── pokemon.php        # Pokémon data
│   ├── ranked.php         # Ranked queue & ELO (v2.0)
│   ├── room.php           # Room management
│   ├── sse.php            # SSE endpoint (fallback)
│   ├── tournament.php     # Battle/tournament (stat bonuses)
│   └── town.php           # Town shop (stat items)
├── css/
│   └── styles.css
├── database/
│   └── migration_v2.sql   # v2.0 migration script
├── js/
│   └── game.js            # Frontend game logic
├── websocket/
│   ├── ecosystem.config.example.js  # PM2 config template
│   ├── package.json       # Node.js dependencies
│   └── server.js          # WebSocket server
├── .gitignore             # Git ignore rules
├── config.php             # Database & game configuration
├── deploy.sh              # Server deploy script
├── DEPLOY.md              # Full deployment guide
├── index.html             # Main game page
└── Guidelines/
    └── GameDesignDocument.md
```

## Game Flow (v2.0)

1. **Login/Create Account** → Nickname + 8-digit code
2. **Queue/Create Room** → Ranked (8 players) or Casual (2-8 players)
3. **Initial Selection** → Each player picks a starter Pokémon
4. **For each of 5 Routes:**
   - **Catch Phase** → 8 encounters per player, round-robin turns (5s timer in ranked)
   - **Town Phase** → Buy items (Ultra Ball, Evo Soda, Mega Stone, Stat Boosts), sell Pokémon
   - **Tournament Phase** → PvP battles with gym leader for odd player
5. **Final Results** → ELO changes and gold rewards (ranked mode)

## Configuration Constants (config.php)

| Constant | Value | Description |
|----------|-------|-------------|
| `TOTAL_ROUTES` | 5 | Number of routes in the game |
| `TURNS_PER_PLAYER` | 8 | Number of turns each player gets per route |
| `TURN_TIMER_RANKED` | 5s | Time per catch/battle turn (ranked) |
| `TOWN_TIMER_RANKED` | 60s | Town phase timer (ranked) |
| `PRICE_HP_BOOST` | R$2 | HP Boost item price (+3 HP) |
| `PRICE_ATTACK_BOOST` | R$2 | Attack Boost item price (+1 ATK) |
| `PRICE_SPEED_BOOST` | R$2 | Speed Boost item price (+3 SPD) |
| `ELO_K_FACTOR` | 32 | Standard ELO K-factor |
