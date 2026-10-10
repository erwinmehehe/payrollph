/**
 * Printable internal BIR Form 2316 review worksheet.
 * NOT the prescribed BIR form, a signed certificate, or substituted-filing proof.
 * Fields not recoverable from annualization are not guessed.
 */
export type Bir2316ReviewInput = {
  taxYear: number;
  employerName: string;
  employerTin: string;
  employeeNo: string;
  employeeName: string;
  employeeTin: string;
  employmentStart: string;
  mwe: boolean;
  sourceStatus: string;
  ruleVersion: string;
  grossCompensation: number | string;
  exemptBenefitPool: number | string;
  deMinimis: number | string;
  statutoryContributions: number | string;
  nonTaxable: number | string;
  taxableIncome: number | string;
  taxDue: number | string;
  withheldBeforeYearEnd: number | string;
  yearEndAdjustment: number | string;
};

const esc = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");
const money = (value: number | string) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-PH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }) : "REQUIRES REVIEW";
};
const section = (title: string, pairs: Array<[string,string]>) =>
  `<section><h2>${esc(title)}</h2><dl>${pairs.map(([k,v]) =>
    `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></section>`;

export function renderBir2316ReviewHtml(input: Bir2316ReviewInput) {
  const finalWithheld = Number(input.withheldBeforeYearEnd) + Number(input.yearEndAdjustment);
  const badges: string[] = [];
  if (input.sourceStatus !== "settled") {
    badges.push("Year-end adjustment has not been recorded as settled.");
  }
  if (Math.abs(finalWithheld - Number(input.taxDue)) > 0.011) {
    badges.push("Final withheld amount does not match the tax due. Investigate release evidence.");
  }
  badges.push("Employee address, RDO, detailed earnings categories and previous-employer fields are not yet verified.");
  badges.push("Employer and employee signatures are required where applicable; this draft contains no signature.");
  const rows: Array<[string,string]> = [
    ["Gross compensation income (annual payroll calculation)", money(input.grossCompensation)],
    ["Non-taxable / exempt compensation (annual payroll calculation)", money(input.nonTaxable)],
    ["Net taxable compensation (annual payroll calculation)", money(input.taxableIncome)],
    ["Calculated annual tax due", money(input.taxDue)],
    ["Payroll withholding before year-end adjustment", money(input.withheldBeforeYearEnd)],
    ["Year-end tax adjustment (collection + / refund -)", money(input.yearEndAdjustment)],
    ["Expected adjusted withholding (verify against released payroll ledger)", money(finalWithheld)],
    ["Exempt 13th-month and other benefits", money(input.exemptBenefitPool)],
    ["Exempt de minimis benefits", money(input.deMinimis)],
    ["Employee statutory contributions", money(input.statutoryContributions)],
  ];
  const body = [
    section("Part I - Employee information", [
      ["Tax year", String(input.taxYear)],
      ["Employee TIN", input.employeeTin],
      ["Employee name", input.employeeName],
      ["Employee number (internal)", input.employeeNo],
      ["Employment start (internal source)", input.employmentStart],
      ["Minimum wage earner", input.mwe ? "Yes - classification requires separate premium-pay review" : "No"],
      ["Unverified employee address, RDO, birth date, contact and wage rate", "REQUIRES VERIFIED EMPLOYEE RECORDS"],
    ]),
    section("Part II - Present employer", [
      ["Employer TIN", input.employerTin],
      ["Employer registered legal name", input.employerName],
      ["Unverified employer address / postal code", "REQUIRES VERIFIED LEGAL-EMPLOYER RECORD"],
    ]),
    section("Part III - Previous employer", [
      ["Unverified previous employer / previous compensation", "NOT VERIFIED - COMPLETE FROM PREVIOUS EMPLOYER'S FORM 2316"],
    ]),
    section("Part IV-A - Compensation and withholding summary (internal)", rows),
    section("Part IV-B - Earnings and deduction detail", [
      ["Unverified detailed compensation categories", "INCOMPLETE - map to BIR's individual fields before issuing official Form 2316"],
    ]),
  ].join("");
  const notices = badges.map(msg => `<li>${esc(msg)}</li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(input.employeeNo)} - Form 2316 review worksheet - ${input.taxYear}</title>
<style>
@page{size:A4;margin:12mm}*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;color:#15232b;margin:0 auto;max-width:950px;font-size:12px}
header{border-bottom:3px solid #164f5c;padding:16px 0;margin-bottom:18px}
h1{font-size:20px;margin:4px 0}h2{font-size:13px;color:#164f5c;letter-spacing:.02em;margin:0 0 9px}
.note{border:2px solid #8b2333;background:#fff5f5;padding:10px 14px;margin:14px 0;font-weight:bold}
.warning{border:1px solid #b4a5a2;padding:11px 14px;margin:14px 0;background:#fffefa}
.warning li{margin:4px 0}section{border:1px solid #c8d2d4;padding:11px 13px;margin:10px 0;break-inside:avoid}
dl{margin:0}dl>div{display:grid;grid-template-columns:52% 48%;border-top:1px solid #e6e9e9;padding:6px 0;gap:4px}dt{color:#42505c}dd{font-weight:600;margin:0;overflow-wrap:anywhere}
footer{margin:20px 0 0;border-top:1px solid #c8d2d4;padding:10px;color:#42505c;font-size:11px}
.muted{color:#6c777b}.print-action{padding:8px 14px;background:#155365;color:white;border:0;border-radius:4px;margin:10px 0;cursor:pointer}
@media print{.print-action{display:none}body{max-width:none}.warning{background:white}.note{background:white}}
</style></head><body>
<header><div class="muted">PAYROLLPH · INTERNAL TAX REVIEW</div><h1>BIR Form 2316 - internal review worksheet</h1>
<div>Tax year: ${esc(input.taxYear)} · Annualization rule: ${esc(input.ruleVersion)}</div>
<div class="note">DRAFT - NOT AN OFFICIAL BIR FORM 2316 / NOT FOR FILING OR SUBSTITUTED FILING</div>
<p class="muted">This worksheet helps payroll reviewers map approved compensation data to BIR Form No. 2316 (September 2021 ENCS).
Use the official BIR certificate and complete all applicable fields before authorized employer and employee signatures.</p></header>
<p class="muted">Use your browser's Print command to save this review copy as a PDF.</p>
${body}
<aside class="warning"><strong>Required before issuing an official certificate</strong><ul>${notices}</ul></aside>
<footer>This document was assembled from annualization source records, not from an accepted filing. No signatures,
certification or BIR acceptance are asserted. Never upload this worksheet as the prescribed Form 2316.</footer>
</body></html>`;
}
