import assert from "node:assert/strict";
import test from "node:test";
import { readHcmCorrectionReason, verifyHcmCorrectionActionRead } from "../src/lib/hcm-correction-action-read";

const expected = { organizationId: 3, employeeId: 5, changeId: 7, userId: 11, action: "return" as const };
const returned = { change: { id: 7, organizationId: 3, employeeId: 5, status: "returned_for_correction" }, previousProcessId: 13 };
test("return reason is never inferred from missing, empty or foreign-employer 200 JSON", () => {
  const reason = { organizationId: 3, employeeId: 5, changeId: 7, note: "Correct the requested effective date.", reviewer: "Fictional reviewer", returnedAt: "2026-10-26T01:00:00.000Z" };
  assert.equal(readHcmCorrectionReason(true, reason, expected), reason.note);
  for (const body of [null, {}, { ...reason, organizationId: 4 }, { ...reason, changeId: 8 }, { ...reason, employeeId: 6 },
    { ...reason, note: "" }, { ...reason, returnedAt: "unknown" }, { ...reason, reviewer: "" }]) assert.throws(() => readHcmCorrectionReason(true, body, expected));
  assert.throws(() => readHcmCorrectionReason(false, reason, expected));
});
test("correction UI refuses failed, missing and foreign action results", () => {
  verifyHcmCorrectionActionRead(true, returned, expected);
  for (const body of [null, {}, { ...returned, previousProcessId: -1 }, { ...returned, change: { ...returned.change, organizationId: 4 } },
    { ...returned, change: { ...returned.change, employeeId: 6 } }, { ...returned, change: { ...returned.change, id: 9 } },
    { ...returned, change: { ...returned.change, status: "approved" } }]) assert.throws(() => verifyHcmCorrectionActionRead(true, body, expected));
  assert.throws(() => verifyHcmCorrectionActionRead(false, returned, expected));
});
test("resubmission UI requires a new own source and a positive fresh in-progress process", () => {
  const fresh = { change: { id: 19, organizationId: 3, employeeId: 5, requestedByUserId: 11, status: "pending_approval", toSnapshot: { correctionOfChangeId: 7 } }, businessProcess: { id: 23, status: "in_progress" } };
  const request = { ...expected, action: "resubmit" as const };
  verifyHcmCorrectionActionRead(true, fresh, request);
  for (const body of [{ ...fresh, change: { ...fresh.change, id: 7 } }, { ...fresh, change: { ...fresh.change, requestedByUserId: 12 } },
    { ...fresh, change: { ...fresh.change, toSnapshot: { correctionOfChangeId: 8 } } },
    { ...fresh, businessProcess: { id: 0, status: "in_progress" } }, { ...fresh, businessProcess: { id: 23, status: "approved" } }]) assert.throws(() => verifyHcmCorrectionActionRead(true, body, request));
});
