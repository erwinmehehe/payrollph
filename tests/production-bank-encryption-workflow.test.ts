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
    "Verify live readiness sees encrypted bank data",
  ]) {
    assert.ok(workflow.includes(`      - name: ${name}\n        if: \${{ inputs.mode == 'apply' }}`));
  }
});
