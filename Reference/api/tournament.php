<?php
/**
 * Tournament Phase API
 * Handles bracket generation, battle management, and tournament progression
 */

// Debug: Show all errors during development
error_reporting(E_ALL);
ini_set('display_errors', 1);

session_start();
header('Content-Type: application/json');

require_once '../config.php';
require_once __DIR__ . '/broadcast.php';

/**
 * Helper to get request data from both JSON and FormData
 */
function getRequestData() {
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    
    if (strpos($contentType, 'application/json') !== false) {
        $json = file_get_contents('php://input');
        return json_decode($json, true) ?? [];
    }
    
    return $_POST;
}

/**
 * Get type effectiveness multiplier (Gen 5 type chart)
 * Type names must match database: normal, fire, water, grass, electric, ice, fighting, 
 * poison, ground, flying, psychic, bug, rock, ghost, dragon, dark, steel
 */
function getTypeMultiplier($attackType, $defenseType) {
    $typeChart = [
        'normal'   => ['rock' => 0.5, 'steel' => 0.5, 'ghost' => 0.1],
        'fire'     => ['fire' => 0.5, 'water' => 0.5, 'rock' => 0.5, 'dragon' => 0.5, 'grass' => 2, 'ice' => 2, 'bug' => 2, 'steel' => 2],
        'water'    => ['water' => 0.5, 'grass' => 0.5, 'dragon' => 0.5, 'fire' => 2, 'ground' => 2, 'rock' => 2],
        'grass'    => ['fire' => 0.5, 'grass' => 0.5, 'poison' => 0.5, 'flying' => 0.5, 'bug' => 0.5, 'dragon' => 0.5, 'steel' => 0.5, 'water' => 2, 'ground' => 2, 'rock' => 2],
        'electric' => ['electric' => 0.5, 'grass' => 0.5, 'dragon' => 0.5, 'ground' => 0.1, 'water' => 2, 'flying' => 2],
        'ice'      => ['fire' => 0.5, 'water' => 0.5, 'ice' => 0.5, 'steel' => 0.5, 'grass' => 2, 'ground' => 2, 'flying' => 2, 'dragon' => 2],
        'fighting' => ['poison' => 0.5, 'flying' => 0.5, 'psychic' => 0.5, 'bug' => 0.5, 'ghost' => 0.1, 'normal' => 2, 'ice' => 2, 'rock' => 2, 'dark' => 2, 'steel' => 2],
        'poison'   => ['poison' => 0.5, 'ground' => 0.5, 'rock' => 0.5, 'ghost' => 0.5, 'steel' => 0.1, 'grass' => 2],
        'ground'   => ['grass' => 0.5, 'bug' => 0.5, 'flying' => 0.1, 'fire' => 2, 'electric' => 2, 'poison' => 2, 'rock' => 2, 'steel' => 2],
        'flying'   => ['electric' => 0.5, 'rock' => 0.5, 'steel' => 0.5, 'grass' => 2, 'fighting' => 2, 'bug' => 2],
        'psychic'  => ['psychic' => 0.5, 'steel' => 0.5, 'dark' => 0.1, 'fighting' => 2, 'poison' => 2],
        'bug'      => ['fire' => 0.5, 'fighting' => 0.5, 'poison' => 0.5, 'flying' => 0.5, 'ghost' => 0.5, 'steel' => 0.5, 'grass' => 2, 'psychic' => 2, 'dark' => 2],
        'rock'     => ['fighting' => 0.5, 'ground' => 0.5, 'steel' => 0.5, 'fire' => 2, 'ice' => 2, 'flying' => 2, 'bug' => 2],
        'ghost'    => ['dark' => 0.5, 'normal' => 0.1, 'psychic' => 2, 'ghost' => 2],
        'dragon'   => ['steel' => 0.5, 'dragon' => 2],
        'dark'     => ['fighting' => 0.5, 'dark' => 0.5, 'psychic' => 2, 'ghost' => 2],
        'steel'    => ['fire' => 0.5, 'water' => 0.5, 'electric' => 0.5, 'steel' => 0.5, 'ice' => 2, 'rock' => 2]
    ];
    
    if (isset($typeChart[$attackType][$defenseType])) {
        return $typeChart[$attackType][$defenseType];
    }
    return 1.0;
}

/**
 * Gym Leader Data - 8 gym leaders + 1 champion for tiebreakers
 * Each has a team that scales with the route number
 * Team Pokémon are defined by their dex IDs in the database
 */
function getGymLeaderData($route) {
    // Gym leaders with their teams (Pokemon names to be looked up in DB)
    // Teams get progressively stronger
    $gymLeaders = [
        1 => [
            'name' => 'Brock',
            'title' => 'Líder de Pedra',
            'avatar' => '🪨',
            'specialty' => 'rock',
            'team' => ['Geodude', 'Geodude'], // 2 Pokemon for early routes
            'dialogue_win' => 'Sua determinação quebrou minhas rochas!',
            'dialogue_lose' => 'As pedras são sólidas e assim é minha defesa!'
        ],
        2 => [
            'name' => 'Misty',
            'title' => 'Líder de Água',
            'avatar' => '🌊',
            'specialty' => 'water',
            'team' => ['Psyduck', 'Starmie'],
            'dialogue_win' => 'Você navegou bem nessa batalha!',
            'dialogue_lose' => 'A maré está a meu favor!'
        ],
        3 => [
            'name' => 'Lt. Surge',
            'title' => 'Líder Elétrico',
            'avatar' => '⚡',
            'specialty' => 'electric',
            'team' => ['Magnemite', 'Raichu', 'Magneton'],
            'dialogue_win' => 'Você me pegou de surpresa, soldado!',
            'dialogue_lose' => 'A eletricidade sempre vence!'
        ],
        4 => [
            'name' => 'Erika',
            'title' => 'Líder de Planta',
            'avatar' => '🌸',
            'specialty' => 'grass',
            'team' => ['Oddish', 'Victreebel', 'Vileplume'],
            'dialogue_win' => 'Suas habilidades floresceram!',
            'dialogue_lose' => 'A natureza é mais forte!'
        ],
        5 => [
            'name' => 'Koga',
            'title' => 'Líder Venenoso',
            'avatar' => '☠️',
            'specialty' => 'poison',
            'team' => ['Venomoth', 'Crobat', 'Beedrill', 'Weezing'],
            'dialogue_win' => 'Você escapou do meu veneno!',
            'dialogue_lose' => 'O veneno ninja é letal!'
        ],
        6 => [
            'name' => 'Sabrina',
            'title' => 'Líder Psíquica',
            'avatar' => '🔮',
            'specialty' => 'psychic',
            'team' => ['Kadabra', 'Hypno', 'Alakazam', 'Haunter'],
            'dialogue_win' => 'Não previ essa derrota...',
            'dialogue_lose' => 'Eu já sabia o resultado!'
        ],
        7 => [
            'name' => 'Blaine',
            'title' => 'Líder de Fogo',
            'avatar' => '🔥',
            'specialty' => 'fire',
            'team' => ['Flareon', 'Magmortar', 'Ninetales', 'Arcanine', 'Magcargo'],
            'dialogue_win' => 'Você apagou minhas chamas!',
            'dialogue_lose' => 'O fogo consome tudo!'
        ],
        8 => [
            'name' => 'Giovanni',
            'title' => 'Líder da Terra',
            'avatar' => '🏔️',
            'specialty' => 'ground',
            'team' => ['Rhyperior', 'Persian', 'Nidoqueen', 'Machamp', 'Cloyster'],
            'dialogue_win' => 'Você provou seu valor...',
            'dialogue_lose' => 'A Team Rocket prevalece!'
        ],
        // Champion for tiebreakers (route 9+)
        9 => [
            'name' => 'Lance',
            'title' => 'Campeão Dragão',
            'avatar' => '🐉',
            'specialty' => 'dragon',
            'team' => ['Dragonite', 'Kingdra', 'Charizard', 'Aerodactyl', 'Gyarados'],
            'dialogue_win' => 'Você é digno do título de Campeão!',
            'dialogue_lose' => 'Os dragões são invencíveis!'
        ]
    ];
    
    // Default to Lance for any route beyond 9
    if ($route > 9) {
        $route = 9;
    }
    
    return $gymLeaders[$route] ?? $gymLeaders[9];
}

/**
 * Create a gym leader battle state
 * Returns a complete battle_state structure for NPC battles
 */
function createGymLeaderBattleState($pdo, $playerId, $playerTeam, $route) {
    $gymLeader = getGymLeaderData($route);
    
    // Get gym leader's team from database by Pokemon names
    $gymTeam = [];
    foreach ($gymLeader['team'] as $pokemonName) {
        $stmt = $pdo->prepare("SELECT * FROM pokemon_dex WHERE name = ?");
        $stmt->execute([$pokemonName]);
        $pokemon = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if ($pokemon) {
            $gymTeam[] = [
                'team_id' => 'npc_' . count($gymTeam),
                'pokemon_id' => $pokemon['id'],
                'name' => $pokemon['name'],
                'type_defense' => $pokemon['type_defense'],
                'type_attack' => $pokemon['type_attack'],
                'base_hp' => $pokemon['base_hp'],
                'base_attack' => $pokemon['base_attack'],
                'base_speed' => $pokemon['base_speed'],
                'battle_hp' => ceil($pokemon['base_hp'] / 10 * 3),
                'current_hp' => ceil($pokemon['base_hp'] / 10 * 3),
                'sprite_url' => $pokemon['sprite_url'],
                'is_fainted' => false
            ];
        }
    }
    
    // Format player team for battle
    $formattedPlayerTeam = array_map(function($p) {
        return [
            'team_id' => $p['team_id'],
            'pokemon_id' => $p['pokemon_id'],
            'name' => $p['name'],
            'type_defense' => $p['type_defense'],
            'type_attack' => $p['type_attack'],
            'base_hp' => $p['base_hp'],
            'base_attack' => $p['base_attack'],
            'base_speed' => $p['base_speed'],
            'battle_hp' => ceil($p['base_hp'] / 10 * 3),
            'current_hp' => ceil($p['base_hp'] / 10 * 3),
            'sprite_url' => $p['sprite_url'],
            'is_fainted' => false
        ];
    }, $playerTeam);
    
    return [
        'is_npc_battle' => true,
        'npc_data' => [
            'name' => $gymLeader['name'],
            'title' => $gymLeader['title'],
            'avatar' => $gymLeader['avatar'],
            'specialty' => $gymLeader['specialty'],
            'dialogue_win' => $gymLeader['dialogue_win'],
            'dialogue_lose' => $gymLeader['dialogue_lose']
        ],
        'match_index' => -1, // Special index for NPC battles
        'player1_id' => $playerId, // Player is always player1
        'player2_id' => 'npc_gym_leader',
        'player1_team' => $formattedPlayerTeam,
        'player2_team' => $gymTeam,
        'player1_active' => null,
        'player2_active' => null,
        'current_turn' => null,
        'phase' => 'selection',
        'turn_number' => 0,
        'battle_log' => []
    ];
}

/**
 * NPC AI: Select a random non-fainted Pokemon
 */
function npcSelectPokemon($battleState) {
    $team = $battleState['player2_team'];
    $availablePokemon = [];
    
    foreach ($team as $index => $pokemon) {
        if (!$pokemon['is_fainted']) {
            $availablePokemon[] = $index;
        }
    }
    
    if (empty($availablePokemon)) {
        return null; // No Pokemon left
    }
    
    // Random selection
    return $availablePokemon[array_rand($availablePokemon)];
}

/**
 * Broadcast event to room via SSE and WebSocket
 * Note: This wrapper maintains compatibility with existing tournament code
 * that passes $pdo as first parameter
 */
function broadcastTournamentEvent($pdo, $roomId, $eventType, $data) {
    // Use centralized broadcast function (writes to DB + sends to WebSocket)
    // Note: we ignore $pdo since broadcastEvent() handles its own DB connection
    \broadcastEvent($roomId, $eventType, $data);
}

/**
 * Get room by code
 */
function getRoomByCode($pdo, $roomCode) {
    $stmt = $pdo->prepare("SELECT * FROM rooms WHERE room_code = ?");
    $stmt->execute([$roomCode]);
    return $stmt->fetch(PDO::FETCH_ASSOC);
}

/**
 * Get player by ID
 */
function getPlayerById($pdo, $playerId) {
    $stmt = $pdo->prepare("SELECT * FROM players WHERE id = ?");
    $stmt->execute([$playerId]);
    return $stmt->fetch(PDO::FETCH_ASSOC);
}

/**
 * Get all players in a room
 */
function getPlayersInRoom($pdo, $roomId) {
    $stmt = $pdo->prepare("
        SELECT p.*, 
               (SELECT COUNT(*) FROM player_pokemon WHERE player_id = p.id) as pokemon_count
        FROM players p 
        WHERE p.room_id = ? 
        ORDER BY p.badges DESC, p.player_number ASC
    ");
    $stmt->execute([$roomId]);
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

/**
 * Get player's team with Pokemon details
 */
function getPlayerTeam($pdo, $playerId) {
    $stmt = $pdo->prepare("
        SELECT pp.id as team_id, pp.pokemon_id, pp.current_hp, pp.current_exp, 
               pp.is_active, pp.team_position,
               pd.name, pd.type_defense, pd.type_attack, pd.base_hp, 
               pd.base_attack, pd.base_speed, pd.evolution_id, pd.evolution_number,
               pd.sprite_url
        FROM player_pokemon pp
        JOIN pokemon_dex pd ON pp.pokemon_id = pd.id
        WHERE pp.player_id = ?
        ORDER BY pp.team_position ASC
    ");
    $stmt->execute([$playerId]);
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

/**
 * Generate tournament brackets
 * For odd number of players, one player fights against a Gym Leader NPC instead of getting a bye
 * The two players with the highest badge count are always paired together (unless all badges are equal)
 */
function generateBrackets($pdo, $roomId, $players, $currentRoute = 1) {
    $numPlayers = count($players);
    $brackets = [];
    
    // Check if all players have the same badge count
    $badgeCounts = array_map(function($p) { return (int)$p['badges']; }, $players);
    $allSameBadges = count(array_unique($badgeCounts)) === 1;
    
    if ($allSameBadges || $numPlayers < 2) {
        // All players have the same badges (or less than 2 players): fully random pairings
        shuffle($players);
    } else {
        // Sort by badges descending to find the top 2
        usort($players, function($a, $b) {
            return (int)$b['badges'] - (int)$a['badges'];
        });
        
        // Extract top 2 players (highest badge counts)
        $top2 = array_slice($players, 0, 2);
        $rest = array_slice($players, 2);
        
        // Shuffle the rest for random pairings
        shuffle($rest);
        
        // Rebuild players array: top 2 first (so they get paired), then the rest
        $players = array_merge($top2, $rest);
    }
    
    // Create matchups
    $matchIndex = 0;
    $usedPlayers = [];
    
    // Pair players sequentially (top 2 badge holders will be index 0 and 1, thus paired together)
    for ($i = 0; $i < floor($numPlayers / 2); $i++) {
        $player1 = $players[$i * 2];
        $player2 = $players[$i * 2 + 1];
        
        $brackets[] = [
            'match_index' => $matchIndex,
            'player1_id' => $player1['id'],
            'player2_id' => $player2['id'],
            'winner_id' => null,
            'status' => 'pending', // pending, in_progress, completed
            'is_npc_battle' => false
        ];
        
        $usedPlayers[] = $player1['id'];
        $usedPlayers[] = $player2['id'];
        $matchIndex++;
    }
    
    // Handle odd number of players - create NPC gym leader battle instead of bye
    $gymLeaderMatch = null;
    if ($numPlayers % 2 === 1) {
        // Last player (after pairing others) fights the gym leader
        $byePlayer = $players[$numPlayers - 1];
        $gymLeader = getGymLeaderData($currentRoute);
        
        $gymLeaderMatch = [
            'match_index' => $matchIndex,
            'player1_id' => $byePlayer['id'],
            'player2_id' => 'npc_gym_leader',
            'npc_name' => $gymLeader['name'],
            'npc_avatar' => $gymLeader['avatar'],
            'npc_title' => $gymLeader['title'],
            'winner_id' => null,
            'status' => 'pending',
            'is_npc_battle' => true
        ];
        
        $brackets[] = $gymLeaderMatch;
        $matchIndex++;
    }
    
    // Store brackets in game_data JSON
    $tournamentData = [
        'brackets' => $brackets,
        'bye_player_id' => null, // No more byes - always fight gym leader
        'gym_leader_match' => $gymLeaderMatch !== null,
        'current_match' => 0,
        'round' => 1,
        'completed_matches' => 0,
        'total_matches' => count($brackets),
        'current_route' => $currentRoute
    ];
    
    $stmt = $pdo->prepare("UPDATE rooms SET game_data = ? WHERE id = ?");
    $stmt->execute([json_encode($tournamentData), $roomId]);
    
    return $tournamentData;
}

/**
 * Generate tiebreaker tournament for players with equal badges
 * In a tiebreaker, losing means elimination
 * @param string $tiebreakerType - 'badges_tiebreaker' or 'final_tiebreaker'
 */
function generateTiebreakerTournament($pdo, $roomId, $players, $tiebreakerType) {
    // Shuffle players for random matchups
    shuffle($players);
    
    $numPlayers = count($players);
    $brackets = [];
    $matchIndex = 0;
    
    // Pair players
    for ($i = 0; $i < floor($numPlayers / 2); $i++) {
        $player1 = $players[$i * 2];
        $player2 = $players[$i * 2 + 1];
        
        $brackets[] = [
            'match_index' => $matchIndex,
            'player1_id' => $player1['id'],
            'player2_id' => $player2['id'],
            'winner_id' => null,
            'status' => 'pending'
        ];
        $matchIndex++;
    }
    
    // Handle bye for odd number of players
    $byePlayerId = null;
    if ($numPlayers % 2 === 1) {
        $byePlayerId = $players[$numPlayers - 1]['id'];
    }
    
    // Store tiebreaker tournament data
    $tournamentData = [
        'brackets' => $brackets,
        'bye_player_id' => $byePlayerId,
        'current_match' => 0,
        'round' => 1,
        'completed_matches' => 0,
        'total_matches' => count($brackets),
        'is_tiebreaker' => true,
        'tiebreaker_type' => $tiebreakerType,
        'tiebreaker_players' => array_map(function($p) { return $p['id']; }, $players),
        'eliminated_players' => []
    ];
    
    $stmt = $pdo->prepare("UPDATE rooms SET game_data = ?, game_state = 'tournament' WHERE id = ?");
    $stmt->execute([json_encode($tournamentData), $roomId]);
    
    return $tournamentData;
}

/**
 * Get current tournament state
 */
function getTournamentState($pdo, $roomId) {
    $stmt = $pdo->prepare("SELECT game_data FROM rooms WHERE id = ?");
    $stmt->execute([$roomId]);
    $room = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$room || !$room['game_data']) {
        return null;
    }
    
    return json_decode($room['game_data'], true);
}

/**
 * Update tournament state
 */
function updateTournamentState($pdo, $roomId, $tournamentData) {
    $stmt = $pdo->prepare("UPDATE rooms SET game_data = ? WHERE id = ?");
    $stmt->execute([json_encode($tournamentData), $roomId]);
}

// Main request handling
try {
    $pdo = new PDO(
        "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME,
        DB_USER,
        DB_PASS,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'error' => 'Database connection failed']);
    exit;
}

$action = $_GET['action'] ?? $_POST['action'] ?? '';
$requestData = getRequestData();

// Debug: Log received action
error_log("Tournament API - Action received: " . $action);

switch ($action) {
    case 'get_state':
        // Debug output at the very start
        error_log("tournament.php get_state called - room_code: " . ($_GET['room_code'] ?? 'none'));
        
        try {
            // Get tournament state
            $roomCode = $_GET['room_code'] ?? $requestData['room_code'] ?? '';
            $playerId = $_GET['player_id'] ?? $requestData['player_id'] ?? '';
            
            if (!$roomCode) {
                echo json_encode(['success' => false, 'error' => 'Room code required']);
                exit;
            }
            
            $room = getRoomByCode($pdo, $roomCode);
            if (!$room) {
                echo json_encode(['success' => false, 'error' => 'Room not found']);
                exit;
            }
            
            $players = getPlayersInRoom($pdo, $room['id']);
            
            // Find host player
            $hostPlayerId = null;
            foreach ($players as $p) {
                if ($p['is_host']) {
                    $hostPlayerId = $p['id'];
                    break;
                }
            }
            
            $tournamentData = getTournamentState($pdo, $room['id']);
            
            // If no tournament data, generate brackets
            if (!$tournamentData) {
                $currentRoute = $room['current_route'] ?? 1;
                $tournamentData = generateBrackets($pdo, $room['id'], $players, $currentRoute);
            }
            
            // Enrich brackets with player info
            $enrichedBrackets = [];
            foreach ($tournamentData['brackets'] as $bracket) {
                $player1 = null;
                $player2 = null;
                $winner = null;
                $isNpcMatch = isset($bracket['is_npc_battle']) && $bracket['is_npc_battle'];
                
                foreach ($players as $p) {
                    if ($p['id'] == $bracket['player1_id']) $player1 = $p;
                    if (!$isNpcMatch && $p['id'] == $bracket['player2_id']) $player2 = $p;
                    if ($bracket['winner_id'] && $p['id'] == $bracket['winner_id']) $winner = $p;
                }
                
                // Handle NPC winner case
                $winnerData = null;
                if ($bracket['winner_id']) {
                    if ($bracket['winner_id'] === 'npc_gym_leader') {
                        $winnerData = [
                            'id' => 'npc_gym_leader',
                            'name' => $bracket['npc_name'] ?? 'Líder de Ginásio',
                            'is_npc' => true
                        ];
                    } else if ($winner) {
                        $winnerData = [
                            'id' => $winner['id'],
                            'name' => $winner['player_name']
                        ];
                    }
                }
                
                // Build player2 data (might be NPC)
                $player2Data = null;
                if ($isNpcMatch) {
                    $player2Data = [
                        'id' => 'npc_gym_leader',
                        'name' => $bracket['npc_name'] ?? 'Líder de Ginásio',
                        'avatar' => $bracket['npc_avatar'] ?? '🏆',
                        'title' => $bracket['npc_title'] ?? 'Líder de Ginásio',
                        'badges' => null,
                        'is_npc' => true
                    ];
                } else if ($player2) {
                    $player2Data = [
                        'id' => $player2['id'],
                        'name' => $player2['player_name'],
                        'avatar' => $player2['avatar_id'],
                        'badges' => $player2['badges']
                    ];
                }
                
                $enrichedBrackets[] = [
                    'match_index' => $bracket['match_index'],
                    'is_npc_battle' => $isNpcMatch,
                    'player1' => $player1 ? [
                        'id' => $player1['id'],
                        'name' => $player1['player_name'],
                        'avatar' => $player1['avatar_id'],
                        'badges' => $player1['badges']
                    ] : null,
                    'player2' => $player2Data,
                    'winner_id' => $bracket['winner_id'],
                    'winner' => $winnerData,
                    'status' => $bracket['status']
                ];
            }
            
            // Get bye player info
            $byePlayer = null;
            if ($tournamentData['bye_player_id']) {
                foreach ($players as $p) {
                    if ($p['id'] == $tournamentData['bye_player_id']) {
                        $byePlayer = [
                            'id' => $p['id'],
                            'name' => $p['player_name'],
                            'avatar' => $p['avatar_id'],
                            'badges' => $p['badges']
                        ];
                        break;
                    }
                }
            }
            
            // Find current/next match
            $currentMatch = null;
            foreach ($enrichedBrackets as $bracket) {
                if ($bracket['status'] !== 'completed') {
                    $currentMatch = $bracket;
                    break;
                }
            }
            
            echo json_encode([
                'success' => true,
                'room' => [
                    'id' => $room['id'],
                    'room_code' => $room['room_code'],
                    'game_state' => $room['game_state'],
                    'current_route' => $room['current_route'],
                    'host_player_id' => $hostPlayerId
                ],
                'tournament' => [
                    'brackets' => $enrichedBrackets,
                    'bye_player' => $byePlayer,
                    'current_match' => $tournamentData['current_match'],
                    'round' => $tournamentData['round'],
                    'completed_matches' => $tournamentData['completed_matches'],
                    'total_matches' => $tournamentData['total_matches'],
                    'is_tiebreaker' => $tournamentData['is_tiebreaker'] ?? false,
                    'tiebreaker_type' => $tournamentData['tiebreaker_type'] ?? ''
                ],
                'players' => array_map(function($p) {
                    return [
                        'id' => $p['id'],
                        'player_name' => $p['player_name'],
                        'avatar_id' => $p['avatar_id'],
                        'badges' => $p['badges'],
                        'money' => $p['money']
                    ];
                }, $players),
                'current_match' => $currentMatch
            ]);
        } catch (Exception $e) {
            echo json_encode(['success' => false, 'error' => 'get_state error: ' . $e->getMessage()]);
        }
        break;
        
    case 'start_match':
        // Start a specific match (transition to battle phase)
        // ONLY HOST CAN START MATCHES
        $roomCode = $requestData['room_code'] ?? '';
        $matchIndex = intval($requestData['match_index'] ?? 0);
        $playerId = $requestData['player_id'] ?? '';
        
        if (!$roomCode) {
            echo json_encode(['success' => false, 'error' => 'Room code required']);
            exit;
        }
        
        $room = getRoomByCode($pdo, $roomCode);
        if (!$room) {
            echo json_encode(['success' => false, 'error' => 'Room not found']);
            exit;
        }
        
        // Check if requester is the host (query players table)
        $stmt = $pdo->prepare("SELECT is_host FROM players WHERE id = ? AND room_id = ?");
        $stmt->execute([$playerId, $room['id']]);
        $player = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if (!$player || !$player['is_host']) {
            echo json_encode(['success' => false, 'error' => 'Only the host can start battles']);
            exit;
        }
        
        $tournamentData = getTournamentState($pdo, $room['id']);
        if (!$tournamentData) {
            echo json_encode(['success' => false, 'error' => 'Tournament not initialized']);
            exit;
        }
        
        // Find the match
        $matchFound = false;
        $isNpcBattle = false;
        $npcData = null;
        foreach ($tournamentData['brackets'] as &$bracket) {
            if ($bracket['match_index'] === $matchIndex) {
                if ($bracket['status'] === 'completed') {
                    echo json_encode(['success' => false, 'error' => 'Match already completed']);
                    exit;
                }
                $bracket['status'] = 'in_progress';
                $matchFound = true;
                
                $player1Id = $bracket['player1_id'];
                $player2Id = $bracket['player2_id'];
                $isNpcBattle = isset($bracket['is_npc_battle']) && $bracket['is_npc_battle'];
                if ($isNpcBattle) {
                    $npcData = [
                        'name' => $bracket['npc_name'] ?? 'Gym Leader',
                        'avatar' => $bracket['npc_avatar'] ?? '🏆',
                        'title' => $bracket['npc_title'] ?? 'Líder de Ginásio'
                    ];
                }
                break;
            }
        }
        unset($bracket);
        
        if (!$matchFound) {
            echo json_encode(['success' => false, 'error' => 'Match not found']);
            exit;
        }
        
        // Get current route for gym leader scaling
        $currentRoute = $tournamentData['current_route'] ?? $room['current_route'] ?? 1;
        
        // Initialize battle state
        $player1Team = getPlayerTeam($pdo, $player1Id);
        
        // For NPC battles, use createGymLeaderBattleState; otherwise normal PvP
        if ($isNpcBattle) {
            // Create NPC battle state using the gym leader helper function
            $battleState = createGymLeaderBattleState($pdo, $player1Id, $player1Team, $currentRoute);
            $battleState['match_index'] = $matchIndex;
            
            // NPC auto-selects their first Pokemon
            $npcSelectedIndex = npcSelectPokemon($battleState);
            if ($npcSelectedIndex !== null) {
                $battleState['player2_active'] = $npcSelectedIndex;
            }
        } else {
            // Normal PvP battle
            $player2Team = getPlayerTeam($pdo, $player2Id);
            
            // Calculate battle HP for all Pokemon (base_hp / 10 * 3)
            $battleState = [
                'match_index' => $matchIndex,
                'player1_id' => $player1Id,
                'player2_id' => $player2Id,
                'is_npc_battle' => false,
                'player1_team' => array_map(function($p) {
                    return [
                        'team_id' => $p['team_id'],
                        'pokemon_id' => $p['pokemon_id'],
                        'name' => $p['name'],
                        'type_defense' => $p['type_defense'],
                        'type_attack' => $p['type_attack'],
                        'base_hp' => $p['base_hp'],
                        'base_attack' => $p['base_attack'],
                        'base_speed' => $p['base_speed'],
                        'battle_hp' => ceil($p['base_hp'] / 10 * 3),
                        'current_hp' => ceil($p['base_hp'] / 10 * 3),
                        'sprite_url' => $p['sprite_url'],
                        'is_fainted' => false
                    ];
                }, $player1Team),
                'player2_team' => array_map(function($p) {
                    return [
                        'team_id' => $p['team_id'],
                        'pokemon_id' => $p['pokemon_id'],
                        'name' => $p['name'],
                        'type_defense' => $p['type_defense'],
                        'type_attack' => $p['type_attack'],
                        'base_hp' => $p['base_hp'],
                        'base_attack' => $p['base_attack'],
                        'base_speed' => $p['base_speed'],
                        'battle_hp' => ceil($p['base_hp'] / 10 * 3),
                        'current_hp' => ceil($p['base_hp'] / 10 * 3),
                        'sprite_url' => $p['sprite_url'],
                        'is_fainted' => false
                    ];
                }, $player2Team),
                'player1_active' => null, // Will be set when players select
                'player2_active' => null,
                'current_turn' => null, // Will be determined by speed
                'phase' => 'selection', // selection, battle, finished
                'turn_number' => 0,
                'battle_log' => []
            ];
        }
        
        $tournamentData['current_match'] = $matchIndex;
        $tournamentData['battle_state'] = $battleState;
        
        updateTournamentState($pdo, $room['id'], $tournamentData);
        
        // Update room to battle phase
        $stmt = $pdo->prepare("UPDATE rooms SET game_state = 'battle' WHERE id = ?");
        $stmt->execute([$room['id']]);
        
        // Get player names
        $player1 = getPlayerById($pdo, $player1Id);
        
        // Prepare broadcast data
        $broadcastData = [
            'match_index' => $matchIndex,
            'is_npc_battle' => $isNpcBattle,
            'player1' => [
                'id' => $player1Id,
                'name' => $player1['player_name']
            ]
        ];
        
        if ($isNpcBattle) {
            $gymLeader = getGymLeaderData($currentRoute);
            $broadcastData['player2'] = [
                'id' => 'npc_gym_leader',
                'name' => $gymLeader['name'],
                'title' => $gymLeader['title'],
                'avatar' => $gymLeader['avatar'],
                'is_npc' => true
            ];
            $broadcastData['npc_data'] = $battleState['npc_data'];
            // Include NPC's initial Pokemon selection
            if ($battleState['player2_active'] !== null) {
                $npcPokemon = $battleState['player2_team'][$battleState['player2_active']];
                $broadcastData['npc_pokemon'] = [
                    'name' => $npcPokemon['name'],
                    'sprite_url' => $npcPokemon['sprite_url']
                ];
            }
        } else {
            $player2 = getPlayerById($pdo, $player2Id);
            $broadcastData['player2'] = [
                'id' => $player2Id,
                'name' => $player2['player_name']
            ];
        }
        
        // Broadcast battle start
        broadcastTournamentEvent($pdo, $room['id'], 'battle_started', $broadcastData);
        
        echo json_encode([
            'success' => true,
            'message' => $isNpcBattle ? 'Batalha contra Líder de Ginásio iniciada!' : 'Batalha iniciada!',
            'battle_state' => $battleState,
            'is_npc_battle' => $isNpcBattle
        ]);
        break;
        
    case 'auto_start_next':
        // Automatically start the next pending match
        $roomCode = $requestData['room_code'] ?? '';
        
        if (!$roomCode) {
            echo json_encode(['success' => false, 'error' => 'Room code required']);
            exit;
        }
        
        $room = getRoomByCode($pdo, $roomCode);
        if (!$room) {
            echo json_encode(['success' => false, 'error' => 'Room not found']);
            exit;
        }
        
        $tournamentData = getTournamentState($pdo, $room['id']);
        if (!$tournamentData) {
            echo json_encode(['success' => false, 'error' => 'Tournament not initialized']);
            exit;
        }
        
        // Find next pending match
        $nextMatch = null;
        foreach ($tournamentData['brackets'] as $bracket) {
            if ($bracket['status'] === 'pending') {
                $nextMatch = $bracket;
                break;
            }
        }
        
        if (!$nextMatch) {
            // All matches completed - tournament is done
            echo json_encode([
                'success' => true,
                'tournament_complete' => true,
                'message' => 'Tournament complete!'
            ]);
            exit;
        }
        
        // Forward to start_match
        $_POST['room_code'] = $roomCode;
        $_POST['match_index'] = $nextMatch['match_index'];
        $requestData['room_code'] = $roomCode;
        $requestData['match_index'] = $nextMatch['match_index'];
        
        // Recursively call start_match logic
        // (In production, this would be refactored to avoid code duplication)
        // For now, return info about the next match
        echo json_encode([
            'success' => true,
            'next_match' => $nextMatch,
            'message' => 'Next match ready'
        ]);
        break;
        
    case 'complete_tournament':
        // Complete tournament and advance to next route or finish game
        $roomCode = $requestData['room_code'] ?? '';
        $playerId = $requestData['player_id'] ?? '';
        
        if (!$roomCode) {
            echo json_encode(['success' => false, 'error' => 'Room code required']);
            exit;
        }
        
        $room = getRoomByCode($pdo, $roomCode);
        if (!$room) {
            echo json_encode(['success' => false, 'error' => 'Room not found']);
            exit;
        }
        
        // Only host can advance to next route (query players table)
        $stmt = $pdo->prepare("SELECT is_host FROM players WHERE id = ? AND room_id = ?");
        $stmt->execute([$playerId, $room['id']]);
        $player = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if (!$player || !$player['is_host']) {
            echo json_encode(['success' => false, 'error' => 'Only the host can advance to the next route']);
            exit;
        }
        
        $currentRoute = $room['current_route'];
        $maxRoutes = 8;
        $badgesToWin = 5;
        
        // Get all players with their badges
        $players = getPlayersInRoom($pdo, $room['id']);
        
        // Check for players with enough badges to win
        $playersWithWinningBadges = [];
        foreach ($players as $p) {
            if ($p['badges'] >= $badgesToWin) {
                $playersWithWinningBadges[] = $p;
            }
        }
        
        // Determine if this is the last route
        $isLastRoute = ($currentRoute >= $maxRoutes);
        
        // VICTORY CONDITION CHECK
        if (count($playersWithWinningBadges) === 1) {
            // Single winner with 5+ badges
            $winner = $playersWithWinningBadges[0];
            
            $stmt = $pdo->prepare("UPDATE rooms SET game_state = 'finished', game_data = ? WHERE id = ?");
            $stmt->execute([json_encode([
                'winner_id' => $winner['id'], 
                'winner_name' => $winner['player_name'],
                'win_type' => 'badges'
            ]), $room['id']]);
            
            broadcastTournamentEvent($pdo, $room['id'], 'game_finished', [
                'winner_id' => $winner['id'],
                'winner_name' => $winner['player_name'],
                'win_type' => 'badges',
                'badges' => $winner['badges']
            ]);
            
            echo json_encode([
                'success' => true,
                'game_finished' => true,
                'winner' => [
                    'id' => $winner['id'],
                    'name' => $winner['player_name'],
                    'badges' => $winner['badges']
                ],
                'win_type' => 'badges'
            ]);
            exit;
            
        } elseif (count($playersWithWinningBadges) > 1) {
            // DRAW: Multiple players have 5+ badges - start tiebreaker tournament
            $tiebreakerData = generateTiebreakerTournament($pdo, $room['id'], $playersWithWinningBadges, 'badges_tiebreaker');
            
            broadcastTournamentEvent($pdo, $room['id'], 'tiebreaker_tournament', [
                'reason' => 'badges_draw',
                'players' => array_map(function($p) {
                    return ['id' => $p['id'], 'name' => $p['player_name'], 'badges' => $p['badges']];
                }, $playersWithWinningBadges)
            ]);
            
            echo json_encode([
                'success' => true,
                'tiebreaker' => true,
                'reason' => 'badges_draw',
                'players' => array_map(function($p) {
                    return ['id' => $p['id'], 'name' => $p['player_name'], 'badges' => $p['badges']];
                }, $playersWithWinningBadges)
            ]);
            exit;
            
        } elseif ($isLastRoute) {
            // Last route - check for winner by most badges
            usort($players, function($a, $b) {
                return $b['badges'] - $a['badges'];
            });
            
            $maxBadges = $players[0]['badges'];
            $playersWithMaxBadges = array_filter($players, function($p) use ($maxBadges) {
                return $p['badges'] === $maxBadges;
            });
            $playersWithMaxBadges = array_values($playersWithMaxBadges);
            
            if (count($playersWithMaxBadges) === 1) {
                // Single winner by badges count
                $winner = $playersWithMaxBadges[0];
                
                $stmt = $pdo->prepare("UPDATE rooms SET game_state = 'finished', game_data = ? WHERE id = ?");
                $stmt->execute([json_encode([
                    'winner_id' => $winner['id'], 
                    'winner_name' => $winner['player_name'],
                    'win_type' => 'most_badges'
                ]), $room['id']]);
                
                broadcastTournamentEvent($pdo, $room['id'], 'game_finished', [
                    'winner_id' => $winner['id'],
                    'winner_name' => $winner['player_name'],
                    'win_type' => 'most_badges',
                    'badges' => $winner['badges']
                ]);
                
                echo json_encode([
                    'success' => true,
                    'game_finished' => true,
                    'winner' => [
                        'id' => $winner['id'],
                        'name' => $winner['player_name'],
                        'badges' => $winner['badges']
                    ],
                    'win_type' => 'most_badges'
                ]);
                exit;
                
            } else {
                // DRAW on last route: Multiple players tied for most badges
                $tiebreakerData = generateTiebreakerTournament($pdo, $room['id'], $playersWithMaxBadges, 'final_tiebreaker');
                
                broadcastTournamentEvent($pdo, $room['id'], 'tiebreaker_tournament', [
                    'reason' => 'final_draw',
                    'players' => array_map(function($p) {
                        return ['id' => $p['id'], 'name' => $p['player_name'], 'badges' => $p['badges']];
                    }, $playersWithMaxBadges)
                ]);
                
                echo json_encode([
                    'success' => true,
                    'tiebreaker' => true,
                    'reason' => 'final_draw',
                    'players' => array_map(function($p) {
                        return ['id' => $p['id'], 'name' => $p['player_name'], 'badges' => $p['badges']];
                    }, $playersWithMaxBadges)
                ]);
                exit;
            }
        }
        
        // No winner yet - advance to next route
        $newRoute = $currentRoute + 1;
        $newEncounters = count($players) * 2;
        
        // Randomize who starts the catching phase
        $randomFirstPlayer = rand(0, count($players) - 1);
        
        // Get the first player's name for the event
        $firstPlayer = null;
        foreach ($players as $p) {
            if ($p['player_number'] == $randomFirstPlayer) {
                $firstPlayer = $p;
                break;
            }
        }
        
        // Reset player ready status
        $stmt = $pdo->prepare("UPDATE players SET is_ready = FALSE WHERE room_id = ?");
        $stmt->execute([$room['id']]);
        
        // Clear wild pokemon
        $stmt = $pdo->prepare("DELETE FROM wild_pokemon WHERE room_id = ?");
        $stmt->execute([$room['id']]);
        
        // Give players town money bonus
        $stmt = $pdo->prepare("UPDATE players SET money = money + 3 WHERE room_id = ?");
        $stmt->execute([$room['id']]);
        
        // Update room to catching phase for next route with randomized first player
        $stmt = $pdo->prepare("
            UPDATE rooms 
            SET game_state = 'catching', 
                current_route = ?, 
                encounters_remaining = ?,
                current_player_turn = ?,
                game_data = NULL
            WHERE id = ?
        ");
        $stmt->execute([$newRoute, $newEncounters, $randomFirstPlayer, $room['id']]);
        
        broadcastTournamentEvent($pdo, $room['id'], 'phase_changed', [
            'new_phase' => 'catching',
            'new_route' => $newRoute,
            'first_player' => $randomFirstPlayer,
            'first_player_name' => $firstPlayer ? $firstPlayer['player_name'] : 'Unknown'
        ]);
        
        echo json_encode([
            'success' => true,
            'new_route' => $newRoute,
            'new_phase' => 'catching',
            'first_player' => $randomFirstPlayer,
            'first_player_name' => $firstPlayer ? $firstPlayer['player_name'] : 'Unknown'
        ]);
        break;
    
    case 'get_battle_state':
        // Get current battle state
        $roomCode = $_GET['room_code'] ?? $requestData['room_code'] ?? '';
        $requestingPlayerId = $_GET['player_id'] ?? $requestData['player_id'] ?? '';
        
        if (!$roomCode) {
            echo json_encode(['success' => false, 'error' => 'Room code required']);
            exit;
        }
        
        $room = getRoomByCode($pdo, $roomCode);
        if (!$room) {
            echo json_encode(['success' => false, 'error' => 'Room not found']);
            exit;
        }
        
        $tournamentData = getTournamentState($pdo, $room['id']);
        if (!$tournamentData || !isset($tournamentData['battle_state'])) {
            echo json_encode(['success' => false, 'error' => 'No active battle']);
            exit;
        }
        
        $battleState = $tournamentData['battle_state'];
        $isNpcBattle = isset($battleState['is_npc_battle']) && $battleState['is_npc_battle'];
        
        // Get player names
        $player1 = getPlayerById($pdo, $battleState['player1_id']);
        // Player2 might be NPC
        $player2 = $isNpcBattle ? null : getPlayerById($pdo, $battleState['player2_id']);
        
        // During selection phase, hide opponent's selection
        // Only reveal which Pokemon is selected once BOTH players have chosen
        $isPlayer1 = ($requestingPlayerId == $battleState['player1_id']);
        $isPlayer2 = ($requestingPlayerId == $battleState['player2_id']);
        $isParticipant = $isPlayer1 || $isPlayer2;
        $bothSelected = ($battleState['player1_active'] !== null && $battleState['player2_active'] !== null);
        
        // Create a response battle state that may hide opponent info
        $responseBattleState = $battleState;
        
        if ($battleState['phase'] === 'selection' && !$bothSelected) {
            // Hide opponent's selection during selection phase
            if ($isPlayer1) {
                // Player 1: can see own selection, hide player 2's selection
                $responseBattleState['player2_active'] = null;
                $responseBattleState['player2_has_selected'] = ($battleState['player2_active'] !== null);
            } else if ($isPlayer2) {
                // Player 2: can see own selection, hide player 1's selection
                $responseBattleState['player1_active'] = null;
                $responseBattleState['player1_has_selected'] = ($battleState['player1_active'] !== null);
            } else {
                // Spectator: hide both selections until both are ready
                $responseBattleState['player1_active'] = null;
                $responseBattleState['player2_active'] = null;
                $responseBattleState['player1_has_selected'] = ($battleState['player1_active'] !== null);
                $responseBattleState['player2_has_selected'] = ($battleState['player2_active'] !== null);
            }
        }
        
        // Build player2 response data (handle NPC case)
        $player2Data = $isNpcBattle ? [
            'id' => 'npc_gym_leader',
            'name' => $battleState['npc_data']['name'] ?? 'Líder de Ginásio',
            'title' => $battleState['npc_data']['title'] ?? '',
            'avatar' => $battleState['npc_data']['avatar'] ?? '🏆',
            'is_npc' => true
        ] : [
            'id' => $player2['id'],
            'name' => $player2['player_name'],
            'avatar' => $player2['avatar_id']
        ];
        
        // Calculate type matchups for Pokémon selection UI
        // This helps players see which of their Pokémon have advantages/disadvantages
        $typeMatchups = null;
        
        // Determine if requesting player needs to select (replacement scenario)
        // We show matchups when there's an active opponent Pokémon
        $opponentActiveIndex = null;
        $opponentPokemon = null;
        $playerTeamKey = null;
        
        if ($isPlayer1) {
            $opponentActiveIndex = $battleState['player2_active'];
            if ($opponentActiveIndex !== null) {
                $opponentPokemon = $battleState['player2_team'][$opponentActiveIndex];
            }
            $playerTeamKey = 'player1_team';
        } else if ($isPlayer2) {
            $opponentActiveIndex = $battleState['player1_active'];
            if ($opponentActiveIndex !== null) {
                $opponentPokemon = $battleState['player1_team'][$opponentActiveIndex];
            }
            $playerTeamKey = 'player2_team';
        }
        
        // If there's an active opponent, calculate matchups for each of the player's Pokémon
        if ($opponentPokemon !== null && $playerTeamKey !== null && $isParticipant) {
            $typeMatchups = [];
            foreach ($responseBattleState[$playerTeamKey] as $index => $pokemon) {
                // Skip fainted Pokémon
                if ($pokemon['is_fainted']) {
                    $typeMatchups[$index] = [
                        'defense_matchup' => 'neutral',
                        'attack_matchup' => 'neutral',
                        'overall' => 'fainted'
                    ];
                    continue;
                }
                
                // Calculate defense matchup: opponent attacks us
                // If opponent's attack type is super effective against our defense = bad (red)
                // If opponent's attack type is resisted by our defense = good (green)
                $defenseMultiplier = getTypeMultiplier($opponentPokemon['type_attack'], $pokemon['type_defense']);
                $defenseMatchup = 'neutral';
                if ($defenseMultiplier >= 2) {
                    $defenseMatchup = 'weak'; // We take super effective damage = red
                } else if ($defenseMultiplier <= 0.5) {
                    $defenseMatchup = 'resist'; // We resist their attack = green
                }
                
                // Calculate attack matchup: we attack opponent
                // If our attack type is super effective against opponent's defense = good (green)
                // If our attack type is resisted by opponent's defense = bad (red)
                $attackMultiplier = getTypeMultiplier($pokemon['type_attack'], $opponentPokemon['type_defense']);
                $attackMatchup = 'neutral';
                if ($attackMultiplier >= 2) {
                    $attackMatchup = 'super_effective'; // We deal super effective damage = green
                } else if ($attackMultiplier <= 0.5) {
                    $attackMatchup = 'resisted'; // Our attack is resisted = red
                }
                
                // Determine overall indicator
                // Priority: If both good = green, if both bad = red, mixed = show both
                $overall = 'neutral';
                $goodCount = 0;
                $badCount = 0;
                
                if ($defenseMatchup === 'resist') $goodCount++;
                if ($defenseMatchup === 'weak') $badCount++;
                if ($attackMatchup === 'super_effective') $goodCount++;
                if ($attackMatchup === 'resisted') $badCount++;
                
                if ($goodCount > 0 && $badCount === 0) {
                    $overall = 'advantage';
                } else if ($badCount > 0 && $goodCount === 0) {
                    $overall = 'disadvantage';
                } else if ($goodCount > 0 && $badCount > 0) {
                    $overall = 'mixed';
                }
                
                $typeMatchups[$index] = [
                    'defense_matchup' => $defenseMatchup,
                    'defense_multiplier' => $defenseMultiplier,
                    'attack_matchup' => $attackMatchup,
                    'attack_multiplier' => $attackMultiplier,
                    'overall' => $overall
                ];
            }
        }
        
        echo json_encode([
            'success' => true,
            'battle_state' => $responseBattleState,
            'is_npc_battle' => $isNpcBattle,
            'npc_data' => $isNpcBattle ? $battleState['npc_data'] : null,
            'player1' => [
                'id' => $player1['id'],
                'name' => $player1['player_name'],
                'avatar' => $player1['avatar_id']
            ],
            'player2' => $player2Data,
            'type_matchups' => $typeMatchups
        ]);
        break;
        
    case 'select_pokemon':
        // Player selects their starting/next Pokemon
        $roomCode = $requestData['room_code'] ?? '';
        $playerId = $requestData['player_id'] ?? '';
        $teamIndex = intval($requestData['team_index'] ?? 0);
        
        if (!$roomCode || !$playerId) {
            echo json_encode(['success' => false, 'error' => 'Missing parameters']);
            exit;
        }
        
        $room = getRoomByCode($pdo, $roomCode);
        if (!$room) {
            echo json_encode(['success' => false, 'error' => 'Room not found']);
            exit;
        }
        
        $tournamentData = getTournamentState($pdo, $room['id']);
        if (!$tournamentData || !isset($tournamentData['battle_state'])) {
            echo json_encode(['success' => false, 'error' => 'No active battle']);
            exit;
        }
        
        $battleState = &$tournamentData['battle_state'];
        
        // Determine which player this is
        $isPlayer1 = ($playerId == $battleState['player1_id']);
        $isPlayer2 = ($playerId == $battleState['player2_id']);
        
        if (!$isPlayer1 && !$isPlayer2) {
            echo json_encode(['success' => false, 'error' => 'Not a participant in this battle']);
            exit;
        }
        
        // Get the appropriate team
        $teamKey = $isPlayer1 ? 'player1_team' : 'player2_team';
        $activeKey = $isPlayer1 ? 'player1_active' : 'player2_active';
        
        // Validate team index
        if ($teamIndex < 0 || $teamIndex >= count($battleState[$teamKey])) {
            echo json_encode(['success' => false, 'error' => 'Invalid Pokemon selection']);
            exit;
        }
        
        // Check Pokemon is not fainted
        if ($battleState[$teamKey][$teamIndex]['is_fainted']) {
            echo json_encode(['success' => false, 'error' => 'Cannot select fainted Pokemon']);
            exit;
        }
        
        // Set active Pokemon
        $battleState[$activeKey] = $teamIndex;
        $selectedPokemon = $battleState[$teamKey][$teamIndex];
        
        // Get player info
        $player = getPlayerById($pdo, $playerId);
        
        // Check if both players have selected
        $bothSelected = ($battleState['player1_active'] !== null && $battleState['player2_active'] !== null);
        $isNpcBattle = isset($battleState['is_npc_battle']) && $battleState['is_npc_battle'];
        
        // Build broadcast data
        $broadcastData = [
            'player_id' => $playerId,
            'player_name' => $player['player_name'],
            'is_player1' => $isPlayer1,
            'both_selected' => $bothSelected,
            'is_npc_battle' => $isNpcBattle,
            // Only include Pokemon details if both have selected (battle starting)
            'pokemon_name' => $bothSelected ? $selectedPokemon['name'] : null,
            'pokemon_sprite' => $bothSelected ? $selectedPokemon['sprite_url'] : null
        ];
        
        // When both have selected, include BOTH players' Pokemon info
        if ($bothSelected) {
            $p1Pokemon = $battleState['player1_team'][$battleState['player1_active']];
            $p2Pokemon = $battleState['player2_team'][$battleState['player2_active']];
            $broadcastData['player1_pokemon'] = $p1Pokemon['name'];
            $broadcastData['player1_active'] = $battleState['player1_active'];
            $broadcastData['player2_pokemon'] = $p2Pokemon['name'];
            $broadcastData['player2_active'] = $battleState['player2_active'];
        }
        
        // Broadcast selection
        broadcastTournamentEvent($pdo, $room['id'], 'battle_pokemon_selected', $broadcastData);
        
        if ($bothSelected && $battleState['phase'] === 'selection') {
            // Transition to battle phase
            $battleState['phase'] = 'battle';
            $battleState['turn_number'] = 1;
            
            // Determine who goes first based on speed
            $p1Pokemon = $battleState['player1_team'][$battleState['player1_active']];
            $p2Pokemon = $battleState['player2_team'][$battleState['player2_active']];
            
            if ($p1Pokemon['base_speed'] >= $p2Pokemon['base_speed']) {
                $battleState['current_turn'] = 'player1';
            } else {
                $battleState['current_turn'] = 'player2';
            }
            
            broadcastTournamentEvent($pdo, $room['id'], 'battle_started_combat', [
                'player1_pokemon' => $p1Pokemon['name'],
                'player2_pokemon' => $p2Pokemon['name'],
                'player1_active' => $battleState['player1_active'],
                'player2_active' => $battleState['player2_active'],
                'first_turn' => $battleState['current_turn']
            ]);
        }
        
        // Save state
        updateTournamentState($pdo, $room['id'], $tournamentData);
        
        echo json_encode([
            'success' => true,
            'message' => "Selected {$selectedPokemon['name']}!",
            'both_selected' => $bothSelected,
            'battle_phase' => $battleState['phase']
        ]);
        break;
        
    case 'execute_turn':
        // Execute a single attack turn (called by frontend with delay)
        $roomCode = $requestData['room_code'] ?? '';
        
        if (!$roomCode) {
            echo json_encode(['success' => false, 'error' => 'Room code required']);
            exit;
        }
        
        $room = getRoomByCode($pdo, $roomCode);
        if (!$room) {
            echo json_encode(['success' => false, 'error' => 'Room not found']);
            exit;
        }
        
        $tournamentData = getTournamentState($pdo, $room['id']);
        if (!$tournamentData || !isset($tournamentData['battle_state'])) {
            echo json_encode(['success' => false, 'error' => 'No active battle']);
            exit;
        }
        
        $battleState = &$tournamentData['battle_state'];
        
        if ($battleState['phase'] !== 'battle') {
            echo json_encode(['success' => false, 'error' => 'Battle not in combat phase']);
            exit;
        }
        
        // Get attacker and defender
        $isPlayer1Turn = ($battleState['current_turn'] === 'player1');
        $isNpcBattle = isset($battleState['is_npc_battle']) && $battleState['is_npc_battle'];
        
        $attackerTeamKey = $isPlayer1Turn ? 'player1_team' : 'player2_team';
        $defenderTeamKey = $isPlayer1Turn ? 'player2_team' : 'player1_team';
        $attackerActiveKey = $isPlayer1Turn ? 'player1_active' : 'player2_active';
        $defenderActiveKey = $isPlayer1Turn ? 'player2_active' : 'player1_active';
        $attackerPlayerId = $isPlayer1Turn ? $battleState['player1_id'] : $battleState['player2_id'];
        $defenderPlayerId = $isPlayer1Turn ? $battleState['player2_id'] : $battleState['player1_id'];
        
        // Check if attacker/defender is NPC
        $attackerIsNpc = $isNpcBattle && !$isPlayer1Turn;
        $defenderIsNpc = $isNpcBattle && $isPlayer1Turn;
        
        $attacker = &$battleState[$attackerTeamKey][$battleState[$attackerActiveKey]];
        $defender = &$battleState[$defenderTeamKey][$battleState[$defenderActiveKey]];
        
        // Calculate damage
        $typeMultiplier = getTypeMultiplier($attacker['type_attack'], $defender['type_defense']);
        $damage = ceil($attacker['base_attack'] * 0.1 * $typeMultiplier);
        $damage = max(1, $damage); // Minimum 1 damage
        
        // Apply damage
        $defender['current_hp'] = max(0, $defender['current_hp'] - $damage);
        $defenderFainted = ($defender['current_hp'] <= 0);
        
        if ($defenderFainted) {
            $defender['is_fainted'] = true;
        }
        
        // Get player info for broadcasts (handle NPC case)
        $attackerPlayer = $attackerIsNpc ? null : getPlayerById($pdo, $attackerPlayerId);
        $defenderPlayer = $defenderIsNpc ? null : getPlayerById($pdo, $defenderPlayerId);
        
        // Get attacker/defender names (handle NPC)
        $attackerName = $attackerIsNpc ? ($battleState['npc_data']['name'] ?? 'Líder de Ginásio') : $attackerPlayer['player_name'];
        $defenderName = $defenderIsNpc ? ($battleState['npc_data']['name'] ?? 'Líder de Ginásio') : $defenderPlayer['player_name'];
        
        // Broadcast the attack
        broadcastTournamentEvent($pdo, $room['id'], 'battle_attack', [
            'attacker_id' => $attackerPlayerId,
            'attacker_name' => $attackerName,
            'attacker_pokemon' => $attacker['name'],
            'defender_pokemon' => $defender['name'],
            'damage' => $damage,
            'type_multiplier' => $typeMultiplier,
            'defender_hp' => $defender['current_hp'],
            'defender_max_hp' => $defender['battle_hp'],
            'defender_fainted' => $defenderFainted,
            'fainted' => $defenderFainted,
            'is_player1_attacking' => $isPlayer1Turn,
            'is_npc_battle' => $isNpcBattle,
            'attacker_is_npc' => $attackerIsNpc,
            'defender_is_npc' => $defenderIsNpc
        ]);
        
        $battleEnded = false;
        $needsSelection = false;
        $winnerId = null;
        $loserId = null;
        
        if ($defenderFainted) {
            // Check if defender has any Pokemon left
            $defenderHasPokemon = false;
            foreach ($battleState[$defenderTeamKey] as $pokemon) {
                if (!$pokemon['is_fainted']) {
                    $defenderHasPokemon = true;
                    break;
                }
            }
            
            if (!$defenderHasPokemon) {
                // Battle is over - attacker wins!
                $battleEnded = true;
                $winnerId = $attackerPlayerId;
                $loserId = $defenderPlayerId;
                $battleState['phase'] = 'finished';
                $battleState['winner_id'] = $winnerId;
                
                // Check if this is a tiebreaker tournament
                $isTiebreaker = isset($tournamentData['is_tiebreaker']) && $tournamentData['is_tiebreaker'];
                
                if ($isTiebreaker) {
                    // In tiebreaker, loser is eliminated (no badge awarded)
                    $tournamentData['eliminated_players'][] = $loserId;
                    
                    // Check if tiebreaker is complete (only one player left or all matches done)
                    $remainingPlayers = array_diff(
                        $tournamentData['tiebreaker_players'],
                        $tournamentData['eliminated_players']
                    );
                    
                    // Include bye player if exists
                    if ($tournamentData['bye_player_id'] && !in_array($tournamentData['bye_player_id'], $tournamentData['eliminated_players'])) {
                        $remainingPlayers = array_unique(array_merge($remainingPlayers, [$tournamentData['bye_player_id']]));
                    }
                    
                    if (count($remainingPlayers) === 1) {
                        // Tiebreaker complete - we have a winner!
                        $tiebreakerWinnerId = reset($remainingPlayers);
                        $tiebreakerWinner = getPlayerById($pdo, $tiebreakerWinnerId);
                        
                        $stmt = $pdo->prepare("UPDATE rooms SET game_state = 'finished', game_data = ? WHERE id = ?");
                        $stmt->execute([json_encode([
                            'winner_id' => $tiebreakerWinnerId, 
                            'winner_name' => $tiebreakerWinner['player_name'],
                            'win_type' => 'tiebreaker'
                        ]), $room['id']]);
                        
                        broadcastTournamentEvent($pdo, $room['id'], 'game_finished', [
                            'winner_id' => $tiebreakerWinnerId,
                            'winner_name' => $tiebreakerWinner['player_name'],
                            'win_type' => 'tiebreaker'
                        ]);
                    } else {
                        // Check if we need another round of tiebreaker matches
                        $allMatchesComplete = true;
                        foreach ($tournamentData['brackets'] as $b) {
                            if ($b['status'] !== 'completed') {
                                $allMatchesComplete = false;
                                break;
                            }
                        }
                        
                        if ($allMatchesComplete && count($remainingPlayers) > 1) {
                            // Generate new bracket round with remaining players
                            $remainingPlayerData = [];
                            foreach ($remainingPlayers as $pid) {
                                $remainingPlayerData[] = getPlayerById($pdo, $pid);
                            }
                            
                            // Create new brackets for remaining players
                            shuffle($remainingPlayerData);
                            $newBrackets = [];
                            $matchIndex = 0;
                            
                            for ($i = 0; $i < floor(count($remainingPlayerData) / 2); $i++) {
                                $newBrackets[] = [
                                    'match_index' => $matchIndex,
                                    'player1_id' => $remainingPlayerData[$i * 2]['id'],
                                    'player2_id' => $remainingPlayerData[$i * 2 + 1]['id'],
                                    'winner_id' => null,
                                    'status' => 'pending'
                                ];
                                $matchIndex++;
                            }
                            
                            // Handle bye if odd number
                            $newByePlayerId = null;
                            if (count($remainingPlayerData) % 2 === 1) {
                                $newByePlayerId = $remainingPlayerData[count($remainingPlayerData) - 1]['id'];
                            }
                            
                            $tournamentData['brackets'] = $newBrackets;
                            $tournamentData['bye_player_id'] = $newByePlayerId;
                            $tournamentData['round']++;
                            $tournamentData['completed_matches'] = 0;
                            $tournamentData['total_matches'] = count($newBrackets);
                            unset($tournamentData['battle_state']);
                            
                            broadcastTournamentEvent($pdo, $room['id'], 'tiebreaker_round', [
                                'round' => $tournamentData['round'],
                                'remaining_players' => count($remainingPlayers)
                            ]);
                        }
                        
                        // Return to tournament phase
                        $stmt = $pdo->prepare("UPDATE rooms SET game_state = 'tournament' WHERE id = ?");
                        $stmt->execute([$room['id']]);
                    }
                } else {
                    // Normal tournament - award badge to winner (only if winner is a real player)
                    $winnerIsNpc = ($winnerId === 'npc_gym_leader');
                    
                    if (!$winnerIsNpc) {
                        // Player won against gym leader or another player
                        $stmt = $pdo->prepare("UPDATE players SET badges = badges + 1 WHERE id = ?");
                        $stmt->execute([$winnerId]);
                        
                        // Award money to winner
                        $stmt = $pdo->prepare("UPDATE players SET money = money + 2 WHERE id = ?");
                        $stmt->execute([$winnerId]);
                    }
                    // If NPC won, player loses but no badge is awarded to NPC
                    
                    // Return to tournament phase
                    $stmt = $pdo->prepare("UPDATE rooms SET game_state = 'tournament' WHERE id = ?");
                    $stmt->execute([$room['id']]);
                }
                
                // Update bracket with winner
                foreach ($tournamentData['brackets'] as &$bracket) {
                    if ($bracket['match_index'] === $battleState['match_index']) {
                        $bracket['winner_id'] = $winnerId;
                        $bracket['status'] = 'completed';
                        $tournamentData['completed_matches']++;
                        break;
                    }
                }
                unset($bracket);
                
                // Broadcast battle end
                $winnerIsNpc = ($winnerId === 'npc_gym_leader');
                $loserIsNpc = ($loserId === 'npc_gym_leader');
                
                $winnerName = $winnerIsNpc 
                    ? ($battleState['npc_data']['name'] ?? 'Líder de Ginásio')
                    : getPlayerById($pdo, $winnerId)['player_name'];
                    
                $loserName = $loserIsNpc
                    ? ($battleState['npc_data']['name'] ?? 'Líder de Ginásio')
                    : getPlayerById($pdo, $loserId)['player_name'];
                
                // Get gym leader dialogue if applicable
                $npcDialogue = null;
                if ($isNpcBattle && isset($battleState['npc_data'])) {
                    $npcDialogue = $winnerIsNpc 
                        ? $battleState['npc_data']['dialogue_lose'] 
                        : $battleState['npc_data']['dialogue_win'];
                }
                
                broadcastTournamentEvent($pdo, $room['id'], 'battle_ended', [
                    'winner_id' => $winnerId,
                    'winner_name' => $winnerName,
                    'loser_id' => $loserId,
                    'loser_name' => $loserName,
                    'is_tiebreaker' => $isTiebreaker ?? false,
                    'is_npc_battle' => $isNpcBattle,
                    'winner_is_npc' => $winnerIsNpc,
                    'npc_dialogue' => $npcDialogue
                ]);
                
            } else {
                // Defender needs to select a new Pokemon
                $needsSelection = true;
                $battleState[$defenderActiveKey] = null;
                
                // If defender is NPC, auto-select next Pokemon
                if ($defenderIsNpc) {
                    $npcNextPokemon = npcSelectPokemon($battleState);
                    if ($npcNextPokemon !== null) {
                        $battleState['player2_active'] = $npcNextPokemon;
                        $newNpcPokemon = $battleState['player2_team'][$npcNextPokemon];
                        
                        // NPC selects immediately, continue battle
                        $needsSelection = false;
                        $battleState['phase'] = 'battle';
                        
                        // Recalculate speed for turn order
                        $playerPokemon = $battleState['player1_team'][$battleState['player1_active']];
                        if ($playerPokemon['base_speed'] >= $newNpcPokemon['base_speed']) {
                            $battleState['current_turn'] = 'player1';
                        } else {
                            $battleState['current_turn'] = 'player2';
                        }
                        
                        broadcastTournamentEvent($pdo, $room['id'], 'battle_pokemon_sent', [
                            'player_id' => 'npc_gym_leader',
                            'player_name' => $battleState['npc_data']['name'] ?? 'Líder de Ginásio',
                            'pokemon_name' => $newNpcPokemon['name'],
                            'pokemon_sprite' => $newNpcPokemon['sprite_url'],
                            'is_player1' => false,
                            'team_index' => $npcNextPokemon,
                            'first_turn' => $battleState['current_turn'],
                            'is_npc' => true
                        ]);
                    }
                } else {
                    // Human player needs to select
                    $battleState['phase'] = 'selection';
                    $battleState['waiting_for'] = $isPlayer1Turn ? 'player2' : 'player1';
                    
                    broadcastTournamentEvent($pdo, $room['id'], 'battle_pokemon_fainted', [
                        'fainted_pokemon' => $defender['name'],
                        'player_id' => $defenderPlayerId,
                        'player_name' => $defenderName,
                        'needs_selection' => true,
                        'is_npc' => false
                    ]);
                }
            }
        } else {
            // Switch turns
            $battleState['current_turn'] = $isPlayer1Turn ? 'player2' : 'player1';
            $battleState['turn_number']++;
        }
        
        // Save state
        updateTournamentState($pdo, $room['id'], $tournamentData);
        
        echo json_encode([
            'success' => true,
            'damage' => $damage,
            'type_multiplier' => $typeMultiplier,
            'defender_hp' => $defender['current_hp'],
            'defender_fainted' => $defenderFainted,
            'battle_ended' => $battleEnded,
            'needs_selection' => $needsSelection,
            'winner_id' => $winnerId,
            'next_turn' => $battleState['current_turn'] ?? null,
            'phase' => $battleState['phase']
        ]);
        break;
    
    case 'select_replacement':
        // Player selects replacement Pokemon after one faints
        $roomCode = $requestData['room_code'] ?? '';
        $playerId = $requestData['player_id'] ?? '';
        $teamIndex = intval($requestData['team_index'] ?? 0);
        
        if (!$roomCode || !$playerId) {
            echo json_encode(['success' => false, 'error' => 'Missing parameters']);
            exit;
        }
        
        $room = getRoomByCode($pdo, $roomCode);
        if (!$room) {
            echo json_encode(['success' => false, 'error' => 'Room not found']);
            exit;
        }
        
        $tournamentData = getTournamentState($pdo, $room['id']);
        if (!$tournamentData || !isset($tournamentData['battle_state'])) {
            echo json_encode(['success' => false, 'error' => 'No active battle']);
            exit;
        }
        
        $battleState = &$tournamentData['battle_state'];
        
        // Verify this player needs to select
        $isPlayer1 = ($playerId == $battleState['player1_id']);
        $isPlayer2 = ($playerId == $battleState['player2_id']);
        
        if (!$isPlayer1 && !$isPlayer2) {
            echo json_encode(['success' => false, 'error' => 'Not a participant']);
            exit;
        }
        
        $teamKey = $isPlayer1 ? 'player1_team' : 'player2_team';
        $activeKey = $isPlayer1 ? 'player1_active' : 'player2_active';
        
        // Verify they need to select (their active is null)
        if ($battleState[$activeKey] !== null) {
            echo json_encode(['success' => false, 'error' => 'You already have an active Pokemon']);
            exit;
        }
        
        // Validate selection
        if ($teamIndex < 0 || $teamIndex >= count($battleState[$teamKey])) {
            echo json_encode(['success' => false, 'error' => 'Invalid selection']);
            exit;
        }
        
        if ($battleState[$teamKey][$teamIndex]['is_fainted']) {
            echo json_encode(['success' => false, 'error' => 'Cannot select fainted Pokemon']);
            exit;
        }
        
        // Set new active Pokemon
        $battleState[$activeKey] = $teamIndex;
        $newPokemon = $battleState[$teamKey][$teamIndex];
        
        // Get the opponent's active Pokemon to determine turn order
        $opponentActiveKey = $isPlayer1 ? 'player2_active' : 'player1_active';
        $opponentTeamKey = $isPlayer1 ? 'player2_team' : 'player1_team';
        $opponentPokemon = $battleState[$opponentTeamKey][$battleState[$opponentActiveKey]];
        
        // Recalculate speed - opponent attacks first if faster
        if ($opponentPokemon['base_speed'] >= $newPokemon['base_speed']) {
            $battleState['current_turn'] = $isPlayer1 ? 'player2' : 'player1';
        } else {
            $battleState['current_turn'] = $isPlayer1 ? 'player1' : 'player2';
        }
        
        // Return to battle phase
        $battleState['phase'] = 'battle';
        unset($battleState['waiting_for']);
        
        // Get player info
        $player = getPlayerById($pdo, $playerId);
        
        // Broadcast
        broadcastTournamentEvent($pdo, $room['id'], 'battle_pokemon_sent', [
            'player_id' => $playerId,
            'player_name' => $player['player_name'],
            'pokemon_name' => $newPokemon['name'],
            'pokemon_sprite' => $newPokemon['sprite_url'],
            'is_player1' => $isPlayer1,
            'team_index' => $teamIndex,
            'first_turn' => $battleState['current_turn']
        ]);
        
        // Save state
        updateTournamentState($pdo, $room['id'], $tournamentData);
        
        echo json_encode([
            'success' => true,
            'message' => "Go, {$newPokemon['name']}!",
            'phase' => 'battle',
            'current_turn' => $battleState['current_turn']
        ]);
        break;
        
    default:
        echo json_encode(['success' => false, 'error' => 'Unknown action: ' . $action]);
        break;
}

