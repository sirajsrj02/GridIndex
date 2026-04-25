-- ============================================================
-- GRIDINDEX DATABASE SCHEMA v1.0
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- REFERENCE TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS regions (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  type VARCHAR(20) NOT NULL,
  tier INTEGER NOT NULL DEFAULT 1,
  timezone VARCHAR(50) NOT NULL,
  utc_offset_hours DECIMAL(4,2),
  states_covered TEXT[],
  countries_covered TEXT[],
  population_served BIGINT,
  peak_demand_mw INTEGER,
  latitude DECIMAL(9,6),
  longitude DECIMAL(9,6),
  data_source VARCHAR(50) NOT NULL,
  data_source_url TEXT,
  update_frequency_minutes INTEGER DEFAULT 60,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- CORE ENERGY PRICE TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS energy_prices (
  id BIGSERIAL PRIMARY KEY,
  region_code VARCHAR(20) NOT NULL REFERENCES regions(code),
  timestamp TIMESTAMPTZ NOT NULL,
  timestamp_local TIMESTAMPTZ,
  price_per_mwh DECIMAL(12,4),
  price_day_ahead_mwh DECIMAL(12,4),
  price_energy_component DECIMAL(12,4),
  price_congestion_component DECIMAL(12,4),
  price_loss_component DECIMAL(12,4),
  price_type VARCHAR(20) NOT NULL,
  pricing_node VARCHAR(100),
  demand_mw DECIMAL(14,4),
  demand_forecast_mw DECIMAL(14,4),
  net_generation_mw DECIMAL(14,4),
  interchange_mw DECIMAL(12,4),
  frequency_hz DECIMAL(6,4),
  source VARCHAR(50) NOT NULL,
  raw_data JSONB,
  is_estimated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ep_region_timestamp ON energy_prices(region_code, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ep_timestamp ON energy_prices(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ep_price ON energy_prices(price_per_mwh);
CREATE INDEX IF NOT EXISTS idx_ep_region_type_timestamp ON energy_prices(region_code, price_type, timestamp DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ep_unique ON energy_prices(region_code, timestamp, price_type, pricing_node);

-- ============================================================
-- FUEL MIX TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS fuel_mix (
  id BIGSERIAL PRIMARY KEY,
  region_code VARCHAR(20) NOT NULL REFERENCES regions(code),
  timestamp TIMESTAMPTZ NOT NULL,
  natural_gas_mw DECIMAL(14,4) DEFAULT 0,
  natural_gas_pct DECIMAL(6,4) DEFAULT 0,
  coal_mw DECIMAL(14,4) DEFAULT 0,
  coal_pct DECIMAL(6,4) DEFAULT 0,
  nuclear_mw DECIMAL(14,4) DEFAULT 0,
  nuclear_pct DECIMAL(6,4) DEFAULT 0,
  wind_mw DECIMAL(14,4) DEFAULT 0,
  wind_pct DECIMAL(6,4) DEFAULT 0,
  solar_mw DECIMAL(14,4) DEFAULT 0,
  solar_pct DECIMAL(6,4) DEFAULT 0,
  hydro_mw DECIMAL(14,4) DEFAULT 0,
  hydro_pct DECIMAL(6,4) DEFAULT 0,
  battery_storage_mw DECIMAL(14,4) DEFAULT 0,
  battery_storage_pct DECIMAL(6,4) DEFAULT 0,
  petroleum_mw DECIMAL(14,4) DEFAULT 0,
  petroleum_pct DECIMAL(6,4) DEFAULT 0,
  other_renewables_mw DECIMAL(14,4) DEFAULT 0,
  other_renewables_pct DECIMAL(6,4) DEFAULT 0,
  other_mw DECIMAL(14,4) DEFAULT 0,
  other_pct DECIMAL(6,4) DEFAULT 0,
  total_generation_mw DECIMAL(14,4),
  renewable_total_pct DECIMAL(6,4),
  clean_total_pct DECIMAL(6,4),
  source VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fm_unique ON fuel_mix(region_code, timestamp);
CREATE INDEX IF NOT EXISTS idx_fm_region_timestamp ON fuel_mix(region_code, timestamp DESC);

-- ============================================================
-- CARBON INTENSITY TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS carbon_intensity (
  id BIGSERIAL PRIMARY KEY,
  region_code VARCHAR(20) NOT NULL REFERENCES regions(code),
  timestamp TIMESTAMPTZ NOT NULL,
  co2_lbs_per_mwh DECIMAL(10,4),
  co2_grams_per_kwh DECIMAL(10,4),
  co2_kg_per_mwh DECIMAL(10,4),
  renewable_percentage DECIMAL(6,4),
  clean_energy_percentage DECIMAL(6,4),
  intensity_category VARCHAR(20),
  calculation_method VARCHAR(50) DEFAULT 'fuel_mix_weighted',
  source VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ci_unique ON carbon_intensity(region_code, timestamp);
CREATE INDEX IF NOT EXISTS idx_ci_region_timestamp ON carbon_intensity(region_code, timestamp DESC);

-- ============================================================
-- WEATHER DATA TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS weather_data (
  id BIGSERIAL PRIMARY KEY,
  region_code VARCHAR(20) NOT NULL REFERENCES regions(code),
  location_name VARCHAR(100),
  latitude DECIMAL(9,6),
  longitude DECIMAL(9,6),
  timestamp TIMESTAMPTZ NOT NULL,
  temperature_f DECIMAL(6,2),
  temperature_c DECIMAL(6,2),
  feels_like_f DECIMAL(6,2),
  humidity_pct DECIMAL(5,2),
  wind_speed_mph DECIMAL(6,2),
  wind_direction_degrees INTEGER,
  wind_gusts_mph DECIMAL(6,2),
  cloud_cover_pct DECIMAL(5,2),
  precipitation_inches DECIMAL(6,4),
  solar_radiation_wm2 DECIMAL(10,4),
  pressure_hpa DECIMAL(8,2),
  weather_code INTEGER,
  cooling_degree_days DECIMAL(6,2),
  heating_degree_days DECIMAL(6,2),
  is_forecast BOOLEAN DEFAULT false,
  forecast_horizon_hours INTEGER,
  source VARCHAR(50) DEFAULT 'OpenMeteo',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wd_unique ON weather_data(region_code, location_name, timestamp, is_forecast);
CREATE INDEX IF NOT EXISTS idx_wd_region_timestamp ON weather_data(region_code, timestamp DESC);

-- ============================================================
-- NATURAL GAS PRICES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS natural_gas_prices (
  id BIGSERIAL PRIMARY KEY,
  hub_name VARCHAR(100) NOT NULL,
  region_code VARCHAR(20),
  timestamp TIMESTAMPTZ NOT NULL,
  price_per_mmbtu DECIMAL(10,4),
  price_per_mcf DECIMAL(10,4),
  price_type VARCHAR(20),
  source VARCHAR(50) DEFAULT 'EIA',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ngp_unique ON natural_gas_prices(hub_name, timestamp, price_type);
CREATE INDEX IF NOT EXISTS idx_ngp_hub_timestamp ON natural_gas_prices(hub_name, timestamp DESC);

-- ============================================================
-- NUCLEAR OUTAGES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS nuclear_outages (
  id BIGSERIAL PRIMARY KEY,
  region_code VARCHAR(20),
  plant_name VARCHAR(150),
  capacity_mw INTEGER,
  outage_mw INTEGER,
  outage_type VARCHAR(30),
  outage_start TIMESTAMPTZ,
  outage_end_expected TIMESTAMPTZ,
  timestamp TIMESTAMPTZ NOT NULL,
  source VARCHAR(50) DEFAULT 'EIA',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_no_region_timestamp ON nuclear_outages(region_code, timestamp DESC);

-- ============================================================
-- EV CHARGING INFRASTRUCTURE TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS ev_charging_stations (
  id BIGSERIAL PRIMARY KEY,
  station_id VARCHAR(50) UNIQUE,
  name VARCHAR(255),
  region_code VARCHAR(20) REFERENCES regions(code),
  state VARCHAR(2),
  city VARCHAR(100),
  latitude DECIMAL(9,6),
  longitude DECIMAL(9,6),
  level1_ports INTEGER DEFAULT 0,
  level2_ports INTEGER DEFAULT 0,
  dcfc_ports INTEGER DEFAULT 0,
  total_capacity_kw DECIMAL(12,2),
  network VARCHAR(100),
  access_type VARCHAR(20),
  is_active BOOLEAN DEFAULT true,
  last_updated TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ev_region ON ev_charging_stations(region_code);
CREATE INDEX IF NOT EXISTS idx_ev_state ON ev_charging_stations(state);

CREATE TABLE IF NOT EXISTS ev_grid_summary (
  id SERIAL PRIMARY KEY,
  region_code VARCHAR(20) UNIQUE NOT NULL REFERENCES regions(code),
  total_stations INTEGER,
  total_ports INTEGER,
  total_capacity_mw DECIMAL(12,4),
  level2_stations INTEGER,
  dcfc_stations INTEGER,
  ev_registrations INTEGER,
  ev_adoption_rate_pct DECIMAL(6,4),
  projected_peak_ev_load_mw DECIMAL(12,4),
  last_calculated TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PRICE FORECASTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS price_forecasts (
  id BIGSERIAL PRIMARY KEY,
  region_code VARCHAR(20) NOT NULL REFERENCES regions(code),
  forecast_for_timestamp TIMESTAMPTZ NOT NULL,
  forecast_created_at TIMESTAMPTZ NOT NULL,
  price_forecast_mwh DECIMAL(12,4),
  price_low_mwh DECIMAL(12,4),
  price_high_mwh DECIMAL(12,4),
  demand_forecast_mw DECIMAL(14,4),
  forecast_horizon_hours INTEGER,
  model_version VARCHAR(20) DEFAULT 'v1',
  forecast_source VARCHAR(50) NOT NULL,
  confidence_score DECIMAL(4,3),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pf_unique ON price_forecasts(region_code, forecast_for_timestamp, forecast_source);
CREATE INDEX IF NOT EXISTS idx_pf_region_horizon ON price_forecasts(region_code, forecast_horizon_hours, forecast_created_at DESC);

-- ============================================================
-- API CUSTOMERS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS api_customers (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  company_name VARCHAR(255),
  full_name VARCHAR(255),
  plan VARCHAR(20) DEFAULT 'trial',
  api_key VARCHAR(64) UNIQUE NOT NULL,
  api_key_created_at TIMESTAMPTZ DEFAULT NOW(),
  calls_this_month INTEGER DEFAULT 0,
  calls_last_month INTEGER DEFAULT 0,
  calls_all_time BIGINT DEFAULT 0,
  monthly_limit INTEGER DEFAULT 1000,
  calls_reset_at TIMESTAMPTZ,
  allowed_regions TEXT[] DEFAULT ARRAY['CAISO','ERCOT'],
  min_interval_minutes INTEGER DEFAULT 60,
  history_days_allowed INTEGER DEFAULT 7,
  use_case VARCHAR(100),
  referral_source VARCHAR(100),
  beta_user BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  is_email_verified BOOLEAN DEFAULT false,
  email_verify_token VARCHAR(64),
  password_reset_token VARCHAR(64),
  password_reset_expires TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- API USAGE LOGS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS api_usage_logs (
  id BIGSERIAL PRIMARY KEY,
  api_key VARCHAR(64) NOT NULL,
  customer_id INTEGER REFERENCES api_customers(id),
  endpoint VARCHAR(255) NOT NULL,
  method VARCHAR(10) NOT NULL,
  region_code VARCHAR(20),
  query_params JSONB,
  response_status INTEGER,
  response_time_ms INTEGER,
  response_rows INTEGER,
  ip_address INET,
  user_agent TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aul_api_key_created ON api_usage_logs(api_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aul_created ON api_usage_logs(created_at DESC);

-- ============================================================
-- PRICE ALERTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS price_alerts (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES api_customers(id),
  api_key VARCHAR(64) NOT NULL,
  alert_name VARCHAR(100),
  region_code VARCHAR(20) NOT NULL REFERENCES regions(code),
  alert_type VARCHAR(30) NOT NULL,
  threshold_price_mwh DECIMAL(12,4),
  threshold_pct_change DECIMAL(6,2),
  threshold_timewindow_minutes INTEGER DEFAULT 5,
  threshold_carbon_g_kwh DECIMAL(10,4),
  threshold_renewable_pct DECIMAL(6,2),
  delivery_method VARCHAR(20) NOT NULL,
  email_address VARCHAR(255),
  webhook_url TEXT,
  webhook_secret VARCHAR(64),
  cooldown_minutes INTEGER DEFAULT 60,
  is_active BOOLEAN DEFAULT true,
  trigger_count INTEGER DEFAULT 0,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pa_region ON price_alerts(region_code, is_active);

-- ============================================================
-- ALERT HISTORY TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS alert_history (
  id BIGSERIAL PRIMARY KEY,
  alert_id INTEGER NOT NULL REFERENCES price_alerts(id),
  region_code VARCHAR(20),
  triggered_at TIMESTAMPTZ NOT NULL,
  alert_type VARCHAR(30),
  price_at_trigger DECIMAL(12,4),
  price_before DECIMAL(12,4),
  pct_change DECIMAL(8,4),
  carbon_at_trigger DECIMAL(10,4),
  renewable_pct_at_trigger DECIMAL(6,4),
  threshold_that_triggered TEXT,
  delivery_method VARCHAR(20),
  delivered BOOLEAN DEFAULT false,
  delivered_at TIMESTAMPTZ,
  delivery_error TEXT,
  webhook_response_code INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ah_alert_id ON alert_history(alert_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_ah_triggered ON alert_history(triggered_at DESC);

-- ============================================================
-- SYSTEM HEALTH TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS data_source_health (
  id SERIAL PRIMARY KEY,
  source_name VARCHAR(50) UNIQUE NOT NULL,
  last_success_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  consecutive_failures INTEGER DEFAULT 0,
  total_calls_today INTEGER DEFAULT 0,
  avg_response_time_ms INTEGER,
  status VARCHAR(20) DEFAULT 'unknown',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
