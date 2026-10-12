import assert from "node:assert/strict";
import test from "node:test";
import { getTableName } from "drizzle-orm";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import { firstPayrollPreviewResult } from "../src/lib/first-payroll-preview";
import { FIRST_PAYROLL_STEPS, journeyRoleCanReviewTime, validJourneySchedule } from "../src/lib/first-payroll-journey";

const schedule = { periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-15" };

test("inline payroll is disabled unless the exact enabling value is supplied", () => {
  for (const value of [undefined, "", "TRUE", "false"]) assert.equal(criticalReleaseFlagEnabled("inlineFirstPayroll", { INLINE_FIRST_PAYROLL_ENABLED: value }), false);
  assert.equal(criticalReleaseFlagEnabled("inlineFirstPayroll", { INLINE_FIRST_PAYROLL_ENABLED: "true" }), true);
});

test("schedule and human review remain separate readiness requirements", () => {
  assert.equal(validJourneySchedule(schedule), true);
  assert.equal(validJourneySchedule({ ...schedule, periodEnd: "2026-02-30" }), false);
  assert.equal(validJourneySchedule({ ...schedule, payDate: "2026-09-01" }), false);
  assert.equal(journeyRoleCanReviewTime("checker"), false);
  assert.equal(journeyRoleCanReviewTime("hr"), true);
  assert.deepEqual(FIRST_PAYROLL_STEPS.map(s => s.ownerRole), ["owner", "hr", "hr", "owner", "payroll", "checker", "bookkeeper"]);
  const row = { employeeId: 1, name: "Synthetic Worker", gross: 15000, sss: 750, philHealth: 375, pagIbig: 100, withholding: 500, net: 13275, missingTin: true, missingBank: true, status: "Ready" };
  const blocked = firstPayrollPreviewResult([row], null, false);
  assert.equal(blocked.previewReady, false);
  assert.equal(blocked.blockers.length, 4);
  assert.equal(firstPayrollPreviewResult([{ ...row, missingTin: false, missingBank: false }], schedule, true).previewReady, true);
});

/** Execute the real production loader/calculator through a strict read-only
 * database double. Every write method throws and is counted. No source grep. */
test("first payroll preview executes the existing engine and writes nothing, including on errors", async () => {
  process.env.DATABASE_URL ??= "postgresql://synthetic:synthetic@127.0.0.1:1/never_connected";
  const { loadFirstPayrollPreview } = await import("../src/lib/first-payroll-preview-server");
  const { db } = await import("../src/db");
  let writes = 0;
  let selected = 0;
  const employee = {
    id: 1, organizationId: 99, legalEntityId: null, orgUnitId: null,
    employeeNo: "SYN-1", firstName: "Synthetic", lastName: "Worker", middleName: "", email: "", title: "Staff", avatarInitials: "SW", status: "Active",
    basicRate: "30000", startDate: "2026-10-01", region: "NCR", restDay: "Sunday", mwe: false,
    bankAccount: "synthetic-bank", bankCode: "BDO", tin: "synthetic-tin", pagIbigVoluntaryMonthly: "0",
  };
  let havePeople = false;
  let haveSchedule = false;
  let reviewed = false;
  let brokenProfile = false;
  const state = new Map<string, unknown[]>();
  state.set("organizations", [{ id: 99, name: "Synthetic Employer", statutoryDeductionTiming: "split" }]);
  function rows(table: string) {
    if (table === "first_payroll_journey_progress") return haveSchedule ? [{ data: { schedule } }] : [];
    if (table === "employees") return havePeople ? [employee] : [];
    if (table === "employee_pay_profiles") return havePeople && !brokenProfile ? [{ employeeId: 1, payBasis: "monthly", rateAmount: "30000", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8" }] : [];
    if (table === "workforce_attendance_period_locks") return reviewed ? [{ lockedByUserId: 5 }] : [];
    return state.get(table) ?? [];
  }
  const writer = () => { writes++; throw new Error("READ ONLY: write forbidden"); };
  const reader = {
    select() {
      let tableName = "";
      const chain: Record<string, unknown> = {};
      chain.from = (table: Parameters<typeof getTableName>[0]) => { tableName = getTableName(table); selected++; return chain; };
      for (const method of ["where", "limit", "orderBy", "innerJoin", "leftJoin"]) chain[method] = () => chain;
      chain.then = (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows(tableName)).then(resolve);
      return chain;
    }, insert: writer, update: writer, delete: writer, execute: writer,
  };
  const database = { async transaction(fn: (tx: typeof reader) => Promise<unknown>, config: unknown) {
    assert.deepEqual(config, { accessMode: "read only", isolationLevel: "repeatable read" });
    return fn(reader);
  } } as unknown as typeof db;
  // Empty tenant is actionable, without a fabricated payroll run.
  const empty = await loadFirstPayrollPreview(99, database);
  assert.equal(empty.previewReady, false);
  assert.match(empty.blockers.join(" "), /No pay schedule/);
  haveSchedule = true;
  assert.equal((await loadFirstPayrollPreview(99, database)).rows.length, 0);
  havePeople = true;
  const beforeReview = await loadFirstPayrollPreview(99, database);
  assert.equal(beforeReview.rows.length, 1);
  assert.equal(beforeReview.rows[0].gross, 15000);
  assert.ok(beforeReview.rows[0].sss > 0);
  assert.ok(beforeReview.rows[0].net < beforeReview.rows[0].gross);
  assert.equal(beforeReview.previewReady, false);
  reviewed = true;
  const ready = await loadFirstPayrollPreview(99, database);
  assert.equal(ready.previewReady, true, JSON.stringify(ready.blockers));
  // Missing payout/TIN produces blockers but still displays the calculation.
  employee.tin = ""; employee.bankAccount = "";
  const missing = await loadFirstPayrollPreview(99, database);
  assert.match(missing.blockers.join(" "), /missing TIN/);
  assert.match(missing.blockers.join(" "), /missing bank/);
  brokenProfile = true;
  await assert.rejects(loadFirstPayrollPreview(99, database), /no pay profile/);
  assert.ok(selected > 25, "the full production input loader was exercised");
  assert.equal(writes, 0);
});

test("the readiness entrypoint renders the inline journey without the legacy navigation checklist", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { FirstPayrollReadinessCard } = await import("../src/components/workspace/first-payroll-readiness");
  const { buildFirstPayrollReadiness } = await import("../src/lib/first-payroll-readiness");
  const html = renderToStaticMarkup(createElement(FirstPayrollReadinessCard, {
    readiness: buildFirstPayrollReadiness({ workspaceName: "New tenant", employees: [], memberships: [], payrollStatuses: [] }),
    onPage: () => { throw new Error("Journey must stay inline"); },
    onNewRun: () => {}, allowedPages: [], guided: true,
    inlineJourney: createElement("section", { "aria-label": "Inline journey" }, "Company form and dry-run preview"),
  }));
  assert.match(html, /Company form and dry-run preview/);
  assert.doesNotMatch(html, /first-payroll-grid|Guided first payroll journey/);
});
