import { useMemo, useState } from "react";
import { compute, fmt } from "../lib/rules";
import { FileText, Gauge, Landmark, Lock, Wallet } from "lucide-react";
import { Reveal, SectionHeading } from "./ui";
import { cn } from "../utils/cn";

const partners = ["BDO", "BPI", "UnionBank", "GCash", "PayMongo", "Xero", "QuickBooks", "SSS R-3", "PhilHealth RF-1", "Pag-IBIG MCRF", "BIR 1601-C", "Alphalist 2316"];
export function TrustStrip() {
  return (
    <section aria-label="Exports and integrations" className="border-y border-[#EDEFF7] bg-[#FAFBFD] py-8">
      <p className="text-center text-[11.5px] font-extrabold uppercase tracking-[0.16em] text-[#9AA0BB]">Generates files for the banks, ledgers and agencies you already use</p>
      <div className="mask-fade-x mt-5 overflow-hidden">
        <div className="animate-marquee flex w-max gap-3 pr-3">
          {[...partners, ...partners].map((p, i) => (
            <span key={i} className="mono whitespace-nowrap rounded-full border border-[#E2E4F0] bg-white px-4 py-2 text-[13px] font-semibold text-[#3A3E59]">{p}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Calculator() {
  const [salary, setSalary] = useState(35000);
  const r = useMemo(() => compute(salary), [salary]);
  const pct = ((salary - 10000) / (200000 - 10000)) * 100;
  const rows = [
    { l: "SSS", sub: `MSC ₱${r.msc.toLocaleString()} · 5% EE · RA 11199`, v: r.sss, c: "#579BFC" },
    { l: "PhilHealth", sub: "5% premium, split 50/50 · RA 11223", v: r.ph, c: "#00CA72" },
    { l: "Pag-IBIG", sub: "2% EE, capped at ₱10,000 base · RA 9679", v: r.hdmf, c: "#FF7A29" },
    { l: "Withholding tax", sub: "TRAIN annual brackets ÷ 12 · RA 10963", v: r.wtax, c: "#7C5CFF" },
  ];
  const total = salary;

  return (
    <section id="calculator" className="scroll-mt-20 bg-[#F7F8FC] py-20 sm:py-28">
      <div className="mx-auto grid max-w-[1240px] items-center gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <SectionHeading title="Drag a salary. Watch every deduction explain itself." description="The same statutory rules Linaw runs on payroll, tested against an independent PH payroll reference. Monthly, employee share, 2025 tables." />
          <Reveal delay={200}>
            <p className="mt-6 text-[12.5px] text-[#7C82A1]">Estimate for illustration. Real runs also apply holidays, OT, benefits and MWE exemptions.</p>
          </Reveal>
        </div>

        <Reveal delay={120}>
          <div className="rounded-3xl border border-[#E2E4F0] bg-white p-6 shadow-[0_24px_60px_-24px_rgba(16,18,38,.2)] sm:p-8">
            <div className="flex items-end justify-between">
              <label htmlFor="salary" className="text-[12px] font-extrabold uppercase tracking-widest text-[#9AA0BB]">Monthly basic</label>
              <p className="mono text-[30px] font-bold sm:text-[36px]">₱{salary.toLocaleString()}</p>
            </div>
            <input id="salary" type="range" min={10000} max={200000} step={500} value={salary} onChange={(e) => setSalary(+e.target.value)}
              className="lin mt-4 w-full" style={{ ["--p" as string]: `${pct}%` }} aria-valuetext={`₱${salary.toLocaleString()} per month`} />
            <div className="mt-2 flex justify-between mono text-[11px] text-[#9AA0BB]"><span>₱10k</span><span>₱200k</span></div>

            <div className="mt-6 flex h-3 overflow-hidden rounded-full bg-[#F1F2F8]" aria-hidden>
              {rows.map((x) => <div key={x.l} className="transition-all duration-300" style={{ width: `${(x.v / total) * 100}%`, background: x.c }} />)}
              <div className="bg-[#E3FAF0] transition-all duration-300" style={{ width: `${(r.net / total) * 100}%` }} />
            </div>

            <ul className="mt-5 divide-y divide-[#F1F2F8]">
              {rows.map((x) => (
                <li key={x.l} className="flex items-center gap-3 py-3">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: x.c }} aria-hidden />
                  <div className="flex-1"><p className="text-[14px] font-bold">{x.l}</p><p className="text-[12px] text-[#7C82A1]">{x.sub}</p></div>
                  <p className="mono text-[14px] font-semibold">−{fmt(x.v)}</p>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-center justify-between rounded-2xl bg-[#E3FAF0] px-4 py-4">
              <p className="text-[14px] font-extrabold text-[#0A6B41]">Take-home pay</p>
              <p className="mono text-[22px] font-bold text-[#0A6B41]" aria-live="polite">₱{fmt(r.net)}</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const bench = [
  { e: "50", t: "124 ms", per: "2.48", thr: 403 },
  { e: "500", t: "988 ms", per: "1.98", thr: 506 },
  { e: "3,000", t: "5.7 s", per: "1.90", thr: 526 },
  { e: "8,000", t: "13.3 s", per: "1.66", thr: 604 },
];
export function Benchmarks() {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto grid max-w-[1240px] gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_1.2fr] lg:items-center">
        <SectionHeading title="8,000 employees in about 13 seconds." description="The job queue chunks work with Postgres SKIP LOCKED instead of running one oversized transaction. Calculation is resumable and idempotent, and throughput goes up as headcount grows." />
        <Reveal delay={120}>
          <div className="rounded-3xl border border-[#E2E4F0] bg-white p-6 sm:p-8">
            <div className="flex items-center gap-2 text-[12px] font-extrabold uppercase tracking-widest text-[#9AA0BB]"><Gauge className="h-4 w-4 text-[#7C5CFF]" aria-hidden /> Throughput · employees / sec</div>
            <ul className="mt-6 space-y-5">
              {bench.map((b, k) => (
                <li key={b.e}>
                  <div className="flex items-baseline justify-between text-[13.5px]">
                    <span className="font-bold">{b.e} employees</span>
                    <span className="mono text-[12.5px] text-[#7C82A1]">{b.t} · {b.per} ms/emp</span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-[#F1F2F8]">
                      <Reveal delay={k * 120} className="h-full"><div className="h-full rounded-full bg-gradient-to-r from-[#7C5CFF] to-[#6161FF]" style={{ width: `${(b.thr / 620) * 100}%` }} /></Reveal>
                    </div>
                    <span className="mono w-10 text-right text-[13px] font-bold">{b.thr}</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mono mt-6 rounded-xl bg-[#F7F8FC] px-3 py-2 text-[11.5px] text-[#5B6080]">$ npx tsx scripts/benchmark.ts</p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function Exports() {
  const groups = [
    { t: "Bank disbursement", icon: Wallet, c: "#00A6B8", soft: "#E0F7FA", items: [["BDO", "DAT"], ["BPI / UnionBank", "CSV"], ["GCash", "CSV"], ["PayMongo", "Transfers V2"]], note: "Dry-run validated before file output" },
    { t: "Accounting", icon: FileText, c: "#6161FF", soft: "#ECECFF", items: [["Xero", "Journal CSV"], ["QuickBooks Online", "Journal CSV"], ["Report builder", "CSV"], ["Full company export", "Portable"]], note: "Your data leaves with you, anytime" },
    { t: "Government", icon: Landmark, c: "#7C5CFF", soft: "#F1EDFF", items: [["BIR 1601-C", "DRAFT"], ["Alphalist / 2316", "DRAFT"], ["SSS R-3", "DRAFT"], ["PhilHealth RF-1", "DRAFT"]], note: "Honestly labelled until agency-validated" },
  ];
  return (
    <section id="exports" className="scroll-mt-20 bg-[#F7F8FC] py-20 sm:py-28">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <SectionHeading title="From released run to the file your bank wants." />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {groups.map((g, k) => (
            <Reveal key={g.t} delay={k * 100}>
              <article className="card-hover h-full rounded-3xl border border-[#E8EAF3] bg-white p-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: g.soft }}><g.icon className="h-5 w-5" style={{ color: g.c }} aria-hidden /></span>
                <h3 className="font-display mt-5 text-[21px] font-extrabold">{g.t}</h3>
                <ul className="mt-4 space-y-2">
                  {g.items.map(([n, f]) => (
                    <li key={n} className="flex items-center justify-between rounded-xl border border-[#F1F2F8] bg-[#FAFBFD] px-3 py-2.5">
                      <span className="text-[13.5px] font-semibold">{n}</span>
                      <span className={cn("mono rounded-md px-2 py-0.5 text-[11px] font-semibold", f === "DRAFT" ? "bg-[#F1EDFF] text-[#6D4DE0]" : "bg-white text-[#5B6080] ring-1 ring-[#E8EAF3]")}>{f}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 flex items-center gap-1.5 text-[12.5px] font-medium text-[#7C82A1]"><Lock className="h-3.5 w-3.5" aria-hidden /> {g.note}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
