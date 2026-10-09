import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  assets,
  employees,
  performanceReviews,
  positionAssignments,
  provisioningTasks,
  separationRecords,
} from "@/db/schema";
import { loadEmploymentLifecycleReadiness } from "@/lib/hcm-lifecycle-readiness-server";
import { philippineBusinessDate } from "@/lib/hcm-employment-terms";
import {
  buildPeopleOperationsItems,
  paginatePeopleOperationsItems,
  type PeopleOpsFilters,
} from "@/lib/hcm-people-operations-inbox";

/**
 * Aggregate fixed, tenant-scoped source selects instead of executing a worker
 * profile fetch per employee. No salary, bank, statutory ID, payroll run,
 * compensation value or performance score is selected or serialized.
 */
export async function loadPeopleOperationsInbox(
  organizationId: number,
  filters: PeopleOpsFilters = {},
  today = philippineBusinessDate(),
) {
  const [
    lifecycle,
    people,
    taskRows,
    reviewRows,
    assignmentRows,
    separationRows,
    assetRows,
  ] = await Promise.all([
    loadEmploymentLifecycleReadiness(organizationId, today),
    db.select({
      id: employees.id,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName,
      lastName: employees.lastName,
      status: employees.status,
      startDate: employees.startDate,
    }).from(employees).where(eq(employees.organizationId, organizationId)),
    db.select({
      employeeId: provisioningTasks.employeeId,
      kind: provisioningTasks.kind,
      done: provisioningTasks.done,
    }).from(provisioningTasks).where(eq(provisioningTasks.organizationId, organizationId)),
    db.select({
      id: performanceReviews.id,
      employeeId: performanceReviews.employeeId,
      status: performanceReviews.status,
    }).from(performanceReviews).where(eq(performanceReviews.organizationId, organizationId)),
    db.select({
      id: positionAssignments.id,
      employeeId: positionAssignments.employeeId,
      assignmentType: positionAssignments.assignmentType,
      effectiveFrom: positionAssignments.effectiveFrom,
      effectiveUntil: positionAssignments.effectiveUntil,
    }).from(positionAssignments).where(eq(positionAssignments.organizationId, organizationId)),
    db.select({
      id: separationRecords.id,
      employeeId: separationRecords.employeeId,
      status: separationRecords.status,
      lastDay: separationRecords.lastDay,
      clearanceStatus: separationRecords.clearanceStatus,
      itCleared: separationRecords.itCleared,
      adminCleared: separationRecords.adminCleared,
      financeCleared: separationRecords.financeCleared,
      hrCleared: separationRecords.hrCleared,
    }).from(separationRecords).where(eq(separationRecords.organizationId, organizationId)),
    db.select({
      employeeId: assets.employeeId,
      status: assets.status,
      returnedOn: assets.returnedOn,
    }).from(assets).where(eq(assets.organizationId, organizationId)),
  ]);

  const rows = buildPeopleOperationsItems({
    today,
    employees: people.map((employee) => ({
      id: employee.id,
      employeeNo: employee.employeeNo,
      employeeName: employee.firstName + " " + employee.lastName,
      status: employee.status,
      startDate: String(employee.startDate),
    })),
    // Deliberately omit free-text decision failures from lifecycle readiness:
    // inbox rows use static, known action descriptions only.
    lifecycle: lifecycle.rows.map((row) => ({
      employeeId: row.employeeId,
      state: row.state,
      action: row.action,
      dueDate: row.dueDate,
      daysUntil: row.daysUntil,
    })),
    provisioning: taskRows,
    reviews: reviewRows,
    positions: assignmentRows.map((row) => ({
      ...row,
      effectiveFrom: String(row.effectiveFrom),
      effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
    })),
    separations: separationRows.map((row) => ({
      ...row,
      lastDay: String(row.lastDay),
    })),
    assets: assetRows.map((row) => ({
      ...row,
      returnedOn: row.returnedOn ? String(row.returnedOn) : null,
    })),
  });
  return paginatePeopleOperationsItems(today, rows, filters);
}
