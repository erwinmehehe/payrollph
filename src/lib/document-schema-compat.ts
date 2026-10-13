import { sql } from "drizzle-orm";
import { documents } from "@/db/schema";

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
