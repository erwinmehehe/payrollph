import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPositionDemandRequirements,
  normalizeDemandWeekdays,
} from "../src/lib/workforce-position-demand";

test("position demand aggregates multiple authorized positions into one WFM requirement", () => {
  const projected = buildPositionDemandRequirements({
    startDate: "2026-10-05",
    endDate: "2026-10-05",
    rules: [
      {
        id: 1,
        positionId: 101,
        positionStatus: "approved",
        jobProfileId: 7,
        worksiteId: 3,
        shiftDefinitionId: 9,
        weekdays: [1],
        effectiveFrom: "2026-10-01",
        effectiveUntil: null,
        requiredHeadcount: 1,
        active: true,
      },
      {
        id: 2,
        positionId: 102,
        positionStatus: "filled",
        jobProfileId: 7,
        worksiteId: 3,
        shiftDefinitionId: 9,
        weekdays: [1],
        effectiveFrom: "2026-10-01",
        effectiveUntil: null,
        requiredHeadcount: 1,
        active: true,
      },
    ],
  });

  assert.equal(projected.length, 1);
  assert.equal(projected[0].requiredHeadcount, 2);
  assert.deepEqual(projected[0].sourceRefs, [
    { positionId: 101, demandRuleId: 1 },
    { positionId: 102, demandRuleId: 2 },
  ]);
});

test("position demand ignores planned/frozen/closed headcount until it is authorized", () => {
  const rows = buildPositionDemandRequirements({
    startDate: "2026-10-05",
    endDate: "2026-10-05",
    rules: ["planned", "frozen", "closed"].map((positionStatus, index) => ({
      id: index + 1,
      positionId: index + 10,
      positionStatus,
      jobProfileId: 7,
      worksiteId: 3,
      shiftDefinitionId: 9,
      weekdays: [1],
      effectiveFrom: "2026-10-01",
      effectiveUntil: null,
      requiredHeadcount: 1,
      active: true,
    })),
  });
  assert.deepEqual(rows, []);
});

test("position demand respects weekdays and effective dates", () => {
  const rows = buildPositionDemandRequirements({
    startDate: "2026-10-05",
    endDate: "2026-10-11",
    rules: [{
      id: 1,
      positionId: 101,
      positionStatus: "open",
      jobProfileId: 7,
      worksiteId: 3,
      shiftDefinitionId: 9,
      weekdays: [1, 3, 5],
      effectiveFrom: "2026-10-07",
      effectiveUntil: "2026-10-09",
      requiredHeadcount: 1,
      active: true,
    }],
  });
  assert.deepEqual(rows.map((row) => row.workDate), ["2026-10-07", "2026-10-09"]);
});

test("weekday normalization is deterministic and rejects invalid weekdays", () => {
  assert.deepEqual(normalizeDemandWeekdays([5, 1, 1, 8, -1, "3"]), [1, 3, 5]);
});
