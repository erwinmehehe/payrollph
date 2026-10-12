import { and,eq,isNotNull,lte } from "drizzle-orm";
import { db } from "@/db";
import { workforcePunchPhotoEvidence } from "@/db/schema";
import { photosDueForPurge } from "@/lib/workforce-punch-evidence";
export async function purgeExpiredPunchPhotos(now=new Date(),limit=250){
  const due=await db.select().from(workforcePunchPhotoEvidence).where(and(
    lte(workforcePunchPhotoEvidence.expiresAt,now),
    eq(workforcePunchPhotoEvidence.legalHold,false),
    isNotNull(workforcePunchPhotoEvidence.sealedPhoto),
  )).limit(limit);
  const ids=photosDueForPurge(due,now).map(row=>row.id);
  let count=0;
  for(const id of ids) {
    const rows=await db.update(workforcePunchPhotoEvidence).set({sealedPhoto:null,purgedAt:now})
      .where(and(eq(workforcePunchPhotoEvidence.id,id),eq(workforcePunchPhotoEvidence.legalHold,false),
        isNotNull(workforcePunchPhotoEvidence.sealedPhoto),lte(workforcePunchPhotoEvidence.expiresAt,now)))
      .returning({id:workforcePunchPhotoEvidence.id});
    count+=rows.length;
  }
  return {purged:count,remainingPossiblyDue:due.length===limit};
}
