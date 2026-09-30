import type { Metadata } from "next";
import { buildCapabilityReport } from "@/lib/capabilities";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Capability Scorecard | Linaw",
  description: "A live capability matrix generated from Linaw's implementation and automated evidence.",
  alternates: { canonical: "/scorecard" },
};

const statusLabel = (status: string) =>
  status === "verified" ? "Verified" : status === "partial" ? "Partial" : "Not built";

const statusClasses = (status: string) =>
  status === "verified"
    ? "bg-[#E3FAF0] text-[#0A8A53]"
    : status === "partial"
      ? "bg-[#FFF4D6] text-[#9A6B00]"
      : "bg-[#F1F2F8] text-[#6B718C]";

const cell = (value: string) => {
  const cls =
    value === "yes"
      ? "bg-[#E3FAF0] text-[#0A8A53]"
      : value === "no"
        ? "bg-[#FFF0F2] text-[#C83250]"
        : value === "limited"
          ? "bg-[#FFF4D6] text-[#9A6B00]"
          : "bg-[#F1F2F8] text-[#6B718C]";
  const label = value === "yes" ? "Yes" : value === "no" ? "No" : value === "limited" ? "Limited" : "Unknown";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${cls}`}>{label}</span>;
};

export default async function ScorecardPage() {
  const report = await buildCapabilityReport();

  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <SiteNav />

      <main>
        <section className="border-b border-[#EDEFF7] bg-[#FAFBFD] py-14 sm:py-18">
          <div className="mx-auto max-w-[1120px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#7C82A1]">Capability scorecard</p>
            <h1 className="font-display mt-3 max-w-[760px] text-[42px] font-semibold tracking-[-0.045em] sm:text-[56px]">
              Verified claims only.
            </h1>
            <p className="mt-4 max-w-[760px] text-[15px] leading-relaxed text-[#5B6080]">
              Every row is generated from this deployment&apos;s code and automated evidence. “Verified” means the implementation
              is proven by an executing test or request-path code. External provider readiness is reported separately.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                { label: "Verified", value: report.counts.verified, detail: "proven by code or test", cls: "bg-[#E3FAF0] text-[#0A8A53]" },
                { label: "Partial", value: report.counts.partial, detail: "surface exists, piece missing", cls: "bg-[#FFF4D6] text-[#9A6B00]" },
                { label: "Not built", value: report.counts.absent, detail: "stated, not implied", cls: "bg-[#F1F2F8] text-[#6B718C]" },
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
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Capability matrix</p>
              <h2 className="font-display mt-2 text-[31px] font-semibold tracking-[-0.035em]">What is actually true here.</h2>
            </div>

            <div className="mt-6 overflow-x-auto rounded-[24px] border border-[#E2E4F0] bg-white">
              <table className="w-full min-w-[900px] border-collapse text-left">
                <thead className="bg-[#FAFBFD] text-[10px] font-bold uppercase tracking-[0.12em] text-[#8B90AA]">
                  <tr>
                    <th className="px-5 py-3.5">Area</th>
                    <th className="px-5 py-3.5">Capability</th>
                    <th className="px-5 py-3.5">Status</th>
                    <th className="px-5 py-3.5">Evidence</th>
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
                        <span className="mt-1 block max-w-[390px] text-[12px] leading-relaxed text-[#7C82A1]">{capability.detail}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClasses(capability.status)}`}>
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
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Competitive parity</p>
            <h2 className="font-display mt-2 text-[31px] font-semibold tracking-[-0.035em]">Linaw vs public competitor positioning.</h2>
            <p className="mt-3 max-w-[780px] text-[13.5px] leading-relaxed text-[#5B6080]">
              The Linaw column is measured against this codebase. Competitor columns reflect public positioning and are not independently verified.
            </p>

            <div className="mt-6 overflow-x-auto rounded-[24px] border border-[#E2E4F0] bg-white">
              <table className="w-full min-w-[900px] border-collapse text-left">
                <thead className="bg-white text-[10px] font-bold uppercase tracking-[0.12em] text-[#8B90AA]">
                  <tr>
                    <th className="px-5 py-3.5">Capability</th>
                    <th className="px-5 py-3.5">Linaw</th>
                    {report.competitors.map((name) => <th className="px-5 py-3.5" key={name}>{name}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EDEFF7]">
                  {report.parity.map((row) => (
                    <tr key={row.capability}>
                      <td className="px-5 py-4 text-[12.5px] font-semibold text-[#2B2F45]">{row.capability}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClasses(row.linaw)}`}>
                          {statusLabel(row.linaw)}
                        </span>
                      </td>
                      {report.competitors.map((name) => <td className="px-5 py-4" key={name}>{cell(row.competitors[name])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 rounded-2xl border border-[#F4D79C] bg-[#FFF9EA] p-4 text-[12.5px] leading-relaxed text-[#72520A]">
              <strong>Implementation and live readiness are different checks.</strong> SSO / SAML is not built. Certified government filing still needs portal validation, live bank submission still needs the external payout account enabled, and email configuration is reported separately.
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
