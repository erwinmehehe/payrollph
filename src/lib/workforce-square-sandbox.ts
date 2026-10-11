import { createHash } from "node:crypto";
import { parseDemandImport, type DemandImport, type DemandQuality } from "./workforce-operational-demand-import";
import { receiptPilotAllowed, validReceiptId } from "./workforce-schedule-receipt";

const DAY = 86_400_000;
const SLOT = 60_000;
const MAX_PAGES = 10;
const MAX_BODY_BYTES = 1_000_000;
const SQUARE_BASE = "https://connect.squareupsandbox.com/v2/payments";
export const SQUARE_SANDBOX_VERSION = "2026-09-16";
export const SQUARE_SANDBOX_SOURCE = "square_sandbox_payments";
const PH_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SQUARE_LOCATION = /^[a-zA-Z0-9_-]{4,64}$/;

export class SquareDemandSourceError extends Error {
  constructor(readonly code:
    "SOURCE_REVIEW"|"SOURCE_UNAVAILABLE"|"SOURCE_RATE_LIMITED"|"SOURCE_SCOPE") {
    super("Sandbox payment source is unavailable, incomplete or not verified for this exact worksite.");
  }
}
export type SquareDemandSyncRequest = {
  organizationId: number; worksiteId: number; workDate: string;
  intervalMinutes: 15|30|60; dryRun: boolean; acknowledged: true;
};
export type SquareDayAggregate = {
  source: "square_sandbox_completed_payments";
  workDate: string; intervalMinutes: 15|30|60;
  counts: number[];
  quality: DemandQuality;
  completedPayments: number;
  pages: number;
  observedAsOf: string;
  boundary: string;
};
type Payment = Record<string,unknown>;
const record = (x:unknown):x is Record<string,unknown> =>
  x!==null && typeof x==="object" && !Array.isArray(x);
const date = (x:unknown): x is string => {
  if (typeof x!=="string" || !PH_DAY.test(x)) return false;
  const parsed=Date.parse(x+"T00:00:00Z");
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0,10)===x;
};
export function parseSquareDemandSync(input:unknown):SquareDemandSyncRequest {
  if(!record(input) || Object.keys(input).length!==6 ||
    !["organizationId","worksiteId","workDate","intervalMinutes","dryRun","acknowledged"]
      .every(k=>Object.prototype.hasOwnProperty.call(input,k)) ||
    !validReceiptId(input.organizationId)||!validReceiptId(input.worksiteId)||
    !date(input.workDate)||![15,30,60].includes(input.intervalMinutes as number)||
    typeof input.dryRun!=="boolean"||input.acknowledged!==true) {
    throw new Error("Exact historical Philippine date, scoped worksite and explicit dry-run/import acknowledgment required.");
  }
  return input as SquareDemandSyncRequest;
}
export function squareSandboxPilotAllowed(org:number) {
  return receiptPilotAllowed(org,
    process.env.WFM_SQUARE_SANDBOX_ENABLED,
    process.env.WFM_SQUARE_SANDBOX_ALLOWED_ORGANIZATION_IDS,
  );
}
export function squareSandboxConnection(org:number,site:number) {
  if (!squareSandboxPilotAllowed(org) ||
    String(org)!==process.env.WFM_SQUARE_SANDBOX_ORGANIZATION_ID ||
    String(site)!==process.env.WFM_SQUARE_SANDBOX_WORKSITE_ID ||
    process.env.WFM_SQUARE_SANDBOX_CONSENT_ACKNOWLEDGED!=="true") return null;
  const token=process.env.WFM_SQUARE_SANDBOX_ACCESS_TOKEN;
  const locationId=process.env.WFM_SQUARE_SANDBOX_LOCATION_ID;
  if (!token || token.length<12 || token.length>2048 ||
    !locationId || !SQUARE_LOCATION.test(locationId)) return null;
  return {accessToken:token,locationId};
}
export function squareDayWindow(workDate:string,now:Date=new Date()) {
  if (!date(workDate) || !Number.isFinite(now.getTime())) {
    throw new SquareDemandSourceError("SOURCE_SCOPE");
  }
  const start=Date.parse(workDate+"T00:00:00+08:00");
  const end=start+DAY;
  // Square lists are eventually consistent, and offline payments can appear
  // later. Enforce a 7-day cooling interval; repeat full-day scans for revisions.
  if (end>now.getTime()-7*DAY || start<now.getTime()-365*DAY) {
    throw new SquareDemandSourceError("SOURCE_SCOPE");
  }
  return {start,end};
}
export async function readSquareSandboxDay(input:{
  accessToken:string;locationId:string;workDate:string;
  intervalMinutes:15|30|60; now?:Date; request?:typeof fetch;
}):Promise<SquareDayAggregate> {
  const now=input.now??new Date();
  const {start,end}=squareDayWindow(input.workDate,now);
  if(!SQUARE_LOCATION.test(input.locationId) || input.accessToken.length<12 ||
    ![15,30,60].includes(input.intervalMinutes)) {
    throw new SquareDemandSourceError("SOURCE_SCOPE");
  }
  const values=new Array<number>(1440/input.intervalMinutes).fill(0);
  const observed=new Map<string,string>();
  const cursors=new Set<string>();
  const request=input.request??fetch;
  let cursor:string|null=null, completed=0, page=0;
  do {
    if(page>=MAX_PAGES)throw new SquareDemandSourceError("SOURCE_REVIEW");
    const url=new URL(SQUARE_BASE);
    url.searchParams.set("begin_time",new Date(start).toISOString());
    url.searchParams.set("end_time",new Date(end).toISOString());
    url.searchParams.set("location_id",input.locationId);
    url.searchParams.set("sort_field","CREATED_AT");
    url.searchParams.set("sort_order","ASC");
    url.searchParams.set("limit","100");
    if(cursor)url.searchParams.set("cursor",cursor);
    let result:Response;
    try {
      result=await request(url.toString(),{
        method:"GET",
        headers:{
          Authorization:"Bearer "+input.accessToken,
          "Square-Version":SQUARE_SANDBOX_VERSION,
          Accept:"application/json",
        },
        signal:AbortSignal.timeout(8000),
        cache:"no-store",
      });
    }catch{
      throw new SquareDemandSourceError("SOURCE_UNAVAILABLE");
    }
    if(result.status===429)throw new SquareDemandSourceError("SOURCE_RATE_LIMITED");
    if(!result.ok)throw new SquareDemandSourceError("SOURCE_UNAVAILABLE");
    const length=Number(result.headers.get("content-length")??0);
    if(!Number.isFinite(length)||length>MAX_BODY_BYTES)throw new SquareDemandSourceError("SOURCE_REVIEW");
    let body:unknown;
    try {
      const raw=await result.text();
      if(raw.length>MAX_BODY_BYTES)throw Error("Oversized provider response");
      body=JSON.parse(raw);
    }catch{
      throw new SquareDemandSourceError("SOURCE_REVIEW");
    }
    if(!record(body)||("errors" in body && (!Array.isArray(body.errors) ||
        body.errors.length>0)) ||
      (body.payments!==undefined && !Array.isArray(body.payments)) ||
      (Array.isArray(body.payments) && body.payments.length>100)) {
      throw new SquareDemandSourceError("SOURCE_REVIEW");
    }
    for(const raw of (body.payments as unknown[]|undefined)??[]) {
      if(!record(raw)||typeof raw.id!=="string"||raw.id.length<4||
        raw.id.length>256||raw.location_id!==input.locationId||
        typeof raw.created_at!=="string" || !Number.isFinite(Date.parse(raw.created_at)) ||
        !["COMPLETED","APPROVED","PENDING","CANCELED","FAILED"].includes(String(raw.status))) {
        throw new SquareDemandSourceError("SOURCE_REVIEW");
      }
      const payment=raw as Payment;
      const stamp=Date.parse(payment.created_at as string);
      const memo=[String(payment.created_at),String(payment.status),String(payment.location_id)].join("|");
      const id=payment.id as string;
      if(observed.has(id)) {
        if(observed.get(id)!==memo)throw new SquareDemandSourceError("SOURCE_REVIEW");
        continue;
      }
      observed.set(id,memo);
      // Square endpoint time boundaries can be inclusive; enforce half-open locally.
      if(stamp<start||stamp>=end||payment.status!=="COMPLETED")continue;
      const index=Math.floor((stamp-start)/(input.intervalMinutes*SLOT));
      if(index<0||index>=values.length)throw new SquareDemandSourceError("SOURCE_REVIEW");
      values[index]++;
      if(values[index]>1_000_000)throw new SquareDemandSourceError("SOURCE_REVIEW");
      completed++;
    }
    const next=body.cursor;
    if(next!==undefined && (typeof next!=="string" || next.length>2048)) {
      throw new SquareDemandSourceError("SOURCE_REVIEW");
    }
    cursor=typeof next==="string"&&next.length>0?next:null;
    if(cursor){if(cursors.has(cursor))throw new SquareDemandSourceError("SOURCE_REVIEW");
      cursors.add(cursor);}
    page++;
  } while(cursor);
  return {
    source:"square_sandbox_completed_payments",
    workDate:input.workDate,intervalMinutes:input.intervalMinutes,
    counts:values,quality:"complete",completedPayments:completed,pages:page,
    observedAsOf:now.toISOString(),
    boundary:"Fully paginated Square SANDBOX completed-payment count by payment.created_at for an exact location, " +
      "reported after a seven-day cooling window. Complete means this point-in-time API scan finished, " +
      "not that Square certifies permanent completeness. Refunds, offline uploads, later status changes " +
      "and non-POS Square payments can change counts. Never identify this as net orders, customers, revenue, " +
      "independently reconciled transactions or a payroll/scheduling authorization.",
  };
}
export function selectSquareDemandRevisions(input:{
  aggregate:SquareDayAggregate; organizationId:number;worksiteId:number;
  existing:readonly {intervalStart:Date|string;revision:number;
    observedCount:number;quality:string}[];now?:Date;
}):{ batch:DemandImport|null; changedIntervals:number; unchangedIntervals:number } {
  const a=input.aggregate;
  if(a.source!=="square_sandbox_completed_payments"||!date(a.workDate)||
    ![15,30,60].includes(a.intervalMinutes) ||
    !Array.isArray(a.counts)||a.counts.length!==1440/a.intervalMinutes||
    a.quality!=="complete"||
    !a.counts.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1_000_000)) {
    throw new SquareDemandSourceError("SOURCE_REVIEW");
  }
  const previous=new Map<string,{revision:number;observedCount:number;quality:string}>();
  for(const row of input.existing) {
    const instant=row.intervalStart instanceof Date
      ?row.intervalStart.toISOString():row.intervalStart;
    if(!Number.isFinite(Date.parse(instant))||!Number.isSafeInteger(row.revision)||
      row.revision<1||row.revision>1000)throw new SquareDemandSourceError("SOURCE_REVIEW");
    const old=previous.get(instant);
    if(!old||row.revision>old.revision)previous.set(instant,row);
  }
  const rows=[];
  const {start}=squareDayWindow(a.workDate,input.now??new Date());
  for(let i=0;i<a.counts.length;i++){
    const iso=new Date(start+i*a.intervalMinutes*SLOT).toISOString();
    const old=previous.get(iso);
    if(old && old.observedCount===a.counts[i]&&old.quality===a.quality)continue;
    if(old && old.revision>=1000)throw new SquareDemandSourceError("SOURCE_REVIEW");
    const hh=String(Math.floor(i*a.intervalMinutes/60)).padStart(2,"0");
    const mm=String((i*a.intervalMinutes)%60).padStart(2,"0");
    rows.push({
      intervalStart:`${a.workDate}T${hh}:${mm}:00+08:00`,
      observedCount:a.counts[i],quality:a.quality,
      revision:(old?.revision??0)+1,
    });
  }
  if(rows.length===0)return {batch:null,changedIntervals:0,unchangedIntervals:a.counts.length};
  const sha=createHash("sha256").update(JSON.stringify({
    organizationId:input.organizationId,worksiteId:input.worksiteId,
    workDate:a.workDate,metricKind:"transactions",intervalMinutes:a.intervalMinutes,
    rows,
  })).digest("hex");
  const batch=parseDemandImport({
    organizationId:input.organizationId,worksiteId:input.worksiteId,
    sourceKey:SQUARE_SANDBOX_SOURCE,
    metricKind:"transactions",intervalMinutes:a.intervalMinutes,
    idempotencyKey:"sqsb_"+sha.slice(0,48),
    acknowledged:true,rows,
  },input.now??new Date());
  return {
    batch,changedIntervals:rows.length,
    unchangedIntervals:a.counts.length-rows.length,
  };
}
