import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { releasedExemptAllowanceYtd } from "../src/lib/final-pay";

const route = readFileSync("src/app/api/separation/route.ts", "utf8");

test("the Separation API still derives ordinary gross as gross pay minus 13th month paid", () => {
  assert.ok(route.includes("ordinaryGrossYtd += Math.max(0, Number(row.grossPay) - parsed.thirteenthPaid);"),
    "released-row gross derivation changed: update Golden Phase 25");
  assert.ok(route.includes("ordinaryGrossYtd += Math.max(0, Number(row.grossPay) - Number(row.thirteenthMonth));"),
    "historical-row gross derivation changed: update Golden Phase 25");
  const passes = route.match(/grossCompensationYtd:\s*sources\.totals\.ordinaryGrossYtd/g) ?? [];
  assert.equal(passes.length, 1, "final pay no longer takes grossCompensationYtd from ordinaryGrossYtd: update Golden Phase 25");
});

test("the separation calculation takes its exemption only from loaded released rows", () => {
  const call = route.slice(route.indexOf("computeFinalPay({"), route.indexOf("const dueDate = finalPayDueDate"));
  assert.ok(call.includes("releasedExemptAllowanceYtd: releasedExemptAllowanceYtd(sources.released),"));
});

test("the Separation API still derives de minimis the way Golden Phase 33 reproduces", () => {
  assert.ok(route.includes("deMinimisPaidYtd += parsed.deMinimisPaid;"), "paid de minimis derivation changed: update Golden Phase 33");
  assert.ok(route.includes("deMinimisExcessYtd += parsed.deMinimisExcess;"), "pool excess derivation changed: update Golden Phase 33");
  assert.ok(route.includes("deMinimisYtd: Number(money(Math.max(0, deMinimisPaidYtd - deMinimisExcessYtd))),"),
    "exempt de minimis is no longer paid less excess: update Golden Phase 33");
  assert.ok(route.includes("deMinimisExcessYtd: Number(money(deMinimisExcessYtd)),"), "excess total changed: update Golden Phase 33");
  const call = route.slice(route.indexOf("computeFinalPay({"), route.indexOf("const dueDate = finalPayDueDate"));
  assert.ok(call.includes("deMinimisYtd: sources.totals.deMinimisYtd,"), "final pay no longer takes the exempt de minimis total: update Golden Phase 33");
  assert.ok(call.includes("deMinimisExcessYtd: sources.totals.deMinimisExcessYtd,"), "final pay no longer takes the pool excess total: update Golden Phase 33");
});

test("released allowance requires consistent outside-pool treatment and exact money", () => {
  const line = { code: "EARN-12", amount: "12000.01", benefitPool90k: false, benefitPoolKind: "taxable_allowance",
    notes: ["Type: taxable_allowance", "Tax treatment: non-taxable"] };
  const total = (...lineItems: unknown[]) => releasedExemptAllowanceYtd([{ lineItems }]);
  assert.equal(total(line), 12000.01);
  assert.equal(total({ ...line, benefitPool90k: true }, { ...line, code: "DM-12" },
    { ...line, notes: [...line.notes, "Tax treatment: taxable"] },
    { ...line, notes: ["Type: taxable_allowance", "Tax treatment: taxable"] }), 0);
  assert.throws(() => total({ ...line, amount: "12000.001" }), /Invalid released/);
});
