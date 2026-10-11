import assert from "node:assert/strict";
import test from "node:test";
import {
  isWebBundyPunchList,
  visibleWebBundyState,
  webBundyReadKey,
  type WebBundyReadState,
} from "../src/lib/web-bundy-display-scope";

test("tenant and employee changes invalidate the previous ready clock state", () => {
  const first = webBundyReadKey(17, 91, 0);
  const old: WebBundyReadState = {
    key: first, status: "ready",
    punches: [{ timeIn: "2026-10-11T00:00:00.000Z" }],
  };
  assert.equal(visibleWebBundyState(first, old).status, "ready");
  for (const key of [
    webBundyReadKey(18, 91, 0),
    webBundyReadKey(17, 92, 0),
    webBundyReadKey(17, null, 0),
  ]) {
    assert.deepEqual(visibleWebBundyState(key, old), { status: "loading", punches: [] });
  }
});

test("reselecting the same employee cannot reuse an earlier successful read", () => {
  const old: WebBundyReadState = {
    key: webBundyReadKey(8, 11, 0), status: "ready", punches: [{ timeIn: "stale" }],
  };
  const revisited = webBundyReadKey(8, 11, 2);
  assert.notEqual(revisited, old.key);
  assert.deepEqual(visibleWebBundyState(revisited, old), { status: "loading", punches: [] });
});

test("unavailable read is not equivalent to an empty successfully loaded day", () => {
  const key = webBundyReadKey(25, 71, 3);
  assert.deepEqual(visibleWebBundyState(key, { key, status: "unavailable", punches: [] }),
    { key, status: "unavailable", punches: [] });
  assert.deepEqual(visibleWebBundyState(key, { key, status: "ready", punches: [] }),
    { key, status: "ready", punches: [] });
  assert.equal(visibleWebBundyState(key, null).status, "loading");
});

test("valid current punches are preserved, no timestamp conversions in scope guard", () => {
  const punches = [{ timeIn: "2026-10-11T07:30:00.000Z", timeOut: null, breakStart: null, breakEnd: null }];
  assert.equal(isWebBundyPunchList(punches), true);
  const key = webBundyReadKey(1, 2, 0);
  assert.deepEqual(visibleWebBundyState(key, { key, status: "ready", punches }).punches, punches);
});

test("malformed punch payload cannot silently enable clock-in", () => {
  for (const bad of [undefined, null, {}, "broken", [{ timeIn: 123 }], [null], [1]]) {
    assert.equal(isWebBundyPunchList(bad), false);
  }
  assert.equal(isWebBundyPunchList([]), true);
});

test("invalid IDs or revision values cannot identify a worker's read state", () => {
  for (const id of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => webBundyReadKey(id, 1, 0), /Valid employer/);
    assert.throws(() => webBundyReadKey(1, id, 0), /Valid employer/);
  }
  assert.throws(() => webBundyReadKey(1, 1, -1), /revision/);
});
