import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireDisposablePiiApprovalEnv } from "./tenant-pii01-approval-contract.mjs";
import { requireLocalRecovery, assertLocalRecoveryDatabase, recoveryReceipt, RECOVERY_MODE } from './tenant-recovery-local-contract.mjs';
const localRecovery=process.env.TENANT_RECOVERY_MODE===RECOVERY_MODE;
if(localRecovery) requireLocalRecovery(); else requireDisposablePiiApprovalEnv();
assert.equal(process.env.TENANT_TOTP_SETUP_MODE, "fictional-ci-only");
const [{ db, pool }, s, { eq }, fixture, crypto, totp, security] = await Promise.all([
  import("../../src/db/index.ts"), import("../../src/db/schema.ts"), import("drizzle-orm"),
  import("./tenant-table-http.mjs"), import("../../src/lib/crypto.ts"), import("../../src/lib/totp.ts"),
  import("../../src/lib/security-secret.ts"),
]);
async function request(f, body, query = "") {
  const response = await fetch("http://127.0.0.1:3000/api/auth/totp/setup" + query, {
    method: body ? "POST" : "GET", redirect: "manual", signal: AbortSignal.timeout(15000),
    headers: { Cookie: f.cookie ?? "", Origin: "http://127.0.0.1:3000", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
async function snapshot(f) {
  return { user: await db.select().from(s.users).where(eq(s.users.id, f.owner.id)),
    sessions: (await db.select().from(s.sessions).where(eq(s.sessions.userId, f.owner.id))).sort((a,b)=>a.id-b.id),
    victim: await fixture.victimSnapshot(f.org.id) };
}
function proveStatus(r, enabled) {
  assert.equal(r.status, 200); assert.equal(r.body.enabled, enabled);
  assert.deepEqual(Object.keys(r.body).sort(), ["enabled", "message"]);
}
async function prepare(label, nonce) {
  const f = await fixture.seedEmployer(label, nonce, fixture.standaloneMakeSession);
  f.password = "Fictional-only-" + randomUUID();
  await db.update(s.users).set({ passwordHash: crypto.hashPassword(f.password), totpEnabled: false, totpSecret: null, backupCodes: [] }).where(eq(s.users.id, f.owner.id));
  const second = await fixture.standaloneMakeSession(f.owner.id);
  await db.update(s.sessions).set({mfaVerifiedAt:null}).where(eq(s.sessions.userId,f.owner.id));
  f.secondId = second.id;
  return f;
}
async function verify() {
  if(localRecovery) await assertLocalRecoveryDatabase(pool);
  assert.equal((await db.select().from(s.users).limit(1)).length, 0, "fresh fictional accounts required");
  const nonce = randomUUID().slice(0,8);
  const a = await prepare("ATTA", nonce), b = await prepare("ATTB", nonce);
  for(let i=0;i<7;i++) await db.insert(s.users).values({ email: nonce+i+"@example.invalid", name:"Fictional filler", passwordHash:"unused" });
  const victim = await prepare("VICTIM", nonce);
  assert.ok(victim.owner.id > Math.max(a.owner.id,b.owner.id,6));
  assert.equal((await request({}, undefined)).status,401);
  assert.equal((await request({}, {action:"begin",currentPassword:"fictional"})).status,401);
  // The victim's factor genuinely works before either attacker is exercised.
  const vBegin = await request(victim,{action:"begin",currentPassword:victim.password});
  assert.equal(vBegin.status,200);
  const vVerify = await request(victim,{action:"verify",currentPassword:victim.password,code:totp.generateTotp(vBegin.body.secret)});
  assert.equal(vVerify.status,200); assert.equal(vVerify.body.enabled,true);
  const victimStatus=await request(victim);
  proveStatus(victimStatus,true);
  const victimBefore = await snapshot(victim);
  for(const f of [a,b]) {
    const forged={userId:victim.owner.id,organizationId:victim.org.id,sessionId:victimBefore.sessions[0].id};
    const status=await request(f,undefined,"?userId="+victim.owner.id);
    proveStatus(status,false);
    assert.throws(()=>proveStatus(victimStatus,false), /true !== false/);
    const initial=await snapshot(f);
    const denied=await request(f,{...forged,action:"begin",currentPassword:victim.password});
    assert.equal(denied.status,403); assert.deepEqual(await snapshot(f),initial);
    const issued=await request(f,{...forged,action:"begin",currentPassword:f.password});
    assert.equal(issued.status,200); assert.equal(issued.body.enabled,false);
    assert.ok(issued.body.secret !== vBegin.body.secret);
    assert.ok(!JSON.stringify(issued.body).includes(victim.owner.email));
    const pending=await snapshot(f);
    assert.notEqual(pending.user[0].totpSecret,issued.body.secret);
    assert.equal(security.decryptTotpSecret(pending.user[0].totpSecret),issued.body.secret);
    proveStatus(await request(f),false);
    const rotated=await request(f,{...forged,action:"begin",currentPassword:f.password});
    assert.equal(rotated.status,200); assert.notEqual(rotated.body.secret,issued.body.secret);
    const beforeBad=await snapshot(f);
    let bad="000000";
    while(totp.verifyTotp(bad,rotated.body.secret)) bad=String(Number(bad)+1).padStart(6,"0");
    assert.equal((await request(f,{...forged,action:"verify",currentPassword:f.password,code:bad})).status,400);
    assert.deepEqual(await snapshot(f),beforeBad);
    const verified=await request(f,{...forged,action:"verify",currentPassword:f.password,code:totp.generateTotp(rotated.body.secret)});
    assert.equal(verified.status,200); assert.equal(verified.body.enabled,true);
    assert.ok(verified.body.backupCodes.length>0);
    const after=await snapshot(f);
    assert.equal(after.user[0].totpEnabled,true);
    assert.deepEqual(after.user[0].backupCodes,verified.body.backupCodes.map(crypto.sha256));
    assert.equal(after.sessions.find(row=>row.id===f.secondId).mfaVerifiedAt,null);
    assert.ok(after.sessions.some(row=>row.id!==f.secondId && row.mfaVerifiedAt));
    proveStatus(await request(f),true);
    const enabledBefore=await snapshot(f);
    assert.equal((await request(f,{action:"begin",currentPassword:f.password})).status,409);
    assert.deepEqual(await snapshot(f),enabledBefore);
    assert.deepEqual(await snapshot(victim),victimBefore,"victim factor, backup codes, sessions, payroll or audit changed");
  }
  const result={kind:"TOTP_SETUP_HTTP",result:"PASS",attackers:2,methods:["GET","POST"],coverageCredits:0,productionCertified:false};
  recoveryReceipt('totp',result);
  console.log(JSON.stringify(result));
}
try {await verify();} finally {await pool.end();}
