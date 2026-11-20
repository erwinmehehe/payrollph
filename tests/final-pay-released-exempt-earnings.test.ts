import test from "node:test";
import assert from "node:assert/strict";
import { releasedExemptAllowanceYtd } from "../src/lib/final-pay";

const premium = (code: string, amount: string, taxable: "yes" | "no") => ({
  code,
  label: "Company premium, Golden top-up",
  amount,
  notes: [
    "Policy P32 v1 · rule golden",
    "480 worked minute(s)",
    `Taxable: ${taxable} · SSS base: included · Pag-IBIG base: excluded`,
  ],
});
const conversion = (id: number, amount: string, treatment: string) => ({
  code: `LEAVE_CONV-${id}`,
  label: "Leave Conversion (Vacation Leave 5d)",
  amount,
  notes: ["5 days @ daily rate ₱2000", treatment],
});
const allowance = (id: number, amount: string, treatment: string) => ({
  code: `EARN-${id}`,
  label: "Allowance",
  amount,
  benefitPool90k: false,
  benefitPoolKind: "allowance",
  notes: ["Type: allowance", treatment],
});
const rows = (...lineItems: unknown[]) => [{ lineItems }];

test("a non-taxable company premium of every family is a released exempt earning", () => {
  assert.equal(releasedExemptAllowanceYtd(rows(
    premium("PREM-1", "200.00", "no"), premium("OTPREM-2", "300.50", "no"), premium("NDPREM-3", "40.25", "no"), premium("DAYPREM-4", "9.25", "no"),
  )), 550);
});

test("a taxable company premium is not exempt", () => {
  assert.equal(releasedExemptAllowanceYtd(rows(premium("PREM-1", "200.00", "yes"), premium("DAYPREM-2", "50.00", "yes"))), 0);
});

test("an exempt leave conversion is exempt and a taxable one is not", () => {
  assert.equal(releasedExemptAllowanceYtd(rows(conversion(1, "10000.00", "Tax treatment: exempt"))), 10000);
  assert.equal(releasedExemptAllowanceYtd(rows(conversion(2, "10000.00", "Tax treatment: taxable"))), 0);
});

test("the released exempt allowance rule is unchanged, and sums across lines and rows", () => {
  assert.equal(releasedExemptAllowanceYtd(rows(allowance(1, "12000.00", "Tax treatment: non-taxable"))), 12000);
  assert.equal(releasedExemptAllowanceYtd(rows(allowance(2, "12000.00", "Tax treatment: taxable"))), 0);
  assert.equal(releasedExemptAllowanceYtd([
    ...rows(allowance(1, "100.10", "Tax treatment: non-taxable"), premium("PREM-1", "200.20", "no")),
    ...rows(conversion(1, "300.30", "Tax treatment: exempt"), premium("PREM-1", "999.00", "yes")),
  ]), 600.6);
});

test("an exemption is never inferred from a missing, repeated or conflicting note", () => {
  const noNotes = { code: "PREM-1", amount: "200.00" };
  const noTaxNote = { code: "PREM-1", amount: "200.00", notes: ["Policy P32 v1"] };
  const twoTaxNotes = { code: "PREM-1", amount: "200.00", notes: ["Taxable: no · SSS base: included", "Taxable: yes · SSS base: included"] };
  const twoTreatments = { code: "LEAVE_CONV-1", amount: "10000.00", notes: ["Tax treatment: exempt", "Tax treatment: taxable"] };
  const noTreatment = { code: "LEAVE_CONV-2", amount: "10000.00", notes: ["5 days @ daily rate ₱2000"] };
  const lookalike = { code: "PREMIUM-1", amount: "200.00", notes: ["Taxable: no"] };
  const notALine = null;
  assert.equal(releasedExemptAllowanceYtd(rows(noNotes, noTaxNote, twoTaxNotes, twoTreatments, noTreatment, lookalike, notALine)), 0);
});

test("a malformed amount on an exempt line fails closed instead of being skipped", () => {
  assert.throws(() => releasedExemptAllowanceYtd(rows(premium("PREM-1", "-5.00", "no"))), /Invalid released exempt allowance amount/);
  assert.throws(() => releasedExemptAllowanceYtd(rows(conversion(1, "not-a-number", "Tax treatment: exempt"))), /Invalid released exempt allowance amount/);
});

test("rows without line items contribute nothing", () => {
  assert.equal(releasedExemptAllowanceYtd([{ lineItems: null }, { lineItems: "x" }, { lineItems: [] }]), 0);
});
