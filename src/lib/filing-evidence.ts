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

export type FilingAgency = "SSS";

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
  /** What the person should enter as the agency reference. */
  referenceLabel: string;
};

export const SSS_R3_GENERATOR_VERSION = "sss-r3-worksheet-v1";

export const FILING_FORMS: readonly FilingFormDefinition[] = [
  {
    agency: "SSS",
    form: "R-3",
    kind: "sss-r3",
    generatorVersion: SSS_R3_GENERATOR_VERSION,
    referenceLabel: "SSS PRN or acknowledgement number from My.SSS",
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
    row.agency === definition.agency
    && row.form === definition.form
    && row.status === "accepted"
    && row.submissionMethod === "file_upload"
    && row.generatorVersion === definition.generatorVersion
  );
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
