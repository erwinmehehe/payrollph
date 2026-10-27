/**
 * Separate feature-gate negative control, not a tenant-isolation credit.
 * A fourth real signed-in fictional employer is excluded from every dynamic
 * allowlist. The two attackers and higher-ID victim ARE included so ordinary
 * own/foreign proof reaches authorization instead of a disabled 404.
 */
import assert from "node:assert/strict";
import { requireTenantTableDisposable, standaloneRequest } from "./tenant-table-http.mjs";
import { readPrivateAllowlistFixture } from "./tenant-table-invariants.mjs";

export function unlistedGateRequests(unlisted) {
  const org = unlisted.org.id, worker = unlisted.worker.id;
  const q = (...args) => new URLSearchParams(args).toString();
  return [
    "/api/hcm/team-leave-calendar?" + q(["organizationId", String(org)]),
    "/api/hcm/process-monitor?" + q(["organizationId", String(org)]),
    "/api/hcm/position-history?" + q(["organizationId", String(org)], ["positionId", "1"]),
    "/api/hcm/org-explorer?" + q(["organizationId", String(org)]),
    "/api/hcm/manager-decision-inbox?" + q(["organizationId", String(org)]),
    "/api/workforce/schedule-receipt-review?" + q(["organizationId", String(org)], ["employeeId", String(worker)]),
    "/api/workforce/demand-outlook?" + q(["organizationId", String(org)], ["worksiteId", "1"], ["horizonDays", "7"]),
    "/api/workforce/demand-observations/outlook?" + q(["organizationId", String(org)],
      ["worksiteId", "1"], ["sourceKey", "ttbl_fictional_source"], ["metricKind", "transactions"],
      ["intervalMinutes", "60"], ["horizonDays", "7"]),
    "/api/workforce/demand-observations/issued?" + q(["organizationId", String(org)], ["worksiteId", "1"]),
    "/api/workforce/demand-staffing/policies?" + q(["organizationId", String(org)],
      ["worksiteId", "1"], ["jobProfileId", "any"], ["metricKind", "transactions"],
      ["intervalMinutes", "60"], ["mode", "manage"]),
  ];
}
export async function verifyUnlistedGateDenials({
  env = process.env, request = standaloneRequest,
} = {}) {
  requireTenantTableDisposable(env);
  assert.equal(env.TENANT_TABLE_PROFILE, "allowlisted-reads");
  const data = readPrivateAllowlistFixture(env.TENANT_TABLE_ALLOWLIST_FIXTURE);
  assert.equal(data.schema, "payrollph-tenant-allowlist-preseed-v1");
  const unlisted = data.excluded;
  assert.ok(unlisted.org.id > Math.max(...data.allowlistedIds));
  for (const route of unlistedGateRequests(unlisted)) {
    const result = await request(route, { cookie: unlisted.cookie });
    assert.equal(result.status, 404, route + " must reject the non-allowlisted employer before data access");
    assert.ok(!result.text.includes(unlisted.marker), route + " must not expose employer data");
    for (const employer of data.employers) assert.ok(!result.text.includes(employer.marker));
  }
  console.log(JSON.stringify({ kind: "tenant-allowlist-negative",
    unavailableEmployer: true, gateRoutes: 10, statuses: "404", credits: 0, productionTested: false }));
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-table-allowlist-negative.mjs")) {
  verifyUnlistedGateDenials().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
}
