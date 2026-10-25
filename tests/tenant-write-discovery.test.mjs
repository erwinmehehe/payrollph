import assert from "node:assert/strict";
import test from "node:test";
import { pgTable, serial, integer, text, boolean, jsonb, date, uuid, foreignKey, unique } from "drizzle-orm/pg-core";
import { describeTables, proposeFixture, proposeBody, inspectWriteHandler, buildWritePlan, probeEligibility } from "../scripts/qa/tenant-write-generator.mjs";
import { classifyProbe, requireWriteProbeTarget, renderProbePath, runWriteProbe, seedProbeWorker, probeBindingVerified } from "../scripts/qa/tenant-write-probe-http.mjs";

const org = pgTable("fictional_organizations", { id: serial("id").primaryKey() });
const parent = pgTable("fictional_parents", { tenant: integer("tenant").notNull(), key: integer("key").notNull() }, t => [unique().on(t.tenant,t.key)]);
const child = pgTable("fictional_children", {
  id: serial("id").primaryKey(), organizationId: integer("organization_id").notNull().references(() => org.id),
  parentTenant: integer("parent_tenant").notNull(), parentKey: integer("parent_key").notNull(),
  name: text("name").notNull(), enabled: boolean("enabled").notNull(), details: jsonb("details").notNull(),
  date: date("date").notNull(), uuid: uuid("uuid").notNull(), status: text("status", { enum: ["draft","active"] }).notNull(),
  optional: text("optional"), defaulted: text("defaulted").notNull().default("safe-default"),
}, t => [foreignKey({ columns: [t.parentTenant,t.parentKey], foreignColumns: [parent.tenant,parent.key] }), unique().on(t.name)]);
const catalogue = describeTables({ org, parent, child, helper: () => {} });
const ctx = { organizationId: 41, employeeId: 52, rowId: 63, marker: "Fictional-A", uuid: "00000000-0000-4000-8000-000000000001",
  references: { "fictional_organizations.id": 41, "fictional_parents.tenant": 41, "fictional_parents.key": 73 } };

test("Drizzle required/default/generated/enum/unique and composite FK metadata drive fictional fixtures", () => {
  assert.deepEqual(Object.keys(catalogue), ["child","org","parent"]);
  const fixture = proposeFixture(catalogue.child, ctx);
  assert.deepEqual(fixture.unresolved, []);
  assert.equal(fixture.values.organizationId, 41);
  assert.equal(fixture.values.parentTenant, 41); assert.equal(fixture.values.parentKey, 73);
  assert.equal(fixture.values.status, "draft"); assert.equal(fixture.values.enabled, false);
  assert.deepEqual(fixture.values.details, {}); assert.equal(fixture.values.date, "2026-01-05");
  assert.equal(fixture.values.uuid, ctx.uuid); assert.equal(fixture.values.name, "Fictional-A name");
  for (const field of ["id","optional","defaulted"]) assert.equal(Object.hasOwn(fixture.values,field),false);
  assert.deepEqual(fixture.uniqueConstraints, [["name"]]);
});

test("unknown FK references stay unresolved, never guessed or borrowed across employers", () => {
  const missing = proposeFixture(catalogue.child, { ...ctx, references: {} });
  assert.equal(missing.unresolved.length, 3);
  assert.equal(Object.hasOwn(missing.values,"organizationId"),false);
  assert.equal(proposeFixture(catalogue.child, { ...ctx, marker: "Fictional-B" }).values.name,"Fictional-B name");
  assert.throws(() => proposeFixture(catalogue.child,ctx,{ nonColumn: "bad" }),/UNKNOWN_FIXTURE_COLUMN/);
  const mismatch=proposeFixture(catalogue.child,{...ctx,references:{...ctx.references,"fictional_organizations.id":99}});
  assert.ok(mismatch.unresolved.some(v=>v.reason==="context-reference-conflict"));
  assert.equal(Object.hasOwn(mismatch.values,"organizationId"),false);
});

const source = `import { child as cases } from "@/db/schema";
 export async function GET(request: Request) { const body=await request.json(); return body.unrelatedSecret; }
 export async function POST(request: Request) { const payload=await request.json().catch(()=>({}));
 const action=String(payload.action ?? "create"); const n=Number(payload.employeeId);
 const { name }=payload; if(action==="update"){}; if(process.env.FICTIONAL_ENABLED!=="true"){};
 return db.insert(cases).values({name,n}); }
 export const PATCH=async(request: Request)=>{const b=await request.json(); return db.update(cases).set({name:b["name"],id:b.id});};`;
test("AST scopes bodies to one HTTP method, handles aliases/destructuring/arrow handlers and records defaults", () => {
  const post=inspectWriteHandler(source,"POST");
  assert.deepEqual(post.fields.map(f=>f.name),["action","employeeId","name"]);
  assert.deepEqual(post.tables,["child"]); assert.deepEqual(post.flags,["FICTIONAL_ENABLED"]);
  assert.deepEqual(post.actions,["update"]);
  assert.equal(post.fields.find(f=>f.name==="employeeId").type,"number");
  const proposed=proposeBody(post,catalogue.child,ctx);
  assert.deepEqual(proposed.unresolved,[]); assert.equal(proposed.body.employeeId,52); assert.equal(proposed.body.action,"create");
  assert.deepEqual(inspectWriteHandler(source,"PATCH").fields.map(f=>f.name),["id","name"]);
  assert.equal(inspectWriteHandler('export { POST } from "./helper";',"POST").supported,false);
  assert.equal(inspectWriteHandler('export async function POST(r: Request){const f=await r.formData();}',"POST").multipart,true);
  assert.throws(()=>inspectWriteHandler("export async function POST( {", "POST"),/ROUTE_AST_INVALID/);
});

test("plans derive the GAP write pool, never touch existing coverage or invent arbitrary source paths", () => {
  const manifest={allApiRouteFiles:{"src/app/api/discipline/route.ts":{route:"discipline",methods:[
    {name:"GET",status:"GAP"},{name:"POST",status:"GAP"},{name:"PATCH",status:"COVERED"}]}}};
  const original=JSON.stringify(manifest);
  const plan=buildWritePlan(manifest,()=>source,catalogue);
  assert.equal(plan.writes.length,1);assert.equal(plan.coverageCredits,0);assert.equal(JSON.stringify(manifest),original);
  assert.equal(plan.writes[0].key,"POST discipline");
  assert.throws(()=>buildWritePlan({allApiRouteFiles:{"../../secret":manifest.allApiRouteFiles["src/app/api/discipline/route.ts"]}},()=>source,catalogue),/INVALID_ROUTE_SOURCE_PATH/);
  assert.throws(()=>buildWritePlan({allApiRouteFiles:{"src/app/api/discipline/route.ts":{route:"auth/logout",methods:[{name:"POST",status:"GAP"}]}}},()=>source,catalogue),/ROUTE_SOURCE_MISMATCH/);
});

test("financial/provider/auth routes and release/approval actions cannot become probe writes", () => {
  const handler=inspectWriteHandler(source,"POST");
  assert.equal(probeEligibility("discipline","POST",handler),null);
  for(const route of ["discipline-evil","payroll-runs","payout-destination-changes","auth/logout","billing","webhooks/provider","jobs/run"]) assert.equal(probeEligibility(route,"POST",handler),"manual-review");
  assert.equal(probeEligibility("discipline","POST",{...handler,actions:["release"]}),"manual-review-action");
  assert.throws(()=>renderProbePath("cases/[id]",undefined),/UNRESOLVED_PATH_PARAMETER/);
  assert.equal(renderProbePath("cases/[id]",63),"/api/cases/63");
  assert.throws(()=>renderProbePath("cases/[employeeId]",63),/UNRESOLVED_PATH_PARAMETER/);
  assert.throws(()=>renderProbePath("cases/[...id]",63),/UNSUPPORTED_PATH_PARAMETER/);
  assert.throws(()=>renderProbePath("discipline/../../auth/logout",63),/INVALID_PROBE_PATH/);
});
test("a rejected target fails before the app DB module or any HTTP fixture can load", async () => {
  await assert.rejects(runWriteProbe({writes:[]},{},{...env,CI:"false"}),/WRITE_PROBE_TARGET_REFUSED/);
});

const env={CI:"true",TENANT_WRITE_PROBE_MODE:"fictional-disposable-only",TENANT_SECOND_PASS_MODE:"isolated-ci-only",
 NODE_ENV:"production",DEMO_MODE:"false",SECURITY_SMOKE_URL:"http://127.0.0.1:3000",DATABASE_URL:"postgresql://fake:fake@127.0.0.1:5432/app_db",
 PAYMONGO_DISBURSEMENTS_ENABLED:"false",XENDIT_PAYOUTS_ENABLED:"false"};
test("probe refuses nonlocal DB/server, startup overrides, enabled payments/workers and external credentials", () => {
  assert.equal(requireWriteProbeTarget(env),env.SECURITY_SMOKE_URL);
  for(const patch of [{CI:"false"},{TENANT_WRITE_PROBE_MODE:""},{DATABASE_URL:"postgresql://fake:fake@real.invalid:5432/app_db"},
    {DATABASE_URL:env.DATABASE_URL+"?options=-crole=owner"},{SECURITY_SMOKE_URL:"https://127.0.0.1:3000"},
    {SECURITY_SMOKE_URL:"http://127.0.0.1:3000/other"},{SECURITY_SMOKE_URL:"http://user:pass@127.0.0.1:3000"},
    {WORKER_ENABLED:"true"},{PAYMONGO_DISBURSEMENTS_ENABLED:"true"},{RESEND_API_KEY:"secret"},{MALWARE_SCAN_URL:"https://real.invalid"}]) {
    assert.throws(()=>requireWriteProbeTarget({...env,...patch}),/REFUSED/);
  }
});
test("probe outcomes distinguish accepted HTTP, flag hints, invalid bodies, fixture/auth gaps and server failures", () => {
  assert.equal(classifyProbe(201),"works");assert.equal(classifyProbe(204),"works");
  assert.equal(classifyProbe(404,{flags:["FICTIONAL_ENABLED"]}),"needs flag");
  assert.equal(classifyProbe(404),"needs fixture");assert.equal(classifyProbe(403),"needs fixture");
  assert.equal(classifyProbe(422),"validation error");assert.equal(classifyProbe(400),"validation error");
  assert.equal(classifyProbe(500),"unavailable");assert.equal(classifyProbe(429),"unavailable");
});


test("probe worker has its explicit own pay profile before server binding, and profile errors abort", async () => {
  const calls = [];
  const context = { organizationId: 41, legalEntityId: 51, orgUnitId: 61, marker: "Fictional-probe", references: {} };
  await seedProbeWorker(async (symbol, ctx, values) => {
    calls.push({ symbol, values });
    if (symbol === "employeePayProfiles") {
      assert.equal(ctx.employeeId, 71);
      assert.equal(ctx.references["employees.id"], 71);
    }
    return { id: 71 };
  }, context);
  assert.deepEqual(calls.map(c => c.symbol), ["employees", "employeePayProfiles"]);
  assert.deepEqual(calls[1].values, { organizationId: 41, employeeId: 71, payBasis: "monthly", rateAmount: "20000.00", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8" });
  await assert.rejects(seedProbeWorker(async (symbol) => {
    if (symbol === "employeePayProfiles") throw Error("PROFILE_FIXTURE_REJECTED");
    return { id: 81 };
  }, { ...context, references: {} }), /PROFILE_FIXTURE_REJECTED/);
});

test("binding requires the exact seeded employee, employer and marker; substring matches never pass", () => {
  const context = { employeeId: 71, organizationId: 41, marker: "Fictional-probe" };
  const row = { id: 71, organizationId: 41, employeeNo: context.marker };
  assert.equal(probeBindingVerified(200, [row], context), true);
  for (const payload of [null, [], { error: context.marker }, [context.marker], [{ ...row, id: 72 }],
    [{ ...row, organizationId: 42 }], [{ ...row, employeeNo: "other" }]]) {
    assert.equal(probeBindingVerified(200, payload, context), false);
  }
  for (const status of [302, 401, 403, 500]) assert.equal(probeBindingVerified(status, [row], context), false);
});
