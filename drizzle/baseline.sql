CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"prefix" varchar(16) NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "approval_delegations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"from_approver" varchar(120) NOT NULL,
	"to_approver" varchar(120) NOT NULL,
	"reason" varchar(200) DEFAULT 'Out of office' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"title" varchar(180) NOT NULL,
	"detail" varchar(240) NOT NULL,
	"approver" varchar(120) NOT NULL,
	"due_label" varchar(80) NOT NULL,
	"priority" varchar(32) DEFAULT 'Normal' NOT NULL,
	"status" varchar(32) DEFAULT 'Pending' NOT NULL,
	"decided_by" varchar(120),
	"decided_on_behalf_of" varchar(120),
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer,
	"type" varchar(50) NOT NULL,
	"name" varchar(200) NOT NULL,
	"serial_number" varchar(100),
	"status" varchar(32) DEFAULT 'assigned' NOT NULL,
	"assigned_on" date,
	"returned_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"actor" varchar(120) NOT NULL,
	"action" varchar(160) NOT NULL,
	"resource" varchar(160) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"version" varchar(32) NOT NULL,
	"format" varchar(32) NOT NULL,
	"mappings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benefit_enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"plan_id" integer NOT NULL,
	"monthly_contribution" numeric(10, 2) DEFAULT '0' NOT NULL,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benefit_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"name" varchar(120) NOT NULL,
	"category" varchar(32) NOT NULL,
	"employee_share" numeric(10, 2) DEFAULT '0' NOT NULL,
	"employer_share" numeric(10, 2) DEFAULT '0' NOT NULL,
	"cap" numeric(12, 2),
	"provider" varchar(80),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biometric_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"device_model" varchar(80) NOT NULL,
	"serial_number" varchar(80) NOT NULL,
	"ip_address" varchar(45),
	"port" integer DEFAULT 4370 NOT NULL,
	"branch_name" varchar(120) NOT NULL,
	"protocol" varchar(32) DEFAULT 'ADMS' NOT NULL,
	"status" varchar(32) DEFAULT 'online' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "biometric_devices_serial_number_unique" UNIQUE("serial_number")
);
--> statement-breakpoint
CREATE TABLE "calamity_advisories" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"advisory_number" varchar(80) NOT NULL,
	"policy" varchar(120) NOT NULL,
	"premium_percent" integer DEFAULT 30 NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"affected_unit" varchar(120) NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contractors" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"email" varchar(200) NOT NULL,
	"name" varchar(200) NOT NULL,
	"country" varchar(3) DEFAULT 'PH' NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"rate" numeric(12, 2) NOT NULL,
	"rate_type" varchar(20) DEFAULT 'monthly' NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"contract_start" date,
	"contract_end" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"subject_email" varchar(200) NOT NULL,
	"request_type" varchar(24) NOT NULL,
	"status" varchar(24) DEFAULT 'received' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"handled_by" varchar(120),
	"notes" varchar(400)
);
--> statement-breakpoint
CREATE TABLE "de_minimis_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"benefit_type" varchar(64) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"frequency" varchar(16) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"effective_on" date NOT NULL,
	"ended_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disciplinary_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"case_number" varchar(64) NOT NULL,
	"offense" varchar(160) NOT NULL,
	"incident_date" date NOT NULL,
	"status" varchar(32) DEFAULT 'nte_issued' NOT NULL,
	"nte_issued_at" timestamp with time zone,
	"nte_details" text,
	"employee_explanation" text,
	"explanation_submitted_at" timestamp with time zone,
	"hearing_date" timestamp with time zone,
	"nod_issued_at" timestamp with time zone,
	"nod_decision" text,
	"penalty" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer,
	"kind" varchar(40) NOT NULL,
	"file_name" varchar(200) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"scanned_clean" boolean DEFAULT false NOT NULL,
	"scan_note" varchar(200) DEFAULT '' NOT NULL,
	"uploaded_by" varchar(120) NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "earned_wage_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"requested_amount" numeric(12, 2) NOT NULL,
	"fee" numeric(10, 2) DEFAULT '0' NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"decided_by" varchar(120),
	"payroll_run_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_loans" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"loan_type" varchar(64) NOT NULL,
	"reference_no" varchar(64) NOT NULL,
	"principal" numeric(12, 2) NOT NULL,
	"monthly_amortization" numeric(10, 2) NOT NULL,
	"cutoff_deduction" numeric(10, 2) NOT NULL,
	"remaining_balance" numeric(12, 2) NOT NULL,
	"total_paid" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"startDate" date,
	"endDate" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"org_unit_id" integer,
	"employee_no" varchar(32) NOT NULL,
	"first_name" varchar(80) NOT NULL,
	"last_name" varchar(80) NOT NULL,
	"title" varchar(120) NOT NULL,
	"employment_type" varchar(32) DEFAULT 'Regular' NOT NULL,
	"status" varchar(32) DEFAULT 'Active' NOT NULL,
	"avatar_initials" varchar(4) NOT NULL,
	"basic_rate" numeric(12, 2) NOT NULL,
	"mwe" boolean DEFAULT false NOT NULL,
	"bank_account" varchar(160),
	"bank_code" varchar(16),
	"mobile" varchar(24),
	"email" varchar(200),
	"region" varchar(32) DEFAULT 'NCR' NOT NULL,
	"tin" varchar(32),
	"sss_no" varchar(32),
	"philhealth_no" varchar(32),
	"pagibig_no" varchar(32),
	"birth_date" date,
	"emergency_contact" varchar(120),
	"emergency_phone" varchar(32),
	"dependents_count" integer DEFAULT 0,
	"education" varchar(120),
	"start_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"category" varchar(60) NOT NULL,
	"description" varchar(240) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"incurred_on" date NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"decided_by" varchar(120),
	"payroll_run_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freelancer_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"monthly_income" numeric(12, 2) DEFAULT '0' NOT NULL,
	"annual_expenses" numeric(12, 2) DEFAULT '0' NOT NULL,
	"filing_method" varchar(32) DEFAULT '8% flat' NOT NULL,
	"next_due_date" date NOT NULL,
	CONSTRAINT "freelancer_profiles_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "health_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"ok" boolean NOT NULL,
	"latency_ms" integer NOT NULL,
	"detail" varchar(160) DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"holiday_date" date NOT NULL,
	"name" varchar(120) NOT NULL,
	"kind" varchar(24) DEFAULT 'regular' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"key_value" varchar(200) NOT NULL,
	"endpoint" varchar(120) NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_key_value_unique" UNIQUE("key_value")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"file_name" varchar(200) NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(24) DEFAULT 'completed' NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"email" varchar(200) NOT NULL,
	"role" varchar(32) DEFAULT 'admin' NOT NULL,
	"org_unit_id" integer,
	"token_hash" varchar(64) NOT NULL,
	"invited_by" varchar(120) NOT NULL,
	"accepted_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"subscription_id" integer,
	"number" varchar(32) NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" varchar(8) DEFAULT 'PHP' NOT NULL,
	"status" varchar(24) DEFAULT 'open' NOT NULL,
	"period_start" date,
	"period_end" date,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_applicants" (
	"id" serial PRIMARY KEY NOT NULL,
	"requisition_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"full_name" varchar(160) NOT NULL,
	"email" varchar(160) NOT NULL,
	"phone" varchar(32),
	"stage" varchar(32) DEFAULT 'applied' NOT NULL,
	"rating" integer DEFAULT 3 NOT NULL,
	"resume_url" text,
	"notes" text,
	"offered_salary" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_requisitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"title" varchar(160) NOT NULL,
	"department" varchar(120) NOT NULL,
	"headcount" integer DEFAULT 1 NOT NULL,
	"salary_min" numeric(12, 2),
	"salary_max" numeric(12, 2),
	"employment_type" varchar(32) DEFAULT 'Full-time' NOT NULL,
	"status" varchar(32) DEFAULT 'open' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"leave_type" varchar(40) NOT NULL,
	"year" integer NOT NULL,
	"opening" numeric(6, 1) DEFAULT '0' NOT NULL,
	"accrued" numeric(6, 1) DEFAULT '0' NOT NULL,
	"used" numeric(6, 1) DEFAULT '0' NOT NULL,
	"pending" numeric(6, 1) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_conversions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"leave_type" varchar(40) NOT NULL,
	"days_converted" numeric(6, 1) NOT NULL,
	"daily_rate" numeric(10, 2) NOT NULL,
	"cash_amount" numeric(12, 2) NOT NULL,
	"tax_exempt" boolean DEFAULT true NOT NULL,
	"payroll_run_id" integer,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"leave_type" varchar(40) NOT NULL,
	"annual_days" numeric(6, 1) NOT NULL,
	"carry_over_max" numeric(6, 1),
	"max_balance" numeric(6, 1),
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"leave_type" varchar(40) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" numeric(6, 1) NOT NULL,
	"reason" varchar(240) DEFAULT '' NOT NULL,
	"status" varchar(32) DEFAULT 'Pending' NOT NULL,
	"approval_task_id" integer,
	"decided_by" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"loan_id" integer NOT NULL,
	"payroll_run_id" integer,
	"amount" numeric(10, 2) NOT NULL,
	"payment_date" date NOT NULL,
	"reference" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "min_wage_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"region" varchar(32) NOT NULL,
	"daily_rate" numeric(10, 2) NOT NULL,
	"wage_order" varchar(40) NOT NULL,
	"effective_on" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_units" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"parent_id" integer,
	"type" varchar(32) NOT NULL,
	"name" varchar(120) NOT NULL,
	"code" varchar(32) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"legal_name" varchar(200) NOT NULL,
	"account_type" varchar(32) DEFAULT 'business' NOT NULL,
	"plan" varchar(32) DEFAULT 'Core' NOT NULL,
	"employee_count" integer DEFAULT 0 NOT NULL,
	"color" varchar(12) DEFAULT '#176B5D' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"channel" varchar(12) DEFAULT 'email' NOT NULL,
	"recipient" varchar(200) NOT NULL,
	"subject" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"purpose" varchar(60) NOT NULL,
	"status" varchar(24) DEFAULT 'queued' NOT NULL,
	"provider" varchar(40) DEFAULT 'none' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "payroll_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"payroll_run_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"gross_pay" numeric(12, 2) NOT NULL,
	"deductions" numeric(12, 2) NOT NULL,
	"net_pay" numeric(12, 2) NOT NULL,
	"status" varchar(32) DEFAULT 'Ready' NOT NULL,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trace" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"payroll_run_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"chunk_size" integer DEFAULT 25 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"locked_at" timestamp with time zone,
	"locked_by" varchar(80),
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"period_label" varchar(80) NOT NULL,
	"scope_label" varchar(120) DEFAULT 'All locations' NOT NULL,
	"status" varchar(32) DEFAULT 'Draft' NOT NULL,
	"pay_date" date NOT NULL,
	"employee_count" integer DEFAULT 0 NOT NULL,
	"gross_pay" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_pay" numeric(14, 2) DEFAULT '0' NOT NULL,
	"exceptions" integer DEFAULT 0 NOT NULL,
	"rule_version" varchar(48) DEFAULT 'PH-2026.01' NOT NULL,
	"processed_chunks" integer DEFAULT 0 NOT NULL,
	"total_chunks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" serial PRIMARY KEY NOT NULL,
	"payroll_entry_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"period_label" varchar(80) NOT NULL,
	"content" text NOT NULL,
	"rule_version" varchar(48) DEFAULT 'PH-2026.01' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"monthly_base" numeric(10, 2) NOT NULL,
	"per_employee" numeric(10, 2) NOT NULL,
	"modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" varchar(32) NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provisioning_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"kind" varchar(24) NOT NULL,
	"title" varchar(160) NOT NULL,
	"owner" varchar(80) DEFAULT 'People Ops' NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" varchar(120)
);
--> statement-breakpoint
CREATE TABLE "rate_limit_hits" (
	"id" serial PRIMARY KEY NOT NULL,
	"bucket_key" varchar(200) NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduler_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_name" varchar(80) NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "scheduler_state_job_name_unique" UNIQUE("job_name")
);
--> statement-breakpoint
CREATE TABLE "separation_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"separation_type" varchar(32) NOT NULL,
	"notice_date" date NOT NULL,
	"last_day" date NOT NULL,
	"clearance_status" varchar(32) DEFAULT 'in_progress' NOT NULL,
	"it_cleared" boolean DEFAULT false NOT NULL,
	"admin_cleared" boolean DEFAULT false NOT NULL,
	"finance_cleared" boolean DEFAULT false NOT NULL,
	"hr_cleared" boolean DEFAULT false NOT NULL,
	"prorated_13th_month" numeric(12, 2) DEFAULT '0' NOT NULL,
	"unused_leave_credits" numeric(6, 1) DEFAULT '0' NOT NULL,
	"leave_monetization_pay" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_adjustment" numeric(12, 2) DEFAULT '0' NOT NULL,
	"loan_deductions" numeric(12, 2) DEFAULT '0' NOT NULL,
	"net_final_pay" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"coe_issued" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"ip" varchar(64),
	"last_seen_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"plan" varchar(32) DEFAULT 'Core' NOT NULL,
	"status" varchar(32) DEFAULT 'trialing' NOT NULL,
	"seat_limit" integer DEFAULT 10 NOT NULL,
	"billing_cycle" varchar(16) DEFAULT 'monthly' NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"currency" varchar(8) DEFAULT 'PHP' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"period_start" timestamp with time zone,
	"period_ends_at" timestamp with time zone,
	"provider" varchar(32),
	"provider_ref" varchar(120),
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "time_punches" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"work_date" date NOT NULL,
	"time_in" timestamp with time zone,
	"time_out" timestamp with time zone,
	"shift_start" varchar(8) DEFAULT '09:00' NOT NULL,
	"shift_end" varchar(8) DEFAULT '18:00' NOT NULL,
	"status" varchar(32) DEFAULT 'Complete' NOT NULL,
	"source" varchar(32) DEFAULT 'web_bundy',
	"device_serial" varchar(80),
	"ip_address" varchar(45),
	"location" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "user_organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"role" varchar(32) DEFAULT 'admin' NOT NULL,
	"org_unit_id" integer
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(180) NOT NULL,
	"name" varchar(120) NOT NULL,
	"password_hash" text NOT NULL,
	"role" varchar(32) DEFAULT 'owner' NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"totp_secret" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"backup_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"employee_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"event" varchar(80) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signature" text NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"response_code" integer,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "year_end_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"tax_year" integer NOT NULL,
	"gross_compensation" numeric(14, 2) NOT NULL,
	"thirteenth_month" numeric(14, 2) DEFAULT '0' NOT NULL,
	"non_taxable" numeric(14, 2) DEFAULT '0' NOT NULL,
	"statutory_contributions" numeric(14, 2) DEFAULT '0' NOT NULL,
	"taxable_income" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_due" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_withheld" numeric(14, 2) DEFAULT '0' NOT NULL,
	"adjustment" numeric(14, 2) DEFAULT '0' NOT NULL,
	"outcome" varchar(24) DEFAULT 'balanced' NOT NULL,
	"mwe" boolean DEFAULT false NOT NULL,
	"breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rule_version" varchar(48) DEFAULT 'PH-2026.01' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit_enrollments" ADD CONSTRAINT "benefit_enrollments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit_enrollments" ADD CONSTRAINT "benefit_enrollments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit_enrollments" ADD CONSTRAINT "benefit_enrollments_plan_id_benefit_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."benefit_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit_plans" ADD CONSTRAINT "benefit_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_devices" ADD CONSTRAINT "biometric_devices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calamity_advisories" ADD CONSTRAINT "calamity_advisories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "de_minimis_grants" ADD CONSTRAINT "de_minimis_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "de_minimis_grants" ADD CONSTRAINT "de_minimis_grants_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_cases" ADD CONSTRAINT "disciplinary_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_cases" ADD CONSTRAINT "disciplinary_cases_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earned_wage_requests" ADD CONSTRAINT "earned_wage_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earned_wage_requests" ADD CONSTRAINT "earned_wage_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freelancer_profiles" ADD CONSTRAINT "freelancer_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applicants" ADD CONSTRAINT "job_applicants_requisition_id_job_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."job_requisitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applicants" ADD CONSTRAINT "job_applicants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_conversions" ADD CONSTRAINT "leave_conversions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_conversions" ADD CONSTRAINT "leave_conversions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_loan_id_employee_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."employee_loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_jobs" ADD CONSTRAINT "payroll_jobs_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_jobs" ADD CONSTRAINT "payroll_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payroll_entry_id_payroll_entries_id_fk" FOREIGN KEY ("payroll_entry_id") REFERENCES "public"."payroll_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_tasks" ADD CONSTRAINT "provisioning_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_tasks" ADD CONSTRAINT "provisioning_tasks_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "separation_records" ADD CONSTRAINT "separation_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "separation_records" ADD CONSTRAINT "separation_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_punches" ADD CONSTRAINT "time_punches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_punches" ADD CONSTRAINT "time_punches_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_organizations" ADD CONSTRAINT "user_organizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_organizations" ADD CONSTRAINT "user_organizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_adjustments" ADD CONSTRAINT "year_end_adjustments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_adjustments" ADD CONSTRAINT "year_end_adjustments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "benefit_enrollment_unique" ON "benefit_enrollments" USING btree ("employee_id","plan_id","started_on");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_balance_unique" ON "leave_balances" USING btree ("employee_id","leave_type","year");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_window_idx" ON "rate_limit_hits" USING btree ("bucket_key","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "user_org_unique" ON "user_organizations" USING btree ("user_id","organization_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS government_filing_validations (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payroll_run_id integer REFERENCES payroll_runs(id) ON DELETE SET NULL,
  agency varchar(16) NOT NULL,
  form varchar(24) NOT NULL,
  period_label varchar(80) NOT NULL,
  file_name varchar(160) NOT NULL,
  file_sha256 varchar(64) NOT NULL,
  generator_version varchar(48) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'generated',
  submission_method varchar(16),
  agency_reference varchar(80),
  submitted_at timestamptz,
  outcome_note text,
  generated_by varchar(120) NOT NULL,
  recorded_by varchar(120),
  recorded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS government_filing_file_unique
  ON government_filing_validations(organization_id, agency, form, file_sha256);

CREATE INDEX IF NOT EXISTS government_filing_status_idx
  ON government_filing_validations(agency, form, status);

-- HCM performance management
CREATE TABLE IF NOT EXISTS "performance_cycles" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(160) NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by" varchar(120) DEFAULT 'System' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "performance_cycles_org_status_idx" ON "performance_cycles" ("organization_id","status");
CREATE UNIQUE INDEX IF NOT EXISTS "performance_cycles_org_name_dates_unique" ON "performance_cycles" ("organization_id","name","start_date","end_date");

CREATE TABLE IF NOT EXISTS "performance_goals" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "cycle_id" integer REFERENCES "performance_cycles"("id") ON DELETE set null,
  "title" varchar(180) NOT NULL,
  "description" text,
  "weight" numeric(5,2) DEFAULT '0' NOT NULL,
  "progress" integer DEFAULT 0 NOT NULL,
  "status" varchar(24) DEFAULT 'active' NOT NULL,
  "due_date" date,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "performance_goals_org_employee_idx" ON "performance_goals" ("organization_id","employee_id");
CREATE INDEX IF NOT EXISTS "performance_goals_cycle_idx" ON "performance_goals" ("cycle_id");

CREATE TABLE IF NOT EXISTS "performance_reviews" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "cycle_id" integer NOT NULL REFERENCES "performance_cycles"("id") ON DELETE cascade,
  "reviewer_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "self_score" numeric(4,2),
  "manager_score" numeric(4,2),
  "final_score" numeric(4,2),
  "employee_reflection" text,
  "manager_summary" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "performance_reviews_cycle_employee_unique" ON "performance_reviews" ("cycle_id","employee_id");
CREATE INDEX IF NOT EXISTS "performance_reviews_org_employee_idx" ON "performance_reviews" ("organization_id","employee_id");

-- HCM job architecture and position planning
CREATE TABLE IF NOT EXISTS "job_profiles" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "title" varchar(160) NOT NULL,
  "family" varchar(120) DEFAULT 'General' NOT NULL,
  "level" varchar(80) DEFAULT 'Individual Contributor' NOT NULL,
  "grade" varchar(40),
  "description" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "job_profiles_org_title_level_unique" ON "job_profiles" ("organization_id","title","level");
CREATE INDEX IF NOT EXISTS "job_profiles_org_active_idx" ON "job_profiles" ("organization_id","active");

CREATE TABLE IF NOT EXISTS "workforce_plans" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(160) NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "budget" numeric(14,2) DEFAULT '0' NOT NULL,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by" varchar(120) DEFAULT 'System' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "workforce_plans_org_name_dates_unique" ON "workforce_plans" ("organization_id","name","start_date","end_date");
CREATE INDEX IF NOT EXISTS "workforce_plans_org_status_idx" ON "workforce_plans" ("organization_id","status");

CREATE TABLE IF NOT EXISTS "positions" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(48) NOT NULL,
  "job_profile_id" integer NOT NULL REFERENCES "job_profiles"("id") ON DELETE restrict,
  "org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  "plan_id" integer REFERENCES "workforce_plans"("id") ON DELETE set null,
  "manager_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "employment_type" varchar(32) DEFAULT 'Regular' NOT NULL,
  "status" varchar(24) DEFAULT 'planned' NOT NULL,
  "planned_start_date" date,
  "annual_budget" numeric(14,2) DEFAULT '0' NOT NULL,
  "notes" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "positions_org_code_unique" ON "positions" ("organization_id","code");
CREATE INDEX IF NOT EXISTS "positions_org_status_idx" ON "positions" ("organization_id","status");
CREATE INDEX IF NOT EXISTS "positions_org_unit_idx" ON "positions" ("organization_id","org_unit_id");
CREATE INDEX IF NOT EXISTS "positions_plan_idx" ON "positions" ("plan_id");

CREATE TABLE IF NOT EXISTS "position_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "position_id" integer NOT NULL REFERENCES "positions"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "effective_from" date NOT NULL,
  "effective_until" date,
  "reason" varchar(240) DEFAULT 'Position assignment' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "position_assignments_position_from_unique" ON "position_assignments" ("position_id","effective_from");
CREATE INDEX IF NOT EXISTS "position_assignments_employee_idx" ON "position_assignments" ("organization_id","employee_id");


-- Labor inspection readiness remediation ownership and close-out proof
CREATE TABLE IF NOT EXISTS labor_inspection_remediations (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  finding_key varchar(220) NOT NULL,
  rule_code varchar(80) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'open',
  owner varchar(120),
  acknowledged_by varchar(120),
  acknowledged_at timestamptz,
  resolution_note text,
  evidence_reference varchar(240),
  resolved_by varchar(120),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS labor_inspection_remediation_unique
  ON labor_inspection_remediations(organization_id, finding_key);

CREATE INDEX IF NOT EXISTS labor_inspection_remediation_status_idx
  ON labor_inspection_remediations(organization_id, status);

DO $compat$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'labor_inspection_remediations_status_check'
  ) THEN
    ALTER TABLE labor_inspection_remediations
      ADD CONSTRAINT labor_inspection_remediations_status_check
      CHECK (status IN ('open', 'acknowledged', 'resolved'));
  END IF;
END
$compat$;

-- Recruitment-to-approved-position lifecycle links
ALTER TABLE "job_applicants"
  ADD COLUMN IF NOT EXISTS "hired_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "hired_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "hired_at" timestamp with time zone;

CREATE UNIQUE INDEX IF NOT EXISTS "job_applicants_hired_employee_unique"
  ON "job_applicants" ("hired_employee_id")
  WHERE "hired_employee_id" IS NOT NULL;

ALTER TABLE "job_requisitions"
  ADD COLUMN IF NOT EXISTS "position_id" integer REFERENCES "positions"("id") ON DELETE set null;

CREATE INDEX IF NOT EXISTS "job_requisitions_position_idx"
  ON "job_requisitions" ("organization_id", "position_id");
CREATE UNIQUE INDEX IF NOT EXISTS "job_requisitions_active_position_unique"
  ON "job_requisitions" ("position_id")
  WHERE "position_id" IS NOT NULL
    AND "status" NOT IN ('filled', 'cancelled');

CREATE UNIQUE INDEX IF NOT EXISTS "position_assignments_active_position_unique"
  ON "position_assignments" ("position_id")
  WHERE "effective_until" IS NULL;

-- Enterprise identity, permissions, session policy, and automation
ALTER TABLE "user_organizations"
  ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS "local_password_enabled" boolean DEFAULT true NOT NULL;

ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "auth_method" varchar(24) DEFAULT 'local' NOT NULL,
  ADD COLUMN IF NOT EXISTS "identity_provider_id" integer;

CREATE TABLE IF NOT EXISTS "organization_security_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL UNIQUE REFERENCES "organizations"("id") ON DELETE cascade,
  "session_idle_minutes" integer DEFAULT 1440 NOT NULL,
  "session_max_hours" integer DEFAULT 336 NOT NULL,
  "max_active_sessions" integer DEFAULT 10 NOT NULL,
  "require_mfa" boolean DEFAULT false NOT NULL,
  "sso_mode" varchar(24) DEFAULT 'optional' NOT NULL,
  "updated_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "organization_security_policies_org_idx" ON "organization_security_policies" ("organization_id");

CREATE TABLE IF NOT EXISTS "identity_providers" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(120) NOT NULL,
  "protocol" varchar(24) DEFAULT 'oidc' NOT NULL,
  "issuer" text NOT NULL,
  "client_id" varchar(240) NOT NULL,
  "client_secret_encrypted" text NOT NULL,
  "authorization_endpoint" text NOT NULL,
  "token_endpoint" text NOT NULL,
  "jwks_uri" text NOT NULL,
  "scopes" varchar(240) DEFAULT 'openid email profile' NOT NULL,
  "email_claim" varchar(80) DEFAULT 'email' NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "discovery_verified_at" timestamp with time zone,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "identity_providers_org_name_unique" ON "identity_providers" ("organization_id","name");
CREATE INDEX IF NOT EXISTS "identity_providers_org_enabled_idx" ON "identity_providers" ("organization_id","enabled");

CREATE TABLE IF NOT EXISTS "identity_domains" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "provider_id" integer NOT NULL REFERENCES "identity_providers"("id") ON DELETE cascade,
  "domain" varchar(180) NOT NULL,
  "verification_token_hash" text NOT NULL,
  "verified" boolean DEFAULT false NOT NULL,
  "verified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "identity_domains_domain_unique" ON "identity_domains" ("domain");
CREATE INDEX IF NOT EXISTS "identity_domains_org_provider_idx" ON "identity_domains" ("organization_id","provider_id");

CREATE TABLE IF NOT EXISTS "external_identities" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "provider_id" integer NOT NULL REFERENCES "identity_providers"("id") ON DELETE cascade,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "subject" varchar(240) NOT NULL,
  "email" varchar(180) NOT NULL,
  "last_login_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "external_identities_provider_subject_unique" ON "external_identities" ("provider_id","subject");
CREATE UNIQUE INDEX IF NOT EXISTS "external_identities_provider_user_unique" ON "external_identities" ("provider_id","user_id");

CREATE TABLE IF NOT EXISTS "oidc_login_states" (
  "id" serial PRIMARY KEY NOT NULL,
  "provider_id" integer NOT NULL REFERENCES "identity_providers"("id") ON DELETE cascade,
  "state_hash" text NOT NULL UNIQUE,
  "nonce" varchar(180) NOT NULL,
  "code_verifier" text NOT NULL,
  "login_hint" varchar(180),
  "redirect_uri" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "oidc_login_states_provider_expiry_idx" ON "oidc_login_states" ("provider_id","expires_at");

CREATE TABLE IF NOT EXISTS "scim_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(120) NOT NULL,
  "prefix" varchar(20) NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "scim_tokens_org_idx" ON "scim_tokens" ("organization_id");

CREATE TABLE IF NOT EXISTS "scim_identities" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "external_id" varchar(240) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "scim_identities_org_external_unique" ON "scim_identities" ("organization_id","external_id");
CREATE UNIQUE INDEX IF NOT EXISTS "scim_identities_org_user_unique" ON "scim_identities" ("organization_id","user_id");

CREATE TABLE IF NOT EXISTS "permission_sets" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(120) NOT NULL,
  "description" text,
  "permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "permission_sets_org_name_unique" ON "permission_sets" ("organization_id","name");

CREATE TABLE IF NOT EXISTS "user_permission_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "user_organization_id" integer NOT NULL REFERENCES "user_organizations"("id") ON DELETE cascade,
  "permission_set_id" integer NOT NULL REFERENCES "permission_sets"("id") ON DELETE cascade,
  "assigned_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_permission_assignments_membership_unique" ON "user_permission_assignments" ("user_organization_id");
CREATE INDEX IF NOT EXISTS "user_permission_assignments_org_idx" ON "user_permission_assignments" ("organization_id");

CREATE TABLE IF NOT EXISTS "automation_rules" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(160) NOT NULL,
  "trigger" varchar(64) NOT NULL,
  "conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "automation_rules_org_name_unique" ON "automation_rules" ("organization_id","name");
CREATE INDEX IF NOT EXISTS "automation_rules_org_trigger_idx" ON "automation_rules" ("organization_id","trigger");

CREATE TABLE IF NOT EXISTS "automation_executions" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "rule_id" integer NOT NULL REFERENCES "automation_rules"("id") ON DELETE cascade,
  "employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "trigger" varchar(64) NOT NULL,
  "event_key" varchar(240) NOT NULL,
  "status" varchar(24) DEFAULT 'completed' NOT NULL,
  "result" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "automation_executions_rule_event_unique" ON "automation_executions" ("rule_id","event_key");
CREATE INDEX IF NOT EXISTS "automation_executions_org_created_idx" ON "automation_executions" ("organization_id","created_at");


-- Immutable employee statutory contribution case timeline
CREATE TABLE IF NOT EXISTS "statutory_contribution_issue_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "case_id" integer NOT NULL REFERENCES "statutory_contribution_issue_cases"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "event_type" varchar(32) NOT NULL,
  "visibility" varchar(24) DEFAULT 'employee' NOT NULL,
  "message" varchar(1000) NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "actor_name" varchar(120) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "statutory_contribution_issue_event_case_idx"
  ON "statutory_contribution_issue_events" ("organization_id", "case_id", "created_at");
CREATE INDEX IF NOT EXISTS "statutory_contribution_issue_event_employee_idx"
  ON "statutory_contribution_issue_events" ("organization_id", "employee_id", "created_at");

DO $compat$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'statutory_contribution_issue_event_type_check'
  ) THEN
    ALTER TABLE "statutory_contribution_issue_events"
      ADD CONSTRAINT "statutory_contribution_issue_event_type_check"
      CHECK ("event_type" IN ('reported', 'review_started', 'payroll_update', 'resolved'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'statutory_contribution_issue_event_visibility_check'
  ) THEN
    ALTER TABLE "statutory_contribution_issue_events"
      ADD CONSTRAINT "statutory_contribution_issue_event_visibility_check"
      CHECK ("visibility" IN ('employee', 'internal'));
  END IF;
END
$compat$;



-- Payroll month close certification
CREATE TABLE IF NOT EXISTS payroll_month_closures (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  applicable_month varchar(7) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'certified',
  snapshot_hash varchar(64) NOT NULL,
  evidence_snapshot jsonb NOT NULL,
  certified_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  certified_by_name varchar(120) NOT NULL,
  certified_at timestamptz NOT NULL DEFAULT NOW(),
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_month_closure_snapshot_unique
  ON payroll_month_closures(organization_id, applicable_month, snapshot_hash);
CREATE INDEX IF NOT EXISTS payroll_month_closure_status_idx
  ON payroll_month_closures(organization_id, applicable_month, status);

-- HCM compensation governance
CREATE TABLE IF NOT EXISTS "compensation_bands" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "job_profile_id" integer NOT NULL REFERENCES "job_profiles"("id") ON DELETE restrict,
  "location_code" varchar(80) DEFAULT 'PH' NOT NULL,
  "currency" varchar(8) DEFAULT 'PHP' NOT NULL,
  "minimum_annual" numeric(14,2) NOT NULL,
  "midpoint_annual" numeric(14,2) NOT NULL,
  "maximum_annual" numeric(14,2) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "compensation_bands_org_profile_location_unique" ON "compensation_bands" ("organization_id","job_profile_id","location_code");
CREATE INDEX IF NOT EXISTS "compensation_bands_org_active_idx" ON "compensation_bands" ("organization_id","active");

CREATE TABLE IF NOT EXISTS "compensation_cycles" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(160) NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "effective_date" date NOT NULL,
  "budget_pool" numeric(14,2) DEFAULT '0' NOT NULL,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by" varchar(120) DEFAULT 'System' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "compensation_cycles_org_name_dates_unique" ON "compensation_cycles" ("organization_id","name","start_date","end_date");
CREATE INDEX IF NOT EXISTS "compensation_cycles_org_status_idx" ON "compensation_cycles" ("organization_id","status");

CREATE TABLE IF NOT EXISTS "compensation_proposals" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "cycle_id" integer NOT NULL REFERENCES "compensation_cycles"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "band_id" integer NOT NULL REFERENCES "compensation_bands"("id") ON DELETE restrict,
  "current_annual" numeric(14,2) NOT NULL,
  "proposed_annual" numeric(14,2) NOT NULL,
  "reason" varchar(500) NOT NULL,
  "status" varchar(24) DEFAULT 'proposed' NOT NULL,
  "submitted_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "approved_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "approved_at" timestamptz,
  "applied_pay_revision_id" integer REFERENCES "employee_pay_revisions"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "compensation_proposals_cycle_employee_unique" ON "compensation_proposals" ("cycle_id","employee_id");
CREATE INDEX IF NOT EXISTS "compensation_proposals_org_status_idx" ON "compensation_proposals" ("organization_id","status");

-- DOLE 13th-month reporting profile and portal submission evidence
CREATE TABLE IF NOT EXISTS dole_reporting_profiles (
  organization_id integer PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  establishment_address text NOT NULL DEFAULT '',
  principal_business varchar(240) NOT NULL DEFAULT '',
  contact_name varchar(160) NOT NULL DEFAULT '',
  contact_position varchar(160) NOT NULL DEFAULT '',
  contact_phone varchar(48) NOT NULL DEFAULT '',
  updated_by varchar(120),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dole_compliance_submissions (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_type varchar(48) NOT NULL,
  report_year integer NOT NULL,
  report_hash varchar(64) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'submitted',
  portal_reference varchar(160) NOT NULL,
  submitted_at timestamptz NOT NULL,
  recorded_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  recorded_by_name varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS dole_compliance_submission_snapshot_unique
  ON dole_compliance_submissions(organization_id, report_type, report_year, report_hash);
CREATE INDEX IF NOT EXISTS dole_compliance_submission_year_idx
  ON dole_compliance_submissions(organization_id, report_year, report_type);

-- Labor inspection drill history
CREATE TABLE IF NOT EXISTS labor_inspection_drills (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status varchar(24) NOT NULL,
  range_label varchar(120) NOT NULL,
  evidence_pack_sha256 varchar(64) NOT NULL,
  evidence_pack_version varchar(64) NOT NULL,
  snapshot_sha256 varchar(64) NOT NULL,
  high_findings integer NOT NULL DEFAULT 0,
  medium_findings integer NOT NULL DEFAULT 0,
  info_findings integer NOT NULL DEFAULT 0,
  recorded_exposure numeric(14,2) NOT NULL DEFAULT '0',
  screening_exposure numeric(14,2) NOT NULL DEFAULT '0',
  unowned_actionable integer NOT NULL DEFAULT 0,
  ready_to_close integer NOT NULL DEFAULT 0,
  blocker_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  action_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  section_row_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_by varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS labor_inspection_drills_org_created_idx ON labor_inspection_drills(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS labor_inspection_drills_status_idx ON labor_inspection_drills(organization_id, status);

-- Audited attendance corrections
CREATE TABLE IF NOT EXISTS "attendance_correction_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "punch_id" integer NOT NULL REFERENCES "time_punches"("id") ON DELETE cascade,
  "work_date" date NOT NULL,
  "original_punch_snapshot" jsonb NOT NULL,
  "proposed_punch_snapshot" jsonb NOT NULL,
  "reason" varchar(240) NOT NULL,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "requested_by" varchar(120) NOT NULL,
  "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "decided_by" varchar(120),
  "decided_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "decided_at" timestamptz,
  "decision_note" varchar(240),
  "applied_at" timestamptz,
  "invalidated_payroll_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "attendance_corrections_org_status_idx"
  ON "attendance_correction_requests" ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "attendance_corrections_employee_date_idx"
  ON "attendance_correction_requests" ("employee_id", "work_date");
CREATE INDEX IF NOT EXISTS "attendance_corrections_punch_idx"
  ON "attendance_correction_requests" ("punch_id");

-- Stable remittance actor identities for separation of duties
ALTER TABLE "statutory_remittance_batches"
  ADD COLUMN IF NOT EXISTS "payment_recorded_by_user_id" integer REFERENCES "users"("id") ON DELETE set null;

ALTER TABLE "statutory_remittance_batches"
  ADD COLUMN IF NOT EXISTS "reconciled_by_user_id" integer REFERENCES "users"("id") ON DELETE set null;

ALTER TABLE "statutory_remittance_members"
  ADD COLUMN IF NOT EXISTS "confirmed_by_user_id" integer REFERENCES "users"("id") ON DELETE set null;

CREATE INDEX IF NOT EXISTS "statutory_remittance_batches_payment_recorder_idx"
  ON "statutory_remittance_batches" ("organization_id", "payment_recorded_by_user_id");
CREATE INDEX IF NOT EXISTS "statutory_remittance_batches_reconciler_idx"
  ON "statutory_remittance_batches" ("organization_id", "reconciled_by_user_id");
CREATE INDEX IF NOT EXISTS "statutory_remittance_members_confirmer_idx"
  ON "statutory_remittance_members" ("organization_id", "confirmed_by_user_id");

-- Managed payroll operations and client release approval
CREATE TABLE IF NOT EXISTS "managed_payroll_engagements" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "status" varchar(24) NOT NULL DEFAULT 'pilot',
  "service_tier" varchar(48) NOT NULL DEFAULT 'Managed payroll',
  "client_approver_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "sla_hours" integer NOT NULL DEFAULT 24,
  "target_go_live" date,
  "created_by" varchar(120) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "managed_payroll_engagement_org_unique"
  ON "managed_payroll_engagements" ("organization_id");

CREATE TABLE IF NOT EXISTS "managed_payroll_gates" (
  "id" serial PRIMARY KEY NOT NULL,
  "engagement_id" integer NOT NULL REFERENCES "managed_payroll_engagements"("id") ON DELETE CASCADE,
  "gate_key" varchar(64) NOT NULL,
  "label" varchar(180) NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'pending',
  "evidence_ref" text,
  "completed_by" varchar(120),
  "completed_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "managed_payroll_gate_unique"
  ON "managed_payroll_gates" ("engagement_id", "gate_key");

CREATE TABLE IF NOT EXISTS "managed_payroll_run_approvals" (
  "id" serial PRIMARY KEY NOT NULL,
  "engagement_id" integer NOT NULL REFERENCES "managed_payroll_engagements"("id") ON DELETE CASCADE,
  "payroll_run_id" integer NOT NULL REFERENCES "payroll_runs"("id") ON DELETE CASCADE,
  "approver_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "approved_by_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "approved_by" varchar(120) NOT NULL,
  "payroll_fingerprint" varchar(64) NOT NULL,
  "approved_gross" numeric(14,2) NOT NULL,
  "approved_net" numeric(14,2) NOT NULL,
  "approved_employee_count" integer NOT NULL,
  "note" text,
  "approved_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "managed_payroll_run_approval_unique"
  ON "managed_payroll_run_approvals" ("payroll_run_id");



-- Enterprise multi-legal-entity employer structure
-- Enterprise multi-legal-entity employer structure
CREATE TABLE IF NOT EXISTS "legal_entities" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(40) NOT NULL,
  "legal_name" varchar(200) NOT NULL,
  "display_name" varchar(160) NOT NULL,
  "bir_tin" varchar(16),
  "bir_branch_code" varchar(4),
  "sss_employer_no" varchar(24),
  "philhealth_employer_no" varchar(24),
  "pagibig_employer_no" varchar(24),
  "statutory_deduction_timing" varchar(24) DEFAULT 'split' NOT NULL,
  "payroll_calendar_mode" varchar(24) DEFAULT 'flexible' NOT NULL,
  "disbursement_bank_code" varchar(16),
  "disbursement_account_name" varchar(160),
  "disbursement_account" varchar(160),
  "primary_entity" boolean DEFAULT false NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "legal_entities_statutory_timing_check"
    CHECK ("statutory_deduction_timing" IN ('split', 'first_cutoff', 'second_cutoff')),
  CONSTRAINT "legal_entities_calendar_mode_check"
    CHECK ("payroll_calendar_mode" IN ('flexible', 'ph_semi_monthly'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "legal_entities_org_code_unique"
  ON "legal_entities" ("organization_id", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "legal_entities_org_primary_unique"
  ON "legal_entities" ("organization_id")
  WHERE "primary_entity" = true;
CREATE INDEX IF NOT EXISTS "legal_entities_org_active_idx"
  ON "legal_entities" ("organization_id", "active");

INSERT INTO "legal_entities" (
  "organization_id",
  "code",
  "legal_name",
  "display_name",
  "bir_tin",
  "bir_branch_code",
  "sss_employer_no",
  "philhealth_employer_no",
  "pagibig_employer_no",
  "statutory_deduction_timing",
  "payroll_calendar_mode",
  "primary_entity",
  "active"
)
SELECT
  o."id",
  'PRIMARY',
  o."legal_name",
  o."name",
  o."bir_tin",
  o."bir_branch_code",
  o."sss_employer_no",
  o."philhealth_employer_no",
  o."pagibig_employer_no",
  o."statutory_deduction_timing",
  o."payroll_calendar_mode",
  true,
  true
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "legal_entities" le WHERE le."organization_id" = o."id"
);

ALTER TABLE "employees"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict;

ALTER TABLE "payroll_runs"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict;

UPDATE "employees" e
SET "legal_entity_id" = (
  SELECT le."id"
  FROM "legal_entities" le
  WHERE le."organization_id" = e."organization_id"
  ORDER BY le."primary_entity" DESC, le."id"
  LIMIT 1
)
WHERE e."legal_entity_id" IS NULL;

UPDATE "payroll_runs" pr
SET "legal_entity_id" = (
  SELECT le."id"
  FROM "legal_entities" le
  WHERE le."organization_id" = pr."organization_id"
  ORDER BY le."primary_entity" DESC, le."id"
  LIMIT 1
)
WHERE pr."legal_entity_id" IS NULL;

CREATE INDEX IF NOT EXISTS "employees_legal_entity_idx"
  ON "employees" ("organization_id", "legal_entity_id");
CREATE INDEX IF NOT EXISTS "payroll_runs_legal_entity_idx"
  ON "payroll_runs" ("organization_id", "legal_entity_id");

