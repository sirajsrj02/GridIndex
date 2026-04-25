'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { testConnection } = require('../src/config/database');
const { query } = require('../src/config/database');
const logger = require('../src/config/logger');

async function main() {
  console.log('Testing database connection...');
  try {
    const info = await testConnection();
    console.log(`Connected to database: ${info.db} at ${info.now}`);

    const { rows } = await query('SELECT COUNT(*) AS count FROM regions');
    const countRow = rows[0];
    if (!countRow || countRow.count === undefined) {
      console.error('Unexpected query result — COUNT(*) returned no rows');
      process.exit(1);
    }
    console.log(`\nSELECT COUNT(*) FROM regions => ${countRow.count}`);

    if (parseInt(countRow.count) >= 8) {
      console.log('\n✓ Phase 1 complete — database has 8+ regions');
    } else {
      console.log(`\n⚠ Only ${countRow.count} regions found — run migrations first`);
      console.log('  node src/db/migrate.js');
    }
  } catch (err) {
    console.error('Connection failed:', err.message);
    if (err.message.includes('ENOTFOUND') || err.message.includes('connect')) {
      console.error('\nCheck your DATABASE_URL in .env');
    }
    process.exit(1);
  }
}

main();
