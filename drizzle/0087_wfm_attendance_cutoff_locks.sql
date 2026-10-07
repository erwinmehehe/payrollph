CREATE TABLE IF NOT EXISTS "workforce_attendance_lock_policies" (
  "organization_id" integer PRIMARY KEY NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "require_payroll_cutoff_lock" boolean DEFAULT false NOT NULL,
  "updated_by" varchar(120) DEFAULT 'System' NOT NULL,
  "updated_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "workforce_attendance_period_locks" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "lock_type" varchar(24) DEFAULT 'attendance' NOT NULL,
  "status" varchar(16) DEFAULT 'locked' NOT NULL,
  "reason" varchar(240) NOT NULL,
  "locked_by" varchar(120) NOT NULL,
  "locked_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "locked_at" timestamptz DEFAULT now() NOT NULL,
  "unlocked_by" varchar(120),
  "unlocked_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "unlock_reason" varchar(240),
  "unlocked_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "workforce_attendance_period_locks_date_check"
    CHECK ("period_end" >= "period_start"),
  CONSTRAINT "workforce_attendance_period_locks_type_check"
    CHECK ("lock_type" IN ('attendance','payroll_cutoff')),
  CONSTRAINT "workforce_attendance_period_locks_status_check"
    CHECK ("status" IN ('locked','unlocked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "workforce_attendance_period_locks_period_unique"
  ON "workforce_attendance_period_locks" (
    "organization_id","period_start","period_end","lock_type"
  );

CREATE INDEX IF NOT EXISTS "workforce_attendance_period_locks_active_idx"
  ON "workforce_attendance_period_locks" (
    "organization_id","status","period_start","period_end"
  );
