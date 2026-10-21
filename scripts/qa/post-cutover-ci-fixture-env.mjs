#!/usr/bin/env node
// Disposable Actions-only fictional fixture configuration. No values printed,
// committed or uploaded. Existing production flags and secrets are untouched.
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";

if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true" ||
    !process.env.GITHUB_ENV || process.env.EXPECTED_DATABASE_NAME !== "payrollph_clean_baseline") {
  throw new Error("ISOLATED_ACTIONS_FIXTURE_ONLY");
}
const fictional = randomBytes(32).toString("hex") + "Aa7";
const invite = randomBytes(32).toString("hex");
const readiness = randomBytes(32).toString("hex");
const setup = randomBytes(32).toString("hex");
const bank = randomBytes(32).toString("hex");
const pii = randomBytes(32).toString("hex");
const totp = randomBytes(32).toString("hex");
const entries = [
  ["SMOKE_FAKE_ACCOUNT_PASSWORD", fictional],
  ["SMOKE_SIGNUP_INVITE_CODE", invite],
  ["SETUP_TOKEN", setup],
  ["READINESS_TOKEN", readiness],
  ["BANK_DATA_ENCRYPTION_KEY", bank],
  ["PII_ENCRYPTION_KEY", pii],
  ["TOTP_ENCRYPTION_KEY", totp],
  ["PRIVATE_PILOT_INVITE_EMAIL_SHA256", createHash("sha256").update("postcutover-b@example.invalid").digest("hex")],
  ["PRIVATE_PILOT_INVITE_CODE_SHA256", createHash("sha256").update(invite).digest("hex")],
  ["PRIVATE_PILOT_INVITE_EXPIRES_AT", new Date(Date.now() + 2 * 3600_000).toISOString()],
];
for (const [, value] of entries) console.log("::add-mask::" + value);
appendFileSync(process.env.GITHUB_ENV, entries.map(([key, value]) => key + "=" + value).join("\n") + "\n");
process.stdout.write("Isolated fictional fixture inputs prepared in GitHub runner memory; no values reported.\n");
