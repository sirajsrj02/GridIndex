'use strict';

const { Router } = require('express');
const { requireApiKey } = require('../../middleware/auth');
const { usageLogger } = require('../../middleware/usageLogger');

const regionsRouter  = require('./regions');
const pricesRouter   = require('./prices');
const fuelMixRouter  = require('./fuelMix');
const carbonRouter   = require('./carbon');
const weatherRouter  = require('./weather');
const healthRouter   = require('./health');

const router = Router();

// Health is public — no API key required
router.use('/sources/health', healthRouter);

// All other v1 routes require a valid API key + usage logging
router.use(requireApiKey, usageLogger);

router.use('/regions',   regionsRouter);
router.use('/prices',    pricesRouter);
router.use('/fuel-mix',  fuelMixRouter);
router.use('/carbon',    carbonRouter);
router.use('/weather',   weatherRouter);

// Catch-all for unknown v1 routes
router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Unknown endpoint: ${req.method} /api/v1${req.path}`,
    code: 'NOT_FOUND'
  });
});

module.exports = router;
