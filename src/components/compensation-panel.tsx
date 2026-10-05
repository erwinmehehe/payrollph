"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeDollarSign, Check, Plus, RefreshCw, ShieldCheck, X } from "lucide-react";

type Employee = { id: number; firstName: string; lastName: string; title: string; annualPay: number | null };
type JobProfile = { id: number; title: string; family: string; level: string };
type Band = { id: number; jobProfileId: number; locationCode: string; minimumAnnual: string; midpointAnnual: string; maximumAnnual: string; active: boolean };
type Cycle = { id: number; name: string; startDate: string; endDate: string; effectiveDate: string; budgetPool: string; status: string };
type Proposal = { id: number; cycleId: number; employeeId: number; bandId: number; currentAnnual: string; proposedAnnual: string; reason: string; status: string; compaRatio: number | null };

const peso = (value: string | number | null) => value == null ? "—" : new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(Number(value));

export function CompensationPanel({ organizationId, setNotice }: { organizationId: number; setNotice: (message: string) => void }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [jobProfiles, setJobProfiles] = useState<JobProfile[]>([]);
  const [bands, setBands] = useState<Band[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [bandForm, setBandForm] = useState({ jobProfileId: "", locationCode: "PH", minimumAnnual: "", midpointAnnual: "", maximumAnnual: "" });
  const [cycleForm, setCycleForm] = useState({ name: "", startDate: "", endDate: "", effectiveDate: "", budgetPool: "" });
  const [proposalForm, setProposalForm] = useState({ employeeId: "", cycleId: "", bandId: "", proposedAnnual: "", reason: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/compensation?organizationId=${organizationId}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not load compensation.");
      setEmployees(body.employees ?? []);
      setJobProfiles(body.jobProfiles ?? []);
      setBands(body.bands ?? []);
      setCycles(body.cycles ?? []);
      setProposals(body.proposals ?? []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load compensation.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  async function post(entityType: string, payload: Record<string, unknown>) {
    const response = await fetch("/api/compensation", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, entityType, ...payload }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Could not save compensation data.");
    await load();
  }

  async function decide(id: number, decision: "approved" | "declined") {
    const response = await fetch("/api/compensation", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, decision }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return setNotice(body.error ?? "Could not decide compensation proposal.");
    setNotice(decision === "approved" ? "Pay change approved. Payroll will honor its effective-dated revision, and the live profile will switch only on the effective date." : "Compensation proposal declined.");
    await load();
  }

  const activeCycle = cycles.find((cycle) => cycle.status === "active");
  const approvedSpend = useMemo(() => proposals.filter((proposal) => proposal.status === "approved" || proposal.status === "applied")
    .reduce((sum, proposal) => sum + Math.max(0, Number(proposal.proposedAnnual) - Number(proposal.currentAnnual)), 0), [proposals]);

  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">COMPENSATION</div>
          <h1>Govern pay changes before they reach payroll.</h1>
          <p>Use salary bands, compa-ratio and a fixed budget pool. Performance data may inform a decision, but it never changes salary automatically.</p>
        </div>
        <div className="page-actions"><button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> Refresh</button></div>
      </div>

      <div className="notice notice-blue" style={{ marginBottom: 16 }}>
        <ShieldCheck size={15} /><span><strong>Maker-checker boundary:</strong> the submitter cannot approve their own proposal. Approval creates a future-safe pay revision; the live pay profile changes only when the effective date arrives.</span>
      </div>

      <section className="stats-grid" style={{ marginBottom: 16 }}>
        <article className="stat-card"><span>Active salary bands</span><strong>{bands.filter((band) => band.active).length}</strong><small>job + location ranges</small></article>
        <article className="stat-card"><span>Active cycle</span><strong>{activeCycle?.name ?? "None"}</strong><small>{activeCycle ? `effective ${activeCycle.effectiveDate}` : "create a review cycle"}</small></article>
        <article className="stat-card"><span>Budget pool</span><strong>{peso(activeCycle?.budgetPool ?? null)}</strong><small>{peso(approvedSpend)} approved increases</small></article>
        <article className="stat-card"><span>Pending proposals</span><strong>{proposals.filter((proposal) => proposal.status === "proposed").length}</strong><small>require explicit decision</small></article>
      </section>

      <section className="module-grid three">
        <article className="card">
          <div className="card-header"><div><div className="card-kicker">SALARY BAND</div><h2>Set a governed range</h2></div><BadgeDollarSign size={18} /></div>
          <div className="card-body" style={{ display: "grid", gap: 8 }}>
            <select value={bandForm.jobProfileId} onChange={(e) => setBandForm({ ...bandForm, jobProfileId: e.target.value })}>
              <option value="">Job profile</option>{jobProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.title} · {profile.level}</option>)}
            </select>
            <input value={bandForm.locationCode} onChange={(e) => setBandForm({ ...bandForm, locationCode: e.target.value })} placeholder="Location code, e.g. NCR" />
            <input type="number" value={bandForm.minimumAnnual} onChange={(e) => setBandForm({ ...bandForm, minimumAnnual: e.target.value })} placeholder="Annual minimum" />
            <input type="number" value={bandForm.midpointAnnual} onChange={(e) => setBandForm({ ...bandForm, midpointAnnual: e.target.value })} placeholder="Annual midpoint" />
            <input type="number" value={bandForm.maximumAnnual} onChange={(e) => setBandForm({ ...bandForm, maximumAnnual: e.target.value })} placeholder="Annual maximum" />
            <button className="secondary-button" onClick={async () => { try { await post("band", { ...bandForm, jobProfileId: Number(bandForm.jobProfileId), minimumAnnual: Number(bandForm.minimumAnnual), midpointAnnual: Number(bandForm.midpointAnnual), maximumAnnual: Number(bandForm.maximumAnnual) }); setNotice("Salary band created."); } catch (e) { setNotice(e instanceof Error ? e.message : "Could not create band."); } }}><Plus size={14} /> Add band</button>
          </div>
        </article>

        <article className="card">
          <div className="card-header"><div><div className="card-kicker">REVIEW CYCLE</div><h2>Lock the budget first</h2></div></div>
          <div className="card-body" style={{ display: "grid", gap: 8 }}>
            <input value={cycleForm.name} onChange={(e) => setCycleForm({ ...cycleForm, name: e.target.value })} placeholder="2027 Annual Review" />
            <label>Review starts<input type="date" value={cycleForm.startDate} onChange={(e) => setCycleForm({ ...cycleForm, startDate: e.target.value })} /></label>
            <label>Review ends<input type="date" value={cycleForm.endDate} onChange={(e) => setCycleForm({ ...cycleForm, endDate: e.target.value })} /></label>
            <label>Pay effective<input type="date" value={cycleForm.effectiveDate} onChange={(e) => setCycleForm({ ...cycleForm, effectiveDate: e.target.value })} /></label>
            <input type="number" value={cycleForm.budgetPool} onChange={(e) => setCycleForm({ ...cycleForm, budgetPool: e.target.value })} placeholder="Increase budget pool" />
            <button className="secondary-button" onClick={async () => { try { await post("cycle", { ...cycleForm, budgetPool: Number(cycleForm.budgetPool) }); setNotice("Compensation cycle created."); } catch (e) { setNotice(e instanceof Error ? e.message : "Could not create cycle."); } }}><Plus size={14} /> Create cycle</button>
          </div>
        </article>

        <article className="card">
          <div className="card-header"><div><div className="card-kicker">PAY PROPOSAL</div><h2>Recommend, do not auto-apply</h2></div></div>
          <div className="card-body" style={{ display: "grid", gap: 8 }}>
            <select value={proposalForm.employeeId} onChange={(e) => setProposalForm({ ...proposalForm, employeeId: e.target.value })}>
              <option value="">Employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} · {peso(employee.annualPay)}</option>)}
            </select>
            <select value={proposalForm.cycleId} onChange={(e) => setProposalForm({ ...proposalForm, cycleId: e.target.value })}>
              <option value="">Cycle</option>{cycles.filter((cycle) => cycle.status === "active").map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}
            </select>
            <select value={proposalForm.bandId} onChange={(e) => setProposalForm({ ...proposalForm, bandId: e.target.value })}>
              <option value="">Salary band</option>{bands.filter((band) => band.active).map((band) => <option key={band.id} value={band.id}>{band.locationCode} · {peso(band.minimumAnnual)}–{peso(band.maximumAnnual)}</option>)}
            </select>
            <input type="number" value={proposalForm.proposedAnnual} onChange={(e) => setProposalForm({ ...proposalForm, proposedAnnual: e.target.value })} placeholder="Proposed annual pay" />
            <textarea value={proposalForm.reason} onChange={(e) => setProposalForm({ ...proposalForm, reason: e.target.value })} placeholder="Reason for proposed change" />
            <button className="secondary-button" onClick={async () => { try { await post("proposal", { ...proposalForm, employeeId: Number(proposalForm.employeeId), cycleId: Number(proposalForm.cycleId), bandId: Number(proposalForm.bandId), proposedAnnual: Number(proposalForm.proposedAnnual) }); setNotice("Compensation proposal submitted for approval."); } catch (e) { setNotice(e instanceof Error ? e.message : "Could not submit proposal."); } }}><Plus size={14} /> Submit proposal</button>
          </div>
        </article>
      </section>

      <article className="card table-card" style={{ marginTop: 16 }}>
        <div className="card-header"><div><div className="card-kicker">GOVERNED CHANGES</div><h2>Compensation proposals</h2><p>Compa-ratio is proposed annual salary ÷ band midpoint. No proposal can exceed its band or cycle budget.</p></div></div>
        <div className="data-table-wrap">
          <table className="data-table"><thead><tr><th>Employee</th><th>Current</th><th>Proposed</th><th>Compa-ratio</th><th>Status</th><th>Decision</th></tr></thead>
          <tbody>{proposals.map((proposal) => {
            const employee = employees.find((row) => row.id === proposal.employeeId);
            return <tr key={proposal.id}>
              <td><strong>{employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${proposal.employeeId}`}</strong><small style={{ display: "block" }}>{proposal.reason}</small></td>
              <td>{peso(proposal.currentAnnual)}</td><td>{peso(proposal.proposedAnnual)}</td><td>{proposal.compaRatio == null ? "—" : `${proposal.compaRatio.toFixed(1)}%`}</td>
              <td>{proposal.status === "approved" ? "Approved · scheduled" : proposal.status === "applied" ? "Applied" : proposal.status}</td>
              <td>{proposal.status === "proposed" ? <span style={{ display: "flex", gap: 6 }}><button className="secondary-button" onClick={() => void decide(proposal.id, "approved")}><Check size={13} /> Approve</button><button className="secondary-button" onClick={() => void decide(proposal.id, "declined")}><X size={13} /> Decline</button></span> : proposal.status === "approved" ? "Awaiting effective date" : proposal.status === "applied" ? "Live in payroll" : "Decided"}</td>
            </tr>;
          })}</tbody></table>
        </div>
      </article>
    </div>
  );
}
