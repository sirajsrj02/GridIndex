'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const logger = require('../config/logger').forJob('pollEIAForecast');
const { clients, sleep } = require('../utils/httpClient');
const { eiaParams, parseEIAPeriod } = require('../utils/eiaHelpers');
const { upsertManyForecasts } = require('../db/queries/forecasts');
const { markHealthSuccess, markHealthFailure } = require('../db/queries/health');

const EIA_KEY = process.env.EIA_API_KEY;
if (!EIA_KEY) throw new Error('EIA_API_KEY environment variable is required');

// All US regions we track — STEO is a national average so we store it for every
// region. This lets the /forecast endpoint query by region_code without joins.
const US_REGIONS = ['CAISO', 'ERCOT', 'PJM', 'MISO', 'NYISO', 'ISONE', 'SPP', 'WECC'];

/**
 * Confidence score for an EIA STEO forecast row based on how far ahead it is.
 * STEO accuracy degrades significantly beyond 6 months.
 */
function confidenceScore(forecastTs) {
  const monthsOut = (forecastTs - Date.now()) / (1000 * 60 * 60 * 24 * 30.5);
  if (monthsOut <= 3)  return 0.75;
  if (monthsOut <= 6)  return 0.60;
  if (monthsOut <= 12) return 0.45;
  return 0.30;
}

/**
 * Fetch EIA Short-Term Energy Outlook (STEO) monthly price forecasts.
 * STEO is published monthly and covers the next 18–24 months.
 * The US retail price (ELERTPUS, cents/kWh) is converted to $/MWh.
 * We store it for every US region so the forecast endpoint can query by region.
 */
async function pollSTEOPriceOutlook() {
  const start = Date.now();
  logger.info('Polling EIA STEO price outlook');

  try {
    const qs = eiaParams({
      api_key:              EIA_KEY,
      frequency:            'monthly',
      'data[]':             ['value'],
      'facets[seriesId][]': ['ELERTPUS'],
      'sort[0][column]':    'period',
      'sort[0][direction]': 'asc',
      offset:               0,
      length:               24  // up to 24 months ahead
    });

    const response = await clients.eia.get(`/steo/data/?${qs}`);
    const records = response.data?.response?.data || [];
    logger.info(`EIA STEO: received ${records.length} records`);

    if (!records.length) {
      logger.warn('EIA STEO returned no records — series may have changed');
      return 0;
    }

    const now = new Date();
    const rows = [];

    for (const rec of records) {
      const forecastTs = parseEIAPeriod(rec.period);
      if (!forecastTs) continue;

      // Only include future months
      if (forecastTs <= now) continue;

      let priceMwh = null;
      let priceLow = null;
      let priceHigh = null;

      if (rec.seriesId === 'ELERTPUS' && rec.value != null) {
        // cents/kWh → $/MWh (× 10)
        priceMwh = parseFloat(rec.value) * 10;
        // Apply ±15% confidence band (rough but industry-standard for STEO)
        priceLow  = parseFloat((priceMwh * 0.85).toFixed(4));
        priceHigh = parseFloat((priceMwh * 1.15).toFixed(4));
      }

      const horizonHours = Math.round((forecastTs - now) / (1000 * 60 * 60));
      const score = confidenceScore(forecastTs);

      // Store for every US region (STEO is national; region context provided by caller)
      for (const regionCode of US_REGIONS) {
        rows.push({
          regionCode,
          forecastForTimestamp: forecastTs,
          forecastCreatedAt:    now,
          priceForecastMwh:     priceMwh,
          priceLowMwh:          priceLow,
          priceHighMwh:         priceHigh,
          demandForecastMw:     null,  // STEO demand is in MWh/month, not instantaneous MW
          forecastHorizonHours: horizonHours,
          modelVersion:         'v1',
          forecastSource:       'EIA_STEO',
          confidenceScore:      score
        });
      }
    }

    const count = await upsertManyForecasts(rows);
    const elapsed = Date.now() - start;

    try { await markHealthSuccess('EIA_API', elapsed); } catch (e) {
      logger.warn('Could not update EIA_API health', { error: e.message });
    }

    logger.info(`EIA STEO: upserted ${count} forecast rows (${elapsed}ms)`);
    return count;

  } catch (err) {
    try { await markHealthFailure('EIA_API', err.message); } catch (e) {
      logger.warn('Could not mark EIA_API failure', { error: e.message });
    }
    logger.error('EIA STEO poll failed', { error: err.message });
    throw err;
  }
}

/**
 * Fetch ISO load forecasts from EIA — these are 7-day ahead regional demand
 * forecasts published hourly. More granular than STEO and region-specific.
 */
async function pollRegionalLoadForecast() {
  await sleep(600);
  const start = Date.now();
  logger.info('Polling EIA regional load forecasts');

  // EIA region map: respondent code → our region code
  const REGION_MAP = {
    'CAL':  'CAISO',
    'TEX':  'ERCOT',
    'MIDA': 'PJM',
    'MIDW': 'MISO',
    'NY':   'NYISO',
    'NE':   'ISONE',
    'SW':   'WECC'
  };

  try {
    const qs = eiaParams({
      api_key:              EIA_KEY,
      frequency:            'hourly',
      'data[]':             ['value'],
      'facets[type][]':     ['DF'],   // DF = demand forecast
      'sort[0][column]':    'period',
      'sort[0][direction]': 'asc',
      offset:               0,
      length:               200       // covers ~7–8 days per region
    });

    const response = await clients.eia.get(`/electricity/rto/region-data/data/?${qs}`);
    const records  = response.data?.response?.data || [];
    logger.info(`EIA regional load forecast: received ${records.length} records`);

    const now = new Date();
    const rows = [];

    for (const rec of records) {
      const regionCode = REGION_MAP[rec.respondent];
      if (!regionCode) continue;

      const forecastTs = parseEIAPeriod(rec.period);
      if (!forecastTs || forecastTs <= now) continue;  // only future hours

      const demandMw = parseFloat(rec.value);
      if (isNaN(demandMw) || demandMw <= 0) continue;

      const horizonHours = Math.round((forecastTs - now) / (1000 * 60 * 60));

      rows.push({
        regionCode,
        forecastForTimestamp: forecastTs,
        forecastCreatedAt:    now,
        priceForecastMwh:     null,   // EIA doesn't give price forecasts per-region hourly
        priceLowMwh:          null,
        priceHighMwh:         null,
        demandForecastMw:     demandMw,
        forecastHorizonHours: horizonHours,
        modelVersion:         'v1',
        forecastSource:       'EIA_LOAD_FORECAST',
        confidenceScore:      horizonHours <= 24 ? 0.85 : horizonHours <= 72 ? 0.70 : 0.55
      });
    }

    const count = await upsertManyForecasts(rows);
    const elapsed = Date.now() - start;

    try { await markHealthSuccess('EIA_API', elapsed); } catch (e) {
      logger.warn('Could not update EIA_API health', { error: e.message });
    }

    logger.info(`EIA load forecast: upserted ${count} rows (${elapsed}ms)`);
    return count;

  } catch (err) {
    try { await markHealthFailure('EIA_API', err.message); } catch (e) {
      logger.warn('Could not mark EIA_API failure', { error: e.message });
    }
    logger.error('EIA regional load forecast poll failed', { error: err.message });
    throw err;
  }
}

async function run() {
  logger.info('=== EIA forecast poll starting ===');
  const results = {};
  try { results.steo = await pollSTEOPriceOutlook(); } catch (e) { results.steoError = e.message; }
  try { results.loadForecast = await pollRegionalLoadForecast(); } catch (e) { results.loadForecastError = e.message; }
  logger.info('=== EIA forecast poll complete ===', results);
  return results;
}

if (require.main === module) {
  run()
    .then((r) => { console.log('Done:', JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
}

module.exports = { run, pollSTEOPriceOutlook, pollRegionalLoadForecast };
