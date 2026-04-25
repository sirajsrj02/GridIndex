'use strict';

const { query } = require('../../config/database');

async function markHealthSuccess(sourceName, responseTimeMs) {
  return query(
    `UPDATE data_source_health SET
       status = 'healthy',
       last_success_at = NOW(),
       last_attempt_at = NOW(),
       consecutive_failures = 0,
       avg_response_time_ms = $2,
       total_calls_today = total_calls_today + 1,
       updated_at = NOW()
     WHERE source_name = $1`,
    [sourceName, responseTimeMs]
  );
}

async function markHealthFailure(sourceName, errorMessage) {
  return query(
    `UPDATE data_source_health SET
       status = CASE WHEN consecutive_failures >= 2 THEN 'down' ELSE 'degraded' END,
       last_attempt_at = NOW(),
       last_error = $2,
       consecutive_failures = consecutive_failures + 1,
       total_calls_today = total_calls_today + 1,
       updated_at = NOW()
     WHERE source_name = $1`,
    [sourceName, errorMessage]
  );
}

module.exports = { markHealthSuccess, markHealthFailure };
