-- Renumbered from draft 0115 to 0117 in pre-release dependency train.
CREATE TABLE IF NOT EXISTS first_payroll_journey_progress (
 organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 step varchar(24) NOT NULL CHECK (step IN ('company','people','time','reviewers','payroll','approval','exports')),
 owner_role varchar(24) NOT NULL CHECK (owner_role IN ('owner','hr','payroll','checker','bookkeeper')),
 data jsonb NOT NULL DEFAULT '{}',
 updated_by_user_id integer NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS first_payroll_journey_tenant_step ON first_payroll_journey_progress(organization_id,step);
