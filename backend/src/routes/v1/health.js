'use strict';

const { Router } = require('express');
const { query } = require('../../config/database');

const router = Router();

/**
 * GET /api/v1/sources/health
 * Data source health status. Public endpoint — no auth required.
 */
router.get('/', async (req, res) => {
  const start = Date.now();
  try {
    const { rows } = await query(
      `SELECT source_name, status, last_success_at, last_attempt_at,
              consecutive_failures, avg_response_time_ms, total_calls_today, last_error
       FROM data_source_health
       ORDER BY source_name`
    );

    const overallHealthy = rows.every(r => r.status !== 'down');

    res.json({
      success: true,
      overall: overallHealthy ? 'healthy' : 'degraded',
      sources: rows,
      meta: { count: rows.length, query_ms: Date.now() - start }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch health data', code: 'DB_ERROR' });
  }
});

module.exports = router;
