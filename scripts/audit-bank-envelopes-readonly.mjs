#!/usr/bin/env node
/**
 * P0-2 protected operational proof; never makes database changes.
 * Intended solely for the manually dispatched production bank-encryption
 * workflow and its separately approved, SELECT-only audit credentials.
 */
import "dotenv/config";
import pg from "pg";
import { bankEncryptionKeySource } from "../src/lib/bank-account-crypto.ts";
import {
  classifyStoredBankEnvelope, currentBankKeyOnly,
} from "./lib/bank-envelope-inspection.ts";
import {
  auditBankEnvelopesReadOnly, requireProtectedBankAudit,
} from "./lib/bank-envelope-audit.mjs";

const mode = process.argv.length === 3 && process.argv[2] === "--inventory"
  ? "inventory"
  : process.argv.length === 3 && process.argv[2] === "--require-zero"
    ? "require-zero"
    : null;

async function main() {
  if (!mode) throw new Error("BANK_AUDIT_INVALID_ARGUMENTS");
  requireProtectedBankAudit(process.env);
  if (!process.env.DATABASE_URL) throw new Error("BANK_AUDIT_DATABASE_MISSING");
  const currentKey = currentBankKeyOnly(process.env);
  if (bankEncryptionKeySource(currentKey) !== "dedicated") {
    throw new Error("BANK_AUDIT_DEDICATED_KEY_REQUIRED");
  }

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 8000,
    query_timeout: 20000,
  });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const result = await auditBankEnvelopesReadOnly({
      client, env: process.env, mode,
      classify(value) {
        return classifyStoredBankEnvelope(value, currentKey);
      },
    });
    // Counts and integrity status only: never serialize bank values, full
    // payroll traces, database URL, encryption keys or employee identifiers.
    console.log(JSON.stringify({
      ...result,
      reviewedCommitSha: process.env.GITHUB_SHA,
      checkedAt: new Date().toISOString(),
    }, null, 2));
    if (!result.verificationSucceeded) {
      process.exitCode = 1;
      console.error("BANK_AUDIT_BLOCKED: Resolve unverified encryption before payroll release.");
    }
  } finally {
    if (connected) {
      try { await client.end(); } catch { /* connection not reusable */ }
    }
  }
}

main().catch(error => {
  // Do not disclose raw SQL failures (often contain SQL text or DB metadata).
  const message = error instanceof Error &&
    /^BANK_AUDIT_[A-Z_]+$/.test(error.message)
    ? error.message
    : "BANK_AUDIT_EXECUTION_FAILED";
  console.error(message + ": production bank encryption remains unverified.");
  process.exitCode = 1;
});
