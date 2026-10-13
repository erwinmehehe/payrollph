import assert from "node:assert/strict";
import test from "node:test";
import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import {
  planGovernmentIdRewrap, planProfilePhotoRewrap, requireDedicatedPiiKey,
} from "../scripts/lib/pii-rotation-policy";
import { validatePiiRotationOperator } from "../scripts/lib/pii-rotation-backfill";
import { decryptGovernmentId, encryptGovernmentId } from "../src/lib/government-id-crypto";
import { decryptProfilePhoto, encryptProfilePhoto } from "../src/lib/ess-photo-crypto";

const parent = Buffer.from("11".repeat(32), "hex");
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  PII_ENCRYPTION_KEY: "33".repeat(32),
  BANK_DATA_ENCRYPTION_KEY: "11".repeat(32),
  TOTP_ENCRYPTION_KEY: "22".repeat(32),
  PII_LEGACY_READ_ENABLED: "true",
  PII_LEGACY_GOVERNMENT_ID_KEY: createHmac("sha256", parent)
    .update("linaw:government-identifiers:v1").digest("hex"),
  PII_LEGACY_PHOTO_KEY: createHmac("sha256", parent)
    .update("linaw:employee-profile-photo:v1").digest("hex"),
};
const currentOnly: NodeJS.ProcessEnv = { NODE_ENV: "test", PII_ENCRYPTION_KEY: env.PII_ENCRYPTION_KEY };

function oldEnvelope(prefix: string, key: Buffer, data: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const bytes = Buffer.concat([cipher.update(data), cipher.final()]);
  return prefix + [iv, cipher.getAuthTag(), bytes].map(v => v.toString("base64url")).join(":");
}

test("legacy government identifiers rewrap with old-key read and current-key-only verification", () => {
  const old = oldEnvelope("enc:govid:v1:", Buffer.from(env.PII_LEGACY_GOVERNMENT_ID_KEY!, "hex"),
    Buffer.from("synthetic-123456"));
  assert.throws(() => decryptGovernmentId(old, currentOnly));
  assert.throws(() => planGovernmentIdRewrap(old, { ...env, PII_LEGACY_READ_ENABLED: "false" }));
  const decision = planGovernmentIdRewrap(old, env);
  assert.equal(decision.status, "rewrap");
  if (decision.status !== "rewrap") return;
  assert.equal(decryptGovernmentId(decision.replacement, currentOnly), "synthetic-123456");
  assert.deepEqual(planGovernmentIdRewrap(decision.replacement, env), { status: "already-current" });
  assert.deepEqual(planGovernmentIdRewrap(null, env), { status: "empty" });
  assert.throws(() => planGovernmentIdRewrap("plaintext", env), /not a recognized encrypted/);
});

test("legacy portrait rewrap preserves byte-for-byte content and integrity verification", () => {
  const bytes = Buffer.from("fictional-photo-content");
  const metadata = { byteSize: bytes.length, contentSha256: createHash("sha256").update(bytes).digest("hex") };
  const old = oldEnvelope("enc:essphoto:v1:", Buffer.from(env.PII_LEGACY_PHOTO_KEY!, "hex"), bytes);
  assert.throws(() => decryptProfilePhoto(old, currentOnly));
  const decision = planProfilePhotoRewrap(old, metadata, env);
  assert.equal(decision.status, "rewrap");
  if (decision.status !== "rewrap") return;
  assert.deepEqual(decryptProfilePhoto(decision.replacement, currentOnly), bytes);
  assert.deepEqual(planProfilePhotoRewrap(decision.replacement, metadata, env), { status: "already-current" });
  assert.throws(() => planProfilePhotoRewrap(old, { ...metadata, byteSize: 0 }, env), /integrity/);
  assert.throws(() => planProfilePhotoRewrap(old, metadata, { ...env, PII_LEGACY_READ_ENABLED: "false" }));
});

test("rotation refuses missing, copied, and malformed dedicated keys", () => {
  assert.throws(() => requireDedicatedPiiKey({ NODE_ENV: "test", TOTP_ENCRYPTION_KEY: env.TOTP_ENCRYPTION_KEY }));
  assert.throws(() => requireDedicatedPiiKey({ ...env, PII_ENCRYPTION_KEY: env.BANK_DATA_ENCRYPTION_KEY }));
  assert.throws(() => requireDedicatedPiiKey({ ...env, PII_ENCRYPTION_KEY: env.TOTP_ENCRYPTION_KEY }));
  assert.throws(() => requireDedicatedPiiKey({ ...env, PII_ENCRYPTION_KEY: "bad" }));
  assert.throws(() => requireDedicatedPiiKey({
    ...env, PII_ENCRYPTION_KEY: env.PII_LEGACY_GOVERNMENT_ID_KEY,
  }), /must be independent/);
  assert.throws(() => requireDedicatedPiiKey({
    ...env, PII_ENCRYPTION_KEY: env.PII_LEGACY_PHOTO_KEY,
  }), /must be independent/);
  assert.throws(() => requireDedicatedPiiKey({
    ...env, PII_ENCRYPTION_KEY_PREVIOUS: env.PII_ENCRYPTION_KEY,
  }), /must be independent/);
  assert.doesNotThrow(() => requireDedicatedPiiKey(env));
});

test("current-key ciphertext is never unnecessarily re-encrypted", () => {
  const current = encryptGovernmentId("fictional-id", { required: true, env: currentOnly })!;
  const photo = encryptProfilePhoto(Buffer.from("fictional-photo"), currentOnly, { required: true });
  const photoBytes = Buffer.from("fictional-photo");
  const meta = { byteSize: photoBytes.length, contentSha256: createHash("sha256").update(photoBytes).digest("hex") };
  assert.deepEqual(planGovernmentIdRewrap(current, env), { status: "already-current" });
  assert.deepEqual(planProfilePhotoRewrap(photo, meta, env), { status: "already-current" });
});

test("operator apply requires a verified tenant and explicit approval; dry-run never does", () => {
  const configured: NodeJS.ProcessEnv = {
    ...env, PII_ROTATION_ORGANIZATION_ID: "1001",
    EXPECTED_PRODUCTION_DATABASE_NAME: "app_db",
  };
  assert.deepEqual(validatePiiRotationOperator(configured, false), {
    organizationId: 1001, expectedDatabase: "app_db",
  });
  assert.throws(() => validatePiiRotationOperator(configured, true), /explicit confirmation/);
  assert.throws(() => validatePiiRotationOperator({
    ...configured, PII_ROTATION_CONFIRMATION: "APPLY_APPROVED_PII_ROTATION",
  }, true), /approval reference/);
  assert.deepEqual(validatePiiRotationOperator({
    ...configured, PII_ROTATION_CONFIRMATION: "APPLY_APPROVED_PII_ROTATION",
    PII_ROTATION_APPROVAL_REF: "SECURITY-CHANGE-1234",
  }, true), { organizationId: 1001, expectedDatabase: "app_db" });
  for (const invalidId of ["0", "-1", "1.5", "not-an-id"]) {
    assert.throws(() => validatePiiRotationOperator({
      ...configured, PII_ROTATION_ORGANIZATION_ID: invalidId,
    }, false), /approved tenant/);
  }
  assert.throws(() => validatePiiRotationOperator({
    ...configured, EXPECTED_PRODUCTION_DATABASE_NAME: "db;DROP TABLE employees",
  }, false), /DBA-verified/);
});

test("flag OFF preserves dedicated-key reads while blocking historical-key reads", () => {
  const off: NodeJS.ProcessEnv = { ...env, PII_LEGACY_READ_ENABLED: "false" };
  const current = encryptGovernmentId("fictional-current-id", { required: true, env: currentOnly })!;
  assert.equal(decryptGovernmentId(current, off), "fictional-current-id");
  assert.deepEqual(planGovernmentIdRewrap(current, off), { status: "already-current" });
  assert.equal(decryptProfilePhoto(encryptProfilePhoto(Buffer.from("fictional-photo"), currentOnly),
    off).toString(), "fictional-photo");
});
