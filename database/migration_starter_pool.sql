-- Migration: Add starter_pool column to rooms for storing the randomly selected starters per game
-- Run on VPS: mysql -u root -p pokefodase < /var/www/pokefodase/database/migration_starter_pool.sql

ALTER TABLE rooms ADD COLUMN starter_pool TEXT DEFAULT NULL AFTER current_match_index;
