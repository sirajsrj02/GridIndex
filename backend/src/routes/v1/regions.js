'use strict';

const { Router } = require('express');
const { query } = require('../../config/database');

const router = Router();

/**
 * GET /api/v1/regions
 * List all active regions. No filtering needed — small static table.
 */
router.get('/', async (req, res) => {
  const start = Date.now();
  try {
    const { rows } = await query(
      `SELECT code, name, type, tier, timezone, states_covered, countries_covered,
              peak_demand_mw, latitude, longitude, data_source, update_frequency_minutes
       FROM regions
       WHERE is_active = true
       ORDER BY tier, code`
    );
    res.json({
      success: true,
      data: rows,
      meta: { count: rows.length, query_ms: Date.now() - start }
    });
  } catch (err) {
    res.locals.errorMessage = err.message;
    res.status(500).json({ success: false, error: 'Failed to fetch regions', code: 'DB_ERROR' });
  }
});

module.exports = router;
