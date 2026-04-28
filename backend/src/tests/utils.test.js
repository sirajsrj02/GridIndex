'use strict';

/**
 * Unit tests for pure utility functions.
 * No mocking needed — these have zero external dependencies.
 */

const { parseEIAPeriod, eiaParams } = require('../utils/eiaHelpers');
const { EIA_REGION_MAP, STATE_TO_REGION } = require('../jobs/pollEIA');
const {
  safeNumeric,
  normalizeFuelMix,
  normalizeCarbonIntensity,
  normalizeEnergyPrice,
  normalizeFuelLabel
} = require('../services/priceNormalizer');

// ─────────────────────────── parseEIAPeriod ───────────────────────────────────

describe('parseEIAPeriod', () => {
  it('parses hourly format "2025-04-23T14" as 14:00 UTC', () => {
    const d = parseEIAPeriod('2025-04-23T14');
    expect(d).toBeInstanceOf(Date);
    expect(isNaN(d.getTime())).toBe(false);
    expect(d.getUTCFullYear()).toBe(2025);
    expect(d.getUTCMonth()).toBe(3);   // April = index 3
    expect(d.getUTCDate()).toBe(23);
    expect(d.getUTCHours()).toBe(14);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
  });

  it('parses hourly format hour 00 correctly', () => {
    const d = parseEIAPeriod('2025-01-01T00');
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCDate()).toBe(1);
  });

  it('parses daily format "2025-04-23" as midnight UTC', () => {
    const d = parseEIAPeriod('2025-04-23');
    expect(d).toBeInstanceOf(Date);
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCDate()).toBe(23);
  });

  it('parses monthly format "2025-04" as the 1st of the month', () => {
    const d = parseEIAPeriod('2025-04');
    expect(d).toBeInstanceOf(Date);
    expect(d.getUTCMonth()).toBe(3);  // April
    expect(d.getUTCDate()).toBe(1);
  });

  it('parses annual format "2025" as Jan 1', () => {
    const d = parseEIAPeriod('2025');
    expect(d).toBeInstanceOf(Date);
    expect(d.getUTCMonth()).toBe(0);
    expect(d.getUTCDate()).toBe(1);
    expect(d.getUTCFullYear()).toBe(2025);
  });

  it('returns null for null input', () => {
    expect(parseEIAPeriod(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseEIAPeriod(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseEIAPeriod('')).toBeNull();
  });

  it('returns null for completely invalid strings', () => {
    expect(parseEIAPeriod('not-a-date')).toBeNull();
    expect(parseEIAPeriod('hello')).toBeNull();
    // '2025/04/23' is deliberately omitted — V8 on macOS accepts slash-separated
    // dates via the native Date constructor (platform behaviour, not a code bug).
  });

  it('returns null for out-of-range date components', () => {
    // The format regex matches "2025-99-99" (just checks digit count), but the
    // resulting Date is Invalid Date. parseEIAPeriod must return null for these.
    expect(parseEIAPeriod('2025-99-99')).toBeNull();  // invalid month/day
    expect(parseEIAPeriod('2025-04-99')).toBeNull();  // valid month, invalid day
  });

  it('falls back to native Date for full ISO 8601 strings', () => {
    const d = parseEIAPeriod('2025-04-23T14:30:00Z');
    expect(d).toBeInstanceOf(Date);
    expect(d.getUTCHours()).toBe(14);
    expect(d.getUTCMinutes()).toBe(30);
  });
});

// ─────────────────────────── eiaParams ────────────────────────────────────────

describe('eiaParams', () => {
  it('serializes array params with indexed bracket notation', () => {
    const qs = eiaParams({ 'data[]': ['value', 'peak'] });
    expect(qs).toContain('data[0]=value');
    expect(qs).toContain('data[1]=peak');
    expect(qs).not.toContain('data[]=');
  });

  it('serializes nested facet array params', () => {
    const qs = eiaParams({ 'facets[type][]': ['D', 'DF'] });
    expect(qs).toContain('facets[type][0]=D');
    expect(qs).toContain('facets[type][1]=DF');
  });

  it('serializes scalar (non-array) params', () => {
    const qs = eiaParams({ frequency: 'hourly', length: 100, offset: 0 });
    expect(qs).toContain('frequency=hourly');
    expect(qs).toContain('length=100');
    expect(qs).toContain('offset=0');
  });

  it('skips null and undefined values within arrays', () => {
    const qs = eiaParams({ 'data[]': ['value', null, undefined, 'peak'] });
    // null and undefined are skipped, indices are contiguous
    expect(qs).toContain('data[0]=value');
    expect(qs).toContain('data[1]=peak');
    expect(qs).not.toContain('null');
    expect(qs).not.toContain('undefined');
  });

  it('URL-encodes special characters in values', () => {
    const qs = eiaParams({ key: 'hello world' });
    expect(qs).toContain('key=hello%20world');
  });

  it('does NOT percent-encode bracket characters in keys', () => {
    const qs = eiaParams({ 'data[]': ['value'] });
    expect(qs).not.toContain('%5B');
    expect(qs).not.toContain('%5D');
    expect(qs).toContain('[0]');
  });
});

// ─────────────────────────── safeNumeric ──────────────────────────────────────

describe('safeNumeric', () => {
  it('returns the numeric value when no bounds are specified', () => {
    expect(safeNumeric(42)).toBe(42);
    expect(safeNumeric(0)).toBe(0);
    expect(safeNumeric(-99)).toBe(-99);
  });

  it('parses string numbers', () => {
    expect(safeNumeric('99.5')).toBe(99.5);
    expect(safeNumeric('0')).toBe(0);
  });

  it('returns null for NaN inputs', () => {
    expect(safeNumeric(NaN)).toBeNull();
    expect(safeNumeric('abc')).toBeNull();
    expect(safeNumeric('')).toBeNull();
  });

  it('returns null for null and undefined', () => {
    expect(safeNumeric(null)).toBeNull();
    expect(safeNumeric(undefined)).toBeNull();
  });

  it('returns null for Infinity', () => {
    expect(safeNumeric(Infinity)).toBeNull();
    expect(safeNumeric(-Infinity)).toBeNull();
  });

  it('enforces minimum bound (exclusive: value < min → null)', () => {
    expect(safeNumeric(-1, 0, 100)).toBeNull();
    expect(safeNumeric(0, 0, 100)).toBe(0);   // equal to min is ok
  });

  it('enforces maximum bound (exclusive: value > max → null)', () => {
    expect(safeNumeric(101, 0, 100)).toBeNull();
    expect(safeNumeric(100, 0, 100)).toBe(100);  // equal to max is ok
  });

  it('accepts valid energy prices (within -500..10000)', () => {
    expect(safeNumeric(250, -500, 10000)).toBe(250);
    expect(safeNumeric(-200, -500, 10000)).toBe(-200);   // negative prices are valid
    expect(safeNumeric(0, -500, 10000)).toBe(0);
  });

  it('rejects implausible energy prices', () => {
    expect(safeNumeric(-600, -500, 10000)).toBeNull();   // below floor
    expect(safeNumeric(15000, -500, 10000)).toBeNull();  // above ceiling
  });

  it('rejects negative demand (min=0)', () => {
    expect(safeNumeric(-500, 0, 1000000)).toBeNull();
  });
});

// ─────────────────────────── normalizeFuelLabel ───────────────────────────────

describe('normalizeFuelLabel', () => {
  it('maps EIA fuel codes correctly', () => {
    expect(normalizeFuelLabel('NG')).toBe('natural_gas');
    expect(normalizeFuelLabel('COL')).toBe('coal');
    expect(normalizeFuelLabel('NUC')).toBe('nuclear');
    expect(normalizeFuelLabel('WND')).toBe('wind');
    expect(normalizeFuelLabel('SUN')).toBe('solar');
    expect(normalizeFuelLabel('WAT')).toBe('hydro');
  });

  it('maps CAISO labels correctly', () => {
    expect(normalizeFuelLabel('Natural Gas')).toBe('natural_gas');
    expect(normalizeFuelLabel('Large Hydro')).toBe('hydro');
    expect(normalizeFuelLabel('Batteries')).toBe('battery_storage');
  });

  it('maps ERCOT labels correctly', () => {
    expect(normalizeFuelLabel('Gas')).toBe('natural_gas');
    expect(normalizeFuelLabel('Lignite')).toBe('coal');
  });

  it('falls back to "other" for unknown labels', () => {
    expect(normalizeFuelLabel('Unknown Source')).toBe('other');
    expect(normalizeFuelLabel('')).toBe('other');
    expect(normalizeFuelLabel(null)).toBe('other');
  });
});

// ─────────────────────────── normalizeFuelMix ─────────────────────────────────

describe('normalizeFuelMix', () => {
  const ts = new Date('2025-04-25T12:00:00Z');

  it('calculates totals and percentages correctly', () => {
    const result = normalizeFuelMix('CAISO', ts, {
      natural_gas: 5000, wind: 2000, solar: 3000
    }, 'EIA');

    expect(result.natural_gas_mw).toBe(5000);
    expect(result.wind_mw).toBe(2000);
    expect(result.solar_mw).toBe(3000);
    expect(result.total_generation_mw).toBe(10000);
    expect(result.natural_gas_pct).toBeCloseTo(50, 5);
    expect(result.wind_pct).toBeCloseTo(20, 5);
    expect(result.solar_pct).toBeCloseTo(30, 5);
  });

  it('calculates renewable and clean percentages correctly', () => {
    // nuclear=4000, wind=3000, solar=2000, hydro=1000 → total=10000
    const result = normalizeFuelMix('CAISO', ts, {
      nuclear: 4000, wind: 3000, solar: 2000, hydro: 1000
    }, 'EIA');

    // renewable = wind+solar+hydro = 30+20+10 = 60%
    expect(result.renewable_total_pct).toBeCloseTo(60, 5);
    // clean = renewable + nuclear = 60 + 40 = 100%
    expect(result.clean_total_pct).toBeCloseTo(100, 5);
  });

  it('returns all-zero percentages when total generation is 0', () => {
    const result = normalizeFuelMix('CAISO', ts, {}, 'EIA');
    expect(result.total_generation_mw).toBe(0);
    expect(result.natural_gas_pct).toBe(0);
    expect(result.renewable_total_pct).toBe(0);
    expect(result.clean_total_pct).toBe(0);
  });

  it('sets unknown fuel keys to 0', () => {
    const result = normalizeFuelMix('CAISO', ts, { natural_gas: 1000 }, 'EIA');
    expect(result.coal_mw).toBe(0);
    expect(result.nuclear_mw).toBe(0);
    expect(result.wind_mw).toBe(0);
  });

  it('floors negative MW values to 0', () => {
    const result = normalizeFuelMix('CAISO', ts, { wind: -100 }, 'EIA');
    expect(result.wind_mw).toBe(0);
  });

  it('attaches region_code, timestamp, and source', () => {
    const result = normalizeFuelMix('PJM', ts, { coal: 1000 }, 'EIA');
    expect(result.region_code).toBe('PJM');
    expect(result.timestamp).toBeInstanceOf(Date);
    expect(result.source).toBe('EIA');
  });

  it('returns a row with all required schema fields', () => {
    const result = normalizeFuelMix('MISO', ts, { natural_gas: 5000 }, 'EIA');
    const requiredFields = [
      'natural_gas_mw', 'natural_gas_pct',
      'coal_mw', 'coal_pct',
      'nuclear_mw', 'nuclear_pct',
      'wind_mw', 'wind_pct',
      'solar_mw', 'solar_pct',
      'hydro_mw', 'hydro_pct',
      'battery_storage_mw', 'battery_storage_pct',
      'petroleum_mw', 'petroleum_pct',
      'other_renewables_mw', 'other_renewables_pct',
      'other_mw', 'other_pct',
      'total_generation_mw', 'renewable_total_pct', 'clean_total_pct', 'source'
    ];
    for (const field of requiredFields) {
      expect(result).toHaveProperty(field);
    }
  });
});

// ─────────────────────────── normalizeCarbonIntensity ─────────────────────────

describe('normalizeCarbonIntensity', () => {
  const ts = new Date('2025-04-25T12:00:00Z');

  it('returns null when total generation is 0', () => {
    const emptyMix = normalizeFuelMix('CAISO', ts, {}, 'EIA');
    expect(normalizeCarbonIntensity('CAISO', ts, emptyMix, 'EIA')).toBeNull();
  });

  it('calculates CO2 correctly for fossil-only generation', () => {
    // 5000 MW gas (897 lbs/MWh) + 1000 MW coal (2249 lbs/MWh)
    // totalLbs = 5000*897 + 1000*2249 = 4485000 + 2249000 = 6734000
    // lbsPerMwh = 6734000 / 6000 ≈ 1122.33
    const fuelMix = normalizeFuelMix('CAISO', ts, { natural_gas: 5000, coal: 1000 }, 'EIA');
    const result = normalizeCarbonIntensity('CAISO', ts, fuelMix, 'EIA');

    expect(result).not.toBeNull();
    const expectedLbs = (5000 * 897 + 1000 * 2249) / 6000;
    expect(result.co2_lbs_per_mwh).toBeCloseTo(expectedLbs, 1);
  });

  it('confirms g/kWh equals kg/MWh (unit equivalence)', () => {
    const fuelMix = normalizeFuelMix('CAISO', ts, { natural_gas: 5000, coal: 1000 }, 'EIA');
    const result = normalizeCarbonIntensity('CAISO', ts, fuelMix, 'EIA');

    // g/kWh == kg/MWh: 1000g/kg cancels 1000kWh/MWh
    expect(result.co2_grams_per_kwh).toBe(result.co2_kg_per_mwh);
  });

  it('returns 0 intensity and very_low category for 100% clean energy', () => {
    // nuclear + wind + solar all have 0 emission factor
    const fuelMix = normalizeFuelMix('CAISO', ts, {
      nuclear: 5000, wind: 3000, solar: 2000
    }, 'EIA');
    const result = normalizeCarbonIntensity('CAISO', ts, fuelMix, 'EIA');

    expect(result.co2_lbs_per_mwh).toBe(0);
    expect(result.co2_grams_per_kwh).toBe(0);
    expect(result.intensity_category).toBe('very_low');
  });

  it('classifies high-coal generation as very_high', () => {
    // coal: 2249 lbs/MWh → gramsPerKwh = 2249 * 453.592/1000 ≈ 1020 → very_high (≥600)
    const fuelMix = normalizeFuelMix('CAISO', ts, { coal: 10000 }, 'EIA');
    const result = normalizeCarbonIntensity('CAISO', ts, fuelMix, 'EIA');
    expect(result.intensity_category).toBe('very_high');
  });

  it('classifies 50% gas + 50% nuclear as medium', () => {
    // lbsPerMwh = 5000*897/10000 = 448.5
    // gramsPerKwh = 448.5 * 453.592/1000 ≈ 203.4 → medium (200–400)
    const fuelMix = normalizeFuelMix('CAISO', ts, { natural_gas: 5000, nuclear: 5000 }, 'EIA');
    const result = normalizeCarbonIntensity('CAISO', ts, fuelMix, 'EIA');
    expect(result.intensity_category).toBe('medium');
  });

  it('attaches metadata correctly', () => {
    const fuelMix = normalizeFuelMix('ERCOT', ts, { natural_gas: 1000 }, 'EIA');
    const result = normalizeCarbonIntensity('ERCOT', ts, fuelMix, 'EIA');

    expect(result.region_code).toBe('ERCOT');
    expect(result.timestamp).toBeInstanceOf(Date);
    expect(result.source).toBe('EIA');
    expect(result.calculation_method).toBe('fuel_mix_weighted');
  });

  it('includes renewable and clean percentages from the fuel mix row', () => {
    const fuelMix = normalizeFuelMix('CAISO', ts, { nuclear: 5000, wind: 5000 }, 'EIA');
    const result = normalizeCarbonIntensity('CAISO', ts, fuelMix, 'EIA');

    expect(result.renewable_percentage).toBeCloseTo(50, 1);  // wind = 50%
    expect(result.clean_energy_percentage).toBeCloseTo(100, 1); // wind + nuclear = 100%
  });
});

// ─────────────────────────── EIA_REGION_MAP / STATE_TO_REGION ─────────────────

describe('EIA_REGION_MAP', () => {
  it('maps all 8 expected EIA respondent codes', () => {
    expect(EIA_REGION_MAP['CAL']).toBe('CAISO');
    expect(EIA_REGION_MAP['TEX']).toBe('ERCOT');
    expect(EIA_REGION_MAP['MIDA']).toBe('PJM');
    expect(EIA_REGION_MAP['MIDW']).toBe('MISO');
    expect(EIA_REGION_MAP['NY']).toBe('NYISO');
    expect(EIA_REGION_MAP['NE']).toBe('ISONE');
    expect(EIA_REGION_MAP['SW']).toBe('WECC');
    expect(EIA_REGION_MAP['CENT']).toBe('SPP');
  });

  it('maps CENT to SPP (the previously missing entry)', () => {
    expect(EIA_REGION_MAP['CENT']).toBe('SPP');
  });

  it('does not map excluded SERC/TVA/FRCC respondent codes', () => {
    expect(EIA_REGION_MAP['SE']).toBeUndefined();
    expect(EIA_REGION_MAP['TEN']).toBeUndefined();
    expect(EIA_REGION_MAP['FLA']).toBeUndefined();
    expect(EIA_REGION_MAP['CAR']).toBeUndefined();
  });
});

describe('STATE_TO_REGION', () => {
  it('maps all 5 core SPP footprint states', () => {
    expect(STATE_TO_REGION['KS']).toBe('SPP');
    expect(STATE_TO_REGION['OK']).toBe('SPP');
    expect(STATE_TO_REGION['NE']).toBe('SPP');
    expect(STATE_TO_REGION['SD']).toBe('SPP');
    expect(STATE_TO_REGION['ND']).toBe('SPP');
  });

  it('continues to map all previously-existing regions correctly', () => {
    expect(STATE_TO_REGION['CA']).toBe('CAISO');
    expect(STATE_TO_REGION['TX']).toBe('ERCOT');
    expect(STATE_TO_REGION['NY']).toBe('NYISO');
    expect(STATE_TO_REGION['MA']).toBe('ISONE');
    expect(STATE_TO_REGION['PA']).toBe('PJM');
    expect(STATE_TO_REGION['IL']).toBe('MISO');
    expect(STATE_TO_REGION['AZ']).toBe('WECC');
  });

  it('returns undefined for unmapped states (no silent fallback)', () => {
    expect(STATE_TO_REGION['FL']).toBeUndefined();
    expect(STATE_TO_REGION['GA']).toBeUndefined();
    expect(STATE_TO_REGION['AL']).toBeUndefined();
  });
});

// ─────────────────────────── normalizeEnergyPrice ─────────────────────────────

describe('normalizeEnergyPrice', () => {
  const ts = new Date('2025-04-25T12:00:00Z');

  it('builds a complete price row with all fields', () => {
    const result = normalizeEnergyPrice({
      regionCode: 'CAISO',
      timestamp: ts,
      pricePerMwh: 45.5,
      priceType: 'real_time_hourly',
      pricingNode: 'CAISO_NODE_1',
      demandMw: 25000,
      source: 'CAISO'
    });

    expect(result.region_code).toBe('CAISO');
    expect(result.price_per_mwh).toBe(45.5);
    expect(result.price_type).toBe('real_time_hourly');
    expect(result.pricing_node).toBe('CAISO_NODE_1');
    expect(result.demand_mw).toBe(25000);
    expect(result.source).toBe('CAISO');
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it('returns null for price above 10000 $/MWh ceiling', () => {
    const result = normalizeEnergyPrice({
      regionCode: 'CAISO', timestamp: ts,
      pricePerMwh: 99999,
      priceType: 'real_time_hourly', source: 'EIA'
    });
    expect(result.price_per_mwh).toBeNull();
  });

  it('accepts negative prices (valid in energy markets with oversupply)', () => {
    const result = normalizeEnergyPrice({
      regionCode: 'CAISO', timestamp: ts,
      pricePerMwh: -200,   // within -500 floor
      priceType: 'real_time_hourly', source: 'EIA'
    });
    expect(result.price_per_mwh).toBe(-200);
  });

  it('rejects prices below -500 $/MWh floor', () => {
    const result = normalizeEnergyPrice({
      regionCode: 'CAISO', timestamp: ts,
      pricePerMwh: -600,
      priceType: 'real_time_hourly', source: 'EIA'
    });
    expect(result.price_per_mwh).toBeNull();
  });

  it('returns null for demand_mw below 0 (demand cannot be negative)', () => {
    const result = normalizeEnergyPrice({
      regionCode: 'CAISO', timestamp: ts,
      pricePerMwh: null, priceType: 'real_time_hourly',
      demandMw: -500,  // min=0 for demand
      source: 'EIA'
    });
    expect(result.demand_mw).toBeNull();
  });

  it('defaults pricing_node to null when not provided', () => {
    const result = normalizeEnergyPrice({
      regionCode: 'CAISO', timestamp: ts,
      pricePerMwh: 50, priceType: 'real_time_hourly', source: 'EIA'
    });
    expect(result.pricing_node).toBeNull();
  });

  it('serializes rawData to JSON string', () => {
    const raw = { foo: 'bar', count: 42 };
    const result = normalizeEnergyPrice({
      regionCode: 'CAISO', timestamp: ts,
      pricePerMwh: 50, priceType: 'real_time_hourly',
      source: 'EIA', rawData: raw
    });
    expect(result.raw_data).toBe(JSON.stringify(raw));
  });

  it('accepts a timestamp string and converts to Date', () => {
    const result = normalizeEnergyPrice({
      regionCode: 'CAISO', timestamp: '2025-04-25T12:00:00Z',
      pricePerMwh: 50, priceType: 'real_time_hourly', source: 'EIA'
    });
    expect(result.timestamp).toBeInstanceOf(Date);
  });
});
