import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {randomUUID} from "node:crypto";
import {and,eq,inArray} from "drizzle-orm";
import {db} from "../src/db";
import {organizations,employees,workforcePunchPhotoEvidence} from "../src/db/schema";
import {purgeExpiredPunchPhotos} from "../src/lib/workforce-punch-retention";


/**
 * Drizzle wraps PostgreSQL errors in a generic "Failed query" exception.
 * Inspect the original SQLSTATE/constraint in the cause chain rather than
 * checking the wrapper's text. Never accept unrelated FK or query failures.
 */
function isPhotoTenantViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth++) {
    if (!current || typeof current !== "object") return false;
    const value = current as {
      code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown;
    };
    if (value.code === "23503" &&
      value.constraint === "workforce_punch_photo_employee_tenant_fk") return true;
    if (value.code === "23514" &&
      typeof value.message === "string" &&
      value.message.includes("WFM_PUNCH_TENANT_MISMATCH")) return true;
    current = value.cause;
  }
  return false;
}

test("tenant photo constraint assertion inspects the PG cause without accepting unrelated failures",()=>{
  assert.equal(isPhotoTenantViolation(new Error("Failed query")),false);
  assert.equal(isPhotoTenantViolation({cause:{code:"23503",
    constraint:"workforce_punch_photo_employee_tenant_fk"}}),true);
  assert.equal(isPhotoTenantViolation({cause:{code:"23503",
    constraint:"some_other_fk"}}),false);
  assert.equal(isPhotoTenantViolation({code:"23514",
    message:"WFM_PUNCH_TENANT_MISMATCH"}),true);
  assert.equal(isPhotoTenantViolation({code:"23514",
    message:"unrelated check constraint"}),false);
});

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
    }, isPhotoTenantViolation,
    "The database must reject a photo whose employee belongs to another tenant.");
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


test("retention scheduler never selects photo ciphertext into worker memory",()=>{
 const source=readFileSync("src/lib/workforce-punch-retention.ts","utf8");
 assert.doesNotMatch(source,/db\.select\(\)\.from\(workforcePunchPhotoEvidence\)/);
 assert.match(source,/db\.select\(\{id:workforcePunchPhotoEvidence\.id\}\)/);
 assert.match(source,/limit>250/);
});


test("PostgreSQL purge distinguishes an exactly full 250-photo page from a 251-photo backlog",async()=>{
  const suffix=randomUUID().slice(0,9);
  const [org]=await db.insert(organizations).values({
    name:"Synthetic Retention Boundary "+suffix,
    legalName:"Synthetic Retention Boundary "+suffix,
  }).returning();
  try{
    const [employee]=await db.insert(employees).values({
      organizationId:org.id,employeeNo:"B-"+suffix,firstName:"Synthetic",lastName:"Worker",
      title:"Tester",avatarInitials:"SW",basicRate:"25000",startDate:"2026-01-01",
    }).returning();
    // Use a deliberately old, synthetic expiry so other CI fixtures (2026+)
    // are not eligible for this job; no real photo bytes or employee data.
    const expiresAt=new Date("2010-01-01T00:00:00.000Z");
    const now=new Date("2010-01-02T00:00:00.000Z");
    const insert=async(count:number)=>{
      const ids=Array.from({length:count},()=>randomUUID());
      await db.insert(workforcePunchPhotoEvidence).values(ids.map(id=>({
        id,organizationId:org.id,employeeId:employee.id,
        expiresAt,sealedPhoto:"synthetic-encrypted-placeholder",
      })));
      return ids;
    };
    const exact=await insert(250);
    const full=await purgeExpiredPunchPhotos(now,250);
    assert.deepEqual(full,{purged:250,remainingPossiblyDue:false},
      "An exactly full final page must not report a phantom backlog");
    const exactRows=await db.select({id:workforcePunchPhotoEvidence.id,
      sealedPhoto:workforcePunchPhotoEvidence.sealedPhoto})
      .from(workforcePunchPhotoEvidence).where(inArray(workforcePunchPhotoEvidence.id,exact));
    assert.ok(exactRows.every(row=>row.sealedPhoto===null));
    const more=await insert(251);
    const first=await purgeExpiredPunchPhotos(now,250);
    assert.deepEqual(first,{purged:250,remainingPossiblyDue:true},
      "A genuine 251st due photo must remain visible to the drain loop");
    const second=await purgeExpiredPunchPhotos(now,250);
    assert.deepEqual(second,{purged:1,remainingPossiblyDue:false});
    const leftovers=await db.select({id:workforcePunchPhotoEvidence.id,
      sealedPhoto:workforcePunchPhotoEvidence.sealedPhoto})
      .from(workforcePunchPhotoEvidence).where(inArray(workforcePunchPhotoEvidence.id,more));
    assert.ok(leftovers.every(row=>row.sealedPhoto===null));
  }finally{
    await db.delete(organizations).where(eq(organizations.id,org.id));
  }
});
