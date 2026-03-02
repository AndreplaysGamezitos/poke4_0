/**
 * @module middleware/authenticate
 * @description Express middleware — extracts Bearer token, verifies it,
 * attaches `req.account` from the database.
 */

const { verifyToken } = require('../auth');
const { query } = require('../db');

/**
 * Require a valid auth token on every request.
 * Sets `req.account` with the full account row.
 */
async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }

  const token = header.slice(7);
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
  }

  const [rows] = await query('SELECT * FROM accounts WHERE id = ?', [decoded.accountId]);
  if (rows.length === 0) {
    return res.status(401).json({ success: false, error: 'Account not found', code: 'INVALID_TOKEN' });
  }

  req.account = rows[0];
  next();
}

module.exports = authenticate;
