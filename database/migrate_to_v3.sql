-- =====================================================
-- PokeFodase v3.0 — Migration from v2.0
-- Run on VPS: mysql -u root -p pokefodase < database/migrate_to_v3.sql
-- =====================================================
-- Your seed data (pokemon_dex, routes, starters) is already correct.
-- This only adds the missing columns and new tables for v3.0.
-- =====================================================

USE pokefodase;

SELECT '=== STARTING v3.0 MIGRATION ===' AS '';

-- =====================================================
-- 1. accounts: Add auth_token column for JWT auth
-- =====================================================
SELECT '1. Adding accounts.auth_token...' AS '';
ALTER TABLE `accounts`
  ADD COLUMN `auth_token` VARCHAR(256) DEFAULT NULL AFTER `account_code`,
  ADD INDEX `idx_auth_token` (`auth_token`);

-- =====================================================
-- 2. rooms: Add missing columns
-- =====================================================
SELECT '2. Adding rooms columns (current_match_index, winner_player_id, updated_at)...' AS '';
ALTER TABLE `rooms`
  ADD COLUMN `current_match_index` INT DEFAULT NULL AFTER `encounters_remaining`,
  ADD COLUMN `winner_player_id` INT DEFAULT NULL,
  ADD COLUMN `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- =====================================================
-- 3. players: Rename has_mega_stone → has_used_mega_stone
-- =====================================================
SELECT '3. Renaming players.has_mega_stone → has_used_mega_stone...' AS '';
ALTER TABLE `players`
  CHANGE COLUMN `has_mega_stone` `has_used_mega_stone` TINYINT(1) DEFAULT 0;

-- =====================================================
-- 4. CREATE tournament_matches (replaces JSON blob in game_data)
-- =====================================================
SELECT '4. Creating tournament_matches table...' AS '';
CREATE TABLE IF NOT EXISTS `tournament_matches` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `room_id` INT NOT NULL,
  `match_index` INT NOT NULL,
  `round_number` INT DEFAULT 1,
  `player1_id` INT DEFAULT NULL,
  `player2_id` INT DEFAULT NULL,
  `is_npc_battle` TINYINT(1) DEFAULT 0,
  `npc_route` INT DEFAULT NULL,
  `winner_id` INT DEFAULT NULL,
  `winner_is_npc` TINYINT(1) DEFAULT 0,
  `status` ENUM('pending','in_progress','completed') DEFAULT 'pending',
  `is_tiebreaker` TINYINT(1) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_room_status` (`room_id`, `status`),
  CONSTRAINT `tm_room` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE,
  CONSTRAINT `tm_player1` FOREIGN KEY (`player1_id`) REFERENCES `players`(`id`) ON DELETE SET NULL,
  CONSTRAINT `tm_player2` FOREIGN KEY (`player2_id`) REFERENCES `players`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 5. CREATE battle_state (normalized battle tracking)
-- =====================================================
SELECT '5. Creating battle_state table...' AS '';
CREATE TABLE IF NOT EXISTS `battle_state` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `match_id` INT NOT NULL UNIQUE,
  `room_id` INT NOT NULL,
  `phase` ENUM('selection','combat','finished') DEFAULT 'selection',
  `current_turn` ENUM('player1','player2') DEFAULT NULL,
  `turn_number` INT DEFAULT 0,
  `player1_active_index` INT DEFAULT NULL,
  `player2_active_index` INT DEFAULT NULL,
  `player1_has_selected` TINYINT(1) DEFAULT 0,
  `player2_has_selected` TINYINT(1) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `bs_match` FOREIGN KEY (`match_id`) REFERENCES `tournament_matches`(`id`) ON DELETE CASCADE,
  CONSTRAINT `bs_room` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 6. CREATE battle_pokemon (snapshot of team per battle)
-- =====================================================
SELECT '6. Creating battle_pokemon table...' AS '';
CREATE TABLE IF NOT EXISTS `battle_pokemon` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `battle_id` INT NOT NULL,
  `player_side` ENUM('player1','player2') NOT NULL,
  `team_index` INT NOT NULL,
  `pokemon_id` INT NOT NULL,
  `max_hp` INT NOT NULL,
  `current_hp` INT NOT NULL,
  `attack` INT NOT NULL,
  `speed` INT NOT NULL,
  `type_attack` VARCHAR(30) NOT NULL,
  `type_defense` VARCHAR(30) NOT NULL,
  `name` VARCHAR(50) NOT NULL,
  `sprite_url` VARCHAR(255) DEFAULT NULL,
  `is_fainted` TINYINT(1) DEFAULT 0,
  INDEX `idx_battle` (`battle_id`),
  CONSTRAINT `bp_battle` FOREIGN KEY (`battle_id`) REFERENCES `battle_state`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 7. VERIFY MIGRATION
-- =====================================================
SELECT '' AS '';
SELECT '=== VERIFICATION ===' AS '';

SELECT 'accounts.auth_token' AS `check`, IF(COUNT(*) > 0, '✅ OK', '❌ FAILED') AS result
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'accounts' AND column_name = 'auth_token'
UNION ALL
SELECT 'rooms.current_match_index', IF(COUNT(*) > 0, '✅ OK', '❌ FAILED')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'rooms' AND column_name = 'current_match_index'
UNION ALL
SELECT 'rooms.winner_player_id', IF(COUNT(*) > 0, '✅ OK', '❌ FAILED')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'rooms' AND column_name = 'winner_player_id'
UNION ALL
SELECT 'rooms.updated_at', IF(COUNT(*) > 0, '✅ OK', '❌ FAILED')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'rooms' AND column_name = 'updated_at'
UNION ALL
SELECT 'players.has_used_mega_stone', IF(COUNT(*) > 0, '✅ OK', '❌ FAILED')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'players' AND column_name = 'has_used_mega_stone'
UNION ALL
SELECT 'tournament_matches table', IF(COUNT(*) > 0, '✅ OK', '❌ FAILED')
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'tournament_matches'
UNION ALL
SELECT 'battle_state table', IF(COUNT(*) > 0, '✅ OK', '❌ FAILED')
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'battle_state'
UNION ALL
SELECT 'battle_pokemon table', IF(COUNT(*) > 0, '✅ OK', '❌ FAILED')
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'battle_pokemon';

SELECT '' AS '';
SELECT '=== v3.0 MIGRATION COMPLETE ===' AS '';
SELECT 'Your seed data was already correct — no Pokémon/route/starter changes needed.' AS '';
SELECT 'All 8 fixes applied. Your database is now v3.0 compatible.' AS '';
