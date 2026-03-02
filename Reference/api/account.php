<?php
/**
 * PokeFodase v2.0 - Account API
 * Handles account creation, login, and profile management
 * Account system: nickname + 8-digit code (no password)
 */

require_once __DIR__ . '/../config.php';

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
        case 'create':
            createAccount();
            break;
        case 'login':
            loginAccount();
            break;
        case 'restore_session':
            restoreSession();
            break;
        case 'profile':
            getProfile();
            break;
        case 'leaderboard':
            getLeaderboard();
            break;
        case 'history':
            getMatchHistory();
            break;
        default:
            jsonResponse(['error' => 'Invalid action'], 400);
    }
} catch (Exception $e) {
    jsonResponse(['error' => 'Server error: ' . $e->getMessage()], 500);
}

/**
 * Create a new account with nickname + generated 8-digit code
 */
function createAccount() {
    $db = getDB();

    $nickname = trim($_POST['nickname'] ?? '');
    if (empty($nickname) || strlen($nickname) < 2 || strlen($nickname) > 50) {
        jsonResponse(['error' => 'Nickname must be 2-50 characters'], 400);
    }

    $avatarId = intval($_POST['avatar_id'] ?? 1);
    if ($avatarId < 1 || $avatarId > 10) $avatarId = 1;

    // Generate unique 8-digit code
    $attempts = 0;
    do {
        $code = generateAccountCode();
        $stmt = $db->prepare("SELECT id FROM accounts WHERE account_code = ?");
        $stmt->execute([$code]);
        $attempts++;
    } while ($stmt->fetch() && $attempts < 100);

    if ($attempts >= 100) {
        jsonResponse(['error' => 'Failed to generate unique code'], 500);
    }

    $stmt = $db->prepare("
        INSERT INTO accounts (nickname, account_code, avatar_id, elo, games_played, games_won, gold)
        VALUES (?, ?, ?, ?, 0, 0, 0)
    ");
    $stmt->execute([$nickname, $code, $avatarId, ELO_STARTING]);
    $accountId = $db->lastInsertId();

    // Store in session
    $_SESSION['account_id'] = $accountId;
    $_SESSION['account_code'] = $code;
    $_SESSION['account_nickname'] = $nickname;

    jsonResponse([
        'success' => true,
        'account' => [
            'id' => $accountId,
            'nickname' => $nickname,
            'code' => $code,
            'avatar_id' => $avatarId,
            'elo' => ELO_STARTING,
            'gold' => 0,
            'games_played' => 0,
            'games_won' => 0
        ],
        'message' => "Account created! Your login code is: $code. Save it!"
    ]);
}

/**
 * Login with nickname + 8-digit code
 */
function loginAccount() {
    $db = getDB();

    $nickname = trim($_POST['nickname'] ?? '');
    $code = trim($_POST['code'] ?? '');

    if (empty($nickname) || empty($code)) {
        jsonResponse(['error' => 'Nickname and code are required'], 400);
    }

    if (strlen($code) !== 8 || !ctype_digit($code)) {
        jsonResponse(['error' => 'Code must be exactly 8 digits'], 400);
    }

    $stmt = $db->prepare("
        SELECT * FROM accounts WHERE nickname = ? AND account_code = ?
    ");
    $stmt->execute([$nickname, $code]);
    $account = $stmt->fetch();

    if (!$account) {
        jsonResponse(['error' => 'Invalid nickname or code'], 401);
    }

    // Update last login
    $stmt = $db->prepare("UPDATE accounts SET last_login = NOW() WHERE id = ?");
    $stmt->execute([$account['id']]);

    // Store in session
    $_SESSION['account_id'] = $account['id'];
    $_SESSION['account_code'] = $account['account_code'];
    $_SESSION['account_nickname'] = $account['nickname'];

    jsonResponse([
        'success' => true,
        'account' => [
            'id' => $account['id'],
            'nickname' => $account['nickname'],
            'code' => $account['account_code'],
            'avatar_id' => (int)($account['avatar_id'] ?? 1),
            'elo' => (int)$account['elo'],
            'gold' => (int)$account['gold'],
            'games_played' => (int)$account['games_played'],
            'games_won' => (int)$account['games_won']
        ]
    ]);
}

/**
 * Restore session from saved account data (called on page reload)
 * Validates account credentials, restores PHP session, and checks for active game
 */
function restoreSession() {
    $db = getDB();

    $accountId = intval($_POST['account_id'] ?? 0);
    $code = trim($_POST['code'] ?? '');

    if (!$accountId || empty($code)) {
        jsonResponse(['error' => 'Account ID and code are required'], 400);
    }

    // Validate account credentials
    $stmt = $db->prepare("SELECT * FROM accounts WHERE id = ? AND account_code = ?");
    $stmt->execute([$accountId, $code]);
    $account = $stmt->fetch();

    if (!$account) {
        jsonResponse(['error' => 'Invalid account credentials'], 401);
    }

    // Restore account session
    $_SESSION['account_id'] = $account['id'];
    $_SESSION['account_code'] = $account['account_code'];
    $_SESSION['account_nickname'] = $account['nickname'];

    // Build response with fresh account data
    $response = [
        'success' => true,
        'account' => [
            'id' => $account['id'],
            'nickname' => $account['nickname'],
            'code' => $account['account_code'],
            'avatar_id' => (int)($account['avatar_id'] ?? 1),
            'elo' => (int)$account['elo'],
            'gold' => (int)$account['gold'],
            'games_played' => (int)$account['games_played'],
            'games_won' => (int)$account['games_won']
        ],
        'active_game' => null
    ];

    // Check for an active game (room not finished) for this account
    $stmt = $db->prepare("
        SELECT p.id as player_id, p.player_number, p.is_host, p.room_id,
               r.room_code, r.game_state, r.game_mode
        FROM players p
        JOIN rooms r ON p.room_id = r.id
        WHERE p.account_id = ? AND r.game_state NOT IN ('finished')
        ORDER BY r.created_at DESC
        LIMIT 1
    ");
    $stmt->execute([$account['id']]);
    $activePlayer = $stmt->fetch();

    if ($activePlayer) {
        // Restore game session
        $_SESSION['player_id'] = $activePlayer['player_id'];
        $_SESSION['room_id'] = $activePlayer['room_id'];
        $_SESSION['room_code'] = $activePlayer['room_code'];

        // Update session_id on the player record so SSE/WS can identify them
        $stmt = $db->prepare("UPDATE players SET session_id = ? WHERE id = ?");
        $stmt->execute([session_id(), $activePlayer['player_id']]);

        $response['active_game'] = [
            'room_code' => $activePlayer['room_code'],
            'room_id' => $activePlayer['room_id'],
            'player_id' => $activePlayer['player_id'],
            'player_number' => (int)$activePlayer['player_number'],
            'is_host' => (bool)$activePlayer['is_host'],
            'game_state' => $activePlayer['game_state'],
            'game_mode' => $activePlayer['game_mode']
        ];
    }

    jsonResponse($response);
}

/**
 * Get account profile
 */
function getProfile() {
    $db = getDB();

    $accountId = $_GET['account_id'] ?? $_SESSION['account_id'] ?? null;
    if (!$accountId) {
        jsonResponse(['error' => 'Not logged in'], 401);
    }

    $stmt = $db->prepare("SELECT * FROM accounts WHERE id = ?");
    $stmt->execute([$accountId]);
    $account = $stmt->fetch();

    if (!$account) {
        jsonResponse(['error' => 'Account not found'], 404);
    }

    // Get rank position
    $stmt = $db->prepare("
        SELECT COUNT(*) + 1 as rank_position 
        FROM accounts 
        WHERE elo > ?
    ");
    $stmt->execute([$account['elo']]);
    $rankData = $stmt->fetch();

    // Get recent match history
    $stmt = $db->prepare("
        SELECT eh.*, r.room_code
        FROM elo_history eh
        LEFT JOIN rooms r ON eh.room_id = r.id
        WHERE eh.account_id = ?
        ORDER BY eh.created_at DESC
        LIMIT 10
    ");
    $stmt->execute([$accountId]);
    $history = $stmt->fetchAll();

    jsonResponse([
        'success' => true,
        'account' => [
            'id' => $account['id'],
            'nickname' => $account['nickname'],
            'avatar_id' => (int)($account['avatar_id'] ?? 1),
            'elo' => (int)$account['elo'],
            'gold' => (int)$account['gold'],
            'games_played' => (int)$account['games_played'],
            'games_won' => (int)$account['games_won'],
            'rank_position' => (int)$rankData['rank_position'],
            'win_rate' => $account['games_played'] > 0 
                ? round(($account['games_won'] / $account['games_played']) * 100, 1) 
                : 0
        ],
        'history' => $history
    ]);
}

/**
 * Get global leaderboard
 */
function getLeaderboard() {
    $db = getDB();

    $limit = min(intval($_GET['limit'] ?? 50), 100);
    $offset = max(intval($_GET['offset'] ?? 0), 0);

    $stmt = $db->prepare("
        SELECT id, nickname, elo, games_played, games_won, gold
        FROM accounts
        WHERE games_played > 0
        ORDER BY elo DESC
        LIMIT ? OFFSET ?
    ");
    $stmt->execute([$limit, $offset]);
    $leaderboard = $stmt->fetchAll();

    // Add rank numbers
    foreach ($leaderboard as $i => &$entry) {
        $entry['rank'] = $offset + $i + 1;
        $entry['win_rate'] = $entry['games_played'] > 0 
            ? round(($entry['games_won'] / $entry['games_played']) * 100, 1) 
            : 0;
    }

    $stmt = $db->prepare("SELECT COUNT(*) as total FROM accounts WHERE games_played > 0");
    $stmt->execute();
    $total = $stmt->fetch()['total'];

    jsonResponse([
        'success' => true,
        'leaderboard' => $leaderboard,
        'total' => (int)$total,
        'limit' => $limit,
        'offset' => $offset
    ]);
}

/**
 * Get match history for an account
 */
function getMatchHistory() {
    $db = getDB();

    $accountId = $_GET['account_id'] ?? $_SESSION['account_id'] ?? null;
    if (!$accountId) {
        jsonResponse(['error' => 'Not logged in'], 401);
    }

    $stmt = $db->prepare("
        SELECT gp.placement, gp.gold_earned, gp.elo_change, gp.created_at,
               r.room_code, r.game_mode
        FROM game_placements gp
        JOIN rooms r ON gp.room_id = r.id
        WHERE gp.account_id = ?
        ORDER BY gp.created_at DESC
        LIMIT 20
    ");
    $stmt->execute([$accountId]);
    $history = $stmt->fetchAll();

    jsonResponse([
        'success' => true,
        'history' => $history
    ]);
}
