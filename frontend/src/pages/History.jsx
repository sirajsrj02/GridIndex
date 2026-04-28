'use strict';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  ResponsiveContainer, Legend
} from 'recharts';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';

const REGIONS = ['CAISO', 'ERCOT', 'PJM', 'MISO', 'NYISO', 'ISONE', 'SPP', 'WECC'];

const RANGES = [
  { label: '24h',  days: 1,    limit: 24   },
  { label: '7d',   days: 7,    limit: 168  },
  { label: '30d',  days: 30,   limit: 720  },
  { label: '90d',  days: 90,   limit: 1000 },
];

const METRICS = [
  { id: 'prices',  label: 'Electricity Prices',  icon: '⚡' },
  { id: 'carbon',  label: 'Carbon Intensity',     icon: '🌿' },
  { id: 'demand',  label: 'Grid Demand',          icon: '📊' },
];

// ── Chart colour scheme ───────────────────────────────────────────────────────
const CHART_COLORS = {
  primary:    '#3b82f6',  // blue-500
  secondary:  '#10b981',  // emerald-500
  tertiary:   '#f97316',  // orange-500
};

// ── Tooltip component ─────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, metric }) {
  if (!active || !payload?.length) return null;

  function formatVal(v, id) {
    if (v == null) return '—';
    if (id === 'prices')  return `$${Number(v).toFixed(2)}/MWh`;
    if (id === 'carbon')  return `${Number(v).toFixed(1)} g/kWh`;
    if (id === 'demand')  return `${Number(v).toLocaleString()} MW`;
    return String(v);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-sm min-w-[160px]">
      <p className="text-xs text-gray-400 mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
            <span className="text-gray-600 capitalize">{p.name}</span>
          </div>
          <span className="font-semibold text-gray-900">{formatVal(p.value, metric)}</span>
        </div>
      ))}
    </div>
  );
}

// ── X-axis tick formatter ─────────────────────────────────────────────────────
function makeTickFormatter(days) {
  return (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    if (days <= 1) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (days <= 7) {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };
}

// ── Y-axis formatter ──────────────────────────────────────────────────────────
function makeYFormatter(metric) {
  if (metric === 'prices')  return (v) => `$${v}`;
  if (metric === 'carbon')  return (v) => `${v}`;
  if (metric === 'demand')  return (v) => `${(v / 1000).toFixed(0)}GW`;
  return (v) => v;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────
function buildQuery(metric, region, range) {
  const now   = new Date();
  const start = new Date(now.getTime() - range.days * 24 * 60 * 60 * 1000);
  const startIso = start.toISOString();
  const endIso   = now.toISOString();

  if (metric === 'prices') {
    return `/v1/prices?region=${region}&start=${startIso}&end=${endIso}&limit=${range.limit}`;
  }
  if (metric === 'carbon') {
    return `/v1/carbon?region=${region}&start=${startIso}&end=${endIso}&limit=${range.limit}`;
  }
  if (metric === 'demand') {
    return `/v1/demand?region=${region}&start=${startIso}&end=${endIso}&limit=${range.limit}`;
  }
  return '';
}

function transformRows(rows, metric) {
  if (!rows?.length) return [];
  // Sort ascending by timestamp for charting
  const sorted = [...rows].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (metric === 'prices') {
    return sorted.map((r) => ({
      ts:           r.timestamp,
      'RT Price':   r.price_per_mwh           != null ? Number(r.price_per_mwh.toFixed(2))            : null,
      'DA Price':   r.price_day_ahead_mwh     != null ? Number(r.price_day_ahead_mwh.toFixed(2))      : null,
    }));
  }
  if (metric === 'carbon') {
    return sorted.map((r) => ({
      ts:               r.timestamp,
      'Carbon g/kWh':   r.carbon_intensity_g_kwh != null ? Number(r.carbon_intensity_g_kwh.toFixed(1)) : null,
      'Renewable %':    r.renewable_pct          != null ? Number(r.renewable_pct.toFixed(1))           : null,
    }));
  }
  if (metric === 'demand') {
    return sorted.map((r) => ({
      ts:        r.timestamp,
      'Demand':  r.demand_mw != null ? Number(r.demand_mw) : null,
    }));
  }
  return [];
}

// ── StatBadge ─────────────────────────────────────────────────────────────────
function StatBadge({ label, value, sub, color = 'blue' }) {
  const colors = {
    blue:   'bg-blue-50  text-blue-800  border-blue-200',
    green:  'bg-green-50 text-green-800 border-green-200',
    orange: 'bg-orange-50 text-orange-800 border-orange-200',
    gray:   'bg-gray-50   text-gray-700  border-gray-200',
  };
  return (
    <div className={`flex flex-col px-4 py-3 rounded-xl border ${colors[color]}`}>
      <span className="text-xs opacity-70 mb-1">{label}</span>
      <span className="text-lg font-bold leading-tight">{value ?? '—'}</span>
      {sub && <span className="text-xs opacity-60 mt-0.5">{sub}</span>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function History() {
  const { customer } = useAuth();

  const defaultRegion = customer?.allowed_regions?.[0] || 'CAISO';

  const [metric,   setMetric]   = useState('prices');
  const [region,   setRegion]   = useState(defaultRegion);
  const [rangeIdx, setRangeIdx] = useState(1); // default 7d
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  const range = RANGES[rangeIdx];

  const load = useCallback(async () => {
    const q = buildQuery(metric, region, range);
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(q);
      const result = Array.isArray(data.data) ? data.data : (data.data ? [data.data] : []);
      setRows(result);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load data');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [metric, region, range]);

  // Auto-load whenever controls change
  useEffect(() => { load(); }, [load]);

  const chartData = transformRows(rows, metric);

  // Compute summary stats
  function computeStats() {
    if (!chartData.length) return null;
    const keys = Object.keys(chartData[0]).filter((k) => k !== 'ts');
    if (!keys.length) return null;

    const primary = keys[0];
    const vals = chartData.map((r) => r[primary]).filter((v) => v != null);
    if (!vals.length) return null;

    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const last = vals[vals.length - 1];

    function fmt(v) {
      if (metric === 'prices')  return `$${v.toFixed(2)}/MWh`;
      if (metric === 'carbon')  return `${v.toFixed(1)} g/kWh`;
      if (metric === 'demand')  return `${(v / 1000).toFixed(1)} GW`;
      return v.toFixed(2);
    }

    return { min: fmt(min), max: fmt(max), avg: fmt(avg), last: fmt(last), count: vals.length };
  }

  const stats = computeStats();

  // Determine series for the chart
  const seriesKeys  = chartData.length ? Object.keys(chartData[0]).filter((k) => k !== 'ts') : [];
  const seriesColors = Object.values(CHART_COLORS);
  const tickFmt  = makeTickFormatter(range.days);
  const yFmt     = makeYFormatter(metric);

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Price History</h1>
        <p className="text-gray-500 text-sm mt-1">
          Visualise historical electricity prices, carbon intensity, and grid demand over time.
        </p>
      </div>

      {/* Controls */}
      <div className="card p-5">
        <div className="flex flex-wrap items-end gap-4">
          {/* Metric tabs */}
          <div>
            <label className="label">Data type</label>
            <div className="flex gap-2 flex-wrap">
              {METRICS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => { setMetric(m.id); setRows([]); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-colors ${
                    metric === m.id
                      ? 'border-brand-600 bg-brand-50 text-brand-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <span>{m.icon}</span>{m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Region */}
          <div>
            <label className="label">Region</label>
            <select
              className="input"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
            >
              {(customer?.allowed_regions || REGIONS).map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Time range pills */}
          <div>
            <label className="label">Time range</label>
            <div className="flex gap-1.5">
              {RANGES.map((r, i) => (
                <button
                  key={r.label}
                  onClick={() => setRangeIdx(i)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    rangeIdx === i
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Refresh */}
          <button
            onClick={load}
            disabled={loading}
            className="btn-secondary ml-auto self-end"
          >
            {loading ? <Spinner size="sm" /> : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            Refresh
          </button>
        </div>
      </div>

      {/* Summary stats */}
      {stats && !loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatBadge label="Current"   value={stats.last}  color="blue"   />
          <StatBadge label="Average"   value={stats.avg}   color="gray"   />
          <StatBadge label="High"      value={stats.max}   color="orange" />
          <StatBadge label="Low"       value={stats.min}   color="green"  sub={`${stats.count} data points`} />
        </div>
      )}

      {/* Chart card */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">
              {METRICS.find((m) => m.id === metric)?.label} — {region}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Past {range.label} · {rows.length} readings
            </p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center h-72">
            <Spinner size="lg" />
          </div>
        )}

        {error && !loading && (
          <div className="flex items-center justify-center h-72 text-sm text-red-500">{error}</div>
        )}

        {!loading && !error && chartData.length === 0 && (
          <div className="flex flex-col items-center justify-center h-72 gap-2">
            <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p className="text-gray-400 text-sm">No data available for this period.</p>
          </div>
        )}

        {!loading && !error && chartData.length > 0 && (
          <ResponsiveContainer width="100%" height={340}>
            <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <defs>
                {seriesKeys.map((key, i) => (
                  <linearGradient key={key} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={seriesColors[i] || '#3b82f6'} stopOpacity={0.18} />
                    <stop offset="95%" stopColor={seriesColors[i] || '#3b82f6'} stopOpacity={0}    />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="ts"
                tickFormatter={tickFmt}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={yFmt}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                width={60}
              />
              <ReTooltip
                content={(props) => <ChartTooltip {...props} metric={metric} />}
                cursor={{ stroke: '#e2e8f0', strokeWidth: 1 }}
              />
              {seriesKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />}
              {seriesKeys.map((key, i) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={seriesColors[i] || '#3b82f6'}
                  strokeWidth={2}
                  fill={`url(#grad-${i})`}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                  connectNulls
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Carbon breakdown detail card (only for carbon metric) */}
      {metric === 'carbon' && !loading && chartData.length > 0 && (() => {
        const latest = rows[rows.length - 1] || rows[0];
        if (!latest) return null;
        const ci  = latest.carbon_intensity_g_kwh;
        const ren = latest.renewable_pct;

        let intensity = 'Moderate';
        let color     = 'text-yellow-600';
        if (ci < 150)       { intensity = 'Very Clean';  color = 'text-green-600';  }
        else if (ci < 300)  { intensity = 'Clean';        color = 'text-emerald-600'; }
        else if (ci > 500)  { intensity = 'High Carbon';  color = 'text-red-600';    }

        return (
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Carbon snapshot — {region}</h2>
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="text-xs text-gray-400">Current intensity</p>
                <p className={`text-2xl font-bold mt-1 ${color}`}>
                  {ci != null ? `${Number(ci).toFixed(0)} g/kWh` : '—'}
                </p>
                <p className={`text-xs font-medium mt-0.5 ${color}`}>{intensity}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Renewable share</p>
                <p className="text-2xl font-bold mt-1 text-green-600">
                  {ren != null ? `${Number(ren).toFixed(1)}%` : '—'}
                </p>
              </div>
              <div className="flex-1 min-w-[180px]">
                <p className="text-xs text-gray-400 mb-2">Intensity scale</p>
                <div className="h-2.5 rounded-full bg-gradient-to-r from-green-400 via-yellow-400 to-red-500 relative">
                  {ci != null && (
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-gray-800 shadow"
                      style={{ left: `${Math.min(Math.max((ci / 700) * 100, 2), 98)}%`, transform: 'translate(-50%, -50%)' }}
                    />
                  )}
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>0</span><span>350</span><span>700+ g/kWh</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
