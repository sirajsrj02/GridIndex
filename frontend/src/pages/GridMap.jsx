import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  AreaChart, Area, Line, ComposedChart,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  getAllRegionPricesBatch, getAllRegionPrices,
  getAllRegionCarbon, getAllRegionWeather,
  getRegionPriceHistory, getRegionFuelMix, getRegionForecast, REGIONS
} from '../api/prices';
import USRegionMap, { REGION_COLORS } from '../components/USRegionMap';
import Spinner from '../components/Spinner';

// ── Weather helpers ────────────────────────────────────────────────────────────
const WMO_ICONS = {
  0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️',
  45: '🌫', 48: '🌫', 51: '🌦', 53: '🌦', 55: '🌧',
  61: '🌧', 63: '🌧', 65: '🌧', 71: '🌨', 73: '🌨', 75: '🌨',
  80: '🌦', 81: '🌧', 82: '⛈', 95: '⛈', 96: '⛈', 99: '⛈'
};
function weatherIcon(code) { return WMO_ICONS[code] ?? '🌡'; }

// ── Fuel mix colours ───────────────────────────────────────────────────────────
const FUEL_COLORS = {
  natural_gas:       '#60a5fa',
  coal:              '#78716c',
  nuclear:           '#a78bfa',
  hydro:             '#34d399',
  wind:              '#38bdf8',
  solar:             '#fbbf24',
  petroleum:         '#f97316',
  other_renewables:  '#86efac',
  other:             '#d1d5db',
};
const FUEL_LABELS = {
  natural_gas: 'Natural Gas', coal: 'Coal', nuclear: 'Nuclear',
  hydro: 'Hydro', wind: 'Wind', solar: 'Solar',
  petroleum: 'Petroleum', other_renewables: 'Other Renewables', other: 'Other',
};

// ── Custom tooltip for price chart ─────────────────────────────────────────────
function PriceTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 rounded-lg px-3 py-2 text-white text-xs shadow-xl">
      <p className="text-slate-400 mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="font-semibold" style={{ color: p.color }}>
          {p.name}: ${Number(p.value).toFixed(2)}/MWh
        </p>
      ))}
    </div>
  );
}

// ── Fuel mix donut tooltip ─────────────────────────────────────────────────────
function FuelTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="bg-slate-900 rounded-lg px-3 py-2 text-white text-xs shadow-xl">
      <p className="font-semibold">{FUEL_LABELS[d.name] || d.name}</p>
      <p className="text-slate-400">{Number(d.value).toFixed(1)} MW · {d.payload.pct}%</p>
    </div>
  );
}

const REFRESH_INTERVAL_S = 300; // 5 minutes

export default function GridMap() {
  const [selectedRegion, setSelectedRegion] = useState('CAISO');
  const [colorMode,  setColorMode]  = useState('region');
  const [priceMap,   setPriceMap]   = useState({});
  const [carbonMap,  setCarbonMap]  = useState({});
  const [weatherMap, setWeatherMap] = useState({});
  const [history,    setHistory]    = useState([]);
  const [fuelMix,    setFuelMix]    = useState(null);
  const [forecast,   setForecast]   = useState([]);
  const [detailTab,  setDetailTab]  = useState('history'); // 'history' | 'forecast'
  const [globalLoading, setGlobalLoading] = useState(true);
  const [regionLoading, setRegionLoading] = useState(false);

  // Auto-refresh state
  const [lastUpdated,        setLastUpdated]        = useState(null);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(REFRESH_INTERVAL_S);
  const [refreshing,         setRefreshing]         = useState(false);
  const intervalRef    = useRef(null);
  const secondsRef     = useRef(REFRESH_INTERVAL_S); // avoids stale closure in setInterval
  const isFetchingRef  = useRef(false);              // concurrency guard — readable inside setInterval callback

  // Mark onboarding step visited (for Step 10 onboarding checklist)
  useEffect(() => {
    localStorage.setItem('onboarding_map_visited', 'true');
  }, []);

  // Named fetch so it can be called on mount and on refresh
  const fetchAll = useCallback(async ({ initial = false } = {}) => {
    // Prevent concurrent fetches — the ref is readable inside the setInterval closure
    // whereas `refreshing` state would be stale due to the empty useCallback deps array
    if (!initial && isFetchingRef.current) return;
    isFetchingRef.current = true;

    if (initial) setGlobalLoading(true);
    else         setRefreshing(true);

    try {
      // Prices: try batch (1 API call) — fall back to 8 parallel if it fails
      let priceResult;
      try {
        priceResult = await getAllRegionPricesBatch();
      } catch {
        console.warn('[GridMap] Batch prices failed, falling back to parallel requests');
        priceResult = await getAllRegionPrices();
      }
      setPriceMap(priceResult);

      const [c, w] = await Promise.allSettled([
        getAllRegionCarbon(),
        getAllRegionWeather(),
      ]);
      if (c.status === 'fulfilled') setCarbonMap(c.value);
      if (w.status === 'fulfilled') setWeatherMap(w.value);
      setLastUpdated(new Date());
    } finally {
      isFetchingRef.current = false;
      if (initial) setGlobalLoading(false);
      else         setRefreshing(false);
      // Reset countdown after every fetch attempt
      secondsRef.current = REFRESH_INTERVAL_S;
      setSecondsUntilRefresh(REFRESH_INTERVAL_S);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchAll({ initial: true });
  }, [fetchAll]);

  // Countdown timer — ticks every second, triggers fetchAll at 0
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      secondsRef.current -= 1;
      setSecondsUntilRefresh(secondsRef.current);
      if (secondsRef.current <= 0) {
        fetchAll({ initial: false });
      }
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [fetchAll]);

  // Manual refresh — reset countdown and fetch immediately
  function handleManualRefresh() {
    if (refreshing) return;
    fetchAll({ initial: false });
  }

  // Fetch per-region detail when tab changes
  const loadRegionDetail = useCallback(async (region) => {
    setRegionLoading(true);
    setHistory([]);
    setFuelMix(null);
    setForecast([]);
    try {
      const [hist, fuel, fcast] = await Promise.allSettled([
        getRegionPriceHistory(region, 48),
        getRegionFuelMix(region),
        getRegionForecast(region, 48),
      ]);
      if (hist.status === 'fulfilled') {
        setHistory(
          (hist.value || [])
            .filter((r) => r.price_per_mwh != null)
            .slice()
            .reverse()
            .map((r) => ({
              time: new Date(r.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
              price: parseFloat(r.price_per_mwh),
              dayAhead: r.price_day_ahead_mwh ? parseFloat(r.price_day_ahead_mwh) : null,
            }))
        );
      }
      if (fuel.status === 'fulfilled' && fuel.value) {
        setFuelMix(fuel.value);
      }
      if (fcast.status === 'fulfilled') {
        setForecast(
          (fcast.value || [])
            .slice()
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
            .map((r) => ({
              time:     new Date(r.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
              date:     new Date(r.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
              price:    r.price_per_mwh    != null ? parseFloat(r.price_per_mwh)    : null,
              dayAhead: r.price_day_ahead_mwh != null ? parseFloat(r.price_day_ahead_mwh) : null,
            }))
        );
      }
    } finally {
      setRegionLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRegionDetail(selectedRegion);
  }, [selectedRegion, loadRegionDetail]);

  function handleSelectRegion(r) {
    setSelectedRegion(r);
    setDetailTab('history');
  }

  const price   = priceMap[selectedRegion];
  const carbon  = carbonMap[selectedRegion];
  const weather = weatherMap[selectedRegion];
  const col     = REGION_COLORS[selectedRegion];

  // Build fuel mix pie data
  const fuelFields = ['natural_gas','coal','nuclear','hydro','wind','solar','petroleum','other_renewables','other'];
  const totalFuel  = fuelFields.reduce((s, f) => s + (parseFloat(fuelMix?.[f]) || 0), 0);
  const fuelPie    = fuelFields
    .map((f) => ({ name: f, value: parseFloat(fuelMix?.[f]) || 0, pct: totalFuel > 0 ? ((parseFloat(fuelMix?.[f]) || 0) / totalFuel * 100).toFixed(1) : '0.0' }))
    .filter((d) => d.value > 0);

  // Weather current conditions (latest non-forecast row)
  const currentWeather = (Array.isArray(weather) ? weather : []).find((w) => !w.is_forecast) || null;

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Grid Map</h1>
        <p className="text-gray-500 text-sm mt-1">Live data across all 8 US ISO/RTO grid operators.</p>
      </div>

      {/* Region tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {REGIONS.map((r) => {
          const c = REGION_COLORS[r];
          const p = priceMap[r]?.price_per_mwh;
          const isSelected = r === selectedRegion;
          return (
            <button
              key={r}
              onClick={() => handleSelectRegion(r)}
              className={`flex-shrink-0 flex flex-col items-center px-4 py-3 rounded-xl border-2 transition-all duration-200 min-w-[90px] ${
                isSelected
                  ? 'shadow-md'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
              }`}
              style={isSelected ? { borderColor: c.base, background: c.base + '0f' } : {}}
            >
              <span
                className="text-xs font-bold tracking-wide"
                style={{ color: isSelected ? c.base : '#6b7280' }}
              >
                {r}
              </span>
              <span className="text-sm font-semibold text-gray-900 mt-0.5">
                {p != null ? `$${Number(p).toFixed(0)}` : '—'}
              </span>
              <span className="text-xs text-gray-400">/MWh</span>
            </button>
          );
        })}
      </div>

      {/* Live status bar */}
      <div className="flex items-center justify-between text-xs text-gray-400 -mt-2">
        <span>
          {globalLoading
            ? 'Loading data…'
            : lastUpdated
              ? `Last updated ${lastUpdated.toLocaleTimeString()}`
              : 'Fetching…'}
        </span>
        <button
          onClick={handleManualRefresh}
          disabled={refreshing || globalLoading}
          className="flex items-center gap-1.5 text-brand-600 hover:text-brand-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <svg
            className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
          {refreshing
            ? 'Refreshing…'
            : globalLoading
              ? 'Loading…'
              : `Refresh in ${secondsUntilRefresh}s`}
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Map — left side */}
        <div className="xl:col-span-3 card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Click a region to select · scroll to zoom</h2>
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              {[
                { id: 'region', label: 'Regions' },
                { id: 'price',  label: 'Price heat' }
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => setColorMode(m.id)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    colorMode === m.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <USRegionMap
            selectedRegion={selectedRegion}
            onSelectRegion={handleSelectRegion}
            priceData={priceMap}
            carbonData={carbonMap}
            colorMode={colorMode}
          />
        </div>

        {/* Right side — current metrics */}
        <div className="xl:col-span-2 space-y-4">
          {/* Region header */}
          <div className="card p-4" style={{ borderLeftWidth: 4, borderLeftColor: col?.base }}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selectedRegion}</h2>
                <p className="text-xs text-gray-400">Live snapshot</p>
              </div>
              {regionLoading && <Spinner size="sm" />}
            </div>

            {/* Key metrics row */}
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">LMP Price</p>
                <p className="text-lg font-bold text-gray-900">
                  {price?.price_per_mwh != null ? `$${Number(price.price_per_mwh).toFixed(2)}` : '—'}
                </p>
                <p className="text-xs text-gray-400">/MWh</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Day-Ahead</p>
                <p className="text-lg font-bold text-gray-900">
                  {price?.price_day_ahead_mwh != null ? `$${Number(price.price_day_ahead_mwh).toFixed(2)}` : '—'}
                </p>
                <p className="text-xs text-gray-400">/MWh</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Demand</p>
                <p className="text-lg font-bold text-gray-900">
                  {price?.demand_mw != null ? `${Math.round(price.demand_mw).toLocaleString()}` : '—'}
                </p>
                <p className="text-xs text-gray-400">MW</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Net Generation</p>
                <p className="text-lg font-bold text-gray-900">
                  {price?.net_generation_mw != null ? `${Math.round(price.net_generation_mw).toLocaleString()}` : '—'}
                </p>
                <p className="text-xs text-gray-400">MW</p>
              </div>
            </div>
          </div>

          {/* Carbon + Renewable */}
          <div className="card p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Carbon & Renewable</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-gray-500 mb-1">Carbon Intensity</p>
                <p className="text-xl font-bold text-gray-900">
                  {carbon?.carbon_intensity_g_kwh != null ? Number(carbon.carbon_intensity_g_kwh).toFixed(1) : '—'}
                </p>
                <p className="text-xs text-gray-400">g CO₂/kWh</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Renewable %</p>
                <p className="text-xl font-bold text-green-600">
                  {carbon?.renewable_pct != null ? `${Number(carbon.renewable_pct).toFixed(1)}%` : '—'}
                </p>
              </div>
            </div>
            {carbon?.renewable_pct != null && (
              <div className="mt-3">
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className="h-2 rounded-full transition-all duration-700"
                    style={{ width: `${Math.min(carbon.renewable_pct, 100)}%`, background: col?.base }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>0%</span><span>Renewable share</span><span>100%</span>
                </div>
              </div>
            )}
          </div>

          {/* Weather */}
          <div className="card p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">⛅ Weather</h3>
            {currentWeather ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-3xl">{weatherIcon(currentWeather.weather_code)}</span>
                  <div>
                    <p className="text-xl font-bold text-gray-900">
                      {currentWeather.temperature_f != null ? `${Math.round(currentWeather.temperature_f)}°F` : '—'}
                    </p>
                    <p className="text-xs text-gray-400">
                      Feels {currentWeather.feels_like_f != null ? `${Math.round(currentWeather.feels_like_f)}°F` : '—'}
                    </p>
                  </div>
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Wind</span>
                    <span className="font-medium">{currentWeather.wind_speed_mph != null ? `${Math.round(currentWeather.wind_speed_mph)} mph` : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Humidity</span>
                    <span className="font-medium">{currentWeather.humidity_pct != null ? `${Math.round(currentWeather.humidity_pct)}%` : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Solar rad.</span>
                    <span className="font-medium">{currentWeather.solar_radiation_wm2 != null ? `${Math.round(currentWeather.solar_radiation_wm2)} W/m²` : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Precipitation</span>
                    <span className="font-medium">{currentWeather.precipitation_inches != null ? `${Number(currentWeather.precipitation_inches).toFixed(2)}"` : '—'}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">No weather data available.</p>
            )}
          </div>
        </div>
      </div>

      {/* Price History / Forecast tabbed chart */}
      <div className="card p-5">
        {/* Tab header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            {[
              { id: 'history',  label: 'Price History',    icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
              { id: 'forecast', label: '48h Forecast',     icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setDetailTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  detailTab === tab.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
                </svg>
                {tab.label}
              </button>
            ))}
          </div>

          <div className="text-right">
            <p className="text-sm font-semibold text-gray-900">{selectedRegion}</p>
            <p className="text-xs text-gray-400">
              {detailTab === 'history' ? 'Last 48 hours · real-time & day-ahead' : 'Next 48 hours · day-ahead based'}
            </p>
          </div>
        </div>

        {/* History chart */}
        {detailTab === 'history' && (
          history.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={history} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="rtGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={col?.base} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={col?.base} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={5} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                <Tooltip content={<PriceTooltip />} />
                <Area type="monotone" dataKey="price" name="Real-time" stroke={col?.base} strokeWidth={2} fill="url(#rtGrad)" dot={false} />
                {history.some((h) => h.dayAhead != null) && (
                  <Line type="monotone" dataKey="dayAhead" name="Day-Ahead" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                )}
              </AreaChart>
            </ResponsiveContainer>
          ) : regionLoading ? (
            <div className="h-56 flex items-center justify-center"><Spinner /></div>
          ) : (
            <div className="h-56 flex items-center justify-center text-gray-400 text-sm">No price history available.</div>
          )
        )}

        {/* Forecast chart */}
        {detailTab === 'forecast' && (
          forecast.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={forecast} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fcastGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    interval={Math.max(1, Math.floor(forecast.length / 8))}
                  />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                  <Tooltip content={<PriceTooltip />} />
                  {/* Real-time forecast band */}
                  {forecast.some((f) => f.price != null) && (
                    <Area
                      type="monotone"
                      dataKey="price"
                      name="RT Forecast"
                      stroke="#6366f1"
                      strokeWidth={2}
                      strokeDasharray="5 3"
                      fill="url(#fcastGrad)"
                      dot={false}
                      connectNulls
                    />
                  )}
                  {/* Day-ahead forecast line */}
                  {forecast.some((f) => f.dayAhead != null) && (
                    <Line
                      type="monotone"
                      dataKey="dayAhead"
                      name="DA Forecast"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>

              {/* Legend + data key */}
              <div className="flex items-center gap-5 mt-3 text-xs text-gray-500">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-6 border-t-2 border-indigo-500 border-dashed" />
                  RT Forecast
                </span>
                {forecast.some((f) => f.dayAhead != null) && (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-6 border-t-2 border-amber-400" />
                    Day-Ahead
                  </span>
                )}
                <span className="ml-auto italic text-gray-400">Forecasts are model-based estimates, not guaranteed prices.</span>
              </div>

              {/* Compact table — first 12 hours */}
              <div className="mt-4 border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Next 12 hours</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-100">
                        <th className="pb-1.5 font-medium">Date</th>
                        <th className="pb-1.5 font-medium">Time</th>
                        <th className="pb-1.5 font-medium text-right">RT Forecast</th>
                        <th className="pb-1.5 font-medium text-right">Day-Ahead</th>
                      </tr>
                    </thead>
                    <tbody>
                      {forecast.slice(0, 12).map((row, i) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-1.5 text-gray-500">{row.date}</td>
                          <td className="py-1.5 font-medium text-gray-700">{row.time}</td>
                          <td className="py-1.5 text-right font-mono text-indigo-700">
                            {row.price != null ? `$${Number(row.price).toFixed(2)}` : '—'}
                          </td>
                          <td className="py-1.5 text-right font-mono text-amber-600">
                            {row.dayAhead != null ? `$${Number(row.dayAhead).toFixed(2)}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : regionLoading ? (
            <div className="h-56 flex items-center justify-center"><Spinner /></div>
          ) : (
            <div className="h-56 flex items-center justify-center text-gray-400 text-sm">
              No forecast data available for {selectedRegion}.
            </div>
          )
        )}
      </div>

      {/* Fuel mix + weather forecast */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Fuel mix donut */}
        <div className="card p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Generation Mix — {selectedRegion}</h2>
          <p className="text-xs text-gray-400 mb-4">Current fuel type breakdown</p>
          {fuelPie.length > 0 ? (
            <div className="flex items-center gap-4">
              <PieChart width={160} height={160}>
                <Pie data={fuelPie} cx={75} cy={75} innerRadius={45} outerRadius={72} dataKey="value" paddingAngle={2}>
                  {fuelPie.map((entry) => (
                    <Cell key={entry.name} fill={FUEL_COLORS[entry.name] || '#d1d5db'} />
                  ))}
                </Pie>
                <Tooltip content={<FuelTooltip />} />
              </PieChart>
              <div className="flex-1 space-y-1.5 text-xs">
                {fuelPie.map((f) => (
                  <div key={f.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: FUEL_COLORS[f.name] || '#d1d5db' }} />
                      <span className="text-gray-700">{FUEL_LABELS[f.name] || f.name}</span>
                    </div>
                    <span className="font-medium text-gray-900">{f.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : regionLoading ? (
            <div className="h-40 flex items-center justify-center"><Spinner /></div>
          ) : (
            <div className="h-40 flex items-center justify-center text-gray-400 text-sm">No fuel mix data.</div>
          )}

          {fuelMix && (
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-gray-100 pt-4 text-xs text-gray-600">
              <div>Renewable total: <strong className="text-green-600">{fuelMix.renewable_total_pct != null ? `${Number(fuelMix.renewable_total_pct).toFixed(1)}%` : '—'}</strong></div>
              <div>Clean total: <strong className="text-blue-600">{fuelMix.clean_total_pct != null ? `${Number(fuelMix.clean_total_pct).toFixed(1)}%` : '—'}</strong></div>
            </div>
          )}
        </div>

        {/* Weather forecast table */}
        <div className="card p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Weather Forecast — {selectedRegion}</h2>
          <p className="text-xs text-gray-400 mb-4">Next 24 hours · hourly</p>
          {Array.isArray(weather) && weather.filter((w) => w.is_forecast).length > 0 ? (
            <div className="overflow-y-auto max-h-52">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100">
                    <th className="pb-2 font-medium">Time</th>
                    <th className="pb-2 font-medium">Cond.</th>
                    <th className="pb-2 font-medium">Temp</th>
                    <th className="pb-2 font-medium">Wind</th>
                    <th className="pb-2 font-medium">Solar</th>
                    <th className="pb-2 font-medium">Precip.</th>
                  </tr>
                </thead>
                <tbody>
                  {weather.filter((w) => w.is_forecast).slice(0, 24).map((w, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-1.5 text-gray-600">
                        {new Date(w.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-1.5">{weatherIcon(w.weather_code)}</td>
                      <td className="py-1.5 font-medium">{w.temperature_f != null ? `${Math.round(w.temperature_f)}°F` : '—'}</td>
                      <td className="py-1.5">{w.wind_speed_mph != null ? `${Math.round(w.wind_speed_mph)} mph` : '—'}</td>
                      <td className="py-1.5">{w.solar_radiation_wm2 != null ? `${Math.round(w.solar_radiation_wm2)} W/m²` : '—'}</td>
                      <td className="py-1.5">{w.precipitation_inches != null ? `${Number(w.precipitation_inches).toFixed(2)}"` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-52 flex items-center justify-center text-gray-400 text-sm">No forecast data available.</div>
          )}
        </div>
      </div>
    </div>
  );
}
