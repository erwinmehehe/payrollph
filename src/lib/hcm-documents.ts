import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  documents,
  employees,
  hcmDocumentExpiryNotices,
  hcmDocumentRequirements,
  hcmEmployeeDocumentCompliance,
  hcmPolicyAssignments,
  hcmPolicyVersions,
  positionAssignments,
  positions,
} from "@/db/schema";
import { runAutomationEventSafely } from "@/lib/automation";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { canIssueExpiryNotice, documentExpiryMilestone } from "@/lib/employee-document-vault";

export type HcmTargetConditions = {
  orgUnitIds?: number[];
  employmentTypes?: string[];
  locations?: string[];
  employeeStatuses?: string[];
  jobProfileIds?: number[];
};

function positiveIntegerArray(value: unknown) {
  return Array.isArray(value)
    && value.length <= 100
    && value.every((item) => Number.isInteger(Number(item)) && Number(item) > 0);
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    && value.length <= 100
    && value.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 120);
}

export function validHcmTargetConditions(value: unknown): value is HcmTargetConditions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const allowed = new Set([
    "orgUnitIds",
    "employmentTypes",
    "locations",
    "employeeStatuses",
    "jobProfileIds",
  ]);
  if (Object.keys(row).some((key) => !allowed.has(key))) return false;
  if (row.orgUnitIds !== undefined && !positiveIntegerArray(row.orgUnitIds)) return false;
  if (row.jobProfileIds !== undefined && !positiveIntegerArray(row.jobProfileIds)) return false;
  if (row.employmentTypes !== undefined && !stringArray(row.employmentTypes)) return false;
  if (row.locations !== undefined && !stringArray(row.locations)) return false;
  if (row.employeeStatuses !== undefined && !stringArray(row.employeeStatuses)) return false;
  return true;
}

function normalized(values: string[] | undefined) {
  return new Set((values ?? []).map((item) => item.trim().toLowerCase()));
}

function targetMatches(
  employee: {
    orgUnitId: number | null;
    employmentType: string;
    region: string;
    status: string;
  },
  jobProfileId: number | null,
  target: HcmTargetConditions,
) {
  if (target.orgUnitIds?.length && (employee.orgUnitId == null || !target.orgUnitIds.includes(employee.orgUnitId))) {
    return false;
  }
  if (target.jobProfileIds?.length && (jobProfileId == null || !target.jobProfileIds.includes(jobProfileId))) {
    return false;
  }
  if (target.employmentTypes?.length && !normalized(target.employmentTypes).has(employee.employmentType.trim().toLowerCase())) {
    return false;
  }
  if (target.locations?.length && !normalized(target.locations).has(employee.region.trim().toLowerCase())) {
    return false;
  }
  if (target.employeeStatuses?.length && !normalized(target.employeeStatuses).has(employee.status.trim().toLowerCase())) {
    return false;
  }
  return true;
}

export async function employeeMatchesHcmTarget(
  organizationId: number,
  employeeId: number,
  target: HcmTargetConditions,
) {
  const [employee] = await db.select({
    id: employees.id,
    orgUnitId: employees.orgUnitId,
    employmentType: employees.employmentType,
    region: employees.region,
    status: employees.status,
    startDate: employees.startDate,
  }).from(employees).where(and(
    eq(employees.id, employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!employee) return false;

  const [assignment] = await db.select({
    positionId: positionAssignments.positionId,
  }).from(positionAssignments).where(and(
    eq(positionAssignments.organizationId, organizationId),
    eq(positionAssignments.employeeId, employeeId),
    isNull(positionAssignments.effectiveUntil),
  )).limit(1);

  let jobProfileId: number | null = null;
  if (assignment) {
    const [position] = await db.select({
      jobProfileId: positions.jobProfileId,
    }).from(positions).where(and(
      eq(positions.id, assignment.positionId),
      eq(positions.organizationId, organizationId),
    )).limit(1);
    jobProfileId = position?.jobProfileId ?? null;
  }

  return targetMatches(employee, jobProfileId, target);
}

export async function resolveTargetEmployees(
  organizationId: number,
  target: HcmTargetConditions,
) {
  const [staff, assignments, positionRows] = await Promise.all([
    db.select({
      id: employees.id,
      orgUnitId: employees.orgUnitId,
      employmentType: employees.employmentType,
      region: employees.region,
      status: employees.status,
      startDate: employees.startDate,
    }).from(employees).where(eq(employees.organizationId, organizationId)),
    db.select({
      employeeId: positionAssignments.employeeId,
      positionId: positionAssignments.positionId,
    }).from(positionAssignments).where(and(
      eq(positionAssignments.organizationId, organizationId),
      isNull(positionAssignments.effectiveUntil),
    )),
    db.select({
      id: positions.id,
      jobProfileId: positions.jobProfileId,
    }).from(positions).where(eq(positions.organizationId, organizationId)),
  ]);

  const positionById = new Map(positionRows.map((row) => [row.id, row]));
  const jobProfileByEmployee = new Map(
    assignments.map((row) => [
      row.employeeId,
      positionById.get(row.positionId)?.jobProfileId ?? null,
    ]),
  );

  return staff.filter((employee) =>
    targetMatches(employee, jobProfileByEmployee.get(employee.id) ?? null, target),
  );
}

function phDate(value: string) {
  return new Date(value + "T00:00:00+08:00");
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function dateOnly(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(date);
}

export async function materializePolicyAssignments(input: {
  organizationId: number;
  policyId: number;
  effectiveFrom: string;
  targetConditions: HcmTargetConditions;
  requiresAcknowledgement: boolean;
  acknowledgementDueDays: number;
}) {
  const staff = await resolveTargetEmployees(input.organizationId, input.targetConditions);
  const now = new Date();
  const effective = phDate(input.effectiveFrom);
  const dueBase = effective.getTime() > now.getTime() ? effective : now;
  const dueAt = input.requiresAcknowledgement
    ? addDays(dueBase, input.acknowledgementDueDays)
    : null;

  if (staff.length === 0) return { targeted: 0, inserted: 0 };

  const inserted = await db.insert(hcmPolicyAssignments).values(
    staff.map((employee) => ({
      organizationId: input.organizationId,
      policyId: input.policyId,
      employeeId: employee.id,
      dueAt,
      status: input.requiresAcknowledgement ? "assigned" : "not_required",
    })),
  ).onConflictDoNothing().returning({ id: hcmPolicyAssignments.id });

  return { targeted: staff.length, inserted: inserted.length };
}

export async function materializeDocumentRequirement(input: {
  organizationId: number;
  requirementId: number;
  targetConditions: HcmTargetConditions;
  submissionDueDays: number;
}) {
  const staff = await resolveTargetEmployees(input.organizationId, input.targetConditions);
  const dueAt = dateOnly(addDays(new Date(), input.submissionDueDays));
  if (staff.length === 0) return { targeted: 0, inserted: 0 };

  const inserted = await db.insert(hcmEmployeeDocumentCompliance).values(
    staff.map((employee) => ({
      organizationId: input.organizationId,
      requirementId: input.requirementId,
      employeeId: employee.id,
      status: "missing",
      dueAt,
    })),
  ).onConflictDoNothing().returning({ id: hcmEmployeeDocumentCompliance.id });

  return { targeted: staff.length, inserted: inserted.length };
}

export async function syncEmployeeHcmObligations(input: {
  organizationId: number;
  employeeId: number;
}) {
  const [policies, requirements] = await Promise.all([
    db.select().from(hcmPolicyVersions).where(and(
      eq(hcmPolicyVersions.organizationId, input.organizationId),
      eq(hcmPolicyVersions.status, "published"),
    )),
    db.select().from(hcmDocumentRequirements).where(and(
      eq(hcmDocumentRequirements.organizationId, input.organizationId),
      eq(hcmDocumentRequirements.active, true),
    )),
  ]);

  let policyAssignmentsCreated = 0;
  let documentRequirementsCreated = 0;
  const now = new Date();

  for (const policy of policies) {
    if (!validHcmTargetConditions(policy.targetConditions)) continue;
    if (!await employeeMatchesHcmTarget(
      input.organizationId,
      input.employeeId,
      policy.targetConditions,
    )) continue;

    const effective = phDate(String(policy.effectiveFrom));
    const dueBase = effective.getTime() > now.getTime() ? effective : now;
    const dueAt = policy.requiresAcknowledgement
      ? addDays(dueBase, policy.acknowledgementDueDays)
      : null;

    const inserted = await db.insert(hcmPolicyAssignments).values({
      organizationId: input.organizationId,
      policyId: policy.id,
      employeeId: input.employeeId,
      dueAt,
      status: policy.requiresAcknowledgement ? "assigned" : "not_required",
    }).onConflictDoNothing().returning({ id: hcmPolicyAssignments.id });
    policyAssignmentsCreated += inserted.length;
  }

  for (const requirement of requirements) {
    if (!validHcmTargetConditions(requirement.targetConditions)) continue;
    if (!await employeeMatchesHcmTarget(
      input.organizationId,
      input.employeeId,
      requirement.targetConditions,
    )) continue;

    const dueAt = dateOnly(addDays(now, requirement.submissionDueDays));
    const inserted = await db.insert(hcmEmployeeDocumentCompliance).values({
      organizationId: input.organizationId,
      requirementId: requirement.id,
      employeeId: input.employeeId,
      status: "missing",
      dueAt,
    }).onConflictDoNothing().returning({ id: hcmEmployeeDocumentCompliance.id });
    documentRequirementsCreated += inserted.length;
  }

  return {
    policyAssignmentsCreated,
    documentRequirementsCreated,
  };
}

export function documentComplianceStatus(
  expiresAt: string | null,
  renewalLeadDays: number,
  now = new Date(),
) {
  if (!expiresAt) return { status: "current" as const, daysUntilExpiry: null };
  const today = phDate(dateOnly(now));
  const expiry = phDate(expiresAt);
  const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / 86_400_000);
  if (daysUntilExpiry < 0) return { status: "expired" as const, daysUntilExpiry };
  if (daysUntilExpiry <= renewalLeadDays) return { status: "expiring" as const, daysUntilExpiry };
  return { status: "current" as const, daysUntilExpiry };
}

export async function runScheduledHcmDocumentExpiry(input: {
  actor: string;
  now?: Date;
  /** Optional bounded employer execution for isolated QA / targeted recovery. */
  organizationId?: number;
}) {
  const now = input.now ?? new Date();
  if (input.organizationId !== undefined &&
    (!Number.isSafeInteger(input.organizationId) || input.organizationId <= 0)) {
    throw new Error("A valid employer id is required for scoped document expiry.");
  }
  const vaultEnabled = criticalReleaseFlagEnabled("employeeDocumentVault");
  const [requirements, compliance] = await Promise.all([
    db.select().from(hcmDocumentRequirements).where(and(
      eq(hcmDocumentRequirements.active, true),
      input.organizationId === undefined ? undefined :
        eq(hcmDocumentRequirements.organizationId, input.organizationId),
    )),
    db.select().from(hcmEmployeeDocumentCompliance).where(input.organizationId === undefined ?
      undefined : eq(hcmEmployeeDocumentCompliance.organizationId, input.organizationId)),
  ]);
  const requirementById = new Map(requirements.map((row) => [row.id, row]));

  const outcomes: Array<{
    complianceId: number;
    status: string;
    employeeId: number;
    automation: unknown;
  }> = [];

  for (const row of compliance) {
    if (!row.documentId || !row.expiresAt || row.status === "waived") continue;
    // A submitted file must never become "verified" via the nightly expiry job.
    // Under the new vault, only actual HR-verified, non-waived records are eligible.
    if (vaultEnabled && (row.verifiedAt === null ||
      !["current", "expiring", "expired"].includes(row.status))) continue;
    const requirement = requirementById.get(row.requirementId);
    if (!requirement || requirement.organizationId !== row.organizationId) continue;

    const next = documentComplianceStatus(
      String(row.expiresAt),
      requirement.renewalLeadDays,
      now,
    );

    if (vaultEnabled) {
      // Lock the live compliance row before changing its status or creating an
      // HR alert. A concurrent replacement/waiver must win by locking order;
      // stale scheduler snapshots may never emit notices for superseded bytes.
      const snapshot = await db.transaction(async tx => {
        const [fresh] = await tx.select().from(hcmEmployeeDocumentCompliance).where(and(
          eq(hcmEmployeeDocumentCompliance.id, row.id),
          eq(hcmEmployeeDocumentCompliance.organizationId, row.organizationId),
          eq(hcmEmployeeDocumentCompliance.employeeId, row.employeeId),
        )).for("update").limit(1);
        if (!fresh || fresh.documentId !== row.documentId ||
          String(fresh.expiresAt) !== String(row.expiresAt)) return null;
        const [attached] = await tx.select({
          scannedClean: documents.scannedClean,
        }).from(documents).where(and(
          eq(documents.id, fresh.documentId!),
          eq(documents.organizationId, fresh.organizationId),
          eq(documents.employeeId, fresh.employeeId),
        )).limit(1);
        if (!attached || !canIssueExpiryNotice({
          status: fresh.status, documentId: fresh.documentId,
          verifiedAt: fresh.verifiedAt, scannedClean: attached.scannedClean,
          expiryRequired: requirement.expiryRequired,
        })) return null;

        // Updating and inserting inside the same transaction is atomic: a
        // concurrent HR waiver cannot be silently overwritten by this tick.
        if (fresh.status !== next.status) {
          await tx.update(hcmEmployeeDocumentCompliance).set({
            status: next.status, updatedAt: now,
          }).where(and(
            eq(hcmEmployeeDocumentCompliance.id, fresh.id),
            eq(hcmEmployeeDocumentCompliance.organizationId, fresh.organizationId),
          ));
        }
        if (next.status === "expired") {
          return { milestoneDays: null, status: "expired" as const };
        }
        const { milestoneDays } = documentExpiryMilestone(String(fresh.expiresAt), now);
        if (!milestoneDays) return null;
        const [notice] = await tx.insert(hcmDocumentExpiryNotices).values({
          organizationId: fresh.organizationId,
          complianceId: fresh.id,
          employeeId: fresh.employeeId,
          documentId: fresh.documentId!,
          expiresOn: String(fresh.expiresAt),
          milestoneDays, createdAt: now,
        }).onConflictDoNothing().returning({ id: hcmDocumentExpiryNotices.id });
        return notice ? { milestoneDays, status: next.status } : null;
      });
      if (!snapshot) continue;

      // External automations are out of the DB transaction: the durable,
      // unique HR inbox is the authoritative source if an automation is down.
      const automation = await runAutomationEventSafely({
        organizationId: row.organizationId,
        employeeId: row.employeeId,
        trigger: "document.expires",
        eventKey: `document-expiry:${row.id}:${row.documentId}:${String(row.expiresAt)}:${
          snapshot.milestoneDays === null ? "expired" : "milestone-" + snapshot.milestoneDays
        }`,
        context: {
          documentComplianceId: row.id,
          documentId: row.documentId,
          documentRequirementId: requirement.id,
          documentRequirementCode: requirement.code,
          documentRequirementName: requirement.name,
          documentKind: requirement.kind,
          expiryDate: String(row.expiresAt),
          daysUntilExpiry: next.daysUntilExpiry,
          ...(snapshot.milestoneDays === null ? {} : {
            reminderMilestoneDays: snapshot.milestoneDays,
          }),
          documentStatus: snapshot.status, eventActor: input.actor,
        },
      });
      outcomes.push({
        complianceId: row.id, status: snapshot.status, employeeId: row.employeeId, automation,
      });
      continue;
    }

    // Preserve pre-A-5 behavior exactly while the new vault is disabled.
    if (row.status !== next.status) {
      await db.update(hcmEmployeeDocumentCompliance).set({
        status: next.status, updatedAt: now,
      }).where(and(
        eq(hcmEmployeeDocumentCompliance.id, row.id),
        eq(hcmEmployeeDocumentCompliance.organizationId, row.organizationId),
      ));
    }
    if (next.status !== "expiring" && next.status !== "expired") continue;

    const automation = await runAutomationEventSafely({
      organizationId: row.organizationId,
      employeeId: row.employeeId,
      trigger: "document.expires",
      eventKey: `document-expiry:${row.id}:${String(row.expiresAt)}:${next.status}`,
      context: {
        documentComplianceId: row.id,
        documentId: row.documentId,
        documentRequirementId: requirement.id,
        documentRequirementCode: requirement.code,
        documentRequirementName: requirement.name,
        documentKind: requirement.kind,
        expiryDate: String(row.expiresAt),
        daysUntilExpiry: next.daysUntilExpiry,
        documentStatus: next.status,
        eventActor: input.actor,
      },
    });

    outcomes.push({
      complianceId: row.id,
      status: next.status,
      employeeId: row.employeeId,
      automation,
    });
  }

  return outcomes;
}
