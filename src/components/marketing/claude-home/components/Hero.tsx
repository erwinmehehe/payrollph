import Link from "next/link";
import { ArrowRight, ChevronRight, ShieldCheck, UsersRound, CalendarDays } from "lucide-react";
import { AppProductPreview } from "./AppProductPreview";

export default function Hero() {
  return (
    <section id="top" className="relative isolate scroll-mt-24 overflow-hidden border-b border-[#e5edf5] bg-[#fcfdff] pt-28 sm:pt-32 lg:pt-36">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_80%_22%,#e3f0ff_0%,transparent_45%),radial-gradient(ellipse_at_9%_75%,#edf9f3_0%,transparent_38%)]" />
      <div className="mx-auto grid max-w-[1270px] items-center gap-10 px-5 pb-20 sm:px-8 lg:grid-cols-[.86fr_1.14fr] lg:gap-10 lg:pb-24">
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#d9e8f8] bg-white px-3.5 py-2 text-[12px] font-semibold text-[#45617f]">
            <span className="h-2 w-2 rounded-full bg-[#0866ed]" aria-hidden="true" /> Payroll + workforce, built for the Philippines
          </div>
          <h1 className="font-display mt-7 max-w-[650px] text-balance text-[44px] font-semibold leading-[1.065] tracking-[-.047em] text-[#10213d] sm:text-[62px] lg:text-[66px]">
            Philippine payroll you can review <span className="text-[#0866ed]">before money moves.</span>
          </h1>
          <p className="mt-6 max-w-[510px] text-[17px] leading-[1.8] text-[#596e86]">
            Linaw connects time, people records, payroll calculations and approvals so Philippine teams can prepare, check and release pay without losing context.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/book-demo" style={{ backgroundColor:"#0866ed",color:"#fff" }} className="hero-primary-cta inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#0866ed] px-6 py-3.5 text-[14px] font-semibold text-white hover:bg-[#0754c5]">
              Request a demo <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link href="#demo" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-[#d4e0ee] bg-white px-6 py-3.5 text-[14px] font-semibold text-[#263b55] hover:bg-[#f1f6ff]">
              See how Linaw works <ChevronRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <div className="mt-10 grid max-w-[550px] gap-4 border-t border-[#e5ebf3] pt-6 sm:grid-cols-3">
            {[
              { icon: ShieldCheck, heading: "Independent review", copy: "Maker-checker approval flow" },
              { icon: UsersRound, heading: "Explainable payroll", copy: "See what changed and why" },
              { icon: CalendarDays, heading: "Connected workforce", copy: "Time, leave and people records" },
            ].map(({icon:Icon,heading,copy})=>(
              <div key={heading} className="flex items-start gap-2.5 sm:block">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#edf5ff] text-[#0866ed] sm:mb-2"><Icon size={16} aria-hidden="true"/></span>
                <div><strong className="block text-[12px] text-[#19314d]">{heading}</strong><p className="mt-1 text-[11px] leading-[1.55] text-[#6d7f96]">{copy}</p></div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative min-w-0 lg:pl-2">
          <div aria-hidden="true" className="pointer-events-none absolute -inset-8 rounded-[50px] bg-[#bfdcff]/25 blur-3xl"/>
          <div className="relative"><AppProductPreview role="payroll" compact /></div>
          <p className="relative mt-3 text-center text-[11px] leading-relaxed text-[#75869b]">Illustrative product view, styled after Linaw&apos;s current Payroll Officer dashboard. Not a live payroll result.</p>
        </div>
      </div>
    </section>
  );
}
