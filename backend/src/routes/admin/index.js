'use strict';

/**
 * Admin API — /api/admin/*
 * Protected by JWT + is_admin flag.  Never exposed in the public API surface.
 *
 * Routes:
 *   GET  /api/admin/stats                    — aggregate platform stats
 *   GET  /api/admin/customers?page&limit&q   — paginated customer list
 *   GET  /api/admin/customers/:id            — single customer detail
 *   PATCH /api/admin/customers/:id           — update plan / limit / active
 */

const { Router } = require('express');
const { requireJwt } = require('../../middleware/auth');
const { query } = require('../../config/database');
const logger = require('../../config/logger').forJob('admin');

const router = Router();

// ── Admin guard ───────────────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  if (!req.customer?.is_admin) {
    return res.status(403).json({ success: false, error: 'Admin access required', code: 'FORBIDDEN' });
  }
  next();
}

// All admin routes require JWT + admin flag
router.use(requireJwt, requireAdmin);

// ── GET /api/admin/stats ─────────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  try {
    const { rows: [stats] } = await query(`
      SELECT
        COUNT(*)                                                   AS total_customers,
        COUNT(*) FILTER (WHERE is_active = true)                   AS active_customers,
        COUNT(*) FILTER (WHERE is_email_verified = true)           AS verified_customers,
        COUNT(*) FILTER (WHERE plan = 'starter')                   AS starter_count,
        COUNT(*) FILTER (WHERE plan IN ('developer','pro'))        AS pro_count,
        COUNT(*) FILTER (WHERE plan = 'enterprise')                AS enterprise_count,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS new_last_7d,
        SUM(calls_this_month)                                      AS total_calls_this_month,
        SUM(calls_all_time)                                        AS total_calls_all_time
      FROM api_customers
    `);

    const { rows: [callsToday] } = await query(`
      SELECT COUNT(*) AS calls_today
      FROM api_usage_logs
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    `);

    const { rows: [alertStats] } = await query(`
      SELECT
        COUNT(*)                                      AS total_alerts,
        COUNT(*) FILTER (WHERE is_active = true)      AS active_alerts,
        COUNT(*) FILTER (WHERE delivery_method = 'webhook') AS webhook_alerts
      FROM price_alerts
    `);

    res.json({
      success: true,
      data: {
        customers: {
          total:        parseInt(stats.total_customers),
          active:       parseInt(stats.active_customers),
          verified:     parseInt(stats.verified_customers),
          new_last_7d:  parseInt(stats.new_last_7d),
          by_plan: {
            starter:    parseInt(stats.starter_count),
            pro:        parseInt(stats.pro_count),
            enterprise: parseInt(stats.enterprise_count),
          }
        },
        calls: {
          today:       parseInt(callsToday.calls_today),
          this_month:  parseInt(stats.total_calls_this_month) || 0,
          all_time:    parseInt(stats.total_calls_all_time)   || 0,
        },
        alerts: {
          total:   parseInt(alertStats.total_alerts),
          active:  parseInt(alertStats.active_alerts),
          webhook: parseInt(alertStats.webhook_alerts),
        }
      }
    });
  } catch (err) {
    logger.error('Failed to fetch admin stats', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to fetch stats', code: 'DB_ERROR' });
  }
});

// ── GET /api/admin/customers ─────────────────────────────────────────────────

router.get('/customers', async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100);
  const q     = req.query.q?.trim() || '';
  const offset = (page - 1) * limit;

  try {
    // The main query has limit($1), offset($2), searchVal($3).
    // The count query only has searchVal($1) — separate clauses to keep param numbers consistent.
    const mainClause  = q ? `AND (email ILIKE $3 OR full_name ILIKE $3 OR company_name ILIKE $3)` : '';
    const countClause = q ? `AND (email ILIKE $1 OR full_name ILIKE $1 OR company_name ILIKE $1)` : '';
    const searchVal   = q ? `%${q}%` : null;

    const { rows: customers } = await query(
      `SELECT
         id, email, full_name, company_name, plan, api_key,
         calls_this_month, calls_last_month, calls_all_time,
         monthly_limit, is_active, is_email_verified, is_admin,
         last_seen_at, created_at
       FROM api_customers
       WHERE 1=1 ${mainClause}
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      q ? [limit, offset, searchVal] : [limit, offset]
    );

    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM api_customers WHERE 1=1 ${countClause}`,
      q ? [searchVal] : []
    );

    res.json({
      success: true,
      data: {
        customers,
        pagination: {
          page,
          limit,
          total:        parseInt(total),
          total_pages:  Math.ceil(parseInt(total) / limit),
          has_next:     page * limit < parseInt(total),
          has_prev:     page > 1,
        }
      }
    });
  } catch (err) {
    logger.error('Failed to list customers', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to list customers', code: 'DB_ERROR' });
  }
});

// ── GET /api/admin/customers/:id ─────────────────────────────────────────────

router.get('/customers/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID', code: 'INVALID_ID' });

  try {
    const { rows: [customer] } = await query(
      `SELECT
         id, email, full_name, company_name, plan, api_key,
         calls_this_month, calls_last_month, calls_all_time,
         monthly_limit, is_active, is_email_verified, is_admin,
         use_case, referral_source, allowed_regions,
         last_seen_at, created_at, api_key_created_at
       FROM api_customers WHERE id = $1`,
      [id]
    );
    if (!customer) return res.status(404).json({ success: false, error: 'Customer not found', code: 'NOT_FOUND' });

    // Recent usage logs (last 10)
    const { rows: recentLogs } = await query(
      `SELECT endpoint, method, response_status, response_time_ms, created_at
       FROM api_usage_logs
       WHERE customer_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [id]
    );

    // Alert count
    const { rows: [{ alert_count }] } = await query(
      `SELECT COUNT(*) AS alert_count FROM price_alerts WHERE customer_id = $1`,
      [id]
    );

    res.json({
      success: true,
      data: { customer, recent_logs: recentLogs, alert_count: parseInt(alert_count) }
    });
  } catch (err) {
    logger.error('Failed to fetch customer', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to fetch customer', code: 'DB_ERROR' });
  }
});

// ── PATCH /api/admin/customers/:id ───────────────────────────────────────────

const VALID_PLANS  = ['trial', 'starter', 'developer', 'pro', 'enterprise'];

router.patch('/customers/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID', code: 'INVALID_ID' });

  const allowed = ['plan', 'monthly_limit', 'is_active', 'is_admin', 'allowed_regions'];
  const sets    = [];
  const vals    = [];
  let   idx     = 1;

  for (const field of allowed) {
    if (req.body[field] === undefined) continue;

    if (field === 'plan' && !VALID_PLANS.includes(req.body.plan)) {
      return res.status(400).json({ success: false, error: `Invalid plan: ${req.body.plan}`, code: 'INVALID_PLAN' });
    }
    if (field === 'monthly_limit' && (isNaN(req.body.monthly_limit) || req.body.monthly_limit < 0)) {
      return res.status(400).json({ success: false, error: 'monthly_limit must be a non-negative integer', code: 'INVALID_LIMIT' });
    }

    sets.push(`${field} = $${idx++}`);
    vals.push(req.body[field]);
  }

  if (!sets.length) {
    return res.status(400).json({ success: false, error: 'No valid fields to update', code: 'NO_FIELDS' });
  }

  vals.push(id);
  try {
    const { rows: [updated] } = await query(
      `UPDATE api_customers
       SET ${sets.join(', ')}
       WHERE id = $${idx}
       RETURNING id, email, full_name, plan, monthly_limit, is_active, is_admin, allowed_regions`,
      vals
    );
    if (!updated) return res.status(404).json({ success: false, error: 'Customer not found', code: 'NOT_FOUND' });

    logger.info('Admin updated customer', { adminId: req.customer.id, targetId: id, changes: req.body });
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error('Failed to update customer', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to update customer', code: 'DB_ERROR' });
  }
});

module.exports = router;
