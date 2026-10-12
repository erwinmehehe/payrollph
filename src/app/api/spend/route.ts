
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employees, expenseCategoryPolicies, expenseClaims, expenseReports, expenseReportItems, spendCards, spendCardTransactions } from "@/db/schema";
import { assertOrganizationRole, assertScope, getAccess, ORG_ADMIN_ROLES, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { enforceSameOriginMutation, requireSensitiveActionMfa, enforceSensitiveActionRateLimit } from "@/lib/security-request";
import { recordAuditEvent } from "@/lib/audit";
import { storedMoneyCentavos } from "@/lib/stored-money-centavos";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { approvedReimbursementAmount } from "@/lib/spend-payroll-reimbursement";

export const dynamic = "force-dynamic";
const validId = (v: unknown) => Number.isSafeInteger(Number(v)) && Number(v) > 0;
const validDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z")) && new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
function amount(v: unknown): string | null {
  const cents = storedMoneyCentavos(v);
  return cents != null && cents > 0 && cents <= 999999999999 ? (cents / 100).toFixed(2) : null;
}
async function auth(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(userId, organizationId, PEOPLE_PAYROLL_ROLES);
  if (denied) return { denied };
  const access = await getAccess(userId, organizationId);
  if (!access) return { denied: Response.json({ error: "Workspace access denied." }, { status: 403 }) };
  return { access };
}
async function employeeScope(organizationId: number, employeeId: number, access: NonNullable<Awaited<ReturnType<typeof getAccess>>>) {
  const [employee] = await db.select({ id: employees.id, orgUnitId: employees.orgUnitId }).from(employees)
    .where(and(eq(employees.organizationId, organizationId), eq(employees.id, employeeId))).limit(1);
  if (!employee) return Response.json({ error: "Employee not found." }, { status: 404 });
  const scope = assertScope(access, employee.orgUnitId);
  return scope.ok ? null : Response.json({ error: scope.error }, { status: scope.status });
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!validId(organizationId)) return Response.json({ error: "Valid organizationId required." }, { status: 400 });
  const context = await auth(user.id, organizationId);
  if (context.denied) return context.denied;
  const [staff, cards, charges, reports, items, claims] = await Promise.all([
    db.select({ id: employees.id, orgUnitId: employees.orgUnitId, firstName: employees.firstName, lastName: employees.lastName }).from(employees).where(eq(employees.organizationId, organizationId)),
    db.select().from(spendCards).where(eq(spendCards.organizationId, organizationId)),
    db.select().from(spendCardTransactions).where(eq(spendCardTransactions.organizationId, organizationId)),
    db.select().from(expenseReports).where(eq(expenseReports.organizationId, organizationId)),
    db.select().from(expenseReportItems).where(eq(expenseReportItems.organizationId, organizationId)),
    db.select().from(expenseClaims).where(eq(expenseClaims.organizationId, organizationId)),
  ]);
  const visible = new Set(staff.filter(e => context.access!.companyWide || e.orgUnitId === context.access!.orgUnitId).map(e => e.id));
  const visibleCards = cards.filter(c => c.employeeId != null ? visible.has(c.employeeId) : context.access!.companyWide);
  const visibleReports = reports.filter(r => visible.has(r.employeeId));
  return Response.json({
    employees: staff.filter(e => visible.has(e.id)),
    cards: visibleCards,
    transactions: charges.filter(t => visibleCards.some(c => c.id === t.cardId)),
    reports: visibleReports.map(r => {
      const claimIds = items.filter(i => i.reportId === r.id).map(i => i.claimId);
      const states = claimIds.map(id => claims.find(c => c.id === id)?.status ?? "missing");
      const reimbursementStatus = r.status !== "approved"
        ? "not_payable"
        : states.length > 0 && states.every(state => state === "paid")
          ? "paid"
          : states.some(state => state === "paid") ? "partially_paid" : "awaiting_payroll";
      return { ...r, claimIds, reimbursementStatus };
    }),
    unreportedClaims: claims.filter(c => visible.has(c.employeeId) && c.status === "pending" && !items.some(i => i.claimId === c.id)),
    spendPayrollEnabled: criticalReleaseFlagEnabled("spendPayroll"),
    canReviewCategories: criticalReleaseFlagEnabled("spendPayroll") &&
      context.access!.companyWide && ["owner", "admin"].includes(context.access!.role),
    categoryPolicies: criticalReleaseFlagEnabled("spendPayroll") ?
      await db.select().from(expenseCategoryPolicies).where(eq(expenseCategoryPolicies.organizationId, organizationId)) : [],
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  if (!validId(organizationId)) return Response.json({ error: "Valid organizationId required." }, { status: 400 });
  const context = await auth(user.id, organizationId);
  if (context.denied) return context.denied;
  const access = context.access!;
  const action = String(body.action ?? "");
  if (action === "category_policy") {
    if (!criticalReleaseFlagEnabled("spendPayroll")) return Response.json({ error: "Policy review is disabled." }, { status: 404 });
    const denied = await assertOrganizationRole(user.id, organizationId, ORG_ADMIN_ROLES);
    if (denied) return denied;
    if (!access.companyWide || !["owner", "admin"].includes(access.role)) {
      return Response.json({ error: "An independent company-wide owner/admin policy reviewer is required." }, { status: 403 });
    }
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;
    const rateDenied = await enforceSensitiveActionRateLimit(request, {
      userId: user.id, action: "expense-category-tax-review",
      resourceId: organizationId, limit: 10, windowMs: 60 * 60_000,
    });
    if (rateDenied) return rateDenied;
    const category = String(body.category ?? "").trim();
    const reviewReference = String(body.reviewReference ?? "").trim();
    if (category.length < 2 || category.length > 60 ||
      typeof body.taxable !== "boolean" ||
      reviewReference.length < 8 || reviewReference.length > 200) {
      return Response.json({ error: "Valid category, taxable flag, and audit reference required." }, { status: 422 });
    }
    const [row] = await db.insert(expenseCategoryPolicies).values({
      organizationId, category, taxable: body.taxable, reviewReference, reviewedByUserId: user.id,
    }).onConflictDoNothing().returning();
    if (!row) return Response.json({ error: "Category is already reviewed. Tax changes require a new governed policy." }, { status: 409 });
    await recordAuditEvent({
      organizationId, actor: user.name, action: "Expense category tax treatment approved",
      resource: String(row.id), metadata: { category, taxable: row.taxable, reviewReference, reviewedByUserId: user.id },
    });
    return Response.json(row, { status: 201 });
  }
  if (action === "card") {
    const employeeId = body.employeeId == null || body.employeeId === "" ? null : Number(body.employeeId);
    if (!access.companyWide && employeeId == null) return Response.json({ error: "Card requires an employee in your unit." }, { status: 403 });
    if (employeeId != null) {
      if (!validId(employeeId)) return Response.json({ error: "Invalid employee." }, { status: 422 });
      const denied = await employeeScope(organizationId, employeeId, access);
      if (denied) return denied;
    }
    const issuer = String(body.issuer ?? "").trim();
    const lastFour = String(body.lastFour ?? "").trim();
    const reference = String(body.reference ?? "").trim() || null;
    if (!issuer || issuer.length > 100 || !/^\d{4}$/.test(lastFour) || (reference && reference.length > 120)) return Response.json({ error: "Issuer and four digits required." }, { status: 422 });
    const [row] = await db.insert(spendCards).values({ organizationId, employeeId, issuer, lastFour, reference }).returning();
    await recordAuditEvent({ organizationId, actor: user.name, action: "Corporate card registered (metadata only)", resource: String(row.id), metadata: { cardId: row.id, employeeId } });
    return Response.json(row, { status: 201 });
  }
  if (action === "transaction") {
    const cardId = Number(body.cardId);
    const value = amount(body.amount);
    const merchant = String(body.merchant ?? "").trim();
    const reference = String(body.externalReference ?? "").trim();
    if (!validId(cardId) || !value || !validDate(body.spentOn) || !merchant || merchant.length > 160 || !reference || reference.length > 120) return Response.json({ error: "Valid card, amount, date, merchant, and unique reference required." }, { status: 422 });
    const [card] = await db.select().from(spendCards).where(and(eq(spendCards.id, cardId), eq(spendCards.organizationId, organizationId))).limit(1);
    if (!card || card.status !== "registered") return Response.json({ error: "Card unavailable." }, { status: 404 });
    if (card.employeeId != null) { const denied = await employeeScope(organizationId, card.employeeId, access); if (denied) return denied; }
    else if (!access.companyWide) return Response.json({ error: "Company-wide card is outside your scope." }, { status: 403 });
    const [row] = await db.insert(spendCardTransactions).values({
      organizationId, cardId, amount: value, spentOn: body.spentOn,
      merchant, externalReference: reference, category: String(body.category ?? "Other").slice(0, 60),
      recordedByUserId: user.id,
    }).onConflictDoNothing().returning();
    if (!row) return Response.json({ error: "Transaction reference already recorded for this card." }, { status: 409 });
    await recordAuditEvent({ organizationId, actor: user.name, action: "Company card charge recorded (not reimbursable)", resource: String(row.id), metadata: { cardId, transactionId: row.id } });
    return Response.json(row, { status: 201 });
  }
  if (action === "report") {
    const employeeId = Number(body.employeeId);
    const ids = body.claimIds;
    const title = String(body.title ?? "").trim();
    if (!validId(employeeId) || !Array.isArray(ids) || ids.length < 1 || ids.length > 50 || ids.some((i: unknown) => !validId(i)) || new Set(ids.map(Number)).size !== ids.length || title.length < 3 || title.length > 180)
      return Response.json({ error: "Employee, title, and 1-50 unique claim IDs required." }, { status: 422 });
    const denied = await employeeScope(organizationId, employeeId, access);
    if (denied) return denied;
    const claimIds = ids.map(Number);
    const report = await db.transaction(async tx => {
      await tx.execute(sql`select id from expense_claims where organization_id = ${organizationId} and id in (${sql.join(claimIds.map(id => sql`${id}`), sql`, `)}) for update`);
      const claims = await tx.select().from(expenseClaims).where(and(eq(expenseClaims.organizationId, organizationId), inArray(expenseClaims.id, claimIds), eq(expenseClaims.employeeId, employeeId)));
      if (claims.length !== claimIds.length || claims.some(c => c.status !== "pending" || c.payrollRunId != null)) throw new Error("Claims must belong to the same employee and remain pending.");
      const already = await tx.select({ claimId: expenseReportItems.claimId }).from(expenseReportItems).where(inArray(expenseReportItems.claimId, claimIds));
      if (already.length) throw new Error("A claim is already in a report.");
      const cents = claims.reduce((sum, c) => sum + (storedMoneyCentavos(c.amount) ?? 0), 0);
      if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error("Invalid claim total.");
      const [created] = await tx.insert(expenseReports).values({ organizationId, employeeId, title, totalAmount: (cents / 100).toFixed(2), submittedByUserId: user.id }).returning();
      await tx.insert(expenseReportItems).values(claimIds.map(claimId => ({ organizationId, reportId: created.id, claimId })));
      await tx.insert(auditEvents).values({
        organizationId, actor: user.name, action: "Expense report submitted", resource: String(created.id),
        metadata: { claimIds, employeeId, reportId: created.id, submittedByUserId: user.id },
      });
      return created;
    }).catch(e => e instanceof Error ? e : new Error("Report failed."));
    if (report instanceof Error) return Response.json({ error: report.message }, { status: 409 });
    return Response.json(report, { status: 201 });
  }
  return Response.json({ error: "Unknown action." }, { status: 422 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!validId(id)) return Response.json({ error: "Valid report id required." }, { status: 422 });
  const [existing] = await db.select().from(expenseReports).where(eq(expenseReports.id, id)).limit(1);
  if (!existing) return Response.json({ error: "Report not found." }, { status: 404 });
  const context = await auth(user.id, existing.organizationId);
  if (context.denied) return context.denied;
  const denied = await employeeScope(existing.organizationId, existing.employeeId, context.access!);
  if (denied) return denied;
  const status = body.status === "approved" || body.status === "rejected" ? body.status : null;
  if (!status) return Response.json({ error: "Approved or rejected required." }, { status: 422 });
  if (existing.submittedByUserId === user.id) return Response.json({ error: "Report submitter cannot decide their own report." }, { status: 403 });
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "expense-report-decision",
    resourceId: String(id), limit: 10, windowMs: 15 * 60_000,
  });
  if (rateDenied) return rateDenied;
  const outcome = await db.transaction(async tx => {
    const [report] = await tx.update(expenseReports).set({ status, decidedByUserId: user.id, decidedAt: new Date(), decisionNote: String(body.note ?? "").slice(0, 240) })
      .where(and(eq(expenseReports.id, id), eq(expenseReports.organizationId, existing.organizationId), eq(expenseReports.status, "submitted"))).returning();
    if (!report) throw new Error("Report already decided.");
    const items = await tx.select().from(expenseReportItems).where(and(eq(expenseReportItems.organizationId, existing.organizationId), eq(expenseReportItems.reportId, id)));
    if (!items.length) throw new Error("Report has no claims.");
    const claimIds = items.map(i => i.claimId);
    const spendEnabled = criticalReleaseFlagEnabled("spendPayroll");
    if (spendEnabled && status === "approved") {
      const claims = await tx.select().from(expenseClaims).where(and(
        eq(expenseClaims.organizationId, existing.organizationId),
        eq(expenseClaims.employeeId, existing.employeeId),
        inArray(expenseClaims.id, claimIds),
      ));
      if (claims.length !== claimIds.length || claims.some(claim =>
        !claim.receiptStorageKey || !claim.receiptSha256 || claim.categoryPolicyId == null ||
        approvedReimbursementAmount(claim.amount, claim.amount) === null)) {
        throw new Error("Each claim requires a scanned receipt and reviewed tax category before report approval.");
      }
    }
    const rows = await tx.update(expenseClaims).set({
      status: status, decidedBy: user.name,
      ...(spendEnabled ? { approvedAmount: status === "approved" ? sql`${expenseClaims.amount}` : null } : {}),
    }).where(and(
      eq(expenseClaims.organizationId, existing.organizationId), eq(expenseClaims.employeeId, existing.employeeId),
      inArray(expenseClaims.id, claimIds), eq(expenseClaims.status, "pending"),
    )).returning({ id: expenseClaims.id });
    if (rows.length !== claimIds.length) throw new Error("One or more claims already changed; refresh report.");
    await tx.insert(auditEvents).values({
      organizationId: existing.organizationId, actor: user.name, action: "Expense report " + status,
      resource: String(id), metadata: { reportId: id, employeeId: existing.employeeId, decidedByUserId: user.id },
    });
    return report;
  }).catch(e => e instanceof Error ? e : new Error("Decision failed."));
  if (outcome instanceof Error) return Response.json({ error: outcome.message }, { status: 409 });
  return Response.json(outcome);
}
