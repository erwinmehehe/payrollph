import assert from "node:assert/strict";
import test from "node:test";
import { proofConfig, runMetadataProof } from "../scripts/qa/audit-live-metadata-proof";
import { STRICT_AUDIT_CHAIN_PROOF_KEYS, STRICT_AUDIT_ROLE_PROOF_SQL } from "../src/lib/audit-role-proof";

const env = { ISSUE908_PROOF_MODE: "operator-approved-metadata-only", ISSUE908_ROLE_LABEL: "worker",
  ISSUE908_SOURCE_SHA: "a".repeat(40), ISSUE908_DEPLOY_SHA: "a".repeat(40),
  ISSUE908_APPROVAL_REFERENCE: "fictional-review", ISSUE908_EXPECTED_HOST: "fictional.example.invalid",
  ISSUE908_EXPECTED_DATABASE: "fictional", ISSUE908_EXPECTED_USER: "fictional_worker",
  ISSUE908_PROOF_DATABASE_URL: "postgresql://fictional_worker:fake@fictional.example.invalid/fictional?sslmode=verify-full" };
const good = Object.fromEntries(STRICT_AUDIT_CHAIN_PROOF_KEYS.map(key => [key, true]));
const identity = { database: "fictional", login: "fictional_worker", session: "fictional_worker", readonly: "on", version: "160011" };
function fake(rows: Record<string, unknown>[] = [good], id = identity, fail = false) {
  const calls: string[] = [];
  return { calls, connect: async () => { calls.push("connect"); }, end: async () => { calls.push("end"); },
    query: async (sql: string) => {
      calls.push(sql);
      if (sql === STRICT_AUDIT_ROLE_PROOF_SQL) { if (fail) throw Error("secret fake URL"); return { rows }; }
      if (sql.startsWith("SELECT current_database")) return { rows: [id] };
      return { rows: [] };
    } };
}
test("operator configuration refuses ambient credentials, wrong pins, startup overrides and insecure TLS", () => {
  assert.equal(proofConfig(env).options.includes("default_transaction_read_only=on"), true);
  for (const key of Object.keys(env)) assert.throws(() => proofConfig({ ...env, [key]: undefined }), /BLOCKED/);
  for (const patch of [
    { ISSUE908_DEPLOY_SHA: "b".repeat(40) }, { ISSUE908_EXPECTED_HOST: "other.invalid" },
    { ISSUE908_EXPECTED_DATABASE: "other" }, { ISSUE908_EXPECTED_USER: "owner" },
    { ISSUE908_EXPECTED_PORT: "9999" }, { ISSUE908_ROLE_LABEL: "sealer" },
  ]) assert.throws(() => proofConfig({ ...env, ...patch }), /BLOCKED/);
  for (const suffix of ["&options=-c%20role=owner", "&sslmode=disable", "&ssl=false", "#fragment"]) {
    assert.throws(() => proofConfig({ ...env, ISSUE908_PROOF_DATABASE_URL: env.ISSUE908_PROOF_DATABASE_URL + suffix }), /BLOCKED/);
  }
  assert.throws(() => proofConfig({ ...env, ISSUE908_PROOF_DATABASE_URL: env.ISSUE908_PROOF_DATABASE_URL.replace("verify-full", "require") }), /BLOCKED/);
});
test("all seventeen strict booleans are required and every transaction rolls back", async () => {
  const client = fake();
  const result = await runMetadataProof(client, env);
  assert.equal(result.status, "METADATA_PASS");
  assert.equal(result.productionIsolationAccepted, false);
  assert.deepEqual(client.calls.slice(0, 2), ["connect", "BEGIN READ ONLY"]);
  assert.deepEqual(client.calls.slice(-2), ["ROLLBACK", "end"]);
  assert.equal(JSON.stringify(result).includes("fictional_worker"), false);
  assert.equal(JSON.stringify(result).includes("fake@"), false);
  for (const key of STRICT_AUDIT_CHAIN_PROOF_KEYS) {
    for (const value of [false, null, undefined, "true", 1]) {
      const c = fake([{ ...good, [key]: value }]);
      assert.equal((await runMetadataProof(c, env)).status, "BLOCKED", `${key}:${value}`);
      assert.deepEqual(c.calls.slice(-2), ["ROLLBACK", "end"]);
    }
  }
  for (const rows of [[], [good, good]]) assert.equal((await runMetadataProof(fake(rows), env)).status, "BLOCKED");
});
test("wrong runtime identity, non-readonly session and SQL failures cannot yield a receipt", async () => {
  for (const change of [{ login: "owner" }, { session: "owner" }, { database: "other" }, { readonly: "off" }, { version: "150001" }]) {
    const c = fake([good], { ...identity, ...change });
    await assert.rejects(runMetadataProof(c, env), /BLOCKED/);
    assert.equal(c.calls.includes(STRICT_AUDIT_ROLE_PROOF_SQL), false);
    assert.deepEqual(c.calls.slice(-2), ["ROLLBACK", "end"]);
  }
  const c = fake([good], identity, true);
  await assert.rejects(runMetadataProof(c, env));
  assert.deepEqual(c.calls.slice(-2), ["ROLLBACK", "end"]);
});
