import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const inventory = fileURLToPath(new URL("../scripts/qa/a4-a5-source-inventory.mjs", import.meta.url));
function fixture(mergedTables = true) {
  const cwd = mkdtempSync(path.join(tmpdir(), "a4-a5-inventory-"));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const write = (file, content) => {
    const full = path.join(cwd, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "synthetic@example.invalid");
  git("config", "user.name", "Synthetic QA");
  write("src/db/schema.ts", mergedTables
    ? 'const hr = pgTable(\n  "employee_hr_cases", {}\n);\n' +
      "const privacy = pgTable('applicant_privacy_evidence', {});\n"
    : 'const company = pgTable("organizations", {});\n');
  git("add", ".");
  git("commit", "-q", "-m", "fictional current-main baseline");
  const base = git("rev-parse", "HEAD");
  git("switch", "-q", "-c", "a4");
  write("src/lib/spend-payroll-reimbursement.ts", "// synthetic A4");
  git("add", ".");git("commit", "-q", "-m", "isolated A4");
  let spend = git("rev-parse", "HEAD");
  git("switch", "-q", "main");
  git("switch", "-q", "-c", "a5");
  write("src/lib/employee-vault-object-reconciliation.ts", "// synthetic A5");
  git("add", ".");git("commit", "-q", "-m", "isolated A5");
  let vault = git("rev-parse", "HEAD");
  const verify = ({ main = base, a4 = spend, a5 = vault, env = {} } = {}) => {
    const call = spawnSync(process.execPath, [inventory], {
      cwd, encoding: "utf8", env: {
        ...process.env, CI: "true", A4_A5_INVENTORY_MODE: "read-only-ci",
        A4_A5_BASE_SHA: main, A4_A5_SPEND_SHA: a4,
        A4_A5_VAULT_SHA: a5, ...env,
      },
    });
    const json = JSON.parse(readFileSync(path.join(cwd,
      "qa-artifacts/a4-a5-source-inventory.json"), "utf8"));
    return { call, json };
  };
  return { cwd, git, write, base, spend, vault, verify,
    clean: () => rmSync(cwd, { recursive: true, force: true }) };
}

test("fresh main with non-overlapping owner branches is inventory-only, never certified", () => {
  const f = fixture();
  try {
    const { call, json } = f.verify();
    assert.equal(call.status, 0, call.stderr);
    assert.equal(json.status, "INVENTORY_ONLY");
    assert.equal(json.verifiedCombinedSource, false);
    assert.equal(json.combinedAcceptance, "NOT_RUN");
    assert.equal(json.databaseWrites, false);
    assert.deepEqual(json.overlaps, []);
    assert.deepEqual(json.owners.spend.changedPaths, ["src/lib/spend-payroll-reimbursement.ts"]);
    assert.deepEqual(json.owners.vault.changedPaths, ["src/lib/employee-vault-object-reconciliation.ts"]);
  } finally { f.clean(); }
});

test("stale owner refs fail closed before any combined test can start", () => {
  const f = fixture();
  try {
    f.git("switch", "-q", "main");
    f.git("commit", "-q", "--allow-empty", "-m", "main advanced");
    const modernMain = f.git("rev-parse", "HEAD");
    const { call, json } = f.verify({ main: modernMain });
    assert.equal(call.status, 1);
    assert.equal(json.status, "BLOCKED");
    assert.ok(json.blockers.some(message => message.includes("PR #896 must reconcile")));
    assert.ok(json.blockers.some(message => message.includes("PR #902 must reconcile")));
  } finally { f.clean(); }
});

test("shared modified paths are inventoried and block unsafe overwrite", () => {
  const f = fixture();
  try {
    f.git("switch", "-q", "a4");
    f.write("src/lib/data-retention.ts", "// synthetic A4 retention");
    f.git("add", ".");f.git("commit", "-q", "-m", "A4 overlap");
    const a4 = f.git("rev-parse", "HEAD");
    f.git("switch", "-q", "a5");
    f.write("src/lib/data-retention.ts", "// synthetic A5 retention");
    f.git("add", ".");f.git("commit", "-q", "-m", "A5 overlap");
    const a5 = f.git("rev-parse", "HEAD");
    const { call, json } = f.verify({ a4, a5 });
    assert.equal(call.status, 1);
    assert.deepEqual(json.overlaps, ["src/lib/data-retention.ts"]);
    assert.ok(json.blockers.some(message => message.includes("Overlapping A4/A5")));
  } finally { f.clean(); }
});

test("missing already-merged applicant privacy/HCM tables makes historical replay unsafe", () => {
  const f = fixture(false);
  try {
    const { call, json } = f.verify();
    assert.equal(call.status, 1);
    assert.ok(json.blockers.some(message => message.includes("employee_hr_cases")));
    assert.ok(json.blockers.some(message => message.includes("applicant_privacy_evidence")));
  } finally { f.clean(); }
});

test("invalid SHA and non-CI execution fail without attempting a merge or SQL", () => {
  const f = fixture();
  try {
    let result = f.verify({ a4: "main" });
    assert.equal(result.call.status, 1);
    assert.ok(result.json.blockers.some(message => message.includes("A4_A5_SPEND_SHA")));
    result = f.verify({ env: { CI: "false" } });
    assert.equal(result.call.status, 1);
    assert.ok(result.json.blockers.some(message => message.includes("CI=true")));
  } finally { f.clean(); }
});
