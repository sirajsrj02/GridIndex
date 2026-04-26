'use strict';

/**
 * Parse EIA period strings into UTC Date objects.
 * EIA returns periods in non-standard truncated formats:
 *   "2025-04-23T00"  → hourly  (EIA omits :mm:ss — we append :00:00Z assuming UTC)
 *   "2025-04-23"     → daily
 *   "2025-04"        → monthly
 *   "2025"           → annual
 *
 * EIA publishes all timestamps in UTC. If a future EIA format change adds
 * timezone offsets, this function will fall through to the native Date parser
 * which handles ISO 8601 with offsets correctly.
 */
function parseEIAPeriod(period) {
  if (!period) return null;
  const s = String(period).trim();
  // Hourly: "2025-04-23T00" — append :00:00Z to make valid ISO 8601 UTC
  if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(s)) return new Date(`${s}:00:00Z`);
  // Daily: "2025-04-23"
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00Z`);
  // Monthly: "2025-04" — use first of month
  if (/^\d{4}-\d{2}$/.test(s)) return new Date(`${s}-01T00:00:00Z`);
  // Annual: "2025" — use January 1
  if (/^\d{4}$/.test(s)) return new Date(`${s}-01-01T00:00:00Z`);
  // Fallback: let native parser handle it (handles ISO 8601 with offsets)
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Build EIA v2 query strings with properly indexed array params.
 * EIA requires:  data[0]=value  facets[type][0]=D  (NOT data[]=value)
 * Keys ending in [] have the brackets stripped, then [i] is appended per element.
 * Bracket characters in keys are NOT percent-encoded — EIA expects them literal.
 * Undefined/null values in arrays are skipped to avoid sending "undefined" to the API.
 */
function eiaParams(base) {
  const parts = [];
  for (const [rawKey, val] of Object.entries(base)) {
    const key = rawKey.endsWith('[]') ? rawKey.slice(0, -2) : rawKey;
    if (Array.isArray(val)) {
      let idx = 0;
      for (const v of val) {
        if (v != null) {
          parts.push(`${key}[${idx}]=${encodeURIComponent(v)}`);
          idx++;
        }
      }
    } else {
      parts.push(`${key}=${encodeURIComponent(val)}`);
    }
  }
  return parts.join('&');
}

module.exports = { parseEIAPeriod, eiaParams };
