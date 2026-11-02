import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";
import { EmployeeCsvPreflight } from "@/components/marketing/employee-csv-preflight";

// Draft tool, accessible by its direct URL but deliberately not submitted to the public index.
export const metadata: Metadata = {
  title: "Employee CSV Preparation Checker | Linaw",
  description: "Check basic employee CSV formatting locally before using the authorized HR import flow. No employee data is uploaded.",
  robots: { index: false, follow: false },
};

export default function EmployeeCsvCheckerPage() {
  return (
    <div className="min-h-screen bg-[#FAFBFD] text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "HR templates", path: "/templates" }, { name: "Employee CSV preparation", path: "/tools/employee-csv-checker" }]} />
      <SiteNav />
      <main>
        <header className="border-b border-[#E8EAF4] bg-white py-14 sm:py-20">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <Link href="/templates" className="inline-flex items-center gap-2 text-sm font-semibold text-[#0868dc]"><ArrowLeft size={16} aria-hidden="true" /> Back to HR templates</Link>
            <p className="mt-6 text-xs font-bold uppercase tracking-[0.15em] text-[#0877ff]">Free preparation tool · no sign-in</p>
            <h1 className="font-display mt-4 max-w-[950px] text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-[60px]">Spot common employee CSV problems before you import.</h1>
            <p className="mt-5 max-w-[820px] text-base leading-relaxed text-[#555C76]">Clean up spreadsheet formatting without uploading employees, accessing payroll, or changing a company record. Use the final authorized import review in Linaw for actual employer data.</p>
          </div>
        </header>
        <EmployeeCsvPreflight />
      </main>
      <SiteFooter />
    </div>
  );
}
