'use strict';

const { query } = require('../../config/database');

/**
 * Record a successful poll for a data source.
 * Uses UPSERT so new source names are created automatically.
 */
async function markHealthSuccess(sourceName, responseTimeMs) {
  return query(
    `INSERT INTO data_source_health
       (source_name, status, last_success_at, last_attempt_at,
        consecutive_failures, avg_response_time_ms, total_calls_today, updated_at)
     VALUES ($1, 'healthy', NOW(), NOW(), 0, $2, 1, NOW())
     ON CONFLICT (source_name) DO UPDATE SET
       status                = 'healthy',
       last_success_at       = NOW(),
       last_attempt_at       = NOW(),
       consecutive_failures  = 0,
       avg_response_time_ms  = $2,
       total_calls_today     = data_source_health.total_calls_today + 1,
       updated_at            = NOW()`,
    [sourceName, responseTimeMs]
  );
}

/**
 * Record a failed poll for a data source.
 * Status becomes 'degraded' after 1 failure, 'down' after 3+.
 * Uses UPSERT so new source names are created automatically.
 */
async function markHealthFailure(sourceName, errorMessage) {
  return query(
    `INSERT INTO data_source_health
       (source_name, status, last_attempt_at, last_error,
        consecutive_failures, total_calls_today, updated_at)
     VALUES ($1, 'degraded', NOW(), $2, 1, 1, NOW())
     ON CONFLICT (source_name) DO UPDATE SET
       status               = CASE
                                WHEN data_source_health.consecutive_failures >= 2 THEN 'down'
                                ELSE 'degraded'
                              END,
       last_attempt_at      = NOW(),
       last_error           = $2,
       consecutive_failures = data_source_health.consecutive_failures + 1,
       total_calls_today    = data_source_health.total_calls_today + 1,
       updated_at           = NOW()`,
    [sourceName, errorMessage]
  );
}

module.exports = { markHealthSuccess, markHealthFailure };
