"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  FileText,
  Star,
  UserCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";

type Requisition = {
  id: number;
  positionId: number | null;
  positionCode: string | null;
  title: string;
  department: string;
  headcount: number;
  salaryMin: string | null;
  salaryMax: string | null;
  annualPositionBudget: string | null;
  planHandoffEvidence: {
    version: string;
    planId: number;
    baselineId: number;
    baselineVersion: number;
    executionId: number;
    positionCode: string;
    executionHash: string;
  } | null;
  employmentType: string;
  status: string;
  description: string;
  applicantCount: number;
  interviewCount: number;
  offerCount: number;
  hiredCount: number;
};

type Applicant = {
  id: number;
  requisitionId: number;
  fullName: string;
  email: string;
  phone: string | null;
  stage: string;
  rating: number;
  notes: string;
  offeredSalary: string | null;
  hiredEmployeeId: number | null;
  createdAt: string;
};

const STAGES = [
  { key: "applied", label: "Applied" },
  { key: "screening", label: "Screening" },
  { key: "interview", label: "Interview" },
  { key: "offer", label: "Job Offer" },
  { key: "hired", label: "Hired" },
] as const;

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", middleName: "", lastName: "" };
  const firstName = parts.shift() ?? "";
  const lastName = parts.pop() ?? "";
  return { firstName, middleName: parts.join(" "), lastName };
}

function peso(value: number | string | null | undefined) {
  if (value == null || value === "") return "—";
  return `₱${Number(value).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

export function RecruitmentPanel({
  organizationId,
  setNotice,
}: {
  organizationId: number;
  setNotice: (message: string) => void;
}) {
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [selectedReqId, setSelectedReqId] = useState<number | null>(null);
  const [showAppModal, setShowAppModal] = useState(false);
  const [hiringApplicant, setHiringApplicant] = useState<Applicant | null>(null);
  const [savingHire, setSavingHire] = useState(false);

  const [formApp, setFormApp] = useState({
    requisitionId: "",
    fullName: "",
    email: "",
    phone: "",
    notes: "",
  });

  const [hireForm, setHireForm] = useState({
    employeeNo: "",
    firstName: "",
    middleName: "",
    lastName: "",
    startDate: new Date().toISOString().slice(0, 10),
    payBasis: "monthly",
    rateAmount: "",
    standardWorkDaysPerMonth: "22",
    standardHoursPerDay: "8",
    region: "NCR",
  });

  const load = useCallback(async () => {
    const response = await fetch(`/api/recruitment?organizationId=${organizationId}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not load recruitment.");
      return;
    }

    const nextReqs = payload.requisitions ?? [];
    setRequisitions(nextReqs);
    setApplicants(payload.applicants ?? []);
    setSelectedReqId((current) =>
      current && nextReqs.some((req: Requisition) => req.id === current)
        ? current
        : nextReqs[0]?.id ?? null,
    );
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  async function createApplicant(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/recruitment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...formApp,
        entityType: "applicant",
        organizationId,
        requisitionId: Number(formApp.requisitionId),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setNotice(payload.error ?? "Failed to add candidate.");

    setShowAppModal(false);
    setFormApp({ requisitionId: "", fullName: "", email: "", phone: "", notes: "" });
    await load();
    setSelectedReqId(payload.requisitionId);
    setNotice("Candidate added to pipeline.");
  }

  async function updateStage(applicantId: number, nextStage: string) {
    const applicant = applicants.find((row) => row.id === applicantId);
    const requisition = applicant ? requisitions.find((row) => row.id === applicant.requisitionId) : null;
    let offeredSalary: number | undefined;

    if (nextStage === "offer") {
      const suggested = applicant?.offeredSalary ?? requisition?.salaryMax ?? requisition?.salaryMin ?? "";
      const entered = window.prompt(
        "Monthly-equivalent offer amount (PHP). This becomes the authoritative offer used by Hire & onboard.",
        String(suggested ?? ""),
      );
      if (entered === null) return;
      offeredSalary = Number(entered);
      if (!Number.isFinite(offeredSalary) || offeredSalary <= 0) {
        setNotice("Enter a valid monthly-equivalent offer amount before moving to Job Offer.");
        return;
      }
    }

    const response = await fetch("/api/recruitment", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicantId, stage: nextStage, offeredSalary }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setNotice(payload.error ?? "Could not move candidate.");

    await load();
    setNotice(nextStage === "offer" ? "Candidate moved to Job Offer with the recorded offer amount." : `Candidate moved to ${nextStage}.`);
  }

  function prepareHire(applicant: Applicant) {
    const requisition = requisitions.find((row) => row.id === applicant.requisitionId);
    const names = splitName(applicant.fullName);
    setHiringApplicant(applicant);
    setHireForm({
      employeeNo: "",
      firstName: names.firstName,
      middleName: names.middleName,
      lastName: names.lastName,
      startDate: new Date().toISOString().slice(0, 10),
      payBasis: "monthly",
      rateAmount: String(applicant.offeredSalary ?? requisition?.salaryMax ?? requisition?.salaryMin ?? ""),
      standardWorkDaysPerMonth: "22",
      standardHoursPerDay: "8",
      region: "NCR",
    });
  }

  async function hireCandidate(event: React.FormEvent) {
    event.preventDefault();
    if (!hiringApplicant) return;
    setSavingHire(true);
    try {
      const response = await fetch("/api/recruitment/hire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicantId: hiringApplicant.id,
          employeeNo: hireForm.employeeNo || undefined,
          firstName: hireForm.firstName,
          middleName: hireForm.middleName,
          lastName: hireForm.lastName,
          startDate: hireForm.startDate,
          payBasis: hireForm.payBasis,
          rateAmount: Number(hireForm.rateAmount),
          standardWorkDaysPerMonth: Number(hireForm.standardWorkDaysPerMonth),
          standardHoursPerDay: Number(hireForm.standardHoursPerDay),
          region: hireForm.region,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error ?? "Could not complete the hire.");
        return;
      }
      if (payload.approvalRequired) {
        setNotice(`Hire request #${payload.businessProcess?.id ?? "pending"} is ${payload.businessProcess?.status ?? "awaiting review"}. No worker or payroll records were created. Complete the HCM Inbox approvals, then submit these same details again to finish onboarding.`);
        return;
      }

      setHiringApplicant(null);
      await load();
      setNotice(
        `${payload.employee.firstName} ${payload.employee.lastName} is now employee ${payload.employee.employeeNo}, assigned to ${payload.position.code}, with onboarding created.`,
      );
    } finally {
      setSavingHire(false);
    }
  }

  const activeReq = requisitions.find((row) => row.id === selectedReqId) ?? requisitions[0];
  const reqApplicants = applicants.filter((row) => (activeReq ? row.requisitionId === activeReq.id : false));
  const totalHired = applicants.filter((row) => row.stage === "hired").length;
  const hiringReq = hiringApplicant
    ? requisitions.find((row) => row.id === hiringApplicant.requisitionId) ?? null
    : null;
  const hiringMonthlyBudget =
    hiringReq?.annualPositionBudget && Number(hiringReq.annualPositionBudget) > 0
      ? Number(hiringReq.annualPositionBudget) / 12
      : null;

  const stageCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const applicant of reqApplicants) map.set(applicant.stage, (map.get(applicant.stage) ?? 0) + 1);
    return map;
  }, [reqApplicants]);

  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">TALENT ACQUISITION</div>
          <h1>Recruitment</h1>
          <p>
            Position-owned requisitions inherit the approved role, unit, employment type, and budget.
            Hiring converts the candidate into an employee, onboarding checklist, and incumbent assignment in one controlled action.
          </p>
        </div>
        <div className="page-actions">
          <button
            className="secondary-button"
            onClick={() => setShowAppModal(true)}
            disabled={!requisitions.some((row) => !["filled", "cancelled"].includes(row.status))}
          >
            <UserPlus size={15} /> Add candidate
          </button>
        </div>
      </div>

      <div className="notice notice-blue" style={{ marginBottom: 16 }}>
        <UserCheck size={15} />
        <span>
          New hiring demand starts in <strong>Planning</strong>: approve a vacant position, open its requisition,
          record the candidate&apos;s offer, then use <strong>Hire &amp; onboard</strong>. Legacy requisitions remain
          visible for history and candidate management, but they cannot create employees.
        </span>
      </div>

      <section className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="stat-card">
          <div className="stat-icon mint"><FileText size={19} /></div>
          <p>REQUISITIONS</p>
          <h3>{requisitions.filter((row) => !["filled", "cancelled"].includes(row.status)).length}</h3>
          <span>{requisitions.filter((row) => row.positionId != null).length} position-linked</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon purple"><Users size={19} /></div>
          <p>APPLICANTS</p>
          <h3>{applicants.length}</h3>
          <span>Across visible openings</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon blue"><Star size={19} /></div>
          <p>IN INTERVIEW</p>
          <h3>{applicants.filter((row) => row.stage === "interview").length}</h3>
          <span>Ready for assessment</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon orange"><CheckCircle2 size={19} /></div>
          <p>HIRED</p>
          <h3>{totalHired}</h3>
          <span>Converted to employees</span>
        </article>
      </section>

      {showAppModal && (
        <article className="card" style={{ padding: 20, marginBottom: 18 }}>
          <div className="card-header" style={{ padding: 0, marginBottom: 14 }}>
            <div>
              <div className="card-kicker">CANDIDATE</div>
              <h2 style={{ margin: 0 }}>Add candidate</h2>
            </div>
            <button className="icon-button" type="button" onClick={() => setShowAppModal(false)}><X size={16} /></button>
          </div>
          <form onSubmit={createApplicant}>
            <div className="setting-form">
              <label>Requisition
                <select required value={formApp.requisitionId} onChange={(event) => setFormApp({ ...formApp, requisitionId: event.target.value })}>
                  <option value="">Select opening</option>
                  {requisitions.filter((row) => !["filled", "cancelled"].includes(row.status)).map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.positionCode ? `${row.positionCode} · ` : ""}{row.title} ({row.department})
                    </option>
                  ))}
                </select>
              </label>
              <label>Full name<input required value={formApp.fullName} onChange={(event) => setFormApp({ ...formApp, fullName: event.target.value })} /></label>
              <label>Email<input required type="email" value={formApp.email} onChange={(event) => setFormApp({ ...formApp, email: event.target.value })} /></label>
              <label>Mobile<input value={formApp.phone} onChange={(event) => setFormApp({ ...formApp, phone: event.target.value })} /></label>
              <label style={{ gridColumn: "1 / -1" }}>Recruiter notes<input value={formApp.notes} onChange={(event) => setFormApp({ ...formApp, notes: event.target.value })} /></label>
            </div>
            <div className="run-actions">
              <button type="button" className="secondary-button" onClick={() => setShowAppModal(false)}>Cancel</button>
              <button className="primary-button">Add candidate</button>
            </div>
          </form>
        </article>
      )}

      {hiringApplicant && (
        <article className="card" style={{ padding: 20, marginBottom: 18, border: "1.5px solid var(--green-border)" }}>
          <div className="card-header" style={{ padding: 0, marginBottom: 14 }}>
            <div>
              <div className="card-kicker">HIRE &amp; ONBOARD</div>
              <h2 style={{ margin: 0 }}>Convert {hiringApplicant.fullName} into an employee</h2>
              <p>First submit the candidate offer and employment terms for independent HCM review. After approval, submit the unchanged details again to atomically create the employee, payroll pay profile, onboarding checklist, and incumbent assignment.</p>
            </div>
            <button className="icon-button" type="button" onClick={() => setHiringApplicant(null)}><X size={16} /></button>
          </div>

          {hiringReq?.positionCode && (
            <div className="notice notice-green" style={{ marginBottom: 14 }}>
              <UserCheck size={15} />
              <span>
                Position <strong>{hiringReq.positionCode}</strong>
                {hiringMonthlyBudget ? <> · approved monthly-equivalent budget <strong>{peso(hiringMonthlyBudget)}</strong></> : null}
              </span>
            </div>
          )}

          <form onSubmit={hireCandidate}>
            <div className="setting-form">
              <label>Employee no. (optional)<input value={hireForm.employeeNo} onChange={(event) => setHireForm({ ...hireForm, employeeNo: event.target.value })} placeholder="Auto-generated if blank" /></label>
              <label>Start date<input required type="date" value={hireForm.startDate} onChange={(event) => setHireForm({ ...hireForm, startDate: event.target.value })} /></label>
              <label>First name<input required value={hireForm.firstName} onChange={(event) => setHireForm({ ...hireForm, firstName: event.target.value })} /></label>
              <label>Middle name<input value={hireForm.middleName} onChange={(event) => setHireForm({ ...hireForm, middleName: event.target.value })} /></label>
              <label>Last name<input required value={hireForm.lastName} onChange={(event) => setHireForm({ ...hireForm, lastName: event.target.value })} /></label>
              <label>Region<input required value={hireForm.region} onChange={(event) => setHireForm({ ...hireForm, region: event.target.value })} /></label>
              <label>Pay basis
                <select value={hireForm.payBasis} onChange={(event) => setHireForm({ ...hireForm, payBasis: event.target.value })}>
                  <option value="monthly">Monthly salaried</option>
                  <option value="daily">Daily paid</option>
                  <option value="hourly">Hourly paid</option>
                </select>
              </label>
              <label>Pay rate<input required type="number" min="0.01" step="0.01" value={hireForm.rateAmount} onChange={(event) => setHireForm({ ...hireForm, rateAmount: event.target.value })} /></label>
              <label>Standard work days / month<input required type="number" min="1" max="31" step="0.5" value={hireForm.standardWorkDaysPerMonth} onChange={(event) => setHireForm({ ...hireForm, standardWorkDaysPerMonth: event.target.value })} /></label>
              <label>Standard hours / day<input required type="number" min="1" max="24" step="0.5" value={hireForm.standardHoursPerDay} onChange={(event) => setHireForm({ ...hireForm, standardHoursPerDay: event.target.value })} /></label>
            </div>
            <div className="run-actions">
              <button type="button" className="secondary-button" onClick={() => setHiringApplicant(null)} disabled={savingHire}>Cancel</button>
              <button className="primary-button" disabled={savingHire}>{savingHire ? "Submitting…" : "Request review / complete approved hire"}</button>
            </div>
          </form>
        </article>
      )}

      <div className="tabs">
        {requisitions.map((req) => (
          <button key={req.id} className={`tab ${activeReq?.id === req.id ? "active" : ""}`} onClick={() => setSelectedReqId(req.id)}>
            {req.positionCode ? `${req.positionCode} · ` : ""}{req.title} <b>{req.applicantCount}</b>
          </button>
        ))}
      </div>

      {activeReq && (
        <article className="card" style={{ padding: 14, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
            <div>
              <div className="card-kicker">{activeReq.positionCode ? `POSITION ${activeReq.positionCode}` : "STANDALONE REQUISITION"}</div>
              <h2 style={{ margin: "2px 0" }}>{activeReq.title}</h2>
              <p style={{ margin: 0 }}>{activeReq.department} · {activeReq.employmentType} · {activeReq.status} · target {activeReq.headcount}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <strong>
                {activeReq.salaryMin && activeReq.salaryMax && activeReq.salaryMin === activeReq.salaryMax
                  ? `${peso(activeReq.salaryMax)}/mo approved budget`
                  : activeReq.salaryMin || activeReq.salaryMax
                    ? `${peso(activeReq.salaryMin)} – ${peso(activeReq.salaryMax)}`
                    : "Budget not set"}
              </strong>
              <span style={{ display: "block", fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
                {activeReq.hiredCount} hired · {activeReq.applicantCount} applicants
              </span>
              {activeReq.planHandoffEvidence?.version === "hcm-plan-requisition-lineage-v1" && (
                <span style={{ display: "block", fontSize: 10, color: "var(--muted)", marginTop: 5 }}>
                  Plan #{activeReq.planHandoffEvidence.planId} · published baseline v{activeReq.planHandoffEvidence.baselineVersion} · applied execution #{activeReq.planHandoffEvidence.executionId}
                </span>
              )}
            </div>
          </div>
        </article>
      )}

      {!activeReq && <div className="empty-state">No requisitions are visible. Approve a position in Planning, then open it for recruitment.</div>}

      {activeReq && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(190px, 1fr))", gap: 12, overflowX: "auto" }}>
          {STAGES.map((stage) => {
            const stageApplicants = reqApplicants.filter((applicant) => applicant.stage === stage.key);
            return (
              <div key={stage.key} style={{ background: "var(--canvas-subtle)", borderRadius: 10, padding: 12, minWidth: 190 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid var(--line)" }}>
                  <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>{stage.label}</span>
                  <b style={{ fontSize: 10, padding: "1px 6px", borderRadius: 10, background: "white" }}>{stageCounts.get(stage.key) ?? 0}</b>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {stageApplicants.length === 0 && <div style={{ fontSize: 10.5, color: "var(--muted-light)", textAlign: "center", padding: "16px 0" }}>Empty</div>}
                  {stageApplicants.map((applicant) => {
                    const stageIndex = STAGES.findIndex((row) => row.key === stage.key);
                    const nextStage = STAGES[stageIndex + 1]?.key;
                    return (
                      <article key={applicant.id} className="card" style={{ padding: 12 }}>
                        <strong style={{ fontSize: 12, display: "block" }}>{applicant.fullName}</strong>
                        <span style={{ fontSize: 10, color: "var(--muted)", display: "block", marginTop: 2 }}>{applicant.email}</span>
                        {applicant.notes && <p style={{ margin: "6px 0", fontSize: 10.5, lineHeight: 1.4 }}>{applicant.notes}</p>}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 6, borderTop: "1px solid var(--line)" }}>
                          <span style={{ fontSize: 9.5, color: "var(--muted)" }}>★ {applicant.rating}/5</span>
                          {stage.key === "offer" && activeReq.positionId ? (
                            <button className="primary-button" style={{ height: 26, fontSize: 9.5, padding: "0 8px" }} onClick={() => prepareHire(applicant)}>
                              <UserCheck size={11} /> Hire & onboard
                            </button>
                          ) : stage.key === "offer" && !activeReq.positionId ? (
                            <span className="status" style={{ fontSize: 8 }}>Legacy requisition</span>
                          ) : stage.key === "hired" ? (
                            <span className="status status-verified" style={{ fontSize: 8 }}>Employee #{applicant.hiredEmployeeId ?? "created"} ✓</span>
                          ) : nextStage ? (
                            <button className="secondary-button" style={{ height: 24, fontSize: 9.5, padding: "0 7px" }} onClick={() => void updateStage(applicant.id, nextStage)}>
                              Next <ChevronRight size={10} />
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
