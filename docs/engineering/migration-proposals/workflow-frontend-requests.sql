-- SOURCE-ONLY unnumbered proposal: saved reports, unverified offline claims and careers visibility.
-- Canonical HR request storage uses main's employee_hr_cases; never create employee_service_cases.
-- Requires independent DBA #910 lineage, isolated clone/restore and product/security signoff.
-- DO NOT APPLY to production; all corresponding feature flags remain OFF.
BEGIN;
ALTER TABLE job_requisitions ADD COLUMN IF NOT EXISTS careers_published boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS saved_report_definitions (
 id serial PRIMARY KEY,
 organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name varchar(100) NOT NULL,
 report_key varchar(40) NOT NULL,
 selected_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
 row_filters jsonb NOT NULL DEFAULT '[]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS saved_reports_user_name_unique ON saved_report_definitions(organization_id,user_id,name);
CREATE TABLE IF NOT EXISTS offline_punch_claims (
 id serial PRIMARY KEY,
 organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 employee_id integer NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
 submitted_by_user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 client_event_id varchar(64) NOT NULL,
 claimed_at timestamptz NOT NULL,
 action_type varchar(20) NOT NULL,
 status varchar(24) NOT NULL DEFAULT 'pending_review',
 reviewed_by_user_id integer REFERENCES users(id) ON DELETE RESTRICT,
 reviewed_at timestamptz,
 review_note varchar(400),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT offline_claim_type_check CHECK(action_type IN ('clock_in','clock_out')),
 CONSTRAINT offline_claim_status_check CHECK(status IN ('pending_review','flagged','dismissed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS offline_punch_client_event_unique ON offline_punch_claims(organization_id,employee_id,client_event_id);
CREATE INDEX IF NOT EXISTS offline_punch_pending_org_idx ON offline_punch_claims(organization_id,status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS employees_org_id_workflows_unique ON employees(organization_id,id);
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workflow_offline_employee_tenant_fk') THEN
  ALTER TABLE offline_punch_claims ADD CONSTRAINT workflow_offline_employee_tenant_fk
   FOREIGN KEY (organization_id,employee_id) REFERENCES employees(organization_id,id);
 END IF;
END $$;
COMMIT;
