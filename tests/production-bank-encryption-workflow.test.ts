import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/production-bank-encryption.yml", "utf8");
// Extract only this workflow's literal run blocks. Never execute deployment,
// database, network, or encryption commands: bash -n checks syntax only.
const scripts = [...workflow.matchAll(/^        run: \|\n((?:          [^\n]*\n|\n)+)/gm)]
  .map((match) => match[1].replace(/^          /gm, ""));

test("bank encryption workflow has one readiness verification and valid shell blocks", () => {
  assert.equal((workflow.match(/^      - name: Verify live readiness sees encrypted bank data$/gm) ?? []).length, 1);
  assert.equal(scripts.length, 6, "inspect every multiline shell step");
  for (const script of scripts) {
    const result = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  }
});

test("zero-plaintext guards reject missing evidence and every nonzero source count", () => {
  const verification = scripts.find((script) => script.includes("/tmp/bank-encryption-verify.txt"));
  assert.ok(verification);
  const guards = verification.split("\n").filter((line) => line.startsWith("grep "));
  assert.equal(guards.length, 4, "employee, snapshot, legal-entity and proposal guards are required");
  const evidence = [
    "12 employee(s) have a bank account. 12 already encrypted, 0 to encrypt.",
    "0 payroll payment snapshot(s) also hold a plaintext account number.",
    "0 legal entity disbursement account(s) hold plaintext.",
    "0 payout change request(s) hold plaintext.",
  ];
  for (const [index, guard] of guards.entries()) {
    // Replay only grep against synthetic stdin, never the enclosing run block.
    const command = guard.replace(" /tmp/bank-encryption-verify.txt", "");
    const check = (input: string) => {
      const result = spawnSync("bash", ["-c", command], { input, encoding: "utf8" });
      assert.ifError(result.error);
      return result.status;
    };
    assert.equal(check(evidence.join("\n") + "\n"), 0);
    for (const count of [1, 10, 20, 100]) {
      const changed = [...evidence];
      changed[index] = index === 0
        ? evidence[index].replace(", 0 to encrypt.", `, ${count} to encrypt.`)
        : evidence[index].replace(/^0 /, `${count} `);
      assert.equal(check(changed.join("\n") + "\n"), 1, `source ${index} count ${count} must fail`);
    }
    assert.equal(check(evidence.filter((_, i) => i !== index).join("\n") + "\n"), 1);
    assert.equal(check(""), 1);
  }
});

test("workflow remains manual, production-protected and apply-gated", () => {
  assert.match(workflow, /^  workflow_dispatch:$/m);
  assert.match(workflow, /^        default: dry-run$/m);
  assert.match(workflow, /^    environment: production$/m);
  for (const name of [
    "Encrypt legacy bank data", "Verify zero plaintext bank data remains",
    "Authenticate every bank envelope with the current key",
    "Verify live readiness sees encrypted bank data",
  ]) {
    assert.ok(workflow.includes(`      - name: ${name}\n        if: \${{ inputs.mode == 'apply' }}`));
  }
});

test("dry-run cannot prepare database columns and apply validates the key first", () => {
  assert.ok(workflow.includes("      - name: Prepare bank-account column safely\n        if: ${{ inputs.mode == 'apply' }}"));
  assert.ok(workflow.indexOf("- name: Prove runner key matches live production") <
    workflow.indexOf("- name: Prepare bank-account column safely"));
  assert.ok(workflow.indexOf("- name: Verify zero plaintext bank data remains") <
    workflow.indexOf("- name: Authenticate every bank envelope with the current key"));
  assert.ok(workflow.indexOf("- name: Authenticate every bank envelope with the current key") <
    workflow.indexOf("- name: Verify live readiness sees encrypted bank data"));
  assert.ok(workflow.includes("run: npx tsx scripts/verify-bank-account-envelopes.ts"));
});

test("readiness requires one valid report, the matching key, and no bank blocker", () => {
  const script = scripts.find((value) => value.includes("Production bank-data encryption readiness is green."));
  assert.ok(script);
  // Only this literal verification block is replayed. Shell functions replace
  // BOTH external commands; jq operates on synthetic stdin, never live data.
  const stub = [
    'curl() { printf "%s" "$MOCK_READINESS"; return "${MOCK_CURL_STATUS:-0}"; }',
    'npx() { printf "%s\\n" "synthetic-key-fingerprint"; }',
  ].join("\n") + "\n";
  const report = { bankEncryptionFingerprint: "synthetic-key-fingerprint", criticalBlockers: [] };
  const check = (body: string, status = 0) => {
    const result = spawnSync("bash", ["-c", stub + script], {
      encoding: "utf8", timeout: 5000,
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH,
        PRODUCTION_BASE_URL: "https://synthetic.invalid",
        MOCK_READINESS: body, MOCK_CURL_STATUS: String(status),
      },
    });
    assert.ifError(result.error);
    return result;
  };
  assert.equal(check(JSON.stringify(report)).status, 0);
  assert.equal(check(JSON.stringify({ ...report, criticalBlockers: ["transactional-email"] })).status, 0,
    "this is a bank gate, not certification of unrelated launch gates");
  for (const invalid of [
    "", "not-json", "null", "[]", "{}",
    JSON.stringify({ criticalBlockers: [] }),
    JSON.stringify({ bankEncryptionFingerprint: "synthetic-key-fingerprint" }),
    JSON.stringify({ ...report, bankEncryptionFingerprint: "different-key" }),
    JSON.stringify({ ...report, criticalBlockers: null }),
    JSON.stringify({ ...report, criticalBlockers: "none" }),
    JSON.stringify({ ...report, criticalBlockers: [null] }),
    JSON.stringify({ ...report, criticalBlockers: ["bank-data-encryption"] }),
    JSON.stringify(report) + "\n" + JSON.stringify(report),
  ]) {
    const result = check(invalid);
    assert.notEqual(result.status, 0, "invalid readiness evidence must fail");
    assert.doesNotMatch(result.stdout, /readiness is green/);
  }
  assert.notEqual(check(JSON.stringify(report), 22).status, 0, "HTTP failure must not pass");
});

test("production backfill cannot use unreviewed branches or generic CI secret fallbacks", () => {
  assert.ok(workflow.includes("if: ${{ github.ref == 'refs/heads/main' }}"),
    "production-protected bank workflow must run only against reviewed main");
  assert.ok(workflow.includes("DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}"));
  assert.ok(workflow.includes("BANK_DATA_ENCRYPTION_KEY: ${{ secrets.PRODUCTION_BANK_DATA_ENCRYPTION_KEY }}"));
  assert.ok(workflow.includes("TOTP_ENCRYPTION_KEY: ${{ secrets.PRODUCTION_TOTP_ENCRYPTION_KEY }}"));
  assert.ok(!workflow.includes("|| secrets.DATABASE_URL"));
  assert.ok(!workflow.includes("|| secrets.BANK_DATA_ENCRYPTION_KEY"));
  assert.ok(!workflow.includes("|| secrets.TOTP_ENCRYPTION_KEY"));
});
