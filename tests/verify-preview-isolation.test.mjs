import assert from "node:assert/strict";
import test from "node:test";
import { auditPreviewIsolationMetadata } from "../scripts/verify-preview-isolation.mjs";

const production = (key) => ({ key, target: ["production"] });
const preview = (key) => ({ key, target: ["preview"] });
const required = ["DATABASE_URL", "TOTP_ENCRYPTION_KEY", "PII_ENCRYPTION_KEY", "BANK_DATA_ENCRYPTION_KEY"];

test("known remaining PGUSER and DATABASE_URL_UNPOOLED shared assignments fail closed", () => {
  const result = auditPreviewIsolationMetadata({ envs: [
    ...required.map(production),
    { key: "PGUSER", target: ["production", "preview"] },
    { key: "DATABASE_URL_UNPOOLED", target: ["preview", "production"] },
  ] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("PGUSER is shared by Preview and Production"));
  assert.ok(result.errors.includes("DATABASE_URL_UNPOOLED is shared by Preview and Production"));
});

test("all shared secrets removed still blocks acceptance until Preview-only DB and keys exist", () => {
  const result = auditPreviewIsolationMetadata({ envs: required.map(production) });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, required.length);
});

test("split Preview/Production assignments pass metadata only, never operational staging proof", () => {
  const result = auditPreviewIsolationMetadata({ envs: [
    ...required.map(production), ...required.map(preview), production("PGUSER"), preview("PGUSER"),
  ] });
  assert.equal(result.ok, true);
  assert.match(result.message, /STILL REQUIRED/);
});

test("previously unknown session or provider key shared across environments also fails", () => {
  const result = auditPreviewIsolationMetadata({ envs: [
    ...required.map(preview),
    { key: "FUTURE_PROVIDER_SESSION_KEY", target: ["production", "preview"] },
  ] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("FUTURE_PROVIDER_SESSION_KEY is shared by Preview and Production"));
});

test("branch-specific Preview overrides alone never satisfy required Preview-wide secrets", () => {
  const scoped = required.map(key => ({ ...preview(key), gitBranch: "feature/sandbox" }));
  const result = auditPreviewIsolationMetadata({ envs: [
    ...required.map(production), ...scoped,
  ] });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, required.map(key => "Preview-only " + key + " is absent"));
  assert.match(result.message, /NO-GO/);
});

test("unscoped Preview-only assignments permit supplemental branch-specific overrides", () => {
  const result = auditPreviewIsolationMetadata({ envs: [
    ...required.map(production), ...required.map(preview),
    ...required.map(key => ({ ...preview(key), gitBranch: "feature/sandbox" })),
  ] });
  assert.equal(result.ok, true, "A scoped override must not invalidate a safe unscoped Preview base");
  assert.match(result.message, /STILL REQUIRED/);
});

test("malformed Git branch selectors fail closed without exposing record values", () => {
  const secret = "private-secret-not-for-logs";
  for (const gitBranch of ["", " sandbox ", "\nmain", 42, false, [], {}]) {
    const result = auditPreviewIsolationMetadata({ envs: [
      ...required.map(preview),
      { key: "OPTIONAL_BRANCH_OVERRIDE", target: ["preview"], gitBranch, value: secret },
    ] });
    assert.equal(result.ok, false, "bad selector: " + JSON.stringify(gitBranch));
    assert.ok(result.errors.some(error => error.startsWith("Malformed environment record")));
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test("pagination or invalid response shape fails closed", () => {
  assert.throws(() => auditPreviewIsolationMetadata({ envs: [], pagination: { next: "cursor" } }), /paginated/);
  assert.throws(() => auditPreviewIsolationMetadata({ envs: "invalid" }), /envs array/);
});

test("malformed key and target assignment fails rather than silently ignoring", () => {
  const result = auditPreviewIsolationMetadata({ envs: [
    ...required.map(preview), { key: "malformed secret\n", target: ["preview"] },
    { key: "MISSING_TARGET", target: [] },
  ] });
  assert.equal(result.ok, false);
  assert.equal(result.errors.filter((e) => e.startsWith("Malformed")).length, 2);
});

test("secret values never enter assessment output", () => {
  const value = "do-not-log-credentials-or-payroll-secrets";
  const result = auditPreviewIsolationMetadata({ envs: [
    { key: "DATABASE_URL", target: ["production", "preview"], value },
    ...required.slice(1).map(preview),
  ] });
  assert.equal(JSON.stringify(result).includes(value), false);
});
