-- =====================================================
-- Migration: Turn-based catching system
-- Each player gets 8 turns per route (not encounter-based)
-- =====================================================

-- Add turns_taken column to players table
ALTER TABLE `players` ADD COLUMN `turns_taken` INT(11) NOT NULL DEFAULT 0 AFTER `is_ready`;

-- encounters_remaining is kept in rooms for backward compat but no longer drives progression.
-- We keep it so old queries don't break, but it's now informational only.
