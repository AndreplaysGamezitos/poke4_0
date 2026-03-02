<?php
/**
 * PokeFodase - Room Management API
 * Handles room creation, joining, and player management
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/broadcast.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// Wrap everything in try-catch to return JSON errors
try {
    $action = $_GET['action'] ?? $_POST['action'] ?? '';

    switch ($action) {
        case 'create':
            createRoom();
            break;
        case 'join':
            joinRoom();
            break;
        case 'leave':
            leaveRoom();
            break;
        case 'get_room':
            getRoomState();
            break;
        case 'set_ready':
            setPlayerReady();
            break;
        case 'start_game':
            startGame();
            break;
        case 'update_player':
            updatePlayer();
            break;
        default:
            jsonResponse(['error' => 'Invalid action'], 400);
    }
} catch (Exception $e) {
    jsonResponse(['error' => 'Server error: ' . $e->getMessage()], 500);
}

/**
 * Create a new game room
 */
function createRoom() {
    $db = getDB();
    
    // Generate unique room code
    $attempts = 0;
    do {
        $roomCode = generateRoomCode();
        $stmt = $db->prepare("SELECT id FROM rooms WHERE room_code = ?");
        $stmt->execute([$roomCode]);
        $attempts++;
    } while ($stmt->fetch() && $attempts < 10);
    
    if ($attempts >= 10) {
        jsonResponse(['error' => 'Failed to generate unique room code'], 500);
    }
    
    // Create room
    $stmt = $db->prepare("INSERT INTO rooms (room_code, game_state) VALUES (?, 'lobby')");
    $stmt->execute([$roomCode]);
    $roomId = $db->lastInsertId();
    
    // Get player name from request
    $playerName = trim($_POST['player_name'] ?? 'Player 1');
    if (empty($playerName)) {
        $playerName = 'Player 1';
    }
    
    $avatarId = intval($_POST['avatar_id'] ?? 1);
    
    // Create host player (starts with 1 ultra ball)
    $sessionId = session_id();
    $stmt = $db->prepare("
        INSERT INTO players (room_id, player_number, player_name, avatar_id, is_host, session_id, ultra_balls)
        VALUES (?, 0, ?, ?, TRUE, ?, 1)
    ");
    $stmt->execute([$roomId, $playerName, $avatarId, $sessionId]);
    $playerId = $db->lastInsertId();
    
    // Store in session
    $_SESSION['room_id'] = $roomId;
    $_SESSION['player_id'] = $playerId;
    $_SESSION['room_code'] = $roomCode;
    
    jsonResponse([
        'success' => true,
        'room_code' => $roomCode,
        'room_id' => $roomId,
        'player_id' => $playerId,
        'player_number' => 0,
        'is_host' => true
    ]);
}

/**
 * Join an existing room
 */
function joinRoom() {
    $db = getDB();
    
    $roomCode = strtoupper(trim($_POST['room_code'] ?? ''));
    if (empty($roomCode)) {
        jsonResponse(['error' => 'Room code is required'], 400);
    }
    
    // Find room
    $stmt = $db->prepare("SELECT id, game_state FROM rooms WHERE room_code = ?");
    $stmt->execute([$roomCode]);
    $room = $stmt->fetch();
    
    if (!$room) {
        jsonResponse(['error' => 'Room not found'], 404);
    }
    
    if ($room['game_state'] !== 'lobby') {
        jsonResponse(['error' => 'Game already in progress'], 400);
    }
    
    // Count current players
    $stmt = $db->prepare("SELECT COUNT(*) as count FROM players WHERE room_id = ?");
    $stmt->execute([$room['id']]);
    $playerCount = $stmt->fetch()['count'];
    
    if ($playerCount >= MAX_PLAYERS) {
        jsonResponse(['error' => 'Room is full (max ' . MAX_PLAYERS . ' players)'], 400);
    }
    
    // Get player info
    $playerName = trim($_POST['player_name'] ?? 'Player ' . ($playerCount + 1));
    if (empty($playerName)) {
        $playerName = 'Player ' . ($playerCount + 1);
    }
    $avatarId = intval($_POST['avatar_id'] ?? 1);
    
    // Check if session already has a player_id for THIS specific room
    $existingPlayerId = $_SESSION['player_id'] ?? null;
    $existingRoomId = $_SESSION['room_id'] ?? null;
    
    if ($existingPlayerId && $existingRoomId == $room['id']) {
        // Verify this player still exists in the database
        $stmt = $db->prepare("SELECT id, player_number, is_host FROM players WHERE id = ? AND room_id = ?");
        $stmt->execute([$existingPlayerId, $room['id']]);
        $existingPlayer = $stmt->fetch();
        
        if ($existingPlayer) {
            // Return existing player data (true rejoin)
            jsonResponse([
                'success' => true,
                'room_code' => $roomCode,
                'room_id' => $room['id'],
                'player_id' => $existingPlayer['id'],
                'player_number' => $existingPlayer['player_number'],
                'is_host' => (bool)$existingPlayer['is_host'],
                'rejoined' => true
            ]);
        }
    }
    
    // Create new player (clear any old session data first, starts with 1 ultra ball)
    unset($_SESSION['room_id'], $_SESSION['player_id'], $_SESSION['room_code']);
    
    $stmt = $db->prepare("
        INSERT INTO players (room_id, player_number, player_name, avatar_id, session_id, ultra_balls)
        VALUES (?, ?, ?, ?, ?, 1)
    ");
    $stmt->execute([$room['id'], $playerCount, $playerName, $avatarId, session_id()]);
    $playerId = $db->lastInsertId();
    
    // Store in session
    $_SESSION['room_id'] = $room['id'];
    $_SESSION['player_id'] = $playerId;
    $_SESSION['room_code'] = $roomCode;
    
    // Add event for other players
    addGameEvent($room['id'], 'player_joined', [
        'player_id' => $playerId,
        'player_name' => $playerName,
        'player_number' => $playerCount
    ]);
    
    jsonResponse([
        'success' => true,
        'room_code' => $roomCode,
        'room_id' => $room['id'],
        'player_id' => $playerId,
        'player_number' => $playerCount,
        'is_host' => false
    ]);
}

/**
 * Leave a room
 */
function leaveRoom() {
    $db = getDB();
    
    $playerId = $_SESSION['player_id'] ?? null;
    $roomId = $_SESSION['room_id'] ?? null;
    
    if (!$playerId || !$roomId) {
        jsonResponse(['error' => 'Not in a room'], 400);
    }
    
    // Get player info before deleting
    $stmt = $db->prepare("SELECT player_name, is_host FROM players WHERE id = ?");
    $stmt->execute([$playerId]);
    $player = $stmt->fetch();
    
    // Delete player
    $stmt = $db->prepare("DELETE FROM players WHERE id = ?");
    $stmt->execute([$playerId]);
    
    // Add event
    addGameEvent($roomId, 'player_left', [
        'player_id' => $playerId,
        'player_name' => $player['player_name']
    ]);
    
    // Check remaining players
    $stmt = $db->prepare("SELECT COUNT(*) as count FROM players WHERE room_id = ?");
    $stmt->execute([$roomId]);
    $remainingPlayers = $stmt->fetch()['count'];
    
    if ($remainingPlayers == 0) {
        // Delete empty room
        $stmt = $db->prepare("DELETE FROM rooms WHERE id = ?");
        $stmt->execute([$roomId]);
    } elseif ($player['is_host']) {
        // Transfer host to another player
        $stmt = $db->prepare("UPDATE players SET is_host = TRUE WHERE room_id = ? LIMIT 1");
        $stmt->execute([$roomId]);
        
        addGameEvent($roomId, 'host_changed', []);
    }
    
    // Renumber remaining players
    renumberPlayers($roomId);
    
    // Clear session
    unset($_SESSION['room_id'], $_SESSION['player_id'], $_SESSION['room_code']);
    
    jsonResponse(['success' => true]);
}

/**
 * Get current room state
 */
function getRoomState() {
    $db = getDB();
    
    $roomCode = $_GET['room_code'] ?? $_SESSION['room_code'] ?? '';
    
    if (empty($roomCode)) {
        jsonResponse(['error' => 'Room code required'], 400);
    }
    
    // Get room
    $stmt = $db->prepare("SELECT * FROM rooms WHERE room_code = ?");
    $stmt->execute([$roomCode]);
    $room = $stmt->fetch();
    
    if (!$room) {
        jsonResponse(['error' => 'Room not found'], 404);
    }
    
    // Get players
    $stmt = $db->prepare("
        SELECT id, player_number, player_name, avatar_id, money, ultra_balls, badges, is_host, is_ready
        FROM players WHERE room_id = ? ORDER BY player_number
    ");
    $stmt->execute([$room['id']]);
    $players = $stmt->fetchAll();
    
    // Get player's Pokemon teams (only if pokemon_dex has data)
    foreach ($players as &$player) {
        try {
            $stmt = $db->prepare("
                SELECT pp.*, pd.name, pd.type_defense, pd.type_attack, pd.base_hp, pd.base_attack, pd.base_speed, pd.sprite_url, pd.has_mega
                FROM player_pokemon pp
                JOIN pokemon_dex pd ON pp.pokemon_id = pd.id
                WHERE pp.player_id = ?
                ORDER BY pp.team_position
            ");
            $stmt->execute([$player['id']]);
            $player['team'] = $stmt->fetchAll();
        } catch (Exception $e) {
            // If pokemon_dex doesn't exist or query fails, just set empty team
            $player['team'] = [];
        }
    }
    
    jsonResponse([
        'success' => true,
        'room' => $room,
        'players' => $players,
        'current_player_id' => $_SESSION['player_id'] ?? null
    ]);
}

/**
 * Set player ready status
 */
function setPlayerReady() {
    $db = getDB();
    
    $playerId = $_SESSION['player_id'] ?? null;
    if (!$playerId) {
        jsonResponse(['error' => 'Not in a room'], 400);
    }
    
    $isReady = filter_var($_POST['is_ready'] ?? true, FILTER_VALIDATE_BOOLEAN);
    
    $stmt = $db->prepare("UPDATE players SET is_ready = ? WHERE id = ?");
    $stmt->execute([$isReady, $playerId]);
    
    // Get room for event
    $roomId = $_SESSION['room_id'];
    addGameEvent($roomId, 'player_ready', [
        'player_id' => $playerId,
        'is_ready' => $isReady
    ]);
    
    jsonResponse(['success' => true]);
}

/**
 * Update player info (name, avatar)
 */
function updatePlayer() {
    $db = getDB();
    
    $playerId = $_SESSION['player_id'] ?? null;
    if (!$playerId) {
        jsonResponse(['error' => 'Not in a room'], 400);
    }
    
    $updates = [];
    $params = [];
    
    if (isset($_POST['player_name'])) {
        $updates[] = "player_name = ?";
        $params[] = trim($_POST['player_name']);
    }
    
    if (isset($_POST['avatar_id'])) {
        $updates[] = "avatar_id = ?";
        $params[] = intval($_POST['avatar_id']);
    }
    
    if (empty($updates)) {
        jsonResponse(['error' => 'No updates provided'], 400);
    }
    
    $params[] = $playerId;
    $stmt = $db->prepare("UPDATE players SET " . implode(", ", $updates) . " WHERE id = ?");
    $stmt->execute($params);
    
    // Notify other players
    $roomId = $_SESSION['room_id'];
    addGameEvent($roomId, 'player_updated', ['player_id' => $playerId]);
    
    jsonResponse(['success' => true]);
}

/**
 * Start the game (host only)
 */
function startGame() {
    $db = getDB();
    
    $playerId = $_SESSION['player_id'] ?? null;
    $roomId = $_SESSION['room_id'] ?? null;
    
    if (!$playerId || !$roomId) {
        jsonResponse(['error' => 'Not in a room'], 400);
    }
    
    // Check if host
    $stmt = $db->prepare("SELECT is_host FROM players WHERE id = ?");
    $stmt->execute([$playerId]);
    $player = $stmt->fetch();
    
    if (!$player['is_host']) {
        jsonResponse(['error' => 'Only the host can start the game'], 403);
    }
    
    // Check player count
    $stmt = $db->prepare("SELECT COUNT(*) as count FROM players WHERE room_id = ?");
    $stmt->execute([$roomId]);
    $playerCount = $stmt->fetch()['count'];
    
    if ($playerCount < MIN_PLAYERS) {
        jsonResponse(['error' => 'Need at least ' . MIN_PLAYERS . ' players to start'], 400);
    }
    
    // Randomize who picks first for initial selection
    $randomFirstPicker = rand(0, $playerCount - 1);
    
    // Store selection deadline in game_data so the timer survives page refreshes
    $selectionDeadline = time() + 10;
    $gameData = json_encode(['selection_deadline' => $selectionDeadline]);
    
    // Update room state to initial (starter selection) with randomized first picker
    $stmt = $db->prepare("UPDATE rooms SET game_state = 'initial', current_player_turn = ?, game_data = ? WHERE id = ?");
    $stmt->execute([$randomFirstPicker, $gameData, $roomId]);
    
    // Get first picker's name for the event
    $stmt = $db->prepare("SELECT player_name FROM players WHERE room_id = ? AND player_number = ?");
    $stmt->execute([$roomId, $randomFirstPicker]);
    $firstPicker = $stmt->fetch();
    
    // Add event with info about who picks first
    addGameEvent($roomId, 'game_started', [
        'first_picker' => $randomFirstPicker,
        'first_picker_name' => $firstPicker['player_name']
    ]);
    
    jsonResponse([
        'success' => true, 
        'game_state' => 'initial',
        'first_picker' => $randomFirstPicker,
        'first_picker_name' => $firstPicker['player_name']
    ]);
}

/**
 * Helper: Add game event for SSE and WebSocket
 */
function addGameEvent($roomId, $eventType, $eventData) {
    // Use centralized broadcast function (writes to DB + sends to WebSocket)
    broadcastEvent($roomId, $eventType, $eventData);
}

/**
 * Helper: Renumber players after someone leaves
 */
function renumberPlayers($roomId) {
    $db = getDB();
    
    $stmt = $db->prepare("SELECT id FROM players WHERE room_id = ? ORDER BY player_number");
    $stmt->execute([$roomId]);
    $players = $stmt->fetchAll();
    
    $number = 0;
    foreach ($players as $player) {
        $stmt = $db->prepare("UPDATE players SET player_number = ? WHERE id = ?");
        $stmt->execute([$number, $player['id']]);
        $number++;
    }
}
?>
