import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  hcmEmploymentTermDecisions,
  hcmEmploymentTerms,
  separationRecords,
} from "@/db/schema";
import {
  buildEmploymentLifecycleRow,
  sortEmploymentLifecycleRows,
  summarizeEmploymentLifecycle,
} from "@/lib/hcm-lifecycle-readiness";
import { philippineBusinessDate } from "@/lib/hcm-employment-terms";
import { loadHcmLifecyclePolicy } from "@/lib/hcm-lifecycle-policy";

export async function loadEmploymentLifecycleReadiness(
  organizationId: number,
  today = philippineBusinessDate(),
) {
  const policy = await loadHcmLifecyclePolicy(organizationId);
  const [employeeRows, termRows, decisionRows, separationRows] = await Promise.all([
    db.select({
      id: employees.id,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName,
      lastName: employees.lastName,
      status: employees.status,
    }).from(employees)
      .where(eq(employees.organizationId, organizationId))
      .orderBy(employees.lastName, employees.firstName, employees.id),
    db.select().from(hcmEmploymentTerms)
      .where(eq(hcmEmploymentTerms.organizationId, organizationId))
      .orderBy(desc(hcmEmploymentTerms.effectiveFrom), desc(hcmEmploymentTerms.id)),
    db.select().from(hcmEmploymentTermDecisions)
      .where(eq(hcmEmploymentTermDecisions.organizationId, organizationId))
      .orderBy(desc(hcmEmploymentTermDecisions.id)),
    db.select({
      id: separationRecords.id,
      employeeId: separationRecords.employeeId,
      status: separationRecords.status,
      lastDay: separationRecords.lastDay,
    }).from(separationRecords)
      .where(eq(separationRecords.organizationId, organizationId))
      .orderBy(desc(separationRecords.id)),
  ]);

  const activeTermByEmployee = new Map<number, (typeof termRows)[number]>();
  for (const row of termRows) {
    if (row.status === "active" && !activeTermByEmployee.has(row.employeeId)) {
      activeTermByEmployee.set(row.employeeId, row);
    }
  }

  const decisionByEmployee = new Map<number, (typeof decisionRows)[number]>();
  for (const row of decisionRows) {
    if (decisionByEmployee.has(row.employeeId)) continue;
    if (
      ["pending_approval", "scheduled", "failed"].includes(row.status)
      || (
        row.status === "applied"
        && row.decisionKind === "non_renew"
        && row.separationHandoffStatus !== "completed"
      )
    ) {
      decisionByEmployee.set(row.employeeId, row);
    }
  }

  const separationByEmployee = new Map<number, (typeof separationRows)[number]>();
  for (const row of separationRows) {
    if (!separationByEmployee.has(row.employeeId)) separationByEmployee.set(row.employeeId, row);
  }

  const rows = employeeRows
    .filter((employee) => !["Separated", "Inactive", "Terminated"].includes(employee.status))
    .map((employee) => {
      const term = activeTermByEmployee.get(employee.id) ?? null;
      const decision = decisionByEmployee.get(employee.id) ?? null;
      const separation = separationByEmployee.get(employee.id) ?? null;

      return buildEmploymentLifecycleRow({
        employeeId: employee.id,
        employeeNo: employee.employeeNo,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        employeeStatus: employee.status,
        term: term ? {
          id: term.id,
          termKind: term.termKind,
          employmentType: term.employmentType,
          effectiveFrom: String(term.effectiveFrom),
          effectiveUntil: term.effectiveUntil ? String(term.effectiveUntil) : null,
          probationReviewDate: term.probationReviewDate ? String(term.probationReviewDate) : null,
          contractEndDate: term.contractEndDate ? String(term.contractEndDate) : null,
          status: term.status,
        } : null,
        decision: decision ? {
          id: decision.id,
          decisionKind: decision.decisionKind,
          status: decision.status,
          effectiveDate: String(decision.effectiveDate),
          proposedSeparationLastDay: decision.proposedSeparationLastDay
            ? String(decision.proposedSeparationLastDay)
            : null,
          separationHandoffStatus: decision.separationHandoffStatus,
          separationRecordId: decision.separationRecordId,
          failure: decision.failure,
        } : null,
        separation: separation ? {
          id: separation.id,
          status: separation.status,
          lastDay: String(separation.lastDay),
        } : null,
        today,
        actionWindowDays: policy.actionWindowDays,
      });
    });

  const sorted = sortEmploymentLifecycleRows(rows);
  return {
    today,
    policy,
    summary: summarizeEmploymentLifecycle(sorted),
    rows: sorted,
  };
}
