import type { Bir2316Withholding } from "./bir-2316-withholding";
/** Read-only review of September 2021 ENCS items. Never computes payroll tax,
 * fills missing evidence with zero, signs a certificate or authorizes filing. */
export const BIR_2316_NON_TAX_ITEMS = ["29", "30", "31", "32", "33", "34", "35", "36", "37"] as const;
export const BIR_2316_TAX_ITEMS = ["39", "40", "41", "42", "43", "44A", "44B", "45", "46", "47", "48", "49", "50", "51A", "51B"] as const;
type Money = number | string | null | undefined;
export type Bir2316ReviewSource = {
  grossCompensation: Money; nonTaxable: Money; taxableIncome: Money;
  taxDue: Money; withheldBeforeYearEnd: Money; yearEndAdjustment: Money;
};
export type Bir2316MappingEvidence = {
  /** Explicit reviewer-mapped present-employer detail items; zeros are evidence. */
  detailItems: Record<string, Money>;
  previousEmployer: { status: "none-confirmed" } | {
    status: "verified"; taxableCompensation: Money; taxWithheld: Money;
  };
  /** Released ledger amount, not tax due or an expected adjustment. */
  actualPresentWithheld: Money;
  /** Positive=actual collection; negative=actual refund. Unknown is not zero. */
  appliedAdjustment: Money;
  peraCredit: Money;
};
export function bir2316Centavos(value: Money, signed = false): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value);
  if (!(signed ? /^-?(0|[1-9]\d*)(\.\d{1,2})?$/ : /^(0|[1-9]\d*)(\.\d{1,2})?$/).test(text)) return null;
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace(/^-/, "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? (negative ? -cents : cents) : null;
}
export function reviewBir2316Summary(source: Bir2316ReviewSource, evidence?: Bir2316MappingEvidence, withholding?: Bir2316Withholding) {
  const issues: Array<{ code: string; message: string }> = [];
  const add = (code: string, message: string) => issues.push({ code, message });
  const read = (value: Money, field: string, signed = false) => {
    const cents = bir2316Centavos(value, signed);
    if (cents === null) add("INVALID_OR_MISSING_AMOUNT", field + " requires a finite, explicit centavo amount.");
    return cents;
  };
  const gross = read(source.grossCompensation, "Present gross");
  const exempt = read(source.nonTaxable, "Present exempt total");
  const taxable = read(source.taxableIncome, "Present taxable total");
  const due = read(source.taxDue, "Tax due");
  const before = read(source.withheldBeforeYearEnd, "Withholding before adjustment");
  const adjustment = read(source.yearEndAdjustment, "Expected adjustment", true);
  const expected = before === null || adjustment === null ? null : before + adjustment;
  if (expected !== null && !Number.isSafeInteger(expected)) add("INVALID_OR_MISSING_AMOUNT", "Adjusted withholding exceeds safe centavo range.");
  if (gross !== null && exempt !== null && taxable !== null && gross !== exempt + taxable)
    add("COMPENSATION_TOTAL_MISMATCH", "Item 19 must equal items 20 plus 21. MWE exempt wages require an explicit mapped split; do not substitute benefit exemptions alone.");
  if (!evidence && expected !== null && due !== null && expected !== due)
    add("EXPECTED_WITHHOLDING_MISMATCH", "Expected withholding differs from tax due, including a one-cent difference.");
  const rows: Array<{ item: string; label: string; centavos: number | null }> = [];
  const row = (item: string, label: string, centavos: number | null) => rows.push({ item, label, centavos });
  row("19", "Present gross compensation", gross); row("20 / 38", "Present exempt compensation", exempt);
  row("21 / 52", "Present taxable compensation", taxable); row("24", "Annual tax due (source calculation)", due);
  row("internal", "Expected adjusted withholding — not released-ledger evidence", expected);
  if (!evidence) {
    add("DETAIL_MAPPING_UNVERIFIED", "Items 29–37 and 39–51B require reviewed present-employer category mapping.");
    add("PREVIOUS_EMPLOYER_UNVERIFIED", "Previous employer taxable compensation and withholding are unknown; absence is not a confirmed zero.");
    const actual = bir2316Centavos(withholding?.actualPresentWithheld);
    const applied = bir2316Centavos(withholding?.appliedAdjustment, true);
    if (!withholding || actual === null || applied === null || withholding.issues.length)
      add("SETTLEMENT_UNVERIFIED", withholding
        ? "Actual collection/refund and present-employer released withholding need review; a settled label alone is insufficient."
        : "Actual collection/refund and present-employer released withholding are unverified, even if the source status says settled.");
    for (const code of withholding?.issues ?? []) add(code, "Released withholding evidence requires correction or independent review.");
    if (actual !== null && applied !== null && before !== null && actual !== before + applied)
      add("ACTUAL_LEDGER_MISMATCH", "Actual released withholding differs from the reviewed opening plus applied adjustment.");
    if (applied !== null && adjustment !== null && applied !== adjustment)
      add("UNSETTLED_ADJUSTMENT", "Tax adjustment has an uncollected balance or unapplied refund.");
    if (withholding) {
      row("internal", "Applied collection (+) / refund (-) in released records", applied);
      row("internal", "Uncollected tax adjustment", applied === null || adjustment === null ? null : Math.max(0, adjustment - applied));
      row("internal", "Unapplied tax refund", applied === null || adjustment === null ? null : Math.max(0, applied - adjustment));
    }
    add("PERA_CREDIT_UNVERIFIED", "Item 27 requires explicit PERA credit review.");
    for (const [item, label] of [["22", "Previous employer taxable compensation"], ["23", "Combined taxable compensation"], ["25A", "Actual present employer withholding"], ["25B", "Previous employer withholding"], ["26", "Combined adjusted withholding"], ["27", "PERA credit"], ["28", "Total taxes withheld including PERA"]]) row(item, label, item === "25A" ? actual : null);
  } else {
    const allowed = new Set<string>([...BIR_2316_NON_TAX_ITEMS, ...BIR_2316_TAX_ITEMS]);
    if (Object.keys(evidence.detailItems).some(item => !allowed.has(item)))
      add("UNMAPPED_DETAIL_ITEM", "Unknown detail item cannot be silently omitted from form totals.");
    const exemptBenefits = bir2316Centavos(evidence.detailItems["34"]);
    if (exemptBenefits !== null && exemptBenefits > 9000000)
      add("EXEMPT_BENEFIT_CAP", "Item 34 cannot exceed the prescribed PHP 90,000 exempt benefit cap.");
    const sumItems = (items: readonly string[]) => {
      let total = 0;
      for (const item of items) {
        const value = read(evidence.detailItems[item], "Item " + item);
        if (value === null) return null;
        total += value;
        if (!Number.isSafeInteger(total)) { add("INVALID_OR_MISSING_AMOUNT", "Detail total exceeds safe centavo range."); return null; }
      }
      return total;
    };
    const detailExempt = sumItems(BIR_2316_NON_TAX_ITEMS), detailTaxable = sumItems(BIR_2316_TAX_ITEMS);
    if ((detailExempt !== null && exempt !== null && detailExempt !== exempt) ||
        (detailTaxable !== null && taxable !== null && detailTaxable !== taxable))
      add("DETAIL_TOTAL_MISMATCH", "Detail items must sum exactly to items 38 and 52.");
    const previous = evidence.previousEmployer;
    const confirmedNone = previous?.status === "none-confirmed";
    const verified = previous?.status === "verified";
    if (!confirmedNone && !verified) add("PREVIOUS_EMPLOYER_UNVERIFIED", "Previous-employer review is required.");
    const previousTaxable = confirmedNone ? 0 : verified ? read(previous.taxableCompensation, "Item 22") : null;
    const previousWithheld = confirmedNone ? 0 : verified ? read(previous.taxWithheld, "Item 25B") : null;
    const actual = read(evidence.actualPresentWithheld, "Item 25A");
    const applied = read(evidence.appliedAdjustment, "Actual adjustment", true);
    const pera = read(evidence.peraCredit, "Item 27");
    if (expected !== null && previousWithheld !== null && pera !== null && due !== null && expected + previousWithheld + pera !== due)
      add("EXPECTED_WITHHOLDING_MISMATCH", "Expected present withholding plus previous-employer withholding and PERA credit differs from tax due.");
    const combined = actual === null || previousWithheld === null ? null : actual + previousWithheld;
    if (before !== null && applied !== null && actual !== null && before + applied !== actual)
      add("ACTUAL_LEDGER_MISMATCH", "Actual present withholding must reconcile to the opening withholding plus actual collection/refund.");
    if (adjustment !== null && applied !== null && adjustment !== applied)
      add("UNSETTLED_ADJUSTMENT", "Expected tax adjustment was not fully collected/refunded; review final-pay shortfall or pending refund.");
    if (combined !== null && pera !== null && due !== null && combined + pera !== due)
      add("ACTUAL_WITHHOLDING_MISMATCH", "Items 26 plus 27 do not reconcile to tax due. Do not report an uncollected tax amount as withheld.");
    row("22", "Previous employer taxable compensation", previousTaxable);
    row("23", "Combined taxable compensation", taxable === null || previousTaxable === null ? null : taxable + previousTaxable);
    row("25A", "Actual present employer withholding", actual); row("25B", "Previous employer withholding", previousWithheld);
    row("26", "Combined adjusted withholding", combined); row("27", "PERA credit", pera);
    row("28", "Total taxes withheld including PERA", combined === null || pera === null ? null : combined + pera);
  }
  if (rows.some(row => row.centavos !== null && !Number.isSafeInteger(row.centavos)))
    add("INVALID_OR_MISSING_AMOUNT", "Combined form total exceeds safe centavo range.");
  return { rows, issues, reconciled: issues.length === 0, officialCertificate: false as const,
    notice: "Internal review only. Complete the prescribed BIR Form 2316, applicable signatures and employee delivery review separately. Alphalist DAT validation does not validate this certificate." };
}
export function bir2316ReviewLines(result: ReturnType<typeof reviewBir2316Summary>) {
  const format = (value: number | null) => value === null || !Number.isSafeInteger(value) ? "REQUIRES VERIFIED SOURCE" :
    (value / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return [...result.rows.map(row => ["Item " + row.item + " — " + row.label, format(row.centavos)] as [string, string]),
    ...result.issues.map(issue => [issue.code, issue.message] as [string, string]),
    ["Certificate status", result.notice] as [string, string]];
}
