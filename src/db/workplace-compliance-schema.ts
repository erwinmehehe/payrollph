import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, pgTable, serial, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { employees, legalEntities, organizations, users } from "@/db/schema";

/** Additive, default-off Philippine workplace compliance pilot tables. */
export const doleExtendedReports = pgTable("dole_extended_reports", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  legalEntityId: integer("legal_entity_id").notNull(),
  reportType: varchar("report_type", { length: 40 }).notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  statutoryBasisUrl: varchar("statutory_basis_url", { length: 350 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("draft"),
  portalReference: varchar("portal_reference", { length: 160 }),
  receiptSha256: varchar("receipt_sha256", { length: 64 }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  recordedByUserId: integer("recorded_by_user_id").notNull().references(() => users.id),
  outcomeRecordedByUserId: integer("outcome_recorded_by_user_id").references(() => users.id),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  foreignKey({
    name: "dole_extended_reports_entity_tenant_fk",
    columns: [table.organizationId, table.legalEntityId],
    foreignColumns: [legalEntities.organizationId, legalEntities.id],
  }).onDelete("restrict"),
  index("dole_extended_reports_employer_period_idx").on(table.organizationId, table.legalEntityId, table.periodStart),
  check("dole_extended_reports_dates_ck", sql.raw('"period_end" >= "period_start"')),
  check("dole_extended_reports_status_ck", sql.raw('"status" in (\'draft\',\'submitted_recorded\',\'accepted_recorded\',\'rejected_recorded\',\'independently_reviewed\')')),
]);

export const oshSafetyEvents = pgTable("osh_safety_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  legalEntityId: integer("legal_entity_id").notNull(),
  worksiteLabel: varchar("worksite_label", { length: 120 }).notNull(),
  occurredOn: date("occurred_on").notNull(),
  eventKind: varchar("event_kind", { length: 32 }).notNull(),
  severity: varchar("severity", { length: 16 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  evidenceSha256: varchar("evidence_sha256", { length: 64 }),
  correctiveActionRef: varchar("corrective_action_ref", { length: 160 }),
  actionOwnerUserId: integer("action_owner_user_id").references(() => users.id),
  recordedByUserId: integer("recorded_by_user_id").notNull().references(() => users.id),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  foreignKey({
    name: "osh_safety_events_entity_tenant_fk",
    columns: [table.organizationId, table.legalEntityId],
    foreignColumns: [legalEntities.organizationId, legalEntities.id],
  }).onDelete("restrict"),
  index("osh_safety_events_scope_date_idx").on(table.organizationId, table.legalEntityId, table.occurredOn),
  check("osh_safety_events_kind_ck", sql.raw('"event_kind" in (\'hazard\',\'near_miss\',\'injury\',\'illness\',\'other\')')),
  check("osh_safety_events_severity_ck", sql.raw('"severity" in (\'low\',\'moderate\',\'high\',\'critical\')')),
  check("osh_safety_events_status_ck", sql.raw('"status" in (\'open\',\'mitigating\',\'resolved\')')),
]);

export const oshTrainingRecords = pgTable("osh_training_records", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  legalEntityId: integer("legal_entity_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  topic: varchar("topic", { length: 48 }).notNull(),
  courseTitle: varchar("course_title", { length: 160 }).notNull(),
  providerName: varchar("provider_name", { length: 120 }),
  completedOn: date("completed_on").notNull(),
  expiresOn: date("expires_on"),
  evidenceSha256: varchar("evidence_sha256", { length: 64 }),
  requirementSource: varchar("requirement_source", { length: 350 }),
  recordedByUserId: integer("recorded_by_user_id").notNull().references(() => users.id),
  verifiedByUserId: integer("verified_by_user_id").references(() => users.id),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  foreignKey({
    name: "osh_training_entity_tenant_fk",
    columns: [table.organizationId, table.legalEntityId],
    foreignColumns: [legalEntities.organizationId, legalEntities.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "osh_training_employee_tenant_fk",
    columns: [table.organizationId, table.employeeId],
    foreignColumns: [employees.organizationId, employees.id],
  }).onDelete("restrict"),
  index("osh_training_records_employee_idx").on(table.organizationId, table.legalEntityId, table.employeeId, table.completedOn),
  check("osh_training_records_topic_ck", sql.raw('"topic" in (\'osh_orientation\',\'fire_safety\',\'first_aid\',\'harassment_prevention\',\'other\')')),
  check("osh_training_records_dates_ck", sql.raw('"expires_on" is null or "expires_on" >= "completed_on"')),
]);

/** Named and reviewable case officers; not an automatic CODI roster. */
export const workplaceCaseOfficers = pgTable("workplace_case_officers", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  legalEntityId: integer("legal_entity_id").notNull(),
  userId: integer("user_id").notNull().references(() => users.id),
  active: boolean("active").notNull().default(true),
  appointedByUserId: integer("appointed_by_user_id").notNull().references(() => users.id),
  appointedAt: timestamp("appointed_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, table => [
  foreignKey({
    name: "workplace_case_officers_entity_tenant_fk",
    columns: [table.organizationId, table.legalEntityId],
    foreignColumns: [legalEntities.organizationId, legalEntities.id],
  }).onDelete("restrict"),
  unique("workplace_case_officers_scope_user_uk").on(table.organizationId, table.legalEntityId, table.userId),
  index("workplace_case_officers_scope_active_idx").on(table.organizationId, table.legalEntityId, table.active),
]);

/** Statements are AES-GCM encrypted; only creator and named reviewers can read. */
export const workplaceProtectedCases = pgTable("workplace_protected_cases", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  legalEntityId: integer("legal_entity_id").notNull(),
  caseKind: varchar("case_kind", { length: 36 }).notNull(),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  reporterEmployeeId: integer("reporter_employee_id"),
  investigatorUserId: integer("investigator_user_id").notNull(),
  reviewerUserId: integer("reviewer_user_id"),
  sealedStatement: text("sealed_statement").notNull(),
  status: varchar("status", { length: 24 }).notNull().default("intake"),
  incidentOn: date("incident_on"),
  externalEvidenceSha256: varchar("external_evidence_sha256", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  foreignKey({
    name: "workplace_protected_cases_entity_tenant_fk",
    columns: [table.organizationId, table.legalEntityId],
    foreignColumns: [legalEntities.organizationId, legalEntities.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "workplace_protected_cases_employee_tenant_fk",
    columns: [table.organizationId, table.reporterEmployeeId],
    foreignColumns: [employees.organizationId, employees.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "workplace_protected_cases_investigator_fk",
    columns: [table.organizationId, table.legalEntityId, table.investigatorUserId],
    foreignColumns: [workplaceCaseOfficers.organizationId, workplaceCaseOfficers.legalEntityId, workplaceCaseOfficers.userId],
  }).onDelete("restrict"),
  foreignKey({
    name: "workplace_protected_cases_reviewer_fk",
    columns: [table.organizationId, table.legalEntityId, table.reviewerUserId],
    foreignColumns: [workplaceCaseOfficers.organizationId, workplaceCaseOfficers.legalEntityId, workplaceCaseOfficers.userId],
  }).onDelete("restrict"),
  unique("workplace_cases_scope_id_uk").on(table.organizationId, table.legalEntityId, table.id),
  index("workplace_cases_investigator_idx").on(table.organizationId, table.legalEntityId, table.investigatorUserId, table.status),
  index("workplace_cases_creator_idx").on(table.organizationId, table.legalEntityId, table.createdByUserId),
  check("workplace_cases_kind_ck", sql.raw('"case_kind" in (\'gender_based_harassment\',\'other_harassment\',\'retaliation\',\'other\')')),
  check("workplace_cases_status_ck", sql.raw('"status" in (\'intake\',\'investigating\',\'review_pending\',\'closed\')')),
  check("workplace_cases_independent_review_ck", sql.raw('"reviewer_user_id" is null or "reviewer_user_id" <> "investigator_user_id"')),
]);

/** Restricted actor trail. Never expose through generic tenant audit exports or return complaint text. */
export const workplaceCaseAuditTrail = pgTable("workplace_case_audit_trail", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  legalEntityId: integer("legal_entity_id").notNull(),
  caseId: integer("case_id").notNull(),
  actorUserId: integer("actor_user_id").notNull().references(() => users.id),
  action: varchar("action", { length: 40 }).notNull(),
  previousStatus: varchar("previous_status", { length: 24 }),
  nextStatus: varchar("next_status", { length: 24 }),
  previousOfficerUserId: integer("previous_officer_user_id"),
  replacementOfficerUserId: integer("replacement_officer_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  foreignKey({
    name: "workplace_case_audit_scope_fk",
    columns: [table.organizationId, table.legalEntityId, table.caseId],
    foreignColumns: [workplaceProtectedCases.organizationId, workplaceProtectedCases.legalEntityId, workplaceProtectedCases.id],
  }).onDelete("restrict"),
  index("workplace_case_audit_scope_created_idx").on(table.organizationId, table.legalEntityId, table.caseId, table.createdAt),
  check("workplace_case_audit_action_ck", sql.raw('"action" in (\'intake\',\'reviewer_assigned\',\'status_changed\',\'reassignment_requested\',\'reassignment_approved\',\'reassignment_rejected\')')),
]);

/** Two-person human review before any investigator/reviewer transfer. */
export const workplaceCaseReassignmentRequests = pgTable("workplace_case_reassignment_requests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  legalEntityId: integer("legal_entity_id").notNull(),
  caseId: integer("case_id").notNull(),
  officerRole: varchar("officer_role", { length: 20 }).notNull(),
  previousOfficerUserId: integer("previous_officer_user_id").notNull().references(() => users.id),
  replacementOfficerUserId: integer("replacement_officer_user_id").notNull().references(() => users.id),
  requestedByUserId: integer("requested_by_user_id").notNull().references(() => users.id),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
}, table => [
  foreignKey({
    name: "workplace_case_reassignment_scope_fk",
    columns: [table.organizationId, table.legalEntityId, table.caseId],
    foreignColumns: [workplaceProtectedCases.organizationId, workplaceProtectedCases.legalEntityId, workplaceProtectedCases.id],
  }).onDelete("restrict"),
  uniqueIndex("workplace_case_reassignment_one_pending_uk")
    .on(table.caseId, table.officerRole).where(sql`${table.status} = 'pending'`),
  index("workplace_case_reassignment_scope_idx").on(table.organizationId, table.legalEntityId, table.status),
  check("workplace_case_reassignment_role_ck", sql.raw('"officer_role" in (\'investigator\',\'reviewer\')')),
  check("workplace_case_reassignment_status_ck", sql.raw('"status" in (\'pending\',\'approved\',\'rejected\')')),
  check("workplace_case_reassignment_signer_ck", sql.raw('("status" = \'pending\' and "approved_by_user_id" is null and "approved_at" is null) or ("status" <> \'pending\' and "approved_by_user_id" is not null and "approved_at" is not null and "requested_by_user_id" <> "approved_by_user_id")')),
]);
