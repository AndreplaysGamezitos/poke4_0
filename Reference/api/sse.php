<?php
/**
 * PokeFodase - Server-Sent Events Handler
 * Provides real-time updates to clients
 */

require_once __DIR__ . '/../config.php';

// IMPORTANT: Close session immediately to prevent blocking other requests
// SSE keeps a long-running connection, and PHP sessions are locked by default
session_write_close();

// SSE Headers
header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('Connection: keep-alive');
header('Access-Control-Allow-Origin: *');
header('X-Accel-Buffering: no'); // Disable nginx buffering

// Get room code from query
$roomCode = $_GET['room_code'] ?? '';
if (empty($roomCode)) {
    echo "event: error\n";
    echo "data: " . json_encode(['error' => 'Room code required']) . "\n\n";
    exit;
}

$db = getDB();

// Get room ID
$stmt = $db->prepare("SELECT id FROM rooms WHERE room_code = ?");
$stmt->execute([$roomCode]);
$room = $stmt->fetch();

if (!$room) {
    echo "event: error\n";
    echo "data: " . json_encode(['error' => 'Room not found']) . "\n\n";
    exit;
}

$roomId = $room['id'];
$lastEventId = isset($_SERVER['HTTP_LAST_EVENT_ID']) ? intval($_SERVER['HTTP_LAST_EVENT_ID']) : 0;

// If no last event ID, get the latest one
if ($lastEventId == 0) {
    $stmt = $db->prepare("SELECT MAX(id) as max_id FROM game_events WHERE room_id = ?");
    $stmt->execute([$roomId]);
    $result = $stmt->fetch();
    $lastEventId = $result['max_id'] ?? 0;
}

// Send initial connection success
echo "event: connected\n";
echo "data: " . json_encode(['status' => 'connected', 'room_code' => $roomCode]) . "\n\n";
ob_flush();
flush();

// Main event loop
$timeout = 30; // seconds before sending keep-alive
$startTime = time();
$lastPoll = 0;

while (true) {
    // Check if client disconnected
    if (connection_aborted()) {
        break;
    }
    
    $now = time();
    
    // Poll for new events every second
    if ($now - $lastPoll >= 1) {
        $lastPoll = $now;
        
        // Get new events
        $stmt = $db->prepare("
            SELECT id, event_type, event_data, created_at 
            FROM game_events 
            WHERE room_id = ? AND id > ? 
            ORDER BY id ASC
            LIMIT 50
        ");
        $stmt->execute([$roomId, $lastEventId]);
        $events = $stmt->fetchAll();
        
        foreach ($events as $event) {
            echo "id: {$event['id']}\n";
            echo "event: {$event['event_type']}\n";
            echo "data: " . json_encode([
                'type' => $event['event_type'],
                'data' => json_decode($event['event_data'], true),
                'timestamp' => $event['created_at']
            ]) . "\n\n";
            
            $lastEventId = $event['id'];
            ob_flush();
            flush();
        }
        
        // Also check for room state changes
        $stmt = $db->prepare("SELECT game_state, current_player_turn, last_update FROM rooms WHERE id = ?");
        $stmt->execute([$roomId]);
        $roomState = $stmt->fetch();
        
        // Send periodic state sync
        if (empty($events) && ($now - $startTime) % 5 == 0) {
            echo "event: state_sync\n";
            echo "data: " . json_encode([
                'game_state' => $roomState['game_state'],
                'current_turn' => $roomState['current_player_turn']
            ]) . "\n\n";
            ob_flush();
            flush();
        }
    }
    
    // Send keep-alive every 15 seconds
    if ($now - $startTime >= 15 && ($now - $startTime) % 15 == 0) {
        echo ": keepalive\n\n";
        ob_flush();
        flush();
    }
    
    // Sleep to prevent CPU hammering
    usleep(500000); // 0.5 seconds
    
    // Timeout after 5 minutes (client should reconnect)
    if ($now - $startTime >= 300) {
        echo "event: reconnect\n";
        echo "data: " . json_encode(['reason' => 'timeout']) . "\n\n";
        ob_flush();
        flush();
        break;
    }
}
?>
