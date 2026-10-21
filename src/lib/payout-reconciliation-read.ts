import type { PayrollPayoutState } from "./payroll-payout-state";
/**
 * A success status or parsed audit metadata alone never certifies a payout.
 * Client presentation is read-only: this validator cannot authorize money movement.
 */
export type PayoutReadScope = {organizationId:number;runId:number;netPay:string;employeeCount:number};
export type VerifiedPayoutRead = PayrollPayoutState & {
  organizationId:number;runId:number;runNetPay:string;runEmployeeCount:number;periodLabel:string;
};
const rec=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const id=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>0;
const count=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
const nilText=(v:unknown)=>v===null||typeof v==="string";
const text=(v:unknown)=>typeof v==="string"&&v.length>0;
const cents=(v:unknown):number|null=> {
  if(typeof v!=="string"||!/^\d{1,12}(?:\.\d{1,2})?$/.test(v))return null;
  const amount=Math.round(Number(v)*100);
  return Number.isSafeInteger(amount)?amount:null;
};
const oneOf=(v:unknown,values:readonly string[])=>typeof v==="string"&&values.includes(v);
const stat=["pending","succeeded","failed","unknown"] as const;
function receiptTransfer(row:unknown):boolean {
  return rec(row)&&text(row.batchId)&&text(row.transferId)&&
    text(row.referenceNumber)&&text(row.employeeNo)&&oneOf(row.status,stat)&&
    count(row.amountCents)&&nilText(row.providerReferenceNumber)&&
    (row.providerError===undefined||nilText(row.providerError))&&
    (row.providerErrorCode===undefined||nilText(row.providerErrorCode));
}
function transfer(row:unknown):boolean {
  if(!rec(row))return false;
  return nilText(row.batchId)&&text(row.transferId)&&text(row.referenceNumber)&&
    text(row.employeeNo)&&oneOf(row.status,stat)&&count(row.amountCents)&&
    nilText(row.providerReferenceNumber)&&nilText(row.providerError)&&
    nilText(row.providerErrorCode)&&nilText(row.occurredAt);
}
export function isVerifiedPayoutRead(value:unknown,expected:PayoutReadScope):value is VerifiedPayoutRead {
  if(!id(expected.organizationId)||!id(expected.runId)||!count(expected.employeeCount)||
    cents(expected.netPay)===null||!rec(value)||value.organizationId!==expected.organizationId||
    value.runId!==expected.runId||value.runEmployeeCount!==expected.employeeCount||
    cents(value.runNetPay)!==cents(expected.netPay)||!text(value.periodLabel)||
    !rec(value.release)||!rec(value.bankFile)||!rec(value.payout)||!rec(value.reconciliation))return false;
  const a=value.release,b=value.bankFile,p=value.payout,c=value.reconciliation;
  if(typeof a.done!=="boolean"||!nilText(a.at)||
    !oneOf(b.status,["waiting","generated"])||!nilText(b.filename)||
    !nilText(b.template)||!nilText(b.generatedAt)||
    !oneOf(p.status,["awaiting-preflight","ready","submitted","completed"])||
    !text(p.label)||!nilText(p.reference)||!nilText(p.method)||!nilText(p.completedAt)||
    !(c.provider===null||c.provider==="PayMongo")||
    !oneOf(c.status,["not-applicable","awaiting-check","pending","attention","settled"])||
    !Array.isArray(c.batchIds)||!c.batchIds.every(text)||
    ![c.total,c.succeeded,c.pending,c.failed,c.unknown].every(count)||
    !nilText(c.checkedAt)||typeof c.canRetryFailed!=="boolean"||
    typeof c.settlementRegressed!=="boolean"||
    !Array.isArray(c.transfers)||!c.transfers.every(transfer))return false;
  const total=c.total as number, succeeded=c.succeeded as number,
    pending=c.pending as number, failed=c.failed as number, unknown=c.unknown as number;
  // Missing transfer rows cannot be converted into provider-pending totals.
  if(succeeded+pending+failed+unknown!==total ||
    c.transfers.length!==total || (c.provider==="PayMongo" && total===0) ||
    (c.canRetryFailed && failed===0))return false;
  const rows=c.transfers as Array<{status:string;referenceNumber:string;transferId:string}>;
  if(new Set(rows.map(row=>row.referenceNumber)).size!==rows.length||
    new Set(rows.map(row=>row.transferId)).size!==rows.length)return false;
  for(const s of ["succeeded","failed","unknown"]){
    if(rows.filter(row=>row.status===s).length!==(c[s] as number))return false;
  }
  if(rows.filter(row=>row.status==="pending").length!==pending)return false;
  if(c.status==="settled" && (total===0||succeeded!==total||failed!==0||unknown!==0))return false;
  if(c.provider===null && (c.status!=="not-applicable"||total!==0||rows.length!==0))return false;
  return true;
}
export async function readVerifiedPayout(
  expected:PayoutReadScope,fetcher:typeof fetch=fetch,signal?:AbortSignal,
):Promise<VerifiedPayoutRead> {
  if(!id(expected.runId)||!id(expected.organizationId))throw Error("Payout reconciliation unavailable.");
  const response=await fetcher("/api/payroll-runs/"+expected.runId+"/payout-reconciliation?view=payout",{cache:"no-store",signal});
  if(!response.ok)throw Error("Payout reconciliation unavailable. Retry.");
  let body:unknown;
  try{body=await response.json();}catch{throw Error("Payout reconciliation unreadable. Retry.");}
  if(!isVerifiedPayoutRead(body,expected))throw Error("Payout reconciliation incomplete or for a different employer. Retry.");
  return body;
}
/** POST acknowledgements cannot use missing counters to show an all-settled result. */
export function isVerifiedPayoutReconciliationReceipt(body:unknown,org:number,runId:number,retry:boolean):boolean {
  if(!rec(body)||body.organizationId!==org||body.runId!==runId||!rec(body.reconciliation))return false;
  const r=body.reconciliation;
  if(![r.total,r.succeeded,r.pending,r.failed,r.unknown].every(count)||
    !Array.isArray(r.transfers)||!r.transfers.every(receiptTransfer)||
    r.total!==r.transfers.length||
    (r.succeeded as number)+(r.pending as number)+(r.failed as number)+(r.unknown as number)!==r.total||
    typeof r.completed!=="boolean"||!Array.isArray(r.retryableReferences)||
    !r.retryableReferences.every(text))return false;
  const transfers=r.transfers as Array<{status:string}>;
  for(const s of stat)if(transfers.filter(row=>row.status===s).length!==r[s])return false;
  if(r.completed!==((r.total as number)>0&&r.succeeded===r.total))return false;
  if(retry)return body.retried===true&&body.failedOnly===true&&text(body.message);
  return text(body.checkedAt);
}
