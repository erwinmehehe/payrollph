import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

export const PROMPT='When a new employee is hired, create an onboarding checklist and send them a welcome email';
export const REQUIRED_ENV=Object.freeze({
  NODE_ENV:'production', TENANT_STUDIO_LANGUAGE_PROOF:'fictional-disposable-only',
  AUTOMATION_LANGUAGE_STUDIO_ENABLED:'true', OPENAI_AUTOMATION_DRAFT_ENABLED:'false',
  OPENAI_AUTOMATION_DPA_CONFIRMED:'false', OPENAI_AUTOMATION_ZERO_RETENTION_CONFIRMED:'false',
  OPENAI_AUTOMATION_NOTICE_CONFIRMED:'false', REQUIRE_PRIVILEGED_MFA:'true', DEMO_MODE:'false',
  WORKER_ENABLED:'false', CENTRAL_SCHEDULER_ENABLED:'false',
  PAYMONGO_DISBURSEMENTS_ENABLED:'false', XENDIT_PAYOUTS_ENABLED:'false', XENDIT_BILLING_ENABLED:'false',
  FINAL_PAY_SIGNED_REVIEW_ENABLED:'false', EXACT_THIRTEENTH_CENTAVOS_ENABLED:'false',
  PAYROLL_CALCULATION_HISTORY_ENABLED:'false', NEXT_CSP_ENABLED:'false', MULTI_ENTITY_ENABLED:'false',
});
export const FORBIDDEN_ENV=Object.freeze(['OPENAI_API_KEY','OPENAI_AUTOMATION_APPROVED_ORG_IDS',
  'PAYMONGO_SECRET_KEY','PAYMONGO_WALLET_ID','XENDIT_SECRET_KEY','XENDIT_PAYOUT_SECRET_KEY',
  'RESEND_API_KEY','SMTP_URL','SMTP_PASSWORD','POSTMARK_SERVER_TOKEN','STRIPE_SECRET_KEY',
  'CRON_SECRET','WORKER_TOKEN','VERCEL','VERCEL_ENV','MALWARE_SCAN_URL']);
export const SOURCE_PINS=Object.freeze({
  "src/lib/automation-draft-conflict.ts": "077126c704fe62e83907c1e6c8f2c39828efb585",
  "src/app/api/automation-studio/route.ts": "3bfc6666644ca11b480cf2735e9563d46139ebf4",
  "src/lib/automation-language-release.ts": "1a1e12c39ecdf671810219e1f168c0c3d2b80c77",
  "src/lib/automation-language-draft.ts": "30240aeccaccf5b08ac062206bbae15b51629ffd",
  "src/lib/automation-language-intent.ts": "f23454a9216f639b0b54df88db055e33ef31d87c",
  "src/lib/automation-language-proposal-receipt.ts": "5912340d0950eef2428780350bdb97014999ffe3",
  "src/lib/automation-model-consent.ts": "63755a418bc55a634f1d28d202757b699bc09746",
  "src/lib/automation-preview-approval.ts": "1182c52c04200c1b0cb79fde840390f81919a65f",
  "src/lib/automation-templates.ts": "f6cd21b7a09fc575345c92f49edcf8b80767952d",
  "src/lib/automation-versioning.ts": "02de9020858887818b70bd940d6b287d1c73e9bf",
  "src/lib/automation.ts": "ce2c8e8feee4554c85f7739b73f2fa0325b81306",
  "src/lib/automation-recovery-scope.ts": "ff3dddff0e7ddea20a7be24792d84503a540202e",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "src/lib/security-request.ts": "de996ebb7eb663aaebf65f8a963d955b8bc90c9d",
  "src/db/schema.ts": "3f504163c9847a99434a5e01a72c120dfd680a02"
});
export function blob(bytes){return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');}
export function verifySources(read=readFileSync){
  assert.ok(Object.keys(SOURCE_PINS).length>=10,'Complete source pins required');
  for(const [path,sha]of Object.entries(SOURCE_PINS))assert.equal(blob(read(path)),sha,'Language proof source drift: '+path);
}
export function requireLanguageEnv(env=process.env){
  for(const [name,value]of Object.entries(REQUIRED_ENV))assert.equal(env[name],value,'Unsafe language proof setting: '+name);
  for(const name of FORBIDDEN_ENV)assert.ok(!env[name],'External configuration refused: '+name);
  const app=new URL(env.APP_BASE_URL),db=new URL(env.DATABASE_URL);
  assert.equal(app.origin,env.APP_BASE_URL);assert.equal(app.hostname,'127.0.0.1');assert.equal(app.protocol,'http:');
  assert.ok(['3000','3319'].includes(app.port));assert.equal(app.username,'');assert.equal(app.password,'');
  assert.equal(env.SECURITY_SMOKE_URL,app.origin);assert.equal(env.TRUSTED_APP_ORIGINS,app.origin);
  assert.ok(['postgres:','postgresql:'].includes(db.protocol));assert.equal(db.hostname,'127.0.0.1');
  assert.ok(['5432','55439'].includes(db.port));assert.equal(db.pathname,'/app_db');assert.equal(db.search,'');
  return app.origin;
}
export function assertDenied(result,status,actors,label){
  assert.equal(result.status,status,label);assert.equal(typeof result.text,'string');
  for(const key of ['rule','draft','proposalReceipt'])assert.equal(result.json?.[key],undefined,label+': private result disclosed');
  const body=result.text.replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
  for(const actor of actors)assert.ok(!body.includes(actor.marker),label+': employer marker leaked');
}
export function assertProposal(result,actor){
  assert.equal(result.status,200);assert.equal(result.json?.source,'approved-template');
  assert.equal(result.json?.validation?.valid,true);assert.equal(result.json?.draft?.name,'New hire core onboarding');
  assert.equal(result.json?.draft?.trigger,'employee.hired');assert.ok(result.json?.draft?.actions?.length>0);
  assert.match(result.json.proposalReceipt,/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const receipt=JSON.parse(Buffer.from(result.json.proposalReceipt.split('.')[0],'base64url').toString());
  assert.equal(receipt.org,actor.org.id);assert.equal(receipt.actor,actor.owner.id);
  assert.equal(receipt.source,'approved-template');assert.equal(receipt.purpose,'language-draft-save');
  assert.ok(Number.isSafeInteger(receipt.session)&&receipt.session>0);return result.json;
}
export function assertProposalDelta(before,after,actor){
  for(const key of Object.keys(before))if(key!=='auditEvents')assert.deepEqual(after[key],before[key],'Proposal changed '+key);
  assert.equal(after.auditEvents.length,before.auditEvents.length+1);
  assert.deepEqual(after.auditEvents.slice(0,-1),before.auditEvents);
  const audit=after.auditEvents.at(-1);assert.equal(audit.organizationId,actor.org.id);
  assert.equal(audit.actor,actor.owner.name);assert.equal(audit.action,'Automation Studio language draft proposed');
  assert.equal(audit.metadata.source,'approved-template');assert.equal(audit.metadata.trigger,'employee.hired');
  assert.deepEqual(Object.keys(audit.metadata).sort(),['actionTypes','source','trigger']);
}
export function assertSavedDelta(before,after,actor,result,proposal){
  assert.equal(result.status,201);assert.equal(result.json?.created,true);
  const {rule,draft}=result.json;assert.ok(Number.isSafeInteger(rule?.id)&&rule.id>0);assert.ok(Number.isSafeInteger(draft?.id)&&draft.id>0);
  for(const key of Object.keys(before))if(!['automationRules','automationRuleVersions','auditEvents'].includes(key))
    assert.deepEqual(after[key],before[key],'Saving changed '+key);
  for(const [table,row]of [['automationRules',rule],['automationRuleVersions',draft]]){
    assert.equal(after[table].length,before[table].length+1);
    assert.deepEqual(after[table].filter(x=>x.id!==row.id),before[table],'Prior definitions changed');
    assert.deepEqual(after[table].find(x=>x.id===row.id),row,'HTTP success must match persisted SQL');
    assert.equal(row.organizationId,actor.org.id);assert.equal(row.createdByUserId,actor.owner.id);
    assert.equal(row.active,false);assert.equal(row.name,proposal.draft.name);
    assert.deepEqual(row.actions,proposal.draft.actions);assert.deepEqual(row.conditions,proposal.draft.conditions);
    assert.equal(row.trigger,proposal.draft.trigger);
  }
  assert.equal(rule.publishedVersion,0);assert.equal(rule.draftVersion,1);assert.equal(draft.ruleId,rule.id);
  assert.equal(draft.status,'draft');assert.equal(draft.version,1);
  assert.equal(after.auditEvents.length,before.auditEvents.length+1);assert.deepEqual(after.auditEvents.slice(0,-1),before.auditEvents);
  const audit=after.auditEvents.at(-1);assert.equal(audit.organizationId,actor.org.id);assert.equal(audit.actor,actor.owner.name);
  assert.equal(audit.action,'Automation Studio signed language draft saved');assert.equal(audit.metadata.ruleId,rule.id);
  assert.equal(audit.metadata.source,'approved-template');assert.equal(audit.metadata.active,false);
}
