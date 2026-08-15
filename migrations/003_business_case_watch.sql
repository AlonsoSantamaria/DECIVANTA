ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS mission_id STRING NULL;
ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS epistemic_type STRING NULL;
ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS provenance JSONB NULL;
ALTER TABLE memory_items DROP CONSTRAINT IF EXISTS memory_items_source_type_check;
ALTER TABLE memory_items ADD CONSTRAINT memory_items_source_type_check CHECK (source_type IN
  ('decision','rationale','assumption','executive_decision','follow_up','fact','observed_pattern','inference','condition','commitment'));
ALTER TABLE memory_items ADD CONSTRAINT IF NOT EXISTS memory_items_epistemic_type_check CHECK
  (epistemic_type IS NULL OR epistemic_type IN ('FACT','DECISION','OBSERVED_PATTERN','INFERENCE','CONDITION','COMMITMENT','FOLLOW_UP'));
CREATE INDEX IF NOT EXISTS memory_items_mission_scope_idx ON memory_items (organization_id, mission_id, epistemic_type, created_at);

CREATE TABLE IF NOT EXISTS business_cases (
  id UUID PRIMARY KEY, organization_id UUID NOT NULL REFERENCES organizations(id), mission_id STRING NOT NULL UNIQUE,
  name STRING NOT NULL, authorized_capex DECIMAL(19,2) NOT NULL, currency_code STRING NOT NULL,
  committed_opening_date DATE NOT NULL, critical_objective STRING NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_case_events (
  id UUID PRIMARY KEY, business_case_id UUID NOT NULL REFERENCES business_cases(id), event_code STRING NOT NULL UNIQUE,
  event_title STRING NOT NULL, alternative_a_capex DECIMAL(19,2) NOT NULL, alternative_a_delay_days INT8 NOT NULL,
  alternative_a_protects_date BOOL NOT NULL, alternative_b_capex DECIMAL(19,2) NOT NULL,
  alternative_b_delay_days INT8 NOT NULL, alternative_b_protects_date BOOL NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mission_runs (
  id UUID PRIMARY KEY, session_id UUID NOT NULL REFERENCES demo_sessions(id), generation INT8 NOT NULL,
  mission_id STRING NOT NULL, idempotency_key STRING NOT NULL, status STRING NOT NULL,
  event_id UUID NOT NULL REFERENCES business_case_events(id), conflict_detected BOOL NULL,
  response_snapshot JSONB NULL, completed_at TIMESTAMPTZ NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mission_runs_status_check CHECK (status IN ('PROCESSING','COMPLETED','MEMORY_UNAVAILABLE','GUIDANCE_UNAVAILABLE','FAILED')),
  CONSTRAINT mission_runs_unique UNIQUE (session_id, mission_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS mission_run_matches (
  mission_run_id UUID NOT NULL REFERENCES mission_runs(id), memory_item_id UUID NOT NULL REFERENCES memory_items(id),
  rank INT8 NOT NULL, distance DECIMAL NOT NULL, retrieved_via STRING NOT NULL DEFAULT 'COCKROACH_CLOUD_MCP_VECTOR',
  PRIMARY KEY (mission_run_id, memory_item_id)
);

CREATE TABLE IF NOT EXISTS mission_guidance (
  id UUID PRIMARY KEY, mission_run_id UUID NOT NULL UNIQUE REFERENCES mission_runs(id), model_id STRING NOT NULL,
  summary STRING NOT NULL, recommended_action STRING NOT NULL, uncertainty_statement STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mission_actions (
  id UUID PRIMARY KEY, mission_run_id UUID NOT NULL UNIQUE REFERENCES mission_runs(id), decision_text STRING NOT NULL,
  condition_text STRING NOT NULL, commitment_text STRING NOT NULL, next_review_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE command_receipts DROP CONSTRAINT IF EXISTS command_receipts_command_check;
ALTER TABLE command_receipts ADD CONSTRAINT command_receipts_command_check CHECK
  (command_type IN ('review','response','guidance_retry','reset','orion_review','orion_action'));

GRANT SELECT, INSERT, UPDATE ON TABLE business_cases, business_case_events, mission_runs,
  mission_run_matches, mission_guidance, mission_actions TO decivanta_app;
