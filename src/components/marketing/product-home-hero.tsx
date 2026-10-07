"use client";

import { useState } from "react";
import { Wallet, CalendarClock, Users, ContactRound, ChartNoAxesCombined, UserRound } from "lucide-react";
import { LinawSimulation } from "@/components/marketing/linaw-simulation";

const productIcons = [Wallet, CalendarClock, Users, ContactRound, ChartNoAxesCombined, UserRound];

const areas = [
  { id: "payroll", name: "Payroll", color: "#0877ff", image: "payroll", height: 1501, title: "Payroll / inputs, calculation & review", copy: "See the payroll run, its amounts, and the items that need your team’s attention.", href: "/small-business-payroll" },
  { id: "wfm", name: "Workforce Management", color: "#088775", image: "attendance", height: 2114, title: "Workforce / time records & exceptions", copy: "Review attendance records and the exceptions that feed workforce and payroll decisions.", href: "/workforce-management" },
  { id: "hcm", name: "HCM", color: "#8455c7", image: "hr", height: 1304, title: "HCM / people workflows", copy: "Follow onboarding tasks, responsibilities, and upcoming employee milestones.", href: "/hcm" },
  { id: "hris", name: "HRIS", color: "#a75528", image: "people", height: 1375, title: "HRIS / employee records", copy: "Maintain employee information, employment details, and organization access in the employee directory.", href: "/hris" },
  { id: "analytics", name: "Workforce Analytics", color: "#277592", image: "reports", height: 1286, title: "Analytics / reports & outputs", copy: "Compare payroll periods, department costs, and headcount in the sample reporting workspace.", href: "/workforce-analytics" },
  { id: "employee", name: "Employee Self-Service", color: "#a23f6a", image: "employee", height: 1050, title: "Self-service / personal pay & time", copy: "Explore personal payslips, attendance, and leave requests from the employee perspective.", href: "/employee-self-service" },
] as const;

export function ProductHomeHero() {
  const [selected, setSelected] = useState<(typeof areas)[number]>(areas[0]);
  const [previewPage, setPreviewPage] = useState("Payroll");
  const destinations: Record<string, string> = { payroll: "Payroll", wfm: "Workforce", hcm: "HCM", hris: "People", analytics: "Exports", employee: "Payroll" };
  return (
    <section id="top" className="linaw-product-hero" aria-label="Linaw payroll and people platform">
      <div className="lp-intro">
        <p className="lp-eyebrow">Payroll & people for Philippine teams</p>
        <h1>Your people. Your payroll.<br /><span>Working together.</span></h1>
        <p className="lp-description">Bring employee records, time, payroll, and approvals into one connected workspace. Give every team a clearer view of what comes next.</p>
        <div className="lp-picker" role="group" aria-label="Choose a product area">
          {areas.map((area, index) => { const Icon = productIcons[index]; return <button key={area.id} type="button" aria-pressed={selected.id === area.id} aria-controls="product-screen" onClick={() => { setSelected(area); setPreviewPage(destinations[area.id]); }} style={{ "--area-color": area.color } as React.CSSProperties}><span className="lp-product-icon" aria-hidden="true"><Icon size={22} strokeWidth={1.7} /></span><span>{area.name}</span></button>; })}
        </div>
        <div className="lp-actions"><a className="lp-button lp-primary hero-primary-cta" href="/demo">Explore the demo <span aria-hidden="true">→</span></a><a className="lp-button" href="/book-demo">Talk to us</a></div>
        <p className="lp-micro">One connected workflow. Clear responsibilities at every step.</p>
      </div>
      <div id="product-screen" className="lp-showcase">
        <div className="lp-screen-heading"><div><h2>{selected.title}</h2><p>{selected.copy}</p></div><a href={selected.href}>Explore {selected.name.toLowerCase()} <span aria-hidden="true">↗</span></a></div>
        <div id="demo" className="lp-simulation system-demo-product"><div className="lp-screen-heading"><strong>Your team. One connected workspace.</strong><a href="/demo">Open role-based sandbox ↗</a></div><LinawSimulation key={selected.id} initialRole={selected.id === "employee" ? "Employee" : "Payroll"} page={previewPage} onPageChange={setPreviewPage} /></div>
        <p className="lp-screen-note">Interactive simulation · Fictional sample data · Changes stay in this preview. Full role-based access is available in the sandbox.</p>
      </div>
      <span className="sr-only" aria-live="polite">{selected.title}</span>
      <div className="lp-context"><strong>Philippine payroll context, built in.</strong><span>SSS</span><span>PhilHealth</span><span>Pag-IBIG</span><span>Withholding tax</span></div>
    </section>
  );
}
