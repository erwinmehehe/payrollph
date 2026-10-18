import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const text = readFileSync("deploy/PROD_ENV_CHECKLIST.md", "utf8");
const read = path => readFileSync(path, "utf8");
const pattern = /^\| \x60([A-Z][A-Z0-9_]*)\x60 \| .* \| \[\x60([^\x60]+):(\d+)\x60\]\(\.\.\/([^#)]+)#L(\d+)\) \|$/gm;
const rows = [...text.matchAll(pattern)].map(m => ({
  name: m[1], path: m[2], line: Number(m[3]),
  linkedPath: m[4], linkedLine: Number(m[5]), row: m[0],
}));

test("production env checklist code references, exact lines, and rows", () => {
  assert.equal(rows.length, 50, "one row per source-verified environment variable");
  assert.equal(new Set(rows.map(x => x.name)).size, rows.length);
  for (const row of rows) {
    assert.equal(row.path, row.linkedPath, row.name);
    assert.equal(row.line, row.linkedLine, row.name);
    const sourceLines = read(row.path).split("\n");
    assert.ok(row.line > 0 && row.line <= sourceLines.length, row.name);
    assert.ok(sourceLines[row.line - 1].includes(row.name),
      row.name + " must appear on its cited source line");
    assert.ok(row.row.includes("check_env " + row.name + " "),
      row.name + " requires a specific verification command");
  }
});

test("every direct environment input in four requested code files appears in inventory", () => {
  const names = new Set(rows.map(r => r.name));
  const files = [
    "src/lib/operational-readiness.ts",
    "scripts/security-preflight.ts",
    "scripts/live-production-readiness.ts",
    "src/lib/production-certification-gates.ts",
  ];
  const readNames = new Set();
  for (const file of files) {
    const source = read(file);
    const patterns = [
      /process\.env\.([A-Z][A-Z0-9_]*)/g,
      /\benv\.([A-Z][A-Z0-9_]*)/g,
      /\b(?:configured|enabled|httpsUrl|strongSecret)\(["']([A-Z][A-Z0-9_]*)["']/g,
    ];
    for (const regex of patterns)
      for (const hit of source.matchAll(regex)) readNames.add(hit[1]);
  }
  assert.deepEqual([...readNames].filter(x => !names.has(x)), [],
    "no direct gate/script input may go undocumented");
});

test("no secrets, false activation toggles, empty rotation keys, and operator instructions", () => {
  for (const name of [
    "WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED", "PAYMONGO_DISBURSEMENTS_ENABLED",
  ]) {
    const row = rows.find(x => x.name === name);
    assert.ok(row && row.row.includes("check_env " + name + " false"), name);
  }
  for (const name of [
    "BANK_DATA_ENCRYPTION_KEY_PREVIOUS",
    "PII_ENCRYPTION_KEY_PREVIOUS",
    "TOTP_ENCRYPTION_KEY_PREVIOUS",
  ]) {
    const row = rows.find(x => x.name === name);
    assert.ok(row && row.row.includes("check_env " + name + " empty"), name);
  }
  for (const phrase of [
    "npm run security:preflight", "x-readiness-token",
    "npx tsx scripts/live-production-readiness.ts", "PRODUCTION_READINESS_TOKEN",
    "rollout_mode=pilot", "Production Readiness Report",
    "payrollph-production-rollout-readiness",
    "qa-artifacts/production-rollout-readiness.json", "RELEASE NO-GO",
  ]) assert.ok(text.includes(phrase), phrase);
  assert.doesNotMatch(text, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
  assert.doesNotMatch(text, /\bsk_(?:live|test)_[A-Za-z0-9]{10,}\b/);
  const seed = read("src/db/seed.ts");
  const credential = seed.match(/export const DEMO_CREDENTIALS\s*=\s*\{\s*email:\s*"([^"]+)"\s*,\s*password:\s*"([^"]+)"/s);
  if (credential) {
    assert.ok(!text.includes(credential[1]), "no public demo login in checklist");
    assert.ok(!text.includes(credential[2]), "no public demo password in checklist");
  }
  assert.doesNotMatch(read("src/lib/production-certification-gates.ts"), /process\.env/);
});

test("preflight logging hazard is documented and safe operator URL checks reject query tokens", () => {
  const preflight = read("scripts/security-preflight.ts");
  // The live preflight currently echoes accepted URL values and can echo a
  // malformed MFA flag. Do not let a future checklist silently present its
  // output as sanitized while this source behavior remains.
  const echoesUrl = /detail:\s*ok\s*\?\s*raw\s*:/.test(preflight);
  const echoesMfa = /env\.REQUIRE_PRIVILEGED_MFA\s*\?\?\s*["\x27]defaults secure["\x27]/.test(preflight);
  if (echoesUrl || echoesMfa) {
    assert.match(text, /Preflight output disclosure HOLD/i);
    assert.match(text, /Do not run this preflight in shared CI/i);
    assert.match(text, /do not pipe, upload, paste, or retain raw stdout\/stderr/i);
    assert.match(text, /separately reviewed source fix/i);
    assert.doesNotMatch(text, /retain sanitized output plus actual exit code/i);
  }
  const helpers = text.slice(text.indexOf("## Value-free verification helpers"),
    text.indexOf("## Server / preflight / activation variables"));
  assert.match(helpers, /!u\.username\s*&&\s*!u\.password/);
  assert.match(helpers, /!u\.hash\s*&&\s*!u\.search/);
});
