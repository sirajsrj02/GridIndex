'use strict';

/**
 * GET /api/v1/natural-gas/latest    — latest spot price per hub (or filtered by ?hub=)
 * GET /api/v1/natural-gas           — historical series (?hub=&start=&end=&limit=)
 *
 * Natural gas prices are a global commodity — no per-region access check is applied.
 * Any customer with a valid API key can query these endpoints.
 *
 * Data source: EIA monthly natural gas spot prices (Henry Hub and regional hubs).
 * Prices are stored in the natural_gas_prices table.
 * Units: price_per_mmbtu ($/MMBtu) and price_per_mcf ($/MCF)
 *
 * Why this matters: gas peaker plants are the marginal price-setter in most US grids.
 * When Henry Hub spikes, electricity prices follow within hours. ESG teams and energy
 * traders need this data alongside electricity prices to understand the full picture.
 */

const { Router } = require('express');
const { getLatestNaturalGasPrices, getNaturalGasPrices } = require('../../db/queries/prices');

const router = Router();

const MAX_LIMIT = 500;

// ── GET /api/v1/natural-gas/latest ───────────────────────────────────────────
// Returns the most recent price for each distinct hub.
// Optional ?hub= filter for partial hub name match (e.g. ?hub=henry+hub).

router.get('/latest', async (req, res) => {
  const start   = Date.now();
  const hubName = req.query.hub?.trim() || null;

  try {
    const rows = await getLatestNaturalGasPrices(hubName);

    if (!rows.length) {
      // No data yet — polling runs as part of pollEIA, which runs hourly.
      return res.status(404).json({
        success: false,
        error:   'No natural gas price data available yet. Data refreshes hourly.',
        code:    'NOT_FOUND'
      });
    }

    res.locals.responseRows = rows.length;
    res.json({
      success: true,
      count:   rows.length,
      data:    rows,
      meta: {
        hub_filter: hubName || null,
        note:       'Monthly EIA spot prices. price_per_mmbtu is the industry-standard unit.',
        query_ms:   Date.now() - start
      }
    });
  } catch (err) {
    res.locals.errorMessage = err.message;
    res.status(500).json({ success: false, error: 'Failed to fetch natural gas prices', code: 'DB_ERROR' });
  }
});

// ── GET /api/v1/natural-gas ───────────────────────────────────────────────────
// Historical natural gas price series.
// Query params:
//   hub    — partial hub name match (optional; omit to get all hubs)
//   start  — ISO 8601 start timestamp (optional)
//   end    — ISO 8601 end timestamp   (optional)
//   limit  — max rows, 1–500 (default 100)

router.get('/', async (req, res) => {
  const start   = Date.now();
  const hubName = req.query.hub?.trim() || null;
  const limit   = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), MAX_LIMIT);

  const startTs = req.query.start ? new Date(req.query.start) : null;
  const endTs   = req.query.end   ? new Date(req.query.end)   : null;

  if (startTs && isNaN(startTs.getTime())) {
    return res.status(400).json({ success: false, error: 'Invalid start date', code: 'INVALID_DATE' });
  }
  if (endTs && isNaN(endTs.getTime())) {
    return res.status(400).json({ success: false, error: 'Invalid end date', code: 'INVALID_DATE' });
  }

  try {
    const rows = await getNaturalGasPrices({
      hubName:  hubName   || undefined,
      start:    startTs   || undefined,
      end:      endTs     || undefined,
      limit
    });

    res.locals.responseRows = rows.length;
    res.json({
      success: true,
      count:   rows.length,
      data:    rows,
      meta: {
        hub_filter: hubName || null,
        limit,
        start:    startTs?.toISOString() || null,
        end:      endTs?.toISOString()   || null,
        note:     'Monthly EIA spot prices. price_per_mmbtu is the industry-standard unit.',
        query_ms: Date.now() - start
      }
    });
  } catch (err) {
    res.locals.errorMessage = err.message;
    res.status(500).json({ success: false, error: 'Failed to fetch natural gas prices', code: 'DB_ERROR' });
  }
});

module.exports = router;
