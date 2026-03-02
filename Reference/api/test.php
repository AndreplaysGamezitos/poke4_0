<?php
/**
 * PokeFodase - Test API Endpoint
 * Used for verifying installation
 */

require_once __DIR__ . '/../config.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$test = $_GET['test'] ?? 'php';

switch ($test) {
    case 'php':
        // Basic PHP test
        jsonResponse([
            'success' => true,
            'php_version' => phpversion(),
            'session_active' => session_status() === PHP_SESSION_ACTIVE,
            'extensions' => [
                'pdo' => extension_loaded('pdo'),
                'pdo_mysql' => extension_loaded('pdo_mysql'),
                'json' => extension_loaded('json')
            ]
        ]);
        break;
        
    case 'database':
        // Database connection test
        try {
            $db = getDB();
            
            // Get list of tables
            $stmt = $db->query("SHOW TABLES");
            $tables = $stmt->fetchAll(PDO::FETCH_COLUMN);
            
            jsonResponse([
                'success' => true,
                'message' => 'Database connected successfully',
                'tables' => $tables,
                'table_count' => count($tables)
            ]);
        } catch (PDOException $e) {
            jsonResponse([
                'success' => false,
                'error' => $e->getMessage()
            ], 500);
        }
        break;
        
    case 'config':
        // Config test (don't expose sensitive info)
        jsonResponse([
            'success' => true,
            'max_players' => MAX_PLAYERS,
            'badges_to_win' => BADGES_TO_WIN,
            'exp_to_evolve' => EXP_TO_EVOLVE
        ]);
        break;
    
    case 'websocket':
        // WebSocket broadcast test - verifies PHP can reach the WS server
        require_once __DIR__ . '/broadcast.php';
        
        $roomCode = $_GET['room_code'] ?? 'TEST';
        
        // First check if the WS server is reachable
        $ch = curl_init(WS_SERVER_URL);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 3,
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_NOBODY => false,
            CURLOPT_CUSTOMREQUEST => 'GET'
        ]);
        $healthResponse = curl_exec($ch);
        $healthHttpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $healthError = curl_error($ch);
        curl_close($ch);
        
        // Try to send a test broadcast
        $testPayload = json_encode([
            'secret' => WS_BROADCAST_SECRET,
            'room_code' => $roomCode,
            'event_type' => 'test_broadcast',
            'event_data' => ['message' => 'WebSocket broadcast test', 'timestamp' => time()]
        ]);
        
        $ch2 = curl_init(WS_SERVER_URL);
        curl_setopt_array($ch2, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $testPayload,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Content-Length: ' . strlen($testPayload)
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 3,
            CURLOPT_CONNECTTIMEOUT => 2
        ]);
        $broadcastResponse = curl_exec($ch2);
        $broadcastHttpCode = curl_getinfo($ch2, CURLINFO_HTTP_CODE);
        $broadcastError = curl_error($ch2);
        curl_close($ch2);
        
        jsonResponse([
            'success' => true,
            'ws_config' => [
                'url' => WS_SERVER_URL,
                'enabled' => WS_ENABLED,
                'secret_length' => strlen(WS_BROADCAST_SECRET)
            ],
            'health_check' => [
                'http_code' => $healthHttpCode,
                'error' => $healthError ?: null,
                'response' => $healthResponse ? json_decode($healthResponse, true) : null
            ],
            'broadcast_test' => [
                'http_code' => $broadcastHttpCode,
                'error' => $broadcastError ?: null,
                'response' => $broadcastResponse ? json_decode($broadcastResponse, true) : null,
                'room_code' => $roomCode
            ]
        ]);
        break;
        
    default:
        jsonResponse(['error' => 'Unknown test'], 400);
}
?>
