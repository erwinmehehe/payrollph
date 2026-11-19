import { CERTIFICATE_LABELS } from "@/lib/bir-2316-certificate";
import type { Bir2316MappingPreview } from "@/lib/bir-2316-mapping-preview";

export function Bir2316MappingReview({ preview }: { preview: Bir2316MappingPreview }) {
  const groups = [
    { name: "Allowances", lines: preview.allowances },
    { name: "Leave conversions", lines: preview.leaveConversions },
  ];
  return <section aria-labelledby="bir-mapping-evidence" className="space-y-4 rounded-xl border p-4">
    <h2 id="bir-mapping-evidence" className="text-lg font-semibold">Payroll evidence for category review</h2>
    <p>Check the evidence against your payroll records and Alphalist. Enter reviewed figures separately when preparing the certificate.</p>
    {preview.issues.length > 0 && <ul aria-label="Mapping issues" className="list-disc space-y-1 pl-5">{preview.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
    {preview.totalsMatch !== null && <p>{preview.totalsMatch
      ? "Released line categories match the saved year-end compensation totals."
      : "Released line categories differ from the saved year-end compensation totals."}</p>}
    {groups.map(({ name, lines }) => <details key={name}>
      <summary>{name} ({lines.length})</summary>
      {lines.length ? <ul>{lines.map(line => <li key={line.entryId + ":" + line.lineNumber}>
        {line.payDate} · Entry #{line.entryId}, line {line.lineNumber} · {line.label} ({line.code}) · PHP {line.amount}
        {" · "}{line.treatment ?? "No unique recorded tax treatment"}{line.detail ? " · " + line.detail : ""}
      </li>)}</ul> : <p>No matching released lines were found.</p>}
    </details>)}
    <details>
      <summary>Minimum-wage classification by pay period ({preview.periods.length})</summary>
      {preview.periods.length ? <ul>{preview.periods.map(period => <li key={period.entryId}>
        {period.periodStart} to {period.periodEnd} · Paid {period.payDate} · Entry #{period.entryId} · Gross PHP {period.grossPay}
        {" · "}{period.mwe === null ? "Status unrecorded" : period.mwe ? "MWE" : "Non-MWE"}
        {period.classification && " · " + period.classification}{period.region && " · " + period.region}
        {period.wageOrder && " · " + period.wageOrder}
        {period.dailyWage && " · Daily wage PHP " + period.dailyWage}
        {period.minimumWage && " · Statutory minimum PHP " + period.minimumWage}
      </li>)}</ul> : <p>No released periods were found.</p>}
    </details>
    <details>
      <summary>Imported periods ({preview.imported.length})</summary>
      {preview.imported.length ? <ul>{preview.imported.map(period => <li key={period.id}>
        {period.payDate} · Import row #{period.id} · Gross PHP {period.grossPay}
        {period.basicSalary === null ? " · Basic pay unrecorded" : " · Basic PHP " + period.basicSalary}
      </li>)}</ul> : <p>No imported periods were found.</p>}
    </details>
    {preview.proposed.length > 0 && <details>
      <summary>Candidate amounts from released lines</summary>
      {preview.totalsMatch !== true && <p>These amounts are incomplete or still need reconciliation.</p>}
      <ul>{preview.proposed.map(({ item, amount, description }) => <li key={item}>
        Item {item} · {description ?? CERTIFICATE_LABELS[item]} · PHP {amount}
      </li>)}</ul>
    </details>}
  </section>;
}
