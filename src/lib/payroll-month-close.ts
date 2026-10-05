import { createHash } from "node:crypto";

export type PayrollMonthRunEvidence = {
  id: number;
  periodLabel: string;
  payDate: string;
  status: string;
  payoutCompleted: boolean;
  payoutReference: string | null;
  journalExported: boolean;
  closeCompleted: boolean;
  closeActor: string | null;
};

export type PayrollMonthBirEvidence = {
  proven: boolean;
  agencyReference: string | null;
  submittedAt: string | null;
  recordedBy: string | null;
  generatorVersion: string | null;
};

export type PayrollMonthRemittanceEvidence = {
  certificationValid: boolean;
  snapshotHash: string | null;
  certifiedByName: string | null;
  certifiedAt: string | null;
  blockerCount: number;
};

export type PayrollMonthInspectionEvidence = {
  highFindingCount: number;
  findingKeys: string[];
  recordedExposure: number;
  screeningExposure: number;
};

export function evaluatePayrollMonthClose(input: {
  applicableMonth: string;
  runs: PayrollMonthRunEvidence[];
  bir1601c: PayrollMonthBirEvidence;
  remittance: PayrollMonthRemittanceEvidence;
  inspection: PayrollMonthInspectionEvidence;
}) {
  const blockers: string[] = [];

  if (input.runs.length === 0) {
    blockers.push("No payroll runs with a pay date in this month were found.");
  }

  for (const run of input.runs) {
    if (run.status !== "Released") {
      blockers.push(`${run.periodLabel} is ${run.status}, not Released.`);
    }
    if (!run.payoutCompleted) {
      blockers.push(`${run.periodLabel} payout is not confirmed settled.`);
    }
    if (!run.journalExported) {
      blockers.push(`${run.periodLabel} final accounting journal has not been exported.`);
    }
    if (!run.closeCompleted) {
      blockers.push(`${run.periodLabel} accounting close has not been completed.`);
    }
  }

  if (!input.bir1601c.proven) {
    blockers.push("BIR 1601-C filing/payment acknowledgement is not proven for this pay month.");
  }

  if (!input.remittance.certificationValid) {
    blockers.push(
      input.remittance.blockerCount > 0
        ? `Statutory remittance month certification is not valid and has ${input.remittance.blockerCount} live blocker(s).`
        : "Statutory remittance month certification is not valid for the current evidence snapshot.",
    );
  }

  if (input.inspection.highFindingCount > 0) {
    blockers.push(
      `${input.inspection.highFindingCount} high labor-inspection finding(s) remain active in the month-close evidence set.`,
    );
  }

  const evidence = {
    applicableMonth: input.applicableMonth,
    runs: [...input.runs]
      .sort((a, b) => a.id - b.id)
      .map((run) => ({
        id: run.id,
        periodLabel: run.periodLabel,
        payDate: run.payDate,
        status: run.status,
        payoutCompleted: run.payoutCompleted,
        payoutReference: run.payoutReference,
        journalExported: run.journalExported,
        closeCompleted: run.closeCompleted,
        closeActor: run.closeActor,
      })),
    bir1601c: input.bir1601c,
    remittance: input.remittance,
    inspection: {
      highFindingCount: input.inspection.highFindingCount,
      findingKeys: [...input.inspection.findingKeys].sort(),
      recordedExposure: input.inspection.recordedExposure,
      screeningExposure: input.inspection.screeningExposure,
    },
  };

  const snapshotHash = createHash("sha256")
    .update(JSON.stringify(evidence))
    .digest("hex");

  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    snapshotHash,
    evidence,
    runCount: input.runs.length,
  };
}
