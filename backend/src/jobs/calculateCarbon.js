'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const logger = require('../config/logger').forJob('calculateCarbon');
const { query } = require('../config/database');
const { normalizeCarbonIntensity } = require('../services/priceNormalizer');
const { upsertCarbonIntensity } = require('../db/queries/prices');

/**
 * Find fuel_mix rows that have no matching carbon_intensity row and fill them in.
 * Runs on-demand or as a catch-up job after a carbon upsert failure.
 */
async function run({ limit = 100 } = {}) {
  logger.info('=== Carbon backfill starting ===');

  const { rows: missing } = await query(
    `SELECT fm.*
     FROM fuel_mix fm
     LEFT JOIN carbon_intensity ci
       ON ci.region_code = fm.region_code AND ci.timestamp = fm.timestamp
     WHERE ci.id IS NULL
     ORDER BY fm.timestamp DESC
     LIMIT $1`,
    [limit]
  );

  if (missing.length === 0) {
    logger.info('Carbon backfill: nothing to do');
    return { filled: 0, skipped: 0 };
  }

  logger.info(`Carbon backfill: found ${missing.length} fuel_mix rows without carbon data`);

  let filled = 0;
  let skipped = 0;

  for (const row of missing) {
    const carbonRow = normalizeCarbonIntensity(row.region_code, row.timestamp, row, 'EIA');
    if (!carbonRow) {
      skipped++;
      logger.warn('Skipped — zero total generation', { region: row.region_code, timestamp: row.timestamp });
      continue;
    }
    try {
      await upsertCarbonIntensity(carbonRow);
      filled++;
    } catch (err) {
      logger.error('Failed to upsert carbon row', { region: row.region_code, timestamp: row.timestamp, error: err.message });
    }
  }

  logger.info(`=== Carbon backfill complete: ${filled} filled, ${skipped} skipped ===`);
  return { filled, skipped };
}

if (require.main === module) {
  run()
    .then((r) => { console.log('Done:', JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
}

module.exports = { run };
