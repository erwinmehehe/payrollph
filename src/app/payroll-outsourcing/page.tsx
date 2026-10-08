import { ProductSimulation } from "@/components/marketing/product-simulation";
import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  FileSpreadsheet,
  Gauge,
  MessageSquareText,
  ShieldCheck,
  Users,
} from "lucide-react";
import { PayrollQuoteForm } from "@/components/marketing/payroll-quote-form";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { absolutePublicUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payroll Outsourcing Philippines | Managed Payroll | Linaw",
  description: "Payroll outsourcing for Philippine businesses covering payroll processing, exception review, statutory calculations, approvals, reports and supported outputs.",
  alternates: { canonical: "/payroll-outsourcing" },
  openGraph: {
    title: "Payroll Outsourcing Philippines | Managed Payroll | Linaw",
    description:
      "Managed payroll processing for Philippine businesses with a controlled input, exception, approval and output workflow.",
    url: "/payroll-outsourcing",
  },
  twitter: {
    card: "summary_large_image",
    title: "Payroll Outsourcing Philippines | Linaw",
    description:
      "Managed Philippine payroll processing with clear exceptions, approval handoff, payslips, reports and supported outputs.",
  },
};

const outsourcingSchema = {
  "@context": "https://schema.org",
  "@type": "Service",
  "@id": absolutePublicUrl("/payroll-outsourcing#service"),
  url: absolutePublicUrl("/payroll-outsourcing"),
  name: "Linaw Payroll Outsourcing",
  serviceType: "Payroll outsourcing and managed payroll processing",
  description:
    "Managed payroll processing for Philippine businesses with payroll calculation, validation, exception handling, approval handoff, payslips, reports and supported payroll outputs.",
  provider: {
    "@type": "Organization",
    "@id": absolutePublicUrl("/#organization"),
    name: "Linaw",
    url: absolutePublicUrl("/"),
  },
  areaServed: {
    "@type": "Country",
    name: "Philippines",
  },
};

const PROCESS = [
  {
    title: "Send approved payroll inputs",
    copy: "Your team provides the employee changes, attendance decisions and other cycle inputs that are already approved internally.",
  },
  {
    title: "We process and validate",
    copy: "The payroll team calculates the run, checks the inputs and surfaces anything that needs a human decision.",
  },
  {
    title: "You review exceptions",
    copy: "Anything that requires business judgment comes back to your authorized team instead of being guessed or silently changed.",
  },
  {
    title: "You approve the run",
    copy: "Approval authority stays with your business. We prepare the run for review; your authorized approver decides when it is ready.",
  },
  {
    title: "We prepare the outputs",
    copy: "After approval, the cycle moves to payslips, payroll reports and the supported export files required by your process.",
  },
];

const SCOPE = [
  {
    icon: Gauge,
    title: "Reviewed payroll register",
    copy: "A gross-to-net payroll register with calculation trace, statutory figures and the exceptions that still need a decision.",
    tone: "bg-[#e5f0ff] text-[#0868dc]",
  },
  {
    icon: ShieldCheck,
    title: "Exception list",
    copy: "Missing inputs and business decisions are surfaced explicitly instead of being guessed or silently changed.",
    tone: "bg-[#e5f8f2] text-[#00886e]",
  },
  {
    icon: FileSpreadsheet,
    title: "Payslips and reports",
    copy: "After approval, the cycle produces employee payslips, payroll reports and supported accounting outputs.",
    tone: "bg-[#E0F7FA] text-[#00838F]",
  },
  {
    icon: MessageSquareText,
    title: "Supported payout and agency outputs",
    copy: "Bank and government outputs show their validation status clearly, including when a template or agency check is still required.",
    tone: "bg-[#F1EDFF] text-[#6D4DE0]",
  },
];

export default function PayrollOutsourcingPage() {
  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(outsourcingSchema).replace(/</g, "\\u003c") }}
      />
      <SiteNav />

      <main>
        <section className="relative overflow-hidden border-b border-[#EDEFF7] py-16 sm:py-20">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute -right-32 -top-52 h-[620px] w-[720px] rounded-full bg-gradient-to-br from-[#e5f0ff] via-[#EAF4FF] to-[#e5f8f2] opacity-85 blur-3xl" />
          </div>

          <div className="relative mx-auto grid max-w-[1180px] items-center gap-10 px-5 sm:px-8 lg:grid-cols-[1.05fr_.95fr]">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-[#DDE0EF] bg-white px-3.5 py-2 text-[12px] font-bold text-[#0868dc] shadow-sm">
                <ShieldCheck size={14} aria-hidden />
                Payroll outsourcing Philippines · managed payroll
              </span>
              <h1 className="font-display mt-6 max-w-[720px] text-balance text-[44px] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-[62px]">
                Payroll Outsourcing Philippines
              </h1>
              <p className="mt-6 max-w-[680px] text-[17px] leading-relaxed text-[#5B6080]">
                Linaw provides managed payroll processing for Philippine businesses: approved inputs come in, the run is
                calculated and checked, exceptions come back for decision, and your authorized approver controls release.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a href="#quote" className="group inline-flex items-center justify-center gap-2 rounded-full bg-[#0877ff] px-7 py-4 text-[14.5px] font-semibold text-white">
                  Get a payroll quote
                  <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
                </a>
                <Link href="/book-demo" className="inline-flex items-center justify-center rounded-full border border-[#D9DCEC] bg-white px-7 py-4 text-[14.5px] font-semibold text-[#2B2F45]">
                  Book a consultation
                </Link>
              </div>

              <div className="mt-8 grid gap-2.5 text-[13.5px] font-medium text-[#2B2F45] sm:grid-cols-3">
                {[
                  "Semi-monthly and monthly payroll workflows",
                  "Exceptions surfaced before approval",
                  "No bank credentials needed for an enquiry",
                ].map((item) => (
                  <span key={item} className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#e5f8f2] text-[#00886e]">
                      <Check size={12} strokeWidth={2.8} />
                    </span>
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <aside className="rounded-[28px] border border-[#E2E4F0] bg-white p-6 shadow-[0_26px_70px_-38px_rgba(30,34,70,.4)] sm:p-7">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">What you receive each cutoff</p>
              <h2 className="font-display mt-2 text-[28px] font-semibold tracking-[-0.035em]">A payroll pack your approver can actually review.</h2>
              <div className="mt-6 grid gap-3">
                {SCOPE.map(({ icon: Icon, title, copy, tone }) => (
                  <div key={title} className="flex gap-3.5 rounded-2xl border border-[#EDEFF7] p-4">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>
                      <Icon size={17} aria-hidden />
                    </span>
                    <div>
                      <strong className="text-[14px] font-semibold">{title}</strong>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-[#6B718C]">{copy}</p>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </section>
        <ProductSimulation area="payroll" />

        <section className="py-16 sm:py-20" id="process">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <div className="max-w-[720px]">
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#7C82A1]">How managed payroll works</p>
              <h2 className="font-display mt-2 text-[34px] font-semibold tracking-[-0.04em] sm:text-[44px]">A visible handoff at every cutoff.</h2>
              <p className="mt-4 text-[15px] leading-relaxed text-[#5B6080]">
                The service removes repetitive work without making the payroll process opaque. Each cycle has a clear input,
                exception, approval and output point.
              </p>
            </div>

            <div className="mt-9 grid gap-4 md:grid-cols-5">
              {PROCESS.map((step, index) => (
                <article key={step.title} className="rounded-[22px] border border-[#E5E7F0] bg-[#FAFBFD] p-5">
                  <span className="mono text-[11px] font-bold text-[#0877ff]">{String(index + 1).padStart(2, "0")}</span>
                  <h3 className="font-display mt-4 text-[17px] font-semibold leading-snug">{step.title}</h3>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-[#6B718C]">{step.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-[#EDEFF7] bg-[#FAFBFD] py-16 sm:py-20">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <div className="max-w-[760px]">
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#7C82A1]">Division of responsibility</p>
              <h2 className="font-display mt-2 text-[34px] font-semibold tracking-[-0.04em] sm:text-[44px]">You outsource the processing. You keep the decisions.</h2>
              <p className="mt-4 text-[15px] leading-relaxed text-[#5B6080]">
                Managed payroll does not transfer employer responsibility. It gives each side a clearer operating boundary.
              </p>
            </div>

            <div className="mt-9 grid gap-5 lg:grid-cols-2">
              <article className="rounded-[26px] border border-[#E2E4F0] bg-white p-6 sm:p-7">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e5f8f2] text-[#00886e]">
                  <ClipboardCheck size={19} />
                </span>
                <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Linaw payroll team</p>
                <h3 className="font-display mt-2 text-[25px] font-semibold tracking-[-0.03em]">We handle the cycle work.</h3>
                <ul className="mt-5 grid gap-3">
                  {[
                    "Process the approved payroll inputs provided for the cycle",
                    "Validate calculations and identify exceptions",
                    "Prepare statutory payroll figures supported by the system",
                    "Prepare reports, payslips and supported outputs after approval",
                    "Coordinate missing inputs and questions with your payroll contact",
                  ].map((item) => (
                    <li key={item} className="flex gap-2.5 text-[14px] leading-relaxed text-[#3E435B]">
                      <Check size={14} className="mt-1 shrink-0 text-[#00886e]" /> {item}
                    </li>
                  ))}
                </ul>
              </article>

              <article className="rounded-[26px] border border-[#E2E4F0] bg-white p-6 sm:p-7">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#F1EDFF] text-[#6D4DE0]">
                  <Users size={19} />
                </span>
                <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Your team</p>
                <h3 className="font-display mt-2 text-[25px] font-semibold tracking-[-0.03em]">You keep control of the business decisions.</h3>
                <ul className="mt-5 grid gap-3">
                  {[
                    "Provide complete and approved payroll inputs",
                    "Confirm employee changes, attendance decisions and exceptions",
                    "Review the processed payroll before release",
                    "Approve the final run through your authorized approver",
                    "Keep control of funding, banking credentials and employer approvals",
                  ].map((item) => (
                    <li key={item} className="flex gap-2.5 text-[14px] leading-relaxed text-[#3E435B]">
                      <Check size={14} className="mt-1 shrink-0 text-[#6D4DE0]" /> {item}
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section className="py-14 sm:py-16"><div className="mx-auto max-w-[1120px] px-5 sm:px-8"><h2 className="font-display text-[28px] font-semibold">Agree the scope before the first cutoff.</h2><p className="mt-4 text-[15px] leading-relaxed text-[#5B6080]">Confirm entities, headcount, pay frequency, input deadlines, correction windows, deliverables and approval owners in the service proposal. Late or incomplete inputs need an agreed decision; they are not silently estimated.</p><p className="mt-3 text-[15px] leading-relaxed text-[#5B6080]">Payroll processing does not itself mean bank execution, agency submission or legal advice. Confirm any additional service separately. Supported worksheets and export files remain distinct from accepted payments or government filings.</p></div></section><section className="py-14 sm:py-16">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <div className="grid gap-5 rounded-[28px] bg-[#11141F] p-6 text-white sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">Prefer to run payroll yourself?</p>
                <h2 className="font-display mt-2 text-[28px] font-semibold tracking-[-0.035em]">Use the software instead of the service.</h2>
                <p className="mt-3 max-w-[720px] text-[14px] leading-relaxed text-white/60">
                  The product includes the same payroll engine, approvals, employee self-service, exports and role-based workspace.
                </p>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Link href="/demo" className="rounded-full border border-white/18 bg-white/10 px-5 py-3 text-[13.5px] font-semibold text-white">
                  Explore role demo
                </Link>
                <Link href="/" className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-[13.5px] font-semibold text-[#11141F]">
                  See payroll software <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-[#EDEFF7] bg-[#FAFBFD] py-16 sm:py-20" id="quote">
          <div className="mx-auto grid max-w-[1120px] gap-8 px-5 sm:px-8 lg:grid-cols-[.82fr_1.18fr] lg:items-start">
            <div className="lg:sticky lg:top-24">
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#7C82A1]">Payroll outsourcing quote</p>
              <h2 className="font-display mt-2 text-[34px] font-semibold tracking-[-0.04em] sm:text-[42px]">Tell us the payroll you want taken off your plate.</h2>
              <p className="mt-4 text-[15px] leading-relaxed text-[#5B6080]">
                Start with headcount, frequency and number of entities. Add the part of the cycle that creates the most rework.
              </p>

              <div className="mt-6 grid gap-3">
                {[
                  "No employee personal data is needed for the enquiry",
                  "No bank credentials are requested",
                  "We only ask for the operating shape of your payroll",
                ].map((item) => (
                  <span key={item} className="flex gap-2.5 text-[13.5px] leading-relaxed text-[#3E435B]">
                    <Check size={14} className="mt-0.5 shrink-0 text-[#00886e]" /> {item}
                  </span>
                ))}
              </div>
            </div>

            <PayrollQuoteForm />
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
