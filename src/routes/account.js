/**
 * @module routes/account
 * @description Account creation and login endpoints.
 * These are the only unauthenticated endpoints.
 */

const express = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const { generateToken } = require('../auth');
const validate = require('../middleware/validate');

const router = express.Router();

/**
 * POST /api/account/create
 * Create a new account with a unique 8-char code.
 */
router.post(
  '/create',
  validate({
    nickname: { type: 'string', required: true, min: 1, max: 50 },
    avatar_id: { type: 'number', required: false, min: 1, max: 20 },
  }),
  async (req, res) => {
    try {
      const { nickname, avatar_id = 1 } = req.body;

      // Generate unique account code (8 uppercase alphanumeric chars)
      let accountCode;
      let attempts = 0;
      while (attempts < 10) {
        accountCode = crypto.randomBytes(4).toString('hex').toUpperCase();
        const [existing] = await query('SELECT id FROM accounts WHERE account_code = ?', [accountCode]);
        if (existing.length === 0) break;
        attempts++;
      }
      if (attempts >= 10) {
        return res.status(500).json({ success: false, error: 'Failed to generate unique code', code: 'INTERNAL_ERROR' });
      }

      // Insert account
      const [result] = await query(
        'INSERT INTO accounts (nickname, account_code, avatar_id) VALUES (?, ?, ?)',
        [nickname.trim(), accountCode, avatar_id]
      );

      const account = {
        id: result.insertId,
        nickname: nickname.trim(),
        code: accountCode,
        avatar_id,
        elo: 0,
        gold: 0,
        games_played: 0,
        games_won: 0,
      };

      // Generate JWT
      const token = generateToken({ id: account.id, nickname: account.nickname, account_code: account.code });

      // Store token hash in DB for reference
      await query('UPDATE accounts SET auth_token = ? WHERE id = ?', [token, account.id]);

      res.json({ success: true, token, account });
    } catch (err) {
      console.error('Account create error:', err);
      res.status(500).json({ success: false, error: 'Failed to create account', code: 'INTERNAL_ERROR' });
    }
  }
);

/**
 * POST /api/account/login
 * Login with nickname + account_code.
 */
router.post(
  '/login',
  validate({
    nickname: { type: 'string', required: true, min: 1, max: 50 },
    account_code: { type: 'string', required: true, min: 8, max: 8 },
  }),
  async (req, res) => {
    try {
      const { nickname, account_code } = req.body;

      const [rows] = await query(
        'SELECT * FROM accounts WHERE nickname = ? AND account_code = ?',
        [nickname.trim(), account_code.toUpperCase()]
      );

      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Account not found', code: 'INVALID_TOKEN' });
      }

      const acct = rows[0];

      // Generate new token
      const token = generateToken({ id: acct.id, nickname: acct.nickname, account_code: acct.account_code });

      // Update stored token + last_login
      await query('UPDATE accounts SET auth_token = ?, last_login = NOW() WHERE id = ?', [token, acct.id]);

      res.json({
        success: true,
        token,
        account: {
          id: acct.id,
          nickname: acct.nickname,
          code: acct.account_code,
          avatar_id: acct.avatar_id,
          elo: acct.elo,
          gold: acct.gold,
          games_played: acct.games_played,
          games_won: acct.games_won,
        },
      });
    } catch (err) {
      console.error('Account login error:', err);
      res.status(500).json({ success: false, error: 'Login failed', code: 'INTERNAL_ERROR' });
    }
  }
);

module.exports = router;
