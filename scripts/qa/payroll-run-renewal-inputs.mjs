/** Literal local-module closure of the reviewed harness and route roots.
 * External packages are pinned by package-lock. Computed/subprocess entrypoints
 * must also be supplied as explicit reviewed roots; this is not a proof probe.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';

export const renewalBlob = bytes => createHash('sha1')
  .update(Buffer.from('blob '+Buffer.byteLength(bytes)+'\0')).update(bytes).digest('hex');

// These five files describe the ledger, not the application or HTTP assertions.
// Credit integration necessarily changes its own accounting. Record their
// historical executed hashes separately; final-head CI must review new accounting.
export const RENEWAL_LEDGER_INPUTS=Object.freeze([
  'scripts/qa/payroll-run-oracle-hold.mjs',
  'scripts/qa/tenant-staffing-policy-get-credit.mjs',
  'scripts/qa/tenant-worker360-legal-employer-credit.mjs',
  'scripts/qa/tenant-year-end-credit.mjs',
  'tests/helpers/tenant-counts.mjs',
]);

export function collectRenewalInputs(roots, read=readFileSync, exists=existsSync, separateLedger=false) {
  const pins={}, visiting=new Set();
  function visit(file) {
    file=file.replaceAll('\\','/');
    assert.ok(!file.startsWith('../')&&!path.isAbsolute(file),'Repository-local input required');
    if(visiting.has(file))return;visiting.add(file);
    if(separateLedger&&RENEWAL_LEDGER_INPUTS.includes(file))return;
    const raw=read(file);pins[file]=renewalBlob(raw);
    if(!/\.(?:[cm]?[jt]sx?)$/.test(file))return;
    const source=raw.toString('utf8');
    const imports=ts.preProcessFile(source,true,true).importedFiles.map(x=>x.fileName);
    for(const specifier of imports){
      if(!specifier.startsWith('.')&&!specifier.startsWith('@/'))continue;
      const relative=specifier.startsWith('@/')?'src/'+specifier.slice(2):path.posix.normalize(path.posix.join(path.posix.dirname(file),specifier));
      const target=[relative,...['.ts','.tsx','.mjs','.js','.json','/index.ts','/index.tsx','/index.mjs','/index.js'].map(ext=>relative+ext)]
        .find(candidate=>exists(candidate)&&/\.[a-z]+$/.test(candidate));
      assert.ok(target,'Unresolved local proof dependency '+specifier+' in '+file);visit(target);
    }
  }
  for(const file of roots)visit(file);
  return Object.fromEntries(Object.entries(pins).sort(([a],[b])=>a.localeCompare(b)));
}
