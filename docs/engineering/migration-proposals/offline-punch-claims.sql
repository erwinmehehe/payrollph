-- #1031 / 2026-10-17: current-schema source-only review reconciliation.
-- These are unnumbered proposals, NOT applied migrations or DBA approval.
-- UNNUMBERED PROPOSAL / NOT FOR PRODUCTION. Obtain DBA migration receipt and clone rehearsal.
CREATE TABLE offline_punch_claims (
 id serial PRIMARY KEY, organization_id integer NOT NULL CONSTRAINT "offline_punch_claims_organization_id_organizations_id_fk" REFERENCES "organizations"("id") ON DELETE CASCADE,
 employee_id integer NOT NULL CONSTRAINT "offline_punch_claims_employee_id_employees_id_fk" REFERENCES "employees"("id") ON DELETE RESTRICT,
 submitted_by_user_id integer NOT NULL CONSTRAINT "offline_punch_claims_submitted_by_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE RESTRICT,
 client_event_id varchar(64) NOT NULL, claimed_at timestamptz NOT NULL,
 action_type varchar(20) NOT NULL CONSTRAINT offline_claim_action_type_check CHECK (action_type IN ('clock_in','clock_out')),
 status varchar(24) NOT NULL DEFAULT 'pending_review' CONSTRAINT offline_claim_status_check CHECK (status IN ('pending_review','flagged','dismissed')),
 reviewed_by_user_id integer CONSTRAINT "offline_punch_claims_reviewed_by_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE RESTRICT, reviewed_at timestamptz,
 review_note varchar(400), created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT workflow_offline_employee_tenant_fk FOREIGN KEY (organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX offline_punch_client_event_unique ON offline_punch_claims (organization_id,employee_id,client_event_id);
CREATE INDEX offline_punch_pending_org_idx ON offline_punch_claims(organization_id,status,created_at);
