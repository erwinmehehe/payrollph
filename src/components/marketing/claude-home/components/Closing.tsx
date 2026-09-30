import { useState } from "react";
import { ArrowRight, MessageCircle, Minus, Plus } from "lucide-react";
import { Reveal, SectionHeading } from "./ui";
import { cn } from "../utils/cn";

const faqs = [
  { q: "Are the statutory computations correct?", a: "SSS, PhilHealth, Pag-IBIG and TRAIN withholding use tested formulas, cross-checked against an independent PH payroll reference package. Holiday stacking, DOLE regional wage floors, MWE exemptions and calamity advisory premiums are applied during calculation and traced on the payslip." },
  { q: "Can I file directly with BIR, SSS, PhilHealth and Pag-IBIG?", a: "Linaw generates 1601-C, Alphalist/2316, SSS R-3, PhilHealth RF-1 and Pag-IBIG MCRF worksheets. They stay labelled DRAFT until a human confirms the output validated in the agency's own free tool. We would rather be honest than overclaim." },
  { q: "I'm a bookkeeper. Can I run payroll for several clients?", a: "Yes. One login can manage multiple client businesses, each fully tenant-isolated. Switch clients from the sidebar or the Cmd/Ctrl+K command palette." },
  { q: "How do I move my existing employees in?", a: "Upload your current spreadsheet. Column order, extra columns, peso signs and thousands separators are tolerated. Row errors are specific, valid rows still import, and re-uploading updates in place by employee number." },
  { q: "How do employees get their payslips?", a: "Releasing a run queues a payslip-ready email for every active employee. They sign in to a personal portal with YTD figures and a downloadable PDF payslip, and can never reach a colleague's data." },
  { q: "Can I get my data out?", a: "Anytime. Full company data export, report builder CSVs and Xero/QBO journals are built in, and Data Privacy Act portability requests are tracked with a 30-day due date." },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto grid max-w-[1200px] gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <SectionHeading
            title={<>Everything teams ask before switching.</>}
            description="Straight answers on compliance, migration and day-to-day operation. Still curious? Try the sandbox, it writes nothing."
          />
          <Reveal delay={200}>
            <div className="mt-8 rounded-3xl border border-[#E2E4F0] bg-[#FAFBFD] p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#ECECFF]">
                <MessageCircle className="h-5 w-5 text-[#4A4AE0]" aria-hidden />
              </span>
              <p className="font-display mt-4 text-[17px] font-extrabold">Talk to a payroll specialist</p>
              <p className="mt-1 text-[14px] text-[#5B6080]">Real humans, Philippine payroll experience, no hard sell.</p>
              <a href="/book-demo" className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-bold text-[#4A4AE0]">
                Book a 20-min walkthrough <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
            </div>
          </Reveal>
        </div>
        <div>
          <ul className="space-y-3">
            {faqs.map((f, i) => {
              const isOpen = open === i;
              return (
                <Reveal key={f.q} delay={i * 60}>
                  <li
                    className={cn(
                      "overflow-hidden rounded-2xl border bg-white transition-all duration-300",
                      isOpen ? "border-[#B9BDE0] shadow-[0_16px_40px_-16px_rgba(97,97,255,0.3)]" : "border-[#E8EAF3]"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : i)}
                      aria-expanded={isOpen}
                      aria-controls={`faq-panel-${i}`}
                      className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
                    >
                      <span className="text-[15.5px] font-bold text-[#0B0D1A]">{f.q}</span>
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-300",
                          isOpen ? "bg-[#11141F] text-white" : "bg-[#F1F2F8] text-[#2B2F45]"
                        )}
                      >
                        {isOpen ? <Minus className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
                      </span>
                    </button>
                    <div
                      id={`faq-panel-${i}`}
                      className={cn("grid transition-all duration-300 ease-out", isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}
                    >
                      <div className="overflow-hidden">
                        <p className="px-6 pb-6 text-[14.5px] leading-relaxed text-[#5B6080]">{f.a}</p>
                      </div>
                    </div>
                  </li>
                </Reveal>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function CTA() {
  return (
    <section id="cta" className="scroll-mt-20 px-5 pb-20 sm:px-8 sm:pb-28">
      <Reveal>
        <div className="relative mx-auto max-w-[1200px] overflow-hidden rounded-[32px] bg-[#11141F] px-6 py-16 text-center text-white sm:px-12 sm:py-24">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="bg-grid absolute inset-0 opacity-[0.12] [background-image:linear-gradient(to_right,rgba(255,255,255,0.5)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.5)_1px,transparent_1px)]" />
            <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[#6161FF] opacity-50 blur-[100px]" />
            <div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-[#00CA72] opacity-30 blur-[100px]" />
            <div className="absolute left-1/2 top-0 h-40 w-[600px] -translate-x-1/2 rounded-full bg-[#7C5CFF] opacity-25 blur-[80px]" />
          </div>
          <div className="relative">
            <h2 className="font-display mx-auto max-w-[640px] text-balance text-[40px] font-extrabold leading-[1.02] sm:text-[60px]">
              Payroll you can explain, line by line.
            </h2>
            <p className="mx-auto mt-5 max-w-[480px] text-[16px] leading-relaxed text-white/65">
              Start a 14-day Core trial, or open the playable preview. It runs the real payroll rules and saves nothing.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="/signup"
                className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-8 py-4 text-[15px] font-bold text-[#11141F] transition-all hover:scale-[1.03] hover:shadow-xl sm:w-auto"
              >
                Start free
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
              </a>
              <a
                href="/demo"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-8 py-4 text-[15px] font-bold text-white backdrop-blur transition-all hover:bg-white/15 sm:w-auto"
              >
                Explore sandbox
              </a>
            </div>
            <p className="mt-6 text-[13px] font-medium text-white/45">No credit card · Solo is free forever · Cancel anytime</p>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

export function Footer() {
  const cols = [
    { h: "Product", links: [["How it works", "#product"], ["Role-based demo", "/demo"], ["Payroll simulation", "#demo"], ["Pricing", "#pricing"], ["Payroll outsourcing", "/payroll-outsourcing"]] },
    { h: "Company", links: [["Capability scorecard", "#scorecard"], ["Security", "#security"], ["System status", "/status"], ["API reference", "#developers"]] },
    { h: "Get started", links: [["Start free", "/signup"], ["Book a demo", "/book-demo"], ["Sign in", "/login"]] },
  ];
  return (
    <footer className="border-t border-[#EDEFF7] bg-[#FAFBFD]">
      <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div>
            <a href="#top" className="flex items-center gap-2.5" aria-label="Linaw home">
              <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[#11141F]">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M3 8.5l3.2 3.2L13 5" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="leading-none">
                <span className="font-display block text-[19px] font-extrabold tracking-tight">linaw</span>
                <span className="block text-[8.5px] font-bold uppercase tracking-[0.18em] text-[#7C82A1]">HR & Payroll</span>
              </span>
            </a>
            <p className="mt-4 max-w-[280px] text-[13.5px] leading-relaxed text-[#5B6080]">
              Philippine payroll software and HRIS for payroll, attendance, statutory deductions, approvals, payslips and reporting.
            </p>
          </div>
          {cols.map((c) => (
            <nav key={c.h} aria-label={c.h}>
              <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-[#9AA0BB]">{c.h}</p>
              <ul className="mt-4 space-y-2.5">
                {c.links.map(([label, href]) => (
                  <li key={label}>
                    <a href={href} className="text-[14px] font-medium text-[#2B2F45] transition-colors hover:text-[#4A4AE0]">
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-12 border-t border-[#E2E4F0] pt-6">
          <p className="text-[13px] font-semibold text-[#2B2F45]">Linaw. Philippine HR and payroll workspace.</p>
          <p className="mt-1.5 max-w-[860px] text-[12px] leading-relaxed text-[#7C82A1]">
            Statutory computations follow RA 11199 (SSS), RA 11223 (PhilHealth), RA 9679 (Pag-IBIG) and RA 10963 (TRAIN).
            Government worksheet output is labelled DRAFT.
          </p>
        </div>
      </div>
    </footer>
  );
}
