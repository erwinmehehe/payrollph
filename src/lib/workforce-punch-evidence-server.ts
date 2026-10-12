import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { workforcePunchPhotoEvidence } from "@/db/schema";
import { executePunchPhotoPurge } from "@/lib/workforce-punch-evidence-policy";

/** Runs inside existing central scheduler's daily leased retention task. */
export async function purgeExpiredPunchPhotoEvidence(now=new Date()){
 // Retention must keep running after capture is disabled. Missing migration
 // is a safe no-op so an unconfigured deployment cannot crash its scheduler.
 const exists=await db.execute(sql`SELECT to_regclass('public.workforce_punch_photo_evidence') AS table_name`);
 if(!exists.rows[0]?.table_name)return {skipped:true as const,deleted:0};
 let deleted=0;
 for(let batch=0;batch<10;batch++){
 const batchDeleted=await executePunchPhotoPurge({
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
 deleted+=batchDeleted;
 if(batchDeleted<100)break;
 }
 return {skipped:false as const,deleted};
}
