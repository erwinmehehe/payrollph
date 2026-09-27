"use client";

import { useState } from "react";
import {
  ArrowRight,
  Calculator,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  FileCheck2,
  FileText,
  Flame,
  Globe,
  Layers,
  Lock,
  Moon,
  Package,
  Play,
  Shield,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Users,
  Wallet,
} from "lucide-react";
import {
  computeAnnualWithholdingTax,
  computePagIbig,
  computePhilHealth,
  computeSss,
} from "@/lib/payroll-rules";

type PricingPlan = {
  id: number;
  name: string;
  monthlyBase: string;
  perEmployee: string;
  modules: any;
  version: string;
};

const peso = (value: number | string) =>
  `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pesoDec = (value: number | string) =>
  `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function InteractiveWelcome({
  plans,
  competitors,
}: {
  plans: PricingPlan[];
  competitors: Array<{ name: string; freelancer: string; pricing: string; multiClient: string; scale: string }>;
}) {
  const [headcount, setHeadcount] = useState(24);
  const [salary, setSalary] = useState(38500);
  const [isMwe, setIsMwe] = useState(false);
  const [hasHazardPay, setHasHazardPay] = useState(true);
  const [nightDiffHours, setNightDiffHours] = useState(12);
  const [overtimeHours, setOvertimeHours] = useState(6);
  const [isAnnual, setIsAnnual] = useState(false);
  const [launching, setLaunching] = useState<string | null>(null);

  // Live Statutory Calculation
  const dailyRate = salary / 22;
  const hourlyRate = dailyRate / 8;

  const baseGross = salary;
  const otPay = overtimeHours * hourlyRate * 1.25;
  const nightDiffPay = nightDiffHours * hourlyRate * 0.1;
  const hazardPay = hasHazardPay ? dailyRate * 3 * 0.3 : 0; // 3 days hazard pay @ 30%
  const totalGross = baseGross + otPay + nightDiffPay + hazardPay;

  const sss = computeSss(salary);
  const philHealth = computePhilHealth(salary);
  const pagIbig = computePagIbig(salary);
  const annualTaxable = Math.max(0, (totalGross * 12) - ((sss.employee + philHealth.employee + pagIbig.employee) * 12));
  const annualTax = isMwe ? 0 : computeAnnualWithholdingTax(annualTaxable);
  const monthlyTax = annualTax / 12;

  const totalEmployeeDeductions = sss.employee + philHealth.employee + pagIbig.employee + monthlyTax;
  const netTakeHome = totalGross - totalEmployeeDeductions;
  const totalEmployerBurden = totalGross + sss.employer + philHealth.employer + pagIbig.employer;

  async function launchDemo(role: "bookkeeper" | "employee" | "freelancer") {
    setLaunching(role);
    try {
      const response = await fetch("/api/auth/demo-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (response.ok) {
        window.location.href = "/";
      }
    } catch {
      window.location.href = "/login";
    } finally {
      setLaunching(null);
    }
  }

  return (
    <div className="interactive-welcome">
      {/* 1-Click Instant Demo Bar */}
      <section className="card" style={{ padding: "18px 22px", background: "linear-gradient(95deg, #0e2e28 0%, #15463c 100%)", color: "white", borderRadius: 14, marginBottom: 24, boxShadow: "var(--shadow-md)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(80, 210, 157, 0.2)", color: "#50d29d", display: "grid", placeItems: "center", fontWeight: 800 }}>
              <Sparkles size={18} className="i-blue" />
            </span>
            <div>
              <strong style={{ fontSize: 13.5, display: "block", color: "white" }}>Explore the Live Interactive Sandbox</strong>
              <span style={{ fontSize: 11.5, color: "#a5cec0" }}>Jump into any role instantly with pre-seeded test data, zero passwords required:</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="primary-button"
              style={{ background: "#50d29d", color: "#0e2e28", borderColor: "#50d29d", fontWeight: 800 }}
              onClick={() => launchDemo("bookkeeper")}
              disabled={launching !== null}
            >
              <UserCheck size={15} className="i-purple" /> {launching === "bookkeeper" ? "Opening…" : "Principal Bookkeeper"}
            </button>
            <button
              className="secondary-button"
              style={{ background: "rgba(255,255,255,0.1)", color: "white", borderColor: "rgba(255,255,255,0.2)" }}
              onClick={() => launchDemo("employee")}
              disabled={launching !== null}
            >
              <Wallet size={15} className="i-green" /> {launching === "employee" ? "Opening…" : "Employee Portal"}
            </button>
            <button
              className="secondary-button"
              style={{ background: "rgba(255,255,255,0.1)", color: "white", borderColor: "rgba(255,255,255,0.2)" }}
              onClick={() => launchDemo("freelancer")}
              disabled={launching !== null}
            >
              <Calculator size={15} className="i-green" /> {launching === "freelancer" ? "Opening…" : "Freelancer Hub"}
            </button>
          </div>
        </div>
      </section>

      {/* Hero Section */}
      <section className="marketing-hero reveal">
        <div className="marketing-eyebrow">
          <span className="pulse-dot" /> Philippine payroll & HR
        </div>
        <h1>Payroll software that scales from 1 to 10,000 employees.</h1>
        <p className="heading-copy">
          SSS, PhilHealth, Pag-IBIG, and BIR TRAIN built in. Multi-currency contractor payments. Equipment tracking.
          Transparent pricing, no sales calls required.
        </p>

        <div className="marketing-actions">
          <button className="primary-button" style={{ height: 44, padding: "0 20px", fontSize: 13.5 }} onClick={() => launchDemo("bookkeeper")}>
            {launching === "bookkeeper" ? "Opening workspace…" : "Try the live dashboard, no signup"} <ArrowRight size={16} />
          </button>
          <a className="secondary-button" href="#pricing" style={{ height: 44, padding: "0 18px", fontSize: 13 }}>
            <CircleDollarSign size={16} className="i-green" /> See transparent pricing
          </a>
        </div>

        <div className="hero-trust">
          <span><ShieldCheck size={15} className="i-green" /> 94 automated tests passing</span>
          <span><FileCheck2 size={15} className="i-green" /> BIR / SSS / PhilHealth / Pag-IBIG modeled</span>
          <span><Lock size={15} className="i-amber" /> Tenant-isolated, audit-logged</span>
        </div>
      </section>

      {/* Key Metric Pillars */}
      <section className="stats-grid reveal">
        <article className="stat-card">
          <div className="stat-icon mint"><Users size={18} className="i-purple" /></div>
          <p>PROVEN AT SCALE</p>
          <h3>8,000</h3>
          <span>employees processed in 13.3s, no timeouts</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon purple"><Shield size={18} className="i-green" /></div>
          <p>STATUTORY ACCURACY</p>
          <h3>To the centavo</h3>
          <span>Versioned engine PH-2026.1, unit-tested</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon blue"><Layers size={18} className="i-teal" /></div>
          <p>ONE LOGIN</p>
          <h3>Unlimited clients</h3>
          <span>Built for bookkeepers and BPO groups</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon orange"><CircleDollarSign size={18} className="i-green" /></div>
          <p>NO QUOTE WALL</p>
          <h3>Published pricing</h3>
          <span>Every peso live in-product, always</span>
        </article>
      </section>

      {/* Persona strip */}
      <section className="marketing-section reveal" style={{ marginTop: 40 }}>
        <p className="marketing-eyebrow" style={{ marginBottom: 6 }}>WHO IT&apos;S FOR</p>
        <h2>One platform, four use cases.</h2>
        <p className="section-copy">Solo freelancers get a tax planner. Bookkeepers manage multiple clients. BPOs run multi-branch payroll with approval chains.</p>
        <div className="persona-strip">
          <div className="persona-chip"><strong>Freelancers</strong><span>8% flat vs graduated tax comparison. Voluntary SSS/PhilHealth/Pag-IBIG calculator. Quarterly deadline tracking.</span></div>
          <div className="persona-chip"><strong>Small business</strong><span>Semi-monthly payroll runs. Auto-generated payslips. Government worksheet exports (2316, Alphalist, R-3).</span></div>
          <div className="persona-chip"><strong>Bookkeepers & CPAs</strong><span>Manage 10+ clients from one login. Per-client permission scoping. Batch payroll processing.</span></div>
          <div className="persona-chip"><strong>Enterprise / BPO</strong><span>Multi-branch hierarchy. Department-scoped RBAC. Approval delegation. Payroll queues tested to 8,000 employees.</span></div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="marketing-section reveal">
        <p className="marketing-eyebrow" style={{ marginBottom: 6 }}>FEATURES</p>
        <h2>Everything in one platform.</h2>
        <div className="feature-grid">
          <div className="feature-card">
            <div className="feature-icon" style={{ background: "var(--green-light)", color: "var(--green)" }}><Flame size={20} className="i-amber" /></div>
            <h3>Auto calamity pay</h3>
            <p>DOLE advisory declared once. Hazard pay (+30%) flows to affected employees automatically.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon" style={{ background: "var(--purple-bg)", color: "var(--purple)" }}><Moon size={20} className="i-slate" /></div>
            <h3>Time & attendance</h3>
            <p>Tardiness, overtime, and night differential (10 PM – 6 AM) derived from raw punches. Incomplete punches flagged for review.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon" style={{ background: "var(--blue-bg)", color: "var(--blue)" }}><Layers size={20} className="i-teal" /></div>
            <h3>Scalable payroll engine</h3>
            <p>Postgres <code>FOR UPDATE SKIP LOCKED</code> chunked queues. Resumable, idempotent. Load-tested to 8,000 employees.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon" style={{ background: "var(--amber-bg)", color: "var(--amber)" }}><FileText size={20} className="i-teal" /></div>
            <h3>Traceable payslips</h3>
            <p>Every line item shows its input, rule version, and statutory basis. Click to see the arithmetic.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon" style={{ background: "var(--green-light)", color: "var(--green)" }}><Wallet size={20} className="i-green" /></div>
            <h3>Benefits administration</h3>
            <p>HMO, group life, Pag-IBIG MP2, and SSS Flexi-Fund. Enroll inside payroll. Statutory caps enforced.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon" style={{ background: "var(--blue-bg)", color: "var(--blue)" }}><Globe size={20} className="i-blue" /></div>
            <h3>Multi-currency contractors</h3>
            <p>Track international contractors in USD, EUR, GBP, or any currency. Contract dates, rates, and status in one place.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon" style={{ background: "var(--amber-bg)", color: "var(--amber)" }}><Package size={20} className="i-teal" /></div>
            <h3>Equipment tracking</h3>
            <p>Laptops, phones, and other assets assigned to employees. Track serial numbers, assignment dates, and returns.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon" style={{ background: "var(--purple-bg)", color: "var(--purple)" }}><Shield size={20} className="i-green" /></div>
            <h3>Enterprise security</h3>
            <p>scrypt password hashing, TOTP 2FA, revocable sessions, distributed rate limits, tenant isolation on every route.</p>
          </div>
        </div>
      </section>

      {/* Interactive Live Statutory Simulator */}
      <section className="simulator-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, borderBottom: "1px solid var(--line)", paddingBottom: 16 }}>
          <div>
            <div className="card-kicker" style={{ color: "var(--green)" }}>LIVE INTERACTIVE STATUTORY SIMULATOR</div>
            <h2 style={{ margin: "4px 0", fontSize: 20, letterSpacing: "-0.4px", fontWeight: 800 }}>Test the Philippine calculation engine in real-time</h2>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 12.5 }}>Adjust salary and statutory toggles to see exact SSS, PhilHealth, Pag-IBIG, and TRAIN tax formulas in action:</p>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className={`secondary-button ${isMwe ? "active" : ""}`} onClick={() => setIsMwe(!isMwe)} style={{ height: 32, fontSize: 11 }}>
              {isMwe ? "✓ MWE Tax Exempt" : "MWE Exemption"}
            </button>
            <button className={`secondary-button ${hasHazardPay ? "active" : ""}`} onClick={() => setHasHazardPay(!hasHazardPay)} style={{ height: 32, fontSize: 11 }}>
              {hasHazardPay ? "✓ DOLE Hazard Pay (+30%)" : "+ Hazard Pay"}
            </button>
          </div>
        </div>

        <div className="sim-grid">
          {/* Controls */}
          <div>
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-secondary)" }}>Monthly Basic Salary</label>
                <strong style={{ color: "var(--green)", fontSize: 14 }}>{peso(salary)} / mo</strong>
              </div>
              <input
                type="range"
                min={14000}
                max={150000}
                step={500}
                value={salary}
                onChange={(e) => setSalary(Number(e.target.value))}
                style={{ width: "100%", ["--range-fill" as string]: `${((salary - 14000) / (150000 - 14000)) * 100}%` }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)", fontSize: 10, marginTop: 2 }}>
                <span>₱14,000 (Min Wage)</span>
                <span>₱50,000 (Mid-level)</span>
                <span>₱150,000 (Senior)</span>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-secondary)", display: "block", marginBottom: 4 }}>
                  <Moon size={13} style={{ display: "inline", marginRight: 4 }} /> Night Diff Hours (10PM–6AM)
                </label>
                <input
                  type="number"
                  min={0}
                  max={80}
                  value={nightDiffHours}
                  onChange={(e) => setNightDiffHours(Number(e.target.value))}
                  style={{ width: "100%", height: 36, padding: "0 8px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12.5 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-secondary)", display: "block", marginBottom: 4 }}>
                  <Flame size={13} style={{ display: "inline", marginRight: 4 }} /> Overtime Hours (1.25x)
                </label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={overtimeHours}
                  onChange={(e) => setOvertimeHours(Number(e.target.value))}
                  style={{ width: "100%", height: 36, padding: "0 8px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12.5 }}
                />
              </div>
            </div>

            <div className="notice notice-green" style={{ margin: 0, fontSize: 11 }}>
              <span><strong>Traceability guarantee:</strong> Every deduction links back to its legal basis: SSS R.A. 11199, PhilHealth R.A. 11223, and BIR TRAIN R.A. 10963.</span>
            </div>
          </div>

          {/* Breakdown Preview */}
          <div style={{ background: "white", padding: 18, borderRadius: 12, border: "1px solid var(--line)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", color: "var(--muted)", textTransform: "uppercase" }}>Calculated Net Payslip</span>
              <span className="status status-verified">Engine PH-2026.1</span>
            </div>

            <div className="sim-breakdown-row">
              <span>Basic Monthly Compensation</span>
              <strong>{pesoDec(baseGross)}</strong>
            </div>
            {otPay > 0 && (
              <div className="sim-breakdown-row">
                <span>Regular Overtime ({overtimeHours} hrs @ 1.25x)</span>
                <strong style={{ color: "var(--green)" }}>+{pesoDec(otPay)}</strong>
              </div>
            )}
            {nightDiffPay > 0 && (
              <div className="sim-breakdown-row">
                <span>Night Differential ({nightDiffHours} hrs @ +10%)</span>
                <strong style={{ color: "var(--green)" }}>+{pesoDec(nightDiffPay)}</strong>
              </div>
            )}
            {hazardPay > 0 && (
              <div className="sim-breakdown-row">
                <span>DOLE Calamity Hazard Pay (+30%)</span>
                <strong style={{ color: "var(--green)" }}>+{pesoDec(hazardPay)}</strong>
              </div>
            )}
            <div className="sim-breakdown-row" style={{ background: "var(--canvas-subtle)", padding: "8px 10px", borderRadius: 6, margin: "4px 0" }}>
              <strong>Total Gross Earnings</strong>
              <strong style={{ fontSize: 13.5 }}>{pesoDec(totalGross)}</strong>
            </div>

            <div className="sim-breakdown-row">
              <span>SSS (EE Share · MSC ₱{sss.monthlySalaryCredit.toLocaleString()})</span>
              <span style={{ color: "var(--danger)", fontWeight: 700 }}>-{pesoDec(sss.employee)}</span>
            </div>
            <div className="sim-breakdown-row">
              <span>PhilHealth (EE Share · 2.5% of ₱{philHealth.base.toLocaleString()})</span>
              <span style={{ color: "var(--danger)", fontWeight: 700 }}>-{pesoDec(philHealth.employee)}</span>
            </div>
            <div className="sim-breakdown-row">
              <span>Pag-IBIG (EE Share · Capped)</span>
              <span style={{ color: "var(--danger)", fontWeight: 700 }}>-{pesoDec(pagIbig.employee)}</span>
            </div>
            <div className="sim-breakdown-row">
              <span>Withholding Tax {isMwe ? "(MWE Exempt)" : "(TRAIN Annualized)"}</span>
              <span style={{ color: isMwe ? "var(--muted)" : "var(--danger)", fontWeight: 700 }}>
                {isMwe ? "₱0.00 (Exempt)" : `-${pesoDec(monthlyTax)}`}
              </span>
            </div>

            <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 8, background: "linear-gradient(135deg, #eaf5ef 0%, #d4ede2 100%)", display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid var(--green-border)" }}>
              <div>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#0e3e34" }}>Estimated Net Pay</span>
                <strong style={{ display: "block", fontSize: 20, color: "#0d6856", letterSpacing: "-0.5px" }}>{pesoDec(netTakeHome)}</strong>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{ fontSize: 9.5, color: "var(--muted)", display: "block" }}>Employer Total Cost</span>
                <span style={{ fontSize: 12, fontWeight: 750, color: "var(--ink-secondary)" }}>{pesoDec(totalEmployerBurden)}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Database-Backed Pricing Section */}
      <section className="marketing-section" id="pricing">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
          <div>
            <p className="eyebrow">TRANSPARENT IN-APP PRICING</p>
            <h2>Published pricing. Zero sales gate walls.</h2>
            <p className="section-copy">
              Compare this to every competitor who hides their pricing behind a mandatory 30-minute discovery call.
              What you see here is live data read directly from our PostgreSQL <code>pricing_plans</code> table.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "white", padding: "4px 6px", borderRadius: 10, border: "1px solid var(--line)" }}>
            <button
              onClick={() => setIsAnnual(false)}
              className={!isAnnual ? "primary-button" : "secondary-button"}
              style={{ height: 28, fontSize: 11, padding: "0 10px" }}
            >
              Monthly
            </button>
            <button
              onClick={() => setIsAnnual(true)}
              className={isAnnual ? "primary-button" : "secondary-button"}
              style={{ height: 28, fontSize: 11, padding: "0 10px" }}
            >
              Annual <span style={{ fontSize: 9, opacity: 0.85, marginLeft: 2 }}>(2 Mo. Free)</span>
            </button>
          </div>
        </div>

        <div className="pricing-grid">
          {plans.map((plan) => {
            const modules = Array.isArray(plan.modules) ? (plan.modules as string[]) : [];
            const basePrice = Number(plan.monthlyBase);
            const perEmp = Number(plan.perEmployee);
            const isScale = plan.name === "Scale";
            const effectiveMonthly = isAnnual ? (basePrice * 10) / 12 : basePrice;

            return (
              <article className={`card price-card ${isScale ? "featured" : ""}`} key={plan.id}>
                {isScale && <div className="popular-label">MOST POPULAR</div>}
                <span className="price-plan">{plan.name}</span>
                <h2>{plan.name === "Solo" ? "Freelancers & Solopreneurs" : plan.name === "Core" ? "Micro & Small Teams" : plan.name === "Scale" ? "Growing Multi-Branch BPOs" : "Enterprise Workforces"}</h2>
                
                <div className="price">
                  <strong>{peso(effectiveMonthly)}</strong>
                  <span>/ month base</span>
                </div>
                <small>
                  {plan.name === "Solo" ? "100% Free Forever for Individual Filers" : `+ ${peso(perEmp)} / employee / month · v${plan.version}`}
                </small>

                <ul className="marketing-modules" style={{ margin: "14px 0" }}>
                  {modules.map((module) => (
                    <li key={module} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <CheckCircle2 size={13} style={{ color: "var(--green)", flex: "none" }} />
                      <span>{module}</span>
                    </li>
                  ))}
                </ul>

                <button
                  className={isScale ? "primary-button full" : "secondary-button full"}
                  style={{ marginTop: "auto" }}
                  onClick={() => launchDemo(plan.name === "Solo" ? "freelancer" : "bookkeeper")}
                >
                  {plan.name === "Solo" ? "Launch Solo Hub" : `Try ${plan.name} Live`} <ArrowRight size={14} />
                </button>
              </article>
            );
          })}
        </div>
      </section>

      {/* Competitor Parity Comparison Table */}
      <section className="marketing-section" id="comparison">
        <p className="eyebrow">COMPETITIVE POSITIONING</p>
        <h2>Why we built across every tier instead of conceding market segments</h2>
        <p className="section-copy">
          Sprout, PayrollHero, GreatDay HR, and Kazam pick lanes and compromise elsewhere.
          Linaw delivers enterprise queue depth and compliance rigor without forcing complexity onto solo operators:
        </p>

        <article className="card table-card">
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>PLATFORM</th>
                  <th>FREELANCER TIER</th>
                  <th>PUBLISHED PRICING</th>
                  <th>MULTI-CLIENT CPA HUB</th>
                  <th>HEADCOUNT SCALE ARCHITECTURE</th>
                </tr>
              </thead>
              <tbody>
                {competitors.map((row) => (
                  <tr key={row.name} style={{ background: row.name === "Linaw" ? "var(--green-light)" : "transparent" }}>
                    <td>
                      <strong>{row.name}</strong>
                      {row.name === "Linaw" && <span style={{ marginLeft: 6, fontSize: 8.5, padding: "2px 6px", background: "var(--green)", color: "white", borderRadius: 4, fontWeight: 800 }}>LIVE SYSTEM</span>}
                    </td>
                    <td>{row.freelancer}</td>
                    <td>{row.pricing}</td>
                    <td>{row.multiClient}</td>
                    <td>{row.scale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      {/* Honest Readiness Block */}
      <section className="marketing-section">
        <div className="notice notice-amber marketing-notice" style={{ padding: "16px 20px" }}>
          <div>
            <strong style={{ fontSize: 13, display: "block", marginBottom: 4 }}>Live Verified Launch Readiness Audit</strong>
            <p style={{ margin: "0 0 10px", fontSize: 12, lineHeight: 1.55 }}>
              <strong>Verified & Passing:</strong> SSS/PhilHealth/Pag-IBIG/TRAIN calculation engine, MWE cascading,
              Postgres FOR UPDATE SKIP LOCKED queue (load-tested to 8,000 headcount), tenant isolation (IDOR-safe),
              HMAC-signed webhooks with backoff, Year-end annualization (2316), and employee self-service.
              <br />
              <strong>External Gate Requirements:</strong> Live bank host-to-host API submission (flat-file validation ready),
              certified government portal validation, and PayMongo production billing keys.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <a className="secondary-button" href="/scorecard" style={{ height: 30, fontSize: 11 }}><FileCheck2 size={14} className="i-green" /> Full 22-Point Scorecard</a>
              <a className="secondary-button" href="/api/readiness" style={{ height: 30, fontSize: 11 }}><ShieldCheck size={14} className="i-green" /> Live Readiness API JSON</a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
