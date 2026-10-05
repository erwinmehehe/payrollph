import { createHash } from "node:crypto";

type Batch = {
  id: number;
  agency: string;
  applicableMonth: string;
  status: string;
  snapshotHash: string;
  reconciledAt: Date | string | null;
  pendingPostingCount: number;
  exceptionCount: number;
};

type Member = {
  batchId: number;
  employeeId: number;
  postingStatus: string;
  postedAmount?: string | null;
  postingReference?: string | null;
};

type Alert = {
  agency: string;
  applicableMonth: string;
  title: string;
  tone: string;
};

export function evaluateRemittanceMonthClose(input: {
  applicableMonth: string;
  batches: Batch[];
  members: Member[];
  alerts: Alert[];
  requiredAgencies: string[];
  allPayrollRunsReleased: boolean;
}) {
  const monthBatches = input.batches
    .filter((batch) => batch.applicableMonth === input.applicableMonth)
    .sort((a, b) => a.agency.localeCompare(b.agency));
  const monthAlerts = input.alerts.filter(
    (alert) => alert.applicableMonth === input.applicableMonth,
  );

  const blockers: string[] = [];
  if (!input.allPayrollRunsReleased) {
    blockers.push("Every payroll run in the month must be Released before remittance close.");
  }
  if (input.requiredAgencies.length === 0) {
    blockers.push("No released statutory contribution liability was found for this month.");
  }
  for (const agency of input.requiredAgencies) {
    if (!monthBatches.some((batch) => batch.agency === agency)) {
      blockers.push(`${agency} remittance batch is missing for this month.`);
    }
  }
  if (monthBatches.length === 0) blockers.push("No remittance batches exist for this month.");
  for (const alert of monthAlerts) blockers.push(alert.title);
  for (const batch of monthBatches) {
    if (batch.status !== "reconciled") {
      blockers.push(`${batch.agency} is ${batch.status}, not reconciled.`);
    }
    if (batch.pendingPostingCount > 0) {
      blockers.push(`${batch.agency} has ${batch.pendingPostingCount} employee posting confirmation(s) outstanding.`);
    }
    if (batch.exceptionCount > 0) {
      blockers.push(`${batch.agency} has ${batch.exceptionCount} employee posting exception(s).`);
    }
  }

  const monthBatchIds = new Set(monthBatches.map((batch) => batch.id));
  const members = input.members
    .filter((member) => monthBatchIds.has(member.batchId))
    .sort((a, b) => a.batchId - b.batchId || a.employeeId - b.employeeId);

  const evidence = {
    applicableMonth: input.applicableMonth,
    batches: monthBatches.map((batch) => ({
      id: batch.id,
      agency: batch.agency,
      status: batch.status,
      snapshotHash: batch.snapshotHash,
      reconciledAt: batch.reconciledAt ? String(batch.reconciledAt) : null,
      pendingPostingCount: batch.pendingPostingCount,
      exceptionCount: batch.exceptionCount,
    })),
    members: members.map((member) => ({
      batchId: member.batchId,
      employeeId: member.employeeId,
      postingStatus: member.postingStatus,
      postedAmount: member.postedAmount ?? null,
      postingReference: member.postingReference ?? null,
    })),
  };

  const snapshotHash = createHash("sha256")
    .update(JSON.stringify(evidence))
    .digest("hex");

  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    snapshotHash,
    agencyCount: monthBatches.length,
    memberCount: members.length,
  };
}
