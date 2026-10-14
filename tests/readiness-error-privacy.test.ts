import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("private readiness denial and failure responses explicitly disable caching", () => {
  const cases: Array<[string, number[]]> = [
    ["src/app/api/readiness/route.ts", [401, 404]],
    ["src/app/api/readiness/billing/route.ts", [404, 503]],
    ["src/app/api/readiness/workspace/route.ts", [400, 401, 403]],
  ];
  for (const [path, statuses] of cases) {
    const source = read(path);
    for (const status of statuses) {
      const headers = new RegExp(
        'status:\\s*' + status + ',\\s*headers:\\s*\\{\\s*"Cache-Control":\\s*"no-store"\\s*\\}',
      );
      assert.match(source, headers, path + ": HTTP " + status + " must disable caching");
    }
  }
});

test("the protected pilot-status endpoint never logs raw exception objects", () => {
  const source = read("src/app/api/readiness/pilot-status/route.ts");
  assert.match(source, /console\\.error\\("Sanitized readiness evaluation failed"\\);/);
  assert.doesNotMatch(source, /console\\.error\\("Sanitized readiness evaluation failed",/);
  assert.match(source, /status: 404, headers: \\{ "Cache-Control": "no-store" \\}/);
});

test("anonymous status and health probes continue to conceal operational details", () => {
  const status = read("src/app/api/status/route.ts");
  const health = read("src/app/api/health/route.ts");
  assert.match(status, /publicStatusResponse\\(rows\\[0\\] \\?\\? null\\)/);
  assert.match(health, /recordSnapshot \\? \\{ ok: true, latencyMs \\} : \\{ ok: true \\}/);
  assert.match(health, /"Cache-Control": "no-store"/);
});
