-- =====================================================
-- PokeFodase v2.0 - Database Migration
-- Ranked Mode, Account System, Stat Items, New Routes
-- =====================================================
-- Run this AFTER backing up your existing database!
-- =====================================================

-- =====================================================
-- 1. ACCOUNT SYSTEM
-- =====================================================

CREATE TABLE IF NOT EXISTS `accounts` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `nickname` VARCHAR(50) NOT NULL,
  `account_code` CHAR(8) NOT NULL UNIQUE,
  `elo` INT(11) NOT NULL DEFAULT 0,
  `games_played` INT(11) NOT NULL DEFAULT 0,
  `games_won` INT(11) NOT NULL DEFAULT 0,
  `gold` INT(11) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `last_login` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_account_code` (`account_code`),
  KEY `idx_elo` (`elo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 2. ELO HISTORY TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS `elo_history` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `account_id` INT(11) NOT NULL,
  `room_id` INT(11) NOT NULL,
  `placement` INT(11) NOT NULL,
  `elo_before` INT(11) NOT NULL,
  `elo_after` INT(11) NOT NULL,
  `elo_change` INT(11) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_account_elo` (`account_id`),
  CONSTRAINT `elo_history_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 3. RANKED QUEUE TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS `ranked_queue` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `account_id` INT(11) NOT NULL,
  `queued_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `status` ENUM('waiting', 'matched', 'cancelled') DEFAULT 'waiting',
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_queue_account` (`account_id`, `status`),
  CONSTRAINT `ranked_queue_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 4. ADD account_id TO PLAYERS TABLE
-- =====================================================

ALTER TABLE `players`
  ADD COLUMN `account_id` INT(11) DEFAULT NULL AFTER `id`,
  ADD KEY `idx_account` (`account_id`);

-- =====================================================
-- 5. ADD ROOM MODE AND SETTINGS
-- =====================================================

ALTER TABLE `rooms`
  ADD COLUMN `game_mode` ENUM('casual', 'ranked') DEFAULT 'casual' AFTER `room_code`,
  ADD COLUMN `turn_timer` INT(11) DEFAULT 0 AFTER `game_data`,
  ADD COLUMN `town_timer` INT(11) DEFAULT 0 AFTER `turn_timer`;

-- =====================================================
-- 6. STAT ITEMS - ADD BONUS COLUMNS TO player_pokemon
-- =====================================================

ALTER TABLE `player_pokemon`
  ADD COLUMN `bonus_hp` INT(11) DEFAULT 0 AFTER `is_mega`,
  ADD COLUMN `bonus_attack` INT(11) DEFAULT 0 AFTER `bonus_hp`,
  ADD COLUMN `bonus_speed` INT(11) DEFAULT 0 AFTER `bonus_attack`;

-- =====================================================
-- 7. ADD catch_rate TO pokemon_dex
-- =====================================================

ALTER TABLE `pokemon_dex`
  ADD COLUMN `catch_rate` INT(11) DEFAULT 30 AFTER `mega_evolution_id`;

-- Update catch rates based on base_hp (15%-40%)
-- Formula: Higher HP = lower catch rate
-- HP <= 40 → 40%, HP 41-55 → 35%, HP 56-70 → 30%, HP 71-90 → 25%, HP 91-110 → 20%, HP > 110 → 15%
-- Only for stage 1 pokemon (evolution_number = 0, excluding megas/legendaries)

UPDATE `pokemon_dex` SET `catch_rate` = 40 WHERE `evolution_number` = 0 AND `base_hp` <= 40 AND `pokedex_number` > 0;
UPDATE `pokemon_dex` SET `catch_rate` = 35 WHERE `evolution_number` = 0 AND `base_hp` BETWEEN 41 AND 55 AND `pokedex_number` > 0;
UPDATE `pokemon_dex` SET `catch_rate` = 30 WHERE `evolution_number` = 0 AND `base_hp` BETWEEN 56 AND 70 AND `pokedex_number` > 0;
UPDATE `pokemon_dex` SET `catch_rate` = 25 WHERE `evolution_number` = 0 AND `base_hp` BETWEEN 71 AND 90 AND `pokedex_number` > 0;
UPDATE `pokemon_dex` SET `catch_rate` = 20 WHERE `evolution_number` = 0 AND `base_hp` BETWEEN 91 AND 110 AND `pokedex_number` > 0;
UPDATE `pokemon_dex` SET `catch_rate` = 15 WHERE `evolution_number` = 0 AND `base_hp` > 110 AND `pokedex_number` > 0;

-- Evolved/legendary pokemon keep default 30 (not directly catchable in wild)
-- Megas are not catchable
UPDATE `pokemon_dex` SET `catch_rate` = 0 WHERE `pokedex_number` < 0;

-- =====================================================
-- 8. TOWN ACTIONS - ADD NEW STAT ITEM TYPES
-- =====================================================

ALTER TABLE `town_actions`
  MODIFY COLUMN `action_type` ENUM(
    'sell', 'evo_soda', 'ultra_ball', 'mega_stone',
    'hp_boost', 'attack_boost', 'speed_boost'
  ) NOT NULL;

-- =====================================================
-- 9. FINAL PLACEMENT TABLE (for ranked games)
-- =====================================================

CREATE TABLE IF NOT EXISTS `game_placements` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `room_id` INT(11) NOT NULL,
  `player_id` INT(11) NOT NULL,
  `account_id` INT(11) DEFAULT NULL,
  `placement` INT(11) NOT NULL,
  `gold_earned` INT(11) DEFAULT 0,
  `elo_change` INT(11) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_room_placement` (`room_id`),
  CONSTRAINT `game_placements_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE,
  CONSTRAINT `game_placements_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 10. ROUTE MERGING: 8 routes → 5 routes
-- =====================================================
-- Plan:
--   New Route 1 = Old Route 1 (Early/Normal) - 19 pokemon → keep all
--   New Route 2 = Old Route 2 + some from R3 (Forest/Cave) - expanded
--   New Route 3 = Old Route 3 (remaining) + Old Route 4 (Water/Cave) - merged
--   New Route 4 = Old Route 5 + Old Route 6 (Fire/Safari) - merged
--   New Route 5 = Old Route 7 + Old Route 8 (High-level + Legendary) - final

-- First, update route table
DELETE FROM `routes` WHERE `route_number` > 5;

UPDATE `routes` SET `route_name` = 'Route 1 - Viridian Path' WHERE `route_number` = 1;
UPDATE `routes` SET `route_name` = 'Route 2 - Verdant Forest' WHERE `route_number` = 2;
UPDATE `routes` SET `route_name` = 'Route 3 - Crystal Caves' WHERE `route_number` = 3;
UPDATE `routes` SET `route_name` = 'Route 4 - Scorched Shores' WHERE `route_number` = 4;
UPDATE `routes` SET `route_name` = 'Route 5 - Apex Summit' WHERE `route_number` = 5;

-- Clear existing route_pokemon assignments
DELETE FROM `route_pokemon`;

-- =====================================================
-- NEW ROUTE 1 - Viridian Path (19 pokemon - early game variety)
-- Normal, Flying, Poison, Ground starters
-- =====================================================
INSERT INTO `route_pokemon` (`route_id`, `pokemon_id`, `encounter_rate`) VALUES
-- Original Route 1 pokemon
(1, 16, 100),  -- Pidgey (Flying)
(1, 19, 100),  -- Rattata (Normal)
(1, 21, 100),  -- Spearow (Flying)
(1, 23, 100),  -- Ekans (Poison)
(1, 27, 100),  -- Sandshrew (Ground)
(1, 29, 100),  -- Nidoran♀ (Poison)
(1, 32, 100),  -- Nidoran♂ (Poison)
(1, 52, 100),  -- Meowth (Normal)
(1, 56, 100),  -- Mankey (Fighting)
(1, 83, 100),  -- Farfetch'd (Normal/Flying)
(1, 84, 100),  -- Doduo (Normal/Flying)
(1, 161, 100), -- Sentret (Normal)
(1, 163, 100), -- Hoothoot (Normal/Flying)
(1, 179, 100), -- Mareep (Electric)
(1, 187, 100), -- Hoppip (Grass/Flying)
(1, 190, 100), -- Aipom (Normal)
(1, 209, 100), -- Snubbull (Fairy)
(1, 216, 100), -- Teddiursa (Normal)
(1, 234, 100), -- Stantler (Normal)
(1, 252, 100); -- Azurill (Normal)

-- =====================================================
-- NEW ROUTE 2 - Verdant Forest (20 pokemon - Bug/Grass/Poison)
-- Merges old Route 2 + some cave pokemon that fit thematically
-- =====================================================
INSERT INTO `route_pokemon` (`route_id`, `pokemon_id`, `encounter_rate`) VALUES
-- Original Route 2 (Bug/Grass) pokemon
(2, 10, 100),  -- Caterpie (Bug)
(2, 13, 100),  -- Weedle (Bug)
(2, 43, 100),  -- Oddish (Grass)
(2, 46, 100),  -- Paras (Bug/Grass)
(2, 48, 100),  -- Venonat (Bug)
(2, 69, 100),  -- Bellsprout (Grass)
(2, 102, 100), -- Exeggcute (Grass)
(2, 114, 100), -- Tangela (Grass)
(2, 123, 100), -- Scyther (Bug)
(2, 127, 100), -- Pinsir (Bug)
(2, 165, 100), -- Ledyba (Bug)
(2, 167, 100), -- Spinarak (Bug)
(2, 191, 100), -- Sunkern (Grass)
(2, 193, 100), -- Yanma (Bug)
(2, 198, 100), -- Murkrow (Dark)
(2, 204, 100), -- Pineco (Bug)
(2, 254, 100), -- Bonsly (Rock)
-- Additions from other routes for variety
(2, 41, 100),  -- Zubat (Poison/Flying) from R3
(2, 92, 100),  -- Gastly (Ghost) from R3
(2, 206, 100); -- Dunsparce (Normal) from R3

-- =====================================================
-- NEW ROUTE 3 - Crystal Caves (20 pokemon - Cave/Water/Ground)
-- Merges remaining old Route 3 + old Route 4
-- =====================================================
INSERT INTO `route_pokemon` (`route_id`, `pokemon_id`, `encounter_rate`) VALUES
-- Remaining from Route 3
(3, 50, 100),  -- Diglett (Ground)
(3, 66, 100),  -- Machop (Fighting)
(3, 74, 100),  -- Geodude (Rock)
(3, 95, 100),  -- Onix (Rock)
(3, 104, 100), -- Cubone (Ground)
(3, 111, 100), -- Rhyhorn (Ground)
(3, 207, 100), -- Gligar (Ground/Flying)
(3, 213, 100), -- Shuckle (Bug/Rock)
(3, 220, 100), -- Swinub (Ice/Ground)
(3, 231, 100), -- Phanpy (Ground)
(3, 253, 100), -- Wynaut (Psychic)
-- All of Route 4 (Water)
(3, 54, 100),  -- Psyduck (Water)
(3, 60, 100),  -- Poliwag (Water)
(3, 72, 100),  -- Tentacool (Water)
(3, 79, 100),  -- Slowpoke (Water)
(3, 86, 100),  -- Seel (Water)
(3, 90, 100),  -- Shellder (Water)
(3, 98, 100),  -- Krabby (Water)
(3, 116, 100), -- Horsea (Water)
(3, 118, 100), -- Goldeen (Water)
(3, 120, 100), -- Staryu (Water)
(3, 129, 100), -- Magikarp (Water)
(3, 170, 100), -- Chinchou (Water)
(3, 194, 100), -- Wooper (Water/Ground)
(3, 211, 100), -- Qwilfish (Water)
(3, 222, 100), -- Corsola (Water)
(3, 223, 100), -- Remoraid (Water)
(3, 258, 100); -- Mantyke (Water)

-- =====================================================
-- NEW ROUTE 4 - Scorched Shores (20 pokemon - Fire/Misc/Safari)
-- Merges old Route 5 + old Route 6
-- =====================================================
INSERT INTO `route_pokemon` (`route_id`, `pokemon_id`, `encounter_rate`) VALUES
-- All from Route 5 (Fire/Misc)
(4, 37, 100),  -- Vulpix (Fire)
(4, 58, 100),  -- Growlithe (Fire)
(4, 77, 100),  -- Ponyta (Fire)
(4, 88, 100),  -- Grimer (Poison)
(4, 109, 100), -- Koffing (Poison)
(4, 138, 100), -- Omanyte (Rock)
(4, 140, 100), -- Kabuto (Rock)
(4, 218, 100), -- Slugma (Fire)
(4, 225, 100), -- Delibird (Ice)
(4, 227, 100), -- Skarmory (Steel)
(4, 228, 100), -- Houndour (Dark)
(4, 239, 100), -- Elekid (Electric)
(4, 240, 100), -- Magby (Fire)
(4, 246, 100), -- Larvitar (Rock)
-- All from Route 6 (Safari)
(4, 108, 100), -- Lickitung (Normal)
(4, 115, 100), -- Kangaskhan (Normal)
(4, 128, 100), -- Tauros (Normal)
(4, 132, 100), -- Ditto (Normal)
(4, 147, 100), -- Dratini (Dragon)
(4, 172, 100), -- Pichu (Electric)
(4, 173, 100), -- Cleffa (Fairy)
(4, 174, 100), -- Igglybuff (Fairy)
(4, 177, 100), -- Natu (Psychic)
(4, 203, 100), -- Girafarig (Normal)
(4, 215, 100), -- Sneasel (Dark)
(4, 235, 100), -- Smeargle (Normal)
(4, 236, 100), -- Tyrogue (Fighting)
(4, 238, 100), -- Smoochum (Ice)
(4, 255, 100), -- Mime Jr. (Psychic)
(4, 256, 100), -- Happiny (Normal)
(4, 257, 100); -- Munchlax (Normal)

-- =====================================================
-- NEW ROUTE 5 - Apex Summit (22 pokemon - Endgame powerhouses)
-- Merges old Route 7 + old Route 8
-- =====================================================
INSERT INTO `route_pokemon` (`route_id`, `pokemon_id`, `encounter_rate`) VALUES
-- All from Route 7 (High-level)
(5, 63, 100),  -- Abra (Psychic)
(5, 81, 100),  -- Magnemite (Electric)
(5, 96, 100),  -- Drowzee (Psychic)
(5, 100, 100), -- Voltorb (Electric)
(5, 131, 100), -- Lapras (Water/Ice)
(5, 137, 100), -- Porygon (Normal)
(5, 142, 100), -- Aerodactyl (Rock)
(5, 200, 100), -- Misdreavus (Ghost)
(5, 201, 100), -- Unown (Psychic)
(5, 214, 100), -- Heracross (Bug)
(5, 241, 100), -- Miltank (Normal)
-- All from Route 8 (Legendaries)
(5, 144, 100), -- Articuno (Ice)
(5, 145, 100), -- Zapdos (Electric)
(5, 146, 100), -- Moltres (Fire)
(5, 150, 100), -- Mewtwo (Psychic)
(5, 151, 100), -- Mew (Psychic)
(5, 243, 100), -- Raikou (Electric)
(5, 244, 100), -- Entei (Fire)
(5, 245, 100), -- Suicune (Water)
(5, 249, 100), -- Lugia (Psychic)
(5, 250, 100), -- Ho-Oh (Fire)
(5, 251, 100); -- Celebi (Psychic)

-- =====================================================
-- 11. UPDATE CONFIG: Remove BADGES_TO_WIN concept
--     (Game now ends after 5 routes with final tournament)
-- =====================================================
-- This is handled in PHP config, not DB

-- =====================================================
-- VERIFICATION QUERIES (run after migration)
-- =====================================================
-- SELECT route_number, route_name, COUNT(rp.id) as pokemon_count
-- FROM routes r
-- LEFT JOIN route_pokemon rp ON r.id = rp.route_id
-- GROUP BY r.id
-- ORDER BY r.route_number;
--
-- SELECT COUNT(*) as total_accounts FROM accounts;
-- SELECT COUNT(DISTINCT pokemon_id) as unique_pokemon_in_routes FROM route_pokemon;
