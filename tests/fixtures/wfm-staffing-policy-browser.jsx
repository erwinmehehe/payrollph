import React,{StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {WorkforceDemandStaffingPanel} from "../../src/components/workspace/workforce-demand-staffing-panel";
import {WorkforceDemandStaffingPolicyAdmin} from "../../src/components/workspace/workforce-demand-staffing-policy-admin";

const root=createRoot(document.getElementById("root"));
const date="2099-01-02";
const sites=[
  {id:5,code:"A",name:"Synthetic branch",active:true},
  {id:6,code:"B",name:"Synthetic depot",active:true},
];
const roles=[{id:3,title:"Cashier",active:true}];
const shifts=[{id:11,code:"DAY",name:"Morning",startTime:"09:00",
  endTime:"10:00",spansMidnight:false,breakMinutes:0}];
const coverage=[{requirementId:21,worksiteId:5,workDate:date,
  shiftDefinitionId:11,jobProfileId:3,availableScheduledHeadcount:2}];
const snapshot={
  version:1,source:"source_reported_aggregate_workload",
  scope:{organizationId:100,worksiteId:5,sourceKey:"pos-main",
    metricKind:"transactions",intervalMinutes:30,horizonDays:7},
  issuedAt:"2099-01-01T00:00:00.000Z",
  sourceCutoffAt:"2099-01-01T00:00:00.000Z",horizonStartPh:date,
  retrospectiveComparisons:30,trainingEvidenceSha256:"a".repeat(64),
  points:[
    {intervalStart:"2099-01-02T01:00:00.000Z",predictedCount:10,
      lowerScenarioCount:8,upperScenarioCount:12,historicalEvidenceCount:10},
    {intervalStart:"2099-01-02T01:30:00.000Z",predictedCount:20,
      lowerScenarioCount:15,upperScenarioCount:24,historicalEvidenceCount:10},
  ],
  boundary:"Synthetic source-reported aggregate workload only.",
};
const policy={
  id:91,version:2,status:"approved",organizationId:100,worksiteId:5,
  jobProfileId:3,metricKind:"transactions",intervalMinutes:30,
  effectiveFrom:"2099-01-01",effectiveUntil:"2099-01-10",
  productiveUnitsPerWorkerHour:10,serviceTargetCoveragePercent:100,
  rationale:"Independent fictional manager policy for synthetic source comparison",
  contentSha256:"b".repeat(64),approvalReceiptSha256:"c".repeat(64),
  approvedAt:"2098-12-01T00:00:00.000Z",approvalIntegrity:"matches_hash",
};
window.requests=[];window.policyRows=[];window.actor="maker";
window.policyCorrupt=false;window.scenarioCorrupt=false;
window.renderTenant=(organizationId)=>{
  root.render(<StrictMode>
    <WorkforceDemandStaffingPolicyAdmin key={"admin-"+organizationId}
      organizationId={organizationId} worksites={sites} jobProfiles={roles}/>
    <WorkforceDemandStaffingPanel key={"manager-"+organizationId}
      organizationId={organizationId} worksites={sites} shifts={shifts}
      jobProfiles={roles} coverage={coverage}
      laborCostVisible={true} laborRows={[{requirementId:21,benchmarkHourlyRate:150}]}
      recoveryOptions={[]} policiesEnabled={true}
      guardrailBlockers={0} rosterStatus="ready"
      windowStart={date} windowEnd={date} dynamicGroupCode=""/>
  </StrictMode>);
};
window.fetch=async(uri,options={})=>{
  const url=new URL(String(uri),"http://local.invalid");
  const method=options.method??"GET";
  const organizationId=Number(url.searchParams.get("organizationId"));
  const worksiteId=Number(url.searchParams.get("worksiteId"));
  window.requests.push({method,path:url.pathname,organizationId,worksiteId});
  if(!["/api/workforce/demand-observations/issued",
      "/api/workforce/demand-staffing/policies"].includes(url.pathname)) {
    throw Error("Unauthorized planner/policy endpoint: "+url.pathname);
  }
  if(method==="GET"&&url.pathname.endsWith("/issued")){
    if(organizationId!==100)return Response.json({error:"Workforce manager access is required."},{status:403});
    return Response.json({
      readOnly:true,scope:{organizationId,worksiteId},
      issued:worksiteId===5?[{
        id:77,worksiteId,issuedAt:snapshot.issuedAt,snapshotSha256:"d".repeat(64),
        integrity:window.scenarioCorrupt?"source_review":"matches_issued_hash",
        snapshot:window.scenarioCorrupt?null:snapshot,
      }]:[],
    });
  }
  if(method==="GET"&&url.pathname.endsWith("/policies")){
    if(organizationId!==100)return Response.json({error:"Workforce manager access is required."},{status:403});
    const jobProfileId=url.searchParams.get("jobProfileId")==="any"?null:
      Number(url.searchParams.get("jobProfileId"));
    const mode=url.searchParams.get("mode");
    return Response.json({
      readOnly:true,
      scope:{
        organizationId,worksiteId,jobProfileId,
        metricKind:url.searchParams.get("metricKind"),
        intervalMinutes:Number(url.searchParams.get("intervalMinutes")),
      },
      policies:worksiteId!==5?[]:mode==="manage"?
        window.policyRows:jobProfileId===3?[{
          ...policy,approvalIntegrity:window.policyCorrupt?"source_review":"matches_hash",
        }]:[],
    });
  }
  if(url.pathname.endsWith("/policies")&&(method==="POST"||method==="PATCH")){
    const data=JSON.parse(options.body);
    if(data.organizationId!==100||window.actor!=="maker"&&window.actor!=="checker"){
      return Response.json({error:"Wrong organization."},{status:403});
    }
    if(method==="POST"){
      if(window.actor!=="maker"||data.worksiteId!==5||data.rationale.length<12)
        return Response.json({error:"Invalid draft scope."},{status:403});
      window.policyRows=[{id:12,version:1,status:"draft",
        ...data,approvalIntegrity:"matches_hash",contentSha256:"e".repeat(64),
        approvalReceiptSha256:null}];
      return Response.json({id:12,version:1,status:"draft",replayed:false},{status:201});
    }
    if(data.policyId!==12||!data.acknowledged)return Response.json({error:"Decision not acknowledged."},{status:400});
    if(data.action==="approve"&&window.actor==="maker")return Response.json({
      error:"Independent owner/admin approver required.",
    },{status:403});
    if(data.action==="submit"&&window.actor!=="maker")return Response.json({
      error:"Draft author required.",
    },{status:403});
    if(data.action==="approve"&&data.decisionNote.length<12)return Response.json({
      error:"Reviewer evidence missing.",
    },{status:400});
    window.policyRows=window.policyRows.map(p=>({...p,status:data.action==="submit"?"submitted":
      data.action==="approve"?"approved":"rejected",
      approvalReceiptSha256:data.action==="approve"?"f".repeat(64):null}));
    return Response.json({id:12,status:window.policyRows[0].status,
      approvalReceiptSha256:data.action==="approve"?"f".repeat(64):null});
  }
  throw Error("Unrecognized browser fixture path");
};
window.renderTenant(100);
