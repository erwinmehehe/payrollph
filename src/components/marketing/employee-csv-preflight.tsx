"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, RotateCcw, ShieldCheck, UploadCloud } from "lucide-react";
import {
  checkEmployeeCsvLocally,
  employeeCsvDiagnosticReport,
  FICTIONAL_EMPLOYEE_CSV,
  PUBLIC_CSV_MAX_BYTES,
  type CsvPreflightResult,
} from "@/lib/public-employee-csv-preflight.mjs";

function counts(result: CsvPreflightResult) {
  return {
    errors: result.issues.filter((item) => item.severity === "error").length,
    warnings: result.issues.filter((item) => item.severity === "warning").length,
  };
}

export function EmployeeCsvPreflight() {
  const uploadVersion = useRef(0);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<CsvPreflightResult | null>(null);
  const [feedback, setFeedback] = useState("");
  const [checking, setChecking] = useState(false);
  const [sample, setSample] = useState(false);

  function reset() {
    uploadVersion.current += 1;
    if (uploadInput.current) uploadInput.current.value = "";
    setResult(null);
    setFeedback("");
    setChecking(false);
    setSample(false);
  }

  async function checkFile(file: File | undefined) {
    if (!file) return;
    const requestVersion = ++uploadVersion.current;
    setResult(null);
    setFeedback("");
    setSample(false);
    setChecking(true);
    if (!/\.csv$/i.test(file.name)) {
      setFeedback("Choose a .csv file. No file was uploaded.");
      setChecking(false);
      return;
    }
    if (file.size > PUBLIC_CSV_MAX_BYTES) {
      setFeedback("This file exceeds the 2 MB limit. Split it before trying again.");
      setChecking(false);
      return;
    }
    try {
      const csv = await file.text();
      if (requestVersion !== uploadVersion.current) return;
      setResult(checkEmployeeCsvLocally(csv));
    } catch {
      if (requestVersion === uploadVersion.current) setFeedback("The browser could not read that CSV. Choose it again.");
    } finally {
      if (requestVersion === uploadVersion.current) setChecking(false);
    }
  }

  function loadSample() {
    reset();
    setResult(checkEmployeeCsvLocally(FICTIONAL_EMPLOYEE_CSV));
    setSample(true);
  }

  function downloadDiagnostics() {
    if (!result?.issues.length) return;
    const data = employeeCsvDiagnosticReport(result);
    const url = URL.createObjectURL(new Blob([data], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "employee-csv-check-issues.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const summary = result ? counts(result) : null;

  return (
    <section className="mx-auto max-w-[1180px] px-5 py-12 sm:px-8 sm:py-16" aria-label="Employee CSV checker">
      <div className="grid gap-7 lg:grid-cols-[1.1fr_.9fr]">
        <div className="rounded-[26px] border border-[#DEE3F0] bg-white p-6 shadow-[0_18px_55px_-38px_rgba(11,45,98,.35)] sm:p-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#E9F2FF] px-3 py-1.5 text-xs font-semibold text-[#0868dc]">
            <FileSpreadsheet size={15} aria-hidden="true" /> Local CSV preparation
          </div>
          <h2 className="font-display mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">Check the spreadsheet before your import.</h2>
          <p className="mt-3 text-sm leading-relaxed text-[#555C76]">
            Check headers, blank required fields, duplicate employee numbers, dates, column counts and basic salary formatting.
            The file is read in this browser tab only. This tool has no upload or save function.
          </p>
          <div className="mt-7 rounded-2xl border border-dashed border-[#9CB9E8] bg-[#F6F9FF] p-5">
            <label htmlFor="employee-csv-file" className="flex items-center gap-2 text-sm font-semibold text-[#172443]">
              <UploadCloud size={20} aria-hidden="true" /> Select a local CSV file
            </label>
            <input
              id="employee-csv-file"
              ref={uploadInput}
              type="file"
              accept=".csv,text/csv"
              disabled={checking}
              onChange={(event) => void checkFile(event.currentTarget.files?.[0])}
              className="mt-3 block w-full max-w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-[#0877ff] file:px-4 file:py-2.5 file:font-semibold file:text-white"
            />
            <p className="mt-3 text-xs leading-relaxed text-[#5B6080]">Up to 2 MB and 10,000 rows. Use sample data when exploring the checker on a shared device.</p>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={loadSample} disabled={checking} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#CED7E9] px-4 py-2 text-sm font-semibold text-[#1755A0] hover:bg-[#F4F8FF]">
              <FileSpreadsheet size={16} aria-hidden="true" /> Try fictional example
            </button>
            <button type="button" onClick={reset} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#CED7E9] px-4 py-2 text-sm font-semibold text-[#26334B] hover:bg-[#F4F8FF]">
              <RotateCcw size={16} aria-hidden="true" /> Clear results
            </button>
          </div>
          {checking && <p className="mt-5 text-sm text-slate-600" role="status">Checking locally in your browser…</p>}
          {feedback && <p className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">{feedback}</p>}
        </div>

        <aside className="rounded-[26px] border border-[#E2E7F2] bg-[#F7FAFF] p-6 sm:p-8">
          <div className="flex items-center gap-2 text-[#075CA4]"><ShieldCheck size={21} aria-hidden="true" /><span className="text-sm font-semibold">Privacy-first by design</span></div>
          <h2 className="font-display mt-4 text-2xl font-semibold tracking-tight">What this checker does not do</h2>
          <ul className="mt-4 space-y-3 text-sm leading-relaxed text-[#47536B]">
            <li>Does not send, save, import, or modify employee data.</li>
            <li>Does not check against existing employees or company departments.</li>
            <li>Does not verify wage-region rules, TIN ownership, statutory eligibility, or bank accounts.</li>
            <li>Does not grant payroll readiness, employment approval, or migration clearance.</li>
          </ul>
          <p className="mt-6 rounded-xl border border-[#DBE4F7] bg-white p-4 text-sm leading-relaxed text-[#465571]">
            The signed-in, employer-scoped import preview and authorized HR approval remain the source of truth.
            Use the official workspace to complete any actual import.
          </p>
        </aside>
      </div>

      {result && summary && (
        <section aria-labelledby="csv-result-title" className="mt-8 rounded-[26px] border border-[#E0E5EF] bg-white p-6 sm:p-8" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-[#0868dc]">
                {summary.errors > 0 ? <AlertTriangle size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}
                {sample ? "Fictional example results" : "Local file results"}
              </p>
              <h2 id="csv-result-title" className="font-display mt-2 text-2xl font-semibold">{summary.errors ? "Review these CSV issues" : "No blocking format issues detected"}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">This is a preliminary formatting check, not confirmation that an authorized import will succeed.</p>
            </div>
            <button type="button" onClick={downloadDiagnostics} disabled={!result.issues.length}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#0877ff] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
              <Download size={16} aria-hidden="true" /> Download issues only
            </button>
          </div>
          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-[#F5F7FB] p-5"><span className="block text-xs font-semibold uppercase tracking-wide text-slate-600">Employee rows</span><strong className="mt-1 block text-3xl font-semibold">{result.totalRows}</strong></div>
            <div className="rounded-xl bg-[#FFF3F3] p-5"><span className="block text-xs font-semibold uppercase tracking-wide text-[#A22539]">Errors</span><strong className="mt-1 block text-3xl font-semibold text-[#A22539]">{summary.errors}</strong></div>
            <div className="rounded-xl bg-[#FFFAEB] p-5"><span className="block text-xs font-semibold uppercase tracking-wide text-[#95610A]">Warnings</span><strong className="mt-1 block text-3xl font-semibold text-[#95610A]">{summary.warnings}</strong></div>
          </div>
          {result.unrecognizedColumns > 0 && <p className="mt-4 text-sm text-slate-600" role="status">{result.unrecognizedColumns} unrecognized header{result.unrecognizedColumns === 1 ? "" : "s"}. Extra columns may be acceptable in the authorized import.</p>}
          {result.issues.length ? (
            <>
              <div className="mt-7 overflow-x-auto rounded-xl border border-[#E2E7EF]">
                <table className="w-full min-w-[600px] text-left text-sm">
                  <caption className="sr-only">Local file issues by CSV source line and field</caption>
                  <thead className="bg-[#F3F6FC] text-[#33425D]"><tr><th scope="col" className="px-4 py-3">CSV line</th><th scope="col" className="px-4 py-3">Severity</th><th scope="col" className="px-4 py-3">Field</th><th scope="col" className="px-4 py-3">What to fix</th></tr></thead>
                  <tbody className="divide-y divide-[#ECF0F6]">
                    {result.issues.slice(0, 60).map((item, index) => (
                      <tr key={`${item.row}-${item.field}-${index}`}><td className="px-4 py-3 font-semibold">{item.row}</td><td className="px-4 py-3">{item.severity}</td><td className="px-4 py-3 font-mono text-xs">{item.field}</td><td className="px-4 py-3 text-[#465571]">{item.message}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.issues.length > 60 && <p className="mt-3 text-sm text-slate-600">Showing the first 60 issues. Download the diagnostic list for all {result.issues.length} issues.</p>}
            </>
          ) : <p className="mt-6 rounded-xl bg-[#EFFAF5] p-4 text-sm text-[#146347]">No issues were found by these limited local checks. The authorized importer performs additional validation.</p>}
        </section>
      )}
    </section>
  );
}
