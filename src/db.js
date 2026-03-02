/**
 * @module db
 * @description MySQL connection pool using mysql2/promise.
 * Every query goes through this pool — no singleton / manual open-close.
 */

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  database: process.env.DB_NAME || 'pokefodase',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  // Return rows as plain objects (not RowDataPacket)
  typeCast: true,
});

/**
 * Execute a single query from the pool.
 * @param {string} sql
 * @param {any[]}  [params]
 * @returns {Promise<[any[], any]>}
 */
async function query(sql, params) {
  return pool.execute(sql, params);
}

/**
 * Get a dedicated connection for transactions.
 * Caller MUST call conn.release() when done.
 * @returns {Promise<import('mysql2/promise').PoolConnection>}
 */
async function getConnection() {
  return pool.getConnection();
}

module.exports = { pool, query, getConnection };
