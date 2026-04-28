import React, { useEffect, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { getUsage } from '../api/dashboard';
import { getHealthStatus, getAllRegionPricesBatch } from '../api/prices';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import { Link } from 'react-router-dom';
import OnboardingChecklist from '../components/OnboardingChecklist';


function StatCard({ label, value, sub, icon, color = 'blue' }) {
  const colors = {
    blue:   { bg: 'bg-blue-50',   icon: 'text-blue-600',   border: 'border-blue-100' },
    green:  { bg: 'bg-green-50',  icon: 'text-green-600',  border: 'border-green-100' },
    purple: { bg: 'bg-purple-50', icon: 'text-purple-600', border: 'border-purple-100' },
    amber:  { bg: 'bg-amber-50',  icon: 'text-amber-600',  border: 'border-amber-100' },
  };
  const c = colors[color];
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-4">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <div className={`w-9 h-9 rounded-lg ${c.bg} border ${c.border} flex items-center justify-center ${c.icon}`}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function UsageGauge({ used, limit }) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const r   = 52;
  const circ = 2 * Math.PI * r;
  const dash = circ * (1 - pct / 100);
  const color = pct > 85 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#2563eb';

  return (
    <div className="flex flex-col items-center">
      <svg width="130" height="130" className="-rotate-90">
        <circle cx="65" cy="65" r={r} fill="none" stroke="#f1f5f9" strokeWidth="10" />
        <circle
          cx="65" cy="65" r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={circ}
          strokeDashoffset={dash}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s ease, stroke 0.3s ease' }}
        />
      </svg>
      <div className="text-center -mt-2">
        <p className="text-2xl font-bold text-gray-900" style={{ color }}>{pct.toFixed(1)}%</p>
        <p className="text-xs text-gray-400">of monthly limit used</p>
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 rounded-lg px-3 py-2 shadow-xl text-white text-xs">
      <p className="text-slate-300 mb-1">{label}</p>
      <p className="font-semibold">{Number(payload[0].value).toLocaleString()} calls</p>
    </div>
  );
}

// ── Price ticker ──────────────────────────────────────────────────────────────

function PriceTicker({ prices, loading }) {
  if (loading) {
    return (
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <h2 className="text-sm font-semibold text-gray-700">Live Prices</h2>
          <span className="text-xs text-gray-400">Day-ahead LMP · $/MWh</span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {['CAISO', 'ERCOT', 'PJM', 'MISO'].map((r) => (
            <div key={r} className="flex-shrink-0 w-28 h-16 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const entries = Object.values(prices || {});
  if (!entries.length) return null;

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        <h2 className="text-sm font-semibold text-gray-700">Live Prices</h2>
        <span className="text-xs text-gray-400 ml-1">Day-ahead LMP · $/MWh</span>
        <span className="ml-auto text-xs text-gray-400">
          Updated {entries[0]?.fetched_at
            ? new Date(entries[0].fetched_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
            : '—'}
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
        {entries.map((p) => {
          const price  = Number(p.price_per_mwh ?? p.price_mwh ?? 0);
          const isHigh = price > 100;
          const isLow  = price < 20;
          return (
            <div
              key={p.region_code}
              className={`flex-shrink-0 px-4 py-3 rounded-xl border text-center min-w-[88px] ${
                isHigh ? 'bg-red-50 border-red-100' :
                isLow  ? 'bg-blue-50 border-blue-100' :
                         'bg-gray-50 border-gray-100'
              }`}
            >
              <p className="text-xs font-mono font-bold text-gray-500 mb-1">{p.region_code}</p>
              <p className={`text-lg font-bold leading-none ${
                isHigh ? 'text-red-600' : isLow ? 'text-blue-600' : 'text-gray-900'
              }`}>
                ${price.toFixed(1)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SOURCE_STATUS = {
  healthy:  { cls: 'badge-green',  dot: 'bg-green-500'  },
  degraded: { cls: 'badge-yellow', dot: 'bg-yellow-500' },
  down:     { cls: 'badge-red',    dot: 'bg-red-500'    },
};

export default function Dashboard() {
  const { customer } = useAuth();
  const [usage,        setUsage]        = useState(null);
  const [health,       setHealth]       = useState(null);
  const [prices,       setPrices]       = useState({});
  const [pricesLoading, setPricesLoading] = useState(true);
  const [dayRange,     setDayRange]     = useState(30);
  const [loading,      setLoading]      = useState(true);
  const [err,          setErr]          = useState(null);

  useEffect(() => {
    setLoading(true);
    setErr(null); // clear any previous error so a successful retry shows data
    Promise.allSettled([getUsage(dayRange), getHealthStatus()])
      .then(([u, h]) => {
        if (u.status === 'fulfilled') setUsage(u.value);
        else setErr(u.reason?.message || 'Failed to load usage data');
        // Health is non-critical — show partial dashboard if it fails
        if (h.status === 'fulfilled') setHealth(h.value);
      })
      .finally(() => setLoading(false));
  }, [dayRange]);

  // Load live prices independently — auto-refresh every 5 minutes
  useEffect(() => {
    let cancelled = false;
    async function loadPrices() {
      setPricesLoading(true);
      try {
        const data = await getAllRegionPricesBatch();
        if (!cancelled) setPrices(data || {});
      } catch {
        // Non-critical — ticker just won't show
      } finally {
        if (!cancelled) setPricesLoading(false);
      }
    }
    loadPrices();
    const interval = setInterval(loadPrices, 5 * 60 * 1000); // refresh every 5 min
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  if (err) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500">
          <p className="text-lg font-medium mb-1">Failed to load dashboard</p>
          <p className="text-sm">{err}</p>
        </div>
      </div>
    );
  }

  const summary = usage?.summary || {};
  const dailyData = (usage?.daily || []).map((d) => ({
    date:  d.date ? new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
    calls: parseInt(d.calls) || 0
  }));
  const topEndpoints = usage?.top_endpoints || [];

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Good {timeGreeting()}, {customer?.full_name?.split(' ')[0] || 'there'} 👋
        </h1>
        <p className="text-gray-500 text-sm mt-1">Here's how your API usage looks this month.</p>
      </div>

      {/* Onboarding checklist — shown until dismissed or all steps complete */}
      <OnboardingChecklist customer={customer} />

      {/* Live price ticker */}
      <PriceTicker prices={prices} loading={pricesLoading} />

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Calls this month"
          value={(summary.calls_this_month || 0).toLocaleString()}
          sub={`of ${(summary.monthly_limit || 0).toLocaleString()} limit`}
          color="blue"
          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>}
        />
        <StatCard
          label="Calls remaining"
          value={(summary.calls_remaining || 0).toLocaleString()}
          sub="resets on the 1st"
          color="green"
          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
        />
        <StatCard
          label="All-time calls"
          value={(summary.calls_all_time || 0).toLocaleString()}
          color="purple"
          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>}
        />
        <StatCard
          label="Active plan"
          value={<span className="capitalize">{summary.plan || 'Starter'}</span>}
          sub={`${(summary.monthly_limit || 0).toLocaleString()} calls/month`}
          color="amber"
          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/></svg>}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Usage area chart */}
        <div className="card p-5 xl:col-span-2">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-semibold text-gray-900">API Calls Over Time</h2>
              <p className="text-xs text-gray-400 mt-0.5">{usage?.total_in_period?.toLocaleString()} calls in the last {dayRange} days</p>
            </div>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setDayRange(d)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    dayRange === d ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
          {dailyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={dailyData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="callsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#2563eb" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="calls" stroke="#2563eb" strokeWidth={2} fill="url(#callsGrad)" dot={false} activeDot={{ r: 4, fill: '#2563eb' }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-56 flex items-center justify-center text-gray-400 text-sm">No usage data yet for this period.</div>
          )}
        </div>

        {/* Usage gauge + plan */}
        <div className="card p-5 flex flex-col">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Monthly Quota</h2>
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <UsageGauge used={summary.calls_this_month || 0} limit={summary.monthly_limit || 1000} />
            <div className="w-full space-y-2 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>Used</span>
                <span className="font-medium text-gray-900">{(summary.calls_this_month || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Limit</span>
                <span className="font-medium text-gray-900">{(summary.monthly_limit || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Remaining</span>
                <span className="font-medium text-green-600">{(summary.calls_remaining || 0).toLocaleString()}</span>
              </div>
            </div>
            <Link to="/dashboard/profile" className="btn-secondary w-full text-center text-xs mt-2">
              View API Key →
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Top endpoints bar chart */}
        <div className="card p-5 xl:col-span-2">
          <h2 className="text-base font-semibold text-gray-900 mb-5">Top Endpoints</h2>
          {topEndpoints.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={topEndpoints.slice(0, 8)} layout="vertical" margin={{ top: 0, right: 10, left: 80, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v} />
                <YAxis type="category" dataKey="endpoint" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={80} />
                <Tooltip
                  formatter={(v) => [v.toLocaleString(), 'Calls']}
                  contentStyle={{ background: '#0f172a', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12 }}
                />
                <Bar dataKey="calls" fill="#2563eb" radius={[0, 4, 4, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No endpoint data yet.</div>
          )}
        </div>

        {/* Data source health */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Data Sources</h2>
            {health && (
              <span className={SOURCE_STATUS[health.overall]?.cls || 'badge-gray'}>
                <span className={`w-1.5 h-1.5 rounded-full ${SOURCE_STATUS[health.overall]?.dot || 'bg-gray-400'}`} />
                {health.overall}
              </span>
            )}
          </div>
          <div className="space-y-3">
            {(health?.sources || []).map((s) => {
              const st = SOURCE_STATUS[s.status] || SOURCE_STATUS.down;
              return (
                <div key={s.source_name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                    <span className="text-sm text-gray-700 font-medium">{s.source_name.replace('_', ' ')}</span>
                  </div>
                  <div className="text-right">
                    <span className={st.cls}>{s.status}</span>
                    {s.avg_response_time_ms && (
                      <p className="text-xs text-gray-400 mt-0.5">{Math.round(s.avg_response_time_ms)}ms avg</p>
                    )}
                  </div>
                </div>
              );
            })}
            {!health?.sources?.length && <p className="text-sm text-gray-400">No health data available.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}
