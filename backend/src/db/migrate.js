'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

// Fail immediately with a clear message if the DB URL is missing
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set. Create a .env file from .env.example first.');
  process.exit(1);
}

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function runMigrations() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // rejectUnauthorized:false required for Supabase pooler (self-signed cert on port 6543)
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();
  try {
    // Ensure migration tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const { rows: applied } = await client.query(
      'SELECT filename FROM schema_migrations ORDER BY filename'
    );
    const appliedSet = new Set(applied.map((r) => r.filename));

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`  SKIP  ${file} (already applied)`);
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`  RUN   ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        ran++;
        console.log(`  OK    ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  FAIL  ${file}: ${err.message}`);
        throw err;
      }
    }

    console.log(`\nMigrations complete. ${ran} file(s) applied.`);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
