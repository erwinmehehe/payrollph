"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ClipboardCheck, Download, ShieldCheck } from "lucide-react";

type Stage = { title: string; owner: string; evidence: string; decision: string; next: string };
type Flow = { title: string; summary: string; helpHref: string; helpLabel: string; stages: readonly Stage[] };
type FlowId = "hire" | "import" | "leave" | "offboard";

const FLOWS: Record<FlowId, Flow> = {
  hire: {
    title: "New-hire handoff",
    summary: "Coordinate a hire between HR, the manager and payroll without treating a checklist as a completed employee record.",
    helpHref: "/help#new-employee-checklists",
    helpLabel: "New employee setup guide",
    stages: [
      { title: "Confirm the approved request", owner: "Hiring manager", evidence: "Offer and start-date decision in the employer's approved channel", decision: "Is the hire approved by an authorized person?", next: "Assign HR onboarding owner" },
      { title: "Prepare employee identity", owner: "HR administrator", evidence: "Documents verified in a protected HR system, not this page", decision: "Are employer, position and identity details verified?", next: "Route worksite and access checks" },
      { title: "Confirm operational setup", owner: "Manager and IT", evidence: "Approved worksite, schedule and access requests", decision: "Are exceptions assigned to an accountable owner?", next: "Request payroll-specific setup review" },
      { title: "Hand off to payroll", owner: "Authorized payroll team", evidence: "Effective date and approved pay setup in the authorized system", decision: "Has a separate authorized payroll review occurred?", next: "Continue only in the protected payroll workflow" },
    ],
  },
  import: {
    title: "Employee CSV preparation",
    summary: "Agree who will review the file, resolve exceptions and verify the outcome before importing records.",
    helpHref: "/help#import-recovery",
    helpLabel: "Interrupted-import recovery guide",
    stages: [
      { title: "Review source ownership", owner: "HR data owner", evidence: "Approved employee roster and correct employer context", decision: "Is this the authoritative, current file?", next: "Check its structure locally" },
      { title: "Check spreadsheet formatting", owner: "HR preparation lead", evidence: "Local CSV diagnostics, without retaining personal values in a public tool", decision: "Are missing headers and duplicate employee numbers resolved?", next: "Open the signed-in import preview" },
      { title: "Review the authorized preview", owner: "People administrator", evidence: "Employer-scoped preview and row-level validation in Linaw", decision: "Is every error handled through the official preview?", next: "Use the authorized confirmation flow" },
      { title: "Verify the final outcome", owner: "HR records reviewer", evidence: "Result confirmed in the employer's employee directory", decision: "Was the commit actually recorded, or is the outcome uncertain?", next: "Never blindly repeat an unknown import" },
    ],
  },
  leave: {
    title: "Leave and team coverage",
    summary: "Separate a leave request, the employer's approval and practical coverage handoff.",
    helpHref: "/help#request-leave",
    helpLabel: "Employee leave guide",
    stages: [
      { title: "Submit the request", owner: "Employee", evidence: "Requested dates through the employer's approved process", decision: "Has a request been submitted, not just discussed?", next: "Await a designated approver" },
      { title: "Review authorization", owner: "Assigned manager or approver", evidence: "Policy, balance and work coverage reviewed in the authorized system", decision: "Is the request approved, declined or still pending?", next: "Confirm a coverage owner" },
      { title: "Arrange work handover", owner: "Manager and team", evidence: "Assigned responsibilities and team communication", decision: "Are critical tasks covered without exposing private details?", next: "Document the return plan" },
      { title: "Confirm the return", owner: "Employee and manager", evidence: "Return-date check and outstanding work items", decision: "Are remaining tasks assigned?", next: "Close tasks in the employer's own system" },
    ],
  },
  offboard: {
    title: "Offboarding and access",
    summary: "Coordinate an authorized departure while leaving final pay and statutory decisions to their separate controls.",
    helpHref: "/help#employee-directory",
    helpLabel: "Employee records guide",
    stages: [
      { title: "Confirm separation authority", owner: "People administrator", evidence: "Approved decision and effective date in the protected system", decision: "Is the decision authorized and documented?", next: "Assign the operational handover" },
      { title: "Arrange return of equipment", owner: "Line manager and IT", evidence: "Protected asset register and return acknowledgement", decision: "Are missing items escalated using policy?", next: "Check access changes" },
      { title: "Review access and retention", owner: "IT and privacy owner", evidence: "Revocation record and employer retention policy", decision: "Are privacy obligations and delegated access handled?", next: "Refer final-pay matters to payroll" },
      { title: "Separate payroll settlement", owner: "Authorized payroll reviewer", evidence: "Final-pay investigation and independent approval in payroll", decision: "Are all monetary decisions independently reviewed?", next: "Do not settle or move funds from this playbook" },
    ],
  },
};

function blankCsv(flow: Flow) {
  const cell = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  const rows = [["Stage", "Suggested owner", "Evidence to confirm", "Decision question", "Next step", "Assigned owner", "Status", "Notes"]];
  for (const stage of flow.stages) {
    rows.push([stage.title, stage.owner, stage.evidence, stage.decision, stage.next, "", "", ""]);
  }
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function HrHandoffPlaybook() {
  const [selected, setSelected] = useState<FlowId>("hire");
  const flow = FLOWS[selected];
  const exportHref = useMemo(() => "data:text/csv;charset=utf-8," + encodeURIComponent(blankCsv(flow)), [flow]);
  return (
    <section className="mx-auto max-w-[1180px] px-5 py-12 sm:px-8 sm:py-16" aria-label="Blank HR handoff planner">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#0877ff]">Choose a process</p>
          <h2 className="font-display mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">A clear owner at every handoff.</h2>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-[#EFFAF5] px-4 py-2 text-xs font-semibold text-[#146347]"><ShieldCheck size={16} aria-hidden="true" /> No employee data collected</span>
      </div>
      <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="group" aria-label="Select HR process">
        {(Object.entries(FLOWS) as [FlowId, Flow][]).map(([id, item]) => (
          <button type="button" key={id} aria-pressed={selected === id} onClick={() => setSelected(id)}
            className={"min-h-14 rounded-xl border px-4 py-3 text-left text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 " +
              (selected === id ? "border-[#0877ff] bg-[#E9F2FF] text-[#064FA5]" : "border-[#DCE2EF] bg-white text-slate-700 hover:bg-slate-50")}>
            {item.title}
          </button>
        ))}
      </div>
      <article className="mt-6 rounded-[26px] border border-[#DFE6F1] bg-white p-6 sm:p-8" aria-live="polite">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[740px]">
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.13em] text-[#0877ff]"><ClipboardCheck size={16} aria-hidden="true" /> Blank planning aid</span>
            <h3 className="font-display mt-3 text-2xl font-semibold sm:text-3xl">{flow.title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-[#536079]">{flow.summary}</p>
          </div>
          <a href={exportHref} download={"linaw-" + selected + "-handoff.csv"}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#0877ff] px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
            <Download size={16} aria-hidden="true" /> Download blank owner matrix
          </a>
        </div>
        <ol className="mt-8 grid gap-4 lg:grid-cols-2">
          {flow.stages.map((stage, index) => (
            <li key={stage.title} className="rounded-2xl border border-[#E3E9F3] bg-[#FAFBFE] p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E6F0FF] text-sm font-bold text-[#075BBE]">{index + 1}</span>
                <h4 className="text-lg font-semibold text-[#172443]">{stage.title}</h4>
              </div>
              <dl className="mt-5 space-y-3 text-sm">
                <div><dt className="font-semibold text-[#263C61]">Suggested owner</dt><dd className="mt-1 text-[#536079]">{stage.owner}</dd></div>
                <div><dt className="font-semibold text-[#263C61]">Evidence to confirm</dt><dd className="mt-1 text-[#536079]">{stage.evidence}</dd></div>
                <div><dt className="font-semibold text-[#263C61]">Decision question</dt><dd className="mt-1 text-[#536079]">{stage.decision}</dd></div>
                <div><dt className="font-semibold text-[#263C61]">Next handoff</dt><dd className="mt-1 text-[#536079]">{stage.next}</dd></div>
              </dl>
            </li>
          ))}
        </ol>
        <div className="mt-7 flex flex-wrap gap-4 border-t border-[#E2E7F0] pt-6 text-sm">
          <Link href={flow.helpHref} className="inline-flex min-h-11 items-center gap-2 font-semibold text-[#0868dc] underline underline-offset-4">{flow.helpLabel}<ArrowRight size={15} aria-hidden="true" /></Link>
          <Link href="/templates/hr-checklists" className="inline-flex min-h-11 items-center gap-2 font-semibold text-[#0868dc] underline underline-offset-4">Browse existing blank HR checklists<ArrowRight size={15} aria-hidden="true" /></Link>
        </div>
        <p className="mt-5 text-xs leading-relaxed text-[#536079]">This page contains suggested handoff roles, not verified legal requirements. Nothing is saved, submitted or approved. Adapt exported blank columns to your employer's policies. Keep personal records in approved private systems and payroll actions in the authorized application.</p>
      </article>
    </section>
  );
}
