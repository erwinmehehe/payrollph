#!/usr/bin/env node
/**
 * Local, static HTML viewer for FICTIONAL summaries from the existing
 * private parallel-payroll checker. Never reads a manifest, CSV or database,
 * and never makes an HTTP request. Not a certification or payout tool.
 */
import { closeSync, constants, fstatSync, openSync, readSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FIELDS = [
  "gross_pay", "taxable_pay", "sss_ee", "philhealth_ee", "pagibig_ee",
  "withholding_tax", "government_loans", "company_loans",
  "other_deductions", "net_pay", "sss_er", "ec_er",
  "philhealth_er", "pagibig_er",
];
const STATUSES = [
  "reconciliation-blocked",
  "pilot-arithmetic-reconciled-pending-independent-review",
  "arithmetic-reconciled-pending-independent-review",
];
const REPORT_KEYS = [
  "status", "legalEntityCode", "cycleCount", "verifiedFileHashCount",
  "results", "issues", "disclaimer",
];
const CYCLE_KEYS = [
  "period", "incumbentEmployeeCount", "linawEmployeeCount", "matchedEmployees",
  "incumbentJournalAccounts", "linawJournalAccounts",
  "employeeFieldVarianceCounts", "journalVarianceCounts",
];
const MAX_BYTES = 256 * 1024;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value, allowed, label) {
  if (!object(value)) throw new Error(label + " must be an object.");
  const actual = Object.keys(value);
  if (actual.length !== allowed.length ||
      actual.some((key) => !allowed.includes(key)) ||
      allowed.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(label + " has an unexpected or missing field.");
  }
}
function count(value, label, maximum = 100000) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(label + " must be a bounded non-negative integer.");
  }
  return value;
}
function fieldCounts(value, fields, label) {
  exactKeys(value, fields, label);
  return fields.map((field) => ({
    field,
    count: count(value[field], label + "." + field),
  }));
}
function issueGroup(issue) {
  // Never render issue strings: they might have originated from a private file.
  if (/population mismatch|employee count/i.test(issue)) return "Worker population";
  if (/payroll (?:[a-z_]+:|variance)|aggregate payroll/i.test(issue)) return "Payroll component variance";
  if (/\bGL\b|journal/i.test(issue)) return "Journal / GL variance";
  return "Evidence, integrity or period gate";
}
function groupedIssues(issues) {
  const groups = new Map();
  for (const issue of issues) {
    const group = issueGroup(issue);
    groups.set(group, (groups.get(group) || 0) + 1);
  }
  return [...groups.entries()].map(([label, countValue]) => ({ label, count: countValue }));
}

export function validateFictionalParallelReport(envelope) {
  exactKeys(envelope, ["fixtureType", "fictionalFixture", "report"], "Fixture envelope");
  if (envelope.fixtureType !== "fictional-parallel-payroll" || envelope.fictionalFixture !== true) {
    throw new Error("An explicit fictional-only fixture wrapper is required.");
  }
  const report = envelope.report;
  exactKeys(report, REPORT_KEYS, "Checker report");
  if (typeof report.legalEntityCode !== "string" ||
      !/^(?:FICTIONAL|SYNTHETIC|TEST|DEMO|PH-TEST)[A-Za-z0-9_-]{0,40}$/.test(report.legalEntityCode)) {
    throw new Error("Only clearly named fictional employer fixtures are accepted.");
  }
  if (!STATUSES.includes(report.status)) throw new Error("Unknown checker status.");
  if (typeof report.disclaimer !== "string" ||
      !/independent human review/i.test(report.disclaimer) ||
      report.disclaimer.length > 2048) {
    throw new Error("Checker review disclaimer is missing.");
  }
  if (!Array.isArray(report.issues) || report.issues.length > 1000 ||
      report.issues.some((item) => typeof item !== "string" || !item.trim() || item.length > 2048)) {
    throw new Error("Checker issue list is malformed.");
  }
  const cycleCount = count(report.cycleCount, "cycleCount", 12);
  const verifiedFileHashCount = count(report.verifiedFileHashCount, "verifiedFileHashCount", 48);
  if (cycleCount < 1 || !Array.isArray(report.results) || report.results.length > cycleCount) {
    throw new Error("Checker cycle counts are inconsistent.");
  }
  const periods = new Set();
  let varianceSignals = 0;
  const rows = report.results.map((item) => {
    exactKeys(item, CYCLE_KEYS, "Cycle");
    if (typeof item.period !== "string" ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.period) || periods.has(item.period)) {
      throw new Error("Invalid or duplicate fictional cycle period.");
    }
    periods.add(item.period);
    const incumbent = count(item.incumbentEmployeeCount, "incumbentEmployeeCount");
    const linaw = count(item.linawEmployeeCount, "linawEmployeeCount");
    const matched = count(item.matchedEmployees, "matchedEmployees");
    const incumbentGL = count(item.incumbentJournalAccounts, "incumbentJournalAccounts");
    const linawGL = count(item.linawJournalAccounts, "linawJournalAccounts");
    if (matched > Math.min(incumbent, linaw)) throw new Error("Impossible employee counts.");
    const payroll = fieldCounts(item.employeeFieldVarianceCounts, FIELDS, "Employee variance counts");
    const journal = fieldCounts(item.journalVarianceCounts, ["debit", "credit"], "GL variance counts");
    varianceSignals += payroll.reduce((sum, entry) => sum + entry.count, 0)
      + journal.reduce((sum, entry) => sum + entry.count, 0);
    if (incumbent !== linaw || matched !== incumbent || incumbentGL !== linawGL) {
      varianceSignals += 1;
    }
    return {
      period: item.period,
      incumbent, linaw, matched, incumbentGL, linawGL,
      signals: [...payroll, ...journal].filter((entry) => entry.count > 0),
    };
  });
  const blocked = report.status === "reconciliation-blocked";
  if ((report.issues.length > 0 || varianceSignals > 0 ||
       rows.length !== cycleCount || verifiedFileHashCount !== cycleCount * 4) && !blocked) {
    throw new Error("Arithmetic-match status conflicts with incomplete or blocked evidence.");
  }
  if (blocked && report.issues.length === 0) {
    throw new Error("A blocked report needs checker issues.");
  }
  return {
    status: report.status,
    cycleCount, verifiedFileHashCount, rows,
    issueCount: report.issues.length,
    issueGroups: groupedIssues(report.issues),
  };
}

function escapeHTML(value) {
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value).replace(/[&<>"']/g, (char) => entities[char]);
}
function td(value) {
  return "<td>" + escapeHTML(value) + "</td>";
}
export function renderFictionalParallelReport(view) {
  const blocked = view.status === "reconciliation-blocked";
  const cycleRows = view.rows.map((row) => "<tr>" + [
    row.period, row.incumbent, row.linaw, row.matched,
    row.incumbentGL, row.linawGL, row.signals.length ? "Review differences" : "No count variances",
  ].map(td).join("") + "</tr>").join("\n");
  const signals = view.rows.flatMap((row) => row.signals.map((item) =>
    "<tr>" + [row.period, item.field.replaceAll("_", " "), item.count].map(td).join("") + "</tr>"
  )).join("\n");
  const groups = view.issueGroups.map((item) =>
    "<li><span>" + escapeHTML(item.label) + "</span><strong>" + item.count + "</strong></li>"
  ).join("\n");
  const statusText = blocked
    ? "BLOCKED — investigate checker issues"
    : "ARITHMETIC MATCH — independent review still pending";
  const statusClass = blocked ? "blocked" : "pending";
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src &#39;none&#39;; connect-src &#39;none&#39;; form-action &#39;none&#39;; base-uri &#39;none&#39;">',
    "<title>Fictional parallel payroll QA | Linaw</title>",
    "<style>",
    "body{margin:0;background:#f5f7fb;color:#182338;font:16px/1.55 system-ui,sans-serif}main{max-width:1080px;margin:auto;padding:44px 22px 64px}h1{font-size:clamp(28px,4vw,42px);line-height:1.15}h2{margin-top:32px}.eyebrow{font-size:12px;letter-spacing:.14em;color:#1762bf;font-weight:800}.muted{color:#4c5a70}.banner{border-left:5px solid #bc7b00;background:#fff6e3;padding:16px 20px;border-radius:10px}.banner.blocked{border-color:#a93246;background:#fff0f2}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:24px 0}.card,section.panel{border:1px solid #d7e0ec;background:#fff;border-radius:14px;padding:18px}.num{font-size:30px;font-weight:750;display:block}.label{font-size:13px;color:#4c5a70}.table-scroll{overflow-x:auto}table{border-collapse:collapse;min-width:750px;width:100%}th,td{text-align:left;border-bottom:1px solid #e4eaf2;padding:11px 8px}th{font-size:13px;color:#31415d}li{padding:8px 0}ul.grouped{list-style:none;padding:0}ul.grouped li{display:flex;justify-content:space-between;max-width:420px;border-bottom:1px solid #e5eaf1}footer{margin-top:30px;border-top:1px solid #cdd8e6;padding-top:18px;font-size:13px}",
    "</style></head><body><main>",
    '<p class="eyebrow">LOCAL-ONLY / FICTIONAL FIXTURE / NO NETWORK</p>',
    "<h1>Parallel payroll QA report</h1>",
    '<p class="muted">This view contains count-only fictional reconciliation signals, not employee pay, worker IDs, private file paths or bank details. It does not run a payroll calculation.</p>',
    '<div role="status" class="banner ' + statusClass + '"><strong>' + escapeHTML(statusText) + '</strong><div>Independent human review, employer sign-off and bank / agency acceptance are not represented by this view.</div></div>',
    '<div class="cards" aria-label="Fictional check summary">',
    '<div class="card"><span class="num">' + view.cycleCount + '</span><span class="label">Period(s) in input</span></div>',
    '<div class="card"><span class="num">' + view.verifiedFileHashCount + '</span><span class="label">Local file hashes reported verified</span></div>',
    '<div class="card"><span class="num">' + view.issueCount + '</span><span class="label">Checker blocker messages (not shown raw)</span></div>',
    "</div>",
    '<section class="panel"><h2>Cycle overview</h2><div class="table-scroll"><table><thead><tr>',
    ["Period", "Incumbent workers", "Linaw workers", "Matched workers", "Incumbent GL accounts", "Linaw GL accounts", "Variance signal"].map((h) => "<th scope=\"col\">" + h + "</th>").join(""),
    "</tr></thead><tbody>" + (cycleRows || '<tr><td colspan="7">No cycle detail available.</td></tr>') + "</tbody></table></div></section>",
    '<section class="panel"><h2>Component variance counts</h2><p class="muted">Only the number of discrepancies is shown; no per-person amount or identity is rendered.</p>',
    signals ? '<div class="table-scroll"><table><thead><tr><th>Period</th><th>Component</th><th>Discrepancies</th></tr></thead><tbody>' + signals + "</tbody></table></div>" :
      "<p>No component-count variances were recorded in these fictional cycle summaries.</p>",
    "</section>",
    '<section class="panel"><h2>Checker issue categories</h2>',
    groups ? '<ul class="grouped">' + groups + "</ul>" : "<p>No checker issue messages were returned. Independent review is still required.</p>",
    "</section>",
    "<footer>Fictional demonstration only. Arithmetic consistency of supplied normalized files does not establish original data accuracy, payroll authorization, independent CPA verification, statutory filing certification or actual transfer. Run the canonical private checker and retain real employer evidence only in an approved encrypted vault.</footer>",
    "</main></body></html>",
  ].join("\n");
}

export function readBoundedFictionalFixture(input) {
  const fd = openSync(input, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > MAX_BYTES) {
      throw new Error("Fixture summary must be a bounded regular file.");
    }
    // Read the same opened object, including one extra byte to reject growth.
    // Never check one pathname object and subsequently reopen a replacement.
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const n = readSync(fd, buffer, size, buffer.length - size, null);
      if (n === 0) break;
      size += n;
    }
    if (size > MAX_BYTES) throw new Error("Fixture summary exceeds the safe size bound.");
    return JSON.parse(buffer.subarray(0, size).toString("utf8"));
  } finally { closeSync(fd); }
}

function runCLI() {
  const [input, output, confirmation, ...extra] = process.argv.slice(2);
  if (!input || !output || confirmation !== "--fictional" || extra.length) {
    console.error("Usage: node scripts/qa/render-fictional-parallel-report.mjs <fictional-wrapper.json> <new-local-report.html> --fictional");
    process.exitCode = 2;
    return;
  }
  try {
    if (resolve(input) === resolve(output)) throw new Error("Input and output paths must differ.");
    const envelope = readBoundedFictionalFixture(input);
    const html = renderFictionalParallelReport(validateFictionalParallelReport(envelope));
    // 'wx' refuses to overwrite any existing private file; 0600 protects the output.
    const fd = openSync(output, "wx", 0o600);
    try { writeFileSync(fd, html, "utf8"); } finally { closeSync(fd); }
    console.log("Local fictional-only HTML QA report created. No data was transmitted.");
  } catch (error) {
    console.error("Fictional viewer refused input/output: " +
      (error instanceof Error ? error.message : "invalid fixture"));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCLI();
