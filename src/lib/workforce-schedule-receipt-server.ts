import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employees, userOrganizations, users, worksites } from "@/db/schema";
import { PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { managerReceiptDays, summarizeManagerReceiptDays } from "./workforce-schedule-receipt-review";
import { workforceScheduleReceipts as receipts } from "./workforce-schedule-receipt-schema";
import { resolveEmployeeScheduleWindow } from "./workforce-schedule-window";
import { manilaWorkDate } from "./workforce-employee-upcoming-week";
import { parseScheduleReceipt, receiptDate, receiptDates, receiptState, scheduleReceiptHash, receiptContextDates, projectReceiptWindow, validReceiptId,
  SCHEDULE_RECEIPT_BOUNDARY, type ScheduleReceiptDay, type ScheduleReceiptView } from "./workforce-schedule-receipt";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ReceiptIdentity = { organizationId: number; employeeId: number; userId: number };
export class ScheduleReceiptError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 409) { super(message); this.code = code; this.status = status; }
}
// A function is deliberately evaluated after waits, not in a default argument.
// Fixed dates remain available to isolated service fixtures; HTTP callers never
// accept a clock or date-window override from the request.
type ReceiptDayClock = string | (() => string);
function currentReceiptDay(clock: ReceiptDayClock): string {
  return receiptDate(typeof clock === "function" ? clock() : clock);
}
function assertCurrentReceiptDates(dates: readonly string[], clock: ReceiptDayClock) {
  const current = new Set(receiptDates(currentReceiptDay(clock)));
  if (dates.some(date => !current.has(date))) {
    throw new ScheduleReceiptError("SCHEDULE_RECEIPT_WINDOW_CHANGED",
      "The Philippine work date changed. Refresh and review the current schedule before acknowledging.");
  }
}
async function assertBoundIdentity(tx: Tx, who: ReceiptIdentity) {
  if (![who.organizationId, who.employeeId, who.userId].every(validReceiptId)) {
    throw new ScheduleReceiptError("RECEIPT_IDENTITY_INVALID", "Employee access could not be verified.", 403);
  }
  const [row] = await tx.select({ id: employees.id }).from(employees)
    .innerJoin(users, and(eq(users.id, who.userId), eq(users.employeeId, employees.id), eq(users.active, true), eq(users.role, "employee")))
    .innerJoin(userOrganizations, and(eq(userOrganizations.userId, users.id), eq(userOrganizations.organizationId, employees.organizationId), eq(userOrganizations.active, true), eq(userOrganizations.role, "employee")))
    .where(and(eq(employees.id, who.employeeId), eq(employees.organizationId, who.organizationId), eq(employees.status, "Active")))
    .limit(1).for("share");
  if (!row) throw new ScheduleReceiptError("RECEIPT_ACCESS_REVOKED", "Your active employee access could not be verified.", 403);
}
async function projectedDays(tx: Tx, who: Pick<ReceiptIdentity, "organizationId" | "employeeId">, dates: string[]) {
  // A single POST also needs both neighboring dates; otherwise a previous
  // overnight shift or next-day start can overlap outside the requested date.
  const contextDates = receiptContextDates(dates);
  const days = await resolveEmployeeScheduleWindow({ organizationId: who.organizationId, employeeId: who.employeeId,
    startDate: contextDates[0], endDate: contextDates[contextDates.length - 1], executor: tx });
  const siteIds = [...new Set(days.flatMap(day => day.worksiteId === null ? [] : [day.worksiteId]))];
  const sites = siteIds.length ? await tx.select({ id: worksites.id, name: worksites.name }).from(worksites)
    .where(and(eq(worksites.organizationId, who.organizationId), inArray(worksites.id, siteIds))) : [];
  return projectReceiptWindow(days, dates, sites).map(({ date, snapshot }) => ({
    date, snapshot, snapshotHash: snapshot ? scheduleReceiptHash(who.organizationId, who.employeeId, snapshot) : null,
  }));
}
function ownReceipt(who: ReceiptIdentity, date: string) {
  return and(eq(receipts.organizationId, who.organizationId), eq(receipts.employeeId, who.employeeId),
    eq(receipts.acknowledgedByUserId, who.userId), eq(receipts.workDate, date));
}
export async function readScheduleReceiptView(who: ReceiptIdentity, today: ReceiptDayClock = manilaWorkDate): Promise<ScheduleReceiptView> {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(6107, ${who.organizationId})`);
    await assertBoundIdentity(tx, who);
    const dates = receiptDates(currentReceiptDay(today));
    const projected = await projectedDays(tx, who, dates);
    const days: ScheduleReceiptDay[] = [];
    for (const day of projected) {
      // Exact-content match first; otherwise one historical row is enough to label a changed snapshot.
      const current = day.snapshotHash ? await tx.select({ snapshotHash: receipts.snapshotHash, acknowledgedAt: receipts.acknowledgedAt })
        .from(receipts).where(and(ownReceipt(who, day.date), eq(receipts.snapshotHash, day.snapshotHash))).limit(1) : [];
      const prior = current.length || !day.snapshotHash ? current : await tx.select({ snapshotHash: receipts.snapshotHash, acknowledgedAt: receipts.acknowledgedAt })
        .from(receipts).where(ownReceipt(who, day.date)).orderBy(desc(receipts.id)).limit(1);
      days.push({ ...day, ...receiptState(day.snapshotHash, prior) });
    }
    assertCurrentReceiptDates(dates, today);
    return { days, boundary: SCHEDULE_RECEIPT_BOUNDARY };
  }, { isolationLevel: "read committed" });
}
export async function acknowledgeScheduleReceipt(who: ReceiptIdentity, body: unknown, today: ReceiptDayClock = manilaWorkDate) {
  const request = parseScheduleReceipt(body, currentReceiptDay(today));
  return db.transaction(async tx => {
    // Shared with published roster writers: re-read source only AFTER acquiring the lock.
    await tx.execute(sql`select pg_advisory_xact_lock(6107, ${who.organizationId})`);
    await assertBoundIdentity(tx, who);
    assertCurrentReceiptDates([request.workDate], today);
    const [current] = await projectedDays(tx, who, [request.workDate]);
    if (!current.snapshot || !current.snapshotHash) throw new ScheduleReceiptError("SCHEDULE_UNAVAILABLE", "A complete published schedule is required before acknowledgment.");
    if (current.snapshotHash !== request.snapshotHash) throw new ScheduleReceiptError("SCHEDULE_CHANGED", "The schedule changed. Refresh and review it before acknowledging.");
    const [existing] = await tx.select({ acknowledgedAt: receipts.acknowledgedAt }).from(receipts)
      .where(and(ownReceipt(who, request.workDate), eq(receipts.snapshotHash, current.snapshotHash))).limit(1);
    // Source reads can themselves cross midnight; recheck before either a
    // duplicate success response or an insert, not only after acquiring the lock.
    assertCurrentReceiptDates([request.workDate], today);
    if (existing) return { created: false, workDate: request.workDate, snapshotHash: current.snapshotHash, acknowledgedAt: existing.acknowledgedAt.toISOString() };
    const [created] = await tx.insert(receipts).values({ organizationId: who.organizationId, employeeId: who.employeeId,
      acknowledgedByUserId: who.userId, workDate: request.workDate, snapshotHash: current.snapshotHash,
      // DEFAULT now() is transaction start, which can precede the roster-lock
      // wait. Record actual insertion time without rewriting historical rows.
      acknowledgedAt: sql`clock_timestamp()`,
      snapshot: current.snapshot }).returning({ id: receipts.id, acknowledgedAt: receipts.acknowledgedAt });
    // Throwing here rolls back a tentative insert if its day expired during I/O.
    assertCurrentReceiptDates([request.workDate], today);
    await tx.insert(auditEvents).values({ organizationId: who.organizationId, actor: "User #" + who.userId,
      action: "WFM employee schedule receipt acknowledged", resource: "Employee #" + who.employeeId + " / " + request.workDate,
      metadata: { receiptId: created.id, employeeId: who.employeeId, userId: who.userId, workDate: request.workDate,
        snapshotHash: current.snapshotHash, attendanceChanged: false, payrollChanged: false, notificationSent: false } });
    return { created: true, workDate: request.workDate, snapshotHash: current.snapshotHash, acknowledgedAt: created.acknowledgedAt.toISOString() };
  }, { isolationLevel: "read committed" });
}

/**
 * Selected-worker, read-only receipt review for authorized People admins.
 * Never returns prior snapshot JSON, receipt hashes, pay data or user logins.
 * Access is checked by the route AND rechecked after the organization roster lock.
 */
export async function readManagerScheduleReceiptView(input: {
  managerUserId: number;
  organizationId: number;
  employeeId: number;
}, today: () => string = manilaWorkDate) {
  if (![input.managerUserId, input.organizationId, input.employeeId].every(validReceiptId)) {
    throw new ScheduleReceiptError("RECEIPT_REVIEW_SCOPE_INVALID", "Invalid employee review scope.", 400);
  }
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(6107, ${input.organizationId})`);
    const [manager] = await tx.select({
      role: userOrganizations.role, orgUnitId: userOrganizations.orgUnitId,
    }).from(userOrganizations).innerJoin(users, eq(users.id, userOrganizations.userId))
      .where(and(
        eq(userOrganizations.organizationId, input.organizationId),
        eq(userOrganizations.userId, input.managerUserId),
        eq(userOrganizations.active, true), eq(users.active, true),
      )).limit(1);
    if (!manager || !PEOPLE_ADMIN_ROLES.includes(manager.role as typeof PEOPLE_ADMIN_ROLES[number])) {
      throw new ScheduleReceiptError("RECEIPT_REVIEW_DENIED", "People administrator access is required.", 403);
    }

    const [employee] = await tx.select({
      id: employees.id, orgUnitId: employees.orgUnitId,
      employeeNo: employees.employeeNo, firstName: employees.firstName,
      lastName: employees.lastName, status: employees.status,
    }).from(employees).where(and(
      eq(employees.organizationId, input.organizationId),
      eq(employees.id, input.employeeId),
    )).limit(1);
    if (!employee || (manager.orgUnitId !== null && manager.orgUnitId !== employee.orgUnitId)) {
      throw new ScheduleReceiptError("RECEIPT_REVIEW_SCOPE_DENIED",
        "Employee is outside your permitted People scope.", 403);
    }
    if (employee.status !== "Active") {
      throw new ScheduleReceiptError("RECEIPT_REVIEW_NOT_ACTIVE",
        "Only active employees have a current acknowledgment review.", 409);
    }
    const label = {
      employeeNo: employee.employeeNo,
      name: (employee.firstName + " " + employee.lastName).trim(),
    };
    const accountRows = await tx.select({ userId: users.id }).from(users)
      .innerJoin(userOrganizations, and(
        eq(userOrganizations.userId, users.id),
        eq(userOrganizations.organizationId, input.organizationId),
        eq(userOrganizations.active, true),
        eq(userOrganizations.role, "employee"),
      )).where(and(
        eq(users.employeeId, input.employeeId),
        eq(users.role, "employee"), eq(users.active, true),
      )).limit(2);
    if (accountRows.length !== 1) {
      return {
        employee: label,
        account: accountRows.length === 0 ? "not_enrolled" as const : "identity_review" as const,
        days: [],
        summary: null,
        boundary: SCHEDULE_RECEIPT_BOUNDARY,
      };
    }

    const dates = receiptDates(currentReceiptDay(today));
    const projected = await projectedDays(tx, input, dates);
    const userId = accountRows[0].userId;
    const common = and(
      eq(receipts.organizationId, input.organizationId),
      eq(receipts.employeeId, input.employeeId),
      eq(receipts.acknowledgedByUserId, userId),
      inArray(receipts.workDate, dates),
    );
    const hashes = [...new Set(projected.flatMap(day => day.snapshotHash ? [day.snapshotHash] : []))];
    const current = hashes.length ? await tx.select({
      workDate: receipts.workDate, snapshotHash: receipts.snapshotHash,
      acknowledgedAt: receipts.acknowledgedAt,
    }).from(receipts).where(and(common, inArray(receipts.snapshotHash, hashes))) : [];
    const previous = await tx.select({ workDate: receipts.workDate })
      .from(receipts).where(common).groupBy(receipts.workDate);

    // If midnight passes while waiting on the roster lock or source queries,
    // return a refresh error, not an obsolete status summary.
    assertCurrentReceiptDates(dates, today);
    const days = managerReceiptDays(projected, current, new Set(previous.map(row => String(row.workDate))));
    return {
      employee: label, account: "ready" as const,
      days, summary: summarizeManagerReceiptDays(days),
      boundary: SCHEDULE_RECEIPT_BOUNDARY,
    };
  }, { isolationLevel: "read committed" });
}
