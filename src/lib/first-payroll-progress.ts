import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { firstPayrollJourneyProgress } from "@/db/schema";
import { getAccess } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { FIRST_PAYROLL_STEPS, type FirstPayrollKey } from "./first-payroll-journey";
export type JourneyOwner = "owner" | "admin" | "hr" | "payroll" | "checker" | "bookkeeper";
export function isJourneyKey(value: unknown): value is FirstPayrollKey {
 return typeof value === "string" && FIRST_PAYROLL_STEPS.some(step => step.key === value);
}
export function canOwnJourneyStep(key: FirstPayrollKey, role: string) {
 const allowed: Record<FirstPayrollKey, string[]> = {
  company:["owner","admin"], people:["owner","admin","hr"],
  time:["hr","manager"], reviewers:["owner","admin"], payroll:["payroll","owner","admin","bookkeeper"],
  approval:["checker"], exports:["owner","admin","bookkeeper","payroll"]
 };
 return allowed[key].includes(role);
}
export async function readJourneyProgress(organizationId: number) {
 const [record] = await db.select().from(firstPayrollJourneyProgress)
  .where(eq(firstPayrollJourneyProgress.organizationId, organizationId)).limit(1);
 return record ?? null;
}
export async function saveJourneyProgress(input: { organizationId:number; userId:number; userName:string; role:string;
  key:FirstPayrollKey; action:"handoff"|"time_review"; targetRole?:JourneyOwner }) {
 const {organizationId,key,userId,role}=input;
 const access=await getAccess(userId, organizationId);
 if (!access?.companyWide) throw Error("Company-wide access required");
 if (input.action === "time_review" && (key !== "time" || !["hr","manager"].includes(role)))
   throw Error("An authorized HR reviewer must complete the time check");
 if (input.action === "handoff" && (!canOwnJourneyStep(key, input.targetRole ?? "") ||
    !["owner","admin","hr","payroll","bookkeeper","checker"].includes(role))) throw Error("Invalid handoff");
 const previous=await readJourneyProgress(organizationId);
 const owners={...(previous?.stepOwners ?? {})};
 const completed={...(previous?.completedSteps ?? {})};
 if (input.action==="handoff") owners[key]=input.targetRole!;
 else completed.time={ byUserId:userId, at:new Date().toISOString() };
 await db.insert(firstPayrollJourneyProgress).values({
   organizationId,stepOwners:owners,completedSteps:completed,
   reviewedByUserId:input.action==="time_review"?userId:previous?.reviewedByUserId,
   reviewedAt:input.action==="time_review"?new Date():previous?.reviewedAt,
   updatedByUserId:userId,
 }).onConflictDoUpdate({target:firstPayrollJourneyProgress.organizationId,set:{
   stepOwners:owners,completedSteps:completed,
   reviewedByUserId:input.action==="time_review"?userId:previous?.reviewedByUserId,
   reviewedAt:input.action==="time_review"?new Date():previous?.reviewedAt,
   updatedByUserId:userId,updatedAt:new Date(),
 }});
 await recordAuditEvent({organizationId,actor:input.userName,action:input.action==="time_review"?"First payroll time handoff reviewed":"First payroll step handed off",
   resource:key,metadata:{step:key,role:input.targetRole ?? role}});
}
