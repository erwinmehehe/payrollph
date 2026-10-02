import { useState } from "react";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Clock, Download, Lock, Play, ShieldCheck } from "lucide-react";
import { Reveal } from "./ui";
import { cn } from "../utils/cn";
import { PayrollOwl } from "@/components/payroll-owl";

const audiences = [
  { id: "freelancer", label: "Freelancer", nav: ["Overview", "Taxes", "Documents"], note: "People, payroll and approvals stay hidden until you need them." },
  { id: "team", label: "Small team", nav: ["Overview", "People", "Payroll", "Time", "Leave"], note: "One company, one semi-monthly run, payslips emailed on release." },
  { id: "bookkeeper", label: "Bookkeeper", nav: ["Clients", "Payroll", "Approvals", "Exports", "Reports"], note: "Switch between client businesses. Each one is tenant-isolated." },
  { id: "branch", label: "Multi-branch", nav: ["Org units", "Payroll", "Approvals", "Delegation", "API"], note: "Department-scoped access, delegated approvers, webhooks." },
] as const;

const entries = [
  { name: "Aira Villanueva", no: "EMP-0012", net: "24,318.40", status: "ok" },
  { name: "Trish Dela Cruz", no: "EMP-0007", net: "12,731.45", status: "exc", flag: "INCOMPLETE_PUNCH" },
  { name: "Rico Mendoza", no: "EMP-0019", net: "18,902.15", status: "ok" },
  { name: "Miguel Santos", no: "EMP-0003", net: "21,445.80", status: "hol", flag: "HOLIDAY 1.3×" },
];

export default function Hero() {
  const [aud, setAud] = useState<(typeof audiences)[number]["id"]>("bookkeeper");
  const a = audiences.find((x) => x.id === aud)!;

  return (
    <section id="top" className="relative overflow-hidden pb-16 pt-[120px] sm:pt-[140px]">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="bg-dots mask-fade-b absolute inset-x-0 top-0 h-[700px] opacity-50" />
        <div className="absolute -top-40 right-[-10%] h-[600px] w-[700px] rounded-full bg-gradient-to-br from-[#ECECFF] via-[#EAF4FF] to-[#E3FAF0] opacity-80 blur-3xl" />
      </div>

      <div className="relative mx-auto grid max-w-[1240px] items-center gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <Reveal delay={80}>
            <h1 className="font-display text-[48px] font-extrabold leading-[1] sm:text-[68px] lg:text-[76px]">
              Payroll that <span className="relative whitespace-nowrap text-[#6161FF]">shows its work.
                <svg aria-hidden viewBox="0 0 300 14" className="absolute -bottom-1.5 left-0 w-full" preserveAspectRatio="none"><path d="M3 10 C 90 2, 200 2, 297 8" stroke="#00CA72" strokeWidth="5" strokeLinecap="round" fill="none" /></svg>
              </span>
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-6 max-w-[520px] text-[17px] leading-relaxed text-[#5B6080] sm:text-[18px]">
              Linaw is the Philippine HR and payroll workspace where every peso has a trace. Clock-derived hours, tested statutory formulas and
              prepare, approve, release and export as four separately authorised steps.
            </p>
          </Reveal>
          <Reveal delay={230}>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="/signup" className="hero-primary-cta btn-primary group inline-flex items-center justify-center gap-2 rounded-full bg-[#6161FF] px-7 py-4 text-[15px] font-semibold text-white">
                Start 14-day trial <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
              </a>
              <a href="#demo" className="group inline-flex items-center justify-center gap-2 rounded-full border border-[#D9DCEC] bg-white px-7 py-4 text-[15px] font-semibold shadow-sm transition-all hover:shadow-md">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ECECFF]"><Play className="h-3 w-3 fill-[#4A4AE0] text-[#4A4AE0]" aria-hidden /></span>
                Play the live demo
              </a>
            </div>
          </Reveal>

          <Reveal delay={300}>
            <div className="mt-10">
              <p className="text-[14px] font-bold text-[#2B2F45]">Complexity is opt-in. I am a…</p>
              <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Choose your setup">
                {audiences.map((x) => (
                  <button key={x.id} role="radio" aria-checked={aud === x.id} onClick={() => setAud(x.id)}
                    className={cn("rounded-full border px-4 py-2 text-[13.5px] font-bold transition-all",
                      aud === x.id ? "border-[#6161FF] bg-[#6161FF] text-white shadow-[0_8px_20px_-8px_rgba(97,97,255,.7)]" : "border-[#E2E4F0] bg-white text-[#2B2F45] hover:border-[#B9BDE0]")}>
                    {x.label}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[13.5px] text-[#5B6080]" aria-live="polite">{a.note}</p>
            </div>
          </Reveal>
        </div>

        <Reveal delay={150} className="relative">
          <div className="mb-4 flex items-center gap-3 rounded-[18px] border border-[#DDE7F1] bg-white/95 p-3 shadow-[0_18px_48px_-32px_rgba(11,35,66,.4)] backdrop-blur sm:max-w-[420px]">
            <div className="h-[72px] w-[72px] shrink-0 rounded-[16px] bg-gradient-to-br from-[#EEF8FB] to-[#F7FBFD] p-1">
              <PayrollOwl state="review" className="h-full w-full" label="PayrollPH owl payroll guide" />
            </div>
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#0F8F8A]">Payroll Guide</p>
              <p className="mt-1 text-[13px] font-extrabold leading-snug text-[#102A4C]">I’ll help you see what needs attention before payday.</p>
              <p className="mt-1 text-[11px] leading-relaxed text-[#727A91]">Clear prompts, real payroll state, no noisy pop-ups.</p>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[22px] border border-[#E2E4F0] bg-white shadow-[0_2px_6px_rgba(16,18,38,.05),0_40px_90px_-30px_rgba(70,70,190,.35)]">
            <div className="grid grid-cols-[150px_1fr] max-sm:grid-cols-1">
              <aside className="border-r border-[#EDEFF7] bg-[#FAFBFD] p-3 max-sm:hidden">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#11141F]"><Check className="h-3.5 w-3.5 text-white" strokeWidth={3} aria-hidden /></span>
                  <span className="text-[13px] font-bold">linaw</span>
                </div>
                <ul className="mt-3 space-y-0.5">
                  {a.nav.map((n, i) => (
                    <li key={n} className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] transition-all duration-300", i === 1 || (a.nav.length === 3 && i === 0) ? "bg-white font-bold shadow-sm ring-1 ring-[#E2E4F0]" : "font-medium text-[#5B6080]")}>
                      <span className={cn("h-4 w-4 rounded-[5px]", ["bg-[#ECECFF]", "bg-[#E3FAF0]", "bg-[#FFF4D6]", "bg-[#F1EDFF]", "bg-[#E0F7FA]"][i])} aria-hidden />
                      {n}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 rounded-lg border border-dashed border-[#D9DCEC] p-2 text-[10.5px] leading-snug text-[#7C82A1]">⌘K to search people, clients & actions</div>
              </aside>

              <div className="p-4 sm:p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-[#9AA0BB]">{aud === "bookkeeper" ? "Client · Masigla Foods" : "Payroll run"}</p>
                    <p className="font-display text-[19px] font-extrabold">Mar 1–15, 2026</p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF4D6] px-2.5 py-1 text-[10.5px] font-extrabold uppercase text-[#9A6B00]">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#E8A800]" aria-hidden /> Needs decision
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  {[["Gross", "79,631.00", "#6161FF"], ["Deductions", "9,856.20", "#FF7A29"], ["Net", "69,774.80", "#00CA72"]].map(([l, v, c]) => (
                    <div key={l} className="rounded-xl border border-[#EDEFF7] p-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#9AA0BB]">{l}</p>
                      <p className="mono mt-0.5 text-[13px] font-semibold sm:text-[14px]">₱{v}</p>
                      <div className="mt-1.5 h-1 rounded-full" style={{ background: c }} />
                    </div>
                  ))}
                </div>

                <ol className="mt-3 grid grid-cols-4 gap-1.5">
                  {[
                    { l: "Prepare", s: "done" }, { l: "Approve", s: "now" }, { l: "Release", s: "lock" }, { l: "Export", s: "lock" },
                  ].map((st) => (
                    <li key={st.l} className={cn("flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-bold",
                      st.s === "done" ? "bg-[#E3FAF0] text-[#0A8A53]" : st.s === "now" ? "bg-[#ECECFF] text-[#4A4AE0] ring-1 ring-[#6161FF]/40" : "bg-[#F4F5FA] text-[#9AA0BB]")}>
                      {st.s === "done" ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : st.s === "now" ? <Clock className="h-3 w-3" aria-hidden /> : <Lock className="h-3 w-3" aria-hidden />}
                      {st.l}
                    </li>
                  ))}
                </ol>

                <div className="mt-3 overflow-hidden rounded-xl border border-[#EDEFF7]">
                  <div className="grid grid-cols-[1fr_auto] bg-[#FAFBFD] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#9AA0BB]">
                    <span>Register</span><span>Net ₱</span>
                  </div>
                  <ul className="divide-y divide-[#F1F2F8]">
                    {entries.map((e) => (
                      <li key={e.no} className="grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-2.5 transition-colors hover:bg-[#FAFBFD]">
                        <div className="min-w-0">
                          <p className="truncate text-[12.5px] font-bold">{e.name} <span className="mono ml-1 text-[10.5px] font-medium text-[#9AA0BB]">{e.no}</span></p>
                          {e.flag && (
                            <span className={cn("mono mt-0.5 inline-block rounded px-1.5 text-[9.5px] font-semibold", e.status === "exc" ? "bg-[#FFE8EC] text-[#D12D4B]" : "bg-[#F1EDFF] text-[#6D4DE0]")}>{e.flag}</span>
                          )}
                        </div>
                        <span className={cn("mono text-[12.5px] font-semibold", e.status === "exc" && "text-[#D12D4B]")}>{e.net}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-3 flex items-center gap-2 rounded-xl bg-[#FFF6F7] px-3 py-2.5 text-[12px] text-[#9E2239] ring-1 ring-[#FFD5DC]">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                  1 exception. Release asks for explicit acknowledgement.
                </div>
              </div>
            </div>
          </div>

          <div aria-hidden className="animate-float absolute -bottom-6 -left-6 hidden items-center gap-2.5 rounded-2xl border border-[#E2E4F0] bg-white/95 p-3 pr-4 shadow-xl backdrop-blur md:flex">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E3FAF0]"><ShieldCheck className="h-4.5 w-4.5 text-[#0A8A53]" /></span>
            <div><p className="text-[12px] font-bold">17/17 cross-tenant attempts</p><p className="mono text-[11px] text-[#0A8A53]">→ 403 Forbidden</p></div>
          </div>
          <div aria-hidden className="animate-float-slow absolute -right-4 -top-5 hidden items-center gap-2.5 rounded-2xl border border-[#E2E4F0] bg-white/95 p-3 pr-4 shadow-xl backdrop-blur md:flex">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E0F7FA]"><Download className="h-4.5 w-4.5 text-[#00838F]" /></span>
            <div><p className="text-[12px] font-bold">BDO DAT validated</p><p className="mono text-[11px] text-[#7C82A1]">dry-run · 40 rows</p></div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
