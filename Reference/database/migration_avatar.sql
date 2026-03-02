-- Migration: Add avatar_id to accounts table
-- Run this on your database to add persistent avatar selection to accounts

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS avatar_id INT DEFAULT 1 AFTER account_code;
