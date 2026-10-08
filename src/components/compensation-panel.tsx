"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  CalendarDays,
  Check,
  Layers3,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";

type Access = { companyWide: boolean; role: string };
type Employee = {
  id: number;
  firstName: string;
  lastName: string;
  title: string;
  annualPay: number | null;
  jobProfileId: number | null;
  gradeId: number | null;
  salaryBand: Band | null;
  compaRatio: number | null;
  rangePosition: number | null;
};
type JobProfile = { id: number; title: string; family: string; level: string; gradeId: number | null; grade: string | null };
type JobGrade = { id: number; code: string; name: string; sequence: number; active: boolean };
type LegalEntity = { id: number; code: string; displayName: string };
type Band = {
  id: number;
  jobProfileId: number | null;
  gradeId: number | null;
  legalEntityId: number | null;
  locationCode: string;
  minimumAnnual: string;
  midpointAnnual: string;
  maximumAnnual: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  active: boolean;
};
type Cycle = { id: number; name: string; startDate: string; endDate: string; effectiveDate: string; budgetPool: string; status: string };
type Proposal = {
  id: number;
  cycleId: number;
  employeeId: number;
  bandId: number;
  currentAnnual: string;
  proposedAnnual: string;
  reason: string;
  status: string;
  compaRatio: number | null;
  rangePosition: number | null;
  submittedByUserId: number | null;
  workerEffectiveChangeId: number | null;
  failure: string | null;
};
type Component = {
  id: number;
  code: string;
  name: string;
  kind: string;
  amountFrequency: string;
  taxable: boolean;
  includeInSssBase: boolean;
  includeInPagIbigBase: boolean;
  active: boolean;
};
type ComponentAssignment = {
  id: number;
  employeeId: number;
  componentId: number;
  amount: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  status: string;
  reason: string;
  requestedByUserId: number | null;
  requestedBy: string;
  approvedBy: string | null;
};
type Promotion = {
  id: number;
  employeeId: number;
  effectiveDate: string;
  status: string;
  targetPositionId: number | null;
};
type CompensationEvent = {
  id: number;
  employeeId: number;
  eventType: string;
  effectiveDate: string;
  previousAnnual: string | null;
  newAnnual: string | null;
  actorName: string;
  metadata: unknown;
};

const peso = (value: string | number | null) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP",
        maximumFractionDigits: 0,
      }).format(Number(value));

function pct(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}%`;
}

export function CompensationPanel({
  organizationId,
  setNotice,
}: {
  organizationId: number;
  setNotice: (message: string) => void;
}) {
  const [access, setAccess] = useState<Access | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [jobProfiles, setJobProfiles] = useState<JobProfile[]>([]);
  const [jobGrades, setJobGrades] = useState<JobGrade[]>([]);
  const [legalEntities, setLegalEntities] = useState<LegalEntity[]>([]);
  const [bands, setBands] = useState<Band[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [componentAssignments, setComponentAssignments] = useState<ComponentAssignment[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [events, setEvents] = useState<CompensationEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const [bandForm, setBandForm] = useState({
    gradeId: "",
    jobProfileId: "",
    legalEntityId: "",
    locationCode: "PH",
    minimumAnnual: "",
    midpointAnnual: "",
    maximumAnnual: "",
    effectiveFrom: "",
    effectiveUntil: "",
  });
  const [cycleForm, setCycleForm] = useState({
    name: "",
    startDate: "",
    endDate: "",
    effectiveDate: "",
    budgetPool: "",
  });
  const [proposalForm, setProposalForm] = useState({
    employeeId: "",
    cycleId: "",
    bandId: "",
    workerEffectiveChangeId: "",
    proposedAnnual: "",
    reason: "",
  });
  const [componentForm, setComponentForm] = useState({
    code: "",
    name: "",
    kind: "allowance",
    amountFrequency: "monthly",
    taxable: true,
    includeInSssBase: true,
    includeInPagIbigBase: true,
  });
  const [assignmentForm, setAssignmentForm] = useState({
    employeeId: "",
    componentId: "",
    amount: "",
    effectiveFrom: "",
    effectiveUntil: "",
    reason: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/compensation?organizationId=${organizationId}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not load compensation.");
      setAccess(body.access ?? null);
      setCurrentUserId(Number.isInteger(body.currentUserId) ? body.currentUserId : null);
      setEmployees(body.employees ?? []);
      setJobProfiles(body.jobProfiles ?? []);
      setJobGrades(body.jobGrades ?? []);
      setLegalEntities(body.legalEntities ?? []);
      setBands(body.bands ?? []);
      setCycles(body.cycles ?? []);
      setProposals(body.proposals ?? []);
      setComponents(body.components ?? []);
      setComponentAssignments(body.componentAssignments ?? []);
      setPromotions(body.promotions ?? []);
      setEvents(body.compensationEvents ?? []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load compensation.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, setNotice]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(entityType: string, payload: Record<string, unknown>) {
    const response = await fetch("/api/compensation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, entityType, ...payload }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Could not save compensation data.");
    await load();
    return body;
  }

  async function patch(payload: Record<string, unknown>, success: string) {
    const response = await fetch("/api/compensation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(body.error ?? "Could not update compensation.");
      // Another checker may have consumed the cycle budget since this screen
      // loaded. Refresh authoritative proposal states before the next action.
      if (response.status === 409) await load();
      return;
    }
    setNotice(success);
    await load();
  }

  const activeCycle = cycles.find((cycle) => cycle.status === "active");
  const committedSpend = useMemo(
    () =>
      proposals
        .filter((proposal) =>
          proposal.cycleId === activeCycle?.id
          && ["scheduled", "applied"].includes(proposal.status),
        )
        .reduce(
          (sum, proposal) =>
            sum + Math.max(0, Number(proposal.proposedAnnual) - Number(proposal.currentAnnual)),
          0,
        ),
    [proposals, activeCycle?.id],
  );
  const selectedEmployeeId = Number(proposalForm.employeeId);
  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId) ?? null;
  const selectedPromotionOptions = promotions.filter(
    (promotion) => promotion.employeeId === selectedEmployeeId,
  );
  const canApprove = access?.role === "owner" || access?.role === "admin";

  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">HCM COMPENSATION</div>
          <h1>Compensation</h1>
          <p>
            Govern grade ranges, salary changes, promotion pay and recurring cash components with effective dates,
            maker-checker approval and a permanent compensation history.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <div className="notice notice-blue" style={{ marginBottom: 16 }}>
        <ShieldCheck size={15} />
        <span>
          <strong>Effective-date boundary:</strong> approved future salary revisions are available to payroll immediately
          for future-cutoff calculation, but the employee&apos;s current pay profile is not changed until the effective date.
          Recurring components use the same date-controlled approach.
        </span>
      </div>

      <section className="stats-grid" style={{ marginBottom: 16 }}>
        <article className="stat-card">
          <span>Active salary bands</span>
          <strong>{bands.filter((band) => band.active).length}</strong>
          <small>grade/profile + employer + location</small>
        </article>
        <article className="stat-card">
          <span>Active cycle</span>
          <strong>{activeCycle?.name ?? "None"}</strong>
          <small>{activeCycle ? `effective ${activeCycle.effectiveDate}` : "create a review cycle"}</small>
        </article>
        <article className="stat-card">
          <span>{access?.companyWide ? "Committed budget" : "Visible committed increases"}</span>
          <strong>{peso(committedSpend)}</strong>
          <small>{!activeCycle
            ? "no active cycle"
            : access?.companyWide
              ? `${peso(Math.max(0, Number(activeCycle.budgetPool) - committedSpend))} remaining of ${peso(activeCycle.budgetPool)} pool`
              : "Only proposals in your assigned scope are shown"}
          </small>
        </article>
        <article className="stat-card">
          <span>Recurring components</span>
          <strong>{componentAssignments.filter((row) => ["scheduled", "active"].includes(row.status)).length}</strong>
          <small>{componentAssignments.filter((row) => row.status === "pending_approval").length} pending approval</small>
        </article>
      </section>

      <section className="module-grid three">
        <article className="card">
          <div className="card-header">
            <div>
              <div className="card-kicker">SALARY STRUCTURE</div>
              <h2>Grade-linked range</h2>
            </div>
            <BadgeDollarSign size={18} />
          </div>
          <div className="card-body" style={{ display: "grid", gap: 8 }}>
            <select value={bandForm.gradeId} onChange={(event) => setBandForm({ ...bandForm, gradeId: event.target.value })}>
              <option value="">Job grade</option>
              {jobGrades.filter((grade) => grade.active).map((grade) => (
                <option key={grade.id} value={grade.id}>{grade.code} · {grade.name}</option>
              ))}
            </select>
            <select value={bandForm.jobProfileId} onChange={(event) => setBandForm({ ...bandForm, jobProfileId: event.target.value })}>
              <option value="">All profiles in grade</option>
              {jobProfiles
                .filter((profile) => !bandForm.gradeId || profile.gradeId === Number(bandForm.gradeId))
                .map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.title} · {profile.level}</option>
                ))}
            </select>
            <select value={bandForm.legalEntityId} onChange={(event) => setBandForm({ ...bandForm, legalEntityId: event.target.value })}>
              <option value="">All legal employers</option>
              {legalEntities.map((entity) => (
                <option key={entity.id} value={entity.id}>{entity.code} · {entity.displayName}</option>
              ))}
            </select>
            <input value={bandForm.locationCode} onChange={(event) => setBandForm({ ...bandForm, locationCode: event.target.value })} placeholder="Location code, e.g. NCR or PH" />
            <input type="number" value={bandForm.minimumAnnual} onChange={(event) => setBandForm({ ...bandForm, minimumAnnual: event.target.value })} placeholder="Annual minimum" />
            <input type="number" value={bandForm.midpointAnnual} onChange={(event) => setBandForm({ ...bandForm, midpointAnnual: event.target.value })} placeholder="Annual midpoint" />
            <input type="number" value={bandForm.maximumAnnual} onChange={(event) => setBandForm({ ...bandForm, maximumAnnual: event.target.value })} placeholder="Annual maximum" />
            <label>Effective from
              <input type="date" value={bandForm.effectiveFrom} onChange={(event) => setBandForm({ ...bandForm, effectiveFrom: event.target.value })} />
            </label>
            <label>Effective until
              <input type="date" value={bandForm.effectiveUntil} onChange={(event) => setBandForm({ ...bandForm, effectiveUntil: event.target.value })} />
            </label>
            <button
              className="secondary-button"
              onClick={async () => {
                try {
                  await post("band", {
                    ...bandForm,
                    gradeId: bandForm.gradeId ? Number(bandForm.gradeId) : null,
                    jobProfileId: bandForm.jobProfileId ? Number(bandForm.jobProfileId) : null,
                    legalEntityId: bandForm.legalEntityId ? Number(bandForm.legalEntityId) : null,
                    minimumAnnual: Number(bandForm.minimumAnnual),
                    midpointAnnual: Number(bandForm.midpointAnnual),
                    maximumAnnual: Number(bandForm.maximumAnnual),
                  });
                  setBandForm({ gradeId: "", jobProfileId: "", legalEntityId: "", locationCode: "PH", minimumAnnual: "", midpointAnnual: "", maximumAnnual: "", effectiveFrom: "", effectiveUntil: "" });
                  setNotice("Salary structure created.");
                } catch (error) {
                  setNotice(error instanceof Error ? error.message : "Could not create salary structure.");
                }
              }}
            >
              <Plus size={14} /> Add salary band
            </button>
          </div>
        </article>

        <article className="card">
          <div className="card-header">
            <div>
              <div className="card-kicker">REVIEW CYCLE</div>
              <h2>Budget before decisions</h2>
            </div>
            <CalendarDays size={18} />
          </div>
          <div className="card-body" style={{ display: "grid", gap: 8 }}>
            <input value={cycleForm.name} onChange={(event) => setCycleForm({ ...cycleForm, name: event.target.value })} placeholder="2027 Annual Review" />
            <label>Review starts
              <input type="date" value={cycleForm.startDate} onChange={(event) => setCycleForm({ ...cycleForm, startDate: event.target.value })} />
            </label>
            <label>Review ends
              <input type="date" value={cycleForm.endDate} onChange={(event) => setCycleForm({ ...cycleForm, endDate: event.target.value })} />
            </label>
            <label>Pay effective
              <input type="date" value={cycleForm.effectiveDate} onChange={(event) => setCycleForm({ ...cycleForm, effectiveDate: event.target.value })} />
            </label>
            <input type="number" value={cycleForm.budgetPool} onChange={(event) => setCycleForm({ ...cycleForm, budgetPool: event.target.value })} placeholder="Increase budget pool" />
            <button
              className="secondary-button"
              onClick={async () => {
                try {
                  await post("cycle", { ...cycleForm, budgetPool: Number(cycleForm.budgetPool) });
                  setCycleForm({ name: "", startDate: "", endDate: "", effectiveDate: "", budgetPool: "" });
                  setNotice("Compensation cycle created.");
                } catch (error) {
                  setNotice(error instanceof Error ? error.message : "Could not create cycle.");
                }
              }}
            >
              <Plus size={14} /> Create cycle
            </button>
          </div>
        </article>

        <article className="card">
          <div className="card-header">
            <div>
              <div className="card-kicker">PAY PROPOSAL</div>
              <h2>Salary or promotion pay</h2>
            </div>
          </div>
          <div className="card-body" style={{ display: "grid", gap: 8 }}>
            <select value={proposalForm.employeeId} onChange={(event) => setProposalForm({ ...proposalForm, employeeId: event.target.value, workerEffectiveChangeId: "" })}>
              <option value="">Employee</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.firstName} {employee.lastName} · {peso(employee.annualPay)}
                </option>
              ))}
            </select>
            {selectedEmployee && (
              <div className="notice notice-slate" style={{ margin: 0 }}>
                <span>
                  <strong>{selectedEmployee.title}</strong> · compa-ratio {pct(selectedEmployee.compaRatio)} · range position {pct(selectedEmployee.rangePosition)}
                </span>
              </div>
            )}
            <select value={proposalForm.cycleId} onChange={(event) => setProposalForm({ ...proposalForm, cycleId: event.target.value })}>
              <option value="">Cycle</option>
              {cycles.filter((cycle) => cycle.status === "active").map((cycle) => (
                <option key={cycle.id} value={cycle.id}>{cycle.name} · effective {cycle.effectiveDate}</option>
              ))}
            </select>
            <select value={proposalForm.workerEffectiveChangeId} onChange={(event) => setProposalForm({ ...proposalForm, workerEffectiveChangeId: event.target.value })}>
              <option value="">Not linked to a promotion</option>
              {selectedPromotionOptions.map((promotion) => (
                <option key={promotion.id} value={promotion.id}>
                  Promotion #{promotion.id} · {promotion.effectiveDate} · {promotion.status}
                </option>
              ))}
            </select>
            <select value={proposalForm.bandId} onChange={(event) => setProposalForm({ ...proposalForm, bandId: event.target.value })}>
              <option value="">Salary band</option>
              {bands.filter((band) => band.active).map((band) => {
                const grade = jobGrades.find((row) => row.id === band.gradeId);
                const profile = jobProfiles.find((row) => row.id === band.jobProfileId);
                return (
                  <option key={band.id} value={band.id}>
                    {profile?.title ?? grade?.code ?? "Band"} · {band.locationCode} · {peso(band.minimumAnnual)}–{peso(band.maximumAnnual)}
                  </option>
                );
              })}
            </select>
            <input type="number" value={proposalForm.proposedAnnual} onChange={(event) => setProposalForm({ ...proposalForm, proposedAnnual: event.target.value })} placeholder="Proposed annual pay" />
            <textarea value={proposalForm.reason} onChange={(event) => setProposalForm({ ...proposalForm, reason: event.target.value })} placeholder="Reason for proposed change" />
            <button
              className="secondary-button"
              onClick={async () => {
                try {
                  await post("proposal", {
                    employeeId: Number(proposalForm.employeeId),
                    cycleId: Number(proposalForm.cycleId),
                    bandId: Number(proposalForm.bandId),
                    workerEffectiveChangeId: proposalForm.workerEffectiveChangeId ? Number(proposalForm.workerEffectiveChangeId) : null,
                    proposedAnnual: Number(proposalForm.proposedAnnual),
                    reason: proposalForm.reason,
                  });
                  setProposalForm({ employeeId: "", cycleId: "", bandId: "", workerEffectiveChangeId: "", proposedAnnual: "", reason: "" });
                  setNotice("Compensation proposal submitted for independent approval.");
                } catch (error) {
                  setNotice(error instanceof Error ? error.message : "Could not submit proposal.");
                }
              }}
            >
              <Plus size={14} /> Submit proposal
            </button>
          </div>
        </article>
      </section>

      <section className="module-grid two" style={{ marginTop: 16 }}>
        <article className="card">
          <div className="card-header">
            <div>
              <div className="card-kicker">COMPONENT CATALOG</div>
              <h2>Recurring cash components</h2>
              <p>Define payroll treatment once, then assign governed amounts to workers.</p>
            </div>
            <Layers3 size={18} />
          </div>
          <div className="card-body" style={{ display: "grid", gap: 8 }}>
            <input value={componentForm.code} onChange={(event) => setComponentForm({ ...componentForm, code: event.target.value })} placeholder="Code, e.g. TRANSPO" />
            <input value={componentForm.name} onChange={(event) => setComponentForm({ ...componentForm, name: event.target.value })} placeholder="Transportation Allowance" />
            <select value={componentForm.kind} onChange={(event) => setComponentForm({ ...componentForm, kind: event.target.value })}>
              <option value="allowance">Allowance</option>
              <option value="stipend">Stipend</option>
              <option value="recurring_bonus">Recurring bonus</option>
              <option value="other_cash">Other cash component</option>
            </select>
            <select value={componentForm.amountFrequency} onChange={(event) => setComponentForm({ ...componentForm, amountFrequency: event.target.value })}>
              <option value="monthly">Monthly amount · split across semi-monthly cutoffs</option>
              <option value="per_cutoff">Amount per cutoff</option>
            </select>
            <label><input type="checkbox" checked={componentForm.taxable} onChange={(event) => setComponentForm({ ...componentForm, taxable: event.target.checked })} /> Taxable</label>
            <label><input type="checkbox" checked={componentForm.includeInSssBase} onChange={(event) => setComponentForm({ ...componentForm, includeInSssBase: event.target.checked })} /> Include in SSS base</label>
            <label><input type="checkbox" checked={componentForm.includeInPagIbigBase} onChange={(event) => setComponentForm({ ...componentForm, includeInPagIbigBase: event.target.checked })} /> Include in Pag-IBIG base</label>
            <button
              className="secondary-button"
              onClick={async () => {
                try {
                  await post("component", componentForm);
                  setComponentForm({ code: "", name: "", kind: "allowance", amountFrequency: "monthly", taxable: true, includeInSssBase: true, includeInPagIbigBase: true });
                  setNotice("Compensation component created.");
                } catch (error) {
                  setNotice(error instanceof Error ? error.message : "Could not create component.");
                }
              }}
            >
              <Plus size={14} /> Add component
            </button>
          </div>
        </article>

        <article className="card">
          <div className="card-header">
            <div>
              <div className="card-kicker">WORKER COMPONENT</div>
              <h2>Assign recurring compensation</h2>
              <p>Assignments are effective-dated and require a different Owner/Admin to approve them.</p>
            </div>
          </div>
          <div className="card-body" style={{ display: "grid", gap: 8 }}>
            <select value={assignmentForm.employeeId} onChange={(event) => setAssignmentForm({ ...assignmentForm, employeeId: event.target.value })}>
              <option value="">Employee</option>
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}
            </select>
            <select value={assignmentForm.componentId} onChange={(event) => setAssignmentForm({ ...assignmentForm, componentId: event.target.value })}>
              <option value="">Compensation component</option>
              {components.filter((component) => component.active).map((component) => (
                <option key={component.id} value={component.id}>{component.code} · {component.name} · {component.amountFrequency.replaceAll("_", " ")}</option>
              ))}
            </select>
            <input type="number" min="0.01" step="0.01" value={assignmentForm.amount} onChange={(event) => setAssignmentForm({ ...assignmentForm, amount: event.target.value })} placeholder="Amount" />
            <label>Effective from
              <input type="date" value={assignmentForm.effectiveFrom} onChange={(event) => setAssignmentForm({ ...assignmentForm, effectiveFrom: event.target.value })} />
            </label>
            <label>Effective until
              <input type="date" value={assignmentForm.effectiveUntil} onChange={(event) => setAssignmentForm({ ...assignmentForm, effectiveUntil: event.target.value })} />
            </label>
            <textarea value={assignmentForm.reason} onChange={(event) => setAssignmentForm({ ...assignmentForm, reason: event.target.value })} placeholder="Reason for recurring component" />
            <button
              className="secondary-button"
              onClick={async () => {
                try {
                  await post("component_assignment", {
                    employeeId: Number(assignmentForm.employeeId),
                    componentId: Number(assignmentForm.componentId),
                    amount: Number(assignmentForm.amount),
                    effectiveFrom: assignmentForm.effectiveFrom,
                    effectiveUntil: assignmentForm.effectiveUntil || null,
                    reason: assignmentForm.reason,
                  });
                  setAssignmentForm({ employeeId: "", componentId: "", amount: "", effectiveFrom: "", effectiveUntil: "", reason: "" });
                  setNotice("Recurring compensation component submitted for approval.");
                } catch (error) {
                  setNotice(error instanceof Error ? error.message : "Could not assign component.");
                }
              }}
            >
              <Plus size={14} /> Submit assignment
            </button>
          </div>
        </article>
      </section>

      <article className="card table-card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">MARKET POSITION</div>
            <h2>Employee pay against salary structure</h2>
            <p>Compa-ratio compares salary with the band midpoint. Range position shows where salary sits between minimum and maximum.</p>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Employee</th><th>Annual pay</th><th>Band</th><th>Compa-ratio</th><th>Range position</th></tr></thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id}>
                  <td><strong>{employee.firstName} {employee.lastName}</strong><small style={{ display: "block" }}>{employee.title}</small></td>
                  <td>{peso(employee.annualPay)}</td>
                  <td>{employee.salaryBand ? `${peso(employee.salaryBand.minimumAnnual)} – ${peso(employee.salaryBand.maximumAnnual)}` : "No applicable band"}</td>
                  <td>{pct(employee.compaRatio)}</td>
                  <td>{pct(employee.rangePosition)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="card table-card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">GOVERNED SALARY CHANGES</div>
            <h2>Compensation proposals</h2>
            <p>Approval creates the future-dated pay revision. Current pay is synchronized only when the effective date arrives.</p>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Employee</th><th>Current</th><th>Proposed</th><th>Position</th><th>Status</th><th>Decision</th></tr></thead>
            <tbody>
              {proposals.map((proposal) => {
                const employee = employees.find((row) => row.id === proposal.employeeId);
                return (
                  <tr key={proposal.id}>
                    <td>
                      <strong>{employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${proposal.employeeId}`}</strong>
                      <small style={{ display: "block" }}>
                        {proposal.reason}{proposal.workerEffectiveChangeId ? ` · linked promotion #${proposal.workerEffectiveChangeId}` : ""}
                        {proposal.failure ? ` · ${proposal.failure}` : ""}
                      </small>
                    </td>
                    <td>{peso(proposal.currentAnnual)}</td>
                    <td>{peso(proposal.proposedAnnual)}</td>
                    <td>{pct(proposal.compaRatio)} compa · {pct(proposal.rangePosition)} range</td>
                    <td>{proposal.status.replaceAll("_", " ")}</td>
                    <td>
                      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {proposal.status === "proposed" && canApprove && proposal.submittedByUserId !== currentUserId && (
                          <>
                            <button className="secondary-button" onClick={() => void patch({ entityType: "proposal", id: proposal.id, decision: "approved" }, "Compensation proposal approved and scheduled.")}><Check size={13} /> Approve</button>
                            <button className="secondary-button" onClick={() => void patch({ entityType: "proposal", id: proposal.id, decision: "declined" }, "Compensation proposal declined.")}><X size={13} /> Decline</button>
                          </>
                        )}
                        {["proposed", "scheduled", "failed"].includes(proposal.status) && canApprove && (
                          <button className="secondary-button" onClick={() => void patch({ entityType: "proposal", id: proposal.id, action: "cancel" }, "Compensation proposal cancelled.")}>Cancel</button>
                        )}
                        {proposal.status === "failed" && canApprove && (
                          <button className="secondary-button" onClick={() => void patch({ entityType: "proposal", id: proposal.id, action: "retry" }, "Compensation proposal retry submitted.")}>Retry</button>
                        )}
                        {!["proposed", "scheduled", "failed"].includes(proposal.status) && "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>

      <article className="card table-card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">RECURRING PAY</div>
            <h2>Employee compensation components</h2>
            <p>Monthly values are split across semi-monthly cutoffs and prorated when their effective dates begin or end inside a cutoff.</p>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Employee</th><th>Component</th><th>Amount</th><th>Effective</th><th>Status</th><th>Decision</th></tr></thead>
            <tbody>
              {componentAssignments.map((assignment) => {
                const employee = employees.find((row) => row.id === assignment.employeeId);
                const component = components.find((row) => row.id === assignment.componentId);
                return (
                  <tr key={assignment.id}>
                    <td><strong>{employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${assignment.employeeId}`}</strong><small style={{ display: "block" }}>{assignment.reason}</small></td>
                    <td>{component ? `${component.code} · ${component.name}` : `Component #${assignment.componentId}`}</td>
                    <td>{peso(assignment.amount)}<small style={{ display: "block" }}>{component?.amountFrequency.replaceAll("_", " ") ?? ""}</small></td>
                    <td>{assignment.effectiveFrom}{assignment.effectiveUntil ? ` → ${assignment.effectiveUntil}` : " → ongoing"}</td>
                    <td>{assignment.status.replaceAll("_", " ")}</td>
                    <td>
                      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {assignment.status === "pending_approval" && canApprove && assignment.requestedByUserId !== currentUserId && (
                          <>
                            <button className="secondary-button" onClick={() => void patch({ entityType: "component_assignment", id: assignment.id, action: "approve" }, "Recurring compensation approved.")}><Check size={13} /> Approve</button>
                            <button className="secondary-button" onClick={() => void patch({ entityType: "component_assignment", id: assignment.id, action: "decline" }, "Recurring compensation declined.")}><X size={13} /> Decline</button>
                          </>
                        )}
                        {["pending_approval", "scheduled"].includes(assignment.status) && (
                          <button className="secondary-button" onClick={() => void patch({ entityType: "component_assignment", id: assignment.id, action: "cancel" }, "Recurring compensation cancelled.")}>Cancel</button>
                        )}
                        {!["pending_approval", "scheduled"].includes(assignment.status) && "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>

      <article className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">COMPENSATION HISTORY</div>
            <h2>Immutable compensation evidence</h2>
            <p>Scheduled, applied, activated, ended and cancelled events remain visible after current state changes.</p>
          </div>
        </div>
        <div className="card-body">
          {events.length === 0 && <div className="empty-state">No compensation history yet.</div>}
          {events.slice(0, 20).map((event) => {
            const employee = employees.find((row) => row.id === event.employeeId);
            return (
              <div className="payslip-line" key={event.id} style={{ gridTemplateColumns: "1fr auto" }}>
                <span>
                  {employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${event.employeeId}`} · {event.eventType.replaceAll("_", " ")}
                  <em>
                    {event.previousAnnual != null || event.newAnnual != null
                      ? `${peso(event.previousAnnual)} → ${peso(event.newAnnual)} · `
                      : ""}
                    recorded by {event.actorName}
                  </em>
                </span>
                <b>{event.effectiveDate}</b>
              </div>
            );
          })}
        </div>
      </article>
    </div>
  );
}
