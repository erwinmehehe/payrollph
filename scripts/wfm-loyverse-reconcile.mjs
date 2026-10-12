import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const invalid=()=>{throw Error("Invalid sanitized aggregate evidence: scope, interval or allowed fields differ.");};
const hash=(data)=>createHash("sha256").update(JSON.stringify(data)).digest("hex");
const shape=(obj,required,allowed=required)=>{
  if(!obj || typeof obj!=="object" || Array.isArray(obj) ||
    required.some(k=>!Object.prototype.hasOwnProperty.call(obj,k)) ||
    Object.keys(obj).some(k=>!allowed.includes(k)))invalid();
};
const day=(v)=>typeof v==="string" && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v+"T00:00:00Z")) &&
  new Date(Date.parse(v+"T00:00:00Z")).toISOString().slice(0,10)===v;
const ints=(v,n)=>Array.isArray(v) && v.length===1440/n &&
  v.every(x=>Number.isSafeInteger(x)&&x>=0&&x<=1_000_000);
const goodScope=(v)=>{
  shape(v,["organizationId","worksiteId"]);
  if(!Number.isSafeInteger(v.organizationId)||v.organizationId<1||
    !Number.isSafeInteger(v.worksiteId)||v.worksiteId<1)invalid();
};
/**
 * Strict sanitized interface. The operator MUST independently confirm that
 * the merchant report represents the exact physical store and gross POS sales
 * source; a matching pair of files does not attest consent or receipt finality.
 */
export function compareLoyverseAggregates(api,merchant){
  shape(api,["readOnly","applied","source","workDate","intervalMinutes",
    "scope","intervalCounts","countedSales","scannedReceipts",
    "scannedPages","changedIntervals","unchangedIntervals",
    "observedAsOf","boundary"]);
  shape(merchant,["source","scope","workDate","intervalMinutes",
    "intervalCounts","generatedAt"]);
  if(api.readOnly!==true||api.applied!==false||
    api.source!=="loyverse_pos_sales"||
    merchant.source!=="independent_loyverse_backoffice_aggregate"||
    !day(api.workDate)||api.workDate!==merchant.workDate||
    ![15,30,60].includes(api.intervalMinutes)||
    api.intervalMinutes!==merchant.intervalMinutes||
    !ints(api.intervalCounts,api.intervalMinutes)||
    !ints(merchant.intervalCounts,merchant.intervalMinutes))invalid();
  goodScope(api.scope);goodScope(merchant.scope);
  if(api.scope.organizationId!==merchant.scope.organizationId ||
    api.scope.worksiteId!==merchant.scope.worksiteId)invalid();
  if(!Number.isSafeInteger(api.countedSales)||api.countedSales<0||
    api.countedSales!==api.intervalCounts.reduce((a,b)=>a+b,0) ||
    !Number.isSafeInteger(api.scannedReceipts) ||
    api.scannedReceipts<api.countedSales||
    !Number.isSafeInteger(api.scannedPages)||api.scannedPages<1||
    typeof api.boundary!=="string" ||
    !Number.isFinite(Date.parse(api.observedAsOf)) ||
    !Number.isFinite(Date.parse(merchant.generatedAt)))invalid();
  const differences=[];
  for(let i=0;i<api.intervalCounts.length;i++){
    const predicted=api.intervalCounts[i], independentlyReported=merchant.intervalCounts[i];
    if(predicted===independentlyReported)continue;
    const startMinute=i*api.intervalMinutes;
    differences.push({
      intervalIndex:i,
      phLocalTime:String(Math.floor(startMinute/60)).padStart(2,"0")+":"+
        String(startMinute%60).padStart(2,"0"),
      apiCount:predicted,independentReportCount:independentlyReported,
      difference:predicted-independentlyReported,
    });
  }
  const apiSum=api.countedSales;
  const merchantSum=merchant.intervalCounts.reduce((a,b)=>a+b,0);
  return {
    status:differences.length===0?"count_match_unattested":"count_mismatch_review_required",
    workDate:api.workDate,intervalMinutes:api.intervalMinutes,
    apiTotal:apiSum,independentReportTotal:merchantSum,
    totalDifference:apiSum-merchantSum,
    mismatchedIntervals:differences.length,
    differences:differences.slice(0,25),
    truncatedDifferenceRows:Math.max(0,differences.length-25),
    sourceEvidenceSha256:hash({scope:api.scope,date:api.workDate,
      intervalMinutes:api.intervalMinutes,counts:api.intervalCounts,
      observedAsOf:api.observedAsOf}),
    merchantEvidenceSha256:hash({scope:merchant.scope,date:merchant.workDate,
      intervalMinutes:merchant.intervalMinutes,counts:merchant.intervalCounts,
      generatedAt:merchant.generatedAt}),
    humanSignoff:"NOT_EXECUTED",
    boundary:"Counts-only diagnostic. Merchant authorization, independent export provenance, " +
      "BIR posture, delayed source corrections, and human source-owner acceptance " +
      "are not validated by this comparison.",
  };
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==4){
    process.stderr.write("Usage: node scripts/wfm-loyverse-reconcile.mjs API_PREVIEW.json MERCHANT_AGGREGATES.json\n");
    process.exitCode=2;
  }else{
    try{
      const limits=[process.argv[2],process.argv[3]];
      const data=await Promise.all(limits.map(async file=>{
        const raw=await readFile(file,"utf8");
        if(Buffer.byteLength(raw)>65536)invalid();
        return JSON.parse(raw);
      }));
      const result=compareLoyverseAggregates(data[0],data[1]);
      process.stdout.write(JSON.stringify(result,null,2)+"\n");
      process.exitCode=result.mismatchedIntervals===0?0:1;
    }catch{
      process.stderr.write("Invalid or unavailable sanitized aggregate evidence. No reconciliation completed.\n");
      process.exitCode=2;
    }
  }
}