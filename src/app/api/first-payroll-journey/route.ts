import { readFirstPayrollProgress, saveFirstPayrollProgress } from "@/lib/first-payroll-progress-server";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { employees, organizations, payrollRuns, userOrganizations, users, workforceAttendancePeriodLocks } from "@/db/schema";
import { journeyAccess } from "@/lib/first-payroll-journey-access";
import { FIRST_PAYROLL_STEPS, validJourneySchedule, type JourneyRole } from "@/lib/first-payroll-journey";
import { buildFirstPayrollReadiness } from "@/lib/first-payroll-readiness";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { requireSaasPaidWrites } from "@/lib/saas-workspace-access";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  const auth = await journeyAccess(organizationId);
  if (auth instanceof Response) return auth;
  const [company, roster, memberships, runs, progress] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1),
    db.select({ status: employees.status, bankAccount: employees.bankAccount, bankCode: employees.bankCode }).from(employees).where(eq(employees.organizationId, organizationId)),
    db.select({ role: userOrganizations.role, name: users.name }).from(userOrganizations).innerJoin(users, eq(users.id, userOrganizations.userId)).where(and(eq(userOrganizations.organizationId, organizationId), eq(userOrganizations.active, true))),
    db.select({ status: payrollRuns.status }).from(payrollRuns).where(eq(payrollRuns.organizationId, organizationId)),
    readFirstPayrollProgress(organizationId),
  ]);
  if (!company[0]) return Response.json({ error: "Employer not found." }, { status: 404 });
  const schedule = (progress.find(p => p.step === "company")?.data as { schedule?: unknown } | undefined)?.schedule;
  const locks = validJourneySchedule(schedule) ? await db.select({ reviewerId: workforceAttendancePeriodLocks.lockedByUserId }).from(workforceAttendancePeriodLocks).where(and(
    eq(workforceAttendancePeriodLocks.organizationId, organizationId), eq(workforceAttendancePeriodLocks.status, "locked"), eq(workforceAttendancePeriodLocks.lockType, "payroll_cutoff"), lte(workforceAttendancePeriodLocks.periodStart, schedule.periodStart), gte(workforceAttendancePeriodLocks.periodEnd, schedule.periodEnd),
  )).limit(1) : [];
  return Response.json({ company: company[0], memberships, progress, timeReviewed: Boolean(locks[0]?.reviewerId), role: auth.access.role, readiness: buildFirstPayrollReadiness({ workspaceName: company[0].name, employees: roster, memberships, payrollStatuses: runs.map(r => r.status) }) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const auth = await journeyAccess(organizationId);
  if (auth instanceof Response) return auth;
  const demoDenied = publicDemoMutationDenied(auth.user.email, "First payroll journey");
  if (demoDenied) return demoDenied;
  const paidDenied = await requireSaasPaidWrites(organizationId);
  if (paidDenied) return paidDenied;
  const mfaDenied = requireSensitiveActionMfa(auth.user);
  if (mfaDenied) return mfaDenied;
  const step = FIRST_PAYROLL_STEPS.find(s => s.key === body.step);
  if (!step) return Response.json({ error: "Unknown journey step." }, { status: 400 });
  if (body.schedule !== undefined && (step.key !== "company" || !["owner", "admin", "payroll", "bookkeeper"].includes(auth.access.role) || !validJourneySchedule(body.schedule))) return Response.json({ error: "A payroll administrator must provide a valid cutoff and pay date (up to 16 days)." }, { status: 422 });
  const ownerRole = body.ownerRole ?? step.ownerRole;
  if (!["owner", "hr", "payroll", "checker", "bookkeeper"].includes(ownerRole)) return Response.json({ error: "Unsupported handoff role." }, { status: 400 });
  // Atomic per-step upsert preserves another person's schedule during a handoff.
  // No client-supplied completion flag can authorize attendance or payment.
  const progress = await saveFirstPayrollProgress({ organizationId, step: step.key, ownerRole: ownerRole as JourneyRole, actorId: auth.user.id, ...(body.schedule !== undefined ? { schedule: body.schedule } : {}) });
  await recordAuditEvent({ organizationId, actor: auth.user.name, action: "First payroll journey updated", resource: step.title, metadata: { step: step.key, ownerRole, scheduleChanged: body.schedule !== undefined } });
  return Response.json({ progress });
}
