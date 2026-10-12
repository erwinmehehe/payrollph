import { createHmac, randomUUID } from "node:crypto";
import { and, desc, eq, lte, isNull, gte, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, employeeWorksiteAssignments, worksiteGeofenceBoundaries, worksites, workforcePunchPhotoConsents, workforcePunchPhotoEvidence, workforcePunchSubmissions, worksitePunchPolicies } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership, assertOrganizationRole, getAccess, assertScope, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";
import { attendanceMutationLock, loadActiveAttendanceLocks } from "@/lib/workforce-attendance-lock";
import { markTimesheetsStaleForEmployeeDate } from "@/lib/workforce-timesheet-server";
import { reconcileAttendanceExceptionEvents } from "@/lib/workforce-attendance-exception-events";
import { authorizedGeofenceSites } from "@/lib/workforce-geofence-server";
import { evaluateGeofenceFix, geofencePilotEnabledForOrganization } from "@/lib/workforce-geofence";
import { encryptPunchPhoto, decryptPunchPhoto, stripJpegMetadata } from "@/lib/workforce-punch-photo-crypto";
import { enhancedPunchEnabled, photoCaptureDecision, photoExpiry, evaluatePunchTiming, impossibleTravel, PUNCH_CONSENT_VERSION, PUNCH_MAX_IMAGE_BYTES, PUNCH_ACTIONS, type PhotoMode } from "@/lib/workforce-punch-evidence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const respond = (value: unknown, status = 200) => Response.json(value, { status, headers });
function workDate(at: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year:"numeric", month:"2-digit", day:"2-digit" }).format(at);
}
function deviceHash(deviceId: string, organizationId: number) {
  const pepper = process.env.PUNCH_DEVICE_HASH_KEY;
  if (!pepper || pepper.length < 32) throw new Error("PUNCH_DEVICE_HASH_KEY is required.");
  return createHmac("sha256", pepper).update(String(organizationId)).update(":").update(deviceId).digest("hex");
}
async function employeeSession(organizationId: number) {
  const user = await getSessionUser();
  if (!user) return { denied: respond({ error:"Authentication required." }, 401), user:null, employee:null };
  if (user.role !== "employee" || !user.employeeId) return { denied: respond({ error:"Employee self-clock account required." }, 403), user, employee:null };
  const denied = await assertMembership(user.id, organizationId);
  if (denied) return { denied, user, employee:null };
  const [employee] = await db.select().from(employees).where(and(eq(employees.id,user.employeeId),eq(employees.organizationId,organizationId))).limit(1);
  return { denied: employee ? null : respond({ error:"Employee unavailable." },404), user, employee:employee??null };
}
async function sitePolicy(organizationId: number, employeeId: number, date: string) {
  const [primary] = await db.select({worksiteId:employeeWorksiteAssignments.worksiteId}).from(employeeWorksiteAssignments)
    .innerJoin(worksites,and(eq(worksites.id,employeeWorksiteAssignments.worksiteId),
      eq(worksites.organizationId,organizationId),eq(worksites.active,true)))
    .where(and(eq(employeeWorksiteAssignments.organizationId,organizationId),
      eq(employeeWorksiteAssignments.employeeId,employeeId),
      eq(employeeWorksiteAssignments.decision,"allow"),
      lte(employeeWorksiteAssignments.effectiveFrom,date),
      or(isNull(employeeWorksiteAssignments.effectiveUntil),gte(employeeWorksiteAssignments.effectiveUntil,date))))
    .orderBy(desc(employeeWorksiteAssignments.effectiveFrom),desc(employeeWorksiteAssignments.id)).limit(1);
  const siteId = primary?.worksiteId ?? null;
  const [policy] = siteId === null ? [null] : await db.select().from(worksitePunchPolicies)
    .where(and(eq(worksitePunchPolicies.organizationId,organizationId),eq(worksitePunchPolicies.worksiteId,siteId))).limit(1);
  const sites = geofencePilotEnabledForOrganization(organizationId)
    ? await authorizedGeofenceSites(organizationId, employeeId, date) : [];
  return {photoMode: (policy?.photoMode ?? "off") as PhotoMode,worksiteId:siteId,sites};
}

export async function GET(request: Request) {
  if (!enhancedPunchEnabled()) return respond({ error:"Not found." },404);
  const params = new URL(request.url).searchParams;
  const organizationId = Number(params.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return respond({error:"Invalid employer."},400);
  const context = await employeeSession(organizationId);
  if (context.denied) return context.denied;
  const employeeId = context.employee!.id;
  const date = workDate(new Date());
  const [consent] = await db.select().from(workforcePunchPhotoConsents).where(and(
    eq(workforcePunchPhotoConsents.organizationId,organizationId),
    eq(workforcePunchPhotoConsents.employeeId,employeeId),
    eq(workforcePunchPhotoConsents.consentVersion,PUNCH_CONSENT_VERSION))).limit(1);
  const {photoMode,worksiteId} = await sitePolicy(organizationId,employeeId,date);
  const pending = await db.select({
    id:workforcePunchSubmissions.id,actionType:workforcePunchSubmissions.actionType,
    serverReceivedAt:workforcePunchSubmissions.serverReceivedAt,
    deviceOccurredAt:workforcePunchSubmissions.deviceOccurredAt,
    flags:workforcePunchSubmissions.flags,status:workforcePunchSubmissions.status,
  }).from(workforcePunchSubmissions).where(and(
    eq(workforcePunchSubmissions.organizationId,organizationId),
    eq(workforcePunchSubmissions.employeeId,employeeId),
    eq(workforcePunchSubmissions.status,"pending"),
  )).orderBy(desc(workforcePunchSubmissions.id)).limit(20);
  return respond({ enabled:true, photoMode,worksiteId,geofenceRequired:geofencePilotEnabledForOrganization(organizationId),consent:consent?.choice??null,
    consentVersion:PUNCH_CONSENT_VERSION,retentionDays:90,pending });
}
export async function POST(request: Request) {
  if (!enhancedPunchEnabled()) return respond({error:"Not found."},404);
  const origin = enforceSameOriginMutation(request); if(origin) return origin;
  const form=await request.formData().catch(()=>null);
  if(!form) return respond({error:"Invalid punch submission."},400);
  const organizationId=Number(form.get("organizationId"));
  if(!Number.isSafeInteger(organizationId)||organizationId<=0) return respond({error:"Invalid employer."},400);
  const context=await employeeSession(organizationId);if(context.denied) return context.denied;
  const {user,employee}=context;
  const limited=await enforceSensitiveActionRateLimit(request,{userId:user!.id,action:"wfm-punch-evidence",resourceId:organizationId,limit:30,windowMs:5*60_000});
  if(limited) return limited;
  const action=String(form.get("actionType")??"");
  if(!PUNCH_ACTIONS.some(valid=>valid===action)) return respond({error:"Invalid action."},400);
  const clientPunchId=String(form.get("clientPunchId")??"");
  const deviceId=String(form.get("deviceId")??"");
  const source=form.get("source")==="offline" ? "offline" : "online";
  const deviceOccurredAt=String(form.get("deviceOccurredAt")??"");
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(clientPunchId)||!/^[0-9a-f-]{36}$/i.test(deviceId))return respond({error:"Invalid device or punch identifier."},400);
  const now=new Date();
  const flags=PUNCH_ACTIONS.includes(action as typeof PUNCH_ACTIONS[number])?evaluatePunchTiming(deviceOccurredAt,now,source):[];
  if(flags.includes("time-invalid")) return respond({error:"Device timestamp must be valid and within the allowed offline window. Ask HR for a manual review."},422);
  const date=workDate(new Date(deviceOccurredAt));
  const attendanceLock=attendanceMutationLock(await loadActiveAttendanceLocks(organizationId),date,"capture");
  if(attendanceLock) return respond({error:"Attendance period is locked. Request a reviewed correction.",code:"ATTENDANCE_PERIOD_LOCKED"},423);
  const [existing]=await db.select({id:workforcePunchSubmissions.id,status:workforcePunchSubmissions.status})
    .from(workforcePunchSubmissions).where(and(eq(workforcePunchSubmissions.organizationId,organizationId),
      eq(workforcePunchSubmissions.employeeId,employee!.id),eq(workforcePunchSubmissions.clientPunchId,clientPunchId))).limit(1);
  if(existing)return respond({ok:true,id:existing.id,status:existing.status,duplicate:true});
  const {photoMode,worksiteId,sites}=await sitePolicy(organizationId,employee!.id,date);
  if(geofencePilotEnabledForOrganization(organizationId)&&(action==="clock_in"||action==="clock_out")) {
    // Never accept stale offline raw GPS as valid location proof.
    if(source==="offline") flags.push("clock-skew");
    else {
      const geoRaw=form.get("geolocation");
      let geo: unknown = null;
      if (typeof geoRaw === "string") { try { geo=JSON.parse(geoRaw); } catch { return respond({error:"Invalid location evidence."},422); } }
      const decision=evaluateGeofenceFix({fix:geo,sites,now:now.getTime()});
      if(!decision.ok)return respond({error:decision.error,code:decision.code},422);
    }
  }
  const [consent]=await db.select().from(workforcePunchPhotoConsents).where(and(
    eq(workforcePunchPhotoConsents.organizationId,organizationId),eq(workforcePunchPhotoConsents.employeeId,employee!.id),
    eq(workforcePunchPhotoConsents.consentVersion,PUNCH_CONSENT_VERSION))).limit(1);
  const file=form.get("photo");
  const hasPhoto=file instanceof File && file.size>0;
  const captureDecision=photoCaptureDecision(photoMode,consent?.choice??null,hasPhoto);
  flags.push(...captureDecision.flags);
  let encrypted: string|null=null;
  if(captureDecision.capture && file instanceof File) {
    if(file.size>PUNCH_MAX_IMAGE_BYTES||file.type!=="image/jpeg")return respond({error:"Only JPEG photos smaller than 512 KB are accepted."},413);
    try {const bytes=stripJpegMetadata(new Uint8Array(await file.arrayBuffer()));encrypted=encryptPunchPhoto(bytes);}
    catch{return respond({error:"Cannot securely validate/encrypt selfie evidence."},503);}
  }
  let digest:string;
  try { digest=deviceHash(deviceId,organizationId); }
  catch{return respond({error:"Device privacy configuration is unavailable."},503);}
  const [sameDevice]=await db.select({employeeId:workforcePunchSubmissions.employeeId}).from(workforcePunchSubmissions)
    .where(and(eq(workforcePunchSubmissions.organizationId,organizationId),eq(workforcePunchSubmissions.deviceDigest,digest),
      ne(workforcePunchSubmissions.employeeId,employee!.id))).limit(1);
  if(sameDevice)flags.push("shared-device");
  // Impossible travel is computed only from employer-managed site centres, not device GPS history.
  const [prior]=await db.select({siteId:workforcePunchSubmissions.worksiteId,at:workforcePunchSubmissions.deviceOccurredAt})
    .from(workforcePunchSubmissions).where(and(eq(workforcePunchSubmissions.organizationId,organizationId),
      eq(workforcePunchSubmissions.employeeId,employee!.id),sql`${workforcePunchSubmissions.worksiteId} is not null`))
    .orderBy(desc(workforcePunchSubmissions.deviceOccurredAt)).limit(1);
  if(prior?.siteId&&worksiteId&&prior.siteId!==worksiteId) {
    const points=await db.select().from(worksiteGeofenceBoundaries).where(and(
      eq(worksiteGeofenceBoundaries.organizationId,organizationId),
      or(eq(worksiteGeofenceBoundaries.worksiteId,prior.siteId),eq(worksiteGeofenceBoundaries.worksiteId,worksiteId))));
    const a=points.find(p=>p.worksiteId===prior.siteId),b=points.find(p=>p.worksiteId===worksiteId);
    if(a&&b&&impossibleTravel({worksiteId:a.worksiteId,latitude:Number(a.latitude),longitude:Number(a.longitude),at:prior.at},
      {worksiteId:b.worksiteId,latitude:Number(b.latitude),longitude:Number(b.longitude),at:new Date(deviceOccurredAt)}))flags.push("impossible-travel");
  }
  const photoId=encrypted?randomUUID():null;
  // Both evidence and staged submission commit together; no payable punch mutation occurs here.
  const id=await db.transaction(async tx=>{
    if(photoId&&encrypted)await tx.insert(workforcePunchPhotoEvidence).values({
      id:photoId,organizationId,employeeId:employee!.id,sealedPhoto:encrypted,expiresAt:photoExpiry(now),
    });
    const [created]=await tx.insert(workforcePunchSubmissions).values({
      organizationId,employeeId:employee!.id,clientPunchId,actionType:action,workDate:date,
      deviceOccurredAt:new Date(deviceOccurredAt),serverReceivedAt:now,receivedSource:source,
      worksiteId,photoEvidenceId:photoId,deviceDigest:digest,flags:[...new Set(flags)],
      requestedByUserId:user!.id,
    }).onConflictDoNothing().returning({id:workforcePunchSubmissions.id});
    if(created)return created.id;
    const [duplicate]=await tx.select({id:workforcePunchSubmissions.id}).from(workforcePunchSubmissions).where(and(
      eq(workforcePunchSubmissions.organizationId,organizationId),eq(workforcePunchSubmissions.employeeId,employee!.id),
      eq(workforcePunchSubmissions.clientPunchId,clientPunchId))).limit(1);
    if(!duplicate)throw new Error("Punch conflict.");
    if(photoId)await tx.delete(workforcePunchPhotoEvidence).where(eq(workforcePunchPhotoEvidence.id,photoId));
    return duplicate.id;
  });
  await recordAuditEvent({organizationId,actor:user!.name,action:"Enhanced Web Bundy punch queued for independent review",
    resource:employee!.employeeNo,metadata:{submissionId:id,action,workDate:date,flags:[...new Set(flags)],photoEvidenceId:photoId}});
  return respond({ok:true,id,status:"pending",flags:[...new Set(flags)],message:"Punch received; awaiting independent human review."},202);
}
