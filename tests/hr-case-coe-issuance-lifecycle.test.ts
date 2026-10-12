import assert from "node:assert/strict";
import test from "node:test";
import { issueCoeObjectWithRecovery } from "../src/lib/hr-case-coe-object-reconciliation";

test("COE stages a durable intent before upload and atomically finalizes only after PUT", async () => {
  const order: string[] = [];
  const result = await issueCoeObjectWithRecovery({
    stage: async () => { order.push("pending-database-commit"); return 45; },
    upload: async () => { order.push("private-PUT"); },
    finalize: async id => { order.push("document-HR-audit-commit:" + id); return { id, signed: true }; },
    recover: async () => { throw new Error("must not clean a successful issue"); },
  });
  assert.deepEqual(result, { id: 45, signed: true });
  assert.deepEqual(order, [
    "pending-database-commit", "private-PUT", "document-HR-audit-commit:45",
  ]);
});

test("database finalization failure triggers recovery after a successful object PUT", async () => {
  const called: string[] = [];
  const original = new Error("synthetic DB audit insert rejected");
  await assert.rejects(issueCoeObjectWithRecovery({
    stage: async () => { called.push("stage"); return 67; },
    upload: async () => { called.push("PUT"); },
    finalize: async () => { called.push("finalize"); throw original; },
    recover: async id => { called.push("reconcile:" + id); },
  }), error => error === original);
  assert.deepEqual(called, ["stage", "PUT", "finalize", "reconcile:67"]);
});

test("ambiguous storage timeout still triggers recovery without promoting the COE", async () => {
  const order: string[] = [];
  await assert.rejects(issueCoeObjectWithRecovery({
    stage: async () => { order.push("stage"); return 88; },
    upload: async () => { order.push("timeout-after-remote-write"); throw new Error("storage timeout"); },
    finalize: async () => { order.push("incorrect-signoff"); return true; },
    recover: async id => { order.push("reconcile:" + id); },
  }), /storage timeout/);
  assert.deepEqual(order, ["stage", "timeout-after-remote-write", "reconcile:88"]);
});

test("a failed DELETE does not suppress primary rejection or lose the pending intent", async () => {
  let intentExists = false;
  const original = new Error("Postgres commit response lost");
  await assert.rejects(issueCoeObjectWithRecovery({
    stage: async () => { intentExists = true; return 90; },
    upload: async () => {},
    finalize: async () => { throw original; },
    recover: async () => { throw new Error("private object DELETE failed"); },
  }), err => err === original);
  assert.equal(intentExists, true);
});

test("failed intent transaction performs no remote PUT or cleanup", async () => {
  const calls: string[] = [];
  await assert.rejects(issueCoeObjectWithRecovery({
    stage: async () => { calls.push("stage"); throw new Error("no durable intent"); },
    upload: async () => { calls.push("PUT"); },
    finalize: async () => { calls.push("finalize"); },
    recover: async () => { calls.push("recover"); },
  }), /no durable intent/);
  assert.deepEqual(calls, ["stage"]);
});
