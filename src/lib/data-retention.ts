import { and, inArray, isNotNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { purgeExpiredRejectedApplicants } from "@/lib/recruitment-applicant-retention";
import { leadRetentionCutoff } from "./lead-retention-policy";
import { sweepPendingCoeObjects } from "@/lib/hr-case-coe-object-reconciliation";
import { sweepPendingSpendReceipts } from "@/lib/spend-receipt-object-reconciliation";
import { sweepPendingVaultUploads } from "@/lib/employee-vault-object-reconciliation";
import {
  emailChangeTokens,
  marketingLeads,
  outbox,
  passwordResetTokens,
  rateLimitHits,
  sessions,
  webhookDeliveries,
} from "@/db/schema";

export const RECORD_RETENTION_SCHEDULE = {
  payrollAccountingTax: {
    minimumYears: 5,
    trigger: "Day after the applicable tax-return filing deadline, or actual filing date if filed late",
    authority: "NIRC Section 235 as amended by RA 11976 (EOPT); BIR RR 7-2024",
    records: [
      "payroll registers",
      "payslips supporting payroll accounting",
      "withholding-tax computations",
      "BIR annualization and filing source records",
      "journal/export source records",
      "government contribution source records",
    ],
    disposal:
      "No automatic purge. After the minimum period, an authorized retention review may securely erase or anonymize records only when no tax protest, refund/credit claim, litigation, investigation, or other legal hold remains.",
  },
  employmentLaborRecords: {
    minimumYears: 3,
    trigger: "Date of last entry, execution, or issuance as applicable",
    authority: "Omnibus Rules Implementing the Labor Code, Book III, Rule X, Section 12",
    records: [
      "employment records",
      "time and attendance records",
      "leave and payroll-support records",
      "pay-rate and rest-day history",
    ],
    disposal:
      "Retain longer when the same record is also part of the five-year tax/accounting class or is subject to a legal hold.",
  },
  privacyRequestCaseFiles: {
    reviewAfterYears: 2,
    trigger: "Completion or final rejection of the request",
    authority: "Internal privacy-management policy under DPA/IRR proportionality and retention principles",
    records: [
      "request register",
      "fulfillment evidence",
      "access-export audit evidence",
      "legal-retention assessment",
    ],
    disposal:
      "Review for secure deletion/anonymization after the review period; retain only what remains necessary for legal claims, accountability, or another lawful basis.",
  },
  securityAuditEvidence: {
    reviewAfterYears: 5,
    trigger: "Event creation",
    authority: "Internal security/accountability policy",
    records: ["payroll release audit", "sensitive-action audit", "security/admin audit"],
    disposal:
      "Review rather than automatically purge while the evidence supports retained payroll/tax records, investigations, or legal claims.",
  },
  marketingLeadRecords: {
    reviewAfterYears: 1,
    trigger: "Last activity on the enquiry",
    authority: "Internal data-minimization policy under DPA/IRR proportionality and retention principles",
    records: ["demo requests", "trial-access requests", "payroll-outsourcing enquiries"],
    disposal: "Automatically purge after one year without a recorded update. Active sales records must be updated to reset the retention window.",
  },
  operationalTransientData: {
    trigger: "Fixed operational windows below",
    authority: "Data minimization and operational necessity",
    records: ["sessions", "reset tokens", "rate-limit windows", "outbox", "webhook delivery attempts"],
    disposal: "Automatically purged by purgeExpiredOperationalData after the configured short operational window.",
  },
} as const;

export const RETENTION_POLICY = {
  authenticationArtifacts: {
    retentionDaysAfterExpiry: 30,
    action: "purge",
    rationale: "Short-lived security artifacts are not payroll records.",
  },
  rateLimitCounters: {
    retentionHours: 1,
    action: "purge",
    rationale: "Only the active abuse-prevention window is required.",
  },
  messageDeliveryRecords: {
    retentionDays: 180,
    action: "purge-completed",
    rationale: "Retain enough delivery history for support while limiting message-body retention.",
  },
  webhookDeliveryRecords: {
    retentionDays: 365,
    action: "purge-completed",
    rationale: "Operational evidence is retained longer than transient message delivery data.",
  },
  marketingLeadRecords: {
    retentionDaysAfterLastUpdate: 365,
    action: "purge",
    rationale: "Prospect contact data is useful for follow-up but should not remain indefinitely without activity.",
  },
  payrollTaxEmploymentRecords: {
    retention: "record-class-schedule",
    action: "no-automatic-purge",
    rationale:
      "Payroll/tax/accounting records use the five-year tax minimum; employment records use the three-year labor minimum. The longer applicable period and any legal hold control disposal.",
  },
} as const;

const daysAgo = (days: number, now = Date.now()) => new Date(now - days * 86_400_000);
const hoursAgo = (hours: number, now = Date.now()) => new Date(now - hours * 3_600_000);

export type RetentionStepFailure = { step: string; code: string | null; message: string };

/**
 * Raised only AFTER every retention step has been attempted. A single missing
 * table or unreachable object store must not stop unrelated purges (rate-limit
 * rows, message history, marketing leads, rejected-applicant personal data),
 * but the failure must still be visible, so it is rethrown once at the end.
 * `result` carries the counts of the steps that did run (null for failed ones).
 */
export class RetentionPurgeIncompleteError extends Error {
  readonly failures: RetentionStepFailure[];
  readonly result: Record<string, unknown>;
  constructor(failures: RetentionStepFailure[], result: Record<string, unknown>) {
    super("Retention purge incomplete: " + failures.map((f) => f.step + (f.code ? " (" + f.code + ")" : "")).join(", "));
    this.name = "RetentionPurgeIncompleteError";
    this.failures = failures;
    this.result = result;
  }
}

export function describeFailure(step: string, error: unknown): RetentionStepFailure {
  const e = error as { code?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } } | null;
  const code = typeof e?.code === "string" ? e.code : typeof e?.cause?.code === "string" ? e.cause.code : null;
  // Prefer the database error over Drizzle's wrapper, which echoes the SQL and its parameters.
  const raw = String(e?.cause?.message ?? e?.message ?? error);
  return { step, code, message: raw.split("\n")[0].slice(0, 160) };
}

async function attempt<T>(failures: RetentionStepFailure[], step: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    failures.push(describeFailure(step, error));
    return null;
  }
}

export async function purgeExpiredOperationalData(now = Date.now()) {
  const authCutoff = daysAgo(RETENTION_POLICY.authenticationArtifacts.retentionDaysAfterExpiry, now);
  const messageCutoff = daysAgo(RETENTION_POLICY.messageDeliveryRecords.retentionDays, now);
  const webhookCutoff = daysAgo(RETENTION_POLICY.webhookDeliveryRecords.retentionDays, now);
  const marketingLeadCutoff = leadRetentionCutoff(now);
  const rateCutoff = hoursAgo(RETENTION_POLICY.rateLimitCounters.retentionHours, now);
  const failures: RetentionStepFailure[] = [];

  const deletedSessions = await attempt(failures, "sessions", () => db.delete(sessions).where(or(
    lt(sessions.expiresAt, authCutoff),
    and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, authCutoff)),
  )).returning({ id: sessions.id }));

  const deletedPasswordTokens = await attempt(failures, "passwordResetTokens", () => db.delete(passwordResetTokens)
    .where(lt(passwordResetTokens.expiresAt, authCutoff))
    .returning({ id: passwordResetTokens.id }));

  const deletedEmailTokens = await attempt(failures, "emailChangeTokens", () => db.delete(emailChangeTokens)
    .where(lt(emailChangeTokens.expiresAt, authCutoff))
    .returning({ id: emailChangeTokens.id }));

  const deletedRateHits = await attempt(failures, "rateLimitWindows", () => db.delete(rateLimitHits)
    .where(lt(rateLimitHits.windowStart, rateCutoff))
    .returning({ id: rateLimitHits.id }));

  const deletedOutbox = await attempt(failures, "outboxMessages", () => db.delete(outbox).where(and(
    lt(outbox.createdAt, messageCutoff),
    inArray(outbox.status, ["sent", "failed"]),
  )).returning({ id: outbox.id }));

  const deletedWebhooks = await attempt(failures, "webhookDeliveries", () => db.delete(webhookDeliveries).where(and(
    lt(webhookDeliveries.createdAt, webhookCutoff),
    inArray(webhookDeliveries.status, ["delivered", "failed"]),
  )).returning({ id: webhookDeliveries.id }));

  const deletedMarketingLeads = await attempt(failures, "marketingLeads", () => db.delete(marketingLeads)
    .where(lt(marketingLeads.updatedAt, marketingLeadCutoff))
    .returning({ id: marketingLeads.id }));

  const applicantPrivacy = await attempt(failures, "applicantPrivacy", () => purgeExpiredRejectedApplicants(new Date(now)));
  // Preserve main's flag-rollback cleanup of unreadable pending COE objects.
  const attemptedCoe = await attempt(failures, "pendingCoeObjectRecovery", async () => await sweepPendingCoeObjects(new Date(now)));
  // Recover uncommitted Spend receipts, even when the A4 flag was rolled back.
  const attemptedSpend = await attempt(failures, "pendingSpendReceiptRecovery", async () => await sweepPendingSpendReceipts(new Date(now)));
  // Private A5 upload intents must also be swept when its flag is rolled back.
  const attemptedVault = await attempt(failures, "pendingVaultObjectRecovery", async () => await sweepPendingVaultUploads(new Date(now)));

  const counts = {
    sessions: deletedSessions?.length ?? null,
    passwordResetTokens: deletedPasswordTokens?.length ?? null,
    emailChangeTokens: deletedEmailTokens?.length ?? null,
    rateLimitWindows: deletedRateHits?.length ?? null,
    outboxMessages: deletedOutbox?.length ?? null,
    webhookDeliveries: deletedWebhooks?.length ?? null,
    marketingLeads: deletedMarketingLeads?.length ?? null,
  };
  if (failures.length > 0) {
    throw new RetentionPurgeIncompleteError(failures, {
      ...(applicantPrivacy?.enabled ? { applicantPrivacyPurged: applicantPrivacy.purged } : {}),
      pendingCoeObjectRecovery: attemptedCoe,
      pendingSpendReceiptRecovery: attemptedSpend,
      pendingVaultObjectRecovery: attemptedVault,
      ...counts,
    });
  }
  // No step failed, so every value below is non-null; the shape is unchanged.
  const pendingCoeObjectRecovery = attemptedCoe!;
  const pendingSpendReceiptRecovery = attemptedSpend!;
  const pendingVaultObjectRecovery = attemptedVault!;
  return {
    ...(applicantPrivacy!.enabled ? { applicantPrivacyPurged: applicantPrivacy!.purged } : {}),
    pendingCoeObjectRecovery,
    pendingSpendReceiptRecovery,
    pendingVaultObjectRecovery,
    ...(counts as { [K in keyof typeof counts]: number }),
  };
}
