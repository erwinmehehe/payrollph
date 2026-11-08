import assert from 'node:assert/strict';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

export const RECOVERY_MODE = 'fictional-local-pg16-only';
export const OFF = ['FINAL_PAY_SIGNED_REVIEW_ENABLED','EXACT_THIRTEENTH_CENTAVOS_ENABLED',
  'PAYROLL_CALCULATION_HISTORY_ENABLED','NEXT_CSP_ENABLED','PAYMONGO_DISBURSEMENTS_ENABLED',
  'XENDIT_PAYOUTS_ENABLED','XENDIT_BILLING_ENABLED','WORKER_ENABLED','CENTRAL_SCHEDULER_ENABLED'];
export const ABSENT = ['DATABASE_URL_UNPOOLED','NEON_DATABASE_URL','NEON_API_KEY','RESEND_API_KEY',
  'POSTMARK_SERVER_TOKEN','SMTP_URL','SMTP_PASSWORD','PAYMONGO_SECRET_KEY','XENDIT_SECRET_KEY',
  'XENDIT_PAYOUT_SECRET_KEY','STRIPE_SECRET_KEY','OPENAI_API_KEY','PII_ENCRYPTION_KEY_PREVIOUS'];
export function requireLocalRecovery(env=process.env) {
  const fail='RECOVERY_REFUSED: ';
  assert.equal(env.TENANT_RECOVERY_MODE, RECOVERY_MODE, fail+'explicit local opt-in');
  assert.ok(!env.GITHUB_ACTIONS, fail+'local execution must not impersonate GitHub');
  assert.equal(env.DATABASE_URL,'postgresql://postgres:postgres@127.0.0.1:5432/app_db',fail+'disposable loopback DB only');
  assert.equal(env.SECURITY_SMOKE_URL,'http://127.0.0.1:3000',fail+'loopback HTTP only');
  assert.equal(env.APP_BASE_URL,'https://payroll.example.test',fail+'reserved canonical origin');
  assert.equal(env.NODE_ENV,'production',fail+'production-mode server required');
  assert.equal(env.DEMO_MODE,'false'); assert.equal(env.REQUIRE_PRIVILEGED_MFA,'true');
  for(const flag of OFF) assert.equal(env[flag],'false',fail+flag);
  for(const name of ABSENT) assert.ok(!env[name],fail+name);
  for(const name of ['PII_ENCRYPTION_KEY','BANK_DATA_ENCRYPTION_KEY','TOTP_ENCRYPTION_KEY'])
    assert.match(env[name]??'',/^[a-f0-9]{64}$/,fail+'ephemeral '+name);
  for(const name of ['.env','.env.local','.env.production','.env.production.local'])
    assert.ok(!existsSync(name),fail+'clean worktree without dotenv');
  const cluster=resolve('outputs/recovery-pg16');
  assert.equal(resolve(env.TENANT_RECOVERY_PGDATA??''),cluster,fail+'worktree-owned cluster required');
  assert.ok(cluster.startsWith(resolve('.')+sep));
  return cluster;
}
export async function assertLocalRecoveryDatabase(pool) {
  const cluster=requireLocalRecovery();
  const {rows:[row]}=await pool.query("SELECT current_setting('server_version_num') AS version, current_setting('data_directory') AS dir, current_database() AS name");
  assert.equal(Math.floor(Number(row.version)/10000),16,'RECOVERY_REFUSED: actual PG16 required');
  assert.equal(row.name,'app_db');
  assert.equal(realpathSync(row.dir),realpathSync(cluster),'RECOVERY_REFUSED: unrelated local DB');
}
export function recoveryReceipt(family,result) {
  if(process.env.TENANT_RECOVERY_MODE!==RECOVERY_MODE)return;
  requireLocalRecovery();
  const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
  // Refuse to label modified source as an executed committed proof.
  assert.equal(git('diff','--name-only','HEAD','--','src','scripts/qa','.github/workflows','drizzle','docs/sql'),'',
    'RECOVERY_REFUSED: commit runtime/proof inputs before execution');
  const receipt={label:'SOLO_VERIFIED_DEV_RECOVERY',sourceHead:git('rev-parse','HEAD'),
    execution:'local-production-http-pg16',family,result,coverageCredits:0,productionCertified:false,
    independentlyAccepted:false,flags:Object.fromEntries(OFF.map(k=>[k,process.env[k]]))};
  writeFileSync('outputs/recovery-'+family+'.json',JSON.stringify(receipt,null,2)+'\n');
  return receipt;
}
