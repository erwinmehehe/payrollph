import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  readSquareSandboxDay, parseSquareDemandSync, selectSquareDemandRevisions,
  SquareDemandSourceError, SQUARE_SANDBOX_SOURCE,
} from "../src/lib/workforce-square-sandbox";

const now=new Date("2026-10-12T00:00:00.000Z");
const day="2026-09-20";
const sample={
  accessToken:"sandbox-fictional-no-production-secret",
  locationId:"SBPHLOC111",workDate:day,
  intervalMinutes:30 as const,now,
};
const payment=(id:string,time:string,status="COMPLETED",location="SBPHLOC111")=>({
  id,created_at:time,status,location_id:location,
  note:"Do not retain this confidential checkout note",
  card_details:{card:{last_4:"4242",fingerprint:"confidential"}},
  customer_id:"confidential-buyer",employee_id:"confidential-worker",
  amount_money:{amount:20500,currency:"PHP"},
});
function sourcePage(pages:Array<{payments?:unknown[];cursor?:string;errors?:unknown[]}>,urls:string[]=[]){
  let i=0;
  return (async (value:RequestInfo|URL,options?:RequestInit) => {
    const url=new URL(String(value));urls.push(url.toString());
    assert.equal(url.origin,"https://connect.squareupsandbox.com");
    assert.equal(url.pathname,"/v2/payments");
    assert.equal(url.searchParams.get("location_id"),"SBPHLOC111");
    assert.equal(url.searchParams.get("sort_field"),"CREATED_AT");
    assert.equal(url.searchParams.get("limit"),"100");
    const headers=new Headers(options?.headers);
    assert.equal(headers.get("Square-Version"),"2026-09-16");
    assert.equal(headers.get("authorization"),"Bearer "+sample.accessToken);
    assert.equal(options?.method,"GET");
    assert.equal(options?.redirect,"error","bearer token must never follow redirects");
    const page=pages[i++]??{};
    return Response.json(page);
  }) as typeof fetch;
}

test("strict sandbox-only, site-bound historical sync request",()=>{
  const req={organizationId:101,worksiteId:202,workDate:day,
    intervalMinutes:30,dryRun:true,acknowledged:true};
  assert.deepEqual(parseSquareDemandSync(req),req);
  for(const variant of [
    {...req,workDate:"2026-09-31"},
    {...req,workDate:"2026-09-20T00:00:00+08:00"},
    {...req,intervalMinutes:45},
    {...req,acknowledged:false},
    {...req,accessToken:"sneaky"},
    {...req,customerId:1},
  ])assert.throws(()=>parseSquareDemandSync(variant),/Exact/);
});
test("paginated payment.created_at counts are PH-local, deduplicated and redacted",async()=>{
  const urls:string[]=[];
  const results=await readSquareSandboxDay({...sample,request:sourcePage([
    {payments:[
      payment("pay1111","2026-09-20T00:02:00+08:00"),
      payment("pay2222","2026-09-20T09:29:59+08:00"),
      payment("notcompleted","2026-09-20T09:33:00+08:00","APPROVED"),
    ],cursor:"a-cursor"},
    {payments:[
      payment("pay2222","2026-09-20T09:29:59+08:00"),
      payment("pay3333","2026-09-20T23:59:00+08:00"),
      payment("ended","2026-09-21T00:00:00+08:00"),
    ]},
  ],urls)});
  assert.equal(results.pages,2);
  assert.equal(results.counts.length,48);
  assert.equal(results.completedPayments,3);
  assert.equal(results.counts[0],1);
  assert.equal(results.counts[18],1);
  assert.equal(results.counts[47],1);
  assert.equal(results.counts.reduce((a,b)=>a+b,0),3);
  assert.equal(results.quality,"complete");
  assert.ok(urls[1].includes("cursor=a-cursor"));
  assert.ok(!JSON.stringify(results).includes("card_details"));
  assert.ok(!JSON.stringify(results).includes("customer_id"));
  assert.ok(!JSON.stringify(results).includes("pay1111"));
});
test("new historical source produces append-only, parsable 48 interval revisions",async()=>{
  const aggregate=await readSquareSandboxDay({...sample,request:sourcePage([
    {payments:[payment("pay1000","2026-09-20T12:30:00+08:00")]},
  ])});
  const diff=selectSquareDemandRevisions({
    aggregate,organizationId:101,worksiteId:202,existing:[],now,
  });
  assert.equal(diff.changedIntervals,48);
  assert.equal(diff.batch?.sourceKey,SQUARE_SANDBOX_SOURCE);
  assert.equal(diff.batch?.metricKind,"transactions");
  assert.equal(diff.batch?.rows[25]?.observedCount,1);
  assert.equal(diff.batch?.rows[25]?.revision,1);
  assert.equal(diff.batch?.rows[25]?.quality,"complete");
  assert.equal(diff.batch?.rows[0]?.observedCount,0);
  assert.ok(diff.batch && diff.batch.idempotencyKey.length<=64);
  assert.equal(JSON.stringify(diff).includes("pay1000"),false);
  const existing=diff.batch!.rows.map(x=>({
    intervalStart:new Date(x.intervalStart),revision:x.revision,
    observedCount:x.observedCount,quality:x.quality,
  }));
  const repeated=selectSquareDemandRevisions({
    aggregate,organizationId:101,worksiteId:202,existing,now,
  });
  assert.equal(repeated.changedIntervals,0);
  assert.equal(repeated.batch,null);
  const corrected={...aggregate,counts:aggregate.counts.map((x,i)=>i===25?0:x)};
  const revised=selectSquareDemandRevisions({
    aggregate:corrected,organizationId:101,worksiteId:202,existing,now,
  });
  assert.equal(revised.changedIntervals,1);
  assert.equal(revised.batch?.rows[0]?.revision,2);
  assert.equal(revised.batch?.rows[0]?.observedCount,0);
  assert.equal(revised.batch?.rows[0]?.intervalStart,"2026-09-20T12:30:00+08:00");
});
test("source failures do not produce partial zero-count imports",async()=>{
  const cases=[
    [{payments:[payment("x1111","2026-09-20T11:00:00+08:00","COMPLETED","WRONGSITE")]}],
    [{payments:[{id:"x1111",created_at:"garbled",status:"COMPLETED",location_id:"SBPHLOC111"}]}],
    [{payments:[payment("x1111","2026-09-20T11:00:00")]}],
    [{payments:[],cursor:"repeat"},{payments:[],cursor:"repeat"}],
    [{payments:[],errors:[{code:"BAD_AUTH"}]}],
    [{payments:Array.from({length:101},(_,i)=>payment("abcde"+i,"2026-09-20T10:00:00+08:00"))}],
  ];
  for(const pages of cases)await assert.rejects(
    readSquareSandboxDay({...sample,request:sourcePage(pages)}),
    SquareDemandSourceError,
  );
  await assert.rejects(readSquareSandboxDay({
    ...sample,workDate:"2026-10-11",request:sourcePage([]),
  }),SquareDemandSourceError,"7-day cooling period required");
});
test("provider transport rate-limits or bad JSON fail closed",async()=>{
  const rate=(async()=>Response.json({errors:[{code:"RATE"}]},{status:429})) as typeof fetch;
  await assert.rejects(readSquareSandboxDay({...sample,request:rate}),e=>
    e instanceof SquareDemandSourceError&&e.code==="SOURCE_RATE_LIMITED");
  const malformed=(async()=>new Response("<html>broken</html>")) as typeof fetch;
  await assert.rejects(readSquareSandboxDay({...sample,request:malformed}),
    SquareDemandSourceError);
});
test("no foreign/invalid prior revisions can authorize a full-day sync",async()=>{
  const aggregate=await readSquareSandboxDay({...sample,request:sourcePage([{payments:[]}])});
  assert.throws(()=>selectSquareDemandRevisions({
    aggregate,organizationId:101,worksiteId:202,now,
    existing:[{intervalStart:"invalid",revision:1,observedCount:0,quality:"complete"}],
  }),SquareDemandSourceError);
  assert.equal(aggregate.counts.every(x=>x===0),true);
  assert.match(aggregate.boundary,/point-in-time API scan/);
});

// Cross-employer and custom-permission denials must occur before provider
// configuration discovery or a source scan on both read and write endpoints.
test("Square route enforces exact tenant permission overlay before checking connector config",()=>{
  const route=readFileSync("src/app/api/workforce/demand-observations/square-sandbox/route.ts","utf8");
  const get=route.slice(route.indexOf("export async function GET("),route.indexOf("export async function POST("));
  const post=route.slice(route.indexOf("export async function POST("));
  assert.ok(get.includes("assertOrganizationRole("));
  assert.ok(post.includes("assertOrganizationRole("));
  assert.ok(get.indexOf("assertOrganizationRole(")<get.indexOf("squareSandboxConnection("));
  assert.ok(post.indexOf("assertOrganizationRole(")<post.indexOf("squareSandboxConnection("));
  assert.match(get,/siteAuthorized\(organizationId,worksiteId,access\)/);
  assert.match(post,/siteAuthorized\(scope.organizationId,scope.worksiteId,access\)/);
  assert.ok(post.includes("requireSensitiveActionMfa(user)"));
  assert.ok(post.includes("enforceSensitiveActionRateLimit(request"));
});
