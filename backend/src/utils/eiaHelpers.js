'use strict';

/**
 * Parse EIA period strings into Date objects.
 * EIA returns periods in non-standard formats:
 *   "2025-04-23T00"  → hourly
 *   "2025-04-23"     → daily
 *   "2025-04"        → monthly
 *   "2025"           → annual
 */
function parseEIAPeriod(period) {
  if (!period) return null;
  const s = String(period).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(s)) return new Date(`${s}:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00Z`);
  if (/^\d{4}-\d{2}$/.test(s)) return new Date(`${s}-01T00:00:00Z`);
  if (/^\d{4}$/.test(s)) return new Date(`${s}-01-01T00:00:00Z`);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Build EIA v2 query strings with properly indexed array params.
 * EIA requires:  data[0]=value  facets[type][0]=D  (not data[]=value)
 * Keys ending in [] have brackets stripped, then [i] is appended per element.
 * Bracket characters in keys are NOT percent-encoded — EIA expects them literal.
 */
function eiaParams(base) {
  const parts = [];
  for (const [rawKey, val] of Object.entries(base)) {
    const key = rawKey.endsWith('[]') ? rawKey.slice(0, -2) : rawKey;
    if (Array.isArray(val)) {
      val.forEach((v, i) => parts.push(`${key}[${i}]=${encodeURIComponent(v)}`));
    } else {
      parts.push(`${key}=${encodeURIComponent(val)}`);
    }
  }
  return parts.join('&');
}

module.exports = { parseEIAPeriod, eiaParams };
