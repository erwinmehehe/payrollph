import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Code2, KeyRound, ShieldCheck, Sparkles, TestTube2 } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";

export const metadata: Metadata = {
  title: "Contact Linaw | Payroll Software Philippines",
  description: "Contact Linaw through the right payroll software path: book a demo, request trial access, review security and procurement evidence, explore developer documentation, or sign in.",
  alternates: { canonical: "/contact" },
};

const contactPaths = [
  {
    title: "Evaluate Linaw for your organization",
    body: "Bring your headcount, payroll frequency, entity structure, schedules and approval questions into a guided payroll walkthrough.",
    href: "/book-demo",
    cta: "Book a demo",
    icon: Sparkles,
  },
  {
    title: "Request a trial workspace",
    body: "Review the live demo first, then request a dedicated trial workspace with the right organization structure and roles.",
    href: "/trial",
    cta: "Request trial access",
    icon: TestTube2,
  },
  {
    title: "Review security or procurement evidence",
    body: "Use the trust center, capability scorecard and procurement checklists before security, compliance or vendor review.",
    href: "/trust",
    cta: "Open trust center",
    icon: ShieldCheck,
  },
  {
    title: "Discuss an integration path",
    body: "Start with the implemented API, webhook, biometric and export documentation before deciding what integration work is required.",
    href: "/developers",
    cta: "Open developer center",
    icon: Code2,
  },
  {
    title: "Already have workspace access?",
    body: "Use the existing sign-in flow for your Linaw workspace instead of sending account credentials through a public contact channel.",
    href: "/login",
    cta: "Sign in",
    icon: KeyRound,
  },
] as const;

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "Contact Linaw", path: "/contact" }]} />
      <SiteNav />
      <main>
        <section className="border-b border-[#EDEFF7] bg-[#FAFBFD] py-16 sm:py-20">
          <div className="mx-auto max-w-[1080px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#0877ff]">Contact Linaw</p>
            <h1 className="font-display mt-4 max-w-[850px] text-[44px] font-semibold leading-[1.03] tracking-[-0.045em] sm:text-[60px]">
              Start with the contact path that matches what you need.
            </h1>
            <p className="mt-5 max-w-[780px] text-[16px] leading-relaxed text-[#5B6080]">
              Linaw routes public requests through purpose-built workflows so payroll evaluation, trial access, security review and workspace access do not get mixed together.
            </p>
          </div>
        </section>

        <section className="py-16 sm:py-20">
          <div className="mx-auto grid max-w-[1080px] gap-5 px-5 sm:px-8 md:grid-cols-2">
            {contactPaths.map(({ title, body, href, cta, icon: Icon }) => (
              <article key={title} className="rounded-[24px] border border-[#E3E5EF] bg-white p-6 shadow-sm">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F1F1FF] text-[#0868dc]">
                  <Icon size={18} />
                </span>
                <h2 className="font-display mt-4 text-[25px] font-semibold tracking-[-0.03em]">{title}</h2>
                <p className="mt-3 text-[14px] leading-relaxed text-[#5B6080]">{body}</p>
                <Link href={href} className="mt-5 inline-flex items-center gap-2 text-[13px] font-semibold text-[#0868dc]">
                  {cta} <ArrowRight size={13} />
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-[#EDEFF7] bg-[#11141F] py-14 text-white">
          <div className="mx-auto max-w-[1080px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/45">Before sending sensitive information</p>
            <h2 className="font-display mt-4 max-w-[760px] text-[32px] font-semibold tracking-[-0.035em] sm:text-[40px]">
              Keep employee and payroll data out of public inquiry flows.
            </h2>
            <p className="mt-4 max-w-[780px] text-[14px] leading-relaxed text-white/60">
              Use sample scenarios for evaluation. Existing users should sign in to their workspace for account-specific activity rather than placing credentials, employee records, bank details or payroll files into a public request.
            </p>
          </div>
        </section>

        <section className="py-14 sm:py-16">
          <div className="mx-auto max-w-[1080px] px-5 sm:px-8">
            <p className="max-w-[820px] text-[13px] leading-relaxed text-[#7C82A1]">
              This page does not publish an unverified phone number, physical office address or public support email. Public contact routes are limited to workflows currently implemented by the product.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
