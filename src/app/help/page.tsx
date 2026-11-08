import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { HelpCenterSearch } from "@/components/marketing/help-center-search";
import { HelpOnboardingPaths } from "@/components/marketing/help-onboarding-paths";
import { StructuredData } from "@/components/marketing/structured-data";

export const metadata: Metadata = {
  title: "Help & Support Center | PayrollPH by Linaw",
  description: "Practical guidance for employees, HR teams, managers and payroll operators using Linaw. Find help with payslips, leave, attendance and onboarding.",
  alternates: { canonical: "/help" },
};

export default function HelpCenterPage() {
  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "Help & support", path: "/help" }]} />
      <SiteNav />
      <main>
        <header className="border-b border-[#EDEFF7] bg-[#FAFBFD] py-16 sm:py-20">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#0877ff]">Help & support</p>
            <h1 className="font-display mt-4 max-w-[850px] text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-[58px]">
              Find the next step without guessing.
            </h1>
            <p className="mt-5 max-w-[760px] text-base leading-relaxed text-[#555C76]">
              Short, practical guides for everyday employee, HR, manager and payroll tasks. These guides explain existing workflows, not new permissions or automatic approvals.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/contact" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#0877ff] px-5 py-3 text-sm font-semibold text-white">
                Contact support <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link href="/templates/payroll-rfp-checklist" className="inline-flex min-h-11 items-center rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800">
                Use RFP checklist
              </Link>
            </div>
          </div>
        </header>
        <HelpOnboardingPaths />
        <HelpCenterSearch />
        <aside className="border-t border-slate-200 bg-slate-50 py-9">
          <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-4 px-5 text-sm leading-relaxed text-slate-700 sm:px-8">
            <ShieldCheck size={24} aria-hidden="true" className="text-[#0877ff]" />
            <p className="max-w-[900px]">
              <strong>Security reminder:</strong> Never send passwords, one-time codes, personal documents or bank information through a public support request.
              Your employer controls staff access and approvals.
            </p>
          </div>
        </aside>
      </main>
      <SiteFooter />
    </div>
  );
}
