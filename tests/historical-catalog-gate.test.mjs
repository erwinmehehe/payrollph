import assert from "node:assert/strict";
import test from "node:test";
import {
  HISTORICAL_REQUIRED_OBJECTS, HISTORICAL_CATALOG_SQL,
  evaluateHistoricalCatalog, assertHistoricalCatalog,
} from "../scripts/lib/historical-catalog-gate.mjs";

const realLookingCatalog = () => HISTORICAL_REQUIRED_OBJECTS.map(x=>({
  key:x.key, matches:true,
}));

test("historical preflight covers all six merged source families with unique keys", () => {
  assert.deepEqual([...new Set(HISTORICAL_REQUIRED_OBJECTS.map(x=>x.prefix))],
    [22,50,110,112,113,114]);
  assert.equal(
    new Set(HISTORICAL_REQUIRED_OBJECTS.map(x=>x.key)).size,
    HISTORICAL_REQUIRED_OBJECTS.length,
  );
  assert.ok(HISTORICAL_REQUIRED_OBJECTS.some(x=>
    x.kind==="table" && x.relation==="worker_employment_events"));
  assert.ok(HISTORICAL_REQUIRED_OBJECTS.some(x=>
    x.kind==="index" && x.name==="provider_events_provider_event_id_unique"
    && x.unique===true));
  assert.ok(HISTORICAL_REQUIRED_OBJECTS.some(x=>
    x.kind==="column" && x.relation==="position_assignments"
    && x.name==="fte" && x.type==="numeric"));
});

test("catalog SQL inspects only static pg_catalog structure and valid/unique indexes", () => {
  assert.match(HISTORICAL_CATALOG_SQL,/pg_catalog\.pg_class/);
  assert.match(HISTORICAL_CATALOG_SQL,/pg_catalog\.pg_attribute/);
  assert.match(HISTORICAL_CATALOG_SQL,/pg_catalog\.pg_index/);
  assert.match(HISTORICAL_CATALOG_SQL,/ix\.indisvalid AND ix\.indisready/);
  assert.match(HISTORICAL_CATALOG_SQL,/ix\.indisunique=required\.expected_unique/);
  assert.doesNotMatch(HISTORICAL_CATALOG_SQL,/(?:FROM|JOIN)\s+(?:public\.)?(?:employees|payroll_entries|payroll_runs|bank_accounts)\b/i);
  assert.doesNotMatch(HISTORICAL_CATALOG_SQL,/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|EXECUTE|CREATE TABLE)\b/i);
});

test("passing catalog can NEVER approve historical execution or production release", () => {
  const result=evaluateHistoricalCatalog(realLookingCatalog(),114);
  assert.equal(result.structurallyReady,true);
  assert.equal(result.missing.length,0);
  assert.equal(result.historicalExecutionProven,false);
  assert.equal(result.productionReleaseApproved,false);
  assert.equal(result.checked,HISTORICAL_REQUIRED_OBJECTS.length);
});

test("required table, typed column, or unique index missing blocks even with attested receipts", async () => {
  for(const selector of [
    x=>x.relation==="worker_employment_events"&&x.kind==="table",
    x=>x.relation==="position_assignments"&&x.name==="fte",
    x=>x.name==="provider_events_provider_event_id_unique",
    x=>x.relation==="workforce_demand_staffing_policies"&&x.kind==="table",
  ]) {
    const target=HISTORICAL_REQUIRED_OBJECTS.find(selector);
    assert.ok(target);
    const rows=realLookingCatalog().map(row=>row.key===target.key
      ? {...row,matches:false}:row);
    const preview=evaluateHistoricalCatalog(rows,114);
    assert.equal(preview.structurallyReady,false);
    assert.equal(preview.historicalExecutionProven,false);
    assert.ok(preview.missing.some(x=>x.source===target.source));
    const mock={async query(sql) {
      assert.equal(sql,HISTORICAL_CATALOG_SQL);
      return {rows};
    }};
    await assert.rejects(()=>assertHistoricalCatalog(mock,114),
      /REVIEWED_MIGRATION_HISTORICAL_CATALOG_OBJECTS_MISSING/);
  }
});

test("not-yet-historical future objects do not block earlier cutovers", () => {
  const rows=realLookingCatalog().map(row=>{
    const obj=HISTORICAL_REQUIRED_OBJECTS.find(x=>x.key===row.key);
    return obj.prefix>50?{...row,matches:false}:row;
  });
  const p=evaluateHistoricalCatalog(rows,50);
  assert.equal(p.structurallyReady,true);
  assert.equal(p.checked,
    HISTORICAL_REQUIRED_OBJECTS.filter(x=>x.prefix<=50).length);
  assert.equal(evaluateHistoricalCatalog(rows,114).structurallyReady,false);
});

test("malformed/truncated/duplicate/unknown catalog output fails closed", () => {
  const good=realLookingCatalog();
  const bad=[
    null,
    [],
    good.slice(1),
    [...good,{...good[0]}],
    good.map((x,i)=>i===0?{...x,matches:"true"}:x),
    good.map((x,i)=>i===0?{...x,key:"foreign:audit:fake"}:x),
    good.map((x,i)=>i===0?{...x,key:null}:x),
  ];
  for(const rows of bad) {
    assert.throws(()=>evaluateHistoricalCatalog(rows,114),
      /REVIEWED_MIGRATION_HISTORICAL_CATALOG_UNVERIFIED/);
  }
  for(const n of [-1,1.5,NaN,10000,"114",null]) {
    assert.throws(()=>evaluateHistoricalCatalog(good,n),
      /REVIEWED_MIGRATION_HISTORICAL_CATALOG_UNVERIFIED/);
  }
});

test("readiness function skips historical check for synthetic cutover 0021",async()=>{
  let called=false;
  const result=await assertHistoricalCatalog({async query(){called=true;throw Error("should-not-query");}},21);
  assert.equal(called,false);
  assert.equal(result.checked,0);
  assert.equal(result.historicalExecutionProven,false);
  assert.equal(result.productionReleaseApproved,false);
});

test("real SQL response with complete structure can pass a structural-only check",async()=>{
  const rows=realLookingCatalog();
  const client={async query(sql){
    assert.equal(sql,HISTORICAL_CATALOG_SQL);
    return {rows};
  }};
  const proof=await assertHistoricalCatalog(client,114);
  assert.equal(proof.structurallyReady,true);
  assert.equal(proof.historicalExecutionProven,false);
});
