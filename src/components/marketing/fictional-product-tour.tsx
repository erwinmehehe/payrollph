"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, RotateCcw, ShieldCheck } from "lucide-react";
import { DEMO_ROLES, type DemoRoleId } from "@/lib/demo-roles";

type Step = {
  heading: string;
  task: string;
  evidence: readonly [string, string][];
  takeaway: string;
};

const SCENARIOS: Record<DemoRoleId, { summary: string; steps: readonly Step[] }> = {
  owner: {
    summary: "See the evidence an owner reviews before authorizing a decision.",
    steps: [
      { heading: "Choose the correct employer", task: "A fictional owner has two companies. Review the selected employer before reading any worklist.", evidence: [["Selected employer", "Sample Company A"], ["Other company", "Not selected"], ["Role", "Owner"]], takeaway: "Employer selection must not grant access to a different tenant." },
      { heading: "Inspect an operational worklist", task: "Review pending fictional HR and payroll-readiness items without changing their status.", evidence: [["Onboarding items", "2 awaiting review"], ["Time exceptions", "1 needs an owner"], ["Payroll", "Not calculated"]], takeaway: "A summary is not approval authority or evidence that payroll is ready." },
      { heading: "Keep decisions separate", task: "A fictional payroll release requires a designated checker and a separate explicit owner decision.", evidence: [["Checker decision", "Pending"], ["Owner release", "Not performed"], ["Provider payout", "Disabled in this tour"]], takeaway: "This walkthrough never releases payroll or contacts a provider." },
    ],
  },
  hr: {
    summary: "Follow a new-hire checklist without creating a worker or changing pay.",
    steps: [
      { heading: "Collect the preparation items", task: "A fictional HR administrator starts a new-hire review.", evidence: [["Employee profile", "Not created"], ["Required documents", "Checklist pending"], ["Worksite", "To be confirmed"]], takeaway: "A public checklist does not create an employee record." },
      { heading: "Assign accountable owners", task: "Separate identity, worksite and payroll handoff responsibilities.", evidence: [["HR review", "Pending"], ["Manager review", "Pending"], ["Payroll setup", "Not authorized"]], takeaway: "Payroll setup requires its own approved workflow." },
      { heading: "Confirm the handoff", task: "Review what the receiving team must verify.", evidence: [["Document status", "For review"], ["Effective date", "Not applied"], ["Next owner", "Manager"]], takeaway: "No automatic payroll or access change is implied." },
    ],
  },
  payroll: {
    summary: "Understand the separate preparation, checking and release stages.",
    steps: [
      { heading: "Prepare the period", task: "Read fictional inputs and identify missing approvals.", evidence: [["Pay period", "Fictional sample"], ["Attendance handoff", "Pending"], ["Calculation", "Not run"]], takeaway: "Preparing payroll is not calculating or committing it." },
      { heading: "Review exceptions", task: "Identify a missing timesheet approval before any calculation can be considered final.", evidence: [["Attendance exception", "Needs review"], ["Statutory validation", "Not performed"], ["Parallel reconciliation", "Not performed"]], takeaway: "This screen contains no computed salary, tax or deduction values." },
      { heading: "Send to independent checker", task: "Show the correct next role for a controlled payroll workflow.", evidence: [["Payroll officer", "Prepared checklist"], ["Independent checker", "Pending"], ["Release", "Not performed"]], takeaway: "The tour cannot submit, calculate, release or pay." },
    ],
  },
  checker: {
    summary: "Understand what independent review should verify.",
    steps: [
      { heading: "Receive the review package", task: "A fictional checker receives a preparation checklist.", evidence: [["Preparer", "Payroll officer"], ["Evidence package", "Illustration only"], ["Approval", "None"]], takeaway: "A status label in this tour is not an audit receipt." },
      { heading: "Find unresolved differences", task: "See why the checker should trace exceptions back to source evidence.", evidence: [["Attendance source", "Needs confirmation"], ["Government inputs", "Not certified"], ["Discrepancy", "Open for investigation"]], takeaway: "Real parallel-payroll reconciliation needs independently reviewed evidence." },
      { heading: "Return unresolved items", task: "A checker should request correction rather than authorize a release without evidence.", evidence: [["Decision", "Illustrative return"], ["Release", "Not performed"], ["Provider", "Not contacted"]], takeaway: "No real decision is recorded by this tour." },
    ],
  },
  bookkeeper: {
    summary: "See how multi-client work keeps employer context visible.",
    steps: [
      { heading: "Review client boundaries", task: "A fictional bookkeeper chooses Sample Company B.", evidence: [["Employer", "Sample Company B"], ["Other employer data", "Unavailable in illustration"], ["Credentials", "None used"]], takeaway: "Actual cross-tenant permissions are enforced only in the signed-in app." },
      { heading: "Prepare an export checklist", task: "Review required roles and source confirmation before exporting.", evidence: [["Employee source", "Not connected"], ["Journal export", "Not generated"], ["Bank file", "Not generated"]], takeaway: "The tour never creates or downloads real employer files." },
      { heading: "Check the handoff", task: "Identify when to ask the owning employer for authorization.", evidence: [["Employer approval", "Pending"], ["External acceptance", "Not demonstrated"], ["Posting", "Not performed"]], takeaway: "A sample review does not confer client authorization." },
    ],
  },
  employee: {
    summary: "Explore a fictional employee's information without signing in.",
    steps: [
      { heading: "Open the employee landing view", task: "A fictional employee reviews available self-service areas.", evidence: [["Profile", "Sample employee"], ["Attendance", "Illustration"], ["Payslips", "No actual records"]], takeaway: "Your own records require a real authorized employee session." },
      { heading: "Understand a correction request", task: "Review the steps involved in asking HR to examine an attendance discrepancy.", evidence: [["Source record", "Not connected"], ["Correction", "Not submitted"], ["Reviewer", "HR team"]], takeaway: "An employee's note is not an approved time or pay correction." },
      { heading: "Review restricted actions", task: "See what must remain under employer control.", evidence: [["Bank details", "Not shown"], ["Salary changes", "Unavailable"], ["Payroll release", "Unavailable"]], takeaway: "The tour never reveals or changes employee information." },
    ],
  },
};

export function FictionalProductTour() {
  const [role, setRole] = useState<DemoRoleId>("hr");
  const [index, setIndex] = useState(0);
  const selected = SCENARIOS[role];
  const current = selected.steps[index];
  function selectRole(next: DemoRoleId) { setRole(next); setIndex(0); }

  return (
    <section className="mx-auto max-w-[1180px] px-5 py-12 sm:px-8 sm:py-16" aria-label="Fictional role walkthrough">
      <div className="mb-8 flex items-start gap-3 rounded-2xl border border-[#BCD9D4] bg-[#F1FBF7] p-5 text-sm leading-relaxed text-[#27564E]">
        <ShieldCheck size={22} aria-hidden="true" className="shrink-0" />
        <p><strong>Fictional, read-only tour.</strong> All examples are invented. The buttons only change this page. There are no API calls, employee data, payroll transactions, accounts or actual approval actions.</p>
      </div>
      <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Choose whose work you want to explore</h2>
      <p className="mt-2 max-w-[830px] text-sm leading-relaxed text-slate-600">The guided tour is separate from the live demo. It explains how work moves between roles without changing system state.</p>
      <div className="mt-5 grid gap-2 sm:grid-cols-3 lg:grid-cols-6" role="group" aria-label="Select fictional role">
        {DEMO_ROLES.map((item) => (
          <button key={item.id} type="button" aria-pressed={role === item.id} onClick={() => selectRole(item.id)}
            className={"min-h-14 rounded-xl border px-3 py-3 text-left text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 " +
              (role === item.id ? "border-[#0877ff] bg-[#E9F2FF] text-[#064FA5]" : "border-[#DCE2EF] bg-white text-slate-700 hover:bg-slate-50")}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[.8fr_1.2fr]">
        <aside className="rounded-[24px] border border-[#E1E6F2] bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#0868dc]">{DEMO_ROLES.find(item => item.id === role)?.label} perspective</p>
          <h3 className="font-display mt-3 text-2xl font-semibold">Three steps, no account required.</h3>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">{selected.summary}</p>
          <ol className="mt-6 space-y-2">
            {selected.steps.map((step, stepIndex) => (
              <li key={step.heading}>
                <button type="button" onClick={() => setIndex(stepIndex)} aria-current={index === stepIndex ? "step" : undefined}
                  className={"flex min-h-14 w-full items-center gap-3 rounded-xl p-3 text-left text-sm font-medium " +
                    (index === stepIndex ? "bg-[#E9F2FF] text-[#075BBE]" : "bg-[#F7F9FC] text-slate-600 hover:bg-[#EEF3F9]")}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-current">{stepIndex + 1}</span>
                  {step.heading}
                </button>
              </li>
            ))}
          </ol>
        </aside>
        <article className="rounded-[24px] border border-[#E1E6F2] bg-white p-6 shadow-[0_20px_45px_-35px_rgba(10,45,95,.3)] sm:p-8" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-wide text-[#0877ff]">Step {index + 1} of {selected.steps.length}</p>
            <span className="rounded-full bg-[#F2F6FC] px-3 py-1 text-xs font-semibold text-slate-600">Illustration only</span>
          </div>
          <h3 className="font-display mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">{current.heading}</h3>
          <p className="mt-3 text-sm leading-relaxed text-[#4E5B75]">{current.task}</p>
          <div className="mt-6 overflow-hidden rounded-2xl border border-[#E3E9F3]">
            <div className="bg-[#F5F8FD] px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Illustrative worklist</div>
            <dl className="divide-y divide-[#EDF1F7]">
              {current.evidence.map(([label, value]) => (
                <div key={label} className="grid gap-1 px-4 py-4 sm:grid-cols-[.85fr_1.15fr]">
                  <dt className="text-sm font-medium text-slate-500">{label}</dt>
                  <dd className="text-sm font-semibold text-[#172443]">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="mt-6 flex items-start gap-2 rounded-xl bg-[#F0FAF5] p-4 text-sm text-[#285744]">
            <CheckCircle2 size={18} aria-hidden="true" className="mt-0.5 shrink-0" /> {current.takeaway}
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setIndex(value => Math.max(value - 1, 0))} disabled={index === 0}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#C6D2E5] px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40">
              <ArrowLeft size={16} aria-hidden="true" /> Previous
            </button>
            <button type="button" onClick={() => setIndex(value => Math.min(value + 1, selected.steps.length - 1))} disabled={index === selected.steps.length - 1}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#0877ff] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              Next step <ArrowRight size={16} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setIndex(0)} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[#075BBE]">
              <RotateCcw size={16} aria-hidden="true" /> Restart
            </button>
          </div>
        </article>
      </div>
      <p className="mt-8 text-center text-sm text-slate-600">
        Want to explore the actual product controls instead of static examples? <Link href="/demo" className="font-semibold text-[#0868dc] underline underline-offset-4">Open the existing demo</Link>. Availability and permissions depend on its deployment.
      </p>
    </section>
  );
}
