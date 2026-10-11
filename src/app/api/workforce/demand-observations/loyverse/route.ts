import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents, workforceDemandImportBatches, worksites,
} from "@/db/schema";
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
  LOYVERSE_WFM_SOURCE, LoyverseSourceError,
  loyverseConnection, loyversePilotEnabled, loyverseReceiptWindow,
  readLoyversePosDay, prepareLoyverseRevisions, parseLoyverseSyncRequest,
  recordLoyverseScanConfirmation,
} from "@/lib/workforce-loyverse-pos";

export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
const success="WFM Loyverse POS historical source scan succeeded";
const failure="WFM Loyverse POS historical source scan failed";
const attempted="WFM Loyverse POS historical source scan started";

async function siteAuthorized(org:number,site:number,access:{
  organizationId:number;companyWide:boolean;orgUnitId:number|null;
}) {
  const [row]=await db.select({
    organizationId:worksites.organizationId,orgUnitId:worksites.orgUnitId,
    active:worksites.active,timezone:worksites.timezone,
  }).from(worksites).where(and(
    eq(worksites.organizationId,org),eq(worksites.id,site),
  )).limit(1);
  return !!row && row.timezone==="Asia/Manila"&&
    operationalDemandSiteAuthorized(access,row);
}
export async function GET(request:Request) {
  const user=await getSessionUser();
  if(!user)return Response.json({error:"Authentication required."},{status:401,headers});
  const query=new URL(request.url).searchParams;
  const organizationId=Number(query.get("organizationId")??"");
  const worksiteId=Number(query.get("worksiteId")??"");
  const intervalMinutes=Number(query.get("intervalMinutes")??"");
  if(!validReceiptId(organizationId)||!validReceiptId(worksiteId)||
    ![15,30,60].includes(intervalMinutes)){
    return Response.json({error:"Exact employer, worksite and interval required."},{status:400,headers});
  }
  if(!operationalDemandPilotAllowed(organizationId)||
    !loyversePilotEnabled(organizationId)||
    !loyverseConnection(organizationId,worksiteId)) {
    return Response.json({error:"Consented POS source is not configured for employer/worksite."},{status:404,headers});
  }
  const access=await getAccess(user.id,organizationId);
  if(!access||!WORKFORCE_MANAGER_ROLES.some(role=>role===access.role)||
    !await siteAuthorized(organizationId,worksiteId,access)) {
    return Response.json({error:"Scoped workforce manager access required."},{status:403,headers});
  }
  try {
    const [lastImport]=await db.select({
      importedAt:workforceDemandImportBatches.importedAt,
      rowCount:workforceDemandImportBatches.rowCount,
    }).from(workforceDemandImportBatches).where(and(
      eq(workforceDemandImportBatches.organizationId,organizationId),
      eq(workforceDemandImportBatches.worksiteId,worksiteId),
      eq(workforceDemandImportBatches.sourceKey,LOYVERSE_WFM_SOURCE),
      eq(workforceDemandImportBatches.intervalMinutes,intervalMinutes),
    )).orderBy(desc(workforceDemandImportBatches.importedAt)).limit(1);
    const audits=await db.select({
      action:auditEvents.action,createdAt:auditEvents.createdAt,metadata:auditEvents.metadata,
    }).from(auditEvents).where(and(
      eq(auditEvents.organizationId,organizationId),
      eq(auditEvents.resource,"worksite:"+worksiteId),
      inArray(auditEvents.action,[attempted,success,failure]),
      sql`${auditEvents.metadata}->>'sourceKey' = ${LOYVERSE_WFM_SOURCE}`,
      sql`${auditEvents.metadata}->>'intervalMinutes' = ${String(intervalMinutes)}`,
    )).orderBy(desc(auditEvents.createdAt)).limit(80);
    const lastCheck=audits.find(a=>a.action===success);
    const lastAttempt=audits.find(a=>a.action===attempted);
    const lastFailure=audits.find(a=>a.action===failure);
    const scanDate=(a:typeof audits[number]|undefined)=>typeof
      (a?.metadata as Record<string,unknown>|undefined)?.workDate==="string"?
      (a!.metadata as {workDate:string}).workDate:null;
    const isStale=!lastCheck||!lastAttempt||
      lastAttempt.createdAt>lastCheck.createdAt;
    return Response.json({
      readOnly:true,
      scope:{organizationId,worksiteId,intervalMinutes,
        sourceKey:LOYVERSE_WFM_SOURCE,metricKind:"transactions"},
      lastStoredImportAt:lastImport?.importedAt.toISOString()??null,
      lastStoredRevisionRows:lastImport?.rowCount??null,
      lastAttemptAt:lastAttempt?.createdAt.toISOString()??null,
      lastSuccessfulScanAt:lastCheck?.createdAt.toISOString()??null,
      lastSuccessfulWorkDate:scanDate(lastCheck),
      lastFailedScanAt:lastFailure?.createdAt.toISOString()??null,
      status:isStale?"source_review":"source_reported_only",
      boundary:"POS receipt scans are locally observed, not independently final, fiscal-certified or live-payroll evidence.",
    },{headers});
  }catch{
    return Response.json({error:"POS source receipt audit or migration unavailable."},{status:503,headers});
  }
}
export async function POST(request:Request) {
  const denied=enforceSameOriginMutation(request);
  if(denied)return denied;
  const user=await getSessionUser();
  if(!user)return Response.json({error:"Authentication required."},{status:401,headers});
  const demo=publicDemoMutationDenied(user.email,"WFM Loyverse source import");
  if(demo)return demo;
  const body=await request.text().catch(()=>"");
  if(Buffer.byteLength(body,"utf8")>2048)
    return Response.json({error:"Source request too large."},{status:413,headers});
  let scoped;
  try{scoped=parseLoyverseSyncRequest(JSON.parse(body));}
  catch{return Response.json({error:"Exact, acknowledged historical POS sync request required."},{status:400,headers});}
  if(!operationalDemandPilotAllowed(scoped.organizationId)||
    !loyversePilotEnabled(scoped.organizationId)) {
    return Response.json({error:"POS source pilot is off for this employer."},{status:404,headers});
  }
  const connection=loyverseConnection(scoped.organizationId,scoped.worksiteId);
  if(!connection)return Response.json({error:"Merchant OAuth or store consent mapping unavailable."},{status:404,headers});
  const access=await getAccess(user.id,scoped.organizationId);
  if(!access||!access.companyWide||!PEOPLE_ADMIN_ROLES.some(role=>role===access.role)||
    !await siteAuthorized(scoped.organizationId,scoped.worksiteId,access)) {
    return Response.json({error:"Company-wide People admin and exact active PH worksite access required."},{status:403,headers});
  }
  const mfa=requireSensitiveActionMfa(user);
  if(mfa)return mfa;
  const limit=await enforceSensitiveActionRateLimit(request,{
    userId:user.id,action:"wfm-loyverse-pos-sync",resourceId:scoped.organizationId,
    limit:2,windowMs:300000,
  });
  if(limit)return limit;
  const meta={
    sourceKey:LOYVERSE_WFM_SOURCE,workDate:scoped.workDate,
    intervalMinutes:scoped.intervalMinutes,
    metricKind:"transactions",dryRun:scoped.dryRun,
  };
  const audit=async(action:string,other:Record<string,unknown>={})=>{
    await db.insert(auditEvents).values({
      organizationId:scoped.organizationId,actor:user.name.slice(0,120),
      action,resource:"worksite:"+scoped.worksiteId,
      metadata:{...meta,...other},
    });
  };
  try {
    const window=loyverseReceiptWindow(scoped.workDate);
    if(!scoped.dryRun)await audit(attempted);
    const aggregate=await readLoyversePosDay({
      ...connection,workDate:scoped.workDate,intervalMinutes:scoped.intervalMinutes,
    });
    const existing=await loadOperationalDemandVersions({
      organizationId:scoped.organizationId,worksiteId:scoped.worksiteId,
      sourceKey:LOYVERSE_WFM_SOURCE,metricKind:"transactions",
      intervalMinutes:scoped.intervalMinutes,
      from:new Date(window.start),to:new Date(window.end),limit:1001,
    });
    if(existing.length>=1001)throw new LoyverseSourceError("SOURCE_REVIEW");
    const prepared=prepareLoyverseRevisions({
      aggregate,organizationId:scoped.organizationId,worksiteId:scoped.worksiteId,
      existing,
    });
    if(scoped.dryRun){
      return Response.json({
        readOnly:true,applied:false,source:LOYVERSE_WFM_SOURCE,
        workDate:scoped.workDate,intervalMinutes:scoped.intervalMinutes,
        countedSales:aggregate.countedSales,
        scannedReceipts:aggregate.scannedReceipts,
        scannedPages:aggregate.pages,
        scope:{organizationId:scoped.organizationId,worksiteId:scoped.worksiteId},
        intervalCounts:aggregate.counts,
        changedIntervals:prepared.changed,unchangedIntervals:prepared.unchanged,
        observedAsOf:aggregate.observedAsOf,boundary:aggregate.boundary,
      },{headers});
    }
    const wrote=prepared.batch
      ?await writeOperationalDemandImport({
        batch:prepared.batch,actorUserId:user.id,actorName:user.name,
      }):null;
    // writeOperationalDemandImport commits aggregate revisions and their audit
    // atomically. A *separate* freshness receipt failure cannot make a
    // successfully committed import appear rejected to the operator.
    const scanAuditRecorded=await recordLoyverseScanConfirmation(()=>audit(success,{
      countedSales:aggregate.countedSales,scannedReceipts:aggregate.scannedReceipts,
      scannedPages:aggregate.pages,observedAsOf:aggregate.observedAsOf,
      changedIntervals:prepared.changed,unchangedIntervals:prepared.unchanged,
      importBatchId:wrote?.batchId??null,pointInTimeOnly:true,
    }));
    return Response.json({
      readOnly:false,applied:true,source:LOYVERSE_WFM_SOURCE,
      workDate:scoped.workDate,intervalMinutes:scoped.intervalMinutes,
      countedSales:aggregate.countedSales,scannedReceipts:aggregate.scannedReceipts,
      scannedPages:aggregate.pages,changedIntervals:prepared.changed,
      unchangedIntervals:prepared.unchanged,importBatchId:wrote?.batchId??null,
      replayed:wrote?.replayed??false,observedAsOf:aggregate.observedAsOf,
      freshness:"source_reported_only",sourceAuditRecorded:scanAuditRecorded,
      boundary:aggregate.boundary+
        (scanAuditRecorded?" Source approval does not authorize shifts, attendance, payroll or payment.":
          " Historical import result is recorded, but scan-freshness audit failed; review source status. No shift, payroll or payment was authorized."),
    },{headers});
  }catch(error){
    if(!scoped.dryRun){
      const reason=error instanceof LoyverseSourceError?error.code:
        error instanceof DemandImportConflict?"SOURCE_REVIEW":"SOURCE_UNAVAILABLE";
      // Non-sensitive failure metadata is append-only; audit errors never mask
      // a failure and cannot convert it to success.
      await audit(failure,{reason}).catch(()=>undefined);
    }
    if(error instanceof DemandImportConflict){
      return Response.json({error:"Source revision changed concurrently. Review and retry."},{status:409,headers});
    }
    if(error instanceof LoyverseSourceError){
      return Response.json({error:error.message,code:error.code},{
        status:error.code==="SOURCE_RATE_LIMITED"?429:
          error.code==="SOURCE_SCOPE"?409:503,headers,
      });
    }
    return Response.json({error:"POS source unavailable; no provider payload retained."},{status:503,headers});
  }
}