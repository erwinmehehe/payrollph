import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRows as hcm } from "../scripts/qa/tenant-table-rows/read/hcm-allowlisted.mjs";
import { createRows as workforce } from "../scripts/qa/tenant-table-rows/read/workforce-allowlisted.mjs";
import { tenantFamilyCatalog } from "../scripts/qa/tenant-table-catalog.mjs";
import { verifyRecoveryReceipt } from "../scripts/qa/tenant-read-gap-recovery.mjs";

const rows = [...hcm({ assert }), ...workforce({ assert })];
const c = {
  orgId: 11, workerId: 21, unitId: 31, marker: "TTBL-ATTA-synthetic",
  seeded: { id: 41, month: "2026-10", assignmentId: 51, code: "TTBL-POS",
    name: "TTBL-ATTA-synthetic mapped unit", taskId: 61,
    headcount: 4, historyCount: 9, historicalCount: 9, observedCount: 9,
    sourceKey: "ttbl_ttbl-atta-synthetic" },
};
function proof(key) {
  const basic = { json: {} };
  switch (key) {
    case "GET hcm/team-leave-calendar": basic.json = {
      organizationId: 11, month: "2026-10", scope: { kind: "company" },
      cases: [{ requestId: 41, employeeId: 21, employeeNo: c.marker, status: "Pending" }],
      summary: { pendingRequestRecords: 1 },
    }; break;
    case "GET hcm/process-monitor": basic.json = { tenantId: 11, filter: "all",
      items: [{ id: 41, tenantId: 11, type: "change_job", status: "in_progress" }] }; break;
    case "GET hcm/position-history": basic.json = {
      tenantId: 11, positionId: 41, position: { id: 41, code: "TTBL-POS" },
      history: { preview: { items: [{ id: 51, employeeId: 21 }] } },
    }; break;
    case "GET hcm/org-explorer": basic.json = { tenantId: 11,
      units: [{ id: 41, name: c.seeded.name, parentId: 31, relationship: "linked" }],
      positions: [],
    }; break;
    case "GET hcm/manager-decision-inbox": basic.json = {
      organizationId: 11, source: "leave", scope: { kind: "company" },
      items: [{ sourceRecordId: 41, approvalTaskId: 61, employee: { id: 21, employeeNo: c.marker },
        status: "pending" }], totals: { assignedItemsThisPage: 1 },
    }; break;
    case "GET workforce/schedule-receipt-review": basic.json = {
      employee: { employeeNo: c.marker, name: "Table " + c.marker }, account: "ready",
      days: Array.from({ length: 7 }, (_, i) => ({ date: "2026-10-" + (i + 1), state: "unavailable" })),
      summary: { acknowledged: 0, pending: 0, changed: 0, unavailable: 7 },
    }; break;
    case "GET workforce/demand-outlook": basic.json = { readOnly: true,
      scope: { organizationId: 11, worksiteId: 41, worksiteName: c.seeded.name }, outlook: { status: "ready", historicalRows: 9, forecasts: [{ worksiteId: 41, estimatedHeadcount: 4, trainingObservations: 9 }] } }; break;
    case "GET workforce/demand-observations/outlook": basic.json = { readOnly: true,
      scope: { organizationId: 11, worksiteId: 41, sourceKey: c.seeded.sourceKey,
        metricKind: "transactions", intervalMinutes: 60 }, forecast: { status: "ready", historicalVersions: 9, points: [{ predictedCount: 9, evidenceCount: 9 }] } }; break;
    default: throw new Error("Missing synthetic proof for " + key);
  }
  return basic;
}
test("eight executed GET credits require the bound receipt, actual seed, exact profile and discriminatory proof", () => {
  const receipt = verifyRecoveryReceipt();
  assert.equal(rows.length, 8);
  assert.equal(new Set(rows.map(row => row.key)).size, 8);
  assert.ok(rows.every(row => row.profile === "allowlisted-reads" && row.flags?.length === 1));
  assert.ok(rows.every(row => typeof row.seed === "function" && typeof row.prove === "function"));
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const catalog = tenantFamilyCatalog("read");
  for (const row of rows) {
    const [verb, route] = row.key.split(" ");
    assert.equal(verb, "GET");
    const found = Object.values(manifest.allApiRouteFiles).find(item => item.route === route);
    assert.ok(found, "route must be inventoried: " + row.key);
    const method = found.methods.find(method => method.name === verb);
    assert.equal(method?.status, "COVERED", "Executed receipt required: " + row.key);
    assert.ok(method.testedBy.evidence.includes(receipt.runLabel));
    assert.equal(method.testedBy.postgresMajor, receipt.postgresMajor);
    assert.equal(catalog.filter(item => item.key === row.key).length, 1);
  }
});
for (const row of rows) {
  test(row.key + " requires a nonempty, employer-discriminating real source projection", () => {
    const good = proof(row.key);
    row.prove(good, c);
    assert.throws(() => row.prove({ json: {} }, c), "missing source data must fail");
    assert.throws(() => row.prove(good, { ...c, orgId: 99, marker: "TTBL-ATTB-other",
      workerId: 109, unitId: 131, seeded: { ...c.seeded, id: 141, assignmentId: 151,
        taskId: 161, sourceKey: "ttbl_ttbl-attb-other" } }), "swapped employer proof must fail");
  });
}
test("gate env values must be generated from actual runtime employer IDs, not wildcard or static numbers", () => {
  const envSource = readFileSync("scripts/qa/tenant-table-env.mjs", "utf8");
  const bootstrap = readFileSync("scripts/qa/tenant-table-allowlist-bootstrap.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-table-proof.yml", "utf8");
  const runner = readFileSync("scripts/qa/tenant-table-http.mjs", "utf8");
  assert.match(envSource, /"allowlisted-reads":/);
  assert.match(workflow, /profile: \[default, multi-entity, flagged-reads, allowlisted-reads\]/);
  assert.match(workflow, /tenant-table-allowlist-bootstrap\.mjs/);
  assert.ok(workflow.indexOf("- name: Preseed two attackers") <
    workflow.indexOf("- run: npm run build"), "preseed must precede Next build");
  assert.ok(workflow.indexOf("- run: npm run build") <
    workflow.indexOf("Start isolated production-mode localhost server"), "build must precede server startup");
  assert.match(workflow, /tenant-table-allowlist-negative\.mjs/);
  assert.match(bootstrap, /const ids = \[attackerA\.org\.id, attackerB\.org\.id, victim\.org\.id\]/);
  assert.match(bootstrap, /ids\.length <= 20 && ids\.join\(","\)\.length <= 240/);
  assert.match(runner, /readAllowlistPreseed\(process\.env\.TENANT_TABLE_ALLOWLIST_FIXTURE\)/);
  assert.match(runner, /await item\.prove\(owned, ctx\)/);
  assert.match(runner, /expectStatus\(await request\(item\.foreign/);
});
test("verified source gate keys (including distinct operational versus historical outlook gates)", () => {
  const contracts = {
    "src/lib/hcm-team-leave-calendar-contract.ts": ["HCM_TEAM_LEAVE_CALENDAR_ENABLED", "HCM_TEAM_LEAVE_CALENDAR_ORG_IDS"],
    "src/lib/hcm-process-monitor.ts": ["HCM_PROCESS_MONITOR_ENABLED", "HCM_PROCESS_MONITOR_ORG_IDS"],
    "src/lib/hcm-org-explorer-access.ts": ["HCM_ORG_EXPLORER_ENABLED", "HCM_ORG_EXPLORER_ORG_IDS"],
    "src/lib/hcm-manager-decision-contract.ts": ["HCM_MANAGER_DECISION_INBOX_ENABLED", "HCM_MANAGER_DECISION_INBOX_ORG_IDS"],
    "src/app/api/workforce/schedule-receipt-review/route.ts": ["WFM_SCHEDULE_RECEIPTS_ENABLED", "WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS"],
    "src/app/api/workforce/demand-outlook/route.ts": ["WFM_HISTORICAL_OUTLOOK_ENABLED", "WFM_HISTORICAL_OUTLOOK_ALLOWED_ORGANIZATION_IDS"],
    "src/app/api/workforce/demand-observations/outlook/route.ts": ["WFM_OPERATIONAL_DEMAND_ENABLED", "WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS"],
  };
  const bootstrap = readFileSync("scripts/qa/tenant-table-allowlist-bootstrap.mjs", "utf8");
  const profile = readFileSync("scripts/qa/tenant-table-env.mjs", "utf8");
  for (const [path, keys] of Object.entries(contracts)) {
    const contract = readFileSync(path, "utf8");
    for (const key of keys) {
      assert.ok(contract.includes(key), path + " must actually gate on " + key);
      if (key.endsWith("_ENABLED")) {
        assert.ok(profile.includes(key + ': "true"'),
          "disposable allowlisted-reads profile must enable " + key);
      } else {
        assert.ok(bootstrap.includes('"' + key + '"'),
          "bootstrap must export the runtime allowlist key " + key);
      }
    }
  }
});
