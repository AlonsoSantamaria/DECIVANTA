INSERT INTO organizations (id, slug, name, default_locale, created_at)
VALUES ('00000000-0000-4000-8000-000000000001', 'northstar-manufacturing', 'Northstar Manufacturing', 'en', '2026-06-18T14:00:00Z')
ON CONFLICT (id) DO UPDATE SET slug = excluded.slug, name = excluded.name, default_locale = excluded.default_locale;

INSERT INTO decisions (id, organization_id, decision_code, initiative_name, decision_title, decision_text, rationale, decision_date, baseline_status, language_code, created_at)
VALUES ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'BOARD-2026-017', 'Project Atlas', 'Accelerate Project Atlas', 'The Board approved acceleration of Project Atlas subject to projected cash remaining at or above the material threshold.', 'Accelerating Project Atlas is expected to protect the planned market-entry window and improve operational capacity.', '2026-06-18', 'APPROVED_MONITORING_CONDITIONS', 'en', '2026-06-18T14:00:00Z')
ON CONFLICT (id) DO UPDATE SET decision_text = excluded.decision_text, rationale = excluded.rationale, baseline_status = excluded.baseline_status;

INSERT INTO decision_assumptions (id, decision_id, assumption_code, metric_code, operator, threshold_value, currency_code, description, materiality, created_at)
VALUES ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101', 'ATLAS-CASH-GTE-4500000', 'projected_cash', 'GTE', 4500000.00, 'USD', 'Projected cash must remain at or above USD 4.5 million.', 'MATERIAL', '2026-06-18T14:05:00Z')
ON CONFLICT (id) DO UPDATE SET threshold_value = excluded.threshold_value, description = excluded.description;

INSERT INTO forecasts (id, organization_id, forecast_code, metric_code, value, currency_code, as_of_date, source_label, language_code, created_at)
VALUES
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001', 'ATLAS-CASH-BASELINE-2026', 'projected_cash', 5100000.00, 'USD', '2026-06-18', 'Initial Project Atlas Cash Forecast', 'en', '2026-06-18T14:10:00Z'),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000001', 'ATLAS-CASH-UPDATED-Q4-2026', 'projected_cash', 3200000.00, 'USD', '2026-08-12', 'Updated Q4 Cash Forecast', 'en', '2026-08-12T20:00:00Z')
ON CONFLICT (id) DO UPDATE SET value = excluded.value, as_of_date = excluded.as_of_date, source_label = excluded.source_label;

INSERT INTO memory_items (id, organization_id, source_type, source_id, content, language_code, embedding_model, created_at)
VALUES
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000001', 'decision', '00000000-0000-4000-8000-000000000101', 'Board decision BOARD-2026-017: Accelerate Project Atlas subject to continued support from its material financial condition.', 'en', 'amazon.titan-embed-text-v2:0', '2026-06-18T14:15:00Z'),
  ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000001', 'rationale', '00000000-0000-4000-8000-000000000101', 'Rationale for BOARD-2026-017: acceleration protects the planned market-entry window and improves operational capacity.', 'en', 'amazon.titan-embed-text-v2:0', '2026-06-18T14:16:00Z'),
  ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000001', 'assumption', '00000000-0000-4000-8000-000000000201', 'Material assumption for Project Atlas: projected cash must remain at or above USD 4.5 million.', 'en', 'amazon.titan-embed-text-v2:0', '2026-06-18T14:17:00Z')
ON CONFLICT (id) DO UPDATE SET content = excluded.content, embedding_model = excluded.embedding_model;

-- Synthetic background memory gives CockroachDB enough rows to exercise its
-- approximate vector-index plan. These records are intentionally unrelated to
-- Project Atlas and never serve as canonical financial evidence.
INSERT INTO memory_items (id, organization_id, source_type, source_id, content, language_code, embedding_model, created_at)
SELECT
  ('10000000-0000-4000-8000-' || lpad(sequence::STRING, 12, '0'))::UUID,
  '00000000-0000-4000-8000-000000000001'::UUID,
  'rationale',
  ('20000000-0000-4000-8000-' || lpad(sequence::STRING, 12, '0'))::UUID,
  'Synthetic archival context unrelated to Project Atlas: routine workplace safety review record ' || sequence::STRING || '.',
  'en',
  'amazon.titan-embed-text-v2:0',
  '2025-01-01T00:00:00Z'::TIMESTAMPTZ + sequence * INTERVAL '1 minute'
FROM generate_series(1, 64) AS generated(sequence)
ON CONFLICT (id) DO UPDATE SET content = excluded.content, embedding_model = excluded.embedding_model;

INSERT INTO memory_events (id, organization_id, event_type, source_type, source_id, title, details, occurred_at)
VALUES
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000001', 'DECISION_RECORDED', 'decision', '00000000-0000-4000-8000-000000000101', 'Board decision recorded', '{"decisionCode":"BOARD-2026-017","initiative":"Project Atlas"}', '2026-06-18T14:00:00Z'),
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000001', 'RATIONALE_PRESERVED', 'decision', '00000000-0000-4000-8000-000000000101', 'Decision rationale preserved', '{"decisionCode":"BOARD-2026-017"}', '2026-06-18T14:01:00Z'),
  ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000001', 'ASSUMPTION_RECORDED', 'decision', '00000000-0000-4000-8000-000000000201', 'Material cash condition recorded', '{"metricCode":"projected_cash","operator":"GTE","threshold":"4500000.00","currency":"USD"}', '2026-06-18T14:05:00Z')
ON CONFLICT (id) DO UPDATE SET title = excluded.title, details = excluded.details;
