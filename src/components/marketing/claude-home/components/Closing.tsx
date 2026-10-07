import { useState } from "react";
import { ArrowRight, MessageCircle, Minus, Plus } from "lucide-react";
import { Reveal, SectionHeading } from "./ui";
import { cn } from "../utils/cn";
import { PUBLIC_FOOTER_GROUPS } from "@/components/marketing/public-navigation";
import { HOMEPAGE_FAQS } from "@/components/marketing/homepage-faqs";


export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="scroll-mt-20 py-16 sm:py-20">
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
        <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr]">
          <div>
            <SectionHeading
              title={<>Everything teams ask before switching.</>}
              description="Straight answers on compliance, migration and day-to-day operation. Still curious? Try the sandbox, it writes nothing."
            />
            <Reveal delay={160}>
              <div className="mt-7 rounded-[24px] bg-[#F7F8FC] p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#e5f0ff]">
                  <MessageCircle className="h-5 w-5 text-[#0868dc]" aria-hidden />
                </span>
                <p className="font-display mt-4 text-[17px] font-semibold">Talk to a payroll specialist</p>
                <p className="mt-1 text-[14px] leading-relaxed text-[#5B6080]">Real humans, Philippine payroll experience, no hard sell.</p>
                <a href="/book-demo" className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#0868dc]">
                  Book a 20-min walkthrough
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </a>
              </div>
            </Reveal>
          </div>

          <div>
            <ul className="divide-y divide-[#E8EAF3] border-y border-[#E8EAF3]">
              {HOMEPAGE_FAQS.map((faq, index) => {
                const isOpen = open === index;
                return (
                  <Reveal key={faq.q} delay={index * 45}>
                    <li>
                      <button
                        type="button"
                        onClick={() => setOpen(isOpen ? null : index)}
                        aria-expanded={isOpen}
                        aria-controls={`faq-panel-${index}`}
                        className="flex w-full items-center justify-between gap-5 py-5 text-left sm:py-6"
                      >
                        <span className="font-display text-[17px] font-semibold leading-snug text-[#0B0D1A] sm:text-[18px]">{faq.q}</span>
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
                        id={`faq-panel-${index}`}
                        className={cn(
                          "grid transition-all duration-300 ease-out",
                          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                        )}
                      >
                        <div className="overflow-hidden">
                          <p className="max-w-[760px] pb-6 text-[15px] leading-[1.75] text-[#5B6080]">{faq.a}</p>
                        </div>
                      </div>
                    </li>
                  </Reveal>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

export function CTA() {
  return (
    <section id="cta" className="scroll-mt-20 px-5 pb-20 pt-2 sm:px-8 sm:pb-24">
      <Reveal>
        <div className="relative mx-auto min-h-[360px] max-w-[1200px] overflow-hidden rounded-[34px] bg-[#11141F] px-6 py-16 text-center text-white sm:flex sm:min-h-[400px] sm:items-center sm:justify-center sm:px-12 sm:py-20">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="bg-grid absolute inset-0 opacity-[0.12] [background-image:linear-gradient(to_right,rgba(255,255,255,0.5)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.5)_1px,transparent_1px)]" />
            <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-[#0877ff] opacity-55 blur-[110px]" />
            <div className="absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-[#00CA72] opacity-32 blur-[110px]" />
            <div className="absolute left-1/2 top-0 h-44 w-[680px] -translate-x-1/2 rounded-full bg-[#10b8a0] opacity-30 blur-[90px]" />
          </div>

          <div className="relative mx-auto max-w-[820px]">
            <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-white/45">Ready when your payroll is</p>
            <h2 className="font-display mx-auto mt-4 max-w-[760px] text-balance text-[46px] font-semibold leading-[0.98] sm:text-[68px]">
              Run your next Philippine payroll with Linaw.
            </h2>
            <p className="mx-auto mt-6 max-w-[560px] text-[17px] leading-relaxed text-white/68">
              Request a trial workspace, or open the live role-based demo first. Review the workflow before you move a real payroll.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="/signup"
                className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-9 py-4.5 text-[15px] font-semibold shadow-[0_10px_34px_-12px_rgba(255,255,255,.45)] transition-all hover:scale-[1.025] hover:bg-[#F6F7FB] sm:w-auto"
                style={{ color: "#11141F" }}
              >
                Request trial access
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
              </a>
              <a
                href="/demo"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-9 py-4.5 text-[15px] font-semibold text-white backdrop-blur transition-all hover:bg-white/15 sm:w-auto"
              >
                Try live demo
              </a>
            </div>

            <p className="mt-7 text-[13.5px] font-medium text-white/48">Sample data first · Controlled workspace access · Keep approval with your team</p>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-[#EDEFF7] bg-[#FAFBFD]">
      <div className="mx-auto max-w-[1200px] px-5 pb-12 pt-16 sm:px-8 sm:pt-20">
        <div className="grid gap-12 md:grid-cols-[1.45fr_1fr_1fr_1fr]">
          <div>
            <a href="/" className="flex items-center gap-3" aria-label="Linaw home">
              <span className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-[#11141F]">
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M3 8.5l3.2 3.2L13 5" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="leading-none">
                <span className="font-display block text-[22px] font-semibold tracking-tight">linaw</span>
                <span className="mt-1 block text-[9px] font-bold uppercase tracking-[0.18em] text-[#7C82A1]">Philippine Payroll</span>
              </span>
            </a>
            <p className="mt-5 max-w-[330px] text-[14px] leading-relaxed text-[#5B6080]">
              Philippine payroll software for teams that want every run, approval and peso to be traceable.
            </p>
          </div>

          {PUBLIC_FOOTER_GROUPS.map((group) => (
            <nav key={group.label} aria-label={group.label}>
              <p className="text-[12px] font-bold uppercase tracking-[0.13em] text-[#8B90AA]">{group.label}</p>
              <ul className="mt-4 space-y-3">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} className="text-[14px] font-medium text-[#2B2F45] transition-colors hover:text-[#0868dc]">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-14 flex flex-col gap-2 border-t border-[#E2E4F0] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] font-medium text-[#5B6080]">Linaw · Philippine payroll software.</p>
          <p className="text-[12.5px] text-[#8B90AA]">Government worksheet output is labelled DRAFT until validated.</p>
        </div>
      </div>
    </footer>
  );
}
