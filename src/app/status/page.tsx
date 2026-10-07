import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { Activity, Clock3, Database, ShieldCheck } from "lucide-react";
import { db } from "@/db";
import { healthSnapshots } from "@/db/schema";
import { currentStatusLabel, summarizeUptime } from "@/lib/status";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "System Status | Linaw",
  description: "Live health history and database round-trip status for this Linaw deployment.",
  alternates: { canonical: "/status" },
};

export default async function StatusPage() {
  let rows: Array<{ ok: boolean; latencyMs: number; createdAt: Date }> = [];
  try {
    rows = await db.select().from(healthSnapshots).orderBy(desc(healthSnapshots.createdAt)).limit(48);
  } catch {
    rows = [];
  }

  const uptime = summarizeUptime(rows);
  const latest = rows[0];
  const status = currentStatusLabel(latest);
  const healthy = latest?.ok ?? false;

  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "System status", path: "/status" }]} />
      <SiteNav />

      <main>
        <section className="border-b border-[#EDEFF7] bg-[#FAFBFD] py-14 sm:py-18">
          <div className="mx-auto max-w-[1040px] px-5 sm:px-8">
            <span className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[12px] font-bold ${
              healthy ? "bg-[#e5f8f2] text-[#00886e]" : "bg-[#FFF4D6] text-[#9A6B00]"
            }`}>
              <ShieldCheck size={14} />
              {status.label}
            </span>
            <h1 className="font-display mt-5 text-[42px] font-semibold tracking-[-0.045em] sm:text-[56px]">Linaw system status.</h1>
            <p className="mt-4 max-w-[700px] text-[15px] leading-relaxed text-[#5B6080]">
              Recorded from live <span className="mono">/api/health</span> checks against this deployment. This is Linaw&apos;s own
              recorded health history, not a third-party status-page estimate.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                {
                  icon: Activity,
                  label: "Current",
                  value: status.label,
                  detail: latest
                    ? `${latest.latencyMs} ms · ${new Date(latest.createdAt).toLocaleString("en-PH")}`
                    : "No health snapshot recorded yet",
                  tone: "bg-[#e5f8f2] text-[#00886e]",
                },
                {
                  icon: Clock3,
                  label: "24h uptime",
                  value: uptime.uptimeLabel,
                  detail: `${uptime.samples} samples · median ${uptime.medianLatencyMs ?? "-"} ms`,
                  tone: "bg-[#e5f0ff] text-[#0868dc]",
                },
                {
                  icon: Database,
                  label: "Coverage",
                  value: "App + database",
                  detail: "This page measures application reachability and database round-trip health.",
                  tone: "bg-[#E0F7FA] text-[#00838F]",
                },
              ].map(({ icon: Icon, label, value, detail, tone }) => (
                <article key={label} className="rounded-[22px] border border-[#E2E4F0] bg-white p-5">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
                    <Icon size={17} />
                  </span>
                  <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.13em] text-[#9298AF]">{label}</p>
                  <strong className="font-display mt-1 block text-[23px] font-semibold tracking-[-0.03em]">{value}</strong>
                  <p className="mt-2 text-[12px] leading-relaxed text-[#6B718C]">{detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="py-14 sm:py-16">
          <div className="mx-auto max-w-[1040px] px-5 sm:px-8">
            <div className="mb-7 rounded-[22px] border border-[#DDE0EF] bg-[#FAFBFD] p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">What this page covers</p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[#5B6080]">
                These checks cover Linaw application reachability and database response. They do not certify transactional email,
                PayMongo or bank payout availability, or BIR, SSS, PhilHealth and Pag-IBIG portal availability.
              </p>
            </div>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Recent checks</p>
                <h2 className="font-display mt-2 text-[30px] font-semibold tracking-[-0.035em]">Newest first.</h2>
              </div>
              <span className="mono text-[11px] text-[#8B90AA]">{rows.length} snapshots</span>
            </div>

            <div className="mt-6 overflow-hidden rounded-[24px] border border-[#E2E4F0] bg-white">
              {rows.length === 0 ? (
                <div className="p-8 text-center text-[14px] text-[#7C82A1]">No snapshots yet. The next health check will start the history.</div>
              ) : (
                <div className="divide-y divide-[#EDEFF7]">
                  {rows.map((row, index) => (
                    <div key={`${row.createdAt}-${index}`} className="grid gap-3 px-5 py-4 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                        row.ok ? "bg-[#e5f8f2] text-[#00886e]" : "bg-[#FFF0F2] text-[#C83250]"
                      }`}>
                        {row.ok ? "●" : "!"}
                      </span>
                      <div>
                        <strong className="text-[13.5px] font-semibold">{row.ok ? "Healthy" : "Failed"}</strong>
                        <p className="mt-0.5 text-[12px] text-[#7C82A1]">{row.latencyMs} ms database round-trip</p>
                      </div>
                      <time className="mono text-[11px] text-[#8B90AA]">{new Date(row.createdAt).toLocaleString("en-PH")}</time>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
