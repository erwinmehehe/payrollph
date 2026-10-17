import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  bookkeeperCloseRequestKey,
  visibleBookkeeperCloseRead,
  type BookkeeperCloseRead,
} from "../src/lib/bookkeeper-close-read-state";

const key = (organizationId: number, runId: number, auditEventCount = 5, reloadKey = 0) =>
  bookkeeperCloseRequestKey({ organizationId, runId, auditEventCount, reloadKey });

test("bookkeeper close never displays a previous employer, run, audit revision, or reload", () => {
  const observed: BookkeeperCloseRead<{ canClose: boolean }> = {
    requestKey: key(11, 501),
    payload: { canClose: true },
    loadError: "",
  };

  assert.deepEqual(visibleBookkeeperCloseRead(key(11, 501), observed), {
    loading: false,
    payload: { canClose: true },
    loadError: "",
  });

  for (const other of [
    key(12, 501),
    key(11, 502),
    key(11, 501, 6),
    key(11, 501, 5, 1),
  ]) {
    assert.deepEqual(visibleBookkeeperCloseRead(other, observed), {
      loading: true,
      payload: null,
      loadError: "",
    }, "a different close read must fail closed while loading");
  }

  assert.deepEqual(visibleBookkeeperCloseRead(key(11, 501), null), {
    loading: true,
    payload: null,
    loadError: "",
  });
});

test("same-scope read failures show an error and never expose close controls", () => {
  const observed: BookkeeperCloseRead<{ canClose: boolean }> = {
    requestKey: key(11, 501),
    payload: null,
    loadError: "Payroll close unavailable",
  };
  assert.deepEqual(visibleBookkeeperCloseRead(key(11, 501), observed), {
    loading: false,
    payload: null,
    loadError: "Payroll close unavailable",
  });
  assert.equal(visibleBookkeeperCloseRead(key(11, 502), observed).loadError, "");
});

test("bookkeeper UI scopes close confirmations and cancels stale requests", () => {
  const source = readFileSync("src/components/workspace/bookkeeper-payroll-close.tsx", "utf8");
  assert.match(source, /bookkeeperCloseRequestKey\(\{/);
  assert.match(source, /organizationId: data\.selectedOrganization\.id/);
  assert.match(source, /runId: run\.id/);
  assert.match(source, /auditEventCount: data\.auditEvents\.length/);
  assert.match(source, /visibleBookkeeperCloseRead\(requestKey, observedClose\)/);
  assert.match(source, /confirmCloseForKey === requestKey/);
  assert.match(source, /ackEvidenceForKey === requestKey/);
  assert.match(source, /setConfirmCloseForKey\(event\.target\.checked \? requestKey : null\)/);
  assert.match(source, /setAckEvidenceForKey\(event\.target\.checked \? requestKey : null\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /active = false; controller\.abort\(\)/);
  assert.doesNotMatch(source, /setLoading\(true\)/);
  assert.doesNotMatch(source, /setPayload\(null\)/);
});
