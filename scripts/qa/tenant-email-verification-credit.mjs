// Read-only security receipt verifier. One-time credit generation has already been
// committed; no Git execution, dynamic import traversal, or file mutation here.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';

export const EMAIL_RECEIPT = Object.freeze({head:'480e6d621c91564f9645563b3417a10fb2ebd5a0',merge:'9ac4795efe8c013cd7a66ba73005dc481bde6626',run:42316473226,job:128230185900});
const route='src/app/api/account/email/verify/route.ts';
const harness='scripts/qa/tenant-account-email-verify-http.mjs';
const workflow='.github/workflows/tenant-account-email-verify-http.yml';
const RECEIPT_DIGEST='cd95cc8dc4ddee4f5ac5e5271e752b70be51913f30905be9145aa6587ee75cb3';
// Source references come from a reviewed fixture, but still never permit that
// fixture or an import specifier to read outside this checked-out repository.
const repositoryRoot=path.resolve(process.cwd());
const rootFiles=new Set(['package.json','package-lock.json','next.config.ts','tsconfig.json']);
export function resolveProofRepoPath(relativeFile) {
  assert.equal(typeof relativeFile,'string','proof file path must be a string');
  assert.ok(!relativeFile.includes(String.fromCharCode(92)) && !relativeFile.includes(String.fromCharCode(0)),
    'proof file path must be POSIX and NUL-free');
  assert.ok(!path.posix.isAbsolute(relativeFile) && !path.win32.isAbsolute(relativeFile),
    'absolute proof paths are forbidden');
  const segments=relativeFile.split('/');
  assert.ok(segments.every(segment=>segment.length>0 && segment!=='.' && segment!=='..'),
    'untrusted path components in proof input');
  assert.ok(
    rootFiles.has(relativeFile) ||
    /^(?:src|scripts|tests)\//.test(relativeFile) ||
    relativeFile.startsWith('.github/workflows/'),
    'proof input must be from an explicit source/QA root'
  );
  const absolute=path.resolve(repositoryRoot,relativeFile);
  assert.ok(absolute.startsWith(repositoryRoot+path.sep),
    'proof file escaped the repository root');
  return absolute;
}
const read=relativeFile=>readFileSync(resolveProofRepoPath(relativeFile),'utf8');

// Explicit repository inputs: a JSON receipt cannot choose arbitrary file paths.
const CREDIT_SOURCE_FILES = Object.freeze([
  ".github/workflows/tenant-account-email-verify-http.yml",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "scripts/lib/migration-only-objects.mjs",
  "scripts/qa/apply-isolated-baseline.mjs",
  "scripts/qa/email-verify-owned-proof.mjs",
  "scripts/qa/tenant-account-email-verify-http.mjs",
  "scripts/qa/tenant-identity-account-proof.mjs",
  "scripts/qa/tenant-legal-employer-admin-proof.mjs",
  "scripts/qa/tenant-read-recovery-snapshot.mjs",
  "scripts/qa/tenant-table-catalog.mjs",
  "scripts/qa/tenant-table-env.mjs",
  "scripts/qa/tenant-table-http.mjs",
  "scripts/qa/tenant-table-invariants.mjs",
  "scripts/qa/tenant-table-loader.mjs",
  "scripts/qa/tenant-table-path.mjs",
  "src/app/api/account/email/verify/route.ts",
  "src/db/index.ts",
  "src/db/schema.ts",
  "src/lib/access.ts",
  "src/lib/account.ts",
  "src/lib/audit.ts",
  "src/lib/auth.ts",
  "src/lib/bank-account-crypto.ts",
  "src/lib/critical-release-flags.ts",
  "src/lib/crypto.ts",
  "src/lib/dynamic-group-authorization.ts",
  "src/lib/dynamic-worker-group-conditions.ts",
  "src/lib/enterprise-session.ts",
  "src/lib/ess-profile-schema.ts",
  "src/lib/government-id-crypto.ts",
  "src/lib/multi-entity-registration-storage.ts",
  "src/lib/organization-auth-policy.ts",
  "src/lib/payroll-period-ui.ts",
  "src/lib/payroll-period-validation.ts",
  "src/lib/permission-overlay-absence.ts",
  "src/lib/permissions.ts",
  "src/lib/pg-tls-policy.ts",
  "src/lib/rate-limit-memory.ts",
  "src/lib/rate-limit.ts",
  "src/lib/security-request.ts",
  "src/lib/tenant-module-storage.ts",
  "src/lib/tenant-modules.ts",
  "src/lib/validation.ts",
  "src/lib/worker-attribute-context.ts",
  "tests/tenant-account-email-verify-contract.test.mjs",
  "tests/tenant-email-verify-owned-proof.test.mjs",
  "tsconfig.json"
]);

export function verifyEmailCredit(manifest, receipt, reader=read) {
  assert.equal(createHash('sha256').update(JSON.stringify(receipt,null,2)+'\n').digest('hex'),RECEIPT_DIGEST,'reviewed receipt bytes');
  assert.deepEqual(receipt.execution,EMAIL_RECEIPT,'execution receipt identity');
  const method=manifest.allApiRouteFiles[route].methods.find(m=>m.name==='POST');
  assert.equal(method.status,'COVERED');
  assert.deepEqual(method.testedBy,receipt.proof,'exact reviewed method evidence');
  assert.deepEqual(Object.keys(receipt.pins).sort(),[...CREDIT_SOURCE_FILES].sort(),
    'the signed proof may not choose additional file inputs');
  for(const relativeFile of CREDIT_SOURCE_FILES){
    const raw=Buffer.from(reader(relativeFile).replaceAll('\r\n','\n'));
    assert.equal(createHash('sha1').update(Buffer.from('blob '+raw.length+'\0')).update(raw).digest('hex'),receipt.pins[relativeFile],relativeFile+': executed input drift');
  }
  const lines=reader(harness).split('\n');
  for(const [key,fragment] of Object.entries(receipt.citations))assert.ok(lines[receipt.proof[key]-1]?.includes(fragment),'invalid '+key+' evidence citation');
  return 1;
}

