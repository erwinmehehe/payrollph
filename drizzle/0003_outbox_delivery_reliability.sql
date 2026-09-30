ALTER TABLE outbox
  ADD COLUMN IF NOT EXISTS dedupe_key varchar(200),
  ADD COLUMN IF NOT EXISTS provider_message_id varchar(200),
  ADD COLUMN IF NOT EXISTS delivery_status varchar(32),
  ADD COLUMN IF NOT EXISTS delivery_detail text,
  ADD COLUMN IF NOT EXISTS delivery_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS outbox_dedupe_key_unique
  ON outbox(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS outbox_org_created_idx
  ON outbox(organization_id, created_at);

CREATE INDEX IF NOT EXISTS outbox_retry_idx
  ON outbox(status, next_attempt_at);
