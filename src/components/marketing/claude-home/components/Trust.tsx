import { useState } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  CircleDollarSign,
  ClipboardCheck,
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

export function PayrollWorkflow() {
  const steps = [
    {
      icon: Users,
      role: "HR Admin",
      action: "Prepare approved inputs",
      copy: "People changes, attendance decisions and other approved payroll inputs are ready before calculation starts.",
      tone: "bg-[#F1F2F8] text-[#5B6080]",
    },
    {
      icon: CircleDollarSign,
      role: "Payroll Officer",
      action: "Calculate and resolve",
      copy: "Run payroll, inspect exceptions and hand the same run to an assigned checker for independent review.",
      tone: "bg-[#e5f0ff] text-[#0868dc]",
    },
    {
      icon: ClipboardCheck,
      role: "Checker",
      action: "Review the run",
      copy: "Review the submitted payroll and approve or decline it without gaining payroll-maker or release permissions.",
      tone: "bg-[#FFF4D6] text-[#9A6B00]",
    },
    {
      icon: BriefcaseBusiness,
      role: "Owner",
      action: "Release with context",
      copy: "See approval state, exceptions and release readiness before the approved payroll is allowed to move.",
      tone: "bg-[#e5f8f2] text-[#00886e]",
    },
    {
      icon: UserRound,
      role: "Employee",
      action: "Receive and verify",
      copy: "Open personal payslips and attendance details without access to another employee's payroll information.",
      tone: "bg-[#F1EDFF] text-[#6D4DE0]",
    },
  ];

  return (
    <section id="product" className="scroll-mt-20 border-y border-[#EDEFF7] bg-[#FAFBFD] py-16 sm:py-20">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <div className="grid gap-7 lg:grid-cols-[.82fr_1.18fr] lg:items-end">
          <SectionHeading
            title="One payroll. A clear owner at every handoff."
            description="Linaw keeps preparation, calculation, review, release and employee self-service distinct, so the same payroll moves forward without blurring responsibilities."
          />
          <Reveal delay={90}>
            <div className="rounded-[22px] border border-[#DDE0EF] bg-white p-5 lg:ml-auto lg:max-w-[560px]">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">The operating question</p>
              <p className="font-display mt-2 text-[19px] font-semibold leading-snug text-[#11141F]">
                Who owns the next decision before money moves?
              </p>
              <a href="/demo" className="mt-4 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-[#0868dc]">
                Try each role in the live demo <ArrowRight size={14} aria-hidden />
              </a>
            </div>
          </Reveal>
        </div>

        <div className="mt-9 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          {steps.map((step, index) => (
            <Reveal key={step.role} delay={index * 70}>
              <article className="relative h-full rounded-[22px] border border-[#E2E4F0] bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${step.tone}`}>
                    <step.icon size={17} aria-hidden />
                  </span>
                  <span className="mono text-[10px] font-bold text-[#A0A5B8]">{String(index + 1).padStart(2, "0")}</span>
                </div>
                <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.13em] text-[#8B90AA]">{step.role}</p>
                <h3 className="font-display mt-1.5 text-[18px] font-semibold leading-snug">{step.action}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-[#606780]">{step.copy}</p>
                {index < steps.length - 1 && (
                  <span className="absolute -right-[10px] top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-[#DDE0EF] bg-[#FAFBFD] text-[#8B90AA] lg:flex" aria-hidden>
                    <ArrowRight size={10} />
                  </span>
                )}
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
    c: "#0877ff",
    s: "#e5f0ff",
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
    t: "Document upload controls",
    d: "Uploads stay disabled unless scanning is configured. When enabled, magic-byte checks, malware scanning, file limits and sanitized names fail closed.",
    c: "#FF5C7A",
    s: "#FFE8EC",
  },
  {
    icon: ShieldCheck,
    t: "Privacy request workflow",
    d: "Access, correction, deletion and portability requests include an audit trail, internal response deadline and legal-retention review.",
    c: "#10b8a0",
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
            <div className="grid min-w-0 gap-0 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="min-w-0 p-6 sm:p-8 lg:p-10">
                <span className="inline-flex items-center gap-2 rounded-full bg-[#e5f8f2] px-3 py-1.5 text-[12px] font-bold text-[#00886e]">
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                  Tenant isolation verified
                </span>
                <h3 className="font-display mt-5 max-w-[600px] break-words text-[28px] font-semibold leading-tight sm:text-[36px]">
                  One workspace can never read another&apos;s payroll.
                </h3>
                <p className="mt-3 max-w-[640px] break-words text-[15px] leading-relaxed text-white/65">
                  Every session route passes one shared membership gate. Resource URLs resolve their own organization, so an ID in the URL never counts as authorization.
                </p>
              </div>

              <div className="min-w-0 border-t border-white/10 bg-white/[0.04] p-5 sm:p-7 lg:border-l lg:border-t-0">
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
  { f: "Core SSS, PhilHealth, Pag-IBIG & TRAIN engine", s: "partial", ev: "Automated tests pass; independent production reconciliation remains a gate" },
  { f: "Holiday premium stacking", s: "verified", ev: "tests/payroll-complex-holiday-matrix.test.ts" },
  { f: "Year-end annualization + 2316 draft", s: "partial", ev: "Automated tests pass; BIR workflow validation remains required" },
  { f: "Benefits deduct on next run", s: "verified", ev: "tests/benefits-wiring.test.ts" },
  { f: "Certified government filing", s: "absent", ev: "Draft outputs require recorded agency acceptance" },
  { f: "Transactional email delivery", s: "partial", ev: "Provider-confirmed live delivery is an operational gate" },
  { f: "SSO / SAML", s: "absent", ev: "Not built yet" },
  { f: "SOC 2 report", s: "absent", ev: "Not built yet" },
];

const badge: Record<S, string> = {
  verified: "bg-[#e5f8f2] text-[#00886e]",
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
                    <Webhook className="mt-0.5 h-4 w-4 shrink-0 text-[#10b8a0]" aria-hidden />
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
                    <span key={index} className={cn("block", line.startsWith("#") && "text-[#00886e]")}>
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
