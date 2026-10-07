"use client";

import { useState } from "react";
import Image from "next/image";

const areas = [
  { id: "payroll", name: "Payroll", color: "#0877ff", image: "payroll", height: 1501, title: "Payroll / inputs, calculation & review", copy: "See the payroll run, its amounts, and the items that need your team’s attention.", href: "/small-business-payroll" },
  { id: "wfm", name: "Workforce Management", color: "#088775", image: "attendance", height: 2114, title: "Workforce / time records & exceptions", copy: "Review attendance records and the exceptions that feed workforce and payroll decisions.", href: "/time-and-attendance" },
  { id: "hcm", name: "HCM", color: "#8455c7", image: "hr", height: 1304, title: "HCM / people workflows", copy: "See the HR dashboard and employee record checks before exploring lifecycle workflows.", href: "/hris" },
  { id: "hris", name: "HRIS", color: "#a75528", image: "people", height: 1375, title: "HRIS / employee records", copy: "Maintain employee information, employment details, and organization access in the employee directory.", href: "/hris" },
  { id: "analytics", name: "Workforce Analytics", color: "#277592", image: "reports", height: 1286, title: "Analytics / reports & outputs", copy: "Inspect payroll history, report categories, and the files available for the finance handoff.", href: "/workforce-analytics" },
  { id: "employee", name: "Employee Self-Service", color: "#a23f6a", image: "employee", height: 1050, title: "Self-service / personal pay & time", copy: "Give employees a personal view of released payslips, payday, and leave information.", href: "/employee-self-service" },
] as const;

export function ProductHomeHero() {
  const [selected, setSelected] = useState<(typeof areas)[number]>(areas[0]);
  return (
    <section id="top" className="linaw-product-hero" aria-label="Linaw payroll and people platform">
      <div className="lp-intro">
        <p className="lp-eyebrow">Payroll & people for Philippine teams</p>
        <h1>Your people. Your payroll.<br /><span>Working together.</span></h1>
        <p className="lp-description">Bring employee records, time, payroll, and approvals into one connected workspace. Give every team a clearer view of what comes next.</p>
        <div className="lp-picker" role="group" aria-label="Choose a product area">
          {areas.map((area) => <button key={area.id} type="button" aria-pressed={selected.id === area.id} aria-controls="product-screen" onClick={() => setSelected(area)} style={{ "--area-color": area.color } as React.CSSProperties}><span className="lp-check" aria-hidden="true">{selected.id === area.id ? "✓" : "+"}</span>{area.name}</button>)}
        </div>
        <div className="lp-actions"><a className="lp-button lp-primary hero-primary-cta" href="/demo">Explore the demo <span aria-hidden="true">→</span></a><a className="lp-button" href="/book-demo">Talk to us</a></div>
        <p className="lp-micro">One connected workflow. Clear responsibilities at every step.</p>
      </div>
      <div id="product-screen" className="lp-showcase">
        <div className="lp-screen-heading"><div><h2>{selected.title}</h2><p>{selected.copy}</p></div><a href={selected.href}>Explore {selected.name.toLowerCase()} <span aria-hidden="true">↗</span></a></div>
        <div className="lp-screen-stage"><a className="lp-screen" href={`/marketing/screens/${selected.image}.webp`} target="_blank" rel="noopener" aria-label={`Open full-size ${selected.name} sample screen`}><Image src={`/marketing/screens/${selected.image}.webp`} alt={`Actual Linaw ${selected.name} workspace with fictional sample data`} width={1440} height={selected.height} sizes="(max-width: 760px) 94vw, 1180px" priority={selected.id === "payroll"} unoptimized /></a></div>
        <p className="lp-screen-note">Actual application screens · Sample data · Open a screen to inspect it full size.</p>
      </div>
      <span className="sr-only" aria-live="polite">{selected.title}</span>
      <div className="lp-context"><strong>Philippine payroll context, built in.</strong><span>SSS</span><span>PhilHealth</span><span>Pag-IBIG</span><span>Withholding tax</span></div>
    </section>
  );
}
