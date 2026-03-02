/**
 * PokeFodase - WebSocket Server
 * Handles real-time event broadcasting to game clients
 * 
 * Architecture:
 * - PHP APIs write events to database AND POST to this server
 * - This server broadcasts events to all connected clients in the room
 * - Clients connect via WebSocket and join rooms by room_code
 */

const WebSocket = require('ws');
const express = require('express');
const http = require('http');

// Configuration
const PORT = process.env.PORT || 3001;
const BROADCAST_SECRET = process.env.BROADCAST_SECRET || '9af4a317f97e4a09aa6d2df96b18403d1642e8abe43b484dbe103a021ba69f65';

// Create Express app for HTTP endpoints (PHP will POST events here)
const app = express();
app.use(express.json());

// Root route - simple status page
app.get('/', (req, res) => {
    res.json({
        name: 'PokeFodase WebSocket Server',
        status: 'running',
        endpoints: {
            health: '/health',
            stats: '/stats',
            broadcast: 'POST /broadcast',
            websocket: 'ws://this-server/?room_code=XXX&player_id=N'
        }
    });
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

/**
 * Room Management
 * Maps room_code -> Set of WebSocket connections
 */
const rooms = new Map();

/**
 * Connection Management
 * Maps WebSocket -> { roomCode, playerId, connectedAt }
 */
const connections = new Map();

/**
 * Stats tracking
 */
const stats = {
    totalConnections: 0,
    totalMessages: 0,
    startTime: Date.now()
};

// ============================================
// WebSocket Connection Handling
// ============================================

wss.on('connection', (ws, req) => {
    stats.totalConnections++;
    
    // Parse room_code from URL query string
    // Expected URL: ws://server:port/?room_code=ABC123&player_id=1
    const url = new URL(req.url, `http://${req.headers.host}`);
    const roomCode = url.searchParams.get('room_code');
    const playerId = url.searchParams.get('player_id');
    
    if (!roomCode) {
        ws.send(JSON.stringify({
            event: 'error',
            data: { message: 'room_code is required' }
        }));
        ws.close(4000, 'room_code required');
        return;
    }
    
    // Store connection metadata
    connections.set(ws, {
        roomCode,
        playerId,
        connectedAt: Date.now()
    });
    
    // Join the room
    if (!rooms.has(roomCode)) {
        rooms.set(roomCode, new Set());
    }
    rooms.get(roomCode).add(ws);
    
    console.log(`[WS] Player ${playerId || 'unknown'} joined room ${roomCode}. Room size: ${rooms.get(roomCode).size}`);
    
    // Send connection confirmation
    ws.send(JSON.stringify({
        event: 'connected',
        data: {
            status: 'connected',
            room_code: roomCode,
            player_id: playerId,
            server_time: Date.now()
        }
    }));
    
    // Handle incoming messages from client (for future features like typing indicators)
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleClientMessage(ws, data);
        } catch (e) {
            console.error('[WS] Invalid message:', e.message);
        }
    });
    
    // Handle disconnection
    ws.on('close', () => {
        const connInfo = connections.get(ws);
        if (connInfo) {
            const { roomCode } = connInfo;
            
            // Remove from room
            if (rooms.has(roomCode)) {
                rooms.get(roomCode).delete(ws);
                
                // Clean up empty rooms
                if (rooms.get(roomCode).size === 0) {
                    rooms.delete(roomCode);
                    console.log(`[WS] Room ${roomCode} is now empty, removed.`);
                } else {
                    console.log(`[WS] Player left room ${roomCode}. Room size: ${rooms.get(roomCode).size}`);
                }
            }
            
            // Remove connection tracking
            connections.delete(ws);
        }
    });
    
    // Handle errors
    ws.on('error', (error) => {
        console.error('[WS] Connection error:', error.message);
    });
    
    // Heartbeat - keep connection alive
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });
});

/**
 * Handle messages from WebSocket clients
 */
function handleClientMessage(ws, data) {
    const connInfo = connections.get(ws);
    if (!connInfo) return;
    
    // For now, we only handle ping/pong for keepalive
    // Future: could add typing indicators, etc.
    if (data.type === 'ping') {
        ws.send(JSON.stringify({ event: 'pong', data: { time: Date.now() } }));
    }
}

/**
 * Broadcast event to all clients in a room
 */
function broadcastToRoom(roomCode, eventType, eventData) {
    if (!rooms.has(roomCode)) {
        console.log(`[Broadcast] Room ${roomCode} not found or empty`);
        return 0;
    }
    
    const room = rooms.get(roomCode);
    const message = JSON.stringify({
        event: eventType,
        data: eventData,
        timestamp: new Date().toISOString()
    });
    
    let sentCount = 0;
    room.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
            sentCount++;
        }
    });
    
    stats.totalMessages += sentCount;
    console.log(`[Broadcast] Sent "${eventType}" to ${sentCount} clients in room ${roomCode}`);
    
    return sentCount;
}

// ============================================
// HTTP Endpoints (for PHP to call)
// ============================================

/**
 * POST /broadcast
 * PHP calls this to broadcast an event to a room
 * 
 * Body: {
 *   secret: string,      // Authentication
 *   room_code: string,   // Target room
 *   event_type: string,  // Event name
 *   event_data: object   // Event payload
 * }
 */
app.post('/broadcast', (req, res) => {
    const { secret, room_code, event_type, event_data } = req.body;
    
    // Validate secret (simple auth - PHP and Node.js share this secret)
    if (secret !== BROADCAST_SECRET) {
        console.log('[HTTP] Unauthorized broadcast attempt');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!room_code || !event_type) {
        return res.status(400).json({ error: 'room_code and event_type required' });
    }
    
    const sentCount = broadcastToRoom(room_code, event_type, event_data || {});
    
    res.json({
        success: true,
        sent_to: sentCount,
        room_code,
        event_type
    });
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: Math.floor((Date.now() - stats.startTime) / 1000),
        rooms: rooms.size,
        connections: connections.size,
        totalConnections: stats.totalConnections,
        totalMessages: stats.totalMessages
    });
});

/**
 * GET /stats
 * Detailed statistics
 */
app.get('/stats', (req, res) => {
    const roomStats = [];
    rooms.forEach((clients, roomCode) => {
        roomStats.push({
            room_code: roomCode,
            connections: clients.size
        });
    });
    
    res.json({
        uptime_seconds: Math.floor((Date.now() - stats.startTime) / 1000),
        total_rooms: rooms.size,
        total_connections: connections.size,
        lifetime_connections: stats.totalConnections,
        lifetime_messages: stats.totalMessages,
        rooms: roomStats
    });
});

// ============================================
// Heartbeat (detect dead connections)
// ============================================

const HEARTBEAT_INTERVAL = 30000; // 30 seconds

setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('[Heartbeat] Terminating dead connection');
            return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.ping();
    });
}, HEARTBEAT_INTERVAL);

// ============================================
// Start Server
// ============================================

// Check if running under Phusion Passenger (Hostinger uses this)
if (typeof(PhusionPassenger) !== 'undefined') {
    PhusionPassenger.configure({ autoInstall: false });
    
    server.listen('passenger', () => {
        console.log('[Server] Running under Phusion Passenger');
        console.log('[Server] PokeFodase WebSocket Server started');
    });
} else {
    // Local development - use PORT
    server.listen(PORT, () => {
        console.log('========================================');
        console.log('  PokeFodase WebSocket Server');
        console.log('========================================');
        console.log(`  WebSocket: ws://localhost:${PORT}`);
        console.log(`  HTTP API:  http://localhost:${PORT}`);
        console.log(`  Health:    http://localhost:${PORT}/health`);
        console.log('========================================');
        console.log('  Waiting for connections...');
        console.log('');
    });
}

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('[Server] SIGTERM received, shutting down...');
    
    // Close all WebSocket connections
    wss.clients.forEach((client) => {
        client.close(1001, 'Server shutting down');
    });
    
    server.close(() => {
        console.log('[Server] Closed.');
        process.exit(0);
    });
});
