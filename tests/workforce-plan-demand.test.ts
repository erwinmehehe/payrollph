import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  demandDates,
  summarizePlanRoleDemand,
  validatePlanDemandHeadcount,
} from "../src/lib/workforce-plan-demand";

test("plan role demand counts only authorized position states in the selected plan and unit", () => {
  const rows = summarizePlanRoleDemand({
    planId: 7,
    orgUnitId: 20,
    positions: [
      { id: 1, planId: 7, jobProfileId: 100, orgUnitId: 20, status: "approved" },
      { id: 2, planId: 7, jobProfileId: 100, orgUnitId: 20, status: "open" },
      { id: 3, planId: 7, jobProfileId: 100, orgUnitId: 20, status: "filled" },
      { id: 4, planId: 7, jobProfileId: 100, orgUnitId: 20, status: "planned" },
      { id: 5, planId: 8, jobProfileId: 100, orgUnitId: 20, status: "approved" },
      { id: 6, planId: 7, jobProfileId: 100, orgUnitId: 21, status: "approved" },
      { id: 7, planId: 7, jobProfileId: 200, orgUnitId: 20, status: "approved" },
    ],
  });

  assert.deepEqual(rows, [
    {
      jobProfileId: 100,
      authorizedHeadcount: 3,
      filledHeadcount: 1,
      vacantHeadcount: 2,
      positionIds: [1, 2, 3],
    },
    {
      jobProfileId: 200,
      authorizedHeadcount: 1,
      filledHeadcount: 0,
      vacantHeadcount: 1,
      positionIds: [7],
    },
  ]);
});

test("WFM demand cannot exceed HCM plan-authorized headcount", () => {
  const role = {
    jobProfileId: 100,
    authorizedHeadcount: 4,
    filledHeadcount: 2,
    vacantHeadcount: 2,
    positionIds: [1, 2, 3, 4],
  };

  assert.doesNotThrow(() => validatePlanDemandHeadcount({ requestedHeadcount: 4, role }));
  assert.throws(
    () => validatePlanDemandHeadcount({ requestedHeadcount: 5, role }),
    /exceeds the plan-authorized headcount of 4/i,
  );
  assert.throws(
    () => validatePlanDemandHeadcount({ requestedHeadcount: 1, role: null }),
    /no approved\/open\/filled position/i,
  );
});

test("plan handoff date windows are explicit and capped at 14 days", () => {
  assert.deepEqual(demandDates("2026-10-01", "2026-10-03"), [
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
  ]);
  assert.throws(
    () => demandDates("2026-10-01", "2026-10-15"),
    /cannot exceed 14 days/i,
  );
});

test("HCM-to-WFM handoff preserves plan and position provenance and fails closed", () => {
  const route = readFileSync("src/app/api/workforce-planning/demand-handoff/route.ts", "utf8");
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const panel = readFileSync("src/components/workforce-planning-panel.tsx", "utf8");

  assert.ok(route.includes("enforceSameOriginMutation"));
  assert.ok(route.includes("requireSensitiveActionMfa"));
  assert.ok(route.includes("assertScope"));
  assert.ok(route.includes("validatePlanDemandHeadcount"));
  assert.ok(route.includes('sourceType: "hcm_plan"'));
  assert.ok(route.includes("sourcePlanId: planId"));
  assert.ok(route.includes("sourcePositionIds: positionIds"));
  assert.ok(route.includes("HCM workforce plan handed to WFM demand"));
  assert.ok(route.includes("A manually managed or differently sourced staffing requirement already exists"));

  assert.ok(schema.includes('sourcePlanId: integer("source_plan_id")'));
  assert.ok(schema.includes('sourcePositionIds: jsonb("source_position_ids")'));
  assert.ok(panel.includes("HCM → WFM DEMAND HANDOFF"));
  assert.ok(panel.includes("/api/workforce-planning/demand-handoff"));
  assert.ok(panel.includes("Linaw does not guess operational demand from HCM records"));
});
