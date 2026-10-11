import assert from "node:assert/strict";
import test from "node:test";
import { createMigrationHistoryReader } from "../src/lib/migration-history-request-owner";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function ok(batches: unknown[]) {
  return { ok: true, json: async () => ({ batches }) } as Response;
}

test("history reads only the explicit employer and accepts a genuinely empty result", async () => {
  const urls: string[] = [];
  const signals: AbortSignal[] = [];
  const results: unknown[] = [];
  const reader = createMigrationHistoryReader(12, async (url, init) => {
    urls.push(url);
    assert.equal(init.cache, "no-store");
    signals.push(init.signal);
    return ok([]);
  }, (result) => results.push(result));

  assert.equal(await reader.refresh(), true);
  assert.deepEqual(urls, ["/api/migrations?organizationId=12"]);
  assert.equal(signals[0]?.aborted, false);
  assert.deepEqual(results, [{ state: "ready", batches: [] }]);
  reader.retire();
});

test("older response cannot overwrite a refreshed history when transport ignores abort", async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  const signalList: AbortSignal[] = [];
  const results: unknown[] = [];
  let n = 0;
  const reader = createMigrationHistoryReader(23, async (_url, init) => {
    signalList.push(init.signal);
    return (++n === 1 ? first.promise : second.promise);
  }, (result) => results.push(result));

  const older = reader.refresh();
  const newer = reader.refresh();
  assert.equal(signalList[0]?.aborted, true);
  second.resolve(ok([{ id: 2, fileName: "tenant-23-new.csv" }]));
  assert.equal(await newer, true);
  first.resolve(ok([{ id: 1, fileName: "tenant-23-old.csv" }]));
  assert.equal(await older, false);
  assert.deepEqual(results, [{ state: "ready", batches: [{ id: 2, fileName: "tenant-23-new.csv" }] }]);
  reader.retire();
});

test("retiring an employer view blocks delayed successful responses and future refreshes", async () => {
  const read = deferred<Response>();
  const results: unknown[] = [];
  let reads = 0;
  const reader = createMigrationHistoryReader(8, async () => { reads++; return read.promise; }, (x) => results.push(x));
  const pending = reader.refresh();
  reader.retire();
  assert.equal(reader.isCurrent(), false);
  read.resolve(ok([{ fileName: "former-employer-sensitive.csv" }]));
  assert.equal(await pending, false);
  assert.equal(await reader.refresh(), false);
  assert.equal(reads, 1);
  assert.deepEqual(results, []);
});

test("HTTP errors are unavailable, not 'no batches'", async () => {
  const results: unknown[] = [];
  const reader = createMigrationHistoryReader(9, async () => ({
    ok: false, json: async () => { throw Error("unexpected"); },
  } as Response), (x) => results.push(x));
  assert.equal(await reader.refresh(), false);
  assert.deepEqual(results, [{ state: "unavailable" }]);
});

test("malformed or untrusted history payloads are not shown as an empty audit history", async () => {
  const payloads: unknown[] = [null, {}, { batches: "not a batch list" }];
  const results: unknown[] = [];
  const reader = createMigrationHistoryReader(20, async () =>
    ({ ok: true, json: async () => payloads.shift() } as Response),
  (x) => results.push(x));
  for (let i = 0; i < 3; i++) assert.equal(await reader.refresh(), false);
  assert.deepEqual(results, Array.from({ length: 3 }, () => ({ state: "unavailable" })));
});

test("transport failures report unavailable but retired transport failures never publish", async () => {
  const results: unknown[] = [];
  const reader = createMigrationHistoryReader(32, async () => { throw Error("disconnected"); }, (x) => results.push(x));
  assert.equal(await reader.refresh(), false);
  assert.deepEqual(results, [{ state: "unavailable" }]);
  const delayed = deferred<Response>();
  const staleReader = createMigrationHistoryReader(44, async () => delayed.promise, (x) => results.push(x));
  const old = staleReader.refresh();
  staleReader.retire();
  delayed.reject(Error("network returned after employer switch"));
  assert.equal(await old, false);
  assert.deepEqual(results, [{ state: "unavailable" }]);
});

test("invalid employer scopes cannot create history reads", () => {
  for (const id of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createMigrationHistoryReader(id, async () => ok([]), () => {}), /employer scope/);
  }
});
