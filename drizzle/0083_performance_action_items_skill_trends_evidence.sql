-- HCM performance follow-through: governed 1:1 action items with owner,
-- due-date, visibility, completion, and immutable event history.

CREATE TABLE IF NOT EXISTS "performance_one_on_one_action_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "one_on_one_id" integer NOT NULL REFERENCES "performance_one_on_ones"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "owner_kind" varchar(16) NOT NULL,
  "owner_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "owner_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "owner_name" varchar(120) NOT NULL,
  "title" varchar(220) NOT NULL,
  "detail" text,
  "due_date" date NOT NULL,
  "visibility" varchar(24) NOT NULL DEFAULT 'employee_shared',
  "status" varchar(24) NOT NULL DEFAULT 'open',
  "completed_at" timestamptz,
  "completed_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "completed_by_name" varchar(120),
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by_name" varchar(120) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "performance_one_on_one_action_items_owner_kind_check"
    CHECK ("owner_kind" IN ('employee','manager')),
  CONSTRAINT "performance_one_on_one_action_items_owner_check"
    CHECK (
      ("owner_kind" = 'employee' AND "owner_employee_id" IS NOT NULL)
      OR ("owner_kind" = 'manager' AND "owner_user_id" IS NOT NULL)
    ),
  CONSTRAINT "performance_one_on_one_action_items_visibility_check"
    CHECK ("visibility" IN ('employee_shared','manager_private')),
  CONSTRAINT "performance_one_on_one_action_items_status_check"
    CHECK ("status" IN ('open','in_progress','completed','cancelled'))
);

CREATE INDEX IF NOT EXISTS "performance_one_on_one_action_items_meeting_idx"
  ON "performance_one_on_one_action_items" ("organization_id","one_on_one_id","status","due_date");

CREATE INDEX IF NOT EXISTS "performance_one_on_one_action_items_owner_user_idx"
  ON "performance_one_on_one_action_items" ("organization_id","owner_user_id","status","due_date");

CREATE INDEX IF NOT EXISTS "performance_one_on_one_action_items_owner_employee_idx"
  ON "performance_one_on_one_action_items" ("organization_id","owner_employee_id","status","due_date");

CREATE TABLE IF NOT EXISTS "performance_one_on_one_action_item_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "action_item_id" integer NOT NULL REFERENCES "performance_one_on_one_action_items"("id") ON DELETE cascade,
  "one_on_one_id" integer NOT NULL REFERENCES "performance_one_on_ones"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "event_type" varchar(32) NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "actor_name" varchar(120) NOT NULL,
  "note" text,
  "before_snapshot" jsonb,
  "after_snapshot" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "performance_one_on_one_action_item_events_type_check"
    CHECK ("event_type" IN ('created','status_changed','reassigned','due_date_changed','visibility_changed','reopened','cancelled'))
);

CREATE INDEX IF NOT EXISTS "performance_one_on_one_action_item_events_item_idx"
  ON "performance_one_on_one_action_item_events" ("organization_id","action_item_id","created_at");
