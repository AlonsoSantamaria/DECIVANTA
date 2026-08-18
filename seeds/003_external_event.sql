INSERT INTO external_events (
  id, organization_id, event_code, title, event_type, jurisdiction, affected_category,
  prior_rate_percent, current_rate_percent, effective_date, published_date,
  source_publisher, source_url, content_hash
) VALUES (
  '40000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'US-STEEL-TARIFF-2025-50',
  'United States steel tariff increased from 25% to 50%',
  'REGULATORY_TARIFF_CHANGE',
  'US',
  'steel articles and derivative steel articles',
  25.000,
  50.000,
  '2025-06-04',
  '2025-06-09',
  'Federal Register',
  'https://www.federalregister.gov/documents/2025/06/09/2025-10524/adjusting-imports-of-aluminum-and-steel-into-the-united-states',
  decode('7f26984aa0cc753fe76140bddb0e42b37ddcc27a7550f0f9e15e74b3584145b5','hex')
) ON CONFLICT (event_code) DO UPDATE SET
  title = excluded.title,
  current_rate_percent = excluded.current_rate_percent,
  source_url = excluded.source_url,
  content_hash = excluded.content_hash;
