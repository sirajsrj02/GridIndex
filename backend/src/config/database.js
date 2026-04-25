'use strict';

const { Pool } = require('pg');
const logger = require('./logger');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 20,               // max connections in pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      logger.error('Unexpected pg pool error', { error: err.message });
    });

    pool.on('connect', () => {
      logger.debug('New pg client connected');
    });
  }
  return pool;
}

/**
 * Execute a parameterized query. Returns the full pg QueryResult.
 * Usage: const { rows } = await query('SELECT $1::text', ['hello']);
 */
async function query(text, params) {
  const start = Date.now();
  const db = getPool();
  try {
    const result = await db.query(text, params);
    const duration = Date.now() - start;
    if (duration > 2000) {
      logger.warn('Slow query detected', { query: text.substring(0, 120), duration });
    }
    return result;
  } catch (err) {
    logger.error('Database query error', {
      query: text.substring(0, 120),
      error: err.message,
      code: err.code
    });
    throw err;
  }
}

/**
 * Execute multiple queries inside a single transaction.
 * Pass an async function that receives a client.
 * Usage: await transaction(async (client) => { await client.query(...) });
 */
async function transaction(fn) {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Simple connectivity check — used during startup and health checks.
 */
async function testConnection() {
  const { rows } = await query('SELECT NOW() AS now, current_database() AS db');
  return rows[0];
}

module.exports = { query, transaction, testConnection, getPool };
