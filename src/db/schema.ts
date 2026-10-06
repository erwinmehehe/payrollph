import { sql } from "drizzle-orm";
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
  statutoryDeductionTiming: varchar("statutory_deduction_timing", { length: 24 }).notNull().default("split"),
  payrollCalendarMode: varchar("payroll_calendar_mode", { length: 24 }).notNull().default("flexible"),
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
  active: boolean("active").notNull().default(true),
  localPasswordEnabled: boolean("local_password_enabled").notNull().default(true),
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
    active: boolean("active").notNull().default(true),
  },
  (table) => [uniqueIndex("user_org_unique").on(table.userId, table.organizationId)],
);

export const legalEntities = pgTable(
  "legal_entities",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 40 }).notNull(),
    legalName: varchar("legal_name", { length: 200 }).notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    birTin: varchar("bir_tin", { length: 16 }),
    birBranchCode: varchar("bir_branch_code", { length: 4 }),
    sssEmployerNo: varchar("sss_employer_no", { length: 24 }),
    philHealthEmployerNo: varchar("philhealth_employer_no", { length: 24 }),
    pagIbigEmployerNo: varchar("pagibig_employer_no", { length: 24 }),
    statutoryDeductionTiming: varchar("statutory_deduction_timing", { length: 24 }).notNull().default("split"),
    payrollCalendarMode: varchar("payroll_calendar_mode", { length: 24 }).notNull().default("flexible"),
    disbursementBankCode: varchar("disbursement_bank_code", { length: 16 }),
    disbursementAccountName: varchar("disbursement_account_name", { length: 160 }),
    disbursementAccount: varchar("disbursement_account", { length: 160 }),
    primaryEntity: boolean("primary_entity").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("legal_entities_org_code_unique").on(table.organizationId, table.code),
    uniqueIndex("legal_entities_org_primary_unique")
      .on(table.organizationId)
      .where(sql`${table.primaryEntity} = true`),
    index("legal_entities_org_active_idx").on(table.organizationId, table.active),
  ],
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
  // Records whether this specific session completed MFA. Privileged actions
  // must never rely on the account-level totpEnabled flag alone.
  mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
  authMethod: varchar("auth_method", { length: 24 }).notNull().default("local"),
  identityProviderId: integer("identity_provider_id"),
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

export const emailChangeTokens = pgTable("email_change_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  newEmail: varchar("new_email", { length: 180 }).notNull(),
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

export const worksites = pgTable(
  "worksites",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    orgUnitId: integer("org_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
    code: varchar("code", { length: 32 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    siteType: varchar("site_type", { length: 32 }).notNull().default("office"),
    timezone: varchar("timezone", { length: 64 }).notNull().default("Asia/Manila"),
    region: varchar("region", { length: 64 }),
    province: varchar("province", { length: 100 }),
    cityMunicipality: varchar("city_municipality", { length: 120 }),
    addressLine1: varchar("address_line_1", { length: 200 }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("worksites_org_code_unique").on(table.organizationId, table.code),
    index("worksites_org_active_idx").on(table.organizationId, table.active),
    index("worksites_org_unit_idx").on(table.organizationId, table.orgUnitId),
  ],
);

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  orgUnitId: integer("org_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
  legalEntityId: integer("legal_entity_id").references(() => legalEntities.id, { onDelete: "restrict" }),
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
  // Holds an AES-256-GCM envelope ("enc:v1:...", about 75-105 chars) when
  // BANK_DATA_ENCRYPTION_KEY is set, so this is wider than a raw account number.
  bankAccount: varchar("bank_account", { length: 160 }),
  bankCode: varchar("bank_code", { length: 16 }),
  mobile: varchar("mobile", { length: 24 }),
  email: varchar("email", { length: 200 }),
  region: varchar("region", { length: 32 }).notNull().default("NCR"),
  // Employer-designated fixed weekly rest day. Null means not configured;
  // payroll must never guess this because a wrong default changes computed pay.
  restDay: varchar("rest_day", { length: 10 }),
  tin: varchar("tin", { length: 180 }),
  tinBranchCode: varchar("tin_branch_code", { length: 180 }),
  sssNo: varchar("sss_no", { length: 180 }),
  philHealthNo: varchar("philhealth_no", { length: 180 }),
  pagIbigNo: varchar("pagibig_no", { length: 180 }),
  pagIbigVoluntaryMonthly: numeric("pagibig_voluntary_monthly", { precision: 10, scale: 2 }).notNull().default("0"),
  nationality: varchar("nationality", { length: 60 }).notNull().default("Filipino"),
  birthDate: date("birth_date"),
  emergencyContact: varchar("emergency_contact", { length: 120 }),
  emergencyPhone: varchar("emergency_phone", { length: 32 }),
  dependentsCount: integer("dependents_count").default(0),
  education: varchar("education", { length: 120 }),
  startDate: date("start_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const employeeWorksiteAssignments = pgTable(
  "employee_worksite_assignments",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    worksiteId: integer("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
    effectiveFrom: date("effective_from").notNull(),
    effectiveUntil: date("effective_until"),
    reason: varchar("reason", { length: 240 }).notNull().default("Worksite assignment"),
    createdBy: varchar("created_by", { length: 120 }).notNull().default("System"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("employee_worksite_assignments_employee_date_idx").on(table.employeeId, table.effectiveFrom),
    index("employee_worksite_assignments_org_worksite_idx").on(table.organizationId, table.worksiteId),
  ],
);

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

export const employeeRestDayRevisions = pgTable(
  "employee_rest_day_revisions",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    effectiveDate: date("effective_date").notNull(),
    previousRestDay: varchar("previous_rest_day", { length: 10 }),
    newRestDay: varchar("new_rest_day", { length: 10 }),
    reason: varchar("reason", { length: 240 }).notNull().default("Work schedule change"),
    createdBy: varchar("created_by", { length: 120 }).notNull().default("System"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("employee_rest_day_revisions_org_employee_idx").on(table.organizationId, table.employeeId),
    uniqueIndex("employee_rest_day_revisions_employee_effective_idx").on(table.employeeId, table.effectiveDate),
  ],
);

export const shiftDefinitions = pgTable(
  "shift_definitions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 32 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    startTime: varchar("start_time", { length: 8 }).notNull(),
    endTime: varchar("end_time", { length: 8 }).notNull(),
    breakMinutes: integer("break_minutes").notNull().default(60),
    spansMidnight: boolean("spans_midnight").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("shift_definitions_org_code_unique").on(table.organizationId, table.code),
    index("shift_definitions_org_active_idx").on(table.organizationId, table.active),
  ],
);

export const workforceScheduleGuardrailPolicies = pgTable(
  "workforce_schedule_guardrail_policies",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().unique().references(() => organizations.id, { onDelete: "cascade" }),
    minimumRestMinutes: integer("minimum_rest_minutes").notNull().default(0),
    maxConsecutiveWorkingDays: integer("max_consecutive_working_days").notNull().default(0),
    rollingSevenDayMinutes: integer("rolling_seven_day_minutes").notNull().default(0),
    enforcementMode: varchar("enforcement_mode", { length: 24 }).notNull().default("advisory"),
    active: boolean("active").notNull().default(true),
    updatedBy: varchar("updated_by", { length: 120 }).notNull().default("System"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("workforce_schedule_guardrail_policy_org_idx").on(table.organizationId),
  ],
);

export const schedulePatterns = pgTable(
  "schedule_patterns",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 32 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    cycleDays: integer("cycle_days").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("schedule_patterns_org_code_unique").on(table.organizationId, table.code),
    index("schedule_patterns_org_active_idx").on(table.organizationId, table.active),
  ],
);

export const schedulePatternDays = pgTable(
  "schedule_pattern_days",
  {
    id: serial("id").primaryKey(),
    patternId: integer("pattern_id").notNull().references(() => schedulePatterns.id, { onDelete: "cascade" }),
    dayIndex: integer("day_index").notNull(),
    isRestDay: boolean("is_rest_day").notNull().default(false),
    label: varchar("label", { length: 80 }),
  },
  (table) => [
    uniqueIndex("schedule_pattern_days_pattern_day_unique").on(table.patternId, table.dayIndex),
  ],
);

export const schedulePatternSegments = pgTable(
  "schedule_pattern_segments",
  {
    id: serial("id").primaryKey(),
    patternDayId: integer("pattern_day_id").notNull().references(() => schedulePatternDays.id, { onDelete: "cascade" }),
    shiftDefinitionId: integer("shift_definition_id").notNull().references(() => shiftDefinitions.id, { onDelete: "restrict" }),
    segmentOrder: integer("segment_order").notNull().default(1),
  },
  (table) => [
    uniqueIndex("schedule_pattern_segments_day_order_unique").on(table.patternDayId, table.segmentOrder),
  ],
);

export const employeeScheduleAssignments = pgTable(
  "employee_schedule_assignments",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    patternId: integer("pattern_id").notNull().references(() => schedulePatterns.id, { onDelete: "restrict" }),
    effectiveFrom: date("effective_from").notNull(),
    effectiveUntil: date("effective_until"),
    anchorDate: date("anchor_date").notNull(),
    workLocationOrgUnitId: integer("work_location_org_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
    worksiteId: integer("worksite_id").references(() => worksites.id, { onDelete: "set null" }),
    reason: varchar("reason", { length: 240 }).notNull().default("Schedule assignment"),
    createdBy: varchar("created_by", { length: 120 }).notNull().default("System"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("employee_schedule_assignments_employee_date_idx").on(table.employeeId, table.effectiveFrom),
    index("employee_schedule_assignments_org_idx").on(table.organizationId),
  ],
);

export const scheduleOverrides = pgTable(
  "schedule_overrides",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    workDate: date("work_date").notNull(),
    kind: varchar("kind", { length: 24 }).notNull().default("shift"),
    isRestDay: boolean("is_rest_day").notNull().default(false),
    segments: jsonb("segments").notNull().default([]),
    workLocationOrgUnitId: integer("work_location_org_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
    worksiteId: integer("worksite_id").references(() => worksites.id, { onDelete: "set null" }),
    reason: varchar("reason", { length: 240 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("approved"),
    createdBy: varchar("created_by", { length: 120 }).notNull().default("System"),
    approvedBy: varchar("approved_by", { length: 120 }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("schedule_overrides_employee_date_unique").on(table.employeeId, table.workDate),
    index("schedule_overrides_org_date_idx").on(table.organizationId, table.workDate),
  ],
);

export const scheduleSwapRequests = pgTable(
  "schedule_swap_requests",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    requesterEmployeeId: integer("requester_employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    counterpartyEmployeeId: integer("counterparty_employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    requesterWorkDate: date("requester_work_date").notNull(),
    counterpartyWorkDate: date("counterparty_work_date").notNull(),
    requesterScheduleSnapshot: jsonb("requester_schedule_snapshot").notNull(),
    counterpartyScheduleSnapshot: jsonb("counterparty_schedule_snapshot").notNull(),
    reason: varchar("reason", { length: 240 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    requestedBy: varchar("requested_by", { length: 120 }).notNull(),
    requestedByUserId: integer("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decidedBy: varchar("decided_by", { length: 120 }),
    decidedByUserId: integer("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: varchar("decision_note", { length: 240 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("schedule_swap_requests_org_status_idx").on(table.organizationId, table.status),
    index("schedule_swap_requests_requester_date_idx").on(table.requesterEmployeeId, table.requesterWorkDate),
    index("schedule_swap_requests_counterparty_date_idx").on(table.counterpartyEmployeeId, table.counterpartyWorkDate),
  ],
);

export const timePunches = pgTable("time_punches", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  workDate: date("work_date").notNull(),
  timeIn: timestamp("time_in", { withTimezone: true }),
  timeOut: timestamp("time_out", { withTimezone: true }),
  breakStart: timestamp("break_start", { withTimezone: true }),
  breakEnd: timestamp("break_end", { withTimezone: true }),
  shiftStart: varchar("shift_start", { length: 8 }).notNull().default("09:00"),
  shiftEnd: varchar("shift_end", { length: 8 }).notNull().default("18:00"),
  status: varchar("status", { length: 32 }).notNull().default("Complete"),
  source: varchar("source", { length: 32 }).default("web_bundy"),
  deviceSerial: varchar("device_serial", { length: 80 }),
  ipAddress: varchar("ip_address", { length: 45 }),
  location: text("location"),
  notes: text("notes"),
});

export const attendanceCorrectionRequests = pgTable(
  "attendance_correction_requests",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    punchId: integer("punch_id").notNull().references(() => timePunches.id, { onDelete: "cascade" }),
    workDate: date("work_date").notNull(),
    originalPunchSnapshot: jsonb("original_punch_snapshot").notNull(),
    proposedPunchSnapshot: jsonb("proposed_punch_snapshot").notNull(),
    reason: varchar("reason", { length: 240 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    requestedBy: varchar("requested_by", { length: 120 }).notNull(),
    requestedByUserId: integer("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decidedBy: varchar("decided_by", { length: 120 }),
    decidedByUserId: integer("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: varchar("decision_note", { length: 240 }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    invalidatedPayrollRunIds: jsonb("invalidated_payroll_run_ids").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("attendance_corrections_org_status_idx").on(table.organizationId, table.status),
    index("attendance_corrections_employee_date_idx").on(table.employeeId, table.workDate),
    index("attendance_corrections_punch_idx").on(table.punchId),
  ],
);

export const overtimeRequests = pgTable(
  "overtime_requests",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    workDate: date("work_date").notNull(),
    requestedMinutes: integer("requested_minutes").notNull(),
    reason: varchar("reason", { length: 240 }).notNull(),
    requestKind: varchar("request_kind", { length: 32 }).notNull().default("pre_approved"),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    approvalTaskId: integer("approval_task_id"),
    requestedBy: varchar("requested_by", { length: 120 }).notNull(),
    requestedByUserId: integer("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decidedBy: varchar("decided_by", { length: 120 }),
    decidedByUserId: integer("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: varchar("decision_note", { length: 240 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("overtime_requests_org_date_idx").on(table.organizationId, table.workDate),
    index("overtime_requests_employee_date_idx").on(table.employeeId, table.workDate),
    index("overtime_requests_status_idx").on(table.organizationId, table.status),
  ],
);

export const overtimeBudgetPolicies = pgTable(
  "overtime_budget_policies",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    orgUnitId: integer("org_unit_id").notNull().references(() => orgUnits.id, { onDelete: "cascade" }),
    managerUserId: integer("manager_user_id").references(() => users.id, { onDelete: "set null" }),
    scopeKey: varchar("scope_key", { length: 120 }).notNull(),
    monthStart: date("month_start").notNull(),
    budgetMinutes: integer("budget_minutes").notNull().default(0),
    enforcementMode: varchar("enforcement_mode", { length: 24 }).notNull().default("advisory"),
    active: boolean("active").notNull().default(true),
    updatedBy: varchar("updated_by", { length: 120 }).notNull().default("System"),
    updatedByUserId: integer("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("overtime_budget_scope_month_unique").on(table.organizationId, table.scopeKey, table.monthStart),
    index("overtime_budget_org_month_idx").on(table.organizationId, table.monthStart),
    index("overtime_budget_org_unit_idx").on(table.organizationId, table.orgUnitId),
  ],
);

export const workforceTimesheetPolicies = pgTable(
  "workforce_timesheet_policies",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().unique().references(() => organizations.id, { onDelete: "cascade" }),
    enforcementMode: varchar("enforcement_mode", { length: 24 }).notNull().default("advisory"),
    active: boolean("active").notNull().default(true),
    updatedBy: varchar("updated_by", { length: 120 }).notNull().default("System"),
    updatedByUserId: integer("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("workforce_timesheet_policy_org_idx").on(table.organizationId),
  ],
);

export const workforceTimesheets = pgTable(
  "workforce_timesheets",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    version: integer("version").notNull().default(1),
    status: varchar("status", { length: 24 }).notNull().default("submitted"),
    scheduledMinutes: integer("scheduled_minutes").notNull().default(0),
    workedMinutes: integer("worked_minutes").notNull().default(0),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    exceptionCount: integer("exception_count").notNull().default(0),
    blockerCount: integer("blocker_count").notNull().default(0),
    snapshot: jsonb("snapshot").notNull().default({}),
    snapshotHash: varchar("snapshot_hash", { length: 64 }).notNull(),
    submittedBy: varchar("submitted_by", { length: 120 }),
    submittedByUserId: integer("submitted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    decidedBy: varchar("decided_by", { length: 120 }),
    decidedByUserId: integer("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: varchar("decision_note", { length: 240 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workforce_timesheet_period_version_unique").on(
      table.organizationId,
      table.employeeId,
      table.periodStart,
      table.periodEnd,
      table.version,
    ),
    index("workforce_timesheet_org_period_idx").on(table.organizationId, table.periodStart, table.periodEnd),
    index("workforce_timesheet_status_idx").on(table.organizationId, table.status),
  ],
);

export const costCenters = pgTable(
  "cost_centers",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 40 }).notNull(),
    name: varchar("name", { length: 140 }).notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("cost_centers_org_code_unique").on(table.organizationId, table.code),
    index("cost_centers_org_active_idx").on(table.organizationId, table.active),
  ],
);

export const employeeLaborAllocations = pgTable(
  "employee_labor_allocations",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    costCenterId: integer("cost_center_id").notNull().references(() => costCenters.id, { onDelete: "restrict" }),
    effectiveFrom: date("effective_from").notNull(),
    effectiveUntil: date("effective_until"),
    allocationPercent: numeric("allocation_percent", { precision: 6, scale: 3 }).notNull(),
    allocationBasis: varchar("allocation_basis", { length: 24 }).notNull().default("percentage"),
    projectCode: varchar("project_code", { length: 64 }),
    clientCode: varchar("client_code", { length: 64 }),
    jobCode: varchar("job_code", { length: 64 }),
    reason: varchar("reason", { length: 240 }).notNull().default("Labor costing allocation"),
    createdBy: varchar("created_by", { length: 120 }).notNull().default("System"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("employee_labor_allocations_employee_date_idx").on(table.employeeId, table.effectiveFrom),
    index("employee_labor_allocations_org_cost_center_idx").on(table.organizationId, table.costCenterId),
  ],
);

export const employeeAvailabilityRules = pgTable(
  "employee_availability_rules",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    startTime: varchar("start_time", { length: 8 }).notNull(),
    endTime: varchar("end_time", { length: 8 }).notNull(),
    availabilityType: varchar("availability_type", { length: 24 }).notNull().default("unavailable"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveUntil: date("effective_until"),
    notes: varchar("notes", { length: 240 }),
    createdBy: varchar("created_by", { length: 120 }).notNull().default("System"),
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("employee_availability_employee_idx").on(table.organizationId, table.employeeId, table.weekday),
    index("employee_availability_effective_idx").on(table.organizationId, table.effectiveFrom),
  ],
);

export const staffingRequirements = pgTable(
  "staffing_requirements",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    worksiteId: integer("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
    workDate: date("work_date").notNull(),
    shiftDefinitionId: integer("shift_definition_id").notNull().references(() => shiftDefinitions.id, { onDelete: "restrict" }),
    requiredHeadcount: integer("required_headcount").notNull(),
    notes: varchar("notes", { length: 240 }),
    createdBy: varchar("created_by", { length: 120 }).notNull().default("System"),
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("staffing_requirement_unique").on(
      table.organizationId,
      table.worksiteId,
      table.workDate,
      table.shiftDefinitionId,
    ),
    index("staffing_requirement_date_idx").on(table.organizationId, table.workDate),
  ],
);

export const openShifts = pgTable(
  "open_shifts",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    worksiteId: integer("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
    workDate: date("work_date").notNull(),
    shiftDefinitionId: integer("shift_definition_id").notNull().references(() => shiftDefinitions.id, { onDelete: "restrict" }),
    slots: integer("slots").notNull().default(1),
    status: varchar("status", { length: 24 }).notNull().default("open"),
    sourceRequirementId: integer("source_requirement_id").references(() => staffingRequirements.id, { onDelete: "set null" }),
    reason: varchar("reason", { length: 240 }).notNull().default("Coverage gap"),
    createdBy: varchar("created_by", { length: 120 }).notNull().default("System"),
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("open_shifts_org_date_idx").on(table.organizationId, table.workDate, table.status),
    index("open_shifts_worksite_idx").on(table.organizationId, table.worksiteId, table.workDate),
  ],
);

export const openShiftClaims = pgTable(
  "open_shift_claims",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    openShiftId: integer("open_shift_id").notNull().references(() => openShifts.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    reason: varchar("reason", { length: 240 }).notNull().default("Open shift claim"),
    requestedBy: varchar("requested_by", { length: 120 }).notNull(),
    requestedByUserId: integer("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decidedBy: varchar("decided_by", { length: 120 }),
    decidedByUserId: integer("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: varchar("decision_note", { length: 240 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("open_shift_claim_unique").on(table.openShiftId, table.employeeId),
    index("open_shift_claim_org_status_idx").on(table.organizationId, table.status),
    index("open_shift_claim_employee_idx").on(table.organizationId, table.employeeId, table.status),
  ],
);

export const payPolicies = pgTable(
  "pay_policies",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    policyKind: varchar("policy_kind", { length: 32 }).notNull().default("company"),
    version: varchar("version", { length: 48 }).notNull(),
    scopeType: varchar("scope_type", { length: 24 }).notNull().default("organization"),
    scopeOrgUnitId: integer("scope_org_unit_id").references(() => orgUnits.id, { onDelete: "cascade" }),
    scopeEmployeeId: integer("scope_employee_id").references(() => employees.id, { onDelete: "cascade" }),
    priority: integer("priority").notNull().default(100),
    effectiveFrom: date("effective_from").notNull(),
    effectiveUntil: date("effective_until"),
    active: boolean("active").notNull().default(true),
    description: text("description"),
    createdBy: varchar("created_by", { length: 120 }).notNull().default("System"),
    approvedBy: varchar("approved_by", { length: 120 }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pay_policies_org_code_version_unique").on(table.organizationId, table.code, table.version),
    index("pay_policies_org_effective_idx").on(table.organizationId, table.effectiveFrom),
    index("pay_policies_scope_idx").on(table.organizationId, table.scopeType, table.scopeOrgUnitId, table.scopeEmployeeId),
  ],
);

export const payPolicyRules = pgTable(
  "pay_policy_rules",
  {
    id: serial("id").primaryKey(),
    policyId: integer("policy_id").notNull().references(() => payPolicies.id, { onDelete: "cascade" }),
    ruleKey: varchar("rule_key", { length: 80 }).notNull(),
    eventType: varchar("event_type", { length: 48 }).notNull(),
    conditions: jsonb("conditions").notNull().default({}),
    outcome: jsonb("outcome").notNull().default({}),
    priority: integer("priority").notNull().default(100),
    statutoryFloorProtected: boolean("statutory_floor_protected").notNull().default(true),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pay_policy_rules_policy_key_unique").on(table.policyId, table.ruleKey),
    index("pay_policy_rules_policy_priority_idx").on(table.policyId, table.priority),
  ],
);

export const payrollRuns = pgTable("payroll_runs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  legalEntityId: integer("legal_entity_id").references(() => legalEntities.id, { onDelete: "restrict" }),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    index("employee_pay_retro_org_employee_idx").on(table.organizationId, table.employeeId),
    uniqueIndex("employee_pay_retro_revision_run_idx").on(table.revisionId, table.sourcePayrollRunId),
  ],
);

export const managedPayrollEngagements = pgTable(
  "managed_payroll_engagements",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 24 }).notNull().default("pilot"),
    serviceTier: varchar("service_tier", { length: 48 }).notNull().default("Managed payroll"),
    clientApproverUserId: integer("client_approver_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    slaHours: integer("sla_hours").notNull().default(24),
    targetGoLive: date("target_go_live"),
    createdBy: varchar("created_by", { length: 120 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("managed_payroll_engagement_org_unique").on(table.organizationId)],
);

export const managedPayrollGates = pgTable(
  "managed_payroll_gates",
  {
    id: serial("id").primaryKey(),
    engagementId: integer("engagement_id").notNull().references(() => managedPayrollEngagements.id, { onDelete: "cascade" }),
    gateKey: varchar("gate_key", { length: 64 }).notNull(),
    label: varchar("label", { length: 180 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    evidenceRef: text("evidence_ref"),
    completedBy: varchar("completed_by", { length: 120 }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("managed_payroll_gate_unique").on(table.engagementId, table.gateKey)],
);

export const managedPayrollRunApprovals = pgTable(
  "managed_payroll_run_approvals",
  {
    id: serial("id").primaryKey(),
    engagementId: integer("engagement_id").notNull().references(() => managedPayrollEngagements.id, { onDelete: "cascade" }),
    payrollRunId: integer("payroll_run_id").notNull().references(() => payrollRuns.id, { onDelete: "cascade" }),
    approverUserId: integer("approver_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    approvedByUserId: integer("approved_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    approvedBy: varchar("approved_by", { length: 120 }).notNull(),
    payrollFingerprint: varchar("payroll_fingerprint", { length: 64 }).notNull(),
    approvedGross: numeric("approved_gross", { precision: 14, scale: 2 }).notNull(),
    approvedNet: numeric("approved_net", { precision: 14, scale: 2 }).notNull(),
    approvedEmployeeCount: integer("approved_employee_count").notNull(),
    note: text("note"),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("managed_payroll_run_approval_unique").on(table.payrollRunId)],
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

export const bankFileValidations = pgTable(
  "bank_file_validations",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    payrollRunId: integer("payroll_run_id").references(() => payrollRuns.id, { onDelete: "set null" }),
    templateName: varchar("template_name", { length: 100 }).notNull(),
    templateVersion: varchar("template_version", { length: 32 }).notNull(),
    fileName: varchar("file_name", { length: 180 }).notNull(),
    fileSha256: varchar("file_sha256", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("generated"),
    portalReference: varchar("portal_reference", { length: 120 }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    outcomeNote: text("outcome_note"),
    generatedBy: varchar("generated_by", { length: 120 }).notNull(),
    recordedBy: varchar("recorded_by", { length: 120 }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("bank_file_validation_unique").on(
      table.organizationId,
      table.templateName,
      table.templateVersion,
      table.fileSha256,
    ),
    index("bank_file_validation_status_idx").on(table.status, table.templateName),
  ],
);

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
  status: varchar("status", { length: 24 }).notNull().default("computed"),
  payrollRunId: integer("payroll_run_id").references(() => payrollRuns.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: varchar("approved_by", { length: 120 }),
  settledAt: timestamp("settled_at", { withTimezone: true }),
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

export const supplementaryEarnings = pgTable("supplementary_earnings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  earningType: varchar("earning_type", { length: 32 }).notNull(),
  label: varchar("label", { length: 120 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  taxable: boolean("taxable").notNull().default(true),
  includeInSssBase: boolean("include_in_sss_base").notNull().default(true),
  includeInPagIbigBase: boolean("include_in_pagibig_base").notNull().default(true),
  effectiveDate: date("effective_date").notNull(),
  status: varchar("status", { length: 24 }).notNull().default("approved"),
  payrollRunId: integer("payroll_run_id").references(() => payrollRuns.id, { onDelete: "set null" }),
  createdBy: varchar("created_by", { length: 120 }).notNull().default("System"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("supplementary_earnings_org_employee_idx").on(table.organizationId, table.employeeId),
  index("supplementary_earnings_status_effective_idx").on(table.status, table.effectiveDate),
]);

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
  tin: varchar("tin", { length: 180 }),
  withholdingAtc: varchar("withholding_atc", { length: 24 }),
  withholdingRate: numeric("withholding_rate", { precision: 6, scale: 3 }),
  contractStart: date("contract_start"),
  contractEnd: date("contract_end"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contractorPayments = pgTable("contractor_payments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  contractorId: integer("contractor_id").notNull().references(() => contractors.id, { onDelete: "restrict" }),
  paymentDate: date("payment_date").notNull(),
  grossAmountPhp: numeric("gross_amount_php", { precision: 14, scale: 2 }).notNull(),
  withholdingAtc: varchar("withholding_atc", { length: 24 }).notNull(),
  withholdingRate: numeric("withholding_rate", { precision: 6, scale: 3 }).notNull(),
  withholdingAmount: numeric("withholding_amount", { precision: 14, scale: 2 }).notNull(),
  netAmountPhp: numeric("net_amount_php", { precision: 14, scale: 2 }).notNull(),
  reference: varchar("reference", { length: 160 }),
  createdBy: varchar("created_by", { length: 120 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("contractor_payment_org_date_idx").on(table.organizationId, table.paymentDate),
  index("contractor_payment_contractor_idx").on(table.contractorId),
]);

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

export const complianceRules = pgTable(
  "compliance_rules",
  {
    id: serial("id").primaryKey(),
    ruleKey: varchar("rule_key", { length: 80 }).notNull(),
    agency: varchar("agency", { length: 40 }).notNull(),
    jurisdiction: varchar("jurisdiction", { length: 80 }).notNull().default("PH"),
    region: varchar("region", { length: 40 }).notNull().default("ALL"),
    ruleVersion: varchar("rule_version", { length: 64 }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveUntil: date("effective_until"),
    sourceDocument: varchar("source_document", { length: 240 }).notNull(),
    sourceUrl: text("source_url").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: varchar("status", { length: 24 }).notNull().default("draft"),
    futureEffective: boolean("future_effective").notNull().default(false),
    reviewedBy: varchar("reviewed_by", { length: 120 }),
    approvedBy: varchar("approved_by", { length: 120 }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    supersedesRuleVersion: varchar("supersedes_rule_version", { length: 64 }),
    rollbackVersion: varchar("rollback_version", { length: 64 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("compliance_rules_version_unique").on(
      table.ruleKey,
      table.jurisdiction,
      table.region,
      table.ruleVersion,
    ),
    index("compliance_rules_effective_idx").on(
      table.ruleKey,
      table.jurisdiction,
      table.region,
      table.effectiveFrom,
    ),
    index("compliance_rules_status_idx").on(table.status, table.effectiveFrom),
  ],
);

export const holidays = pgTable("holidays", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  orgUnitId: integer("org_unit_id").references(() => orgUnits.id, { onDelete: "cascade" }),
  worksiteId: integer("worksite_id").references(() => worksites.id, { onDelete: "cascade" }),
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
  dedupeKey: varchar("dedupe_key", { length: 200 }),
  status: varchar("status", { length: 24 }).notNull().default("queued"),
  provider: varchar("provider", { length: 40 }).notNull().default("none"),
  providerMessageId: varchar("provider_message_id", { length: 200 }),
  deliveryStatus: varchar("delivery_status", { length: 32 }),
  deliveryDetail: text("delivery_detail"),
  deliveryUpdatedAt: timestamp("delivery_updated_at", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(4),
  error: text("error"),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("outbox_dedupe_key_unique").on(table.dedupeKey),
  index("outbox_org_created_idx").on(table.organizationId, table.createdAt),
  index("outbox_retry_idx").on(table.status, table.nextAttemptAt),
]);

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

export const hcmPolicyVersions = pgTable(
  "hcm_policy_versions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    policyCode: varchar("policy_code", { length: 80 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    category: varchar("category", { length: 60 }).notNull().default("company_policy"),
    version: varchar("version", { length: 48 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("draft"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveUntil: date("effective_until"),
    targetConditions: jsonb("target_conditions").notNull().default({}),
    requiresAcknowledgement: boolean("requires_acknowledgement").notNull().default(true),
    acknowledgementDueDays: integer("acknowledgement_due_days").notNull().default(7),
    sourceDocumentId: integer("source_document_id").references(() => documents.id, { onDelete: "set null" }),
    content: text("content").notNull().default(""),
    contentSha256: varchar("content_sha256", { length: 64 }).notNull(),
    approvedByUserId: integer("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    approvedByName: varchar("approved_by_name", { length: 120 }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdByName: varchar("created_by_name", { length: 120 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("hcm_policy_version_unique").on(table.organizationId, table.policyCode, table.version),
    index("hcm_policy_status_effective_idx").on(table.organizationId, table.status, table.effectiveFrom),
  ],
);

export const hcmPolicyAssignments = pgTable(
  "hcm_policy_assignments",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    policyId: integer("policy_id").notNull().references(() => hcmPolicyVersions.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: varchar("status", { length: 24 }).notNull().default("assigned"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedByUserId: integer("acknowledged_by_user_id").references(() => users.id, { onDelete: "set null" }),
    acknowledgementSha256: varchar("acknowledgement_sha256", { length: 64 }),
    acknowledgementEvidence: jsonb("acknowledgement_evidence").notNull().default({}),
    waivedAt: timestamp("waived_at", { withTimezone: true }),
    waivedByUserId: integer("waived_by_user_id").references(() => users.id, { onDelete: "set null" }),
    waivedByName: varchar("waived_by_name", { length: 120 }),
    waiverReason: varchar("waiver_reason", { length: 240 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("hcm_policy_assignment_unique").on(table.policyId, table.employeeId),
    index("hcm_policy_assignment_employee_idx").on(table.organizationId, table.employeeId, table.status),
    index("hcm_policy_assignment_due_idx").on(table.organizationId, table.status, table.dueAt),
  ],
);

export const hcmDocumentRequirements = pgTable(
  "hcm_document_requirements",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 80 }).notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    kind: varchar("kind", { length: 40 }).notNull(),
    targetConditions: jsonb("target_conditions").notNull().default({}),
    mandatory: boolean("mandatory").notNull().default(true),
    expiryRequired: boolean("expiry_required").notNull().default(false),
    submissionDueDays: integer("submission_due_days").notNull().default(14),
    renewalLeadDays: integer("renewal_lead_days").notNull().default(30),
    active: boolean("active").notNull().default(true),
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdByName: varchar("created_by_name", { length: 120 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("hcm_document_requirement_unique").on(table.organizationId, table.code),
    index("hcm_document_requirement_active_idx").on(table.organizationId, table.active),
  ],
);

export const hcmEmployeeDocumentCompliance = pgTable(
  "hcm_employee_document_compliance",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    requirementId: integer("requirement_id").notNull().references(() => hcmDocumentRequirements.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    documentId: integer("document_id").references(() => documents.id, { onDelete: "set null" }),
    status: varchar("status", { length: 24 }).notNull().default("missing"),
    dueAt: date("due_at"),
    expiresAt: date("expires_at"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedByUserId: integer("verified_by_user_id").references(() => users.id, { onDelete: "set null" }),
    verifiedByName: varchar("verified_by_name", { length: 120 }),
    waivedAt: timestamp("waived_at", { withTimezone: true }),
    waivedByUserId: integer("waived_by_user_id").references(() => users.id, { onDelete: "set null" }),
    waivedByName: varchar("waived_by_name", { length: 120 }),
    waiverReason: varchar("waiver_reason", { length: 240 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("hcm_employee_document_requirement_unique").on(table.requirementId, table.employeeId),
    index("hcm_employee_document_status_idx").on(table.organizationId, table.employeeId, table.status),
    index("hcm_employee_document_expiry_idx").on(table.organizationId, table.status, table.expiresAt),
  ],
);

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
  fulfillmentAction: varchar("fulfillment_action", { length: 64 }),
  fulfillmentEvidence: jsonb("fulfillment_evidence").notNull().default({}),
  legalRetentionApplied: boolean("legal_retention_applied").notNull().default(false),
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
  basicSalary: numeric("basic_salary", { precision: 14, scale: 2 }),
  netPay: numeric("net_pay", { precision: 14, scale: 2 }).notNull(),
  taxWithheld: numeric("tax_withheld", { precision: 14, scale: 2 }).notNull().default("0"),
  sssEmployee: numeric("sss_employee", { precision: 14, scale: 2 }).notNull().default("0"),
  philHealthEmployee: numeric("philhealth_employee", { precision: 14, scale: 2 }).notNull().default("0"),
  pagIbigEmployee: numeric("pagibig_employee", { precision: 14, scale: 2 }).notNull().default("0"),
  thirteenthMonth: numeric("thirteenth_month", { precision: 14, scale: 2 }).notNull().default("0"),
  // Null means the prior provider did not supply category-level de minimis
  // detail. An explicit {} means the source confirmed there was none.
  deMinimisBreakdown: jsonb("de_minimis_breakdown"),
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

/**
 * Evidence that a file Linaw generated was actually accepted by an agency.
 * A row is created when a filing file is generated (status "generated", tied to
 * the file's SHA-256), and is later marked accepted or rejected by a person who
 * has the agency's own acknowledgement. Readiness reads this table instead of
 * trusting an environment flag. Rows are never deleted by the app, and an
 * accepted row cannot be edited.
 */
export const laborInspectionDrills = pgTable(
  "labor_inspection_drills",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 24 }).notNull(),
    rangeLabel: varchar("range_label", { length: 120 }).notNull(),
    evidencePackSha256: varchar("evidence_pack_sha256", { length: 64 }).notNull(),
    evidencePackVersion: varchar("evidence_pack_version", { length: 64 }).notNull(),
    snapshotSha256: varchar("snapshot_sha256", { length: 64 }).notNull(),
    highFindings: integer("high_findings").notNull().default(0),
    mediumFindings: integer("medium_findings").notNull().default(0),
    infoFindings: integer("info_findings").notNull().default(0),
    recordedExposure: numeric("recorded_exposure", { precision: 14, scale: 2 }).notNull().default("0"),
    screeningExposure: numeric("screening_exposure", { precision: 14, scale: 2 }).notNull().default("0"),
    unownedActionable: integer("unowned_actionable").notNull().default(0),
    readyToClose: integer("ready_to_close").notNull().default(0),
    blockerSummary: jsonb("blocker_summary").notNull().default([]),
    actionPlan: jsonb("action_plan").notNull().default([]),
    sectionRowCounts: jsonb("section_row_counts").notNull().default({}),
    generatedBy: varchar("generated_by", { length: 120 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("labor_inspection_drills_org_created_idx").on(table.organizationId, table.createdAt),
    index("labor_inspection_drills_status_idx").on(table.organizationId, table.status),
  ],
);

export const laborInspectionRemediations = pgTable(
  "labor_inspection_remediations",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    findingKey: varchar("finding_key", { length: 220 }).notNull(),
    ruleCode: varchar("rule_code", { length: 80 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("open"),
    owner: varchar("owner", { length: 120 }),
    acknowledgedBy: varchar("acknowledged_by", { length: 120 }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    evidenceReference: varchar("evidence_reference", { length: 240 }),
    resolvedBy: varchar("resolved_by", { length: 120 }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("labor_inspection_remediation_unique").on(table.organizationId, table.findingKey),
    index("labor_inspection_remediation_status_idx").on(table.organizationId, table.status),
  ],
);

export const governmentFilingValidations = pgTable(
  "government_filing_validations",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    payrollRunId: integer("payroll_run_id").references(() => payrollRuns.id, { onDelete: "set null" }),
    agency: varchar("agency", { length: 16 }).notNull(),
    form: varchar("form", { length: 24 }).notNull(),
    periodLabel: varchar("period_label", { length: 80 }).notNull(),
    applicableMonth: varchar("applicable_month", { length: 7 }),
    employeeCount: integer("employee_count"),
    reportedTotal: numeric("reported_total", { precision: 14, scale: 2 }),
    fileName: varchar("file_name", { length: 160 }).notNull(),
    fileSha256: varchar("file_sha256", { length: 64 }).notNull(),
    generatorVersion: varchar("generator_version", { length: 48 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("generated"),
    submissionMethod: varchar("submission_method", { length: 16 }),
    agencyReference: varchar("agency_reference", { length: 80 }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    outcomeNote: text("outcome_note"),
    generatedBy: varchar("generated_by", { length: 120 }).notNull(),
    recordedBy: varchar("recorded_by", { length: 120 }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("government_filing_file_unique").on(table.organizationId, table.agency, table.form, table.fileSha256),
    index("government_filing_status_idx").on(table.agency, table.form, table.status),
  ],
);

export const birWithholdingRemittanceBatches = pgTable(
  "bir_withholding_remittance_batches",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    applicableMonth: varchar("applicable_month", { length: 7 }).notNull(),
    filingChannel: varchar("filing_channel", { length: 24 }).notNull(),
    efpsGroup: varchar("efps_group", { length: 1 }),
    filingDueDate: date("filing_due_date").notNull(),
    paymentDueDate: date("payment_due_date").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("open"),
    employeeCount: integer("employee_count").notNull().default(0),
    payrollRunCount: integer("payroll_run_count").notNull().default(0),
    expectedTaxWithheld: numeric("expected_tax_withheld", { precision: 14, scale: 2 }).notNull().default("0"),
    amountPaid: numeric("amount_paid", { precision: 14, scale: 2 }),
    paymentReference: varchar("payment_reference", { length: 120 }),
    paymentVarianceNote: varchar("payment_variance_note", { length: 240 }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paymentRecordedByUserId: integer("payment_recorded_by_user_id").references(() => users.id, { onDelete: "set null" }),
    paymentRecordedBy: varchar("payment_recorded_by", { length: 120 }),
    filingValidationId: integer("filing_validation_id").references(() => governmentFilingValidations.id, { onDelete: "set null" }),
    filingReference: varchar("filing_reference", { length: 120 }),
    filedAt: timestamp("filed_at", { withTimezone: true }),
    snapshotHash: varchar("snapshot_hash", { length: 64 }).notNull(),
    createdBy: varchar("created_by", { length: 120 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("bir_withholding_remittance_month_unique").on(table.organizationId, table.applicableMonth),
    index("bir_withholding_remittance_due_idx").on(table.organizationId, table.status, table.paymentDueDate),
    index("bir_withholding_remittance_filing_idx").on(table.organizationId, table.filingValidationId),
  ],
);

export const statutoryRemittanceBatches = pgTable(
  "statutory_remittance_batches",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    agency: varchar("agency", { length: 16 }).notNull(),
    applicableMonth: varchar("applicable_month", { length: 7 }).notNull(),
    dueDate: date("due_date").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("open"),
    employeeCount: integer("employee_count").notNull().default(0),
    expectedEmployeeShare: numeric("expected_employee_share", { precision: 14, scale: 2 }).notNull().default("0"),
    expectedEmployerShare: numeric("expected_employer_share", { precision: 14, scale: 2 }).notNull().default("0"),
    expectedTotal: numeric("expected_total", { precision: 14, scale: 2 }).notNull().default("0"),
    amountPaid: numeric("amount_paid", { precision: 14, scale: 2 }),
    paymentReference: varchar("payment_reference", { length: 120 }),
    agencyReceiptReference: varchar("agency_receipt_reference", { length: 120 }),
    paymentChannel: varchar("payment_channel", { length: 80 }),
    paymentVarianceNote: varchar("payment_variance_note", { length: 240 }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paymentRecordedByUserId: integer("payment_recorded_by_user_id").references(() => users.id, { onDelete: "set null" }),
    paymentRecordedBy: varchar("payment_recorded_by", { length: 120 }),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    reconciledByUserId: integer("reconciled_by_user_id").references(() => users.id, { onDelete: "set null" }),
    reconciledBy: varchar("reconciled_by", { length: 120 }),
    snapshotHash: varchar("snapshot_hash", { length: 64 }).notNull(),
    notes: text("notes"),
    createdBy: varchar("created_by", { length: 120 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("statutory_remittance_batch_unique").on(table.organizationId, table.agency, table.applicableMonth),
    index("statutory_remittance_due_idx").on(table.organizationId, table.status, table.dueDate),
    index("statutory_remittance_batches_payment_recorder_idx").on(table.organizationId, table.paymentRecordedByUserId),
    index("statutory_remittance_batches_reconciler_idx").on(table.organizationId, table.reconciledByUserId),
  ],
);

export const statutoryRemittancePaymentEvidence = pgTable(
  "statutory_remittance_payment_evidence",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    batchId: integer("batch_id").notNull().references(() => statutoryRemittanceBatches.id, { onDelete: "cascade" }),
    fileName: varchar("file_name", { length: 180 }).notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    byteSize: integer("byte_size").notNull(),
    fileSha256: varchar("file_sha256", { length: 64 }).notNull(),
    fileDataBase64: text("file_data_base64").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("active"),
    replacementReason: varchar("replacement_reason", { length: 280 }),
    uploadedByUserId: integer("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
    uploadedByName: varchar("uploaded_by_name", { length: 120 }).notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("statutory_remittance_payment_evidence_hash_unique").on(table.batchId, table.fileSha256),
    index("statutory_remittance_payment_evidence_batch_idx").on(table.organizationId, table.batchId, table.status),
  ],
);

export const statutoryPostingEvidenceArtifacts = pgTable(
  "statutory_posting_evidence_artifacts",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    batchId: integer("batch_id").notNull().references(() => statutoryRemittanceBatches.id, { onDelete: "cascade" }),
    sourceType: varchar("source_type", { length: 32 }).notNull(),
    outcome: varchar("outcome", { length: 32 }).notNull(),
    fileName: varchar("file_name", { length: 200 }),
    mimeType: varchar("mime_type", { length: 100 }),
    byteSize: integer("byte_size"),
    contentSha256: varchar("content_sha256", { length: 64 }).notNull(),
    fileDataBase64: text("file_data_base64"),
    evidenceReference: varchar("evidence_reference", { length: 160 }),
    rowCount: integer("row_count").notNull().default(1),
    recordedByUserId: integer("recorded_by_user_id").references(() => users.id, { onDelete: "set null" }),
    recordedByName: varchar("recorded_by_name", { length: 120 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("statutory_posting_evidence_batch_hash_unique").on(
      table.organizationId,
      table.batchId,
      table.contentSha256,
      table.outcome,
    ),
    index("statutory_posting_evidence_batch_idx").on(
      table.organizationId,
      table.batchId,
      table.sourceType,
    ),
  ],
);

export const statutoryRemittanceMembers = pgTable(
  "statutory_remittance_members",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id").notNull().references(() => statutoryRemittanceBatches.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    employeeNo: varchar("employee_no", { length: 32 }).notNull(),
    employeeShare: numeric("employee_share", { precision: 12, scale: 2 }).notNull().default("0"),
    employerShare: numeric("employer_share", { precision: 12, scale: 2 }).notNull().default("0"),
    totalContribution: numeric("total_contribution", { precision: 12, scale: 2 }).notNull().default("0"),
    postingStatus: varchar("posting_status", { length: 24 }).notNull().default("pending"),
    postingReference: varchar("posting_reference", { length: 120 }),
    postedAmount: numeric("posted_amount", { precision: 12, scale: 2 }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    confirmedByUserId: integer("confirmed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    confirmedBy: varchar("confirmed_by", { length: 120 }),
    postingEvidenceArtifactId: integer("posting_evidence_artifact_id").references(
      () => statutoryPostingEvidenceArtifacts.id,
      { onDelete: "set null" },
    ),
    exceptionNote: text("exception_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("statutory_remittance_member_unique").on(table.batchId, table.employeeId),
    index("statutory_remittance_member_status_idx").on(table.organizationId, table.postingStatus),
    index("statutory_remittance_members_confirmer_idx").on(table.organizationId, table.confirmedByUserId),
    index("statutory_remittance_members_evidence_idx").on(table.organizationId, table.postingEvidenceArtifactId),
  ],
);

export const statutoryRemittanceCorrectionRequests = pgTable(
  "statutory_remittance_correction_requests",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    targetType: varchar("target_type", { length: 32 }).notNull(),
    batchId: integer("batch_id").notNull().references(() => statutoryRemittanceBatches.id, { onDelete: "cascade" }),
    memberId: integer("member_id").references(() => statutoryRemittanceMembers.id, { onDelete: "cascade" }),
    originalSnapshot: jsonb("original_snapshot").notNull(),
    proposedSnapshot: jsonb("proposed_snapshot").notNull(),
    reason: varchar("reason", { length: 360 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    requestedByUserId: integer("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
    requestedByName: varchar("requested_by_name", { length: 120 }).notNull(),
    decidedByUserId: integer("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decidedByName: varchar("decided_by_name", { length: 120 }),
    decisionNote: varchar("decision_note", { length: 360 }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("statutory_remittance_corrections_status_idx").on(table.organizationId, table.status, table.createdAt),
    index("statutory_remittance_corrections_batch_idx").on(table.organizationId, table.batchId),
    index("statutory_remittance_corrections_member_idx").on(table.organizationId, table.memberId),
  ],
);

export const doleReportingProfiles = pgTable("dole_reporting_profiles", {
  organizationId: integer("organization_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  establishmentAddress: text("establishment_address").notNull().default(""),
  principalBusiness: varchar("principal_business", { length: 240 }).notNull().default(""),
  contactName: varchar("contact_name", { length: 160 }).notNull().default(""),
  contactPosition: varchar("contact_position", { length: 160 }).notNull().default(""),
  contactPhone: varchar("contact_phone", { length: 48 }).notNull().default(""),
  updatedBy: varchar("updated_by", { length: 120 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const doleComplianceSubmissions = pgTable(
  "dole_compliance_submissions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    reportType: varchar("report_type", { length: 48 }).notNull(),
    reportYear: integer("report_year").notNull(),
    reportHash: varchar("report_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("submitted"),
    portalReference: varchar("portal_reference", { length: 160 }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    recordedByUserId: integer("recorded_by_user_id").references(() => users.id, { onDelete: "set null" }),
    recordedByName: varchar("recorded_by_name", { length: 120 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("dole_compliance_submission_snapshot_unique").on(table.organizationId, table.reportType, table.reportYear, table.reportHash),
    index("dole_compliance_submission_year_idx").on(table.organizationId, table.reportYear, table.reportType),
  ],
);

export const payrollMonthClosures = pgTable(
  "payroll_month_closures",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    applicableMonth: varchar("applicable_month", { length: 7 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("certified"),
    snapshotHash: varchar("snapshot_hash", { length: 64 }).notNull(),
    evidenceSnapshot: jsonb("evidence_snapshot").notNull(),
    certifiedByUserId: integer("certified_by_user_id").references(() => users.id, { onDelete: "set null" }),
    certifiedByName: varchar("certified_by_name", { length: 120 }).notNull(),
    certifiedAt: timestamp("certified_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payroll_month_closure_snapshot_unique").on(table.organizationId, table.applicableMonth, table.snapshotHash),
    index("payroll_month_closure_status_idx").on(table.organizationId, table.applicableMonth, table.status),
  ],
);

export const statutoryRemittanceMonthClosures = pgTable(
  "statutory_remittance_month_closures",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    applicableMonth: varchar("applicable_month", { length: 7 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("certified"),
    snapshotHash: varchar("snapshot_hash", { length: 64 }).notNull(),
    certifiedByUserId: integer("certified_by_user_id").references(() => users.id, { onDelete: "set null" }),
    certifiedByName: varchar("certified_by_name", { length: 120 }).notNull(),
    certifiedAt: timestamp("certified_at", { withTimezone: true }).notNull().defaultNow(),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    invalidationReason: varchar("invalidation_reason", { length: 280 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("statutory_remittance_month_closure_snapshot_unique").on(table.organizationId, table.applicableMonth, table.snapshotHash),
    index("statutory_remittance_month_closure_status_idx").on(table.organizationId, table.status),
  ],
);

export const statutoryContributionIssueCases = pgTable(
  "statutory_contribution_issue_cases",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    batchId: integer("batch_id").references(() => statutoryRemittanceBatches.id, { onDelete: "set null" }),
    remittanceMemberId: integer("remittance_member_id").references(() => statutoryRemittanceMembers.id, { onDelete: "set null" }),
    agency: varchar("agency", { length: 24 }).notNull(),
    applicableMonth: varchar("applicable_month", { length: 7 }).notNull(),
    issueType: varchar("issue_type", { length: 48 }).notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    employeeSnapshot: jsonb("employee_snapshot").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("open"),
    reportedByUserId: integer("reported_by_user_id").references(() => users.id, { onDelete: "set null" }),
    reportedByName: varchar("reported_by_name", { length: 120 }).notNull(),
    assignedToUserId: integer("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
    assignedToName: varchar("assigned_to_name", { length: 120 }),
    reviewStartedAt: timestamp("review_started_at", { withTimezone: true }),
    resolutionOutcome: varchar("resolution_outcome", { length: 48 }),
    resolutionNote: varchar("resolution_note", { length: 600 }),
    resolvedByUserId: integer("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    resolvedByName: varchar("resolved_by_name", { length: 120 }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("statutory_contribution_issue_org_status_idx").on(table.organizationId, table.status, table.createdAt),
    index("statutory_contribution_issue_employee_idx").on(table.organizationId, table.employeeId, table.createdAt),
    index("statutory_contribution_issue_member_idx").on(table.organizationId, table.remittanceMemberId),
  ],
);

export const statutoryContributionIssueEvents = pgTable(
  "statutory_contribution_issue_events",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    caseId: integer("case_id").notNull().references(() => statutoryContributionIssueCases.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 32 }).notNull(),
    visibility: varchar("visibility", { length: 24 }).notNull().default("employee"),
    message: varchar("message", { length: 1000 }).notNull(),
    actorUserId: integer("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorName: varchar("actor_name", { length: 120 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("statutory_contribution_issue_event_case_idx").on(table.organizationId, table.caseId, table.createdAt),
    index("statutory_contribution_issue_event_employee_idx").on(table.organizationId, table.employeeId, table.createdAt),
  ],
);

export const complianceActionTasks = pgTable(
  "compliance_action_tasks",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sourceType: varchar("source_type", { length: 48 }).notNull(),
    sourceKey: varchar("source_key", { length: 120 }).notNull(),
    agency: varchar("agency", { length: 24 }),
    applicableMonth: varchar("applicable_month", { length: 7 }),
    severity: varchar("severity", { length: 16 }).notNull(),
    severityChangedAt: timestamp("severity_changed_at", { withTimezone: true }).notNull().defaultNow(),
    escalationEpisode: integer("escalation_episode").notNull().default(1),
    title: varchar("title", { length: 180 }).notNull(),
    detail: varchar("detail", { length: 360 }).notNull(),
    dueDate: date("due_date"),
    status: varchar("status", { length: 24 }).notNull().default("open"),
    assignedToUserId: integer("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
    assignedToName: varchar("assigned_to_name", { length: 120 }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedByUserId: integer("acknowledged_by_user_id").references(() => users.id, { onDelete: "set null" }),
    acknowledgedByName: varchar("acknowledged_by_name", { length: 120 }),
    firstDetectedAt: timestamp("first_detected_at", { withTimezone: true }).notNull().defaultNow(),
    lastDetectedAt: timestamp("last_detected_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("compliance_action_source_unique").on(table.organizationId, table.sourceType, table.sourceKey),
    index("compliance_action_status_idx").on(table.organizationId, table.status, table.severity),
    index("compliance_action_assignee_idx").on(table.organizationId, table.assignedToUserId, table.status),
  ],
);

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

export const governmentLoanRemittanceBatches = pgTable(
  "government_loan_remittance_batches",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    agency: varchar("agency", { length: 16 }).notNull(),
    applicableMonth: varchar("applicable_month", { length: 7 }).notNull(),
    dueDate: date("due_date").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("open"),
    employeeCount: integer("employee_count").notNull().default(0),
    loanCount: integer("loan_count").notNull().default(0),
    expectedTotal: numeric("expected_total", { precision: 14, scale: 2 }).notNull().default("0"),
    amountPaid: numeric("amount_paid", { precision: 14, scale: 2 }),
    paymentReference: varchar("payment_reference", { length: 120 }),
    agencyAcknowledgementReference: varchar("agency_acknowledgement_reference", { length: 120 }),
    paymentVarianceNote: varchar("payment_variance_note", { length: 240 }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paymentRecordedBy: varchar("payment_recorded_by", { length: 120 }),
    snapshotHash: varchar("snapshot_hash", { length: 64 }).notNull(),
    createdBy: varchar("created_by", { length: 120 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("government_loan_remittance_batch_unique").on(table.organizationId, table.agency, table.applicableMonth),
    index("government_loan_remittance_due_idx").on(table.organizationId, table.status, table.dueDate),
  ],
);

export const governmentLoanRemittanceMembers = pgTable(
  "government_loan_remittance_members",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id").notNull().references(() => governmentLoanRemittanceBatches.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    loanId: integer("loan_id").notNull().references(() => employeeLoans.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    employeeNo: varchar("employee_no", { length: 32 }).notNull(),
    loanType: varchar("loan_type", { length: 64 }).notNull(),
    loanReferenceNo: varchar("loan_reference_no", { length: 64 }).notNull(),
    deductedAmount: numeric("deducted_amount", { precision: 12, scale: 2 }).notNull(),
    postingStatus: varchar("posting_status", { length: 24 }).notNull().default("pending"),
    postedAmount: numeric("posted_amount", { precision: 12, scale: 2 }),
    postingReference: varchar("posting_reference", { length: 120 }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    confirmedBy: varchar("confirmed_by", { length: 120 }),
    exceptionNote: text("exception_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("government_loan_remittance_member_unique").on(table.batchId, table.loanId),
    index("government_loan_remittance_member_status_idx").on(table.organizationId, table.postingStatus),
  ],
);

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

export const jobRequisitions = pgTable(
  "job_requisitions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    positionId: integer("position_id").references(() => positions.id, { onDelete: "set null" }),
    title: varchar("title", { length: 160 }).notNull(),
    department: varchar("department", { length: 120 }).notNull(),
    headcount: integer("headcount").notNull().default(1),
    salaryMin: numeric("salary_min", { precision: 12, scale: 2 }),
    salaryMax: numeric("salary_max", { precision: 12, scale: 2 }),
    employmentType: varchar("employment_type", { length: 32 }).notNull().default("Full-time"),
    status: varchar("status", { length: 32 }).notNull().default("open"), // "open", "interviewing", "filled", "cancelled"
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("job_requisitions_position_idx").on(table.organizationId, table.positionId),
    uniqueIndex("job_requisitions_active_position_unique")
      .on(table.positionId)
      .where(sql`${table.positionId} is not null and ${table.status} not in ('filled', 'cancelled')`),
  ],
);

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
  hiredEmployeeId: integer("hired_employee_id").references(() => employees.id, { onDelete: "set null" }),
  hiredByUserId: integer("hired_by_user_id").references(() => users.id, { onDelete: "set null" }),
  hiredAt: timestamp("hired_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("job_applicants_hired_employee_unique")
    .on(table.hiredEmployeeId)
    .where(sql`${table.hiredEmployeeId} is not null`),
]);

export const separationRecords = pgTable("separation_records", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  separationType: varchar("separation_type", { length: 32 }).notNull(), // "resignation", "retirement", "authorized_cause", "just_cause", "end_of_contract"
  noticeDate: date("notice_date").notNull(),
  lastDay: date("last_day").notNull(),
  clearanceStatus: varchar("clearance_status", { length: 32 }).notNull().default("in_progress"),
  itCleared: boolean("it_cleared").notNull().default(false),
  adminCleared: boolean("admin_cleared").notNull().default(false),
  financeCleared: boolean("finance_cleared").notNull().default(false),
  hrCleared: boolean("hr_cleared").notNull().default(false),
  prorated13thMonth: numeric("prorated_13th_month", { precision: 12, scale: 2 }).notNull().default("0"),
  thirteenthEntitlement: numeric("thirteenth_entitlement", { precision: 12, scale: 2 }).notNull().default("0"),
  thirteenthPaidYtd: numeric("thirteenth_paid_ytd", { precision: 12, scale: 2 }).notNull().default("0"),
  basicSalaryEarnedYtd: numeric("basic_salary_earned_ytd", { precision: 14, scale: 2 }).notNull().default("0"),
  historicalBasicSalaryEarned: numeric("historical_basic_salary_earned", { precision: 14, scale: 2 }).notNull().default("0"),
  unpaidBasicSalary: numeric("unpaid_basic_salary", { precision: 12, scale: 2 }).notNull().default("0"),
  unusedLeaveCredits: numeric("unused_leave_credits", { precision: 6, scale: 1 }).notNull().default("0"),
  leaveMonetizationPay: numeric("leave_monetization_pay", { precision: 12, scale: 2 }).notNull().default("0"),
  separationPay: numeric("separation_pay", { precision: 12, scale: 2 }).notNull().default("0"),
  retirementPay: numeric("retirement_pay", { precision: 12, scale: 2 }).notNull().default("0"),
  otherBenefits: numeric("other_benefits", { precision: 12, scale: 2 }).notNull().default("0"),
  taxAdjustment: numeric("tax_adjustment", { precision: 12, scale: 2 }).notNull().default("0"),
  finalStatutoryDeductions: numeric("final_statutory_deductions", { precision: 12, scale: 2 }).notNull().default("0"),
  loanDeductions: numeric("loan_deductions", { precision: 12, scale: 2 }).notNull().default("0"),
  grossFinalPay: numeric("gross_final_pay", { precision: 12, scale: 2 }).notNull().default("0"),
  netFinalPay: numeric("net_final_pay", { precision: 12, scale: 2 }).notNull().default("0"),
  finalPayDueDate: date("final_pay_due_date"),
  computationSnapshot: jsonb("computation_snapshot").notNull().default({}),
  status: varchar("status", { length: 32 }).notNull().default("draft"), // "draft", "approved", "released"
  coeIssued: boolean("coe_issued").notNull().default(false),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  releaseReference: varchar("release_reference", { length: 160 }),
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

/* -------------------------------------------------------------------------- */
/* HCM: performance management                                                */
/* -------------------------------------------------------------------------- */

export const performanceCycles = pgTable(
  "performance_cycles",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("draft"),
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdBy: varchar("created_by", { length: 120 }).notNull().default("System"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("performance_cycles_org_status_idx").on(table.organizationId, table.status),
    uniqueIndex("performance_cycles_org_name_dates_unique").on(table.organizationId, table.name, table.startDate, table.endDate),
  ],
);

export const performanceGoals = pgTable(
  "performance_goals",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    cycleId: integer("cycle_id").references(() => performanceCycles.id, { onDelete: "set null" }),
    title: varchar("title", { length: 180 }).notNull(),
    description: text("description"),
    weight: numeric("weight", { precision: 5, scale: 2 }).notNull().default("0"),
    progress: integer("progress").notNull().default(0),
    status: varchar("status", { length: 24 }).notNull().default("active"),
    dueDate: date("due_date"),
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("performance_goals_org_employee_idx").on(table.organizationId, table.employeeId),
    index("performance_goals_cycle_idx").on(table.cycleId),
  ],
);

export const performanceReviews = pgTable(
  "performance_reviews",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    cycleId: integer("cycle_id").notNull().references(() => performanceCycles.id, { onDelete: "cascade" }),
    reviewerUserId: integer("reviewer_user_id").references(() => users.id, { onDelete: "set null" }),
    status: varchar("status", { length: 24 }).notNull().default("draft"),
    selfScore: numeric("self_score", { precision: 4, scale: 2 }),
    managerScore: numeric("manager_score", { precision: 4, scale: 2 }),
    finalScore: numeric("final_score", { precision: 4, scale: 2 }),
    employeeReflection: text("employee_reflection"),
    managerSummary: text("manager_summary"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("performance_reviews_cycle_employee_unique").on(table.cycleId, table.employeeId),
    index("performance_reviews_org_employee_idx").on(table.organizationId, table.employeeId),
  ],
);

/* -------------------------------------------------------------------------- */
/* HCM: job architecture and position planning                                */
/* -------------------------------------------------------------------------- */

export const jobProfiles = pgTable(
  "job_profiles",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 160 }).notNull(),
    family: varchar("family", { length: 120 }).notNull().default("General"),
    level: varchar("level", { length: 80 }).notNull().default("Individual Contributor"),
    grade: varchar("grade", { length: 40 }),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("job_profiles_org_title_level_unique").on(table.organizationId, table.title, table.level),
    index("job_profiles_org_active_idx").on(table.organizationId, table.active),
  ],
);

export const workforcePlans = pgTable(
  "workforce_plans",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    budget: numeric("budget", { precision: 14, scale: 2 }).notNull().default("0"),
    status: varchar("status", { length: 24 }).notNull().default("draft"),
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdBy: varchar("created_by", { length: 120 }).notNull().default("System"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workforce_plans_org_name_dates_unique").on(table.organizationId, table.name, table.startDate, table.endDate),
    index("workforce_plans_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const workforcePlanningScenarios = pgTable(
  "workforce_planning_scenarios",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    planId: integer("plan_id").references(() => workforcePlans.id, { onDelete: "set null" }),
    name: varchar("name", { length: 160 }).notNull(),
    version: integer("version").notNull().default(1),
    scopeOrgUnitId: integer("scope_org_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
    worksiteId: integer("worksite_id").references(() => worksites.id, { onDelete: "set null" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    demandGrowthPercent: numeric("demand_growth_percent", { precision: 7, scale: 2 }).notNull().default("0"),
    vacancyFillPercent: numeric("vacancy_fill_percent", { precision: 7, scale: 2 }).notNull().default("100"),
    employerLoadPercent: numeric("employer_load_percent", { precision: 7, scale: 2 }).notNull().default("0"),
    status: varchar("status", { length: 24 }).notNull().default("draft"),
    snapshot: jsonb("snapshot").notNull().default({}),
    snapshotHash: varchar("snapshot_hash", { length: 64 }).notNull(),
    createdByUserId: integer("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    submittedByUserId: integer("submitted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    decidedByUserId: integer("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: varchar("decision_note", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workforce_scenarios_org_name_version_unique").on(table.organizationId, table.name, table.version),
    index("workforce_scenarios_org_status_idx").on(table.organizationId, table.status),
    index("workforce_scenarios_org_unit_idx").on(table.organizationId, table.scopeOrgUnitId),
    index("workforce_scenarios_plan_idx").on(table.planId),
  ],
);

export const positions = pgTable(
  "positions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 48 }).notNull(),
    jobProfileId: integer("job_profile_id").notNull().references(() => jobProfiles.id, { onDelete: "restrict" }),
    orgUnitId: integer("org_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
    planId: integer("plan_id").references(() => workforcePlans.id, { onDelete: "set null" }),
    managerEmployeeId: integer("manager_employee_id").references(() => employees.id, { onDelete: "set null" }),
    employmentType: varchar("employment_type", { length: 32 }).notNull().default("Regular"),
    status: varchar("status", { length: 24 }).notNull().default("planned"),
    plannedStartDate: date("planned_start_date"),
    annualBudget: numeric("annual_budget", { precision: 14, scale: 2 }).notNull().default("0"),
    notes: text("notes"),
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("positions_org_code_unique").on(table.organizationId, table.code),
    index("positions_org_status_idx").on(table.organizationId, table.status),
    index("positions_org_unit_idx").on(table.organizationId, table.orgUnitId),
    index("positions_plan_idx").on(table.planId),
  ],
);

export const positionAssignments = pgTable(
  "position_assignments",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    positionId: integer("position_id").notNull().references(() => positions.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    effectiveFrom: date("effective_from").notNull(),
    effectiveUntil: date("effective_until"),
    reason: varchar("reason", { length: 240 }).notNull().default("Position assignment"),
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("position_assignments_position_from_unique").on(table.positionId, table.effectiveFrom),
    uniqueIndex("position_assignments_active_position_unique")
      .on(table.positionId)
      .where(sql`${table.effectiveUntil} is null`),
    index("position_assignments_employee_idx").on(table.organizationId, table.employeeId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Enterprise identity, permissions, session policy, and workflow automation   */
/* -------------------------------------------------------------------------- */

export const organizationSecurityPolicies = pgTable(
  "organization_security_policies",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().unique().references(() => organizations.id, { onDelete: "cascade" }),
    sessionIdleMinutes: integer("session_idle_minutes").notNull().default(1440),
    sessionMaxHours: integer("session_max_hours").notNull().default(336),
    maxActiveSessions: integer("max_active_sessions").notNull().default(10),
    requireMfa: boolean("require_mfa").notNull().default(false),
    ssoMode: varchar("sso_mode", { length: 24 }).notNull().default("optional"),
    updatedByUserId: integer("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("organization_security_policies_org_idx").on(table.organizationId)],
);

export const identityProviders = pgTable(
  "identity_providers",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    protocol: varchar("protocol", { length: 24 }).notNull().default("oidc"),
    issuer: text("issuer").notNull(),
    clientId: varchar("client_id", { length: 240 }).notNull(),
    clientSecretEncrypted: text("client_secret_encrypted").notNull(),
    authorizationEndpoint: text("authorization_endpoint").notNull(),
    tokenEndpoint: text("token_endpoint").notNull(),
    jwksUri: text("jwks_uri").notNull(),
    scopes: varchar("scopes", { length: 240 }).notNull().default("openid email profile"),
    emailClaim: varchar("email_claim", { length: 80 }).notNull().default("email"),
    enabled: boolean("enabled").notNull().default(false),
    discoveryVerifiedAt: timestamp("discovery_verified_at", { withTimezone: true }),
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("identity_providers_org_name_unique").on(table.organizationId, table.name),
    index("identity_providers_org_enabled_idx").on(table.organizationId, table.enabled),
  ],
);

export const identityDomains = pgTable(
  "identity_domains",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    providerId: integer("provider_id").notNull().references(() => identityProviders.id, { onDelete: "cascade" }),
    domain: varchar("domain", { length: 180 }).notNull(),
    verificationTokenHash: text("verification_token_hash").notNull(),
    verified: boolean("verified").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("identity_domains_domain_unique").on(table.domain),
    index("identity_domains_org_provider_idx").on(table.organizationId, table.providerId),
  ],
);

export const externalIdentities = pgTable(
  "external_identities",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    providerId: integer("provider_id").notNull().references(() => identityProviders.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    subject: varchar("subject", { length: 240 }).notNull(),
    email: varchar("email", { length: 180 }).notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("external_identities_provider_subject_unique").on(table.providerId, table.subject),
    uniqueIndex("external_identities_provider_user_unique").on(table.providerId, table.userId),
  ],
);

export const oidcLoginStates = pgTable(
  "oidc_login_states",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id").notNull().references(() => identityProviders.id, { onDelete: "cascade" }),
    stateHash: text("state_hash").notNull().unique(),
    nonce: varchar("nonce", { length: 180 }).notNull(),
    codeVerifier: text("code_verifier").notNull(),
    loginHint: varchar("login_hint", { length: 180 }),
    redirectUri: text("redirect_uri").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("oidc_login_states_provider_expiry_idx").on(table.providerId, table.expiresAt)],
);

export const scimTokens = pgTable(
  "scim_tokens",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    prefix: varchar("prefix", { length: 20 }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("scim_tokens_org_idx").on(table.organizationId)],
);

export const scimIdentities = pgTable(
  "scim_identities",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    externalId: varchar("external_id", { length: 240 }).notNull(),
    active: boolean("active").notNull().default(true),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("scim_identities_org_external_unique").on(table.organizationId, table.externalId),
    uniqueIndex("scim_identities_org_user_unique").on(table.organizationId, table.userId),
  ],
);

export const permissionSets = pgTable(
  "permission_sets",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    permissions: jsonb("permissions").notNull().default([]),
    active: boolean("active").notNull().default(true),
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("permission_sets_org_name_unique").on(table.organizationId, table.name)],
);

export const userPermissionAssignments = pgTable(
  "user_permission_assignments",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userOrganizationId: integer("user_organization_id").notNull().references(() => userOrganizations.id, { onDelete: "cascade" }),
    permissionSetId: integer("permission_set_id").notNull().references(() => permissionSets.id, { onDelete: "cascade" }),
    assignedByUserId: integer("assigned_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_permission_assignments_membership_unique").on(table.userOrganizationId),
    index("user_permission_assignments_org_idx").on(table.organizationId),
  ],
);

export const automationRules = pgTable(
  "automation_rules",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    trigger: varchar("trigger", { length: 64 }).notNull(),
    conditions: jsonb("conditions").notNull().default({}),
    actions: jsonb("actions").notNull().default([]),
    active: boolean("active").notNull().default(true),
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("automation_rules_org_name_unique").on(table.organizationId, table.name),
    index("automation_rules_org_trigger_idx").on(table.organizationId, table.trigger),
  ],
);

export const automationExecutions = pgTable(
  "automation_executions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    ruleId: integer("rule_id").notNull().references(() => automationRules.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").references(() => employees.id, { onDelete: "set null" }),
    trigger: varchar("trigger", { length: 64 }).notNull(),
    eventKey: varchar("event_key", { length: 240 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("completed"),
    result: jsonb("result").notNull().default({}),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("automation_executions_rule_event_unique").on(table.ruleId, table.eventKey),
    index("automation_executions_org_created_idx").on(table.organizationId, table.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* HCM: compensation governance                                               */
/* -------------------------------------------------------------------------- */

export const compensationBands = pgTable(
  "compensation_bands",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    jobProfileId: integer("job_profile_id").notNull().references(() => jobProfiles.id, { onDelete: "restrict" }),
    locationCode: varchar("location_code", { length: 80 }).notNull().default("PH"),
    currency: varchar("currency", { length: 8 }).notNull().default("PHP"),
    minimumAnnual: numeric("minimum_annual", { precision: 14, scale: 2 }).notNull(),
    midpointAnnual: numeric("midpoint_annual", { precision: 14, scale: 2 }).notNull(),
    maximumAnnual: numeric("maximum_annual", { precision: 14, scale: 2 }).notNull(),
    active: boolean("active").notNull().default(true),
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("compensation_bands_org_profile_location_unique").on(table.organizationId, table.jobProfileId, table.locationCode),
    index("compensation_bands_org_active_idx").on(table.organizationId, table.active),
  ],
);

export const compensationCycles = pgTable(
  "compensation_cycles",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    effectiveDate: date("effective_date").notNull(),
    budgetPool: numeric("budget_pool", { precision: 14, scale: 2 }).notNull().default("0"),
    status: varchar("status", { length: 24 }).notNull().default("draft"),
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdBy: varchar("created_by", { length: 120 }).notNull().default("System"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("compensation_cycles_org_name_dates_unique").on(table.organizationId, table.name, table.startDate, table.endDate),
    index("compensation_cycles_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const compensationProposals = pgTable(
  "compensation_proposals",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    cycleId: integer("cycle_id").notNull().references(() => compensationCycles.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    bandId: integer("band_id").notNull().references(() => compensationBands.id, { onDelete: "restrict" }),
    currentAnnual: numeric("current_annual", { precision: 14, scale: 2 }).notNull(),
    proposedAnnual: numeric("proposed_annual", { precision: 14, scale: 2 }).notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("proposed"),
    submittedByUserId: integer("submitted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    approvedByUserId: integer("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    appliedPayRevisionId: integer("applied_pay_revision_id").references(() => employeePayRevisions.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("compensation_proposals_cycle_employee_unique").on(table.cycleId, table.employeeId),
    index("compensation_proposals_org_status_idx").on(table.organizationId, table.status),
  ],
);
