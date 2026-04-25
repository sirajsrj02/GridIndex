'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const logger = require('../config/logger').forJob('pollCAISO');
const { clients, sleep } = require('../utils/httpClient');
const { normalizeEnergyPrice, normalizeFuelMix, normalizeCarbonIntensity } = require('../services/priceNormalizer');
const { upsertEnergyPrice, upsertFuelMix, upsertCarbonIntensity } = require('../db/queries/prices');
const { markHealthSuccess, markHealthFailure } = require('../db/queries/health');

const EIA_KEY = process.env.EIA_API_KEY;

const EIA_FUEL_MAP = {
  'NG': 'natural_gas', 'COL': 'coal', 'NUC': 'nuclear',
  'WAT': 'hydro', 'WND': 'wind', 'SUN': 'solar',
  'OIL': 'petroleum', 'OTH': 'other', 'GEO': 'other_renewables',
  'BIO': 'other_renewables', 'WAS': 'other'
};

function parseEIAPeriod(period) {
  if (!period) return null;
  const s = String(period).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(s)) return new Date(`${s}:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00Z`);
  if (/^\d{4}-\d{2}$/.test(s)) return new Date(`${s}-01T00:00:00Z`);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function eiaParams(base) {
  const parts = [];
  for (const [rawKey, val] of Object.entries(base)) {
    const key = rawKey.endsWith('[]') ? rawKey.slice(0, -2) : rawKey;
    if (Array.isArray(val)) {
      val.forEach((v, i) => parts.push(`${key}[${i}]=${encodeURIComponent(v)}`));
    } else {
      parts.push(`${key}=${encodeURIComponent(val)}`);
    }
  }
  return parts.join('&');
}

/**
 * Pull CAISO demand and net generation from EIA (CAL respondent code).
 * EIA ingests CAISO data and republishes it — reliable and no auth quirks.
 */
async function pollDemandFromEIA() {
  const start = Date.now();
  logger.info('Polling CAISO demand via EIA (CAL region)');

  try {
    const qs = eiaParams({
      api_key: EIA_KEY,
      frequency: 'hourly',
      'data[]': ['value'],
      'facets[respondent][]': ['CAL'],
      'facets[type][]': ['D', 'NG'],
      'sort[0][column]': 'period',
      'sort[0][direction]': 'desc',
      offset: 0,
      length: 50
    });

    const response = await clients.eia.get(`/electricity/rto/region-data/data/?${qs}`);
    const records = response.data?.response?.data || [];
    logger.info(`CAISO via EIA: received ${records.length} records`);

    // Track latest timestamp seen per type to report the most recent values
    const latestByType = {};

    for (const rec of records) {
      const ts = parseEIAPeriod(rec.period);
      if (!ts) continue;
      const val = parseFloat(rec.value);
      if (isNaN(val)) continue;

      // Records arrive newest-first — capture the most recent value per type
      if (!latestByType[rec.type] || ts > latestByType[rec.type].ts) {
        latestByType[rec.type] = { ts, val };
      }

      await upsertEnergyPrice(normalizeEnergyPrice({
        regionCode: 'CAISO',
        timestamp: ts,
        pricePerMwh: null,
        priceType: 'real_time_hourly',
        pricingNode: `EIA_CAL_${rec.type}`,
        demandMw: rec.type === 'D' ? val : null,
        netGenerationMw: rec.type === 'NG' ? val : null,
        source: 'EIA'
      }));
    }

    const demandMw = latestByType['D']?.val ?? null;
    const netGenMw = latestByType['NG']?.val ?? null;

    const elapsed = Date.now() - start;
    await markHealthSuccess('CAISO', elapsed);
    logger.info(`CAISO demand: load=${demandMw}MW, netGen=${netGenMw}MW (${elapsed}ms)`);
    return { demandMw, netGenMw };

  } catch (err) {
    await markHealthFailure('CAISO', err.message);
    logger.error('CAISO EIA poll failed', { error: err.message });
    throw err;
  }
}

/**
 * Pull CAISO fuel mix from EIA fuel-type endpoint (CAL region).
 */
async function pollFuelMixFromEIA() {
  logger.info('Polling CAISO fuel mix via EIA');
  await sleep(600);

  try {
    const qs = eiaParams({
      api_key: EIA_KEY,
      frequency: 'hourly',
      'data[]': ['value'],
      'facets[respondent][]': ['CAL'],
      'sort[0][column]': 'period',
      'sort[0][direction]': 'desc',
      offset: 0,
      length: 50
    });

    const response = await clients.eia.get(`/electricity/rto/fuel-type-data/data/?${qs}`);
    const records = response.data?.response?.data || [];

    const grouped = {};
    for (const rec of records) {
      const ts = parseEIAPeriod(rec.period);
      if (!ts) continue;
      const key = ts.toISOString();
      if (!grouped[key]) grouped[key] = { ts, fuels: {} };
      const fuelKey = EIA_FUEL_MAP[rec.fueltype];
      if (fuelKey) {
        grouped[key].fuels[fuelKey] = (grouped[key].fuels[fuelKey] || 0) + parseFloat(rec.value || 0);
      }
    }

    const sortedKeys = Object.keys(grouped).sort().reverse();
    let fuelCount = 0;
    for (const key of sortedKeys.slice(0, 1)) {
      const { ts, fuels } = grouped[key];
      const fuelMixRow = normalizeFuelMix('CAISO', ts, fuels, 'EIA');
      await upsertFuelMix(fuelMixRow);
      const carbonRow = normalizeCarbonIntensity('CAISO', ts, fuelMixRow, 'EIA');
      if (carbonRow) await upsertCarbonIntensity(carbonRow);
      fuelCount++;
      logger.info(`CAISO fuel mix: solar=${fuelMixRow.solar_pct?.toFixed(1)}%, wind=${fuelMixRow.wind_pct?.toFixed(1)}%, renewables=${fuelMixRow.renewable_total_pct?.toFixed(1)}%`);
    }

    return { fuelCount };

  } catch (err) {
    try { await markHealthFailure('CAISO', err.message); } catch (e) {
      logger.warn('Could not update CAISO health', { error: e.message });
    }
    logger.error('CAISO fuel mix poll failed', { error: err.message });
    throw err;
  }
}

async function run() {
  logger.info('=== CAISO poll starting ===');
  const results = {};
  try { results.demand = await pollDemandFromEIA(); } catch (e) { results.demandError = e.message; }
  try { results.fuelMix = await pollFuelMixFromEIA(); } catch (e) { results.fuelMixError = e.message; }
  logger.info('=== CAISO poll complete ===', results);
  return results;
}

if (require.main === module) {
  run()
    .then((r) => { console.log('Done:', JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
}

module.exports = { run, pollDemandFromEIA, pollFuelMixFromEIA };
