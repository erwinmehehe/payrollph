import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";

const digest = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const validSha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);

export function verifyStagingConfiguration(env) {
  if (env.HCM_STAGING_GATE !== "true") throw Error("HCM staging gate must be explicitly enabled");
  if (env.VERCEL_ENV === "production") throw Error("Production environment is forbidden");
  if (env.HCM_STAGING_PROJECT_ID !== env.EXPECTED_HCM_STAGING_PROJECT_ID ||
      !env.HCM_STAGING_PROJECT_ID?.startsWith("prj_")) {
    throw Error("Dedicated staging project identity is missing or mismatched");
  }
  const address = new URL(env.DATABASE_URL ?? "");
  if (!["postgresql:", "postgres:"].includes(address.protocol) ||
      !address.hostname || !address.pathname || address.pathname === "/") {
    throw Error("Valid dedicated staging PostgreSQL URL required");
  }
  if (!validSha(env.PRODUCTION_DATABASE_URL_SHA256)) {
    throw Error("Out-of-band production DB fingerprint attestation missing");
  }
  if (digest(env.DATABASE_URL) === env.PRODUCTION_DATABASE_URL_SHA256.toLowerCase()) {
    throw Error("Staging and production database URLs match");
  }
  if (!/^[a-z][a-z0-9_-]{5,63}$/.test(env.HCM_STAGING_EXPECTED_DB_MARKER ?? "")) {
    throw Error("Explicit staging database marker required");
  }
  if (env.HCM_PEOPLE_HOME_ENABLED === "true" ||
      env.NEXT_PUBLIC_HCM_PEOPLE_HOME_ENABLED === "true") {
    throw Error("Staging People Home must remain OFF until human approval");
  }
  return {
    project: env.HCM_STAGING_PROJECT_ID,
    expectedMarker: env.HCM_STAGING_EXPECTED_DB_MARKER,
    dbHostDigest: digest(address.hostname).slice(0, 12),
  };
}

export async function verifyStagingDatabase(env, connect = (config) => new pg.Client(config)) {
  const config = verifyStagingConfiguration(env);
  const client = connect({
    connectionString: env.DATABASE_URL,
    ssl: env.HCM_STAGING_DB_SSL === "true" ? { rejectUnauthorized: true } : undefined,
    connectionTimeoutMillis: 7000,
    query_timeout: 7000,
  });
  try {
    await client.connect();
    const result = await client.query(
      "SELECT current_setting('payrollph.environment', true) AS marker, " +
      "current_database() AS database_name, " +
      "current_setting('transaction_read_only') AS read_only"
    );
    if (result.rows.length !== 1 ||
        result.rows[0].marker !== config.expectedMarker) {
      throw Error("Database-side environment marker missing or incorrect");
    }
    if (result.rows[0].read_only !== "on") {
      throw Error("Staging attestation requires a read-only database login");
    }
    return {
      gate: "PASS",
      projectMatched: true,
      productionUrlDifferent: true,
      databaseMarkerMatched: true,
      dbReadOnly: true,
      dbHostDigest: config.dbHostDigest,
      dbNameDigest: digest(String(result.rows[0].database_name)).slice(0, 12),
      realEmployerAccepted: false,
      releaseApproved: false,
    };
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  verifyStagingDatabase(process.env)
    .then((result) => { process.stdout.write(JSON.stringify(result) + "\n"); })
    .catch((error) => {
      process.stderr.write("HCM_STAGING_ISOLATION_NO_GO: " +
        (error instanceof Error ? error.message : "verification failed") + "\n");
      process.exitCode = 1;
    });
}
