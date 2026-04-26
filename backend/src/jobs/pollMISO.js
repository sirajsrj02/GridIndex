'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const logger = require('../config/logger').forJob('pollMISO');
const { clients, sleep } = require('../utils/httpClient');
const { parseEIAPeriod, eiaParams } = require('../utils/eiaHelpers');
const { normalizeEnergyPrice, normalizeFuelMix, normalizeCarbonIntensity } = require('../services/priceNormalizer');
const { upsertEnergyPrice, upsertFuelMix, upsertCarbonIntensity } = require('../db/queries/prices');
const { markHealthSuccess, markHealthFailure } = require('../db/queries/health');

const EIA_KEY = process.env.EIA_API_KEY;
if (!EIA_KEY) throw new Error('EIA_API_KEY environment variable is required');

const EIA_FUEL_MAP = {
  'NG': 'natural_gas', 'COL': 'coal', 'NUC': 'nuclear',
  'WAT': 'hydro', 'WND': 'wind', 'SUN': 'solar',
  'OIL': 'petroleum', 'OTH': 'other', 'GEO': 'other_renewables',
  'BIO': 'other_renewables', 'WAS': 'other'
};

async function safeMarkFailure(source, message) {
  try { await markHealthFailure(source, message); } catch (e) {
    logger.warn(`Could not update health for ${source}`, { error: e.message });
  }
}

async function pollDemandFromEIA() {
  const start = Date.now();
  logger.info('Polling MISO demand via EIA (MIDW region)');

  try {
    const qs = eiaParams({
      api_key: EIA_KEY,
      frequency: 'hourly',
      'data[]': ['value'],
      'facets[respondent][]': ['MIDW'],
      'facets[type][]': ['D', 'NG'],
      'sort[0][column]': 'period',
      'sort[0][direction]': 'desc',
      offset: 0,
      length: 50
    });

    const response = await clients.eia.get(`/electricity/rto/region-data/data/?${qs}`);
    const records = response.data?.response?.data || [];
    logger.info(`MISO via EIA: received ${records.length} records`);

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
        regionCode: 'MISO', timestamp: ts, pricePerMwh: null,
        priceType: 'real_time_hourly',
        pricingNode: `EIA_MIDW_${rec.type}`,
        demandMw: rec.type === 'D' ? val : null,
        netGenerationMw: rec.type === 'NG' ? val : null,
        source: 'EIA'
      }));
    }

    const demandMw = latestByType['D']?.val ?? null;
    const netGenMw = latestByType['NG']?.val ?? null;
    const elapsed = Date.now() - start;

    try { await markHealthSuccess('MISO', elapsed); } catch (e) {
      logger.warn('Could not update MISO health', { error: e.message });
    }
    logger.info(`MISO demand: load=${demandMw}MW, netGen=${netGenMw}MW (${elapsed}ms)`);
    return { demandMw, netGenMw };

  } catch (err) {
    await safeMarkFailure('MISO', err.message);
    logger.error('MISO EIA poll failed', { error: err.message });
    throw err;
  }
}

async function pollFuelMixFromEIA() {
  const start = Date.now();
  logger.info('Polling MISO fuel mix via EIA');
  await sleep(600);

  try {
    const qs = eiaParams({
      api_key: EIA_KEY,
      frequency: 'hourly',
      'data[]': ['value'],
      'facets[respondent][]': ['MIDW'],
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
      const fuelMixRow = normalizeFuelMix('MISO', ts, fuels, 'EIA');
      await upsertFuelMix(fuelMixRow);
      const carbonRow = normalizeCarbonIntensity('MISO', ts, fuelMixRow, 'EIA');
      if (carbonRow) {
        await upsertCarbonIntensity(carbonRow);
      } else {
        logger.warn('Skipped carbon intensity — zero total generation', { region: 'MISO', timestamp: ts });
      }
      fuelCount++;
      logger.info(`MISO fuel mix: coal=${fuelMixRow.coal_pct?.toFixed(1)}%, wind=${fuelMixRow.wind_pct?.toFixed(1)}%, renewables=${fuelMixRow.renewable_total_pct?.toFixed(1)}%`);
    }

    try { await markHealthSuccess('MISO', Date.now() - start); } catch (e) {
      logger.warn('Could not update MISO health', { error: e.message });
    }
    return { fuelCount };

  } catch (err) {
    await safeMarkFailure('MISO', err.message);
    logger.error('MISO fuel mix poll failed', { error: err.message });
    throw err;
  }
}

async function run() {
  logger.info('=== MISO poll starting ===');
  const results = {};
  try { results.demand = await pollDemandFromEIA(); } catch (e) { results.demandError = e.message; }
  try { results.fuelMix = await pollFuelMixFromEIA(); } catch (e) { results.fuelMixError = e.message; }
  logger.info('=== MISO poll complete ===', results);
  return results;
}

if (require.main === module) {
  run()
    .then((r) => { console.log('Done:', JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
}

module.exports = { run, pollDemandFromEIA, pollFuelMixFromEIA };
