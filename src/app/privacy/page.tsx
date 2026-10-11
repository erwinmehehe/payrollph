import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

export const metadata: Metadata = {
  title: "Privacy Notice | Linaw PayrollPH",
  description: "How Linaw handles public enquiries and payroll information, including retention, service providers and privacy requests.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyNoticePage() {
  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <SiteNav />
      <main className="mx-auto max-w-[860px] space-y-7 px-5 py-12 text-[14px] leading-7 sm:px-8 sm:py-16">
        <header>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[#68708C]">Linaw / PayrollPH</p>
          <h1 className="mt-3 text-[40px] font-semibold tracking-tight">Privacy notice</h1>
          <p className="mt-3 text-[#4C516C]">Effective 10 October 2026. This explains the information involved in Linaw's enquiries and payroll service. An employer's own employee privacy notice and contractual arrangements may provide more detail.</p>
        </header>
        <section><h2 className="text-[22px] font-semibold">Who handles your data</h2>
          <p>Linaw / PayrollPH operates this website and receives product enquiries. Employers using the service remain responsible for their employee-data processing instructions and notices. For a privacy request, contact the team through <Link href="/contact" className="text-[#0868dc] underline">our contact page</Link> and describe it as a privacy enquiry. Never attach bank details, government IDs or payroll files to a public form.</p>
        </section>
        <section><h2 className="text-[22px] font-semibold">Data and purposes</h2>
          <p>Enquiries collect a name, work email, company, approximate headcount and optional company-level notes to respond to a request, plus basic attribution, notice version, consent timestamp and notification status. Payroll workspaces may process employee identity, attendance, leave, pay and payout details under the employer's instructions and applicable law.</p>
          <p>The enquiry checkbox authorizes follow-up on that enquiry only; it does not subscribe you to unrelated promotional messages. Payroll processing may rely on legal, contractual or other applicable bases.</p>
        </section>
        <section><h2 className="text-[22px] font-semibold">Providers and transfers</h2>
          <p>Depending on enabled services, hosting, mail and payments may involve Vercel, Resend or Postmark, Xendit and PayMongo. Optional OpenAI-assisted drafting is disabled by default and requires additional approval. Some processing may occur outside the Philippines. The deployed provider inventory and applicable contracts must be confirmed for each deployment; this page does not claim that unverified agreements, including zero-retention arrangements, have been signed.</p>
        </section>
        <section><h2 className="text-[22px] font-semibold">Retention and safeguards</h2>
          <p>Inactive public enquiry records are scheduled for removal after 365 days without an update. Sessions, tokens and delivery records have separate retention windows. Statutory payroll, tax and employment records can require longer retention, subject to legal holds. Access controls, revocable sessions and encryption protections reduce risk but do not provide absolute security.</p>
        </section>
        <section><h2 className="text-[22px] font-semibold">Your rights and requests</h2>
          <p>You can ask about access, correction, objection, portability, deletion or withdrawal of consent as applicable. Identity verification, the employer's role and legal retention requirements can affect how requests are handled. Submit a privacy enquiry via the <Link href="/contact" className="text-[#0868dc] underline">contact page</Link>.</p>
        </section>
        <p className="border-t border-[#E2E4F0] pt-5 text-[12px] text-[#68708C]">This notice requires DPO/legal verification of operator identity, provider contracts and actual deployment practices before real-customer publication.</p>
      </main>
      <SiteFooter />
    </div>
  );
}
