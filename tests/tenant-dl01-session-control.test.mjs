/**
 * Unit regressions for the actual session-control statements in DL-01 probes.
 * Responses below are deliberately synthetic: these tests do not query PG,
 * perform HTTP, or confer COVERED status. The existing PG16 HTTP jobs must pass.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const accountRoute = readFileSync("src/app/api/account/route.ts", "utf8");
const profileRoute = readFileSync("src/app/api/account/profile/route.ts", "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const files = [
  "scripts/qa/tenant-dl01-import-history-http.mjs",
  "scripts/qa/tenant-dl01-filing-file-http.mjs",
];
const f = { owners: [{ id: 101 }, { id: 202 }, { id: 303 }] };

function compileSessionControl(source) {
  const match = source.match(/const account = expectStatus\(await request\("([^"\n]+)", \{ cookie \}\), 200,\s*"[^"\n]+"\);\s*assert\.equal\(account\.json\?\.profile\?\.id, f\.owners\[idx\]\.id\);/);
  assert.ok(match, "Retain the exact HTTP 200 control and matching authenticated owner assertion");
  assert.ok(source.indexOf("const own = expectStatus", match.index) > match.index,
    "The authenticated principal must be checked before the actual own-object request");
  return new AsyncFunction("request", "expectStatus", "assert", "f", "idx", "cookie", match[0]);
}

async function exercise(source, idx, response) {
  const calls = [];
  const cookie = "fictional-dl01-session-" + idx;
  const request = async (path, options) => {
    assert.deepEqual(options, { cookie }, "Do not lose or switch the attacker session");
    calls.push(path);
    // Model the actual existing route contract, not an invented successful GET.
    return path === "/api/account" ? response : { status: 405, json: null };
  };
  const expectStatus = (actual, expected) => {
    assert.equal(actual.status, expected, "Session-control HTTP status must match exactly");
    return actual;
  };
  await compileSessionControl(source)(request, expectStatus, assert, f, idx, cookie);
  assert.deepEqual(calls, ["/api/account"], "Use the existing read-only account GET exactly once");
}

test("session-control target has an authenticated GET; profile remains a mutation-only route", () => {
  assert.match(accountRoute, /export async function GET\(\)/);
  assert.match(accountRoute, /await getSessionUser\(\)/);
  assert.match(accountRoute, /profile:\s*\{\s*id: account\.id/);
  assert.match(profileRoute, /export async function POST\(/);
  assert.doesNotMatch(profileRoute, /export\s+(?:async\s+function|const)\s+GET\b/);
});

for (const file of files) {
  const source = readFileSync(file, "utf8");
  test(file + " executes its real session control for both independent attacker principals", async () => {
    for (const idx of [1, 2]) {
      await exercise(source, idx, { status: 200, json: { profile: { id: f.owners[idx].id } } });
    }
  });
  test(file + " rejects the original mutation-only profile GET with HTTP 405", async () => {
    const originalBug = source.replace('request("/api/account", { cookie })',
      'request("/api/account/profile", { cookie })');
    await assert.rejects(exercise(originalBug, 1, { status: 200, json: { profile: { id: 202 } } }),
      error => error.code === "ERR_ASSERTION" && error.actual === 405 && error.expected === 200);
  });
  test(file + " refuses authentication failures, missing methods and throttled controls", async () => {
    for (const status of [401, 403, 404, 405, 429, 500]) {
      await assert.rejects(exercise(source, 1, { status, json: { profile: { id: 202 } } }),
        error => error.code === "ERR_ASSERTION" && error.expected === 200);
    }
  });
  test(file + " refuses HTTP 200 with empty, malformed or another employer's principal", async () => {
    for (const json of [null, {}, { profile: {} }, { profile: { id: 101 } }, { profile: { id: 303 } }]) {
      await assert.rejects(exercise(source, 1, { status: 200, json }),
        error => error.code === "ERR_ASSERTION" && error.expected === 202);
    }
  });
}
