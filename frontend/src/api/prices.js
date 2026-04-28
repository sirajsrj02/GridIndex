import api from './client';

const REGIONS = ['CAISO', 'ERCOT', 'PJM', 'MISO', 'NYISO', 'ISONE', 'SPP', 'WECC'];

/**
 * Fetch the latest price for every region in a single batch request.
 * Returns a map: { CAISO: { price_per_mwh, timestamp, ... }, ... }
 * Counts as 1 API call instead of 8.
 */
export async function getAllRegionPricesBatch() {
  const { data } = await api.get('/v1/prices/latest/all');
  return data.data; // already a map keyed by region_code
}

/**
 * Fetch the latest price for every region in parallel (fallback).
 * Returns a map: { CAISO: { price_per_mwh, timestamp, ... }, ... }
 */
export async function getAllRegionPrices() {
  const results = await Promise.allSettled(
    REGIONS.map((r) =>
      api.get(`/v1/prices/latest?region=${r}`).then((res) => ({ region: r, ...res.data.data }))
    )
  );
  const map = {};
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      map[r.value.region] = r.value;
    }
  }
  return map;
}

/**
 * Fetch the latest carbon intensity for every region.
 */
export async function getAllRegionCarbon() {
  const results = await Promise.allSettled(
    REGIONS.map((r) =>
      api.get(`/v1/carbon/latest?region=${r}`).then((res) => ({ region: r, ...res.data.data }))
    )
  );
  const map = {};
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      map[r.value.region] = r.value;
    }
  }
  return map;
}

/**
 * Fetch weather for a specific region.
 */
export async function getRegionWeather(region) {
  const { data } = await api.get(`/v1/weather?region=${region}`);
  return data.data;
}

/**
 * Fetch weather for every region in parallel.
 * Returns a map: { CAISO: [ ...weatherRows ], ... }
 * NOTE: weather endpoint returns an array, not a single object — store it directly.
 */
export async function getAllRegionWeather() {
  const results = await Promise.allSettled(
    REGIONS.map((r) =>
      api.get(`/v1/weather?region=${r}`).then((res) => ({
        region: r,
        rows: Array.isArray(res.data.data) ? res.data.data : []
      }))
    )
  );
  const map = {};
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      map[r.value.region] = r.value.rows;
    }
  }
  return map;
}

/**
 * Fetch price history for a specific region.
 * Uses the collection endpoint GET /v1/prices (not /v1/prices/latest).
 */
export async function getRegionPriceHistory(region, limit = 48) {
  const { data } = await api.get(`/v1/prices?region=${region}&limit=${limit}`);
  return data.data;
}

/**
 * Fetch fuel mix for a region.
 */
export async function getRegionFuelMix(region) {
  const { data } = await api.get(`/v1/fuel-mix/latest?region=${region}`);
  return data.data;
}

/**
 * Fetch 48-hour price forecast for a region.
 * Returns an array of { timestamp, price_per_mwh, price_day_ahead_mwh } rows
 * sorted ascending by timestamp.
 */
export async function getRegionForecast(region, horizon = 48) {
  const { data } = await api.get(`/v1/forecast?region=${region}&horizon=${horizon}`);
  return Array.isArray(data.data) ? data.data : [];
}

/**
 * Fetch data source health.
 */
export async function getHealthStatus() {
  const { data } = await api.get('/v1/sources/health');
  return data;
}

export { REGIONS };
