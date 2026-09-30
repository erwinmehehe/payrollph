export type PayrollPostReleaseAuditEvent = {
  action: string;
  metadata: unknown;
  createdAt: Date | string;
};

export type PayrollPostReleaseRun = {
  id: number;
  status: string;
};

export type PayrollPostReleaseState = "released" | "exported" | "submitted" | "disbursed";

export type PayrollPostReleaseStatus = {
  state: PayrollPostReleaseState;
  hasReleaseReceipt: boolean;
  bankFileGeneratedAt: string | null;
  bankFilename: string | null;
  submittedAt: string | null;
  disbursedAt: string | null;
  latestFailure: string | null;
  label: string;
  detail: string;
};

function metadataOf(event: PayrollPostReleaseAuditEvent) {
  return event.metadata && typeof event.metadata === "object"
    ? event.metadata as Record<string, unknown>
    : {};
}

function runIdOf(event: PayrollPostReleaseAuditEvent) {
  return Number(metadataOf(event).runId ?? 0);
}

function timestampOf(event: PayrollPostReleaseAuditEvent | undefined) {
  if (!event) return null;
  const value = event.createdAt instanceof Date ? event.createdAt.toISOString() : String(event.createdAt);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function epochOf(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  const time = parsed.getTime();
  return Number.isNaN(time) ? 0 : time;
}

function newest(events: PayrollPostReleaseAuditEvent[], action: string) {
  return events
    .filter((event) => event.action === action)
    .sort((a, b) => epochOf(b.createdAt) - epochOf(a.createdAt))[0];
}

export function derivePayrollPostReleaseStatus(
  run: PayrollPostReleaseRun,
  auditEvents: PayrollPostReleaseAuditEvent[],
): PayrollPostReleaseStatus | null {
  if (run.status !== "Released") return null;

  const events = auditEvents.filter((event) => runIdOf(event) === run.id);
  const releaseReceipt = newest(events, "Payroll release receipt");
  const bankExport = newest(events, "bank export generated");
  const bankSubmission = newest(events, "Payroll bank upload confirmed");
  const disbursed = newest(events, "Payroll disbursed via PayMongo");
  const failed = newest(events, "Payroll disbursement failed");

  const failureMessage = failed
    ? String(metadataOf(failed).error ?? "The most recent provider disbursement attempt failed.")
    : null;
  const failureAfterSubmission =
    failed && bankSubmission && epochOf(failed.createdAt) > epochOf(bankSubmission.createdAt)
      ? failureMessage
      : null;

  if (disbursed) {
    return {
      state: "disbursed",
      hasReleaseReceipt: Boolean(releaseReceipt),
      bankFileGeneratedAt: timestampOf(bankExport),
      bankFilename: typeof metadataOf(bankExport ?? disbursed).filename === "string"
        ? String(metadataOf(bankExport ?? disbursed).filename)
        : null,
      submittedAt: timestampOf(bankSubmission),
      disbursedAt: timestampOf(disbursed),
      latestFailure: null,
      label: "Disbursed",
      detail: "The provider accepted the payroll disbursement batch. The provider batch is recorded in the audit trail.",
    };
  }

  if (bankSubmission) {
    return {
      state: "submitted",
      hasReleaseReceipt: Boolean(releaseReceipt),
      bankFileGeneratedAt: timestampOf(bankExport),
      bankFilename: typeof metadataOf(bankExport ?? bankSubmission).filename === "string"
        ? String(metadataOf(bankExport ?? bankSubmission).filename)
        : null,
      submittedAt: timestampOf(bankSubmission),
      disbursedAt: null,
      latestFailure: failureAfterSubmission,
      label: "Submitted to bank",
      detail: "The owner confirmed the generated bank file was uploaded externally. Linaw records submission, not final bank settlement.",
    };
  }

  if (bankExport) {
    return {
      state: "exported",
      hasReleaseReceipt: Boolean(releaseReceipt),
      bankFileGeneratedAt: timestampOf(bankExport),
      bankFilename: typeof metadataOf(bankExport).filename === "string" ? String(metadataOf(bankExport).filename) : null,
      submittedAt: null,
      disbursedAt: null,
      latestFailure: failureMessage,
      label: "Bank file generated",
      detail: "The final bank file exists. Upload it to the bank portal, then record that external submission in Linaw.",
    };
  }

  return {
    state: "released",
    hasReleaseReceipt: Boolean(releaseReceipt),
    bankFileGeneratedAt: null,
    bankFilename: null,
    submittedAt: null,
    disbursedAt: null,
    latestFailure: failureMessage,
    label: "Ready for payout",
    detail: "Payroll is released and locked. Generate the final bank file before submitting the payout externally.",
  };
}
