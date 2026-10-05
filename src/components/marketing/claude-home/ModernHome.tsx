"use client";

import { useState } from "react";
import { HOMEPAGE_FAQS } from "../homepage-faqs";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  FileCheck2,
  LockKeyhole,
  Menu,
  ShieldCheck,
  X,
} from "lucide-react";

type FocusId = "changes" | "blockers" | "approvals";

const focusTabs: Array<{ id: FocusId; label: string; title: string; copy: string }> = [
  {
    id: "changes",
    label: "What changed?",
    title: "See the movement, not just the new total.",
    copy: "Linaw compares the current calculation with the previous state so payroll teams can see which employees, earnings and deductions moved.",
  },
  {
    id: "blockers",
    label: "What blocks release?",
    title: "Warnings become owned work, not background noise.",
    copy: "Hard blockers stay visible, name the affected employee, and assign the next action before release can continue.",
  },
  {
    id: "approvals",
    label: "Who approved it?",
    title: "Every release leaves a decision trail.",
    copy: "Preparation, checking and final release remain separate actions with a user, timestamp and resulting payroll state.",
  },
];

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
  const links = [
    { label: "Product", href: "#product" },
    { label: "Workflow", href: "#workflow" },
    { label: "Security", href: "/trust" },
    { label: "Pricing", href: "/pricing" },
  ];

  return (
    <header className="linaw-nav-wrap">
      <nav className="linaw-nav linaw-shell" aria-label="Primary">
        <Brand />
        <div className="linaw-nav-links">
          {links.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
        </div>
        <div className="linaw-nav-actions">
          <a className="linaw-nav-signin" href="/login">Sign in</a>
          <a className="linaw-nav-cta" href="/demo">Try the demo</a>
          <button
            className="linaw-menu-button"
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </nav>

      {open ? (
        <div className="linaw-mobile-menu linaw-shell">
          {links.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</a>
          ))}
          <div>
            <a href="/login" onClick={() => setOpen(false)}>Sign in</a>
            <a className="linaw-nav-cta" href="/demo" onClick={() => setOpen(false)}>Try the demo</a>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function ProductWindow() {
  return (
    <div className="product-window" aria-label="Linaw payroll release workspace preview">
      <aside className="product-sidebar">
        <div className="product-sidebar-brand"><span className="sidebar-mark"><Check /></span><strong>Linaw</strong></div>
        <nav aria-label="Preview navigation">
          <span>Overview</span>
          <span className="active">Payroll runs</span>
          <span>People</span>
          <span>Attendance</span>
          <span>Compliance</span>
          <span>Reports</span>
        </nav>
        <div className="product-sidebar-foot">
          <span>October payroll</span>
          <strong>Oct 1–15</strong>
        </div>
      </aside>

      <div className="product-main">
        <div className="product-topbar">
          <div>
            <span className="product-eyebrow">PAYROLL RUN · OCT 1–15</span>
            <h2>Release readiness</h2>
          </div>
          <span className="blocked-pill"><i /> Blocked</span>
        </div>

        <div className="release-summary">
          <div className="release-copy">
            <span className="summary-label">NET PAYROLL</span>
            <strong>₱403,920</strong>
            <p>128 employees · 3 blockers before release</p>
          </div>
          <div className="release-progress" aria-label="Payroll workflow">
            <div className="done"><i><Check /></i><span>Inputs</span></div>
            <div className="done"><i><Check /></i><span>Calculate</span></div>
            <div className="current"><i>3</i><span>Resolve</span></div>
            <div><i>4</i><span>Review</span></div>
            <div><i>5</i><span>Release</span></div>
          </div>
        </div>

        <div className="release-grid">
          <section className="release-blockers">
            <div className="panel-head">
              <div>
                <span>WHAT NEEDS ATTENTION</span>
                <strong>3 blockers</strong>
              </div>
              <a href="#workflow">View all</a>
            </div>

            {[
              ["Maria Reyes", "Government ID incomplete", "HR Admin"],
              ["Jose Cruz", "Attendance exception unresolved", "Payroll"],
              ["Anna Santos", "Payout account needs review", "HR Admin"],
            ].map(([name, issue, owner]) => (
              <div className="blocker-row" key={name}>
                <span className="blocker-icon"><AlertTriangle /></span>
                <div><strong>{name}</strong><span>{issue}</span></div>
                <span className="owner-tag">{owner}</span>
              </div>
            ))}
          </section>

          <aside className="release-checks">
            <span className="panel-kicker">CONTROLS</span>
            <div className="control-row ok"><ShieldCheck /><span><strong>Statutory calculations</strong><small>Verified</small></span></div>
            <div className="control-row ok"><LockKeyhole /><span><strong>Maker-checker</strong><small>Enforced</small></span></div>
            <div className="control-row"><FileCheck2 /><span><strong>Release evidence</strong><small>Waiting</small></span></div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="hero">
      <div className="linaw-shell hero-grid">
        <div className="hero-copy">
          <span className="hero-kicker">Payroll software for Philippine teams</span>
          <h1>Payroll should tell you <em>when not to pay.</em></h1>
          <p>
            Linaw shows what changed, what is blocked, who owns the fix, and who approved the final release.
            No green checkmark until the payroll is actually ready.
          </p>
          <div className="hero-actions">
            <a className="primary-cta" href="/demo">Try the live demo <ArrowRight size={16} /></a>
            <a className="text-cta" href="/book-demo">Book a walkthrough <ChevronRight size={15} /></a>
          </div>
        </div>

        <div className="hero-product">
          <ProductWindow />
        </div>
      </div>
    </section>
  );
}

function StatutoryStrip() {
  return (
    <section className="statutory-strip">
      <div className="linaw-shell statutory-inner">
        <p>Built for Philippine payroll operations, not adapted from a generic global HR workflow.</p>
        <div className="statutory-marks" aria-label="Philippine statutory systems">
          <span>SSS</span>
          <span>PhilHealth</span>
          <span>Pag-IBIG</span>
          <span>BIR</span>
        </div>
      </div>
    </section>
  );
}

function ChangesView() {
  return (
    <div className="focus-surface">
      <div className="surface-top">
        <div><span>CALCULATION COMPARISON</span><strong>What moved since the last calculation?</strong></div>
        <span className="surface-state neutral">12 employees changed</span>
      </div>
      <div className="change-metrics">
        <div><span>Net payroll</span><strong>₱403,920</strong><small>+₱7,430</small></div>
        <div><span>Gross pay</span><strong>₱512,840</strong><small>+₱9,310</small></div>
        <div><span>Deductions</span><strong>₱108,920</strong><small>+₱1,880</small></div>
      </div>
      <div className="focus-table">
        <div className="focus-row focus-head"><span>Employee</span><span>Change</span><span>Impact</span></div>
        <div className="focus-row"><strong>Anna Santos</strong><span>Overtime +4.0h</span><b>+₱1,840</b></div>
        <div className="focus-row"><strong>Jose Cruz</strong><span>Attendance correction</span><b>+₱920</b></div>
        <div className="focus-row"><strong>Maria Reyes</strong><span>Loan deduction updated</span><b className="negative">−₱1,200</b></div>
      </div>
    </div>
  );
}

function BlockersView() {
  return (
    <div className="focus-surface">
      <div className="surface-top">
        <div><span>RELEASE SAFETY</span><strong>Hard blockers</strong></div>
        <span className="surface-state warning">3 open</span>
      </div>
      <div className="blocker-feature">
        <span className="blocker-feature-icon"><AlertTriangle /></span>
        <div>
          <span>HARD BLOCKER</span>
          <strong>Government ID is incomplete</strong>
          <p>Maria Reyes cannot be included in the release until HR completes the required identifier.</p>
        </div>
      </div>
      <div className="blocker-meta">
        <div><span>Owner</span><strong>HR Admin</strong></div>
        <div><span>Employee</span><strong>Maria Reyes</strong></div>
        <div><span>Release state</span><strong className="warning-text">Blocked</strong></div>
      </div>
      <div className="blocker-queue">
        <div><strong>Jose Cruz</strong><span>Attendance exception</span><b>Payroll</b></div>
        <div><strong>Anna Santos</strong><span>Payout account review</span><b>HR Admin</b></div>
      </div>
    </div>
  );
}

function ApprovalsView() {
  return (
    <div className="focus-surface">
      <div className="surface-top">
        <div><span>RELEASE EVIDENCE</span><strong>Approval chain</strong></div>
        <span className="surface-state good">2 of 3 complete</span>
      </div>
      <div className="approval-chain">
        <div className="approval-step complete">
          <i><Check /></i>
          <span><strong>Payroll Officer</strong><small>Prepared · 2:31 PM</small></span>
        </div>
        <div className="approval-line" />
        <div className="approval-step complete">
          <i><Check /></i>
          <span><strong>Checker</strong><small>Approved · 2:42 PM</small></span>
        </div>
        <div className="approval-line" />
        <div className="approval-step current">
          <i>3</i>
          <span><strong>Owner</strong><small>Ready for release</small></span>
        </div>
      </div>
      <div className="evidence-note">
        Every decision stays attached to the payroll run with the user, timestamp and resulting state.
      </div>
    </div>
  );
}

function ProductFocus() {
  const [active, setActive] = useState<FocusId>("changes");
  const current = focusTabs.find((item) => item.id === active) ?? focusTabs[0];

  return (
    <section className="focus-section" id="product">
      <div className="linaw-shell">
        <div className="focus-heading">
          <span>THREE ANSWERS BEFORE RELEASE</span>
          <h2>Make payroll explain itself.</h2>
          <p>Linaw is designed around the questions a real payroll team needs answered before money leaves the business.</p>
        </div>

        <div className="focus-layout">
          <div className="focus-tabs" role="tablist" aria-label="Payroll control questions">
            {focusTabs.map((tab, index) => (
              <button
                key={tab.id}
                type="button"
                className={active === tab.id ? "active" : ""}
                role="tab"
                aria-selected={active === tab.id}
                onClick={() => setActive(tab.id)}
              >
                <span>0{index + 1}</span>
                <strong>{tab.label}</strong>
              </button>
            ))}
          </div>

          <div className="focus-copy">
            <span>{current.label}</span>
            <h3>{current.title}</h3>
            <p>{current.copy}</p>
          </div>

          <div className="focus-preview" role="tabpanel" aria-label={current.label}>
            {active === "changes" ? <ChangesView /> : null}
            {active === "blockers" ? <BlockersView /> : null}
            {active === "approvals" ? <ApprovalsView /> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function Workflow() {
  const steps = [
    ["01", "Prepare", "Attendance, earnings, deductions and employee changes enter the run."],
    ["02", "Calculate", "Payroll logic and statutory calculations resolve the cutoff."],
    ["03", "Resolve", "Owned blockers are cleared before approval can start."],
    ["04", "Review", "Checker verifies the run without repeating preparation work."],
    ["05", "Release", "Approved outputs are released with evidence attached."],
  ];

  return (
    <section className="workflow-section" id="workflow">
      <div className="linaw-shell">
        <div className="workflow-heading">
          <span>ONE CONTROLLED FLOW</span>
          <h2>Five stages. One clear release decision.</h2>
          <p>The workflow is designed to make unsafe transitions impossible to miss.</p>
        </div>

        <div className="workflow-rail" role="list">
          {steps.map(([number, title, copy], index) => (
            <article key={number} className={index === 2 ? "active" : ""} role="listitem">
              <span className="workflow-number">{number}</span>
              <strong>{title}</strong>
              <p>{copy}</p>
            </article>
          ))}
        </div>

        <div className="workflow-state">
          <div>
            <span>Current state</span>
            <strong>Resolve blockers</strong>
          </div>
          <p>3 hard blockers remain. Review and release stay locked until the owning roles resolve them.</p>
          <span className="workflow-lock"><LockKeyhole /> Release locked</span>
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  return (
    <section className="faq-section">
      <div className="linaw-shell faq-layout">
        <div className="faq-heading">
          <span>COMMON QUESTIONS</span>
          <h2>What buyers need to know before trusting payroll software.</h2>
          <a href="/pricing">See pricing <ArrowRight size={14} /></a>
        </div>

        <div className="faq-list">
          {HOMEPAGE_FAQS.slice(0, 4).map((item, index) => (
            <details key={item.q} open={index === 0}>
              <summary>{item.q}<ChevronRight /></summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="final-section">
      <div className="linaw-shell final-inner">
        <div>
          <span>SEE THE REAL WORKFLOW</span>
          <h2>Do not trust the homepage. Try the payroll flow.</h2>
          <p>Open the role-based demo and see how Linaw handles calculation changes, blockers, review and release.</p>
        </div>
        <a className="primary-cta final-primary" href="/demo">Try the live demo <ArrowRight size={16} /></a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="linaw-footer">
      <div className="linaw-shell">
        <div className="footer-main">
          <div>
            <Brand />
            <p>Philippine payroll software for controlled calculations, approvals and release.</p>
          </div>
          <div><strong>Product</strong><a href="/demo">Live demo</a><a href="/pricing">Pricing</a><a href="/payroll-outsourcing">Payroll outsourcing</a></div>
          <div><strong>Company</strong><a href="/about">About</a><a href="/contact">Contact</a><a href="/status">Status</a></div>
          <div><strong>Resources</strong><a href="/resources">Resources</a><a href="/calculators">Calculators</a><a href="/trust">Security</a></div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 Linaw</span>
          <span>Built for Philippine payroll operations</span>
        </div>
      </div>
    </footer>
  );
}

export default function ModernHome() {
  return (
    <div className="linaw-landing">
      <Navigation />
      <main id="main">
        <Hero />
        <StatutoryStrip />
        <ProductFocus />
        <Workflow />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
