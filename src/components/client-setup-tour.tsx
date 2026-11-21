"use client";

import Link from "next/link";
import { useState } from "react";

/** Navigation-only tour. Completion is not persisted or treated as approval. */
const STAGES = [
  {
    title: "Review your organization",
    description: "Confirm the business name and company details recorded in the workspace. Check any legal-employer details before using the information for actual payroll.",
    instruction: "From your workspace, choose Settings, then Organization.",
    action: "Open workspace",
    page: "",
  },
  {
    title: "Add your employee records",
    description: "Create employee profiles or import a roster using the existing People workflow. Review the imported details; the mere presence of a record does not verify it.",
    instruction: "Open People to add or import employees.",
    action: "Open People",
    page: "&workspacePage=People",
  },
  {
    title: "Organize your team",
    description: "Set up the right HR and finance access. Keep payroll preparation, checking and release responsibilities independently authorized.",
    instruction: "In Settings, choose Team. Review Approvals separately.",
    action: "Open workspace",
    page: "",
  },
  {
    title: "Read the reports",
    description: "Find People Intelligence and other existing reports. Historical numbers appear only when their source evidence supports them.",
    instruction: "From your workspace, open Reports (Analytics).",
    action: "Open workspace",
    page: "",
  },
] as const;

export function ClientSetupTour({ organizationId }: { organizationId: number }) {
  const [index, setIndex] = useState(0);
  const step = STAGES[index];
  return (
    <section className="mt-9 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      aria-labelledby="client-setup-tour-title">
      <div className="border-b border-slate-100 px-6 py-5">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Guided walkthrough</p>
        <h2 id="client-setup-tour-title" className="mt-1 text-xl font-bold">Find your way around Linaw</h2>
        <p className="mt-1 text-sm text-slate-600">
          This tour only explains where to go. It does not submit forms, change records or record approvals.
        </p>
      </div>
      <div className="p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Step {index + 1} of {STAGES.length}
        </p>
        <div aria-live="polite" aria-atomic="true" className="mt-3 min-h-36">
          <h3 className="text-lg font-bold">{step.title}</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-700">{step.description}</p>
          <p className="mt-3 text-sm font-medium text-emerald-900">{step.instruction}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/app?organizationId=${organizationId}${step.page}`}
            className="inline-flex min-h-11 items-center rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900">
            {step.action} →
          </Link>
          <button type="button" onClick={() => setIndex((current) => Math.max(0, current - 1))}
            disabled={index === 0}
            className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">
            Previous
          </button>
          <button type="button" onClick={() => setIndex((current) => Math.min(STAGES.length - 1, current + 1))}
            disabled={index === STAGES.length - 1}
            className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">
            Next step
          </button>
        </div>
      </div>
    </section>
  );
}
