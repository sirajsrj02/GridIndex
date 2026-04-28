import React, { useState, useCallback } from 'react';
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
  Annotation
} from 'react-simple-maps';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';

const STATE_TO_ISO = {
  'California':    'CAISO',
  'Texas':         'ERCOT',
  'Pennsylvania':  'PJM',  'New Jersey':    'PJM',  'Maryland':    'PJM',
  'Delaware':      'PJM',  'Ohio':          'PJM',  'Indiana':     'PJM',
  'West Virginia': 'PJM',  'Virginia':      'PJM',  'Michigan':    'PJM',
  'Illinois':      'MISO', 'Wisconsin':     'MISO', 'Minnesota':   'MISO',
  'Iowa':          'MISO', 'Missouri':      'MISO', 'North Dakota':'MISO',
  'South Dakota':  'MISO', 'Montana':       'MISO', 'Mississippi': 'MISO',
  'Arkansas':      'MISO', 'Louisiana':     'MISO',
  'New York':      'NYISO',
  'Connecticut':   'ISONE','Massachusetts': 'ISONE','Maine':       'ISONE',
  'New Hampshire': 'ISONE','Rhode Island':  'ISONE','Vermont':     'ISONE',
  'Kansas':        'SPP',  'Oklahoma':      'SPP',  'Nebraska':    'SPP',
  'Oregon':        'WECC', 'Washington':    'WECC', 'Idaho':       'WECC',
  'Nevada':        'WECC', 'Arizona':       'WECC', 'New Mexico':  'WECC',
  'Colorado':      'WECC', 'Utah':          'WECC', 'Wyoming':     'WECC',
};

export const REGION_COLORS = {
  CAISO: { base: '#3b82f6', light: '#bfdbfe', label: '#1d4ed8' },
  ERCOT: { base: '#10b981', light: '#a7f3d0', label: '#065f46' },
  PJM:   { base: '#8b5cf6', light: '#ddd6fe', label: '#5b21b6' },
  MISO:  { base: '#f59e0b', light: '#fde68a', label: '#92400e' },
  NYISO: { base: '#ec4899', light: '#fbcfe8', label: '#9d174d' },
  ISONE: { base: '#06b6d4', light: '#a5f3fc', label: '#0e7490' },
  SPP:   { base: '#f97316', light: '#fed7aa', label: '#9a3412' },
  WECC:  { base: '#84cc16', light: '#d9f99d', label: '#3f6212' },
};

const REGION_ANNOTATIONS = [
  { iso: 'CAISO', x: -119.5, y: 37.0  },
  { iso: 'ERCOT', x: -99.0,  y: 31.0  },
  { iso: 'PJM',   x: -79.5,  y: 39.5  },
  { iso: 'MISO',  x: -91.0,  y: 43.5  },
  { iso: 'NYISO', x: -75.5,  y: 43.0  },
  { iso: 'ISONE', x: -71.5,  y: 44.5  },
  { iso: 'SPP',   x: -98.5,  y: 37.5  },
  { iso: 'WECC',  x: -111.0, y: 40.5  },
];

// Map a 0-1 value to a green→yellow→red color
function heatColor(t) {
  // 0 = green (#22c55e), 0.5 = yellow (#f59e0b), 1.0 = red (#ef4444)
  if (t <= 0.5) {
    const r = Math.round(34  + (245 - 34)  * (t * 2));
    const g = Math.round(197 + (158 - 197) * (t * 2));
    const b = Math.round(94  + (11  - 94)  * (t * 2));
    return `rgb(${r},${g},${b})`;
  } else {
    const u = (t - 0.5) * 2;
    const r = Math.round(245 + (239 - 245) * u);
    const g = Math.round(158 + (68  - 158) * u);
    const b = Math.round(11  + (68  - 11)  * u);
    return `rgb(${r},${g},${b})`;
  }
}

function priceToHeat(price, minP, maxP) {
  if (price == null || maxP === minP) return 0.5;
  return Math.max(0, Math.min(1, (price - minP) / (maxP - minP)));
}

function GradientLegend({ min, max }) {
  const steps = 5;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold text-gray-600 mb-1">Price ($/MWh)</p>
      <div className="flex items-stretch gap-1 h-4">
        {Array.from({ length: 40 }).map((_, i) => (
          <div key={i} className="flex-1 rounded-sm" style={{ background: heatColor(i / 39) }} />
        ))}
      </div>
      <div className="flex justify-between text-xs text-gray-500">
        <span className="text-green-600 font-medium">${min >= 0 ? min.toFixed(0) : min.toFixed(0)}</span>
        <span className="text-gray-500">${((min + max) / 2).toFixed(0)}</span>
        <span className="text-red-500 font-medium">${max.toFixed(0)}</span>
      </div>
    </div>
  );
}

export default function USRegionMap({ selectedRegion, onSelectRegion, priceData = {}, carbonData = {}, colorMode = 'region' }) {
  const [position, setPosition] = useState({ coordinates: [-97, 38], zoom: 1 });
  const [tooltip,  setTooltip]  = useState(null);

  // Compute price range for heat map
  const prices    = Object.entries(priceData).map(([, v]) => v?.price_per_mwh).filter((p) => p != null).map(Number);
  const minPrice  = prices.length ? Math.min(...prices) : 0;
  const maxPrice  = prices.length ? Math.max(...prices) : 200;

  const handleMove = useCallback((pos) => setPosition(pos), []);

  function getIso(geo)  { return STATE_TO_ISO[geo.properties.name] || null; }

  function getFill(iso) {
    if (!iso) return '#e2e8f0';
    const col = REGION_COLORS[iso];
    if (!col) return '#e2e8f0';

    if (colorMode === 'price') {
      const p = priceData[iso]?.price_per_mwh;
      if (p == null) return '#e2e8f0';
      const t = priceToHeat(Number(p), minPrice, maxPrice);
      const base = heatColor(t);
      if (selectedRegion && selectedRegion !== iso) return base + '88';
      return base;
    }

    // Region identity mode
    if (selectedRegion && selectedRegion !== iso) return col.light;
    return col.base;
  }

  function getStroke(iso) {
    if (!iso) return '#cbd5e1';
    return selectedRegion === iso ? '#1e293b' : '#ffffff';
  }

  function fmtPrice(iso) {
    const p = priceData[iso]?.price_per_mwh;
    return p != null ? `$${Number(p).toFixed(2)}/MWh` : 'No price data';
  }
  function fmtCarbon(iso) {
    const c = carbonData[iso]?.carbon_intensity_g_kwh;
    return c != null ? `${Number(c).toFixed(1)} g CO₂/kWh` : null;
  }
  function fmtRenewable(iso) {
    const r = carbonData[iso]?.renewable_pct;
    return r != null ? `${Number(r).toFixed(1)}% renewable` : null;
  }

  return (
    <div className="relative w-full select-none">
      {/* Zoom controls */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
        <button
          onClick={() => setPosition((p) => ({ ...p, zoom: Math.min(p.zoom * 1.5, 8) }))}
          className="w-8 h-8 rounded-lg bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-600 hover:bg-gray-50 text-lg font-bold"
          title="Zoom in"
        >+</button>
        <button
          onClick={() => setPosition((p) => ({ ...p, zoom: Math.max(p.zoom / 1.5, 1) }))}
          className="w-8 h-8 rounded-lg bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-600 hover:bg-gray-50 text-lg font-bold"
          title="Zoom out"
        >−</button>
        <button
          onClick={() => setPosition({ coordinates: [-97, 38], zoom: 1 })}
          className="w-8 h-8 rounded-lg bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-500 hover:bg-gray-50 text-xs font-medium"
          title="Reset view"
        >⌂</button>
      </div>

      <ComposableMap
        projection="geoAlbersUsa"
        projectionConfig={{ scale: 900 }}
        className="w-full h-auto"
        style={{ outline: 'none' }}
      >
        <ZoomableGroup
          zoom={position.zoom}
          center={position.coordinates}
          onMoveEnd={handleMove}
          minZoom={1}
          maxZoom={8}
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const iso = getIso(geo);
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={getFill(iso)}
                    stroke={getStroke(iso)}
                    strokeWidth={0.5 / position.zoom}
                    style={{
                      default: { outline: 'none', cursor: iso ? 'pointer' : 'default', transition: 'fill 0.25s ease' },
                      hover:   { outline: 'none', opacity: 0.8 },
                      pressed: { outline: 'none' },
                    }}
                    onClick={() => iso && onSelectRegion && onSelectRegion(iso)}
                    onMouseEnter={(e) => {
                      if (!iso) return;
                      setTooltip({ name: geo.properties.name, iso, x: e.clientX, y: e.clientY });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                );
              })
            }
          </Geographies>

          {/* Region labels — only show when zoomed out enough */}
          {position.zoom < 3 && REGION_ANNOTATIONS.map(({ iso, x, y }) => (
            <Annotation key={iso} subject={[x, y]} dx={0} dy={0} connectorProps={{ stroke: 'none' }}>
              <text
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 9 / position.zoom,
                  fontWeight: 700,
                  fill: selectedRegion && selectedRegion !== iso ? '#94a3b8' : '#1e293b',
                  pointerEvents: 'none',
                  transition: 'fill 0.2s',
                }}
              >
                {iso}
              </text>
            </Annotation>
          ))}
        </ZoomableGroup>
      </ComposableMap>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{ left: tooltip.x + 14, top: tooltip.y - 56 }}
        >
          <div className="bg-slate-900 text-white text-xs rounded-xl px-3 py-2.5 shadow-2xl min-w-[160px]">
            <p className="font-bold text-white mb-1">{tooltip.iso} · {tooltip.name}</p>
            <p className="text-slate-300">{fmtPrice(tooltip.iso)}</p>
            {fmtCarbon(tooltip.iso)  && <p className="text-slate-400 text-[10px] mt-0.5">{fmtCarbon(tooltip.iso)}</p>}
            {fmtRenewable(tooltip.iso) && <p className="text-green-400 text-[10px]">{fmtRenewable(tooltip.iso)}</p>}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 space-y-3 px-1">
        {colorMode === 'price' && prices.length > 0 ? (
          <GradientLegend min={minPrice} max={maxPrice} />
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {Object.entries(REGION_COLORS).map(([iso, col]) => {
              const p = priceData[iso]?.price_per_mwh;
              return (
                <button
                  key={iso}
                  onClick={() => onSelectRegion && onSelectRegion(iso)}
                  className={`flex items-center gap-1.5 text-xs font-medium transition-opacity ${
                    selectedRegion && selectedRegion !== iso ? 'opacity-40' : 'opacity-100'
                  }`}
                >
                  <span className="w-3 h-3 rounded-sm" style={{ background: col.base }} />
                  <span>{iso}</span>
                  {p != null && (
                    <span className="text-gray-400 font-normal">${Number(p).toFixed(0)}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <p className="text-xs text-gray-400">Scroll or pinch to zoom · Drag to pan · Click a region to select</p>
      </div>
    </div>
  );
}
