'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const logger = require('../config/logger').forJob('pollCAISO');
const { clients } = require('../utils/httpClient');
const { normalizeEnergyPrice, normalizeFuelMix, normalizeCarbonIntensity, normalizeFuelLabel } = require('../services/priceNormalizer');
const { upsertEnergyPrice, upsertFuelMix, upsertCarbonIntensity } = require('../db/queries/prices');
const { markHealthSuccess, markHealthFailure } = require('../db/queries/health');

/**
 * Poll CAISO current system outlook — clean JSON, updates every 5 minutes.
 * Returns current demand, net generation, renewables breakdown.
 */
async function pollCurrentOutlook() {
  const start = Date.now();
  logger.info('Polling CAISO current outlook');

  try {
    const response = await clients.caiso.get('/outlook/SP/current/outlook.json', {
      timeout: 10000
    });

    const data = response.data;
    if (!data) throw new Error('Empty CAISO outlook response');

    // CAISO outlook JSON structure varies — handle both array and object forms
    const summary = Array.isArray(data) ? data[0] : data;
    const now = new Date();
    // Snap to the nearest 5-minute interval
    now.setSeconds(0, 0);
    now.setMinutes(Math.floor(now.getMinutes() / 5) * 5);

    const demandMw = parseFloat(summary.current_demand || summary.demand || 0);
    const netGenMw = parseFloat(summary.current_net_generation || summary.generation || 0);
    const renewablesPct = parseFloat(summary.renewables || summary.renewable_pct || 0);

    const priceRow = normalizeEnergyPrice({
      regionCode: 'CAISO',
      timestamp: now,
      pricePerMwh: null,  // outlook doesn't include LMP — that needs OASIS
      priceType: 'real_time_5min',
      pricingNode: 'CAISO_SYSTEM',
      demandMw: demandMw || null,
      netGenerationMw: netGenMw || null,
      source: 'CAISO',
      rawData: summary
    });

    await upsertEnergyPrice(priceRow);
    const elapsed = Date.now() - start;
    await markHealthSuccess('CAISO', elapsed);
    logger.info(`CAISO outlook: demand=${demandMw}MW, renewables=${renewablesPct}% (${elapsed}ms)`);
    return { demandMw, netGenMw, renewablesPct };

  } catch (err) {
    await markHealthFailure('CAISO', err.message);
    logger.error('CAISO outlook poll failed', { error: err.message });
    throw err;
  }
}

/**
 * Poll CAISO current fuel source CSV — updated every 5 minutes.
 * Parses CSV of generation by fuel type.
 */
async function pollFuelSource() {
  logger.info('Polling CAISO fuel source CSV');

  try {
    const response = await clients.caiso.get('/outlook/SP/current/fuelsource.csv', {
      timeout: 10000
    });

    const csvText = response.data;
    if (!csvText || typeof csvText !== 'string') {
      throw new Error('Invalid CAISO fuelsource response');
    }

    // Parse CSV — format: "Time,Solar,Wind,Geothermal,Biomass,Biogas,Small Hydro,Coal,Nuclear,Natural Gas,Large Hydro,Batteries,Imports,Other"
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) throw new Error('CAISO fuelsource CSV has no data rows');

    const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
    // Use the most recent row (last line)
    const lastLine = lines[lines.length - 1];
    const values = lastLine.split(',').map((v) => v.trim().replace(/"/g, ''));

    const now = new Date();
    now.setSeconds(0, 0);
    now.setMinutes(Math.floor(now.getMinutes() / 5) * 5);

    const fuelMwRaw = {};
    for (let i = 1; i < headers.length; i++) {
      const label = headers[i];
      const mw = parseFloat(values[i]) || 0;
      const fuelKey = normalizeFuelLabel(label);
      fuelMwRaw[fuelKey] = (fuelMwRaw[fuelKey] || 0) + mw;
    }

    const fuelMixRow = normalizeFuelMix('CAISO', now, fuelMwRaw, 'CAISO');
    await upsertFuelMix(fuelMixRow);

    const carbonRow = normalizeCarbonIntensity('CAISO', now, fuelMixRow, 'CAISO');
    if (carbonRow) await upsertCarbonIntensity(carbonRow);

    logger.info(`CAISO fuel mix: total=${fuelMixRow.total_generation_mw?.toFixed(0)}MW, renewables=${fuelMixRow.renewable_total_pct?.toFixed(1)}%`);
    return fuelMixRow;

  } catch (err) {
    logger.error('CAISO fuel source poll failed', { error: err.message });
    throw err;
  }
}

async function run() {
  logger.info('=== CAISO poll starting ===');
  const results = {};

  try { results.outlook = await pollCurrentOutlook(); } catch (e) { results.outlookError = e.message; }
  try { results.fuelMix = await pollFuelSource(); } catch (e) { results.fuelMixError = e.message; }

  logger.info('=== CAISO poll complete ===');
  return results;
}

if (require.main === module) {
  run()
    .then((r) => { console.log('Done:', JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
}

module.exports = { run, pollCurrentOutlook, pollFuelSource };
