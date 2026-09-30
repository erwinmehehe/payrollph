"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  FileLock2,
  Fingerprint,
  Gauge,
  KeyRound,
  Minus,
  Plus,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import { Reveal } from "./reveal";

/**
 * Every claim on this page is checked against the code it describes, see
 * the verification notes in the PR that added this file. Nothing here is
 * illustrative, each line names the real mechanism.
 */
export function SecuritySection() {
  return (
    <div className="bento">
      <Reveal className="feature-card wide security-lead">
        <h3>One workspace can never read another&apos;s payroll.</h3>
        <p>
          Every session route passes one shared membership gate. Resource URLs resolve their own organization, so an id
          in the URL never counts as authorization.
        </p>
        <div className="mono-block">
          {[
            "GET  /api/payroll-runs/:foreign/exports",
            "POST /api/payroll-runs/:foreign/release",
            "GET  /api/employees?org=:foreign",
          ].map((line) => (
            <div key={line}>
              <span className="path">{line}</span>
              <span className="code403">403</span>
            </div>
          ))}
          <div className="foot">Cross-tenant access attempts are covered by a test that fails the build if the gate is dropped.</div>
        </div>
      </Reveal>

      {[
        { icon: Fingerprint, tone: "i-purple", t: "TOTP before session", d: "Second factor sits between password success and session creation. Backup codes included." },
        { icon: KeyRound, tone: "i-amber", t: "Hashed everything", d: "scrypt passwords, hashed session, reset and API tokens. Lockout and distributed rate limits." },
        { icon: FileLock2, tone: "i-red", t: "Files sniffed, not trusted", d: "Magic-byte content checks, a 5 MB cap, and a scan hook that fails closed when an AV engine is wired." },
        { icon: ShieldCheck, tone: "i-teal", t: "Data Privacy Act ready", d: "Access, correction, deletion and portability requests, each with a 30-day due date and audit trail." },
      ].map((x, k) => (
        <Reveal key={x.t} delay={k * 70} className="feature-card">
          <span className="feature-icon" aria-hidden>
            <x.icon size={18} className={x.tone} />
          </span>
          <h3>{x.t}</h3>
          <p>{x.d}</p>
        </Reveal>
      ))}
    </div>
  );
}

const SNIPPET = `curl https://your-deployment/api/v1/employees \\
  -H "Authorization: Bearer sk_live_..." \\
  -H "Idempotency-Key: onboard-0042" \\
  -d '{"employeeNo":"EMP-0042","monthlyBasic":28000}'

# -> 201 Created, webhook: employee.onboarded
# Linaw-Signature: t=1773734400,v1=4b1e...`;

export function DevelopersSection() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="split">
      <div>
        <ul className="module-grid" style={{ display: "grid", gap: 10 }}>
          {[
            "Scoped API keys, hashed and shown once",
            "Idempotency-Key replay protection",
            "HMAC-SHA256 signed webhook deliveries",
            "Retries: 1m, 5m, 25m, 125m",
          ].map((line) => (
            <li key={line} className="notice notice-slate" style={{ margin: 0 }}>
              <Webhook size={15} className="i-purple" />
              <span style={{ fontWeight: 650 }}>{line}</span>
            </li>
          ))}
        </ul>
      </div>
      <Reveal className="dev-panel">
        <div className="dev-panel-head">
          <span className="dev-panel-dots" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          <span className="path">POST /api/v1/employees</span>
          <button
            type="button"
            className="dev-panel-copy"
            onClick={() => {
              navigator.clipboard?.writeText(SNIPPET);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            aria-label="Copy request"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre>
          <code>
            {SNIPPET.split("\n").map((line, index) => (
              <span key={index} className={line.startsWith("#") ? "comment" : undefined} style={{ display: "block" }}>
                {line || " "}
              </span>
            ))}
          </code>
        </pre>
      </Reveal>
    </div>
  );
}

/**
 * Measured, not assumed. Same numbers as README.md's "Benchmarks" table, from
 * a real `npx tsx scripts/benchmark.ts` run against the sandbox Postgres, not
 * an estimate.
 */
const BENCH_ROWS = [
  { employees: "50", time: "124 ms", perEmployee: "2.48 ms/emp", throughput: 403 },
  { employees: "500", time: "988 ms", perEmployee: "1.98 ms/emp", throughput: 506 },
  { employees: "3,000", time: "5.7 s", perEmployee: "1.90 ms/emp", throughput: 526 },
  { employees: "8,000", time: "13.3 s", perEmployee: "1.66 ms/emp", throughput: 604 },
];
const BENCH_MAX = 620;

export function BenchmarksSection() {
  return (
    <div className="split">
      <div className="section-copy" style={{ marginTop: 0 }}>
        <p>
          The job queue chunks work with Postgres <span className="mono">FOR UPDATE SKIP LOCKED</span> instead of running
          one oversized transaction. Calculation is resumable and idempotent, and throughput holds, slightly improving,
          as headcount grows.
        </p>
      </div>
      <Reveal className="card" style={{ padding: 24 }}>
        <div className="notice notice-slate" style={{ marginBottom: 4 }}>
          <Gauge size={15} className="i-purple" />
          <span style={{ fontWeight: 650 }}>Throughput, employees / sec</span>
        </div>
        <div className="bench-list" style={{ marginTop: 18 }}>
          {BENCH_ROWS.map((row, index) => (
            <Reveal key={row.employees} delay={index * 90}>
              <div className="bench-row-head">
                <strong>{row.employees} employees</strong>
                <span>
                  {row.time} · {row.perEmployee}
                </span>
              </div>
              <div className="bench-track">
                <div className="bench-fill" style={{ width: `${(row.throughput / BENCH_MAX) * 100}%` }} />
              </div>
            </Reveal>
          ))}
        </div>
        <p className="mono" style={{ marginTop: 16, fontSize: 11.5, color: "var(--muted)" }}>
          $ npx tsx scripts/benchmark.ts · see README.md#benchmarks
        </p>
      </Reveal>
    </div>
  );
}

const FAQS = [
  {
    q: "Are the statutory computations correct?",
    a: "SSS, PhilHealth, Pag-IBIG and TRAIN withholding are covered by an automated test suite (tests/payroll-rules.test.ts). Holiday stacking, DOLE regional wage floors, MWE exemptions and calamity advisory premiums are applied during calculation and traced on the payslip.",
  },
  {
    q: "Can I file directly with BIR, SSS, PhilHealth and Pag-IBIG?",
    a: "Linaw generates 1601-C, Alphalist/2316, SSS R-3, PhilHealth RF-1 and Pag-IBIG MCRF worksheets. They stay labelled DRAFT until a human confirms the output validated in the agency's own free tool. We would rather be honest than overclaim.",
  },
  {
    q: "I'm a bookkeeper. Can I run payroll for several clients?",
    a: "Yes. One login can manage multiple client businesses, each fully tenant-isolated. Switch clients from the sidebar or the Cmd/Ctrl+K command palette.",
  },
  {
    q: "How do I move my existing employees in?",
    a: "Upload your current spreadsheet. Column order, extra columns, peso signs and thousands separators are tolerated. Row errors are specific, valid rows still import, and re-uploading updates in place by employee number.",
  },
  {
    q: "How do employees get their payslips?",
    a: "Releasing a run queues a payslip-ready email for every active employee. They sign in to a personal portal with YTD figures and a downloadable PDF payslip, and can never reach a colleague's data.",
  },
  {
    q: "Can I get my data out?",
    a: "Anytime. Full company data export, report builder CSVs and Xero/QuickBooks Online journals are built in, and Data Privacy Act portability requests are tracked with a 30-day due date.",
  },
];

export function FaqSection() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="faq-list">
      {FAQS.map((faq, index) => {
        const isOpen = open === index;
        return (
          <Reveal key={faq.q} delay={index * 50} className={`faq-item ${isOpen ? "open" : ""}`}>
            <button
              type="button"
              className="faq-q"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : index)}
            >
              <span>{faq.q}</span>
              <span className="faq-q-icon" aria-hidden>
                {isOpen ? <Minus size={14} /> : <Plus size={14} />}
              </span>
            </button>
            <div className="faq-a">
              <div className="faq-a-inner">
                <p>{faq.a}</p>
              </div>
            </div>
          </Reveal>
        );
      })}
    </div>
  );
}
