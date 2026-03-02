<?php
/**
 * PokeFodase - Town Phase API
 * Handles shop purchases, selling Pokemon, and ready status
 */

require_once '../config.php';
require_once __DIR__ . '/broadcast.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$pdo = getDB();

/**
 * Helper function to get request data from either JSON body or POST/GET
 */
function getRequestData() {
    // Try JSON body first
    $jsonData = json_decode(file_get_contents('php://input'), true);
    if ($jsonData && is_array($jsonData)) {
        return $jsonData;
    }
    // Fall back to $_POST + $_GET
    return array_merge($_GET, $_POST);
}

// Get action from request
$action = $_GET['action'] ?? $_POST['action'] ?? '';

switch ($action) {
    case 'get_state':
        getTownState($pdo);
        break;
    case 'buy_ultra_ball':
        buyUltraBall($pdo);
        break;
    case 'buy_evo_soda':
        buyEvoSoda($pdo);
        break;
    case 'buy_mega_stone':
        buyMegaStone($pdo);
        break;
    case 'buy_and_mega_evolve':
        buyAndMegaEvolve($pdo);
        break;
    case 'mega_evolve':
        megaEvolvePokemon($pdo);
        break;
    case 'sell_pokemon':
        sellPokemon($pdo);
        break;
    case 'set_active':
        setActivePokemon($pdo);
        break;
    case 'toggle_ready':
        toggleReady($pdo);
        break;
    default:
        echo json_encode(['success' => false, 'error' => 'Invalid action']);
}

/**
 * Get current town phase state
 */
function getTownState($pdo) {
    $roomCode = $_GET['room_code'] ?? '';
    $playerId = $_GET['player_id'] ?? '';
    
    if (empty($roomCode) || empty($playerId)) {
        echo json_encode(['success' => false, 'error' => 'Missing parameters']);
        return;
    }
    
    // Get room info
    $stmt = $pdo->prepare("
        SELECT r.*, 
               (SELECT COUNT(*) FROM players WHERE room_id = r.id) as player_count
        FROM rooms r 
        WHERE r.room_code = ?
    ");
    $stmt->execute([$roomCode]);
    $room = $stmt->fetch();
    
    if (!$room) {
        echo json_encode(['success' => false, 'error' => 'Room not found']);
        return;
    }
    
    // Get current player info
    $stmt = $pdo->prepare("
        SELECT * FROM players WHERE id = ? AND room_id = ?
    ");
    $stmt->execute([$playerId, $room['id']]);
    $player = $stmt->fetch();
    
    if (!$player) {
        echo json_encode(['success' => false, 'error' => 'Player not found']);
        return;
    }
    
    // Get player's team with Pokemon details (including mega evolution info)
    $stmt = $pdo->prepare("
        SELECT pp.id, pp.pokemon_id, pp.team_position, pp.current_exp, pp.is_active, pp.is_mega,
               pd.name, pd.type_defense as type, pd.base_hp as hp, pd.base_attack as attack, 
               pd.base_speed as speed, pd.sprite_url, pd.evolution_id, pd.evolution_number,
               pd.has_mega, pd.mega_evolution_id,
               mega.name as mega_name, mega.sprite_url as mega_sprite_url
        FROM player_pokemon pp
        JOIN pokemon_dex pd ON pp.pokemon_id = pd.id
        LEFT JOIN pokemon_dex mega ON pd.mega_evolution_id = mega.id
        WHERE pp.player_id = ?
        ORDER BY pp.team_position
    ");
    $stmt->execute([$playerId]);
    $team = $stmt->fetchAll();
    
    // Find active slot
    $activeSlot = 0;
    foreach ($team as $idx => $p) {
        if ($p['is_active']) {
            $activeSlot = $p['team_position'];
            break;
        }
    }
    
    // Get all players with ready status
    $stmt = $pdo->prepare("
        SELECT p.id, p.player_name, p.avatar_id as avatar, p.money, p.ultra_balls, p.badges, p.is_ready
        FROM players p
        WHERE p.room_id = ?
        ORDER BY p.player_number
    ");
    $stmt->execute([$room['id']]);
    $players = $stmt->fetchAll();
    
    // Count ready players
    $readyCount = 0;
    foreach ($players as $p) {
        if ($p['is_ready']) $readyCount++;
    }
    
    echo json_encode([
        'success' => true,
        'room' => [
            'id' => $room['id'],
            'current_route' => $room['current_route'],
            'game_state' => $room['game_state']
        ],
        'player' => [
            'id' => $player['id'],
            'name' => $player['player_name'],
            'money' => (int)$player['money'],
            'ultra_balls' => (int)$player['ultra_balls'],
            'badges' => (int)$player['badges'],
            'active_pokemon_slot' => (int)$activeSlot,
            'is_ready' => (bool)$player['is_ready'],
            'has_mega_stone' => (bool)($player['has_mega_stone'] ?? false),
            'used_mega_stone' => (bool)($player['used_mega_stone'] ?? false)
        ],
        'team' => array_map(function($p) {
            return [
                'team_id' => $p['id'],
                'pokemon_id' => $p['pokemon_id'],
                'slot' => (int)$p['team_position'],
                'name' => $p['name'],
                'type' => $p['type'],
                'hp' => (int)$p['hp'],
                'attack' => (int)$p['attack'],
                'speed' => (int)$p['speed'],
                'sprite_url' => $p['sprite_url'],
                'exp' => (int)$p['current_exp'],
                'evolution_stage' => (int)$p['evolution_number'],
                'can_evolve' => $p['evolution_id'] !== null,
                'is_mega' => (bool)($p['is_mega'] ?? false),
                'has_mega' => (bool)($p['has_mega'] ?? false),
                'mega_evolution_id' => $p['mega_evolution_id'] ?? null,
                'mega_name' => $p['mega_name'] ?? null,
                'mega_sprite_url' => $p['mega_sprite_url'] ?? null
            ];
        }, $team),
        'players' => $players,
        'ready_count' => $readyCount,
        'total_players' => count($players),
        'shop_prices' => [
            'ultra_ball' => PRICE_ULTRA_BALL,
            'evo_soda' => PRICE_EVO_SODA,
            'mega_stone' => PRICE_MEGA_STONE
        ]
    ]);
}

/**
 * Buy an Ultra Ball
 */
function buyUltraBall($pdo) {
    $data = getRequestData();
    $roomCode = $data['room_code'] ?? '';
    $playerId = $data['player_id'] ?? '';
    
    if (empty($roomCode) || empty($playerId)) {
        echo json_encode(['success' => false, 'error' => 'Missing parameters']);
        return;
    }
    
    // Get room
    $stmt = $pdo->prepare("SELECT id FROM rooms WHERE room_code = ? AND game_state = 'town'");
    $stmt->execute([$roomCode]);
    $room = $stmt->fetch();
    
    if (!$room) {
        echo json_encode(['success' => false, 'error' => 'Invalid room or not in town phase']);
        return;
    }
    
    // Get player
    $stmt = $pdo->prepare("SELECT * FROM players WHERE id = ? AND room_id = ?");
    $stmt->execute([$playerId, $room['id']]);
    $player = $stmt->fetch();
    
    if (!$player) {
        echo json_encode(['success' => false, 'error' => 'Player not found']);
        return;
    }
    
    // Check if player has enough money
    if ($player['money'] < PRICE_ULTRA_BALL) {
        echo json_encode(['success' => false, 'error' => 'Not enough money']);
        return;
    }
    
    // Purchase the Ultra Ball
    $stmt = $pdo->prepare("
        UPDATE players 
        SET money = money - ?, ultra_balls = ultra_balls + 1 
        WHERE id = ?
    ");
    $stmt->execute([PRICE_ULTRA_BALL, $playerId]);
    
    // Log the event
    logTownEvent($pdo, $room['id'], 'purchase', [
        'player_id' => $playerId,
        'player_name' => $player['player_name'],
        'item' => 'ultra_ball',
        'cost' => PRICE_ULTRA_BALL
    ]);
    
    // Get updated player data
    $stmt = $pdo->prepare("SELECT money, ultra_balls FROM players WHERE id = ?");
    $stmt->execute([$playerId]);
    $updated = $stmt->fetch();
    
    echo json_encode([
        'success' => true,
        'message' => 'Purchased Ultra Ball!',
        'new_money' => (int)$updated['money'],
        'new_ultra_balls' => (int)$updated['ultra_balls']
    ]);
}

/**
 * Buy Evo Soda (+1 EXP to active Pokemon)
 */
function buyEvoSoda($pdo) {
    $data = getRequestData();
    $roomCode = $data['room_code'] ?? '';
    $playerId = $data['player_id'] ?? '';
    
    if (empty($roomCode) || empty($playerId)) {
        echo json_encode(['success' => false, 'error' => 'Missing parameters']);
        return;
    }
    
    // Get room
    $stmt = $pdo->prepare("SELECT id FROM rooms WHERE room_code = ? AND game_state = 'town'");
    $stmt->execute([$roomCode]);
    $room = $stmt->fetch();
    
    if (!$room) {
        echo json_encode(['success' => false, 'error' => 'Invalid room or not in town phase']);
        return;
    }
    
    // Get player
    $stmt = $pdo->prepare("SELECT * FROM players WHERE id = ? AND room_id = ?");
    $stmt->execute([$playerId, $room['id']]);
    $player = $stmt->fetch();
    
    if (!$player) {
        echo json_encode(['success' => false, 'error' => 'Player not found']);
        return;
    }
    
    // Check if player has enough money
    if ($player['money'] < PRICE_EVO_SODA) {
        echo json_encode(['success' => false, 'error' => 'Not enough money']);
        return;
    }
    
    // Get active Pokemon
    $stmt = $pdo->prepare("
        SELECT pp.*, pd.name, pd.evolution_id
        FROM player_pokemon pp
        JOIN pokemon_dex pd ON pp.pokemon_id = pd.id
        WHERE pp.player_id = ? AND pp.is_active = TRUE
        LIMIT 1
    ");
    $stmt->execute([$playerId]);
    $activePokemon = $stmt->fetch();
    
    if (!$activePokemon) {
        echo json_encode(['success' => false, 'error' => 'No active Pokemon']);
        return;
    }
    
    // Check if Pokemon can gain EXP (has evolution)
    if (!$activePokemon['evolution_id']) {
        echo json_encode(['success' => false, 'error' => 'This Pokemon cannot evolve and doesn\'t need EXP']);
        return;
    }
    
    $pdo->beginTransaction();
    
    try {
        // Deduct money
        $stmt = $pdo->prepare("UPDATE players SET money = money - ? WHERE id = ?");
        $stmt->execute([PRICE_EVO_SODA, $playerId]);
        
        // Add EXP to active Pokemon
        $newExp = $activePokemon['current_exp'] + 1;
        $evolved = false;
        $evolvedTo = null;
        
        // Check for evolution
        if ($newExp >= EXP_TO_EVOLVE && $activePokemon['evolution_id']) {
            // Evolve the Pokemon!
            $stmt = $pdo->prepare("
                UPDATE player_pokemon 
                SET pokemon_id = ?, current_exp = 0 
                WHERE id = ?
            ");
            $stmt->execute([$activePokemon['evolution_id'], $activePokemon['id']]);
            $evolved = true;
            
            // Get evolved Pokemon name
            $stmt = $pdo->prepare("SELECT name FROM pokemon_dex WHERE id = ?");
            $stmt->execute([$activePokemon['evolution_id']]);
            $evolvedTo = $stmt->fetch()['name'];
            $newExp = 0;
        } else {
            // Just add EXP
            $stmt = $pdo->prepare("UPDATE player_pokemon SET current_exp = ? WHERE id = ?");
            $stmt->execute([$newExp, $activePokemon['id']]);
        }
        
        $pdo->commit();
        
        // Log the event
        $eventData = [
            'player_id' => $playerId,
            'player_name' => $player['player_name'],
            'item' => 'evo_soda',
            'pokemon_name' => $activePokemon['name'],
            'cost' => PRICE_EVO_SODA
        ];
        
        if ($evolved) {
            $eventData['evolved'] = true;
            $eventData['evolved_to'] = $evolvedTo;
        }
        
        logTownEvent($pdo, $room['id'], 'purchase', $eventData);
        
        // Get updated player data
        $stmt = $pdo->prepare("SELECT money FROM players WHERE id = ?");
        $stmt->execute([$playerId]);
        $updated = $stmt->fetch();
        
        $response = [
            'success' => true,
            'message' => $evolved 
                ? "{$activePokemon['name']} evolved into {$evolvedTo}!" 
                : "{$activePokemon['name']} gained 1 EXP!",
            'new_money' => (int)$updated['money'],
            'new_exp' => $newExp,
            'evolved' => $evolved
        ];
        
        if ($evolved) {
            $response['evolved_to'] = $evolvedTo;
        }
        
        echo json_encode($response);
        
    } catch (Exception $e) {
        $pdo->rollBack();
        echo json_encode(['success' => false, 'error' => 'Database error']);
    }
}

/**
 * Buy a Mega Stone
 * Can only buy ONE mega stone per game per player
 */
function buyMegaStone($pdo) {
    $data = getRequestData();
    $roomCode = $data['room_code'] ?? '';
    $playerId = $data['player_id'] ?? '';
    
    if (empty($roomCode) || empty($playerId)) {
        echo json_encode(['success' => false, 'error' => 'Missing parameters']);
        return;
    }
    
    // Get room
    $stmt = $pdo->prepare("SELECT id FROM rooms WHERE room_code = ? AND game_state = 'town'");
    $stmt->execute([$roomCode]);
    $room = $stmt->fetch();
    
    if (!$room) {
        echo json_encode(['success' => false, 'error' => 'Invalid room or not in town phase']);
        return;
    }
    
    // Get player
    $stmt = $pdo->prepare("SELECT * FROM players WHERE id = ? AND room_id = ?");
    $stmt->execute([$playerId, $room['id']]);
    $player = $stmt->fetch();
    
    if (!$player) {
        echo json_encode(['success' => false, 'error' => 'Player not found']);
        return;
    }
    
    // Check if player already has a mega stone (can only buy once per game)
    if ($player['has_mega_stone'] || $player['used_mega_stone']) {
        echo json_encode(['success' => false, 'error' => 'You can only buy one Mega Stone per game!']);
        return;
    }
    
    // Check if player has enough money
    if ($player['money'] < PRICE_MEGA_STONE) {
        echo json_encode(['success' => false, 'error' => 'Not enough money (need R$' . PRICE_MEGA_STONE . ')']);
        return;
    }
    
    // Purchase the Mega Stone
    $stmt = $pdo->prepare("
        UPDATE players 
        SET money = money - ?, has_mega_stone = TRUE 
        WHERE id = ?
    ");
    $stmt->execute([PRICE_MEGA_STONE, $playerId]);
    
    // Log the event
    logTownEvent($pdo, $room['id'], 'purchase', [
        'player_id' => $playerId,
        'player_name' => $player['player_name'],
        'item' => 'mega_stone',
        'cost' => PRICE_MEGA_STONE
    ]);
    
    // Get updated player data
    $stmt = $pdo->prepare("SELECT money, has_mega_stone FROM players WHERE id = ?");
    $stmt->execute([$playerId]);
    $updated = $stmt->fetch();
    
    echo json_encode([
        'success' => true,
        'message' => 'Purchased Mega Stone! Select a Pokemon to Mega Evolve.',
        'new_money' => (int)$updated['money'],
        'has_mega_stone' => (bool)$updated['has_mega_stone']
    ]);
}

/**
 * Buy Mega Stone and Mega Evolve active Pokemon in one action
 * This is the streamlined flow - only works if active Pokemon can Mega Evolve
 */
function buyAndMegaEvolve($pdo) {
    $data = getRequestData();
    $roomCode = $data['room_code'] ?? '';
    $playerId = $data['player_id'] ?? '';
    
    if (empty($roomCode) || empty($playerId)) {
        echo json_encode(['success' => false, 'error' => 'Missing parameters']);
        return;
    }
    
    // Get room
    $stmt = $pdo->prepare("SELECT id FROM rooms WHERE room_code = ? AND game_state = 'town'");
    $stmt->execute([$roomCode]);
    $room = $stmt->fetch();
    
    if (!$room) {
        echo json_encode(['success' => false, 'error' => 'Invalid room or not in town phase']);
        return;
    }
    
    // Get player
    $stmt = $pdo->prepare("SELECT * FROM players WHERE id = ? AND room_id = ?");
    $stmt->execute([$playerId, $room['id']]);
    $player = $stmt->fetch();
    
    if (!$player) {
        echo json_encode(['success' => false, 'error' => 'Player not found']);
        return;
    }
    
    // Check if player already used mega stone
    if ($player['has_mega_stone'] || $player['used_mega_stone']) {
        echo json_encode(['success' => false, 'error' => 'You can only use one Mega Stone per game!']);
        return;
    }
    
    // Check if player has enough money
    if ($player['money'] < PRICE_MEGA_STONE) {
        echo json_encode(['success' => false, 'error' => 'Not enough money (need R$' . PRICE_MEGA_STONE . ')']);
        return;
    }
    
    // Get active Pokemon
    $stmt = $pdo->prepare("
        SELECT pp.*, pd.name, pd.has_mega, pd.mega_evolution_id,
               mega.name as mega_name, mega.sprite_url as mega_sprite_url,
               mega.base_hp as mega_hp, mega.base_attack as mega_attack, mega.base_speed as mega_speed
        FROM player_pokemon pp
        JOIN pokemon_dex pd ON pp.pokemon_id = pd.id
        LEFT JOIN pokemon_dex mega ON pd.mega_evolution_id = mega.id
        WHERE pp.player_id = ? AND pp.is_active = TRUE
        LIMIT 1
    ");
    $stmt->execute([$playerId]);
    $pokemon = $stmt->fetch();
    
    if (!$pokemon) {
        echo json_encode(['success' => false, 'error' => 'No active Pokemon']);
        return;
    }
    
    // Check if active Pokemon can Mega Evolve
    if (!$pokemon['has_mega'] || !$pokemon['mega_evolution_id']) {
        echo json_encode(['success' => false, 'error' => $pokemon['name'] . ' cannot Mega Evolve! Select a different Pokemon as active.']);
        return;
    }
    
    // Check if already mega evolved
    if ($pokemon['is_mega']) {
        echo json_encode(['success' => false, 'error' => $pokemon['name'] . ' is already Mega Evolved!']);
        return;
    }
    
    $pdo->beginTransaction();
    
    try {
        // Deduct money and mark mega stone as used (skip the has_mega_stone intermediate state)
        $stmt = $pdo->prepare("
            UPDATE players 
            SET money = money - ?, has_mega_stone = FALSE, used_mega_stone = TRUE 
            WHERE id = ?
        ");
        $stmt->execute([PRICE_MEGA_STONE, $playerId]);
        
        // Transform the Pokemon to its Mega form
        $stmt = $pdo->prepare("
            UPDATE player_pokemon 
            SET pokemon_id = ?, is_mega = TRUE, current_exp = 0
            WHERE id = ?
        ");
        $stmt->execute([$pokemon['mega_evolution_id'], $pokemon['id']]);
        
        $pdo->commit();
        
        // Log the event
        logTownEvent($pdo, $room['id'], 'mega_evolution', [
            'player_id' => $playerId,
            'player_name' => $player['player_name'],
            'pokemon_name' => $pokemon['name'],
            'mega_name' => $pokemon['mega_name'],
            'cost' => PRICE_MEGA_STONE
        ]);
        
        // Get updated money
        $stmt = $pdo->prepare("SELECT money FROM players WHERE id = ?");
        $stmt->execute([$playerId]);
        $updated = $stmt->fetch();
        
        echo json_encode([
            'success' => true,
            'message' => $pokemon['name'] . ' Mega Evolved into ' . $pokemon['mega_name'] . '!',
            'mega_name' => $pokemon['mega_name'],
            'mega_sprite_url' => $pokemon['mega_sprite_url'],
            'new_money' => (int)$updated['money'],
            'new_stats' => [
                'hp' => (int)$pokemon['mega_hp'],
                'attack' => (int)$pokemon['mega_attack'],
                'speed' => (int)$pokemon['mega_speed']
            ]
        ]);
        
    } catch (Exception $e) {
        $pdo->rollBack();
        echo json_encode(['success' => false, 'error' => 'Database error: ' . $e->getMessage()]);
    }
}

/**
 * Mega Evolve a Pokemon
 * Uses the player's mega stone on a specific Pokemon with mega evolution available
 */
function megaEvolvePokemon($pdo) {
    $data = getRequestData();
    $roomCode = $data['room_code'] ?? '';
    $playerId = $data['player_id'] ?? '';
    $teamId = $data['team_id'] ?? '';
    
    if (empty($roomCode) || empty($playerId) || empty($teamId)) {
        echo json_encode(['success' => false, 'error' => 'Missing parameters']);
        return;
    }
    
    // Get room
    $stmt = $pdo->prepare("SELECT id FROM rooms WHERE room_code = ? AND game_state = 'town'");
    $stmt->execute([$roomCode]);
    $room = $stmt->fetch();
    
    if (!$room) {
        echo json_encode(['success' => false, 'error' => 'Invalid room or not in town phase']);
        return;
    }
    
    // Get player
    $stmt = $pdo->prepare("SELECT * FROM players WHERE id = ? AND room_id = ?");
    $stmt->execute([$playerId, $room['id']]);
    $player = $stmt->fetch();
    
    if (!$player) {
        echo json_encode(['success' => false, 'error' => 'Player not found']);
        return;
    }
    
    // Check if player has a mega stone
    if (!$player['has_mega_stone']) {
        echo json_encode(['success' => false, 'error' => 'You need a Mega Stone first!']);
        return;
    }
    
    // Check if already used mega evolution
    if ($player['used_mega_stone']) {
        echo json_encode(['success' => false, 'error' => 'You have already used your Mega Stone!']);
        return;
    }
    
    // Get the Pokemon to mega evolve
    $stmt = $pdo->prepare("
        SELECT pp.*, pd.name, pd.has_mega, pd.mega_evolution_id,
               mega.name as mega_name, mega.sprite_url as mega_sprite_url,
               mega.base_hp as mega_hp, mega.base_attack as mega_attack, mega.base_speed as mega_speed
        FROM player_pokemon pp
        JOIN pokemon_dex pd ON pp.pokemon_id = pd.id
        LEFT JOIN pokemon_dex mega ON pd.mega_evolution_id = mega.id
        WHERE pp.id = ? AND pp.player_id = ?
    ");
    $stmt->execute([$teamId, $playerId]);
    $pokemon = $stmt->fetch();
    
    if (!$pokemon) {
        echo json_encode(['success' => false, 'error' => 'Pokemon not found']);
        return;
    }
    
    // Check if Pokemon can mega evolve
    if (!$pokemon['has_mega'] || !$pokemon['mega_evolution_id']) {
        echo json_encode(['success' => false, 'error' => $pokemon['name'] . ' cannot Mega Evolve!']);
        return;
    }
    
    // Check if already mega evolved
    if ($pokemon['is_mega']) {
        echo json_encode(['success' => false, 'error' => $pokemon['name'] . ' is already Mega Evolved!']);
        return;
    }
    
    $pdo->beginTransaction();
    
    try {
        // Transform the Pokemon to its Mega form
        $stmt = $pdo->prepare("
            UPDATE player_pokemon 
            SET pokemon_id = ?, is_mega = TRUE, current_exp = 0
            WHERE id = ?
        ");
        $stmt->execute([$pokemon['mega_evolution_id'], $teamId]);
        
        // Mark mega stone as used
        $stmt = $pdo->prepare("
            UPDATE players 
            SET has_mega_stone = FALSE, used_mega_stone = TRUE 
            WHERE id = ?
        ");
        $stmt->execute([$playerId]);
        
        $pdo->commit();
        
        // Log the event
        logTownEvent($pdo, $room['id'], 'mega_evolution', [
            'player_id' => $playerId,
            'player_name' => $player['player_name'],
            'pokemon_name' => $pokemon['name'],
            'mega_name' => $pokemon['mega_name']
        ]);
        
        echo json_encode([
            'success' => true,
            'message' => $pokemon['name'] . ' Mega Evolved into ' . $pokemon['mega_name'] . '!',
            'mega_name' => $pokemon['mega_name'],
            'mega_sprite_url' => $pokemon['mega_sprite_url'],
            'new_stats' => [
                'hp' => (int)$pokemon['mega_hp'],
                'attack' => (int)$pokemon['mega_attack'],
                'speed' => (int)$pokemon['mega_speed']
            ]
        ]);
        
    } catch (Exception $e) {
        $pdo->rollBack();
        echo json_encode(['success' => false, 'error' => 'Database error: ' . $e->getMessage()]);
    }
}

/**
 * Sell a Pokemon
 */
function sellPokemon($pdo) {
    $data = getRequestData();
    $roomCode = $data['room_code'] ?? '';
    $playerId = $data['player_id'] ?? '';
    $teamId = $data['team_id'] ?? '';
    
    if (empty($roomCode) || empty($playerId) || empty($teamId)) {
        echo json_encode(['success' => false, 'error' => 'Missing parameters']);
        return;
    }
    
    // Get room
    $stmt = $pdo->prepare("SELECT id FROM rooms WHERE room_code = ? AND game_state = 'town'");
    $stmt->execute([$roomCode]);
    $room = $stmt->fetch();
    
    if (!$room) {
        echo json_encode(['success' => false, 'error' => 'Invalid room or not in town phase']);
        return;
    }
    
    // Get player's team count
    $stmt = $pdo->prepare("SELECT COUNT(*) as count FROM player_pokemon WHERE player_id = ?");
    $stmt->execute([$playerId]);
    $teamCount = $stmt->fetch()['count'];
    
    if ($teamCount <= 1) {
        echo json_encode(['success' => false, 'error' => 'Cannot sell your last Pokemon!']);
        return;
    }
    
    // Get the Pokemon to sell
    $stmt = $pdo->prepare("
        SELECT pp.*, pd.name, pd.evolution_number
        FROM player_pokemon pp
        JOIN pokemon_dex pd ON pp.pokemon_id = pd.id
        WHERE pp.id = ? AND pp.player_id = ?
    ");
    $stmt->execute([$teamId, $playerId]);
    $pokemon = $stmt->fetch();
    
    if (!$pokemon) {
        echo json_encode(['success' => false, 'error' => 'Pokemon not found']);
        return;
    }
    
    // Calculate sell price: R$2 + evolution_number
    $sellPrice = SELL_BASE_PRICE + (int)$pokemon['evolution_number'];
    
    $pdo->beginTransaction();
    
    try {
        // Check if the sold Pokemon is the active one
        $wasActive = (bool)$pokemon['is_active'];
        
        // Delete the Pokemon
        $stmt = $pdo->prepare("DELETE FROM player_pokemon WHERE id = ?");
        $stmt->execute([$teamId]);
        
        // Add money to player
        $stmt = $pdo->prepare("UPDATE players SET money = money + ? WHERE id = ?");
        $stmt->execute([$sellPrice, $playerId]);
        
        // Reorganize team positions
        $stmt = $pdo->prepare("
            SELECT id, team_position FROM player_pokemon 
            WHERE player_id = ? 
            ORDER BY team_position
        ");
        $stmt->execute([$playerId]);
        $remaining = $stmt->fetchAll();
        
        // Reassign positions sequentially
        $newPos = 0;
        foreach ($remaining as $p) {
            $stmt = $pdo->prepare("UPDATE player_pokemon SET team_position = ? WHERE id = ?");
            $stmt->execute([$newPos, $p['id']]);
            $newPos++;
        }
        
        // If sold Pokemon was active, make the first remaining Pokemon active
        if ($wasActive && count($remaining) > 0) {
            $stmt = $pdo->prepare("UPDATE player_pokemon SET is_active = TRUE WHERE id = ?");
            $stmt->execute([$remaining[0]['id']]);
        }
        
        $pdo->commit();
        
        // Get player name for log
        $stmt = $pdo->prepare("SELECT player_name, money FROM players WHERE id = ?");
        $stmt->execute([$playerId]);
        $playerData = $stmt->fetch();
        
        // Log the event
        logTownEvent($pdo, $room['id'], 'sell', [
            'player_id' => $playerId,
            'player_name' => $playerData['player_name'],
            'pokemon_name' => $pokemon['name'],
            'sell_price' => $sellPrice
        ]);
        
        echo json_encode([
            'success' => true,
            'message' => "Sold {$pokemon['name']} for R\${$sellPrice}!",
            'new_money' => (int)$playerData['money'],
            'sell_price' => $sellPrice
        ]);
        
    } catch (Exception $e) {
        $pdo->rollBack();
        echo json_encode(['success' => false, 'error' => 'Database error: ' . $e->getMessage()]);
    }
}

/**
 * Set active Pokemon
 */
function setActivePokemon($pdo) {
    $data = getRequestData();
    $roomCode = $data['room_code'] ?? '';
    $playerId = $data['player_id'] ?? '';
    $slot = $data['slot'] ?? 0;
    
    if (empty($roomCode) || empty($playerId)) {
        echo json_encode(['success' => false, 'error' => 'Missing parameters']);
        return;
    }
    
    // Get room
    $stmt = $pdo->prepare("SELECT id FROM rooms WHERE room_code = ?");
    $stmt->execute([$roomCode]);
    $room = $stmt->fetch();
    
    if (!$room) {
        echo json_encode(['success' => false, 'error' => 'Room not found']);
        return;
    }
    
    // Verify the slot has a Pokemon
    $stmt = $pdo->prepare("
        SELECT pp.*, pd.name 
        FROM player_pokemon pp
        JOIN pokemon_dex pd ON pp.pokemon_id = pd.id
        WHERE pp.player_id = ? AND pp.team_position = ?
    ");
    $stmt->execute([$playerId, $slot]);
    $pokemon = $stmt->fetch();
    
    if (!$pokemon) {
        echo json_encode(['success' => false, 'error' => 'No Pokemon in that slot']);
        return;
    }
    
    // Clear all active flags for this player
    $stmt = $pdo->prepare("UPDATE player_pokemon SET is_active = FALSE WHERE player_id = ?");
    $stmt->execute([$playerId]);
    
    // Set the new active Pokemon
    $stmt = $pdo->prepare("UPDATE player_pokemon SET is_active = TRUE WHERE id = ?");
    $stmt->execute([$pokemon['id']]);
    
    // Get player name for event
    $stmt = $pdo->prepare("SELECT player_name FROM players WHERE id = ?");
    $stmt->execute([$playerId]);
    $player = $stmt->fetch();
    
    // Log event for SSE
    logTownEvent($pdo, $room['id'], 'switch_active', [
        'player_id' => $playerId,
        'player_name' => $player['player_name'],
        'pokemon_name' => $pokemon['name'],
        'slot' => $slot
    ]);
    
    echo json_encode([
        'success' => true,
        'message' => "Switched to {$pokemon['name']}!",
        'new_active_slot' => (int)$slot,
        'pokemon_name' => $pokemon['name']
    ]);
}

/**
 * Toggle player ready status
 */
function toggleReady($pdo) {
    $data = getRequestData();
    $roomCode = $data['room_code'] ?? '';
    $playerId = $data['player_id'] ?? '';
    
    if (empty($roomCode) || empty($playerId)) {
        echo json_encode(['success' => false, 'error' => 'Missing parameters']);
        return;
    }
    
    // Get room
    $stmt = $pdo->prepare("SELECT id FROM rooms WHERE room_code = ? AND game_state = 'town'");
    $stmt->execute([$roomCode]);
    $room = $stmt->fetch();
    
    if (!$room) {
        echo json_encode(['success' => false, 'error' => 'Invalid room or not in town phase']);
        return;
    }
    
    // Toggle ready status
    $stmt = $pdo->prepare("
        UPDATE players SET is_ready = NOT is_ready WHERE id = ? AND room_id = ?
    ");
    $stmt->execute([$playerId, $room['id']]);
    
    // Get updated status
    $stmt = $pdo->prepare("SELECT player_name, is_ready FROM players WHERE id = ?");
    $stmt->execute([$playerId]);
    $player = $stmt->fetch();
    
    // Log event
    logTownEvent($pdo, $room['id'], 'ready_toggle', [
        'player_id' => $playerId,
        'player_name' => $player['player_name'],
        'is_ready' => (bool)$player['is_ready']
    ]);
    
    // Check if all players are ready
    $stmt = $pdo->prepare("
        SELECT COUNT(*) as total, SUM(is_ready) as ready 
        FROM players WHERE room_id = ?
    ");
    $stmt->execute([$room['id']]);
    $counts = $stmt->fetch();
    
    $allReady = ($counts['ready'] == $counts['total']);
    
    if ($allReady) {
        // All players ready - transition to tournament phase
        // Reset ready status for all players
        $stmt = $pdo->prepare("UPDATE players SET is_ready = 0 WHERE room_id = ?");
        $stmt->execute([$room['id']]);
        
        // Update game state to tournament
        $stmt = $pdo->prepare("UPDATE rooms SET game_state = 'tournament' WHERE id = ?");
        $stmt->execute([$room['id']]);
        
        // Log phase transition
        logTownEvent($pdo, $room['id'], 'phase_change', [
            'new_phase' => 'tournament',
            'message' => 'All players ready! Starting Tournament Phase...'
        ]);
    }
    
    echo json_encode([
        'success' => true,
        'is_ready' => (bool)$player['is_ready'],
        'ready_count' => (int)$counts['ready'],
        'total_players' => (int)$counts['total'],
        'all_ready' => $allReady
    ]);
}

/**
 * Log town event for SSE and WebSocket
 */
function logTownEvent($pdo, $roomId, $eventType, $eventData) {
    // Use centralized broadcast function (writes to DB + sends to WebSocket)
    // Note: we prefix with 'town_' to match existing event naming
    broadcastEvent($roomId, 'town_' . $eventType, $eventData);
}
