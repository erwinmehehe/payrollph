import assert from "node:assert/strict";
import test from "node:test";

import { importedDeMinimisFinalPayAdjustment } from "../src/lib/final-pay-imported-de-minimis";
import { finalPaySourceFingerprint, type FinalPayFingerprintInputs } from "../src/lib/final-pay-source-fingerprint";

const row = (id: number, payDate: string, gross: number, breakdown: unknown) => ({ id, payDate, grossPay: gross, deMinimisBreakdown: breakdown });
const dm = (payDate: string, category: string, amount: number, pool = 0) => ({
  payDate, lineItems: [{ code: `DM-${category}`, amount: amount.toFixed(2), periodOtherBenefitsPool: pool }],
});

test("no imported de minimis changes nothing, whatever the engine paid", () => {
  assert.deepEqual(importedDeMinimisFinalPayAdjustment([row(1, "2026-01-31", 30000, null), row(2, "2026-02-28", 30000, {})], [dm("2026-07-15", "uniformClothing", 1000)]), { exempt: 0, excess: 0 });
  assert.deepEqual(importedDeMinimisFinalPayAdjustment([row(1, "2026-01-31", 30000, { riceSubsidy: 0 })], []), { exempt: 0, excess: 0 });
});

test("a monthly ceiling is applied to each imported month and the part above joins the pool", () => {
  const rows = ["01", "02", "03"].map((m, i) => row(i + 1, `2026-${m}-28`, 33000, { riceSubsidy: 3000 }));
  assert.deepEqual(importedDeMinimisFinalPayAdjustment(rows, []), { exempt: 7500, excess: 1500 });
});

test("an annual ceiling is applied once across the imported months", () => {
  const rows = [1, 2, 3, 4, 5, 6].map((m) => row(m, `2026-0${m}-28`, 32000, { uniformClothing: 2000 }));
  assert.deepEqual(importedDeMinimisFinalPayAdjustment(rows, []), { exempt: 8000, excess: 4000 });
});

test("the ceiling is shared with the engine's own lines and the delta replaces their separately capped figures", () => {
  const rows = [1, 2, 3, 4, 5, 6].map((m) => row(m, `2026-0${m}-28`, 32000, { uniformClothing: 2000 }));
  // The engine already knew the imported 12,000: its lines show 0 exempt and 6,000 excess a cutoff for 12 cutoffs.
  const engine = Array.from({ length: 12 }, (_, i) => dm(`2026-${String(7 + Math.floor(i / 2)).padStart(2, "0")}-${i % 2 ? 28 : 15}`, "uniformClothing", 6000, 6000));
  // Union: 12,000 + 72,000 = 84,000 -> 8,000 exempt, 76,000 excess. Engine lines: 0 exempt, 72,000 excess. Delta: 8,000 / 4,000.
  assert.deepEqual(importedDeMinimisFinalPayAdjustment(rows, engine), { exempt: 8000, excess: 4000 });
});

test("engine meal allowance and leave-day lines are left exactly as the engine accounted them", () => {
  const rows = [row(1, "2026-01-31", 33000, { riceSubsidy: 3000 })];
  const engine = [dm("2026-07-15", "mealAllowance", 500, 100), dm("2026-07-15", "monetizedVacationLeaveDays", 900, 0)];
  assert.deepEqual(importedDeMinimisFinalPayAdjustment(rows, engine), { exempt: 2500, excess: 500 });
});

test("unreadable, invalid, unknown, uncappable and over-gross imported de minimis is refused, never guessed", () => {
  const call = (breakdown: unknown, gross = 33000) => () => importedDeMinimisFinalPayAdjustment([row(9, "2026-01-31", gross, breakdown)], []);
  assert.throws(call([1, 2]), /unreadable de minimis breakdown/);
  assert.throws(call({ riceSubsidy: -1 }), /invalid de minimis amount/);
  assert.throws(call({ riceSubsidy: "abc" }), /invalid de minimis amount/);
  assert.throws(call({ notACategory: 100 }), /unknown de minimis category/);
  assert.throws(call({ monetizedVacationLeaveDays: 3 }), /cannot be applied to imported totals/);
  assert.throws(call({ riceSubsidy: 2500 }, 2000), /more de minimis/);
});

test("a changed imported de minimis breakdown changes the frozen final-pay source, an absent one leaves it unchanged", () => {
  const base = (deMinimisBreakdown?: unknown): FinalPayFingerprintInputs => ({
    employee: { status: "Active", basicRate: 30000, mwe: false, orgUnitId: null, legalEntityId: null, employmentType: "regular", startDate: "2026-01-01" },
    payProfile: { id: 1, payBasis: "monthly", rateAmount: 30000, standardWorkDaysPerMonth: 22, standardHoursPerDay: 8, updatedAt: null },
    released: [],
    historical: [{ id: 1, grossPay: 32500, basicSalary: 30000, thirteenthMonth: 0, taxWithheld: 1007.4, sssEmployee: 1500, philHealthEmployee: 750, pagIbigEmployee: 200, payDate: "2026-01-31", ...(deMinimisBreakdown === undefined ? {} : { deMinimisBreakdown }) }],
    loans: [],
  });
  const without = JSON.stringify(finalPaySourceFingerprint(base()));
  assert.equal(JSON.stringify(finalPaySourceFingerprint(base(null))), without, "a null breakdown must not change the stored shape");
  const rice = JSON.stringify(finalPaySourceFingerprint(base({ riceSubsidy: 2500 })));
  assert.notEqual(rice, without);
  assert.notEqual(JSON.stringify(finalPaySourceFingerprint(base({ riceSubsidy: 3000 }))), rice);
});
