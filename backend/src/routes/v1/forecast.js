'use strict';

const { Router } = require('express');
const { requireRegionAccess } = require('../../middleware/auth');
const { getDayAheadPrices, getSTEOForecasts, getForecastWeather } = require('../../db/queries/forecasts');

const router = Router();

const VALID_REGIONS   = ['CAISO', 'ERCOT', 'PJM', 'MISO', 'NYISO', 'ISONE', 'SPP', 'WECC'];
const MAX_HORIZON_HRS = 8760;   // 1 year cap
const DEFAULT_HORIZON = 48;

function validateRegion(region, res) {
  if (!region) {
    res.status(400).json({ success: false, error: 'region query parameter is required', code: 'MISSING_REGION' });
    return false;
  }
  if (!VALID_REGIONS.includes(region)) {
    res.status(400).json({ success: false, error: `Invalid region. Valid options: ${VALID_REGIONS.join(', ')}`, code: 'INVALID_REGION' });
    return false;
  }
  return true;
}

/**
 * Summarise day-ahead price rows for the meta block.
 */
function summarisePrices(rows) {
  if (!rows.length) return null;
  const prices = rows.map(r => parseFloat(r.price_per_mwh ?? r.price_day_ahead_mwh)).filter(p => !isNaN(p));
  if (!prices.length) return null;
  return {
    avg_mwh:  parseFloat((prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(4)),
    min_mwh:  Math.min(...prices),
    max_mwh:  Math.max(...prices),
    count:    prices.length
  };
}

/**
 * GET /api/v1/forecast?region=CAISO&horizon=48
 *
 * Returns a three-layer forecast for the requested region:
 *
 *   1. day_ahead  — hourly day-ahead prices already stored in energy_prices
 *                   (most accurate short-term signal, 0–48 h)
 *
 *   2. load       — EIA regional demand forecast stored in price_forecasts
 *                   (0–168 h, region-specific MW figures)
 *
 *   3. steo       — EIA Short-Term Energy Outlook monthly retail price outlook
 *                   (national average, up to 18 months, ±15 % confidence band)
 *
 *   4. weather    — Open-Meteo forecast weather for the region's key locations
 *                   (temperature, wind, solar radiation — the main price drivers)
 *
 * Query parameters:
 *   region   — required, one of VALID_REGIONS
 *   horizon  — hours ahead to include in day-ahead and weather layers (default 48, max 8760)
 *   steo     — 'true'|'false'  include STEO monthly outlook (default true)
 */
router.get('/', requireRegionAccess, async (req, res) => {
  const queryStart = Date.now();
  const { region, steo = 'true' } = req.query;

  if (!validateRegion(region, res)) return;

  const horizonHours = Math.min(
    parseInt(req.query.horizon) || DEFAULT_HORIZON,
    MAX_HORIZON_HRS
  );
  const includeSTEO = steo !== 'false';

  try {
    // Run all queries in parallel for minimal latency
    const [dayAheadRows, weatherRows, steoRows] = await Promise.all([
      getDayAheadPrices(region, horizonHours),
      getForecastWeather(region, Math.min(horizonHours, 168)),  // weather only 7 days
      includeSTEO ? getSTEOForecasts(region, 18) : Promise.resolve([])
    ]);

    const summary = summarisePrices(dayAheadRows);

    res.locals.responseRows = dayAheadRows.length + weatherRows.length + steoRows.length;

    res.json({
      success: true,
      data: {
        region,
        horizon_hours: horizonHours,

        /**
         * day_ahead — hourly prices for the next `horizon_hours`.
         * These come from the ISO's own day-ahead market clearing process
         * and are the best available near-term price signal.
         * Note: will be empty if the region sources only real-time data (e.g. EIA-only regions).
         */
        day_ahead: {
          source:  'ISO day-ahead market',
          note:    'Prices cleared in the day-ahead market; most accurate 0–48 h signal.',
          count:   dayAheadRows.length,
          summary,
          prices:  dayAheadRows
        },

        /**
         * weather — forecast weather for region population centres.
         * Temperature, wind speed, and solar radiation are the three dominant
         * electricity demand drivers.  High temperature → AC load → price spikes.
         * Low wind/solar → more gas dispatch → higher marginal cost.
         */
        weather_forecast: {
          source: 'Open-Meteo',
          note:   'Up to 7-day hourly weather forecast for key population centres.',
          count:  weatherRows.length,
          data:   weatherRows
        },

        /**
         * steo — EIA Short-Term Energy Outlook monthly price outlook.
         * National US average retail price (cents/kWh → $/MWh).
         * Use as a macro directional signal, not a precise regional price.
         * Confidence bands are ±15 % (EIA-published margin of error).
         */
        steo_outlook: includeSTEO ? {
          source:   'EIA Short-Term Energy Outlook (STEO)',
          note:     'US national average retail electricity price outlook — not region-specific. Use as a macro directional signal.',
          unit:     '$/MWh',
          count:    steoRows.length,
          forecasts: steoRows
        } : null
      },
      meta: {
        region,
        horizon_hours:     horizonHours,
        generated_at:      new Date().toISOString(),
        data_sources:      ['ISO day-ahead', 'EIA_STEO', 'Open-Meteo'],
        steo_included:     includeSTEO,
        query_ms:          Date.now() - queryStart
      }
    });

  } catch (err) {
    res.locals.errorMessage = err.message;
    res.status(500).json({ success: false, error: 'Failed to fetch forecast data', code: 'DB_ERROR' });
  }
});

module.exports = router;
