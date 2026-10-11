import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decryptBankAccount, encryptBankAccount } from "../src/lib/bank-account-crypto";
import { bankRotationPlan } from "../scripts/lib/bank-rotation-policy";

const first = { BANK_DATA_ENCRYPTION_KEY: "a".repeat(64) } as NodeJS.ProcessEnv;
const second = { BANK_DATA_ENCRYPTION_KEY: "b".repeat(64) } as NodeJS.ProcessEnv;
const rotating = {
  ...second, BANK_DATA_ENCRYPTION_KEY_PREVIOUS: first.BANK_DATA_ENCRYPTION_KEY,
} as NodeJS.ProcessEnv;
const plain = "SYNTHETIC-ACCOUNT-12345";

test("rotation skips values already authenticated by the current key", () => {
  const current = encryptBankAccount(plain, second)!;
  assert.deepEqual(bankRotationPlan(current, rotating), { status: "already-current" });
  for (const value of [null, undefined, "", " "]) {
    assert.deepEqual(bankRotationPlan(value, rotating), { status: "empty" });
  }
});

test("previous-only envelopes are rewrapped, and the new envelope decrypts without the previous key", () => {
  const previous = encryptBankAccount(plain, first)!;
  const decision = bankRotationPlan(previous, rotating);
  assert.equal(decision.status, "rewrap");
  if (decision.status !== "rewrap") return;
  assert.notEqual(decision.replacement, previous);
  assert.equal(decryptBankAccount(decision.replacement, second), plain);
  assert.throws(() => decryptBankAccount(previous, second), /could not be decrypted/);
});

test("malformed, plaintext, absent previous key and TOTP-only current fail closed", () => {
  const old = encryptBankAccount(plain, first)!;
  for (const value of [plain, " enc:v1:garbage", 42, {}, ["bank"], "enc:v1:forged"]) {
    assert.throws(() => bankRotationPlan(value, rotating));
  }
  assert.throws(() => bankRotationPlan(old, second), /previous key/);
  assert.throws(() => bankRotationPlan(old, {
    TOTP_ENCRYPTION_KEY: second.BANK_DATA_ENCRYPTION_KEY,
    BANK_DATA_ENCRYPTION_KEY_PREVIOUS: first.BANK_DATA_ENCRYPTION_KEY,
  } as NodeJS.ProcessEnv), /dedicated current bank encryption key/);
});

test("bank rotation scans all four stores with bounded pages and compare-and-swap writes", () => {
  const script = readFileSync("scripts/rotate-bank-envelopes.ts", "utf8");
  for (const key of [
    "employees.bankAccount", "payrollEntries.trace",
    "legalEntities.disbursementAccount", "employeePayoutChangeRequests.proposedBankAccount",
    "gt(employees.id, cursor)", "gt(payrollEntries.id, cursor)",
    "gt(legalEntities.id, cursor)", "gt(employeePayoutChangeRequests.id, cursor)",
    "replaceEmployeeBankAccount(pool", "replacePayrollSnapshotBankAccount(pool",
    "eq(legalEntities.disbursementAccount, original)",
    "eq(employeePayoutChangeRequests.proposedBankAccount, original)",
  ]) assert.ok(script.includes(key), key);
  assert.ok(script.includes("const PAGE_SIZE = 500"));
  assert.ok(script.indexOf("await scanAll(false)") < script.indexOf("await scanAll(true)"));
  assert.ok(script.includes('BANK_ROTATION_CONFIRMATION !== "APPLY_APPROVED_BANK_ROTATION"'));
  assert.ok(script.includes("EXPECTED_PRODUCTION_DATABASE_NAME"));
  assert.ok(script.includes("BANK_ROTATION_APPROVAL_REF"));
  assert.doesNotMatch(script, /SET trace\s*=\s*\$|trace:\s*\{\s*\.\.\.trace/);
  assert.ok(!script.includes("console.log(row."), "Never log bank values or IDs.");
});

test("legacy all-in-one sensitive rotation refuses unsafe two-store bank rewrap", () => {
  const script = readFileSync("scripts/rotate-sensitive-encryption.ts", "utf8");
  assert.match(script, /if \(rotateBank\) \{\s*throw new Error/);
  assert.ok(script.indexOf("if (rotateBank) {") < script.indexOf("const employeeRows = await db.select()"),
    "The unsafe legacy bank rotation must fail before any data is read or written");
});
