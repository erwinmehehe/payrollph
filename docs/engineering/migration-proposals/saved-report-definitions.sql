-- Unnumbered source-only proposal. NEVER apply directly to production.
CREATE TABLE saved_report_definitions (
 id serial PRIMARY KEY,organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name varchar(100) NOT NULL,report_key varchar(40) NOT NULL,
 selected_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
 row_filters jsonb NOT NULL DEFAULT '[]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT saved_reports_user_name_unique UNIQUE(organization_id,user_id,name)
);
