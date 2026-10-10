"use client";

import Link from "next/link";
import { ArrowRight, Building2, CheckCircle2, ClipboardList, CreditCard, FileCheck2, UsersRound } from "lucide-react";

export function SaasOnboardingQuickstart({
  companyName, employees, runs, onPage, onAddEmployee,
}: {
  companyName: string;
  employees: number;
  runs: number;
  onPage: (page: string) => void;
  onAddEmployee: () => void;
}) {
  const steps = [
    {
      label: "Review company and employer details",
      detail: "Confirm the legal employer, registration IDs and payroll calendar.",
      complete: false,
      icon: Building2,
      action: () => onPage("Settings"),
      actionLabel: "Company settings",
    },
    {
      label: "Add or import employees",
      detail: "Start with staff profiles, bank destinations, work arrangements and statutory numbers.",
      complete: employees > 0,
      icon: UsersRound,
      action: onAddEmployee,
      actionLabel: "Add an employee",
    },
    {
      label: "Configure time and leave",
      detail: "Review attendance, leave, holidays and payroll cutoffs before your first run.",
      complete: false,
      icon: ClipboardList,
      action: () => onPage("Time & attendance"),
      actionLabel: "Review attendance",
    },
    {
      label: "Prepare your first payroll",
      detail: "Run the readiness checks, calculate, review and release.",
      complete: runs > 0,
      icon: FileCheck2,
      action: () => onPage("Payroll"),
      actionLabel: "Open payroll",
    },
  ];
  return (
    <section className="mb-5 rounded-[20px] border border-[#c9dff8] bg-[#f7fbff] p-5" aria-label="First payroll onboarding">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[.12em] text-[#0868dc]">Welcome to your new workspace</span>
          <h2 className="mt-2 text-[23px] font-semibold text-[#10213d]">Set up {companyName} for payroll</h2>
          <p className="mt-2 max-w-[620px] text-[13px] leading-relaxed text-[#576982]">Your workspace starts with zero sample employees and no fictional payroll runs. Use these steps to prepare real company data before issuing your first payroll.</p>
        </div>
        <Link href="/billing/manage" className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#a7cafa] bg-white px-4 text-[12px] font-semibold text-[#0868dc]">
          <CreditCard size={16} /> Manage billing
        </Link>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {steps.map(({ label, detail, complete, icon: Icon, action, actionLabel }) => (
          <article key={label} className="flex flex-col rounded-2xl border border-[#e1eafb] bg-white p-4">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-[#eaf3ff] p-2 text-[#0868dc]">{complete ? <CheckCircle2 size={20} /> : <Icon size={20} />}</span>
              <div>
                <h3 className="text-[14px] font-semibold text-[#142c4e]">{label}</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-[#64748b]">{detail}</p>
              </div>
            </div>
            <button type="button" onClick={action} className="mt-4 inline-flex min-h-[44px] items-center gap-2 self-start text-[12px] font-bold text-[#0868dc]">{actionLabel} <ArrowRight size={15} /></button>
          </article>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-[#71829b]">Progress is based on data already recorded. Company and time configuration still require your review.</p>
    </section>
  );
}
