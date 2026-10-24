/** Operator-run catalog checkpoint only. Never imports the app DB or schema setup. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { STRICT_AUDIT_ROLE_PROOF_SQL, STRICT_AUDIT_CHAIN_PROOF_KEYS,
  auditChainProtectionProven } from "../../src/lib/audit-role-proof";

type Env = Record<string, string | undefined>;
type Client = { connect(): Promise<unknown>; query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<unknown> };
const blocked = () => new Error("AUDIT_LIVE_PROOF_BLOCKED");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

export function proofConfig(env: Env) {
  try {
    if (env.ISSUE908_PROOF_MODE !== "operator-approved-metadata-only"
      || !["app", "worker", "scheduler"].includes(env.ISSUE908_ROLE_LABEL ?? "")
      || !/^[a-f0-9]{40}$/.test(env.ISSUE908_SOURCE_SHA ?? "")
      || !/^[a-f0-9]{40}$/.test(env.ISSUE908_DEPLOY_SHA ?? "")
      || env.ISSUE908_SOURCE_SHA !== env.ISSUE908_DEPLOY_SHA
      || !env.ISSUE908_APPROVAL_REFERENCE?.trim()) throw blocked();
    // Dedicated input, no DATABASE_URL/.env fallback. Pins come from independent review.
    const url = new URL(env.ISSUE908_PROOF_DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.password || url.hash
      || !env.ISSUE908_EXPECTED_HOST || !env.ISSUE908_EXPECTED_DATABASE || !env.ISSUE908_EXPECTED_USER
      || url.hostname !== env.ISSUE908_EXPECTED_HOST
      || (url.port || "5432") !== (env.ISSUE908_EXPECTED_PORT || "5432")
      || decodeURIComponent(url.pathname.slice(1)) !== env.ISSUE908_EXPECTED_DATABASE
      || decodeURIComponent(url.username) !== env.ISSUE908_EXPECTED_USER
      || [...url.searchParams.keys()].some(key => key !== "sslmode")
      || url.searchParams.getAll("sslmode").length !== 1
      || url.searchParams.get("sslmode") !== "verify-full") throw blocked();
    return { connectionString: url.href, application_name: "issue908-readonly-proof",
      connectionTimeoutMillis: 5000, statement_timeout: 15000, query_timeout: 20000,
      // Enforced before the first query, then reinforced by explicit transaction.
      options: "-c default_transaction_read_only=on -c lock_timeout=3000" };
  } catch { throw blocked(); }
}

export async function runMetadataProof(client: Client, env: Env) {
  proofConfig(env);
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const identity = await client.query(`SELECT current_database() AS database,
      current_user AS login, session_user AS session,
      current_setting('transaction_read_only') AS readonly,
      current_setting('server_version_num') AS version`);
    const row = identity.rows[0];
    if (identity.rows.length !== 1 || row?.database !== env.ISSUE908_EXPECTED_DATABASE
      || row?.login !== env.ISSUE908_EXPECTED_USER || row?.session !== row?.login
      || row?.readonly !== "on" || !/^(16|17|18)\d{4}$/.test(String(row?.version))) throw blocked();
    const result = await client.query(STRICT_AUDIT_ROLE_PROOF_SQL);
    const proven = result.rows.length === 1 && auditChainProtectionProven(result.rows[0], true);
    const predicates = Object.fromEntries(STRICT_AUDIT_CHAIN_PROOF_KEYS.map(key =>
      [key, result.rows.length === 1 && result.rows[0]?.[key] === true]));
    return { kind: "AUDIT_LIVE_METADATA_CHECKPOINT", status: proven ? "METADATA_PASS" : "BLOCKED",
      role: env.ISSUE908_ROLE_LABEL, sourceSha: env.ISSUE908_SOURCE_SHA,
      deployedSha: env.ISSUE908_DEPLOY_SHA, strictSqlSha256: sha(STRICT_AUDIT_ROLE_PROOF_SQL),
      observedAt: new Date().toISOString(), predicates,
      productionIsolationAccepted: false, releaseAuthorized: false };
  } finally {
    // ROLLBACK, never COMMIT, including errors and false predicates. No raw error output.
    try { await client.query("ROLLBACK"); } finally { await client.end(); }
  }
}

async function main() {
  if (process.argv.length === 3 && process.argv[2] === "--describe") {
    console.log("#908 metadata-only operator checkpoint; no connection made. See docs/security/issue908-live-proof-runbook.md.");
    return;
  }
  try {
    if (process.argv.length !== 3 || process.argv[2] !== "--execute") throw blocked();
    const config = proofConfig(process.env);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (head !== process.env.ISSUE908_SOURCE_SHA) throw blocked();
    execFileSync("git", ["diff", "--quiet", "HEAD", "--"], { stdio: "ignore" });
    const { Client } = await import("pg");
    const receipt = await runMetadataProof(new Client(config), process.env);
    console.log(JSON.stringify(receipt));
    if (receipt.status !== "METADATA_PASS") process.exitCode = 1;
  } catch {
    console.log(JSON.stringify({ kind: "AUDIT_LIVE_METADATA_CHECKPOINT", status: "BLOCKED",
      reason: "Configuration, identity, catalog or connection check failed; inspect privately with DBA.",
      productionIsolationAccepted: false, releaseAuthorized: false }));
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
