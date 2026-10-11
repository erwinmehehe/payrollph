import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, workforceDemandImportBatches, worksites } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { getAccess, PEOPLE_ADMIN_ROLES, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa,
} from "@/lib/security-request";
import { validReceiptId } from "@/lib/workforce-schedule-receipt";
import { operationalDemandPilotAllowed } from "@/lib/workforce-operational-demand-import";
import { operationalDemandSiteAuthorized } from "@/lib/workforce-operational-demand-scope";
import {
  loadOperationalDemandVersions, writeOperationalDemandImport, DemandImportConflict,
} from "@/lib/workforce-operational-demand-server";
import {
  SQUARE_SANDBOX_SOURCE, SquareDemandSourceError, squareSandboxPilotAllowed,
  squareSandboxConnection, squareDayWindow, readSquareSandboxDay,
  selectSquareDemandRevisions, parseSquareDemandSync,
} from "@/lib/workforce-square-sandbox";

export const dynamic = "force-dynamic";
const headers = {"Cache-Control":"private, no-store"};

async function siteAuthorized(org:number,site:number,access:{
  organizationId:number;companyWide:boolean;orgUnitId:number|null;
}){
  const [row]=await db.select({
    organizationId:worksites.organizationId,orgUnitId:worksites.orgUnitId,
    active:worksites.active,timezone:worksites.timezone,
  }).from(worksites).where(and(
    eq(worksites.organizationId,org),eq(worksites.id,site),
  )).limit(1);
  return !!row&&row.timezone==="Asia/Manila"&&
    operationalDemandSiteAuthorized(access,row);
}

/** No provider call or credential exposure on GET; show only stored aggregate freshness. */
export async function GET(request:Request){
  const user=await getSessionUser();
  if(!user)return Response.json({error:"Authentication required."},{status:401,headers});
  const q=new URL(request.url).searchParams;
  const organizationId=Number(q.get("organizationId")??"");
  const worksiteId=Number(q.get("worksiteId")??"");
  const intervalMinutes=Number(q.get("intervalMinutes")??"");
  if(!validReceiptId(organizationId)||!validReceiptId(worksiteId)||
    ![15,30,60].includes(intervalMinutes)){
    return Response.json({error:"Exact worksite and interval are required."},{status:400,headers});
  }
  if(!operationalDemandPilotAllowed(organizationId)||
     !squareSandboxPilotAllowed(organizationId)||
     !squareSandboxConnection(organizationId,worksiteId)){
    return Response.json({error:"Square sandbox source not enabled for this employer/worksite."},{status:404,headers});
  }
  const access=await getAccess(user.id,organizationId);
  if(!access||!WORKFORCE_MANAGER_ROLES.some(role=>role===access.role)||
    !await siteAuthorized(organizationId,worksiteId,access)){
    return Response.json({error:"Scoped workforce manager access required."},{status:403,headers});
  }
  try{
    const [last]=await db.select({
      importedAt:workforceDemandImportBatches.importedAt,
      rowCount:workforceDemandImportBatches.rowCount,
    }).from(workforceDemandImportBatches).where(and(
      eq(workforceDemandImportBatches.organizationId,organizationId),
      eq(workforceDemandImportBatches.worksiteId,worksiteId),
      eq(workforceDemandImportBatches.sourceKey,SQUARE_SANDBOX_SOURCE),
      eq(workforceDemandImportBatches.intervalMinutes,intervalMinutes),
    )).orderBy(desc(workforceDemandImportBatches.importedAt)).limit(1);
    const [scan]=await db.select({
      createdAt:auditEvents.createdAt,metadata:auditEvents.metadata,
    }).from(auditEvents).where(and(
      eq(auditEvents.organizationId,organizationId),
      eq(auditEvents.action,"WFM Square sandbox source checked"),
      eq(auditEvents.resource,"worksite:"+worksiteId),
    )).orderBy(desc(auditEvents.createdAt)).limit(1);
    return Response.json({
      readOnly:true,
      scope:{organizationId,worksiteId,sourceKey:SQUARE_SANDBOX_SOURCE,intervalMinutes,
        metricKind:"transactions"},
      lastStoredImportAt:last?.importedAt.toISOString()??null,
      lastStoredRevisionRows:last?.rowCount??null,
      lastCheckedAt:scan?.createdAt.toISOString()??null,
      lastCheckedWorkDate:typeof (scan?.metadata as Record<string,unknown>|undefined)?.workDate===
        "string" ? (scan!.metadata as {workDate:string}).workDate:null,
      freshness:"source_reported_scan_only",
      boundary:"Square SANDBOX source, point-in-time provider scan only. No independently certified provider completeness, live merchant feed or payroll/schedule authority.",
    },{headers});
  }catch{
    return Response.json({error:"Sandbox freshness evidence unavailable."},{status:503,headers});
  }
}

/** Explicit company People admin sync. Source token and location are server-owned. */
export async function POST(request:Request){
  const deny=enforceSameOriginMutation(request);
  if(deny)return deny;
  const user=await getSessionUser();
  if(!user)return Response.json({error:"Authentication required."},{status:401,headers});
  const demo=publicDemoMutationDenied(user.email,"Square sandbox demand import");
  if(demo)return demo;
  const text=await request.text().catch(()=>"");
  if(Buffer.byteLength(text,"utf8")>2048){
    return Response.json({error:"Sandbox sync request too large."},{status:413,headers});
  }
  let scope;
  try{scope=parseSquareDemandSync(JSON.parse(text));}
  catch{return Response.json({error:"Exact historical worksite sync request required."},{status:400,headers});}
  if(!operationalDemandPilotAllowed(scope.organizationId)||
    !squareSandboxPilotAllowed(scope.organizationId)){
    return Response.json({error:"Sandbox provider pilot not enabled."},{status:404,headers});
  }
  const conn=squareSandboxConnection(scope.organizationId,scope.worksiteId);
  if(!conn)return Response.json({error:"Sandbox location or consent binding unavailable."},{status:404,headers});
  const access=await getAccess(user.id,scope.organizationId);
  if(!access||!access.companyWide||!PEOPLE_ADMIN_ROLES.some(role=>role===access.role)||
    !await siteAuthorized(scope.organizationId,scope.worksiteId,access)){
    return Response.json({error:"Company People admin with exact worksite scope required."},{status:403,headers});
  }
  const mfa=requireSensitiveActionMfa(user);
  if(mfa)return mfa;
  const rate=await enforceSensitiveActionRateLimit(request,{
    userId:user.id,action:"wfm-square-sandbox-sync",
    resourceId:scope.organizationId,limit:2,windowMs:300_000,
  });
  if(rate)return rate;
  try{
    const window=squareDayWindow(scope.workDate);
    const aggregate=await readSquareSandboxDay({
      ...conn,workDate:scope.workDate,intervalMinutes:scope.intervalMinutes,
    });
    const existing=await loadOperationalDemandVersions({
      organizationId:scope.organizationId,worksiteId:scope.worksiteId,
      sourceKey:SQUARE_SANDBOX_SOURCE,metricKind:"transactions",
      intervalMinutes:scope.intervalMinutes,
      from:new Date(window.start),to:new Date(window.end),limit:1001,
    });
    if(existing.length>=1001)throw new SquareDemandSourceError("SOURCE_REVIEW");
    const selected=selectSquareDemandRevisions({
      aggregate,organizationId:scope.organizationId,worksiteId:scope.worksiteId,
      existing,
    });
    if(scope.dryRun){
      return Response.json({
        readOnly:true,applied:false,
        source:SQUARE_SANDBOX_SOURCE,workDate:scope.workDate,
        intervalMinutes:scope.intervalMinutes,
        completedPayments:aggregate.completedPayments,
        scannedPages:aggregate.pages,observedAsOf:aggregate.observedAsOf,
        changedIntervals:selected.changedIntervals,
        unchangedIntervals:selected.unchangedIntervals,
        boundary:aggregate.boundary,
      },{headers});
    }
    const written=selected.batch
      ?await writeOperationalDemandImport({
        batch:selected.batch,actorUserId:user.id,actorName:user.name,
      }):null;
    await db.insert(auditEvents).values({
      organizationId:scope.organizationId,
      actor:user.name.slice(0,120),
      action:"WFM Square sandbox source checked",
      resource:"worksite:"+scope.worksiteId,
      metadata:{
        sourceKey:SQUARE_SANDBOX_SOURCE,
        metricKind:"transactions",intervalMinutes:scope.intervalMinutes,
        workDate:scope.workDate,completedPayments:aggregate.completedPayments,
        scannedPages:aggregate.pages,observedAsOf:aggregate.observedAsOf,
        pointInTimeOnly:true,changedIntervals:selected.changedIntervals,
        importedBatchId:written?.batchId??null,
      },
    });
    return Response.json({
      applied:true,readOnly:false,
      source:SQUARE_SANDBOX_SOURCE,workDate:scope.workDate,
      intervalMinutes:scope.intervalMinutes,
      changedIntervals:selected.changedIntervals,
      unchangedIntervals:selected.unchangedIntervals,
      batchId:written?.batchId??null,replayed:written?.replayed??false,
      completedPayments:aggregate.completedPayments,
      scannedPages:aggregate.pages,observedAsOf:aggregate.observedAsOf,
      freshness:"source_reported_scan_only",
      boundary:aggregate.boundary+" Append-only aggregate revisions only; no schedule, employee or payroll mutation.",
    },{headers});
  }catch(error){
    if(error instanceof DemandImportConflict){
      return Response.json({error:"Aggregate source revision changed concurrently; review and retry."},{status:409,headers});
    }
    if(error instanceof SquareDemandSourceError){
      const status=error.code==="SOURCE_RATE_LIMITED"?429:
        error.code==="SOURCE_SCOPE"?409:503;
      return Response.json({error:error.message,code:error.code,
        boundary:"No partial Square sandbox source scan was imported."},
        {status,headers});
    }
    return Response.json({error:"Sandbox source sync unavailable; no response details recorded."},
      {status:503,headers});
  }
}
