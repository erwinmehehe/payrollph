import { createHash } from "node:crypto";
import { parseDemandImport, type DemandImport } from "./workforce-operational-demand-import";
import { receiptPilotAllowed, validReceiptId } from "./workforce-schedule-receipt";
import { criticalReleaseFlagEnabled } from "./critical-release-flags";

const API_ROOT = "https://api.loyverse.com/v1.0";
const DAY = 86_400_000;
const MAX_PAGES = 12;
const PAGE_SIZE = 250;
const MAX_BYTES = 2_000_000;
const TOKEN_LIMIT = 2048;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CALENDAR = /^\d{4}-\d{2}-\d{2}$/;
// Provider timestamps must carry an explicit UTC offset; Date.parse of a bare
// local time depends on the server timezone and can silently shift POS bins.
const PROVIDER_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
export const LOYVERSE_WFM_SOURCE = "loyverse_pos_sales";
export type LoyverseSyncRequest = {
  organizationId: number;
  worksiteId: number;
  workDate: string;
  intervalMinutes: 15 | 30 | 60;
  dryRun: boolean;
  acknowledged: true;
};
export type LoyverseDayAggregate = {
  source: "loyverse_pos_sale_receipts";
  workDate: string;
  intervalMinutes: 15 | 30 | 60;
  counts: number[];
  countedSales: number;
  scannedReceipts: number;
  pages: number;
  observedAsOf: string;
  quality: "complete";
  boundary: string;
};
export class LoyverseSourceError extends Error {
  constructor(public readonly code:
    "SOURCE_SCOPE" | "SOURCE_REVIEW" | "SOURCE_UNAVAILABLE" | "SOURCE_RATE_LIMITED") {
    super("Authorized POS receipt scan is incomplete, unavailable, or outside the configured worksite.");
  }
}
const obj = (x: unknown): x is Record<string,unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);
const exact = (x:Record<string,unknown>,keys:string[]) =>
  Object.keys(x).length === keys.length &&
  keys.every(k=>Object.prototype.hasOwnProperty.call(x,k));
const isDay = (x:unknown):x is string => {
  if(typeof x!=="string" || !CALENDAR.test(x))return false;
  const n=Date.parse(x+"T00:00:00Z");
  return Number.isFinite(n) && new Date(n).toISOString().slice(0,10)===x;
};
const validStore = (x:unknown):x is string => typeof x==="string" &&
  UUID.test(x);
const iso = (ms:number)=>new Date(ms).toISOString();
function explicitProviderTime(value:unknown):value is string {
  if(typeof value!=="string")return false;
  const match=PROVIDER_TIME.exec(value);
  if(!match)return false;
  const parsed=Date.parse(value);
  if(!Number.isFinite(parsed))return false;
  const zone=match[2];
  let minutes=0;
  if(zone!=="Z"){
    const hours=Number(zone.slice(1,3)),mins=Number(zone.slice(4,6));
    if(hours>14||mins>59||(hours===14&&mins!==0))return false;
    minutes=(zone[0]==="+"?1:-1)*(hours*60+mins);
  }
  // Verify the provider's local calendar fields rather than accepting JS
  // rollover dates such as September 31 as October 1.
  return new Date(parsed+minutes*60_000).toISOString().slice(0,19)===match[1];
}
/**
 * The aggregate import is committed and audited in its own SQL transaction.
 * Failure to record a separate scan-freshness receipt must not falsely report
 * the already-committed aggregate import as rejected.
 */
export async function recordLoyverseScanConfirmation(
  write:()=>Promise<unknown>,
):Promise<boolean>{
  try {await write();return true;}
  catch {return false;}
}
export function parseLoyverseSyncRequest(input:unknown):LoyverseSyncRequest {
  if(!obj(input)||!exact(input,[
    "organizationId","worksiteId","workDate","intervalMinutes","dryRun","acknowledged",
  ]) || !validReceiptId(input.organizationId) || !validReceiptId(input.worksiteId) ||
    !isDay(input.workDate) || ![15,30,60].includes(input.intervalMinutes as number) ||
    typeof input.dryRun!=="boolean" || input.acknowledged!==true) {
    throw new Error("Exact historical Philippine date, scoped worksite and explicit consent acknowledgement required.");
  }
  return input as LoyverseSyncRequest;
}
export function loyversePilotEnabled(
  organizationId: number,
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return criticalReleaseFlagEnabled("wfmLoyversePos", env) &&
    receiptPilotAllowed(organizationId,
      env.WFM_LOYVERSE_POS_ENABLED,
      env.WFM_LOYVERSE_POS_ALLOWED_ORGANIZATION_IDS);
}
/** A separate OAuth grant must be provisioned by the actual merchant outside the app. */
export function loyverseConnection(org:number,site:number) {
  if(!loyversePilotEnabled(org) ||
    String(org)!==process.env.WFM_LOYVERSE_POS_ORGANIZATION_ID ||
    String(site)!==process.env.WFM_LOYVERSE_POS_WORKSITE_ID ||
    process.env.WFM_LOYVERSE_MERCHANT_CONSENT_RECORDED!=="true" ||
    process.env.WFM_LOYVERSE_AUTH_MODE!=="oauth_receipts_read" ||
    process.env.WFM_LOYVERSE_GRANTED_SCOPES!=="RECEIPTS_READ STORES_READ")return null;
  const token=process.env.WFM_LOYVERSE_ACCESS_TOKEN;
  const storeId=process.env.WFM_LOYVERSE_STORE_ID;
  if(!token || token.length<16 || token.length>TOKEN_LIMIT ||
    !validStore(storeId))return null;
  return {accessToken:token,storeId};
}
/**
 * Include seven days of future *creation* time to see late-sync POS receipts
 * whose receipt_date falls on the selected work date.
 * Still not a provider-certified finality guarantee.
 */
export function loyverseReceiptWindow(workDate:string,now:Date=new Date()) {
  if(!isDay(workDate) || !Number.isFinite(now.getTime())) {
    throw new LoyverseSourceError("SOURCE_SCOPE");
  }
  const start=Date.parse(workDate+"T00:00:00+08:00");
  const end=start+DAY;
  const createdThrough=end+7*DAY;
  if(createdThrough>now.getTime() || start<now.getTime()-365*DAY) {
    throw new LoyverseSourceError("SOURCE_SCOPE");
  }
  return {start,end,createdThrough};
}
async function providerJson(request:typeof fetch, url:string, token:string):Promise<Record<string,unknown>> {
  let response:Response;
  try {
    response=await request(url,{
      method:"GET",
      headers:{Authorization:"Bearer "+token,Accept:"application/json"},
      signal:AbortSignal.timeout(8000),cache:"no-store",redirect:"error",
    });
  }catch {
    throw new LoyverseSourceError("SOURCE_UNAVAILABLE");
  }
  if(response.status===429)throw new LoyverseSourceError("SOURCE_RATE_LIMITED");
  if(!response.ok)throw new LoyverseSourceError("SOURCE_UNAVAILABLE");
  const declared=Number(response.headers.get("content-length")??0);
  if(!Number.isFinite(declared)||declared>MAX_BYTES)throw new LoyverseSourceError("SOURCE_REVIEW");
  // Do not buffer an untrusted upstream response before checking its size.
  // Content-Length can be absent or false; enforce the same cap while reading.
  if(!response.body)throw new LoyverseSourceError("SOURCE_REVIEW");
  const reader=response.body.getReader();
  let data:unknown;
  const chunks:Uint8Array[]=[];
  let bytes=0;
  try {
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>MAX_BYTES){
        await reader.cancel().catch(()=>{});
        throw Error("oversized");
      }
      chunks.push(value);
    }
    data=JSON.parse(Buffer.concat(chunks,bytes).toString("utf8"));
  }catch {
    throw new LoyverseSourceError("SOURCE_REVIEW");
  }finally {
    reader.releaseLock();
  }
  if(!obj(data)||("errors" in data && (!Array.isArray(data.errors) ||
    data.errors.length>0)))throw new LoyverseSourceError("SOURCE_REVIEW");
  return data;
}
export async function readLoyversePosDay(input:{
  accessToken:string;storeId:string;workDate:string;
  intervalMinutes:15|30|60; now?:Date; request?:typeof fetch;
}):Promise<LoyverseDayAggregate> {
  const now=input.now??new Date();
  const {start,end,createdThrough}=loyverseReceiptWindow(input.workDate,now);
  if(!validStore(input.storeId)||typeof input.accessToken!=="string"||
    input.accessToken.length<16||input.accessToken.length>TOKEN_LIMIT||
    ![15,30,60].includes(input.intervalMinutes)){
    throw new LoyverseSourceError("SOURCE_SCOPE");
  }
  const request=input.request??fetch;
  // Verify the token can enumerate exactly the merchant-consented store,
  // with Philippine location. Never trust a browser-supplied store identity.
  const storeURL=new URL(API_ROOT+"/stores");
  storeURL.searchParams.set("store_ids",input.storeId);
  storeURL.searchParams.set("limit","1");
  const storePage=await providerJson(request,storeURL.toString(),input.accessToken);
  if(!Array.isArray(storePage.stores)||storePage.stores.length!==1||
    !obj(storePage.stores[0])||storePage.stores[0].id!==input.storeId||
    !["PH","PHILIPPINES"].includes(String(storePage.stores[0].country??"").trim().toUpperCase()) ||
    (storePage.stores[0].deleted_at!==undefined && storePage.stores[0].deleted_at!==null)){
    throw new LoyverseSourceError("SOURCE_SCOPE");
  }
  const counts=new Array<number>(1440/input.intervalMinutes).fill(0);
  const seen=new Map<string,string>();
  const cursors=new Set<string>();
  let next:string|null=null;
  let pages=0,counted=0,scanned=0;
  do {
    if(pages>=MAX_PAGES)throw new LoyverseSourceError("SOURCE_REVIEW");
    const url=new URL(API_ROOT+"/receipts");
    url.searchParams.set("store_id",input.storeId);
    url.searchParams.set("source","point of sale");
    url.searchParams.set("created_at_min",iso(start));
    url.searchParams.set("created_at_max",iso(createdThrough));
    url.searchParams.set("limit",String(PAGE_SIZE));
    if(next)url.searchParams.set("cursor",next);
    const page=await providerJson(request,url.toString(),input.accessToken);
    if(!Array.isArray(page.receipts)||page.receipts.length>PAGE_SIZE){
      throw new LoyverseSourceError("SOURCE_REVIEW");
    }
    for(const value of page.receipts) {
      if(!obj(value) || typeof value.receipt_number!=="string" ||
        value.receipt_number.length<1 || value.receipt_number.length>128 ||
        value.store_id!==input.storeId ||
        typeof value.created_at!=="string" || typeof value.receipt_date!=="string" ||
        !explicitProviderTime(value.created_at) ||
        !explicitProviderTime(value.receipt_date) ||
        !["SALE","REFUND"].includes(String(value.receipt_type)) ||
        value.source!=="point of sale" ||
        (value.cancelled_at!==undefined && value.cancelled_at!==null &&
          (typeof value.cancelled_at!=="string" ||
            !explicitProviderTime(value.cancelled_at)))) {
        throw new LoyverseSourceError("SOURCE_REVIEW");
      }
      const created=Date.parse(value.created_at);
      if(created<start || created>createdThrough)throw new LoyverseSourceError("SOURCE_REVIEW");
      const occured=Date.parse(value.receipt_date);
      if(occured>created)throw new LoyverseSourceError("SOURCE_REVIEW");
      const id=value.receipt_number;
      const digest=createHash("sha256").update(JSON.stringify([
        value.receipt_type,value.store_id,value.source,
        value.created_at,value.receipt_date,value.cancelled_at??null,
      ])).digest("hex");
      if(seen.has(id)) {
        if(seen.get(id)!==digest)throw new LoyverseSourceError("SOURCE_REVIEW");
        continue;
      }
      seen.set(id,digest);scanned++;
      if(occured<start||occured>=end||value.receipt_type!=="SALE"||
        value.cancelled_at!=null)continue;
      const bucket=Math.floor((occured-start)/(input.intervalMinutes*60_000));
      if(bucket<0||bucket>=counts.length)throw new LoyverseSourceError("SOURCE_REVIEW");
      counts[bucket]++;
      if(counts[bucket]>1_000_000)throw new LoyverseSourceError("SOURCE_REVIEW");
      counted++;
    }
    pages++;
    const cursor=page.cursor;
    if(cursor!==undefined&&cursor!==null &&
      (typeof cursor!=="string" || cursor.length>512)){
      throw new LoyverseSourceError("SOURCE_REVIEW");
    }
    next=typeof cursor==="string"&&cursor.length>0?cursor:null;
    if(next){
      if(cursors.has(next))throw new LoyverseSourceError("SOURCE_REVIEW");
      cursors.add(next);
    }
  }while(next);
  return {
    source:"loyverse_pos_sale_receipts",workDate:input.workDate,
    intervalMinutes:input.intervalMinutes,counts,
    countedSales:counted,scannedReceipts:scanned,pages,
    observedAsOf:now.toISOString(),quality:"complete",
    boundary:"Loyverse source-reported POS SALE receipts by receipt_date, including late-sync receipts " +
      "created within seven days after the PH work date. Only completed pages are accepted. " +
      "REFUND and canceled receipts are excluded; refunds do not subtract earlier sales. " +
      "Provider may later amend receipts or sync transactions outside the lookahead. " +
      "These are not provider-certified final receipts, BIR evidence, customer counts, " +
      "net sales, payroll data, or authorization to schedule workers.",
  };
}
/** Return only changed interval revisions; unchanged scans are not rewritten. */
export function prepareLoyverseRevisions(input:{
  aggregate:LoyverseDayAggregate; organizationId:number;worksiteId:number;
  existing:readonly {intervalStart:Date|string;revision:number;
    observedCount:number;quality:string}[];now?:Date;
}):{batch:DemandImport|null;changed:number;unchanged:number}{
  const a=input.aggregate;
  if(a.source!=="loyverse_pos_sale_receipts"||!isDay(a.workDate)||
    ![15,30,60].includes(a.intervalMinutes)||a.quality!=="complete"||
    !Array.isArray(a.counts)||a.counts.length!==1440/a.intervalMinutes||
    !a.counts.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1_000_000)){
    throw new LoyverseSourceError("SOURCE_REVIEW");
  }
  const prior=new Map<string,{revision:number;observedCount:number;quality:string}>();
  for(const row of input.existing) {
    const stamp=row.intervalStart instanceof Date
      ?row.intervalStart.toISOString():row.intervalStart;
    if(!Number.isFinite(Date.parse(stamp))||!Number.isSafeInteger(row.revision)||
      row.revision<1||row.revision>1000||
      !Number.isSafeInteger(row.observedCount)||row.observedCount<0||
      !["complete","partial","unverified"].includes(row.quality)){
      throw new LoyverseSourceError("SOURCE_REVIEW");
    }
    const old=prior.get(stamp);
    if(!old||row.revision>old.revision)prior.set(stamp,row);
  }
  const {start}=loyverseReceiptWindow(a.workDate,input.now??new Date());
  const rows=[];
  for(let i=0;i<a.counts.length;i++){
    const stamp=iso(start+i*a.intervalMinutes*60_000);
    const old=prior.get(stamp);
    if(old&&old.observedCount===a.counts[i]&&old.quality==="complete")continue;
    if(old&&old.revision>=1000)throw new LoyverseSourceError("SOURCE_REVIEW");
    const mins=i*a.intervalMinutes;
    const hh=String(Math.floor(mins/60)).padStart(2,"0");
    const mm=String(mins%60).padStart(2,"0");
    rows.push({
      intervalStart:a.workDate+"T"+hh+":"+mm+":00+08:00",
      observedCount:a.counts[i],quality:"complete" as const,
      revision:(old?.revision??0)+1,
    });
  }
  if(!rows.length)return {batch:null,changed:0,unchanged:a.counts.length};
  const sha=createHash("sha256").update(JSON.stringify({
    organizationId:input.organizationId,worksiteId:input.worksiteId,
    workDate:a.workDate,intervalMinutes:a.intervalMinutes,rows,
  })).digest("hex");
  const batch=parseDemandImport({
    organizationId:input.organizationId,worksiteId:input.worksiteId,
    sourceKey:LOYVERSE_WFM_SOURCE,metricKind:"transactions",
    intervalMinutes:a.intervalMinutes,
    idempotencyKey:"lvpos_"+sha.slice(0,48),
    acknowledged:true,rows,
  },input.now??new Date());
  return {batch,changed:rows.length,unchanged:a.counts.length-rows.length};
}