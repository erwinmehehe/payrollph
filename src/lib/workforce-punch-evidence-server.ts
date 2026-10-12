import { and, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { workforcePunchPhotoEvidence } from "@/db/schema";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { executePunchPhotoPurge } from "@/lib/workforce-punch-evidence-policy";

/** Runs inside existing central scheduler's daily leased retention task. */
export async function purgeExpiredPunchPhotoEvidence(now=new Date()){
 if(!criticalReleaseFlagEnabled("wfmPunchEvidence"))return {skipped:true as const,deleted:0};
 const deleted=await executePunchPhotoPurge({
  listExpired:async(date,limit)=>{
   const rows=await db.select({id:workforcePunchPhotoEvidence.id})
     .from(workforcePunchPhotoEvidence).where(and(
       lte(workforcePunchPhotoEvidence.expiresAt,date),
       eq(workforcePunchPhotoEvidence.legalHold,false),
     )).limit(limit);
   return rows.map(r=>r.id);
  },
  deleteExpired:async(ids,date)=>{
   const removed=await db.delete(workforcePunchPhotoEvidence).where(and(
     inArray(workforcePunchPhotoEvidence.id,[...ids]),
     lte(workforcePunchPhotoEvidence.expiresAt,date),
     eq(workforcePunchPhotoEvidence.legalHold,false),
   )).returning({id:workforcePunchPhotoEvidence.id});
   return removed.length;
  },
 },now,100);
 return {skipped:false as const,deleted};
}
