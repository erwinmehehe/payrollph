import assert from "node:assert/strict";
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
});
test("projections use only authorized source columns and reject absent filter fields",()=>{
 const input={columns:["Name","Gross","Secret"],rows:[["A","100","private"],["B","200","hidden"]]};
 const out=projectReportRows({...input,selectedFields:["Name","Gross","NotProvided"],filters:[{field:"Name",operator:"equals" as const,value:"A"}]});
 assert.deepEqual(out.columns,["Name","Gross"]); assert.deepEqual(out.rows,[["A","100"]]);
 const none=projectReportRows({...input,selectedFields:["Name"],filters:[{field:"Unauthorized",operator:"contains" as const,value:"x"}]});
 assert.deepEqual(none.rows,[]);
 assert.match(exportProjectedReportCsv(["Name"],[["=cmd"]]),/"'=cmd"/);
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
