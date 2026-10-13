"use client";

import Link from "next/link";
import { ArrowRight, CreditCard } from "lucide-react";

export function SaasOnboardingQuickstart({
  companyName, onPage,
}: {
  companyName: string;
  employees: number;
  runs: number;
  onPage: (page: string) => void;
  onAddEmployee: () => void;
}) {
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
      <div className="mt-5">
        <button type="button" className="primary-button" onClick={() => onPage("Overview")}>
          Open the seven-step first-payroll journey <ArrowRight size={15} />
        </button>
      </div>
      <p className="mt-4 text-[11px] text-[#71829b]">The guided journey is the source of truth for setup, attendance review and independent payroll approval.</p>
    </section>
  );
}
