-- Additive UI workflow storage. Requires a tested DBA migration receipt before flag activation.
-- Idempotent on a rehearsal clone; production review must verify applied hashes.
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
CREATE TABLE IF NOT EXISTS employee_service_cases (
 id serial PRIMARY KEY,
 organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 employee_id integer NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
 category varchar(40) NOT NULL,
 subject varchar(160) NOT NULL,
 description text NOT NULL,
 priority varchar(16) NOT NULL DEFAULT 'normal',
 status varchar(24) NOT NULL DEFAULT 'open',
 assigned_to_user_id integer REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT service_case_status_check CHECK(status IN ('open','in_review','waiting_employee','resolved')),
 CONSTRAINT service_case_priority_check CHECK(priority IN ('normal','high'))
);
CREATE INDEX IF NOT EXISTS employee_service_cases_org_status_idx ON employee_service_cases(organization_id,status,created_at);
CREATE INDEX IF NOT EXISTS employee_service_cases_employee_idx ON employee_service_cases(organization_id,employee_id,created_at);
CREATE TABLE IF NOT EXISTS employee_service_case_messages (
 id serial PRIMARY KEY,
 organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 case_id integer NOT NULL REFERENCES employee_service_cases(id) ON DELETE CASCADE,
 author_user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 body text NOT NULL,
 internal boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_case_messages_case_idx ON employee_service_case_messages(organization_id,case_id,created_at);
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
-- Defensive tenant-consistent keys for new employee-owned workflow records.
CREATE UNIQUE INDEX IF NOT EXISTS employees_org_id_workflows_unique ON employees(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS employee_service_cases_org_id_unique ON employee_service_cases(organization_id,id);
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workflow_case_employee_tenant_fk') THEN
  ALTER TABLE employee_service_cases ADD CONSTRAINT workflow_case_employee_tenant_fk
   FOREIGN KEY (organization_id,employee_id) REFERENCES employees(organization_id,id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workflow_offline_employee_tenant_fk') THEN
  ALTER TABLE offline_punch_claims ADD CONSTRAINT workflow_offline_employee_tenant_fk
   FOREIGN KEY (organization_id,employee_id) REFERENCES employees(organization_id,id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workflow_case_message_tenant_fk') THEN
  ALTER TABLE employee_service_case_messages ADD CONSTRAINT workflow_case_message_tenant_fk
   FOREIGN KEY (organization_id,case_id) REFERENCES employee_service_cases(organization_id,id);
 END IF;
END $$;
COMMIT;
