import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employees, userOrganizations, users, worksites } from "@/db/schema";
import { workforceScheduleReceipts as receipts } from "./workforce-schedule-receipt-schema";
import { resolveEmployeeScheduleWindow } from "./workforce-schedule-window";
import { manilaWorkDate } from "./workforce-employee-upcoming-week";
import { parseScheduleReceipt, receiptDates, receiptState, scheduleReceiptHash, receiptContextDates, projectReceiptWindow, validReceiptId,
  SCHEDULE_RECEIPT_BOUNDARY, type ScheduleReceiptDay, type ScheduleReceiptView } from "./workforce-schedule-receipt";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ReceiptIdentity = { organizationId: number; employeeId: number; userId: number };
export class ScheduleReceiptError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 409) { super(message); this.code = code; this.status = status; }
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
async function projectedDays(tx: Tx, who: ReceiptIdentity, dates: string[]) {
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
export async function readScheduleReceiptView(who: ReceiptIdentity, today = manilaWorkDate()): Promise<ScheduleReceiptView> {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(6107, ${who.organizationId})`);
    await assertBoundIdentity(tx, who);
    const projected = await projectedDays(tx, who, receiptDates(today));
    const days: ScheduleReceiptDay[] = [];
    for (const day of projected) {
      // Exact-content match first; otherwise one historical row is enough to label a changed snapshot.
      const current = day.snapshotHash ? await tx.select({ snapshotHash: receipts.snapshotHash, acknowledgedAt: receipts.acknowledgedAt })
        .from(receipts).where(and(ownReceipt(who, day.date), eq(receipts.snapshotHash, day.snapshotHash))).limit(1) : [];
      const prior = current.length || !day.snapshotHash ? current : await tx.select({ snapshotHash: receipts.snapshotHash, acknowledgedAt: receipts.acknowledgedAt })
        .from(receipts).where(ownReceipt(who, day.date)).orderBy(desc(receipts.id)).limit(1);
      days.push({ ...day, ...receiptState(day.snapshotHash, prior) });
    }
    return { days, boundary: SCHEDULE_RECEIPT_BOUNDARY };
  }, { isolationLevel: "read committed" });
}
export async function acknowledgeScheduleReceipt(who: ReceiptIdentity, body: unknown, today = manilaWorkDate()) {
  const request = parseScheduleReceipt(body, today);
  return db.transaction(async tx => {
    // Shared with published roster writers: re-read source only AFTER acquiring the lock.
    await tx.execute(sql`select pg_advisory_xact_lock(6107, ${who.organizationId})`);
    await assertBoundIdentity(tx, who);
    const [current] = await projectedDays(tx, who, [request.workDate]);
    if (!current.snapshot || !current.snapshotHash) throw new ScheduleReceiptError("SCHEDULE_UNAVAILABLE", "A complete published schedule is required before acknowledgment.");
    if (current.snapshotHash !== request.snapshotHash) throw new ScheduleReceiptError("SCHEDULE_CHANGED", "The schedule changed. Refresh and review it before acknowledging.");
    const [existing] = await tx.select({ acknowledgedAt: receipts.acknowledgedAt }).from(receipts)
      .where(and(ownReceipt(who, request.workDate), eq(receipts.snapshotHash, current.snapshotHash))).limit(1);
    if (existing) return { created: false, workDate: request.workDate, snapshotHash: current.snapshotHash, acknowledgedAt: existing.acknowledgedAt.toISOString() };
    const [created] = await tx.insert(receipts).values({ organizationId: who.organizationId, employeeId: who.employeeId,
      acknowledgedByUserId: who.userId, workDate: request.workDate, snapshotHash: current.snapshotHash,
      snapshot: current.snapshot }).returning({ id: receipts.id, acknowledgedAt: receipts.acknowledgedAt });
    await tx.insert(auditEvents).values({ organizationId: who.organizationId, actor: "User #" + who.userId,
      action: "WFM employee schedule receipt acknowledged", resource: "Employee #" + who.employeeId + " / " + request.workDate,
      metadata: { receiptId: created.id, employeeId: who.employeeId, userId: who.userId, workDate: request.workDate,
        snapshotHash: current.snapshotHash, attendanceChanged: false, payrollChanged: false, notificationSent: false } });
    return { created: true, workDate: request.workDate, snapshotHash: current.snapshotHash, acknowledgedAt: created.acknowledgedAt.toISOString() };
  }, { isolationLevel: "read committed" });
}
