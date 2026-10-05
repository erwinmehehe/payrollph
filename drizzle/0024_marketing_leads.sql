CREATE TABLE IF NOT EXISTS marketing_leads (
  id serial PRIMARY KEY,
  kind varchar(32) NOT NULL,
  name varchar(120) NOT NULL,
  email varchar(180) NOT NULL,
  company varchar(160) NOT NULL,
  headcount varchar(40),
  payroll_frequency varchar(40),
  entities varchar(40),
  notes text,
  source_path varchar(120) NOT NULL,
  attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(24) NOT NULL DEFAULT 'new',
  notification_status varchar(24) NOT NULL DEFAULT 'not-configured',
  notification_provider varchar(40),
  notification_outbox_id integer,
  notification_attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT marketing_leads_kind_check
    CHECK (kind IN ('demo', 'trial-access', 'payroll-outsourcing')),
  CONSTRAINT marketing_leads_status_check
    CHECK (status IN ('new', 'contacted', 'qualified', 'closed')),
  CONSTRAINT marketing_leads_notification_status_check
    CHECK (notification_status IN ('not-configured', 'queued', 'sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS marketing_leads_status_created_idx
  ON marketing_leads(status, created_at DESC);

CREATE INDEX IF NOT EXISTS marketing_leads_kind_created_idx
  ON marketing_leads(kind, created_at DESC);


ALTER TABLE marketing_leads
  ADD COLUMN IF NOT EXISTS attribution jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $compat$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_leads_kind_check') THEN
    ALTER TABLE marketing_leads
      ADD CONSTRAINT marketing_leads_kind_check
      CHECK (kind IN ('demo', 'trial-access', 'payroll-outsourcing'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_leads_status_check') THEN
    ALTER TABLE marketing_leads
      ADD CONSTRAINT marketing_leads_status_check
      CHECK (status IN ('new', 'contacted', 'qualified', 'closed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_leads_notification_status_check') THEN
    ALTER TABLE marketing_leads
      ADD CONSTRAINT marketing_leads_notification_status_check
      CHECK (notification_status IN ('not-configured', 'queued', 'sent', 'failed'));
  END IF;
END
$compat$;
