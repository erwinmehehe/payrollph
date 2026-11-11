/** Multi-entity HR-case HTTP proof contract. Disposable PG16 only. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
export const ORIGIN = "http://127.0.0.1:3000";
export const PINS = Object.freeze({
  "src/app/api/hr-cases/route.ts": "2cd3e59558d6a6ae6946b3a7f0f3685b5ddf7cd1",
  "src/lib/hr-case-tenant-scope.ts": "253666f693f7328a9cd99d1fea593f7d1a73962d",
  "src/lib/multi-entity-server.ts": "f38a8bb77a5026d581d4a92b22533fc879ea7e00",
  "src/lib/hr-case-activation.ts": "005c1edfada672f79deecb6f6d9370ea3ccbdee2",
  "src/lib/critical-release-flags.ts": "aa9867f795bbcbe9cfe42c6df7f64d0f0c4a9671",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
});
export function blob(source) {
  const b=Buffer.isBuffer(source)?source:Buffer.from(source);
  return createHash("sha1").update(Buffer.from("blob "+b.length+"\0")).update(b).digest("hex");
}
export function verifyPins() {
  for(const [path,sha] of Object.entries(PINS))
    assert.equal(blob(readFileSync(path)),sha,"HR_ENTITY_REFUSED: changed source "+path);
  return true;
}
export function requireDisposableMultiHr(env=process.env) {
  const required={
    CI:"true", GITHUB_ACTIONS:"true", NODE_ENV:"production",
    TENANT_HR_LEGAL_EMPLOYER_PROOF:"fictional-pg16-multi-entity-only",
    BUILD_BLOCK_ACCEPTANCE_MODE:"synthetic-postgres-only",
    DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL:ORIGIN, SECURITY_SMOKE_URL:ORIGIN,
    TRUSTED_APP_ORIGINS:ORIGIN, EMPLOYEE_HR_CASES_ENABLED:"true",
    MULTI_ENTITY_ENABLED:"true", EMPLOYEE_DOCUMENT_VAULT_ENABLED:"false",
    DEMO_MODE:"false", WORKER_ENABLED:"false",
    CENTRAL_SCHEDULER_ENABLED:"false",
    XENDIT_PAYOUTS_ENABLED:"false", XENDIT_BILLING_ENABLED:"false",
    PAYMONGO_DISBURSEMENTS_ENABLED:"false",
    FINAL_PAY_SIGNED_REVIEW_ENABLED:"false",
    PAYROLL_CALCULATION_HISTORY_ENABLED:"false",
  };
  for(const [key,val] of Object.entries(required))
    assert.equal(env[key],val,"HR_ENTITY_REFUSED: unsafe "+key);
  for(const key of ["NEON_DATABASE_URL","OPENAI_API_KEY","XENDIT_SECRET_KEY",
    "PAYMONGO_SECRET_KEY","SMTP_PASSWORD","RESEND_API_KEY","WORKER_TOKEN",
    "CRON_SECRET","S3_ACCESS_KEY_ID","S3_SECRET_ACCESS_KEY","R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY"])
    assert.ok(!env[key],"HR_ENTITY_REFUSED: provider secret "+key);
  return true;
}
export function assertDenied(result,expected,markers=[],label="refusal"){
  assert.equal(result.status,expected,label+": status");
  assert.ok(!result.text.includes('"cases":['),label+": no case array");
  for(const marker of markers){
    assert.ok(!result.text.includes(marker),label+": leaked victim marker");
    assert.ok(!result.text.includes(encodeURIComponent(marker)),label+": encoded victim marker");
  }
  assert.ok(!result.headers.get("set-cookie")?.includes("__Host-linaw_session="),
    label+": denied response must not authenticate");
}
export function assertSnapshotsEqual(actual,original,label){
  assert.deepEqual(actual,original,label+": protected employer SQL changed");
}
