/** Generate a v2 receipt candidate from inspected native Actions job packets. Grants ZERO credits.
 *
 * Closure rules (each one is tested in tests/wage-registry-renewal-v2.test.mjs):
 *  - roots per method: route, original proof file and its *File citations, files cited by its own
 *    original receipt, plus every repository file named by the jobs of its proof families;
 *  - follow every literal local import/export/require/import() (TypeScript AST, type-only included);
 *  - follow every repository path string literal in a pinned script (subprocess entrypoints);
 *  - a non-literal dynamic import or require must be on the reviewed list below, otherwise generation fails;
 *  - an unresolvable local import fails generation.
 */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,statSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import yaml from 'js-yaml';
import {readWageRenewalInventory,INVENTORY_BLOB} from './wage-registry-renewal-plan.mjs';
import {methodKey,requiredWageFamilies} from './wage-registry-renewal-methods.mjs';
import {RECIPES} from './wage-registry-renewal-workflow.mjs';
import {blob,expectedWageJobs,qualifiedWageMethods} from './wage-registry-renewal-verify.mjs';
import {verifyWageFamilyResults} from './wage-registry-renewal-results.mjs';
import {V2_ACCOUNTING_ONLY,V2_GLOBAL_ROOTS,WAGE_RENEWAL_V2_SCHEMA,WAGE_RENEWAL_V2_RECEIPT,WAGE_RENEWAL_V2_RECEIPT_BLOB,validateWageRenewalV2Receipt} from './wage-registry-renewal-v2.mjs';
const require=createRequire(import.meta.url);

const PATH_LITERAL=/^(?:src|scripts|tests|fixtures|assets|docs\/sql|drizzle)\/[A-Za-z0-9_.\/\[\]()-]+\.(?:mjs|cjs|js|ts|tsx|mts|sql|json|pem)$/;
const PATH_IN_TEXT=/(?:^|[\s"'`=(:])((?:src|scripts|tests|fixtures|assets|docs\/sql|drizzle)\/[A-Za-z0-9_.\/\[\]-]+\.(?:mjs|cjs|js|ts|tsx|mts|sql|json|pem))/g;
const CODE=/\.(?:[cm]?[jt]sx?)$/;
const DATA_LITERAL=/^(?:fixtures|docs\/sql|drizzle)\/|^scripts\/qa\/.*\.(?:sql|pem)$/;
const SPAWN=/\b(?:spawn|spawnSync|execFile|execFileSync|fork)\s*\(\s*process\.execPath/;
const isFile=file=>existsSync(file)&&statSync(file).isFile();
const listFiles=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const p=dir+'/'+e.name;return e.isDirectory()?listFiles(p):[p];});

/** Reviewed non-literal dynamic loads: exact file and call text. Anything else fails generation. */
export const REVIEWED_DYNAMIC_SITES=Object.freeze({
 // Auto-discovers every row family file: all of them are closure members.
 'scripts/qa/tenant-table-loader.mjs':{calls:['import(spec.url.href)'],expand:'scripts/qa/tenant-table-rows'},
 // Local-only direct adapters; each asserts CI !== "true" and GITHUB_ACTIONS !== "true" before loading.
 'scripts/qa/tenant-money-lifecycle-http.mjs':{calls:['require(authPath)','require(`../../src/app/api/${found[0]}/route.ts`)'],ciExcluded:true},
 'scripts/qa/paymongo-export-isolation-local.mjs':{calls:['require(authPath)','require(`../../src/app/api/${found[0]}/route.ts`)'],ciExcluded:true},
 'scripts/qa/final-pay-lifecycle-http.mjs':{calls:['require(authPath)','require(`../../src/app/api/${found[0]}/route.ts`)'],ciExcluded:true},
 'scripts/qa/underpayment-posting-http.mjs':{calls:['require(authPath)','require(`../../src/app/api/${found[0]}/route.ts`)'],ciExcluded:true},
 // Loads an npm package (playwright) by name; package-lock.json is in the global base.
 'scripts/hcm-request-lifecycle-browser.mjs':{calls:['require(process.env.HCM_BROWSER_PLAYWRIGHT_MODULE ?? "playwright")'],externalPackage:true},
});

/** One file's local edges: literal imports, reviewed dynamic expansions and repository path literals. */
export function fileEdges(file,source,exists=isFile){
 const ts=require('typescript');
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const edges=new Set(),dynamic=[];
 const resolve=spec=>{
  if(!spec.startsWith('.')&&!spec.startsWith('@/'))return;
  const rel=spec.startsWith('@/')?'src/'+spec.slice(2):path.posix.normalize(path.posix.join(path.posix.dirname(file),spec));
  const target=[rel,...['.ts','.tsx','.mts','.mjs','.js','.json','/index.ts','/index.tsx','/index.mjs','/index.js'].map(x=>rel+x)].find(c=>/\.[a-z]+$/.test(c)&&exists(c));
  assert.ok(target,'Unresolved local proof dependency '+spec+' in '+file);edges.add(target);
 };
 // Type-only imports and exports are erased before execution, so they are not runtime inputs.
 const typeOnly=node=>{
  if(ts.isExportDeclaration(node))return node.isTypeOnly||(node.exportClause&&ts.isNamedExports(node.exportClause)&&node.exportClause.elements.length>0&&node.exportClause.elements.every(e=>e.isTypeOnly));
  const c=node.importClause;if(!c)return false;
  if(c.isTypeOnly)return true;
  return !c.name&&Boolean(c.namedBindings)&&ts.isNamedImports(c.namedBindings)&&c.namedBindings.elements.length>0&&c.namedBindings.elements.every(e=>e.isTypeOnly);
 };
 const walk=node=>{
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteralLike(node.moduleSpecifier)){if(!typeOnly(node))resolve(node.moduleSpecifier.text);}
  else if(ts.isImportEqualsDeclaration(node)&&ts.isExternalModuleReference(node.moduleReference)&&ts.isStringLiteralLike(node.moduleReference.expression))resolve(node.moduleReference.expression.text);
  else if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.expression)&&node.expression.text==='require'))){
   const arg=node.arguments[0];
   if(arg&&ts.isStringLiteralLike(arg))resolve(arg.text);else dynamic.push(node.getText());
  }else if(ts.isStringLiteralLike(node)&&PATH_LITERAL.test(node.text)&&exists(node.text)){
   // Runtime inputs a proof loads by path: fixtures and SQL always; scripts only when this file launches
   // child processes (subprocess entrypoints such as the isolated-baseline steps).
   if(DATA_LITERAL.test(node.text)||(spawns&&CODE.test(node.text)&&node.text.startsWith('scripts/')))edges.add(node.text);
  }
  ts.forEachChild(node,walk);
 };
 const spawns=SPAWN.test(source);
 walk(ast);
 if(dynamic.length){
  const reviewed=REVIEWED_DYNAMIC_SITES[file];
  for(const call of dynamic){
   assert.ok(reviewed?.calls.includes(call),'Unreviewed non-literal dynamic load in '+file+': '+call);
  }
  if(reviewed?.expand)for(const f of listFiles(reviewed.expand))edges.add(f);
 }
 return [...edges];
}

/** Ledger validation: the tenant manifest, its documents and its receipts. A ledger file can make a proof job
 * fail but cannot change what an HTTP proof demonstrated, so it is neither pinned nor followed. A file counts
 * only when BOTH its path names it as ledger AND its source makes no request, opens no database, starts no
 * process and imports no application source; anything else stays a pinned runtime input. */
const LEDGER_PATH=/^(?:scripts\/qa\/[^/]*(?:credit|accounting|holds?|reconciliation|supersession|renewal|receipt|ledger|counts|repin)[^/]*\.mjs|tests\/(?:helpers\/)?[^/]*(?:coverage-inventory|credit|ledger|reconciliation|holds?|renewal|closure-plan|families|counts|repin|inventory)[^/]*\.mjs)$/;
/** What makes a file runtime rather than ledger, read from its syntax tree so that text inside a string (a ledger test quoting an import
 * line in its fixtures) is never mistaken for code: an import/require of application source or a database or network or process
 * module, a call to fetch, a database pool, or a process started from process.execPath. */
const RUNTIME_MODULE=/^(?:pg|postgres|node:child_process|child_process|node:http|node:https|node:net|http|https|net)$/;
const APP_SOURCE_SPECIFIER=/^@\/|^(?:\.\.?\/)*(?:\.\.\/)+src\//;
function runtimeReason(file,source){
 const ts=require("typescript");
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith("x")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 let reason=null;
 const flagSpecifier=node=>{if(node&&ts.isStringLiteralLike(node)&&(RUNTIME_MODULE.test(node.text)||APP_SOURCE_SPECIFIER.test(node.text)))reason??=node.text;};
 const walk=node=>{
  if(reason)return;
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier)flagSpecifier(node.moduleSpecifier);
  else if(ts.isCallExpression(node)){
   const callee=node.expression;
   if(callee.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(callee)&&callee.text==="require"))flagSpecifier(node.arguments[0]);
   else if(ts.isIdentifier(callee)&&callee.text==="fetch")reason??="fetch";
   else if(ts.isIdentifier(callee)&&["spawn","spawnSync","fork"].includes(callee.text))reason??=callee.text;
   else if(ts.isIdentifier(callee)&&["execFileSync","execFile"].includes(callee.text)&&node.arguments[0]?.getText()==="process.execPath")reason??="execFile process.execPath";
   else if(ts.isPropertyAccessExpression(callee)&&["request","get"].includes(callee.name.text)&&ts.isIdentifier(callee.expression)&&["http","https"].includes(callee.expression.text))reason??="http request";
  }else if(ts.isNewExpression(node)&&((ts.isIdentifier(node.expression)&&["Pool","Client"].includes(node.expression.text))||(ts.isPropertyAccessExpression(node.expression)&&["Pool","Client"].includes(node.expression.name.text))))reason??="database client";
  ts.forEachChild(node,walk);
 };
 walk(ast);
 return reason;
}
export const isLedgerSource=(file,source)=>LEDGER_PATH.test(file)&&runtimeReason(file,source)===null;

export function closure(roots,read=readFileSync,exists=isFile,cache=new Map()){
 const pins={},queue=[...roots];
 while(queue.length){
  const file=queue.shift().replaceAll('\\','/');
  if(Object.hasOwn(pins,file))continue;
  assert.ok(!file.startsWith('../')&&!path.isAbsolute(file),'Repository-local input required: '+file);
  // Bookkeeping is neither pinned nor followed: what it imports is ledger validation, not proof runtime.
  // (An input a harness really executes is reached from that harness, never only through bookkeeping.)
  if(V2_ACCOUNTING_ONLY.includes(file)){pins[file]=null;continue;}
  const raw=read(file),sha=blob(raw);
  if(isLedgerSource(file,raw.toString('utf8'))){pins[file]=null;continue;}
  pins[file]=sha;
  if(!CODE.test(file))continue;
  const memo=file+'@'+sha;
  if(!cache.has(memo))cache.set(memo,fileEdges(file,raw.toString('utf8'),exists));
  queue.push(...cache.get(memo));
 }
 return Object.fromEntries(Object.entries(pins).filter(([,sha])=>sha!==null).sort(([a],[b])=>a.localeCompare(b)));
}

/** Every repository file the selected jobs of each proof family name, plus the family's own recipe workflow. */
export function familyRoots(read=readFileSync,exists=isFile){
 const out={};
 for(const [family,[file,selected]]of Object.entries(RECIPES)){
  const recipe=yaml.load(read('.github/workflows/'+file,'utf8'));
  const jobs=Object.entries(recipe.jobs).filter(([id])=>!selected||selected.includes(id)).map(([,job])=>job);
  const text=JSON.stringify([recipe.env??{},jobs]).replaceAll('\\n',' ').replaceAll('\\"','"');
  const roots=new Set(['.github/workflows/'+file]);
  for(const m of text.matchAll(PATH_IN_TEXT))if(exists(m[1]))roots.add(m[1]);
  out[family]=[...roots].sort();
 }
 return out;
}

/** Files the method's own original proof and its original receipt cite (v1 rule, scoped to one method). */
function citedFiles(entry,read=readFileSync,exists=isFile){
 const proof=entry.held.reviewedUncertified.priorProof,found=new Set();
 const visit=value=>{
  if(Array.isArray(value)){value.forEach(visit);return;}
  if(!value||typeof value!=='object')return;
  for(const [key,x]of Object.entries(value)){
   if(PATH_LITERAL.test(key)&&/^[a-f0-9]{40}$/.test(x)&&exists(key))found.add(key);
   if(typeof x==='string'&&PATH_LITERAL.test(x)&&exists(x))found.add(x);else visit(x);
  }
 };
 visit(proof);
 if(proof.receiptFile&&exists(proof.receiptFile)){found.add(proof.receiptFile);visit(JSON.parse(read(proof.receiptFile,'utf8')));}
 return [...found];
}

export function methodRoots(entry,families,read=readFileSync,exists=isFile){
 return [...new Set([entry.path,...citedFiles(entry,read,exists),...requiredWageFamilies(entry).flatMap(f=>families[f])])]
  .filter(f=>!V2_ACCOUNTING_ONLY.includes(f)).sort();
}

/** Global base plus one closure per method; global members are not repeated per method. */
export function sealClosures(entries,read=readFileSync,exists=isFile){
 const cache=new Map(),globalPins=closure(V2_GLOBAL_ROOTS,read,exists,cache);
 for(const f of Object.keys(globalPins))assert.ok(!V2_ACCOUNTING_ONLY.includes(f),'Bookkeeping in global base: '+f);
 const families=familyRoots(read,exists),methodPins={};
 for(const entry of entries){
  const all=closure(methodRoots(entry,families,read,exists),read,exists,cache);
  methodPins[methodKey(entry)]=Object.fromEntries(Object.entries(all).filter(([f])=>!Object.hasOwn(globalPins,f)&&!V2_ACCOUNTING_ONLY.includes(f)));
 }
 return {globalPins,methodPins};
}

function treeAt(head){
 const text=execFileSync('git',['ls-tree','-r',head],{encoding:'utf8',maxBuffer:32*1024*1024});
 return new Map(text.trimEnd().split('\n').map(line=>{const [meta,file]=line.split('\t');return [file,meta.split(' ')[2]];}));
}

export function captureWageRenewalV2(directory='outputs/wage-renewal-v2-jobs'){
 const inventory=readWageRenewalInventory();
 const packets=readdirSync(directory).filter(x=>x.endsWith('.json')).map(x=>JSON.parse(readFileSync(directory+'/'+x)));
 const families={},heldFamilies={};
 for(const family of Object.keys(RECIPES)){
  const jobs=packets.filter(j=>j.jobKey.startsWith(family+'__'));
  const expected=expectedWageJobs(family);
  if(jobs.length!==expected.length){heldFamilies[family]='Missing completed jobs/matrix legs: '+jobs.length+'/'+expected.length;continue;}
  try{verifyWageFamilyResults(family,jobs);families[family]=jobs;}catch(error){heldFamilies[family]=error.message.split('\n')[0];}
 }
 const {methods,heldMethods}=qualifiedWageMethods(families,inventory);
 assert.ok(methods.length>0,'No complete source-current method proofs; no receipt or credit');
 const {globalPins,methodPins:all}=sealClosures(inventory.methods);
 const methodPins=Object.fromEntries(methods.map(k=>[k,all[k]]));
 const heads=[...new Set(Object.values(families).flatMap(jobs=>jobs.map(j=>j.sourceHead)))];
 for(const head of heads){
  const tree=treeAt(head);
  for(const pins of [globalPins,...Object.values(methodPins)])for(const [file,sha]of Object.entries(pins))
   assert.equal(tree.get(file),sha,'Fresh executed checkout does not match a sealed input at '+head+': '+file);
 }
 const executedAccountingInputs=Object.fromEntries(heads.map(head=>{const tree=treeAt(head);return [head,Object.fromEntries(V2_ACCOUNTING_ONLY.map(f=>[f,tree.get(f)??null]))];}));
 const receipt={schema:WAGE_RENEWAL_V2_SCHEMA,label:'SOLO_VERIFIED_DEV_RECOVERY',inventoryBlobSha:INVENTORY_BLOB,
  productionAccepted:false,independentlyAccepted:false,liveActivation:false,creditsAtExecution:0,
  methods,families,globalRoots:V2_GLOBAL_ROOTS,globalPins,methodPins,reviewedDynamicSites:REVIEWED_DYNAMIC_SITES,
  accountingScope:{excludedInputs:V2_ACCOUNTING_ONLY,executedAccountingInputs,
   boundary:'Only ledger validation/generation is separated. Each method is bound to its own executed closure plus the global base; drift elsewhere does not withdraw it. Final accounting CI is still required.'}};
 validateWageRenewalV2Receipt(receipt,inventory);
 return {receipt,heldFamilies,heldMethods};
}

const cli=process.argv[1]?.replaceAll('\\','/').endsWith('/wage-registry-renewal-v2-capture.mjs');
if(cli&&process.argv.includes('--closures')){
 const {globalPins,methodPins}=sealClosures(readWageRenewalInventory().methods);
 const sizes=Object.values(methodPins).map(p=>Object.keys(p).length).sort((a,b)=>a-b);
 const target=process.argv[process.argv.indexOf('--closures')+1];
 const reach=target&&!target.startsWith('--')?Object.entries(methodPins).filter(([,p])=>Object.hasOwn(p,target)).map(([k])=>k):null;
 console.log(JSON.stringify({global:Object.keys(globalPins).length,methods:sizes.length,min:sizes[0],median:sizes[sizes.length>>1],max:sizes.at(-1),
  ...(target&&!target.startsWith('--')?{target,global:Object.hasOwn(globalPins,target),withdraws:reach}:{})},null,1));
}
if(cli&&(process.argv.includes('--write')||process.argv.includes('--check'))){
 const {receipt,heldFamilies,heldMethods}=captureWageRenewalV2();
 if(process.argv.includes('--write')){
  assert.equal(WAGE_RENEWAL_V2_RECEIPT_BLOB,'PENDING_REAL_PG16_HTTP','Never overwrite a sealed execution receipt');
  writeFileSync(WAGE_RENEWAL_V2_RECEIPT,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 }
 console.log(JSON.stringify({eligibleMethods:receipt.methods.length,completedFamilies:Object.keys(receipt.families),heldFamilies,heldMethods,
  globalPins:Object.keys(receipt.globalPins).length,creditsWritten:0}));
}
