import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";
import { HrHandoffPlaybook } from "@/components/marketing/hr-handoff-playbook";

export const metadata: Metadata = {
  title: "HR Process Handoff Planner | Linaw",
  description: "Use a blank, role-based handoff planner for hiring, employee CSV preparation, leave and offboarding. No employee data is collected.",
  robots: { index: false, follow: false },
};

export default function HrProcessPlaybookPage() {
  return (
    <div className="min-h-screen bg-[#FAFBFD] text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "HR templates", path: "/templates" }, { name: "HR handoff planner", path: "/tools/hr-handoff-planner" }]} />
      <SiteNav />
      <main>
        <header className="border-b border-[#E4EAF4] bg-white py-14 sm:py-20">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <Link href="/templates" className="inline-flex items-center gap-2 text-sm font-semibold text-[#0868dc]"><ArrowLeft size={16} aria-hidden="true" /> Back to HR templates</Link>
            <p className="mt-6 text-xs font-bold uppercase tracking-[0.15em] text-[#0877ff]">HR toolkit · role and process planning</p>
            <h1 className="font-display mt-4 max-w-[940px] text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-[60px]">Make every HR handoff accountable, without changing a record.</h1>
            <p className="mt-5 max-w-[790px] text-base leading-relaxed text-[#555C76]">Choose an HR process, review suggested owners and evidence, and download a blank worksheet. Actual decisions, employee data and payroll actions stay in the authorized employer workspace.</p>
          </div>
        </header>
        <HrHandoffPlaybook />
      </main>
      <SiteFooter />
    </div>
  );
}
