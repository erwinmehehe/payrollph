import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  analyzeRouteEdit, describeImpact, segmentRoute,
} from "../scripts/qa/tenant-route-edit-impact.mjs";

const TOOL = "scripts/qa/tenant-route-edit-impact.mjs";
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));

const BASE = `import { db } from "@/db";
export const dynamic = "force-dynamic";

function helper(x: number) {
  return x + 1;
}

// Reads the thing.
export async function GET(request: Request) {
  return Response.json({ ok: helper(1) });
}

/** Writes the thing. */
export async function POST(request: Request) {
  return Response.json({ ok: true });
}
`;

const states = (analysis) => Object.fromEntries(analysis.methods.map((m) => [m.name, m.state]));

test("an identical file changes nothing, and CRLF line endings are not an edit", () => {
  const same = analyzeRouteEdit(BASE, BASE);
  assert.equal(same.sharedChanged, false);
  assert.deepEqual(states(same), { GET: "UNCHANGED", POST: "UNCHANGED" });
  const crlf = analyzeRouteEdit(BASE, BASE.replace(/\n/g, "\r\n"));
  assert.equal(crlf.sharedChanged, false);
  assert.deepEqual(states(crlf), { GET: "UNCHANGED", POST: "UNCHANGED" });
});

test("a sibling-only edit marks only the edited handler (the #2025 route edit shape)", () => {
  const head = BASE.replace("return Response.json({ ok: true });", "return Response.json({ ok: true, warning: \"x\" });");
  const analysis = analyzeRouteEdit(BASE, head);
  assert.equal(analysis.sharedChanged, false);
  assert.deepEqual(states(analysis), { GET: "UNCHANGED", POST: "CHANGED" });
});

test("a comment directly above a handler belongs to that handler, not to the one before it", () => {
  const head = BASE.replace("/** Writes the thing. */", "/** Writes the thing, differently. */");
  assert.deepEqual(states(analyzeRouteEdit(BASE, head)), { GET: "UNCHANGED", POST: "CHANGED" });
  const upper = BASE.replace("// Reads the thing.", "// Reads another thing.");
  assert.deepEqual(states(analyzeRouteEdit(BASE, upper)), { GET: "CHANGED", POST: "UNCHANGED" });
});

test("imports, config and non-exported helpers are shared code, so an edit there reaches every handler", () => {
  for (const head of [
    BASE.replace('import { db } from "@/db";', 'import { db } from "@/db";\nimport { other } from "@/other";'),
    BASE.replace('"force-dynamic"', '"auto"'),
    BASE.replace("return x + 1;", "return x + 2;"),
  ]) {
    const analysis = analyzeRouteEdit(BASE, head);
    assert.equal(analysis.sharedChanged, true);
    assert.deepEqual(states(analysis), { GET: "UNCHANGED", POST: "UNCHANGED" });
    const impact = describeImpact("src/app/api/x/route.ts", analysis, { methods: [{ name: "GET", status: "COVERED" }, { name: "POST", status: "COVERED" }] });
    assert.ok(impact.methods.every((m) => /shared code/.test(m.meaning)), "an untouched handler must still be told shared code changed");
    assert.equal(impact.creditedAtStake, 2);
  }
});

test("added, removed and const-style handlers are recognised", () => {
  const withPatch = BASE + "\nexport const PATCH = async () => Response.json({});\n";
  assert.deepEqual(states(analyzeRouteEdit(BASE, withPatch)), { GET: "UNCHANGED", PATCH: "ADDED", POST: "UNCHANGED" });
  assert.deepEqual(states(analyzeRouteEdit(withPatch, BASE)), { GET: "UNCHANGED", PATCH: "REMOVED", POST: "UNCHANGED" });
  assert.deepEqual(Object.keys(segmentRoute(withPatch).methods).sort(), ["GET", "PATCH", "POST"]);
  assert.deepEqual(states(analyzeRouteEdit(null, BASE)), { GET: "ADDED", POST: "ADDED" });
  assert.deepEqual(states(analyzeRouteEdit(BASE, null)), { GET: "REMOVED", POST: "REMOVED" });
});

test("credit at stake counts only credited statuses and never invents a status", () => {
  const analysis = analyzeRouteEdit(BASE, BASE.replace("ok: true }", "ok: false }"));
  const impact = describeImpact("src/app/api/x/route.ts", analysis, {
    methods: [{ name: "GET", status: "COVERED" }, { name: "POST", status: "GAP" }],
  });
  assert.equal(impact.creditedAtStake, 1);
  assert.equal(impact.methods.find((m) => m.name === "GET").recorded, "COVERED");
  assert.equal(impact.methods.find((m) => m.name === "POST").credited, false);
  assert.equal(describeImpact("src/app/api/x/route.ts", analysis, undefined).methods[0].recorded, "NOT-IN-MANIFEST");
  const sibling = impact.methods.find((m) => m.name === "GET");
  assert.match(sibling.meaning, /whole-blob pin still requires re-proof/,
    "an untouched sibling must still be reported as needing re-proof, never as keeping its credit");
});

test("the segmenter finds exactly the manifest's methods in every real route file", () => {
  const mismatches = [];
  for (const [path, route] of Object.entries(manifest.allApiRouteFiles)) {
    const found = Object.keys(segmentRoute(readFileSync(path, "utf8")).methods).sort();
    const expected = route.methods.map((method) => method.name).sort();
    if (JSON.stringify(found) !== JSON.stringify(expected)) mismatches.push(path + ": " + found + " vs " + expected);
  }
  assert.deepEqual(mismatches, [], "a parser that misses a handler would hide a changed credited method");
});

test("the tool is read-only and does not renew, re-pin or re-credit anything", () => {
  const source = readFileSync(TOOL, "utf8");
  assert.ok(!/writeFileSync|appendFileSync|renameSync|unlinkSync|copyFileSync|\.write\(/.test(source));
  assert.ok(!/gitBlobSha\s*=|\.status\s*=|"COVERED"\s*;/.test(source), "it must not assign pins or statuses");
  assert.match(source, /NEVER writes, re-pins or re-credits/);
});

test("on an unchanged tree the CLI reports nothing at stake and --strict still exits 0", () => {
  const plain = spawnSync(process.execPath, [TOOL, "--base", "HEAD"], { encoding: "utf8" });
  assert.equal(plain.status, 0, plain.stderr);
  const strict = spawnSync(process.execPath, [TOOL, "--base", "HEAD", "--strict", "--json"], { encoding: "utf8" });
  assert.equal(strict.status, 0, strict.stderr);
  assert.equal(JSON.parse(strict.stdout).changedRoutes, 0);
});
