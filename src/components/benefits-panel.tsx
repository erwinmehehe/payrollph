"use client";

import { useEffect, useState } from "react";
import { HandCoins, HeartPulse, PiggyBank, Plus, X } from "lucide-react";
import { HmoBenefitsPanel } from "@/components/hmo-benefits-panel";

type Plan = { id: number; name: string; category: string; employeeShare: string; employerShare: string; cap: string | null; provider: string | null; enrolled: number };
type Row = { id: number; name: string; monthlyBasic: string; enrolments: Array<{ id: number; planId: number; monthlyContribution: string; status: string }> };

const peso = (value: string | number) =>
  `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const iconFor = (category: string) =>
  category === "hmo" ? <HeartPulse size={19} className="i-pink" />
    : category === "voluntary" ? <PiggyBank size={19} className="i-green" />
      : <HandCoins size={19} className="i-green" />;

export function BenefitsPanel({ organizationId, setNotice }: { organizationId: number; setNotice: (message: string) => void }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [employees, setEmployees] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [employeeId, setEmployeeId] = useState(0);
  const [planId, setPlanId] = useState(0);
  const [amount, setAmount] = useState("");
  const [startedOn, setStartedOn] = useState("2026-03-01");

  const [nonce, setNonce] = useState(0);
  // Fetch inside the effect body so state is never set synchronously during the
  // effect; `load()` just schedules a re-run. `alive` drops stale responses.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch(`/api/benefits?organizationId=${organizationId}`, { cache: "no-store" });
        if (!response.ok) { if (alive) setLoaded(true); return; }
        const payload = await response.json();
        if (!alive) return;
        setPlans(payload.plans);
        setEmployees(payload.employees);
        setLoaded(true);
      } catch {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, [organizationId, nonce]);

  function load() {
    setNonce((n) => n + 1);
  }

  async function seed() {
    const response = await fetch("/api/benefits", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId }),
    });
    const payload = await response.json();
    setNotice(payload.seeded ? "Default PH benefit catalogue created." : "Catalogue already exists.");
    await load();
  }

  async function enrol(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/benefits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        employeeId,
        planId,
        monthlyContribution: Number(amount || 0),
        startedOn,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setNotice([payload.error, ...(payload.problems ?? [])].filter(Boolean).join(" "));
      return;
    }
    setNotice("Employee enrolled. Deductions apply from the next calculated run.");
    setAmount("");
    await load();
  }

  async function end(id: number) {
    await fetch(`/api/benefits?id=${id}`, { method: "DELETE" });
    setNotice("Enrolment ended. It stops deducting from the next run.");
    await load();
  }

  const totalEmployee = plans.reduce((sum, plan) => sum + Number(plan.employeeShare) * plan.enrolled, 0);
  const totalEmployer = plans.reduce((sum, plan) => sum + Number(plan.employerShare) * plan.enrolled, 0);

  return (
    <>
      <PageHeading
        eyebrow="BENEFITS ADMINISTRATION"
        title="Benefits"
        copy="HMO, group insurance, Pag-IBIG MP2 and allowance enrolments deduct automatically on the next calculated run."
        actions={plans.length === 0 && <button className="primary-button" onClick={seed}><Plus size={16} className="i-green" /> Seed PH catalogue</button>}
      />

      <HmoBenefitsPanel organizationId={organizationId} setNotice={setNotice} />

      <section className="stats-grid">
        <article className="stat-card"><div className="stat-icon mint"><HandCoins size={19} /></div><p>EMPLOYEE SHARE / MO</p><h3>{peso(totalEmployee)}</h3><span>{employees.reduce((sum, e) => sum + e.enrolments.filter((x) => x.status === "active").length, 0)} active enrolment(s)</span></article>
        <article className="stat-card"><div className="stat-icon blue"><HandCoins size={19} /></div><p>EMPLOYER SHARE / MO</p><h3>{peso(totalEmployer)}</h3><span>cost, not deducted</span></article>
        <article className="stat-card"><div className="stat-icon purple"><PiggyBank size={19} /></div><p>PLANS</p><h3>{plans.length}</h3><span>available to enrol</span></article>
      </section>

      {!loaded && <div className="empty-state">Loading benefits…</div>}

      {loaded && plans.length > 0 && (
        <article className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div><div className="card-kicker">ENROL AN EMPLOYEE</div><h2>Add a benefit</h2></div>
          </div>
          <form onSubmit={enrol} className="setting-form">
            <label>Employee
              <select value={employeeId} onChange={(event) => setEmployeeId(Number(event.target.value))} required>
                <option value="">Choose…</option>
                {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
              </select>
            </label>
            <label>Plan
              <select value={planId} onChange={(event) => setPlanId(Number(event.target.value))} required>
                <option value="">Choose…</option>
                {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}, {peso(plan.employeeShare)}/mo</option>)}
              </select>
            </label>
            <label>Monthly amount (blank = plan default)
              <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="e.g. 2000" />
            </label>
            <label>Starts on<input type="date" value={startedOn} onChange={(event) => setStartedOn(event.target.value)} /></label>
            <div style={{ gridColumn: "1 / -1" }}><button className="primary-button">Enrol employee</button></div>
          </form>
        </article>
      )}

      <article className="card">
        <div className="card-header"><div><div className="card-kicker">CATALOGUE</div><h2>Available plans</h2></div><Status value={plans.length ? "Active" : "Not seeded"} /></div>
        {plans.length === 0 && loaded && (
          <div className="empty-state">
            <span>No benefit plans yet.</span>
            <button className="secondary-button" onClick={seed}>Seed the default PH catalogue</button>
          </div>
        )}
        <div className="worksheet-list">
          {plans.map((plan) => (
            <div key={plan.id}>
              <span className="attention-icon">{iconFor(plan.category)}</span>
              <span>{plan.name}<small>employee {peso(plan.employeeShare)} · employer {peso(plan.employerShare)}{plan.cap ? ` · cap ${peso(plan.cap)}` : ""}</small></span>
              <span className="mwe-tag">{plan.enrolled} enrolled</span>
            </div>
          ))}
        </div>
      </article>

      {loaded && employees.some((employee) => employee.enrolments.length > 0) && (
        <article className="card" style={{ marginTop: 16 }}>
          <div className="card-header"><div><div className="card-kicker">ENROLMENTS</div><h2>Per employee</h2></div></div>
          <div className="worksheet-list">
            {employees.filter((employee) => employee.enrolments.length > 0).map((employee) => (
              <div key={employee.id}>
                <span className="avatar">{employee.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}</span>
                <span>
                  {employee.name}
                  <small>
                    {employee.enrolments.map((enrolment) => {
                      const plan = plans.find((p) => p.id === enrolment.planId);
                      return `${plan?.name ?? "plan"} ${peso(enrolment.monthlyContribution)}/mo (${enrolment.status})`;
                    }).join(" · ")}
                  </small>
                </span>
                {employee.enrolments.filter((e) => e.status === "active").map((enrolment) => (
                  <button key={enrolment.id} className="row-more" onClick={() => end(enrolment.id)} aria-label="End enrolment"><X size={16} /></button>
                ))}
              </div>
            ))}
          </div>
        </article>
      )}

      <div className="notice notice-green" style={{ marginTop: 16 }}>
        <span><strong>Traceable by construction.</strong> Each benefit appears on the payslip as <code>BEN-&lt;planId&gt;</code> with its basis and the rule version used. Contributions above a legal cap are clamped, not silently accepted.</span>
      </div>
    </>
  );
}

function PageHeading({ eyebrow, title, copy, actions }: { eyebrow: string; title: string; copy: string; actions?: React.ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="heading-copy">{copy}</p></div>{actions && <div className="heading-actions">{actions}</div>}</div>;
}

function Status({ value }: { value: string }) {
  return <span className={`status ${value === "Active" ? "status-tested" : "status-credential-required"}`}>{value}</span>;
}
