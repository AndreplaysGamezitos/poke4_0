-- =====================================================
-- PokeFodase v3.0 — Clean-Slate Database Schema
-- Run this FIRST, then run seed.sql
-- =====================================================

CREATE DATABASE IF NOT EXISTS pokefodase
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE pokefodase;

-- =====================================================
-- 1. ACCOUNTS (persistent player identity)
-- =====================================================
CREATE TABLE accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nickname VARCHAR(50) NOT NULL,
  account_code CHAR(8) NOT NULL UNIQUE,
  auth_token VARCHAR(256) DEFAULT NULL,
  avatar_id INT DEFAULT 1,
  elo INT DEFAULT 0,
  games_played INT DEFAULT 0,
  games_won INT DEFAULT 0,
  gold INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_auth_token (auth_token),
  INDEX idx_elo (elo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 2. ROOMS
-- =====================================================
CREATE TABLE rooms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_code VARCHAR(10) NOT NULL UNIQUE,
  game_mode ENUM('casual','ranked') DEFAULT 'casual',
  game_state ENUM('lobby','initial','catching','town','tournament','battle','finished') DEFAULT 'lobby',
  current_route INT DEFAULT 1,
  current_player_turn INT DEFAULT 0,
  encounters_remaining INT DEFAULT 0,
  current_match_index INT DEFAULT NULL,
  turn_timer INT DEFAULT 0,
  town_timer INT DEFAULT 0,
  winner_player_id INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_room_code (room_code),
  INDEX idx_game_state (game_state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 3. PLAYERS (per-game player instance)
-- =====================================================
CREATE TABLE players (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  account_id INT DEFAULT NULL,
  player_number INT NOT NULL DEFAULT 0,
  player_name VARCHAR(50) NOT NULL,
  avatar_id INT DEFAULT 1,
  money INT DEFAULT 0,
  ultra_balls INT DEFAULT 1,
  badges INT DEFAULT 0,
  is_host BOOLEAN DEFAULT FALSE,
  is_ready BOOLEAN DEFAULT FALSE,
  has_used_mega_stone BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
  INDEX idx_room (room_id),
  INDEX idx_account (account_id),
  UNIQUE KEY unique_room_player (room_id, player_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 4. POKEMON DEX (static game data)
-- =====================================================
CREATE TABLE pokemon_dex (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pokedex_number INT NOT NULL DEFAULT 0,
  name VARCHAR(50) NOT NULL,
  type_defense VARCHAR(30) DEFAULT NULL,
  type_attack VARCHAR(30) DEFAULT NULL,
  base_hp INT NOT NULL DEFAULT 50,
  base_attack INT NOT NULL DEFAULT 50,
  base_speed INT NOT NULL DEFAULT 50,
  sprite_url VARCHAR(255) DEFAULT NULL,
  evolution_id INT DEFAULT NULL,
  evolution_number INT DEFAULT 0,
  has_mega BOOLEAN DEFAULT FALSE,
  mega_evolution_id INT DEFAULT NULL,
  catch_rate INT DEFAULT 30,
  INDEX idx_pokedex (pokedex_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 5. PLAYER POKEMON (team members)
-- =====================================================
CREATE TABLE player_pokemon (
  id INT AUTO_INCREMENT PRIMARY KEY,
  player_id INT NOT NULL,
  pokemon_id INT NOT NULL,
  current_exp INT DEFAULT 0,
  is_active BOOLEAN DEFAULT FALSE,
  is_mega BOOLEAN DEFAULT FALSE,
  team_position INT DEFAULT 0,
  bonus_hp INT DEFAULT 0,
  bonus_attack INT DEFAULT 0,
  bonus_speed INT DEFAULT 0,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  FOREIGN KEY (pokemon_id) REFERENCES pokemon_dex(id),
  INDEX idx_player (player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 6. WILD POKEMON (active encounter in catching phase)
-- =====================================================
CREATE TABLE wild_pokemon (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  pokemon_id INT NOT NULL,
  current_hp INT NOT NULL,
  max_hp INT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (pokemon_id) REFERENCES pokemon_dex(id),
  INDEX idx_room_active (room_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 7. ROUTES (static game data)
-- =====================================================
CREATE TABLE routes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  route_number INT NOT NULL UNIQUE,
  route_name VARCHAR(100) NOT NULL,
  background_url VARCHAR(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 8. ROUTE POKEMON (which Pokémon appear on which route)
-- =====================================================
CREATE TABLE route_pokemon (
  id INT AUTO_INCREMENT PRIMARY KEY,
  route_id INT NOT NULL,
  pokemon_id INT NOT NULL,
  encounter_rate INT DEFAULT 100,
  FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
  FOREIGN KEY (pokemon_id) REFERENCES pokemon_dex(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 9. STARTER POKEMON
-- =====================================================
CREATE TABLE starter_pokemon (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pokemon_id INT NOT NULL,
  priority INT DEFAULT 0,
  FOREIGN KEY (pokemon_id) REFERENCES pokemon_dex(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 10. TOURNAMENT MATCHES (normalized)
-- =====================================================
CREATE TABLE tournament_matches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  match_index INT NOT NULL,
  round_number INT DEFAULT 1,
  player1_id INT DEFAULT NULL,
  player2_id INT DEFAULT NULL,
  is_npc_battle BOOLEAN DEFAULT FALSE,
  npc_route INT DEFAULT NULL,
  winner_id INT DEFAULT NULL,
  winner_is_npc BOOLEAN DEFAULT FALSE,
  status ENUM('pending','in_progress','completed') DEFAULT 'pending',
  is_tiebreaker BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (player1_id) REFERENCES players(id) ON DELETE SET NULL,
  FOREIGN KEY (player2_id) REFERENCES players(id) ON DELETE SET NULL,
  INDEX idx_room_status (room_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 11. BATTLE STATE (normalized)
-- =====================================================
CREATE TABLE battle_state (
  id INT AUTO_INCREMENT PRIMARY KEY,
  match_id INT NOT NULL UNIQUE,
  room_id INT NOT NULL,
  phase ENUM('selection','combat','finished') DEFAULT 'selection',
  current_turn ENUM('player1','player2') DEFAULT NULL,
  turn_number INT DEFAULT 0,
  player1_active_index INT DEFAULT NULL,
  player2_active_index INT DEFAULT NULL,
  player1_has_selected BOOLEAN DEFAULT FALSE,
  player2_has_selected BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (match_id) REFERENCES tournament_matches(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 12. BATTLE POKEMON (snapshot of team for a battle)
-- =====================================================
CREATE TABLE battle_pokemon (
  id INT AUTO_INCREMENT PRIMARY KEY,
  battle_id INT NOT NULL,
  player_side ENUM('player1','player2') NOT NULL,
  team_index INT NOT NULL,
  pokemon_id INT NOT NULL,
  max_hp INT NOT NULL,
  current_hp INT NOT NULL,
  attack INT NOT NULL,
  speed INT NOT NULL,
  type_attack VARCHAR(30) NOT NULL,
  type_defense VARCHAR(30) NOT NULL,
  name VARCHAR(50) NOT NULL,
  sprite_url VARCHAR(255) DEFAULT NULL,
  is_fainted BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (battle_id) REFERENCES battle_state(id) ON DELETE CASCADE,
  INDEX idx_battle (battle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 13. ELO HISTORY (for ranked mode)
-- =====================================================
CREATE TABLE elo_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NOT NULL,
  room_id INT NOT NULL,
  placement INT NOT NULL,
  elo_before INT NOT NULL,
  elo_after INT NOT NULL,
  elo_change INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 14. GAME PLACEMENTS (final results for ranked)
-- =====================================================
CREATE TABLE game_placements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  player_id INT NOT NULL,
  account_id INT DEFAULT NULL,
  placement INT NOT NULL,
  gold_earned INT DEFAULT 0,
  elo_change INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 15. ENCOUNTERED POKEMON (track spawns per catching phase)
-- =====================================================
CREATE TABLE encountered_pokemon (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  route_number INT NOT NULL,
  pokemon_id INT NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  INDEX idx_room_route (room_id, route_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
