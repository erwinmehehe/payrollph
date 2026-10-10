import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  FileCheck2,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { Reveal } from "./ui";

const trustPoints = [
  "SSS, PhilHealth, Pag-IBIG & TRAIN calculations",
  "Government worksheets clearly labelled",
  "Maker-checker release controls",
] as const;

const releaseChecks = [
  {
    icon: Check,
    label: "Checker approval",
    value: "Approved",
    tone: "ok",
  },
  {
    icon: AlertTriangle,
    label: "Payroll exceptions",
    value: "2 need review",
    tone: "warn",
  },
  {
    icon: FileCheck2,
    label: "Statutory calculations",
    value: "Ready",
    tone: "ok",
  },
] as const;

export default function Hero() {
  return (
    <section id="top" className="payroll-home-hero payroll-home-hero-v2">
      <div className="payroll-home-hero-glow" aria-hidden />

      <div className="payroll-home-hero-inner payroll-home-hero-inner-v2">
        <div className="payroll-home-hero-copy payroll-home-hero-copy-v2">
          <Reveal delay={60}>
            <span className="payroll-home-kicker">Philippine Payroll · HRIS · WFM · HCM</span>
          </Reveal>

          <Reveal delay={120}>
            <h1>
              One Philippine platform for payroll and people operations.
            </h1>
          </Reveal>

          <Reveal delay={180}>
            <p className="payroll-home-lede">
              Connect employee records, schedules, attendance, performance and payroll review in one governed workspace. Understand changes and approvals before money moves.
            </p>
          </Reveal>

          <Reveal delay={230}>
            <div className="payroll-home-actions">
              <a href="/demo" className="hero-primary-cta payroll-home-primary">
                Try Live Demo <ArrowRight size={16} aria-hidden />
              </a>
              <a href="#pricing" className="payroll-home-secondary">
                See Pricing
              </a>
            </div>
          </Reveal>

          <Reveal delay={280}>
            <ul className="payroll-home-trust">
              {trustPoints.map((item) => (
                <li key={item}>
                  <CheckCircle2 size={17} aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        <Reveal delay={150} className="payroll-home-control-wrap">
          <div className="payroll-hero-control-card" aria-label="Payroll release readiness example">
            <div className="payroll-hero-control-head">
              <div>
                <span className="payroll-hero-control-eyebrow">Release readiness</span>
                <h2>Can I safely release this payroll?</h2>
              </div>
              <span className="payroll-hero-review-pill">
                <AlertTriangle size={13} aria-hidden />
                Needs review
              </span>
            </div>

            <div className="payroll-hero-period">
              <div>
                <strong>March 1–15, 2026</strong>
                <span>Pay date Mar 20, 2026</span>
              </div>
              <span className="payroll-hero-rule-badge">Rule engine PH-2026.01</span>
            </div>

            <div className="payroll-hero-money-grid">
              <article>
                <span>Gross payroll</span>
                <strong>₱79,631</strong>
              </article>
              <article>
                <span>Deductions</span>
                <strong>₱9,856</strong>
              </article>
              <article>
                <span>Net pay</span>
                <strong>₱69,775</strong>
              </article>
            </div>

            <div className="payroll-hero-checks">
              {releaseChecks.map(({ icon: Icon, label, value, tone }) => (
                <div key={label} className="payroll-hero-check-row">
                  <span className={`payroll-hero-check-icon ${tone}`}>
                    <Icon size={15} aria-hidden />
                  </span>
                  <div>
                    <span>{label}</span>
                    <strong className={tone}>{value}</strong>
                  </div>
                </div>
              ))}
            </div>

            <div className="payroll-hero-lock-row">
              <span className="payroll-hero-lock-icon">
                <LockKeyhole size={16} aria-hidden />
              </span>
              <div>
                <strong>Release stays locked until blockers are cleared.</strong>
                <span>Nothing moves just because payroll was calculated.</span>
              </div>
            </div>

            <div className="payroll-hero-control-foot">
              <span>
                <ShieldCheck size={14} aria-hidden />
                Every decision stays traceable
              </span>
              <span>SSS · PhilHealth · Pag-IBIG · BIR</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
