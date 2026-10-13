import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import { resolveWorkflowUiFlags } from "../src/lib/workflow-ui-flags";
import { FaceOfflinePunchPanel } from "../src/components/workspace/face-offline-punch";
import { OfflinePunchReviewQueue } from "../src/components/workspace/offline-punch-review";
test("offline UI flag is exact-true and disabled under multi-entity",()=>{
  for(const value of [undefined,"","1","TRUE","true "])
    assert.equal(criticalReleaseFlagEnabled("faceOfflinePunch",{FACE_OFFLINE_PUNCH_UI_ENABLED:value}),false);
  assert.equal(resolveWorkflowUiFlags({FACE_OFFLINE_PUNCH_UI_ENABLED:"true",MULTI_ENTITY_ENABLED:"false"}).faceOfflinePunch,true);
  assert.equal(resolveWorkflowUiFlags({FACE_OFFLINE_PUNCH_UI_ENABLED:"true",MULTI_ENTITY_ENABLED:"true"}).faceOfflinePunch,false);
});
test("offline employee consent and HR queue clearly label unverified claims",()=>{
  const html=renderToStaticMarkup(createElement(FaceOfflinePunchPanel,{organizationId:1,employeeId:1}));
  assert.match(html,/camera preview/i);assert.match(html,/not face verification/i);
  const hr=renderToStaticMarkup(createElement(OfflinePunchReviewQueue,{organizationId:1}));
  assert.match(hr,/Unverified offline punch claims/);assert.match(hr,/Loading offline claims/);
});
test("offline claims API rejects disabled and multi-entity requests before DB access",async()=>{
  process.env.DATABASE_URL??="postgresql://local:local@127.0.0.1:1/offline";
  const prior=[process.env.FACE_OFFLINE_PUNCH_UI_ENABLED,process.env.MULTI_ENTITY_ENABLED];
  try{
    const api=await import("../src/app/api/attendance/offline-claims/route");
    process.env.FACE_OFFLINE_PUNCH_UI_ENABLED="false";process.env.MULTI_ENTITY_ENABLED="false";
    assert.equal((await api.GET(new Request("https://example.test/api/attendance/offline-claims?organizationId=1"))).status,404);
    process.env.FACE_OFFLINE_PUNCH_UI_ENABLED="true";process.env.MULTI_ENTITY_ENABLED="true";
    for(const [method,handler] of [["GET",api.GET],["POST",api.POST],["PATCH",api.PATCH]] as const){
      const response=await handler(new Request("https://example.test/api/attendance/offline-claims?organizationId=1",{method,...(method==="GET"?{}:{headers:{"content-type":"application/json"},body:"{}"})}));
      assert.equal(response.status,403);assert.equal((await response.json()).code,"ENTITY_WORKFLOW_DEFERRED");
    }
  }finally{
    const [flag,entity]=prior;
    if(flag===undefined)delete process.env.FACE_OFFLINE_PUNCH_UI_ENABLED;else process.env.FACE_OFFLINE_PUNCH_UI_ENABLED=flag;
    if(entity===undefined)delete process.env.MULTI_ENTITY_ENABLED;else process.env.MULTI_ENTITY_ENABLED=entity;
  }
});
