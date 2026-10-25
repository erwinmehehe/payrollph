#!/usr/bin/env node
/**
 * Local-only: build and/or start the production-mode server for tenant-table proofs with the same
 * profile flags the shared workflow uses.
 *   node scripts/qa/local-tenant-proof-server.mjs build
 *   node scripts/qa/local-tenant-proof-server.mjs start [profile]
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { TENANT_TABLE_BASE_ENV, TENANT_TABLE_PROFILES } from "./tenant-table-env.mjs";

const [command, profile = "default"] = process.argv.slice(2);
if (!["build", "start"].includes(command) || !TENANT_TABLE_PROFILES[profile]) {
  console.error("usage: build | start [" + Object.keys(TENANT_TABLE_PROFILES).join("|") + "]");
  process.exit(2);
}
const env = {
  ...process.env, ...TENANT_TABLE_BASE_ENV, ...TENANT_TABLE_PROFILES[profile],
  PII_ENCRYPTION_KEY: process.env.PII_ENCRYPTION_KEY ?? randomBytes(32).toString("hex"),
  BANK_DATA_ENCRYPTION_KEY: process.env.BANK_DATA_ENCRYPTION_KEY ?? randomBytes(32).toString("hex"),
  RESEND_WEBHOOK_SECRET: "whsec_" + randomBytes(32).toString("base64"),
};
const args = command === "build" ? ["build"] : ["start", "-H", "127.0.0.1", "-p", "3000"];
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", ...args], { env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
