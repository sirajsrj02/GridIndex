'use strict';

const { Router } = require('express');
const { requireJwt } = require('../../middleware/auth');
const { getUsageSummary, getTopEndpoints } = require('../../db/queries/usage');

const router = Router();

// All dashboard routes require JWT auth
router.use(requireJwt);

/**
 * GET /api/dashboard/usage?days=30
 * Daily usage breakdown for the authenticated customer.
 */
router.get('/usage', async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 90);
  try {
    const [daily, topEndpoints] = await Promise.all([
      getUsageSummary(req.customer.id, days),
      getTopEndpoints(req.customer.id, days)
    ]);

    const totalCalls = daily.reduce((sum, d) => sum + parseInt(d.calls), 0);

    res.json({
      success: true,
      data: {
        summary: {
          calls_this_month: req.customer.calls_this_month,
          monthly_limit: req.customer.monthly_limit,
          calls_remaining: Math.max(0, req.customer.monthly_limit - req.customer.calls_this_month),
          calls_all_time: req.customer.calls_all_time,
          plan: req.customer.plan
        },
        daily,
        top_endpoints: topEndpoints,
        total_in_period: totalCalls,
        period_days: days
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch usage data', code: 'DB_ERROR' });
  }
});

/**
 * GET /api/dashboard/profile
 * Customer profile and plan details.
 */
router.get('/profile', (req, res) => {
  const c = req.customer;
  res.json({
    success: true,
    data: {
      id: c.id,
      email: c.email,
      company_name: c.company_name,
      full_name: c.full_name,
      plan: c.plan,
      api_key: c.api_key,
      api_key_created_at: c.api_key_created_at,
      allowed_regions: c.allowed_regions,
      monthly_limit: c.monthly_limit,
      history_days_allowed: c.history_days_allowed,
      calls_this_month: c.calls_this_month,
      calls_all_time: c.calls_all_time,
      last_seen_at: c.last_seen_at,
      created_at: c.created_at
    }
  });
});

module.exports = router;
