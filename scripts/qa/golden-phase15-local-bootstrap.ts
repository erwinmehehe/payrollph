/** Applies only the reviewed source baseline to a fresh local PG16 app_db. No reset/drop/remote mode. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {requirePhase15Environment, requirePhase15Database} from "./golden-phase15-safety";

const sources = [
  ["drizzle/0109_tamper_evident_audit_chain.sql", "3a1f1c58d04adbc9431922d4c0a64a4788c444b9caaf25884ed025a87687ef2a"],
  ["docs/sql/source-baseline-supplement.sql", "faa1dd6a184b57612bc2f8655ddd11855e771ad90d34ffea3fa4264a2be9df04"],
];
async function main() {
  const mode=requirePhase15Environment(process.env);
  assert.equal(mode,"local-disposable-pg16-only","PHASE15_REFUSED: this bootstrap is local only");
  const sql=sources.map(([file,pin])=>{
    const raw=readFileSync(file,"utf8").replaceAll("\r\n","\n");
    assert.equal(createHash("sha256").update(raw).digest("hex"),pin,"PHASE15_REFUSED: unreviewed baseline "+file);
    return raw;
  });
  const {Client}=await import("pg");
  const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
  await client.connect();
  try {
    const {rows:[identity]}=await client.query(`SELECT current_setting('server_version_num')::int AS version,
      current_database() AS database, host(inet_server_addr()) AS "serverAddress", host(inet_client_addr()) AS "clientAddress"`);
    const exists=(await client.query("SELECT to_regclass('public.organizations') AS name")).rows[0].name;
    const employers=exists?Number((await client.query("SELECT count(*)::int AS n FROM organizations")).rows[0].n):0;
    requirePhase15Database({...identity,employers},mode);
    // Zero employers alone is not permission to overwrite unrelated local data.
    const tables=await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
    for(const {table_name:name}of tables.rows){
      const identifier='"'+String(name).replaceAll('"','""')+'"';
      const existing=await client.query("SELECT 1 FROM public."+identifier+" LIMIT 1");
      assert.equal(existing.rowCount,0,"PHASE15_REFUSED: local database already contains rows; use a fresh disposable directory");
    }
    const push=spawnSync(process.execPath,["node_modules/drizzle-kit/bin.cjs","push","--force"],{
      env:process.env,encoding:"utf8",
    });
    // Do not print generated connection configuration or an environment dump.
    assert.equal(push.status,0,"PHASE15_REFUSED: local schema push failed; inspect its output privately");
    assert.match(push.stdout+push.stderr,/Changes applied|No changes detected/i,"PHASE15_REFUSED: schema push did not confirm success");
    assert.equal(Number((await client.query("SELECT count(*)::int AS n FROM organizations")).rows[0].n),0);
    await client.query("BEGIN");
    try { for(const statement of sql)await client.query(statement); await client.query("COMMIT"); }
    catch(error){await client.query("ROLLBACK");throw error;}
    console.log("PASS: reviewed baseline prepared on this computer's empty disposable PG16; no CI impersonation, database reset or provider calls.");
  } finally {await client.end();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:"PHASE15_REFUSED");process.exitCode=1;});
