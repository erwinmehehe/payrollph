import { createHash } from "node:crypto";

/**
 * Pure rules for government filing evidence. No database access here, so the
 * rules can be tested without one. See filing-evidence-store.ts for persistence.
 *
 * What this proves, and what it does not. A file Linaw generates is only
 * evidence of agency acceptance when a person submitted that exact file and
 * kept the agency's own acknowledgement. So:
 *   - a filing is identified by the SHA-256 of the file's bytes, and the
 *     download route refuses to serve a file whose bytes no longer match;
 *   - "accepted" needs an agency reference and how the file was submitted;
 *   - only an upload of the generated file counts as proof the FORMAT works.
 *     Re-typing the figures into a portal proves a person filed, not that
 *     Linaw's file is importable, so it is recorded but never counted.
 */

export type FilingAgency = "SSS" | "BIR" | "PhilHealth" | "Pag-IBIG";

export type FilingFormDefinition = {
  agency: FilingAgency;
  form: string;
  /** The generateGovernmentDraft kind that produces this file. */
  kind: string;
  /**
   * Bump whenever the generated file's columns or layout change. Acceptance of
   * an older layout says nothing about the new one, so readiness only counts
   * evidence recorded against the current version.
   */
  generatorVersion: string;
  /**
   * True only when the bytes Linaw generates are intended for direct upload to
   * the agency's current system. Reconciliation worksheets/source extracts must
   * never satisfy the filing-format readiness gate even if a user records an
   * "accepted" filing after re-keying the same figures elsewhere.
   */
  generatedFileIsAgencyUpload: boolean;
  /** What the person should enter as the agency reference. */
  referenceLabel: string;
  /** Wording the recording form uses. Kept here so the copy is reviewed with the rules. */
  copy: {
    title: string;
    agencyLabel: string;
    portalLabel: string;
    /** What "submitted" means for this form, shown for each submission method. */
    methodLabels: Record<"file_upload" | "manual_entry", string>;
    /** Why a hand-typed filing does not count. */
    manualEntryNote: string;
    /** What the agency says back, so the person knows what to copy. */
    answerLabel: string;
    /** Anything that limits what an acceptance proves. Shown above the form. */
    scopeNote: string | null;
    /** What has not been confirmed about this route. Shown above the form. */
    unconfirmedNote: string;
  };
};

export const SSS_R3_GENERATOR_VERSION = "sss-r3-worksheet-v2";
export const BIR_1604C_GENERATOR_VERSION = "bir-1604c-source-v1";
export const PHILHEALTH_RF1_GENERATOR_VERSION = "philhealth-rf1-worksheet-v1";
export const PAGIBIG_MCRF_GENERATOR_VERSION = "pagibig-mcrf-worksheet-v1";

export const FILING_FORMS: readonly FilingFormDefinition[] = [
  {
    agency: "SSS",
    form: "R-3",
    kind: "sss-r3",
    generatorVersion: SSS_R3_GENERATOR_VERSION,
    generatedFileIsAgencyUpload: false,
    referenceLabel: "SSS PRN or acknowledgement number from My.SSS",
    copy: {
      title: "SSS R-3 / e-CL filing evidence",
      agencyLabel: "SSS",
      portalLabel: "My.SSS e-CL / R-3",
      methodLabels: {
        file_upload: "Used an official SSS R-3 File Generator output",
        manual_entry: "Created/edited the contribution list in My.SSS",
      },
      manualEntryNote: "Linaw's R-3 artifact is a reconciliation worksheet, not an SSS File Generator output. Record My.SSS/e-CL completion as manual entry unless the exact official generator file was used.",
      answerLabel: "SSS PRN or acknowledgement number",
      scopeNote: "SSS currently supports My.SSS contribution collection lists and still publishes its own R3 File Generator. Linaw does not claim to reproduce the generator's proprietary output bytes.",
      unconfirmedNote: "Do not upload Linaw's worksheet as an R-3 file. Reconcile it against My.SSS/e-CL or the current official R3 File Generator.",
    },
  },
  {
    agency: "BIR",
    form: "1604-C",
    kind: "bir-1604c-source",
    generatorVersion: BIR_1604C_GENERATOR_VERSION,
    generatedFileIsAgencyUpload: false,
    referenceLabel: "BIR validation report or ticket reference from esubmission@bir.gov.ph",
    copy: {
      title: "BIR 1604-C Alphalist evidence",
      agencyLabel: "BIR",
      portalLabel: "BIR Alphalist Data Entry and Validation Module",
      methodLabels: {
        file_upload: "Validated/submitted an official-structure 1604-C DAT",
        manual_entry: "Used the BIR module to encode/convert the figures",
      },
      manualEntryNote: "The current Linaw 1604-C CSV is a source extract only. Record it as manual entry when its figures were encoded or converted through the BIR module; that does not prove the CSV itself is a BIR upload file.",
      answerLabel: "BIR validation/eSubmission acknowledgement reference",
      scopeNote: "BIR's current Alphalist module is version 7.4 and taxpayers with their own extract program must follow the published 1604-C file structure and naming convention. Linaw's existing CSV is not that DAT.",
      unconfirmedNote: "Do not treat the Linaw source extract as submission-ready. A future DAT generator must pass the current BIR validator before its format can count as proven.",
    },
  },
  {
    agency: "PhilHealth",
    form: "RF-1",
    kind: "philhealth-rf1",
    generatorVersion: PHILHEALTH_RF1_GENERATOR_VERSION,
    generatedFileIsAgencyUpload: false,
    referenceLabel: "PhilHealth acknowledgement receipt (ePAR) number from EPRS",
    copy: {
      title: "PhilHealth EPRS / RF-1 filing evidence",
      agencyLabel: "PhilHealth",
      portalLabel: "PhilHealth EPRS",
      methodLabels: {
        file_upload: "Used an EPRS-prescribed softcopy RF-1 file",
        manual_entry: "Prepared/submitted the report through EPRS",
      },
      manualEntryNote: "Linaw's RF-1 CSV is a reconciliation worksheet. PhilHealth has documented softcopy RF-1 upload facilities, but Linaw does not yet have a current EPRS-issued template contract to claim direct compatibility.",
      answerLabel: "PhilHealth acknowledgement/ePAR reference",
      scopeNote: "Use EPRS as the authoritative employer reporting and payment workflow. Reconcile the monthly premium and employee list before submission.",
      unconfirmedNote: "Do not count the Linaw worksheet as an EPRS-compatible upload until a current PhilHealth template is obtained and the exact bytes are accepted in EPRS.",
    },
  },
  {
    agency: "Pag-IBIG",
    form: "MCRF",
    kind: "pagibig-mcrf",
    generatorVersion: PAGIBIG_MCRF_GENERATOR_VERSION,
    generatedFileIsAgencyUpload: false,
    referenceLabel: "Pag-IBIG online payment instruction number (OPIN) or the confirmation reference you were given",
    copy: {
      title: "Pag-IBIG MCRF / eSRS filing evidence",
      agencyLabel: "Pag-IBIG",
      portalLabel: "Virtual Pag-IBIG eSRS / accredited payment channel",
      methodLabels: {
        file_upload: "Used the prescribed Pag-IBIG MCRF workbook or approved converter output",
        manual_entry: "Maintained employees and created the Payment Instruction in eSRS",
      },
      manualEntryNote: "Pag-IBIG's published MCRF instructions prescribe an Excel workbook with a YYYYMM period and a specific filename. Linaw's CSV is only a reconciliation/source worksheet.",
      answerLabel: "Pag-IBIG PIN / payment acknowledgement reference",
      scopeNote: "eSRS is the authoritative employer workflow: maintain the employee list, create the Payment Instruction Form, then pay using the generated PIN through an accredited channel.",
      unconfirmedNote: "Do not upload Linaw's CSV as an MCRF. Use the current Pag-IBIG workbook/eSRS workflow until Linaw supports and passes UAT for the prescribed file.",
    },
  },
];

export function findFilingForm(agency: unknown, form: unknown): FilingFormDefinition | null {
  return FILING_FORMS.find((item) => item.agency === agency && item.form === form) ?? null;
}

export const FILING_STATUSES = ["generated", "accepted", "rejected"] as const;
export type FilingStatus = (typeof FILING_STATUSES)[number];

export const SUBMISSION_METHODS = ["file_upload", "manual_entry"] as const;
export type SubmissionMethod = (typeof SUBMISSION_METHODS)[number];

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export type FilingOutcomeInput =
  | {
      outcome: "accepted";
      submissionMethod: SubmissionMethod;
      agencyReference: string;
      submittedAt: Date;
      note: string | null;
    }
  | {
      outcome: "rejected";
      submissionMethod: SubmissionMethod;
      agencyReference: string | null;
      submittedAt: Date | null;
      note: string;
    };

const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 \-\/]{3,59}$/;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Validates what a person typed from an agency acknowledgement. The reference
 * format is deliberately loose (agencies do not publish one we can pin), but it
 * must be present for an acceptance, because "accepted" with nothing to check
 * it against is just the old environment flag in a different place.
 */
export function parseFilingOutcome(
  body: unknown,
  now: Date = new Date(),
): { ok: true; value: FilingOutcomeInput } | { ok: false; error: string } {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const outcome = input.outcome;
  if (outcome !== "accepted" && outcome !== "rejected") {
    return { ok: false, error: "outcome must be \"accepted\" or \"rejected\"." };
  }

  const method = input.submissionMethod;
  if (!SUBMISSION_METHODS.includes(method as SubmissionMethod)) {
    return { ok: false, error: "submissionMethod must be \"file_upload\" or \"manual_entry\"." };
  }

  const note = typeof input.note === "string" ? input.note.trim().slice(0, 2000) : "";
  const reference = typeof input.agencyReference === "string" ? input.agencyReference.trim() : "";

  let submittedAt: Date | null = null;
  if (input.submittedAt !== undefined && input.submittedAt !== null && input.submittedAt !== "") {
    const parsed = new Date(String(input.submittedAt));
    if (Number.isNaN(parsed.getTime())) return { ok: false, error: "submittedAt is not a valid date." };
    if (parsed.getTime() > now.getTime() + ONE_DAY_MS) return { ok: false, error: "submittedAt cannot be in the future." };
    submittedAt = parsed;
  }

  if (outcome === "rejected") {
    if (!note) return { ok: false, error: "Say what the agency rejected, so the next attempt can fix it." };
    return {
      ok: true,
      value: {
        outcome,
        submissionMethod: method as SubmissionMethod,
        agencyReference: reference || null,
        submittedAt,
        note,
      },
    };
  }

  if (!REFERENCE_PATTERN.test(reference)) {
    return { ok: false, error: "An accepted filing needs the agency's own reference number (4 to 60 letters, digits, spaces, dashes or slashes)." };
  }
  if (!submittedAt) return { ok: false, error: "An accepted filing needs the date it was submitted." };

  return {
    ok: true,
    value: {
      outcome,
      submissionMethod: method as SubmissionMethod,
      agencyReference: reference,
      submittedAt,
      note: note || null,
    },
  };
}

export type FilingEvidenceRow = {
  agency: string;
  form: string;
  status: string;
  submissionMethod: string | null;
  generatorVersion: string;
  agencyReference?: string | null;
  periodLabel?: string;
  submittedAt?: Date | null;
};

/**
 * True only when the agency accepted an upload of a file in the layout Linaw
 * produces today. This is the single definition readiness and the scorecard use.
 */
export function provesFileFormat(row: FilingEvidenceRow, definition: FilingFormDefinition): boolean {
  return (
    definition.generatedFileIsAgencyUpload
    && row.agency === definition.agency
    && row.form === definition.form
    && row.status === "accepted"
    && row.submissionMethod === "file_upload"
    && row.generatorVersion === definition.generatorVersion
  );
}

type EvidenceSummary = ReturnType<typeof summarizeFilingEvidence>;

/**
 * The readiness gate's explanation while a form is not proven. It says which
 * weaker kinds of evidence exist so nobody is told "nothing" when something is
 * recorded, and never suggests they count.
 */
export function describeEvidenceGap(summary: EvidenceSummary | null, definition: FilingFormDefinition): string {
  const parts = [
    definition.generatedFileIsAgencyUpload
      ? `No recorded ${definition.copy.agencyLabel} acceptance of a Linaw-generated ${definition.form} file in the current layout yet.`
      : `Linaw's current ${definition.form} artifact is reconciliation/source data, not a claimed direct-upload file for ${definition.copy.agencyLabel}.`,
  ];
  if (summary?.acceptedByManualEntry) {
    parts.push(`${summary.acceptedByManualEntry} filing(s) were typed in by hand, which proves a filing was made but not that the generated file works.`);
  }
  if (summary?.acceptedOnOlderLayout) parts.push(`${summary.acceptedOnOlderLayout} acceptance(s) were for an older file layout.`);
  if (summary?.rejected) parts.push(`${summary.rejected} rejection(s) are recorded.`);
  parts.push(
    definition.generatedFileIsAgencyUpload
      ? "Create a record on the Exports page, submit that exact file, then record the agency's answer."
      : "Use the official agency portal/template for filing and record the acknowledgement; a direct-upload format gate stays blocked until Linaw has a validated agency-compatible generator.",
  );
  return parts.join(" ");
}

export function summarizeFilingEvidence(rows: FilingEvidenceRow[], definition: FilingFormDefinition) {
  const relevant = rows.filter((row) => row.agency === definition.agency && row.form === definition.form);
  const proving = relevant.filter((row) => provesFileFormat(row, definition));
  const latest = [...proving].sort(
    (a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0),
  )[0];
  return {
    proven: proving.length > 0,
    provingCount: proving.length,
    acceptedByManualEntry: relevant.filter((row) => row.status === "accepted" && row.submissionMethod === "manual_entry").length,
    acceptedOnOlderLayout: relevant.filter(
      (row) => row.status === "accepted" && row.submissionMethod === "file_upload" && row.generatorVersion !== definition.generatorVersion,
    ).length,
    rejected: relevant.filter((row) => row.status === "rejected").length,
    latest: latest
      ? { periodLabel: latest.periodLabel ?? null, agencyReference: latest.agencyReference ?? null }
      : null,
  };
}
