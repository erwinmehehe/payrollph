import assert from "node:assert/strict";
import test from "node:test";
import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { register } from "../src/instrumentation";
import { decryptGovernmentId, encryptGovernmentId, rotateGovernmentIdEncryption } from "../src/lib/government-id-crypto";
import { decryptProfilePhoto, encryptProfilePhoto } from "../src/lib/ess-photo-crypto";

function legacyRow(prefix: string, key: Buffer, plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const bytes = Buffer.concat([cipher.update(plain), cipher.final()]);
  return prefix + [iv, cipher.getAuthTag(), bytes].map(x => x.toString("base64url")).join(":");
}

test("the real standalone production worker refuses work without its dedicated PII key", () => {
  const boot = (pii: string, enabled: string) => spawnSync(process.execPath, ["--import", "tsx", "scripts/worker.ts"], {
    cwd: process.cwd(), encoding: "utf8", timeout: 20_000,
    env: { ...process.env, NODE_ENV: "production", DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
      PII_ENCRYPTION_KEY: pii, BANK_DATA_ENCRYPTION_KEY: "11".repeat(32), TOTP_ENCRYPTION_KEY: "22".repeat(32),
      WORKER_ENABLED: enabled, CENTRAL_SCHEDULER_ENABLED: "false", WORKER_POLL_MS: "3000" },
  });
  const missing = boot("", "true");
  assert.equal(missing.error, undefined);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /PII_ENCRYPTION_KEY must be a dedicated 32-byte key/);
  assert.doesNotMatch(missing.stdout, /worker started/);
  const off = boot("33".repeat(32), "false");
  assert.equal(off.error, undefined);
  assert.equal(off.status, 1);
  assert.match(off.stderr, /WORKER_ENABLED must be true/);
  assert.doesNotMatch(off.stderr, /PII_ENCRYPTION_KEY/);
  assert.doesNotMatch(off.stdout, /worker started/);
});

test("production boot rejects missing dedicated PII key even with bank and TOTP keys", async () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, { NODE_ENV: "production", NEXT_RUNTIME: "nodejs", PII_ENCRYPTION_KEY: "", BANK_DATA_ENCRYPTION_KEY: "11".repeat(32), TOTP_ENCRYPTION_KEY: "22".repeat(32) });
    await assert.rejects(register(), /PII_ENCRYPTION_KEY/);
    process.env.PII_ENCRYPTION_KEY = "11".repeat(32);
    await assert.rejects(register(), /must not reuse bank or TOTP/);
    process.env.PII_ENCRYPTION_KEY = "22".repeat(32);
    await assert.rejects(register(), /must not reuse bank or TOTP/);
    process.env.PII_ENCRYPTION_KEY = "33".repeat(32);
    await register();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test("old fallback rows read only in explicit transition and rewrap under dedicated key", () => {
  const parent = Buffer.from("11".repeat(32), "hex");
  const govKey = createHmac("sha256", parent).update("linaw:government-identifiers:v1").digest();
  const photoKey = createHmac("sha256", parent).update("linaw:employee-profile-photo:v1").digest();
  const row = legacyRow("enc:govid:v1:", govKey, "123-456-789");
  const portrait = legacyRow("enc:essphoto:v1:", photoKey, "fictional portrait bytes");
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PII_ENCRYPTION_KEY: "33".repeat(32), PII_LEGACY_GOVERNMENT_ID_KEY: govKey.toString("hex"), PII_LEGACY_PHOTO_KEY: photoKey.toString("hex"), PII_LEGACY_READ_ENABLED: "true" };
  assert.equal(decryptGovernmentId(row, env), "123-456-789");
  assert.equal(decryptProfilePhoto(portrait, env).toString(), "fictional portrait bytes");
  const rewritten = rotateGovernmentIdEncryption(row, { required: true, env })!;
  const photo = encryptProfilePhoto(decryptProfilePhoto(portrait, env), env);
  const retired: NodeJS.ProcessEnv = { NODE_ENV: "test", PII_ENCRYPTION_KEY: env.PII_ENCRYPTION_KEY };
  assert.equal(decryptGovernmentId(rewritten, retired), "123-456-789");
  assert.equal(decryptProfilePhoto(photo, retired).toString(), "fictional portrait bytes");
  assert.throws(() => decryptGovernmentId(row, retired));
  assert.throws(() => decryptProfilePhoto(portrait, retired));
  assert.throws(() => decryptGovernmentId(row, { ...env, PII_LEGACY_READ_ENABLED: "false" }));
});

test("writers cannot select bank or authentication secrets", () => {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", BANK_DATA_ENCRYPTION_KEY: "11".repeat(32), TOTP_ENCRYPTION_KEY: "22".repeat(32) };
  assert.throws(() => encryptGovernmentId("123456789", { required: true, env }));
  assert.throws(() => encryptProfilePhoto(Buffer.from("portrait"), env));
});
