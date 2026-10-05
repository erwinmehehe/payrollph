
"use client";

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Calculator,
  Check,
  ChevronRight,
  Download,
  History,
  LockKeyhole,
  Menu,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

type Plan = {
  id: number;
  name: string;
  monthlyBase: string;
  perEmployee: string;
  modules: unknown;
  version: string;
  active?: boolean;
};

const workflowTabs = [
  {
    id: "run",
    label: "Run payroll",
    helper: "Inputs, calculations and cutoff totals",
  },
  {
    id: "resolve",
    label: "Resolve exceptions",
    helper: "Surface blockers before approval",
  },
  {
    id: "release",
    label: "Release & export",
    helper: "Maker-checker sign-off and outputs",
  },
] as const;

type WorkflowId = (typeof workflowTabs)[number]["id"];

function Brand() {
  return (
    <a className="linaw-brand" href="/" aria-label="Linaw home">
      <span className="linaw-mark"><Check aria-hidden="true" /></span>
      <span>Linaw</span>
    </a>
  );
}

function Navigation() {
  const [open, setOpen] = useState(false);
  const navLinks = [
    { label: "Live demo", href: "/demo" },
    { label: "Payroll outsourcing", href: "/payroll-outsourcing" },
    { label: "Trust", href: "/trust" },
    { label: "Pricing", href: "/pricing" },
  ];

  return (
    <header className="linaw-nav-wrap">
      <nav className="linaw-nav linaw-shell" aria-label="Primary">
        <Brand />
        <div className="linaw-nav-links">
          {navLinks.map((link) => <a href={link.href} key={link.href}>{link.label}</a>)}
        </div>
        <div className="linaw-nav-actions">
          <a className="linaw-nav-signin" href="/login">Sign in</a>
          <a className="linaw-nav-cta" href="/signup">
            Get started <ArrowRight size={13} aria-hidden="true" />
          </a>
          <button
            className="linaw-menu-button"
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={17} /> : <Menu size={17} />}
          </button>
        </div>
      </nav>
      {open ? (
        <div className="linaw-mobile-menu linaw-shell">
          {navLinks.map((link) => <a href={link.href} key={link.href} onClick={() => setOpen(false)}>{link.label}</a>)}
          <div>
            <a href="/login" onClick={() => setOpen(false)}>Sign in</a>
            <a className="linaw-nav-cta" href="/signup" onClick={() => setOpen(false)}>Get started <ArrowRight size={13} /></a>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function PayrollHeroPreview() {
  return (
    <div className="linaw-ui payroll-hero-control-card" aria-label="Payroll release readiness preview">
      <div className="linaw-ui-top">
        <div className="linaw-ui-title">
          <span className="linaw-window-dots" aria-hidden="true"><i /><i /><i /></span>
          <strong>Payroll control room</strong>
        </div>
        <span className="linaw-ui-state"><i /> 3 checks remaining</span>
      </div>
      <div className="linaw-ui-body">
        <div className="linaw-ui-meta">
          <div>
            <span className="linaw-ui-kicker">Current payroll</span>
            <h2>Can I safely release this payroll?</h2>\n            <p className="linaw-ui-period-copy">October 1–15, 2026</p>
          </div>
          <div className="linaw-ui-period">
            <span>Release window</span>
            <strong>Oct 15 · 5:00 PM</strong>
          </div>
        </div>

        <div className="linaw-stage-row" aria-label="Payroll stages">
          <span className="linaw-stage done">Inputs</span>
          <span className="linaw-stage done">Calculate</span>
          <span className="linaw-stage active">Resolve</span>
          <span className="linaw-stage">Review</span>
          <span className="linaw-stage">Release</span>
        </div>

        <div className="linaw-money">
          <article><span>Gross pay</span><strong>₱512,840</strong></article>
          <article><span>Deductions</span><strong>₱108,920</strong></article>
          <article><span>Net pay</span><strong>₱403,920</strong></article>
        </div>

        <div className="linaw-check-list">
          <div className="linaw-check">
            <span className="linaw-check-icon ok"><ShieldCheck aria-hidden="true" /></span>
            <span className="linaw-check-copy"><strong>Statutory calculations</strong><span>SSS, PhilHealth, Pag-IBIG and withholding</span></span>
            <span className="linaw-check-status ok">Verified</span>
          </div>
          <div className="linaw-check">
            <span className="linaw-check-icon warn"><AlertTriangle aria-hidden="true" /></span>
            <span className="linaw-check-copy"><strong>Employee payout readiness</strong><span>3 employee records need attention</span></span>
            <span className="linaw-check-status warn">Review</span>
          </div>
          <div className="linaw-check">
            <span className="linaw-check-icon ok"><LockKeyhole aria-hidden="true" /></span>
            <span className="linaw-check-copy"><strong>Maker-checker release</strong><span>Payroll officer prepares, checker approves</span></span>
            <span className="linaw-check-status ok">Enforced</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="linaw-hero" id="top">
      <div className="linaw-shell linaw-hero-grid">
        <div className="linaw-hero-copy">
          <span className="linaw-badge"><i /> <Sparkles size={12} /> Introducing release readiness</span>
          <h1>Philippine payroll you can <span>verify before you pay.</span></h1>
          <p>
            Linaw brings calculations, employee readiness, approvals and payroll outputs into one controlled workflow
            built for Philippine teams.
          </p>
          <div className="linaw-hero-actions">
            <a className="linaw-primary hero-primary-cta" href="/signup">Get started <ArrowRight size={15} /></a>
            <a className="linaw-secondary" href="/book-demo">Book demo</a>
          </div>
          <ul className="linaw-hero-proof payroll-home-trust">
            <li><Check /> Statutory calculation controls</li>
            <li><Check /> Maker-checker approvals</li>
            <li><Check /> Traceable payroll outputs</li>
          </ul>
        </div>
        <PayrollHeroPreview />
      </div>
    </section>
  );
}

function ProofStrip() {
  return (
    <section className="linaw-proof-strip" aria-label="Philippine payroll systems">
      <div className="linaw-shell linaw-proof-row">
        <p>Built around the systems Philippine payroll teams already reconcile every cutoff.</p>
        <span className="linaw-proof-logo">SSS</span>
        <span className="linaw-proof-logo">PhilHealth</span>
        <span className="linaw-proof-logo">Pag-IBIG</span>
        <span className="linaw-proof-logo">BIR</span>
      </div>
    </section>
  );
}

function StatutoryMiniUI() {
  return (
    <div className="mini-ui">
      <div className="mini-toolbar"><span>Calculation review</span><span>Cutoff · Oct 1–15</span></div>
      <div className="mini-row"><strong>SSS + MPF</strong><span>₱18,950</span><span className="mini-pill green">Matched</span></div>
      <div className="mini-row"><strong>PhilHealth</strong><span>₱10,250</span><span className="mini-pill green">Matched</span></div>
      <div className="mini-row"><strong>Pag-IBIG</strong><span>₱4,800</span><span className="mini-pill green">Matched</span></div>
      <div className="mini-row"><strong>Withholding tax</strong><span>₱31,420</span><span className="mini-pill violet">Explained</span></div>
    </div>
  );
}

function ApprovalMiniUI() {
  return (
    <div className="mini-ui">
      <div className="mini-toolbar"><span>Release workflow</span><span>3 of 5 complete</span></div>
      <div className="mini-board">
        <div className="mini-column"><span>Prepared</span><div className="mini-task">Payroll Officer<br /><small>Calculations locked</small></div></div>
        <div className="mini-column"><span>Review</span><div className="mini-task">Checker<br /><small>3 exceptions open</small></div></div>
        <div className="mini-column"><span>Release</span><div className="mini-task">Owner<br /><small>Waiting on review</small></div></div>
      </div>
    </div>
  );
}

function PeopleMiniUI() {
  return (
    <div className="mini-ui">
      <div className="mini-toolbar"><span>Employee readiness</span><Search size={11} /></div>
      <div className="mini-row"><strong>A. Santos</strong><span>Payout ready</span><span className="mini-pill green">Ready</span></div>
      <div className="mini-row"><strong>M. Reyes</strong><span>Missing ID</span><span className="mini-pill amber">Review</span></div>
      <div className="mini-row"><strong>J. Cruz</strong><span>Payout ready</span><span className="mini-pill green">Ready</span></div>
      <div className="mini-row"><strong>L. Garcia</strong><span>Bank update</span><span className="mini-pill violet">Updated</span></div>
    </div>
  );
}

function AuditMiniUI() {
  return (
    <div className="mini-ui">
      <div className="mini-toolbar"><span>Activity trail</span><span>Live</span></div>
      <div className="mini-feed">
        <div className="mini-event"><span className="mini-event-icon"><Calculator /></span><div><strong>Payroll recalculated</strong><span>Payroll Officer · Oct 5 cutoff</span></div><time>2m</time></div>
        <div className="mini-event"><span className="mini-event-icon"><BadgeCheck /></span><div><strong>Attendance exception resolved</strong><span>HR Admin · A. Santos</span></div><time>12m</time></div>
        <div className="mini-event"><span className="mini-event-icon"><History /></span><div><strong>Checker review requested</strong><span>Release controls updated</span></div><time>18m</time></div>
      </div>
    </div>
  );
}

function ExportMiniUI() {
  return (
    <div className="mini-ui">
      <div className="mini-toolbar"><span>Payroll outputs</span><Download size={11} /></div>
      <div className="mini-stat-grid">
        <div className="mini-stat"><span>Bank file</span><strong>128</strong><small>employees ready</small></div>
        <div className="mini-stat"><span>Payslips</span><strong>128</strong><small>generated</small></div>
        <div className="mini-stat"><span>GL export</span><strong>Ready</strong><small>balanced</small></div>
        <div className="mini-stat"><span>Gov worksheets</span><strong>4</strong><small>draft outputs</small></div>
      </div>
    </div>
  );
}

function FeatureBento() {
  return (
    <section className="linaw-section" id="platform">
      <div className="linaw-shell">
        <div className="linaw-section-head">
          <div>
            <span className="linaw-section-kicker">One payroll control layer</span>
            <h2>Every critical payroll decision has a visible state.</h2>
          </div>
          <p>
            Instead of hiding payroll inside forms and spreadsheets, Linaw makes calculations, blockers, owners and
            release decisions inspectable before funds move.
          </p>
        </div>

        <div className="linaw-bento">
          <article className="linaw-card span-7">
            <span className="linaw-card-label">Compliance engine</span>
            <h3>See how statutory calculations resolve.</h3>
            <p>Review contribution and withholding results in the same place as the payroll run.</p>
            <StatutoryMiniUI />
          </article>

          <article className="linaw-card span-5">
            <span className="linaw-card-label">Maker-checker controls</span>
            <h3>Separate preparation from approval.</h3>
            <p>Make the handoff obvious and keep release authority out of the operator flow.</p>
            <ApprovalMiniUI />
          </article>

          <article className="linaw-card span-4">
            <span className="linaw-card-label">People readiness</span>
            <h3>Find employee blockers early.</h3>
            <p>Missing payroll details should surface before calculation day.</p>
            <PeopleMiniUI />
          </article>

          <article className="linaw-card span-4">
            <span className="linaw-card-label">Auditability</span>
            <h3>Know who changed what.</h3>
            <p>Keep a readable event trail across the payroll workflow.</p>
            <AuditMiniUI />
          </article>

          <article className="linaw-card span-4">
            <span className="linaw-card-label">Controlled outputs</span>
            <h3>Release the files each role actually needs.</h3>
            <p>Move from reviewed payroll to payslips, bank and accounting outputs.</p>
            <ExportMiniUI />
          </article>
        </div>
      </div>
    </section>
  );
}

function WorkflowPreview({ active }: { active: WorkflowId }) {
  if (active === "resolve") {
    return (
      <div className="linaw-preview-canvas">
        <div className="linaw-preview-summary">
          <article><span>Hard blockers</span><strong>3</strong></article>
          <article><span>Needs review</span><strong>5</strong></article>
          <article><span>Resolved today</span><strong>11</strong></article>
        </div>
        <div className="linaw-preview-table">
          <div className="linaw-preview-row"><strong>Maria Reyes</strong><span>Government ID</span><span>HR Admin</span><span className="mini-pill amber">Blocker</span></div>
          <div className="linaw-preview-row"><strong>Jose Cruz</strong><span>Attendance</span><span>Payroll</span><span className="mini-pill violet">Review</span></div>
          <div className="linaw-preview-row"><strong>Liza Garcia</strong><span>Payout detail</span><span>HR Admin</span><span className="mini-pill green">Resolved</span></div>
          <div className="linaw-preview-row"><strong>Anna Santos</strong><span>Loan balance</span><span>Payroll</span><span className="mini-pill violet">Review</span></div>
        </div>
        <div className="linaw-preview-notice"><AlertTriangle /> Release stays blocked until hard blockers are resolved or explicitly handled by the authorized role.</div>
      </div>
    );
  }

  if (active === "release") {
    return (
      <div className="linaw-preview-canvas">
        <div className="linaw-preview-summary">
          <article><span>Net payroll</span><strong>₱403,920</strong></article>
          <article><span>Employees</span><strong>128</strong></article>
          <article><span>Checks passed</span><strong>18 / 18</strong></article>
        </div>
        <div className="linaw-preview-table">
          <div className="linaw-preview-row"><strong>Checker review</strong><span>Approved</span><span>2:42 PM</span><span className="mini-pill green">Passed</span></div>
          <div className="linaw-preview-row"><strong>Owner release</strong><span>Approved</span><span>2:48 PM</span><span className="mini-pill green">Passed</span></div>
          <div className="linaw-preview-row"><strong>Bank export</strong><span>Generated</span><span>2:49 PM</span><span className="mini-pill green">Ready</span></div>
          <div className="linaw-preview-row"><strong>Payslips</strong><span>Generated</span><span>2:50 PM</span><span className="mini-pill green">Ready</span></div>
        </div>
        <div className="linaw-preview-notice"><LockKeyhole /> Release evidence stays attached to the payroll run so later review does not depend on chat threads or spreadsheets.</div>
      </div>
    );
  }

  return (
    <div className="linaw-preview-canvas">
      <div className="linaw-preview-summary">
        <article><span>Gross pay</span><strong>₱512,840</strong></article>
        <article><span>Deductions</span><strong>₱108,920</strong></article>
        <article><span>Net pay</span><strong>₱403,920</strong></article>
      </div>
      <div className="linaw-preview-table">
        <div className="linaw-preview-row"><strong>Regular payroll</strong><span>128 employees</span><span>Calculated</span><span className="mini-pill green">Ready</span></div>
        <div className="linaw-preview-row"><strong>Attendance</strong><span>2 exceptions</span><span>Imported</span><span className="mini-pill amber">Review</span></div>
        <div className="linaw-preview-row"><strong>Supplementary pay</strong><span>8 entries</span><span>Included</span><span className="mini-pill violet">Checked</span></div>
        <div className="linaw-preview-row"><strong>Loans & deductions</strong><span>14 entries</span><span>Included</span><span className="mini-pill violet">Checked</span></div>
      </div>
      <div className="linaw-preview-notice"><Activity /> Recalculate after an input changes and keep the resulting payroll state visible to the next reviewer.</div>
    </div>
  );
}

function Workflow() {
  const [active, setActive] = useState<WorkflowId>("run");
  const activeTab = workflowTabs.find((tab) => tab.id === active) ?? workflowTabs[0];

  return (
    <section className="linaw-section linaw-workflow" id="workflow">
      <div className="linaw-shell linaw-workflow-layout">
        <div>
          <span className="linaw-section-kicker">Workflow, not a dashboard maze</span>
          <h2 style={{ margin: "10px 0 0", fontSize: "clamp(34px,4vw,52px)", lineHeight: 1.03, letterSpacing: "-.05em", fontWeight: 690 }}>
            Move from inputs to release without losing the decision trail.
          </h2>
          <div className="linaw-tabs" role="tablist" aria-label="Payroll workflows">
            {workflowTabs.map((tab, index) => (
              <button
                key={tab.id}
                type="button"
                className={"linaw-tab " + (active === tab.id ? "active" : "")}
                onClick={() => setActive(tab.id)}
                role="tab"
                aria-selected={active === tab.id}
              >
                <span className="linaw-tab-index">0{index + 1}</span>
                <span><strong>{tab.label}</strong><span>{tab.helper}</span></span>
                <ChevronRight />
              </button>
            ))}
          </div>
        </div>
        <div className="linaw-workflow-preview" role="tabpanel" aria-label={activeTab.label}>
          <div className="linaw-preview-header">
            <div><strong>{activeTab.label}</strong><br /><span>October 1–15 payroll</span></div>
            <span className="mini-pill violet">Live workflow preview</span>
          </div>
          <WorkflowPreview active={active} />
        </div>
      </div>
    </section>
  );
}

function ProofAndRoles() {
  return (
    <section className="linaw-section">
      <div className="linaw-shell">
        <div className="linaw-section-head">
          <div>
            <span className="linaw-section-kicker">Designed for operational clarity</span>
            <h2>One release chain. Different responsibilities.</h2>
          </div>
          <p>Linaw keeps each role focused on the decision it owns instead of giving everyone the same overloaded dashboard.</p>
        </div>

        <div className="linaw-proof-metrics">
          <div className="linaw-metric"><strong>5</strong><span>role-aware workspaces across payroll preparation, review and administration</span></div>
          <div className="linaw-metric"><strong>1</strong><span>controlled release chain from payroll inputs through approval and outputs</span></div>
          <div className="linaw-metric"><strong>100%</strong><span>of release decisions designed to stay attributable in the audit trail</span></div>
        </div>

        <div className="linaw-role-quotes">
          <article className="linaw-quote">
            <p>“Show me what blocks this payroll, who owns it, and whether I can safely move it forward.”</p>
            <div className="linaw-quote-footer"><span className="linaw-avatar">PO</span><span><strong>Payroll Officer</strong><span>Preparation view</span></span></div>
          </article>
          <article className="linaw-quote">
            <p>“Give me the exceptions and evidence. I should not have to repeat the operator’s work to review the run.”</p>
            <div className="linaw-quote-footer"><span className="linaw-avatar">CK</span><span><strong>Checker</strong><span>Review view</span></span></div>
          </article>
          <article className="linaw-quote">
            <p>“I need confidence that the payroll is releasable, not another screen full of operational detail.”</p>
            <div className="linaw-quote-footer"><span className="linaw-avatar">OW</span><span><strong>Owner</strong><span>Release view</span></span></div>
          </article>
        </div>
      </div>
    </section>
  );
}

function currencyNumber(value: string) {
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function Pricing({ plans }: { plans: Plan[] }) {
  const [headcount, setHeadcount] = useState(25);
  const visible = plans.filter((plan) => plan.active !== false).slice(0, 3);
  if (!visible.length) return null;

  return (
    <section className="linaw-section" id="pricing">
      <div className="linaw-shell">
        <div className="linaw-section-head">
          <div>
            <span className="linaw-section-kicker">Simple starting point</span>
            <h2>Choose the operating model that fits your payroll team.</h2>
          </div>
          <p>Pricing values come from the live plan catalog. Start with software, then expand only when the workflow requires it.</p>
        </div>
        <div className="linaw-pricing-controls" aria-label="Pricing employee count">
          <span>{headcount} employees</span>
          <div>
            {[25, 50, 100].map((count) => (
              <button
                type="button"
                data-headcount={count}
                className={headcount === count ? "active" : ""}
                onClick={() => setHeadcount(count)}
                key={count}
              >
                {count}
              </button>
            ))}
          </div>
        </div>
        <div className="linaw-pricing-compact">
          {visible.map((plan, index) => {
            const base = currencyNumber(plan.monthlyBase);
            const perEmployee = currencyNumber(plan.perEmployee);
            const estimated = base !== null && perEmployee !== null
              ? new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(base + perEmployee * headcount)
              : plan.monthlyBase;
            return (
              <article className={"linaw-price-card pricing-plan-card " + (index === 1 ? "featured" : "")} key={plan.id}>
                <h3>{plan.name}</h3>
                <div className="linaw-price pricing-amount">{estimated}<small>/ estimated month</small></div>
                <p>{plan.monthlyBase} base + {plan.perEmployee} per employee. Final inclusions follow the current plan configuration.</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="linaw-final">
      <div className="linaw-shell">
        <div className="linaw-final-card">
          <div>
            <h2>Make the next payroll easier to verify than the last.</h2>
            <p>See Linaw using a role-based demo, or start setting up a controlled Philippine payroll workspace.</p>
          </div>
          <div className="linaw-final-actions">
            <a className="linaw-primary" href="/signup">Get started <ArrowRight size={15} /></a>
            <a className="linaw-secondary" href="/demo">Try live demo</a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="linaw-footer">
      <div className="linaw-shell">
        <div className="linaw-footer-grid">
          <div className="linaw-footer-copy">
            <Brand />
            <p>Philippine payroll software for controlled calculations, approvals, employee readiness and payroll outputs.</p>
          </div>
          <div className="linaw-footer-col"><strong>Product</strong><a href="/demo">Live demo</a><a href="#pricing">Pricing</a><a href="/payroll-outsourcing">Payroll outsourcing</a></div>
          <div className="linaw-footer-col"><strong>Company</strong><a href="/about">About</a><a href="/contact">Contact</a><a href="/status">Status</a></div>
          <div className="linaw-footer-col"><strong>Resources</strong><a href="/resources">Resources</a><a href="/calculators">Calculators</a><a href="/security">Security</a></div>
        </div>
        <div className="linaw-footer-bottom">
          <span>© 2026 Linaw. Built for Philippine payroll operations.</span>
          <span>Controlled payroll · Role-based access · Audit-ready workflow</span>
        </div>
      </div>
    </footer>
  );
}

export default function ModernHome({ plans }: { plans: Plan[] }) {
  return (
    <div className="linaw-landing">
      <Navigation />
      <main id="main">
        <Hero />
        <ProofStrip />
        <FeatureBento />
        <Workflow />
        <ProofAndRoles />
        <Pricing plans={plans} />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
