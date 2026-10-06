"use client";

import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, BriefcaseBusiness, Plus, RefreshCw, ShieldCheck } from "lucide-react";

type CapabilityPayload = {
  skills: Array<{ id: number; code: string; name: string; category: string }>;
  jobProfileSkills: Array<{ id: number; jobProfileId: number; skillId: number; minimumProficiency: number; mandatory: boolean }>;
  employeeSkills: Array<{ id: number; skillId: number; proficiency: number; status: string; effectiveFrom: string; effectiveUntil: string | null }>;
  jobProfileCredentials: Array<{ id: number; jobProfileId: number; documentRequirementId: number; mandatory: boolean; blocksWorkforceEligibility: boolean }>;
  documentRequirements: Array<{ id: number; code: string; name: string; kind: string; expiryRequired: boolean }>;
  employeeDocumentCompliance: Array<{ requirementId: number; status: string; expiresAt: string | null }>;
};

function phToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

export function HcmCapabilitiesPanel({
  organizationId,
  employeeId,
  jobProfileId,
  canManage,
  onChanged,
}: {
  organizationId: number;
  employeeId: number;
  jobProfileId: number;
  canManage: boolean;
  onChanged?: () => Promise<unknown> | unknown;
}) {
  const [payload, setPayload] = useState<CapabilityPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [skillName, setSkillName] = useState("");
  const [skillCode, setSkillCode] = useState("");
  const [skillCategory, setSkillCategory] = useState("Operational");
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [minimumProficiency, setMinimumProficiency] = useState("3");
  const [workerSkillId, setWorkerSkillId] = useState("");
  const [workerProficiency, setWorkerProficiency] = useState("3");
  const [credentialRequirementId, setCredentialRequirementId] = useState("");

  async function reload() {
    setError("");
    const response = await fetch(
      "/api/hcm/capabilities?organizationId=" + organizationId
        + "&employeeId=" + employeeId
        + "&jobProfileId=" + jobProfileId,
      { cache: "no-store" },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "Could not load capabilities.");
    setPayload(data as CapabilityPayload);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          "/api/hcm/capabilities?organizationId=" + organizationId
            + "&employeeId=" + employeeId
            + "&jobProfileId=" + jobProfileId,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? "Could not load capabilities.");
        if (!cancelled) setPayload(data as CapabilityPayload);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load capabilities.");
      }
    })();
    return () => { cancelled = true; };
  }, [employeeId, jobProfileId, organizationId]);

  async function mutate(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/hcm/capabilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, ...body }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Capability update failed.");
      await reload();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Capability update failed.");
    } finally {
      setBusy(false);
    }
  }

  const skillById = useMemo(
    () => new Map((payload?.skills ?? []).map((skill) => [skill.id, skill])),
    [payload?.skills],
  );
  const complianceByRequirement = useMemo(
    () => new Map((payload?.employeeDocumentCompliance ?? []).map((row) => [row.requirementId, row])),
    [payload?.employeeDocumentCompliance],
  );
  const linkedCredentialIds = new Set((payload?.jobProfileCredentials ?? []).map((row) => row.documentRequirementId));

  return (
    <section className="card" style={{ margin: "0 0 16px", boxShadow: "none" }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">CAPABILITY &amp; CREDENTIAL GOVERNANCE</div>
          <h2 style={{ fontSize: 14 }}>Skills and credentials that WFM can enforce</h2>
          <p>Verified skill levels and current job credentials feed qualified coverage and open-shift eligibility.</p>
        </div>
        <button className="secondary-button" disabled={busy} onClick={() => void reload()}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && <div className="notice notice-amber" style={{ margin: "0 16px 12px" }}><span>{error}</span></div>}

      <div className="card-body">
        <div className="module-grid two" style={{ margin: 0 }}>
          <div>
            <div className="card-kicker" style={{ marginBottom: 7 }}>JOB SKILLS</div>
            {(payload?.jobProfileSkills ?? []).length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 12 }}>No skill requirements configured for this job profile.</p>
            ) : (
              payload!.jobProfileSkills.map((row) => {
                const skill = skillById.get(row.skillId);
                const worker = payload!.employeeSkills
                  .filter((item) => item.skillId === row.skillId)
                  .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
                const passes = worker?.status === "verified" && Number(worker.proficiency) >= row.minimumProficiency;
                return (
                  <div className="payslip-line" key={row.id} style={{ gridTemplateColumns: "1fr auto" }}>
                    <span>
                      {skill?.name ?? "Skill #" + row.skillId}
                      <em>level {row.minimumProficiency}+ · {row.mandatory ? "required" : "preferred"}</em>
                    </span>
                    <b>{passes ? "Qualified" : worker ? worker.status + " · L" + worker.proficiency : "Missing"}</b>
                  </div>
                );
              })
            )}
          </div>

          <div>
            <div className="card-kicker" style={{ marginBottom: 7 }}>JOB CREDENTIALS</div>
            {(payload?.jobProfileCredentials ?? []).length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 12 }}>No credential requirements linked to this job profile.</p>
            ) : (
              payload!.jobProfileCredentials.map((row) => {
                const requirement = payload!.documentRequirements.find((item) => item.id === row.documentRequirementId);
                const compliance = complianceByRequirement.get(row.documentRequirementId);
                return (
                  <div className="payslip-line" key={row.id} style={{ gridTemplateColumns: "1fr auto" }}>
                    <span>
                      {requirement?.name ?? "Credential #" + row.documentRequirementId}
                      <em>{row.blocksWorkforceEligibility ? "blocks WFM when invalid" : "advisory"} · {row.mandatory ? "required" : "optional"}</em>
                    </span>
                    <b>{compliance?.status ?? "missing"}{compliance?.expiresAt ? " · " + compliance.expiresAt : ""}</b>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {canManage && payload && (
          <>
            <div className="module-grid two" style={{ marginTop: 16 }}>
              <form
                className="setting-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void mutate({ action: "create_skill", code: skillCode, name: skillName, category: skillCategory })
                    .then(() => { setSkillCode(""); setSkillName(""); });
                }}
              >
                <div className="card-kicker">ADD SKILL</div>
                <label>Code<input required value={skillCode} onChange={(event) => setSkillCode(event.target.value)} placeholder="CALL-HANDLING" /></label>
                <label>Name<input required value={skillName} onChange={(event) => setSkillName(event.target.value)} placeholder="Customer call handling" /></label>
                <label>Category<input value={skillCategory} onChange={(event) => setSkillCategory(event.target.value)} /></label>
                <button className="secondary-button" disabled={busy}><Plus size={14} /> Add skill</button>
              </form>

              <form
                className="setting-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void mutate({
                    action: "set_job_skill",
                    jobProfileId,
                    skillId: Number(selectedSkillId),
                    minimumProficiency: Number(minimumProficiency),
                    mandatory: true,
                  });
                }}
              >
                <div className="card-kicker">JOB REQUIREMENT</div>
                <label>Skill
                  <select required value={selectedSkillId} onChange={(event) => setSelectedSkillId(event.target.value)}>
                    <option value="">Select skill…</option>
                    {payload.skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.code} · {skill.name}</option>)}
                  </select>
                </label>
                <label>Minimum proficiency
                  <select value={minimumProficiency} onChange={(event) => setMinimumProficiency(event.target.value)}>
                    {[1,2,3,4,5].map((level) => <option key={level} value={level}>Level {level}</option>)}
                  </select>
                </label>
                <button className="secondary-button" disabled={busy || !selectedSkillId}><BriefcaseBusiness size={14} /> Require skill</button>
              </form>
            </div>

            <div className="module-grid two" style={{ marginTop: 16 }}>
              <form
                className="setting-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void mutate({
                    action: "set_employee_skill",
                    employeeId,
                    skillId: Number(workerSkillId),
                    proficiency: Number(workerProficiency),
                    status: "verified",
                    effectiveFrom: phToday(),
                  });
                }}
              >
                <div className="card-kicker">VERIFY WORKER SKILL</div>
                <label>Skill
                  <select required value={workerSkillId} onChange={(event) => setWorkerSkillId(event.target.value)}>
                    <option value="">Select skill…</option>
                    {payload.skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.code} · {skill.name}</option>)}
                  </select>
                </label>
                <label>Verified proficiency
                  <select value={workerProficiency} onChange={(event) => setWorkerProficiency(event.target.value)}>
                    {[1,2,3,4,5].map((level) => <option key={level} value={level}>Level {level}</option>)}
                  </select>
                </label>
                <button className="secondary-button" disabled={busy || !workerSkillId}><BadgeCheck size={14} /> Verify skill</button>
              </form>

              <form
                className="setting-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void mutate({
                    action: "link_credential",
                    jobProfileId,
                    documentRequirementId: Number(credentialRequirementId),
                    mandatory: true,
                    blocksWorkforceEligibility: true,
                  });
                }}
              >
                <div className="card-kicker">LINK JOB CREDENTIAL</div>
                <label>Document / licence requirement
                  <select required value={credentialRequirementId} onChange={(event) => setCredentialRequirementId(event.target.value)}>
                    <option value="">Select requirement…</option>
                    {payload.documentRequirements
                      .filter((requirement) => !linkedCredentialIds.has(requirement.id))
                      .map((requirement) => (
                        <option key={requirement.id} value={requirement.id}>
                          {requirement.code} · {requirement.name}{requirement.expiryRequired ? " · expires" : ""}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="modal-note">Uses the existing verified document and expiry record. No duplicate credential store is created.</div>
                <button className="secondary-button" disabled={busy || !credentialRequirementId}><ShieldCheck size={14} /> Require credential</button>
              </form>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
