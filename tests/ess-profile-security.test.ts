import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ESS_IDENTIFIER_KINDS, isEssIdentifierKind, normalizeEssIdentifier,
} from "../src/lib/ess-identifiers";
import { encryptProfilePhoto, decryptProfilePhoto } from "../src/lib/ess-photo-crypto";
import { decryptGovernmentId, encryptGovernmentId, maskGovernmentId } from "../src/lib/government-id-crypto";

const key = { PII_ENCRYPTION_KEY: "f9".repeat(32) } as NodeJS.ProcessEnv;
const wrong = { PII_ENCRYPTION_KEY: "ab".repeat(32) } as NodeJS.ProcessEnv;

test("ESS identifier allowlist excludes arbitrary properties", () => {
  assert.equal(isEssIdentifierKind("__proto__"), false);
  assert.equal(isEssIdentifierKind("bankAccount"), false);
  assert.equal(ESS_IDENTIFIER_KINDS.length, 9);
});

test("ESS validates and canonicalizes official government ID formats", () => {
  const cases = [
    ["sssNo", "12-3456789-0", "1234567890"],
    ["tin", "123-456-789", "123456789"],
    ["tinBranchCode", "0012", "0012"],
    ["philHealthNo", "12-345678901-2", "123456789012"],
    ["pagIbigNo", "1234 5678 9012", "123456789012"],
    ["passportNo", "P1234567", "P1234567"],
    ["driversLicenseNo", "N01-12-345678", "N0112345678"],
    ["prcLicenseNo", "123456", "123456"],
    ["umidNo", "0000 1234 5678", "000012345678"],
  ] as const;
  for (const [kind, input, expected] of cases) {
    assert.deepEqual(normalizeEssIdentifier(kind, input), { ok: true, value: expected });
  }
  assert.equal(normalizeEssIdentifier("sssNo", "123").ok, false);
  assert.equal(normalizeEssIdentifier("tin", "<script>alert(1)</script>").ok, false);
  assert.equal(normalizeEssIdentifier("passportNo", "A".repeat(130)).ok, false);
});

test("government IDs are encrypted, masked and support rotation", () => {
  const encrypted = encryptGovernmentId("123456789012", { required: true, env: key });
  assert.ok(encrypted?.startsWith("enc:govid:"));
  assert.ok(!encrypted?.includes("123456789012"));
  assert.equal(maskGovernmentId(encrypted, key), "••••9012");
  assert.equal(decryptGovernmentId(encrypted, key), "123456789012");
  assert.throws(() => decryptGovernmentId(encrypted, wrong));
  assert.throws(() => encryptGovernmentId("1234", { required: true, env: {} }));
});

test("ESS profile photos use purpose-separated AES-GCM and reject other keys", () => {
  const source = Buffer.from("photo content for a test, not a real image");
  const sealed = encryptProfilePhoto(source, key);
  assert.ok(sealed.startsWith("enc:essphoto:v1:"));
  assert.ok(!sealed.includes(source.toString("base64")));
  assert.deepEqual(decryptProfilePhoto(sealed, key), source);
  assert.throws(() => decryptProfilePhoto(sealed, wrong));
  assert.throws(() => encryptProfilePhoto(source, {}));
  assert.throws(() => decryptProfilePhoto(source.toString("base64"), key));
});
