import { index, integer, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { employees, organizations, users } from "../db/schema";

/** Photos are separate from employee directory records to avoid bulk-reading portraits. */
export const essEmployeePhotos = pgTable("ess_employee_photos", {
  employeeId: integer("employee_id").primaryKey().references(() => employees.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  mimeType: varchar("mime_type", { length: 24 }).notNull(),
  byteSize: integer("byte_size").notNull(),
  sealedPhoto: text("sealed_photo").notNull(),
  contentSha256: varchar("content_sha256", { length: 64 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("ess_employee_photos_org_idx").on(table.organizationId)]);

/** Values supplied by employees do not become authoritative until HR reviews. */
export const essIdentifierRequests = pgTable("ess_identifier_requests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 32 }).notNull(),
  proposedEncrypted: varchar("proposed_encrypted", { length: 256 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  requestedByUserId: integer("requested_by_user_id").notNull().references(() => users.id),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),
}, (table) => [
  index("ess_identifier_requests_employee_idx").on(table.employeeId, table.requestedAt),
  index("ess_identifier_requests_org_status_idx").on(table.organizationId, table.status, table.requestedAt),
]);

/** Optional credentials are not part of payroll or statutory calculation inputs. */
export const essOtherIdentifiers = pgTable("ess_other_identifiers", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 32 }).notNull(),
  encryptedValue: varchar("encrypted_value", { length: 256 }).notNull(),
  verifiedByUserId: integer("verified_by_user_id").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ess_other_identifiers_unique").on(table.employeeId, table.kind),
  index("ess_other_identifiers_org_idx").on(table.organizationId),
]);
