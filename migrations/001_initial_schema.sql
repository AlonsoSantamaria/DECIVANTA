CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), slug STRING NOT NULL UNIQUE, name STRING NOT NULL,
  default_locale STRING NOT NULL DEFAULT 'en', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT organizations_locale_check CHECK (default_locale IN ('en', 'es-MX'))
);

CREATE TABLE IF NOT EXISTS decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id),
  decision_code STRING NOT NULL UNIQUE, initiative_name STRING NOT NULL, decision_title STRING NOT NULL,
  decision_text STRING NOT NULL, rationale STRING NOT NULL, decision_date DATE NOT NULL,
  baseline_status STRING NOT NULL, language_code STRING NOT NULL DEFAULT 'en', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT decisions_status_check CHECK (baseline_status IN ('APPROVED', 'MONITORING', 'APPROVED_MONITORING_CONDITIONS'))
);

CREATE TABLE IF NOT EXISTS decision_assumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), decision_id UUID NOT NULL REFERENCES decisions(id),
  assumption_code STRING NOT NULL UNIQUE, metric_code STRING NOT NULL, operator STRING NOT NULL,
  threshold_value DECIMAL(19,2) NOT NULL, currency_code STRING NOT NULL, description STRING NOT NULL,
  materiality STRING NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assumptions_operator_check CHECK (operator IN ('GTE')),
  CONSTRAINT assumptions_materiality_check CHECK (materiality IN ('MATERIAL'))
);

CREATE TABLE IF NOT EXISTS forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id),
  forecast_code STRING NOT NULL UNIQUE, metric_code STRING NOT NULL, value DECIMAL(19,2) NOT NULL,
  currency_code STRING NOT NULL, as_of_date DATE NOT NULL, source_label STRING NOT NULL,
  language_code STRING NOT NULL DEFAULT 'en', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id),
  source_type STRING NOT NULL, source_id UUID NOT NULL, content STRING NOT NULL,
  language_code STRING NOT NULL DEFAULT 'en', embedding_model STRING NOT NULL,
  embedding VECTOR(1024), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT memory_items_source_type_check CHECK (source_type IN ('decision', 'rationale', 'assumption')),
  CONSTRAINT memory_items_source_unique UNIQUE (organization_id, source_type, source_id)
);

CREATE TABLE IF NOT EXISTS demo_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), token_hash BYTES NOT NULL UNIQUE,
  organization_id UUID NOT NULL REFERENCES organizations(id), generation INT8 NOT NULL DEFAULT 1,
  current_review_run_id UUID NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT demo_sessions_generation_check CHECK (generation > 0)
);

CREATE TABLE IF NOT EXISTS command_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), session_id UUID NOT NULL REFERENCES demo_sessions(id),
  generation INT8 NOT NULL, command_type STRING NOT NULL, idempotency_key STRING NOT NULL,
  request_hash BYTES NOT NULL, status STRING NOT NULL, resource_id UUID NULL,
  response_snapshot JSONB NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ NULL,
  CONSTRAINT command_receipts_command_check CHECK (command_type IN ('review', 'response', 'guidance_retry', 'reset')),
  CONSTRAINT command_receipts_status_check CHECK (status IN ('processing', 'completed', 'failed')),
  CONSTRAINT command_receipts_unique UNIQUE (session_id, command_type, idempotency_key)
);

CREATE TABLE IF NOT EXISTS review_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), session_id UUID NOT NULL REFERENCES demo_sessions(id),
  generation INT8 NOT NULL, idempotency_key STRING NOT NULL, status STRING NOT NULL,
  forecast_id UUID NOT NULL REFERENCES forecasts(id), decision_id UUID NULL REFERENCES decisions(id),
  assumption_id UUID NULL REFERENCES decision_assumptions(id), threshold_value DECIMAL(19,2) NULL,
  observed_value DECIMAL(19,2) NULL, variance_value DECIMAL(19,2) NULL, condition_met BOOL NULL,
  failure_code STRING NULL, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ NULL,
  CONSTRAINT review_runs_status_check CHECK (status IN ('PROCESSING', 'COMPLETED', 'GUIDANCE_UNAVAILABLE', 'MEMORY_UNAVAILABLE', 'EVIDENCE_UNAVAILABLE', 'FAILED')),
  CONSTRAINT review_runs_unique UNIQUE (session_id, generation, idempotency_key)
);

ALTER TABLE demo_sessions ADD CONSTRAINT IF NOT EXISTS demo_sessions_current_review_fk
  FOREIGN KEY (current_review_run_id) REFERENCES review_runs(id);

CREATE TABLE IF NOT EXISTS review_memory_matches (
  review_run_id UUID NOT NULL REFERENCES review_runs(id), memory_item_id UUID NOT NULL REFERENCES memory_items(id),
  rank INT8 NOT NULL, distance DECIMAL NOT NULL, retrieved_via STRING NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (review_run_id, memory_item_id),
  CONSTRAINT review_memory_rank_check CHECK (rank > 0),
  CONSTRAINT review_memory_via_check CHECK (retrieved_via IN ('COCKROACH_CLOUD_MCP_VECTOR'))
);

CREATE TABLE IF NOT EXISTS guidance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), review_run_id UUID NOT NULL UNIQUE REFERENCES review_runs(id),
  model_id STRING NOT NULL, prompt_version STRING NOT NULL, summary STRING NOT NULL,
  recommended_action STRING NOT NULL, explanation STRING NOT NULL, caveats JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT guidance_action_check CHECK (recommended_action IN ('REQUEST_REVISED_SCENARIO'))
);

CREATE TABLE IF NOT EXISTS executive_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), review_run_id UUID NOT NULL UNIQUE REFERENCES review_runs(id),
  action STRING NOT NULL, note STRING NOT NULL DEFAULT '', executive_name STRING NOT NULL,
  next_review_date DATE NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT executive_response_action_check CHECK (action IN ('REQUEST_REVISED_SCENARIO', 'CONTINUE_WITH_CONDITIONS', 'DISMISS_ALERT'))
);

CREATE TABLE IF NOT EXISTS memory_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id),
  session_id UUID NULL REFERENCES demo_sessions(id), generation INT8 NULL, review_run_id UUID NULL REFERENCES review_runs(id),
  event_type STRING NOT NULL, source_type STRING NOT NULL, source_id UUID NULL, title STRING NOT NULL,
  details JSONB NOT NULL, occurred_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT memory_events_type_check CHECK (event_type IN ('DECISION_RECORDED', 'RATIONALE_PRESERVED', 'ASSUMPTION_RECORDED', 'EVIDENCE_RECEIVED', 'MEMORY_RETRIEVED', 'CONDITION_EVALUATED', 'GUIDANCE_GENERATED', 'GUIDANCE_UNAVAILABLE', 'EXECUTIVE_RESPONSE_RECORDED', 'FOLLOW_UP_SCHEDULED')),
  CONSTRAINT memory_events_source_check CHECK (source_type IN ('decision', 'evidence', 'calculation', 'guidance', 'executive', 'follow-up', 'system'))
);

CREATE INDEX IF NOT EXISTS decisions_organization_idx ON decisions (organization_id, decision_code);
CREATE INDEX IF NOT EXISTS forecasts_organization_idx ON forecasts (organization_id, forecast_code);
CREATE INDEX IF NOT EXISTS memory_events_projection_idx ON memory_events (organization_id, session_id, generation, occurred_at);

CREATE VECTOR INDEX IF NOT EXISTS memory_items_org_embedding_idx
ON memory_items (
  organization_id,
  embedding vector_cosine_ops
);

GRANT SELECT, INSERT, UPDATE ON TABLE
  organizations, decisions, decision_assumptions, forecasts, memory_items,
  demo_sessions, command_receipts, review_runs, review_memory_matches,
  guidance_records, executive_responses, memory_events
TO decivanta_app;

REVOKE admin FROM decivanta_app;
