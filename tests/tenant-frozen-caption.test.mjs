import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { reconcileKnownEdg02MainCaption } from "./helpers/tenant-frozen-caption.mjs";

const oldCaption = "Frozen subtotal: **372 COVERED + 15 PUBLIC-BY-DESIGN + 12 PRIVILEGED-OPERATIONS-TOKEN-ONLY + 7 GAP = 406**. Relative to the live 498-method ledger, the other **92 methods** are **84 COVERED and 8 PUBLIC-BY-DESIGN**. 4 batches remain INCOMPLETE (DL-01, MNY-01, EDG-01, EDG-02); DL-02, MNY-02, STA-01, PII-01, PII-02, WRK-01, WRK-02, WRK-03 remain PROVISIONAL — NOT ACCEPTED.";
const repairedCaption = "Frozen subtotal: **372 COVERED + 15 PUBLIC-BY-DESIGN + 12 PRIVILEGED-OPERATIONS-TOKEN-ONLY + 7 GAP = 406**. Relative to the live 498-method ledger, the other **92 methods** are **84 COVERED and 8 PUBLIC-BY-DESIGN**. 3 batches remain INCOMPLETE; DL-02, MNY-02, STA-01, PII-01, PII-02, WRK-01, WRK-02, WRK-03, EDG-02 remain PROVISIONAL — NOT ACCEPTED.";
const historicalPlanBlob = "f5b46002c4889da8155cc630ca8ecf55e179e5c1";
const inputs = () => ({ actual: oldCaption, expected: repairedCaption,
  current: repairedCaption, baselinePlanBlob: historicalPlanBlob });

test("reproduces the exact old-main caption mismatch", () => {
  assert.notEqual(oldCaption, repairedCaption);
  assert.match(oldCaption, /4 batches remain INCOMPLETE/);
  assert.match(repairedCaption, /3 batches remain INCOMPLETE/);
  assert.match(repairedCaption, /WRK-03, EDG-02 remain PROVISIONAL/);
});

test("recognizes only the exact pinned main document after the checkout repairs it", () => {
  const input = inputs(), before = structuredClone(input);
  assert.equal(reconcileKnownEdg02MainCaption(input), repairedCaption);
  assert.deepEqual(input, before);
});

test("already-correct main needs no historical exception", () => {
  assert.equal(reconcileKnownEdg02MainCaption({ actual: repairedCaption,
    expected: repairedCaption, current: repairedCaption,
    baselinePlanBlob: "new-reviewed-main" }), repairedCaption);
});

const rejected = [
  ["unknown main document bytes", p => { p.baselinePlanBlob = "0".repeat(40); }],
  ["missing main identity", p => { delete p.baselinePlanBlob; }],
  ["unrepaired checkout", p => { p.current = oldCaption; }],
  ["missing or duplicate checkout summary", p => { p.current = undefined; }],
  ["changed checkout count", p => { p.current = repairedCaption.replace("372 COVERED", "373 COVERED"); }],
  ["changed main count", p => { p.actual = oldCaption.replace("372 COVERED", "373 COVERED"); }],
  ["changed main GAP total", p => { p.actual = oldCaption.replace("7 GAP", "6 GAP"); }],
  ["changed expected COVERED total", p => { p.expected = repairedCaption.replace("372 COVERED", "373 COVERED"); p.current = p.expected; }],
  ["changed expected GAP total", p => { p.expected = repairedCaption.replace("7 GAP", "6 GAP"); p.current = p.expected; }],
  ["unrelated omitted batch", p => { p.actual = oldCaption.replace("PII-01, ", ""); }],
  ["extra provisional batch", p => { p.expected = repairedCaption.replace("DL-02, ", "DL-01, DL-02, "); p.current = p.expected; }],
  ["invented main acceptance", p => { p.actual = oldCaption.replace("NOT ACCEPTED", "ACCEPTED"); }],
  ["invented expected acceptance", p => { p.expected = repairedCaption.replace("NOT ACCEPTED", "ACCEPTED"); p.current = p.expected; }],
  ["different historical wording", p => { p.actual += " Approved."; }],
  ["missing main caption", p => { p.actual = undefined; }],
];
for (const [label, mutate] of rejected) {
  test("does not reconcile " + label, () => {
    const input = inputs(); mutate(input);
    assert.notEqual(reconcileKnownEdg02MainCaption(input), input.expected);
  });
}

// Exercise the actual checkout's first/current table, not later historical tables.
// The table is additionally validated against all 406 source-linked methods by
// tenant-six-method-proof-review.test.mjs before its main-caption comparison.
const plan = readFileSync("docs/engineering/tenant-isolation-closure-plan.md", "utf8");
const section = plan.split("### Current 406-method frozen batch queue")[1]
  ?.split("### Three narrowly promoted API methods")[0];

test("checkout summary matches every current batch, total and provisional label", () => {
  assert.ok(section, "Current frozen table is required");
  const rows = section.split("\n").filter(line => /^\| \d+ \| \*\*/.test(line))
    .map(line => line.split("|").slice(1, -1).map(cell => cell.trim()));
  assert.equal(rows.length, 12);
  const totals = [0, 0, 0, 0, 0], provisional = [];
  for (const [, name, ...cells] of rows) {
    const values = cells.slice(0, 5).map(Number);
    assert.ok(values.every(value => Number.isSafeInteger(value) && value >= 0));
    assert.equal(values[0], values.slice(1).reduce((a, b) => a + b, 0));
    values.forEach((value, index) => { totals[index] += value; });
    assert.equal(cells[5], values[4] ? "INCOMPLETE" : "PROVISIONAL \u2014 NOT ACCEPTED");
    if (values[4] === 0) provisional.push(name.replaceAll("**", ""));
  }
  assert.equal(totals[0], 406);
  const captions = section.split("\n").filter(line => line.startsWith("Frozen subtotal"));
  assert.equal(captions.length, 1, "One unambiguous current summary is required");
  const incomplete = rows.length - provisional.length;
  const m = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8")).metrics;
  const outside = [[m.coveredAfter - totals[1], "COVERED"], [m.publicByDesign - totals[2], "PUBLIC-BY-DESIGN"],
    [m.privilegedOperationsTokenOnly - totals[3], "PRIVILEGED-OPERATIONS-TOKEN-ONLY"], [m.gap - totals[4], "GAP"]];
  assert.ok(outside.every(([n]) => Number.isSafeInteger(n) && n >= 0));
  assert.equal(outside.reduce((sum, [n]) => sum + n, 0), m.methods - totals[0]);
  const outsideText = outside.filter(([n]) => n > 0).map(([n, status]) => n + " " + status).join(" + ");
  const summary = `Frozen subtotal (2026-11-11 classification proposal): **${totals[1]} COVERED + ${totals[2]} PUBLIC-BY-DESIGN + ${totals[3]} PRIVILEGED-OPERATIONS-TOKEN-ONLY + ${totals[4]} GAP = 406**. Relative to the live ${m.methods}-method ledger, the other **${m.methods - totals[0]} methods** are **${outsideText}**. ${incomplete} batches remain INCOMPLETE; ${provisional.join(", ")} remain PROVISIONAL \u2014 NOT ACCEPTED.`;
  assert.equal(captions[0], summary, "Frozen summary must reflect the verified current table");
});
