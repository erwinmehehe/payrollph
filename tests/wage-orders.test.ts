import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { holidayMultiplier } from "../src/lib/payroll-rules";
import { FORTHCOMING_WAGE_ORDERS, REGION_VII_WAGE_TIERS, ROVII27_EFFECTIVE_ON, holidayOn, isBelowMinimum, nationalHolidayCalendarForDate, wageOrderFor, WAGE_ORDERS } from "../src/lib/wage-orders";

test("NCR screening reference uses the current official Oct 2026 high tier", () => {
  const order = wageOrderFor("NCR");
  assert.equal(order.wageOrder, "WO-NCR-28");
  assert.equal(order.dailyRate, 755);
  assert.equal(order.effectiveOn, "2026-09-26");
  assert.equal(order.verified, true);
});

test("a ₱14,000 monthly rate is below the NCR screening reference without deciding MWE status", () => {
  const check = isBelowMinimum(14_000, "NCR");
  assert.equal(check.below, true);
  assert.ok(check.impliedDaily < check.order.dailyRate);
  assert.equal(check.order.verified, true);
});

test("a ₱38,500 monthly rate is above the NCR floor", () => {
  assert.equal(isBelowMinimum(38_500, "NCR").below, false);
});

test("Black Saturday 2026 is recognized as a special non-working day", () => {
  const holiday = holidayOn("2026-04-04");
  assert.ok(holiday);
  assert.equal(holiday?.kind, "special");
  const multiplier = holidayMultiplier({ holiday: "special", worked: true });
  assert.equal(multiplier, 1.3);
});

test("Christmas is a regular holiday at 200% when worked", () => {
  const holiday = holidayOn("2026-12-25");
  assert.equal(holiday?.kind, "regular");
  assert.equal(holidayMultiplier({ holiday: "regular", worked: true }), 2);
});

test("every stored screening rate is source-verified but still only one high-tier regional reference", () => {
  assert.equal(WAGE_ORDERS.length, 17);
  for (const order of WAGE_ORDERS) {
    assert.equal(order.verified, true, `${order.region} must be backed by an official NWPC/RTWPB current-rate source`);
  }
  assert.equal(isBelowMinimum(20_000, "XI").order.verified, true);
});

test("future tranches are not activated early", () => {
  assert.equal(wageOrderFor("VII").dailyRate, 540, "ROVII-27 takes effect only on 2026-10-14");
  assert.equal(wageOrderFor("V").dailyRate, 455, "Bicol second tranche takes effect only on 2026-12-01");
  assert.equal(wageOrderFor("BARMM").dailyRate, 436, "BARMM second tranche takes effect only on 2026-12-01");
});

test("every region has exactly one wage order, and the hire form's dropdown has a region to pick from", () => {
  const regions = WAGE_ORDERS.map((order) => order.region);
  assert.equal(new Set(regions).size, regions.length, "no duplicate region keys");
  for (const region of ["NCR", "CAR", "I", "II", "III", "IV-A", "IV-B", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "BARMM"]) {
    assert.ok(regions.includes(region), `missing region ${region}`);
  }
});


test("national holiday calendar is effective-dated and fails closed outside certified coverage", () => {
  assert.equal(nationalHolidayCalendarForDate("2026-12-25").some((holiday) => holiday.date === "2026-12-25"), true);
  assert.throws(() => nationalHolidayCalendarForDate("2025-12-25"), /No certified Philippine national-holiday rule pack/);
  assert.throws(() => nationalHolidayCalendarForDate("2027-01-01"), /No certified Philippine national-holiday rule pack/);
});

test("unknown wage regions cannot silently use the NCR wage reference", () => {
  assert.equal(wageOrderFor(" ncr ").region, "NCR");
  assert.throws(() => wageOrderFor("UNKNOWN"), /Unknown Philippine wage region/);
  assert.throws(() => wageOrderFor(""), /Unknown Philippine wage region/);
  assert.throws(() => isBelowMinimum(14_000, "IX", 0), /positive working days/);
  assert.throws(() => isBelowMinimum(Number.NaN, "IX"), /non-negative monthly rate/);
});


test("employee creation validates wage regions at the API boundary before payroll", () => {
  const source = readFileSync("src/app/api/employees/route.ts", "utf8");
  assert.ok(source.includes('wageRegion = wageOrderFor(String(body.region ?? "NCR")).region'));
  assert.ok(source.includes('code: "INVALID_WAGE_REGION"'));
  assert.ok(source.includes('status: 422'));
  assert.ok(source.includes("region: wageRegion"));
  assert.ok(!source.includes('region: String(body.region ?? "NCR")'));
  assert.equal(wageOrderFor(" iv-b ").region, "IV-B");
});


test("official ROVII-27 Class A and Class B rates activate only on 14 October 2026", () => {
  assert.equal(ROVII27_EFFECTIVE_ON, "2026-10-14");
  assert.equal(REGION_VII_WAGE_TIERS.length, 2);
  assert.deepEqual(REGION_VII_WAGE_TIERS.map((item) =>
    [item.wageClass, item.oldDailyRate, item.newDailyRate]), [
    ["A", 540, 582], ["B", 500, 542],
  ]);
  assert.equal(FORTHCOMING_WAGE_ORDERS.length, 1, "region-only screening uses Class A maximum");
  for (const [wageClass, before, after] of [["A", 540, 582], ["B", 500, 542]] as const) {
    assert.equal(wageOrderFor("VII", "2026-10-13", wageClass).dailyRate, before);
    assert.equal(wageOrderFor("VII", "2026-10-14", wageClass).dailyRate, after);
    assert.equal(wageOrderFor("VII", "2026-10-15", wageClass).wageOrder, "WO-ROVII-27");
  }
  assert.equal(wageOrderFor("VII", "2026-10-10").dailyRate, 540);
  assert.equal(wageOrderFor("VII", "2026-10-14").dailyRate, 582);
  assert.equal(wageOrderFor("VII").dailyRate, 540, "undated generic screens preserve baseline");
  assert.equal(wageOrderFor("NCR", "2026-10-14").dailyRate, 755);
  assert.throws(() => wageOrderFor("VII", "2026-02-29"), /Invalid wage screening calendar date/);
  assert.throws(() => wageOrderFor("NCR", "2026-10-14", "B"), /only be selected for Region VII/);
  assert.throws(() => wageOrderFor("VII", "2026-10-14", "C" as never), /Invalid Region VII wage class/);
});

test("Class B screen does not use the higher Class A threshold after effectivity", () => {
  const monthly = 550 * 22;
  assert.equal(isBelowMinimum(monthly, "VII", 22, "2026-10-13", "A").below, false);
  assert.equal(isBelowMinimum(monthly, "VII", 22, "2026-10-14", "A").below, true);
  assert.equal(isBelowMinimum(monthly, "VII", 22, "2026-10-14", "B").below, false);
  assert.equal(isBelowMinimum(monthly, "VII", 22, "2026-10-14").below, true,
    "unknown locality stays conservative, not an automatic legal wage assignment");
  const engine = readFileSync("src/lib/payroll-engine.ts", "utf8");
  assert.ok(engine.includes('isBelowMinimum(monthly, input.employee.region ?? "NCR", payProfile.standardWorkDaysPerMonth, input.payDate)'),
    "payroll warning must use pay date, not today's unpublished or future rate");
});
