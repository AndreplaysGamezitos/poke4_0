<?php
/**
 * PokeFodase - Pokemon API
 * Handles Pokemon data, selection, and team management
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

try {
    $action = $_GET['action'] ?? $_POST['action'] ?? '';

    switch ($action) {
        case 'get_starters':
            getStarters();
            break;
        case 'select_starter':
            selectStarter();
            break;
        case 'get_selection_state':
            getSelectionState();
            break;
        case 'get_team':
            getTeam();
            break;
        case 'get_pokemon':
            getPokemonData();
            break;
        default:
            jsonResponse(['error' => 'Invalid action'], 400);
    }
} catch (Exception $e) {
    jsonResponse(['error' => 'Server error: ' . $e->getMessage()], 500);
}

/**
 * Get available starter Pokemon based on player count in room
 * Starters are randomly selected from the pool but consistent for the same room
 */
function getStarters() {
    $db = getDB();
    
    $roomCode = $_GET['room_code'] ?? null;
    $playerCount = 3; // Default to 3 (show original starters)
    $roomId = null;
    
    // If room code provided, get actual player count and room ID
    if ($roomCode) {
        $stmt = $db->prepare("
            SELECT r.id as room_id, COUNT(p.id) as player_count 
            FROM rooms r
            LEFT JOIN players p ON p.room_id = r.id
            WHERE r.room_code = ?
            GROUP BY r.id
        ");
        $stmt->execute([$roomCode]);
        $result = $stmt->fetch();
        if ($result) {
            $playerCount = max(3, intval($result['player_count'])); // Minimum 3 starters
            $roomId = $result['room_id'];
        }
    }
    
    // Get ALL starters from the pool
    $stmt = $db->prepare("
        SELECT pd.* 
        FROM pokemon_dex pd
        INNER JOIN starter_pokemon sp ON pd.id = sp.pokemon_id
        ORDER BY sp.priority
    ");
    $stmt->execute();
    $allStarters = $stmt->fetchAll();
    
    // If we have a room ID, use it as a seed for consistent randomization
    // This ensures all players in the same room see the same random selection
    if ($roomId) {
        mt_srand($roomId * 12345); // Use room ID as seed
    }
    
    // Shuffle the starters array
    $startersCopy = $allStarters;
    for ($i = count($startersCopy) - 1; $i > 0; $i--) {
        $j = mt_rand(0, $i);
        $temp = $startersCopy[$i];
        $startersCopy[$i] = $startersCopy[$j];
        $startersCopy[$j] = $temp;
    }
    
    // Reset the random seed to not affect other random operations
    mt_srand();
    
    // Take only the number we need (playerCount starters)
    $selectedStarters = array_slice($startersCopy, 0, $playerCount);
    
    jsonResponse([
        'success' => true,
        'starters' => $selectedStarters,
        'player_count' => $playerCount
    ]);
}

/**
 * Select a starter Pokemon
 */
function selectStarter() {
    $db = getDB();
    
    $playerId = $_SESSION['player_id'] ?? null;
    $roomId = $_SESSION['room_id'] ?? null;
    
    if (!$playerId || !$roomId) {
        jsonResponse(['error' => 'Not in a room'], 400);
    }
    
    $pokemonId = intval($_POST['pokemon_id'] ?? 0);
    if ($pokemonId <= 0) {
        jsonResponse(['error' => 'Invalid Pokemon ID'], 400);
    }
    
    // Check room is in initial phase
    $stmt = $db->prepare("SELECT game_state, current_player_turn FROM rooms WHERE id = ?");
    $stmt->execute([$roomId]);
    $room = $stmt->fetch();
    
    if ($room['game_state'] !== 'initial') {
        jsonResponse(['error' => 'Not in selection phase'], 400);
    }
    
    // Get player info
    $stmt = $db->prepare("SELECT player_number FROM players WHERE id = ?");
    $stmt->execute([$playerId]);
    $player = $stmt->fetch();
    
    // Check if it's this player's turn
    if ($player['player_number'] != $room['current_player_turn']) {
        jsonResponse(['error' => 'Not your turn'], 400);
    }
    
    // Check if player already has a Pokemon (shouldn't happen but safety check)
    $stmt = $db->prepare("SELECT COUNT(*) as count FROM player_pokemon WHERE player_id = ?");
    $stmt->execute([$playerId]);
    if ($stmt->fetch()['count'] > 0) {
        jsonResponse(['error' => 'You already have a starter'], 400);
    }
    
    // Check if this starter is still available (not taken by another player)
    $stmt = $db->prepare("
        SELECT COUNT(*) as count FROM player_pokemon pp
        INNER JOIN players p ON pp.player_id = p.id
        WHERE p.room_id = ? AND pp.pokemon_id = ?
    ");
    $stmt->execute([$roomId, $pokemonId]);
    if ($stmt->fetch()['count'] > 0) {
        jsonResponse(['error' => 'This Pokemon was already chosen'], 400);
    }
    
    // Get Pokemon data
    $stmt = $db->prepare("SELECT * FROM pokemon_dex WHERE id = ?");
    $stmt->execute([$pokemonId]);
    $pokemon = $stmt->fetch();
    
    if (!$pokemon) {
        jsonResponse(['error' => 'Pokemon not found'], 404);
    }
    
    // Add Pokemon to player's team
    $stmt = $db->prepare("
        INSERT INTO player_pokemon (player_id, pokemon_id, current_hp, current_exp, is_active, team_position)
        VALUES (?, ?, ?, 0, TRUE, 0)
    ");
    $stmt->execute([$playerId, $pokemonId, $pokemon['base_hp']]);
    
    // Get total player count
    $stmt = $db->prepare("SELECT COUNT(*) as count FROM players WHERE room_id = ?");
    $stmt->execute([$roomId]);
    $playerCount = $stmt->fetch()['count'];
    
    // Check how many players have now selected (to determine wrap-around order)
    $stmt = $db->prepare("
        SELECT COUNT(DISTINCT pp.player_id) as selected_count
        FROM player_pokemon pp
        INNER JOIN players p ON pp.player_id = p.id
        WHERE p.room_id = ?
    ");
    $stmt->execute([$roomId]);
    $selectedCount = $stmt->fetch()['selected_count'];
    
    // Check if all players have selected
    if ($selectedCount >= $playerCount) {
        // All players selected, move to catching phase
        // Randomize who starts the catching phase
        $randomFirstPlayer = rand(0, $playerCount - 1);
        
        $stmt = $db->prepare("
            UPDATE rooms 
            SET game_state = 'catching', 
                current_player_turn = ?,
                current_route = 1,
                encounters_remaining = ? * ?
            WHERE id = ?
        ");
        $stmt->execute([$randomFirstPlayer, ENCOUNTERS_PER_PLAYER, $playerCount, $roomId]);
        
        // Get first player's name for the event
        $stmt = $db->prepare("SELECT player_name FROM players WHERE room_id = ? AND player_number = ?");
        $stmt->execute([$roomId, $randomFirstPlayer]);
        $firstPlayer = $stmt->fetch();
        
        // Add game event
        addGameEvent($roomId, 'phase_changed', [
            'new_phase' => 'catching',
            'route' => 1,
            'first_player' => $randomFirstPlayer,
            'first_player_name' => $firstPlayer['player_name']
        ]);
        
        jsonResponse([
            'success' => true,
            'pokemon' => $pokemon,
            'next_turn' => -1,
            'phase_complete' => true,
            'first_player' => $randomFirstPlayer,
            'first_player_name' => $firstPlayer['player_name']
        ]);
    } else {
        // Find next player who hasn't selected yet (wrap-around)
        $startingTurn = $room['current_player_turn'];
        $nextTurn = ($startingTurn + 1) % $playerCount;
        
        // Get list of players who have selected
        $stmt = $db->prepare("
            SELECT p.player_number 
            FROM player_pokemon pp
            INNER JOIN players p ON pp.player_id = p.id
            WHERE p.room_id = ?
        ");
        $stmt->execute([$roomId]);
        $selectedPlayers = $stmt->fetchAll(PDO::FETCH_COLUMN);
        
        // Find the next player who hasn't selected (handle wrap-around)
        $checked = 0;
        while (in_array($nextTurn, $selectedPlayers) && $checked < $playerCount) {
            $nextTurn = ($nextTurn + 1) % $playerCount;
            $checked++;
        }
        
        // Update next player's turn
        $stmt = $db->prepare("UPDATE rooms SET current_player_turn = ? WHERE id = ?");
        $stmt->execute([$nextTurn, $roomId]);
        
        // Add selection event
        addGameEvent($roomId, 'starter_selected', [
            'player_id' => $playerId,
            'player_number' => $player['player_number'],
            'pokemon_id' => $pokemonId,
            'pokemon_name' => $pokemon['name'],
            'next_turn' => $nextTurn
        ]);
        
        jsonResponse([
            'success' => true,
            'pokemon' => $pokemon,
            'next_turn' => $nextTurn,
            'phase_complete' => false
        ]);
    }
}

/**
 * Get current selection state (who has selected, whose turn)
 */
function getSelectionState() {
    $db = getDB();
    
    $roomId = $_SESSION['room_id'] ?? null;
    $roomCode = $_GET['room_code'] ?? '';
    
    if (!$roomId && empty($roomCode)) {
        jsonResponse(['error' => 'Room not specified'], 400);
    }
    
    // Get room by code if needed
    if (!$roomId) {
        $stmt = $db->prepare("SELECT id FROM rooms WHERE room_code = ?");
        $stmt->execute([$roomCode]);
        $room = $stmt->fetch();
        if (!$room) {
            jsonResponse(['error' => 'Room not found'], 404);
        }
        $roomId = $room['id'];
    }
    
    // Get room state
    $stmt = $db->prepare("SELECT game_state, current_player_turn FROM rooms WHERE id = ?");
    $stmt->execute([$roomId]);
    $room = $stmt->fetch();
    
    // Get all players with their selections
    $stmt = $db->prepare("
        SELECT p.id, p.player_number, p.player_name, p.avatar_id,
               pp.pokemon_id, pd.name as pokemon_name, pd.sprite_url
        FROM players p
        LEFT JOIN player_pokemon pp ON p.id = pp.player_id
        LEFT JOIN pokemon_dex pd ON pp.pokemon_id = pd.id
        WHERE p.room_id = ?
        ORDER BY p.player_number
    ");
    $stmt->execute([$roomId]);
    $players = $stmt->fetchAll();
    
    jsonResponse([
        'success' => true,
        'game_state' => $room['game_state'],
        'current_turn' => $room['current_player_turn'],
        'players' => $players,
        'current_player_id' => $_SESSION['player_id'] ?? null
    ]);
}

/**
 * Get a player's team
 */
function getTeam() {
    $db = getDB();
    
    $playerId = $_GET['player_id'] ?? $_SESSION['player_id'] ?? null;
    
    if (!$playerId) {
        jsonResponse(['error' => 'Player not specified'], 400);
    }
    
    $stmt = $db->prepare("
        SELECT pp.*, pd.name, pd.type_defense, pd.type_attack, 
               pd.base_hp, pd.base_attack, pd.base_speed, pd.sprite_url,
               pd.evolution_id, pd.evolution_number, pd.has_mega
        FROM player_pokemon pp
        JOIN pokemon_dex pd ON pp.pokemon_id = pd.id
        WHERE pp.player_id = ?
        ORDER BY pp.team_position
    ");
    $stmt->execute([$playerId]);
    $team = $stmt->fetchAll();
    
    jsonResponse([
        'success' => true,
        'team' => $team
    ]);
}

/**
 * Get Pokemon data by ID
 */
function getPokemonData() {
    $db = getDB();
    
    $pokemonId = intval($_GET['id'] ?? 0);
    if ($pokemonId <= 0) {
        jsonResponse(['error' => 'Invalid Pokemon ID'], 400);
    }
    
    $stmt = $db->prepare("SELECT * FROM pokemon_dex WHERE id = ?");
    $stmt->execute([$pokemonId]);
    $pokemon = $stmt->fetch();
    
    if (!$pokemon) {
        jsonResponse(['error' => 'Pokemon not found'], 404);
    }
    
    jsonResponse([
        'success' => true,
        'pokemon' => $pokemon
    ]);
}

/**
 * Helper: Add game event for SSE and WebSocket
 */
function addGameEvent($roomId, $eventType, $eventData) {
    // Use centralized broadcast function (writes to DB + sends to WebSocket)
    broadcastEvent($roomId, $eventType, $eventData);
}
?>
