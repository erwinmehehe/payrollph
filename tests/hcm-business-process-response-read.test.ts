import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readVerifiedHcmBusinessProcessResponse } from "../src/lib/hcm-business-process-read";

const empty = {
  organizationId: 51, myWork: [], submitted: [], recent: [],
  meta: { myWorkPartial: false, submittedPartial: false, recentPartial: false,
    companyHistoryAvailable: false },
};
const work = {
  id: 7, stepIndex: 0, stepType: "approval", label: "Approve fictional hire",
  assignee: "hr", dueAt: null, approvalTaskId: 18, instanceId: 19,
  processType: "hire", processName: "Hire", effectiveDate: "2026-10-01",
  initiatedByName: "Sample Requester", makerBlocked: false,
  employee: { id: 3, employeeNo: "FICTIONAL-3", name: "Sample Worker", title: "" },
};
const history = {
  id: 19, processType: "hire", processName: "Hire", status: "in_progress",
  effectiveDate: null, initiatedByName: "Sample Requester",
  initiatedAt: null, completedAt: null, employeeId: 3,
};

test("a verified same-employer empty queue is not an unavailable or partial read", () => {
  assert.deepEqual(readVerifiedHcmBusinessProcessResponse(true, empty, 51), empty);
  for (const bad of [
    null, {}, [], { ...empty, organizationId: 52 },
    { ...empty, organizationId: undefined }, { ...empty, myWork: undefined },
    { ...empty, submitted: null }, { ...empty, recent: undefined },
    { ...empty, meta: undefined }, { ...empty, meta: { ...empty.meta, myWorkPartial: undefined } },
  ]) assert.equal(readVerifiedHcmBusinessProcessResponse(true, bad, 51), null);
  for (const ok of [false]) {
    assert.equal(readVerifiedHcmBusinessProcessResponse(ok, empty, 51), null);
  }
  assert.equal(readVerifiedHcmBusinessProcessResponse(true, empty, 52), null);
  assert.equal(readVerifiedHcmBusinessProcessResponse(true, empty, 0), null);
});

test("populated HCM approval and history must be structurally verified before actions", () => {
  const valid = { ...empty, myWork: [work], submitted: [history], recent: [history] };
  assert.deepEqual(readVerifiedHcmBusinessProcessResponse(true, valid, 51), valid);
  for (const bad of [
    { ...valid, myWork: [{ ...work, makerBlocked: undefined }] },
    { ...valid, myWork: [{ ...work, approvalTaskId: -1 }] },
    { ...valid, myWork: [{ ...work, employee: { ...work.employee, id: 0 } }] },
    { ...valid, myWork: [work, work] },
    { ...valid, submitted: [{ ...history, employeeId: "3" }] },
    { ...valid, recent: [{ ...history, initiatedAt: "bad-time" }] },
    { ...valid, organizationId: 500 },
  ]) assert.equal(readVerifiedHcmBusinessProcessResponse(true, bad, 51), null);
  assert.equal(readVerifiedHcmBusinessProcessResponse(false, valid, 51), null);
});

test("process inbox UI exposes unavailable retry and never substitutes missing work as empty", () => {
  const panel = readFileSync("src/components/hcm-business-process-inbox.tsx", "utf8");
  const reader = readFileSync("src/lib/hcm-business-process-read.ts", "utf8");
  assert.match(reader, /readVerifiedHcmBusinessProcessResponse\(response\.ok, payload, organizationId\)/);
  assert.match(panel, /Unavailable, retry/);
  assert.match(panel, />Retry<\/button>/);
  assert.doesNotMatch(panel, /payload\?\.myWork\.length\s*\?\?\s*0/);
  assert.doesNotMatch(panel, /setPayload\(data as InboxPayload\)/);
  assert.doesNotMatch(panel, /payload\?\.myWork\s*\?\?\s*\[\]/);
});

test("effective dates reject rolled-over days while preserving real leap days", () => {
  const valid = { ...empty, myWork: [work], submitted: [history], recent: [history] };
  for (const invalid of ["2026-02-30", "2025-02-29", "2026-04-31", "2026-00-10", "2026-13-01"]) {
    assert.equal(readVerifiedHcmBusinessProcessResponse(true, {
      ...valid, myWork: [{ ...work, effectiveDate: invalid }],
    }, 51), null, "work item " + invalid);
    assert.equal(readVerifiedHcmBusinessProcessResponse(true, {
      ...valid, submitted: [{ ...history, effectiveDate: invalid }],
    }, 51), null, "submitted history " + invalid);
    assert.equal(readVerifiedHcmBusinessProcessResponse(true, {
      ...valid, recent: [{ ...history, effectiveDate: invalid }],
    }, 51), null, "recent history " + invalid);
  }
  for (const date of ["2024-02-29", "2026-12-31"]) {
    const verified = {
      ...valid,
      myWork: [{ ...work, effectiveDate: date }],
      submitted: [{ ...history, effectiveDate: date }],
      recent: [{ ...history, effectiveDate: date }],
    };
    assert.deepEqual(readVerifiedHcmBusinessProcessResponse(true, verified, 51), verified);
  }
});

test("timestamp fields require real calendar days and explicit timezone offsets", () => {
  const valid = { ...empty, myWork: [work], submitted: [history], recent: [history] };
  for (const invalid of [
    "2026-02-30T08:30:00.000Z", "2025-02-29T08:30:00Z",
    "2026-04-31T08:30:00+08:00", "2026-10-27T24:00:00Z",
    "2026-10-27T12:60:00Z", "2026-10-27T12:00:60Z",
    "2026-10-27T12:00:00", "2026-10-27", "1",
  ]) {
    assert.equal(readVerifiedHcmBusinessProcessResponse(true, {
      ...valid, myWork: [{ ...work, dueAt: invalid }],
    }, 51), null, "dueAt " + invalid);
    assert.equal(readVerifiedHcmBusinessProcessResponse(true, {
      ...valid, submitted: [{ ...history, initiatedAt: invalid }],
    }, 51), null, "initiatedAt " + invalid);
    assert.equal(readVerifiedHcmBusinessProcessResponse(true, {
      ...valid, recent: [{ ...history, completedAt: invalid }],
    }, 51), null, "completedAt " + invalid);
  }
  for (const instant of ["2026-10-27T10:15:00.000Z", "2024-02-29T12:00:00+08:00"]) {
    const read = {
      ...valid,
      myWork: [{ ...work, dueAt: instant }],
      submitted: [{ ...history, initiatedAt: instant }],
      recent: [{ ...history, completedAt: instant }],
    };
    assert.deepEqual(readVerifiedHcmBusinessProcessResponse(true, read, 51), read);
  }
});
