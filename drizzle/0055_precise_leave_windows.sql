-- Clock-precise leave; do not round hourly requests to 0.1 day.
ALTER TABLE "leave_requests" ALTER COLUMN "days" TYPE numeric(8,4);
CREATE TABLE IF NOT EXISTS "hcm_leave_time_windows" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "leave_request_id" integer NOT NULL REFERENCES "leave_requests"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "work_date" date NOT NULL,
  "start_time" varchar(5) NOT NULL,
  "end_time" varchar(5) NOT NULL,
  "minutes" integer NOT NULL,
  "standard_day_minutes" integer NOT NULL,
  "exact_day_equivalent" numeric(8,4) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hcm_leave_window_valid_times" CHECK (
    "start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "end_time" > "start_time"
    AND "minutes" BETWEEN 1 AND 1439
    AND "standard_day_minutes" BETWEEN 60 AND 1440
    AND "exact_day_equivalent" > 0
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "hcm_leave_window_request_unique" ON "hcm_leave_time_windows" ("leave_request_id");
CREATE INDEX IF NOT EXISTS "hcm_leave_windows_org_date_idx" ON "hcm_leave_time_windows" ("organization_id","employee_id","work_date");
