import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { requireDisposableIdentityAccount } from "../scripts/qa/tenant-identity-account-proof.mjs";
import { TENANT_TABLE_BASE_ENV } from "../scripts/qa/tenant-table-env.mjs";

const good = {
  ...TENANT_TABLE_BASE_ENV,
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  RESEND_API_KEY: "",
};

test("email verification proof refuses non-CI, nonlocal DB or application and providers", () => {
  assert.equal(requireDisposableIdentityAccount(good), true);
  for (const unsafe of [
    { CI: "false" },
    { DATABASE_URL: "postgresql://postgres:postgres@db.example.invalid:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/production" },
    { SECURITY_SMOKE_URL: "https://example.invalid" },
    { RESEND_API_KEY: "real-or-fake-provider-credential" },
    { XENDIT_PAYOUTS_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { DEMO_MODE: "true" },
  ]) {
    assert.throws(() => requireDisposableIdentityAccount({ ...good, ...unsafe }),
      /IDENTITY_PROOF_REFUSED/, "unsafe proof target must fail before any DB imports");
  }
});

test("email verification HTTP proof must gate before its first database import", () => {
  const source = readFileSync("scripts/qa/tenant-account-email-verify-http.mjs", "utf8");
  const gate = source.indexOf("requireDisposableIdentityAccount();");
  const dbImport = source.indexOf('import("../../src/db/index.ts")');
  assert.ok(gate > 0 && dbImport > gate, "disposable preflight must precede DB/app import");
  assert.match(source, /assert\.deepEqual\(await snapshot\(\), before/);
  assert.match(source, /noExternalEmailDelivery: true/);
  assert.match(source, /credits: 0/);
});
