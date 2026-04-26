'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const cron = require('node-cron');
const logger = require('../config/logger').forJob('scheduler');
const { resetDailyCallCounters } = require('../db/queries/health');
const { resetMonthlyUsage } = require('../db/queries/customers');

const pollEIA    = require('./pollEIA');
const pollCAISO  = require('./pollCAISO');
const pollERCOT  = require('./pollERCOT');
const pollPJM    = require('./pollPJM');
const pollMISO   = require('./pollMISO');
const pollNYISO  = require('./pollNYISO');
const pollISONE  = require('./pollISONE');
const pollWeather    = require('./pollWeather');
const calculateCarbon = require('./calculateCarbon');

// Wrap a job run so one failure never kills the scheduler process
function schedule(name, cronExpr, fn) {
  cron.schedule(cronExpr, async () => {
    logger.info(`[scheduler] Starting ${name}`);
    try {
      await fn();
      logger.info(`[scheduler] ${name} completed`);
    } catch (err) {
      logger.error(`[scheduler] ${name} failed`, { error: err.message });
    }
  }, { timezone: 'UTC' });
  logger.info(`[scheduler] Registered ${name} → "${cronExpr}"`);
}

function start() {
  logger.info('=== GridIndex scheduler starting ===');

  // Stagger ISO polls across the hour to avoid hammering EIA simultaneously.
  // EIA data updates hourly so polling more often than once per hour adds no value.
  schedule('pollEIA',     '2  * * * *', () => pollEIA.run());
  schedule('pollCAISO',   '8  * * * *', () => pollCAISO.run());
  schedule('pollERCOT',   '12 * * * *', () => pollERCOT.run());
  schedule('pollPJM',     '16 * * * *', () => pollPJM.run());
  schedule('pollMISO',    '20 * * * *', () => pollMISO.run());
  schedule('pollNYISO',   '24 * * * *', () => pollNYISO.run());
  schedule('pollISONE',   '28 * * * *', () => pollISONE.run());

  // Weather: once per hour, after the ISO polls
  schedule('pollWeather', '45 * * * *', () => pollWeather.run());

  // Carbon backfill: catch any fuel_mix rows that missed carbon intensity (3am UTC daily)
  schedule('calculateCarbon', '0 3 * * *', () => calculateCarbon.run());

  // Reset daily call counters at midnight UTC
  schedule('resetDailyCounters', '0 0 * * *', async () => {
    await resetDailyCallCounters();
    logger.info('[scheduler] Daily call counters reset');
  });

  // Reset monthly customer API usage on the 1st of each month at 00:05 UTC
  schedule('resetMonthlyUsage', '5 0 1 * *', async () => {
    await resetMonthlyUsage();
    logger.info('[scheduler] Monthly customer usage counters reset');
  });

  logger.info('=== GridIndex scheduler running ===');
}

// Run all pollers once on startup so the DB has fresh data immediately,
// then hand off to cron for subsequent runs.
async function runOnce() {
  logger.info('[scheduler] Running all pollers once on startup...');
  const jobs = [
    { name: 'pollEIA',     fn: () => pollEIA.run() },
    { name: 'pollCAISO',   fn: () => pollCAISO.run() },
    { name: 'pollERCOT',   fn: () => pollERCOT.run() },
    { name: 'pollPJM',     fn: () => pollPJM.run() },
    { name: 'pollMISO',    fn: () => pollMISO.run() },
    { name: 'pollNYISO',   fn: () => pollNYISO.run() },
    { name: 'pollISONE',   fn: () => pollISONE.run() },
    { name: 'pollWeather', fn: () => pollWeather.run() },
  ];

  for (const job of jobs) {
    try {
      logger.info(`[startup] Running ${job.name}`);
      await job.fn();
    } catch (err) {
      logger.error(`[startup] ${job.name} failed`, { error: err.message });
    }
  }
  logger.info('[scheduler] Startup run complete');
}

if (require.main === module) {
  runOnce()
    .then(() => start())
    .catch((err) => {
      logger.error('Scheduler failed to start', { error: err.message });
      process.exit(1);
    });
}

module.exports = { start, runOnce };
