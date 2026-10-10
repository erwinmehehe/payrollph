import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { receiptPilotAllowed, receiptDate, receiptDates, snapshotForReceipt, scheduleReceiptHash, receiptState, parseScheduleReceipt, type ReceiptSourceDay } from "../src/lib/workforce-schedule-receipt";
const day = (overrides: Partial<ReceiptSourceDay> = {}): ReceiptSourceDay => ({ date: "2026-10-10", source: "pattern", isRestDay: false,
  assignmentId: 1, patternId: 2, overrideId: null, workLocationOrgUnitId: null, worksiteId: 4,
  segments: [{ shiftDefinitionId: 5, shiftCode: "DAY", shiftName: "Day shift", segmentOrder: 1,
    startTime: "09:00", endTime: "17:00", breakMinutes: 60, spansMidnight: false }], ...overrides });
const site = { id: 4, name: "Fictional office" };

test("schedule receipts require an explicit valid pilot allowlist and independent flag", () => {
  for (const ids of [undefined, "", "*", "4,", "4,4", "04", "4,-5", "4,0", "4,2147483648"]) assert.equal(receiptPilotAllowed(4, "true", ids), false);
  assert.equal(receiptPilotAllowed(4, "false", "4"), false);
  assert.equal(receiptPilotAllowed(4, "true", "4, 5"), true);
  assert.equal(receiptPilotAllowed(6, "true", "4,5"), false);
});
test("receipt date validation rejects rollover dates and handles leap/new-year boundaries", () => {
  assert.throws(() => receiptDate("2026-02-30"));
  assert.equal(receiptDates("2024-02-27")[2], "2024-02-29");
  assert.equal(receiptDates("2026-12-29")[6], "2027-01-04");
});
test("schedule receipt snapshot strips personal and audit fields", () => {
  const raw = { ...day(), salary: 9999, audit: ["PRIVATE"], employeeName: "PRIVATE" };
  const snapshot = snapshotForReceipt(raw, site);
  assert.ok(snapshot);
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE"));
  assert.ok(!JSON.stringify(snapshot).includes("salary"));
});
test("unassigned schedule is never a receiptable rest day", () => {
  assert.equal(snapshotForReceipt(day({ source: "unassigned", isRestDay: true, segments: [] }), site), null);
  assert.equal(snapshotForReceipt(day({ isRestDay: true, segments: [] }), site)?.isRestDay, true);
});
test("missing authoritative source or foreign/missing worksite fails closed", () => {
  assert.equal(snapshotForReceipt(day(), null), null);
  assert.equal(snapshotForReceipt(day(), { id: 9, name: "Wrong employer site" }), null);
  assert.equal(snapshotForReceipt(day({ assignmentId: null }), site), null);
  assert.equal(snapshotForReceipt(day({ source: "override" }), site), null);
});
test("invalid shift times, break and segment ordering cannot be acknowledged", () => {
  for (const patch of [{ startTime: "25:00" }, { breakMinutes: 480 }, { endTime: "08:00" }, { segmentOrder: 0 }]) {
    const value = day(); value.segments[0] = { ...value.segments[0], ...patch };
    assert.equal(snapshotForReceipt(value, site), null);
  }
});
test("overnight receipt preserves explicit next-day completion", () => {
  const value = day(); value.segments[0] = { ...value.segments[0], startTime: "22:00", endTime: "06:00", spansMidnight: true };
  assert.equal(snapshotForReceipt(value, site)?.segments[0].spansMidnight, true);
});
test("receipt digest is bound to tenant, employee, date and displayed content", () => {
  const snapshot = snapshotForReceipt(day(), site)!;
  const hash = scheduleReceiptHash(1, 2, snapshot);
  for (const other of [scheduleReceiptHash(2, 2, snapshot), scheduleReceiptHash(1, 3, snapshot),
    scheduleReceiptHash(1, 2, { ...snapshot, date: "2026-10-11" }),
    scheduleReceiptHash(1, 2, { ...snapshot, worksite: { ...site, name: "Another office" } })]) assert.notEqual(other, hash);
  assert.match(hash, /^[a-f0-9]{64}$/);
});
test("old snapshot receipts do not acknowledge changed or unavailable schedules", () => {
  const rows = [{ snapshotHash: "a".repeat(64), acknowledgedAt: new Date("2026-10-10T01:00:00Z") }];
  assert.equal(receiptState("a".repeat(64), rows).state, "acknowledged");
  assert.equal(receiptState("b".repeat(64), rows).state, "changed");
  assert.equal(receiptState(null, rows).state, "unavailable");
  assert.equal(receiptState("b".repeat(64), []).state, "pending");
});
test("acknowledgment rejects implicit consent, stale dates and client identity overrides", () => {
  const body = { workDate: "2026-10-10", snapshotHash: "a".repeat(64), acknowledged: true };
  assert.equal(parseScheduleReceipt(body, "2026-10-10").workDate, body.workDate);
  for (const patch of [{ acknowledged: false }, { employeeId: 9 }, { organizationId: 9 }, { userId: 9 },
    { workDate: "2026-10-09" }, { workDate: "2026-10-17" }, { snapshotHash: "bad" }]) {
    assert.throws(() => parseScheduleReceipt({ ...body, ...patch }, "2026-10-10"));
  }
});
test("receipt API and service retain session, pilot, origin, demo and transactional controls", () => {
  const api = readFileSync("src/app/api/self/schedule-receipts/route.ts", "utf8");
  const service = readFileSync("src/lib/workforce-schedule-receipt-server.ts", "utf8");
  const ui = readFileSync("src/components/employee-schedule-receipts.tsx", "utf8");
  for (const token of ["getSessionUser()", "session.employeeId", "assertMembership(", "receiptPilotAllowed(",
    "publicDemoMutationDenied(", "enforceSameOriginMutation(", "enforceSensitiveActionRateLimit(", "private, no-store"]) assert.ok(api.includes(token), token);
  for (const token of ["pg_advisory_xact_lock(6107", "assertBoundIdentity(tx, who)", "current.snapshotHash !== request.snapshotHash",
    "tx.insert(receipts)", "tx.insert(auditEvents)", "eq(users.employeeId, employees.id)", "eq(userOrganizations.role, \"employee\")"]) assert.ok(service.includes(token), token);
  assert.ok(!service.includes("tx.update("));
  assert.ok(!service.includes("queueMessage("));
  assert.ok(ui.includes("acknowledged: true"));
  assert.ok(ui.includes("read.current?.abort()"));
  assert.ok(ui.includes("request !== generation.current"));
  assert.ok(ui.includes("setView(null)"));
});
