import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";

export const metadata: Metadata = {
  title: "About Linaw | Philippine Payroll Software",
  description: "Learn how Linaw approaches Philippine payroll software, product evidence, compliance transparency, implementation controls and customer evaluation.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "About Linaw", path: "/about" }]} />
      <SiteNav />
      <main>
        <section className="border-b border-[#EDEFF7] bg-[#FAFBFD] py-16 sm:py-20">
          <div className="mx-auto max-w-[1080px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#0877ff]">About Linaw</p>
            <h1 className="font-display mt-4 max-w-[860px] text-[44px] font-semibold leading-[1.03] tracking-[-0.045em] sm:text-[60px]">
              Building clearer payroll operations for Philippine teams.
            </h1>
            <p className="mt-5 max-w-[780px] text-[16px] leading-relaxed text-[#5B6080]">
              Linaw is Philippine payroll software designed to connect employee data, time and attendance, payroll calculations, approvals, statutory workflows, employee access and controlled outputs in one traceable operating model.
            </p>
          </div>
        </section>

        <section className="py-16 sm:py-20">
          <div className="mx-auto grid max-w-[1080px] gap-6 px-5 sm:px-8 lg:grid-cols-2">
            {[
              {
                title: "Philippine payroll first",
                body: "The product is built around Philippine payroll realities: statutory deductions, withholding, overtime, holidays, night work, attendance evidence, payroll review and released payroll outputs.",
              },
              {
                title: "Controls, not just calculations",
                body: "Payroll accuracy depends on who can change data, who reviews exceptions, who approves a run and what is allowed to leave the system. Linaw treats those controls as part of payroll, not as an afterthought.",
              },
              {
                title: "Evidence before marketing claims",
                body: "Public product claims are separated into verified, partial, externally dependent or absent states. Calculation capability is not presented as proof of government filing acceptance, and certifications are not implied without evidence.",
              },
              {
                title: "Implementation is part of the product experience",
                body: "Migration, year-to-date reconciliation, access setup, integrations, controlled payroll and go-live readiness are treated as operational work that needs explicit ownership and validation.",
              },
            ].map((item) => (
              <article key={item.title} className="rounded-[24px] border border-[#E3E5EF] bg-white p-6">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e5f8f2] text-[#00886e]">
                  <CheckCircle2 size={17} />
                </span>
                <h2 className="font-display mt-4 text-[25px] font-semibold tracking-[-0.03em]">{item.title}</h2>
                <p className="mt-3 text-[14px] leading-relaxed text-[#5B6080]">{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-[#EDEFF7] bg-[#11141F] py-16 text-white">
          <div className="mx-auto max-w-[1080px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/45">How we want buyers to evaluate Linaw</p>
            <h2 className="font-display mt-4 max-w-[820px] text-[34px] font-semibold tracking-[-0.035em] sm:text-[44px]">
              Inspect the workflow and the evidence—not a superlative.
            </h2>
            <div className="mt-7 grid gap-4 md:grid-cols-3">
              {[
                ["Try the product flow", "Use the live role-based demo to inspect how payroll moves from preparation through review and release."],
                ["Review the evidence", "Use the trust center and capability scorecard to distinguish working paths from partial or externally dependent capabilities."],
                ["Test your real scenario", "Bring your headcount, payroll frequency, schedules, exceptions, integrations and approval model into the evaluation."],
              ].map(([title, body]) => (
                <article key={title} className="rounded-[22px] border border-white/10 bg-white/[0.04] p-5">
                  <h3 className="font-display text-[21px] font-semibold">{title}</h3>
                  <p className="mt-3 text-[13px] leading-relaxed text-white/60">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-[1080px] px-5 sm:px-8">
            <h2 className="font-display text-[32px] font-semibold tracking-[-0.035em]">What Linaw does not claim here.</h2>
            <p className="mt-4 max-w-[800px] text-[14px] leading-relaxed text-[#5B6080]">
              This page does not claim a company founding year, historical client count, market leadership position, independent certification, government endorsement or guaranteed payroll outcome. Those claims require separate evidence before publication.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Trust center", "/trust"],
                ["Evidence methodology", "/methodology"],
                ["Security", "/security"],
                ["Developer center", "/developers"],
                ["Live demo", "/demo"],
                ["Book a payroll walkthrough", "/book-demo"],
              ].map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center justify-between rounded-[18px] border border-[#E3E5EF] bg-[#FAFBFD] p-4 text-[13px] font-semibold text-[#34394F]"
                >
                  {label}
                  <ArrowRight size={14} />
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
