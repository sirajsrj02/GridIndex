'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const logger = require('../config/logger').forJob('pollWeather');
const { clients, sleep } = require('../utils/httpClient');
const { upsertWeatherData } = require('../db/queries/weather');
const { markHealthSuccess, markHealthFailure } = require('../db/queries/health');

// One representative city per grid region for load-temperature correlation
const WEATHER_LOCATIONS = [
  { region: 'CAISO', name: 'Los Angeles',   lat: 34.0522,  lon: -118.2437 },
  { region: 'CAISO', name: 'San Francisco', lat: 37.7749,  lon: -122.4194 },
  { region: 'ERCOT', name: 'Houston',       lat: 29.7604,  lon:  -95.3698 },
  { region: 'ERCOT', name: 'Dallas',        lat: 32.7767,  lon:  -96.7970 },
  { region: 'PJM',   name: 'Philadelphia',  lat: 39.9526,  lon:  -75.1652 },
  { region: 'MISO',  name: 'Chicago',       lat: 41.8781,  lon:  -87.6298 },
  { region: 'MISO',  name: 'Minneapolis',   lat: 44.9778,  lon:  -93.2650 },
  { region: 'NYISO', name: 'New York',      lat: 40.7128,  lon:  -74.0060 },
  { region: 'ISONE', name: 'Boston',        lat: 42.3601,  lon:  -71.0589 },
  { region: 'SPP',   name: 'Oklahoma City', lat: 35.4676,  lon:  -97.5164 },
  { region: 'WECC',  name: 'Phoenix',       lat: 33.4484,  lon: -112.0740 },
  { region: 'WECC',  name: 'Denver',        lat: 39.7392,  lon: -104.9903 },
];

function celsiusToFahrenheit(c) {
  return c * 9 / 5 + 32;
}

function kmhToMph(kmh) {
  return kmh * 0.621371;
}

function mmToInches(mm) {
  return mm * 0.0393701;
}

function calcCDD(tempF) {
  return Math.max(0, (tempF - 65) / 24);
}

function calcHDD(tempF) {
  return Math.max(0, (65 - tempF) / 24);
}

async function pollLocation(location) {
  const { region, name, lat, lon } = location;

  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: [
      'temperature_2m', 'apparent_temperature', 'relativehumidity_2m',
      'windspeed_10m', 'windgusts_10m', 'winddirection_10m',
      'precipitation', 'cloudcover', 'shortwave_radiation',
      'surface_pressure', 'weathercode'
    ].join(','),
    past_days: 1,
    forecast_days: 1,
    timezone: 'UTC'
  });

  const response = await clients.openmeteo.get(`/forecast?${params}`);
  const hourly = response.data?.hourly;
  if (!hourly?.time?.length) return 0;

  const now = Date.now();
  let count = 0;

  for (let i = 0; i < hourly.time.length; i++) {
    const ts = new Date(`${hourly.time[i]}:00Z`);
    if (isNaN(ts.getTime())) continue;

    const tempC = hourly.temperature_2m?.[i] ?? null;
    const feelsC = hourly.apparent_temperature?.[i] ?? null;
    const tempF = tempC != null ? celsiusToFahrenheit(tempC) : null;
    const feelsF = feelsC != null ? celsiusToFahrenheit(feelsC) : null;

    const isForecast = ts.getTime() > now;
    const horizonHours = isForecast ? Math.round((ts.getTime() - now) / 3600000) : null;

    await upsertWeatherData({
      region_code: region,
      location_name: name,
      latitude: lat,
      longitude: lon,
      timestamp: ts,
      temperature_f: tempF != null ? parseFloat(tempF.toFixed(2)) : null,
      temperature_c: tempC != null ? parseFloat(tempC.toFixed(2)) : null,
      feels_like_f: feelsF != null ? parseFloat(feelsF.toFixed(2)) : null,
      humidity_pct: hourly.relativehumidity_2m?.[i] ?? null,
      wind_speed_mph: hourly.windspeed_10m?.[i] != null ? parseFloat(kmhToMph(hourly.windspeed_10m[i]).toFixed(2)) : null,
      wind_direction_degrees: hourly.winddirection_10m?.[i] ?? null,
      wind_gusts_mph: hourly.windgusts_10m?.[i] != null ? parseFloat(kmhToMph(hourly.windgusts_10m[i]).toFixed(2)) : null,
      cloud_cover_pct: hourly.cloudcover?.[i] ?? null,
      precipitation_inches: hourly.precipitation?.[i] != null ? parseFloat(mmToInches(hourly.precipitation[i]).toFixed(4)) : null,
      solar_radiation_wm2: hourly.shortwave_radiation?.[i] ?? null,
      pressure_hpa: hourly.surface_pressure?.[i] ?? null,
      weather_code: hourly.weathercode?.[i] ?? null,
      cooling_degree_days: tempF != null ? parseFloat(calcCDD(tempF).toFixed(4)) : null,
      heating_degree_days: tempF != null ? parseFloat(calcHDD(tempF).toFixed(4)) : null,
      is_forecast: isForecast,
      forecast_horizon_hours: horizonHours,
      source: 'OpenMeteo'
    });
    count++;
  }

  return count;
}

async function run() {
  const start = Date.now();
  logger.info('=== Weather poll starting ===');

  let totalRows = 0;
  let errors = 0;

  for (const location of WEATHER_LOCATIONS) {
    try {
      const count = await pollLocation(location);
      totalRows += count;
      logger.info(`Weather: ${location.name} (${location.region}) — ${count} rows`);
    } catch (err) {
      errors++;
      logger.error(`Weather poll failed: ${location.name}`, { error: err.message });
    }
    await sleep(200);
  }

  const elapsed = Date.now() - start;

  if (errors === 0) {
    try { await markHealthSuccess('OPENMETEO', elapsed); } catch (e) {
      logger.warn('Could not update OPENMETEO health', { error: e.message });
    }
  } else if (errors === WEATHER_LOCATIONS.length) {
    try { await markHealthFailure('OPENMETEO', `All ${errors} locations failed`); } catch (e) {
      logger.warn('Could not update OPENMETEO health', { error: e.message });
    }
  } else {
    try { await markHealthSuccess('OPENMETEO', elapsed); } catch (e) {
      logger.warn('Could not update OPENMETEO health', { error: e.message });
    }
  }

  logger.info(`=== Weather poll complete: ${totalRows} rows, ${errors} errors (${elapsed}ms) ===`);
  return { totalRows, errors };
}

if (require.main === module) {
  run()
    .then((r) => { console.log('Done:', JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
}

module.exports = { run, pollLocation };
