import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const inventory = fileURLToPath(new URL("../scripts/qa/a4-a5-source-inventory.mjs", import.meta.url));
const expiryMarker = "/** Per-expiry, per-milestone HR alert ledger; idempotent across scheduler retries. */\n";
const expiryBlock = expiryMarker +
  'export const hcmDocumentExpiryNotices = pgTable("hcm_document_expiry_notices", {});\n\n';
const importVault = 'import { sweepPendingVaultUploads } from "@/lib/employee-vault-object-reconciliation";\n';
const vaultTick = "  // Private A5 upload intents must also be swept when its flag is rolled back.\n" +
  "  const pendingVaultObjectRecovery = await sweepPendingVaultUploads(new Date(now));\n";

function fixture({ predecessors = true } = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "a4-a5-merged-"));
  const git = (...args) => execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const write = (file, content) => {
    const full = path.join(cwd, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  const read = file => readFileSync(path.join(cwd, file), "utf8");
  git("init", "-q", "--initial-branch=main");
  git("config", "user.name", "Fictional Git Fixture");
  git("config", "user.email", "fixture@example.invalid");
  const oldSchema = (predecessors
    ? 'const hr = pgTable(\n  "employee_hr_cases", {}\n);\n' +
      'const privacy = pgTable("applicant_privacy_evidence", {});\n'
    : 'const org = pgTable("organizations", {});\n') +
    'export const invitations = pgTable("invitations", {});\n';
  const oldRetention =
    'import { sweepPendingCoeObjects } from "@/lib/hr-case-coe-object-reconciliation";\n' +
    'async function tick(now) {\n' +
    '  const pendingCoeObjectRecovery = await sweepPendingCoeObjects(new Date(now));\n' +
    '  return {\n    pendingCoeObjectRecovery,\n  };\n}\n';
  write("src/db/schema.ts", oldSchema);
  write("src/lib/data-retention.ts", oldRetention);
  // Test frozen runtime guards without loading either owner's application.
  write("src/lib/critical-release-flags.ts",
    'export const VAULT_RELEASE_FLAG_DEFAULT = false;\n');
  write("src/proxy.ts", 'export const HCM_PROXY_FAIL_CLOSED = true;\n');
  git("add", ".");git("commit", "-q", "-m", "fictional A2 A3 original");
  const original = git("rev-parse", "HEAD");

  // In the real repo this is the already-merged #896 commit, NOT #896's old PR head.
  write("src/db/schema.ts", oldSchema.replace(
    'export const invitations',
    'const a4policies = pgTable("expense_category_policies", {});\n' +
    'const a4evidence = pgTable("expense_claim_evidence", {});\n' +
    'export const invitations',
  ));
  const spendImport = 'import { sweepPendingSpendReceipts } from "@/lib/spend-receipt-object-reconciliation";\n';
  const spendTick = '  const pendingSpendReceiptRecovery = await sweepPendingSpendReceipts(new Date(now));\n';
  const mergedRetention = spendImport + oldRetention
    .replace('  return {\n', spendTick + '  return {\n')
    .replace('    pendingCoeObjectRecovery,\n', '    pendingCoeObjectRecovery,\n    pendingSpendReceiptRecovery,\n');
  write("src/lib/data-retention.ts", mergedRetention);
  git("add", ".");git("commit", "-q", "-m", "merged A4 896");
  const mergedSpend = git("rev-parse", "HEAD");
  git("switch", "-q", "-c", "a5");
  write("src/db/schema.ts", read("src/db/schema.ts").replace(
    'export const invitations', expiryBlock + 'export const invitations',
  ));
  write("src/lib/data-retention.ts",
    importVault + mergedRetention
      .replace('  return {\n', vaultTick + '  return {\n')
      .replace('    pendingSpendReceiptRecovery,\n',
        '    pendingSpendReceiptRecovery,\n    pendingVaultObjectRecovery,\n')
  );
  git("add", ".");git("commit", "-q", "-m", "reconciled private A5 vault");
  const vault = git("rev-parse", "HEAD");

  function verify({ main = mergedSpend, a4 = mergedSpend, a5 = vault, env = {} } = {}) {
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
  }
  return { cwd, git, write, read, original, mergedSpend, vault, verify,
    clean: () => rmSync(cwd, { recursive: true, force: true }) };
}

test("merged A4 and scoped A5 source reconcile without certifying combined QA", () => {
  const f = fixture();
  try {
    const { call, json } = f.verify();
    assert.equal(call.status, 0, call.stderr);
    assert.equal(json.status, "SOURCE_RECONCILED_ONLY");
    assert.equal(json.mergedA4InMain, true);
    assert.equal(json.vaultIncludesMain, true);
    assert.equal(json.a4SchemaPreserved, true);
    assert.equal(json.a4RetentionPreserved, true);
    assert.equal(json.featureFlagsChanged, false);
    assert.equal(json.hcmProxyChanged, false);
    assert.equal(json.sourceReconciled, true);
    assert.equal(json.combinedAcceptance, "NOT_RUN");
    assert.equal(json.databaseOperations, false);
  } finally { f.clean(); }
});

test("a vault branch behind newly advanced main fails closed", () => {
  const f = fixture();
  try {
    f.git("switch", "-q", "main");
    f.git("commit", "-q", "--allow-empty", "-m", "another main update");
    const latest = f.git("rev-parse", "HEAD");
    const { call, json } = f.verify({ main: latest });
    assert.equal(call.status, 1);
    assert.equal(json.vaultIncludesMain, false);
    assert.ok(json.blockers.some(x => x.includes("A5 #902 must reconcile")));
  } finally { f.clean(); }
});

test("old A4 feature head cannot stand in for its actual main merge commit", () => {
  const f = fixture();
  try {
    const { call, json } = f.verify({ a4: f.vault });
    assert.equal(call.status, 1);
    assert.equal(json.mergedA4InMain, false);
    assert.ok(json.blockers.some(x => x.includes("A4 #896 merged commit")));
  } finally { f.clean(); }
});

test("A5 cannot silently change A4 receipt ledger schema beyond its expiry table", () => {
  const f = fixture();
  try {
    f.write("src/db/schema.ts", f.read("src/db/schema.ts").replace(
      '"expense_category_policies"', '"wrong_a4_replacement"',
    ));
    f.git("add", ".");f.git("commit", "-q", "-m", "regression in merged A4 schema");
    const { call, json } = f.verify({ a5: f.git("rev-parse", "HEAD") });
    assert.equal(call.status, 1);
    assert.equal(json.a4SchemaPreserved, false);
  } finally { f.clean(); }
});

test("A5 cannot silently remove Spend orphan recovery in the retention scheduler", () => {
  const f = fixture();
  try {
    f.write("src/lib/data-retention.ts", f.read("src/lib/data-retention.ts")
      .replace('    pendingSpendReceiptRecovery,\n', '    LOST_SPEND_RECOVERY,\n'));
    f.git("add", ".");f.git("commit", "-q", "-m", "regressed A4 retry receipt");
    const { call, json } = f.verify({ a5: f.git("rev-parse", "HEAD") });
    assert.equal(call.status, 1);
    assert.equal(json.a4RetentionPreserved, false);
  } finally { f.clean(); }
});

test("historical combined replay remains blocked if A2 and A3 tables are missing", () => {
  const f = fixture({ predecessors: false });
  try {
    const { call, json } = f.verify();
    assert.equal(call.status, 1);
    assert.equal(json.applicantHrPredecessorsPresent, false);
    assert.ok(json.blockers.some(x => x.includes("HR-case/applicant-privacy")));
  } finally { f.clean(); }
});

test("non-CI execution, malformed SHA and nonexistent commit all block", () => {
  const f = fixture();
  try {
    const nonCi = f.verify({ env: { CI: "false" } });
    assert.equal(nonCi.call.status, 1);
    assert.ok(nonCi.json.blockers.some(x => x.includes("read-only CI")));
    const malformed = f.verify({ a4: "main" });
    assert.equal(malformed.call.status, 1);
    assert.ok(malformed.json.blockers.some(x => x.includes("A4_A5_SPEND_SHA")));
    const missing = f.verify({ a5: "0".repeat(40) });
    assert.equal(missing.call.status, 1);
    assert.ok(missing.json.blockers.some(x => x.includes("A4_A5_VAULT_SHA")));
  } finally { f.clean(); }
});

test("candidate vault cannot alter critical feature flags while inventory claims unchanged", () => {
  const f = fixture();
  try {
    f.write("src/lib/critical-release-flags.ts",
      f.read("src/lib/critical-release-flags.ts").replace("false", "true"));
    f.git("add", ".");f.git("commit", "-q", "-m", "fictional accidental feature flag activation");
    const { call, json } = f.verify({ a5: f.git("rev-parse", "HEAD") });
    assert.equal(call.status, 1);
    assert.equal(json.featureFlagsChanged, true);
    assert.equal(json.hcmProxyChanged, false);
    assert.ok(json.blockers.some(x => x.includes("critical feature flag")));
  } finally { f.clean(); }
});

test("candidate vault cannot weaken the HCM proxy guard while inventory claims unchanged", () => {
  const f = fixture();
  try {
    f.write("src/proxy.ts",
      f.read("src/proxy.ts").replace("true", "false"));
    f.git("add", ".");f.git("commit", "-q", "-m", "fictional weakened proxy guard");
    const { call, json } = f.verify({ a5: f.git("rev-parse", "HEAD") });
    assert.equal(call.status, 1);
    assert.equal(json.featureFlagsChanged, false);
    assert.equal(json.hcmProxyChanged, true);
    assert.ok(json.blockers.some(x => x.includes("HCM HTTP proxy guards")));
  } finally { f.clean(); }
});

test("invalid refs cannot report flag/proxy parity before source was inspected", () => {
  const f = fixture();
  try {
    const { call, json } = f.verify({ a5: "0".repeat(40) });
    assert.equal(call.status, 1);
    assert.equal(json.featureFlagsChanged, null);
    assert.equal(json.hcmProxyChanged, null);
    assert.equal(json.sourceReconciled, false);
  } finally { f.clean(); }
});

test("PR source inventory pins the exact event base instead of a moving main ref", () => {
  const workflow = readFileSync(
    fileURLToPath(new URL("../.github/workflows/a4-a5-source-inventory.yml", import.meta.url)),
    "utf8",
  );
  assert.ok(workflow.includes('PR_EVENT_BASE_SHA: $' + '{{ github.event.pull_request.base.sha }}'));
  assert.ok(workflow.includes('if [[ "${GITHUB_EVENT_NAME}" == "pull_request" ]]'));
  assert.ok(workflow.includes('export A4_A5_BASE_SHA="${PR_EVENT_BASE_SHA}"'));
  assert.ok(workflow.includes('git cat-file -e "${A4_A5_BASE_SHA}^{commit}"'));
  assert.ok(workflow.includes('refs/pull/902/head:refs/remotes/origin/a5-owner-902'));
});
