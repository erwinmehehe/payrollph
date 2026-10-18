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

test("bookkeeper close hides another employer, run, audit revision, reload and A -> B -> A revisit", () => {
  const currentScope = { requestKey: key(11, 501) };
  const observed: BookkeeperCloseRead<{ canClose: boolean }> = {
    requestScope: currentScope,
    payload: { canClose: true },
    loadError: "",
  };

  assert.deepEqual(visibleBookkeeperCloseRead(currentScope, observed), {
    loading: false,
    payload: { canClose: true },
    loadError: "",
  });

  for (const other of [
    key(12, 501),
    key(11, 502),
    key(11, 501, 6),
    key(11, 501, 5, 1),
    key(11, 501), // same key after A -> B -> A must not resurrect A's old approval
  ]) {
    assert.deepEqual(visibleBookkeeperCloseRead({ requestKey: other }, observed), {
      loading: true,
      payload: null,
      loadError: "",
    }, "a new observation scope must fail closed while loading");
  }

  assert.deepEqual(visibleBookkeeperCloseRead(currentScope, null), {
    loading: true,
    payload: null,
    loadError: "",
  });
});

test("same-scope read failures show errors but never expose close controls", () => {
  const currentScope = { requestKey: key(11, 501) };
  const observed: BookkeeperCloseRead<{ canClose: boolean }> = {
    requestScope: currentScope,
    payload: null,
    loadError: "Payroll close unavailable",
  };
  assert.deepEqual(visibleBookkeeperCloseRead(currentScope, observed), {
    loading: false,
    payload: null,
    loadError: "Payroll close unavailable",
  });
  assert.equal(visibleBookkeeperCloseRead({ requestKey: key(11, 502) }, observed).loadError, "");
});

test("bookkeeper UI binds close consent to a snapshot and cancels obsolete GETs", () => {
  const source = readFileSync("src/components/workspace/bookkeeper-payroll-close.tsx", "utf8");
  assert.match(source, /bookkeeperCloseRequestKey\(\{/);
  assert.match(source, /organizationId: data\.selectedOrganization\.id/);
  assert.match(source, /runId: run\.id/);
  assert.match(source, /auditEventCount: data\.auditEvents\.length/);
  assert.match(source, /useMemo<BookkeeperCloseScope>/);
  assert.match(source, /auditEvents: data\.auditEvents, runStatus: run\.status/);
  assert.match(source, /\[requestKey, data\.auditEvents, run\.status\]/);
  assert.match(source, /visibleBookkeeperCloseRead\(requestScope, observedClose\)/);
  assert.match(source, /confirmCloseForScope === requestScope/);
  assert.match(source, /ackEvidenceForScope === requestScope/);
  assert.match(source, /setConfirmCloseForScope\(event\.target\.checked \? requestScope : null\)/);
  assert.match(source, /setAckEvidenceForScope\(event\.target\.checked \? requestScope : null\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /active = false; controller\.abort\(\)/);
  assert.doesNotMatch(source, /setLoading\(true\)/);
  assert.doesNotMatch(source, /setPayload\(null\)/);
});
