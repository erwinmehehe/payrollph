import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { projectReportRows, exportProjectedReportCsv } from "../src/lib/report-builder-view";
import { CustomReportBuilder } from "../src/components/workspace/custom-report-builder";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import { resolveWorkflowUiFlags } from "../src/lib/workflow-ui-flags";
test("saved report UI is exact-true default OFF and denied for multi-entity",()=>{
 for(const value of [undefined,"","1","TRUE","true "])
  assert.equal(criticalReleaseFlagEnabled("reportBuilder",{REPORT_BUILDER_UI_ENABLED:value}),false);
 assert.equal(resolveWorkflowUiFlags({REPORT_BUILDER_UI_ENABLED:"true",MULTI_ENTITY_ENABLED:"false"}).reportBuilder,true);
 assert.equal(resolveWorkflowUiFlags({REPORT_BUILDER_UI_ENABLED:"true",MULTI_ENTITY_ENABLED:"true"}).reportBuilder,false);
 const combined=resolveWorkflowUiFlags({BENEFITS_LOANS_UI_ENABLED:"true",REPORT_BUILDER_UI_ENABLED:"true",MULTI_ENTITY_ENABLED:"false"});
 assert.equal(combined.benefitsLoans,true,"already-merged benefits feature must survive the saved-report integration");
 assert.equal(combined.reportBuilder,true);
 const held=resolveWorkflowUiFlags({BENEFITS_LOANS_UI_ENABLED:"true",REPORT_BUILDER_UI_ENABLED:"true",MULTI_ENTITY_ENABLED:"true"});
 assert.deepEqual(held,{benefitsLoans:false,reportBuilder:false,faceOfflinePunch:false,recruitmentJourney:false},"multi-entity hold applies to all four features");
});
test("projections use only authorized source columns and reject absent filter fields",()=>{
 const input={columns:["Name","Gross","Secret"],rows:[["A","100","private"],["B","200","hidden"]]};
 const out=projectReportRows({...input,selectedFields:["Name","Gross","NotProvided"],filters:[{field:"Name",operator:"equals" as const,value:"A"}]});
 assert.deepEqual(out.columns,["Name","Gross"]); assert.deepEqual(out.rows,[["A","100"]]);
 const none=projectReportRows({...input,selectedFields:["Name"],filters:[{field:"Unauthorized",operator:"contains" as const,value:"x"}]});
 assert.deepEqual(none.rows,[]);
 assert.match(exportProjectedReportCsv(["Name"],[["=cmd"]]),/"'=cmd"/);
});
test("saved report mutations commit the definition and audit in the same transaction",()=>{
 const code=readFileSync("src/app/api/report-builder/saved/route.ts","utf8");
 assert.equal((code.match(/await db\.transaction\(/g)??[]).length,3);
 assert.equal((code.match(/await tx\.insert\(auditEvents\)/g)??[]).length,3);
 assert.doesNotMatch(code,/await recordAuditEvent\(/);
 assert.match(code,/requestJsonObject\(request\)/);
});
test("CSV export neutralizes invisible-character-prefixed spreadsheet formulas",()=>{
 const csv=exportProjectedReportCsv(["Name","Amount"],[
  ["\u200b=HYPERLINK(A1)","123"],
  ["\t+SUM(1,2)","-42"],
  ["\ufeff@evil","plain"],
  ["safe, literal",'quoted "value"'],
 ]);
 assert.ok(csv.includes('"' + "'" + "\u200b=HYPERLINK(A1)" + '"'));
 assert.ok(csv.includes('"' + "'" + "\t+SUM(1,2)" + '"'));
 assert.ok(csv.includes('"' + "'" + "\ufeff@evil" + '"'));
 assert.ok(csv.includes('"safe, literal"'));
 assert.ok(csv.includes('"quoted ""value"""'));
});

test("saved report builder renders loading and empty state without data",()=>{
 const html=renderToStaticMarkup(createElement(CustomReportBuilder,{organizationId:1,active:"headcount",report:null,onReport:()=>{}}));
 assert.match(html,/report/i);assert.doesNotMatch(html,/privates+salarys+record/i);
});
test("saved routes deny disabled and multi-entity requests before querying data",async()=>{
 process.env.DATABASE_URL??="postgresql://local:local@127.0.0.1:1/offline";
 const prior=[process.env.REPORT_BUILDER_UI_ENABLED,process.env.MULTI_ENTITY_ENABLED];
 try{
  const api=await import("../src/app/api/report-builder/saved/route");
  process.env.REPORT_BUILDER_UI_ENABLED="false";process.env.MULTI_ENTITY_ENABLED="false";
  assert.equal((await api.GET(new Request("https://example.test/api/report-builder/saved?organizationId=1"))).status,404);
  process.env.REPORT_BUILDER_UI_ENABLED="true";process.env.MULTI_ENTITY_ENABLED="true";
  for(const [method,handler] of [["GET",api.GET],["POST",api.POST],["PATCH",api.PATCH],["DELETE",api.DELETE]] as const){
   const response=await handler(new Request("https://example.test/api/report-builder/saved?organizationId=1",{method,...(method==="GET"?{}:{headers:{"content-type":"application/json"},body:"{}"})}));
   assert.equal(response.status,403);assert.equal((await response.json()).code,"ENTITY_WORKFLOW_DEFERRED");
  }
 }finally{
  if(prior[0]===undefined)delete process.env.REPORT_BUILDER_UI_ENABLED;else process.env.REPORT_BUILDER_UI_ENABLED=prior[0];
  if(prior[1]===undefined)delete process.env.MULTI_ENTITY_ENABLED;else process.env.MULTI_ENTITY_ENABLED=prior[1];
 }
});

test("four dev UI features remain independent, default OFF, and entity-held", () => {
  const all = { BENEFITS_LOANS_UI_ENABLED:"true", REPORT_BUILDER_UI_ENABLED:"true",
    FACE_OFFLINE_PUNCH_UI_ENABLED:"true", RECRUITMENT_JOURNEY_UI_ENABLED:"true",
    MULTI_ENTITY_ENABLED:"false" };
  assert.deepEqual(resolveWorkflowUiFlags(all), {
    benefitsLoans:true, reportBuilder:true, faceOfflinePunch:true, recruitmentJourney:true,
  });
  const noCareers = resolveWorkflowUiFlags({ ...all, RECRUITMENT_JOURNEY_UI_ENABLED:"false" });
  assert.deepEqual(noCareers, {
    benefitsLoans:true, reportBuilder:true, faceOfflinePunch:true, recruitmentJourney:false,
  }, "careers disabled does not deactivate other features");
  const noOffline = resolveWorkflowUiFlags({ ...all, FACE_OFFLINE_PUNCH_UI_ENABLED:"false" });
  assert.deepEqual(noOffline, {
    benefitsLoans:true, reportBuilder:true, faceOfflinePunch:false, recruitmentJourney:true,
  }, "offline disabled does not deactivate careers");
  const noReports = resolveWorkflowUiFlags({ ...all, REPORT_BUILDER_UI_ENABLED:"false" });
  assert.equal(noReports.recruitmentJourney,true);
  assert.equal(noReports.reportBuilder,false);
  const denied = { benefitsLoans:false, reportBuilder:false, faceOfflinePunch:false, recruitmentJourney:false };
  assert.deepEqual(resolveWorkflowUiFlags({ ...all, MULTI_ENTITY_ENABLED:"true" }),denied);
  assert.deepEqual(resolveWorkflowUiFlags({}),denied,"all features default OFF");
});
