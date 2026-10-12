import React,{StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {WorkforceLoyversePosPanel} from "../../src/components/workspace/workforce-loyverse-pos-panel";
const root=createRoot(document.getElementById("root"));
const sites=[
  {id:5,code:"PH-A",name:"Fictional store",active:true},
  {id:6,code:"PH-B",name:"Foreign scope",active:true},
];
window.requests=[];window.imported=false;window.failSource=false;
window.render=(org,manager=true)=>{
  root.render(<StrictMode><WorkforceLoyversePosPanel
    key={org+"-"+manager} organizationId={org} worksites={sites}
    canManage={manager}/></StrictMode>);
};
window.fetch=async(target,options={})=>{
  const url=new URL(String(target),"http://local.invalid");
  const method=options.method??"GET";
  const body=method==="POST"?JSON.parse(options.body):null;
  const org=method==="GET"?Number(url.searchParams.get("organizationId")):body.organizationId;
  const site=method==="GET"?Number(url.searchParams.get("worksiteId")):body.worksiteId;
  window.requests.push({url:url.pathname,method,org,site});
  if(url.pathname!=="/api/workforce/demand-observations/loyverse"){
    throw Error("Client attempted unsupported endpoint: "+url.pathname);
  }
  if(org!==100||site!==5){
    return Response.json({error:"Merchant consent or store mapping unavailable."},{status:403});
  }
  if(method==="GET")return Response.json({
    readOnly:true,scope:{organizationId:org,worksiteId:site,
      intervalMinutes:Number(url.searchParams.get("intervalMinutes")),
      sourceKey:"loyverse_pos_sales",metricKind:"transactions"},
    lastStoredImportAt:window.imported?"2026-10-12T00:00:00.000Z":null,
    lastStoredRevisionRows:window.imported?48:null,
    lastAttemptAt:window.imported?"2026-10-12T00:00:00.000Z":null,
    lastSuccessfulScanAt:window.imported?"2026-10-12T00:00:00.000Z":null,
    lastSuccessfulWorkDate:window.imported?"2026-09-20":null,
    lastFailedScanAt:null,status:window.imported?"source_reported_only":"source_review",
    boundary:"Fictional provider source only",
  });
  if(method==="POST"){
    if(window.failSource)return Response.json({
      error:"Provider scan incomplete, nothing imported.",
    },{status:503});
    if(body.workDate!=="2026-09-20"||body.intervalMinutes!==30||
       body.acknowledged!==true)return Response.json({
      error:"Incorrect scenario scope",
    },{status:400});
    if(!body.dryRun)window.imported=true;
    return Response.json({
      readOnly:body.dryRun,applied:!body.dryRun,
      source:"loyverse_pos_sales",workDate:body.workDate,intervalMinutes:30,
      countedSales:3,scannedReceipts:4,scannedPages:2,
      changedIntervals:body.dryRun?48:48,unchangedIntervals:0,
      observedAsOf:"2026-10-12T00:00:00.000Z",
      boundary:"Fictional POS receipt count",
    });
  }
  throw Error("Unexpected method");
};
window.render(100,true);
