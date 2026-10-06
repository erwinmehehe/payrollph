import type { Metadata } from "next";
import { PayrollHealthCheck } from "@/components/marketing/payroll-health-check";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

export const metadata: Metadata = {
  title: "Payroll Health Check Philippines | Process Audit | Linaw",
  description: "Assess Philippine payroll process maturity across manual work, attendance, approvals, compliance controls, security, auditability and employee self-service.",
  alternates: { canonical: "/payroll-health-check" },
};

export default function PayrollHealthCheckPage() {
  return (
    <div className="min-h-screen bg-[#FAFBFD] text-[#0B0D1A]">
      <SiteNav />
      <main>
        <section className="border-b border-[#EDEFF7] bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-[1080px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6161FF]">Payroll health check</p>
            <h1 className="font-display mt-4 max-w-[820px] text-[44px] font-semibold tracking-[-0.045em] sm:text-[58px]">How resilient is your current payroll process?</h1>
            <p className="mt-5 max-w-[760px] text-[16px] leading-relaxed text-[#5B6080]">Answer ten operational questions. No employee names, government IDs, bank details or payroll files are required.</p>
          </div>
        </section>
        <section className="py-12 sm:py-16"><div className="mx-auto max-w-[1080px] px-5 sm:px-8"><PayrollHealthCheck /></div></section>
      </main>
      <SiteFooter />
    </div>
  );
}
