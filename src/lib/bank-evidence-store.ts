import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bankFileValidations, payrollRuns } from "@/db/schema";
import { generateBankFile } from "@/lib/exporters";

export type BankFileValidationRow = typeof bankFileValidations.$inferSelect;

export function bankFileSha256(body: string | Uint8Array) {
  return createHash("sha256").update(body).digest("hex");
}

export async function recordGeneratedBankFile(input: {
  organizationId: number;
  runId: number;
  templateName: string;
  actor: string;
}) {
  const [run] = await db.select().from(payrollRuns).where(and(
    eq(payrollRuns.id, input.runId),
    eq(payrollRuns.organizationId, input.organizationId),
  )).limit(1);
  if (!run) throw new Error("Payroll run not found in this workspace.");
  if (run.status !== "Released") {
    throw new Error("Bank validation evidence can be created only from a released payroll run.");
  }

  const file = await generateBankFile(run.id, input.templateName, false);
  const fileSha256 = bankFileSha256(file.body);
  const templateVersion = String(file.validation.version ?? "").trim();
  if (!templateVersion) throw new Error("Bank template version is missing.");

  const [inserted] = await db.insert(bankFileValidations).values({
    organizationId: input.organizationId,
    payrollRunId: run.id,
    templateName: String(file.validation.template),
    templateVersion,
    fileName: file.filename,
    fileSha256,
    generatedBy: input.actor,
  }).onConflictDoNothing().returning();

  if (inserted) return { record: inserted, created: true, file };

  const [existing] = await db.select().from(bankFileValidations).where(and(
    eq(bankFileValidations.organizationId, input.organizationId),
    eq(bankFileValidations.templateName, String(file.validation.template)),
    eq(bankFileValidations.templateVersion, templateVersion),
    eq(bankFileValidations.fileSha256, fileSha256),
  )).limit(1);
  if (!existing) throw new Error("Bank validation record could not be created.");
  return { record: existing, created: false, file };
}

export async function listBankFileValidations(organizationId: number) {
  return db.select().from(bankFileValidations)
    .where(eq(bankFileValidations.organizationId, organizationId))
    .orderBy(desc(bankFileValidations.createdAt), desc(bankFileValidations.id))
    .limit(100);
}

export async function getBankFileValidation(organizationId: number, id: number) {
  const [row] = await db.select().from(bankFileValidations).where(and(
    eq(bankFileValidations.id, id),
    eq(bankFileValidations.organizationId, organizationId),
  )).limit(1);
  return row ?? null;
}

export async function regenerateRecordedBankFile(row: BankFileValidationRow) {
  if (!row.payrollRunId) throw new Error("This bank-file validation can no longer be regenerated.");
  const file = await generateBankFile(row.payrollRunId, row.templateName, false);
  if (
    String(file.validation.version) !== row.templateVersion
    || bankFileSha256(file.body) !== row.fileSha256
  ) {
    throw new Error(
      "Payroll or bank-template data changed since this validation record was created. Generate a new record and submit that file instead.",
    );
  }
  return file;
}

export type BankPortalOutcome = {
  outcome: "accepted" | "rejected";
  portalReference: string | null;
  submittedAt: Date;
  note: string | null;
};

export function parseBankPortalOutcome(body: Record<string, unknown>) {
  const outcome = body.outcome === "accepted" || body.outcome === "rejected"
    ? body.outcome
    : null;
  if (!outcome) return { ok: false as const, error: "outcome must be accepted or rejected." };

  const rawDate = typeof body.submittedAt === "string" ? body.submittedAt.trim() : "";
  const submittedAt = rawDate ? new Date(rawDate) : new Date();
  if (Number.isNaN(submittedAt.getTime())) {
    return { ok: false as const, error: "submittedAt is invalid." };
  }

  const portalReference = typeof body.portalReference === "string"
    ? body.portalReference.trim().slice(0, 120)
    : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";

  if (outcome === "accepted" && portalReference.length < 4) {
    return {
      ok: false as const,
      error: "An accepted bank validation requires the bank portal's confirmation or batch reference.",
    };
  }
  if (outcome === "rejected" && note.length < 4) {
    return {
      ok: false as const,
      error: "A rejected bank validation requires the bank portal's error/rejection note.",
    };
  }

  return {
    ok: true as const,
    value: {
      outcome,
      portalReference: portalReference || null,
      submittedAt,
      note: note || null,
    } satisfies BankPortalOutcome,
  };
}

export async function recordBankPortalOutcome(input: {
  organizationId: number;
  id: number;
  actor: string;
  outcome: BankPortalOutcome;
}) {
  const [updated] = await db.update(bankFileValidations).set({
    status: input.outcome.outcome,
    portalReference: input.outcome.portalReference,
    submittedAt: input.outcome.submittedAt,
    outcomeNote: input.outcome.note,
    recordedBy: input.actor,
    recordedAt: new Date(),
  }).where(and(
    eq(bankFileValidations.id, input.id),
    eq(bankFileValidations.organizationId, input.organizationId),
    eq(bankFileValidations.status, "generated"),
  )).returning();
  return updated ?? null;
}

export async function acceptedBankFileValidationCount() {
  const rows = await db.select({ id: bankFileValidations.id })
    .from(bankFileValidations)
    .where(eq(bankFileValidations.status, "accepted"));
  return rows.length;
}
