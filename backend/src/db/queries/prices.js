'use strict';

const { query, transaction } = require('../../config/database');

/**
 * Upsert a single normalized energy_prices row.
 * Conflict key: (region_code, timestamp, price_type, pricing_node)
 * pricing_node always defaults to 'SYSTEM' — never NULL — so the unique
 * constraint works correctly (PostgreSQL treats NULL != NULL).
 */
async function upsertEnergyPrice(row) {
  const sql = `
    INSERT INTO energy_prices (
      region_code, timestamp, price_per_mwh, price_day_ahead_mwh,
      price_energy_component, price_congestion_component, price_loss_component,
      price_type, pricing_node, demand_mw, demand_forecast_mw,
      net_generation_mw, interchange_mw, frequency_hz,
      source, raw_data, is_estimated
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
    )
    ON CONFLICT (region_code, timestamp, price_type, pricing_node)
    DO UPDATE SET
      price_per_mwh        = EXCLUDED.price_per_mwh,
      price_day_ahead_mwh  = EXCLUDED.price_day_ahead_mwh,
      demand_mw            = EXCLUDED.demand_mw,
      net_generation_mw    = EXCLUDED.net_generation_mw,
      interchange_mw       = EXCLUDED.interchange_mw,
      source               = EXCLUDED.source
  `;
  // Always use a non-null pricing_node so the unique constraint fires correctly
  const pricingNode = row.pricing_node || 'SYSTEM';
  return query(sql, [
    row.region_code,
    row.timestamp,
    row.price_per_mwh,
    row.price_day_ahead_mwh,
    row.price_energy_component,
    row.price_congestion_component,
    row.price_loss_component,
    row.price_type,
    pricingNode,
    row.demand_mw,
    row.demand_forecast_mw,
    row.net_generation_mw,
    row.interchange_mw,
    row.frequency_hz,
    row.source,
    row.raw_data,
    row.is_estimated
  ]);
}

/**
 * Upsert many price rows inside a single transaction.
 * All rows succeed or all are rolled back — no partial writes.
 * Returns count of rows submitted.
 */
async function upsertManyEnergyPrices(rows) {
  if (!rows || rows.length === 0) return 0;
  await transaction(async (client) => {
    for (const row of rows) {
      const pricingNode = row.pricing_node || 'SYSTEM';
      await client.query(`
        INSERT INTO energy_prices (
          region_code, timestamp, price_per_mwh, price_day_ahead_mwh,
          price_energy_component, price_congestion_component, price_loss_component,
          price_type, pricing_node, demand_mw, demand_forecast_mw,
          net_generation_mw, interchange_mw, frequency_hz,
          source, raw_data, is_estimated
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT (region_code, timestamp, price_type, pricing_node)
        DO UPDATE SET
          price_per_mwh     = EXCLUDED.price_per_mwh,
          price_day_ahead_mwh = EXCLUDED.price_day_ahead_mwh,
          demand_mw         = EXCLUDED.demand_mw,
          net_generation_mw = EXCLUDED.net_generation_mw,
          interchange_mw    = EXCLUDED.interchange_mw,
          source            = EXCLUDED.source
      `, [
        row.region_code, row.timestamp, row.price_per_mwh, row.price_day_ahead_mwh,
        row.price_energy_component, row.price_congestion_component, row.price_loss_component,
        row.price_type, pricingNode, row.demand_mw, row.demand_forecast_mw,
        row.net_generation_mw, row.interchange_mw, row.frequency_hz,
        row.source, row.raw_data, row.is_estimated
      ]);
    }
  });
  return rows.length;
}

/**
 * Upsert a fuel_mix row.
 */
async function upsertFuelMix(row) {
  const sql = `
    INSERT INTO fuel_mix (
      region_code, timestamp,
      natural_gas_mw, natural_gas_pct, coal_mw, coal_pct,
      nuclear_mw, nuclear_pct, wind_mw, wind_pct,
      solar_mw, solar_pct, hydro_mw, hydro_pct,
      battery_storage_mw, battery_storage_pct,
      petroleum_mw, petroleum_pct,
      other_renewables_mw, other_renewables_pct,
      other_mw, other_pct,
      total_generation_mw, renewable_total_pct, clean_total_pct, source
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
    )
    ON CONFLICT (region_code, timestamp)
    DO UPDATE SET
      natural_gas_mw = EXCLUDED.natural_gas_mw, natural_gas_pct = EXCLUDED.natural_gas_pct,
      coal_mw = EXCLUDED.coal_mw, coal_pct = EXCLUDED.coal_pct,
      nuclear_mw = EXCLUDED.nuclear_mw, nuclear_pct = EXCLUDED.nuclear_pct,
      wind_mw = EXCLUDED.wind_mw, wind_pct = EXCLUDED.wind_pct,
      solar_mw = EXCLUDED.solar_mw, solar_pct = EXCLUDED.solar_pct,
      hydro_mw = EXCLUDED.hydro_mw, hydro_pct = EXCLUDED.hydro_pct,
      battery_storage_mw = EXCLUDED.battery_storage_mw, battery_storage_pct = EXCLUDED.battery_storage_pct,
      petroleum_mw = EXCLUDED.petroleum_mw, petroleum_pct = EXCLUDED.petroleum_pct,
      other_renewables_mw = EXCLUDED.other_renewables_mw, other_renewables_pct = EXCLUDED.other_renewables_pct,
      other_mw = EXCLUDED.other_mw, other_pct = EXCLUDED.other_pct,
      total_generation_mw = EXCLUDED.total_generation_mw,
      renewable_total_pct = EXCLUDED.renewable_total_pct,
      clean_total_pct = EXCLUDED.clean_total_pct,
      source = EXCLUDED.source
  `;
  return query(sql, [
    row.region_code, row.timestamp,
    row.natural_gas_mw, row.natural_gas_pct,
    row.coal_mw, row.coal_pct,
    row.nuclear_mw, row.nuclear_pct,
    row.wind_mw, row.wind_pct,
    row.solar_mw, row.solar_pct,
    row.hydro_mw, row.hydro_pct,
    row.battery_storage_mw, row.battery_storage_pct,
    row.petroleum_mw, row.petroleum_pct,
    row.other_renewables_mw, row.other_renewables_pct,
    row.other_mw, row.other_pct,
    row.total_generation_mw, row.renewable_total_pct, row.clean_total_pct,
    row.source
  ]);
}

/**
 * Upsert a carbon_intensity row.
 */
async function upsertCarbonIntensity(row) {
  const sql = `
    INSERT INTO carbon_intensity (
      region_code, timestamp, co2_lbs_per_mwh, co2_grams_per_kwh, co2_kg_per_mwh,
      renewable_percentage, clean_energy_percentage, intensity_category,
      calculation_method, source
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (region_code, timestamp)
    DO UPDATE SET
      co2_lbs_per_mwh = EXCLUDED.co2_lbs_per_mwh,
      co2_grams_per_kwh = EXCLUDED.co2_grams_per_kwh,
      co2_kg_per_mwh = EXCLUDED.co2_kg_per_mwh,
      renewable_percentage = EXCLUDED.renewable_percentage,
      clean_energy_percentage = EXCLUDED.clean_energy_percentage,
      intensity_category = EXCLUDED.intensity_category,
      source = EXCLUDED.source
  `;
  return query(sql, [
    row.region_code, row.timestamp,
    row.co2_lbs_per_mwh, row.co2_grams_per_kwh, row.co2_kg_per_mwh,
    row.renewable_percentage, row.clean_energy_percentage,
    row.intensity_category, row.calculation_method, row.source
  ]);
}

/**
 * Get the most recent price row for a region.
 */
async function getLatestPrice(regionCode, priceType = 'real_time_hourly') {
  const { rows } = await query(
    `SELECT * FROM energy_prices
     WHERE region_code = $1 AND price_type = $2
     ORDER BY timestamp DESC LIMIT 1`,
    [regionCode, priceType]
  );
  return rows[0] || null;
}

module.exports = {
  upsertEnergyPrice,
  upsertManyEnergyPrices,
  upsertFuelMix,
  upsertCarbonIntensity,
  getLatestPrice
};
