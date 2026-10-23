import test from "node:test";
import assert from "node:assert/strict";
import { assertMoneyProofTarget } from "../scripts/qa/money-proof-target.mjs";
const safe = { MONEY_PROOF_MODE: "disposable-only", MONEY_PROOF_URL: "http://127.0.0.1:3011",
  DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:5432/payroll_mny01_test" };
test("money proof accepts only its explicitly selected disposable target", () => {
  assert.doesNotThrow(() => assertMoneyProofTarget(safe));
});
test("money proof rejects hosted, ambiguous and provider-enabled targets before imports", () => {
  for (const change of [
    { MONEY_PROOF_MODE: undefined }, { MONEY_PROOF_URL: "https://example.com" },
    { MONEY_PROOF_URL: "http://127.0.0.1:3000" }, { MONEY_PROOF_URL: "http://127.0.0.1:3011/?x=1" },
    { DATABASE_URL: "postgresql://synthetic:synthetic@database.example.com:5432/payroll_mny01_test" },
    { DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:5432/neondb" },
    { DATABASE_URL: safe.DATABASE_URL + "?host=remote.example.com" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" }, { XENDIT_PAYOUTS_ENABLED: "true" },
    { PAYROLL_UNDERPAYMENT_POSTING_ENABLED: "true" },
    { PAYMONGO_SECRET_KEY: "synthetic" }, { XENDIT_SECRET_KEY: "synthetic" },
    { XENDIT_PAYOUT_SECRET_KEY: "synthetic" }, { POSTMARK_SERVER_TOKEN: "synthetic" },
    { SMTP_URL: "smtp://synthetic.invalid" }, { RESEND_API_KEY: "synthetic" }, { SMTP_HOST: "synthetic" },
  ]) assert.throws(() => assertMoneyProofTarget({ ...safe, ...change }));
});
