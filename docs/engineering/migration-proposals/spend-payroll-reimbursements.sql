-- WIP proposal. Do not apply to production without sequential migration review.
CREATE TABLE IF NOT EXISTS "expense_category_policies" (
  "id" serial PRIMARY KEY, "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "category" varchar(60) NOT NULL, "taxable" boolean NOT NULL,
  "review_reference" varchar(200) NOT NULL,
  "reviewed_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "expense_category_policies_org_category" ON "expense_category_policies"("organization_id","category");
ALTER TABLE "expense_claims" ADD COLUMN IF NOT EXISTS "category_policy_id" integer REFERENCES "expense_category_policies"("id");
ALTER TABLE "expense_claims" ADD COLUMN IF NOT EXISTS "taxable" boolean NOT NULL DEFAULT false;
ALTER TABLE "expense_claims" ADD COLUMN IF NOT EXISTS "approved_amount" numeric(12,2);
ALTER TABLE "expense_claims" ADD COLUMN IF NOT EXISTS "receipt_storage_key" varchar(512);
ALTER TABLE "expense_claims" ADD COLUMN IF NOT EXISTS "receipt_sha256" varchar(64);
ALTER TABLE "expense_claims" ADD COLUMN IF NOT EXISTS "receipt_mime" varchar(100);
ALTER TABLE "expense_claims" ADD COLUMN IF NOT EXISTS "receipt_file_name" varchar(200);
ALTER TABLE "expense_claims" ADD COLUMN IF NOT EXISTS "receipt_scan_note" varchar(240);
