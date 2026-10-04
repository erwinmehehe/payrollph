import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCircle2,
  ClipboardCheck,
  Search,
  ShieldCheck,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { Reveal } from "./ui";

const trustPoints = [
  "Philippine statutory payroll rules modeled",
  "Government worksheets clearly labelled",
  "Maker-checker release controls",
] as const;

const recentRuns = [
  { period: "Oct 1–15, 2026", amount: "₱ 1,248,530", status: "For Approval" },
  { period: "Sep 16–30, 2026", amount: "₱ 1,236,400", status: "Released" },
  { period: "Sep 1–15, 2026", amount: "₱ 1,198,450", status: "Released" },
] as const;

export default function Hero() {
  return (
    <section id="top" className="payroll-home-hero">
      <div className="payroll-home-hero-glow" aria-hidden />

      <div className="payroll-home-hero-inner">
        <div className="payroll-home-hero-copy">
          <Reveal delay={60}>
            <span className="payroll-home-kicker">Philippine payroll software · Review before release</span>
          </Reveal>

          <Reveal delay={120}>
            <h1>
              Philippine payroll software
              <br />
              you can verify before you pay.
            </h1>
          </Reveal>

          <Reveal delay={180}>
            <p className="payroll-home-lede">
              Calculate payroll, surface exceptions, get checker approval, release payslips,
              and prepare statutory outputs from one controlled workflow built for Philippine teams.
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

        <Reveal delay={150} className="payroll-home-visual-wrap">
          <div className="payroll-home-visual" aria-label="Linaw payroll release preview">
            <div className="payroll-hero-laptop">
              <div className="payroll-hero-screen">
                <div className="payroll-hero-appbar">
                  <div className="payroll-hero-brand">
                    <span className="payroll-hero-brand-mark"><ShieldCheck size={13} aria-hidden /></span>
                    <strong>linaw</strong>
                  </div>
                  <div className="payroll-hero-search">
                    <Search size={11} aria-hidden />
                    <span>Search employees, payroll, reports...</span>
                  </div>
                  <div className="payroll-hero-app-actions">
                    <Bell size={13} aria-hidden />
                    <span className="payroll-hero-avatar">MA</span>
                  </div>
                </div>

                <div className="payroll-hero-app">
                  <aside className="payroll-hero-sidebar">
                    {[
                      ["Dashboard", true],
                      ["Employees", false],
                      ["Payroll", false],
                      ["Approvals", false],
                      ["Government Reports", false],
                      ["Reports", false],
                      ["Settings", false],
                    ].map(([label, active]) => (
                      <div key={String(label)} className={active ? "active" : ""}>
                        <span />
                        {label}
                      </div>
                    ))}
                  </aside>

                  <div className="payroll-hero-main">
                    <div className="payroll-hero-welcome">
                      <div>
                        <h2>October payroll is ready for review.</h2>
                        <p>See what changed and clear the blockers before money moves.</p>
                      </div>
                    </div>

                    <div className="payroll-hero-alert">
                      <div className="payroll-hero-alert-icon" aria-hidden>
                        <AlertTriangle size={18} />
                      </div>
                      <div className="payroll-hero-alert-copy">
                        <strong>3 things need attention</strong>
                        <span>Resolve these before sending payroll for approval.</span>
                        <ul>
                          <li><i className="danger" /><span>2 employees are missing bank details</span></li>
                          <li><i className="warning" /><span>1 payroll exception needs review</span></li>
                          <li><i className="info" /><span>Checker approval is due</span></li>
                        </ul>
                      </div>
                      <button type="button" tabIndex={-1}>Review issues <ArrowRight size={10} aria-hidden /></button>
                    </div>

                    <div className="payroll-hero-metrics">
                      <article>
                        <span className="green"><WalletCards size={13} /></span>
                        <div><small>Payroll Status</small><strong>Ready for review</strong></div>
                      </article>
                      <article>
                        <span className="blue"><UsersRound size={13} /></span>
                        <div><small>Employees</small><strong>124</strong></div>
                      </article>
                      <article>
                        <span className="red"><AlertTriangle size={13} /></span>
                        <div><small>Exceptions</small><strong>3</strong></div>
                      </article>
                      <article>
                        <span className="blue"><ClipboardCheck size={13} /></span>
                        <div><small>For Approval</small><strong>1</strong></div>
                      </article>
                    </div>

                    <div className="payroll-hero-table">
                      <header>
                        <strong>Recent Payroll Runs</strong>
                        <span>View all</span>
                      </header>
                      <div className="payroll-hero-table-head">
                        <span>Period</span><span>Employees</span><span>Total Amount</span><span>Status</span>
                      </div>
                      {recentRuns.map((run) => (
                        <div className="payroll-hero-table-row" key={run.period}>
                          <strong>{run.period}</strong>
                          <span>124</span>
                          <span>{run.amount}</span>
                          <span className={run.status === "Released" ? "released" : "approval"}>{run.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="payroll-hero-laptop-base" aria-hidden>
                <span />
              </div>
            </div>

            <div className="payroll-home-orbit payroll-home-orbit-one" aria-hidden />
            <div className="payroll-home-orbit payroll-home-orbit-two" aria-hidden />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
