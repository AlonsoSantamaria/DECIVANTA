ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS session_id UUID NULL REFERENCES demo_sessions(id);
ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS generation INT8 NULL;
ALTER TABLE memory_items DROP CONSTRAINT IF EXISTS memory_items_source_type_check;
ALTER TABLE memory_items ADD CONSTRAINT memory_items_source_type_check
  CHECK (source_type IN ('decision', 'rationale', 'assumption', 'executive_decision', 'follow_up'));
CREATE INDEX IF NOT EXISTS memory_items_session_scope_idx
  ON memory_items (organization_id, session_id, generation, created_at);
