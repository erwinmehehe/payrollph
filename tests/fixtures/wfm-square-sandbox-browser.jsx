import React,{StrictMode} from "react";
import { createRoot } from "react-dom/client";
import { WorkforceSquareSandboxPanel } from "../../src/components/workspace/workforce-square-sandbox-panel";

const root=createRoot(document.getElementById("root"));
const worksites=[
  {id:5,code:"SYN",name:"Fictional sandbox branch",active:true},
  {id:6,code:"NO",name:"Unlinked fictional branch",active:true},
];
window.requests=[];window.imported=false;window.failProvider=false;
window.renderTenant=(organizationId)=>{
  root.render(<StrictMode><WorkforceSquareSandboxPanel key={organizationId}
    organizationId={organizationId} worksites={worksites}/></StrictMode>);
};
window.fetch=async(uri,options={})=>{
  const url=new URL(String(uri),"http://local.invalid");
  const method=options.method??"GET";
  const organizationId=method==="GET"?Number(url.searchParams.get("organizationId")):
    Number(JSON.parse(options.body).organizationId);
  const worksiteId=method==="GET"?Number(url.searchParams.get("worksiteId")):
    Number(JSON.parse(options.body).worksiteId);
  window.requests.push({path:url.pathname,method,organizationId,worksiteId});
  if(url.pathname!=="/api/workforce/demand-observations/square-sandbox"){
    throw Error("Unapproved client source/schedule/payroll endpoint: "+url.pathname);
  }
  if(organizationId!==100||worksiteId!==5){
    return Response.json({error:"Sandbox location or consent binding unavailable."},{status:403});
  }
  if(method==="GET"){
    return Response.json({
      readOnly:true,scope:{organizationId,worksiteId,intervalMinutes:
        Number(url.searchParams.get("intervalMinutes")),sourceKey:"square_sandbox_payments"},
      lastStoredImportAt:window.imported?"2026-10-12T00:00:00.000Z":null,
      lastStoredRevisionRows:window.imported?48:null,
      lastCheckedAt:window.imported?"2026-10-12T00:00:00.000Z":null,
      lastCheckedWorkDate:window.imported?"2026-09-20":null,
      freshness:"source_reported_scan_only",
      boundary:"Fictional sandbox-only source scan; not independently certified",
    });
  }
  if(method==="POST"){
    const data=JSON.parse(options.body);
    if(!data.acknowledged||data.workDate!=="2026-09-20"||data.intervalMinutes!==30){
      return Response.json({error:"Invalid historical sync request."},{status:400});
    }
    if(window.failProvider)return Response.json({
      error:"Sandbox source incomplete or unavailable",code:"SOURCE_REVIEW",
    },{status:503});
    if(!data.dryRun)window.imported=true;
    return Response.json({
      applied:!data.dryRun,readOnly:data.dryRun,
      source:"square_sandbox_payments",workDate:data.workDate,
      intervalMinutes:30,completedPayments:3,scannedPages:2,
      changedIntervals:window.imported&&data.dryRun?0:48,
      unchangedIntervals:0,observedAsOf:"2026-10-12T00:00:00.000Z",
      boundary:"Fictional point-in-time sandbox count only",
    });
  }
  throw Error("Unexpected method "+method);
};
window.renderTenant(100);
