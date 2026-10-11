import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  forecastHistoricalStaffingRequirements,
  shiftOutlookDate,
  WFM_OUTLOOK_LOOKBACK_DAYS,
  WFM_OUTLOOK_MAX_ROWS,
  type HistoricalStaffingRequirement,
} from "../src/lib/workforce-demand-outlook";
import { authorizedOutlookSite } from "../src/lib/workforce-demand-outlook-scope";

const today = "2026-10-12"; // Philippine Monday
const site = 70;
const values = [2, 2, 2, 2, 2, 2, 3, 3, 4, 4, 4, 5];
function mondays(count = values.length, numbers = values): HistoricalStaffingRequirement[] {
  return Array.from({ length: count }, (_, i) => ({
    worksiteId: site,
    shiftDefinitionId: 19,
    jobProfileId: 31,
    workDate: shiftOutlookDate(today, -7 * (count - i)),
    requiredHeadcount: numbers[i] ?? 2,
  }));
}
const calc = (rows: readonly HistoricalStaffingRequirement[], horizonDays: 7 | 14 = 7) =>
  forecastHistoricalStaffingRequirements({ today, horizonDays, worksiteId: site, rows });

test("weekday forecast is deterministic and uses only prior same-weekday staffing requirements", () => {
  const history = mondays().reverse(); // unordered database import
  const outcome = calc(history);
  assert.equal(outcome.status, "ready");
  assert.equal(outcome.historicalRows, 12);
  assert.equal(outcome.distinctCohorts, 1);
  assert.equal(outcome.daysForecast, 1, "unknown Tue-Sun dates are never inferred as zero");
  assert.equal(outcome.forecasts.length, 1);
  const row = outcome.forecasts[0];
  assert.equal(row.workDate, today);
  assert.equal(row.estimatedHeadcount, 4); // six weighted historic Mondays: [3,3,4,4,4,5]
  assert.equal(row.lowerScenarioHeadcount, 3);
  assert.equal(row.upperScenarioHeadcount, 5);
  assert.equal(row.backtestObservations, 3);
  assert.equal(row.backtestMaeHeadcount, 1);
  assert.equal(outcome.holdout.wapePercent, 23.08);
  assert.equal(outcome.holdout.comparisons, 3);
  assert.match(outcome.boundary, /not measured customer demand/);
});

test("fourteen-day projection repeats only evidenced weekdays, no silent zero-demand weekend", () => {
  const outcome = calc(mondays(), 14);
  assert.deepEqual(outcome.forecasts.map(item => item.workDate), [today, "2026-10-19"]);
  assert.equal(outcome.forecasts.every(item => item.estimatedHeadcount === 4), true);
  assert.equal(outcome.daysForecast, 2);
});

test("holdout tests do not use the observations being predicted", () => {
  const base = mondays();
  const original = calc(base);
  base[base.length - 1].requiredHeadcount = 80;
  const mutated = calc(base);
  assert.notEqual(original.holdout.maeHeadcount, mutated.holdout.maeHeadcount);
  assert.equal(mutated.holdout.comparisons, 3);
  assert.ok(mutated.forecasts[0].estimatedHeadcount > original.forecasts[0].estimatedHeadcount);
});

test("insufficient, partial or stale weekdays cannot fabricate an outlook", () => {
  assert.equal(calc([]).status, "insufficient_history");
  assert.equal(calc(mondays(8)).status, "insufficient_history");
  const old = mondays(9).map(row => ({ ...row, workDate: shiftOutlookDate(row.workDate, -70) }));
  assert.equal(calc(old).status, "insufficient_history");
  assert.equal(calc(old).forecasts.length, 0);
  assert.equal(calc(mondays().map(row => ({ ...row, requiredHeadcount: 0 }))).forecasts[0].estimatedHeadcount, 0,
    "an explicit zero is allowed; a missing record never becomes zero");
});

test("duplicate source days, cross-site data, impossible headcount and future dates fail closed", () => {
  const base = mondays();
  assert.equal(calc([...base, { ...base[0], requiredHeadcount: 99 }]).status, "source_review");
  assert.equal(calc([...base.slice(1), { ...base[0], worksiteId: 71 }]).status, "source_review");
  assert.equal(calc([...base.slice(1), { ...base[0], requiredHeadcount: -2 }]).status, "source_review");
  assert.equal(calc([...base.slice(1), { ...base[0], workDate: today }]).status, "source_review");
  assert.equal(calc([...base.slice(1), { ...base[0], workDate: "2026-02-30" }]).status, "source_review");
  const oversize = Array.from({ length: WFM_OUTLOOK_MAX_ROWS + 1 }, () => base[0]);
  assert.equal(calc(oversize).status, "source_review", "no silent paging or partial forecast");
});

test("calendar arithmetic is Manila-independent, validates leap dates and protects scope", () => {
  assert.equal(shiftOutlookDate("2024-03-01", -1), "2024-02-29");
  assert.equal(shiftOutlookDate(today, -WFM_OUTLOOK_LOOKBACK_DAYS), "2026-04-13");
  assert.throws(() => shiftOutlookDate("2026-02-29", 1), /Invalid staffing history calendar date/);
  assert.throws(() => shiftOutlookDate(today, 367), /Invalid staffing outlook calendar offset/);
  assert.throws(() => forecastHistoricalStaffingRequirements({
    today, worksiteId: site, horizonDays: 9 as 7, rows: [],
  }), /Invalid staffing outlook scope/);
});

test("manager cannot request other employer, unassigned, null-unit or inactive worksite", () => {
  const manager = { organizationId: 4, orgUnitId: 9, companyWide: false };
  assert.equal(authorizedOutlookSite(manager, { organizationId: 4, orgUnitId: 9, active: true }), true);
  assert.equal(authorizedOutlookSite(manager, { organizationId: 5, orgUnitId: 9, active: true }), false);
  assert.equal(authorizedOutlookSite(manager, { organizationId: 4, orgUnitId: 10, active: true }), false);
  assert.equal(authorizedOutlookSite(manager, { organizationId: 4, orgUnitId: null, active: true }), false);
  assert.equal(authorizedOutlookSite({ ...manager, orgUnitId: null }, { organizationId: 4, orgUnitId: null, active: true }), false);
  assert.equal(authorizedOutlookSite(manager, { organizationId: 4, orgUnitId: 9, active: false }), false);
  const owner = { organizationId: 4, orgUnitId: null, companyWide: true };
  assert.equal(authorizedOutlookSite(owner, { organizationId: 4, orgUnitId: null, active: true }), true);
  assert.equal(authorizedOutlookSite(owner, { organizationId: 5, orgUnitId: null, active: true }), false);
});

test("outlook API remains authenticated, strict tenant/site scoped, read-only and bounded", () => {
  const route = readFileSync("src/app/api/workforce/demand-outlook/route.ts", "utf8");
  const panel = readFileSync("src/components/workspace/workforce-demand-outlook-panel.tsx", "utf8");
  const coverage = readFileSync("src/components/workspace/workforce-coverage-panel.tsx", "utf8");
  assert.match(route, /await getSessionUser\(\)/);
  assert.match(route, /await getAccess\(user.id, organizationId\)/);
  assert.match(route, /WORKFORCE_MANAGER_ROLES/);
  assert.match(route, /eq\(worksites.organizationId, organizationId\)/);
  assert.match(route, /authorizedOutlookSite\(access, site\)/);
  assert.match(route, /eq\(staffingRequirements.organizationId, organizationId\)/);
  assert.match(route, /eq\(staffingRequirements.worksiteId, site.id\)/);
  assert.match(route, /lt\(staffingRequirements.workDate, today\)/);
  assert.match(route, /limit\(WFM_OUTLOOK_MAX_ROWS \+ 1\)/);
  assert.match(route, /Cache-Control": "private, no-store"/);
  assert.doesNotMatch(route, /export async function POST/);
  assert.match(coverage, /<WorkforceDemandOutlookPanel/);
  assert.match(panel, /AbortController/);
  assert.match(panel, /json.scope\?\.organizationId !== organizationId/);
  assert.match(panel, /readOnly !== true/);
  assert.match(panel, /not external traffic or measured business demand/i);
});
