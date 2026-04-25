-- ============================================================
-- SEED DATA: Regions and data source health trackers
-- ============================================================

INSERT INTO regions (code, name, type, tier, timezone, states_covered, latitude, longitude, data_source, update_frequency_minutes) VALUES
('CAISO', 'California ISO', 'us_iso', 1, 'America/Los_Angeles', ARRAY['CA'], 36.77, -119.41, 'CAISO', 5),
('ERCOT', 'Electric Reliability Council of Texas', 'us_iso', 1, 'America/Chicago', ARRAY['TX'], 31.97, -99.90, 'ERCOT', 5),
('PJM', 'PJM Interconnection', 'us_iso', 1, 'America/New_York', ARRAY['DE','IL','IN','KY','MD','MI','NJ','NC','OH','PA','TN','VA','WV','DC'], 40.44, -79.99, 'PJM', 5),
('MISO', 'Midcontinent ISO', 'us_iso', 1, 'America/Chicago', ARRAY['AR','IL','IN','IA','KY','LA','MI','MN','MS','MO','MT','ND','SD','WI'], 44.97, -93.27, 'MISO', 5),
('NYISO', 'New York ISO', 'us_iso', 1, 'America/New_York', ARRAY['NY'], 40.71, -74.00, 'NYISO', 5),
('ISONE', 'ISO New England', 'us_iso', 1, 'America/New_York', ARRAY['CT','ME','MA','NH','RI','VT'], 42.36, -71.05, 'ISONE', 5),
('SPP', 'Southwest Power Pool', 'us_iso', 1, 'America/Chicago', ARRAY['KS','NE','OK','SD','NM','TX','WY'], 35.50, -98.00, 'EIA', 60),
('WECC', 'Western Interconnection', 'us_iso', 1, 'America/Denver', ARRAY['AZ','CO','ID','MT','NV','NM','OR','UT','WA','WY'], 39.00, -111.00, 'EIA', 60)
ON CONFLICT (code) DO NOTHING;

-- International regions (Tier 2)
INSERT INTO regions (code, name, type, tier, timezone, countries_covered, latitude, longitude, data_source, update_frequency_minutes) VALUES
('GBR', 'United Kingdom', 'country', 2, 'Europe/London', ARRAY['GB'], 51.51, -0.13, 'IEA', 60),
('DEU', 'Germany', 'country', 2, 'Europe/Berlin', ARRAY['DE'], 51.16, 10.45, 'IEA', 60),
('FRA', 'France', 'country', 2, 'Europe/Paris', ARRAY['FR'], 46.23, 2.21, 'IEA', 60),
('AUS', 'Australia', 'country', 2, 'Australia/Sydney', ARRAY['AU'], -25.27, 133.77, 'IEA', 60),
('JPN', 'Japan', 'country', 2, 'Asia/Tokyo', ARRAY['JP'], 36.20, 138.25, 'IEA', 60),
('CAN', 'Canada', 'country', 2, 'America/Toronto', ARRAY['CA'], 56.13, -106.35, 'IEA', 60)
ON CONFLICT (code) DO NOTHING;

-- Data source health trackers
INSERT INTO data_source_health (source_name, status) VALUES
('EIA_API', 'unknown'),
('CAISO', 'unknown'),
('ERCOT', 'unknown'),
('PJM', 'unknown'),
('MISO', 'unknown'),
('NYISO', 'unknown'),
('ISONE', 'unknown'),
('IEA', 'unknown'),
('OPENMETEO', 'unknown'),
('DOE_EV', 'unknown')
ON CONFLICT (source_name) DO NOTHING;
