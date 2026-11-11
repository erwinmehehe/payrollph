import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {REQUIRED_ENV,FORBIDDEN_ENV,blob} from './tenant-studio-language-contract.mjs';

export const REQUIRED=Object.freeze({...REQUIRED_ENV,AUTOMATION_LANGUAGE_STUDIO_ENABLED:'false',
  TENANT_STUDIO_RECOVERY_SCOPE_PROOF:'fictional-pg16-only'});
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
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "src/lib/security-request.ts": "de996ebb7eb663aaebf65f8a963d955b8bc90c9d",
  "src/db/schema.ts": "3f504163c9847a99434a5e01a72c120dfd680a02",
  "src/lib/automation-recovery-scope.ts": "ff3dddff0e7ddea20a7be24792d84503a540202e",
  "src/lib/automation-execution-recovery.ts": "ecc727efb94ed78bd73ce7389ad4ef8aee264659",
  "src/db/index.ts": "7a5718d0a99ce5b3a7f0f25e385f79a61be807f6",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
  "scripts/qa/tenant-studio-source-resolution-proof.mjs": "65ae6c7ec3f11af5c79b291bc0f768ecc6848970",
  "src/lib/automation-operational-cases.ts": "5355d830524f54e6d47dd551c9d7bc5e73649f52"
});
export function requireScopeEnv(env=process.env){
  for(const [k,v]of Object.entries(REQUIRED))assert.equal(env[k],v,'Unsafe recovery scope environment: '+k);
  for(const k of FORBIDDEN_ENV)assert.ok(!env[k],'External configuration refused: '+k);
  const app=new URL(env.APP_BASE_URL),db=new URL(env.DATABASE_URL);
  assert.equal(app.protocol,'http:');assert.equal(app.hostname,'127.0.0.1');
  assert.ok(['3000','3319'].includes(app.port));assert.equal(app.origin,env.APP_BASE_URL);
  assert.equal(app.username,'');assert.equal(app.password,'');assert.equal(app.origin,env.TRUSTED_APP_ORIGINS);
  assert.equal(app.origin,env.SECURITY_SMOKE_URL);assert.ok(['postgres:','postgresql:'].includes(db.protocol));
  assert.equal(db.hostname,'127.0.0.1');assert.ok(['5432','55439'].includes(db.port));
  assert.equal(db.pathname,'/app_db');assert.equal(db.search,'');return app.origin;
}
export function verifyScopeSources(read=readFileSync){
  assert.ok(Object.keys(SOURCE_PINS).length>=5,'Complete recovery scope source seals required');
  for(const [p,sha]of Object.entries(SOURCE_PINS))assert.equal(blob(read(p)),sha,'Recovery scope source drift: '+p);
}
export function assertOwnedRecovery(response,actor,source,mode,persisted){
  assert.equal(response.status,mode==='replay-execution'?201:200);
  const e=response.json?.execution;assert.ok(e,'persisted recovery response required');
  assert.equal(e.organizationId,actor.org.id,'accepts another employer\'s data');
  assert.equal(e.employeeId,actor.worker.id,'accepts another employer\'s data');
  assert.equal(e.ruleId,source.ruleId,'accepts another employer\'s data');
  assert.equal(e.status,'completed');assert.deepEqual(e,persisted,'HTTP must equal persisted execution');
  if(mode==='replay-execution')assert.notEqual(e.id,source.id);else assert.equal(e.id,source.id);
}
