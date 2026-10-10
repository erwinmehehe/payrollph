-- Tamper-evident audit trail.
--
-- 1. Append-only: UPDATE and direct DELETE on audit_events are rejected by a
--    trigger, immediately, for every writer (recordAuditEvent and direct
--    drizzle inserts alike). Deletes cascading from an organization deletion
--    are allowed (pg_trigger_depth() > 1).
-- 2. Hash chain: seal_audit_events() appends committed, unsealed rows to a
--    per-organization SHA-256 chain (chain_seq, prev_hash, row_hash). Sealing
--    runs outside application transactions under a try-lock, so audit inserts
--    never take a lock and can never deadlock or slow payroll writes. Once a
--    row is sealed, altering or removing it breaks verification for every
--    later row in that organization's chain. Existing history is sealed too.
--
-- `SET LOCAL linaw.audit_maintenance = 'on'` inside a transaction permits an
-- authorized, deliberate correction; a sealed row changed this way still fails
-- verification.

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
CREATE INDEX IF NOT EXISTS audit_events_unsealed_idx
  ON audit_events (id)
  WHERE chain_seq IS NULL;

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

CREATE OR REPLACE FUNCTION audit_events_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('linaw.audit_maintenance', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  -- The sealer may only fill the chain columns of an unsealed row.
  IF TG_OP = 'UPDATE'
    AND current_setting('linaw.audit_sealing', true) = 'on'
    AND OLD.chain_seq IS NULL
    AND (NEW.id, NEW.organization_id, NEW.actor, NEW.action, NEW.resource, NEW.metadata, NEW.created_at)
      IS NOT DISTINCT FROM (OLD.id, OLD.organization_id, OLD.actor, OLD.action, OLD.resource, OLD.metadata, OLD.created_at)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_protect_mutation ON audit_events;
CREATE TRIGGER audit_events_protect_mutation
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_protect();

-- Returns the number of rows sealed, or 0 when another sealer holds the lock.
CREATE OR REPLACE FUNCTION seal_audit_events(max_rows integer DEFAULT 500) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  event record;
  key integer;
  head_seq bigint;
  head_hash varchar(64);
  next_hash varchar(64);
  sealed integer := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('linaw:audit-chain-seal')) THEN
    RETURN 0;
  END IF;
  PERFORM set_config('linaw.audit_sealing', 'on', true);

  FOR event IN
    SELECT id, organization_id, actor, action, resource, metadata, created_at
    FROM audit_events
    WHERE chain_seq IS NULL
    ORDER BY id
    LIMIT greatest(max_rows, 1)
  LOOP
    key := coalesce(event.organization_id, 0);
    INSERT INTO audit_chain_heads (chain_key) VALUES (key) ON CONFLICT (chain_key) DO NOTHING;
    SELECT last_seq, last_hash INTO head_seq, head_hash FROM audit_chain_heads WHERE chain_key = key;

    next_hash := audit_event_row_hash(
      head_hash, head_seq + 1, event.id, event.organization_id,
      event.actor, event.action, event.resource, event.metadata, event.created_at
    );
    UPDATE audit_events
      SET chain_seq = head_seq + 1, prev_hash = head_hash, row_hash = next_hash
      WHERE id = event.id;
    UPDATE audit_chain_heads
      SET last_seq = head_seq + 1, last_hash = next_hash, updated_at = now()
      WHERE chain_key = key;
    sealed := sealed + 1;
  END LOOP;

  PERFORM set_config('linaw.audit_sealing', 'off', true);
  RETURN sealed;
END;
$$;
