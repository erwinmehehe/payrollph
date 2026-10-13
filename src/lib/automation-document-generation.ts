import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  documents,
  employees,
  legalEntities,
  organizations,
  orgUnits,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { documentObjectKey, putDocumentObject, deleteDocumentObject } from "@/lib/document-object-storage";
import { compatibleDocumentColumns, legacyDocumentInsertTable } from "@/lib/document-schema-compat";
import {
  getAutomationDocumentTemplate,
  type AutomationDocumentSnapshot,
  type AutomationDocumentTrigger,
} from "@/lib/automation-document-templates";

export class AutomationDocumentGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationDocumentGenerationError";
  }
}

function textValue(value: unknown) {
  if (value == null) return null;
  const cleaned = String(value).replace(/[\r\n\t]+/g, " ").trim();
  return cleaned || null;
}

function integerValue(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function safeFilePart(value: string) {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "document";
}

export async function generateAutomationEmployeeDocument(input: {
  organizationId: number;
  employeeId: number;
  trigger: AutomationDocumentTrigger;
  templateId: string;
  sourceKey: string;
  context?: Record<string, unknown>;
  actor?: string;
  // Server-only injected adapter for disposable PostgreSQL + fake S3 tests.
  // Never populated from an HTTP request.
  objectStore?: {
    put: (key: string, bytes: Uint8Array, mime: string) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };
}) {
  const template = getAutomationDocumentTemplate(input.templateId);
  if (!template) {
    throw new AutomationDocumentGenerationError("Generated-document template not found.");
  }
  if (!template.allowedTriggers.includes(input.trigger)) {
    throw new AutomationDocumentGenerationError(
      "This generated-document template is not approved for the triggering event.",
    );
  }

  const sourceKey = input.sourceKey.trim().slice(0, 160);
  if (!sourceKey) throw new AutomationDocumentGenerationError("A stable document generation source key is required.");

  const [existing] = await db.select(compatibleDocumentColumns).from(documents).where(and(
    eq(documents.organizationId, input.organizationId),
    eq(documents.sourceKey, sourceKey),
  )).limit(1);
  if (existing) {
    if (
      existing.sourceType !== "generated"
      || existing.employeeId !== input.employeeId
    ) {
      throw new AutomationDocumentGenerationError(
        "The generated-document source key is already bound to a different document.",
      );
    }
    return { document: existing, idempotent: true, auditWarning: null as string | null };
  }

  const [employee, organization] = await Promise.all([
    db.select().from(employees).where(and(
      eq(employees.id, input.employeeId),
      eq(employees.organizationId, input.organizationId),
    )).limit(1).then((rows) => rows[0] ?? null),
    db.select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);
  if (!employee) throw new AutomationDocumentGenerationError("Employee not found in this organization.");
  if (!organization) throw new AutomationDocumentGenerationError("Organization not found.");

  const [unit, legalEntity] = await Promise.all([
    employee.orgUnitId
      ? db.select({ id: orgUnits.id, name: orgUnits.name })
          .from(orgUnits)
          .where(and(
            eq(orgUnits.id, employee.orgUnitId),
            eq(orgUnits.organizationId, input.organizationId),
          ))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    employee.legalEntityId
      ? db.select({
          id: legalEntities.id,
          code: legalEntities.code,
          displayName: legalEntities.displayName,
        }).from(legalEntities)
          .where(and(
            eq(legalEntities.id, employee.legalEntityId),
            eq(legalEntities.organizationId, input.organizationId),
          ))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  const context = input.context ?? {};
  const snapshot: AutomationDocumentSnapshot = {
    generatedAt: new Date().toISOString(),
    organizationName: organization.name,
    legalEntityName: legalEntity?.displayName ?? null,
    legalEntityCode: legalEntity?.code ?? null,
    employeeId: employee.id,
    employeeNo: employee.employeeNo,
    employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
    employeeEmail: employee.email,
    employeeTitle: employee.title,
    employmentType: employee.employmentType,
    employeeStatus: employee.status,
    employeeStartDate: String(employee.startDate),
    department: unit?.name ?? null,
    trigger: input.trigger,
    effectiveDate: textValue(context.effectiveDate),
    movementType: textValue(context.movementType),
    previousOrgUnitId: integerValue(context.previousOrgUnitId),
    previousPositionId: integerValue(context.previousPositionId),
    positionId: integerValue(context.positionId),
    positionCode: textValue(context.positionCode),
    managerName: textValue(context.managerName),
  };

  const rendered = template.render(snapshot).replace(/\r\n/g, "\n").trimEnd() + "\n";
  if (rendered.length < 40 || rendered.length > 200_000) {
    throw new AutomationDocumentGenerationError("Generated document content is outside the allowed size.");
  }

  const bytes = Buffer.from(rendered, "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sourceDigest = createHash("sha256").update(sourceKey, "utf8").digest("hex").slice(0, 12);
  const fileName = `${safeFilePart(employee.employeeNo)}-${safeFilePart(template.id)}-${sourceDigest}.txt`;
  const metadata = {
    templateId: template.id,
    templateVersion: template.version,
    trigger: input.trigger,
    employeeId: employee.id,
    effectiveDate: snapshot.effectiveDate,
    generatedAt: snapshot.generatedAt,
  };

  const vaultEnabled = criticalReleaseFlagEnabled("employeeDocumentVault");
  const storageKey = vaultEnabled ? documentObjectKey(input.organizationId, employee.id) : null;
  if (storageKey) {
    try {
      await (input.objectStore?.put ?? putDocumentObject)(
        storageKey, bytes, "text/plain; charset=utf-8",
      );
    } catch {
      throw new AutomationDocumentGenerationError("Private generated-document storage is unavailable.");
    }
  }
  // Retain sourceKey idempotency under concurrent generation. Any orphan
  // object written before a rejected SQL insert is cleaned up best-effort.
  let createdId: number | null = null;
  try {
    const docValues = {

    organizationId: input.organizationId,
    employeeId: employee.id,
    kind: template.kind,
    fileName,
    mimeType: "text/plain; charset=utf-8",
    byteSize: bytes.byteLength,
    sha256,
    scannedClean: true,
    scanNote: "System-generated by PayrollPH from a governed template; no uploaded bytes were accepted.",
    sourceType: "generated",
    sourceKey,
    generationMetadata: metadata,
    uploadedBy: input.actor ?? "Automation Studio",
    content: vaultEnabled ? "" : bytes.toString("base64"),
    };
    const [created] = storageKey
      ? await db.insert(documents).values({ ...docValues, objectStorageKey: storageKey })
          .onConflictDoNothing().returning({ id: documents.id })
      : await db.insert(legacyDocumentInsertTable).values(docValues)
          .onConflictDoNothing().returning({ id: legacyDocumentInsertTable.id });
    createdId = created?.id ?? null;
  } catch (error) {
    if (storageKey) {
      await (input.objectStore?.delete ?? deleteDocumentObject)(storageKey).catch(() => {});
    }
    throw error;
  }
  if (storageKey && createdId === null) {
    await (input.objectStore?.delete ?? deleteDocumentObject)(storageKey).catch(() => {});
  }

  const document = (await db.select(compatibleDocumentColumns).from(documents).where(and(
    eq(documents.organizationId, input.organizationId),
    eq(documents.sourceKey, sourceKey),
  )).limit(1))[0];

  if (!document) {
    throw new AutomationDocumentGenerationError("Generated document could not be persisted.");
  }
  if (
    document.sourceType !== "generated"
    || document.employeeId !== input.employeeId
    || document.sha256 !== sha256
  ) {
    throw new AutomationDocumentGenerationError(
      "Generated-document idempotency conflict detected; no replacement was performed.",
    );
  }

  let auditWarning: string | null = null;
  if (createdId !== null) {
    try {
      await recordAuditEvent({
        organizationId: input.organizationId,
        actor: input.actor ?? "Automation Studio",
        action: "Employee document generated by governed automation",
        resource: fileName,
        metadata: {
          documentId: document.id,
          employeeId: employee.id,
          templateId: template.id,
          templateVersion: template.version,
          trigger: input.trigger,
          sourceKey,
          sha256,
        },
      });
    } catch (error) {
      auditWarning = error instanceof Error ? error.message.slice(0, 1000) : "Audit recording failed.";
    }
  }

  return { document, idempotent: createdId === null, auditWarning };
}
