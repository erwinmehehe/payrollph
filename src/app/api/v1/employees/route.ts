import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { employeePayProfiles, employees } from "@/db/schema";
import { authenticateApiKey, requireScope } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { findReplay, storeReplay } from "@/lib/idempotency";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { dispatchWebhook } from "@/lib/webhooks";
import { ensureEmployeePayHistory } from "@/lib/pay-basis-schema";
import { recordEffectivePayChange } from "@/lib/pay-history-server";
import { resolvePayProfile } from "@/lib/pay-basis";

export const dynamic = "force-dynamic";

const ENDPOINT = "POST /api/v1/employees";

export async function GET(request: Request) {
  const limited = await rateLimitDistributed(`api:${clientIp(request)}`, { limit: 120, windowMs: 60_000 });
  if (!limited.allowed) {
    return Response.json({ error: "Rate limit exceeded.", mode: limited.mode, retryAfterMs: limited.retryAfterMs }, { status: 429 });
  }

  const auth = await authenticateApiKey(request);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  if (!requireScope(auth.scopes, "employees:read")) {
    return Response.json({ error: "API key is missing the employees:read scope." }, { status: 403 });
  }

  await ensureEmployeePayHistory(auth.organizationId);

  const { searchParams } = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));
  const offset = Math.max(0, Number(searchParams.get("offset") ?? 0));

  const [rows, payProfiles, [{ value: total }]] = await Promise.all([
    db.select().from(employees).where(eq(employees.organizationId, auth.organizationId)).orderBy(asc(employees.id)).limit(limit).offset(offset),
    db.select().from(employeePayProfiles).where(eq(employeePayProfiles.organizationId, auth.organizationId)),
    db.select({ value: count() }).from(employees).where(eq(employees.organizationId, auth.organizationId)),
  ]);
  const payByEmployee = new Map(payProfiles.map((profile) => [profile.employeeId, profile]));

  return Response.json({
    object: "list",
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total,
    data: rows.map((row) => {
      const profile = payByEmployee.get(row.id);
      return {
      id: row.id,
      employeeNo: row.employeeNo,
      firstName: row.firstName,
      lastName: row.lastName,
      title: row.title,
      employmentType: row.employmentType,
      status: row.status,
      monthlyBasic: row.basicRate,
      payBasis: profile?.payBasis ?? "monthly",
      payRate: profile?.rateAmount ?? row.basicRate,
      standardWorkDaysPerMonth: profile?.standardWorkDaysPerMonth ?? "22.00",
      standardHoursPerDay: profile?.standardHoursPerDay ?? "8.00",
      mwe: row.mwe,
      startDate: row.startDate,
    };
    }),
  });
}

export async function POST(request: Request) {
  const limited = await rateLimitDistributed(`api:${clientIp(request)}`, { limit: 120, windowMs: 60_000 });
  if (!limited.allowed) {
    return Response.json({ error: "Rate limit exceeded.", mode: limited.mode }, { status: 429 });
  }

  const auth = await authenticateApiKey(request);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  if (!requireScope(auth.scopes, "employees:write")) {
    return Response.json({ error: "API key is missing the employees:write scope." }, { status: 403 });
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (idempotencyKey) {
    const replay = await findReplay(auth.organizationId, idempotencyKey, ENDPOINT);
    if (replay) {
      return Response.json(replay.responseBody as never, {
        status: replay.responseStatus,
        headers: { "Idempotent-Replay": "true" },
      });
    }
  }

  const body = await request.json().catch(() => ({}));
  const firstName = String(body.firstName ?? "").trim();
  const lastName = String(body.lastName ?? "").trim();
  const title = String(body.title ?? "").trim();
  const rateAmount = Number(body.rateAmount ?? body.monthlyBasic ?? body.basicRate);
  const startDate = String(body.startDate ?? "").trim();

  const problems: string[] = [];
  if (!firstName) problems.push("firstName is required.");
  if (!lastName) problems.push("lastName is required.");
  if (!title) problems.push("title is required.");
  let payProfile;
  try {
    payProfile = resolvePayProfile({
      payBasis: String(body.payBasis ?? "monthly"),
      rateAmount,
      standardWorkDaysPerMonth: Number(body.standardWorkDaysPerMonth ?? 22),
      standardHoursPerDay: Number(body.standardHoursPerDay ?? 8),
    });
  } catch (error) {
    problems.push(error instanceof Error ? error.message : "Pay profile is invalid.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) problems.push("startDate must be YYYY-MM-DD.");
  if (problems.length) return Response.json({ error: "Validation failed.", problems }, { status: 422 });

  await ensureEmployeePayHistory(auth.organizationId);
  const [{ value: existing }] = await db.select({ value: count() }).from(employees).where(eq(employees.organizationId, auth.organizationId));
  const employeeNo = String(body.employeeNo ?? `API-${String(existing + 1).padStart(4, "0")}`).trim();

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Validation failed.", problems: ["email must be a valid address."] }, { status: 422 });
  }

  const [created] = await db.insert(employees).values({
    organizationId: auth.organizationId,
    employeeNo,
    firstName,
    lastName,
    title,
    employmentType: String(body.employmentType ?? "Regular"),
    status: String(body.status ?? "Active"),
    avatarInitials: `${firstName[0] ?? "?"}${lastName[0] ?? "?"}`.toUpperCase(),
    basicRate: payProfile!.monthlyEquivalent.toFixed(2),
    mwe: Boolean(body.mwe),
    email,
    startDate,
  }).returning();

  await recordEffectivePayChange({
    organizationId: auth.organizationId,
    employeeId: created.id,
    effectiveFrom: startDate,
    payProfile: payProfile!,
    reason: "Opening pay profile via API",
    actor: `api_key:${auth.keyId}`,
  });

  const payload = {
    id: created.id,
    employeeNo: created.employeeNo,
    firstName: created.firstName,
    lastName: created.lastName,
    title: created.title,
    status: created.status,
    monthlyBasic: created.basicRate,
    payBasis: payProfile!.payBasis,
    payRate: payProfile!.rateAmount.toFixed(2),
    standardWorkDaysPerMonth: payProfile!.standardWorkDaysPerMonth.toFixed(2),
    standardHoursPerDay: payProfile!.standardHoursPerDay.toFixed(2),
    startDate: created.startDate,
  };

  await recordAuditEvent({
    organizationId: auth.organizationId,
    actor: `api_key:${auth.keyId}`,
    action: "Employee created via API",
    resource: `${created.firstName} ${created.lastName}`,
    metadata: { employeeNo: created.employeeNo, idempotencyKey: idempotencyKey ?? null },
  });

  await dispatchWebhook({
    organizationId: auth.organizationId,
    event: "employee.onboarded",
    data: payload,
  });

  if (idempotencyKey) {
    await storeReplay({
      organizationId: auth.organizationId,
      keyValue: idempotencyKey,
      endpoint: ENDPOINT,
      responseStatus: 201,
      responseBody: payload,
    });
  }

  return Response.json(payload, { status: 201 });
}
