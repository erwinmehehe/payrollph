ALTER TABLE outbox
  ADD COLUMN IF NOT EXISTS provider_message_id varchar(200),
  ADD COLUMN IF NOT EXISTS delivery_status varchar(32),
  ADD COLUMN IF NOT EXISTS delivery_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_detail text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dedupe_key varchar(220);

CREATE UNIQUE INDEX IF NOT EXISTS outbox_dedupe_key_unique
  ON outbox(dedupe_key);

CREATE INDEX IF NOT EXISTS outbox_org_created_idx
  ON outbox(organization_id, created_at);
