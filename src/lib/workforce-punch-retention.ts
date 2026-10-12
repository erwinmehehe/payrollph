import { and,asc,eq,isNotNull,lte } from "drizzle-orm";
import { db } from "@/db";
import { workforcePunchPhotoEvidence } from "@/db/schema";
export async function purgeExpiredPunchPhotos(now=new Date(),limit=250){
  if(!Number.isFinite(now.getTime())||!Number.isSafeInteger(limit)||limit<1||limit>250)
    throw new Error("Invalid bounded photo-retention job parameters.");
  // Select only non-sensitive row IDs. The purge process must not load
  // expired encrypted selfies from the database just to discard them.
  const due=await db.select({id:workforcePunchPhotoEvidence.id})
    .from(workforcePunchPhotoEvidence).where(and(
      lte(workforcePunchPhotoEvidence.expiresAt,now),
      eq(workforcePunchPhotoEvidence.legalHold,false),
      isNotNull(workforcePunchPhotoEvidence.sealedPhoto),
    )).orderBy(asc(workforcePunchPhotoEvidence.id)).limit(limit);
  const ids=due.map(row=>row.id);
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
