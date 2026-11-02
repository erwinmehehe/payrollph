import assert from "node:assert/strict";
import {bootstrap,snapshot,assertions,pool} from "./tenant-records-mwe-migration-shared.mjs";
import {proveMigrations} from "./tenant-records-migrations-http.mjs";
import {proveMwe} from "./tenant-records-mwe-http.mjs";

try{
  const {attackers,victim}=await bootstrap();
  const negativeMigrations=await proveMigrations(attackers,victim);
  const negativeMwe=await proveMwe(attackers,victim);
  const orgs=[...attackers,victim];
  // These are actual database readbacks, not mock object-state comparisons.
  const before=new Map(await Promise.all(orgs.map(async e=>
    [e.org.id,await snapshot(e.org.id)])));
  await negativeMigrations();
  const {victimRow,victimWorker}=await negativeMwe();
  for(const e of orgs){
    assert.deepEqual(await snapshot(e.org.id),before.get(e.org.id),
      "all real employer PostgreSQL tables immutable after real foreign/forged migration and MWE requests");
  }
  console.log(JSON.stringify({
    kind:"tenant-records-migration-mwe-pg16-http",
    methods:["POST migrations (four real kinds, preview+commit)",
      "PATCH MWE classifications (approve+reject)"],
    independentAuthenticatedOwnEmployers:attackers.length,
    realVictimOrganizationId:victim.org.id,
    realVictimEmployeeId:victimWorker.id,
    realVictimClassificationId:victimRow.id,
    fourPartAssertions:assertions.length,
    victimAndAttackerSqlSnapshotsUnchanged:true,
    moneyPayoutProvidersCsp:"OFF",credits:0,productionTested:false,
  }));
}finally{await pool.end();}
