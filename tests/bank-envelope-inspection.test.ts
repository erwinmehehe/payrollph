import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decryptBankAccount, encryptBankAccount } from "../src/lib/bank-account-crypto";
import {
  classifyStoredBankEnvelope,
  currentBankKeyOnly,
} from "../scripts/lib/bank-envelope-inspection";

const current: NodeJS.ProcessEnv = { NODE_ENV: "test", BANK_DATA_ENCRYPTION_KEY: "c".repeat(64) };
const former: NodeJS.ProcessEnv = { NODE_ENV: "test", BANK_DATA_ENCRYPTION_KEY: "d".repeat(64) };
const account = "123456789012";

test("four-store cutover proof requires an authenticated current-key envelope", () => {
  const sealed = encryptBankAccount(account, current)!;
  assert.equal(classifyStoredBankEnvelope(sealed, currentBankKeyOnly(current)), "authenticated");
  for (const value of [null, undefined, "", "  "]) {
    assert.equal(classifyStoredBankEnvelope(value, currentBankKeyOnly(current)), "empty");
  }
  for (const value of [account, " enc:v1:garbage", "legacy"]) {
    assert.equal(classifyStoredBankEnvelope(value, currentBankKeyOnly(current)), "plaintext");
  }
  for (const value of [42, { account }, "enc:v1:malformed", "enc:v1:"]) {
    assert.equal(classifyStoredBankEnvelope(value, currentBankKeyOnly(current)), "unreadable");
  }
  assert.equal(classifyStoredBankEnvelope(sealed, currentBankKeyOnly({ NODE_ENV: "test" })), "unreadable");
});

test("an old-key-only envelope is NOT accepted even when a rotation key can read it", () => {
  const old = encryptBankAccount(account, former)!;
  const rotating = {
    ...current,
    BANK_DATA_ENCRYPTION_KEY_PREVIOUS: former.BANK_DATA_ENCRYPTION_KEY,
  };
  assert.equal(decryptBankAccount(old, rotating), account);
  assert.equal(classifyStoredBankEnvelope(old, currentBankKeyOnly(rotating)), "unreadable");
  assert.equal(classifyStoredBankEnvelope(encryptBankAccount(account, current), currentBankKeyOnly(rotating)), "authenticated");
});

test("bank cutover verification scans all stores with bounded keyset pages and fails on bad values", () => {
  const script = readFileSync("scripts/verify-bank-account-envelopes.ts", "utf8");
  for (const source of [
    "employees.id", "payrollEntries.id", "legalEntities.id",
    "employeePayoutChangeRequests.id",
    "employees.bankAccount", "payrollEntries.trace",
    "legalEntities.disbursementAccount", "employeePayoutChangeRequests.proposedBankAccount",
  ]) assert.ok(script.includes(source), "Source must be reviewed: " + source);
  assert.match(script, /PAGE_SIZE = 500/);
  assert.match(script, /gt\(employees\.id, cursor\)/);
  assert.match(script, /gt\(payrollEntries\.id, cursor\)/);
  assert.match(script, /gt\(legalEntities\.id, cursor\)/);
  assert.match(script, /gt\(employeePayoutChangeRequests\.id, cursor\)/);
  assert.match(script, /result\.plaintext !== 0 \|\| result\.unreadable !== 0/);
  assert.ok(!script.includes("console.log(row."), "Never print bank field contents");
});
