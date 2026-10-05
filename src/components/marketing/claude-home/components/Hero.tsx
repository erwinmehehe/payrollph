import { ArrowRight, CheckCircle2 } from "lucide-react";
import { WorkspacePreview } from "@/components/marketing/workspace-preview";
import { Reveal } from "./ui";

const trustPoints = [
  "SSS, PhilHealth, Pag-IBIG & TRAIN calculations",
  "Government worksheets clearly labelled",
  "Maker-checker release controls",
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
              Philippine payroll software{" "}
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
          <div className="payroll-home-visual" aria-label="Actual Linaw payroll workspace preview">
            <div className="payroll-home-preview-label">
              <span>Actual Linaw workspace</span>
              <small>Sample payroll · nothing saved</small>
            </div>
            <div className="payroll-home-real-preview system-demo-stage">
              <div className="system-demo-product">
                <WorkspacePreview mode="showcase" />
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
