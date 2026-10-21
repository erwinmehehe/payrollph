import assert from "node:assert/strict";
import test from "node:test";
import { isVerifiedHcmBusinessProcessInbox } from "../src/lib/hcm-business-process-read";
import {
  isVerifiedLifecycleNotificationQueue, isVerifiedLifecycleNotificationReceipt,
} from "../src/lib/hcm-lifecycle-notification-read";

test("HCM process source must echo employer and all separate work/history/meta arrays", () => {
  const valid = {
    organizationId: 51, myWork: [], submitted: [], recent: [],
    meta: {
      myWorkPartial: false, submittedPartial: false, recentPartial: false,
      companyHistoryAvailable: false,
    },
  };
  assert.equal(isVerifiedHcmBusinessProcessInbox(valid, 51), true);
  for (const bad of [
    {...valid, organizationId: 52}, {...valid, myWork: undefined},
    {...valid, recent: {}}, {...valid, meta: {...valid.meta, myWorkPartial: undefined}},
    {...valid, myWork: [{id:9}]},
  ]) assert.equal(isVerifiedHcmBusinessProcessInbox(bad, 51), false);
  const item = {
    id: 1, stepIndex: 0, stepType: "approval", label: "Approve hire",
    assignee: "hr", dueAt: null, approvalTaskId: 43, instanceId: 100,
    processType: "hire", processName: "Hiring", effectiveDate: "2026-10-01",
    initiatedByName: "Requester", makerBlocked: false, employee: null,
  };
  assert.equal(isVerifiedHcmBusinessProcessInbox({...valid, myWork: [item]}, 51), true);
  assert.equal(isVerifiedHcmBusinessProcessInbox({...valid, myWork: [item, item]}, 51), false);
  assert.equal(isVerifiedHcmBusinessProcessInbox({...valid, myWork: [{...item, makerBlocked: null}]}, 51), false);
});

test("lifecycle tasks reject foreign rows, missing owners and incomplete task evidence", () => {
  const valid = { organizationId: 5, tasks: [], owners: [], canAssign: false };
  assert.equal(isVerifiedLifecycleNotificationQueue(valid, 5), true);
  const item = {
    id: 4, organizationId: 5, employeeId: 3, sourceType: "employment_decision",
    sourceId: 8, employeeNo: "E-3", employeeName: "Example Employee",
    action: "review_decision", stage: "probation", escalationStage: 0,
    severity: "warning", title: "Review", detail: "", dueDate: null,
    status: "open", ownerUserId: null, ownerName: null,
    snoozeUntil: null, lastNotifiedAt: null,
  };
  assert.equal(isVerifiedLifecycleNotificationQueue({...valid, tasks: [item]}, 5), true);
  for (const bad of [
    {...valid, tasks: undefined},
    {...valid, organizationId: 7},
    {...valid, tasks: [{...item, organizationId: 7}]},
    {...valid, tasks: [{...item, status: null}]},
    {...valid, tasks: [item, item]},
    {...valid, owners: [{userId:2, name:"A", email:"a@example.com", role:"manager"}]},
  ]) assert.equal(isVerifiedLifecycleNotificationQueue(bad, 5), false);
});

test("lifecycle mutations require the exact employer and task receipt", () => {
  const receipt = {task: {id: 4, organizationId: 5, status:"acknowledged"}};
  assert.equal(isVerifiedLifecycleNotificationReceipt(receipt, 5, 4, "acknowledge"), true);
  assert.equal(isVerifiedLifecycleNotificationReceipt(receipt, 6, 4, "acknowledge"), false);
  assert.equal(isVerifiedLifecycleNotificationReceipt(receipt, 5, 5, "acknowledge"), false);
  assert.equal(isVerifiedLifecycleNotificationReceipt({task: {id:4, organizationId:5}}, 5, 4, "acknowledge"), false);
  assert.equal(isVerifiedLifecycleNotificationReceipt({task:{id:4,organizationId:5,ownerUserId:12}}, 5, 4, "assign", {ownerUserId:12}), true);
});
