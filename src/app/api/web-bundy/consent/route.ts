import { and,eq } from "drizzle-orm";
import { db } from "@/db";
import { employees,workforcePunchPhotoConsents } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership } from "@/lib/access";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { enhancedPunchEnabled,PUNCH_CONSENT_VERSION } from "@/lib/workforce-punch-evidence";
export const dynamic="force-dynamic";
export async function POST(request:Request) {
  if(!enhancedPunchEnabled())return Response.json({error:"Not found."},{status:404});
  const origin=enforceSameOriginMutation(request);if(origin)return origin;
  const user=await getSessionUser();
  if(!user||user.role!=="employee"||!user.employeeId)return Response.json({error:"Employee login required."},{status:403});
  const body=await request.json().catch(()=>({}));
  const org=Number(body.organizationId),choice=body.choice;
  if(!Number.isSafeInteger(org)||org<=0||!["accepted","declined"].includes(choice))return Response.json({error:"Invalid consent decision."},{status:400});
  const denied=await assertMembership(user.id,org);if(denied)return denied;
  const [employee]=await db.select({id:employees.id}).from(employees).where(and(eq(employees.id,user.employeeId),eq(employees.organizationId,org))).limit(1);
  if(!employee)return Response.json({error:"Employee not found."},{status:404});
  // Store the first choice. A later acceptance requires privacy-reviewed change workflow.
  const [created]=await db.insert(workforcePunchPhotoConsents).values({organizationId:org,employeeId:employee.id,
    consentVersion:PUNCH_CONSENT_VERSION,choice,decidedByUserId:user.id}).onConflictDoNothing().returning({choice:workforcePunchPhotoConsents.choice});
  const [saved]=created?[created]:await db.select({choice:workforcePunchPhotoConsents.choice}).from(workforcePunchPhotoConsents).where(and(
    eq(workforcePunchPhotoConsents.organizationId,org),eq(workforcePunchPhotoConsents.employeeId,employee.id),
    eq(workforcePunchPhotoConsents.consentVersion,PUNCH_CONSENT_VERSION))).limit(1);
  return Response.json({ok:true,choice:saved.choice},{headers:{"Cache-Control":"no-store"}});
}
