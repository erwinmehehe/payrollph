"use client";

import { useMemo, useState } from "react";

const questions = [
  { id: "manual", label: "Payroll still depends heavily on manual spreadsheet work.", area: "Efficiency" },
  { id: "attendance", label: "Attendance must be re-encoded or manually reconciled before payroll.", area: "Automation" },
  { id: "exceptions", label: "Payroll exceptions are often discovered late in the cutoff.", area: "Controls" },
  { id: "approval", label: "The same person can prepare and release payroll without independent review.", area: "Controls" },
  { id: "statutory", label: "Statutory calculations or contribution tables are maintained manually.", area: "Compliance" },
  { id: "filing", label: "Government output is treated as ready without a documented validation step.", area: "Compliance" },
  { id: "security", label: "Payroll access is broader than necessary for each role.", area: "Security" },
  { id: "migration", label: "There is no documented payroll migration or reconciliation checklist.", area: "Continuity" },
  { id: "audit", label: "It is difficult to reconstruct who approved, changed or released a payroll run.", area: "Auditability" },
  { id: "selfservice", label: "Employees regularly ask payroll to resend payslips or explain basic payroll history.", area: "Employee experience" },
] as const;

export function PayrollHealthCheck() {
  const [answers, setAnswers] = useState<Record<string, boolean>>({});

  const result = useMemo(() => {
    const risks = questions.filter((q) => answers[q.id]).length;
    const answered = Object.keys(answers).length;
    const score = answered === 0 ? 0 : Math.max(0, Math.round(100 - (risks / questions.length) * 100));
    return { risks, answered, score };
  }, [answers]);

  const label = result.answered === 0
    ? "Answer the questions to generate a score."
    : result.score >= 80
      ? "Strong operating foundation"
      : result.score >= 60
        ? "Moderate payroll risk"
        : "High payroll process risk";

  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
      <div className="grid gap-3">
        {questions.map((question) => (
          <article key={question.id} className="rounded-[20px] border border-[#E3E5EF] bg-white p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#8B90AA]">{question.area}</p>
            <p className="mt-2 text-[14px] font-medium leading-relaxed text-[#2B2F45]">{question.label}</p>
            <div className="mt-4 flex gap-2">
              {([["yes", true], ["no", false]] as const).map(([labelText, value]) => (
                <button
                  key={labelText}
                  type="button"
                  onClick={() => setAnswers((current) => ({ ...current, [question.id]: value }))}
                  className={`rounded-full border px-4 py-2 text-[12px] font-semibold ${answers[question.id] === value ? "border-[#0877ff] bg-[#F1F1FF] text-[#0868dc]" : "border-[#DDE0EB] bg-white text-[#596078]"}`}
                >
                  {labelText === "yes" ? "Yes" : "No"}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
      <aside className="h-fit rounded-[26px] bg-[#11141F] p-7 text-white lg:sticky lg:top-24">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">Payroll health score</p>
        <p className="mt-4 text-[54px] font-semibold tracking-[-0.05em]">{result.answered ? result.score : "—"}<span className="text-[20px] text-white/35">{result.answered ? "/100" : ""}</span></p>
        <h2 className="mt-3 text-[22px] font-semibold">{label}</h2>
        <p className="mt-3 text-[13px] leading-relaxed text-white/60">
          This is a process-maturity screen, not a legal compliance certification. A lower score means more of the common payroll-control risks above are present.
        </p>
        {result.answered ? <p className="mt-5 text-[12px] text-white/50">{result.risks} risk signal{result.risks === 1 ? "" : "s"} identified across {result.answered} answered questions.</p> : null}
      </aside>
    </div>
  );
}
