import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  decryptBankAccount, encryptBankAccount, isEncryptedBankAccount,
} from "../src/lib/bank-account-crypto";

test("payroll engine never copies employee bank account bytes directly into payment trace", () => {
  const engine = readFileSync("src/lib/payroll-engine.ts", "utf8");
  assert.match(engine, /bankAccount: encryptBankAccount\(employee\.bankAccount\)/);
  assert.ok(!engine.includes("bankAccount: employee.bankAccount,"));
  assert.ok(engine.includes('import { encryptBankAccount } from "@/lib/bank-account-crypto";'));
});

test("payment snapshot encryption protects legacy numbers when key is available", () => {
  const key = "d".repeat(64);
  const env = { NODE_ENV: "test", BANK_DATA_ENCRYPTION_KEY: key } as NodeJS.ProcessEnv;
  const legacy = "123456789012";
  const snapshotAccount = encryptBankAccount(legacy, env);
  assert.ok(isEncryptedBankAccount(snapshotAccount));
  assert.ok(!snapshotAccount?.includes(legacy));
  assert.equal(decryptBankAccount(snapshotAccount, env), legacy);
});
