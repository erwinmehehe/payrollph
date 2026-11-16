/**
 * Source-only importer inventory: follow transitive runtime imports from all
 * API routes to the modified wage and statutory watch modules.
 * This is NOT executed HTTP evidence, new credit, or production approval.
 */
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, extname } from "node:path";
import { WAGE_SOURCE_HELD_METHODS, verifyAllWageRegistrySourceHolds } from "../scripts/qa/wage-registry-source-hold.mjs";

const WAGE="src/lib/wage-orders.ts", WATCH="src/lib/statutory-rule-watch.ts";
const EXT=[".ts",".tsx",".js",".jsx",".mts",".mjs"];
const pathName=x=>normalize(x).replaceAll("\\","/");
function filesIn(dir) {
  return readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
    const p=pathName(join(dir,e.name));
    return e.isDirectory()?filesIn(p):
      EXT.includes(extname(p))&&!p.endsWith(".d.ts")&&!p.endsWith(".d.mts")?[p]:[];
  });
}
const exists=new Set(filesIn("src"));
const edgesByFile=new Map();
const unresolved=[], dynamic=[];
function local(file,spec) {
  if(!spec.startsWith("@/")&&!spec.startsWith("."))return null;
  const stem=spec.startsWith("@/")?"src/"+spec.slice(2):pathName(join(dirname(file),spec));
  const choices=[stem,...EXT.map(ext=>stem+ext),...EXT.map(ext=>stem+"/index"+ext)];
  const found=choices.find(p=>exists.has(p));
  if(!found)unresolved.push({file,spec});
  return found??null;
}
function edges(file) {
  if(edgesByFile.has(file))return edgesByFile.get(file);
  const contents=readFileSync(file,"utf8");
  const ast=ts.createSourceFile(file,contents,ts.ScriptTarget.Latest,true,
    file.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const imports=[];
  function add(node) {
    if(!node||!ts.isStringLiteralLike(node)){dynamic.push(file);return;}
    const result=local(file,node.text);
    if(result)imports.push(result);
  }
  function walk(node) {
    if(ts.isImportDeclaration(node)) {
      const c=node.importClause;
      const onlyType=c?.isTypeOnly || (c?.namedBindings &&
        ts.isNamedImports(c.namedBindings)&&!c.name &&
        c.namedBindings.elements.length>0 &&
        c.namedBindings.elements.every(e=>e.isTypeOnly));
      if(!onlyType)add(node.moduleSpecifier);
    } else if(ts.isExportDeclaration(node)) {
      if(node.moduleSpecifier&&!node.isTypeOnly)add(node.moduleSpecifier);
    } else if(ts.isImportEqualsDeclaration(node)&&ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression);
    } else if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression)&&node.expression.text==="require"))) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node,walk);
  }
  walk(ast);
  const result=[...new Set(imports)];
  edgesByFile.set(file,result);
  return result;
}
function pathTo(start,goal) {
  const queue=[[start]],seen=new Set([start]);
  for(let i=0;i<queue.length;i++) {
    const chain=queue[i],file=chain[chain.length-1];
    if(file===goal)return chain;
    for(const next of edges(file))if(!seen.has(next)){
      seen.add(next);queue.push([...chain,next]);
    }
  }
  return null;
}
test("only historical zero-credit holds can stand for changed transitive wage runtime sources",()=>{
  const m=JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json","utf8"));
  assert.equal(verifyAllWageRegistrySourceHolds(m).length,23);
  const impacted=[];
  for(const [route,rec] of Object.entries(m.allApiRouteFiles)) {
    const viaWage=pathTo(route,WAGE),viaWatch=pathTo(route,WATCH);
    if(!viaWage&&!viaWatch)continue;
    impacted.push({route,viaWage,viaWatch,methods:rec.methods.map(method=>({
      verb:method.name,status:method.status,
      held:method.reviewedUncertified?.kind==="wage-registry-dependency-source-withdrawal",
    }))});
  }
  const uncovered=impacted.flatMap(row=>row.methods.filter(m=>m.status==="COVERED")
    .map(m=>({route:row.route,verb:m.verb,chain:row.viaWage??row.viaWatch})));
  console.log("WAGE_TRANSITIVE_SOURCE_IMPACT="+JSON.stringify({
    impactedRoutes:impacted.length,held:WAGE_SOURCE_HELD_METHODS.length,
    uncoveredCovered:uncovered.length,unresolved:unresolved.slice(0,30),
    dynamic:[...new Set(dynamic)].slice(0,30),impacted,
  }));
  assert.deepEqual(unresolved,[],"Fail closed: internal runtime import cannot be resolved");
  assert.deepEqual(uncovered,[],"A COVERED method imports a changed wage source indirectly without new proof or explicit HOLD");
});
