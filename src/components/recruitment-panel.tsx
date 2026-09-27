"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, ChevronRight, FileText, Mail, Phone, Plus, Star, UserPlus, Users, X } from "lucide-react";

type Requisition = {
  id: number;
  title: string;
  department: string;
  headcount: number;
  salaryMin: string | null;
  salaryMax: string | null;
  employmentType: string;
  status: string;
  description: string;
  applicantCount: number;
  interviewCount: number;
  offerCount: number;
};

type Applicant = {
  id: number;
  requisitionId: number;
  fullName: string;
  email: string;
  phone: string;
  stage: string;
  rating: number;
  notes: string;
  offeredSalary: string | null;
  createdAt: string;
};

const STAGES = [
  { key: "applied", label: "Applied" },
  { key: "screening", label: "Screening" },
  { key: "interview", label: "Interview" },
  { key: "offer", label: "Job Offer" },
  { key: "hired", label: "Hired" },
];

export function RecruitmentPanel({ organizationId, setNotice }: { organizationId: number; setNotice: (m: string) => void }) {
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [selectedReqId, setSelectedReqId] = useState<number | null>(null);
  const [showReqModal, setShowReqModal] = useState(false);
  const [showAppModal, setShowAppModal] = useState(false);

  const [formReq, setFormReq] = useState({
    title: "",
    department: "Engineering",
    headcount: 1,
    salaryMin: "",
    salaryMax: "",
    employmentType: "Full-time",
    description: "",
  });

  const [formApp, setFormApp] = useState({
    requisitionId: "",
    fullName: "",
    email: "",
    phone: "",
    notes: "",
  });

  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((current) => current + 1), []);

  // The fetch lives in the effect so every state update happens after an await,
  // and `alive` stops a slow response for one client overwriting a newer one.
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(`/api/recruitment?organizationId=${organizationId}${selectedReqId ? `&requisitionId=${selectedReqId}` : ""}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!alive) return;
      setRequisitions(data.requisitions ?? []);
      setApplicants(data.applicants ?? []);
      if (!selectedReqId && data.requisitions?.length > 0) {
        setSelectedReqId(data.requisitions[0].id);
      }
    })();
    return () => {
      alive = false;
    };
  }, [organizationId, selectedReqId, nonce]);

  async function createRequisition(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/recruitment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...formReq,
        entityType: "requisition",
        organizationId,
        headcount: Number(formReq.headcount),
        salaryMin: Number(formReq.salaryMin) || undefined,
        salaryMax: Number(formReq.salaryMax) || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error ?? "Failed to create requisition.");
      return;
    }
    setNotice("Job requisition opened.");
    setShowReqModal(false);
    reload();
  }

  async function createApplicant(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/recruitment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...formApp,
        entityType: "applicant",
        organizationId,
        requisitionId: Number(formApp.requisitionId),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error ?? "Failed to add candidate.");
      return;
    }
    setNotice("Candidate added to pipeline.");
    setShowAppModal(false);
    setFormApp({ requisitionId: "", fullName: "", email: "", phone: "", notes: "" });
    reload();
  }

  async function updateStage(applicantId: number, nextStage: string) {
    const res = await fetch("/api/recruitment", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicantId, stage: nextStage }),
    });
    if (res.ok) {
      setNotice(`Candidate moved to ${nextStage}.`);
      reload();
    }
  }

  const activeReq = requisitions.find((r) => r.id === selectedReqId) ?? requisitions[0];
  const reqApplicants = applicants.filter((a) => (selectedReqId ? a.requisitionId === selectedReqId : true));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Recruitment Pipeline &amp; Talent Acquisition (ATS)</h2>
          <p className="heading-copy">Requisition management, candidate pipelines, interview scheduling, and job offer tracking.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="secondary-button" onClick={() => setShowAppModal(true)}>
            <UserPlus size={15} className="i-purple" /> Add Candidate
          </button>
          <button className="primary-button" onClick={() => setShowReqModal(true)}>
            <Plus size={15} className="i-green" /> Open Requisition
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="stat-card">
          <div className="stat-icon mint"><FileText size={19} /></div>
          <p>ACTIVE REQUISITIONS</p>
          <h3>{requisitions.length}</h3>
          <span>Open hiring slots</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon purple"><Users size={19} /></div>
          <p>TOTAL APPLICANTS</p>
          <h3>{applicants.length}</h3>
          <span>Across all pipelines</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon blue"><Star size={19} /></div>
          <p>IN INTERVIEWS</p>
          <h3>{applicants.filter((a) => a.stage === "interview").length}</h3>
          <span>Screened candidates</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon orange"><CheckCircle2 size={19} /></div>
          <p>OFFERS EXTENDED</p>
          <h3>{applicants.filter((a) => a.stage === "offer" || a.stage === "hired").length}</h3>
          <span>Contract stage</span>
        </article>
      </div>

      {showReqModal && (
        <article className="card" style={{ padding: 20, marginBottom: 18 }}>
          <div className="card-header" style={{ padding: 0, marginBottom: 14 }}>
            <div><div className="card-kicker">NEW VACANCY</div><h2 style={{ margin: 0 }}>Open Job Requisition</h2></div>
            <button className="icon-button" onClick={() => setShowReqModal(false)}><X size={16} /></button>
          </div>
          <form onSubmit={createRequisition}>
            <div className="setting-form">
              <label>Job Title
                <input required placeholder="e.g. Senior Payroll Accountant" value={formReq.title} onChange={(e) => setFormReq({ ...formReq, title: e.target.value })} />
              </label>
              <label>Department
                <input required placeholder="e.g. Finance & Accounting" value={formReq.department} onChange={(e) => setFormReq({ ...formReq, department: e.target.value })} />
              </label>
              <label>Headcount Target
                <input required type="number" min="1" value={formReq.headcount} onChange={(e) => setFormReq({ ...formReq, headcount: Number(e.target.value) })} />
              </label>
              <label>Employment Type
                <select value={formReq.employmentType} onChange={(e) => setFormReq({ ...formReq, employmentType: e.target.value })}>
                  <option>Full-time</option><option>Part-time</option><option>Contractual</option><option>Probationary</option>
                </select>
              </label>
              <label>Budget Minimum (PHP)
                <input type="number" placeholder="45000" value={formReq.salaryMin} onChange={(e) => setFormReq({ ...formReq, salaryMin: e.target.value })} />
              </label>
              <label>Budget Maximum (PHP)
                <input type="number" placeholder="70000" value={formReq.salaryMax} onChange={(e) => setFormReq({ ...formReq, salaryMax: e.target.value })} />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>Job Description / Key Competencies
                <textarea rows={2} placeholder="Brief summary of duties..." value={formReq.description} onChange={(e) => setFormReq({ ...formReq, description: e.target.value })} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--line)" }} />
              </label>
            </div>
            <div className="run-actions">
              <button type="button" className="secondary-button" onClick={() => setShowReqModal(false)}>Cancel</button>
              <button className="primary-button">Publish Requisition</button>
            </div>
          </form>
        </article>
      )}

      {showAppModal && (
        <article className="card" style={{ padding: 20, marginBottom: 18, border: "1.5px solid var(--green-border)" }}>
          <div className="card-header" style={{ padding: 0, marginBottom: 14 }}>
            <div><div className="card-kicker">TALENT PIPELINE</div><h2 style={{ margin: 0 }}>Add Candidate Profile</h2></div>
            <button className="icon-button" onClick={() => setShowAppModal(false)}><X size={16} /></button>
          </div>
          <form onSubmit={createApplicant}>
            <div className="setting-form">
              <label>Requisition
                <select required value={formApp.requisitionId} onChange={(e) => setFormApp({ ...formApp, requisitionId: e.target.value })}>
                  <option value="">Select Opening…</option>
                  {requisitions.map((r) => <option key={r.id} value={r.id}>{r.title} ({r.department})</option>)}
                </select>
              </label>
              <label>Candidate Full Name
                <input required placeholder="e.g. Maria Clara Santos" value={formApp.fullName} onChange={(e) => setFormApp({ ...formApp, fullName: e.target.value })} />
              </label>
              <label>Email Address
                <input required type="email" placeholder="maria@dev.ph" value={formApp.email} onChange={(e) => setFormApp({ ...formApp, email: e.target.value })} />
              </label>
              <label>Mobile Number
                <input placeholder="09171234567" value={formApp.phone} onChange={(e) => setFormApp({ ...formApp, phone: e.target.value })} />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>Recruiter Notes / Experience Summary
                <input placeholder="Key strengths, notice period, asking rate..." value={formApp.notes} onChange={(e) => setFormApp({ ...formApp, notes: e.target.value })} />
              </label>
            </div>
            <div className="run-actions">
              <button type="button" className="secondary-button" onClick={() => setShowAppModal(false)}>Cancel</button>
              <button className="primary-button">Add to Pipeline</button>
            </div>
          </form>
        </article>
      )}

      {/* Requisitions selector tabs */}
      <div className="tabs">
        {requisitions.map((req) => (
          <button
            key={req.id}
            className={`tab ${selectedReqId === req.id ? "active" : ""}`}
            onClick={() => setSelectedReqId(req.id)}
          >
            {req.title} <b>{req.applicantCount}</b>
          </button>
        ))}
      </div>

      {activeReq && (
        <div style={{ background: "white", border: "1px solid var(--line)", borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong style={{ fontSize: 14 }}>{activeReq.title}</strong>
              <span style={{ display: "block", color: "var(--muted)", fontSize: 11 }}>{activeReq.department} · {activeReq.employmentType} · Target: {activeReq.headcount} headcount</span>
            </div>
            <div>
              {activeReq.salaryMin && <strong style={{ color: "var(--green)", fontSize: 13 }}>₱{Number(activeReq.salaryMin).toLocaleString()} – ₱{Number(activeReq.salaryMax).toLocaleString()}</strong>}
            </div>
          </div>
        </div>
      )}

      {/* Kanban Pipeline Columns */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, overflowX: "auto" }}>
        {STAGES.map((stage) => {
          const stageApps = reqApplicants.filter((a) => a.stage === stage.key);
          return (
            <div key={stage.key} style={{ background: "var(--canvas-subtle)", borderRadius: 10, padding: 12, minWidth: 200 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid var(--line)" }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>{stage.label}</span>
                <b style={{ fontSize: 10, padding: "1px 6px", borderRadius: 10, background: "white", color: "var(--ink)" }}>{stageApps.length}</b>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {stageApps.length === 0 && <div style={{ fontSize: 10.5, color: "var(--muted-light)", textAlign: "center", padding: "16px 0" }}>Empty</div>}
                {stageApps.map((app) => (
                  <div key={app.id} className="card" style={{ padding: 12, border: "1px solid var(--line)", boxShadow: "var(--shadow-xs)" }}>
                    <strong style={{ fontSize: 12, display: "block" }}>{app.fullName}</strong>
                    <span style={{ fontSize: 10, color: "var(--muted)", display: "block", marginTop: 2 }}>{app.email}</span>
                    {app.notes && <p style={{ margin: "6px 0", fontSize: 10.5, color: "var(--ink-secondary)", lineHeight: 1.4 }}>{app.notes}</p>}

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 6, borderTop: "1px solid #edf2ee" }}>
                      <span style={{ fontSize: 9.5, color: "var(--muted)" }}>★ {app.rating}/5</span>
                      {stage.key !== "hired" && (
                        <button
                          className="secondary-button"
                          style={{ height: 22, fontSize: 9.5, padding: "0 6px" }}
                          onClick={() => {
                            const nextIdx = STAGES.findIndex((s) => s.key === stage.key) + 1;
                            if (nextIdx < STAGES.length) updateStage(app.id, STAGES[nextIdx].key);
                          }}
                        >
                          Next <ChevronRight size={10} />
                        </button>
                      )}
                      {stage.key === "hired" && (
                        <span className="status status-verified" style={{ fontSize: 8 }}>Hired ✓</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
