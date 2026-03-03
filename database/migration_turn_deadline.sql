-- Migration: Add turn_deadline column to rooms for server-authoritative timers
-- The column stores a Unix epoch timestamp (milliseconds) of when the current turn expires.
-- All clients calculate remaining time from this value, so timers are perfectly synced.
-- Run on VPS: mysql -u root -p pokefodase < /var/www/pokefodase/database/migration_turn_deadline.sql

ALTER TABLE rooms ADD COLUMN turn_deadline BIGINT DEFAULT NULL AFTER starter_pool;
