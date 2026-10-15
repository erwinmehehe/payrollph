import { and, asc, eq, gte, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employeeAvailabilityRules, employees } from "@/db/schema";
import { assertMembership } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { manilaWorkDate } from "@/lib/workforce-employee-upcoming-week";
import {
  availabilityRemovalDecision,
  contradictoryAvailability,
  parseAvailabilityRemoval,
  parseEmployeeAvailabilityDraft,
  sameAvailabilityRule,
  type EmployeeAvailabilityDraft,
} from "@/lib/workforce-employee-availability-preferences";
import { readScheduleReceiptBody, ScheduleReceiptBodyError } from "@/lib/workforce-schedule-receipt-body";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit } from "@/lib/security-request";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const MAX_ACTIVE_RULES = 60;

function respond(data: Record<string, unknown>, status = 200) {
  return Response.json(data, { status, headers: HEADERS });
}
function unavailable() {
  return respond({ error: "Your availability source is unavailable. No rule was saved or removed.", code: "AVAILABILITY_SOURCE_UNAVAILABLE" }, 503);
}
class AvailabilityConflict extends Error {
  constructor(message: string) { super(message); this.name = "AvailabilityConflict"; }
}

async function authenticatedEmployee() {
  if (!criticalReleaseFlagEnabled("wfmEmployeeAvailability")) {
    return { denied: respond({ error: "Employee availability preferences are not enabled." }, 404) };
  }
  const session = await getSessionUser();
  if (!session) return { denied: respond({ error: "Authentication required." }, 401) };
  if (session.role !== "employee" || !session.employeeId) {
    return { denied: respond({ error: "Employee self-service access is required." }, 403) };
  }
  const [employee] = await db.select({
    id: employees.id,
    organizationId: employees.organizationId,
    employeeNo: employees.employeeNo,
  }).from(employees).where(eq(employees.id, session.employeeId)).limit(1);
  if (!employee) return { denied: respond({ error: "Employee record unavailable." }, 403) };
  const denied = await assertMembership(session.id, employee.organizationId);
  if (denied) return { denied };
  return { session, employee, denied: null };
}

export async function GET(request: Request) {
  try {
    const scope = await authenticatedEmployee();
    if (scope.denied) return scope.denied;
    // Always derive employer and employee from the authenticated session.
    if (new URL(request.url).search) return respond({ error: "Client-supplied employee and employer identifiers are not accepted." }, 400);
    const today = manilaWorkDate();
    const rows = await db.select({
      id: employeeAvailabilityRules.id,
      weekday: employeeAvailabilityRules.weekday,
      startTime: employeeAvailabilityRules.startTime,
      endTime: employeeAvailabilityRules.endTime,
      availabilityType: employeeAvailabilityRules.availabilityType,
      effectiveFrom: employeeAvailabilityRules.effectiveFrom,
      effectiveUntil: employeeAvailabilityRules.effectiveUntil,
      notes: employeeAvailabilityRules.notes,
    }).from(employeeAvailabilityRules).where(and(
      eq(employeeAvailabilityRules.organizationId, scope.employee!.organizationId),
      eq(employeeAvailabilityRules.employeeId, scope.employee!.id),
      or(isNull(employeeAvailabilityRules.effectiveUntil), gte(employeeAvailabilityRules.effectiveUntil, today)),
    )).orderBy(
      asc(employeeAvailabilityRules.weekday),
      asc(employeeAvailabilityRules.effectiveFrom),
      asc(employeeAvailabilityRules.id),
    ).limit(MAX_ACTIVE_RULES + 1);

    return respond({
      rules: rows.slice(0, MAX_ACTIVE_RULES).map(row => ({
        id: row.id,
        weekday: row.weekday,
        startTime: row.startTime.slice(0, 5),
        endTime: row.endTime.slice(0, 5),
        availabilityType: row.availabilityType === "preferred" ? "preferred" :
          row.availabilityType === "unavailable" ? "unavailable" : "unknown",
        effectiveFrom: String(row.effectiveFrom),
        effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
        notes: row.notes,
      })),
      partial: rows.length > MAX_ACTIVE_RULES,
      source: "employee_availability_rules",
      note: "Preferences are not published shifts or approved leave; the schedule and payroll remain unchanged.",
    });
  } catch {
    return unavailable();
  }
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  try {
    const scope = await authenticatedEmployee();
    if (scope.denied) return scope.denied;
    if (new URL(request.url).search) return respond({ error: "Client-supplied scope is not accepted." }, 400);
    const session = scope.session!;
    const employee = scope.employee!;
    const demoDenied = publicDemoMutationDenied(session.email, "Employee availability preference");
    if (demoDenied) return demoDenied;
    const limited = await enforceSensitiveActionRateLimit(request, {
      userId: session.id, action: "self-workforce-availability-preference",
      resourceId: employee.id, limit: 12, windowMs: 15 * 60_000,
    });
    if (limited) return limited;

    let body: unknown;
    try {
      // Existing 2048-byte streaming/UTF-8/timeout parser; never parse
      // unbounded notes, forged scopes or client-controlled identities.
      body = await readScheduleReceiptBody(request);
    } catch (error) {
      if (error instanceof ScheduleReceiptBodyError) {
        return respond({ error: "Availability request requires valid JSON of at most 2048 bytes.", code: "AVAILABILITY_BODY_INVALID" }, error.status);
      }
      return respond({ error: "Invalid availability request." }, 400);
    }
    const now = manilaWorkDate();
    const candidate = body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown> : null;
    if (candidate?.action === "create") {
      const parsed = parseEmployeeAvailabilityDraft(body, now);
      if (!parsed.ok) return respond({ error: parsed.error }, 400);
      const value = parsed.value;
      const created = await db.transaction(async tx => {
        // Serialize concurrent ESS saves against the employee's own record.
        const [locked] = await tx.select({ id: employees.id }).from(employees).where(and(
          eq(employees.id, employee.id), eq(employees.organizationId, employee.organizationId),
        )).for("update").limit(1);
        if (!locked) throw new AvailabilityConflict("Employee scope changed. Refresh before editing.");
        const existing = await tx.select({
          id: employeeAvailabilityRules.id,
          weekday: employeeAvailabilityRules.weekday,
          startTime: employeeAvailabilityRules.startTime,
          endTime: employeeAvailabilityRules.endTime,
          availabilityType: employeeAvailabilityRules.availabilityType,
          effectiveFrom: employeeAvailabilityRules.effectiveFrom,
          effectiveUntil: employeeAvailabilityRules.effectiveUntil,
        }).from(employeeAvailabilityRules).where(and(
          eq(employeeAvailabilityRules.organizationId, employee.organizationId),
          eq(employeeAvailabilityRules.employeeId, employee.id),
          or(isNull(employeeAvailabilityRules.effectiveUntil), gte(employeeAvailabilityRules.effectiveUntil, now)),
        )).limit(MAX_ACTIVE_RULES + 1);
        if (existing.length >= MAX_ACTIVE_RULES) {
          throw new AvailabilityConflict("Your active availability list is full. Remove or end an old rule before adding another.");
        }
        for (const rule of existing) {
          const previous: EmployeeAvailabilityDraft = {
            weekday: rule.weekday, startTime: rule.startTime.slice(0, 5),
            endTime: rule.endTime.slice(0, 5),
            availabilityType: rule.availabilityType === "preferred" ? "preferred" : "unavailable",
            effectiveFrom: String(rule.effectiveFrom),
            effectiveUntil: rule.effectiveUntil ? String(rule.effectiveUntil) : null, notes: null,
          };
          if (sameAvailabilityRule(previous, value)) {
            throw new AvailabilityConflict("This availability rule has already been recorded.");
          }
          if (contradictoryAvailability(previous, value)) {
            throw new AvailabilityConflict("A conflicting preferred/unavailable window already exists for this weekday and date range.");
          }
        }
        const [row] = await tx.insert(employeeAvailabilityRules).values({
          organizationId: employee.organizationId, employeeId: employee.id,
          ...value, createdBy: session.name, createdByUserId: session.id,
        }).returning({ id: employeeAvailabilityRules.id });
        await tx.insert(auditEvents).values({
          organizationId: employee.organizationId, actor: session.name,
          action: "Employee WFM availability preference created",
          resource: employee.employeeNo + " · rule #" + row.id,
          metadata: { employeeId: employee.id, ruleId: row.id, weekday: value.weekday,
            availabilityType: value.availabilityType, effectiveFrom: value.effectiveFrom,
            effectiveUntil: value.effectiveUntil, timeWindow: [value.startTime, value.endTime],
            source: "self-service", publishedRosterChanged: false, payrollMutationPerformed: false },
        });
        return row.id;
      });
      return respond({ id: created, saved: true, publishedRosterChanged: false, payrollMutationPerformed: false }, 201);
    }
    if (candidate?.action === "remove") {
      const parsed = parseAvailabilityRemoval(body);
      if (!parsed.ok) return respond({ error: parsed.error }, 400);
      const result = await db.transaction(async tx => {
        const [rule] = await tx.select().from(employeeAvailabilityRules).where(and(
          eq(employeeAvailabilityRules.id, parsed.ruleId),
          eq(employeeAvailabilityRules.organizationId, employee.organizationId),
          eq(employeeAvailabilityRules.employeeId, employee.id),
        )).for("update").limit(1);
        if (!rule) throw new AvailabilityConflict("That rule is not in your current employee record.");
        const decision = availabilityRemovalDecision({
          effectiveFrom: String(rule.effectiveFrom),
          effectiveUntil: rule.effectiveUntil ? String(rule.effectiveUntil) : null,
        }, now);
        if (decision.action === "historical_rule") throw new AvailabilityConflict(decision.error);
        if (decision.action === "delete_future_rule") {
          await tx.delete(employeeAvailabilityRules).where(and(
            eq(employeeAvailabilityRules.id, rule.id),
            eq(employeeAvailabilityRules.organizationId, employee.organizationId),
            eq(employeeAvailabilityRules.employeeId, employee.id),
          ));
        } else {
          await tx.update(employeeAvailabilityRules)
            .set({ effectiveUntil: decision.effectiveUntil, updatedAt: new Date() })
            .where(and(
              eq(employeeAvailabilityRules.id, rule.id),
              eq(employeeAvailabilityRules.organizationId, employee.organizationId),
              eq(employeeAvailabilityRules.employeeId, employee.id),
            ));
        }
        await tx.insert(auditEvents).values({
          organizationId: employee.organizationId, actor: session.name,
          action: "Employee WFM availability preference withdrawn",
          resource: employee.employeeNo + " · rule #" + rule.id,
          metadata: {
            employeeId: employee.id, ruleId: rule.id, disposition: decision.action,
            weekday: rule.weekday, availabilityType: rule.availabilityType,
            effectiveFrom: String(rule.effectiveFrom), priorEffectiveUntil: rule.effectiveUntil,
            publishedRosterChanged: false, payrollMutationPerformed: false,
          },
        });
        return decision.action;
      });
      return respond({ removed: true, disposition: result, publishedRosterChanged: false, payrollMutationPerformed: false });
    }
    return respond({ error: "Use create or remove for your own availability." }, 400);
  } catch (error) {
    if (error instanceof AvailabilityConflict) return respond({ error: error.message }, 409);
    return unavailable();
  }
}
