import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";

// DBA SOURCE-PROPOSAL rehearsal on disposable PostgreSQL only.
// Never run on Neon production, or with actual employment records.
assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
const url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "5432");
assert.equal(url.pathname, "/app_db");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const ddl = readFileSync(
  new URL("../docs/engineering/migration-proposals/offboarding-clearance-a6.sql", import.meta.url),
  "utf8",
);
const marker = "a6-synthetic-scope-20261012";
try {
  await client.query("BEGIN");
  await client.query(ddl);
  await client.query(ddl);
  const guards = await client.query(
    "SELECT tgname FROM pg_trigger WHERE tgrelid='public.separation_clearance_waivers'::regclass AND tgname='a6_clearance_waiver_scope_guard' AND NOT tgisinternal",
  );
  assert.equal(guards.rowCount, 1);

  const orgA = (await client.query(
    "INSERT INTO organizations(name,legal_name,plan) VALUES($1,$2,'Core') RETURNING id",
    [marker + "-A", marker + "-A"],
  )).rows[0].id;
  const orgB = (await client.query(
    "INSERT INTO organizations(name,legal_name,plan) VALUES($1,$2,'Core') RETURNING id",
    [marker + "-B", marker + "-B"],
  )).rows[0].id;
  const maker = (await client.query(
    "INSERT INTO users(name,email,password_hash) VALUES('Synthetic A6 Maker',$1,'qa') RETURNING id",
    [marker + "-maker@example.test"],
  )).rows[0].id;
  const reviewer = (await client.query(
    "INSERT INTO users(name,email,password_hash) VALUES('Synthetic A6 Reviewer',$1,'qa') RETURNING id",
    [marker + "-checker@example.test"],
  )).rows[0].id;
  async function worker(organizationId, suffix) {
    return (await client.query(
      "INSERT INTO employees(organization_id,employee_no,first_name,last_name,title,avatar_initials,basic_rate,start_date) VALUES($1,$2,'Synthetic','Worker','QA','SW','30000.00','2026-01-01') RETURNING id",
      [organizationId, marker + "-" + suffix],
    )).rows[0].id;
  }
  const workerA = await worker(orgA, "A");
  const workerB = await worker(orgB, "B");
  const sepA = (await client.query(
    "INSERT INTO separation_records(organization_id,employee_id,separation_type,notice_date,last_day,prepared_by_user_id) VALUES($1,$2,'resignation','2026-10-01','2026-10-31',$3) RETURNING id",
    [orgA, workerA, maker],
  )).rows[0].id;
  async function waiver(org, employee) {
    return client.query(
      "INSERT INTO separation_clearance_waivers (organization_id,separation_id,employee_id,department,reason,evidence_reference,authorized_by_user_id) VALUES($1,$2,$3,'finance','Synthetic independent finance review and approval','SYNTHETIC-A6-EVIDENCE-2026',$4) RETURNING id",
      [org, sepA, employee, reviewer],
    );
  }
  for (const args of [[orgB,workerA],[orgA,workerB]]) {
    await client.query("SAVEPOINT mismatch");
    await assert.rejects(() => waiver(...args), err =>
      err?.code === "23514" && String(err.message).includes("A6_WAIVER_TENANT_OR_EMPLOYEE_MISMATCH"));
    await client.query("ROLLBACK TO SAVEPOINT mismatch");
  }
  const inserted = await waiver(orgA, workerA);
  assert.equal(inserted.rowCount, 1);
  const waiverId = inserted.rows[0].id;
  for (const statement of [
    "UPDATE separation_clearance_waivers SET reason='Altered historical clearance rationale' WHERE id=$1",
    "UPDATE separation_clearance_waivers SET organization_id=$2 WHERE id=$1",
  ]) {
    await client.query("SAVEPOINT rewrite");
    await assert.rejects(() => client.query(statement, [waiverId,orgB]), err =>
      err?.code === "23514" && String(err.message).includes("A6_WAIVER_HISTORY_IMMUTABLE"));
    await client.query("ROLLBACK TO SAVEPOINT rewrite");
  }
  const revoked = await client.query(
    "UPDATE separation_clearance_waivers SET revoked_at=now(), revoked_by_user_id=$2 WHERE id=$1",
    [waiverId,reviewer],
  );
  assert.equal(revoked.rowCount, 1);
  await client.query("SAVEPOINT undo_revocation");
  await assert.rejects(() => client.query(
    "UPDATE separation_clearance_waivers SET revoked_at=NULL, revoked_by_user_id=NULL WHERE id=$1",
    [waiverId],
  ), err => err?.code === "23514" && String(err.message).includes("A6_WAIVER_REVOCATION_IMMUTABLE"));
  await client.query("ROLLBACK TO SAVEPOINT undo_revocation");
  console.log("PASS A-6 rollback-only proposal: cross-tenant denial, immutable evidence, one-way revocation");
} finally {
  await client.query("ROLLBACK").catch(() => {});
  const result = await client.query("SELECT count(*)::int AS count FROM organizations WHERE name LIKE $1", [marker + "%"]);
  assert.equal(result.rows[0].count, 0, "rollback must remove all synthetic employers");
  await client.end();
}
