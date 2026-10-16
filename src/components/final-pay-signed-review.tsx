import { finalPaySignedBalance } from "@/lib/final-pay-signed-balance";
import { finalPayReviewShortfall, type FinalPayReviewRecord } from "@/lib/final-pay-review-evidence";
export function FinalPaySignedReview({ record }: { record: FinalPayReviewRecord }) {
  const signed = finalPaySignedBalance(record), shortfall = finalPayReviewShortfall(record);
  const money = (value: number | null) => value === null ? "Unverified — review source records" : new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
  return <section aria-label="Signed final-pay reconciliation" style={{ marginTop: 16, padding: 16, border: "2px solid #b15e00", borderRadius: 8, background: "#fff8eb", color: "#442900", overflowWrap: "anywhere" }}>
    <h3 style={{ margin: "0 0 10px" }}>Final-pay reconciliation balance</h3>
    <dl style={{ display: "grid", gap: 8, margin: 0 }}>
      <div><dt>Signed balance after tax, statutory deductions and applied loans</dt><dd style={{ margin: 0, fontWeight: 700 }}>{money(signed)}</dd></div>
      <div><dt>Uncollected mandatory deductions</dt><dd style={{ margin: 0, fontWeight: 700 }}>{money(shortfall.total)}</dd></div>
      <div><dt>Uncollected tax / statutory split</dt><dd style={{ margin: 0 }}>{money(shortfall.tax)} / {money(shortfall.statutory)}</dd></div>
    </dl>
    <p style={{ marginBottom: 0 }}>This balance is for reconciliation, not a negative payout or a finding of employee debt. The payable cash stays nonnegative. Existing approval and release blocks still apply.</p>
  </section>;
}
