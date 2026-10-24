/**
 * Source-boundary regression checks: these DO NOT certify real HTTP/PostgreSQL
 * tenant isolation. Exact-method, own/foreign, immutable-victim proof is still
 * required in the disposable CI harness before any release acceptance.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decideEntityAccess, entityResourceAllowed } from "../src/lib/multi-entity-policy";

const routes = [
  {
    path: "src/app/api/compliance/contribution-issues/evidence/route.ts",
    entity: "issue.legalEntityId",
    sensitiveMaterial: "buildContributionEvidencePack(",
  },
  {
    path: "src/app/api/compliance/statutory-remittances/payment-evidence/[id]/route.ts",
    entity: "record.legalEntityId",
    sensitiveMaterial: "Buffer.from(",
  },
  {
    path: "src/app/api/compliance/statutory-remittances/posting-evidence/[id]/route.ts",
    entity: "record.legalEntityId",
    sensitiveMaterial: "Buffer.from(",
  },
] as const;

test("every compliance evidence GET rejects ungranted legal employers before exporting bytes", () => {
  for (const route of routes) {
    const source = readFileSync(route.path, "utf8");
    const resolveAt = source.indexOf("resolveMultiEntityContext({");
    const resourceGate = `assertEntityResource(entityScope.context, ${route.entity})`;
    const resourceAt = source.indexOf(resourceGate);
    const materialAt = source.indexOf(route.sensitiveMaterial);
    assert.ok(resolveAt > 0, route.path + ": missing selected legal-employer resolution");
    assert.ok(resourceAt > resolveAt, route.path + ": missing employer-specific resource guard");
    assert.ok(materialAt > resourceAt, route.path + ": evidence generated before the legal-employer guard");
    assert.match(source, /if \(!entityScope\.ok\) return entityScope\.response;/,
      route.path + ": denied selection must stop the download");
    assert.match(source, /if \(entityDenied\) return entityDenied;/,
      route.path + ": denied employer must stop the download");
  }
});

test("downloaded payment and posting evidence require a same-tenant remittance parent", () => {
  for (const [path, table] of [
    ["src/app/api/compliance/statutory-remittances/payment-evidence/[id]/route.ts", "statutoryRemittancePaymentEvidence"],
    ["src/app/api/compliance/statutory-remittances/posting-evidence/[id]/route.ts", "statutoryPostingEvidenceArtifacts"],
  ]) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes(`innerJoin(statutoryRemittanceBatches, and(`),
      path + ": missing parent remittance join");
    assert.ok(source.includes(`eq(${table}.batchId, statutoryRemittanceBatches.id)`),
      path + ": missing parent ID equality");
    assert.ok(source.includes(`eq(${table}.organizationId, statutoryRemittanceBatches.organizationId)`),
      path + ": parent from another tenant must never back an attachment");
  }
});

test("a company-wide payroll membership cannot substitute another legal-employer selector", () => {
  const availableEntityIds = [101, 102, 201];
  const grantedEntityIds = [101];
  const own = decideEntityAccess({
    role: "payroll", availableEntityIds, grantedEntityIds, requested: 101,
  });
  assert.equal(own.ok, true);
  assert.equal(entityResourceAllowed(own, 101), true);
  assert.equal(entityResourceAllowed(own, 102), false);
  assert.equal(entityResourceAllowed(own, 201), false);
  const forged = decideEntityAccess({
    role: "payroll", availableEntityIds, grantedEntityIds, requested: 102,
  });
  assert.deepEqual(forged, { ok: false, code: "ENTITY_ACCESS_DENIED" });
  const all = decideEntityAccess({
    role: "payroll", availableEntityIds, grantedEntityIds, requested: "all",
  });
  assert.deepEqual(all, { ok: false, code: "ENTITY_ACCESS_DENIED" });
});
