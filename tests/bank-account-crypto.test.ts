import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  bankEncryptionConfigured,
  bankEncryptionKeyFingerprint,
  bankEncryptionKeySource,
  bankEncryptionPreviousKeyConfigured,
  decryptBankAccount,
  encryptBankAccount,
  isEncryptedBankAccount,
  maskBankAccount,
  parseBankEncryptionKey,
  rotateBankAccountEncryption,
  sameBankAccount,
} from "../src/lib/bank-account-crypto";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const withKey = (key?: string) => ({ BANK_DATA_ENCRYPTION_KEY: key }) as unknown as NodeJS.ProcessEnv;
const withTotpMaster = (key?: string) => ({ TOTP_ENCRYPTION_KEY: key }) as unknown as NodeJS.ProcessEnv;

test("an account number round-trips and is not stored readable", () => {
  const sealed = encryptBankAccount("1234567890", withKey(KEY_A));
  assert.ok(sealed && isEncryptedBankAccount(sealed));
  assert.ok(!sealed.includes("1234567890"), "the plaintext must not appear in the stored value");
  assert.equal(decryptBankAccount(sealed, withKey(KEY_A)), "1234567890");
});

test("the same number encrypts differently every time", () => {
  const first = encryptBankAccount("1234567890", withKey(KEY_A));
  const second = encryptBankAccount("1234567890", withKey(KEY_A));
  assert.notEqual(first, second, "a fixed IV would let equal account numbers be spotted");
});

test("a stored value fits the widened column", () => {
  const longest = encryptBankAccount("9".repeat(40), withKey(KEY_A))!;
  assert.ok(longest.length <= 160, `envelope is ${longest.length} chars, column is varchar(160)`);
  assert.ok(longest.length > 40, "the old varchar(40) column could not hold it");
});

test("the wrong key and tampering both fail instead of returning garbage", () => {
  const sealed = encryptBankAccount("1234567890", withKey(KEY_A))!;
  assert.throws(() => decryptBankAccount(sealed, withKey(KEY_B)), /could not be decrypted/);

  const parts = sealed.split(":");
  const flipped = parts[4].startsWith("A") ? `B${parts[4].slice(1)}` : `A${parts[4].slice(1)}`;
  const tampered = [...parts.slice(0, 4), flipped].join(":");
  assert.throws(() => decryptBankAccount(tampered, withKey(KEY_A)), /could not be decrypted/);
});

test("an encrypted value with no key configured is an error, never a silent blank", () => {
  const sealed = encryptBankAccount("1234567890", withKey(KEY_A))!;
  assert.throws(() => decryptBankAccount(sealed, withKey(undefined)), /configured/);
});

test("legacy plaintext remains readable for migration, but non-empty writes fail closed without a key", () => {
  assert.equal(decryptBankAccount("1234567890", withKey(KEY_A)), "1234567890");
  assert.equal(decryptBankAccount("1234567890", withKey(undefined)), "1234567890");
  assert.throws(
    () => encryptBankAccount("1234567890", withKey(undefined)),
    /Bank-account save refused: configure BANK_DATA_ENCRYPTION_KEY or TOTP_ENCRYPTION_KEY/,
  );
  const sealed = encryptBankAccount("1234567890", withKey(KEY_A))!;
  assert.throws(
    () => encryptBankAccount(sealed, withKey(undefined)),
    /Bank-account save refused/,
    "re-saving ciphertext must not silently skip key verification",
  );
  assert.equal(encryptBankAccount(null, withKey(undefined)), null);
  assert.equal(encryptBankAccount("  ", withKey(undefined)), null);
});

test("saving twice never double-encrypts, and empty stays null", () => {
  const once = encryptBankAccount("1234567890", withKey(KEY_A))!;
  assert.equal(encryptBankAccount(once, withKey(KEY_A)), once);
  assert.equal(encryptBankAccount("", withKey(KEY_A)), null);
  assert.equal(encryptBankAccount("   ", withKey(KEY_A)), null);
  assert.equal(encryptBankAccount(null, withKey(KEY_A)), null);
  assert.equal(decryptBankAccount(null, withKey(KEY_A)), null);
});

test("a malformed key is rejected loudly instead of silently storing plaintext", () => {
  assert.throws(() => encryptBankAccount("1234567890", withKey("too-short")), /32 bytes/);
  assert.equal(bankEncryptionConfigured(withKey("too-short")), false);
  assert.equal(bankEncryptionConfigured(withKey(KEY_A)), true);
  assert.equal(bankEncryptionConfigured(withKey(undefined)), false);
});

test("keys are accepted as 64 hex characters or as base64", () => {
  assert.equal(parseBankEncryptionKey(KEY_A)?.length, 32);
  assert.equal(parseBankEncryptionKey(Buffer.alloc(32, 7).toString("base64"))?.length, 32);
  assert.equal(parseBankEncryptionKey(Buffer.alloc(16, 7).toString("base64")), null);
  assert.equal(parseBankEncryptionKey(undefined), null);
});

test("what the browser receives shows the last four digits and nothing usable", () => {
  const sealed = encryptBankAccount("1234567890", withKey(KEY_A))!;
  assert.equal(maskBankAccount(sealed, withKey(KEY_A)), "••••7890");
  assert.equal(maskBankAccount("1234567890", withKey(undefined)), "••••7890");
  assert.equal(maskBankAccount("123", withKey(undefined)), "••••");
  assert.equal(maskBankAccount(null, withKey(undefined)), null);
  // An unreadable value must not break a whole dashboard payload.
  assert.equal(maskBankAccount(sealed, withKey(KEY_B)), "••••");
  assert.ok(!String(maskBankAccount("1234567890", withKey(undefined))).includes("123456"));
});

test("the release guard compares decrypted values, so re-encrypting is not a 'change'", () => {
  const first = encryptBankAccount("1234567890", withKey(KEY_A))!;
  const second = encryptBankAccount("1234567890", withKey(KEY_A))!;
  assert.notEqual(first, second);
  assert.equal(sameBankAccount(first, second, withKey(KEY_A)), true, "same number, different envelope");
  assert.equal(sameBankAccount(first, "1234567890", withKey(KEY_A)), true, "plaintext snapshot vs sealed row");
  assert.equal(sameBankAccount(first, encryptBankAccount("1234567891", withKey(KEY_A)), withKey(KEY_A)), false);
  assert.equal(sameBankAccount(null, null, withKey(KEY_A)), true);
  assert.equal(sameBankAccount(null, "1234567890", withKey(KEY_A)), false);
  // An unreadable value must never count as unchanged, not even against itself.
  assert.equal(sameBankAccount(first, first, withKey(KEY_B)), false);
});

test("every place that reads or writes the number goes through the crypto module", () => {
  const read = (path: string) => readFileSync(path, "utf8");

  const payout = read("src/lib/paymongo-disbursements.ts");
  assert.ok(payout.includes("decryptBankAccount(frozen.bankAccount)"), "PayMongo transfers must decrypt the independently verified frozen recipient account");
  assert.ok(!payout.includes("decryptBankAccount(employee.bankAccount)"), "PayMongo cannot route from a mutable employee account");

  const exporter = read("src/lib/exporters.ts");
  assert.ok(exporter.includes("decryptBankAccount(payment.bankAccount)"), "bank files must use the decrypted number");

  const settlement = read("src/lib/payroll-settlement.ts");
  assert.ok(settlement.includes("sameBankAccount(snapshot.bankAccount, employee.bankAccount)"), "release guard must compare decrypted values");

  for (const path of ["src/app/api/employees/import/route.ts", "src/app/api/migrations/route.ts"]) {
    const source = read(path);
    assert.ok(source.includes("encryptBankAccount(row.bankAccount)"), `${path} must encrypt on write`);
    assert.ok(!/bankAccount: row\.bankAccount,/.test(source), `${path} must not store the raw number`);
  }

  const publicDemo = read("src/db/public-demo.ts");
  assert.ok(publicDemo.includes("bankAccount: null"), "public demo must not persist bank-account data at all");
  assert.ok(!publicDemo.includes("encryptBankAccount(person.bankAccount)"), "public demo must not depend on production bank encryption keys");

  const localSeed = read("src/db/seed.ts");
  assert.ok(localSeed.includes("bankAccount: encryptBankAccount(person[8])"), "local demo seed must encrypt bank accounts when a key is available");

  for (const path of ["src/lib/dashboard-data.ts", "src/app/api/employees/route.ts"]) {
    assert.ok(read(path).includes("bankAccount: maskBankAccount(employee.bankAccount)"), `${path} must not send the account number to the browser`);
  }
});

test("the schema, baseline and migration agree on the widened column", () => {
  assert.ok(readFileSync("src/db/schema.ts", "utf8").includes('varchar("bank_account", { length: 160 })'));
  assert.ok(readFileSync("drizzle/baseline.sql", "utf8").includes('"bank_account" varchar(160)'));
  assert.ok(readFileSync("drizzle/0004_bank_account_envelope.sql", "utf8").includes("ALTER COLUMN bank_account TYPE varchar(160)"));
});


test("bank encryption can derive a domain-separated key from the TOTP master", () => {
  const env = withTotpMaster(KEY_A);
  const sealed = encryptBankAccount("1234567890", env);
  assert.ok(sealed && isEncryptedBankAccount(sealed));
  assert.equal(decryptBankAccount(sealed, env), "1234567890");
  assert.equal(bankEncryptionConfigured(env), true);
  assert.equal(bankEncryptionKeySource(env), "totp-derived");
  assert.throws(
    () => decryptBankAccount(sealed, withTotpMaster(KEY_B)),
    /could not be decrypted/,
  );
});

test("the rollout fingerprint is stable for the same effective key and changes for a different key", () => {
  const dedicatedA = bankEncryptionKeyFingerprint(withKey(KEY_A));
  const dedicatedAAgain = bankEncryptionKeyFingerprint(withKey(KEY_A));
  const dedicatedB = bankEncryptionKeyFingerprint(withKey(KEY_B));
  const derivedA = bankEncryptionKeyFingerprint(withTotpMaster(KEY_A));

  assert.match(dedicatedA ?? "", /^[0-9a-f]{16}$/);
  assert.equal(dedicatedA, dedicatedAAgain);
  assert.notEqual(dedicatedA, dedicatedB);
  assert.notEqual(dedicatedA, derivedA, "dedicated and domain-derived keys must not share a fingerprint");
  assert.equal(bankEncryptionKeyFingerprint(withKey(undefined)), null);
  assert.equal(bankEncryptionKeyFingerprint(withKey("bad")), null);
});

test("a dedicated bank key overrides the TOTP-derived key and malformed overrides fail loudly", () => {
  const dedicated = {
    BANK_DATA_ENCRYPTION_KEY: KEY_A,
    TOTP_ENCRYPTION_KEY: KEY_B,
  } as unknown as NodeJS.ProcessEnv;
  assert.equal(bankEncryptionKeySource(dedicated), "dedicated");
  const sealed = encryptBankAccount("1234567890", dedicated);
  assert.equal(decryptBankAccount(sealed, dedicated), "1234567890");

  const malformed = {
    BANK_DATA_ENCRYPTION_KEY: "bad",
    TOTP_ENCRYPTION_KEY: KEY_B,
  } as unknown as NodeJS.ProcessEnv;
  assert.equal(bankEncryptionConfigured(malformed), false);
  assert.throws(() => encryptBankAccount("1234567890", malformed), /BANK_DATA_ENCRYPTION_KEY/);
});


test("bank account envelopes can be read through a one-key rotation window and rewrapped", () => {
  const oldEnv = withKey(KEY_A);
  const sealedOld = encryptBankAccount("1234567890", oldEnv)!;
  const rotatingEnv = {
    BANK_DATA_ENCRYPTION_KEY: KEY_B,
    BANK_DATA_ENCRYPTION_KEY_PREVIOUS: KEY_A,
  } as unknown as NodeJS.ProcessEnv;

  assert.equal(bankEncryptionPreviousKeyConfigured(rotatingEnv), true);
  assert.equal(decryptBankAccount(sealedOld, rotatingEnv), "1234567890");

  const rotated = rotateBankAccountEncryption(sealedOld, rotatingEnv)!;
  assert.notEqual(rotated, sealedOld);
  assert.equal(decryptBankAccount(rotated, withKey(KEY_B)), "1234567890");
  assert.throws(() => decryptBankAccount(rotated, withKey(KEY_A)), /could not be decrypted/);
});

test("bank rotation also supports a previous TOTP-derived bank key", () => {
  const oldDerived = withTotpMaster(KEY_A);
  const sealedOld = encryptBankAccount("1234567890", oldDerived)!;
  const rotatingEnv = {
    BANK_DATA_ENCRYPTION_KEY: KEY_B,
    TOTP_ENCRYPTION_KEY_PREVIOUS: KEY_A,
  } as unknown as NodeJS.ProcessEnv;

  assert.equal(decryptBankAccount(sealedOld, rotatingEnv), "1234567890");
  const rotated = rotateBankAccountEncryption(sealedOld, rotatingEnv)!;
  assert.equal(decryptBankAccount(rotated, withKey(KEY_B)), "1234567890");
});
