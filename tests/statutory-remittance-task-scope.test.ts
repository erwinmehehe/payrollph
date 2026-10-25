import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  statutoryRemittanceTaskEntityId, statutoryRemittanceTaskInScope,
} from "../src/lib/statutory-remittance-task-scope";

test("source-key attribution rejects malformed, legacy and forged employer prefixes", () => {
  assert.equal(statutoryRemittanceTaskEntityId("legal-entity:101:batch:1"), 101);
  for (const candidate of [
    "", "legacy:batch:1", "legal-entity:0:batch", "legal-entity:-4:batch",
    "legal-entity:1", "legal-entity:1x:batch", "other:legal-entity:1:batch",
    "legal-entity:9007199254740993:batch",
  ]) assert.equal(statutoryRemittanceTaskEntityId(candidate), null, candidate);
  assert.equal(statutoryRemittanceTaskInScope("legal-entity:101:case", 101), true);
  assert.equal(statutoryRemittanceTaskInScope("legal-entity:102:case", 101), false);
  assert.equal(statutoryRemittanceTaskInScope("legacy:case", 101), false);
  assert.equal(statutoryRemittanceTaskInScope("legacy:case", null), true,
    "Flag-off company-wide legacy semantics stay intact");
});

test("both GET and POST resolve employer grants before queue/task access", () => {
  const src = readFileSync("src/app/api/compliance/remittance-actions/route.ts", "utf8");
  const calls = src.match(/resolveMultiEntityContext\(\{ userId: user\.id, organizationId, request \}\)/g);
  assert.equal(calls?.length, 2);
  assert.match(src, /like\(complianceActionTasks\.sourceKey,/);
  assert.match(src, /syncStatutoryRemittanceActions\(organizationId, user\.name, legalEntityId \?\? undefined\)/);
  assert.match(src, /grantedAssignees\.has\(membership\.userId\)/);
  assert.match(src, /assignmentGrant\.length === 0/);
  assert.equal(src.match(/eq\(complianceActionTasks\.sourceKey, task\.sourceKey\)/g)?.length, 2,
    "Both task updates must protect the observed source-key boundary from races");
});

test("escalation outbox cannot bypass selected legal-employer grants", () => {
  const escalation = readFileSync("src/lib/statutory-remittance-escalations.ts", "utf8");
  const sync = readFileSync("src/lib/statutory-remittance-actions.ts", "utf8");
  assert.match(escalation, /criticalReleaseFlagEnabled\("multiEntity"\)/);
  assert.match(escalation, /statutoryRemittanceTaskEntityId\(task\.sourceKey\)/);
  assert.match(escalation, /grantedRecipients\.has/);
  assert.match(escalation, /if \(enabled && employerId == null\) continue;/);
  assert.match(sync, /queueStatutoryComplianceEscalations\(\{\s*organizationId,\s*legalEntityId,\s*actor,/);
});
