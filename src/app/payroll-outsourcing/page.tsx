import type { Metadata } from "next";
import { CheckCircle2, ClipboardCheck, HandCoins, ShieldCheck, UsersRound } from "lucide-react";

export const metadata: Metadata = {
  title: "Payroll Outsourcing Philippines | Managed Payroll Services | Linaw",
  description: "Outsource Philippine payroll processing to a managed payroll team while your company retains review, approval, and payment authority in the same Linaw platform.",
  alternates: { canonical: "/payroll-outsourcing" },
};

const steps=[
  ["1","Cutoff handoff","Your team provides approved timekeeping, changes, benefits, loans and one-off inputs."],
  ["2","Payroll preparation","Our payroll processor prepares the run inside the same Linaw workspace you can see."],
  ["3","Variance review","Exceptions, employee changes and material variances are reviewed before anything is approved."],
  ["4","Client approval","Your authorized payroll approver reviews the final numbers. Linaw does not approve on your behalf."],
  ["5","Release & outputs","After approval, your authorized release authority can finalize payslips, bank files and statutory working files."],
];

export default function PayrollOutsourcingPage(){
 return <main className="marketing-page">
  <header className="marketing-nav"><a className="marketing-brand" href="/"><div className="brand-mark"><span>sa</span></div><strong>linaw</strong></a><div className="marketing-nav-actions"><a className="link-button" href="/">Payroll Software</a><a className="secondary-button" href="/#live-demo">Try Live Demo</a><a className="primary-button" href="/book-demo?service=payroll-outsourcing">Get a Payroll Quote</a></div></header>
  <section className="marketing-hero" style={{maxWidth:900,margin:"70px auto 36px"}}><div className="marketing-eyebrow"><span className="pulse-dot"/> Managed payroll services for Philippine businesses</div><h1>We run the payroll. Your team stays in control.</h1><p className="heading-copy">Linaw Managed Payroll combines a payroll operations team with the same payroll software your company can inspect at any time. We prepare and review. Your company approves and controls money movement.</p><div className="marketing-actions"><a className="primary-button" href="/book-demo?service=payroll-outsourcing">Get a payroll outsourcing quote</a><a className="secondary-button" href="/#live-demo">See the payroll platform</a></div></section>
  <section className="marketing-section"><div className="marketing-eyebrow"><UsersRound size={16}/> One platform, two operating models</div><h2>Outsource the work without outsourcing visibility.</h2><div className="marketing-grid" style={{marginTop:24}}><article className="marketing-card"><ShieldCheck/><h3>Client-controlled approval</h3><p>Managed payroll operators can prepare and process payroll but cannot approve, release, or trigger live disbursement.</p></article><article className="marketing-card"><ClipboardCheck/><h3>Reviewable audit trail</h3><p>Cutoffs, inputs, exceptions, approvals, exports and release events stay traceable in the client workspace.</p></article><article className="marketing-card"><HandCoins/><h3>Same system if you insource later</h3><p>Move from managed payroll to self-service without migrating employee history or rebuilding payroll data elsewhere.</p></article></div></section>
  <section className="marketing-section"><div className="marketing-eyebrow"><CheckCircle2 size={16}/> Managed payroll workflow</div><h2>A clear handoff between processor and client.</h2><div className="marketing-grid" style={{marginTop:24}}>{steps.map(([n,t,d])=><article className="marketing-card" key={n}><strong>{n}</strong><h3>{t}</h3><p>{d}</p></article>)}</div></section>
  <section className="marketing-section"><div className="notice notice-blue"><span><strong>Need payroll software instead?</strong> The Linaw homepage is focused on self-service payroll software and HRIS. Managed payroll is intentionally a separate service funnel for companies that want the processing work handled for them.</span></div><div className="marketing-actions" style={{marginTop:24}}><a className="primary-button" href="/book-demo?service=payroll-outsourcing">Book payroll consultation</a><a className="secondary-button" href="/">Explore payroll software</a></div></section>
 </main>;
}
