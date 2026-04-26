'use strict';

const { query } = require('../../config/database');

/**
 * Upsert a weather_data row.
 * Conflict key: (region_code, location_name, timestamp, is_forecast)
 */
async function upsertWeatherData(row) {
  return query(
    `INSERT INTO weather_data (
       region_code, location_name, latitude, longitude, timestamp,
       temperature_f, temperature_c, feels_like_f, humidity_pct,
       wind_speed_mph, wind_direction_degrees, wind_gusts_mph,
       cloud_cover_pct, precipitation_inches, solar_radiation_wm2,
       pressure_hpa, weather_code, cooling_degree_days, heating_degree_days,
       is_forecast, forecast_horizon_hours, source
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
     )
     ON CONFLICT (region_code, location_name, timestamp, is_forecast)
     DO UPDATE SET
       temperature_f          = EXCLUDED.temperature_f,
       temperature_c          = EXCLUDED.temperature_c,
       feels_like_f           = EXCLUDED.feels_like_f,
       humidity_pct           = EXCLUDED.humidity_pct,
       wind_speed_mph         = EXCLUDED.wind_speed_mph,
       wind_direction_degrees = EXCLUDED.wind_direction_degrees,
       wind_gusts_mph         = EXCLUDED.wind_gusts_mph,
       cloud_cover_pct        = EXCLUDED.cloud_cover_pct,
       precipitation_inches   = EXCLUDED.precipitation_inches,
       solar_radiation_wm2    = EXCLUDED.solar_radiation_wm2,
       pressure_hpa           = EXCLUDED.pressure_hpa,
       weather_code           = EXCLUDED.weather_code,
       cooling_degree_days    = EXCLUDED.cooling_degree_days,
       heating_degree_days    = EXCLUDED.heating_degree_days,
       source                 = EXCLUDED.source`,
    [
      row.region_code, row.location_name, row.latitude, row.longitude, row.timestamp,
      row.temperature_f, row.temperature_c, row.feels_like_f, row.humidity_pct,
      row.wind_speed_mph, row.wind_direction_degrees, row.wind_gusts_mph,
      row.cloud_cover_pct, row.precipitation_inches, row.solar_radiation_wm2,
      row.pressure_hpa, row.weather_code, row.cooling_degree_days, row.heating_degree_days,
      row.is_forecast, row.forecast_horizon_hours, row.source
    ]
  );
}

module.exports = { upsertWeatherData };
