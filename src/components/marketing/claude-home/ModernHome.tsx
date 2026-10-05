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

type Plan = {
  id: number;
  name: string;
  monthlyBase: string;
  perEmployee: string;
  modules: unknown;
  version: string;
  active?: boolean;
};

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

            <div className="blocker-row">
              <span className="blocker-icon"><AlertTriangle /></span>
              <div><strong>Maria Reyes</strong><span>Government ID incomplete</span></div>
              <span className="owner-tag">HR Admin</span>
            </div>
            <div className="blocker-row">
              <span className="blocker-icon"><AlertTriangle /></span>
              <div><strong>Jose Cruz</strong><span>Attendance exception unresolved</span></div>
              <span className="owner-tag">Payroll</span>
            </div>
            <div className="blocker-row">
              <span className="blocker-icon"><AlertTriangle /></span>
              <div><strong>Anna Santos</strong><span>Payout account needs review</span></div>
              <span className="owner-tag">HR Admin</span>
            </div>
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
        <p>Built for the Philippine payroll reality, not adapted from a generic global HR tool.</p>
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

function ChangeStoryVisual() {
  return (
    <div className="story-visual change-visual">
      <div className="visual-toolbar">
        <span>Calculation changes</span>
        <span>Compared with previous calculation</span>
      </div>
      <div className="change-summary">
        <div><span>Net pay</span><strong>₱403,920</strong><small>+₱7,430</small></div>
        <div><span>Employees changed</span><strong>12</strong><small>of 128</small></div>
        <div><span>New exceptions</span><strong>2</strong><small>needs review</small></div>
      </div>
      <div className="change-table">
        <div className="table-row table-head"><span>Employee</span><span>Change</span><span>Impact</span></div>
        <div className="table-row"><strong>Anna Santos</strong><span>Overtime +4.0h</span><b>+₱1,840</b></div>
        <div className="table-row"><strong>Jose Cruz</strong><span>Attendance correction</span><b>+₱920</b></div>
        <div className="table-row"><strong>Maria Reyes</strong><span>Loan deduction updated</span><b className="negative">−₱1,200</b></div>
      </div>
    </div>
  );
}

function BlockerStoryVisual() {
  return (
    <div className="story-visual blocker-visual">
      <div className="visual-toolbar">
        <span>Release blockers</span>
        <span>3 open</span>
      </div>
      <div className="large-blocker">
        <span className="large-blocker-icon"><AlertTriangle /></span>
        <div>
          <span>HARD BLOCKER</span>
          <strong>Government ID is incomplete</strong>
          <p>Maria Reyes cannot be included in the release until HR completes the required identifier.</p>
        </div>
      </div>
      <div className="blocker-actions">
        <div><span>Owner</span><strong>HR Admin</strong></div>
        <div><span>Employee</span><strong>Maria Reyes</strong></div>
        <a href="/demo">Open issue <ArrowRight size={14} /></a>
      </div>
    </div>
  );
}

function ApprovalStoryVisual() {
  return (
    <div className="story-visual approval-visual">
      <div className="visual-toolbar">
        <span>Release evidence</span>
        <span>Audit trail</span>
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
      <div className="approval-note">
        Every approval remains attached to the payroll run with the user, timestamp and resulting state.
      </div>
    </div>
  );
}

const stories = [
  {
    number: "01",
    eyebrow: "See what changed",
    title: "Stop recalculating blind.",
    copy: "When payroll inputs change, Linaw shows the effect on the run instead of asking your team to remember what moved inside a spreadsheet.",
    visual: <ChangeStoryVisual />,
  },
  {
    number: "02",
    eyebrow: "Block unsafe releases",
    title: "A warning should actually stop the workflow.",
    copy: "Hard blockers stay visible, have an owner, and prevent release. The interface does not pretend payroll is ready just because calculation finished.",
    visual: <BlockerStoryVisual />,
  },
  {
    number: "03",
    eyebrow: "Keep the decision trail",
    title: "Approval should leave evidence.",
    copy: "Preparation, review and release remain separate actions with attributable timestamps, so the next audit does not depend on chat messages.",
    visual: <ApprovalStoryVisual />,
  },
];

function ProductStories() {
  return (
    <section className="product-stories" id="product">
      <div className="linaw-shell">
        <div className="stories-intro">
          <span>THE PRODUCT</span>
          <h2>Three answers before every payroll release.</h2>
        </div>

        <div className="story-list">
          {stories.map((story, index) => (
            <article className={"story-row " + (index % 2 ? "reverse" : "")} key={story.number}>
              <div className="story-copy">
                <span className="story-number">{story.number}</span>
                <span className="story-eyebrow">{story.eyebrow}</span>
                <h3>{story.title}</h3>
                <p>{story.copy}</p>
              </div>
              {story.visual}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Workflow() {
  const steps = [
    ["01", "Prepare", "Bring attendance, earnings, deductions and employee changes into the run."],
    ["02", "Calculate", "Apply payroll logic and statutory calculations to the current cutoff."],
    ["03", "Resolve", "Assign and clear blockers before anyone can approve the payroll."],
    ["04", "Review", "Checker reviews the result without repeating the operator's work."],
    ["05", "Release", "Owner releases bank, payslip and accounting outputs with evidence attached."],
  ];

  return (
    <section className="workflow-section" id="workflow">
      <div className="linaw-shell">
        <div className="workflow-heading">
          <span>ONE CONTROLLED FLOW</span>
          <h2>From raw inputs to releasable payroll.</h2>
          <p>Each stage has a clear purpose. The product moves the team forward only when the previous decision is complete.</p>
        </div>

        <div className="workflow-rail">
          {steps.map(([number, title, copy]) => (
            <article key={number}>
              <span>{number}</span>
              <strong>{title}</strong>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function RoleProof() {
  return (
    <section className="role-section">
      <div className="linaw-shell">
        <div className="role-heading">
          <span>ROLE-AWARE</span>
          <h2>Everyone sees the decision they own.</h2>
        </div>
        <div className="role-grid">
          <article><strong>HR Admin</strong><p>Employee readiness, identifiers, payout details and attendance exceptions.</p></article>
          <article><strong>Payroll Officer</strong><p>Inputs, calculations, deductions and resolution of payroll issues.</p></article>
          <article><strong>Checker</strong><p>Exceptions, evidence and independent review before release.</p></article>
          <article><strong>Owner</strong><p>One clear answer: is this payroll safe to release?</p></article>
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
          {HOMEPAGE_FAQS.slice(0, 5).map((item, index) => (
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
          <span>SEE IT WITH A REAL PAYROLL FLOW</span>
          <h2>Try Linaw before you trust it with payroll.</h2>
        </div>
        <div className="final-actions">
          <a className="primary-cta" href="/demo">Try the live demo <ArrowRight size={16} /></a>
          <a className="text-cta" href="/book-demo">Book a walkthrough <ChevronRight size={15} /></a>
        </div>
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

export default function ModernHome({ plans: _plans }: { plans: Plan[] }) {
  return (
    <div className="linaw-landing">
      <Navigation />
      <main id="main">
        <Hero />
        <StatutoryStrip />
        <ProductStories />
        <Workflow />
        <RoleProof />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
