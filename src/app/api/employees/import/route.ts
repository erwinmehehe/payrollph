import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employees, importBatches } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { getEntitlements, requireFeature, seatUsage } from "@/lib/billing";
import { parseEmployeeCsv } from "@/lib/csv-import";
import { assertOrganizationRole, PEOPLE_ADMIN_ROLES } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const csv = typeof body.csv === "string" ? body.csv : "";
  const fileName = String(body.fileName ?? "upload.csv").slice(0, 200);
  const dryRun = Boolean(body.dryRun);

  if (!Number.isInteger(organizationId) || !csv.trim()) {
    return Response.json({ error: "organizationId and csv content are required." }, { status: 400 });
  }

  const deniedImport = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can import employee records.",
  );
  if (deniedImport) return deniedImport;

  const entitlements = await getEntitlements(organizationId);
  const gate = requireFeature(entitlements, "imports");
  if (gate) return gate;

  const parsed = parseEmployeeCsv(csv);
  if (parsed.valid.length === 0 && parsed.errors.length > 0) {
    return Response.json({
      error: "No valid rows found.",
      errors: parsed.errors.slice(0, 25),
      unmappedColumns: parsed.unmapped,
    }, { status: 422 });
  }

  // Seat limit is enforced before anything is written.
  const seats = await seatUsage(organizationId, entitlements.seatLimit);
  if (seats.limit != null && seats.used + parsed.valid.length > seats.limit) {
    return Response.json({
      error: `Import would take you to ${seats.used + parsed.valid.length} employees but the ${entitlements.plan} plan allows ${seats.limit} seats.`,
      plan: entitlements.plan,
      seatLimit: seats.limit,
      currentlyUsed: seats.used,
      rowsRequested: parsed.valid.length,
      upgradeRequired: true,
    }, { status: 402 });
  }

  const existing = await db.select({ employeeNo: employees.employeeNo })
    .from(employees)
    .where(eq(employees.organizationId, organizationId));
  const knownNumbers = new Set(existing.map((row) => row.employeeNo));

  const seen = new Set<string>();
  const toInsert: typeof employees.$inferInsert[] = [];
  const rowErrors = [...parsed.errors];
  let updatedCount = 0;

  for (const row of parsed.valid) {
    if (seen.has(row.employeeNo)) {
      rowErrors.push({ line: 0, problems: [`Duplicate employeeNo "${row.employeeNo}" inside the upload`] });
      continue;
    }
    seen.add(row.employeeNo);

    if (knownNumbers.has(row.employeeNo)) {
      // Update-in-place keeps re-uploading a corrected roster safe.
      await db.update(employees).set({
        firstName: row.firstName,
        lastName: row.lastName,
        title: row.title,
        employmentType: row.employmentType,
        status: row.status,
        basicRate: row.monthlyBasic.toFixed(2),
        mwe: row.mwe,
        region: row.region,
        email: row.email,
        mobile: row.mobile,
        bankAccount: row.bankAccount,
        bankCode: row.bankCode,
      }).where(and(eq(employees.organizationId, organizationId), eq(employees.employeeNo, row.employeeNo)));
      updatedCount += 1;
      continue;
    }

    toInsert.push({
      organizationId,
      employeeNo: row.employeeNo,
      firstName: row.firstName,
      lastName: row.lastName,
      title: row.title,
      employmentType: row.employmentType,
      status: row.status,
      avatarInitials: `${row.firstName[0] ?? "?"}${row.lastName[0] ?? "?"}`.toUpperCase(),
      basicRate: row.monthlyBasic.toFixed(2),
      mwe: row.mwe,
      region: row.region,
      email: row.email,
      mobile: row.mobile,
      bankAccount: row.bankAccount,
      bankCode: row.bankCode,
      startDate: new Date().toISOString().slice(0, 10),
    });
  }

  let createdCount = 0;
  if (!dryRun && toInsert.length > 0) {
    const inserted = await db.insert(employees).values(toInsert).returning({ id: employees.id });
    createdCount = inserted.length;
  }

  const [batch] = await db.insert(importBatches).values({
    organizationId,
    fileName,
    totalRows: parsed.valid.length + parsed.errors.length,
    createdCount: dryRun ? 0 : createdCount,
    updatedCount: dryRun ? 0 : updatedCount,
    errorCount: rowErrors.length,
    status: rowErrors.length > 0 ? "partial" : "completed",
    errors: rowErrors.slice(0, 100),
    createdBy: user.name,
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: dryRun ? "Employee import validated" : "Employee import completed",
    resource: fileName,
    metadata: {
      batchId: batch.id,
      created: dryRun ? 0 : createdCount,
      updated: dryRun ? 0 : updatedCount,
      errors: rowErrors.length,
      plan: entitlements.plan,
    },
  });

  return Response.json({
    batchId: batch.id,
    dryRun,
    fileName,
    totalRows: batch.totalRows,
    createdCount: batch.createdCount,
    updatedCount: batch.updatedCount,
    errorCount: rowErrors.length,
    errors: rowErrors.slice(0, 25),
    unmappedColumns: parsed.unmapped,
    seatUsage: { used: seats.used + (dryRun ? 0 : createdCount), limit: seats.limit },
  });
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId") ?? "1");
  const deniedList = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can view import history.",
  );
  if (deniedList) return deniedList;
  const batches = await db.select().from(importBatches).where(eq(importBatches.organizationId, organizationId));
  return Response.json({ batches: batches.slice(-10).reverse() });
}

export const TEMPLATE_CSV = `Employee No,First Name,Last Name,Title,Employment Type,Status,Monthly Basic,MWE,Region,Email,Mobile,Bank Account,Bank Code
EMP-001,Juan,Dela Cruz,Driver,Regular,Active,21500.00,no,NCR,juan@example.com,09171234567,1234567890,BDO
EMP-002,Maria,Santos,Bookkeeper,Regular,Active,28000.00,no,III,maria@example.com,09181234567,1234567891,BPI
EMP-003,Pedro,Reyes,Helper,Probationary,Active,6450.00,yes,NCR,,,,
`;
