import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  readLoyversePosDay,prepareLoyverseRevisions,parseLoyverseSyncRequest,
  loyverseReceiptWindow,LoyverseSourceError,LOYVERSE_WFM_SOURCE,
  recordLoyverseScanConfirmation, loyversePilotEnabled,
} from "../src/lib/workforce-loyverse-pos";

test("Loyverse provider remains OFF unless the exact central flag and tenant allowlist both permit it", () => {
  const allowed = { WFM_LOYVERSE_POS_ALLOWED_ORGANIZATION_IDS: "101" };
  assert.equal(loyversePilotEnabled(101, allowed), false);
  assert.equal(loyversePilotEnabled(101, { ...allowed, WFM_LOYVERSE_POS_ENABLED: "TRUE" }), false);
  assert.equal(loyversePilotEnabled(102, { ...allowed, WFM_LOYVERSE_POS_ENABLED: "true" }), false);
  assert.equal(loyversePilotEnabled(101, { ...allowed, WFM_LOYVERSE_POS_ENABLED: "true" }), true);
});
const now=new Date("2026-10-12T00:00:00.000Z");
const day="2026-09-20";
const storeId="11111111-1111-4111-8111-111111111111";
const conf={accessToken:"synthetic-example-value",storeId,
  workDate:day,intervalMinutes:30 as const,now};
const ticket=(number:string,created:string,receiptDate:string,other:Record<string,unknown>={})=>({
  receipt_number:number,store_id:storeId,receipt_type:"SALE",created_at:created,
  receipt_date:receiptDate,source:"point of sale",cancelled_at:null,
  ...other,
});
function pages(list:Record<string,unknown>[],urls:string[]=[]):typeof fetch {
  let index=0;
  return (async(value:RequestInfo|URL,init?:RequestInit)=>{
    assert.equal(init?.method,"GET");
    assert.equal(init?.redirect,"error","Never forward bearer credentials to a redirected origin");
    const u=new URL(String(value));urls.push(u.toString());
    assert.equal(u.origin,"https://api.loyverse.com");
    if(u.pathname==="/v1.0/stores")return Response.json({
      stores:[{id:storeId,country:"PH",deleted_at:null}],
    });
    assert.equal(u.pathname,"/v1.0/receipts");
    assert.equal(u.searchParams.get("store_id"),storeId);
    assert.equal(u.searchParams.get("source"),"point of sale");
    assert.equal(u.searchParams.get("limit"),"250");
    return Response.json(list[index++]??{receipts:[]});
  }) as typeof fetch;
}
test("exact request, historical window and malformed calendar",()=>{
  const input={organizationId:101,worksiteId:202,workDate:day,intervalMinutes:30,
    dryRun:true,acknowledged:true};
  assert.deepEqual(parseLoyverseSyncRequest(input),input);
  assert.throws(()=>parseLoyverseSyncRequest({...input,workDate:"2026-09-31"}));
  assert.throws(()=>parseLoyverseSyncRequest({...input,customer:123}));
  assert.throws(()=>parseLoyverseSyncRequest({...input,acknowledged:false}));
  assert.equal(loyverseReceiptWindow(day,now).createdThrough-
    loyverseReceiptWindow(day,now).end,7*86_400_000);
  assert.throws(()=>loyverseReceiptWindow("2026-10-10",now));
});
test("PH receipt-date interval, late sync, refund and cancellation",async()=>{
  const urls:string[]=[];
  const aggregate=await readLoyversePosDay({...conf,request:pages([
    {receipts:[
      ticket("A1","2026-09-20T09:00:00+08:00","2026-09-20T09:00:00+08:00"),
      ticket("A2","2026-09-23T13:00:00+08:00","2026-09-20T13:00:00+08:00"),
      ticket("R3","2026-09-20T10:00:00+08:00","2026-09-20T10:00:00+08:00",
        {receipt_type:"REFUND"}),
    ],cursor:"next-page"},
    {receipts:[
      ticket("A2","2026-09-23T13:00:00+08:00","2026-09-20T13:00:00+08:00"),
      ticket("C4","2026-09-20T11:00:00+08:00","2026-09-20T11:00:00+08:00",
        {cancelled_at:"2026-09-24T11:00:00+08:00"}),
    ]},
  ],urls)});
  assert.equal(aggregate.pages,2);
  assert.equal(aggregate.scannedReceipts,4);
  assert.equal(aggregate.countedSales,2);
  assert.equal(aggregate.counts[18],1);
  assert.equal(aggregate.counts[26],1);
  assert.ok(urls[2].includes("cursor=next-page"));
  assert.ok(!JSON.stringify(aggregate).includes("A1"));
});
test("unchanged scans replay, corrections append a new interval revision",async()=>{
  const aggregate=await readLoyversePosDay({...conf,
    request:pages([{receipts:[
      ticket("V1","2026-09-20T09:00:00+08:00","2026-09-20T09:00:00+08:00"),
    ]}]),
  });
  const first=prepareLoyverseRevisions({aggregate,organizationId:101,
    worksiteId:202,existing:[],now});
  assert.equal(first.batch?.sourceKey,LOYVERSE_WFM_SOURCE);
  assert.equal(first.changed,48);
  const history=first.batch!.rows.map(row=>({
    intervalStart:new Date(row.intervalStart),revision:row.revision,
    observedCount:row.observedCount,quality:row.quality,
  }));
  assert.equal(prepareLoyverseRevisions({aggregate,organizationId:101,
    worksiteId:202,existing:history,now}).changed,0);
  const corrected={...aggregate,counts:aggregate.counts.map((v,i)=>i===18?0:v)};
  const second=prepareLoyverseRevisions({aggregate:corrected,organizationId:101,
    worksiteId:202,existing:history,now});
  assert.equal(second.changed,1);
  assert.equal(second.batch?.rows[0].revision,2);
  assert.equal(second.batch?.rows[0].observedCount,0);
});
test("wrong country, cursor loops and missing receipt pages fail closed",async()=>{
  await assert.rejects(readLoyversePosDay({...conf,request:pages([
    {receipts:[],cursor:"repeat"},{receipts:[],cursor:"repeat"},
  ])}),LoyverseSourceError);
  await assert.rejects(readLoyversePosDay({...conf,request:pages([
    {no_receipts:true},
  ])}),LoyverseSourceError);
  const badCountry=(async(u:RequestInfo|URL)=>{
    if(String(u).includes("/stores"))return Response.json({stores:[
      {id:storeId,country:"US"},
    ]});
    throw Error("No receipt query should occur");
  }) as typeof fetch;
  await assert.rejects(readLoyversePosDay({...conf,request:badCountry}),
    LoyverseSourceError);
});
test("rate-limited provider cannot become a complete zero-demand day",async()=>{
  const bad=(async()=>Response.json({},{status:429})) as typeof fetch;
  await assert.rejects(readLoyversePosDay({...conf,request:bad}),
    (e:unknown)=>e instanceof LoyverseSourceError&&e.code==="SOURCE_RATE_LIMITED");
});
test("provider-created and business-event timestamps require explicit ISO timezone", async()=>{
  const good=ticket("ZONED","2026-09-20T09:00:00+08:00",
    "2026-09-20T09:00:00+08:00");
  for(const field of ["created_at","receipt_date","cancelled_at"] as const){
    const bad={...good,[field]:"2026-09-20T09:00:00"};
    await assert.rejects(readLoyversePosDay({...conf,
      request:pages([{receipts:[bad]}])}),
    (e:unknown)=>e instanceof LoyverseSourceError&&e.code==="SOURCE_REVIEW",
    field+" without a timezone must not create an ambiguous PH work interval");
  }
});
test("a failed scan-freshness receipt cannot misreport a committed aggregate as rejected",async()=>{
  let attempted=0;
  assert.equal(await recordLoyverseScanConfirmation(async()=>{attempted++;}),true);
  assert.equal(await recordLoyverseScanConfirmation(async()=>{
    attempted++;throw Error("fictional audit write unavailable");
  }),false);
  assert.equal(attempted,2);
  const route=readFileSync(
    "src/app/api/workforce/demand-observations/loyverse/route.ts","utf8");
  const get=route.slice(route.indexOf("export async function GET("),
    route.indexOf("export async function POST("));
  const post=route.slice(route.indexOf("export async function POST("));
  const getRoleGate=get.indexOf("assertOrganizationRole(");
  const postRoleGate=post.indexOf("assertOrganizationRole(");
  assert.ok(getRoleGate>=0 && get.includes("WORKFORCE_MANAGER_ROLES"),
    "GET must enforce workforce.manage and organization session policy");
  assert.ok(postRoleGate>=0 && post.includes("PEOPLE_ADMIN_ROLES"),
    "POST must enforce people.admin and organization session policy");
  assert.ok(getRoleGate<get.indexOf("loyverseConnection("));
  assert.ok(postRoleGate<post.indexOf("loyverseConnection("));
  assert.ok(get.indexOf("const access=await getAccess(")>=0);
  assert.ok(get.indexOf("const access=await getAccess(")<get.indexOf("loyverseConnection("),
    "GET must deny unauthorized tenants before disclosing connector configuration");
  assert.ok(post.indexOf("const access=await getAccess(")<post.indexOf("loyverseConnection("),
    "POST must authorize employer and worksite before checking merchant configuration");
  assert.ok(post.indexOf("writeOperationalDemandImport(")<
    post.indexOf("recordLoyverseScanConfirmation("));
  assert.ok(post.includes("sourceAuditRecorded:scanAuditRecorded"));
  assert.ok(post.includes("scan-freshness audit failed"));
  const panel=readFileSync(
    "src/components/workspace/workforce-loyverse-pos-panel.tsx","utf8");
  assert.ok(panel.includes("result.sourceAuditRecorded===false"));
  assert.ok(panel.includes("aggregate import was recorded"));
});

test("oversized chunked provider JSON is cancelled before buffering its full body",async()=>{
  let cancelled=false, reads=0;
  const request=(async(value:RequestInfo|URL,init?:RequestInit)=>{
    assert.equal(init?.redirect,"error","Never forward bearer credentials to a redirected origin");
    const url=new URL(String(value));
    assert.equal(url.origin,"https://api.loyverse.com");
    if(url.pathname==="/v1.0/stores")return Response.json({
      stores:[{id:storeId,country:"PH",deleted_at:null}],
    });
    assert.equal(url.pathname,"/v1.0/receipts");
    // Provider omits Content-Length. The second chunk crosses the 2 MB cap,
    // so the reader MUST cancel without awaiting a third chunk or parsing it.
    const body=new ReadableStream<Uint8Array>({
      pull(controller){
        reads++;
        if(reads===1)controller.enqueue(new TextEncoder().encode('{"receipts":['));
        else if(reads===2)controller.enqueue(new Uint8Array(2_000_001));
        else controller.close();
      },
      cancel(){cancelled=true;},
    });
    return new Response(body,{status:200,headers:{"Content-Type":"application/json"}});
  }) as typeof fetch;
  await assert.rejects(readLoyversePosDay({...conf,request}),
    (error:unknown)=>error instanceof LoyverseSourceError&&error.code==="SOURCE_REVIEW");
  assert.equal(cancelled,true,"Provider body must be cancelled on limit breach");
  assert.ok(reads<=3,"An oversized response must not be fully consumed");
});

test("nonexistent calendar times and invalid offsets cannot become aggregate bins",async()=>{
  for(const stamp of [
    "2026-09-31T09:00:00+08:00",
    "2026-09-20T09:00:00+15:00",
    "2026-09-20T25:00:00+08:00",
  ]){
    const row=ticket("BROKEN","2026-09-20T09:00:00+08:00",stamp);
    await assert.rejects(readLoyversePosDay({...conf,
      request:pages([{receipts:[row]}])}),
    (e:unknown)=>e instanceof LoyverseSourceError&&e.code==="SOURCE_REVIEW",
    "Invalid provider clock must never be treated as a completed source scan: "+stamp);
  }
});
