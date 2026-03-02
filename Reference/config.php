<?php
/**
 * PokeFodase v2.0 - Configuration File
 * Database and game settings
 */

// Start session first (before any output)
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

// Error reporting - enable display for debugging
error_reporting(E_ALL);
ini_set('display_errors', 1);
ini_set('log_errors', 1);

// Database Configuration
define('DB_HOST', 'localhost');
define('DB_NAME', 'pokefodase');
define('DB_USER', 'pokefodase_user');
define('DB_PASS', 'Andre159**');

// ===========================================
// GAME CONFIGURATION v2.0
// ===========================================

// Player limits
define('MAX_PLAYERS', 8);
define('MIN_PLAYERS', 2);
define('RANKED_PLAYERS', 4); // Ranked mode requires 4 for easier testing
define('MAX_TEAM_SIZE', 6);

// Route / Game structure
define('TOTAL_ROUTES', 5);       // 5 merged routes
define('RANKED_TOTAL_ROUTES', 4); // 4 routes in ranked mode
define('BADGES_TO_WIN', 5);       // 5 badges to win in casual mode
define('RANKED_BADGES_TO_WIN', 4); // 4 badges to win in ranked mode
define('EXP_TO_EVOLVE', 6);

// Catch phase: each player gets 8 turns per route
define('TURNS_PER_PLAYER', 8);

// Town phase
define('TOWN_INCOME', 3);
define('TOWN_TIMER_RANKED', 60);  // 60s timer in ranked mode
define('TOWN_TIMER_CASUAL', 0);   // No timer in casual

// Tournament (PvP) rewards
define('PVP_WIN_GOLD', 2);  // Gold per PvP win

// Timers (ranked mode)
define('TURN_TIMER_RANKED', 5);     // 5s per catch/attack turn
define('REPLACEMENT_TIMER', 5);     // 5s to pick replacement pokemon
define('TURN_TIMER_CASUAL', 0);     // No timer in casual

// Shop Prices
define('PRICE_EVO_SODA', 1);
define('PRICE_ULTRA_BALL', 3);
define('PRICE_MEGA_STONE', 5);
define('PRICE_HP_BOOST', 2);       // +10 HP bonus
define('PRICE_ATTACK_BOOST', 2);   // +10 Attack bonus
define('PRICE_SPEED_BOOST', 2);    // +10 Speed bonus
define('SELL_BASE_PRICE', 2);

// Stat item bonus values
define('HP_BOOST_VALUE', 10);      // +10 HP (applied to battle HP calc)
define('ATTACK_BOOST_VALUE', 10);  // +10 Attack (applied to damage calc)
define('SPEED_BOOST_VALUE', 10);   // +10 Speed (applied to speed comparison)

// Catch mechanics (HP-based catch rates defined in pokemon_dex.catch_rate)
// catch_rate is a percentage (15-40) stored per pokemon
// Roll: random(0,99) < catch_rate -> caught
define('FULL_TEAM_CATCH_REWARD', 2);

// ELO Configuration
define('ELO_STARTING', 0);
define('ELO_K_FACTOR', 32);

// ELO changes by placement in 4-player game:
// 1st: +25, 2nd: +10, 3rd: -10, 4th: -25
define('ELO_PLACEMENT_CHANGES', json_encode([
    1 => 25,
    2 => 10,
    3 => -10,
    4 => -25
]));

// Gold earned by placement (top 2 earn gold)
define('GOLD_PLACEMENT_REWARDS', json_encode([
    1 => 10,
    2 => 4,
    3 => 0,
    4 => 0
]));

// SSE Configuration
define('SSE_RETRY_MS', 1000);

// Database connection function
function getDB() {
    static $pdo = null;
    if ($pdo === null) {
        try {
            $pdo = new PDO(
                "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4",
                DB_USER,
                DB_PASS,
                [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES => false
                ]
            );
        } catch (PDOException $e) {
            http_response_code(500);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]);
            exit;
        }
    }
    return $pdo;
}

// Helper function to send JSON response
function jsonResponse($data, $statusCode = 200) {
    http_response_code($statusCode);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

// Helper function to generate unique room codes
function generateRoomCode($length = 6) {
    $characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    $code = '';
    for ($i = 0; $i < $length; $i++) {
        $code .= $characters[random_int(0, strlen($characters) - 1)];
    }
    return $code;
}

// Helper function to generate 8-digit account codes
function generateAccountCode() {
    return str_pad(random_int(0, 99999999), 8, '0', STR_PAD_LEFT);
}

/**
 * Calculate ELO change for a given placement
 */
function getEloChange($placement) {
    $changes = json_decode(ELO_PLACEMENT_CHANGES, true);
    return $changes[$placement] ?? 0;
}

/**
 * Calculate gold reward for a given placement
 */
function getGoldReward($placement) {
    $rewards = json_decode(GOLD_PLACEMENT_REWARDS, true);
    return $rewards[$placement] ?? 0;
}
?>
