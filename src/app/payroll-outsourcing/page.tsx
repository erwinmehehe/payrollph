import type { Metadata } from "next";
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  FileSpreadsheet,
  Gauge,
  MessageSquareText,
  ShieldCheck,
  Users,
} from "lucide-react";
import { PayrollQuoteForm } from "@/components/marketing/payroll-quote-form";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payroll Outsourcing Philippines | Managed Payroll Services | Linaw",
  description:
    "Payroll outsourcing for Philippine businesses. Linaw handles payroll processing, validation, statutory calculations, reports and payroll-cycle coordination while you retain approval authority.",
  alternates: { canonical: "/payroll-outsourcing" },
};

const PROCESS = [
  {
    title: "Send the payroll inputs",
    copy: "Your team provides the approved employee changes, attendance data and other inputs required for the cycle.",
  },
  {
    title: "We process and validate",
    copy: "The payroll team runs the cycle, checks the inputs and calculations, and identifies exceptions that need a decision.",
  },
  {
    title: "You review exceptions",
    copy: "Anything that needs business judgment comes back to your team instead of being guessed or silently changed.",
  },
  {
    title: "You approve the run",
    copy: "Approval authority stays with your business. The service prepares the run for review; your authorized approver decides when it is ready.",
  },
  {
    title: "You receive the payroll outputs",
    copy: "After approval, the cycle moves to the reports, payslips and supported payroll outputs required for your process.",
  },
];

export default function PayrollOutsourcingPage() {
  return (
    <div className="site outsourcing-page">
      <SiteNav />

      <section className="outsourcing-hero">
        <div className="site-shell outsourcing-hero-grid">
          <div>
            <p className="eyebrow">Managed payroll services Philippines</p>
            <h1>Payroll outsourcing for Philippine businesses. We process your payroll. You stay in control.</h1>
            <p className="outsourcing-lead">
              Hand off the repetitive payroll work without handing over approval. The payroll team handles processing,
              validation, statutory calculations, payroll reports and cycle coordination. Your authorized people review
              exceptions and approve the run.
            </p>

            <div className="outsourcing-actions">
              <a className="primary-button" href="#quote">
                Get a payroll quote <ArrowRight size={14} />
              </a>
              <a className="secondary-button" href="#quote">
                Book a consultation
              </a>
            </div>

            <div className="outsourcing-trust">
              <span><Check size={15} className="i-green" /> Approval stays with your team</span>
              <span><Check size={15} className="i-green" /> Exceptions are surfaced for review</span>
              <span><Check size={15} className="i-green" /> Service and software have separate conversion paths</span>
            </div>
          </div>

          <aside className="outsourcing-scope-card">
            <p className="eyebrow">What gets handed off</p>
            <h2>The payroll cycle work, not your authority.</h2>
            <div className="scope-list">
              <div><Gauge size={17} className="i-blue" /><span><strong>Processing</strong>Run the payroll cycle from the inputs you provide.</span></div>
              <div><ShieldCheck size={17} className="i-green" /><span><strong>Validation</strong>Check calculations and surface payroll exceptions before approval.</span></div>
              <div><FileSpreadsheet size={17} className="i-teal" /><span><strong>Outputs</strong>Prepare the payroll reports and supported output files for the approved cycle.</span></div>
              <div><MessageSquareText size={17} className="i-purple" /><span><strong>Coordination</strong>Keep the cycle moving when an exception or missing input needs your team.</span></div>
            </div>
          </aside>
        </div>
      </section>

      <section className="section" id="process">
        <div className="site-shell">
          <div className="section-head">
            <p className="eyebrow">How managed payroll works</p>
            <h2>A clear handoff at every payroll cutoff.</h2>
            <p>
              Outsourcing should remove repetitive work without making the payroll process opaque. Each cycle has a defined
              input, review and approval point.
            </p>
          </div>

          <div className="service-process-grid">
            {PROCESS.map((step, index) => (
              <article className="service-step" key={step.title}>
                <span className="service-step-number mono">{String(index + 1).padStart(2, "0")}</span>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="site-shell">
          <div className="section-head">
            <p className="eyebrow">Division of responsibility</p>
            <h2>You outsource the processing. You keep the decisions.</h2>
            <p>
              This is a managed payroll service, not a transfer of employer responsibility. Your business remains the
              approval authority for the payroll it releases.
            </p>
          </div>

          <div className="responsibility-grid">
            <article className="responsibility-card">
              <span className="feature-icon"><ClipboardCheck size={17} className="i-green" /></span>
              <p className="eyebrow">Linaw payroll team</p>
              <h3>We handle the cycle work</h3>
              <ul>
                <li>Process the payroll inputs provided for the cycle</li>
                <li>Validate calculations and identify exceptions</li>
                <li>Prepare statutory payroll figures supported by the system</li>
                <li>Prepare payroll reports, payslips and supported outputs after approval</li>
                <li>Coordinate questions and missing inputs with your payroll contact</li>
              </ul>
            </article>

            <article className="responsibility-card">
              <span className="feature-icon"><Users size={17} className="i-purple" /></span>
              <p className="eyebrow">Your team</p>
              <h3>You keep control of the business decisions</h3>
              <ul>
                <li>Provide complete and approved payroll inputs</li>
                <li>Confirm employee changes, attendance decisions and exceptions</li>
                <li>Review the processed payroll before release</li>
                <li>Approve the final run through your authorized approver</li>
                <li>Keep control of funding, banking credentials and employer approvals</li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section className="section service-software-bridge">
        <div className="site-shell">
          <div className="service-bridge-card">
            <div>
              <p className="eyebrow">Prefer to run payroll yourself?</p>
              <h2>Linaw payroll software is a separate product.</h2>
              <p>
                If your team wants the system rather than a managed service, the homepage covers the HRIS, attendance,
                payroll engine, approvals, self-service, interactive demo and database-driven software pricing.
              </p>
            </div>
            <a className="secondary-button" href="/">
              See payroll software <ArrowRight size={14} />
            </a>
          </div>
        </div>
      </section>

      <section className="section alt" id="quote">
        <div className="site-shell quote-layout">
          <div className="quote-copy">
            <p className="eyebrow">Payroll outsourcing quote</p>
            <h2>Tell us the payroll you want taken off your plate.</h2>
            <p>
              Start with headcount, frequency and number of entities. Add the part of the cycle that currently consumes the
              most time or creates the most rework.
            </p>
            <div className="quote-points">
              <span><Check size={15} className="i-green" /> No employee personal data is needed for the enquiry</span>
              <span><Check size={15} className="i-green" /> No bank credentials are requested</span>
              <span><Check size={15} className="i-green" /> The form reports whether the enquiry was emailed or only queued</span>
            </div>
          </div>
          <PayrollQuoteForm />
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
