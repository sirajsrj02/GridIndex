'use strict';

/**
 * Jest setup — runs before every test file, before any module is loaded.
 *
 * dotenv.config() does NOT override existing process.env values (default
 * behaviour since dotenv v6+), so values set here take precedence over any
 * .env file that the application loads at startup.
 */

process.env.NODE_ENV    = 'test';
process.env.JWT_SECRET  = 'test-jwt-secret-must-be-at-least-32-characters-long!';
process.env.EIA_API_KEY = 'test-eia-api-key';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/testdb';
process.env.LOG_LEVEL   = 'error';   // silence info/warn/http logs during tests
process.env.START_SCHEDULER = 'false'; // never start cron jobs in tests
