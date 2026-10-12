import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {and,eq,inArray} from "drizzle-orm";
import {db} from "../src/db";
import {organizations,employees,workforcePunchPhotoEvidence} from "../src/db/schema";
import {purgeExpiredPunchPhotos} from "../src/lib/workforce-punch-retention";

test("real purge job erases expired ciphertext but preserves held and future tenant evidence",async()=>{
  const suffix=randomUUID().slice(0,9);
  const [orgA,orgB]=await db.insert(organizations).values([
    {name:"Synthetic Evidence A "+suffix,legalName:"Synthetic Evidence A "+suffix},
    {name:"Synthetic Evidence B "+suffix,legalName:"Synthetic Evidence B "+suffix},
  ]).returning();
  try{
    const [a,b]=await db.insert(employees).values([
      {organizationId:orgA.id,employeeNo:"E-"+suffix,firstName:"Test",lastName:"A",title:"Tester",avatarInitials:"TA",basicRate:"25000",startDate:"2026-01-01"},
      {organizationId:orgB.id,employeeNo:"E-"+suffix,firstName:"Test",lastName:"B",title:"Tester",avatarInitials:"TB",basicRate:"25000",startDate:"2026-01-01"},
    ]).returning();
    const old=new Date("2026-01-01T00:00:00.000Z"),future=new Date("2027-01-01T00:00:00.000Z");
    const ids=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
    await db.insert(workforcePunchPhotoEvidence).values([
      {id:ids[0],organizationId:orgA.id,employeeId:a.id,expiresAt:old,sealedPhoto:"sealed-old"},
      {id:ids[1],organizationId:orgA.id,employeeId:a.id,expiresAt:old,sealedPhoto:"sealed-held",legalHold:true},
      {id:ids[2],organizationId:orgA.id,employeeId:a.id,expiresAt:future,sealedPhoto:"sealed-future"},
      {id:ids[3],organizationId:orgB.id,employeeId:b.id,expiresAt:old,sealedPhoto:"sealed-other"},
    ]);
    // SQL tenant triggers must reject mismatched employee/evidence even
    // when an API caller attempts a direct database write.
    await assert.rejects(async()=>{
      await db.insert(workforcePunchPhotoEvidence).values({
        id:randomUUID(),organizationId:orgB.id,employeeId:a.id,
        expiresAt:future,sealedPhoto:"synthetic-wrong-tenant",
      });
    },/WFM_PUNCH_TENANT_MISMATCH/);
    const result=await purgeExpiredPunchPhotos(new Date("2026-10-12T00:00:00.000Z"));
    assert.ok(result.purged>=2);
    const rows=await db.select().from(workforcePunchPhotoEvidence).where(inArray(workforcePunchPhotoEvidence.id,ids));
    const map=new Map(rows.map(row=>[row.id,row]));
    assert.equal(map.get(ids[0])?.sealedPhoto,null);
    assert.ok(map.get(ids[0])?.purgedAt);
    assert.equal(map.get(ids[1])?.sealedPhoto,"sealed-held");
    assert.equal(map.get(ids[2])?.sealedPhoto,"sealed-future");
    assert.equal(map.get(ids[3])?.sealedPhoto,null);
    const retry=await purgeExpiredPunchPhotos(new Date("2026-10-12T00:00:00.000Z"));
    assert.equal(retry.purged,0,"idempotent after synthetic database isolated purge");
  }finally{
    await db.delete(organizations).where(eq(organizations.id,orgA.id));
    await db.delete(organizations).where(eq(organizations.id,orgB.id));
  }
});
