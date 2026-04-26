'use strict';

const { query } = require('../../config/database');

async function logUsage({
  apiKey, customerId, endpoint, method,
  regionCode = null, queryParams = null,
  responseStatus, responseTimeMs, responseRows = null,
  ipAddress = null, userAgent = null, errorMessage = null
}) {
  // Fire-and-forget: usage logging must never block or crash a response
  return query(
    `INSERT INTO api_usage_logs
       (api_key, customer_id, endpoint, method, region_code, query_params,
        response_status, response_time_ms, response_rows, ip_address, user_agent, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      apiKey, customerId, endpoint, method,
      regionCode, queryParams ? JSON.stringify(queryParams) : null,
      responseStatus, responseTimeMs, responseRows,
      ipAddress, userAgent, errorMessage
    ]
  );
}

async function getUsageSummary(customerId, days = 30) {
  const { rows } = await query(
    `SELECT
       DATE(created_at) AS day,
       COUNT(*)         AS calls,
       AVG(response_time_ms)::int AS avg_ms,
       COUNT(*) FILTER (WHERE response_status >= 400) AS errors
     FROM api_usage_logs
     WHERE customer_id = $1
       AND created_at >= NOW() - ($2 || ' days')::interval
     GROUP BY day
     ORDER BY day DESC`,
    [customerId, days]
  );
  return rows;
}

async function getTopEndpoints(customerId, days = 30) {
  const { rows } = await query(
    `SELECT endpoint, method, COUNT(*) AS calls
     FROM api_usage_logs
     WHERE customer_id = $1
       AND created_at >= NOW() - ($2 || ' days')::interval
     GROUP BY endpoint, method
     ORDER BY calls DESC
     LIMIT 10`,
    [customerId, days]
  );
  return rows;
}

module.exports = { logUsage, getUsageSummary, getTopEndpoints };
