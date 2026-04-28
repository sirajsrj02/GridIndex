import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { getAllAlertHistory } from '../api/alerts';
import { useToast } from '../context/ToastContext';
import Spinner from '../components/Spinner';

const REGIONS = ['CAISO', 'ERCOT', 'PJM', 'MISO', 'NYISO', 'ISONE', 'SPP', 'WECC'];

const TYPE_LABELS = {
  price_above:     'Price above',
  price_below:     'Price below',
  pct_change:      '% change',
  carbon_above:    'Carbon above',
  renewable_below: 'Renewable below',
};

const TYPE_BADGE = {
  price_above:     'badge-red',
  price_below:     'badge-blue',
  pct_change:      'badge-yellow',
  carbon_above:    'badge-yellow',
  renewable_below: 'badge-green',
};

const DAY_OPTIONS = [
  { label: 'Last 7 days',  value: 7  },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
  { label: 'All time',     value: 0  },
];

function formatValue(row) {
  if (row.alert_type === 'carbon_above' && row.carbon_at_trigger != null) {
    return `${Number(row.carbon_at_trigger).toFixed(1)} g/kWh`;
  }
  if (row.alert_type === 'renewable_below' && row.renewable_pct_at_trigger != null) {
    return `${Number(row.renewable_pct_at_trigger).toFixed(1)}%`;
  }
  if (row.alert_type === 'pct_change' && row.pct_change != null) {
    return `${Number(row.pct_change).toFixed(2)}% change`;
  }
  if (row.price_at_trigger != null) {
    return `$${Number(row.price_at_trigger).toFixed(2)}/MWh`;
  }
  return '—';
}

function formatThreshold(row) {
  if (row.threshold_that_triggered == null) return '—';
  if (row.alert_type === 'carbon_above')    return `${Number(row.threshold_that_triggered).toFixed(1)} g/kWh`;
  if (row.alert_type === 'renewable_below') return `${Number(row.threshold_that_triggered).toFixed(1)}%`;
  if (row.alert_type === 'pct_change')      return `${Number(row.threshold_that_triggered).toFixed(2)}%`;
  return `$${Number(row.threshold_that_triggered).toFixed(2)}/MWh`;
}

// Build a daily bar chart series from alert history rows
function buildChartData(rows, days) {
  const now = new Date();
  let span;

  if (days) {
    // Specific window selected (7 / 30 / 90)
    span = days;
  } else if (rows.length > 0) {
    // "All time" — compute span from actual data range so no events are clipped
    const oldest = rows.reduce((min, r) => {
      const t = new Date(r.triggered_at).getTime();
      return t < min ? t : min;
    }, Infinity);
    span = Math.max(1, Math.ceil((now.getTime() - oldest) / 86_400_000) + 1);
  } else {
    span = 30; // no data — fallback (chart won't render anyway)
  }

  const buckets = {};

  // Pre-fill every day in the range with 0
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    buckets[key] = 0;
  }

  for (const row of rows) {
    const d   = new Date(row.triggered_at);
    const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (key in buckets) buckets[key]++;
  }

  return Object.entries(buckets).map(([date, count]) => ({ date, count }));
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 rounded-lg px-3 py-2 shadow-xl text-white text-xs">
      <p className="text-slate-300 mb-1">{label}</p>
      <p className="font-semibold">{payload[0].value} trigger{payload[0].value !== 1 ? 's' : ''}</p>
    </div>
  );
}

export default function AlertHistory() {
  const toast = useToast();

  const [rows,         setRows]         = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [typeFilter,   setTypeFilter]   = useState('all');
  const [regionFilter, setRegionFilter] = useState('all');
  const [days,         setDays]         = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAllAlertHistory(500, {
        region: regionFilter !== 'all' ? regionFilter : undefined,
        days:   days || undefined,
      });
      setRows(data);
    } catch {
      toast.error('Failed to load alert history');
    } finally {
      setLoading(false);
    }
  }, [regionFilter, days, toast]);

  useEffect(() => { load(); }, [load]);

  // Derived
  const alertTypes = ['all', ...Array.from(new Set(rows.map((r) => r.alert_type))).sort()];

  const filtered = rows.filter((r) => {
    if (typeFilter !== 'all' && r.alert_type !== typeFilter) return false;
    return true;
  });

  const chartData    = buildChartData(rows, days);
  const deliveredPct = rows.length
    ? Math.round((rows.filter((r) => r.delivered).length / rows.length) * 100)
    : null;

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              to="/dashboard/alerts"
              className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
              </svg>
              Alerts
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Alert History</h1>
          <p className="text-gray-500 text-sm mt-1">
            Every time one of your alerts triggered — most recent first.
          </p>
        </div>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Days selector */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {DAY_OPTIONS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setDays(value)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                days === value ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Region filter */}
        <select
          className="input text-sm py-1.5 w-auto"
          value={regionFilter}
          onChange={(e) => setRegionFilter(e.target.value)}
        >
          <option value="all">All regions</option>
          {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>

        {/* Type filter */}
        <select
          className="input text-sm py-1.5 w-auto"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          {alertTypes.map((t) => (
            <option key={t} value={t}>
              {t === 'all' ? 'All types' : (TYPE_LABELS[t] || t)}
            </option>
          ))}
        </select>

        {/* Delivery rate badge */}
        {deliveredPct !== null && !loading && (
          <span className={`ml-auto text-xs font-medium px-2.5 py-1 rounded-full ${
            deliveredPct === 100 ? 'bg-green-100 text-green-700' :
            deliveredPct >= 80  ? 'bg-amber-100 text-amber-700' :
            'bg-red-100 text-red-700'
          }`}>
            {deliveredPct}% delivery rate
          </span>
        )}
      </div>

      {/* Triggers-per-day chart */}
      {!loading && rows.length > 0 && (
        <div className="card p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Triggers over time</h2>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                interval={Math.max(1, Math.floor(chartData.length / 8))}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" fill="#2563eb" radius={[3, 3, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="card p-16 text-center">
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">No alert history</h3>
          <p className="text-gray-500 text-sm mb-6 max-w-sm mx-auto">
            {regionFilter !== 'all' || typeFilter !== 'all' || days
              ? 'No events match your current filters. Try widening the date range or removing filters.'
              : 'Once your alerts fire, you\'ll see a full record here.'}
          </p>
          <Link to="/dashboard/alerts" className="btn-primary inline-block">
            Configure alerts
          </Link>
        </div>
      )}

      {!loading && filtered.length === 0 && rows.length > 0 && (
        <div className="card p-8 text-center text-gray-400 text-sm">
          No history matches the selected type filter.
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              {filtered.length} event{filtered.length !== 1 ? 's' : ''}
              {typeFilter !== 'all' && ` · ${TYPE_LABELS[typeFilter] || typeFilter}`}
              {regionFilter !== 'all' && ` · ${regionFilter}`}
            </h2>
            <span className="text-xs text-gray-400">Showing up to 500 events</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Triggered at</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Alert</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Region</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Type</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Value at trigger</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden xl:table-cell">Threshold</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden xl:table-cell">Delivery</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4 whitespace-nowrap">
                      <p className="text-gray-900 font-medium text-xs">
                        {new Date(row.triggered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                      <p className="text-gray-400 text-xs mt-0.5">
                        {new Date(row.triggered_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </p>
                    </td>

                    <td className="px-5 py-4">
                      <p className="font-medium text-gray-900 text-sm truncate max-w-[160px]">
                        {row.alert_name || `Alert #${row.alert_id}`}
                      </p>
                    </td>

                    <td className="px-5 py-4 hidden md:table-cell">
                      <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded text-gray-700">
                        {row.region_code}
                      </span>
                    </td>

                    <td className="px-5 py-4 hidden lg:table-cell">
                      <span className={TYPE_BADGE[row.alert_type] || 'badge-gray'}>
                        {TYPE_LABELS[row.alert_type] || row.alert_type}
                      </span>
                    </td>

                    <td className="px-5 py-4 hidden lg:table-cell font-mono text-xs text-gray-800">
                      {formatValue(row)}
                    </td>

                    <td className="px-5 py-4 hidden xl:table-cell font-mono text-xs text-gray-500">
                      {formatThreshold(row)}
                    </td>

                    <td className="px-5 py-4 hidden xl:table-cell">
                      <span className="text-xs text-gray-600 capitalize">
                        {row.delivery_method === 'email' ? '📧 Email' : '🔗 Webhook'}
                      </span>
                    </td>

                    <td className="px-5 py-4 text-right">
                      {row.delivered ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium">
                          <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                          </svg>
                          Sent
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-red-600 font-medium"
                          title={row.delivery_error || 'Delivery failed'}
                        >
                          <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                          </svg>
                          Failed
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
