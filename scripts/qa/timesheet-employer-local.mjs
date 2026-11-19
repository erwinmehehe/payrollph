/** Build, start or verify the #2028 regression on an isolated local machine. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { ABSENT, OFF } from "./tenant-recovery-local-contract.mjs";
import { TENANT_TABLE_BASE_ENV, TENANT_TABLE_PROFILES } from "./tenant-table-env.mjs";
const command = process.argv[2];
assert.ok(["build", "start", "verify"].includes(command), "Use build, start or verify");
for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) assert.ok(!existsSync(file), "Local proof requires a dotenv-free checkout");
for (const name of [...ABSENT, "VERCEL", "GITHUB_ACTIONS", "SMTP_HOST", "CRON_SECRET", "WORKER_TOKEN"])
  assert.ok(!process.env[name], "External credential or hosted environment configured: " + name);
const keyPath = "outputs/timesheet-local-keys.json";
if (command === "build" && !existsSync(keyPath))
  writeFileSync(keyPath, JSON.stringify(Object.fromEntries(["PII_ENCRYPTION_KEY", "BANK_DATA_ENCRYPTION_KEY", "TOTP_ENCRYPTION_KEY"].map(name => [name, randomBytes(32).toString("hex")]))), {flag:"wx",mode:0o600});
const env = { ...process.env, ...TENANT_TABLE_BASE_ENV, ...TENANT_TABLE_PROFILES["compliance-posts"],
  ...JSON.parse(readFileSync(keyPath)), ...Object.fromEntries(OFF.map(name => [name, "false"])),
  GOLDEN_PHASE15_DISPOSABLE: "local-disposable-pg16-only", GOLDEN_PHASE15_LOCAL_CONFIRM: "fresh-empty-fictional-database",
  MULTI_ENTITY_ENABLED: "true", MULTI_ENTITY_TRANSFERS_ENABLED: "false", TRUSTED_APP_ORIGINS: "http://127.0.0.1:3000",
  MALWARE_SCAN_URL: "", MALWARE_SCAN_TOKEN: "", WORKER_TOKEN: "", CI: "false",
};
const args = command === "verify" ? ["--import", "tsx", "scripts/qa/timesheet-employer-pg16.mjs"]
  : ["node_modules/next/dist/bin/next", ...(command === "build" ? ["build"] : ["start", "-H", "127.0.0.1", "-p", "3000"])];
const child = spawnSync(process.execPath, args, { env, stdio: "inherit" });
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
