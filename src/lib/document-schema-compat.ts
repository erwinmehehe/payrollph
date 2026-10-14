import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import {
  boolean, integer, jsonb, pgTable, serial, text, timestamp, varchar,
} from "drizzle-orm/pg-core";

/** Independent Drizzle mapping with ONLY pre-A5 physical columns.
 * Drizzle INSERT emits columns for the table mapping even when values omit
 * them; using the expanded A-5 mapping with flag OFF breaks old-schema writes.
 * No new fields, constraints or schema writes are activated by this mapping.
 */
export const legacyDocumentInsertTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  employeeId: integer("employee_id"),
  kind: varchar("kind", { length: 40 }).notNull(),
  fileName: varchar("file_name", { length: 200 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  byteSize: integer("byte_size").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  scannedClean: boolean("scanned_clean").notNull().default(false),
  scanNote: varchar("scan_note", { length: 200 }).notNull().default(""),
  sourceType: varchar("source_type", { length: 24 }).notNull().default("upload"),
  sourceKey: varchar("source_key", { length: 160 }),
  generationMetadata: jsonb("generation_metadata").notNull().default({}),
  uploadedBy: varchar("uploaded_by", { length: 120 }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});


/** Compatibility with legacy documents rows before A-5 columns exist.
 * Missing JSON keys are NULL; existing private-object keys still protect
 * data during flag rollback. No schema mutations or vault activation.
 */
export const compatibleDocumentColumns = {
  id: documents.id,
  organizationId: documents.organizationId,
  employeeId: documents.employeeId,
  kind: documents.kind,
  fileName: documents.fileName,
  mimeType: documents.mimeType,
  byteSize: documents.byteSize,
  sha256: documents.sha256,
  scannedClean: documents.scannedClean,
  scanNote: documents.scanNote,
  sourceType: documents.sourceType,
  sourceKey: documents.sourceKey,
  generationMetadata: documents.generationMetadata,
  uploadedBy: documents.uploadedBy,
  uploadedByUserId: sql<number | null>`(to_jsonb(${documents})->>'uploaded_by_user_id')::integer`,
  objectStorageKey: sql<string | null>`to_jsonb(${documents})->>'object_storage_key'`,
  content: documents.content,
  createdAt: documents.createdAt,
};

/** Only legacy rows remain visible to non-HR People roles when A-5 is off. */
export const legacyVisibleDocumentWhere =
  sql`(to_jsonb(${documents})->>'object_storage_key') IS NULL`;

/**
 * A-5 rollback boundary: legacy HCM actions may verify or waive only a
 * legacy employee file when the private vault is OFF. Query the physical
 * document row using the pre-A5-compatible JSON projection so old production
 * schemas without object_storage_key still work. Private objects remain
 * governed by the independent maker/checker path after a separate rollout.
 *
 * Return false on missing, foreign-employer, foreign-employee or object-backed
 * evidence. Do not pass a guessed documentId from a request without checking
 * employer and employee identity.
 */
export async function canMutateLegacyHcmDocument(input: {
  organizationId: number;
  employeeId: number;
  documentId: number;
}): Promise<boolean> {
  if ([input.organizationId, input.employeeId, input.documentId].some(
    value => !Number.isSafeInteger(value) || value <= 0,
  )) return false;
  const [row] = await db.select({ id: documents.id }).from(documents).where(and(
    eq(documents.id, input.documentId),
    eq(documents.organizationId, input.organizationId),
    eq(documents.employeeId, input.employeeId),
    legacyVisibleDocumentWhere,
  )).limit(1);
  return Boolean(row);
}
