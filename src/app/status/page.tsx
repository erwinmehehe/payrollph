import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { Activity, ShieldCheck } from "lucide-react";
import { db } from "@/db";
import { healthSnapshots } from "@/db/schema";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "System Status | Linaw",
  description: "The current recorded application and database availability for this Linaw deployment.",
  alternates: { canonical: "/status" },
};

export default async function StatusPage() {
  // Only the latest up/down signal may appear in public HTML or RSC payloads.
  // Detailed timestamps, health history and latency remain private via the
  // authenticated operations API; do not render them in server components.
  let current: boolean | null = null;
  try {
    const [latest] = await db.select({ ok: healthSnapshots.ok })
      .from(healthSnapshots).orderBy(desc(healthSnapshots.createdAt)).limit(1);
    current = latest?.ok ?? null;
  } catch {
    current = null;
  }

  const status = current === null ? "Unknown" : current ? "Operational" : "Degraded";
  const tone = current === true
    ? "bg-[#e5f8f2] text-[#00886e]"
    : current === false
      ? "bg-[#FFF0F2] text-[#C83250]"
      : "bg-[#FFF4D6] text-[#9A6B00]";

  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "System status", path: "/status" }]} />
      <SiteNav />
      <main>
        <section className="border-b border-[#EDEFF7] bg-[#FAFBFD] py-14 sm:py-18">
          <div className="mx-auto max-w-[1040px] px-5 sm:px-8">
            <span className={"inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[12px] font-bold " + tone}>
              <ShieldCheck size={14} />
              {status}
            </span>
            <h1 className="font-display mt-5 text-[42px] font-semibold tracking-[-0.045em] sm:text-[56px]">Linaw system status.</h1>
            <p className="mt-4 max-w-[700px] text-[15px] leading-relaxed text-[#5B6080]">
              Recorded from live <span className="mono">/api/health</span> checks against this deployment. This is Linaw&apos;s own
              recorded health signal, not a third-party status-page estimate.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <article className="rounded-[22px] border border-[#E2E4F0] bg-white p-5">
                <span className={"flex h-10 w-10 items-center justify-center rounded-xl " + tone}>
                  <Activity size={17} />
                </span>
                <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.13em] text-[#9298AF]">Current</p>
                <strong className="font-display mt-1 block text-[23px] font-semibold">{status}</strong>
                <p className="mt-2 text-[12px] leading-relaxed text-[#6B718C]">
                  Latest recorded application and database health state. When no verified snapshot is available, status is unknown.
                </p>
              </article>
              <article className="rounded-[22px] border border-[#E2E4F0] bg-white p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e5f0ff] text-[#0868dc]">
                  <ShieldCheck size={17} />
                </span>
                <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.13em] text-[#9298AF]">Monitoring scope</p>
                <strong className="font-display mt-1 block text-[23px] font-semibold">App + database</strong>
                <p className="mt-2 text-[12px] leading-relaxed text-[#6B718C]">
                  Detailed measurements and historical diagnostics are available to authorized operators only.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="py-14 sm:py-16">
          <div className="mx-auto max-w-[1040px] px-5 sm:px-8">
            <div className="rounded-[22px] border border-[#DDE0EF] bg-[#FAFBFD] p-5">
              <h2 className="text-[18px] font-semibold">What this status means</h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[#5B6080]">
                These checks cover Linaw application reachability and database response. They do not certify transactional email,
                PayMongo or bank payout availability, or BIR, SSS, PhilHealth and Pag-IBIG portal availability.
                This display does not establish service-level guarantees.
              </p>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
