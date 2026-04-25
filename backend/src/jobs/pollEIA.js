'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const logger = require('../config/logger').forJob('pollEIA');
const { clients, sleep } = require('../utils/httpClient');
const { normalizeEnergyPrice, normalizeFuelMix, normalizeCarbonIntensity } = require('../services/priceNormalizer');
const { upsertManyEnergyPrices, upsertFuelMix, upsertCarbonIntensity } = require('../db/queries/prices');
const { markHealthSuccess, markHealthFailure } = require('../db/queries/health');

const EIA_KEY = process.env.EIA_API_KEY;

// EIA region codes → our region codes
const EIA_REGION_MAP = {
  'CAL': 'CAISO',
  'TEX': 'ERCOT',
  'MIDA': 'PJM',
  'MIDW': 'MISO',
  'NY': 'NYISO',
  'NE': 'ISONE',
  'SE': 'ISONE',   // SE maps to closest ISO for now
  'SW': 'WECC',
  'TEN': 'PJM',
  'FLA': 'PJM',
  'CAR': 'PJM'
};

// EIA fuel type codes → our unified labels
const EIA_FUEL_MAP = {
  'NG': 'natural_gas', 'COL': 'coal', 'NUC': 'nuclear',
  'WAT': 'hydro', 'WND': 'wind', 'SUN': 'solar',
  'OIL': 'petroleum', 'OTH': 'other', 'GEO': 'other_renewables',
  'BIO': 'other_renewables', 'WAS': 'other'
};

/**
 * Fetch hourly electricity demand by EIA region.
 * Stores rows in energy_prices with price_type='real_time_hourly'.
 * (EIA region data = demand, not LMP prices — we store demand_mw)
 */
async function pollHourlyDemand() {
  const start = Date.now();
  logger.info('Polling EIA hourly regional demand');

  try {
    const response = await clients.eia.get('/electricity/rto/region-data/data/', {
      params: {
        api_key: EIA_KEY,
        frequency: 'hourly',
        'data[]': 'value',
        'facets[type][]': 'D',      // D = Demand
        sort: '[{"column":"period","direction":"desc"}]',
        offset: 0,
        length: 100
      }
    });

    const records = response.data?.response?.data || [];
    logger.info(`EIA demand: received ${records.length} records`);

    const priceRows = [];
    for (const rec of records) {
      const regionCode = EIA_REGION_MAP[rec.respondent];
      if (!regionCode) continue;

      const demandMw = parseFloat(rec.value);
      if (isNaN(demandMw)) continue;

      priceRows.push(normalizeEnergyPrice({
        regionCode,
        timestamp: new Date(rec.period),
        pricePerMwh: null,        // EIA region endpoint gives demand, not price
        priceType: 'real_time_hourly',
        pricingNode: `EIA_${rec.respondent}`,
        demandMw,
        source: 'EIA'
      }));
      await sleep(0); // yield between records
    }

    const count = await upsertManyEnergyPrices(priceRows);
    const elapsed = Date.now() - start;
    await markHealthSuccess('EIA_API', elapsed);
    logger.info(`EIA demand: upserted ${count} rows (${elapsed}ms)`);
    return count;

  } catch (err) {
    await markHealthFailure('EIA_API', err.message);
    logger.error('EIA demand poll failed', { error: err.message });
    throw err;
  }
}

/**
 * Fetch hourly generation by fuel type for all EIA regions.
 * Stores rows in fuel_mix table.
 */
async function pollFuelMix() {
  logger.info('Polling EIA fuel type generation');
  await sleep(600); // 600ms gap to respect EIA rate limits

  try {
    const response = await clients.eia.get('/electricity/rto/fuel-type-data/data/', {
      params: {
        api_key: EIA_KEY,
        frequency: 'hourly',
        'data[]': 'value',
        sort: '[{"column":"period","direction":"desc"}]',
        offset: 0,
        length: 200
      }
    });

    const records = response.data?.response?.data || [];
    logger.info(`EIA fuel mix: received ${records.length} records`);

    // Group by (respondent, period) to build complete fuel mix rows
    const grouped = {};
    for (const rec of records) {
      const regionCode = EIA_REGION_MAP[rec.respondent];
      if (!regionCode) continue;
      const key = `${regionCode}|${rec.period}`;
      if (!grouped[key]) {
        grouped[key] = { regionCode, timestamp: new Date(rec.period), fuels: {} };
      }
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
      if (carbonRow) {
        await upsertCarbonIntensity(carbonRow);
        carbonCount++;
      }
    }

    logger.info(`EIA fuel mix: upserted ${fuelCount} fuel rows, ${carbonCount} carbon rows`);
    return { fuelCount, carbonCount };

  } catch (err) {
    await markHealthFailure('EIA_API', err.message);
    logger.error('EIA fuel mix poll failed', { error: err.message });
    throw err;
  }
}

/**
 * Fetch retail electricity prices by state/sector (monthly data).
 */
async function pollRetailPrices() {
  logger.info('Polling EIA retail electricity prices');
  await sleep(600);

  try {
    const response = await clients.eia.get('/electricity/retail-sales/data/', {
      params: {
        api_key: EIA_KEY,
        frequency: 'monthly',
        'data[]': ['price', 'sales', 'revenue'],
        'facets[sectorName][]': ['residential', 'commercial', 'industrial'],
        sort: '[{"column":"period","direction":"desc"}]',
        offset: 0,
        length: 100
      }
    });

    const records = response.data?.response?.data || [];
    logger.info(`EIA retail prices: received ${records.length} records`);

    const rows = [];
    for (const rec of records) {
      if (!rec.price || isNaN(parseFloat(rec.price))) continue;

      // EIA retail prices are in cents/kWh — convert to $/MWh (* 10)
      const pricePerMwh = parseFloat(rec.price) * 10;
      const regionCode = rec.stateid ? `US_${rec.stateid}` : null;

      rows.push(normalizeEnergyPrice({
        regionCode: regionCode || 'CAISO', // fallback for now
        timestamp: new Date(`${rec.period}-01`),
        pricePerMwh,
        priceType: 'monthly_retail',
        pricingNode: `${rec.stateid || 'US'}_${rec.sectorName}`,
        source: 'EIA',
        rawData: rec
      }));
    }

    const count = await upsertManyEnergyPrices(rows);
    logger.info(`EIA retail prices: upserted ${count} rows`);
    return count;

  } catch (err) {
    logger.warn('EIA retail prices poll failed (non-critical)', { error: err.message });
    return 0;
  }
}

/**
 * Main entry point — runs all EIA polls in sequence with rate-limit gaps.
 */
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

// Allow running directly: node src/jobs/pollEIA.js
if (require.main === module) {
  run()
    .then((r) => { console.log('Done:', JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
}

module.exports = { run, pollHourlyDemand, pollFuelMix, pollRetailPrices };
