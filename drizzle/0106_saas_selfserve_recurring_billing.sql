-- Automated employer signup + verified, idempotent recurring billing (opt-in).
-- All state is tenant-bound. Never apply unreviewed changes to a live payroll database.
CREATE TABLE IF NOT EXISTS saas_signup_verifications (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  user_id integer NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS saas_billing_checkouts (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id integer NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  reference_id varchar(100) NOT NULL UNIQUE,
  provider_session_id varchar(180) UNIQUE,
  provider_plan_id varchar(180) UNIQUE,
  plan varchar(32) NOT NULL,
  seats integer NOT NULL CHECK (seats BETWEEN 1 AND 2000),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency varchar(8) NOT NULL DEFAULT 'PHP' CHECK (currency='PHP'),
  status varchar(24) NOT NULL DEFAULT 'creating',
  checkout_url text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saas_billing_checkouts_org_idx ON saas_billing_checkouts(organization_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS saas_billing_one_open_checkout ON saas_billing_checkouts(organization_id)
  WHERE status IN ('creating','awaiting_payment','review_required');
CREATE TABLE IF NOT EXISTS saas_billing_state (
  organization_id integer PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id integer NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  provider_plan_id varchar(180),
  last_paid_cycle_id varchar(180),
  paid_through timestamptz,
  recovery_url text,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancelled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS saas_billing_events (
  id serial PRIMARY KEY,
  provider_event_key varchar(250) NOT NULL UNIQUE,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_plan_id varchar(180) NOT NULL,
  event_type varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saas_billing_events_org_idx ON saas_billing_events(organization_id,created_at);
