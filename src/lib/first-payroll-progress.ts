import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, firstPayrollJourneyProgress, legalEntities, userOrganizations } from "@/db/schema";
import { getAccess } from "@/lib/access";
import { parseMigrationDate } from "./migration-date";
import { FIRST_PAYROLL_STEPS, type FirstPayrollKey } from "./first-payroll-journey";

export type JourneyOwner = "owner" | "hr" | "payroll" | "checker" | "bookkeeper";
export function isJourneyKey(value: unknown): value is FirstPayrollKey {
  return typeof value === "string" && FIRST_PAYROLL_STEPS.some(step=>step.key===value);
}
export function canOwnJourneyStep(key:FirstPayrollKey,role:string) {
  return FIRST_PAYROLL_STEPS.find(step=>step.key===key)?.allowedOwners.some(owner=>owner===role)===true;
}
export async function readJourneyProgress(organizationId:number) {
  const rows=await db.select().from(firstPayrollJourneyProgress)
    .where(eq(firstPayrollJourneyProgress.organizationId,organizationId));
  if(!rows.length)return null;
  const stepOwners:Record<string,string>={};
  const completedSteps:Record<string,{byUserId:number;at:string;periodStart?:string;periodEnd?:string}>={};
  for(const row of rows) {
    stepOwners[row.step]=row.ownerRole;
    if(row.data?.completedAt && row.data.completedByUserId)completedSteps[row.step]={
      byUserId:row.data.completedByUserId,at:row.data.completedAt,
      ...(row.data.periodStart?{periodStart:row.data.periodStart}:{}),
      ...(row.data.periodEnd?{periodEnd:row.data.periodEnd}:{}),
    };
  }
  return {stepOwners,completedSteps,reviewedByUserId:completedSteps.time?.byUserId??null,
    reviewedAt:completedSteps.time?.at??null};
}
export type JourneyUpdate={
 organizationId:number;userId:number;userName:string;role:string;
 key:FirstPayrollKey;action:"handoff"|"time_review"|"company_confirm";
 targetRole?:JourneyOwner;periodStart?:string;periodEnd?:string;acknowledged?:boolean;
};
/** Align with canonical 0117 (one row per employer + step), not a competing schema.
 * A serial tenant lock preserves concurrent edits; audit and step update share a transaction. */
export async function saveJourneyProgress(input:JourneyUpdate) {
 const {organizationId,userId,role,key,action}=input;
 const access=await getAccess(userId,organizationId);
 if(!access?.companyWide||access.role!==role)throw Error("Company-wide authorized membership required.");
 if(action==="time_review"&&
   (key!=="time"||role!=="hr"||input.acknowledged!==true||
    !parseMigrationDate(input.periodStart)||!parseMigrationDate(input.periodEnd)||
    input.periodStart!>input.periodEnd!))
   throw Error("HR must expressly attest valid calendar dates for this payroll period.");
 if(action==="company_confirm"&&(key!=="company"||!["owner","admin"].includes(role)))
   throw Error("Employer confirmation requires an administrator.");
 if(action==="handoff"&&
   (!canOwnJourneyStep(key,input.targetRole??"")||
    !["owner","admin","hr","payroll","checker","bookkeeper"].includes(role)))
   throw Error("Invalid owner role for this step.");
 return db.transaction(async tx=>{
   await tx.execute(sql`SELECT pg_advisory_xact_lock(4213, ${organizationId})`);
   if(action==="company_confirm"){
     const employers=await tx.select({primaryEntity:legalEntities.primaryEntity,active:legalEntities.active})
       .from(legalEntities).where(eq(legalEntities.organizationId,organizationId));
     if(!employers.some(e=>e.primaryEntity&&e.active))
       throw Error("An active primary legal employer is required.");
   }
   if (action === "handoff") {
     const [recipient] = await tx.select({ userId: userOrganizations.userId })
       .from(userOrganizations).where(and(
         eq(userOrganizations.organizationId, organizationId),
         eq(userOrganizations.role, input.targetRole!),
         eq(userOrganizations.active, true),
       )).limit(1);
     if (!recipient) throw Error("Invite and activate a member with this role before handing off the step.");
   }
   const [previous]=await tx.select().from(firstPayrollJourneyProgress)
     .where(and(eq(firstPayrollJourneyProgress.organizationId,organizationId),eq(firstPayrollJourneyProgress.step,key))).limit(1);
   const definition=FIRST_PAYROLL_STEPS.find(s=>s.key===key)!;
   const ownerRole=action==="handoff" ? input.targetRole! : (previous?.ownerRole??definition.owner);
   const now=new Date();
   const data={...(previous?.data??{})};
   if(action==="time_review"||action==="company_confirm"){
     data.completedByUserId=userId;data.completedAt=now.toISOString();
     if(action==="time_review"){data.periodStart=input.periodStart;data.periodEnd=input.periodEnd;}
   }
   const row={organizationId,step:key,ownerRole,data,updatedByUserId:userId,updatedAt:now};
   await tx.insert(firstPayrollJourneyProgress).values(row)
     .onConflictDoUpdate({target:[firstPayrollJourneyProgress.organizationId,firstPayrollJourneyProgress.step],
       set:{ownerRole,data,updatedByUserId:userId,updatedAt:now}});
   await tx.insert(auditEvents).values({organizationId,actor:input.userName,
     action:action==="time_review"?"First payroll period inputs reviewed":
       action==="company_confirm"?"First payroll employer setup confirmed":"First payroll step handed off",
     resource:key,metadata:{key,action,role,targetRole:action==="handoff"?input.targetRole:null,
       periodStart:action==="time_review"?input.periodStart:null,
       periodEnd:action==="time_review"?input.periodEnd:null}});
   return row;
 });
}
