'use strict';

const axios = require('axios');
const logger = require('../config/logger');

// Delay helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create an axios instance with retry logic, timeouts, and logging.
 * @param {object} options
 * @param {string} options.baseURL
 * @param {number} [options.timeout=15000]
 * @param {number} [options.retries=3]
 * @param {number} [options.retryDelay=1000]  base delay in ms (doubles each retry)
 * @param {object} [options.headers]
 */
function createHttpClient({ baseURL, timeout = 15000, retries = 3, retryDelay = 1000, headers = {} } = {}) {
  const instance = axios.create({ baseURL, timeout, headers });

  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const config = error.config;
      if (!config) return Promise.reject(error);

      config._retryCount = config._retryCount || 0;

      const isRetryable =
        !error.response ||                          // network error
        error.response.status === 429 ||            // rate limited
        error.response.status >= 500;               // server error

      if (config._retryCount >= retries || !isRetryable) {
        return Promise.reject(error);
      }

      config._retryCount++;
      const delay = retryDelay * Math.pow(2, config._retryCount - 1);

      logger.warn(`HTTP retry ${config._retryCount}/${retries}`, {
        url: config.url,
        status: error.response?.status,
        delay
      });

      await sleep(delay);
      return instance(config);
    }
  );

  return instance;
}

// Pre-built clients for each data source
const clients = {
  eia: createHttpClient({
    baseURL: 'https://api.eia.gov/v2',
    timeout: 20000,
    retries: 3,
    retryDelay: 1000
  }),

  caiso: createHttpClient({
    baseURL: 'https://www.caiso.com',
    timeout: 15000,
    retries: 3,
    retryDelay: 2000
  }),

  ercot: createHttpClient({
    baseURL: 'https://www.ercot.com',
    timeout: 15000,
    retries: 3,
    retryDelay: 2000
  }),

  pjm: createHttpClient({
    baseURL: 'https://api.pjm.com/api',
    timeout: 20000,
    retries: 3,
    retryDelay: 1500
  }),

  miso: createHttpClient({
    baseURL: 'https://api.misoenergy.org',
    timeout: 15000,
    retries: 3,
    retryDelay: 1500
  }),

  nyiso: createHttpClient({
    baseURL: 'https://mis.nyiso.com/public/csv',
    timeout: 15000,
    retries: 3,
    retryDelay: 1500
  }),

  isone: createHttpClient({
    baseURL: 'https://webservices.iso-ne.com/api/v1.1',
    timeout: 15000,
    retries: 3,
    retryDelay: 1500
  }),

  openmeteo: createHttpClient({
    baseURL: 'https://api.open-meteo.com/v1',
    timeout: 10000,
    retries: 2,
    retryDelay: 500
  }),

  iea: createHttpClient({
    baseURL: 'https://api.iea.org/rte',
    timeout: 20000,
    retries: 3,
    retryDelay: 2000
  }),

  nrel: createHttpClient({
    baseURL: 'https://developer.nrel.gov/api',
    timeout: 20000,
    retries: 3,
    retryDelay: 1500
  })
};

module.exports = { createHttpClient, clients, sleep };
