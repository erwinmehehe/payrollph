/** Own disposable PG16 only. UTF8 matters for actual audit text on Windows. */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {requireSecurityWrite,assertSecurityDatabase} from './tenant-security-write-local-contract.mjs';
import {hcmWorkItemFixtureSql} from './prepare-hcm-work-item-fixture.mjs';
requireSecurityWrite();
const owned=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{await assertSecurityDatabase(owned,{empty:false});}finally{await owned.end();}
const admin=new pg.Client('postgresql://postgres:postgres@127.0.0.1:5432/postgres');await admin.connect();
try{
  const parked='app_db_security_'+Date.now()+'_'+randomBytes(3).toString('hex');
  assert.match(parked,/^app_db_security_[0-9]+_[a-f0-9]+$/);
  // Preserve prior fixture DBs; never drop an existing database.
  await admin.query('ALTER DATABASE app_db RENAME TO '+parked);
  await admin.query("CREATE DATABASE app_db WITH TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'");
}finally{await admin.end();}
const pushed=spawnSync(process.execPath,['scripts/strict-db-push.mjs'],{env:process.env,encoding:'utf8'});
assert.equal(pushed.status,0,'SECURITY_WRITE_REFUSED: strict schema initializer failed');
const db=new pg.Client(process.env.DATABASE_URL);await db.connect();
try{
  const {rows:[r]}=await db.query("SELECT current_setting('server_encoding') AS encoding,(SELECT count(*)::int FROM organizations) AS orgs,to_regclass('public.audit_chain_heads')::text AS heads");
  assert.deepEqual(r,{encoding:'UTF8',orgs:0,heads:null},'new schema must be empty UTF8');
  for(const file of ['drizzle/0109_tamper_evident_audit_chain.sql','docs/sql/source-baseline-supplement.sql']){
    await db.query('BEGIN');try{await db.query(readFileSync(file,'utf8'));await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}
  }
  await db.query('BEGIN');try{await db.query(hcmWorkItemFixtureSql());await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}
}finally{await db.end();}
console.log('Owned disposable PG16 UTF8 fixture ready; prior fixture database preserved');
