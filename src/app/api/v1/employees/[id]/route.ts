import { and, asc, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import {
  employeePayProfiles,
  employeePayRevisions,
  employeePayRetroAdjustments,
  employees,
  payrollEntries,
  payrollRuns,
} from "@/db/schema";
import { authenticateApiKey, requireScope } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { dispatchWebhook } from "@/lib/webhooks";
import { seedProvisioning } from "@/lib/provisioning";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { ensureEmployeePayProfiles } from "@/lib/pay-basis-schema";
import { fixedMonthlyBasicForTimeline, resolvePayProfile, resolvePayTimeline } from "@/lib/pay-basis";

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
  const [row] = await db.select().from(employees).where(and(
    eq(employees.id, id),
    eq(employees.organizationId, gate.auth!.organizationId),
  ));
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
  const [existing] = await db.select().from(employees).where(and(
    eq(employees.id, id),
    eq(employees.organizationId, gate.auth!.organizationId),
  ));
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
  let payEffectiveDate: string | null = null;
  let payChangeReason: string | null = null;
  if (wantsPayUpdate) {
    payEffectiveDate = String(body.payEffectiveDate ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date())).trim();
    payChangeReason = String(body.payChangeReason ?? "API pay adjustment").trim();
    const todayPh = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payEffectiveDate)) {
      return Response.json({ error: "Validation failed.", problems: ["payEffectiveDate must be YYYY-MM-DD."] }, { status: 422 });
    }
    if (payEffectiveDate < String(existing.startDate)) {
      return Response.json({ error: "Validation failed.", problems: ["payEffectiveDate cannot be before the employee start date."] }, { status: 422 });
    }
    if (payEffectiveDate > todayPh) {
      return Response.json({ error: "Validation failed.", problems: ["Future-dated pay changes are not applied early."] }, { status: 422 });
    }
    if (!payChangeReason) {
      return Response.json({ error: "Validation failed.", problems: ["payChangeReason is required for pay updates."] }, { status: 422 });
    }
    const [latestRevision] = await db.select().from(employeePayRevisions)
      .where(and(
        eq(employeePayRevisions.organizationId, gate.auth!.organizationId),
        eq(employeePayRevisions.employeeId, id),
      ))
      .orderBy(desc(employeePayRevisions.effectiveDate), desc(employeePayRevisions.id))
      .limit(1);
    if (latestRevision && payEffectiveDate < String(latestRevision.effectiveDate)) {
      return Response.json({
        error: "Validation failed.",
        problems: [`A later pay change already exists effective ${latestRevision.effectiveDate}; API pay changes must be added chronologically.`],
      }, { status: 409 });
    }

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

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx.update(employees).set(patch).where(eq(employees.id, id)).returning();
    let revisionId: number | null = null;
    let retroAdjustments = 0;
    let retroTotal = 0;

    if (nextPayProfile && payEffectiveDate) {
      const [sameDayRevision] = await tx.select().from(employeePayRevisions)
        .where(and(
          eq(employeePayRevisions.employeeId, id),
          eq(employeePayRevisions.effectiveDate, payEffectiveDate),
        ))
        .limit(1);

      const previousPayBasis = sameDayRevision?.previousPayBasis ?? existingPayProfile?.payBasis ?? "monthly";
      const previousRateAmount = Number(sameDayRevision?.previousRateAmount ?? existingPayProfile?.rateAmount ?? existing.basicRate);
      const previousStandardWorkDaysPerMonth = Number(
        sameDayRevision?.previousStandardWorkDaysPerMonth ?? existingPayProfile?.standardWorkDaysPerMonth ?? 22,
      );
      const previousStandardHoursPerDay = Number(
        sameDayRevision?.previousStandardHoursPerDay ?? existingPayProfile?.standardHoursPerDay ?? 8,
      );

      const [revision] = await tx.insert(employeePayRevisions).values({
        employeeId: id,
        organizationId: updated.organizationId,
        effectiveDate: payEffectiveDate,
        previousPayBasis,
        previousRateAmount: previousRateAmount.toFixed(2),
        previousStandardWorkDaysPerMonth: previousStandardWorkDaysPerMonth.toFixed(2),
        previousStandardHoursPerDay: previousStandardHoursPerDay.toFixed(2),
        newPayBasis: nextPayProfile.payBasis,
        newRateAmount: nextPayProfile.rateAmount.toFixed(2),
        newStandardWorkDaysPerMonth: nextPayProfile.standardWorkDaysPerMonth.toFixed(2),
        newStandardHoursPerDay: nextPayProfile.standardHoursPerDay.toFixed(2),
        reason: payChangeReason ?? "API pay adjustment",
        createdBy: `api_key:${gate.auth!.keyId}`,
      }).onConflictDoUpdate({
        target: [employeePayRevisions.employeeId, employeePayRevisions.effectiveDate],
        set: {
          newPayBasis: nextPayProfile.payBasis,
          newRateAmount: nextPayProfile.rateAmount.toFixed(2),
          newStandardWorkDaysPerMonth: nextPayProfile.standardWorkDaysPerMonth.toFixed(2),
          newStandardHoursPerDay: nextPayProfile.standardHoursPerDay.toFixed(2),
          reason: payChangeReason ?? "API pay adjustment",
          createdBy: `api_key:${gate.auth!.keyId}`,
          createdAt: new Date(),
        },
      }).returning({ id: employeePayRevisions.id });
      revisionId = revision.id;

      await tx.insert(employeePayProfiles).values({
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

      if (previousPayBasis === "monthly" && nextPayProfile.payBasis === "monthly") {
        const impacted = await tx.select({
          runId: payrollRuns.id,
          periodLabel: payrollRuns.periodLabel,
          periodStart: payrollRuns.periodStart,
          periodEnd: payrollRuns.periodEnd,
          lineItems: payrollEntries.lineItems,
        })
          .from(payrollRuns)
          .innerJoin(payrollEntries, and(
            eq(payrollEntries.payrollRunId, payrollRuns.id),
            eq(payrollEntries.employeeId, id),
          ))
          .where(and(
            eq(payrollRuns.organizationId, updated.organizationId),
            eq(payrollRuns.status, "Released"),
            gte(payrollRuns.periodEnd, payEffectiveDate),
          ));

        const revisionRows = await tx.select().from(employeePayRevisions)
          .where(and(
            eq(employeePayRevisions.organizationId, updated.organizationId),
            eq(employeePayRevisions.employeeId, id),
          ))
          .orderBy(asc(employeePayRevisions.effectiveDate), asc(employeePayRevisions.id));

        for (const released of impacted) {
          const timeline = resolvePayTimeline({
            currentProfile: {
              payBasis: nextPayProfile.payBasis,
              rateAmount: nextPayProfile.rateAmount,
              standardWorkDaysPerMonth: nextPayProfile.standardWorkDaysPerMonth,
              standardHoursPerDay: nextPayProfile.standardHoursPerDay,
            },
            revisions: revisionRows.map((row) => ({
              effectiveDate: String(row.effectiveDate),
              previousPayBasis: row.previousPayBasis,
              previousRateAmount: row.previousRateAmount,
              previousStandardWorkDaysPerMonth: row.previousStandardWorkDaysPerMonth,
              previousStandardHoursPerDay: row.previousStandardHoursPerDay,
              newPayBasis: row.newPayBasis,
              newRateAmount: row.newRateAmount,
              newStandardWorkDaysPerMonth: row.newStandardWorkDaysPerMonth,
              newStandardHoursPerDay: row.newStandardHoursPerDay,
              reason: row.reason,
            })),
            periodStart: String(released.periodStart),
            periodEnd: String(released.periodEnd),
          });
          if (timeline.some((segment) => segment.profile.payBasis !== "monthly")) continue;
          const expectedBasic = fixedMonthlyBasicForTimeline(
            timeline,
            String(released.periodStart),
            String(released.periodEnd),
          );
          const releasedLines = Array.isArray(released.lineItems)
            ? released.lineItems as Array<Record<string, unknown>>
            : [];
          const releasedBasic = Number(releasedLines.find((line) => line.code === "BASIC")?.amount ?? NaN);
          if (!Number.isFinite(releasedBasic)) continue;
          const amount = Math.round((expectedBasic - releasedBasic + Number.EPSILON) * 100) / 100;
          if (Math.abs(amount) < 0.005) continue;

          await tx.insert(employeePayRetroAdjustments).values({
            organizationId: updated.organizationId,
            employeeId: id,
            revisionId: revision.id,
            sourcePayrollRunId: released.runId,
            sourcePeriodLabel: released.periodLabel,
            amount: amount.toFixed(2),
            status: "pending",
          }).onConflictDoUpdate({
            target: [employeePayRetroAdjustments.revisionId, employeePayRetroAdjustments.sourcePayrollRunId],
            set: {
              amount: amount.toFixed(2),
              status: "pending",
              settledPayrollRunId: null,
              settledAt: null,
            },
          });
          retroAdjustments += 1;
          retroTotal += amount;
        }
      }
    }

    return { updated, revisionId, retroAdjustments, retroTotal };
  });
  const updated = result.updated;

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
      payEffectiveDate,
      payChangeReason,
      payRevisionId: result.revisionId,
      retroAdjustments: result.retroAdjustments,
      retroTotal: result.retroTotal,
    },
  });

  return Response.json({
    ...updated,
    payBasis: nextPayProfile?.payBasis ?? existingPayProfile?.payBasis ?? "monthly",
    payRate: (nextPayProfile?.rateAmount ?? Number(existingPayProfile?.rateAmount ?? updated.basicRate)).toFixed(2),
    standardWorkDaysPerMonth: (nextPayProfile?.standardWorkDaysPerMonth ?? Number(existingPayProfile?.standardWorkDaysPerMonth ?? 22)).toFixed(2),
    standardHoursPerDay: (nextPayProfile?.standardHoursPerDay ?? Number(existingPayProfile?.standardHoursPerDay ?? 8)).toFixed(2),
    payChange: nextPayProfile ? {
      effectiveDate: payEffectiveDate,
      reason: payChangeReason,
      revisionId: result.revisionId,
      retroAdjustments: result.retroAdjustments,
      retroTotal: Number(result.retroTotal.toFixed(2)),
    } : null,
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await authorize(request, "employees:write");
  if ("error" in gate && gate.error) return gate.error;
  const id = Number((await params).id);
  const [existing] = await db.select().from(employees).where(and(
    eq(employees.id, id),
    eq(employees.organizationId, gate.auth!.organizationId),
  ));
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
