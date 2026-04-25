'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const logger = require('../config/logger').forJob('pollERCOT');
const { clients } = require('../utils/httpClient');
const { normalizeEnergyPrice, normalizeFuelMix, normalizeCarbonIntensity, normalizeFuelLabel } = require('../services/priceNormalizer');
const { upsertEnergyPrice, upsertFuelMix, upsertCarbonIntensity } = require('../db/queries/prices');
const { markHealthSuccess, markHealthFailure } = require('../db/queries/health');

// ERCOT hub pricing nodes we track
const ERCOT_HUBS = ['HB_BUSAVG', 'HB_HOUSTON', 'HB_NORTH', 'HB_SOUTH', 'HB_WEST'];

/**
 * Poll ERCOT dashboard data — real-time system conditions, prices, and fuel mix.
 * The dashboard endpoint returns a comprehensive JSON payload.
 */
async function pollDashboard() {
  const start = Date.now();
  logger.info('Polling ERCOT dashboard');

  try {
    const response = await clients.ercot.get('/api/1/services/read/dashboardData', {
      timeout: 15000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'GridIndex/1.0 (energy data aggregation)'
      }
    });

    const data = response.data;
    if (!data) throw new Error('Empty ERCOT dashboard response');

    const now = new Date();
    now.setSeconds(0, 0);
    now.setMinutes(Math.floor(now.getMinutes() / 5) * 5);

    // Extract system-level metrics
    const systemLoad = parseFloat(
      data.systemStatus?.totalLoad ||
      data.loadForecast?.currentLoad ||
      data.current_load || 0
    );
    const windOutput = parseFloat(data.windOutput || data.wind || 0);
    const solarOutput = parseFloat(data.solarOutput || data.solar || 0);
    const frequency = parseFloat(data.systemStatus?.frequency || data.frequency || 60.0);

    // Try to extract real-time settlement point prices
    const rtspData = data.RTSPData || data.rtsp || [];
    const prices = Array.isArray(rtspData) ? rtspData : [];

    // Upsert a system-level price row with demand/generation info
    const systemRow = normalizeEnergyPrice({
      regionCode: 'ERCOT',
      timestamp: now,
      pricePerMwh: prices.length > 0 ? parseFloat(prices[0]?.price || prices[0]?.settlementPointPrice || 0) : null,
      priceType: 'real_time_5min',
      pricingNode: 'HB_BUSAVG',
      demandMw: systemLoad || null,
      frequencyHz: frequency !== 60.0 ? frequency : null,
      source: 'ERCOT',
      rawData: { systemLoad, windOutput, solarOutput, frequency }
    });
    await upsertEnergyPrice(systemRow);

    // Upsert individual hub prices if available
    for (const priceRecord of prices) {
      const hub = priceRecord.settlementPoint || priceRecord.hub || priceRecord.name;
      if (!hub || !ERCOT_HUBS.includes(hub)) continue;
      const price = parseFloat(priceRecord.price || priceRecord.settlementPointPrice);
      if (isNaN(price)) continue;

      await upsertEnergyPrice(normalizeEnergyPrice({
        regionCode: 'ERCOT',
        timestamp: now,
        pricePerMwh: price,
        priceType: 'real_time_5min',
        pricingNode: hub,
        source: 'ERCOT'
      }));
    }

    // Build fuel mix from ERCOT generation data
    const genMix = data.generationMix || data.fuelMix || data.fuel_mix || {};
    const fuelMwRaw = {};

    // ERCOT dashboard may nest generation data differently — try multiple paths
    const fuelSources = [
      { label: 'Wind', mw: windOutput },
      { label: 'Solar', mw: solarOutput },
      { label: 'Gas', mw: parseFloat(genMix.gas || genMix.naturalGas || genMix['Natural Gas'] || 0) },
      { label: 'Nuclear', mw: parseFloat(genMix.nuclear || genMix.Nuclear || 0) },
      { label: 'Coal', mw: parseFloat(genMix.coal || genMix.Coal || genMix.lignite || 0) },
      { label: 'Hydro', mw: parseFloat(genMix.hydro || genMix.Hydro || 0) },
      { label: 'Other', mw: parseFloat(genMix.other || genMix.Other || 0) }
    ];

    for (const { label, mw } of fuelSources) {
      if (mw > 0) {
        const fuelKey = normalizeFuelLabel(label);
        fuelMwRaw[fuelKey] = (fuelMwRaw[fuelKey] || 0) + mw;
      }
    }

    if (Object.values(fuelMwRaw).some((v) => v > 0)) {
      const fuelMixRow = normalizeFuelMix('ERCOT', now, fuelMwRaw, 'ERCOT');
      await upsertFuelMix(fuelMixRow);

      const carbonRow = normalizeCarbonIntensity('ERCOT', now, fuelMixRow, 'ERCOT');
      if (carbonRow) await upsertCarbonIntensity(carbonRow);

      logger.info(`ERCOT fuel mix: wind=${windOutput}MW, solar=${solarOutput}MW, renewables=${fuelMixRow.renewable_total_pct?.toFixed(1)}%`);
    }

    const elapsed = Date.now() - start;
    await markHealthSuccess('ERCOT', elapsed);
    logger.info(`ERCOT dashboard: load=${systemLoad}MW, freq=${frequency}Hz (${elapsed}ms)`);

    return { systemLoad, windOutput, solarOutput, frequency, priceCount: prices.length };

  } catch (err) {
    await markHealthFailure('ERCOT', err.message);
    logger.error('ERCOT dashboard poll failed', { error: err.message });
    throw err;
  }
}

async function run() {
  logger.info('=== ERCOT poll starting ===');
  const results = {};
  try { results.dashboard = await pollDashboard(); } catch (e) { results.error = e.message; }
  logger.info('=== ERCOT poll complete ===');
  return results;
}

if (require.main === module) {
  run()
    .then((r) => { console.log('Done:', JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
}

module.exports = { run, pollDashboard };
