'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const logger = require('../config/logger').forJob('pollEIA');
const { clients, sleep } = require('../utils/httpClient');
const { parseEIAPeriod, eiaParams } = require('../utils/eiaHelpers');
const { normalizeEnergyPrice, normalizeFuelMix, normalizeCarbonIntensity } = require('../services/priceNormalizer');
const { upsertManyEnergyPrices, upsertFuelMix, upsertCarbonIntensity, upsertNaturalGasPrice } = require('../db/queries/prices');
const { markHealthSuccess, markHealthFailure } = require('../db/queries/health');

const EIA_KEY = process.env.EIA_API_KEY;
if (!EIA_KEY) throw new Error('EIA_API_KEY environment variable is required');

// EIA region respondent codes → our region codes.
// Only map codes that genuinely correspond to our tracked ISOs.
// SE (Southeast/SERC), TEN (TVA), FLA (FRCC), CAR (Carolinas/SERC) are
// intentionally excluded — they do NOT map to PJM or ISONE and storing them
// there would corrupt demand figures for those regions.
//
// NOTE: SPP (Southwest Power Pool) demand and fuel-mix data is available via
// EIA respondent code 'CENT' (Central region). However, SPP real-time LMP
// prices are NOT available through the EIA API — they require SPP's own
// Integrated Marketplace API (https://marketplace.spp.org/). The 'CENT'→'SPP'
// mapping here captures demand and generation data; price data remains null
// until SPP Marketplace integration is added.
const EIA_REGION_MAP = {
  'CAL':  'CAISO',
  'TEX':  'ERCOT',
  'MIDA': 'PJM',
  'MIDW': 'MISO',
  'NY':   'NYISO',
  'NE':   'ISONE',
  'SW':   'WECC',  // Southwest (AZ, NV, NM) is within WECC territory
  'CENT': 'SPP'    // Central (KS, OK, NE, SD, ND, parts of TX/NM) = SPP territory
};

// US states → closest ISO/region for retail price context
const STATE_TO_REGION = {
  CA: 'CAISO', TX: 'ERCOT',
  NY: 'NYISO', CT: 'ISONE', MA: 'ISONE', ME: 'ISONE', NH: 'ISONE', RI: 'ISONE', VT: 'ISONE',
  PA: 'PJM', NJ: 'PJM', MD: 'PJM', VA: 'PJM', WV: 'PJM', OH: 'PJM', IN: 'PJM',
  IL: 'MISO', MI: 'MISO', MN: 'MISO', WI: 'MISO', MO: 'MISO', IA: 'MISO',
  AZ: 'WECC', CO: 'WECC', NV: 'WECC', OR: 'WECC', WA: 'WECC', UT: 'WECC',
  // SPP core footprint states
  KS: 'SPP', OK: 'SPP', NE: 'SPP', SD: 'SPP', ND: 'SPP'
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
  const start = Date.now();
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
      if (carbonRow) {
        await upsertCarbonIntensity(carbonRow);
        carbonCount++;
      } else {
        logger.warn('Skipped carbon intensity — zero total generation', { regionCode, timestamp });
      }
    }

    const elapsed = Date.now() - start;
    try { await markHealthSuccess('EIA_API', elapsed); } catch (e) {
      logger.warn('Could not update EIA_API health', { error: e.message });
    }
    logger.info(`EIA fuel mix: upserted ${fuelCount} fuel rows, ${carbonCount} carbon rows (${elapsed}ms)`);
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

/**
 * Fetch monthly natural gas spot prices from EIA.
 * Targets the Henry Hub spot price and any other hubs returned by the
 * /natural-gas/pri/sum endpoint with process code PRS (spot price).
 *
 * EIA units for this endpoint are $/MCF (thousand cubic feet).
 * Conversion: 1 MCF ≈ 1.037 MMBtu for pipeline-quality natural gas.
 *
 * Henry Hub is the US benchmark — it's what gas peakers are priced against
 * and is a key input for electricity price forecasting.
 */
async function pollNaturalGasPrices() {
  const start = Date.now();
  logger.info('Polling EIA natural gas prices');
  await sleep(600);

  try {
    const qs = eiaParams({
      api_key:            EIA_KEY,
      frequency:          'monthly',
      'data[]':           ['value'],
      'facets[process][]': ['PRS'],   // spot price process code
      'sort[0][column]':  'period',
      'sort[0][direction]': 'desc',
      offset: 0,
      length: 50
    });
    const response = await clients.eia.get(`/natural-gas/pri/sum/data/?${qs}`);
    const records  = response.data?.response?.data || [];
    logger.info(`EIA natural gas: received ${records.length} records`);

    let count = 0;
    for (const rec of records) {
      const rawValue = parseFloat(rec.value);
      if (isNaN(rawValue) || rawValue <= 0) continue;

      const ts = parseEIAPeriod(rec.period);
      if (!ts) continue;

      // Determine units from the record — EIA v2 returns a `units` field
      const units = (rec.units || '').toLowerCase();
      let pricePerMcf   = null;
      let pricePerMmbtu = null;

      if (units.includes('mcf') || units.includes('thousand cubic feet')) {
        pricePerMcf   = rawValue;
        pricePerMmbtu = rawValue / 1.037;  // 1 MCF ≈ 1.037 MMBtu
      } else if (units.includes('mmbtu') || units.includes('million btu')) {
        pricePerMmbtu = rawValue;
        pricePerMcf   = rawValue * 1.037;
      } else {
        // Default assumption for this EIA endpoint: $/MCF
        pricePerMcf   = rawValue;
        pricePerMmbtu = rawValue / 1.037;
      }

      // Use the human-readable series description as hub name; fall back to series ID
      const hubName = (rec['series-description'] || rec['seriesDescription'] || rec.series || 'Unknown Hub').trim();

      await upsertNaturalGasPrice({
        hubName,
        regionCode:   null,   // natural gas hubs don't map 1:1 to electricity ISOs
        timestamp:    ts,
        pricePerMmbtu,
        pricePerMcf,
        priceType:    'spot',
        source:       'EIA'
      });
      count++;
    }

    const elapsed = Date.now() - start;
    try { await markHealthSuccess('EIA_API', elapsed); } catch (e) {
      logger.warn('Could not update EIA_API health', { error: e.message });
    }
    logger.info(`EIA natural gas: upserted ${count} rows (${elapsed}ms)`);
    return count;

  } catch (err) {
    // Natural gas is supplementary — log a warning but don't mark EIA as failing
    logger.warn('EIA natural gas poll failed (non-critical)', { error: err.message });
    return 0;
  }
}

async function run() {
  logger.info('=== EIA poll starting ===');
  const results = {};
  try { results.demand     = await pollHourlyDemand(); }    catch (e) { results.demandError    = e.message; }
  await sleep(600);
  try { results.fuelMix    = await pollFuelMix(); }         catch (e) { results.fuelMixError   = e.message; }
  await sleep(600);
  results.retail           = await pollRetailPrices();
  await sleep(600);
  results.naturalGas       = await pollNaturalGasPrices();  // non-critical; swallows its own errors
  logger.info('=== EIA poll complete ===', results);
  return results;
}

if (require.main === module) {
  run()
    .then((r) => { console.log('Done:', JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
}

module.exports = { run, pollHourlyDemand, pollFuelMix, pollRetailPrices, pollNaturalGasPrices, EIA_REGION_MAP, STATE_TO_REGION };
