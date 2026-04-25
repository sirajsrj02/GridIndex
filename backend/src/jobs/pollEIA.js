'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const logger = require('../config/logger').forJob('pollEIA');
const { clients, sleep } = require('../utils/httpClient');
const { parseEIAPeriod, eiaParams } = require('../utils/eiaHelpers');
const { normalizeEnergyPrice, normalizeFuelMix, normalizeCarbonIntensity } = require('../services/priceNormalizer');
const { upsertManyEnergyPrices, upsertFuelMix, upsertCarbonIntensity } = require('../db/queries/prices');
const { markHealthSuccess, markHealthFailure } = require('../db/queries/health');

const EIA_KEY = process.env.EIA_API_KEY;
if (!EIA_KEY) throw new Error('EIA_API_KEY environment variable is required');

// EIA region respondent codes → our region codes
const EIA_REGION_MAP = {
  'CAL': 'CAISO', 'TEX': 'ERCOT', 'MIDA': 'PJM',
  'MIDW': 'MISO', 'NY': 'NYISO', 'NE': 'ISONE',
  'SE': 'ISONE', 'SW': 'WECC', 'TEN': 'PJM',
  'FLA': 'PJM', 'CAR': 'PJM'
};

// US states → closest ISO/region for retail price context
const STATE_TO_REGION = {
  CA: 'CAISO', TX: 'ERCOT',
  NY: 'NYISO', CT: 'ISONE', MA: 'ISONE', ME: 'ISONE', NH: 'ISONE', RI: 'ISONE', VT: 'ISONE',
  PA: 'PJM', NJ: 'PJM', MD: 'PJM', VA: 'PJM', WV: 'PJM', OH: 'PJM', IN: 'PJM',
  IL: 'MISO', MI: 'MISO', MN: 'MISO', WI: 'MISO', MO: 'MISO', IA: 'MISO',
  AZ: 'WECC', CO: 'WECC', NV: 'WECC', OR: 'WECC', WA: 'WECC', UT: 'WECC'
};

// EIA fuel type codes → our unified labels
const EIA_FUEL_MAP = {
  'NG': 'natural_gas', 'COL': 'coal', 'NUC': 'nuclear',
  'WAT': 'hydro', 'WND': 'wind', 'SUN': 'solar',
  'OIL': 'petroleum', 'OTH': 'other', 'GEO': 'other_renewables',
  'BIO': 'other_renewables', 'WAS': 'other'
};

// Safely record a health failure without masking the original error
async function safeMarkFailure(source, message) {
  try { await markHealthFailure(source, message); } catch (e) {
    logger.warn(`Could not update health for ${source}`, { error: e.message });
  }
}

/**
 * Fetch hourly electricity demand by EIA region.
 */
async function pollHourlyDemand() {
  const start = Date.now();
  logger.info('Polling EIA hourly regional demand');

  try {
    const qs = eiaParams({
      api_key: EIA_KEY,
      frequency: 'hourly',
      'data[]': ['value'],
      'facets[type][]': ['D'],
      'sort[0][column]': 'period',
      'sort[0][direction]': 'desc',
      offset: 0,
      length: 100
    });
    const response = await clients.eia.get(`/electricity/rto/region-data/data/?${qs}`);
    const records = response.data?.response?.data || [];
    logger.info(`EIA demand: received ${records.length} records`);

    const priceRows = [];
    for (const rec of records) {
      const regionCode = EIA_REGION_MAP[rec.respondent];
      if (!regionCode) continue;
      const ts = parseEIAPeriod(rec.period);
      if (!ts) continue;
      const demandMw = parseFloat(rec.value);
      if (isNaN(demandMw)) continue;

      priceRows.push(normalizeEnergyPrice({
        regionCode, timestamp: ts, pricePerMwh: null,
        priceType: 'real_time_hourly',
        pricingNode: `EIA_${rec.respondent}`,
        demandMw, source: 'EIA'
      }));
    }

    const count = await upsertManyEnergyPrices(priceRows);
    const elapsed = Date.now() - start;
    try { await markHealthSuccess('EIA_API', elapsed); } catch (e) {
      logger.warn('Could not update EIA_API health', { error: e.message });
    }
    logger.info(`EIA demand: upserted ${count} rows (${elapsed}ms)`);
    return count;

  } catch (err) {
    await safeMarkFailure('EIA_API', err.message);
    logger.error('EIA demand poll failed', { error: err.message });
    throw err;
  }
}

/**
 * Fetch hourly generation by fuel type for all EIA regions.
 */
async function pollFuelMix() {
  logger.info('Polling EIA fuel type generation');
  await sleep(600);

  try {
    const qs = eiaParams({
      api_key: EIA_KEY,
      frequency: 'hourly',
      'data[]': ['value'],
      'sort[0][column]': 'period',
      'sort[0][direction]': 'desc',
      offset: 0,
      length: 200
    });
    const response = await clients.eia.get(`/electricity/rto/fuel-type-data/data/?${qs}`);
    const records = response.data?.response?.data || [];
    logger.info(`EIA fuel mix: received ${records.length} records`);

    const grouped = {};
    for (const rec of records) {
      const regionCode = EIA_REGION_MAP[rec.respondent];
      if (!regionCode) continue;
      const ts = parseEIAPeriod(rec.period);
      if (!ts) continue;
      const key = `${regionCode}|${rec.period}`;
      if (!grouped[key]) grouped[key] = { regionCode, timestamp: ts, fuels: {} };
      const fuelKey = EIA_FUEL_MAP[rec.fueltype];
      if (fuelKey) {
        grouped[key].fuels[fuelKey] = (grouped[key].fuels[fuelKey] || 0) + parseFloat(rec.value || 0);
      }
    }

    let fuelCount = 0;
    let carbonCount = 0;
    for (const { regionCode, timestamp, fuels } of Object.values(grouped)) {
      const fuelMixRow = normalizeFuelMix(regionCode, timestamp, fuels, 'EIA');
      await upsertFuelMix(fuelMixRow);
      fuelCount++;
      const carbonRow = normalizeCarbonIntensity(regionCode, timestamp, fuelMixRow, 'EIA');
      if (carbonRow) { await upsertCarbonIntensity(carbonRow); carbonCount++; }
    }

    logger.info(`EIA fuel mix: upserted ${fuelCount} fuel rows, ${carbonCount} carbon rows`);
    return { fuelCount, carbonCount };

  } catch (err) {
    await safeMarkFailure('EIA_API', err.message);
    logger.error('EIA fuel mix poll failed', { error: err.message });
    throw err;
  }
}

/**
 * Fetch retail electricity prices by state/sector (monthly data).
 * Skips states not mapped to a known ISO region.
 */
async function pollRetailPrices() {
  const start = Date.now();
  logger.info('Polling EIA retail electricity prices');
  await sleep(600);

  try {
    const qs = eiaParams({
      api_key: EIA_KEY,
      frequency: 'monthly',
      'data[]': ['price', 'sales', 'revenue'],
      'facets[sectorName][]': ['residential', 'commercial', 'industrial'],
      'sort[0][column]': 'period',
      'sort[0][direction]': 'desc',
      offset: 0,
      length: 100
    });
    const response = await clients.eia.get(`/electricity/retail-sales/data/?${qs}`);
    const records = response.data?.response?.data || [];
    logger.info(`EIA retail prices: received ${records.length} records`);

    const rows = [];
    for (const rec of records) {
      if (!rec.price || isNaN(parseFloat(rec.price))) continue;
      const regionCode = STATE_TO_REGION[rec.stateid];
      if (!regionCode) continue; // skip unmapped states — no silent fallback
      const ts = parseEIAPeriod(rec.period);
      if (!ts) continue;
      // EIA retail prices in cents/kWh → convert to $/MWh (* 10)
      rows.push(normalizeEnergyPrice({
        regionCode, timestamp: ts,
        pricePerMwh: parseFloat(rec.price) * 10,
        priceType: 'monthly_retail',
        pricingNode: `${rec.stateid}_${rec.sectorName}`,
        source: 'EIA', rawData: rec
      }));
    }

    const count = await upsertManyEnergyPrices(rows);
    const elapsed = Date.now() - start;
    try { await markHealthSuccess('EIA_API', elapsed); } catch (e) {
      logger.warn('Could not update EIA_API health', { error: e.message });
    }
    logger.info(`EIA retail prices: upserted ${count} rows (${elapsed}ms)`);
    return count;

  } catch (err) {
    await safeMarkFailure('EIA_API', err.message);
    logger.warn('EIA retail prices poll failed (non-critical)', { error: err.message });
    return 0;
  }
}

async function run() {
  logger.info('=== EIA poll starting ===');
  const results = {};
  results.demand = await pollHourlyDemand();
  await sleep(600);
  results.fuelMix = await pollFuelMix();
  await sleep(600);
  results.retail = await pollRetailPrices();
  logger.info('=== EIA poll complete ===', results);
  return results;
}

if (require.main === module) {
  run()
    .then((r) => { console.log('Done:', JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
}

module.exports = { run, pollHourlyDemand, pollFuelMix, pollRetailPrices };
