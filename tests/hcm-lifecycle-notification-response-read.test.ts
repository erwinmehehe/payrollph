import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readVerifiedLifecycleNotificationResponse } from "../src/lib/hcm-lifecycle-notification-read";

const empty = { organizationId: 71, tasks: [], owners: [], canAssign: false };
const task = {
  id: 8, organizationId: 71, employeeId: 9, sourceType: "employment_decision",
  sourceId: 6, employeeNo: "FICTIONAL-9", employeeName: "Sample Worker",
  action: "review_decision", stage: "probation", escalationStage: 0,
  severity: "warning", title: "Review due", detail: "Fictional case",
  dueDate: null, status: "open", ownerUserId: null, ownerName: null,
  snoozeUntil: null, lastNotifiedAt: null,
};
const owner = { userId: 33, name: "Sample Owner", email: "sample@example.invalid", role: "hr" };

test("a verified empty notification collection differs from HTTP failure or missing tasks", () => {
  assert.deepEqual(readVerifiedLifecycleNotificationResponse(true, empty, 71), empty);
  assert.equal(readVerifiedLifecycleNotificationResponse(false, empty, 71), null);
  assert.equal(readVerifiedLifecycleNotificationResponse(true, empty, 72), null);
  assert.equal(readVerifiedLifecycleNotificationResponse(true, empty, 0), null);
  for (const bad of [
    null, {}, [], { ...empty, organizationId: 72 },
    { ...empty, organizationId: undefined }, { ...empty, tasks: undefined },
    { ...empty, tasks: null }, { ...empty, owners: undefined },
    { ...empty, canAssign: undefined }, { ...empty, canAssign: false, owners: [owner] },
  ]) assert.equal(readVerifiedLifecycleNotificationResponse(true, bad, 71), null);
});

test("same-employer populated tasks and owner assignments have a complete read contract", () => {
  const valid = { organizationId: 71, tasks: [task], owners: [owner], canAssign: true };
  assert.deepEqual(readVerifiedLifecycleNotificationResponse(true, valid, 71), valid);
  for (const bad of [
    { ...valid, tasks: [{ ...task, organizationId: 72 }] },
    { ...valid, tasks: [{ ...task, status: undefined }] },
    { ...valid, tasks: [{ ...task, employeeId: 0 }] },
    { ...valid, tasks: [{ ...task, ownerUserId: "33" }] },
    { ...valid, tasks: [task, task] },
    { ...valid, owners: [{ ...owner, userId: null }] },
    { ...valid, canAssign: false },
  ]) assert.equal(readVerifiedLifecycleNotificationResponse(true, bad, 71), null);
  assert.equal(readVerifiedLifecycleNotificationResponse(false, valid, 71), null);
});

test("notification UI keeps failed reads unavailable and renders empty only after verification", () => {
  const panel = readFileSync("src/components/hcm-lifecycle-notification-inbox.tsx", "utf8");
  assert.match(panel, /readVerifiedLifecycleNotificationResponse\(response\.ok, data, organizationId\)/);
  assert.match(panel, /Unavailable, retry/);
  assert.match(panel, />Retry<\/button>/);
  assert.match(panel, /payload && payload\.tasks\.length === 0/);
  assert.doesNotMatch(panel, /payload\?\.tasks\s*\?\?\s*\[\]/);
});
