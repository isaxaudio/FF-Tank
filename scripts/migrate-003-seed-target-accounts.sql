-- Migration 003: Seed existing clients and competitor watchlist
-- Run AFTER migrate-002 completes.
-- Run in Supabase SQL editor: https://supabase.com/dashboard/project/frjzevqeyhesymilpjqo/sql

-- Existing clients
insert into target_accounts (name, company_name, tier, state, region, existing_relationship, why_fit, is_monitored, status) values
  ('Western Governors University', 'Western Governors University', 'existing_client', 'UT', 'Mountain West', true, 'Fatfish largest account. Multi-year relationship. Large-scale annual events.', true, 'active'),
  ('Huntsman Corporation',         'Huntsman Corporation',         'existing_client', 'UT', 'Mountain West', true, 'Long-term client. Corporate events and investor-facing production.', true, 'active'),
  ('Fox Pest Control',             'Fox Pest Control',             'existing_client', 'UT', 'Mountain West', true, 'Annual conference and brand events.', true, 'active'),
  ('TEDxSaltLakeCity',             'TEDxSaltLakeCity',             'existing_client', 'UT', 'Mountain West', true, 'Annual TEDx event. Brand-aligned creative work.', true, 'active'),
  ('Progressive Leasing',          'Progressive Leasing',          'existing_client', 'UT', 'Mountain West', true, 'Brandlive streaming partner. Corporate comms events.', true, 'active'),
  ('Equality Utah',                'Equality Utah',                'existing_client', 'UT', 'Mountain West', true, 'Annual gala and advocacy events. Values-aligned.', true, 'active'),
  ('Cynosure',                     'Cynosure',                     'existing_client', 'UT', 'Mountain West', true, 'Medical aesthetics events and product launches.', true, 'active'),
  ('Magellan Financial',           'Magellan Financial',           'existing_client', 'UT', 'Mountain West', true, 'Financial services corporate events.', true, 'active')
on conflict do nothing;

-- Competitor watchlist
insert into target_accounts (name, company_name, tier, state, region, why_fit, monitoring_keywords, is_monitored, status) values
  ('Webb Audio Visual',  'Webb Audio Visual',  'watchlist', 'UT', 'Mountain West', 'Direct competitor. Monitor client wins, case studies, and hires.', array['Webb AV case study', 'Webb Audio Visual client'], true, 'active'),
  ('Cornerstone AV',     'Cornerstone AV',     'watchlist', 'UT', 'Mountain West', 'Direct competitor. Monitor client wins and expansions.',           array['Cornerstone AV client', 'Cornerstone Audio Visual'],  true, 'active')
on conflict do nothing;
