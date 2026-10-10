-- Tamper-evident audit trail.
--
-- Every audit_events insert is hash-chained per organization by a database
-- trigger, so rows written directly through drizzle (not only recordAuditEvent)
-- are covered. Each row stores chain_seq, prev_hash and row_hash; altering or
-- removing any chained row breaks verification for every later row.
--
-- The chain head is a locked row in audit_chain_heads. Under READ COMMITTED the
-- FOR UPDATE waits for the newest head; under SERIALIZABLE a concurrent writer
-- gets a retryable serialization failure instead of forking the chain.
--
-- UPDATE and direct DELETE on audit_events are rejected. Deletes cascading from
-- an organization deletion are allowed (pg_trigger_depth() > 1). Operators can
-- set `SET LOCAL linaw.audit_maintenance = 'on'` inside a transaction for an
-- authorized, deliberate correction; such a change will still fail verification.
--
-- Rows written before this migration keep null hashes and are reported as
-- legacy (unchained) by verification.

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS chain_seq bigint;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS prev_hash varchar(64);
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS row_hash varchar(64);

CREATE TABLE IF NOT EXISTS audit_chain_heads (
  chain_key integer PRIMARY KEY,
  last_seq bigint NOT NULL DEFAULT 0,
  last_hash varchar(64) NOT NULL DEFAULT repeat('0', 64),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS audit_events_chain_seq_unique
  ON audit_events ((coalesce(organization_id, 0)), chain_seq)
  WHERE chain_seq IS NOT NULL;

CREATE OR REPLACE FUNCTION audit_event_row_hash(
  prev text,
  seq bigint,
  event_id integer,
  org integer,
  actor text,
  action text,
  resource text,
  metadata jsonb,
  created timestamptz
) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    prev,
    seq,
    event_id,
    org,
    actor,
    action,
    resource,
    metadata,
    to_char(created AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
  )::text, 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION audit_events_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  key integer := coalesce(NEW.organization_id, 0);
  head_seq bigint;
  head_hash varchar(64);
BEGIN
  INSERT INTO audit_chain_heads (chain_key) VALUES (key) ON CONFLICT (chain_key) DO NOTHING;
  SELECT last_seq, last_hash INTO head_seq, head_hash
    FROM audit_chain_heads WHERE chain_key = key FOR UPDATE;

  NEW.chain_seq := head_seq + 1;
  NEW.prev_hash := head_hash;
  NEW.row_hash := audit_event_row_hash(
    NEW.prev_hash, NEW.chain_seq, NEW.id, NEW.organization_id,
    NEW.actor, NEW.action, NEW.resource, NEW.metadata, NEW.created_at
  );

  UPDATE audit_chain_heads
    SET last_seq = NEW.chain_seq, last_hash = NEW.row_hash, updated_at = now()
    WHERE chain_key = key;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION audit_events_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('linaw.audit_maintenance', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_chain_insert ON audit_events;
CREATE TRIGGER audit_events_chain_insert
  BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_chain();

DROP TRIGGER IF EXISTS audit_events_protect_mutation ON audit_events;
CREATE TRIGGER audit_events_protect_mutation
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_protect();
