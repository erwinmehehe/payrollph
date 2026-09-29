import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employeePayProfiles, employees } from "@/db/schema";
import { authenticateApiKey, requireScope } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { dispatchWebhook } from "@/lib/webhooks";
import { seedProvisioning } from "@/lib/provisioning";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { ensureEmployeePayProfiles } from "@/lib/pay-basis-schema";
import { resolvePayProfile } from "@/lib/pay-basis";

export const dynamic = "force-dynamic";

async function authorize(request: Request, scope: string) {
  const limited = await rateLimitDistributed(`api:${clientIp(request)}`, { limit: 120, windowMs: 60_000 });
  if (!limited.allowed) return { error: Response.json({ error: "Rate limit exceeded.", mode: limited.mode }, { status: 429 }) };
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return { error: Response.json({ error: auth.error }, { status: auth.status }) };
  if (!requireScope(auth.scopes, scope)) {
    return { error: Response.json({ error: `API key is missing the ${scope} scope.` }, { status: 403 }) };
  }
  return { auth };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await authorize(request, "employees:read");
  if ("error" in gate && gate.error) return gate.error;
  const id = Number((await params).id);
  await ensureEmployeePayProfiles(gate.auth!.organizationId);
  const [row] = await db.select().from(employees).where(eq(employees.id, id));
  if (!row || row.organizationId !== gate.auth!.organizationId) {
    return Response.json({ error: "Employee not found." }, { status: 404 });
  }
  const [profile] = await db.select().from(employeePayProfiles).where(eq(employeePayProfiles.employeeId, id)).limit(1);
  return Response.json({
    ...row,
    payBasis: profile?.payBasis ?? "monthly",
    payRate: profile?.rateAmount ?? row.basicRate,
    standardWorkDaysPerMonth: profile?.standardWorkDaysPerMonth ?? "22.00",
    standardHoursPerDay: profile?.standardHoursPerDay ?? "8.00",
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await authorize(request, "employees:write");
  if ("error" in gate && gate.error) return gate.error;
  const id = Number((await params).id);
  const [existing] = await db.select().from(employees).where(eq(employees.id, id));
  if (!existing || existing.organizationId !== gate.auth!.organizationId) {
    return Response.json({ error: "Employee not found." }, { status: 404 });
  }

  await ensureEmployeePayProfiles(gate.auth!.organizationId);
  const [existingPayProfile] = await db.select().from(employeePayProfiles)
    .where(eq(employeePayProfiles.employeeId, id))
    .limit(1);

  const body = await request.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string") patch.title = body.title.trim();
  if (typeof body.status === "string") patch.status = body.status.trim();
  if (typeof body.employmentType === "string") patch.employmentType = body.employmentType.trim();
  const wantsPayUpdate = [
    body.payBasis,
    body.rateAmount,
    body.monthlyBasic,
    body.basicRate,
    body.standardWorkDaysPerMonth,
    body.standardHoursPerDay,
  ].some((value) => value !== undefined);
  let nextPayProfile = null;
  if (wantsPayUpdate) {
    try {
      nextPayProfile = resolvePayProfile({
        payBasis: String(body.payBasis ?? existingPayProfile?.payBasis ?? "monthly"),
        rateAmount: Number(body.rateAmount ?? body.monthlyBasic ?? body.basicRate ?? existingPayProfile?.rateAmount ?? existing.basicRate),
        standardWorkDaysPerMonth: Number(body.standardWorkDaysPerMonth ?? existingPayProfile?.standardWorkDaysPerMonth ?? 22),
        standardHoursPerDay: Number(body.standardHoursPerDay ?? existingPayProfile?.standardHoursPerDay ?? 8),
      });
      patch.basicRate = nextPayProfile.monthlyEquivalent.toFixed(2);
    } catch (error) {
      return Response.json({ error: "Validation failed.", problems: [error instanceof Error ? error.message : "Pay profile is invalid."] }, { status: 422 });
    }
  }
  if (typeof body.mwe === "boolean") patch.mwe = body.mwe;
  if (typeof body.region === "string") patch.region = body.region;
  if (typeof body.email === "string") patch.email = body.email.trim().toLowerCase() || null;

  if (Object.keys(patch).length === 0 && !nextPayProfile) {
    return Response.json({ error: "No updatable fields provided." }, { status: 422 });
  }

  const [updated] = await db.update(employees).set(patch).where(eq(employees.id, id)).returning();

  if (nextPayProfile) {
    await db.insert(employeePayProfiles).values({
      employeeId: id,
      organizationId: updated.organizationId,
      payBasis: nextPayProfile.payBasis,
      rateAmount: nextPayProfile.rateAmount.toFixed(2),
      standardWorkDaysPerMonth: nextPayProfile.standardWorkDaysPerMonth.toFixed(2),
      standardHoursPerDay: nextPayProfile.standardHoursPerDay.toFixed(2),
    }).onConflictDoUpdate({
      target: employeePayProfiles.employeeId,
      set: {
        payBasis: nextPayProfile.payBasis,
        rateAmount: nextPayProfile.rateAmount.toFixed(2),
        standardWorkDaysPerMonth: nextPayProfile.standardWorkDaysPerMonth.toFixed(2),
        standardHoursPerDay: nextPayProfile.standardHoursPerDay.toFixed(2),
        updatedAt: new Date(),
      },
    });
  }

  if (updated.status === "Separating" && existing.status !== "Separating") {
    await seedProvisioning(updated.organizationId, updated.id, "offboarding");
  }

  await recordAuditEvent({
    organizationId: updated.organizationId,
    actor: `api_key:${gate.auth!.keyId}`,
    action: "Employee updated via API",
    resource: `${updated.firstName} ${updated.lastName}`,
    metadata: {
      patch,
      payBasis: nextPayProfile?.payBasis ?? existingPayProfile?.payBasis ?? "monthly",
    },
  });

  return Response.json({
    ...updated,
    payBasis: nextPayProfile?.payBasis ?? existingPayProfile?.payBasis ?? "monthly",
    payRate: (nextPayProfile?.rateAmount ?? Number(existingPayProfile?.rateAmount ?? updated.basicRate)).toFixed(2),
    standardWorkDaysPerMonth: (nextPayProfile?.standardWorkDaysPerMonth ?? Number(existingPayProfile?.standardWorkDaysPerMonth ?? 22)).toFixed(2),
    standardHoursPerDay: (nextPayProfile?.standardHoursPerDay ?? Number(existingPayProfile?.standardHoursPerDay ?? 8)).toFixed(2),
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await authorize(request, "employees:write");
  if ("error" in gate && gate.error) return gate.error;
  const id = Number((await params).id);
  const [existing] = await db.select().from(employees).where(eq(employees.id, id));
  if (!existing || existing.organizationId !== gate.auth!.organizationId) {
    return Response.json({ error: "Employee not found." }, { status: 404 });
  }

  // Soft-delete: mark Separating and open the offboarding checklist rather than destroying payroll history.
  const [updated] = await db.update(employees).set({ status: "Separating" }).where(eq(employees.id, id)).returning();
  await seedProvisioning(updated.organizationId, updated.id, "offboarding");

  await recordAuditEvent({
    organizationId: updated.organizationId,
    actor: `api_key:${gate.auth!.keyId}`,
    action: "Employee offboarded via API",
    resource: `${updated.firstName} ${updated.lastName}`,
    metadata: { previousStatus: existing.status },
  });

  await dispatchWebhook({
    organizationId: updated.organizationId,
    event: "employee.offboarded",
    data: { id: updated.id, status: updated.status, action: "offboarded" },
  });

  return Response.json({ id: updated.id, status: updated.status, offboardingStarted: true });
}
