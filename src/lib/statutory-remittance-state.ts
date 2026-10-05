import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  organizations,
  payrollEntries,
  payrollRuns,
  statutoryRemittanceBatches,
  statutoryRemittanceMembers,
} from "@/db/schema";
import { buildStatutoryRemittanceAlerts } from "@/lib/statutory-remittance-alerts";
import {
  nominalRemittanceDueDate,
  statutorySharesForEntry,
  type StatutoryAgency,
} from "@/lib/statutory-remittance";

export function currentManilaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function currentManilaMonth() {
  return currentManilaDate().slice(0, 7);
}

export function statutoryLiabilityKeys(input: {
  runMonths: Record<number, string>;
  entries: Array<{
    payrollRunId: number;
    employeeId: number;
    lineItems: unknown;
    trace: unknown;
  }>;
}) {
  const keys = new Set<string>();
  const agencies: StatutoryAgency[] = ["SSS", "PhilHealth", "Pag-IBIG"];

  for (const entry of input.entries) {
    const applicableMonth = input.runMonths[entry.payrollRunId];
    if (!applicableMonth) continue;

    for (const agency of agencies) {
      const shares = statutorySharesForEntry(entry, agency);
      if (shares.employeeShare + shares.employerShare > 0) {
        keys.add(`${applicableMonth}|${agency}`);
      }
    }
  }

  return keys;
}

export async function loadStatutoryRemittanceState(organizationId: number) {
  const [organization] = await db.select().from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!organization) return null;

  const batches = await db.select().from(statutoryRemittanceBatches)
    .where(eq(statutoryRemittanceBatches.organizationId, organizationId))
    .orderBy(asc(statutoryRemittanceBatches.applicableMonth), asc(statutoryRemittanceBatches.agency));

  const batchIds = batches.map((batch) => batch.id);
  const members = batchIds.length
    ? await db.select().from(statutoryRemittanceMembers)
        .where(and(
          eq(statutoryRemittanceMembers.organizationId, organizationId),
          inArray(statutoryRemittanceMembers.batchId, batchIds),
        ))
        .orderBy(asc(statutoryRemittanceMembers.batchId), asc(statutoryRemittanceMembers.employeeNo))
    : [];

  const releasedRuns = await db.select({
    id: payrollRuns.id,
    periodEnd: payrollRuns.periodEnd,
  }).from(payrollRuns).where(and(
    eq(payrollRuns.organizationId, organizationId),
    eq(payrollRuns.status, "Released"),
  ));

  const today = currentManilaDate();
  const closedMonths = [...new Set(
    releasedRuns
      .map((run) => String(run.periodEnd).slice(0, 7))
      .filter((month) => month < currentManilaMonth()),
  )].sort().slice(-6);
  const closedMonthSet = new Set(closedMonths);
  const closedRuns = releasedRuns.filter((run) =>
    closedMonthSet.has(String(run.periodEnd).slice(0, 7)),
  );
  const closedRunIds = closedRuns.map((run) => run.id);
  const releasedEntries = closedRunIds.length
    ? await db.select({
        payrollRunId: payrollEntries.payrollRunId,
        employeeId: payrollEntries.employeeId,
        lineItems: payrollEntries.lineItems,
        trace: payrollEntries.trace,
      }).from(payrollEntries).where(inArray(payrollEntries.payrollRunId, closedRunIds))
    : [];
  const runMonths = Object.fromEntries(
    closedRuns.map((run) => [run.id, String(run.periodEnd).slice(0, 7)]),
  ) as Record<number, string>;
  const liabilityKeys = statutoryLiabilityKeys({
    runMonths,
    entries: releasedEntries,
  });

  const existingKeys = new Set(
    batches.map((batch) => `${batch.applicableMonth}|${batch.agency}`),
  );

  const coverageGaps = closedMonths.flatMap((applicableMonth) =>
    (["SSS", "PhilHealth", "Pag-IBIG"] as const)
      .filter((agency) =>
        liabilityKeys.has(`${applicableMonth}|${agency}`)
        && !existingKeys.has(`${applicableMonth}|${agency}`),
      )
      .map((agency) => {
        let dueDate: string | null = null;
        try {
          dueDate = nominalRemittanceDueDate({
            agency,
            applicableMonth,
            legalName: organization.legalName,
            philHealthEmployerNo: organization.philHealthEmployerNo,
          });
        } catch {
          dueDate = null;
        }
        return { applicableMonth, agency, dueDate };
      }),
  );

  const batchSummaries = batches.map((batch) => ({
    ...batch,
    displayStatus:
      batch.status === "open" && String(batch.dueDate) < today
        ? "overdue"
        : batch.status,
    pendingPostingCount: members.filter(
      (member) => member.batchId === batch.id && member.postingStatus === "pending",
    ).length,
    exceptionCount: members.filter(
      (member) => member.batchId === batch.id && member.postingStatus === "exception",
    ).length,
  }));

  const alerts = buildStatutoryRemittanceAlerts({
    today,
    batches: batchSummaries,
    coverageGaps,
  });

  return {
    organization,
    today,
    batches: batchSummaries,
    members,
    coverageGaps,
    alerts,
  };
}
