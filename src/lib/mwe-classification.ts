import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalTasks,
  auditEvents,
  employeeMweClassifications,
  employees,
  legalEntities,
  dynamicWorkerGroups,
  permissionSets,
  payrollEntries,
  payrollRuns,
  userLegalEntityGrants,
  userOrganizations,
  userPermissionAssignments,
  users,
} from "@/db/schema";
import { PAYROLL_TAX_APPROVER_ROLES } from "@/lib/access";
import { ROLE_GATE_PERMISSIONS } from "@/lib/permissions";
import { permissionOverlayGroupBindingValid, permissionOverlayKeysValid } from "@/lib/permission-overlay-absence";
import { authorizedDynamicGroupMember } from "@/lib/dynamic-group-authorization";

export type MweClassificationRecord = {
  id: number;
  employeeId: number;
  isMwe: boolean;
  region: string;
  employeeDailyWage: string | number;
  statutoryMinimumWage: string | number;
  wageOrderReference: string;
  evidenceReference: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  status: string;
};

export type MweClassificationResolution = {
  isMwe: boolean;
  source: "approved" | "legacy_boolean" | "default_non_mwe";
  governanceMissing: boolean;
  classificationId: number | null;
  region: string | null;
  employeeDailyWage: number | null;
  statutoryMinimumWage: number | null;
  wageOrderReference: string | null;
  evidenceReference: string | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
};

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dayBefore(value: string) {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function todayPh() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

function includesDate(row: Pick<MweClassificationRecord, "effectiveFrom" | "effectiveUntil">, asOf: string) {
  return row.effectiveFrom <= asOf && (!row.effectiveUntil || asOf <= row.effectiveUntil);
}

export function resolveMweClassification(
  rows: MweClassificationRecord[],
  asOf: string,
  legacyMwe: boolean,
): MweClassificationResolution {
  if (!isIsoDate(asOf)) throw new Error("MWE classification requires an ISO applicable date.");
  const applicable = rows.filter((row) => row.status === "approved" && includesDate(row, asOf));
  if (applicable.length > 1) {
    throw new Error(
      `Ambiguous approved MWE classifications for employee #${applicable[0]?.employeeId ?? "unknown"} on ${asOf}.`,
    );
  }
  const approved = applicable[0];
  if (approved) {
    return {
      isMwe: approved.isMwe,
      source: "approved",
      governanceMissing: false,
      classificationId: approved.id,
      region: approved.region,
      employeeDailyWage: Number(approved.employeeDailyWage),
      statutoryMinimumWage: Number(approved.statutoryMinimumWage),
      wageOrderReference: approved.wageOrderReference,
      evidenceReference: approved.evidenceReference,
      effectiveFrom: approved.effectiveFrom,
      effectiveUntil: approved.effectiveUntil,
    };
  }
  if (legacyMwe) {
    return {
      isMwe: true,
      source: "legacy_boolean",
      governanceMissing: true,
      classificationId: null,
      region: null,
      employeeDailyWage: null,
      statutoryMinimumWage: null,
      wageOrderReference: null,
      evidenceReference: null,
      effectiveFrom: null,
      effectiveUntil: null,
    };
  }
  return {
    isMwe: false,
    source: "default_non_mwe",
    governanceMissing: false,
    classificationId: null,
    region: null,
    employeeDailyWage: null,
    statutoryMinimumWage: null,
    wageOrderReference: null,
    evidenceReference: null,
    effectiveFrom: null,
    effectiveUntil: null,
  };
}

export async function listMweClassifications(organizationId: number, employeeId: number) {
  return db.select().from(employeeMweClassifications).where(and(
    eq(employeeMweClassifications.organizationId, organizationId),
    eq(employeeMweClassifications.employeeId, employeeId),
  )).orderBy(desc(employeeMweClassifications.effectiveFrom), desc(employeeMweClassifications.id));
}

export async function createMweClassificationRequest(input: {
  organizationId: number;
  employeeId: number;
  isMwe: boolean;
  region: string;
  employeeDailyWage: number;
  statutoryMinimumWage: number;
  wageOrderReference: string;
  evidenceReference: string;
  effectiveFrom: string;
  effectiveUntil?: string | null;
  requestedByUserId: number;
  requestedByName: string;
}) {
  const region = input.region.trim().toUpperCase();
  const wageOrderReference = input.wageOrderReference.trim();
  const evidenceReference = input.evidenceReference.trim();
  const effectiveUntil = input.effectiveUntil?.trim() || null;

  if (!isIsoDate(input.effectiveFrom) || (effectiveUntil && !isIsoDate(effectiveUntil))) {
    throw new Error("MWE classification effective dates must use YYYY-MM-DD.");
  }
  if (effectiveUntil && effectiveUntil < input.effectiveFrom) {
    throw new Error("MWE classification end date cannot be before its effective date.");
  }
  if (!region || !wageOrderReference || !evidenceReference) {
    throw new Error("Region, wage-order reference, and evidence reference are required.");
  }
  if (!Number.isFinite(input.employeeDailyWage) || input.employeeDailyWage <= 0
    || !Number.isFinite(input.statutoryMinimumWage) || input.statutoryMinimumWage <= 0) {
    throw new Error("Employee daily wage and statutory minimum wage must be positive amounts.");
  }
  if (
    input.isMwe
    && Math.abs(input.employeeDailyWage - input.statutoryMinimumWage) > 0.01
  ) {
    throw new Error(
      "An MWE classification requires the evidenced employee daily wage to match the applicable statutory minimum wage. Use a non-MWE classification when pay is above the statutory minimum.",
    );
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select id from employees
      where id = ${input.employeeId} and organization_id = ${input.organizationId}
      for update
    `);
    const [employee] = await tx.select().from(employees).where(and(
      eq(employees.id, input.employeeId),
      eq(employees.organizationId, input.organizationId),
    )).limit(1);
    if (!employee) throw new Error("Employee not found.");
    if (input.effectiveFrom < String(employee.startDate)) {
      throw new Error("MWE classification cannot start before the employee start date.");
    }

    const [pending] = await tx.select().from(employeeMweClassifications).where(and(
      eq(employeeMweClassifications.organizationId, input.organizationId),
      eq(employeeMweClassifications.employeeId, input.employeeId),
      eq(employeeMweClassifications.status, "pending"),
    )).limit(1);
    if (pending) throw new Error("This employee already has a pending MWE classification request.");

    const [created] = await tx.insert(employeeMweClassifications).values({
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      isMwe: input.isMwe,
      region,
      employeeDailyWage: input.employeeDailyWage.toFixed(2),
      statutoryMinimumWage: input.statutoryMinimumWage.toFixed(2),
      wageOrderReference: wageOrderReference.slice(0, 160),
      evidenceReference,
      effectiveFrom: input.effectiveFrom,
      effectiveUntil,
      status: "pending",
      requestedByUserId: input.requestedByUserId,
      requestedByName: input.requestedByName.slice(0, 120),
    }).returning();

    await tx.insert(auditEvents).values({
      organizationId: input.organizationId,
      actor: input.requestedByName,
      action: "MWE classification submitted for review",
      resource: `${employee.firstName} ${employee.lastName} (${employee.employeeNo})`,
      metadata: {
        classificationId: created.id,
        employeeId: employee.id,
        isMwe: created.isMwe,
        region: created.region,
        employeeDailyWage: created.employeeDailyWage,
        statutoryMinimumWage: created.statutoryMinimumWage,
        wageOrderReference: created.wageOrderReference,
        evidenceReference: created.evidenceReference,
        effectiveFrom: created.effectiveFrom,
        effectiveUntil: created.effectiveUntil,
        requestedByUserId: input.requestedByUserId,
      },
    });
    return created;
  });
}

const BUSY_PAYROLL_STATUSES = new Set(["Queued", "Processing", "Recalculating", "Releasing"]);

export async function decideMweClassificationRequest(input: {
  organizationId: number;
  classificationId: number;
  decidedByUserId: number;
  decidedByName: string;
  decision: "approve" | "reject";
  decisionNote?: string | null;
  /** Selected employer required only when multi-entity is enabled. */
  expectedLegalEntityId?: number | null;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select id from employee_mwe_classifications
      where id = ${input.classificationId} and organization_id = ${input.organizationId}
      for update
    `);
    const [request] = await tx.select().from(employeeMweClassifications).where(and(
      eq(employeeMweClassifications.id, input.classificationId),
      eq(employeeMweClassifications.organizationId, input.organizationId),
    )).limit(1);
    if (!request) return { kind: "not_found" as const };
    if (request.status !== "pending") {
      return { kind: "conflict" as const, message: `This classification is already ${request.status}.` };
    }
    if (request.requestedByUserId === input.decidedByUserId) {
      return { kind: "forbidden" as const, message: "Maker-checker control: the requester cannot decide their own MWE classification." };
    }

    // Hold the current employer attribution stable until the approval/rejection
    // and its audit commit. A reassignment cannot bypass the request preflight.
    const [employee] = await tx.select().from(employees).where(and(
      eq(employees.id, request.employeeId),
      eq(employees.organizationId, input.organizationId),
    )).for("share").limit(1);
    if (!employee) return { kind: "conflict" as const, message: "The employee record no longer exists." };
    if (input.expectedLegalEntityId !== undefined &&
        employee.legalEntityId !== input.expectedLegalEntityId) {
      return { kind: "forbidden" as const, message: "Legal employer is not available to this account." };
    }

    // Revalidate and lock live authority in the SAME transaction as the tax
    // classification and audit changes. A revoked user, role, unit, custom
    // permission or legal-employer grant may not win a preflight/write race.
    // The membership FOR UPDATE also serializes new FK-linked permission
    // assignments; existing assignments/sets and grants are share-locked.
    const [liveUser] = await tx.select({ active: users.active }).from(users)
      .where(eq(users.id, input.decidedByUserId)).for("share").limit(1);
    const [membership] = await tx.select({
      id: userOrganizations.id, role: userOrganizations.role,
      orgUnitId: userOrganizations.orgUnitId, active: userOrganizations.active,
    }).from(userOrganizations).where(and(
      eq(userOrganizations.userId, input.decidedByUserId),
      eq(userOrganizations.organizationId, input.organizationId),
    )).for("update").limit(1);
    const permissionDenied = () => ({ kind: "forbidden" as const,
      message: "MWE classification decision is unavailable to this account." });
    if (!liveUser?.active || !membership?.active ||
        !PAYROLL_TAX_APPROVER_ROLES.some(role => role === membership.role) ||
        (membership.orgUnitId !== null && membership.orgUnitId !== employee.orgUnitId)) {
      return permissionDenied();
    }

    const [assignment] = await tx.select().from(userPermissionAssignments).where(and(
      eq(userPermissionAssignments.organizationId, input.organizationId),
      eq(userPermissionAssignments.userOrganizationId, membership.id),
    )).for("share").limit(1);
    if (assignment) {
      const [permissionSet] = await tx.select().from(permissionSets).where(and(
        eq(permissionSets.id, assignment.permissionSetId),
        eq(permissionSets.organizationId, input.organizationId),
      )).for("share").limit(1);
      if (!permissionSet?.active ||
          !permissionOverlayKeysValid(permissionSet.permissions, ROLE_GATE_PERMISSIONS) ||
          !permissionSet.permissions.includes("payroll.check") ||
          !permissionOverlayGroupBindingValid(assignment)) return permissionDenied();
      if (assignment.dynamicGroupId !== null) {
        const [group] = await tx.select({ id: dynamicWorkerGroups.id })
          .from(dynamicWorkerGroups).where(and(
            eq(dynamicWorkerGroups.id, assignment.dynamicGroupId),
            eq(dynamicWorkerGroups.organizationId, input.organizationId),
          )).for("share").limit(1);
        if (!group) return permissionDenied();
        const eligibility = await authorizedDynamicGroupMember({
          userId: input.decidedByUserId, organizationId: input.organizationId,
          groupId: assignment.dynamicGroupId,
          expectedVersion: assignment.dynamicGroupVersion,
        });
        if (!eligibility.eligible) return permissionDenied();
      }
    }

    if (input.expectedLegalEntityId !== undefined) {
      if (!Number.isSafeInteger(input.expectedLegalEntityId) ||
          !input.expectedLegalEntityId || input.expectedLegalEntityId <= 0) {
        return permissionDenied();
      }
      // Use one deterministic lock order on the transaction connection.
      const [grant] = await tx.select({ id: userLegalEntityGrants.id }).from(userLegalEntityGrants)
        .where(and(
          eq(userLegalEntityGrants.organizationId, input.organizationId),
          eq(userLegalEntityGrants.userId, input.decidedByUserId),
          eq(userLegalEntityGrants.legalEntityId, input.expectedLegalEntityId),
        )).for("share").limit(1);
      const [entity] = await tx.select({ id: legalEntities.id }).from(legalEntities).where(and(
        eq(legalEntities.id, input.expectedLegalEntityId),
        eq(legalEntities.organizationId, input.organizationId),
        eq(legalEntities.active, true),
      )).for("share").limit(1);
      if (!grant || !entity) return permissionDenied();
    }

    const decidedAt = new Date();
    if (input.decision === "reject") {
      const [rejected] = await tx.update(employeeMweClassifications).set({
        status: "rejected",
        decidedByUserId: input.decidedByUserId,
        decidedByName: input.decidedByName.slice(0, 120),
        decisionNote: input.decisionNote?.trim() || null,
        decidedAt,
        updatedAt: decidedAt,
      }).where(and(
        eq(employeeMweClassifications.id, request.id),
        eq(employeeMweClassifications.organizationId, input.organizationId),
        eq(employeeMweClassifications.status, "pending"),
      )).returning();
      await tx.insert(auditEvents).values({
        organizationId: input.organizationId,
        actor: input.decidedByName,
        action: "MWE classification rejected",
        resource: `${employee.firstName} ${employee.lastName} (${employee.employeeNo})`,
        metadata: {
          classificationId: request.id,
          employeeId: employee.id,
          requestedByUserId: request.requestedByUserId,
          decidedByUserId: input.decidedByUserId,
          decisionNote: rejected.decisionNote,
        },
      });
      return { kind: "rejected" as const, classification: rejected };
    }

    const affectedRows = await tx.select({
      id: payrollRuns.id,
      status: payrollRuns.status,
      payDate: payrollRuns.payDate,
    }).from(payrollEntries)
      .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
      .where(and(
        eq(payrollEntries.employeeId, request.employeeId),
        eq(payrollRuns.organizationId, input.organizationId),
      ));
    const affected = [...new Map(
      affectedRows
        .filter((run) =>
          String(run.payDate) >= String(request.effectiveFrom)
          && (!request.effectiveUntil || String(run.payDate) <= String(request.effectiveUntil))
        )
        .map((run) => [run.id, run]),
    ).values()];
    const busy = affected.find((run) => run.status !== "Released" && BUSY_PAYROLL_STATUSES.has(run.status));
    if (busy) {
      return {
        kind: "busy" as const,
        message: `Payroll run #${busy.id} is ${busy.status.toLowerCase()}. Finish or stop that payroll activity before approving a tax classification that affects it.`,
      };
    }

    const approvedRows = await tx.select().from(employeeMweClassifications).where(and(
      eq(employeeMweClassifications.organizationId, input.organizationId),
      eq(employeeMweClassifications.employeeId, request.employeeId),
      eq(employeeMweClassifications.status, "approved"),
    )).orderBy(desc(employeeMweClassifications.effectiveFrom), desc(employeeMweClassifications.id));

    const latest = approvedRows[0] ?? null;
    if (latest && String(request.effectiveFrom) <= String(latest.effectiveFrom)) {
      return {
        kind: "conflict" as const,
        message: `Approved MWE history already starts on ${latest.effectiveFrom}. New classifications must be added chronologically.`,
      };
    }

    if (latest && (!latest.effectiveUntil || String(latest.effectiveUntil) >= String(request.effectiveFrom))) {
      await tx.update(employeeMweClassifications).set({
        effectiveUntil: dayBefore(String(request.effectiveFrom)),
        updatedAt: decidedAt,
      }).where(and(
        eq(employeeMweClassifications.id, latest.id),
        eq(employeeMweClassifications.organizationId, input.organizationId),
      ));
    }

    const [approved] = await tx.update(employeeMweClassifications).set({
      status: "approved",
      decidedByUserId: input.decidedByUserId,
      decidedByName: input.decidedByName.slice(0, 120),
      decisionNote: input.decisionNote?.trim() || null,
      decidedAt,
      updatedAt: decidedAt,
    }).where(and(
      eq(employeeMweClassifications.id, request.id),
      eq(employeeMweClassifications.organizationId, input.organizationId),
      eq(employeeMweClassifications.status, "pending"),
    )).returning();
    if (!approved) return { kind: "conflict" as const, message: "Classification state changed while approval was being recorded." };

    const currentDate = todayPh();
    if (
      String(approved.effectiveFrom) <= currentDate
      && (!approved.effectiveUntil || currentDate <= String(approved.effectiveUntil))
    ) {
      await tx.update(employees).set({ mwe: approved.isMwe }).where(and(
        eq(employees.id, employee.id),
        eq(employees.organizationId, input.organizationId),
      ));
    }

    const invalidatedRunIds: number[] = [];
    for (const run of affected) {
      if (run.status === "Released") continue;
      await tx.delete(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
      await tx.update(payrollRuns).set({
        status: "Draft",
        employeeCount: 0,
        grossPay: "0",
        netPay: "0",
        exceptions: 0,
        processedChunks: 0,
        totalChunks: 0,
      }).where(and(
        eq(payrollRuns.id, run.id),
        eq(payrollRuns.organizationId, input.organizationId),
      ));
      await tx.update(approvalTasks).set({
        status: "Superseded",
        decidedBy: "System",
        decidedAt,
      }).where(and(
        eq(approvalTasks.payrollRunId, run.id),
        eq(approvalTasks.organizationId, input.organizationId),
        inArray(approvalTasks.status, ["Pending", "Approved"]),
      ));
      invalidatedRunIds.push(run.id);
    }

    await tx.insert(auditEvents).values({
      organizationId: input.organizationId,
      actor: input.decidedByName,
      action: "MWE classification approved",
      resource: `${employee.firstName} ${employee.lastName} (${employee.employeeNo})`,
      metadata: {
        classificationId: approved.id,
        employeeId: employee.id,
        requestedByUserId: approved.requestedByUserId,
        approvedByUserId: input.decidedByUserId,
        isMwe: approved.isMwe,
        region: approved.region,
        employeeDailyWage: approved.employeeDailyWage,
        statutoryMinimumWage: approved.statutoryMinimumWage,
        wageOrderReference: approved.wageOrderReference,
        evidenceReference: approved.evidenceReference,
        effectiveFrom: approved.effectiveFrom,
        effectiveUntil: approved.effectiveUntil,
        invalidatedPayrollRunIds: invalidatedRunIds,
      },
    });

    return {
      kind: "approved" as const,
      classification: approved,
      invalidatedPayrollRunIds: invalidatedRunIds,
    };
  });
}
