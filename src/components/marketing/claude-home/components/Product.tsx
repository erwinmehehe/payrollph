import { useMemo, useState } from "react";
import { compute, fmt } from "../lib/rules";
import { FileText, Gauge, Landmark, Lock, Wallet } from "lucide-react";
import { Reveal, SectionHeading } from "./ui";
import { cn } from "../utils/cn";

export function Calculator() {
  const [salary, setSalary] = useState(35000);
  const r = useMemo(() => compute(salary), [salary]);
  const pct = ((salary - 10000) / (200000 - 10000)) * 100;
  const rows = [
    { l: "SSS", sub: `MSC ₱${r.msc.toLocaleString()} · 5% EE · RA 11199`, v: r.sss, c: "#579BFC" },
    { l: "PhilHealth", sub: "5% premium, split 50/50 · RA 11223", v: r.ph, c: "#00CA72" },
    { l: "Pag-IBIG", sub: "2% EE, capped at ₱10,000 base · RA 9679", v: r.hdmf, c: "#FF7A29" },
    { l: "Withholding tax", sub: "TRAIN annual brackets ÷ 12 · RA 10963", v: r.wtax, c: "#10b8a0" },
  ];
  const total = salary;

  return (
    <section id="calculator" className="scroll-mt-20 bg-[#F7F8FC] py-16 sm:py-20">
      <div className="mx-auto grid max-w-[1240px] items-center gap-10 px-5 sm:px-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <SectionHeading
            title="See how a payroll calculation explains itself."
            description="This simple salary example uses the same statutory formulas as Linaw's payroll engine. Real payroll adds attendance, holidays, overtime, benefits, exemptions and cutoff context."
          />
          <Reveal delay={180}>
            <p className="mt-5 text-[13.5px] leading-relaxed text-[#7C82A1]">
              Estimate for illustration. Real runs also apply holidays, OT, benefits and MWE exemptions.
            </p>
          </Reveal>
        </div>

        <Reveal delay={100}>
          <div className="rounded-[28px] border border-[#E2E4F0] bg-white p-6 shadow-[0_20px_52px_-28px_rgba(16,18,38,.22)] sm:p-7">
            <div className="flex items-end justify-between gap-4">
              <label htmlFor="salary" className="text-[12.5px] font-bold uppercase tracking-[0.13em] text-[#8B90AA]">
                Monthly basic
              </label>
              <p className="mono text-[30px] font-bold sm:text-[35px]">₱{salary.toLocaleString()}</p>
            </div>

            <input
              id="salary"
              type="range"
              min={10000}
              max={200000}
              step={500}
              value={salary}
              onChange={(e) => setSalary(+e.target.value)}
              className="lin mt-4 w-full"
              style={{ ["--p" as string]: `${pct}%` }}
              aria-valuetext={`₱${salary.toLocaleString()} per month`}
            />
            <div className="mt-2 flex justify-between mono text-[12px] text-[#8B90AA]">
              <span>₱10k</span>
              <span>₱200k</span>
            </div>

            <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-[#F1F2F8]" aria-hidden>
              {rows.map((x) => (
                <div key={x.l} className="transition-all duration-300" style={{ width: `${(x.v / total) * 100}%`, background: x.c }} />
              ))}
              <div className="bg-[#e5f8f2] transition-all duration-300" style={{ width: `${(r.net / total) * 100}%` }} />
            </div>

            <ul className="mt-4 divide-y divide-[#F1F2F8]">
              {rows.map((x) => (
                <li key={x.l} className="flex items-center gap-3 py-3">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: x.c }} aria-hidden />
                  <div className="flex-1">
                    <p className="text-[14.5px] font-semibold">{x.l}</p>
                    <p className="text-[13px] leading-relaxed text-[#7C82A1]">{x.sub}</p>
                  </div>
                  <p className="mono text-[14px] font-semibold">−{fmt(x.v)}</p>
                </li>
              ))}
            </ul>

            <div className="mt-2 flex items-center justify-between rounded-2xl bg-[#e5f8f2] px-4 py-4">
              <p className="text-[14.5px] font-bold text-[#0A6B41]">Take-home pay</p>
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
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <div className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
          <SectionHeading
            title="8,000 employees in about 13 seconds."
            description="The job queue chunks work with Postgres SKIP LOCKED instead of running one oversized transaction."
          />
          <Reveal delay={100}>
            <div className="grid grid-cols-3 gap-3">
              {[
                ["604", "employees / sec"],
                ["1.66 ms", "per employee"],
                ["resumable", "calculation jobs"],
              ].map(([value, label]) => (
                <div key={label} className="rounded-2xl border border-[#E8EAF3] bg-[#FAFBFD] px-4 py-4">
                  <p className="mono text-[20px] font-bold text-[#0B0D1A] sm:text-[24px]">{value}</p>
                  <p className="mt-1 text-[12.5px] font-medium leading-snug text-[#7C82A1]">{label}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>

        <Reveal delay={140}>
          <div className="mt-7 overflow-hidden rounded-[28px] border border-[#E2E4F0] bg-[#11141F] p-6 text-white sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[12.5px] font-bold uppercase tracking-[0.13em] text-white/55">
                <Gauge className="h-4 w-4 text-[#A7A7FF]" aria-hidden />
                Throughput benchmark
              </div>
              <p className="mono rounded-full bg-white/10 px-3 py-1.5 text-[12px] text-white/60">$ npx tsx scripts/benchmark.ts</p>
            </div>

            <ul className="mt-7 grid gap-5 md:grid-cols-2">
              {bench.map((b, k) => (
                <li key={b.e} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-baseline justify-between gap-3 text-[14px]">
                    <span className="font-semibold">{b.e} employees</span>
                    <span className="mono text-[12.5px] text-white/55">{b.t} · {b.per} ms/emp</span>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10">
                      <Reveal delay={k * 100} className="h-full">
                        <div className="h-full rounded-full bg-gradient-to-r from-[#10b8a0] via-[#0877ff] to-[#579BFC]" style={{ width: `${(b.thr / 620) * 100}%` }} />
                      </Reveal>
                    </div>
                    <span className="mono w-10 text-right text-[13px] font-bold">{b.thr}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const exportGroups = [
  {
    t: "Bank disbursement",
    icon: Wallet,
    c: "#00A6B8",
    soft: "#E0F7FA",
    items: [["BDO", "TEMPLATE"], ["BPI / UnionBank", "TEMPLATE"], ["GCash", "EXPORT"], ["PayMongo", "DIRECT*"]],
    note: "Only enabled through a validated template or configured provider",
    preview: [
      "H|LINAW|20260320|40|0036128200",
      "D|EMP-0012|AIRA VILLANUEVA|...|0002431840",
      "T|40|0036128200",
    ],
  },
  {
    t: "Accounting",
    icon: FileText,
    c: "#0877ff",
    soft: "#e5f0ff",
    items: [["Xero", "Journal CSV"], ["QuickBooks Online", "Journal CSV"], ["Report builder", "CSV"], ["Full company export", "Portable"]],
    note: "Your data leaves with you, anytime",
    preview: [
      "Payroll Mar 1-15,6100 Salaries,361282.00,",
      "Payroll Mar 1-15,2210 SSS Payable,,18450.00",
      "Payroll Mar 1-15,1010 Bank,,315442.15",
    ],
  },
  {
    t: "Government",
    icon: Landmark,
    c: "#10b8a0",
    soft: "#F1EDFF",
    items: [["BIR 1601-C", "DRAFT"], ["Alphalist / 2316", "DRAFT"], ["SSS R-3", "DRAFT"], ["PhilHealth RF-1", "DRAFT"]],
    note: "Draft until agency acceptance evidence is recorded",
    preview: [
      "BIR 1601-C · period 2026-03",
      "withholding_tax_payable: ₱42,218.44",
      "status: DRAFT · validation required",
    ],
  },
];

export function Exports() {
  return (
    <section id="exports" className="scroll-mt-20 bg-[#F7F8FC] py-16 sm:py-20">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <SectionHeading
          title="From released payroll to a controlled payout or export path."
          description="Every downstream output shows what it is: direct when configured, export when supported, template-dependent for proprietary bank files, or draft until agency validation."
        />

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {exportGroups.map((g, k) => (
            <Reveal key={g.t} delay={k * 90}>
              <article className="card-hover flex h-full flex-col rounded-[26px] border border-[#E8EAF3] bg-white p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: g.soft }}>
                    <g.icon className="h-5 w-5" style={{ color: g.c }} aria-hidden />
                  </span>
                  <div>
                    <h3 className="font-display text-[20px] font-semibold">{g.t}</h3>
                    <p className="mt-0.5 text-[12.5px] font-medium text-[#7C82A1]">{g.note}</p>
                  </div>
                </div>

                <div className="mono mt-5 overflow-hidden rounded-2xl border border-[#E8EAF3] bg-[#11141F] p-4 text-[11.5px] leading-relaxed text-white/72">
                  {g.preview.map((line, i) => (
                    <p key={line} className={i === 0 ? "text-white" : ""}>{line}</p>
                  ))}
                </div>

                <ul className="mt-4 grid gap-2">
                  {g.items.map(([n, format]) => (
                    <li key={n} className="flex items-center justify-between rounded-xl bg-[#FAFBFD] px-3 py-2.5">
                      <span className="text-[13.5px] font-semibold">{n}</span>
                      <span className={cn(
                        "mono rounded-md px-2 py-0.5 text-[11.5px] font-semibold",
                        format === "DRAFT" ? "bg-[#F1EDFF] text-[#6D4DE0]" : "bg-white text-[#5B6080] ring-1 ring-[#E8EAF3]"
                      )}>
                        {format}
                      </span>
                    </li>
                  ))}
                </ul>

                <p className="mt-auto flex items-center gap-1.5 pt-4 text-[13px] font-medium text-[#7C82A1]">
                  <Lock className="h-3.5 w-3.5" aria-hidden />
                  Controlled after release
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
