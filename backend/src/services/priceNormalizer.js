'use strict';

// EPA emission factors in lbs CO2 per MWh of generation
const EPA_EMISSION_FACTORS_LBS_MWH = {
  natural_gas: 897,
  coal: 2249,
  nuclear: 0,
  wind: 0,
  solar: 0,
  hydro: 0,
  battery_storage: 0,
  petroleum: 1672,
  other_renewables: 0,
  other: 1100  // conservative estimate for unknown sources
};

// Map every source's raw fuel label to our unified fuel key
const FUEL_TYPE_MAP = {
  // EIA API codes
  'NG': 'natural_gas', 'COL': 'coal', 'NUC': 'nuclear',
  'WAT': 'hydro', 'WND': 'wind', 'SUN': 'solar',
  'OIL': 'petroleum', 'OTH': 'other', 'GEO': 'other_renewables',
  'BIO': 'other_renewables', 'WAS': 'other', 'LIG': 'coal',

  // CAISO labels
  'Natural Gas': 'natural_gas', 'Coal': 'coal', 'Nuclear': 'nuclear',
  'Large Hydro': 'hydro', 'Small Hydro': 'hydro', 'Wind': 'wind',
  'Solar': 'solar', 'Batteries': 'battery_storage',
  'Geothermal': 'other_renewables', 'Biomass': 'other_renewables',
  'Biogas': 'other_renewables', 'Other Imports': 'other',
  'Imports': 'other',

  // ERCOT labels
  'Gas': 'natural_gas', 'Gas-CC': 'natural_gas', 'Gas-CT': 'natural_gas',
  'Hydro': 'hydro', 'Lignite': 'coal', 'Other': 'other',
  'Thermal': 'other', 'Wind': 'wind', 'Solar': 'solar',
  'Nuclear': 'nuclear',

  // MISO labels
  'Natural Gas': 'natural_gas', 'Coal': 'coal', 'Nuclear': 'nuclear',
  'Wind': 'wind', 'Solar': 'solar', 'Hydro': 'hydro',
  'Other': 'other', 'Storage': 'battery_storage',

  // PJM labels
  'Gas': 'natural_gas', 'Coal': 'coal', 'Nuclear': 'nuclear',
  'Wind': 'wind', 'Solar': 'solar', 'Hydro': 'hydro',
  'Oil': 'petroleum', 'Other': 'other', 'Storage': 'battery_storage',
  'Multiple Fuels': 'other',

  // NYISO labels
  'Natural Gas': 'natural_gas', 'Dual Fuel': 'natural_gas',
  'Nuclear': 'nuclear', 'Hydro': 'hydro', 'Wind': 'wind',
  'Other Fossil Fuels': 'petroleum', 'Other Renewables': 'other_renewables',
  'Solar': 'solar',

  // ISO-NE labels
  'Natural Gas': 'natural_gas', 'Coal': 'coal', 'Nuclear': 'nuclear',
  'Hydro': 'hydro', 'Wind': 'wind', 'Solar': 'solar',
  'Oil': 'petroleum', 'Wood': 'other_renewables', 'Refuse': 'other',
  'Landfill Gas': 'other_renewables', 'Other': 'other'
};

/**
 * Normalize a raw fuel label to our unified fuel key.
 * Falls back to 'other' for unknown labels.
 */
function normalizeFuelLabel(rawLabel) {
  if (!rawLabel) return 'other';
  return FUEL_TYPE_MAP[rawLabel] || FUEL_TYPE_MAP[rawLabel.trim()] || 'other';
}

/**
 * Build a fuel_mix row from a map of { fuelKey: mw } values.
 * Calculates all percentages and derived totals.
 */
function normalizeFuelMix(regionCode, timestamp, fuelMwMap, source) {
  const FUEL_KEYS = [
    'natural_gas', 'coal', 'nuclear', 'wind', 'solar',
    'hydro', 'battery_storage', 'petroleum', 'other_renewables', 'other'
  ];

  const mw = {};
  for (const key of FUEL_KEYS) {
    mw[key] = Math.max(0, parseFloat(fuelMwMap[key] || 0));
  }

  const total = FUEL_KEYS.reduce((sum, k) => sum + mw[k], 0);

  const pct = {};
  for (const key of FUEL_KEYS) {
    pct[key] = total > 0 ? (mw[key] / total) * 100 : 0;
  }

  const renewablePct = pct.wind + pct.solar + pct.hydro + pct.other_renewables;
  const cleanPct = renewablePct + pct.nuclear;

  return {
    region_code: regionCode,
    timestamp: timestamp instanceof Date ? timestamp : new Date(timestamp),
    natural_gas_mw: mw.natural_gas,
    natural_gas_pct: pct.natural_gas,
    coal_mw: mw.coal,
    coal_pct: pct.coal,
    nuclear_mw: mw.nuclear,
    nuclear_pct: pct.nuclear,
    wind_mw: mw.wind,
    wind_pct: pct.wind,
    solar_mw: mw.solar,
    solar_pct: pct.solar,
    hydro_mw: mw.hydro,
    hydro_pct: pct.hydro,
    battery_storage_mw: mw.battery_storage,
    battery_storage_pct: pct.battery_storage,
    petroleum_mw: mw.petroleum,
    petroleum_pct: pct.petroleum,
    other_renewables_mw: mw.other_renewables,
    other_renewables_pct: pct.other_renewables,
    other_mw: mw.other,
    other_pct: pct.other,
    total_generation_mw: total,
    renewable_total_pct: renewablePct,
    clean_total_pct: cleanPct,
    source
  };
}

/**
 * Calculate carbon intensity from a fuel mix row.
 * Returns a carbon_intensity row ready for DB insert.
 */
function normalizeCarbonIntensity(regionCode, timestamp, fuelMix, source) {
  const total = fuelMix.total_generation_mw || 0;
  if (total === 0) return null;

  const FUEL_KEYS = [
    'natural_gas', 'coal', 'nuclear', 'wind', 'solar',
    'hydro', 'battery_storage', 'petroleum', 'other_renewables', 'other'
  ];

  let totalLbsCo2 = 0;
  for (const key of FUEL_KEYS) {
    const mw = parseFloat(fuelMix[`${key}_mw`] || 0);
    const factor = EPA_EMISSION_FACTORS_LBS_MWH[key] || 0;
    totalLbsCo2 += mw * factor;
  }

  const lbsPerMwh = totalLbsCo2 / total;
  const gramsPerKwh = lbsPerMwh * 453.592 / 1000;
  const kgPerMwh = gramsPerKwh;

  let category;
  if (gramsPerKwh < 100) category = 'very_low';
  else if (gramsPerKwh < 200) category = 'low';
  else if (gramsPerKwh < 400) category = 'medium';
  else if (gramsPerKwh < 600) category = 'high';
  else category = 'very_high';

  return {
    region_code: regionCode,
    timestamp: timestamp instanceof Date ? timestamp : new Date(timestamp),
    co2_lbs_per_mwh: parseFloat(lbsPerMwh.toFixed(4)),
    co2_grams_per_kwh: parseFloat(gramsPerKwh.toFixed(4)),
    co2_kg_per_mwh: parseFloat(kgPerMwh.toFixed(4)),
    renewable_percentage: fuelMix.renewable_total_pct || 0,
    clean_energy_percentage: fuelMix.clean_total_pct || 0,
    intensity_category: category,
    calculation_method: 'fuel_mix_weighted',
    source
  };
}

/**
 * Normalize a raw price record into the energy_prices schema.
 */
function normalizeEnergyPrice({
  regionCode,
  timestamp,
  pricePerMwh,
  priceDayAheadMwh = null,
  priceEnergyComponent = null,
  priceCongestionComponent = null,
  priceLossComponent = null,
  priceType,
  pricingNode = null,
  demandMw = null,
  demandForecastMw = null,
  netGenerationMw = null,
  interchangeMw = null,
  frequencyHz = null,
  source,
  rawData = null,
  isEstimated = false
}) {
  return {
    region_code: regionCode,
    timestamp: timestamp instanceof Date ? timestamp : new Date(timestamp),
    price_per_mwh: pricePerMwh != null ? parseFloat(pricePerMwh) : null,
    price_day_ahead_mwh: priceDayAheadMwh != null ? parseFloat(priceDayAheadMwh) : null,
    price_energy_component: priceEnergyComponent != null ? parseFloat(priceEnergyComponent) : null,
    price_congestion_component: priceCongestionComponent != null ? parseFloat(priceCongestionComponent) : null,
    price_loss_component: priceLossComponent != null ? parseFloat(priceLossComponent) : null,
    price_type: priceType,
    pricing_node: pricingNode,
    demand_mw: demandMw != null ? parseFloat(demandMw) : null,
    demand_forecast_mw: demandForecastMw != null ? parseFloat(demandForecastMw) : null,
    net_generation_mw: netGenerationMw != null ? parseFloat(netGenerationMw) : null,
    interchange_mw: interchangeMw != null ? parseFloat(interchangeMw) : null,
    frequency_hz: frequencyHz != null ? parseFloat(frequencyHz) : null,
    source,
    raw_data: rawData ? JSON.stringify(rawData) : null,
    is_estimated: isEstimated
  };
}

module.exports = {
  normalizeFuelLabel,
  normalizeFuelMix,
  normalizeCarbonIntensity,
  normalizeEnergyPrice,
  FUEL_TYPE_MAP,
  EPA_EMISSION_FACTORS_LBS_MWH
};
