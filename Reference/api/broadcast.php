<?php
/**
 * PokeFodase - Event Broadcaster
 * 
 * Centralized function to broadcast events to clients.
 * Writes to database (for history/fallback) AND sends to WebSocket server.
 */

require_once __DIR__ . '/../config.php';

// WebSocket Server Configuration
define('WS_SERVER_URL', 'http://localhost:3001/broadcast'); // Must match the PORT in websocket/ecosystem.config.js
define('WS_BROADCAST_SECRET', '9af4a317f97e4a09aa6d2df96b18403d1642e8abe43b484dbe103a021ba69f65');
define('WS_ENABLED', true); // Set to false to disable WebSocket and use SSE only

/**
 * Broadcast an event to all clients in a room
 * 
 * @param int $roomId - The database room ID
 * @param string $roomCode - The room code (needed for WebSocket)
 * @param string $eventType - The event type/name
 * @param array $eventData - The event payload
 * @param bool $writeToDb - Whether to write to game_events table (default true)
 * @return bool - Success status
 */
function broadcastGameEvent($roomId, $roomCode, $eventType, $eventData, $writeToDb = true) {
    $success = true;
    
    // 1. Write to database (for history and SSE fallback)
    if ($writeToDb) {
        try {
            $db = getDB();
            $stmt = $db->prepare("INSERT INTO game_events (room_id, event_type, event_data) VALUES (?, ?, ?)");
            $stmt->execute([$roomId, $eventType, json_encode($eventData)]);
            
            // Update room's last_update timestamp
            $stmt = $db->prepare("UPDATE rooms SET last_update = CURRENT_TIMESTAMP WHERE id = ?");
            $stmt->execute([$roomId]);
        } catch (Exception $e) {
            error_log("broadcastGameEvent DB error: " . $e->getMessage());
            $success = false;
        }
    }
    
    // 2. Send to WebSocket server (for instant push)
    if (WS_ENABLED) {
        $wsSuccess = sendToWebSocketServer($roomCode, $eventType, $eventData);
        if (!$wsSuccess) {
            // WebSocket failed, but DB write succeeded - SSE will pick it up
            error_log("broadcastGameEvent WS failed for room $roomCode event $eventType");
        }
    }
    
    return $success;
}

/**
 * Send event to WebSocket server via HTTP POST
 * 
 * @param string $roomCode - The room code
 * @param string $eventType - The event type
 * @param array $eventData - The event payload
 * @return bool - Success status
 */
function sendToWebSocketServer($roomCode, $eventType, $eventData) {
    // Prepare the payload
    $payload = json_encode([
        'secret' => WS_BROADCAST_SECRET,
        'room_code' => $roomCode,
        'event_type' => $eventType,
        'event_data' => $eventData
    ]);
    
    // Use cURL for the HTTP request
    $ch = curl_init(WS_SERVER_URL);
    
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Content-Length: ' . strlen($payload)
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 2, // 2 second timeout - don't block PHP for long
        CURLOPT_CONNECTTIMEOUT => 1
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($error) {
        error_log("WS broadcast cURL error for '$eventType' in room $roomCode → " . WS_SERVER_URL . ": $error");
        return false;
    }
    
    if ($httpCode !== 200) {
        error_log("WS broadcast HTTP $httpCode for '$eventType' in room $roomCode → " . WS_SERVER_URL . ": $response");
        return false;
    }
    
    return true;
}

/**
 * Helper to get room code from room ID
 * (Some functions only have room ID, not code)
 */
function getRoomCodeById($roomId) {
    static $cache = [];
    
    if (isset($cache[$roomId])) {
        return $cache[$roomId];
    }
    
    $db = getDB();
    $stmt = $db->prepare("SELECT room_code FROM rooms WHERE id = ?");
    $stmt->execute([$roomId]);
    $room = $stmt->fetch();
    
    if ($room) {
        $cache[$roomId] = $room['room_code'];
        return $room['room_code'];
    }
    
    return null;
}

/**
 * Simplified broadcast function when you only have room ID
 * Automatically looks up room code
 */
function broadcastEvent($roomId, $eventType, $eventData, $writeToDb = true) {
    $roomCode = getRoomCodeById($roomId);
    if (!$roomCode) {
        error_log("broadcastEvent: Could not find room code for room ID $roomId");
        return false;
    }
    
    return broadcastGameEvent($roomId, $roomCode, $eventType, $eventData, $writeToDb);
}
?>
