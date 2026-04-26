'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');

const logger = require('./src/config/logger');
const { testConnection } = require('./src/config/database');
const { globalLimiter } = require('./src/middleware/rateLimit');

const v1Router      = require('./src/routes/v1/index');
const authRouter    = require('./src/routes/auth/index');
const dashRouter    = require('./src/routes/dashboard/index');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security & parsing ────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// ── HTTP request logging (skip in test) ──────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) }
  }));
}

// ── Global IP rate limit ──────────────────────────────────────────────────────
app.use(globalLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/v1',        v1Router);
app.use('/api/auth',      authRouter);
app.use('/api/dashboard', dashRouter);

// Root health check — no auth, no rate limit
app.get('/', (req, res) => {
  res.json({
    name: 'GridIndex API',
    version: '1.0.0',
    status: 'ok',
    docs: 'https://gridindex.io/docs',
    endpoints: {
      health:   'GET /api/v1/sources/health',
      prices:   'GET /api/v1/prices/latest?region=CAISO',
      fuelMix:  'GET /api/v1/fuel-mix/latest?region=CAISO',
      carbon:   'GET /api/v1/carbon/latest?region=CAISO',
      weather:  'GET /api/v1/weather?region=CAISO',
      regions:  'GET /api/v1/regions',
      register: 'POST /api/auth/register',
      login:    'POST /api/auth/login'
    }
  });
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.path}`,
    code: 'NOT_FOUND'
  });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path });
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    code: 'INTERNAL_ERROR'
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');
  if (!process.env.EIA_API_KEY) throw new Error('EIA_API_KEY environment variable is required');

  await testConnection();

  app.listen(PORT, () => {
    logger.info(`GridIndex API listening on port ${PORT}`, { env: process.env.NODE_ENV || 'development' });
  });

  // Optionally start the data poller scheduler in the same process
  if (process.env.START_SCHEDULER === 'true') {
    logger.info('Starting job scheduler...');
    const scheduler = require('./src/jobs/index');
    await scheduler.runOnce();
    scheduler.start();
  }
}

if (require.main === module) {
  start().catch((err) => {
    logger.error('Failed to start server', { error: err.message });
    process.exit(1);
  });
}

module.exports = app; // export for supertest
