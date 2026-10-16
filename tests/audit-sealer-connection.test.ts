import assert from "node:assert/strict";
import test from "node:test";
import { auditSealerConfig, dispatchAuditSealing } from "../src/lib/audit-sealer-connection";

const env = { NODE_ENV: "production", AUDIT_ROLE_ISOLATION_PROOF_ENABLED: "true",
  DATABASE_URL: "postgresql://app:private@db.example/neondb?sslmode=require",
  AUDIT_SEALER_DATABASE_URL: "postgresql://sealer:secret@db.example/neondb?sslmode=require" };

test("flag off preserves legacy sealing without requiring or opening another connection", async () => {
  for (const flag of [undefined, "false", "TRUE", "1"]) {
    let calls = 0;
    assert.equal(await dispatchAuditSealing(async () => { calls++; return 7; }, () => { throw Error("unexpected connection"); }, 500,
      { AUDIT_ROLE_ISOLATION_PROOF_ENABLED: flag }), 7);
    assert.equal(calls, 1);
  }
});

test("dedicated credential validation fails closed without leaking URL or using the app login", () => {
  assert.match(auditSealerConfig(env).connectionString!, /sslmode=verify-full/);
  for (const url of [undefined, env.DATABASE_URL, env.AUDIT_SEALER_DATABASE_URL.replace("db.example", "other.example"),
    env.AUDIT_SEALER_DATABASE_URL.replace("neondb", "otherdb"), env.AUDIT_SEALER_DATABASE_URL + "&options=-crole%3Dpostgres",
    env.AUDIT_SEALER_DATABASE_URL.replace("require", "disable")]) {
    assert.throws(() => auditSealerConfig({ ...env, AUDIT_SEALER_DATABASE_URL: url }),
      e => e instanceof Error && e.message === "AUDIT_SEALER_BOUNDARY_NOT_READY");
  }
});

test("strict dispatcher checks the login, scopes the sealer role and closes after commit", async () => {
  const calls: string[] = [];
  const result = await dispatchAuditSealing(async () => { throw Error("legacy"); }, () => ({
    async connect() { calls.push("connect"); }, async end() { calls.push("end"); },
    async query(text, values) {
      calls.push(text.startsWith("SELECT current_user") ? "proof" : text);
      if (text.startsWith("SELECT current_user")) return { rows: [{ ready: true }] };
      if (text.startsWith("SELECT public.seal")) { assert.deepEqual(values, [500]); return { rows: [{ sealed: 2 }] }; }
      return { rows: [] };
    },
  }), 500, env);
  assert.equal(result, 2);
  assert.deepEqual(calls, ["connect", "proof", "BEGIN", "SET LOCAL ROLE payrollph_audit_sealing", "proof", "SELECT public.seal_audit_events($1) AS sealed", "COMMIT", "end"]);
});

test("strict failures reject false proof, rollback query errors and redact pg errors", async () => {
  for (const fail of ["connect", "proof", "group", "seal"]) {
    const calls: string[] = [];
    await assert.rejects(() => dispatchAuditSealing(async () => 0, () => ({
      async connect() { if (fail === "connect") throw Error(env.AUDIT_SEALER_DATABASE_URL); },
      async end() { calls.push("end"); },
      async query(text) {
        calls.push(text);
        if (text.startsWith("SELECT current_user=session_user")) return { rows: [{ ready: fail !== "proof" }] };
        if (text.startsWith("SELECT current_user=")) return { rows: [{ ready: fail !== "group" }] };
        if (text.startsWith("SELECT public.seal")) throw Error(env.AUDIT_SEALER_DATABASE_URL);
        return { rows: [] };
      },
    }), 10, env), e => e instanceof Error && e.message === "AUDIT_SEALER_BOUNDARY_NOT_READY");
    assert.equal(calls.at(-1), "end");
    assert.equal(calls.includes("ROLLBACK"), fail === "seal" || fail === "group");
    assert.equal(calls.includes("COMMIT"), false);
  }
});
