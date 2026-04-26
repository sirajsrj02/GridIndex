'use strict';

const { Router } = require('express');
const { query } = require('../../config/database');
const { requireRegionAccess } = require('../../middleware/auth');

const router = Router();

const VALID_REGIONS = ['CAISO','ERCOT','PJM','MISO','NYISO','ISONE','SPP','WECC'];

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
 * GET /api/v1/weather?region=CAISO&location=Los Angeles&forecast=false
 * Weather data for a region. Optionally filter by location name or forecast flag.
 */
router.get('/', requireRegionAccess, async (req, res) => {
  const start = Date.now();
  const { region, location, forecast } = req.query;

  if (!validateRegion(region, res)) return;

  const conditions = ['region_code = $1'];
  const params = [region];
  let idx = 2;

  if (location) {
    conditions.push(`location_name ILIKE $${idx++}`);
    params.push(`%${location}%`);
  }

  if (forecast === 'true') {
    conditions.push(`is_forecast = true`);
  } else if (forecast === 'false') {
    conditions.push(`is_forecast = false`);
  }

  // Default: last 24h of observed + next 24h of forecast
  conditions.push(`timestamp >= NOW() - INTERVAL '24 hours'`);
  conditions.push(`timestamp <= NOW() + INTERVAL '24 hours'`);

  try {
    const { rows } = await query(
      `SELECT region_code, location_name, latitude, longitude, timestamp,
              temperature_f, temperature_c, feels_like_f, humidity_pct,
              wind_speed_mph, wind_direction_degrees, wind_gusts_mph,
              cloud_cover_pct, precipitation_inches, solar_radiation_wm2,
              pressure_hpa, weather_code, cooling_degree_days, heating_degree_days,
              is_forecast, forecast_horizon_hours, source
       FROM weather_data
       WHERE ${conditions.join(' AND ')}
       ORDER BY location_name, timestamp ASC
       LIMIT 200`,
      params
    );

    res.locals.responseRows = rows.length;
    res.json({
      success: true,
      data: rows,
      meta: {
        region,
        location: location || 'all',
        count: rows.length,
        query_ms: Date.now() - start
      }
    });
  } catch (err) {
    res.locals.errorMessage = err.message;
    res.status(500).json({ success: false, error: 'Failed to fetch weather data', code: 'DB_ERROR' });
  }
});

module.exports = router;
