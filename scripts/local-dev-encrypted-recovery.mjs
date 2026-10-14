#!/usr/bin/env node
/**
 * Zero-cloud-cost DEVELOPMENT recovery helper (Node 22+).
 * No AWS, GitHub Actions, migrations, writes to Neon, or plaintext dump files.
 * Only operate on fictional development data; verify its classification first.
 *
 * BACKUP: pg_dump --format=custom stdout -> age recipient -> ignored local file.
 * VERIFY: age private identity -> disconnected disposable Docker Postgres 18.
 */
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { finished } from "node:stream/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BACKUPS = join(ROOT, "qa-artifacts", "local-dev-backups");
const NEON_HOST = "ep-cool-hat-b7e7gpoo.c-13.us-east-1.aws.neon.tech";
const AGE_RECIPIENT = /^age1[023456789acdefghjklmnpqrstuvwxyz]{50,70}$/;

function reject(code) { throw new Error("LOCAL_DEV_RECOVERY_" + code); }
function within(base, child) {
  const diff = relative(base, child);
  return diff === "" || (!diff.startsWith(".." + sep) && diff !== ".." && !isAbsolute(diff));
}

export function validateBackupEnv(env) {
  if (env.GITHUB_ACTIONS || env.CI === "true") reject("NO_CI_EXPORT");
  if (env.DATABASE_URL || env.MIGRATION_TARGET_DATABASE_URL) reject("APP_CONNECTION_ENV_FORBIDDEN");
  if (env.DEV_BACKUP_CONFIRM !== "FICTIONAL_DATA_ONLY_NO_PRODUCTION") reject("DATA_CLASSIFICATION_NOT_ATTESTED");
  if (!AGE_RECIPIENT.test(env.BACKUP_AGE_RECIPIENT || "")) reject("AGE_PUBLIC_RECIPIENT_REQUIRED");
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(env.PGDATABASE || "") ||
      !/^[a-z_][a-z0-9_]{0,62}$/.test(env.PGUSER || "") ||
      !/^[0-9]{2,5}$/.test(env.PGPORT || "") ||
      Number(env.PGPORT) < 1 || Number(env.PGPORT) > 65535) reject("PG_TARGET_INCOMPLETE");
  const source = env.DEV_BACKUP_SOURCE;
  if (source === "local") {
    if (!["localhost","127.0.0.1","::1"].includes(env.PGHOST) ||
        env.PGSSLMODE !== "disable") reject("LOCALHOST_REQUIRED");
  } else if (source === "pinned-neon") {
    if (env.PGHOST !== NEON_HOST || env.PGDATABASE !== "neondb" ||
        env.PGSSLMODE !== "verify-full" || env.PGSSLROOTCERT !== "system" ||
        /owner|postgres|admin|root|superuser/i.test(env.PGUSER)) {
      reject("NEON_IDENTITY_OR_ROLE_UNSAFE");
    }
  } else reject("SOURCE_MUST_BE_LOCAL_OR_PINNED_NEON");
  return Object.freeze({ source, database:env.PGDATABASE, host:env.PGHOST });
}

export function validateRestoreEnv(env) {
  if (env.CI === "true" || env.GITHUB_ACTIONS) reject("NO_CI_RESTORE");
  if (env.DATABASE_URL || env.MIGRATION_TARGET_DATABASE_URL ||
      env.PGHOST || env.PGUSER || env.PGPASSWORD || env.PGDATABASE) {
    reject("EXTERNAL_DATABASE_ENV_FORBIDDEN");
  }
  if (env.DEV_RESTORE_CONFIRM !== "DISCONNECTED_DOCKER_ONLY") {
    reject("DISPOSABLE_TARGET_CONFIRMATION_REQUIRED");
  }
  if (!env.AGE_IDENTITY_FILE || typeof env.AGE_IDENTITY_FILE !== "string") {
    reject("PRIVATE_IDENTITY_FILE_REQUIRED");
  }
  return true;
}

function waitChild(child) {
  return new Promise((done) => {
    let errored = false;
    child.once("error", () => { errored = true; });
    child.once("close", (code) => done(!errored && code === 0));
  });
}

async function runQuiet(cmd, args, options={}) {
  const child = spawn(cmd, args, {shell:false, stdio:["ignore","pipe","pipe"], ...options});
  const maxOutput=2048;
  let output="";
  child.stdout.on("data", (data) => {
    if (output.length < maxOutput) output += data.toString("utf8").slice(0,maxOutput);
  });
  child.stderr.resume(); // Never print Postgres stderr/credentials or private data.
  const ok=await waitChild(child);
  if (!ok) reject("COMMAND_FAILED_" + cmd.toUpperCase().replace(/[^A-Z0-9]/g,""));
  return output.trim();
}

async function streamCommands(source, consumer, outfile) {
  const input=spawn(source.cmd, source.args, {shell:false, env:source.env, stdio:["ignore","pipe","pipe"]});
  const output=spawn(consumer.cmd, consumer.args, {shell:false, env:consumer.env, stdio:["pipe","pipe","pipe"]});
  const file=outfile ? createWriteStream(outfile,{flags:"wx",mode:0o600}) : null;
  input.stderr.resume(); output.stderr.resume(); // Fail without logging source data.
  input.stdout.pipe(output.stdin);
  output.stdin.on("error",()=>{ input.kill(); });
  if (file) output.stdout.pipe(file);
  else output.stdout.resume();
  const inputDone=waitChild(input);
  const outputDone=waitChild(output);
  output.on("close",(code)=>{if(code!==0)input.kill();});
  if (file) file.on("error",()=>{input.kill(); output.kill();});
  const interrupt=()=>{ input.kill(); output.kill(); };
  process.once("SIGINT",interrupt);
  process.once("SIGTERM",interrupt);
  try {
    const [first,second,sink]=await Promise.all([
      inputDone,outputDone,file ? finished(file).then(()=>true,()=>false) : Promise.resolve(true)
    ]);
    if (!first || !second || !sink) reject("ENCRYPT_OR_RESTORE_PIPE_FAILED");
  } finally {
    process.removeListener("SIGINT",interrupt);
    process.removeListener("SIGTERM",interrupt);
  }
}

async function sha256(file) {
  const hash=createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function backup() {
  const source=validateBackupEnv(process.env);
  const env={...process.env, PGOPTIONS:"-c default_transaction_read_only=on",
    PGCONNECT_TIMEOUT:"10", PGAPPNAME:"linaw-local-dev-backup"};
  if (source.source === "pinned-neon") {
    const guard=join(ROOT,"scripts","sql","protected-neon-backup-source.sql");
    const result=await runQuiet("psql",["-X","-A","-t","-q","-w",
      "-v","ON_ERROR_STOP=1","-f",guard],{env});
    if (result!=="PINNED_READ_ONLY_SOURCE") reject("NEON_PINNED_READER_GUARD_FAILED");
  }
  await mkdir(BACKUPS,{recursive:true,mode:0o700});
  const tag=new Date().toISOString().replace(/[-:.]/g,"") + "-" + randomBytes(4).toString("hex");
  const name="linaw-dev-" + tag + ".pgdump.age";
  const archive=join(BACKUPS,name);
  const temporary=archive + ".partial";
  const receiptPath=archive + ".json";
  try {
    await streamCommands(
      {cmd:"pg_dump",args:["--format=custom","--no-owner","--no-acl",
        "--no-password","--lock-wait-timeout=10s"],env},
      {cmd:"age",args:["-r",process.env.BACKUP_AGE_RECIPIENT],env:process.env},
      temporary);
    const bytes=(await stat(temporary)).size;
    if (bytes<128) reject("ENCRYPTED_ARCHIVE_TOO_SMALL");
    const digest=await sha256(temporary);
    await rename(temporary,archive);
    const receipt={
      format:"linaw-dev-age-pgdump-v1",status:"encrypted-locally-not-restored",
      archive:name,encryptedBytes:bytes,encryptedSha256:digest,
      createdUtc:new Date().toISOString(),sourceKind:source.source,
      database:source.database,restoreVerified:false,productionCertified:false
    };
    await writeFile(receiptPath,JSON.stringify(receipt,null,2)+"\n",{flag:"wx",mode:0o600});
    process.stdout.write("LOCAL_DEV_ENCRYPTED_BACKUP_CREATED\n"+
      "Archive: "+archive+"\nReceipt: "+receiptPath+"\n"+
      "Ciphertext SHA256: "+digest+"\n"+
      "No plaintext dump was saved. Copy ciphertext, receipt and separately protected private key appropriately.\n");
  } catch {
    await rm(temporary,{force:true}).catch(()=>{});
    await rm(archive,{force:true}).catch(()=>{});
    await rm(receiptPath,{force:true}).catch(()=>{});
    reject("BACKUP_FAILED_NO_VALID_ARCHIVE");
  }
}

async function verify(archiveArgument) {
  validateRestoreEnv(process.env);
  if (!archiveArgument) reject("ARCHIVE_ARGUMENT_REQUIRED");
  const archive=resolve(archiveArgument);
  const actual=await realpath(archive);
  if (!(await stat(actual)).isFile() || !actual.endsWith(".pgdump.age")) reject("INVALID_ENCRYPTED_ARCHIVE");
  const key=await realpath(resolve(process.env.AGE_IDENTITY_FILE));
  if (within(ROOT,key) || !(await stat(key)).isFile() || key===actual) {
    reject("PRIVATE_KEY_MUST_BE_OUTSIDE_REPOSITORY");
  }
  const receipt=JSON.parse(await readFile(actual+".json","utf8"));
  if (receipt.format!=="linaw-dev-age-pgdump-v1" ||
      receipt.archive!==actual.split(sep).at(-1) ||
      !/^[0-9a-f]{64}$/.test(receipt.encryptedSha256 || "") ||
      receipt.encryptedBytes!==(await stat(actual)).size ||
      receipt.encryptedSha256!==await sha256(actual)) reject("CIPHERTEXT_RECEIPT_MISMATCH");
  const tag="linaw-dev-restore-"+process.pid+"-"+randomBytes(4).toString("hex");
  let started=false;
  const start=Date.now();
  try {
    await runQuiet("docker",["run","-d","--rm","--network","none",
      "--name",tag,"--security-opt","no-new-privileges",
      "-e","POSTGRES_DB=linaw_restore_probe",
      "-e","POSTGRES_PASSWORD="+randomBytes(32).toString("hex"),
      "postgres:18"]);
    started=true;
    let ready=false;
    for (let i=0;i<60;i++) {
      try {
        await runQuiet("docker",["exec",tag,"pg_isready","-q","-U","postgres",
          "-d","linaw_restore_probe"]);
        ready=true;break;
      } catch {
        await new Promise(r=>setTimeout(r,1000));
      }
    }
    if (!ready) reject("DISPOSABLE_POSTGRES_NOT_READY");
    await streamCommands(
      {cmd:"age",args:["-d","-i",key,actual],env:process.env},
      {cmd:"docker",args:["exec","-i",tag,"pg_restore","-U","postgres",
        "-d","linaw_restore_probe","--no-owner","--no-acl",
        "--single-transaction","--exit-on-error"],env:process.env},
      null);
    const tables=await runQuiet("docker",["exec",tag,"psql","-XAtq",
      "-U","postgres","-d","linaw_restore_probe","-v","ON_ERROR_STOP=1",
      "-c","SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')"]);
    if (!/^[0-9]+$/.test(tables) || Number(tables)<1) reject("RESTORED_SCHEMA_EMPTY");
    const evidence={
      format:"linaw-dev-offline-verification-v1",status:"SOLO_DEV_RESTORE_SMOKE",
      archive:receipt.archive,encryptedSha256:receipt.encryptedSha256,
      restoredPublicTables:Number(tables),restoreSeconds:Math.ceil((Date.now()-start)/1000),
      disconnectedDocker:true,restoredToNeon:false,productionCertified:false,
      verifiedUtc:new Date().toISOString()
    };
    await writeFile(actual+".verify.json",JSON.stringify(evidence,null,2)+"\n",{flag:"wx",mode:0o600});
    process.stdout.write("LOCAL_DEV_OFFLINE_RESTORE_PASS\n"+
      "Restored public tables: "+tables+"\n"+
      "Evidence: "+actual+".verify.json\n"+
      "This does not certify full schema/data parity or production recovery.\n");
  } finally {
    if(started) await runQuiet("docker",["rm","-f",tag]).catch(()=>{});
  }
}

async function main() {
  const action=process.argv[2];
  if (action==="backup") await backup();
  else if (action==="verify") await verify(process.argv[3]);
  else if(action==="--help" || action==="help") {
    process.stdout.write("Node 22 local dev encrypted recovery: backup | verify <file.pgdump.age>\n"+
      "See docs/engineering/p0-4-zero-cost-local-dev-recovery.md\n");
  } else reject("ACTION_MUST_BE_BACKUP_OR_VERIFY");
}

if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  main().catch((err)=>{
    const code=typeof err?.message==="string" && err.message.startsWith("LOCAL_DEV_RECOVERY_") ?
      err.message : "LOCAL_DEV_RECOVERY_UNEXPECTED_FAILURE";
    process.stderr.write(code+"\n");
    process.exitCode=1;
  });
}
