'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const logger = require('../config/logger').forJob('pollERCOT');
const { clients, sleep } = require('../utils/httpClient');
const { normalizeEnergyPrice, normalizeFuelMix, normalizeCarbonIntensity } = require('../services/priceNormalizer');
const { upsertEnergyPrice, upsertFuelMix, upsertCarbonIntensity } = require('../db/queries/prices');
const { markHealthSuccess, markHealthFailure } = require('../db/queries/health');

const EIA_KEY = process.env.EIA_API_KEY;

// EIA fuel codes → our unified keys
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
 * Pull ERCOT demand and generation data from EIA (TEX respondent code).
 * EIA is the most reliable source for ERCOT since ERCOT locked down their public API.
 */
async function pollDemandFromEIA() {
  const start = Date.now();
  logger.info('Polling ERCOT demand via EIA (TEX region)');

  try {
    const qs = eiaParams({
      api_key: EIA_KEY,
      frequency: 'hourly',
      'data[]': ['value'],
      'facets[respondent][]': ['TEX'],
      'facets[type][]': ['D', 'NG'],  // D=Demand, NG=Net Generation
      'sort[0][column]': 'period',
      'sort[0][direction]': 'desc',
      offset: 0,
      length: 50
    });

    const response = await clients.eia.get(`/electricity/rto/region-data/data/?${qs}`);
    const records = response.data?.response?.data || [];
    logger.info(`ERCOT via EIA: received ${records.length} records`);

    // Track the most recent value per type explicitly by timestamp comparison
    const latestByType = {};

    for (const rec of records) {
      const ts = parseEIAPeriod(rec.period);
      if (!ts) continue;
      const val = parseFloat(rec.value);
      if (isNaN(val)) continue;

      if (!latestByType[rec.type] || ts > latestByType[rec.type].ts) {
        latestByType[rec.type] = { ts, val };
      }

      await upsertEnergyPrice(normalizeEnergyPrice({
        regionCode: 'ERCOT',
        timestamp: ts,
        pricePerMwh: null,
        priceType: 'real_time_hourly',
        pricingNode: `EIA_TEX_${rec.type}`,
        demandMw: rec.type === 'D' ? val : null,
        netGenerationMw: rec.type === 'NG' ? val : null,
        source: 'EIA'
      }));
    }

    const demandMw = latestByType['D']?.val ?? null;
    const netGenMw = latestByType['NG']?.val ?? null;
    const latestTs = latestByType['D']?.ts ?? latestByType['NG']?.ts ?? null;

    const elapsed = Date.now() - start;
    await markHealthSuccess('ERCOT', elapsed);
    logger.info(`ERCOT demand: load=${demandMw}MW, netGen=${netGenMw}MW (${elapsed}ms)`);
    return { demandMw, netGenMw, latestTs };

  } catch (err) {
    await markHealthFailure('ERCOT', err.message);
    logger.error('ERCOT EIA poll failed', { error: err.message });
    throw err;
  }
}

/**
 * Pull ERCOT fuel mix from EIA fuel-type endpoint (TEX region).
 */
async function pollFuelMixFromEIA() {
  logger.info('Polling ERCOT fuel mix via EIA');
  await sleep(600);

  try {
    const qs = eiaParams({
      api_key: EIA_KEY,
      frequency: 'hourly',
      'data[]': ['value'],
      'facets[respondent][]': ['TEX'],
      'sort[0][column]': 'period',
      'sort[0][direction]': 'desc',
      offset: 0,
      length: 50
    });

    const response = await clients.eia.get(`/electricity/rto/fuel-type-data/data/?${qs}`);
    const records = response.data?.response?.data || [];

    // Group by period to build a complete fuel mix
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

    // Process most recent complete interval
    const sortedKeys = Object.keys(grouped).sort().reverse();
    let fuelCount = 0;
    for (const key of sortedKeys.slice(0, 1)) {
      const { ts, fuels } = grouped[key];
      const fuelMixRow = normalizeFuelMix('ERCOT', ts, fuels, 'EIA');
      await upsertFuelMix(fuelMixRow);
      const carbonRow = normalizeCarbonIntensity('ERCOT', ts, fuelMixRow, 'EIA');
      if (carbonRow) await upsertCarbonIntensity(carbonRow);
      fuelCount++;
      logger.info(`ERCOT fuel mix: wind=${fuelMixRow.wind_pct?.toFixed(1)}%, solar=${fuelMixRow.solar_pct?.toFixed(1)}%, renewables=${fuelMixRow.renewable_total_pct?.toFixed(1)}%`);
    }

    return { fuelCount };

  } catch (err) {
    try { await markHealthFailure('ERCOT', err.message); } catch (e) {
      logger.warn('Could not update ERCOT health', { error: e.message });
    }
    logger.error('ERCOT fuel mix poll failed', { error: err.message });
    throw err;
  }
}

async function run() {
  logger.info('=== ERCOT poll starting ===');
  const results = {};
  try { results.demand = await pollDemandFromEIA(); } catch (e) { results.demandError = e.message; }
  try { results.fuelMix = await pollFuelMixFromEIA(); } catch (e) { results.fuelMixError = e.message; }
  logger.info('=== ERCOT poll complete ===', results);
  return results;
}

if (require.main === module) {
  run()
    .then((r) => { console.log('Done:', JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
}

module.exports = { run, pollDemandFromEIA, pollFuelMixFromEIA };
