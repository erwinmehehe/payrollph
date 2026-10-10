import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { governmentFilingValidations, payrollRuns } from "@/db/schema";
import { generateGovernmentDraft } from "@/lib/exporters";
import {
  FILING_FORMS,
  sha256Hex,
  summarizeFilingEvidence,
  type FilingFormDefinition,
  type FilingOutcomeInput,
} from "@/lib/filing-evidence";
import { summarizeMonthlyContributionFile } from "@/lib/filing-remittance-snapshot";

export type FilingValidationRow = typeof governmentFilingValidations.$inferSelect;

/**
 * Generates the filing file for a payroll run and records it, identified by the
 * SHA-256 of its bytes. Generating the same unchanged file twice returns the
 * same record instead of a duplicate.
 */
export async function recordGeneratedFiling(input: {
  organizationId: number;
  runId: number;
  definition: FilingFormDefinition;
  actor: string;
}) {
  // The per-run 1604-C source predates year-end settlement preflight.
  // Retain historical evidence rows read-only; never create new records from
  // an unverified source format or claim their worksheet is an ADES .DAT.
  if (input.definition.agency === "BIR" && input.definition.form === "1604-C") {
    throw new Error("BIR 1604-C per-run filing evidence is retired. Use Compliance > Year-End Annualization and Check BIR source before exporting a draft; official BIR ADES validation is still required.");
  }
  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.id, input.runId), eq(payrollRuns.organizationId, input.organizationId)))
    .limit(1);
  if (!run) throw new Error("Payroll run not found in this workspace.");
  if (!run.legalEntityId) throw new Error("Payroll run has no legal employer. Fix payroll ownership before generating government filing evidence.");

  const file = await generateGovernmentDraft(run.id, input.definition.kind);
  const fileSha256 = sha256Hex(file.body);
  const applicableMonth = String(run.periodEnd).slice(0, 7);
  const remittanceSnapshot = summarizeMonthlyContributionFile({
    agency: input.definition.agency,
    form: input.definition.form,
    body: file.body,
    applicableMonth,
  });

  const [inserted] = await db
    .insert(governmentFilingValidations)
    .values({
      organizationId: input.organizationId,
      legalEntityId: run.legalEntityId,
      payrollRunId: run.id,
      agency: input.definition.agency,
      form: input.definition.form,
      periodLabel: run.periodLabel,
      applicableMonth: remittanceSnapshot?.applicableMonth ?? null,
      employeeCount: remittanceSnapshot?.employeeCount ?? null,
      reportedTotal: remittanceSnapshot ? remittanceSnapshot.reportedTotal.toFixed(2) : null,
      fileName: file.filename,
      fileSha256,
      generatorVersion: input.definition.generatorVersion,
      generatedBy: input.actor,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) return { record: inserted, created: true, file };

  const [existing] = await db
    .select()
    .from(governmentFilingValidations)
    .where(and(
      eq(governmentFilingValidations.organizationId, input.organizationId),
      eq(governmentFilingValidations.legalEntityId, run.legalEntityId),
      eq(governmentFilingValidations.agency, input.definition.agency),
      eq(governmentFilingValidations.form, input.definition.form),
      eq(governmentFilingValidations.fileSha256, fileSha256),
    ))
    .limit(1);

  // Snapshot metadata is deterministically derived from the already-hashed file.
  // Backfill newly-supported metadata without changing the immutable file or its
  // recorded agency outcome.
  if (existing && remittanceSnapshot && (
    existing.applicableMonth !== remittanceSnapshot.applicableMonth
    || existing.employeeCount !== remittanceSnapshot.employeeCount
    || Number(existing.reportedTotal ?? Number.NaN) !== remittanceSnapshot.reportedTotal
  )) {
    const [backfilled] = await db.update(governmentFilingValidations).set({
      applicableMonth: remittanceSnapshot.applicableMonth,
      employeeCount: remittanceSnapshot.employeeCount,
      reportedTotal: remittanceSnapshot.reportedTotal.toFixed(2),
    }).where(eq(governmentFilingValidations.id, existing.id)).returning();
    return { record: backfilled ?? existing, created: false, file };
  }

  return { record: existing, created: false, file };
}

export async function listFilingValidations(organizationId: number, legalEntityId: number) {
  return db
    .select()
    .from(governmentFilingValidations)
    .where(and(
      eq(governmentFilingValidations.organizationId, organizationId),
      eq(governmentFilingValidations.legalEntityId, legalEntityId),
    ))
    .orderBy(desc(governmentFilingValidations.createdAt), desc(governmentFilingValidations.id))
    .limit(100);
}

export async function getFilingValidation(organizationId: number, id: number) {
  const [row] = await db
    .select()
    .from(governmentFilingValidations)
    .where(and(eq(governmentFilingValidations.id, id), eq(governmentFilingValidations.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/**
 * Re-generates the file for a record and confirms its bytes still match the
 * hash that was recorded. If payroll data changed since, the person must not
 * upload this file and then attach the acceptance to a record for different
 * bytes, so a mismatch is an error rather than a silent re-hash.
 */
export async function regenerateRecordedFile(row: FilingValidationRow) {
  const definition = FILING_FORMS.find((item) => item.agency === row.agency && item.form === row.form);
  if (!definition || !row.payrollRunId) {
    throw new Error("This filing record can no longer be regenerated.");
  }
  const file = await generateGovernmentDraft(row.payrollRunId, definition.kind);
  if (sha256Hex(file.body) !== row.fileSha256) {
    throw new Error(
      "Payroll data has changed since this record was created, so the file no longer matches it. Generate a new record and submit that file instead.",
    );
  }
  return file;
}

/**
 * Records what the agency said. Only a "generated" record can be resolved, and
 * the update is conditional on that so two people cannot both resolve it and an
 * accepted record can never be edited afterwards.
 */
export async function recordFilingOutcome(input: {
  organizationId: number;
  id: number;
  actor: string;
  outcome: FilingOutcomeInput;
}) {
  const { outcome } = input;
  if (outcome.outcome === "accepted") {
    const [source] = await db.select({
      agency: governmentFilingValidations.agency,
      form: governmentFilingValidations.form,
    }).from(governmentFilingValidations).where(and(
      eq(governmentFilingValidations.organizationId, input.organizationId),
      eq(governmentFilingValidations.id, input.id),
    )).limit(1);
    if (source?.agency === "BIR" && source.form === "1604-C") {
      throw new Error("Legacy 1604-C source worksheets cannot be marked as current BIR-validated filing evidence.");
    }
  }
  const [updated] = await db
    .update(governmentFilingValidations)
    .set({
      status: outcome.outcome,
      submissionMethod: outcome.submissionMethod,
      agencyReference: outcome.agencyReference,
      submittedAt: outcome.submittedAt,
      outcomeNote: outcome.note,
      recordedBy: input.actor,
      recordedAt: new Date(),
    })
    .where(and(
      eq(governmentFilingValidations.id, input.id),
      eq(governmentFilingValidations.organizationId, input.organizationId),
      eq(governmentFilingValidations.status, "generated"),
    ))
    .returning();
  return updated ?? null;
}

/** Evidence summary per supported filing form, across every workspace. */
export async function filingEvidenceSummaries() {
  const rows = await db.select().from(governmentFilingValidations);
  return FILING_FORMS.map((definition) => ({
    definition,
    ...summarizeFilingEvidence(rows, definition),
  }));
}
