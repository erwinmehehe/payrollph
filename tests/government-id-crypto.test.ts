import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptGovernmentId,
  encryptGovernmentId,
  governmentIdEncryptionConfigured,
  isEncryptedGovernmentId,
  maskGovernmentId,
} from "../src/lib/government-id-crypto";

const env = {
  ...process.env,
  PII_ENCRYPTION_KEY: "11".repeat(32),
  BANK_DATA_ENCRYPTION_KEY: "",
  TOTP_ENCRYPTION_KEY: "",
};

test("government identifiers use authenticated field-level encryption", () => {
  assert.equal(governmentIdEncryptionConfigured(env), true);
  const stored = encryptGovernmentId("123-456-789", { required: true, env });
  assert.ok(stored);
  assert.equal(isEncryptedGovernmentId(stored), true);
  assert.notEqual(stored, "123-456-789");
  assert.equal(decryptGovernmentId(stored, env), "123-456-789");
  assert.equal(maskGovernmentId(stored, env), "••••6789");
});

test("government identifier ciphertext tampering fails closed", () => {
  const stored = encryptGovernmentId("34-1234567-8", { required: true, env })!;
  const parts = stored.split(":");
  const ciphertext = parts.at(-1)!;
  parts[parts.length - 1] = ciphertext.slice(0, -1) + (ciphertext.endsWith("A") ? "B" : "A");
  assert.throws(() => decryptGovernmentId(parts.join(":"), env), /could not be decrypted/);
});

test("legacy plaintext identifiers remain readable for controlled backfill", () => {
  assert.equal(decryptGovernmentId("123-456-789", env), "123-456-789");
  assert.equal(maskGovernmentId("123-456-789", env), "••••6789");
});

test("production-style required encryption refuses plaintext writes without a key", () => {
  const noKey = { ...process.env, PII_ENCRYPTION_KEY: "", BANK_DATA_ENCRYPTION_KEY: "", TOTP_ENCRYPTION_KEY: "" };
  assert.equal(governmentIdEncryptionConfigured(noKey), false);
  assert.throws(
    () => encryptGovernmentId("123456789", { required: true, env: noKey }),
    /required before government identifiers can be stored/,
  );
});
