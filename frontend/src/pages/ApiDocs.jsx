import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

const BASE_URL = 'https://api.gridindex.io/api/v1';

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={copy}
      className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
    >
      {copied ? (
        <>
          <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

// ── Code block ─────────────────────────────────────────────────────────────────

function CodeBlock({ code, lang = 'bash' }) {
  return (
    <div className="relative rounded-lg bg-slate-900 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">{lang}</span>
        <CopyButton text={code} />
      </div>
      <pre className="px-4 py-3 text-sm text-slate-200 overflow-x-auto leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ── Param row ──────────────────────────────────────────────────────────────────

function ParamRow({ name, type, required, description }) {
  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="py-2.5 pr-4 align-top">
        <code className="text-xs font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{name}</code>
        {required && <span className="ml-1.5 text-xs text-red-500 font-medium">required</span>}
      </td>
      <td className="py-2.5 pr-4 align-top">
        <span className="text-xs text-gray-400 font-mono">{type}</span>
      </td>
      <td className="py-2.5 align-top text-sm text-gray-600">{description}</td>
    </tr>
  );
}

// ── Endpoint section ───────────────────────────────────────────────────────────

function Endpoint({ method, path, title, description, params = [], curl, js, response }) {
  const [open, setOpen] = useState(false);

  const methodColors = {
    GET:    'bg-emerald-100 text-emerald-700',
    POST:   'bg-blue-100 text-blue-700',
    PUT:    'bg-amber-100 text-amber-700',
    DELETE: 'bg-red-100 text-red-700',
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-white hover:bg-gray-50 transition-colors text-left"
      >
        <span className={`flex-shrink-0 text-xs font-bold px-2 py-0.5 rounded-md font-mono ${methodColors[method] || 'bg-gray-100 text-gray-600'}`}>
          {method}
        </span>
        <code className="text-sm font-mono text-gray-700 flex-1">{path}</code>
        <span className="text-sm text-gray-500 hidden sm:block">{title}</span>
        <svg
          className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-gray-100 bg-gray-50 px-5 py-5 space-y-5">
          {description && <p className="text-sm text-gray-600">{description}</p>}

          {params.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Parameters</h4>
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full">
                  <tbody>
                    {params.map((p) => <ParamRow key={p.name} {...p} />)}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {curl && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Example request</h4>
              <CodeBlock code={curl} lang="bash" />
            </div>
          )}

          {js && (
            <div>
              <CodeBlock code={js} lang="javascript" />
            </div>
          )}

          {response && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Example response</h4>
              <CodeBlock code={response} lang="json" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Section header ─────────────────────────────────────────────────────────────

function Section({ title, description, children }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        {description && <p className="text-sm text-gray-500 mt-0.5">{description}</p>}
      </div>
      {children}
    </section>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function ApiDocs() {
  const { customer } = useAuth();
  const [showKey, setShowKey] = useState(false);

  const apiKey = customer?.api_key || 'YOUR_API_KEY';
  const displayKey = showKey ? apiKey : apiKey.slice(0, 8) + '••••••••••••••••••••••••••••••••';

  // Helper — produce curl/JS snippets for each endpoint with the live key
  function curl(method, path, extra = '') {
    return `curl -X ${method} "${BASE_URL}${path}" \\
  -H "X-API-Key: ${apiKey}"${extra}`;
  }

  function js(method, path, body) {
    const bodyStr = body ? `\n  body: JSON.stringify(${body}),\n  headers: { 'Content-Type': 'application/json', 'X-API-Key': '${apiKey}' },` : `\n  headers: { 'X-API-Key': '${apiKey}' },`;
    return `const res = await fetch('${BASE_URL}${path}', {
  method: '${method}',${bodyStr}
});
const { data } = await res.json();`;
  }

  return (
    <div className="p-6 space-y-8 animate-fade-in max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">API Reference</h1>
        <p className="text-gray-500 text-sm mt-1">
          Live examples below use your actual API key — ready to copy and run.
        </p>
      </div>

      {/* Auth + base URL card */}
      <div className="card p-5 space-y-4">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Base URL</p>
          <div className="flex items-center gap-2">
            <code className="text-sm font-mono text-gray-800 bg-gray-100 px-3 py-1.5 rounded-lg flex-1">{BASE_URL}</code>
            <CopyButton text={BASE_URL} />
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Authentication</p>
          <p className="text-sm text-gray-600 mb-2">
            Pass your API key in the <code className="font-mono text-blue-600 text-xs bg-blue-50 px-1.5 py-0.5 rounded">X-API-Key</code> request header on every call.
          </p>
          <div className="flex items-center gap-2 bg-slate-900 rounded-lg px-4 py-2.5">
            <code className="text-sm font-mono text-slate-200 flex-1 truncate">
              X-API-Key: {displayKey}
            </code>
            <button
              onClick={() => setShowKey((s) => !s)}
              className="flex-shrink-0 text-xs text-slate-400 hover:text-slate-200 transition-colors mr-2"
              title={showKey ? 'Hide key' : 'Show key'}
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
            <CopyButton text={`X-API-Key: ${apiKey}`} />
          </div>
        </div>

        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <span>Never expose your API key in client-side JavaScript. Use it only from your server.</span>
        </div>
      </div>

      {/* Rate limits */}
      <div className="card p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-3">Rate limits</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Plan</th>
                <th className="text-left pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Monthly calls</th>
                <th className="text-left pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Burst (per minute)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[
                { plan: 'Starter / Trial', monthly: '1,000',     burst: '20 req/min' },
                { plan: 'Developer',       monthly: '25,000',    burst: '60 req/min' },
                { plan: 'Pro',             monthly: '100,000',   burst: '60 req/min' },
                { plan: 'Enterprise',      monthly: 'Custom',    burst: '200 req/min' },
              ].map(({ plan, monthly, burst }) => (
                <tr key={plan}>
                  <td className="py-2.5 font-medium text-gray-700">{plan}</td>
                  <td className="py-2.5 text-gray-600 font-mono text-xs">{monthly}</td>
                  <td className="py-2.5 text-gray-600 font-mono text-xs">{burst}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          Burst headers returned with each response:{' '}
          <code className="font-mono text-blue-600 bg-blue-50 px-1 rounded">X-RateLimit-Burst-Limit</code>{' '}
          <code className="font-mono text-blue-600 bg-blue-50 px-1 rounded">X-RateLimit-Burst-Remaining</code>.{' '}
          When exceeded, the API returns <code className="font-mono text-red-600 bg-red-50 px-1 rounded">429</code> with{' '}
          <code className="font-mono text-blue-600 bg-blue-50 px-1 rounded">Retry-After: 60</code>.
        </p>
      </div>

      {/* ── Regions ────────────────────────────────────────────────────────────── */}
      <Section title="Regions" description="Retrieve available grid regions and their metadata.">
        <Endpoint
          method="GET"
          path="/regions"
          title="List all regions"
          description="Returns all grid regions your plan grants access to, including ISO name, timezone, and allowed data types."
          curl={curl('GET', '/regions')}
          js={js('GET', '/regions')}
          response={`{
  "success": true,
  "data": [
    {
      "region_code": "CAISO",
      "region_name": "California ISO",
      "timezone": "America/Los_Angeles",
      "data_types": ["prices", "fuel_mix", "carbon", "weather", "forecast"]
    },
    { "region_code": "ERCOT", "region_name": "Electric Reliability Council of Texas", ... }
  ]
}`}
        />
      </Section>

      {/* ── Prices ─────────────────────────────────────────────────────────────── */}
      <Section title="Prices" description="Real-time and historical day-ahead / real-time LMP prices in $/MWh.">
        <Endpoint
          method="GET"
          path="/prices/latest"
          title="Latest price (single region)"
          description="Returns the most recent price record for one region. Requires ?region= query parameter."
          params={[
            { name: 'region', type: 'string', required: true, description: 'ISO region code (CAISO, ERCOT, PJM, MISO, NYISO, ISONE, SPP, WECC)' },
            { name: 'price_type', type: 'string', required: false, description: 'da (day-ahead) or rt (real-time). Defaults to da.' },
          ]}
          curl={curl('GET', '/prices/latest?region=CAISO&price_type=rt')}
          js={js('GET', '/prices/latest?region=CAISO&price_type=rt')}
          response={`{
  "success": true,
  "data": {
    "region_code": "CAISO",
    "price_type": "rt",
    "price_mwh": 68.42,
    "interval_start": "2026-04-27T14:00:00Z",
    "interval_end": "2026-04-27T15:00:00Z",
    "fetched_at": "2026-04-27T14:05:33Z"
  }
}`}
        />

        <Endpoint
          method="GET"
          path="/prices/latest/all"
          title="Latest prices (all regions)"
          description="Returns the most recent price for every region your plan includes in a single call. Useful for dashboards."
          params={[
            { name: 'price_type', type: 'string', required: false, description: 'da or rt. Defaults to da.' },
          ]}
          curl={curl('GET', '/prices/latest/all')}
          js={js('GET', '/prices/latest/all')}
          response={`{
  "success": true,
  "count": 8,
  "data": [
    { "region_code": "CAISO", "price_mwh": 68.42, "interval_start": "2026-04-27T14:00:00Z" },
    { "region_code": "ERCOT", "price_mwh": 31.10, "interval_start": "2026-04-27T14:00:00Z" },
    ...
  ]
}`}
        />

        <Endpoint
          method="GET"
          path="/prices"
          title="Price history"
          description="Returns an ordered series of historical price records. Paginated — up to 1,000 rows per request."
          params={[
            { name: 'region', type: 'string', required: true, description: 'ISO region code' },
            { name: 'price_type', type: 'string', required: false, description: 'da or rt. Defaults to da.' },
            { name: 'start', type: 'ISO 8601', required: false, description: 'Start of range (e.g. 2026-04-01T00:00:00Z)' },
            { name: 'end', type: 'ISO 8601', required: false, description: 'End of range. Defaults to now.' },
            { name: 'limit', type: 'integer', required: false, description: 'Max records (1–1000, default 100)' },
          ]}
          curl={curl('GET', '/prices?region=CAISO&start=2026-04-01T00:00:00Z&limit=48')}
          js={js('GET', '/prices?region=CAISO&start=2026-04-01T00:00:00Z&limit=48')}
          response={`{
  "success": true,
  "count": 48,
  "data": [
    { "region_code": "CAISO", "price_type": "da", "price_mwh": 62.10, "interval_start": "2026-04-01T00:00:00Z" },
    ...
  ]
}`}
        />
      </Section>

      {/* ── Fuel Mix ───────────────────────────────────────────────────────────── */}
      <Section title="Fuel Mix" description="Generation breakdown by fuel source (solar, wind, gas, nuclear, hydro, …).">
        <Endpoint
          method="GET"
          path="/fuel-mix/latest"
          title="Latest fuel mix"
          description="Most recent generation snapshot for a region — fuel sources and MW output."
          params={[
            { name: 'region', type: 'string', required: true, description: 'ISO region code' },
          ]}
          curl={curl('GET', '/fuel-mix/latest?region=CAISO')}
          js={js('GET', '/fuel-mix/latest?region=CAISO')}
          response={`{
  "success": true,
  "data": {
    "region_code": "CAISO",
    "interval_start": "2026-04-27T14:00:00Z",
    "solar_mw": 12450, "wind_mw": 3200, "natural_gas_mw": 8100,
    "nuclear_mw": 2200, "hydro_mw": 5400, "imports_mw": 1800,
    "renewable_pct": 52.4
  }
}`}
        />

        <Endpoint
          method="GET"
          path="/fuel-mix"
          title="Fuel mix history"
          description="Time series of generation snapshots. Useful for charting renewable percentage over time."
          params={[
            { name: 'region', type: 'string', required: true, description: 'ISO region code' },
            { name: 'start', type: 'ISO 8601', required: false, description: 'Start of range' },
            { name: 'end', type: 'ISO 8601', required: false, description: 'End of range' },
            { name: 'limit', type: 'integer', required: false, description: 'Max records (1–500, default 100)' },
          ]}
          curl={curl('GET', '/fuel-mix?region=ERCOT&limit=24')}
          js={js('GET', '/fuel-mix?region=ERCOT&limit=24')}
        />
      </Section>

      {/* ── Carbon ─────────────────────────────────────────────────────────────── */}
      <Section title="Carbon Intensity" description="Grid carbon intensity in grams of CO₂ per kWh.">
        <Endpoint
          method="GET"
          path="/carbon/latest"
          title="Latest carbon intensity"
          description="Most recent carbon intensity reading for a region."
          params={[
            { name: 'region', type: 'string', required: true, description: 'ISO region code' },
          ]}
          curl={curl('GET', '/carbon/latest?region=PJM')}
          js={js('GET', '/carbon/latest?region=PJM')}
          response={`{
  "success": true,
  "data": {
    "region_code": "PJM",
    "carbon_intensity_g_kwh": 342.7,
    "interval_start": "2026-04-27T14:00:00Z"
  }
}`}
        />

        <Endpoint
          method="GET"
          path="/carbon"
          title="Carbon intensity history"
          params={[
            { name: 'region', type: 'string', required: true, description: 'ISO region code' },
            { name: 'start', type: 'ISO 8601', required: false, description: 'Start of range' },
            { name: 'end', type: 'ISO 8601', required: false, description: 'End of range' },
            { name: 'limit', type: 'integer', required: false, description: 'Max records (1–500, default 100)' },
          ]}
          curl={curl('GET', '/carbon?region=PJM&limit=72')}
          js={js('GET', '/carbon?region=PJM&limit=72')}
        />
      </Section>

      {/* ── Forecast ───────────────────────────────────────────────────────────── */}
      <Section title="Forecast" description="24–72 hour ahead price and load forecasts.">
        <Endpoint
          method="GET"
          path="/forecast"
          title="Price & load forecast"
          description="Returns the most recent set of hourly forecast records for a region, up to 72 hours ahead."
          params={[
            { name: 'region', type: 'string', required: true, description: 'ISO region code' },
            { name: 'hours', type: 'integer', required: false, description: 'Forecast horizon in hours (1–72, default 24)' },
          ]}
          curl={curl('GET', '/forecast?region=CAISO&hours=48')}
          js={js('GET', '/forecast?region=CAISO&hours=48')}
          response={`{
  "success": true,
  "count": 48,
  "data": [
    {
      "region_code": "CAISO",
      "interval_start": "2026-04-27T15:00:00Z",
      "forecast_price_mwh": 71.20,
      "forecast_load_mw": 28400
    },
    ...
  ]
}`}
        />
      </Section>

      {/* ── Demand ─────────────────────────────────────────────────────────────── */}
      <Section title="Demand" description="Hourly electricity demand (load) by grid region in MW, sourced from EIA.">
        <Endpoint
          method="GET"
          path="/demand/latest"
          title="Latest demand (single region)"
          description="Returns the most recent hourly demand reading for one region."
          params={[
            { name: 'region', type: 'string', required: true, description: 'ISO region code (CAISO, ERCOT, PJM, MISO, NYISO, ISONE, SPP, WECC)' },
          ]}
          curl={curl('GET', '/demand/latest?region=CAISO')}
          js={js('GET', '/demand/latest?region=CAISO')}
          response={`{
  "success": true,
  "data": {
    "region_code": "CAISO",
    "timestamp": "2026-04-28T14:00:00Z",
    "demand_mw": 27843.5,
    "demand_forecast_mw": 28100.0,
    "net_generation_mw": 26910.2,
    "interchange_mw": 933.3,
    "source": "EIA"
  },
  "meta": { "query_ms": 4 }
}`}
        />

        <Endpoint
          method="GET"
          path="/demand/latest/all"
          title="Latest demand (all regions)"
          description="One demand reading per accessible region in a single call."
          curl={curl('GET', '/demand/latest/all')}
          js={js('GET', '/demand/latest/all')}
          response={`{
  "success": true,
  "count": 8,
  "data": [
    { "region_code": "CAISO", "timestamp": "2026-04-28T14:00:00Z", "demand_mw": 27843.5 },
    { "region_code": "ERCOT", "timestamp": "2026-04-28T14:00:00Z", "demand_mw": 52100.0 },
    ...
  ]
}`}
        />

        <Endpoint
          method="GET"
          path="/demand"
          title="Demand history"
          description="Historical hourly demand series for one region."
          params={[
            { name: 'region', type: 'string', required: true, description: 'ISO region code' },
            { name: 'start', type: 'ISO 8601', required: false, description: 'Start of range (e.g. 2026-04-01T00:00:00Z)' },
            { name: 'end', type: 'ISO 8601', required: false, description: 'End of range. Defaults to now.' },
            { name: 'limit', type: 'integer', required: false, description: 'Max rows (1–1000, default 100)' },
          ]}
          curl={curl('GET', '/demand?region=ERCOT&limit=48')}
          js={js('GET', '/demand?region=ERCOT&limit=48')}
        />
      </Section>

      {/* ── Natural Gas ─────────────────────────────────────────────────────────── */}
      <Section
        title="Natural Gas"
        description="Monthly Henry Hub and regional spot prices in $/MMBtu. Gas peakers are the marginal price-setter in most US grids — when gas spikes, electricity follows."
      >
        <Endpoint
          method="GET"
          path="/natural-gas/latest"
          title="Latest spot prices (all hubs)"
          description="Most recent price for each hub. Filter to a specific hub with ?hub=."
          params={[
            { name: 'hub', type: 'string', required: false, description: 'Partial hub name match (e.g. henry+hub). Omit for all hubs.' },
          ]}
          curl={curl('GET', '/natural-gas/latest')}
          js={js('GET', '/natural-gas/latest')}
          response={`{
  "success": true,
  "count": 3,
  "data": [
    {
      "hub_name": "Henry Hub Natural Gas Spot Price",
      "timestamp": "2026-04-01T00:00:00Z",
      "price_per_mmbtu": 1.89,
      "price_per_mcf": 1.96,
      "price_type": "spot",
      "source": "EIA"
    }
  ],
  "meta": { "note": "Monthly EIA spot prices. price_per_mmbtu is the industry-standard unit." }
}`}
        />

        <Endpoint
          method="GET"
          path="/natural-gas"
          title="Natural gas price history"
          description="Historical monthly spot prices. Useful for charting gas–electricity price correlation."
          params={[
            { name: 'hub', type: 'string', required: false, description: 'Partial hub name match (e.g. henry). Omit for all hubs.' },
            { name: 'start', type: 'ISO 8601', required: false, description: 'Start of range' },
            { name: 'end', type: 'ISO 8601', required: false, description: 'End of range' },
            { name: 'limit', type: 'integer', required: false, description: 'Max rows (1–500, default 100)' },
          ]}
          curl={curl('GET', '/natural-gas?hub=henry&limit=24')}
          js={js('GET', '/natural-gas?hub=henry&limit=24')}
        />
      </Section>

      {/* ── Alerts ─────────────────────────────────────────────────────────────── */}
      <Section title="Alerts" description="Manage price and grid alerts — create, update, delete, and view trigger history.">
        <Endpoint
          method="GET"
          path="/alerts"
          title="List alerts"
          description="Returns all alerts for the authenticated customer."
          curl={curl('GET', '/alerts')}
          js={js('GET', '/alerts')}
        />

        <Endpoint
          method="POST"
          path="/alerts"
          title="Create alert"
          description="Create a new alert. Webhook delivery requires a Pro or Enterprise plan."
          params={[
            { name: 'region_code', type: 'string', required: true, description: 'ISO region code' },
            { name: 'alert_type', type: 'string', required: true, description: 'price_above | price_below | pct_change | carbon_above | renewable_below' },
            { name: 'threshold_price_mwh', type: 'number', required: false, description: 'Threshold for price_above / price_below alerts ($/MWh)' },
            { name: 'threshold_pct_change', type: 'number', required: false, description: 'Percentage change trigger for pct_change alerts' },
            { name: 'threshold_carbon_g_kwh', type: 'number', required: false, description: 'Threshold for carbon_above alerts (g/kWh)' },
            { name: 'threshold_renewable_pct', type: 'number', required: false, description: 'Threshold for renewable_below alerts (%)' },
            { name: 'delivery_method', type: 'string', required: true, description: 'email or webhook' },
            { name: 'email_address', type: 'string', required: false, description: 'Required when delivery_method is email' },
            { name: 'webhook_url', type: 'string', required: false, description: 'Required when delivery_method is webhook' },
            { name: 'webhook_secret', type: 'string', required: false, description: 'Optional HMAC secret for payload signing (sha256=…)' },
            { name: 'cooldown_minutes', type: 'integer', required: false, description: 'Min minutes between re-triggers (default 60, max 10080)' },
            { name: 'alert_name', type: 'string', required: false, description: 'Human-readable name (max 100 chars)' },
          ]}
          curl={`curl -X POST "${BASE_URL}/alerts" \\
  -H "X-API-Key: ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "region_code": "CAISO",
    "alert_type": "price_above",
    "threshold_price_mwh": 150,
    "delivery_method": "email",
    "email_address": "ops@company.com",
    "cooldown_minutes": 60,
    "alert_name": "CAISO spike alert"
  }'`}
          js={js('POST', '/alerts', `{
  region_code: 'CAISO', alert_type: 'price_above',
  threshold_price_mwh: 150, delivery_method: 'email',
  email_address: 'ops@company.com'
}`)}
        />

        <Endpoint
          method="POST"
          path="/alerts/:id/test"
          title="Test webhook"
          description="Fires a single test payload (event: 'alert.test') to the alert's configured webhook URL. Only valid for webhook-delivery alerts. Useful to verify your endpoint is reachable before relying on live triggers."
          curl={`curl -X POST "${BASE_URL}/alerts/42/test" \\
  -H "X-API-Key: ${apiKey}"`}
          js={js('POST', '/alerts/42/test')}
          response={`{
  "success": true,
  "data": { "delivered": true, "statusCode": 200, "error": null },
  "webhook_url": "https://your-server.com/hook"
}`}
        />

        <Endpoint
          method="GET"
          path="/alerts/history"
          title="Trigger history (all alerts)"
          description="All trigger events across every alert owned by this customer. Most recent first."
          params={[
            { name: 'limit', type: 'integer', required: false, description: 'Max rows (1–500, default 100)' },
            { name: 'region', type: 'string', required: false, description: 'Filter to a single region code' },
            { name: 'days', type: 'integer', required: false, description: 'Only events from the last N days (1–365)' },
          ]}
          curl={curl('GET', '/alerts/history?limit=50&region=CAISO&days=30')}
          js={js('GET', '/alerts/history?limit=50&days=30')}
        />
      </Section>

      {/* Error reference */}
      <div className="card p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-3">Error codes</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">HTTP</th>
                <th className="text-left pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">code</th>
                <th className="text-left pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Meaning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[
                { status: 400, code: 'VALIDATION_ERROR', desc: 'Missing or invalid request parameter' },
                { status: 401, code: 'MISSING_API_KEY', desc: 'X-API-Key header absent' },
                { status: 401, code: 'INVALID_API_KEY', desc: 'Key not recognised or account inactive' },
                { status: 403, code: 'REGION_NOT_ALLOWED', desc: 'Your plan does not include this region' },
                { status: 403, code: 'PLAN_REQUIRED', desc: 'Feature requires a higher plan (e.g. webhook alerts)' },
                { status: 404, code: 'NOT_FOUND', desc: 'Resource not found or does not belong to you' },
                { status: 429, code: 'RATE_LIMIT_EXCEEDED', desc: 'Burst or monthly call limit exceeded' },
                { status: 500, code: 'DB_ERROR', desc: 'Internal server error — retry with back-off' },
              ].map(({ status, code, desc }) => (
                <tr key={code}>
                  <td className="py-2.5 font-mono text-xs text-gray-700">{status}</td>
                  <td className="py-2.5 font-mono text-xs text-blue-600 pr-4">
                    <code className="bg-blue-50 px-1.5 py-0.5 rounded">{code}</code>
                  </td>
                  <td className="py-2.5 text-gray-600 text-sm">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
