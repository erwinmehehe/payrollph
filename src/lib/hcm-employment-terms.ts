import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, hcmEmploymentTerms, workerEmploymentEvents } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";

export const EMPLOYMENT_TERM_KINDS = [
  "regular",
  "probationary",
  "fixed_term",
  "project",
  "seasonal",
  "casual",
  "other",
] as const;

export type EmploymentTermKind = (typeof EMPLOYMENT_TERM_KINDS)[number];

export function philippineBusinessDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
}

export function previousIsoDate(date: string) {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export function employmentTermLifecycle(input: {
  termKind: string;
  probationReviewDate?: string | null;
  contractEndDate?: string | null;
  effectiveUntil?: string | null;
}, today = philippineBusinessDate()) {
  const dueDate = input.termKind === "probationary"
    ? input.probationReviewDate ?? null
    : input.contractEndDate ?? input.effectiveUntil ?? null;

  if (!dueDate) {
    return { state: "none" as const, dueDate: null, action: null };
  }

  const diffDays = Math.round(
    (new Date(dueDate + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime())
      / 86_400_000,
  );

  const action = input.termKind === "probationary"
    ? "Review probation outcome through a governed employment change."
    : "Review the employment end date and use the Separation workflow if employment will end.";

  if (diffDays < 0) return { state: "overdue" as const, dueDate, daysUntil: diffDays, action };
  if (diffDays === 0) return { state: "due" as const, dueDate, daysUntil: 0, action };
  if (diffDays <= 30) return { state: "upcoming" as const, dueDate, daysUntil: diffDays, action };
  return { state: "future" as const, dueDate, daysUntil: diffDays, action };
}

export async function activateEmploymentTerm(input: {
  termId: number;
  actor: string;
  actorUserId?: number | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const today = philippineBusinessDate(now);

  const result = await db.transaction(async (tx) => {
    const [term] = await tx.select().from(hcmEmploymentTerms)
      .where(eq(hcmEmploymentTerms.id, input.termId))
      .limit(1);
    if (!term) throw new Error("Employment terms record not found.");
    if (term.status !== "scheduled") {
      if (term.status === "active") return { term, event: null, alreadyActive: true as const };
      throw new Error("Only scheduled employment terms can activate.");
    }
    if (String(term.effectiveFrom) > today) {
      throw new Error("Employment terms cannot activate before their effective date.");
    }

    await tx.execute(sql`select id from employees where id = ${term.employeeId} for update`);
    const [employee] = await tx.select().from(employees).where(and(
      eq(employees.id, term.employeeId),
      eq(employees.organizationId, term.organizationId),
    )).limit(1);
    if (!employee) throw new Error("Employee not found for employment terms activation.");

    const active = await tx.select().from(hcmEmploymentTerms).where(and(
      eq(hcmEmploymentTerms.organizationId, term.organizationId),
      eq(hcmEmploymentTerms.employeeId, term.employeeId),
      eq(hcmEmploymentTerms.status, "active"),
    ));

    for (const prior of active) {
      const priorEnd = prior.effectiveUntil ? String(prior.effectiveUntil) : null;
      const nextEnd = previousIsoDate(String(term.effectiveFrom));
      await tx.update(hcmEmploymentTerms).set({
        status: "superseded",
        effectiveUntil: !priorEnd || priorEnd > nextEnd ? nextEnd : priorEnd,
        supersededAt: now,
        updatedAt: now,
      }).where(eq(hcmEmploymentTerms.id, prior.id));
    }

    const [updatedEmployee] = await tx.update(employees).set({
      employmentType: term.employmentType,
    }).where(and(
      eq(employees.id, term.employeeId),
      eq(employees.organizationId, term.organizationId),
    )).returning();
    if (!updatedEmployee) throw new Error("Employee changed before employment terms activation.");

    const [event] = await tx.insert(workerEmploymentEvents).values({
      organizationId: term.organizationId,
      employeeId: term.employeeId,
      effectiveDate: String(term.effectiveFrom),
      eventType: "employment_terms_change",
      fromEmploymentType: employee.employmentType,
      toEmploymentType: term.employmentType,
      fromStatus: employee.status,
      toStatus: employee.status,
      reason: term.reason,
      metadata: {
        employmentTermId: term.id,
        termKind: term.termKind,
        probationReviewDate: term.probationReviewDate,
        contractEndDate: term.contractEndDate,
        effectiveUntil: term.effectiveUntil,
        projectName: term.projectName,
        autoSeparation: false,
        autoRegularization: false,
      },
      actorUserId: input.actorUserId ?? term.approvedByUserId ?? term.requestedByUserId,
      actorName: input.actor,
    }).returning();

    const [activated] = await tx.update(hcmEmploymentTerms).set({
      status: "active",
      activatedAt: now,
      failure: null,
      updatedAt: now,
    }).where(and(
      eq(hcmEmploymentTerms.id, term.id),
      eq(hcmEmploymentTerms.status, "scheduled"),
    )).returning();
    if (!activated) throw new Error("Employment terms changed before activation.");

    return { term: activated, event, alreadyActive: false as const };
  });

  if (!result.alreadyActive) {
    await recordAuditEvent({
      organizationId: result.term.organizationId,
      actor: input.actor,
      action: "HCM employment terms activated",
      resource: `Employee #${result.term.employeeId}`,
      metadata: {
        employmentTermId: result.term.id,
        employmentType: result.term.employmentType,
        termKind: result.term.termKind,
        effectiveFrom: result.term.effectiveFrom,
        workerEmploymentEventId: result.event?.id ?? null,
      },
    });
  }

  return result;
}

export async function runScheduledEmploymentTerms(input: {
  actor?: string;
  now?: Date;
  limit?: number;
} = {}) {
  const now = input.now ?? new Date();
  const today = philippineBusinessDate(now);
  const rows = await db.select({ id: hcmEmploymentTerms.id }).from(hcmEmploymentTerms).where(and(
    eq(hcmEmploymentTerms.status, "scheduled"),
    lte(hcmEmploymentTerms.effectiveFrom, today),
  )).limit(input.limit ?? 100);

  const results: Array<{ id: number; ok: boolean; error?: string }> = [];
  for (const row of rows) {
    try {
      await activateEmploymentTerm({ termId: row.id, actor: input.actor ?? "System scheduler", now });
      results.push({ id: row.id, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Employment terms activation failed.";
      await db.update(hcmEmploymentTerms).set({
        status: "failed",
        failure: message,
        updatedAt: now,
      }).where(and(eq(hcmEmploymentTerms.id, row.id), eq(hcmEmploymentTerms.status, "scheduled")));
      results.push({ id: row.id, ok: false, error: message });
    }
  }
  return results;
}
