import { useState } from "react";
import {
  Building2,
  Check,
  Copy,
  FileLock2,
  Fingerprint,
  KeyRound,
  Minus,
  ShieldCheck,
  UserRound,
  Users,
  Webhook,
  X,
} from "lucide-react";
import { Reveal, SectionHeading } from "./ui";
import { cn } from "../utils/cn";

export function Audiences() {
  const items = [
    { icon: UserRound, t: "Freelancers", c: "#00CA72", soft: "#E3FAF0", d: "A quiet self-employed profile. Solo is free, and team modules stay out of your way." },
    { icon: Users, t: "Small teams", c: "#579BFC", soft: "#EAF3FF", d: "People, time, leave and payslips. CSV import accepts the spreadsheet you already have." },
    { icon: Building2, t: "Bookkeepers", c: "#FF7A29", soft: "#FFF1E6", d: "Run payroll for many client businesses from one login. Every client is tenant-isolated." },
    { icon: ShieldCheck, t: "Multi-branch", c: "#7C5CFF", soft: "#F1EDFF", d: "Org units, department-scoped access, delegated approvals, API and webhooks." },
  ];

  return (
    <section id="product" className="scroll-mt-20 py-16 sm:py-20">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <SectionHeading align="center" title="Simple when you're small. Serious when you're not." />
        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((x, k) => (
            <Reveal key={x.t} delay={k * 80}>
              <article className="card-hover group relative h-full overflow-hidden rounded-[26px] border border-[#E8EAF3] bg-white p-6">
                <span className="absolute inset-x-0 top-0 h-1.5" style={{ background: x.c }} aria-hidden />
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-2xl transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110"
                  style={{ background: x.soft }}
                >
                  <x.icon className="h-6 w-6" style={{ color: x.c }} aria-hidden />
                </span>
                <h3 className="font-display mt-5 text-[20px] font-semibold">{x.t}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-[#5B6080]">{x.d}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const securityControls = [
  {
    icon: Fingerprint,
    t: "TOTP before session",
    d: "Second factor sits between password success and session creation. Backup codes included.",
    c: "#6161FF",
    s: "#ECECFF",
  },
  {
    icon: KeyRound,
    t: "Hashed everything",
    d: "scrypt passwords, hashed session, reset and API tokens. Lockout and distributed rate limits.",
    c: "#E8A800",
    s: "#FFF6DA",
  },
  {
    icon: FileLock2,
    t: "Files sniffed and scanned",
    d: "Magic-byte checks, ClamAV scanning that fails closed, 5 MB cap, sanitized filenames.",
    c: "#FF5C7A",
    s: "#FFE8EC",
  },
  {
    icon: ShieldCheck,
    t: "Data Privacy Act ready",
    d: "Access, correction, deletion and portability requests, each with a 30-day due date and audit trail.",
    c: "#7C5CFF",
    s: "#F1EDFF",
  },
];

export function Security() {
  return (
    <section id="security" className="scroll-mt-20 py-16 sm:py-20">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
          <SectionHeading
            title="Controls that return 403, not a tooltip."
            description="Every rule below is checked on the server and covered by a test that fails the build if it regresses."
          />
          <Reveal delay={80}>
            <p className="max-w-[620px] text-[15px] leading-relaxed text-[#5B6080] lg:ml-auto">
              The strongest security story is not a badge wall. It is predictable refusal behavior at the exact boundary where data or money could move.
            </p>
          </Reveal>
        </div>

        <Reveal delay={100}>
          <article className="mt-8 overflow-hidden rounded-[30px] border border-[#CDEFDD] bg-[#11141F] text-white shadow-[0_30px_70px_-38px_rgba(17,20,31,.5)]">
            <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="p-6 sm:p-8 lg:p-10">
                <span className="inline-flex items-center gap-2 rounded-full bg-[#E3FAF0] px-3 py-1.5 text-[12px] font-bold text-[#0A8A53]">
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                  Tenant isolation verified
                </span>
                <h3 className="font-display mt-5 max-w-[600px] text-[28px] font-semibold leading-tight sm:text-[36px]">
                  One workspace can never read another&apos;s payroll.
                </h3>
                <p className="mt-3 max-w-[640px] text-[15px] leading-relaxed text-white/65">
                  Every session route passes one shared membership gate. Resource URLs resolve their own organization, so an ID in the URL never counts as authorization.
                </p>
              </div>

              <div className="border-t border-white/10 bg-white/[0.04] p-5 sm:p-7 lg:border-l lg:border-t-0">
                <div className="mono grid gap-2 rounded-2xl border border-white/10 bg-black/10 p-4 text-[12.5px]">
                  {[
                    "GET  /api/payroll-runs/:foreign/exports",
                    "POST /api/payroll-runs/:foreign/release",
                    "GET  /api/employees?org=:foreign",
                  ].map((line) => (
                    <div key={line} className="flex items-center justify-between gap-3">
                      <span className="truncate text-white/72">{line}</span>
                      <span className="shrink-0 rounded-md bg-[#FFE8EC] px-2 py-0.5 font-semibold text-[#D12D4B]">403</span>
                    </div>
                  ))}
                  <div className="mt-2 border-t border-white/10 pt-3 text-[#77E1AD]">✓ 17/17 cross-tenant attempts rejected</div>
                </div>
              </div>
            </div>
          </article>
        </Reveal>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {securityControls.map((x, k) => (
            <Reveal key={x.t} delay={k * 70}>
              <article className="card-hover h-full rounded-[24px] border border-[#E8EAF3] bg-white p-5">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: x.s }}>
                  <x.icon className="h-5 w-5" style={{ color: x.c }} aria-hidden />
                </span>
                <h3 className="font-display mt-4 text-[18px] font-semibold">{x.t}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-[#5B6080]">{x.d}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

type S = "verified" | "partial" | "absent";

const score: { f: string; s: S; ev: string }[] = [
  { f: "SSS, PhilHealth, Pag-IBIG, TRAIN", s: "verified", ev: "tests/payroll-rules.test.ts" },
  { f: "Holiday stacking & regional wage floors", s: "verified", ev: "tests/wage-orders.test.ts" },
  { f: "Year-end annualization (2316)", s: "verified", ev: "tests/annualization.test.ts" },
  { f: "Benefits deduct on next run", s: "verified", ev: "tests/benefits-wiring.test.ts" },
  { f: "Government files byte-identical to ADES", s: "partial", ev: "DRAFT until agency tool validates" },
  { f: "Transactional email delivery", s: "partial", ev: "Outbox queues without provider" },
  { f: "SSO / SAML", s: "absent", ev: "Not built yet" },
  { f: "SOC 2 report", s: "absent", ev: "Not built yet" },
];

const badge: Record<S, string> = {
  verified: "bg-[#E3FAF0] text-[#0A8A53]",
  partial: "bg-[#FFF4D6] text-[#9A6B00]",
  absent: "bg-[#F1F2F8] text-[#7C82A1]",
};

const Ico = { verified: Check, partial: Minus, absent: X };

export function Scorecard() {
  const [filter, setFilter] = useState<S | "all">("all");
  const rows = score.filter((row) => filter === "all" || row.s === filter);

  return (
    <section id="scorecard" className="scroll-mt-20 bg-[#F7F8FC] py-16 sm:py-20">
      <div className="mx-auto grid max-w-[1240px] gap-9 px-5 sm:px-8 lg:grid-cols-[0.9fr_1.25fr]">
        <div>
          <SectionHeading
            title="We tell you what's missing, too."
            description="Every claim is classified verified, partial or absent and comes with its evidence: a test name, a file path or a live row count, generated from the deployment itself."
          />
          <Reveal delay={140}>
            <div className="mt-6 flex flex-wrap gap-2">
              {(["all", "verified", "partial", "absent"] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                  className={cn(
                    "rounded-full border px-4 py-2 text-[13px] font-semibold capitalize transition-all",
                    filter === value ? "border-[#11141F] bg-[#11141F] text-white" : "border-[#E2E4F0] bg-white hover:border-[#B9BDE0]"
                  )}
                >
                  {value}
                </button>
              ))}
            </div>
          </Reveal>
        </div>

        <Reveal delay={100}>
          <div className="overflow-hidden rounded-[26px] border border-[#E2E4F0] bg-white">
            <div className="grid grid-cols-[1fr_auto] bg-[#FAFBFD] px-5 py-3 text-[12px] font-bold uppercase tracking-[0.12em] text-[#8B90AA]">
              <span>Capability · evidence</span>
              <span>Status</span>
            </div>
            <ul className="divide-y divide-[#F1F2F8]">
              {rows.map((row) => {
                const Icon = Ico[row.s];
                return (
                  <li key={row.f} className="grid grid-cols-[1fr_auto] items-center gap-3 px-5 py-3.5 transition-colors hover:bg-[#FAFBFD]">
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-semibold">{row.f}</p>
                      <p className="mono truncate text-[12px] text-[#7C82A1]">{row.ev}</p>
                    </div>
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-bold capitalize", badge[row.s])}>
                      <Icon className="h-3 w-3" strokeWidth={3} aria-hidden />
                      {row.s}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const snippet = `curl https://app.linaw.ph/api/v1/employees \\
  -H "Authorization: Bearer lk_live_9f2c…" \\
  -H "Idempotency-Key: onboard-0042" \\
  -d '{"employeeNo":"EMP-0042","monthlyBasic":28000}'

# ← 201 Created · webhook: employee.onboarded
# Linaw-Signature: t=1773734400,v1=4b1e…`;

export function Developers() {
  const [copied, setCopied] = useState(false);

  return (
    <section id="developers" className="scroll-mt-20 py-16 sm:py-20">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <div className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
          <div>
            <SectionHeading title="Plug payroll into the rest of your stack." />
            <Reveal delay={120}>
              <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
                {[
                  "Scoped API keys, hashed and shown once",
                  "Idempotency-Key replay protection",
                  "HMAC-SHA256 signed deliveries",
                  "Retries: 1m → 5m → 25m → 125m",
                ].map((text) => (
                  <li key={text} className="flex items-start gap-2 rounded-2xl border border-[#E8EAF3] bg-white p-3.5 text-[14px] font-medium leading-relaxed">
                    <Webhook className="mt-0.5 h-4 w-4 shrink-0 text-[#7C5CFF]" aria-hidden />
                    {text}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <Reveal delay={100}>
            <div className="overflow-hidden rounded-[28px] border border-[#E2E4F0] bg-[#FBFBFE] shadow-[0_22px_54px_-30px_rgba(124,92,255,.32)]">
              <div className="flex items-center justify-between border-b border-[#EDEFF7] bg-white px-5 py-3">
                <div className="flex gap-1.5" aria-hidden>
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
                </div>
                <span className="mono text-[12px] text-[#7C82A1]">POST /api/v1/employees</span>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(snippet);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-[#6D4DE0] hover:bg-[#F1EDFF]"
                  aria-label="Copy code"
                >
                  {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="mono overflow-x-auto p-5 text-[13px] leading-[1.75] text-[#2B2F45]">
                <code>
                  {snippet.split("\n").map((line, index) => (
                    <span key={index} className={cn("block", line.startsWith("#") && "text-[#0A8A53]")}>
                      {line || " "}
                    </span>
                  ))}
                </code>
              </pre>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
