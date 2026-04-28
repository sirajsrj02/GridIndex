'use strict';

const { Router } = require('express');
const { requireApiKey } = require('../../middleware/auth');
const { apiRateLimiter } = require('../../middleware/rateLimit');
const { usageLogger } = require('../../middleware/usageLogger');

const regionsRouter  = require('./regions');
const pricesRouter   = require('./prices');
const fuelMixRouter  = require('./fuelMix');
const carbonRouter   = require('./carbon');
const weatherRouter  = require('./weather');
const forecastRouter = require('./forecast');
const healthRouter   = require('./health');
const alertsRouter   = require('./alerts');

const router = Router();

// Health is public — no API key required
router.use('/sources/health', healthRouter);

// All other v1 routes require a valid API key, per-minute burst limit, + usage logging
router.use(requireApiKey, apiRateLimiter, usageLogger);

router.use('/regions',   regionsRouter);
router.use('/prices',    pricesRouter);
router.use('/fuel-mix',  fuelMixRouter);
router.use('/carbon',    carbonRouter);
router.use('/weather',   weatherRouter);
router.use('/forecast',  forecastRouter);
router.use('/alerts',    alertsRouter);

// Catch-all for unknown v1 routes
router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Unknown endpoint: ${req.method} /api/v1${req.path}`,
    code: 'NOT_FOUND'
  });
});

module.exports = router;
