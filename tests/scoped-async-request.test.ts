import assert from "node:assert/strict";
import test from "node:test";
import { activeAsyncResult, createScopedRequestOwner, type RequestOutcome } from "../src/lib/scoped-async-request";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("a superseded request cannot overwrite the newer page even if transport ignores abort", async () => {
  const owner = createScopedRequestOwner<object>();
  const key = {};
  owner.activate(key);
  const first = deferred<string>();
  const second = deferred<string>();
  const outcomes: RequestOutcome<string>[] = [];
  let firstSignal!: AbortSignal;
  const a = owner.run(key, signal => { firstSignal = signal; return first.promise; }, result => outcomes.push(result));
  const b = owner.run(key, () => second.promise, result => outcomes.push(result));
  assert.equal(firstSignal.aborted, true);
  second.resolve("new page");
  await b;
  first.resolve("old page");
  await a;
  assert.deepEqual(outcomes, [{ data: "new page", error: null }]);
});

test("scope changes hide stored data immediately and suppress old errors", async () => {
  const owner = createScopedRequestOwner<object>();
  const oldKey = { scope: "employer A, week 1" };
  const newKey = { scope: "employer B, week 2" };
  const stored = { key: oldKey, data: "A workers", error: null };
  assert.equal(activeAsyncResult(stored, newKey, true), null);
  assert.equal(activeAsyncResult(stored, { ...oldKey }, true), null, "returning to a prior query must fetch anew");
  owner.activate(oldKey);
  const oldRequest = deferred<string>();
  const commits: string[] = [];
  const a = owner.run(oldKey, () => oldRequest.promise, () => commits.push("old"));
  owner.activate(newKey);
  const b = owner.run(newKey, async () => "B workers", () => commits.push("new"));
  oldRequest.reject(new Error("old tenant denied"));
  await Promise.all([a, b]);
  assert.deepEqual(commits, ["new"]);
});

test("a late mutation refresh from an old scope cannot cancel the current tenant fetch", async () => {
  const owner = createScopedRequestOwner<object>();
  const oldKey = {};
  const newKey = {};
  owner.activate(oldKey);
  owner.activate(newKey);
  const response = deferred<string>();
  let signal!: AbortSignal;
  const request = owner.run(newKey, value => { signal = value; return response.promise; }, () => {});
  let obsoleteLoadCalled = false;
  assert.equal(owner.isActive(oldKey), false);
  await owner.run(oldKey, async () => { obsoleteLoadCalled = true; return "stale"; }, () => assert.fail("stale commit"));
  owner.cancel(oldKey);
  assert.equal(obsoleteLoadCalled, false);
  assert.equal(signal.aborted, false);
  response.resolve("current");
  await request;
});

test("unmount cancels the request and blocks success/error commits and refreshes", async () => {
  for (const fail of [false, true]) {
    const owner = createScopedRequestOwner<object>();
    const key = {};
    owner.activate(key);
    const response = deferred<string>();
    let signal!: AbortSignal;
    const request = owner.run(key, value => { signal = value; return response.promise; }, () => assert.fail("unmounted commit"));
    owner.cancel(key);
    assert.equal(signal.aborted, true);
    assert.equal(owner.isActive(key), false);
    if (fail) response.reject(new Error("late failure")); else response.resolve("late success");
    await request;
    await owner.run(key, async () => assert.fail("unmounted refresh"), () => assert.fail("unmounted commit"));
  }
});

test("Strict Mode cleanup and restart do not let the first setup commit", async () => {
  const owner = createScopedRequestOwner<object>();
  const key = {};
  const oldResponse = deferred<number>();
  const values: number[] = [];
  owner.activate(key);
  const first = owner.run(key, () => oldResponse.promise, value => values.push(value.data!));
  owner.cancel(key);
  owner.activate(key);
  await owner.run(key, async () => 2, value => values.push(value.data!));
  oldResponse.resolve(1);
  await first;
  assert.deepEqual(values, [2]);
});

test("refresh completion awaits the transport and failure clears prior success", async () => {
  const owner = createScopedRequestOwner<object>();
  const key = {};
  owner.activate(key);
  const outcomes: RequestOutcome<string>[] = [{ data: "previous roster", error: null }];
  const response = deferred<string>();
  let completed = false;
  const request = owner.run(key, () => response.promise, value => { outcomes.push(value); }).then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  response.reject(new Error("refresh denied"));
  await request;
  assert.equal(completed, true);
  assert.equal(outcomes.length, 2);
  const outcome = outcomes[1];
  assert.deepEqual(outcome, { data: null, error: new Error("refresh denied") });
  assert.equal(activeAsyncResult({ key, ...outcome }, key, false), null, "disabled features show no data or errors");
});

test("owners are independent across mounted views", async () => {
  const key = {};
  const a = createScopedRequestOwner<object>();
  const b = createScopedRequestOwner<object>();
  a.activate(key);
  b.activate(key);
  const response = deferred<string>();
  let signal!: AbortSignal;
  const request = b.run(key, value => { signal = value; return response.promise; }, value => assert.equal(value.data, "B"));
  a.cancel(key);
  assert.equal(signal.aborted, false);
  response.resolve("B");
  await request;
});
