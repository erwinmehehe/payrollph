-- #1031 / 2026-10-17: current-schema source-only review reconciliation.
-- These are unnumbered proposals, NOT applied migrations or DBA approval.
-- Unnumbered source-only proposal. NEVER apply directly to production.
CREATE TABLE saved_report_definitions (
 id serial PRIMARY KEY,organization_id integer NOT NULL CONSTRAINT "saved_report_definitions_organization_id_organizations_id_fk" REFERENCES "organizations"("id") ON DELETE CASCADE,
 user_id integer NOT NULL CONSTRAINT "saved_report_definitions_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE CASCADE,
 name varchar(100) NOT NULL,report_key varchar(40) NOT NULL,
 selected_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
 row_filters jsonb NOT NULL DEFAULT '[]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX saved_reports_user_name_unique ON saved_report_definitions (organization_id,user_id,name);
