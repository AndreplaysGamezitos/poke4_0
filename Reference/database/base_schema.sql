-- =====================================================
-- PokeFodase - Base Database Schema
-- Run this FIRST on a fresh install, BEFORE migration_v2.sql
-- =====================================================

-- =====================================================
-- 1. ROOMS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS `rooms` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `room_code` VARCHAR(10) NOT NULL UNIQUE,
  `game_state` ENUM('lobby', 'initial', 'catching', 'town', 'tournament', 'battle', 'finished') DEFAULT 'lobby',
  `current_route` INT(11) DEFAULT 1,
  `current_player_turn` INT(11) DEFAULT 0,
  `encounters_remaining` INT(11) DEFAULT 0,
  `wild_pokemon_id` INT(11) DEFAULT NULL,
  `game_data` TEXT DEFAULT NULL,
  `last_update` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_room_code` (`room_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 2. PLAYERS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS `players` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `room_id` INT(11) NOT NULL,
  `player_number` INT(11) NOT NULL DEFAULT 0,
  `player_name` VARCHAR(50) NOT NULL,
  `avatar_id` INT(11) DEFAULT 1,
  `money` INT(11) DEFAULT 0,
  `ultra_balls` INT(11) DEFAULT 1,
  `badges` INT(11) DEFAULT 0,
  `is_host` TINYINT(1) DEFAULT 0,
  `is_ready` TINYINT(1) DEFAULT 0,
  `has_mega_stone` TINYINT(1) DEFAULT 0,
  `session_id` VARCHAR(128) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_room` (`room_id`),
  CONSTRAINT `players_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 3. POKEMON DEX (all Pokemon data)
-- =====================================================

CREATE TABLE IF NOT EXISTS `pokemon_dex` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `pokedex_number` INT(11) NOT NULL DEFAULT 0,
  `name` VARCHAR(50) NOT NULL,
  `type_defense` VARCHAR(30) DEFAULT NULL,
  `type_attack` VARCHAR(30) DEFAULT NULL,
  `base_hp` INT(11) NOT NULL DEFAULT 50,
  `base_attack` INT(11) NOT NULL DEFAULT 50,
  `base_speed` INT(11) NOT NULL DEFAULT 50,
  `sprite_url` VARCHAR(255) DEFAULT NULL,
  `evolution_id` INT(11) DEFAULT NULL,
  `evolution_number` INT(11) DEFAULT 0,
  `has_mega` TINYINT(1) DEFAULT 0,
  `mega_evolution_id` INT(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pokedex` (`pokedex_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 4. PLAYER POKEMON (team members)
-- =====================================================

CREATE TABLE IF NOT EXISTS `player_pokemon` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `player_id` INT(11) NOT NULL,
  `pokemon_id` INT(11) NOT NULL,
  `current_hp` INT(11) NOT NULL DEFAULT 50,
  `current_exp` INT(11) DEFAULT 0,
  `is_active` TINYINT(1) DEFAULT 0,
  `is_mega` TINYINT(1) DEFAULT 0,
  `team_position` INT(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_player` (`player_id`),
  CONSTRAINT `player_pokemon_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`) ON DELETE CASCADE,
  CONSTRAINT `player_pokemon_pokemon` FOREIGN KEY (`pokemon_id`) REFERENCES `pokemon_dex` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 5. WILD POKEMON (spawned encounters)
-- =====================================================

CREATE TABLE IF NOT EXISTS `wild_pokemon` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `room_id` INT(11) NOT NULL,
  `pokemon_id` INT(11) NOT NULL,
  `current_hp` INT(11) NOT NULL DEFAULT 50,
  `max_hp` INT(11) NOT NULL DEFAULT 50,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_room_active` (`room_id`, `is_active`),
  CONSTRAINT `wild_pokemon_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE,
  CONSTRAINT `wild_pokemon_pokemon` FOREIGN KEY (`pokemon_id`) REFERENCES `pokemon_dex` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 6. ROUTES
-- =====================================================

CREATE TABLE IF NOT EXISTS `routes` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `route_number` INT(11) NOT NULL,
  `route_name` VARCHAR(100) NOT NULL,
  `background_url` VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_route_number` (`route_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert initial 8 routes (seed_data.sql populates these with real names/backgrounds)
-- Only needed if NOT using seed_data.sql:
-- INSERT INTO `routes` (`route_number`, `route_name`) VALUES
-- (1, 'Route 1'), (2, 'Route 2'), (3, 'Route 3'), (4, 'Route 4'),
-- (5, 'Route 5'), (6, 'Route 6'), (7, 'Route 7'), (8, 'Route 8');

-- =====================================================
-- 7. ROUTE POKEMON (which Pokemon appear on which route)
-- =====================================================

CREATE TABLE IF NOT EXISTS `route_pokemon` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `route_id` INT(11) NOT NULL,
  `pokemon_id` INT(11) NOT NULL,
  `encounter_rate` INT(11) DEFAULT 100,
  PRIMARY KEY (`id`),
  KEY `idx_route` (`route_id`),
  CONSTRAINT `route_pokemon_route` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `route_pokemon_pokemon` FOREIGN KEY (`pokemon_id`) REFERENCES `pokemon_dex` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 8. STARTER POKEMON (available as starters)
-- =====================================================

CREATE TABLE IF NOT EXISTS `starter_pokemon` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `pokemon_id` INT(11) NOT NULL,
  `priority` INT(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  CONSTRAINT `starter_pokemon_pokemon` FOREIGN KEY (`pokemon_id`) REFERENCES `pokemon_dex` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 9. GAME EVENTS (for SSE/WebSocket event history)
-- =====================================================

CREATE TABLE IF NOT EXISTS `game_events` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `room_id` INT(11) NOT NULL,
  `event_type` VARCHAR(50) NOT NULL,
  `event_data` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_room_events` (`room_id`, `id`),
  CONSTRAINT `game_events_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 10. TOWN ACTIONS (purchase/action log)
-- =====================================================

CREATE TABLE IF NOT EXISTS `town_actions` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `player_id` INT(11) NOT NULL,
  `room_id` INT(11) NOT NULL,
  `action_type` ENUM('sell', 'evo_soda', 'ultra_ball', 'mega_stone') NOT NULL,
  `target_pokemon_id` INT(11) DEFAULT NULL,
  `gold_spent` INT(11) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_player_actions` (`player_id`),
  CONSTRAINT `town_actions_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`) ON DELETE CASCADE,
  CONSTRAINT `town_actions_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- NEXT STEP: Run database/seed_data.sql to populate:
--   - pokemon_dex (291 Pokémon including Megas)
--   - routes (8 routes with names and backgrounds)
--   - starter_pokemon (9 starters)
-- Then run database/migration_v2.sql to upgrade to v2.0
-- =====================================================
