import {
  boolean,
  date,
  integer,
  index,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  legalName: varchar("legal_name", { length: 200 }).notNull(),
  accountType: varchar("account_type", { length: 32 }).notNull().default("business"),
  plan: varchar("plan", { length: 32 }).notNull().default("Core"),
  employeeCount: integer("employee_count").notNull().default(0),
  color: varchar("color", { length: 12 }).notNull().default("#176B5D"),
  birTin: varchar("bir_tin", { length: 16 }),
  birBranchCode: varchar("bir_branch_code", { length: 4 }),
  sssEmployerNo: varchar("sss_employer_no", { length: 24 }),
  philHealthEmployerNo: varchar("philhealth_employer_no", { length: 24 }),
  pagIbigEmployerNo: varchar("pagibig_employer_no", { length: 24 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 180 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  role: varchar("role", { length: 32 }).notNull().default("owner"),
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  backupCodes: jsonb("backup_codes").notNull().default([]),
  // Set when the account is an employee self-service login (role = "employee").
  // Scoped to exactly one employee record; never grants access to other staff.
  employeeId: integer("employee_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userOrganizations = pgTable(
  "user_organizations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 32 }).notNull().default("admin"),
    orgUnitId: integer("org_unit_id"),
  },
  (table) => [uniqueIndex("user_org_unique").on(table.userId, table.organizationId)],
);

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  // Recorded so users can see and revoke the devices they are signed in on.
  userAgent: text("user_agent"),
  ip: varchar("ip", { length: 64 }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orgUnits = pgTable("org_units", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  parentId: integer("parent_id"),
  type: varchar("type", { length: 32 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  code: varchar("code", { length: 32 }).notNull(),
});

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  orgUnitId: integer("org_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
  employeeNo: varchar("employee_no", { length: 32 }).notNull(),
  firstName: varchar("first_name", { length: 80 }).notNull(),
  middleName: varchar("middle_name", { length: 80 }),
  lastName: varchar("last_name", { length: 80 }).notNull(),
  title: varchar("title", { length: 120 }).notNull(),
  employmentType: varchar("employment_type", { length: 32 }).notNull().default("Regular"),
  status: varchar("status", { length: 32 }).notNull().default("Active"),
  avatarInitials: varchar("avatar_initials", { length: 4 }).notNull(),
  basicRate: numeric("basic_rate", { precision: 12, scale: 2 }).notNull(),
  mwe: boolean("mwe").notNull().default(false),
  bankAccount: varchar("bank_account", { length: 40 }),
  bankCode: varchar("bank_code", { length: 16 }),
  mobile: varchar("mobile", { length: 24 }),
  email: varchar("email", { length: 200 }),
  region: varchar("region", { length: 32 }).notNull().default("NCR"),
  tin: varchar("tin", { length: 32 }),
  tinBranchCode: varchar("tin_branch_code", { length: 4 }),
  sssNo: varchar("sss_no", { length: 32 }),
  philHealthNo: varchar("philhealth_no", { length: 32 }),
  pagIbigNo: varchar("pagibig_no", { length: 32 }),
  nationality: varchar("nationality", { length: 60 }).notNull().default("Filipino"),
  birthDate: date("birth_date"),
  emergencyContact: varchar("emergency_contact", { length: 120 }),
  emergencyPhone: varchar("emergency_phone", { length: 32 }),
  dependentsCount: integer("dependents_count").default(0),
  education: varchar("education", { length: 120 }),
  startDate: date("start_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const employeePayProfiles = pgTable(
  "employee_pay_profiles",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull().unique().references(() => employees.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    payBasis: varchar("pay_basis", { length: 16 }).notNull(),
    rateAmount: numeric("rate_amount", { precision: 12, scale: 2 }).notNull(),
    standardWorkDaysPerMonth: numeric("standard_work_days_per_month", { precision: 6, scale: 2 }).notNull(),
    standardHoursPerDay: numeric("standard_hours_per_day", { precision: 5, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("employee_pay_profiles_org_idx").on(table.organizationId)],
);

export const employeePayRevisions = pgTable(
  "employee_pay_revisions",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    effectiveDate: date("effective_date").notNull(),
    previousPayBasis: varchar("previous_pay_basis", { length: 16 }).notNull(),
    previousRateAmount: numeric("previous_rate_amount", { precision: 12, scale: 2 }).notNull(),
    previousStandardWorkDaysPerMonth: numeric("previous_standard_work_days_per_month", { precision: 6, scale: 2 }).notNull(),
    previousStandardHoursPerDay: numeric("previous_standard_hours_per_day", { precision: 5, scale: 2 }).notNull(),
    newPayBasis: varchar("new_pay_basis", { length: 16 }).notNull(),
    newRateAmount: numeric("new_rate_amount", { precision: 12, scale: 2 }).notNull(),
    newStandardWorkDaysPerMonth: numeric("new_standard_work_days_per_month", { precision: 6, scale: 2 }).notNull(),
    newStandardHoursPerDay: numeric("new_standard_hours_per_day", { precision: 5, scale: 2 }).notNull(),
    reason: varchar("reason", { length: 240 }).notNull().default("Pay change"),
    createdBy: varchar("created_by", { length: 120 }).notNull().default("System"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("employee_pay_revisions_org_employee_idx").on(table.organizationId, table.employeeId),
    uniqueIndex("employee_pay_revisions_employee_effective_idx").on(table.employeeId, table.effectiveDate),
  ],
);

export const timePunches = pgTable("time_punches", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  workDate: date("work_date").notNull(),
  timeIn: timestamp("time_in", { withTimezone: true }),
  timeOut: timestamp("time_out", { withTimezone: true }),
  shiftStart: varchar("shift_start", { length: 8 }).notNull().default("09:00"),
  shiftEnd: varchar("shift_end", { length: 8 }).notNull().default("18:00"),
  status: varchar("status", { length: 32 }).notNull().default("Complete"),
  source: varchar("source", { length: 32 }).default("web_bundy"),
  deviceSerial: varchar("device_serial", { length: 80 }),
  ipAddress: varchar("ip_address", { length: 45 }),
  location: text("location"),
  notes: text("notes"),
});

export const payrollRuns = pgTable("payroll_runs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  periodLabel: varchar("period_label", { length: 80 }).notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  scopeLabel: varchar("scope_label", { length: 120 }).notNull().default("All locations"),
  scopeOrgUnitId: integer("scope_org_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
  status: varchar("status", { length: 32 }).notNull().default("Draft"),
  payDate: date("pay_date").notNull(),
  employeeCount: integer("employee_count").notNull().default(0),
  grossPay: numeric("gross_pay", { precision: 14, scale: 2 }).notNull().default("0"),
  netPay: numeric("net_pay", { precision: 14, scale: 2 }).notNull().default("0"),
  exceptions: integer("exceptions").notNull().default(0),
  ruleVersion: varchar("rule_version", { length: 48 }).notNull().default("PH-2026.01"),
  processedChunks: integer("processed_chunks").notNull().default(0),
  totalChunks: integer("total_chunks").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const employeePayRetroAdjustments = pgTable(
  "employee_pay_retro_adjustments",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    revisionId: integer("revision_id").notNull().references(() => employeePayRevisions.id, { onDelete: "cascade" }),
    sourcePayrollRunId: integer("source_payroll_run_id").notNull().references(() => payrollRuns.id, { onDelete: "cascade" }),
    sourcePeriodLabel: varchar("source_period_label", { length: 80 }).notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    settledPayrollRunId: integer("settled_payroll_run_id").references(() => payrollRuns.id, { onDelete: "set null" }),
    settledSeparationId: integer("settled_separation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    index("employee_pay_retro_org_employee_idx").on(table.organizationId, table.employeeId),
    uniqueIndex("employee_pay_retro_revision_run_idx").on(table.revisionId, table.sourcePayrollRunId),
  ],
);

export const payrollEntries = pgTable("payroll_entries", {
  id: serial("id").primaryKey(),
  payrollRunId: integer("payroll_run_id").notNull().references(() => payrollRuns.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  grossPay: numeric("gross_pay", { precision: 12, scale: 2 }).notNull(),
  deductions: numeric("deductions", { precision: 12, scale: 2 }).notNull(),
  netPay: numeric("net_pay", { precision: 12, scale: 2 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("Ready"),
  lineItems: jsonb("line_items").notNull().default([]),
  trace: jsonb("trace").notNull().default({}),
});

export const payrollJobs = pgTable("payroll_jobs", {
  id: serial("id").primaryKey(),
  payrollRunId: integer("payroll_run_id").notNull().references(() => payrollRuns.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 32 }).notNull().default("queued"),
  chunkIndex: integer("chunk_index").notNull().default(0),
  chunkSize: integer("chunk_size").notNull().default(25),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: varchar("locked_by", { length: 80 }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payslips = pgTable("payslips", {
  id: serial("id").primaryKey(),
  payrollEntryId: integer("payroll_entry_id").notNull().references(() => payrollEntries.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  periodLabel: varchar("period_label", { length: 80 }).notNull(),
  content: text("content").notNull(),
  ruleVersion: varchar("rule_version", { length: 48 }).notNull().default("PH-2026.01"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pricingPlans = pgTable("pricing_plans", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 64 }).notNull(),
  monthlyBase: numeric("monthly_base", { precision: 10, scale: 2 }).notNull(),
  perEmployee: numeric("per_employee", { precision: 10, scale: 2 }).notNull(),
  modules: jsonb("modules").notNull().default([]),
  version: varchar("version", { length: 32 }).notNull(),
  active: boolean("active").notNull().default(true),
});

export const freelancerProfiles = pgTable("freelancer_profiles", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().unique().references(() => organizations.id, { onDelete: "cascade" }),
  monthlyIncome: numeric("monthly_income", { precision: 12, scale: 2 }).notNull().default("0"),
  annualExpenses: numeric("annual_expenses", { precision: 12, scale: 2 }).notNull().default("0"),
  filingMethod: varchar("filing_method", { length: 32 }).notNull().default("8% flat"),
  nextDueDate: date("next_due_date").notNull(),
});

export const calamityAdvisories = pgTable("calamity_advisories", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  advisoryNumber: varchar("advisory_number", { length: 80 }).notNull(),
  policy: varchar("policy", { length: 120 }).notNull(),
  premiumPercent: integer("premium_percent").notNull().default(30),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  affectedUnit: varchar("affected_unit", { length: 120 }).notNull(),
  active: boolean("active").notNull().default(true),
});

export const bankTemplates = pgTable("bank_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  version: varchar("version", { length: 32 }).notNull(),
  format: varchar("format", { length: 32 }).notNull(),
  mappings: jsonb("mappings").notNull().default({}),
  active: boolean("active").notNull().default(true),
});

export const approvalTasks = pgTable("approval_tasks", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 180 }).notNull(),
  detail: varchar("detail", { length: 240 }).notNull(),
  approver: varchar("approver", { length: 120 }).notNull(),
  dueLabel: varchar("due_label", { length: 80 }).notNull(),
  priority: varchar("priority", { length: 32 }).notNull().default("Normal"),
  status: varchar("status", { length: 32 }).notNull().default("Pending"),
  decidedBy: varchar("decided_by", { length: 120 }),
  decidedOnBehalfOf: varchar("decided_on_behalf_of", { length: 120 }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const approvalDelegations = pgTable("approval_delegations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  fromApprover: varchar("from_approver", { length: 120 }).notNull(),
  toApprover: varchar("to_approver", { length: 120 }).notNull(),
  reason: varchar("reason", { length: 200 }).notNull().default("Out of office"),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  prefix: varchar("prefix", { length: 16 }).notNull(),
  keyHash: text("key_hash").notNull().unique(),
  scopes: jsonb("scopes").notNull().default([]),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: jsonb("events").notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: serial("id").primaryKey(),
  endpointId: integer("endpoint_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  event: varchar("event", { length: 80 }).notNull(),
  payload: jsonb("payload").notNull().default({}),
  signature: text("signature").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  responseCode: integer("response_code"),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const yearEndAdjustments = pgTable("year_end_adjustments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  taxYear: integer("tax_year").notNull(),
  grossCompensation: numeric("gross_compensation", { precision: 14, scale: 2 }).notNull(),
  thirteenthMonth: numeric("thirteenth_month", { precision: 14, scale: 2 }).notNull().default("0"),
  nonTaxable: numeric("non_taxable", { precision: 14, scale: 2 }).notNull().default("0"),
  statutoryContributions: numeric("statutory_contributions", { precision: 14, scale: 2 }).notNull().default("0"),
  taxableIncome: numeric("taxable_income", { precision: 14, scale: 2 }).notNull().default("0"),
  taxDue: numeric("tax_due", { precision: 14, scale: 2 }).notNull().default("0"),
  taxWithheld: numeric("tax_withheld", { precision: 14, scale: 2 }).notNull().default("0"),
  adjustment: numeric("adjustment", { precision: 14, scale: 2 }).notNull().default("0"),
  outcome: varchar("outcome", { length: 24 }).notNull().default("balanced"),
  mwe: boolean("mwe").notNull().default(false),
  breakdown: jsonb("breakdown").notNull().default({}),
  ruleVersion: varchar("rule_version", { length: 48 }).notNull().default("PH-2026.01"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rateLimitHits = pgTable("rate_limit_hits", {
  id: serial("id").primaryKey(),
  bucketKey: varchar("bucket_key", { length: 200 }).notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  hits: integer("hits").notNull().default(0),
}, (table) => [
  uniqueIndex("rate_limit_window_idx").on(table.bucketKey, table.windowStart),
]);

export const idempotencyKeys = pgTable("idempotency_keys", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  keyValue: varchar("key_value", { length: 200 }).notNull().unique(),
  endpoint: varchar("endpoint", { length: 120 }).notNull(),
  responseStatus: integer("response_status").notNull(),
  responseBody: jsonb("response_body").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leaveRequests = pgTable("leave_requests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  leaveType: varchar("leave_type", { length: 40 }).notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  days: numeric("days", { precision: 6, scale: 1 }).notNull(),
  reason: varchar("reason", { length: 240 }).notNull().default(""),
  status: varchar("status", { length: 32 }).notNull().default("Pending"),
  approvalTaskId: integer("approval_task_id"),
  decidedBy: varchar("decided_by", { length: 120 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const provisioningTasks = pgTable("provisioning_tasks", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 24 }).notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  owner: varchar("owner", { length: 80 }).notNull().default("People Ops"),
  done: boolean("done").notNull().default(false),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedBy: varchar("completed_by", { length: 120 }),
});

export const leavePolicies = pgTable("leave_policies", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leaveType: varchar("leave_type", { length: 40 }).notNull(),
  annualDays: numeric("annual_days", { precision: 6, scale: 1 }).notNull(),
  carryOverMax: numeric("carry_over_max", { precision: 6, scale: 1 }),
  maxBalance: numeric("max_balance", { precision: 6, scale: 1 }),
  payTreatment: varchar("pay_treatment", { length: 24 }).notNull().default("unconfigured"),
  paidPercentage: numeric("paid_percentage", { precision: 5, scale: 2 }).notNull().default("100"),
  active: boolean("active").notNull().default(true),
});

export const leaveBalances = pgTable("leave_balances", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  leaveType: varchar("leave_type", { length: 40 }).notNull(),
  year: integer("year").notNull(),
  opening: numeric("opening", { precision: 6, scale: 1 }).notNull().default("0"),
  accrued: numeric("accrued", { precision: 6, scale: 1 }).notNull().default("0"),
  used: numeric("used", { precision: 6, scale: 1 }).notNull().default("0"),
  pending: numeric("pending", { precision: 6, scale: 1 }).notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("leave_balance_unique").on(table.employeeId, table.leaveType, table.year),
]);

export const expenseClaims = pgTable("expense_claims", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  category: varchar("category", { length: 60 }).notNull(),
  description: varchar("description", { length: 240 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  incurredOn: date("incurred_on").notNull(),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  decidedBy: varchar("decided_by", { length: 120 }),
  payrollRunId: integer("payroll_run_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const earnedWageRequests = pgTable("earned_wage_requests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  requestedAmount: numeric("requested_amount", { precision: 12, scale: 2 }).notNull(),
  fee: numeric("fee", { precision: 10, scale: 2 }).notNull().default("0"),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  decidedBy: varchar("decided_by", { length: 120 }),
  payrollRunId: integer("payroll_run_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** RR 29-2025 de minimis benefits granted to an employee. */
export const deMinimisGrants = pgTable("de_minimis_grants", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  benefitType: varchar("benefit_type", { length: 64 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  frequency: varchar("frequency", { length: 16 }).notNull(),
  active: boolean("active").notNull().default(true),
  effectiveOn: date("effective_on").notNull(),
  endedOn: date("ended_on"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const minWageOrders = pgTable("min_wage_orders", {
  id: serial("id").primaryKey(),
  region: varchar("region", { length: 32 }).notNull(),
  dailyRate: numeric("daily_rate", { precision: 10, scale: 2 }).notNull(),
  wageOrder: varchar("wage_order", { length: 40 }).notNull(),
  effectiveOn: date("effective_on").notNull(),
  active: boolean("active").notNull().default(true),
});

export const contractors = pgTable("contractors", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 200 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  country: varchar("country", { length: 3 }).notNull().default("PH"),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  rate: numeric("rate", { precision: 12, scale: 2 }).notNull(),
  rateType: varchar("rate_type", { length: 20 }).notNull().default("monthly"),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  contractStart: date("contract_start"),
  contractEnd: date("contract_end"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assets = pgTable("assets", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").references(() => employees.id, { onDelete: "set null" }),
  type: varchar("type", { length: 50 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  serialNumber: varchar("serial_number", { length: 100 }),
  status: varchar("status", { length: 32 }).notNull().default("assigned"),
  assignedOn: date("assigned_on"),
  returnedOn: date("returned_on"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const holidays = pgTable("holidays", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  holidayDate: date("holiday_date").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  kind: varchar("kind", { length: 24 }).notNull().default("regular"),
});

export const healthSnapshots = pgTable("health_snapshots", {
  id: serial("id").primaryKey(),
  ok: boolean("ok").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  detail: varchar("detail", { length: 160 }).notNull().default("ok"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schedulerState = pgTable("scheduler_state", {
  id: serial("id").primaryKey(),
  jobName: varchar("job_name", { length: 80 }).notNull().unique(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastResult: jsonb("last_result").notNull().default({}),
});

export const outbox = pgTable("outbox", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  channel: varchar("channel", { length: 12 }).notNull().default("email"),
  recipient: varchar("recipient", { length: 200 }).notNull(),
  subject: varchar("subject", { length: 200 }).notNull(),
  body: text("body").notNull(),
  purpose: varchar("purpose", { length: 60 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("queued"),
  provider: varchar("provider", { length: 40 }).notNull().default("none"),
  error: text("error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").references(() => employees.id, { onDelete: "set null" }),
  kind: varchar("kind", { length: 40 }).notNull(),
  fileName: varchar("file_name", { length: 200 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  byteSize: integer("byte_size").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  scannedClean: boolean("scanned_clean").notNull().default(false),
  scanNote: varchar("scan_note", { length: 200 }).notNull().default(""),
  uploadedBy: varchar("uploaded_by", { length: 120 }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invitations = pgTable("invitations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 200 }).notNull(),
  role: varchar("role", { length: 32 }).notNull().default("admin"),
  orgUnitId: integer("org_unit_id"),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  invitedBy: varchar("invited_by", { length: 120 }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().unique().references(() => organizations.id, { onDelete: "cascade" }),
  plan: varchar("plan", { length: 32 }).notNull().default("Core"),
  status: varchar("status", { length: 32 }).notNull().default("trialing"),
  seatLimit: integer("seat_limit").notNull().default(10),
  billingCycle: varchar("billing_cycle", { length: 16 }).notNull().default("monthly"),
  amountCents: integer("amount_cents").notNull().default(0),
  currency: varchar("currency", { length: 8 }).notNull().default("PHP"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_ends_at", { withTimezone: true }),
  provider: varchar("provider", { length: 32 }),
  providerRef: varchar("provider_ref", { length: 120 }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  subscriptionId: integer("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
  number: varchar("number", { length: 32 }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: varchar("currency", { length: 8 }).notNull().default("PHP"),
  status: varchar("status", { length: 24 }).notNull().default("open"),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dataRequests = pgTable("data_requests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  subjectEmail: varchar("subject_email", { length: 200 }).notNull(),
  requestType: varchar("request_type", { length: 24 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("received"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  handledBy: varchar("handled_by", { length: 120 }),
  notes: varchar("notes", { length: 400 }),
});

export const importBatches = pgTable("import_batches", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  fileName: varchar("file_name", { length: 200 }).notNull(),
  sourceSystem: varchar("source_system", { length: 64 }).notNull().default("generic"),
  importKind: varchar("import_kind", { length: 40 }).notNull().default("employees"),
  totalRows: integer("total_rows").notNull().default(0),
  createdCount: integer("created_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  status: varchar("status", { length: 24 }).notNull().default("completed"),
  errors: jsonb("errors").notNull().default([]),
  createdBy: varchar("created_by", { length: 120 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const historicalPayrollEntries = pgTable("historical_payroll_entries", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  importBatchId: integer("import_batch_id").references(() => importBatches.id, { onDelete: "set null" }),
  sourceSystem: varchar("source_system", { length: 64 }).notNull().default("generic"),
  sourceReference: varchar("source_reference", { length: 180 }).notNull(),
  periodLabel: varchar("period_label", { length: 120 }).notNull(),
  payDate: date("pay_date").notNull(),
  grossPay: numeric("gross_pay", { precision: 14, scale: 2 }).notNull(),
  basicSalaryEarned: numeric("basic_salary_earned", { precision: 14, scale: 2 }).notNull().default("0"),
  otherNonTaxable: numeric("other_non_taxable", { precision: 14, scale: 2 }).notNull().default("0"),
  netPay: numeric("net_pay", { precision: 14, scale: 2 }).notNull(),
  taxWithheld: numeric("tax_withheld", { precision: 14, scale: 2 }).notNull().default("0"),
  sssEmployee: numeric("sss_employee", { precision: 14, scale: 2 }).notNull().default("0"),
  philHealthEmployee: numeric("philhealth_employee", { precision: 14, scale: 2 }).notNull().default("0"),
  pagIbigEmployee: numeric("pagibig_employee", { precision: 14, scale: 2 }).notNull().default("0"),
  thirteenthMonth: numeric("thirteenth_month", { precision: 14, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("historical_payroll_source_unique").on(
    table.organizationId,
    table.employeeId,
    table.sourceSystem,
    table.sourceReference,
  ),
]);

export const benefitPlans = pgTable("benefit_plans", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  category: varchar("category", { length: 32 }).notNull(),
  // Monthly employee share in PHP. 0 means fully employer-paid.
  employeeShare: numeric("employee_share", { precision: 10, scale: 2 }).notNull().default("0"),
  employerShare: numeric("employer_share", { precision: 10, scale: 2 }).notNull().default("0"),
  // Voluntary programmes capped by law (e.g. Pag-IBIG MP2 accrual ceiling).
  cap: numeric("cap", { precision: 12, scale: 2 }),
  provider: varchar("provider", { length: 80 }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const benefitEnrollments = pgTable("benefit_enrollments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  planId: integer("plan_id").notNull().references(() => benefitPlans.id, { onDelete: "cascade" }),
  // Voluntary savers can over- or under-pay the default within the plan cap.
  monthlyContribution: numeric("monthly_contribution", { precision: 10, scale: 2 }).notNull().default("0"),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  startedOn: date("started_on").notNull(),
  endedOn: date("ended_on"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("benefit_enrollment_unique").on(table.employeeId, table.planId, table.startedOn),
]);

export const auditEvents = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  // Nullable: auth events (password reset, login) happen outside any
  // organization context and must still be auditable.
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  actor: varchar("actor", { length: 120 }).notNull(),
  action: varchar("action", { length: 160 }).notNull(),
  resource: varchar("resource", { length: 160 }).notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const employeeLoans = pgTable("employee_loans", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  loanType: varchar("loan_type", { length: 64 }).notNull(), // "SSS Salary Loan", "Pag-IBIG Multi-Purpose Loan", "Company Emergency Loan", etc.
  referenceNo: varchar("reference_no", { length: 64 }).notNull(),
  principal: numeric("principal", { precision: 12, scale: 2 }).notNull(),
  monthlyAmortization: numeric("monthly_amortization", { precision: 10, scale: 2 }).notNull(),
  cutoffDeduction: numeric("cutoff_deduction", { precision: 10, scale: 2 }).notNull(),
  remainingBalance: numeric("remaining_balance", { precision: 12, scale: 2 }).notNull(),
  totalPaid: numeric("total_paid", { precision: 12, scale: 2 }).notNull().default("0"),
  status: varchar("status", { length: 32 }).notNull().default("active"), // "active", "paid_off", "paused"
  startDate: date("startDate"),
  endDate: date("endDate"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const loanPayments = pgTable("loan_payments", {
  id: serial("id").primaryKey(),
  loanId: integer("loan_id").notNull().references(() => employeeLoans.id, { onDelete: "cascade" }),
  payrollRunId: integer("payroll_run_id"),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  paymentDate: date("payment_date").notNull(),
  reference: varchar("reference", { length: 120 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const disciplinaryCases = pgTable("disciplinary_cases", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  caseNumber: varchar("case_number", { length: 64 }).notNull(),
  offense: varchar("offense", { length: 160 }).notNull(),
  incidentDate: date("incident_date").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("nte_issued"), // "nte_issued", "explanation_submitted", "hearing_scheduled", "nod_issued", "closed"
  nteIssuedAt: timestamp("nte_issued_at", { withTimezone: true }),
  nteDetails: text("nte_details"),
  employeeExplanation: text("employee_explanation"),
  explanationSubmittedAt: timestamp("explanation_submitted_at", { withTimezone: true }),
  hearingDate: timestamp("hearing_date", { withTimezone: true }),
  nodIssuedAt: timestamp("nod_issued_at", { withTimezone: true }),
  nodDecision: text("nod_decision"),
  penalty: varchar("penalty", { length: 64 }), // "Written Warning", "Suspension", "Termination", "Exonerated"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobRequisitions = pgTable("job_requisitions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 160 }).notNull(),
  department: varchar("department", { length: 120 }).notNull(),
  headcount: integer("headcount").notNull().default(1),
  salaryMin: numeric("salary_min", { precision: 12, scale: 2 }),
  salaryMax: numeric("salary_max", { precision: 12, scale: 2 }),
  employmentType: varchar("employment_type", { length: 32 }).notNull().default("Full-time"),
  status: varchar("status", { length: 32 }).notNull().default("open"), // "open", "interviewing", "filled", "cancelled"
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobApplicants = pgTable("job_applicants", {
  id: serial("id").primaryKey(),
  requisitionId: integer("requisition_id").notNull().references(() => jobRequisitions.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  fullName: varchar("full_name", { length: 160 }).notNull(),
  email: varchar("email", { length: 160 }).notNull(),
  phone: varchar("phone", { length: 32 }),
  stage: varchar("stage", { length: 32 }).notNull().default("applied"), // "applied", "screening", "interview", "offer", "hired", "rejected"
  rating: integer("rating").notNull().default(3),
  resumeUrl: text("resume_url"),
  notes: text("notes"),
  offeredSalary: numeric("offered_salary", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const separationRecords = pgTable("separation_records", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  separationType: varchar("separation_type", { length: 32 }).notNull(), // "resignation", "retirement", "authorized_cause", "just_cause", "end_of_contract"
  noticeDate: date("notice_date").notNull(),
  lastDay: date("last_day").notNull(),
  finalPayDueDate: date("final_pay_due_date"),
  clearanceStatus: varchar("clearance_status", { length: 32 }).notNull().default("in_progress"),
  itCleared: boolean("it_cleared").notNull().default(false),
  adminCleared: boolean("admin_cleared").notNull().default(false),
  financeCleared: boolean("finance_cleared").notNull().default(false),
  hrCleared: boolean("hr_cleared").notNull().default(false),
  prorated13thMonth: numeric("prorated_13th_month", { precision: 12, scale: 2 }).notNull().default("0"),
  unusedLeaveCredits: numeric("unused_leave_credits", { precision: 6, scale: 1 }).notNull().default("0"),
  leaveMonetizationPay: numeric("leave_monetization_pay", { precision: 12, scale: 2 }).notNull().default("0"),
  taxAdjustment: numeric("tax_adjustment", { precision: 12, scale: 2 }).notNull().default("0"),
  loanDeductions: numeric("loan_deductions", { precision: 12, scale: 2 }).notNull().default("0"),
  netFinalPay: numeric("net_final_pay", { precision: 12, scale: 2 }).notNull().default("0"),
  finalPayBreakdown: jsonb("final_pay_breakdown").notNull().default({}),
  status: varchar("status", { length: 32 }).notNull().default("draft"), // "draft", "approved", "released"
  coeIssued: boolean("coe_issued").notNull().default(false),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  releasedBy: varchar("released_by", { length: 120 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const biometricDevices = pgTable("biometric_devices", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  deviceModel: varchar("device_model", { length: 80 }).notNull(), // "ZKTeco K40", "Hikvision Face/Retina DS-K1T", etc.
  serialNumber: varchar("serial_number", { length: 80 }).notNull().unique(),
  ipAddress: varchar("ip_address", { length: 45 }),
  port: integer("port").notNull().default(4370),
  branchName: varchar("branch_name", { length: 120 }).notNull(),
  protocol: varchar("protocol", { length: 32 }).notNull().default("ADMS"), // "ADMS", "Push SDK", "Port Forwarding"
  status: varchar("status", { length: 32 }).notNull().default("online"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leaveConversions = pgTable("leave_conversions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  leaveType: varchar("leave_type", { length: 40 }).notNull(),
  daysConverted: numeric("days_converted", { precision: 6, scale: 1 }).notNull(),
  dailyRate: numeric("daily_rate", { precision: 10, scale: 2 }).notNull(),
  cashAmount: numeric("cash_amount", { precision: 12, scale: 2 }).notNull(),
  taxExempt: boolean("tax_exempt").notNull().default(true), // up to 10 or 12 days SIL/VL per BIR rules
  payrollRunId: integer("payroll_run_id"),
  status: varchar("status", { length: 32 }).notNull().default("pending"), // "pending", "approved", "paid"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
