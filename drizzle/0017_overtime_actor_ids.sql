ALTER TABLE "overtime_requests"
  ADD COLUMN IF NOT EXISTS "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "decided_by_user_id" integer REFERENCES "users"("id") ON DELETE set null;
