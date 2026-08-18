INSERT INTO business_cases (id, organization_id, mission_id, name, authorized_capex, currency_code, committed_opening_date, critical_objective)
VALUES ('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','business-case-watch-orion','ORION Industrial Park',18000000.00,'USD','2027-03-15','First building operational in time to receive the client''s first tenant.')
ON CONFLICT (id) DO UPDATE SET authorized_capex=excluded.authorized_capex, committed_opening_date=excluded.committed_opening_date, critical_objective=excluded.critical_objective;

INSERT INTO business_case_events (id,business_case_id,event_code,event_title,alternative_a_capex,alternative_a_delay_days,alternative_a_protects_date,alternative_b_capex,alternative_b_delay_days,alternative_b_protects_date,occurred_at)
VALUES ('30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','ORION-PROCUREMENT-CONFLICT','Contractor supply conflict',0.00,28,false,310000.00,0,true,'2026-08-15T14:00:00Z')
ON CONFLICT (id) DO UPDATE SET alternative_a_delay_days=excluded.alternative_a_delay_days, alternative_b_capex=excluded.alternative_b_capex;

INSERT INTO memory_items (id,organization_id,source_type,source_id,content,language_code,embedding_model,mission_id,epistemic_type,provenance,created_at)
VALUES
('30000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','fact','30000000-0000-4000-8000-000000000011','Client rejected the proposed USD 900K CAPEX increase.','en','amazon.titan-embed-text-v2:0','business-case-watch-orion','FACT','{"support":"direct historical record"}','2026-05-04T14:00:00Z'),
('30000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000001','decision','30000000-0000-4000-8000-000000000012','Client selected Option B with USD 420K additional CAPEX to protect the committed opening date rather than Option A with an approximately three-week delay.','en','amazon.titan-embed-text-v2:0','business-case-watch-orion','DECISION','{"rationale":"Protect committed opening date despite additional cost"}','2026-06-20T14:00:00Z'),
('30000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000001','observed_pattern','30000000-0000-4000-8000-000000000013','In recent decisions, the client has resisted CAPEX increases generally but has accepted additional cost when necessary to protect the committed opening date.','en','amazon.titan-embed-text-v2:0','business-case-watch-orion','OBSERVED_PATTERN','{"supportedBy":["30000000-0000-4000-8000-000000000101","30000000-0000-4000-8000-000000000102"],"scope":"recent decisions","notPreference":true}','2026-06-20T14:05:00Z')
ON CONFLICT (id) DO UPDATE SET content=excluded.content, epistemic_type=excluded.epistemic_type, provenance=excluded.provenance;
