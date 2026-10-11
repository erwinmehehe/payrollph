import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  decryptBankAccount, encryptBankAccount, isEncryptedBankAccount,
} from "../src/lib/bank-account-crypto";
import { sealPayrollPaymentBankAccount } from "../src/lib/payroll-snapshot-sealing";

const KEY_A = "d".repeat(64);
const KEY_B = "e".repeat(64);
const withKey = (key?: string) => ({ NODE_ENV: "test", BANK_DATA_ENCRYPTION_KEY: key }) as NodeJS.ProcessEnv;

test("payroll engine preflights every chunk destination before inserting any entries", () => {
  const engine = readFileSync("src/lib/payroll-engine.ts", "utf8");
  const preflight = engine.indexOf("sealedPaymentBankAccounts.set(employee.id, sealPayrollPaymentBankAccount(employee.bankAccount))");
  const insert = engine.indexOf("await db.insert(payrollEntries).values({");
  assert.ok(preflight > 0 && insert > preflight, "bank accounts must be sealed before financial entries");
  assert.match(engine, /bankAccount: sealedPaymentBankAccounts\.get\(employee\.id\) \?\? null/);
  assert.ok(!engine.includes("bankAccount: employee.bankAccount,"));
  assert.ok(!engine.includes("bankAccount: encryptBankAccount(employee.bankAccount)"));
  assert.ok(engine.includes('import { sealPayrollPaymentBankAccount } from "@/lib/payroll-snapshot-sealing";'));
});

test("legacy account cannot enter a payroll payment snapshot without a current key", () => {
  for (const nodeEnv of ["production", "development", "test"]) {
    const env = { NODE_ENV: nodeEnv } as NodeJS.ProcessEnv;
    assert.throws(() => sealPayrollPaymentBankAccount("123456789012", env), /current bank encryption key is required/);
    assert.equal(sealPayrollPaymentBankAccount(null, env), null);
    assert.equal(sealPayrollPaymentBankAccount("", env), null);
    assert.equal(sealPayrollPaymentBankAccount("   ", env), null);
  }
  const previousOnly = { NODE_ENV: "test", BANK_DATA_ENCRYPTION_KEY_PREVIOUS: KEY_A } as NodeJS.ProcessEnv;
  assert.throws(() => sealPayrollPaymentBankAccount("123456789012", previousOnly), /current bank encryption key is required/);
});

test("payment snapshots encrypt and authenticate legacy bank numbers", () => {
  const env = withKey(KEY_A);
  const legacy = "123456789012";
  const sealed = sealPayrollPaymentBankAccount(legacy, env);
  assert.ok(isEncryptedBankAccount(sealed));
  assert.ok(!sealed?.includes(legacy));
  assert.equal(decryptBankAccount(sealed, env), legacy);
  assert.equal(sealPayrollPaymentBankAccount(sealed, env), sealed);
});

test("stored envelopes with wrong key or invalid GCM authentication fail closed", () => {
  const oldEnv = withKey(KEY_A);
  const sealed = encryptBankAccount("123456789012", oldEnv)!;
  assert.throws(() => sealPayrollPaymentBankAccount(sealed, withKey(KEY_B)), /could not be decrypted/);
  assert.throws(() => sealPayrollPaymentBankAccount("enc:v1:malformed", oldEnv), /malformed/);
  const rotation = {
    NODE_ENV: "test",
    BANK_DATA_ENCRYPTION_KEY: KEY_B,
    BANK_DATA_ENCRYPTION_KEY_PREVIOUS: KEY_A,
  } as NodeJS.ProcessEnv;
  assert.equal(sealPayrollPaymentBankAccount(sealed, rotation), sealed);
  assert.throws(() => sealPayrollPaymentBankAccount(sealed, withKey(undefined)), /current bank encryption key is required/);
});

test("malformed configured encryption keys do not allow payroll payment writes", () => {
  assert.throws(() => sealPayrollPaymentBankAccount("123456789012", withKey("invalid")), /current bank encryption key is required/);
});
