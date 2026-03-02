/**
 * @module auth
 * @description JWT token generation and verification for PokeFodase.
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_EXPIRY = '30d';

/**
 * Generate a JWT for the given account.
 * @param {{ id: number, nickname: string, account_code: string }} account
 * @returns {string}
 */
function generateToken(account) {
  return jwt.sign(
    {
      accountId: account.id,
      nickname: account.nickname,
      code: account.account_code,
    },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

/**
 * Verify and decode a JWT.
 * @param {string} token
 * @returns {{ accountId: number, nickname: string, code: string } | null}
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

module.exports = { generateToken, verifyToken };
