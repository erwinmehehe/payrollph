-- QA-only isolated rehearsal. Never apply to the original/default Neon branch.
-- Observed 2026-10-16: src/app/api/workforce/schedules/route.ts performs
-- db.select() from workforce_schedule_guardrail_policies, which was absent.
-- Applied once on QA branch br-green-hat-b77qj8fs. This file documents
-- exactly the intended Drizzle table contract; NOT a production migration.
DO $qa$
BEGIN
 IF current_setting('neon.project_id',true) <> 'calm-wave-70219564'
 OR current_setting('neon.branch_id',true) <> 'br-green-hat-b77qj8fs'
 OR current_setting('neon.endpoint_id',true) <> 'ep-old-paper-b7k36yuc'
 OR current_database() <> 'neondb'
 THEN RAISE EXCEPTION 'QA schema target mismatch'; END IF;

 IF to_regclass('public.workforce_schedule_guardrail_policies') IS NULL THEN
   CREATE TABLE public.workforce_schedule_guardrail_policies (
     id serial PRIMARY KEY,
     organization_id integer NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
     minimum_rest_minutes integer NOT NULL DEFAULT 0,
     max_consecutive_working_days integer NOT NULL DEFAULT 0,
     rolling_seven_day_minutes integer NOT NULL DEFAULT 0,
     enforcement_mode varchar(24) NOT NULL DEFAULT 'advisory',
     active boolean NOT NULL DEFAULT true,
     updated_by varchar(120) NOT NULL DEFAULT 'System',
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE INDEX workforce_schedule_guardrail_policy_org_idx
   ON public.workforce_schedule_guardrail_policies(organization_id);
 END IF;
END $qa$;
