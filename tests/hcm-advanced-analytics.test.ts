import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  daysBetween,
  performanceDistribution,
  reconstructHeadcountTrend,
  recruitingFunnel,
  reportableSensitiveCohort,
  traceInputNumber,
} from "../src/lib/hcm-analytics";
import { calculateCareerReadiness } from "../src/lib/career-readiness";

test("reconstructs month-end headcount from hires and released separations", () => {
  const trend = reconstructHeadcountTrend({
    today: "2026-05-15",
    months: 5,
    employees: [
      { id: 1, startDate: "2025-12-01" },
      { id: 2, startDate: "2026-03-10" },
      { id: 3, startDate: "2026-06-01" },
    ],
    separations: [
      { employeeId: 1, lastDay: "2026-04-20", status: "released" },
    ],
  });

  assert.deepEqual(trend.map((row) => row.headcount), [1, 1, 2, 1, 1]);
  assert.equal(trend.at(-1)?.date, "2026-05-15");
});

test("days-between and recruiting funnel use authoritative lifecycle timestamps", () => {
  assert.equal(daysBetween("2026-01-01", "2026-01-31"), 30);
  assert.deepEqual(
    recruitingFunnel(["applied", "applied", "interview", "hired", "rejected"]).map((row) => row.count),
    [2, 0, 1, 0, 1, 1],
  );
});

test("performance distribution uses fixed score buckets", () => {
  const rows = performanceDistribution([1.5, 2.2, 3.1, 3.9, 4.8, 5]);
  assert.deepEqual(rows.map((row) => row.count), [1, 1, 2, 1, 1]);
});

test("analytics privacy threshold never drops below five", () => {
  assert.equal(reportableSensitiveCohort(4), false);
  assert.equal(reportableSensitiveCohort(5), true);
});

test("payroll trace exposes persisted employer statutory cost without recomputation", () => {
  const trace = { inputs: ["gross=50000.00", "employerStatutoryCost=4235.50"] };
  assert.equal(traceInputNumber(trace, "employerStatutoryCost"), 4235.5);
  assert.equal(traceInputNumber(trace, "missing"), 0);
});

test("shared career readiness preserves critical-skill weighting", () => {
  const rows = calculateCareerReadiness({
    employees: [{ id: 10 }],
    assignments: [{ employeeId: 10, positionId: 100 }],
    positions: [{ id: 100, jobProfileId: 1 }],
    profiles: [{ id: 1 }, { id: 2 }],
    requirements: [
      { jobProfileId: 2, skillId: 7, requiredLevel: 4, critical: true },
      { jobProfileId: 2, skillId: 8, requiredLevel: 3, critical: false },
    ],
    skills: [
      { employeeId: 10, skillId: 7, proficiencyLevel: 2 },
      { employeeId: 10, skillId: 8, proficiencyLevel: 3 },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].readinessPercent, 67);
  assert.equal(rows[0].criticalGaps.length, 1);
});

test("advanced analytics joins HCM domains while keeping sensitive buckets aggregate-only", () => {
  const route = readFileSync("src/app/api/hcm-analytics/route.ts", "utf8");
  assert.ok(route.includes("WORKFORCE_MANAGER_ROLES"));
  assert.ok(route.includes('access.role === "bookkeeper"'));
  assert.ok(route.includes("calculateCareerReadiness"));
  assert.ok(route.includes('traceInputNumber(row.trace, "employerStatutoryCost")'));
  assert.ok(route.includes("employerBenefitMonthlyRunRate"));
  assert.ok(route.includes("forecastAnnualLoadedCost"));
  assert.ok(route.includes("current organization unit"));
  assert.ok(route.includes("scopedCostReportable"));
  assert.ok(route.includes("At least 5 active employees are required before unit-scoped payroll cost aggregates are shown."));
  assert.ok(route.includes("bucket.count === 0 || bucket.count >= HCM_ANALYTICS_PRIVACY_THRESHOLD"));
  assert.ok(route.includes("readyCountReportable"));
  assert.ok(route.includes("reportableCohort(scopedResponses.length, threshold)"));
});

test("advanced analytics exposes no raw anonymous engagement comments", () => {
  const route = readFileSync("src/app/api/hcm-analytics/route.ts", "utf8");
  assert.equal(route.includes("textValue"), false);
  assert.equal(route.includes("comments:"), false);
});

test("learning and analytics use one career-readiness calculation", () => {
  const learning = readFileSync("src/app/api/learning-career/route.ts", "utf8");
  const analytics = readFileSync("src/app/api/hcm-analytics/route.ts", "utf8");
  assert.ok(learning.includes('calculateCareerReadiness({'));
  assert.ok(analytics.includes('calculateCareerReadiness({'));
});

test("talent analytics are layered into Analytics only for HCM roles", () => {
  const analytics = readFileSync("src/components/workspace/analytics.tsx", "utf8");
  const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");
  const panel = readFileSync("src/components/hcm-analytics-panel.tsx", "utf8");

  assert.ok(analytics.includes("<HcmAnalyticsPanel"));
  assert.ok(workspace.includes('["owner", "admin", "hr", "manager"].includes(effectiveRole ?? "")'));
  assert.ok(panel.includes("CONNECTED HCM INTELLIGENCE"));
  assert.ok(panel.includes("Small compensation buckets remain hidden"));
});
