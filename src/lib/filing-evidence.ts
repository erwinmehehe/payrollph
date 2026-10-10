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
 *   - only an upload of the generated file can prove the FORMAT works;
 *   - some portal-first workflows can instead be proven operationally by the
 *     agency's own acknowledgement, without claiming the PayrollPH worksheet
 *     is an agency-prescribed upload format.
 */

export type FilingAgency = "SSS" | "BIR" | "PhilHealth" | "Pag-IBIG";

export type FilingFormDefinition = {
  agency: FilingAgency;
  form: string;
  /** The generateGovernmentDraft kind that produces this file. */
  kind: string;
  /** Whether readiness proves the generated file layout or the operational filing workflow. */
  evidenceMode: "file-format" | "operational";
  /** Submission methods the UI/API may accept for this filing. */
  submissionMethods: readonly SubmissionMethod[];
  /** Monthly worksheets must be tied to the final cutoff so the month is complete. */
  requiresFinalCutoff?: boolean;
  /**
   * Bump whenever the generated file's columns or layout change. Acceptance of
   * an older layout says nothing about the new one, so readiness only counts
   * evidence recorded against the current version.
   */
  generatorVersion: string;
  /** What the person should enter as the agency reference. */
  referenceLabel: string;
  /** Wording the recording form uses. Kept here so the copy is reviewed with the rules. */
  copy: {
    title: string;
    agencyLabel: string;
    portalLabel: string;
    /** What "submitted" means for this form, shown for each submission method. */
    methodLabels: Record<"file_upload" | "manual_entry", string>;
    /** What portal/manual filing evidence proves and what it does not prove. */
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
export const BIR_1601C_GENERATOR_VERSION = "bir-1601c-monthly-v1";
export const BIR_1604C_GENERATOR_VERSION = "bir-1604c-source-v2";
export const PHILHEALTH_RF1_GENERATOR_VERSION = "philhealth-rf1-worksheet-v1";
export const PAGIBIG_MCRF_GENERATOR_VERSION = "pagibig-mcrf-worksheet-v2";

export const FILING_FORMS: readonly FilingFormDefinition[] = [
  {
    agency: "SSS",
    form: "R-3",
    kind: "sss-r3",
    evidenceMode: "operational",
    submissionMethods: ["file_upload", "manual_entry"],
    requiresFinalCutoff: true,
    generatorVersion: SSS_R3_GENERATOR_VERSION,
    referenceLabel: "SSS PRN or acknowledgement number from My.SSS",
    copy: {
      title: "SSS R-3: did SSS accept the file?",
      agencyLabel: "SSS",
      portalLabel: "My.SSS",
      methodLabels: {
        file_upload: "Uploaded the file Linaw generated",
        manual_entry: "Typed the figures in by hand",
      },
      manualEntryNote: "A My.SSS acknowledgement can prove the operational filing even when figures were entered manually; it does not prove the PayrollPH worksheet is an SSS upload format.",
      answerLabel: "SSS PRN or acknowledgement number",
      scopeNote: null,
      unconfirmedNote: "It is not yet confirmed that SSS takes this worksheet at all, so a rejection is useful information, record it.",
    },
  },
  {
    agency: "BIR",
    form: "1601-C",
    kind: "bir-1601c",
    evidenceMode: "operational",
    submissionMethods: ["manual_entry"],
    requiresFinalCutoff: true,
    generatorVersion: BIR_1601C_GENERATOR_VERSION,
    referenceLabel: "BIR eBIRForms/eFPS filing or payment confirmation reference",
    copy: {
      title: "BIR 1601-C: was the monthly withholding return filed and paid?",
      agencyLabel: "BIR",
      portalLabel: "eBIRForms or eFPS",
      methodLabels: {
        file_upload: "Uploaded the PayrollPH worksheet",
        manual_entry: "Filed in eBIRForms/eFPS using PayrollPH's figures",
      },
      manualEntryNote: "For 1601-C, the PayrollPH file is a source/checking worksheet. An accepted eBIRForms/eFPS filing with BIR's own reference proves the operational filing, not an upload-file format.",
      answerLabel: "BIR filing/payment confirmation reference",
      scopeNote: "PayrollPH does not claim that its 1601-C CSV is a BIR-prescribed upload file. Record the official eBIRForms/eFPS acknowledgement for the monthly return and retain the payment evidence.",
      unconfirmedNote: "The exact due date can vary by eFPS filer group and the published BIR calendar; the Compliance Calendar therefore uses a conservative internal target.",
    },
  },
  {
    agency: "BIR",
    form: "1604-C",
    kind: "bir-1604c-source",
    evidenceMode: "file-format",
    submissionMethods: ["file_upload", "manual_entry"],
    generatorVersion: BIR_1604C_GENERATOR_VERSION,
    referenceLabel: "BIR validation report or ticket reference from esubmission@bir.gov.ph",
    copy: {
      title: "BIR Alphalist (1604-C): did BIR's ADES accept it?",
      agencyLabel: "BIR",
      portalLabel: "the BIR Alphalist Data Entry and Validation Module (ADES)",
      methodLabels: {
        file_upload: "Loaded Linaw's extract into ADES",
        manual_entry: "Typed the figures into ADES by hand",
      },
      manualEntryNote: "If you typed the figures into ADES, record it as typed in: it is kept, but it does not prove Linaw's extract loads.",
      answerLabel: "BIR validation report or ticket reference",
      scopeNote: "Linaw provides a source extract for BIR validation. A recorded acceptance proves only the exact generator version and dataset submitted; it does not replace BIR Alphalist v7.4 validation or the annual filing acknowledgement. Legacy per-run evidence is historical only; its source CSV is no longer eligible to count as current BIR file-format acceptance.",
      unconfirmedNote: "ADES produces the final .DAT you email to BIR; Linaw does not produce that .DAT. It is not confirmed that ADES can load this CSV, so a rejection or a typed-in filing is useful information, record it.",
    },
  },
  {
    agency: "PhilHealth",
    form: "RF-1",
    kind: "philhealth-rf1",
    evidenceMode: "operational",
    submissionMethods: ["file_upload", "manual_entry"],
    requiresFinalCutoff: true,
    generatorVersion: PHILHEALTH_RF1_GENERATOR_VERSION,
    referenceLabel: "PhilHealth acknowledgement receipt (ePAR) number from EPRS",
    copy: {
      title: "PhilHealth RF-1: did EPRS accept the report?",
      agencyLabel: "PhilHealth",
      portalLabel: "PhilHealth's EPRS",
      methodLabels: {
        file_upload: "Loaded Linaw's file into EPRS",
        manual_entry: "Typed the figures into EPRS by hand",
      },
      manualEntryNote: "An EPRS acknowledgement can prove the operational filing even when figures were entered manually; it does not prove the PayrollPH worksheet is an EPRS upload format.",
      answerLabel: "PhilHealth acknowledgement receipt (ePAR) number",
      scopeNote: "PhilHealth issues the acknowledgement receipt when the premium is paid, so the number shows the report was filed and paid in EPRS. Linaw's figures are recomputed from monthly basic salary, so check they match the amount you actually remitted.",
      unconfirmedNote: "EPRS takes RF-1 data in its own prescribed template. It is not confirmed that Linaw's CSV matches it, so a rejection or a typed-in filing is useful information, record it.",
    },
  },
  {
    agency: "Pag-IBIG",
    form: "MCRF",
    kind: "pagibig-mcrf",
    evidenceMode: "operational",
    submissionMethods: ["file_upload", "manual_entry"],
    requiresFinalCutoff: true,
    generatorVersion: PAGIBIG_MCRF_GENERATOR_VERSION,
    referenceLabel: "Pag-IBIG online payment instruction number (OPIN) or the confirmation reference you were given",
    copy: {
      title: "Pag-IBIG MCRF: did Pag-IBIG accept the remittance file?",
      agencyLabel: "Pag-IBIG",
      portalLabel: "Pag-IBIG eSRS or your bank's Pag-IBIG upload facility",
      methodLabels: {
        file_upload: "Uploaded the file Linaw generated",
        manual_entry: "Typed the figures in by hand",
      },
      manualEntryNote: "A Pag-IBIG acknowledgement can prove the operational filing even when figures were entered manually; it does not prove the PayrollPH worksheet is the prescribed eSRS upload format.",
      answerLabel: "Pag-IBIG payment instruction number (OPIN) or confirmation reference",
      scopeNote: "A payment instruction or confirmation reference shows the submitted remittance reached the selected Pag-IBIG payment workflow. It does not by itself prove the contribution was finally posted to every member account, so retain the posting/remittance acknowledgement too.",
      unconfirmedNote: "Pag-IBIG publishes MCRF spreadsheet encoding instructions and also provides eSRS. Linaw mirrors the published fields as a worksheet, but it does not claim that this CSV is the agency-prescribed upload workbook. Record portal/bank acceptance for the exact submitted version.",
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
  // 1604-C legacy evidence refers to a payroll-source CSV, not the prescribed
  // official BIR DAT. It cannot satisfy an agency file-format acceptance gate.
  if (definition.agency === "BIR" && definition.form === "1604-C") return false;
  return (
    row.agency === definition.agency
    && row.form === definition.form
    && row.status === "accepted"
    && row.submissionMethod === "file_upload"
    && definition.submissionMethods.includes(row.submissionMethod as SubmissionMethod)
    && row.generatorVersion === definition.generatorVersion
  );
}

/**
 * Operational filing proof is deliberately broader than file-format proof.
 * Portal-first agency workflows can be proven by an accepted manual/portal
 * submission with the agency's own acknowledgement reference, while a claimed
 * upload format still requires provesFileFormat().
 */
export function provesOperationalFiling(
  row: FilingEvidenceRow,
  definition: FilingFormDefinition,
): boolean {
  if (definition.agency === "BIR" && definition.form === "1604-C") return false;
  return (
    row.agency === definition.agency
    && row.form === definition.form
    && row.status === "accepted"
    && definition.submissionMethods.includes(row.submissionMethod as SubmissionMethod)
    && (row.submissionMethod === "file_upload" || row.submissionMethod === "manual_entry")
    && row.generatorVersion === definition.generatorVersion
    && Boolean(row.agencyReference?.trim())
  );
}

type EvidenceSummary = ReturnType<typeof summarizeFilingEvidence>;

/**
 * The readiness gate's explanation while a form is not proven. It says which
 * weaker kinds of evidence exist so nobody is told "nothing" when something is
 * recorded, and never suggests they count.
 */
export function describeEvidenceGap(summary: EvidenceSummary | null, definition: FilingFormDefinition): string {
  if (definition.evidenceMode === "operational") {
    const parts = [`No recorded current-version ${definition.copy.agencyLabel} operational acknowledgement for ${definition.form} yet.`];
    if (summary?.acceptedByManualEntry) {
      parts.push(`${summary.acceptedByManualEntry} portal/manual filing acknowledgement(s) exist, but none qualifies as current-version operational evidence.`);
    }
    if (summary?.acceptedOnOlderLayout) {
      parts.push(`${summary.acceptedOnOlderLayout} file acceptance(s) were recorded against an older generator version.`);
    }
    if (summary?.rejected) parts.push(`${summary.rejected} rejection(s) are recorded.`);
    parts.push("Create a record on the Exports page, complete the agency workflow, then record the agency's own acknowledgement.");
    return parts.join(" ");
  }

  const parts = [`No recorded ${definition.copy.agencyLabel} acceptance of a PayrollPH-generated ${definition.form} file in the current layout yet.`];
  if (summary?.acceptedByManualEntry) {
    parts.push(`${summary.acceptedByManualEntry} filing(s) were typed in by hand, which proves a filing was made but not that the generated file works.`);
  }
  if (summary?.acceptedOnOlderLayout) parts.push(`${summary.acceptedOnOlderLayout} acceptance(s) were for an older file layout.`);
  if (summary?.rejected) parts.push(`${summary.rejected} rejection(s) are recorded.`);
  parts.push("Create a record on the Exports page, use that file, then record the agency's answer.");
  return parts.join(" ");
}

export function summarizeFilingEvidence(rows: FilingEvidenceRow[], definition: FilingFormDefinition) {
  const relevant = rows.filter((row) => row.agency === definition.agency && row.form === definition.form);
  const proving = relevant.filter((row) => provesFileFormat(row, definition));
  const operational = relevant.filter((row) => provesOperationalFiling(row, definition));
  const latest = [...proving].sort(
    (a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0),
  )[0];
  const latestOperational = [...operational].sort(
    (a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0),
  )[0];
  return {
    proven: proving.length > 0,
    provingCount: proving.length,
    operationallyProven: operational.length > 0,
    operationalProvingCount: operational.length,
    latestOperational: latestOperational
      ? {
          periodLabel: latestOperational.periodLabel ?? null,
          agencyReference: latestOperational.agencyReference ?? null,
          submissionMethod: latestOperational.submissionMethod ?? null,
        }
      : null,
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
