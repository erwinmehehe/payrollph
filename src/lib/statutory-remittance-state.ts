import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  organizations,
  payrollRuns,
  statutoryRemittanceBatches,
  statutoryRemittanceMembers,
} from "@/db/schema";
import { buildStatutoryRemittanceAlerts } from "@/lib/statutory-remittance-alerts";
import { nominalRemittanceDueDate } from "@/lib/statutory-remittance";

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

  const existingKeys = new Set(
    batches.map((batch) => `${batch.applicableMonth}|${batch.agency}`),
  );

  const coverageGaps = closedMonths.flatMap((applicableMonth) =>
    (["SSS", "PhilHealth", "Pag-IBIG"] as const)
      .filter((agency) => !existingKeys.has(`${applicableMonth}|${agency}`))
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
