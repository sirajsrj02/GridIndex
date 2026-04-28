import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  PieChart, Pie, Cell, Tooltip as ReTooltip, Legend, ResponsiveContainer
} from 'recharts';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Spinner from '../components/Spinner';

const REGIONS = ['CAISO', 'ERCOT', 'PJM', 'MISO', 'NYISO', 'ISONE', 'SPP', 'WECC'];

const DATA_TYPES = [
  {
    id:       'prices',
    label:    'Prices',
    icon:     '⚡',
    endpoint: (r, opts) => `/v1/prices?region=${r}&limit=${opts.limit}${opts.start ? `&start=${opts.start}` : ''}${opts.end ? `&end=${opts.end}` : ''}`,
    columns:  ['timestamp','region_code','price_per_mwh','price_day_ahead_mwh','price_type','demand_mw','net_generation_mw','source'],
  },
  {
    id:       'fuel-mix',
    label:    'Fuel Mix',
    icon:     '🔋',
    endpoint: (r) => `/v1/fuel-mix?region=${r}`,
    // Column names must match the DB field names returned by the fuel-mix endpoint.
    // The API returns _mw and _pct suffixed columns — the old bare names (natural_gas,
    // coal, …) matched nothing and silently produced blank table columns and CSV exports.
    columns:  [
      'timestamp', 'region_code',
      'natural_gas_mw', 'coal_mw', 'nuclear_mw', 'hydro_mw',
      'wind_mw', 'solar_mw', 'battery_storage_mw', 'petroleum_mw',
      'other_renewables_mw', 'other_mw',
      'total_generation_mw', 'renewable_total_pct', 'clean_total_pct', 'source',
    ],
  },
  {
    id:       'carbon',
    label:    'Carbon',
    icon:     '🌿',
    endpoint: (r) => `/v1/carbon?region=${r}`,
    columns:  ['timestamp','region_code','carbon_intensity_g_kwh','renewable_pct','source'],
  },
  {
    id:       'weather',
    label:    'Weather',
    icon:     '⛅',
    endpoint: (r) => `/v1/weather?region=${r}`,
    columns:  ['timestamp','region_code','location_name','temperature_f','feels_like_f','wind_speed_mph','humidity_pct','precipitation_inches','solar_radiation_wm2','weather_code','is_forecast','source'],
  },
  {
    id:       'forecast',
    label:    'Forecast',
    icon:     '📈',
    endpoint: (r, opts) => `/v1/forecast?region=${r}&horizon=${opts.horizon || 48}`,
    columns:  ['timestamp','region_code','price_per_mwh','price_day_ahead_mwh','source'],
  },
];

function toCSV(rows, columns) {
  if (!rows.length) return '';
  function escapeCell(v) {
    if (v == null) return '';
    const s = String(v);
    // Wrap in quotes if value contains comma, double-quote, or newline
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }
  const header = columns.join(',');
  const body   = rows.map((r) => columns.map((c) => escapeCell(r[c])).join(','));
  return [header, ...body].join('\n');
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url;
  a.download = filename;
  // Must be in the DOM for Firefox to honour the download attribute
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadCSV(content, filename) {
  triggerDownload(new Blob([content], { type: 'text/csv;charset=utf-8;' }), filename);
}

function downloadJSON(rows, filename) {
  triggerDownload(
    new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json;charset=utf-8;' }),
    filename
  );
}

/** Dropdown export button — closes on outside click or Escape. */
function ExportMenu({ onCSV, onJSON }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function close(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [open]);

  function pick(fn) { fn(); setOpen(false); }

  return (
    <div className="relative" ref={ref}>
      <button
        className="btn-secondary"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
        </svg>
        Export
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-44 bg-white rounded-xl border border-gray-200 shadow-lg z-10 py-1 animate-fade-in">
          <button
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            onClick={() => pick(onCSV)}
          >
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            <div className="text-left">
              <p className="font-medium leading-tight">CSV</p>
              <p className="text-xs text-gray-400">Spreadsheet-ready</p>
            </div>
          </button>
          <button
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            onClick={() => pick(onJSON)}
          >
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
            </svg>
            <div className="text-left">
              <p className="font-medium leading-tight">JSON</p>
              <p className="text-xs text-gray-400">All fields, raw values</p>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}

function CurlBlock({ endpoint, apiKey }) {
  const [copied, setCopied] = useState(false);
  const full = `curl "https://api.gridindex.io/api${endpoint}" \\\n  -H "X-API-Key: ${apiKey || 'YOUR_API_KEY'}"`;

  async function copy() {
    await navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="relative">
      <pre className="bg-slate-900 text-slate-200 text-xs rounded-xl p-4 overflow-x-auto leading-relaxed">
        {full}
      </pre>
      <button
        onClick={copy}
        className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium transition-colors"
      >
        {copied ? (
          <><svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg> Copied!</>
        ) : (
          <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy</>
        )}
      </button>
    </div>
  );
}

// ── Fuel mix colour palette (one per source) ─────────────────────────────────
const FUEL_COLORS = {
  natural_gas:       '#f97316', // orange
  coal:              '#78716c', // stone
  nuclear:           '#8b5cf6', // violet
  hydro:             '#0ea5e9', // sky
  wind:              '#10b981', // emerald
  solar:             '#facc15', // yellow
  battery_storage:   '#6366f1', // indigo
  petroleum:         '#ef4444', // red
  other_renewables:  '#34d399', // green
  other:             '#94a3b8', // slate
};

const FUEL_LABELS = {
  natural_gas:      'Natural Gas',
  coal:             'Coal',
  nuclear:          'Nuclear',
  hydro:            'Hydro',
  wind:             'Wind',
  solar:            'Solar',
  battery_storage:  'Battery',
  petroleum:        'Petroleum',
  other_renewables: 'Other Renew.',
  other:            'Other',
};

function buildPieSlices(row) {
  return Object.keys(FUEL_COLORS)
    .map((key) => ({
      name:  FUEL_LABELS[key],
      key,
      value: row[`${key}_mw`] ?? 0,
      color: FUEL_COLORS[key],
    }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
}

function FuelMixPieChart({ rows }) {
  // Use the most recent row for the visual
  const row = rows[0];
  if (!row) return null;

  const slices = buildPieSlices(row);
  if (!slices.length) return null;

  const total = row.total_generation_mw
    ?? slices.reduce((s, x) => s + x.value, 0);

  const renewablePct = row.renewable_total_pct != null
    ? Number(row.renewable_total_pct).toFixed(1)
    : null;

  const cleanPct = row.clean_total_pct != null
    ? Number(row.clean_total_pct).toFixed(1)
    : null;

  function CustomTooltip({ active, payload }) {
    if (!active || !payload?.length) return null;
    const { name, value, color } = payload[0].payload;
    const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '—';
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-sm">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
          <span className="font-semibold text-gray-900">{name}</span>
        </div>
        <p className="text-gray-600">{Number(value).toLocaleString()} MW</p>
        <p className="text-gray-400 text-xs">{pct}% of total</p>
      </div>
    );
  }

  function renderLegend(props) {
    return (
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center mt-2">
        {props.payload.map((entry) => (
          <li key={entry.value} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: entry.color }} />
            {entry.value}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Generation Mix</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {row.region_code} · {row.timestamp ? new Date(row.timestamp).toLocaleString() : ''}
          </p>
        </div>
        <div className="flex gap-4 text-right">
          <div>
            <p className="text-xs text-gray-400">Total</p>
            <p className="text-sm font-semibold text-gray-800">
              {Number(total).toLocaleString()} MW
            </p>
          </div>
          {renewablePct !== null && (
            <div>
              <p className="text-xs text-gray-400">Renewable</p>
              <p className="text-sm font-semibold text-green-600">{renewablePct}%</p>
            </div>
          )}
          {cleanPct !== null && (
            <div>
              <p className="text-xs text-gray-400">Clean</p>
              <p className="text-sm font-semibold text-blue-600">{cleanPct}%</p>
            </div>
          )}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={slices}
            cx="50%"
            cy="50%"
            innerRadius={70}
            outerRadius={120}
            paddingAngle={2}
            dataKey="value"
            nameKey="name"
          >
            {slices.map((s) => (
              <Cell key={s.key} fill={s.color} stroke="white" strokeWidth={2} />
            ))}
          </Pie>
          <ReTooltip content={<CustomTooltip />} />
          <Legend content={renderLegend} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function DataExplorer() {
  const { customer } = useAuth();
  const toast = useToast();

  // Onboarding tracking
  useEffect(() => {
    localStorage.setItem('onboarding_explorer_visited', 'true');
  }, []);

  const [dataType,  setDataType]  = useState(DATA_TYPES[0]);
  const [region,    setRegion]    = useState(customer?.allowed_regions?.[0] || 'CAISO');
  const [startDate, setStartDate] = useState('');
  const [endDate,   setEndDate]   = useState('');
  const [limit,     setLimit]     = useState(50);
  const [horizon,   setHorizon]   = useState(48);
  const [rows,      setRows]      = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [ran,       setRan]       = useState(false);

  const buildEndpoint = useCallback(() => {
    return dataType.endpoint(region, { limit, start: startDate, end: endDate, horizon });
  }, [dataType, region, limit, startDate, endDate, horizon]);

  async function handleFetch() {
    const ep = buildEndpoint();
    setLoading(true);
    setRan(true);
    try {
      const { data } = await api.get(ep);
      const result = Array.isArray(data.data) ? data.data : (data.data ? [data.data] : []);
      setRows(result);
      if (!result.length) toast.info('Query returned no rows.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Request failed');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  function baseFilename() {
    return `gridindex_${dataType.id}_${region}_${new Date().toISOString().slice(0, 10)}`;
  }

  function handleDownloadCSV() {
    if (!rows.length) return;
    const csv = toCSV(rows, dataType.columns);
    downloadCSV(csv, `${baseFilename()}.csv`);
    toast.success(`${rows.length} rows exported as CSV`);
  }

  function handleDownloadJSON() {
    if (!rows.length) return;
    downloadJSON(rows, `${baseFilename()}.json`);
    toast.success(`${rows.length} rows exported as JSON`);
  }

  const visibleCols = dataType.columns.filter((c) => rows.some((r) => r[c] != null));

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Data Explorer</h1>
        <p className="text-gray-500 text-sm mt-1">Query, preview, and download GridIndex data. Copy the API call to use in your code.</p>
      </div>

      {/* Controls card */}
      <div className="card p-5">
        {/* Data type tabs */}
        <div className="flex gap-2 flex-wrap mb-5">
          {DATA_TYPES.map((dt) => (
            <button
              key={dt.id}
              onClick={() => { setDataType(dt); setRows([]); setRan(false); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${
                dataType.id === dt.id
                  ? 'border-brand-600 bg-brand-50 text-brand-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              <span>{dt.icon}</span>{dt.label}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-5">
          <div>
            <label className="label">Region</label>
            <select className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
              {(customer?.allowed_regions || REGIONS).map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>

          {dataType.id === 'prices' && (
            <>
              <div>
                <label className="label">Start date</label>
                <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <label className="label">End date</label>
                <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <div>
                <label className="label">Row limit</label>
                <select className="input" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                  {[25, 50, 100, 200, 500].map((n) => <option key={n} value={n}>{n} rows</option>)}
                </select>
              </div>
            </>
          )}

          {dataType.id === 'forecast' && (
            <div>
              <label className="label">Horizon (hours)</label>
              <select className="input" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
                {[24, 48, 72].map((h) => <option key={h} value={h}>{h}h</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Action row */}
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={handleFetch} disabled={loading}>
            {loading ? <Spinner size="sm" color="white" /> : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z"/>
              </svg>
            )}
            Run query
          </button>

          {rows.length > 0 && (
            <ExportMenu onCSV={handleDownloadCSV} onJSON={handleDownloadJSON} />
          )}

          {rows.length > 0 && (
            <span className="text-sm text-gray-500 ml-auto">{rows.length} row{rows.length !== 1 ? 's' : ''} returned</span>
          )}
        </div>
      </div>

      {/* API call block */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Your API call</h2>
        <CurlBlock endpoint={buildEndpoint()} apiKey={customer?.api_key} />
        <p className="text-xs text-gray-400 mt-3">
          Replace <code className="bg-gray-100 px-1 rounded">YOUR_API_KEY</code> with your actual key or copy from the{' '}
          <a href="/dashboard/profile" className="text-brand-600 hover:underline">Profile page</a>.
        </p>
      </div>

      {/* Results table */}
      {ran && !loading && rows.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Results preview</h2>
            <span className="text-xs text-gray-400">{rows.length} rows · {visibleCols.length} columns</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {visibleCols.map((c) => (
                    <th key={c} className="px-4 py-2.5 font-semibold text-gray-500 whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.slice(0, 200).map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    {visibleCols.map((c) => {
                      const v = row[c];
                      let display = v;
                      // Format timestamps
                      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
                        display = new Date(v).toLocaleString();
                      }
                      // Format numbers
                      if (typeof v === 'number' && !Number.isInteger(v)) {
                        display = Number(v).toFixed(4);
                      }
                      return (
                        <td
                          key={c}
                          className={`px-4 py-2 whitespace-nowrap font-mono ${
                            v == null ? 'text-gray-300' : 'text-gray-800'
                          }`}
                        >
                          {v == null ? '—' : String(display)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 200 && (
            <p className="px-5 py-3 text-xs text-gray-400 border-t border-gray-100">
              Showing first 200 of {rows.length} rows. Use <strong>Export → CSV</strong> or <strong>JSON</strong> to download all data.
            </p>
          )}
        </div>
      )}

      {/* Fuel mix donut chart — shown when fuel-mix tab is active */}
      {ran && !loading && dataType.id === 'fuel-mix' && rows.length > 0 && (
        <FuelMixPieChart rows={rows} />
      )}

      {ran && !loading && rows.length === 0 && (
        <div className="card p-12 text-center">
          <p className="text-gray-400 text-sm">No data returned for this query. Try adjusting your filters or a different date range.</p>
        </div>
      )}
    </div>
  );
}
