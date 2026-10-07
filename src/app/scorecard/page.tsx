import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Minus, X } from "lucide-react";
import { buildCapabilityReport } from "@/lib/capabilities";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payroll Capability Scorecard | Linaw",
  description:
    "See which Linaw payroll capabilities are verified, partial, or not yet available, including the evidence and external validation still required.",
  alternates: { canonical: "/scorecard" },
  openGraph: {
    title: "Payroll Capability Scorecard | Linaw",
    description:
      "See which Linaw payroll capabilities are verified, partial or not ready, including evidence and external validation still required.",
    url: "/scorecard",
  },
  twitter: {
    card: "summary_large_image",
    title: "Payroll Capability Scorecard | Linaw",
    description:
      "A transparent view of verified, partial and not-ready Linaw payroll capabilities.",
  },
};

type Status = "verified" | "partial" | "absent";

const statusLabel = (status: string) =>
  status === "verified" ? "Verified" : status === "partial" ? "Partial" : "Not ready";

const statusClasses = (status: string) =>
  status === "verified"
    ? "bg-[#e5f8f2] text-[#00886e]"
    : status === "partial"
      ? "bg-[#FFF4D6] text-[#9A6B00]"
      : "bg-[#F1F2F8] text-[#6B718C]";

const StatusIcon = ({ status }: { status: Status }) => {
  const Icon = status === "verified" ? Check : status === "partial" ? Minus : X;
  return <Icon size={12} strokeWidth={3} aria-hidden />;
};

export default async function ScorecardPage() {
  const report = await buildCapabilityReport();
  const byId = new Map(report.capabilities.map((capability) => [capability.id, capability]));
  const rollout = [
    byId.get("engine"),
    byId.get("govfiling"),
    byId.get("bank"),
    byId.get("email"),
  ].filter(Boolean) as typeof report.capabilities;

  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <SiteNav />
      <main>
        <section className="relative overflow-hidden border-b border-[#EDEFF7] bg-[#FAFBFD] py-14 sm:py-18">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute -right-40 -top-56 h-[620px] w-[680px] rounded-full bg-gradient-to-br from-[#e5f0ff] via-[#EAF4FF] to-[#e5f8f2] opacity-65 blur-3xl" />
          </div>
          <div className="relative mx-auto max-w-[1120px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#7C82A1]">Capability scorecard</p>
            <h1 className="font-display mt-3 max-w-[760px] text-[42px] font-semibold tracking-[-0.045em] sm:text-[56px]">
              Verified claims only.
            </h1>
            <p className="mt-4 max-w-[790px] text-[15px] leading-relaxed text-[#5B6080]">
              Linaw separates what is implemented from what is externally validated. “Verified” means the product path is
              backed by executing code or tests. It does not turn bank, email, government-portal or production-certification
              work into a claim we have not earned.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                { label: "Verified", value: report.counts.verified, detail: "implemented with executing evidence", cls: "bg-[#e5f8f2] text-[#00886e]" },
                { label: "Partial", value: report.counts.partial, detail: "working path with a remaining gate", cls: "bg-[#FFF4D6] text-[#9A6B00]" },
                { label: "Not ready", value: report.counts.absent, detail: "not sold as complete", cls: "bg-[#F1F2F8] text-[#6B718C]" },
              ].map((item) => (
                <article key={item.label} className="rounded-[22px] border border-[#E2E4F0] bg-white p-5">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${item.cls}`}>
                    {item.label}
                  </span>
                  <strong className="font-display mt-4 block text-[31px] font-semibold tracking-[-0.035em]">{item.value}</strong>
                  <p className="mt-1 text-[12px] text-[#7C82A1]">{item.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="py-14 sm:py-16">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Capability matrix</p>
            <h2 className="font-display mt-2 text-[31px] font-semibold tracking-[-0.035em]">What is actually true in this deployment.</h2>
            <p className="mt-3 max-w-[760px] text-[13.5px] leading-relaxed text-[#5B6080]">
              The evidence column is intentionally specific. It helps technical buyers distinguish a UI surface from a tested product path.
            </p>

            <div className="mt-6 overflow-x-auto rounded-[24px] border border-[#E2E4F0] bg-white">
              <table className="w-full min-w-[900px] border-collapse text-left">
                <thead className="bg-[#FAFBFD] text-[10px] font-bold uppercase tracking-[0.12em] text-[#8B90AA]">
                  <tr>
                    <th className="px-5 py-3.5">Area</th>
                    <th className="px-5 py-3.5">Capability</th>
                    <th className="px-5 py-3.5">Status</th>
                    <th className="px-5 py-3.5">Evidence / remaining gate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EDEFF7]">
                  {report.capabilities.map((capability) => (
                    <tr key={capability.id} className="align-top">
                      <td className="px-5 py-4">
                        <span className="inline-flex rounded-full bg-[#F1F2F8] px-2.5 py-1 text-[10px] font-bold text-[#626881]">{capability.area}</span>
                      </td>
                      <td className="px-5 py-4">
                        <strong className="block text-[13px] font-semibold text-[#11141F]">{capability.label}</strong>
                        <span className="mt-1 block max-w-[420px] text-[12px] leading-relaxed text-[#7C82A1]">{capability.detail}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClasses(capability.status)}`}>
                          <StatusIcon status={capability.status as Status} />
                          {statusLabel(capability.status)}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-[11.5px] leading-relaxed text-[#68708C]">{capability.proof}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="border-y border-[#EDEFF7] bg-[#FAFBFD] py-14 sm:py-16">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Rollout gates</p>
            <h2 className="font-display mt-2 text-[31px] font-semibold tracking-[-0.035em]">The work we still refuse to call complete.</h2>
            <p className="mt-3 max-w-[760px] text-[13.5px] leading-relaxed text-[#5B6080]">
              These are the capabilities most likely to be mistaken for launch readiness. Their current status comes from the same live report above.
            </p>

            <div className="mt-7 grid gap-4 md:grid-cols-2">
              {rollout.map((item) => (
                <article key={item.id} className="rounded-[22px] border border-[#E2E4F0] bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#8B90AA]">{item.area}</p>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClasses(item.status)}`}>
                      <StatusIcon status={item.status as Status} />
                      {statusLabel(item.status)}
                    </span>
                  </div>
                  <h3 className="font-display mt-3 text-[20px] font-semibold">{item.label}</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-[#5B6080]">{item.detail}</p>
                </article>
              ))}
            </div>

            <div className="mt-8 flex flex-col gap-3 rounded-[26px] bg-[#11141F] p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-7">
              <div>
                <strong className="font-display text-[22px] font-semibold">See the product before you trust the claims.</strong>
                <p className="mt-2 max-w-[680px] text-[13.5px] leading-relaxed text-white/60">
                  Open the role-based demo to inspect the workflow yourself, or bring your payroll questions to a walkthrough.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2.5">
                <Link href="/demo" className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-[13.5px] font-semibold text-[#11141F]">
                  Try live demo <ArrowRight size={14} />
                </Link>
                <Link href="/book-demo" className="rounded-full border border-white/20 bg-white/10 px-5 py-3 text-[13.5px] font-semibold text-white">
                  Book walkthrough
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
