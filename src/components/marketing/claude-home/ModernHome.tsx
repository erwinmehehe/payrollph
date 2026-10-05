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
        <div className="product-sidebar-brand">
          <span className="sidebar-mark"><Check /></span>
          <strong>Linaw</strong>
        </div>
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
      <div className="linaw-shell">
        <div className="hero-copy">
          <span className="hero-kicker">Payroll software for Philippine teams</span>
          <h1>Payroll, <em>clearly.</em></h1>
          <p>
            Know what changed. Know what is blocked. Know who approved the release.
            Linaw gives every payroll run a clear state before money moves.
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
        <p>Built around Philippine payroll operations.</p>
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

function ChangesVisual() {
  return (
    <div className="apple-product-panel">
      <div className="panel-browser-bar"><i /><i /><i /><span>Calculation comparison</span></div>
      <div className="comparison-summary">
        <div><span>Net payroll</span><strong>₱403,920</strong><small>+₱7,430</small></div>
        <div><span>Employees changed</span><strong>12</strong><small>of 128</small></div>
        <div><span>New exceptions</span><strong>2</strong><small>needs review</small></div>
      </div>
      <div className="apple-table">
        <div className="apple-table-row head"><span>Employee</span><span>Change</span><span>Impact</span></div>
        <div className="apple-table-row"><strong>Anna Santos</strong><span>Overtime +4.0h</span><b>+₱1,840</b></div>
        <div className="apple-table-row"><strong>Jose Cruz</strong><span>Attendance correction</span><b>+₱920</b></div>
        <div className="apple-table-row"><strong>Maria Reyes</strong><span>Loan deduction updated</span><b className="negative">−₱1,200</b></div>
      </div>
    </div>
  );
}

function BlockerVisual() {
  return (
    <div className="apple-product-panel blocker-panel">
      <div className="panel-browser-bar"><i /><i /><i /><span>Release safety</span></div>
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
    </div>
  );
}

function ApprovalVisual() {
  return (
    <div className="apple-product-panel approval-panel">
      <div className="panel-browser-bar"><i /><i /><i /><span>Release evidence</span></div>
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
        Every approval stays attached to the payroll run with the user, timestamp and resulting state.
      </div>
    </div>
  );
}

function ProductFocus() {
  return (
    <section className="product-focus" id="product">
      <div className="apple-story apple-story-white">
        <div className="linaw-shell">
          <div className="apple-story-copy centered">
            <span>SEE WHAT CHANGED</span>
            <h2>Every movement. <em>Explained.</em></h2>
            <p>Compare the current calculation with the previous state and see exactly which people, earnings and deductions moved.</p>
          </div>
          <div className="apple-story-visual wide"><ChangesVisual /></div>
        </div>
      </div>

      <div className="apple-story apple-story-soft">
        <div className="linaw-shell apple-split">
          <div className="apple-story-copy">
            <span>BLOCK UNSAFE RELEASES</span>
            <h2>Not ready means <em>not releasable.</em></h2>
            <p>Hard blockers stay visible, name the affected employee, assign an owner and prevent the workflow from pretending payroll is ready.</p>
          </div>
          <div className="apple-story-visual"><BlockerVisual /></div>
        </div>
      </div>

      <div className="apple-story apple-story-white">
        <div className="linaw-shell">
          <div className="apple-story-copy centered">
            <span>LEAVE A DECISION TRAIL</span>
            <h2>Approval you can <em>prove later.</em></h2>
            <p>Preparation, checking and release remain separate decisions, each with a user, timestamp and resulting payroll state.</p>
          </div>
          <div className="apple-story-visual wide"><ApprovalVisual /></div>
        </div>
      </div>
    </section>
  );
}

function Workflow() {
  const steps = [
    ["01", "Prepare"],
    ["02", "Calculate"],
    ["03", "Resolve"],
    ["04", "Review"],
    ["05", "Release"],
  ];

  return (
    <section className="workflow-section" id="workflow">
      <div className="linaw-shell">
        <div className="workflow-heading">
          <span>ONE CONTROLLED FLOW</span>
          <h2>From inputs to release, without losing the thread.</h2>
          <p>Each stage has one job. The next stage stays locked until the current decision is complete.</p>
        </div>

        <div className="workflow-rail">
          {steps.map(([number, label], index) => (
            <div className={"workflow-stage " + (index < 2 ? "done" : index === 2 ? "current" : "")} key={number}>
              <i>{index < 2 ? <Check /> : number}</i>
              <span>{label}</span>
            </div>
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
          <h2>Everything else, without the sales pitch.</h2>
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
          <h2>Try the payroll flow yourself.</h2>
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
