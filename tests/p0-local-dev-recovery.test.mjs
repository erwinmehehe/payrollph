import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateBackupEnv, validateRestoreEnv } from "../scripts/local-dev-encrypted-recovery.mjs";

const recipient = "age1" + "q".repeat(58);
const local = Object.freeze({
  DEV_BACKUP_SOURCE:"local",
  DEV_BACKUP_CONFIRM:"FICTIONAL_DATA_ONLY_NO_PRODUCTION",
  BACKUP_AGE_RECIPIENT:recipient,
  PGHOST:"127.0.0.1",PGPORT:"5432",PGDATABASE:"linaw_dev",
  PGUSER:"linaw_reader",PGSSLMODE:"disable"
});
const neon = Object.freeze({
  ...local,DEV_BACKUP_SOURCE:"pinned-neon",
  PGHOST:"ep-cool-hat-b7e7gpoo.c-13.us-east-1.aws.neon.tech",
  PGDATABASE:"neondb",PGSSLROOTCERT:"system",PGSSLMODE:"verify-full"
});
const refuse=(value,expected)=>assert.throws(value,new RegExp("LOCAL_DEV_RECOVERY_"+expected));

test("local development export requires explicit fictional-data confirmation and localhost",()=>{
  assert.equal(validateBackupEnv(local).source,"local");
  refuse(()=>validateBackupEnv({...local,DEV_BACKUP_CONFIRM:""}),"DATA_CLASSIFICATION_NOT_ATTESTED");
  refuse(()=>validateBackupEnv({...local,PGHOST:"remote.postgres.example"}),"LOCALHOST_REQUIRED");
  refuse(()=>validateBackupEnv({...local,PGSSLMODE:"require"}),"LOCALHOST_REQUIRED");
  refuse(()=>validateBackupEnv({...local,BACKUP_AGE_RECIPIENT:""}),"AGE_PUBLIC_RECIPIENT_REQUIRED");
});

test("app production URLs, cloud CI and incomplete DB settings are rejected before any DB contact",()=>{
  refuse(()=>validateBackupEnv({...local,DATABASE_URL:"postgres://secret:token@prod"}),"APP_CONNECTION_ENV_FORBIDDEN");
  refuse(()=>validateBackupEnv({...local,MIGRATION_TARGET_DATABASE_URL:"postgres://prod"}),"APP_CONNECTION_ENV_FORBIDDEN");
  refuse(()=>validateBackupEnv({...local,CI:"true"}),"NO_CI_EXPORT");
  refuse(()=>validateBackupEnv({...local,GITHUB_ACTIONS:"true"}),"NO_CI_EXPORT");
  refuse(()=>validateBackupEnv({...local,PGPORT:"65536"}),"PG_TARGET_INCOMPLETE");
  refuse(()=>validateBackupEnv({...local,PGUSER:""}),"PG_TARGET_INCOMPLETE");
});

test("remote Neon mode is pinned, read-only-role-gated and transport-verified",()=>{
  assert.equal(validateBackupEnv(neon).source,"pinned-neon");
  refuse(()=>validateBackupEnv({...neon,PGHOST:"some-other.neon.tech"}),"NEON_IDENTITY_OR_ROLE_UNSAFE");
  refuse(()=>validateBackupEnv({...neon,PGUSER:"neondb_owner"}),"NEON_IDENTITY_OR_ROLE_UNSAFE");
  refuse(()=>validateBackupEnv({...neon,PGUSER:"postgres"}),"NEON_IDENTITY_OR_ROLE_UNSAFE");
  refuse(()=>validateBackupEnv({...neon,PGSSLMODE:"require"}),"NEON_IDENTITY_OR_ROLE_UNSAFE");
  refuse(()=>validateBackupEnv({...neon,PGSSLROOTCERT:""}),"NEON_IDENTITY_OR_ROLE_UNSAFE");
});

test("verification never accepts any external PostgreSQL destination or missing confirmation",()=>{
  const safe={DEV_RESTORE_CONFIRM:"DISCONNECTED_DOCKER_ONLY",AGE_IDENTITY_FILE:"/outside/key.txt"};
  assert.equal(validateRestoreEnv(safe),true);
  refuse(()=>validateRestoreEnv({...safe,DATABASE_URL:"postgres://prod"}),"EXTERNAL_DATABASE_ENV_FORBIDDEN");
  refuse(()=>validateRestoreEnv({...safe,PGHOST:"127.0.0.1"}),"EXTERNAL_DATABASE_ENV_FORBIDDEN");
  refuse(()=>validateRestoreEnv({...safe,PGDATABASE:"neondb"}),"EXTERNAL_DATABASE_ENV_FORBIDDEN");
  refuse(()=>validateRestoreEnv({...safe,PGPASSWORD:"top-secret"}),"EXTERNAL_DATABASE_ENV_FORBIDDEN");
  refuse(()=>validateRestoreEnv({...safe,DEV_RESTORE_CONFIRM:""}),"DISPOSABLE_TARGET_CONFIRMATION_REQUIRED");
  refuse(()=>validateRestoreEnv({...safe,AGE_IDENTITY_FILE:""}),"PRIVATE_IDENTITY_FILE_REQUIRED");
});

test("recovery source streams ciphertext and restore to networkless Docker, with local-only artifacts",()=>{
  const code=readFileSync(new URL("../scripts/local-dev-encrypted-recovery.mjs",import.meta.url),"utf8");
  const ignore=readFileSync(new URL("../.gitignore",import.meta.url),"utf8");
  assert.match(code,/cmd:"pg_dump"/);
  assert.match(code,/cmd:"age",args:\["-r"/);
  assert.match(code,/cmd:"age",args:\["-d","-i"/);
  assert.match(code,/cmd:"docker",args:\["exec","-i",tag,"pg_restore"/);
  assert.match(code,/--network","none"/);
  assert.match(code,/"image","inspect","postgres:18","--format","{{.Id}}"/);
  assert.match(code,/restoreImageId\]/);
  assert.match(code,/disconnectedDocker:true,restoreImageId/);
  assert.match(code,/--single-transaction","--exit-on-error"/);
  assert.match(code,/qa-artifacts", "local-dev-backups"/);
  assert.doesNotMatch(code,/aws s3api|AWS_ACCESS_KEY_ID|s3:\/\/|cloudformation deploy/);
  assert.match(ignore,/\.backup-dev\.env/);
  assert.match(ignore,/\/qa-artifacts\//);
});

test("CLI without required env refuses to run and never attempts a dump",()=>{
  const script=new URL("../scripts/local-dev-encrypted-recovery.mjs",import.meta.url);
  const result=spawnSync(process.execPath,[fileURLToPath(script),"backup"],{
    encoding:"utf8",env:{PATH:process.env.PATH||"",SYSTEMROOT:process.env.SYSTEMROOT||""},timeout:10000
  });
  assert.equal(result.status,1);
  assert.match(result.stderr,/LOCAL_DEV_RECOVERY_DATA_CLASSIFICATION_NOT_ATTESTED/);
  assert.ok(!result.stdout.includes("CREATED"));
});

test("help mode has no external side effects",()=>{
  const script=new URL("../scripts/local-dev-encrypted-recovery.mjs",import.meta.url);
  const result=spawnSync(process.execPath,[fileURLToPath(script),"--help"],{
    encoding:"utf8",env:{PATH:process.env.PATH||"",SYSTEMROOT:process.env.SYSTEMROOT||""},timeout:10000
  });
  assert.equal(result.status,0);
  assert.match(result.stdout,/backup \| verify/);
});
