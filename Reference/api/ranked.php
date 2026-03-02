<?php
/**
 * PokeFodase v2.0 - Ranked Queue API
 * Handles ranked matchmaking queue (4-player solo queue)
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
        case 'join_queue':
            joinQueue();
            break;
        case 'leave_queue':
            leaveQueue();
            break;
        case 'check_queue':
            checkQueue();
            break;
        case 'finalize_game':
            finalizeRankedGame();
            break;
        default:
            jsonResponse(['error' => 'Invalid action'], 400);
    }
} catch (Exception $e) {
    jsonResponse(['error' => 'Server error: ' . $e->getMessage()], 500);
}

/**
 * Join the ranked queue
 */
function joinQueue() {
    $db = getDB();

    $accountId = $_SESSION['account_id'] ?? null;
    if (!$accountId) {
        jsonResponse(['error' => 'Must be logged in to play ranked'], 401);
    }

    // Clean up stale queue entries older than 10 minutes
    $stmt = $db->prepare("
        DELETE FROM ranked_queue 
        WHERE status = 'waiting' AND queued_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)
    ");
    $stmt->execute();

    // Also clean up old cancelled/matched entries to prevent unique key conflicts
    $stmt = $db->prepare("
        DELETE FROM ranked_queue 
        WHERE status IN ('cancelled', 'matched') AND queued_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)
    ");
    $stmt->execute();

    // Check if already in queue - if so, treat as a rejoin
    $stmt = $db->prepare("
        SELECT id FROM ranked_queue 
        WHERE account_id = ? AND status = 'waiting'
    ");
    $stmt->execute([$accountId]);
    $existingEntry = $stmt->fetch();

    if (!$existingEntry) {
        // Check if already in an active game
        $stmt = $db->prepare("
            SELECT p.id as player_id, p.player_number, p.is_host,
                   r.id as room_id, r.room_code, r.game_state, r.game_mode
            FROM players p
            JOIN rooms r ON p.room_id = r.id
            WHERE p.account_id = ? AND r.game_state NOT IN ('finished', 'lobby')
        ");
        $stmt->execute([$accountId]);
        $activeGame = $stmt->fetch();
        if ($activeGame) {
            // Restore their session so they can reconnect
            $_SESSION['player_id'] = $activeGame['player_id'];
            $_SESSION['room_id'] = $activeGame['room_id'];
            $_SESSION['room_code'] = $activeGame['room_code'];
            
            jsonResponse([
                'success' => false,
                'error' => 'Already in an active game',
                'active_game' => [
                    'room_code' => $activeGame['room_code'],
                    'room_id' => $activeGame['room_id'],
                    'player_id' => $activeGame['player_id'],
                    'player_number' => (int)$activeGame['player_number'],
                    'is_host' => (bool)$activeGame['is_host'],
                    'game_state' => $activeGame['game_state'],
                    'game_mode' => $activeGame['game_mode']
                ]
            ], 400);
        }

        // Add to queue
        $stmt = $db->prepare("
            INSERT INTO ranked_queue (account_id, status) VALUES (?, 'waiting')
        ");
        $stmt->execute([$accountId]);
    } else {
        // Refresh the timestamp so it doesn't get cleaned up
        $stmt = $db->prepare("
            UPDATE ranked_queue SET queued_at = NOW() WHERE id = ?
        ");
        $stmt->execute([$existingEntry['id']]);
    }

    // Check if we have enough players waiting
    $stmt = $db->prepare("
        SELECT rq.id, rq.account_id, a.nickname
        FROM ranked_queue rq
        JOIN accounts a ON rq.account_id = a.id
        WHERE rq.status = 'waiting'
        ORDER BY rq.queued_at ASC
        LIMIT " . RANKED_PLAYERS . "
    ");
    $stmt->execute();
    $waitingPlayers = $stmt->fetchAll();

    if (count($waitingPlayers) >= RANKED_PLAYERS) {
        // We have enough players! Create ranked game
        $result = createRankedGame($db, $waitingPlayers);
        
        // Find the current player's record in the new room and set their session
        $stmt = $db->prepare("
            SELECT id, player_number FROM players 
            WHERE account_id = ? AND room_id = ?
        ");
        $stmt->execute([$accountId, $result['room_id']]);
        $myPlayer = $stmt->fetch();
        
        if ($myPlayer) {
            $_SESSION['player_id'] = $myPlayer['id'];
            $_SESSION['room_id'] = $result['room_id'];
            $_SESSION['room_code'] = $result['room_code'];
        }
        
        jsonResponse([
            'success' => true,
            'status' => 'matched',
            'room_code' => $result['room_code'],
            'room_id' => $result['room_id'],
            'player_id' => $myPlayer['id'] ?? null,
            'player_number' => $myPlayer['player_number'] ?? null,
            'message' => 'Match found! Game starting...'
        ]);
    } else {
        jsonResponse([
            'success' => true,
            'status' => 'waiting',
            'queue_position' => count($waitingPlayers),
            'total_needed' => RANKED_PLAYERS,
            'players_needed' => RANKED_PLAYERS - count($waitingPlayers),
            'message' => 'In queue. Waiting for ' . (RANKED_PLAYERS - count($waitingPlayers)) . ' more players...'
        ]);
    }
}

/**
 * Leave the ranked queue
 */
function leaveQueue() {
    $db = getDB();

    $accountId = $_SESSION['account_id'] ?? null;
    if (!$accountId) {
        jsonResponse(['error' => 'Not logged in'], 401);
    }

    $stmt = $db->prepare("
        DELETE FROM ranked_queue 
        WHERE account_id = ? AND status = 'waiting'
    ");
    $stmt->execute([$accountId]);

    jsonResponse(['success' => true, 'message' => 'Left queue']);
}

/**
 * Check queue status
 */
function checkQueue() {
    $db = getDB();

    $accountId = $_SESSION['account_id'] ?? null;
    if (!$accountId) {
        jsonResponse(['error' => 'Not logged in'], 401);
    }

    // Clean up stale queue entries older than 10 minutes
    $stmt = $db->prepare("
        DELETE FROM ranked_queue 
        WHERE status = 'waiting' AND queued_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)
    ");
    $stmt->execute();

    // Check if already matched
    $stmt = $db->prepare("
        SELECT rq.*, r.room_code
        FROM ranked_queue rq
        LEFT JOIN players p ON p.account_id = rq.account_id AND p.room_id = (
            SELECT MAX(r2.id) FROM rooms r2 
            JOIN players p2 ON p2.room_id = r2.id 
            WHERE p2.account_id = rq.account_id AND r2.game_mode = 'ranked'
        )
        LEFT JOIN rooms r ON p.room_id = r.id
        WHERE rq.account_id = ? AND rq.status IN ('waiting', 'matched')
        ORDER BY rq.queued_at DESC
        LIMIT 1
    ");
    $stmt->execute([$accountId]);
    $queueEntry = $stmt->fetch();

    if (!$queueEntry) {
        jsonResponse(['success' => true, 'status' => 'not_in_queue']);
        return;
    }

    if ($queueEntry['status'] === 'matched') {
        // Find the room they were matched into
        $stmt = $db->prepare("
            SELECT r.room_code, r.id as room_id, p.id as player_id, p.player_number
            FROM players p
            JOIN rooms r ON p.room_id = r.id
            WHERE p.account_id = ? AND r.game_mode = 'ranked' AND r.game_state != 'finished'
            ORDER BY r.created_at DESC
            LIMIT 1
        ");
        $stmt->execute([$accountId]);
        $match = $stmt->fetch();

        if ($match) {
            // Set session for this player
            $_SESSION['player_id'] = $match['player_id'];
            $_SESSION['room_id'] = $match['room_id'];
            $_SESSION['room_code'] = $match['room_code'];
            
            jsonResponse([
                'success' => true,
                'status' => 'matched',
                'room_code' => $match['room_code'],
                'room_id' => $match['room_id'],
                'player_id' => $match['player_id'],
                'player_number' => $match['player_number']
            ]);
        }
    }

    // Still waiting - check if enough players to create a match now
    $stmt = $db->prepare("
        SELECT rq.id, rq.account_id, a.nickname
        FROM ranked_queue rq
        JOIN accounts a ON rq.account_id = a.id
        WHERE rq.status = 'waiting'
        ORDER BY rq.queued_at ASC
        LIMIT " . RANKED_PLAYERS . "
    ");
    $stmt->execute();
    $waitingPlayers = $stmt->fetchAll();
    $count = count($waitingPlayers);

    if ($count >= RANKED_PLAYERS) {
        // Enough players gathered while polling! Create the match
        $result = createRankedGame($db, $waitingPlayers);
        
        // Check if this player is in the match
        $isInMatch = false;
        foreach ($waitingPlayers as $wp) {
            if ($wp['account_id'] == $accountId) {
                $isInMatch = true;
                break;
            }
        }
        
        if ($isInMatch) {
            // Find this player's data in the new room
            $stmt = $db->prepare("
                SELECT r.room_code, r.id as room_id, p.id as player_id, p.player_number
                FROM players p
                JOIN rooms r ON p.room_id = r.id
                WHERE p.account_id = ? AND r.id = ?
            ");
            $stmt->execute([$accountId, $result['room_id']]);
            $match = $stmt->fetch();
            
            if ($match) {
                // Set session for this player
                $_SESSION['player_id'] = $match['player_id'];
                $_SESSION['room_id'] = $match['room_id'];
                $_SESSION['room_code'] = $match['room_code'];
                
                jsonResponse([
                    'success' => true,
                    'status' => 'matched',
                    'room_code' => $match['room_code'],
                    'room_id' => $match['room_id'],
                    'player_id' => $match['player_id'],
                    'player_number' => $match['player_number']
                ]);
            }
        }
    }

    jsonResponse([
        'success' => true,
        'status' => 'waiting',
        'queue_position' => $count,
        'total_needed' => RANKED_PLAYERS,
        'players_needed' => max(0, RANKED_PLAYERS - $count)
    ]);
}

/**
 * Create a ranked game room with matched players
 */
function createRankedGame($db, $players) {
    // Generate room code
    $attempts = 0;
    do {
        $roomCode = generateRoomCode();
        $stmt = $db->prepare("SELECT id FROM rooms WHERE room_code = ?");
        $stmt->execute([$roomCode]);
        $attempts++;
    } while ($stmt->fetch() && $attempts < 10);

    // Create ranked room
    $stmt = $db->prepare("
        INSERT INTO rooms (room_code, game_mode, game_state, turn_timer, town_timer)
        VALUES (?, 'ranked', 'initial', ?, ?)
    ");
    $stmt->execute([$roomCode, TURN_TIMER_RANKED, TOWN_TIMER_RANKED]);
    $roomId = $db->lastInsertId();

    // Randomize player order
    $shuffled = $players;
    shuffle($shuffled);

    // Create players
    foreach ($shuffled as $i => $queuePlayer) {
        $stmt = $db->prepare("
            INSERT INTO players (account_id, room_id, player_number, player_name, avatar_id, is_host, session_id, ultra_balls)
            VALUES (?, ?, ?, ?, 1, ?, '', 1)
        ");
        $stmt->execute([
            $queuePlayer['account_id'],
            $roomId,
            $i,
            $queuePlayer['nickname'],
            $i === 0 ? 1 : 0 // First player is "host" for technical purposes
        ]);

        // Update queue status
        $stmt = $db->prepare("
            UPDATE ranked_queue SET status = 'matched' 
            WHERE id = ?
        ");
        $stmt->execute([$queuePlayer['id']]);
    }

    return [
        'room_code' => $roomCode,
        'room_id' => $roomId
    ];
}

/**
 * Finalize a ranked game - calculate ELO and gold rewards based on placements
 * Called when the final tournament determines all 8 placements
 */
function finalizeRankedGame() {
    $db = getDB();

    $roomId = $_POST['room_id'] ?? $_SESSION['room_id'] ?? null;
    if (!$roomId) {
        jsonResponse(['error' => 'Room not specified'], 400);
    }

    // Verify this is a ranked game
    $stmt = $db->prepare("SELECT * FROM rooms WHERE id = ? AND game_mode = 'ranked'");
    $stmt->execute([$roomId]);
    $room = $stmt->fetch();

    if (!$room) {
        jsonResponse(['error' => 'Not a ranked game'], 400);
    }

    // Check if already finalized
    $stmt = $db->prepare("SELECT COUNT(*) as count FROM game_placements WHERE room_id = ?");
    $stmt->execute([$roomId]);
    if ($stmt->fetch()['count'] > 0) {
        jsonResponse(['error' => 'Game already finalized'], 400);
    }

    // Get placements from POST data (array of {player_id, placement})
    $placements = json_decode($_POST['placements'] ?? '[]', true);
    if (empty($placements) || count($placements) !== RANKED_PLAYERS) {
        jsonResponse(['error' => 'Invalid placements data'], 400);
    }

    $results = [];

    foreach ($placements as $p) {
        $playerId = $p['player_id'];
        $placement = $p['placement'];

        // Get player's account
        $stmt = $db->prepare("SELECT account_id FROM players WHERE id = ?");
        $stmt->execute([$playerId]);
        $player = $stmt->fetch();

        if (!$player || !$player['account_id']) continue;

        $accountId = $player['account_id'];
        $eloChange = getEloChange($placement);
        $goldReward = getGoldReward($placement);

        // Get current ELO
        $stmt = $db->prepare("SELECT elo FROM accounts WHERE id = ?");
        $stmt->execute([$accountId]);
        $account = $stmt->fetch();
        $eloBefore = $account['elo'];
        $eloAfter = max(0, $eloBefore + $eloChange); // ELO can't go below 0

        // Update account
        $stmt = $db->prepare("
            UPDATE accounts SET 
                elo = ?,
                gold = gold + ?,
                games_played = games_played + 1,
                games_won = games_won + ?
            WHERE id = ?
        ");
        $stmt->execute([
            $eloAfter,
            $goldReward,
            $placement === 1 ? 1 : 0,
            $accountId
        ]);

        // Record ELO history
        $stmt = $db->prepare("
            INSERT INTO elo_history (account_id, room_id, placement, elo_before, elo_after, elo_change)
            VALUES (?, ?, ?, ?, ?, ?)
        ");
        $stmt->execute([$accountId, $roomId, $placement, $eloBefore, $eloAfter, $eloChange]);

        // Record game placement
        $stmt = $db->prepare("
            INSERT INTO game_placements (room_id, player_id, account_id, placement, gold_earned, elo_change)
            VALUES (?, ?, ?, ?, ?, ?)
        ");
        $stmt->execute([$roomId, $playerId, $accountId, $placement, $goldReward, $eloChange]);

        $results[] = [
            'player_id' => $playerId,
            'account_id' => $accountId,
            'placement' => $placement,
            'elo_before' => $eloBefore,
            'elo_after' => $eloAfter,
            'elo_change' => $eloChange,
            'gold_earned' => $goldReward
        ];
    }

    // Broadcast results
    $roomCode = $room['room_code'];
    broadcastEvent($roomId, 'ranked_results', ['placements' => $results]);

    jsonResponse([
        'success' => true,
        'results' => $results
    ]);
}
