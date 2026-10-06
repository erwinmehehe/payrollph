"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FileText,
  Plus,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";

type Policy = {
  id: number;
  policyCode: string;
  title: string;
  category: string;
  version: string;
  status: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  targetConditions: Record<string, unknown>;
  requiresAcknowledgement: boolean;
  acknowledgementDueDays: number;
  contentSha256: string;
  approvedByName: string | null;
  approvedAt: string | null;
};

type PolicyAssignment = {
  id: number;
  status: string;
  dueAt: string | null;
  acknowledgedAt: string | null;
  acknowledgementSha256: string | null;
  overdue: boolean;
  employee: null | { id: number; employeeNo: string; name: string; orgUnitId: number | null };
  policy: Policy | null;
};

type Requirement = {
  id: number;
  code: string;
  name: string;
  kind: string;
  mandatory: boolean;
  expiryRequired: boolean;
  submissionDueDays: number;
  renewalLeadDays: number;
  active: boolean;
};

type Compliance = {
  id: number;
  status: string;
  dueAt: string | null;
  expiresAt: string | null;
  employee: null | { id: number; employeeNo: string; name: string; orgUnitId: number | null };
  requirement: Requirement | null;
  document: null | { id: number; fileName: string; scannedClean: boolean; createdAt: string };
};

type Payload = {
  policies: Policy[];
  assignments: PolicyAssignment[];
  requirements: Requirement[];
  compliance: Compliance[];
  employees: Array<{ id: number; employeeNo: string; name: string }>;
  orgUnits: Array<{ id: number; name: string; code: string }>;
  jobProfiles: Array<{ id: number; title: string; family: string; level: string; grade: string | null }>;
  canDefineRules: boolean;
  analytics: {
    publishedPolicies: number;
    pendingAcknowledgements: number;
    overdueAcknowledgements: number;
    missingDocuments: number;
    submittedDocuments: number;
    expiringDocuments: number;
    expiredDocuments: number;
  };
};

function dateLabel(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(
    new Date(value.length === 10 ? value + "T00:00:00+08:00" : value),
  );
}

function targetConditions(input: {
  orgUnitId: string;
  employmentType: string;
  location: string;
  jobProfileId: string;
}) {
  return {
    ...(input.orgUnitId ? { orgUnitIds: [Number(input.orgUnitId)] } : {}),
    ...(input.employmentType ? { employmentTypes: [input.employmentType] } : {}),
    ...(input.location ? { locations: [input.location] } : {}),
    ...(input.jobProfileId ? { jobProfileIds: [Number(input.jobProfileId)] } : {}),
    employeeStatuses: ["Active"],
  };
}

export function HcmDocumentsPanel({
  organizationId,
  setNotice,
}: {
  organizationId: number;
  setNotice: (message: string) => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [requirementOpen, setRequirementOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [policyCode, setPolicyCode] = useState("");
  const [policyTitle, setPolicyTitle] = useState("");
  const [policyCategory, setPolicyCategory] = useState("company_policy");
  const [policyVersion, setPolicyVersion] = useState("1.0");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [ackDueDays, setAckDueDays] = useState(7);
  const [requiresAck, setRequiresAck] = useState(true);
  const [policyContent, setPolicyContent] = useState("");
  const [policyOrgUnitId, setPolicyOrgUnitId] = useState("");
  const [policyEmploymentType, setPolicyEmploymentType] = useState("");
  const [policyLocation, setPolicyLocation] = useState("");
  const [policyJobProfileId, setPolicyJobProfileId] = useState("");

  const [requirementCode, setRequirementCode] = useState("");
  const [requirementName, setRequirementName] = useState("");
  const [requirementKind, setRequirementKind] = useState("government_id");
  const [requirementExpiry, setRequirementExpiry] = useState(false);
  const [submissionDueDays, setSubmissionDueDays] = useState(14);
  const [renewalLeadDays, setRenewalLeadDays] = useState(30);
  const [requirementOrgUnitId, setRequirementOrgUnitId] = useState("");
  const [requirementEmploymentType, setRequirementEmploymentType] = useState("");
  const [requirementLocation, setRequirementLocation] = useState("");
  const [requirementJobProfileId, setRequirementJobProfileId] = useState("");

  const [uploadComplianceId, setUploadComplianceId] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadExpiry, setUploadExpiry] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/hcm/documents?organizationId=${organizationId}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load HCM documents.");
      setData(payload as Payload);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load HCM documents.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  const policyAssignmentCounts = useMemo(() => {
    const counts = new Map<number, { assigned: number; acknowledged: number; overdue: number; waived: number }>();
    for (const row of data?.assignments ?? []) {
      const policyId = row.policy?.id;
      if (!policyId) continue;
      const current = counts.get(policyId) ?? { assigned: 0, acknowledged: 0, overdue: 0, waived: 0 };
      if (row.status === "assigned") current.assigned += 1;
      if (row.status === "acknowledged") current.acknowledged += 1;
      if (row.status === "waived") current.waived += 1;
      if (row.overdue) current.overdue += 1;
      counts.set(policyId, current);
    }
    return counts;
  }, [data]);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/hcm/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, ...body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "HCM document action failed.");
    return payload;
  }

  async function savePolicy() {
    setBusy(true);
    try {
      await post({
        action: "save-policy-draft",
        policyCode,
        title: policyTitle,
        category: policyCategory,
        version: policyVersion,
        effectiveFrom,
        targetConditions: targetConditions({
          orgUnitId: policyOrgUnitId,
          employmentType: policyEmploymentType,
          location: policyLocation,
          jobProfileId: policyJobProfileId,
        }),
        requiresAcknowledgement: requiresAck,
        acknowledgementDueDays: ackDueDays,
        content: policyContent,
      });
      setPolicyOpen(false);
      setPolicyCode("");
      setPolicyTitle("");
      setPolicyContent("");
      await load();
      setNotice("Policy draft saved. Publish it when the version is approved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save policy.");
    } finally {
      setBusy(false);
    }
  }

  async function publishPolicy(policy: Policy) {
    setBusy(true);
    try {
      const payload = await post({ action: "publish-policy", policyId: policy.id });
      await load();
      setNotice(
        `${policy.policyCode} v${policy.version} published to ${payload.materialized?.targeted ?? 0} targeted employee(s).`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not publish policy.");
    } finally {
      setBusy(false);
    }
  }

  async function createRequirement() {
    setBusy(true);
    try {
      const payload = await post({
        action: "create-document-requirement",
        code: requirementCode,
        name: requirementName,
        kind: requirementKind,
        mandatory: true,
        expiryRequired: requirementExpiry,
        submissionDueDays,
        renewalLeadDays,
        targetConditions: targetConditions({
          orgUnitId: requirementOrgUnitId,
          employmentType: requirementEmploymentType,
          location: requirementLocation,
          jobProfileId: requirementJobProfileId,
        }),
      });
      setRequirementOpen(false);
      setRequirementCode("");
      setRequirementName("");
      await load();
      setNotice(
        `Document requirement created for ${payload.materialized?.targeted ?? 0} targeted employee(s).`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create document requirement.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyDocument(row: Compliance) {
    setBusy(true);
    try {
      await post({ action: "verify-document", complianceId: row.id });
      await load();
      setNotice("Employee document verified and compliance status recalculated.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not verify document.");
    } finally {
      setBusy(false);
    }
  }

  async function waive(kind: "policy" | "document", id: number) {
    const reason = window.prompt("Enter the documented waiver reason:");
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      await post(kind === "policy"
        ? { action: "waive-policy-assignment", assignmentId: id, reason }
        : { action: "waive-document-requirement", complianceId: id, reason });
      await load();
      setNotice(kind === "policy" ? "Acknowledgement requirement waived with audit evidence." : "Document requirement waived with audit evidence.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not record waiver.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadRequiredDocument() {
    if (!uploadFile || !uploadComplianceId) return;
    const row = data?.compliance.find((item) => item.id === Number(uploadComplianceId));
    if (!row?.employee || !row.requirement) return;
    if (row.requirement.expiryRequired && !uploadExpiry) {
      setNotice("This requirement needs an expiry date.");
      return;
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.set("organizationId", String(organizationId));
      form.set("employeeId", String(row.employee.id));
      form.set("requirementId", String(row.requirement.id));
      form.set("kind", row.requirement.kind);
      form.set("file", uploadFile);
      if (uploadExpiry) form.set("expiresAt", uploadExpiry);

      const response = await fetch("/api/documents", { method: "POST", body: form });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not upload employee document.");

      setUploadFile(null);
      setUploadExpiry("");
      setUploadOpen(false);
      await load();
      setNotice("Document uploaded securely and queued for HR verification.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not upload employee document.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <div className="card" style={{ padding: 24 }}>{loading ? "Loading HCM document controls…" : "Documents unavailable."}</div>;
  }

  const openCompliance = data.compliance.filter((row) => ["missing", "submitted", "expiring", "expired"].includes(row.status));
  const pendingAcks = data.assignments.filter((row) => row.status === "assigned");

  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">DOCUMENTS &amp; POLICIES</div>
          <h1>Turn employee files into governed HCM obligations.</h1>
          <p>Publish versioned policies, prove acknowledgements, require employee documents, track renewal dates and feed expiry events into Automation Studio.</p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          {data.canDefineRules && <button className="secondary-button" onClick={() => setRequirementOpen((value) => !value)}><Plus size={15} /> Requirement</button>}
          {data.canDefineRules && <button className="primary-button" onClick={() => setPolicyOpen((value) => !value)}><Plus size={15} /> Policy</button>}
        </div>
      </div>

      <section className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="stat-card"><div className="stat-icon purple"><BookOpen size={19} /></div><p>PUBLISHED POLICIES</p><h3>{data.analytics.publishedPolicies}</h3><span>Version-controlled</span></article>
        <article className="stat-card"><div className="stat-icon amber"><Clock3 size={19} /></div><p>PENDING ACKS</p><h3>{data.analytics.pendingAcknowledgements}</h3><span>{data.analytics.overdueAcknowledgements} overdue</span></article>
        <article className="stat-card"><div className="stat-icon red"><AlertTriangle size={19} /></div><p>MISSING DOCS</p><h3>{data.analytics.missingDocuments}</h3><span>{data.analytics.submittedDocuments} awaiting verification</span></article>
        <article className="stat-card"><div className="stat-icon green"><FileCheck2 size={19} /></div><p>RENEWAL RISK</p><h3>{data.analytics.expiringDocuments + data.analytics.expiredDocuments}</h3><span>{data.analytics.expiringDocuments} expiring · {data.analytics.expiredDocuments} expired</span></article>
      </section>

      <article className="card" style={{ marginTop: 16 }}>
        <div className="notice notice-slate" style={{ margin: 0 }}>
          <ShieldCheck size={16} className="i-purple" />
          <span><strong>Evidence boundary.</strong> Published policy versions are immutable. Employees acknowledge their own assigned content hash. HR can waive with a reason, but cannot create employee acknowledgement evidence.</span>
        </div>
      </article>

      {policyOpen && data.canDefineRules && (
        <article className="card" style={{ marginTop: 16 }}>
          <div className="card-header"><div><div className="card-kicker">NEW POLICY VERSION</div><h2>Draft before publish</h2><p>Publishing requires recent MFA and materializes employee-specific assignments from the targeting rules.</p></div></div>
          <div className="card-body">
            <div className="setting-form">
              <label>Policy code<input value={policyCode} onChange={(e) => setPolicyCode(e.target.value)} placeholder="EMPLOYEE-HANDBOOK" /></label>
              <label>Title<input value={policyTitle} onChange={(e) => setPolicyTitle(e.target.value)} placeholder="Employee Handbook" /></label>
              <label>Category<input value={policyCategory} onChange={(e) => setPolicyCategory(e.target.value)} /></label>
              <label>Version<input value={policyVersion} onChange={(e) => setPolicyVersion(e.target.value)} /></label>
              <label>Effective from<input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></label>
              <label>Acknowledgement due days<input type="number" min={0} max={365} value={ackDueDays} onChange={(e) => setAckDueDays(Number(e.target.value))} /></label>
              <label>Org unit<select value={policyOrgUnitId} onChange={(e) => setPolicyOrgUnitId(e.target.value)}><option value="">All units</option>{data.orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
              <label>Employment type<input value={policyEmploymentType} onChange={(e) => setPolicyEmploymentType(e.target.value)} placeholder="Regular (optional)" /></label>
              <label>Location / region<input value={policyLocation} onChange={(e) => setPolicyLocation(e.target.value)} placeholder="NCR (optional)" /></label>
              <label>Job profile<select value={policyJobProfileId} onChange={(e) => setPolicyJobProfileId(e.target.value)}><option value="">All job profiles</option>{data.jobProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.title} · {profile.level}</option>)}</select></label>
              <label style={{ gridColumn: "1 / -1" }}>Policy content<textarea rows={10} value={policyContent} onChange={(e) => setPolicyContent(e.target.value)} placeholder="Paste the approved policy text. The exact published content is SHA-256 hashed for acknowledgement evidence." /></label>
              <label><input type="checkbox" checked={requiresAck} onChange={(e) => setRequiresAck(e.target.checked)} /> Require employee acknowledgement</label>
            </div>
            <div className="run-actions"><button className="secondary-button" onClick={() => setPolicyOpen(false)}>Cancel</button><button className="primary-button" disabled={busy || !policyCode || !policyTitle || policyContent.length < 20} onClick={() => void savePolicy()}>Save draft</button></div>
          </div>
        </article>
      )}

      {requirementOpen && data.canDefineRules && (
        <article className="card" style={{ marginTop: 16 }}>
          <div className="card-header"><div><div className="card-kicker">DOCUMENT REQUIREMENT</div><h2>Define who must provide what</h2><p>Requirements materialize missing-document obligations for every employee that matches the target.</p></div></div>
          <div className="card-body">
            <div className="setting-form">
              <label>Requirement code<input value={requirementCode} onChange={(e) => setRequirementCode(e.target.value)} placeholder="PRC-LICENSE" /></label>
              <label>Name<input value={requirementName} onChange={(e) => setRequirementName(e.target.value)} placeholder="PRC Professional License" /></label>
              <label>Document type<input value={requirementKind} onChange={(e) => setRequirementKind(e.target.value)} /></label>
              <label>Submission due days<input type="number" min={0} max={365} value={submissionDueDays} onChange={(e) => setSubmissionDueDays(Number(e.target.value))} /></label>
              <label>Renewal lead days<input type="number" min={0} max={365} value={renewalLeadDays} onChange={(e) => setRenewalLeadDays(Number(e.target.value))} /></label>
              <label>Org unit<select value={requirementOrgUnitId} onChange={(e) => setRequirementOrgUnitId(e.target.value)}><option value="">All units</option>{data.orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
              <label>Employment type<input value={requirementEmploymentType} onChange={(e) => setRequirementEmploymentType(e.target.value)} placeholder="Regular (optional)" /></label>
              <label>Location / region<input value={requirementLocation} onChange={(e) => setRequirementLocation(e.target.value)} placeholder="NCR (optional)" /></label>
              <label>Job profile<select value={requirementJobProfileId} onChange={(e) => setRequirementJobProfileId(e.target.value)}><option value="">All job profiles</option>{data.jobProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.title} · {profile.level}</option>)}</select></label>
              <label><input type="checkbox" checked={requirementExpiry} onChange={(e) => setRequirementExpiry(e.target.checked)} /> Expiry date required</label>
            </div>
            <div className="run-actions"><button className="secondary-button" onClick={() => setRequirementOpen(false)}>Cancel</button><button className="primary-button" disabled={busy || !requirementCode || !requirementName} onClick={() => void createRequirement()}>Create requirement</button></div>
          </div>
        </article>
      )}

      <section className="module-grid two" style={{ marginTop: 16 }}>
        <article className="card">
          <div className="card-header"><div><div className="card-kicker">POLICY LIBRARY</div><h2>Versioned policy register</h2><p>Draft versions remain editable. Published versions are immutable evidence.</p></div></div>
          {data.policies.length === 0 && <div className="empty-state">No HCM policy versions yet.</div>}
          {data.policies.map((policy) => {
            const counts = policyAssignmentCounts.get(policy.id) ?? { assigned: 0, acknowledged: 0, overdue: 0, waived: 0 };
            return (
              <div className="leave-request" key={policy.id}>
                <div className="inline-icon purple"><BookOpen size={16} /></div>
                <div style={{ flex: 1 }}>
                  <strong>{policy.title}</strong>
                  <span>{policy.policyCode} · v{policy.version} · effective {dateLabel(policy.effectiveFrom)} · {counts.acknowledged} acknowledged · {counts.assigned} pending{counts.overdue ? ` · ${counts.overdue} overdue` : ""}</span>
                </div>
                <span className={policy.status === "published" ? "status status-verified" : "status"}>{policy.status}</span>
                {policy.status === "draft" && data.canDefineRules && <button className="primary-button" disabled={busy} onClick={() => void publishPolicy(policy)}>Publish</button>}
              </div>
            );
          })}
        </article>

        <article className="card">
          <div className="card-header"><div><div className="card-kicker">ACKNOWLEDGEMENT QUEUE</div><h2>Who has not acknowledged?</h2><p>Overdue status is calculated from the employee-specific due date.</p></div></div>
          {pendingAcks.length === 0 && <div className="empty-state">No outstanding policy acknowledgements.</div>}
          {pendingAcks.slice(0, 20).map((row) => (
            <div className="leave-request" key={row.id}>
              <div className="inline-icon amber"><Clock3 size={16} /></div>
              <div style={{ flex: 1 }}>
                <strong>{row.employee?.name ?? "Employee"}</strong>
                <span>{row.policy?.title ?? "Policy"} · due {dateLabel(row.dueAt)}{row.overdue ? " · OVERDUE" : ""}</span>
              </div>
              <span className={row.overdue ? "status status-failed" : "status"}>{row.overdue ? "Overdue" : "Pending"}</span>
              <button className="secondary-button" disabled={busy} onClick={() => void waive("policy", row.id)}>Waive</button>
            </div>
          ))}
        </article>
      </section>

      <article className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div><div className="card-kicker">DOCUMENT COMPLIANCE</div><h2>Missing, submitted, expiring and expired</h2><p>A file upload stays Submitted until an authorized People administrator verifies it.</p></div>
          <button className="secondary-button" onClick={() => setUploadOpen((value) => !value)}><UploadCloud size={15} /> Upload</button>
        </div>

        {uploadOpen && (
          <div className="card-body" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="setting-form">
              <label>Employee requirement
                <select value={uploadComplianceId} onChange={(e) => { setUploadComplianceId(e.target.value); setUploadExpiry(""); }}>
                  <option value="">Choose open requirement</option>
                  {openCompliance.map((row) => <option key={row.id} value={row.id}>{row.employee?.name ?? "Employee"} · {row.requirement?.name ?? "Requirement"} · {row.status}</option>)}
                </select>
              </label>
              <label>File<input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} /></label>
              {data.compliance.find((row) => row.id === Number(uploadComplianceId))?.requirement?.expiryRequired && <label>Expiry date<input type="date" value={uploadExpiry} onChange={(e) => setUploadExpiry(e.target.value)} /></label>}
            </div>
            <div className="run-actions"><button className="primary-button" disabled={busy || !uploadComplianceId || !uploadFile} onClick={() => void uploadRequiredDocument()}>Upload securely</button></div>
          </div>
        )}

        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>EMPLOYEE</th><th>REQUIREMENT</th><th>FILE</th><th>EXPIRY</th><th>STATUS</th><th>ACTION</th></tr></thead>
            <tbody>
              {data.compliance.length === 0 && <tr><td colSpan={6}><div className="empty-state">No employee document requirements yet.</div></td></tr>}
              {data.compliance.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.employee?.name ?? "Employee"}</strong><small style={{ display: "block", color: "var(--muted)" }}>{row.employee?.employeeNo ?? ""}</small></td>
                  <td>{row.requirement?.name ?? "Requirement"}<small style={{ display: "block", color: "var(--muted)" }}>{row.requirement?.code}</small></td>
                  <td>
                    {row.document ? (
                      <a className="secondary-button" href={"/api/documents/" + row.document.id} target="_blank" rel="noreferrer">
                        <FileText size={13} /> {row.document.fileName}
                      </a>
                    ) : "No file"}
                  </td>
                  <td>{dateLabel(row.expiresAt)}</td>
                  <td><span className={row.status === "current" ? "status status-verified" : row.status === "expired" ? "status status-failed" : "status"}>{row.status}</span></td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      {row.status === "submitted" && <button className="primary-button" disabled={busy} onClick={() => void verifyDocument(row)}><CheckCircle2 size={13} /> Verify</button>}
                      {!["waived", "current"].includes(row.status) && <button className="secondary-button" disabled={busy} onClick={() => void waive("document", row.id)}>Waive</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="card" style={{ marginTop: 16 }}>
        <div className="notice notice-slate" style={{ margin: 0 }}>
          <FileText size={16} className="i-blue" />
          <span><strong>Storage note.</strong> Existing hardened upload validation, malware scanning, tenant scoping and SHA-256 evidence remain the file-storage boundary. This HCM layer adds obligation, version, verification and expiry governance on top.</span>
        </div>
      </article>
    </div>
  );
}
