import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SECOND_PASS_ROUTES, SECOND_PASS_FAMILIES } from "../scripts/qa/tenant-second-pass-manifest.mjs";

const ROOT = "src/app/api";
const normalized = (path) => path.replaceAll("\\", "/");

function routeFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(path) : entry.name === "route.ts" ? [normalized(path)] : [];
  });
}

test("second-pass manifest inventories every omitted family, route and HTTP method", () => {
  const all = SECOND_PASS_FAMILIES.flatMap((family) => routeFiles(join(ROOT, family)))
    .map((file) => file.slice((ROOT + "/").length, -"/route.ts".length))
    .sort();
  const declared = Object.keys(SECOND_PASS_ROUTES).sort();
  assert.equal(SECOND_PASS_FAMILIES.length, 6);
  assert.ok(declared.length >= 42, "The original first-sweep blind spot must not shrink silently.");
  assert.deepEqual(all, declared, "New sensitive routes cannot silently bypass the second-pass inventory.");

  let count = 0;
  for (const route of declared) {
    const file = join(ROOT, route, "route.ts");
    const source = readFileSync(file, "utf8");
    const actualMethods = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)]
      .map((match) => match[1]).sort();
    const declaredMethods = SECOND_PASS_ROUTES[route].split(" ").sort();
    assert.deepEqual(actualMethods, declaredMethods, file + ": new method needs an explicit tenant review");
    assert.ok(actualMethods.length > 0, file + ": route must export an HTTP handler");
    count += actualMethods.length;
  }
  assert.ok(count >= 50, "All omitted HTTP methods must be inventoried; never skip a family.");
});

test("high-risk resource and credential families cannot be dropped from the second pass", () => {
  for (const [route, verbs] of [
    ["v1/employees/[id]", ["GET", "PATCH", "DELETE"]],
    ["scim/v2/Users/[id]", ["GET", "PATCH", "DELETE"]],
    ["account/sessions", ["GET", "DELETE"]],
    ["jobs/admin-status", ["GET"]],
    ["auth/demo-switch", ["POST"]],
    ["webhooks/paymongo/transfers", ["POST"]],
    ["webhooks/xendit/subscriptions", ["POST"]],
  ]) {
    assert.deepEqual(SECOND_PASS_ROUTES[route].split(" ").sort(), verbs.sort(), route);
  }
});
