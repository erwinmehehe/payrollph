import { createHash } from "node:crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  employeePayoutChangeRequests,
  employees,
  payrollEntries,
} from "@/db/schema";
import {
  encryptBankAccount,
  maskBankAccount,
  sameBankAccount,
} from "@/lib/bank-account-crypto";
import { treasuryControlPolicy } from "@/lib/treasury-controls";

function normalizeCode(value: string | null | undefined) {
  return value?.trim().toUpperCase() || null;
}

function normalizeMobile(value: string | null | undefined) {
  return value?.trim() || null;
}

export function payoutDestinationStateSha256(input: {
  bankAccount: string | null;
  bankCode: string | null;
  mobile: string | null;
}) {
  return createHash("sha256").update(JSON.stringify({
    bankAccount: input.bankAccount ?? null,
    bankCode: normalizeCode(input.bankCode),
    mobile: normalizeMobile(input.mobile),
  })).digest("hex");
}

export function safePayoutChangeRequest(row: typeof employeePayoutChangeRequests.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    employeeId: row.employeeId,
    status: row.status,
    reason: row.reason,
    originalSnapshot: row.originalSnapshot,
    proposedBankCode: row.proposedBankCode,
    proposedMobile: row.proposedMobile,
    proposedMaskedAccount: row.proposedMaskedAccount,
    requestedByUserId: row.requestedByUserId,
    requestedByName: row.requestedByName,
    requestedAt: row.requestedAt,
    decidedByUserId: row.decidedByUserId,
    decidedByName: row.decidedByName,
    decisionNote: row.decisionNote,
    decidedAt: row.decidedAt,
    appliedAt: row.appliedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createPayoutDestinationChangeRequest(input: {
  organizationId: number;
  employeeId: number;
  requestedByUserId: number;
  requestedByName: string;
  reason: string;
  replacementBankAccount: string | null;
  bankCode: string | null;
  mobile: string | null;
}) {
  const policy = await treasuryControlPolicy(input.organizationId);
  if (!policy?.enabled) return null;

  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, input.employeeId),
    eq(employees.organizationId, input.organizationId),
  )).limit(1);
  if (!employee) throw new Error("Employee not found.");

  const proposedBankAccount = input.replacementBankAccount
    ? encryptBankAccount(input.replacementBankAccount)
    : employee.bankAccount;
  const proposedBankCode = normalizeCode(input.bankCode);
  const proposedMobile = normalizeMobile(input.mobile);

  if (Boolean(proposedBankAccount) !== Boolean(proposedBankCode)) {
    throw new Error("Bank account and bank code must be complete together before payroll payout.");
  }

  const accountChanged = !sameBankAccount(employee.bankAccount, proposedBankAccount);
  const bankChanged = normalizeCode(employee.bankCode) !== proposedBankCode;
  const mobileChanged = normalizeMobile(employee.mobile) !== proposedMobile;
  if (!accountChanged && !bankChanged && !mobileChanged) {
    throw new Error("The proposed payout destination is unchanged.");
  }

  const reason = input.reason.trim();
  if (!reason) throw new Error("A reason is required for a payout destination change.");

  const [existing] = await db.select().from(employeePayoutChangeRequests).where(and(
    eq(employeePayoutChangeRequests.organizationId, input.organizationId),
    eq(employeePayoutChangeRequests.employeeId, input.employeeId),
    eq(employeePayoutChangeRequests.status, "pending"),
  )).limit(1);

  if (existing) {
    const sameProposal =
      sameBankAccount(existing.proposedBankAccount, proposedBankAccount)
      && normalizeCode(existing.proposedBankCode) === proposedBankCode
      && normalizeMobile(existing.proposedMobile) === proposedMobile;
    if (sameProposal && existing.requestedByUserId === input.requestedByUserId) {
      return safePayoutChangeRequest(existing);
    }
    throw new Error("This employee already has a pending payout destination change.");
  }

  const originalSnapshot = {
    maskedAccount: maskBankAccount(employee.bankAccount),
    bankCode: normalizeCode(employee.bankCode),
    mobile: normalizeMobile(employee.mobile),
  };
  const originalStateSha256 = payoutDestinationStateSha256({
    bankAccount: employee.bankAccount,
    bankCode: employee.bankCode,
    mobile: employee.mobile,
  });

  const [created] = await db.insert(employeePayoutChangeRequests).values({
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    status: "pending",
    reason: reason.slice(0, 360),
    originalSnapshot,
    originalStateSha256,
    proposedBankAccount,
    proposedBankCode,
    proposedMobile,
    proposedMaskedAccount: maskBankAccount(proposedBankAccount),
    requestedByUserId: input.requestedByUserId,
    requestedByName: input.requestedByName.slice(0, 120),
  }).returning();

  await db.insert(auditEvents).values({
    organizationId: input.organizationId,
    actor: input.requestedByName,
    action: "Employee payout destination change requested",
    resource: `Employee #${input.employeeId}`,
    metadata: {
      requestId: created.id,
      employeeId: input.employeeId,
      requestedByUserId: input.requestedByUserId,
      reason: created.reason,
      originalSnapshot,
      proposedMaskedAccount: created.proposedMaskedAccount,
      proposedBankCode,
      proposedMobile,
      treasuryPolicyEnabled: true,
    },
  });

  return safePayoutChangeRequest(created);
}

export async function decidePayoutDestinationChange(input: {
  organizationId: number;
  requestId: number;
  decidedByUserId: number;
  decidedByName: string;
  decision: "approve" | "reject";
  decisionNote?: string | null;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select id from employee_payout_change_requests
      where id = ${input.requestId}
      for update
    `);

    const [request] = await tx.select().from(employeePayoutChangeRequests).where(and(
      eq(employeePayoutChangeRequests.id, input.requestId),
      eq(employeePayoutChangeRequests.organizationId, input.organizationId),
    )).limit(1);
    if (!request) return { kind: "not_found" as const };
    if (request.status !== "pending") {
      return { kind: "conflict" as const, message: `This request is already ${request.status}.` };
    }
    if (request.requestedByUserId === input.decidedByUserId) {
      return { kind: "forbidden" as const, message: "Maker-checker control: the requester cannot approve or reject their own payout destination change." };
    }

    const [employee] = await tx.select().from(employees).where(and(
      eq(employees.id, request.employeeId),
      eq(employees.organizationId, input.organizationId),
    )).limit(1);
    if (!employee) return { kind: "conflict" as const, message: "The employee record no longer exists." };

    await tx.execute(sql`
      select id from employees
      where id = ${employee.id}
      for update
    `);

    const currentStateSha256 = payoutDestinationStateSha256({
      bankAccount: employee.bankAccount,
      bankCode: employee.bankCode,
      mobile: employee.mobile,
    });

    const decidedAt = new Date();
    if (currentStateSha256 !== request.originalStateSha256) {
      const [cancelled] = await tx.update(employeePayoutChangeRequests).set({
        status: "cancelled",
        decidedByUserId: input.decidedByUserId,
        decidedByName: input.decidedByName.slice(0, 120),
        decisionNote: "Source payout destination changed after this request was created.",
        decidedAt,
        updatedAt: decidedAt,
      }).where(and(
        eq(employeePayoutChangeRequests.id, request.id),
        eq(employeePayoutChangeRequests.status, "pending"),
      )).returning();

      await tx.insert(auditEvents).values({
        organizationId: input.organizationId,
        actor: input.decidedByName,
        action: "Employee payout destination change cancelled as stale",
        resource: `Employee #${request.employeeId}`,
        metadata: {
          requestId: request.id,
          employeeId: request.employeeId,
          requestedByUserId: request.requestedByUserId,
          decidedByUserId: input.decidedByUserId,
        },
      });
      return { kind: "stale" as const, request: safePayoutChangeRequest(cancelled) };
    }

    if (input.decision === "reject") {
      const [rejected] = await tx.update(employeePayoutChangeRequests).set({
        status: "rejected",
        decidedByUserId: input.decidedByUserId,
        decidedByName: input.decidedByName.slice(0, 120),
        decisionNote: input.decisionNote?.trim().slice(0, 500) || null,
        decidedAt,
        updatedAt: decidedAt,
      }).where(and(
        eq(employeePayoutChangeRequests.id, request.id),
        eq(employeePayoutChangeRequests.status, "pending"),
      )).returning();

      await tx.insert(auditEvents).values({
        organizationId: input.organizationId,
        actor: input.decidedByName,
        action: "Employee payout destination change rejected",
        resource: `Employee #${request.employeeId}`,
        metadata: {
          requestId: request.id,
          employeeId: request.employeeId,
          requestedByUserId: request.requestedByUserId,
          decidedByUserId: input.decidedByUserId,
          decisionNote: rejected.decisionNote,
        },
      });
      return { kind: "rejected" as const, request: safePayoutChangeRequest(rejected), employee };
    }

    const [updatedEmployee] = await tx.update(employees).set({
      bankAccount: request.proposedBankAccount,
      bankCode: request.proposedBankCode,
      mobile: request.proposedMobile,
    }).where(and(
      eq(employees.id, employee.id),
      eq(employees.organizationId, input.organizationId),
    )).returning();

    const [approved] = await tx.update(employeePayoutChangeRequests).set({
      status: "approved",
      decidedByUserId: input.decidedByUserId,
      decidedByName: input.decidedByName.slice(0, 120),
      decisionNote: input.decisionNote?.trim().slice(0, 500) || null,
      decidedAt,
      appliedAt: decidedAt,
      updatedAt: decidedAt,
    }).where(and(
      eq(employeePayoutChangeRequests.id, request.id),
      eq(employeePayoutChangeRequests.status, "pending"),
    )).returning();

    await tx.insert(auditEvents).values({
      organizationId: input.organizationId,
      actor: input.decidedByName,
      action: "Employee payout destination change approved",
      resource: `${updatedEmployee.firstName} ${updatedEmployee.lastName} (${updatedEmployee.employeeNo})`,
      metadata: {
        requestId: request.id,
        employeeId: request.employeeId,
        requestedByUserId: request.requestedByUserId,
        approvedByUserId: input.decidedByUserId,
        reason: request.reason,
        originalSnapshot: request.originalSnapshot,
        proposedMaskedAccount: request.proposedMaskedAccount,
        proposedBankCode: request.proposedBankCode,
        proposedMobile: request.proposedMobile,
        appliedAt: decidedAt.toISOString(),
      },
    });

    return {
      kind: "approved" as const,
      request: safePayoutChangeRequest(approved),
      employee: updatedEmployee,
    };
  });
}

export async function listPayoutDestinationChangeRequests(input: {
  organizationId: number;
  employeeId?: number | null;
}) {
  const where = input.employeeId
    ? and(
        eq(employeePayoutChangeRequests.organizationId, input.organizationId),
        eq(employeePayoutChangeRequests.employeeId, input.employeeId),
      )
    : eq(employeePayoutChangeRequests.organizationId, input.organizationId);

  const rows = await db.select().from(employeePayoutChangeRequests)
    .where(where)
    .orderBy(desc(employeePayoutChangeRequests.createdAt));
  return rows.map(safePayoutChangeRequest);
}

export async function latestApprovedPayoutDestinationChangeForRun(input: {
  organizationId: number;
  runId: number;
  after: Date;
}) {
  const [row] = await db.select({
    id: employeePayoutChangeRequests.id,
    employeeId: employeePayoutChangeRequests.employeeId,
    appliedAt: employeePayoutChangeRequests.appliedAt,
  }).from(employeePayoutChangeRequests)
    .innerJoin(payrollEntries, and(
      eq(payrollEntries.employeeId, employeePayoutChangeRequests.employeeId),
      eq(payrollEntries.payrollRunId, input.runId),
    ))
    .where(and(
      eq(employeePayoutChangeRequests.organizationId, input.organizationId),
      eq(employeePayoutChangeRequests.status, "approved"),
      gt(employeePayoutChangeRequests.appliedAt, input.after),
    ))
    .orderBy(desc(employeePayoutChangeRequests.appliedAt))
    .limit(1);
  return row ?? null;
}
