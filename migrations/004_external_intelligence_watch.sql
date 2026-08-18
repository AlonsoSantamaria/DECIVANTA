CREATE TABLE IF NOT EXISTS external_events (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  event_code STRING NOT NULL UNIQUE,
  title STRING NOT NULL,
  event_type STRING NOT NULL,
  jurisdiction STRING NOT NULL,
  affected_category STRING NOT NULL,
  prior_rate_percent DECIMAL(7,3) NOT NULL,
  current_rate_percent DECIMAL(7,3) NOT NULL,
  effective_date DATE NOT NULL,
  published_date DATE NOT NULL,
  source_publisher STRING NOT NULL,
  source_url STRING NOT NULL,
  content_hash BYTES NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT external_events_rate_check CHECK (prior_rate_percent >= 0 AND current_rate_percent >= 0)
);

CREATE TABLE IF NOT EXISTS external_intelligence_runs (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES demo_sessions(id),
  generation INT8 NOT NULL,
  mission_id STRING NOT NULL,
  idempotency_key STRING NOT NULL,
  event_id UUID NOT NULL REFERENCES external_events(id),
  status STRING NOT NULL,
  relevant BOOL NULL,
  connected_to_business_context BOOL NULL,
  potential_cost_impact BOOL NULL,
  potential_schedule_impact BOOL NULL,
  executive_attention_required BOOL NULL,
  response_snapshot JSONB NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT external_intelligence_runs_status_check CHECK (status IN ('PROCESSING','COMPLETED','MEMORY_UNAVAILABLE','GUIDANCE_UNAVAILABLE','FAILED')),
  CONSTRAINT external_intelligence_runs_unique UNIQUE (session_id, generation, mission_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS external_intelligence_matches (
  run_id UUID NOT NULL REFERENCES external_intelligence_runs(id),
  memory_item_id UUID NOT NULL REFERENCES memory_items(id),
  rank INT8 NOT NULL,
  distance DECIMAL NOT NULL,
  retrieved_via STRING NOT NULL DEFAULT 'COCKROACH_CLOUD_MCP_VECTOR',
  PRIMARY KEY (run_id, memory_item_id)
);

CREATE TABLE IF NOT EXISTS external_intelligence_guidance (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL UNIQUE REFERENCES external_intelligence_runs(id),
  model_id STRING NOT NULL,
  summary STRING NOT NULL,
  recommended_action STRING NOT NULL,
  potential_impact STRING NOT NULL,
  uncertainty_statement STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON TABLE external_events, external_intelligence_runs,
  external_intelligence_matches, external_intelligence_guidance TO decivanta_app;
