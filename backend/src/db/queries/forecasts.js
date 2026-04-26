'use strict';

const { query, transaction } = require('../../config/database');

/**
 * Upsert a single row into price_forecasts.
 * On conflict (region + timestamp + source) we update the price fields so the
 * latest model run always wins.
 */
async function upsertPriceForecast(row) {
  return query(
    `INSERT INTO price_forecasts
       (region_code, forecast_for_timestamp, forecast_created_at,
        price_forecast_mwh, price_low_mwh, price_high_mwh,
        demand_forecast_mw, forecast_horizon_hours,
        model_version, forecast_source, confidence_score)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (region_code, forecast_for_timestamp, forecast_source)
     DO UPDATE SET
       price_forecast_mwh   = EXCLUDED.price_forecast_mwh,
       price_low_mwh        = EXCLUDED.price_low_mwh,
       price_high_mwh       = EXCLUDED.price_high_mwh,
       demand_forecast_mw   = EXCLUDED.demand_forecast_mw,
       forecast_horizon_hours = EXCLUDED.forecast_horizon_hours,
       confidence_score     = EXCLUDED.confidence_score,
       forecast_created_at  = EXCLUDED.forecast_created_at`,
    [
      row.regionCode,
      row.forecastForTimestamp,
      row.forecastCreatedAt,
      row.priceForecastMwh ?? null,
      row.priceLowMwh ?? null,
      row.priceHighMwh ?? null,
      row.demandForecastMw ?? null,
      row.forecastHorizonHours ?? null,
      row.modelVersion ?? 'v1',
      row.forecastSource,
      row.confidenceScore ?? null
    ]
  );
}

/**
 * Upsert many forecast rows in a single transaction.
 * Returns the number of rows processed.
 */
async function upsertManyForecasts(rows) {
  if (!rows.length) return 0;
  await transaction(async (client) => {
    for (const row of rows) {
      await client.query(
        `INSERT INTO price_forecasts
           (region_code, forecast_for_timestamp, forecast_created_at,
            price_forecast_mwh, price_low_mwh, price_high_mwh,
            demand_forecast_mw, forecast_horizon_hours,
            model_version, forecast_source, confidence_score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (region_code, forecast_for_timestamp, forecast_source)
         DO UPDATE SET
           price_forecast_mwh     = EXCLUDED.price_forecast_mwh,
           price_low_mwh          = EXCLUDED.price_low_mwh,
           price_high_mwh         = EXCLUDED.price_high_mwh,
           demand_forecast_mw     = EXCLUDED.demand_forecast_mw,
           forecast_horizon_hours = EXCLUDED.forecast_horizon_hours,
           confidence_score       = EXCLUDED.confidence_score,
           forecast_created_at    = EXCLUDED.forecast_created_at`,
        [
          row.regionCode,
          row.forecastForTimestamp,
          row.forecastCreatedAt,
          row.priceForecastMwh ?? null,
          row.priceLowMwh ?? null,
          row.priceHighMwh ?? null,
          row.demandForecastMw ?? null,
          row.forecastHorizonHours ?? null,
          row.modelVersion ?? 'v1',
          row.forecastSource,
          row.confidenceScore ?? null
        ]
      );
    }
  });
  return rows.length;
}

/**
 * Get day-ahead hourly prices for a region — these are stored in energy_prices
 * with price_type = 'day_ahead_hourly' and act as short-term forecasts.
 * Returns rows ordered by timestamp ASC for the next `horizonHours` hours.
 */
async function getDayAheadPrices(regionCode, horizonHours = 48) {
  const { rows } = await query(
    `SELECT region_code, timestamp, price_per_mwh, price_day_ahead_mwh,
            price_type, pricing_node, demand_mw, demand_forecast_mw,
            net_generation_mw, source
     FROM energy_prices
     WHERE region_code = $1
       AND price_type  = 'day_ahead_hourly'
       AND timestamp  >= NOW()
       AND timestamp  <= NOW() + ($2 || ' hours')::interval
     ORDER BY timestamp ASC
     LIMIT 200`,
    [regionCode, horizonHours]
  );
  return rows;
}

/**
 * Get EIA STEO monthly price forecasts for a region.
 * Returns rows ordered by forecast_for_timestamp ASC (nearest month first).
 */
async function getSTEOForecasts(regionCode, months = 18) {
  const { rows } = await query(
    `SELECT region_code, forecast_for_timestamp, forecast_created_at,
            price_forecast_mwh, price_low_mwh, price_high_mwh,
            demand_forecast_mw, forecast_horizon_hours,
            forecast_source, confidence_score
     FROM price_forecasts
     WHERE region_code    = $1
       AND forecast_source = 'EIA_STEO'
       AND forecast_for_timestamp >= DATE_TRUNC('month', NOW())
     ORDER BY forecast_for_timestamp ASC
     LIMIT $2`,
    [regionCode, months]
  );
  return rows;
}

/**
 * Get weather-based demand/price context for a region's forecast.
 * Returns the next `horizonHours` hours of forecast weather.
 */
async function getForecastWeather(regionCode, horizonHours = 48) {
  const { rows } = await query(
    `SELECT location_name, timestamp, temperature_f, temperature_c,
            wind_speed_mph, cloud_cover_pct, solar_radiation_wm2,
            cooling_degree_days, heating_degree_days,
            is_forecast, forecast_horizon_hours
     FROM weather_data
     WHERE region_code  = $1
       AND is_forecast  = true
       AND timestamp   >= NOW()
       AND timestamp   <= NOW() + ($2 || ' hours')::interval
     ORDER BY location_name, timestamp ASC
     LIMIT 500`,
    [regionCode, horizonHours]
  );
  return rows;
}

module.exports = {
  upsertPriceForecast,
  upsertManyForecasts,
  getDayAheadPrices,
  getSTEOForecasts,
  getForecastWeather
};
