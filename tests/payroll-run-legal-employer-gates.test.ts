/** Source-level legal-employer checks only: real HTTP/PG16 proof runs separately. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decideEntityAccess, entityResourceAllowed } from "../src/lib/multi-entity-policy";

const close = readFileSync("src/app/api/payroll-runs/[id]/close/route.ts", "utf8");

test("payroll close GET and POST share legal-employer guard before close-state evidence reads", () => {
  assert.match(close, /async function loadCloseState\(request: Request, runId: number, userId: number\)/);
  assert.equal((close.match(/loadCloseState\(request, runId, user\.id\)/g) ?? []).length, 2);
  const org = close.indexOf("const denied = await assertOrganizationRole(");
  const unit = close.indexOf("const scopeDenied = await assertOrganizationUnitAccess(");
  const entity = close.indexOf("const employerDenied = await requireRunEmployer({");
  const evidence = close.indexOf("const [events, filingRows] = await Promise.all([");
  assert.ok(org >= 0 && org < unit && unit < entity && entity < evidence,
    "The legal-employer gate must precede all accounting, audit, and filing reads");
  assert.match(close, /request, userId, organizationId: run\.organizationId, legalEntityId: run\.legalEntityId/);
  assert.match(close, /if \(employerDenied\) return \{ error: employerDenied \};/);
  assert.match(close, /export async function GET\(request: Request/);
  assert.match(close, /export async function POST\(request: Request/);
});

test("owner of one legal employer cannot use selection to read another employer", () => {
  const own = decideEntityAccess({
    role: "owner", availableEntityIds: [101, 102], grantedEntityIds: [101], requested: 101,
  });
  assert.equal(entityResourceAllowed(own, 101), true);
  assert.equal(entityResourceAllowed(own, 102), false);
  assert.equal(entityResourceAllowed(own, null), false);
  const forged = decideEntityAccess({
    role: "owner", availableEntityIds: [101, 102], grantedEntityIds: [101], requested: 102,
  });
  assert.equal(forged.ok, false);
  assert.equal(entityResourceAllowed(forged, 102), false);
  const multiGrant = decideEntityAccess({
    role: "owner", availableEntityIds: [101, 102], grantedEntityIds: [101, 102], requested: 101,
  });
  assert.equal(entityResourceAllowed(multiGrant, 102), false,
    "Having both grants never bypasses the explicit single-employer selection");
});
