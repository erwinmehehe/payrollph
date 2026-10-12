import { createHmac, randomUUID } from "node:crypto";
import { and, desc, eq, lte, isNull, gte, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employees, employeeWorksiteAssignments, worksiteGeofenceBoundaries, worksites, workforcePunchPhotoConsents, workforcePunchPhotoEvidence, workforcePunchSubmissions, worksitePunchPolicies } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership } from "@/lib/access";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit } from "@/lib/security-request";
import { attendanceMutationLock, loadActiveAttendanceLocks } from "@/lib/workforce-attendance-lock";
import { authorizedGeofenceSites } from "@/lib/workforce-geofence-server";
import { evaluateGeofenceFix, geofencePilotEnabledForOrganization } from "@/lib/workforce-geofence";
import { encryptPunchPhoto, stripJpegMetadata } from "@/lib/workforce-punch-photo-crypto";
import { documentUploadsEnabled, scanUpload } from "@/lib/storage";
import { enhancedPunchEnabled, enhancedPunchEnabledForOrganization, photoCaptureDecision, photoExpiry, evaluatePunchTiming, impossibleTravel, resolvedWorksiteDecision, PUNCH_CONSENT_VERSION, PUNCH_MAX_IMAGE_BYTES, PUNCH_ACTIONS, validPunchUuid, type PhotoMode } from "@/lib/workforce-punch-evidence";

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
  // Determine the latest effective assignment before filtering worksite activity:
  // otherwise an inactive newer deny would be hidden and expose an old allow.
  const [primary] = await db.select({
    worksiteId: employeeWorksiteAssignments.worksiteId,
    decision: employeeWorksiteAssignments.decision,
  }).from(employeeWorksiteAssignments)
    .where(and(eq(employeeWorksiteAssignments.organizationId,organizationId),
      eq(employeeWorksiteAssignments.employeeId,employeeId),
      lte(employeeWorksiteAssignments.effectiveFrom,date),
      or(isNull(employeeWorksiteAssignments.effectiveUntil),gte(employeeWorksiteAssignments.effectiveUntil,date))))
    .orderBy(desc(employeeWorksiteAssignments.effectiveFrom),desc(employeeWorksiteAssignments.id)).limit(1);
  const selectedSiteId = resolvedWorksiteDecision(primary ? [primary] : []);
  const [activeSite] = selectedSiteId === null ? [null] : await db.select({id:worksites.id})
    .from(worksites).where(and(eq(worksites.id,selectedSiteId),
      eq(worksites.organizationId,organizationId),eq(worksites.active,true))).limit(1);
  const siteId = activeSite?.id ?? null;
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
  if (!enhancedPunchEnabledForOrganization(organizationId)) return respond({error:"Not found."},404);
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
  if(!enhancedPunchEnabledForOrganization(organizationId)) return respond({error:"Not found."},404);
  const context=await employeeSession(organizationId);if(context.denied) return context.denied;
  const {user,employee}=context;
  // A shared browser can retain queues from several workers. Do not replay a
  // former employee's local action into the currently authenticated account.
  const claimedEmployeeId=form.get("employeeId");
  if(claimedEmployeeId!==null&&(
    !/^\d+$/.test(String(claimedEmployeeId))||
    Number(claimedEmployeeId)!==employee!.id
  ))return respond({error:"Queued punch belongs to another worker. Sign in as its owner or request HR correction."},403);
  const limited=await enforceSensitiveActionRateLimit(request,{userId:user!.id,action:"wfm-punch-evidence",resourceId:organizationId,limit:30,windowMs:5*60_000});
  if(limited) return limited;
  const action=String(form.get("actionType")??"");
  if(!PUNCH_ACTIONS.some(valid=>valid===action)) return respond({error:"Invalid action."},400);
  const clientPunchId=String(form.get("clientPunchId")??"");
  const deviceId=String(form.get("deviceId")??"");
  const rawSource=form.get("source");
  if(rawSource!=="offline"&&rawSource!=="online")return respond({error:"Invalid punch source."},400);
  const source=rawSource;
  const deviceOccurredAt=String(form.get("deviceOccurredAt")??"");
  if(!validPunchUuid(clientPunchId)||!validPunchUuid(deviceId))
    return respond({error:"Invalid device or punch identifier."},400);
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
    if(source==="offline") flags.push("geofence-unverified");
    else {
      const geoRaw=form.get("geolocation");
      let geo: unknown = null;
      if (typeof geoRaw === "string") { try { geo=JSON.parse(geoRaw); } catch { return respond({error:"Invalid location evidence."},422); } }
      const decision=evaluateGeofenceFix({fix:geo,sites,now:now.getTime()});
      if(!decision.ok)return respond({error:decision.error,code:decision.code},422);
      flags.push("geofence-verified");
    }
  }
  const [consent]=await db.select().from(workforcePunchPhotoConsents).where(and(
    eq(workforcePunchPhotoConsents.organizationId,organizationId),eq(workforcePunchPhotoConsents.employeeId,employee!.id),
    eq(workforcePunchPhotoConsents.consentVersion,PUNCH_CONSENT_VERSION))).limit(1);
  const file=form.get("photo");
  const hasPhoto=file instanceof File && file.size>0;
  // Drizzle persists a generic string; an unexpected value must fail closed.
  const rawChoice = consent?.choice;
  const choice = rawChoice === "accepted" || rawChoice === "declined" ? rawChoice : null;
  const captureDecision = photoCaptureDecision(photoMode, choice, hasPhoto);
  flags.push(...captureDecision.flags);
  let encrypted: string|null=null;
  if(captureDecision.capture && file instanceof File) {
    if(file.size>PUNCH_MAX_IMAGE_BYTES||file.size<1||file.type!=="image/jpeg")
      return respond({error:"Only JPEG photos smaller than 512 KB are accepted."},413);
    if(!documentUploadsEnabled())
      return respond({error:"Secure photo upload and malware scanning are not enabled."},503);
    let bytes:Uint8Array;
    try { bytes=stripJpegMetadata(new Uint8Array(await file.arrayBuffer())); }
    catch{return respond({error:"Invalid JPEG image evidence."},422);}
    // Scan sanitized pixels BEFORE encrypting or saving. An unavailable scanner
    // fails closed; never let evidence bypass the document security boundary.
    const scan=await scanUpload(bytes,{fileName:"punch-evidence.jpg",mime:"image/jpeg"});
    if(!scan.scannedClean||scan.unavailable)
      return respond({error:"Photo evidence malware scan is unavailable or rejected the image."},503);
    try { encrypted=encryptPunchPhoto(bytes); }
    catch{return respond({error:"Cannot encrypt selfie evidence."},503);}
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
  // Evidence, submission and its immutable audit receipt commit or roll back together.
  const result=await db.transaction(async tx=>{
    let retainedPhotoId=photoId;
    if(retainedPhotoId) {
      // Consent withdrawal obtains this same transaction-scoped lock. Recheck
      // after scanning so a withdrawn selfie is never persisted on a race.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(6108, ${organizationId})`);
      const [latestConsent]=await tx.select({choice:workforcePunchPhotoConsents.choice})
        .from(workforcePunchPhotoConsents).where(and(
          eq(workforcePunchPhotoConsents.organizationId,organizationId),
          eq(workforcePunchPhotoConsents.employeeId,employee!.id),
          eq(workforcePunchPhotoConsents.consentVersion,PUNCH_CONSENT_VERSION),
        )).for("update").limit(1);
      if(latestConsent?.choice!=="accepted") {
        retainedPhotoId=null;
        flags.push("consent-declined");
      }
      // This is serialized with company-wide policy mutation in the same
      // organization advisory lock. Photo withdrawal and a policy switch to
      // "off" never leave post-change encrypted images behind.
      if(retainedPhotoId){
        const [liveSitePolicy]=await tx.select({photoMode:worksitePunchPolicies.photoMode})
          .from(worksitePunchPolicies).where(and(
            eq(worksitePunchPolicies.organizationId,organizationId),
            eq(worksitePunchPolicies.worksiteId,worksiteId!),
          )).limit(1);
        if(liveSitePolicy?.photoMode!=="optional"&&liveSitePolicy?.photoMode!=="required"){
          retainedPhotoId=null;
          flags.push("photo-policy-changed");
        }
      }
    }
    if(retainedPhotoId&&encrypted)await tx.insert(workforcePunchPhotoEvidence).values({
      id:retainedPhotoId,organizationId,employeeId:employee!.id,sealedPhoto:encrypted,expiresAt:photoExpiry(now),
    });
    const finalFlags=[...new Set(flags)];
    const [created]=await tx.insert(workforcePunchSubmissions).values({
      organizationId,employeeId:employee!.id,clientPunchId,actionType:action,workDate:date,
      deviceOccurredAt:new Date(deviceOccurredAt),serverReceivedAt:now,receivedSource:source,
      worksiteId,photoEvidenceId:retainedPhotoId,deviceDigest:digest,flags:finalFlags,
      requestedByUserId:user!.id,
    }).onConflictDoNothing().returning({id:workforcePunchSubmissions.id});
    if(created) {
      // A staged punch must not be visible without its audit event.
      await tx.insert(auditEvents).values({
        organizationId,actor:user!.name,action:"Enhanced Web Bundy punch queued for independent review",
        resource:employee!.employeeNo,metadata:{
          submissionId:created.id,action,workDate:date,flags:finalFlags,photoEvidenceId:retainedPhotoId,
        },
      });
      return {id:created.id,status:"pending",flags:finalFlags,duplicate:false};
    }
    const [duplicate]=await tx.select({
      id:workforcePunchSubmissions.id,status:workforcePunchSubmissions.status,flags:workforcePunchSubmissions.flags,
    }).from(workforcePunchSubmissions).where(and(
      eq(workforcePunchSubmissions.organizationId,organizationId),eq(workforcePunchSubmissions.employeeId,employee!.id),
      eq(workforcePunchSubmissions.clientPunchId,clientPunchId))).limit(1);
    if(!duplicate)throw new Error("Punch conflict.");
    if(retainedPhotoId)await tx.delete(workforcePunchPhotoEvidence)
      .where(eq(workforcePunchPhotoEvidence.id,retainedPhotoId));
    // A racing retry neither creates a duplicate audit event nor misstates a reviewed punch.
    return {id:duplicate.id,status:duplicate.status,flags:duplicate.flags,duplicate:true};
  });
  return respond({ok:true,id:result.id,status:result.status,flags:result.flags,duplicate:result.duplicate,
    message:result.duplicate?"Existing submission returned.":"Punch received; awaiting independent human review."},
    result.duplicate?200:202);
}
