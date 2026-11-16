import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-only importer inventory for the current wage-order dependency. This is
 * NOT tenant-isolation security proof; fresh disposable PG16 HTTP proof remains
 * required for covered route importers, even if their own route SHA is unchanged.
 */
function sourceFiles(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const full = join(folder, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\\.(?:ts|tsx|mjs|mts|js|jsx)$/.test(entry.name)
      ? [full.replaceAll("\\\\", "/")] : [];
  });
}
const importPattern = /\\bfrom\\s*["'][^"']*wage-orders(?:\\.ts)?["']|\\bimport\\s*\\(\\s*["'][^"']*wage-orders(?:\\.ts)?["']/m;
const symbolPattern = /\\bwageOrderFor\\b|\\bWAGE_ORDERS\\b/g;

test("inventory every source, test and script importer of regional wage orders", () => {
  const files = ["src", "tests", "scripts"].flatMap(sourceFiles).sort();
  const importers = [];
  const symbolReferences = [];
  for (const path of files) {
    const contents = readFileSync(path, "utf8");
    if (path === "src/lib/wage-orders.ts") continue;
    if (importPattern.test(contents)) importers.push(path);
    if (symbolPattern.test(contents)) symbolReferences.push(path);
    symbolPattern.lastIndex = 0;
  }
  assert.ok(importers.includes("src/lib/payroll-engine.ts"),
    "payroll engine must remain explicitly inventoried");
  assert.ok(importers.includes("src/app/api/employees/route.ts"),
    "employee route is a covered direct wage-order importer");
  assert.ok(importers.includes("tests/wage-orders.test.ts"),
    "wage-order regressions must remain inventoried");

  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const directRoutes = importers.filter(path => path.startsWith("src/app/api/") && path.endsWith("/route.ts"));
  const coveredRoutes = directRoutes.map(path => {
    const record = manifest.allApiRouteFiles?.[path];
    assert.ok(record, path + ": direct API importer must be present in tenant manifest");
    return { route: path, methods: record.methods.map(method => ({
      name: method.name, status: method.status, proof: method.testedBy?.file ?? null,
    })) };
  });
  console.log("WAGE_ORDER_IMPORTERS=" + JSON.stringify(importers));
  console.log("WAGE_ORDER_SYMBOL_REFERENCES=" + JSON.stringify(symbolReferences));
  console.log("WAGE_ORDER_DIRECT_ROUTE_PROOF_IMPACT=" + JSON.stringify(coveredRoutes));
});
