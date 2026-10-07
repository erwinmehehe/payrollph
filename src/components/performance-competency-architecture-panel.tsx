"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, BriefcaseBusiness, Link2, Plus, RefreshCw, ShieldCheck } from "lucide-react";

type JobProfile = {
  id: number;
  title: string;
  familyId: number | null;
  levelId: number | null;
  family: string;
  level: string;
  active: boolean;
};

type JobFamily = { id: number; code: string; name: string; active: boolean };
type JobLevel = { id: number; code: string; name: string; sequence: number; active: boolean };

type Skill = {
  id: number;
  code: string;
  name: string;
  category: string;
  description: string | null;
  active: boolean;
};

type Requirement = {
  id: number;
  jobProfileId: number;
  skillId: number;
  minimumProficiency: number;
  mandatory: boolean;
};

type ExpectationDefault = {
  id: number;
  jobFamilyId: number | null;
  jobLevelId: number | null;
  skillId: number;
  minimumProficiency: number;
  mandatory: boolean;
  active: boolean;
};

type Template = {
  id: number;
  code: string;
  name: string;
  type: "competency";
  jobProfileId: number | null;
  skillId: number | null;
  active: boolean;
};

type Coverage = {
  jobProfileId: number;
  title: string;
  family: string;
  level: string;
  mandatorySkills: number;
  mappedMandatorySkills: number;
  inheritedSkills: number;
  complete: boolean;
  effectiveExpectations: Array<{
    skillId: number;
    code: string;
    name: string;
    minimumProficiency: number;
    mandatory: boolean;
    source: "profile" | "family" | "level" | "family_level";
    ruleId: number | null;
  }>;
  missing: Array<{
    skillId: number;
    code: string;
    name: string;
    minimumProficiency: number;
    source: "profile" | "family" | "level" | "family_level";
  }>;
};

export function PerformanceCompetencyArchitecturePanel({
  organizationId,
  setNotice,
}: {
  organizationId: number;
  setNotice: (message: string) => void;
}) {
  const [profiles, setProfiles] = useState<JobProfile[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [defaults, setDefaults] = useState<ExpectationDefault[]>([]);
  const [families, setFamilies] = useState<JobFamily[]>([]);
  const [levels, setLevels] = useState<JobLevel[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [showSkill, setShowSkill] = useState(false);
  const [showRequirement, setShowRequirement] = useState(false);
  const [showDefault, setShowDefault] = useState(false);
  const [skillForm, setSkillForm] = useState({ code: "", name: "", category: "General", description: "" });
  const [requirementForm, setRequirementForm] = useState({
    jobProfileId: "",
    skillId: "",
    minimumProficiency: "3",
    mandatory: true,
  });
  const [defaultForm, setDefaultForm] = useState({
    jobFamilyId: "",
    jobLevelId: "",
    skillId: "",
    minimumProficiency: "3",
    mandatory: false,
  });
  const [mappingSkill, setMappingSkill] = useState<Record<number, string>>({});
  const [mappingProfile, setMappingProfile] = useState<Record<number, string>>({});
  const [requirementLevels, setRequirementLevels] = useState<Record<number, string>>({});
  const [requirementMandatory, setRequirementMandatory] = useState<Record<number, boolean>>({});
  const [defaultLevels, setDefaultLevels] = useState<Record<number, string>>({});
  const [defaultMandatory, setDefaultMandatory] = useState<Record<number, boolean>>({});
  const [defaultActive, setDefaultActive] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    const response = await fetch("/api/performance/competencies?organizationId=" + organizationId, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not load job-profile competency architecture.");
      return;
    }
    setProfiles(payload.profiles ?? []);
    setSkills(payload.skills ?? []);
    setRequirements(payload.requirements ?? []);
    setDefaults(payload.defaults ?? []);
    setFamilies(payload.families ?? []);
    setLevels(payload.levels ?? []);
    setTemplates(payload.templates ?? []);
    setCoverage(payload.coverage ?? []);
    setMappingSkill(Object.fromEntries((payload.templates ?? []).map((template: Template) => [
      template.id,
      template.skillId ? String(template.skillId) : "",
    ])));
    setMappingProfile(Object.fromEntries((payload.templates ?? []).map((template: Template) => [
      template.id,
      template.jobProfileId ? String(template.jobProfileId) : "",
    ])));
    setRequirementLevels(Object.fromEntries((payload.requirements ?? []).map((requirement: Requirement) => [
      requirement.id,
      String(requirement.minimumProficiency),
    ])));
    setRequirementMandatory(Object.fromEntries((payload.requirements ?? []).map((requirement: Requirement) => [
      requirement.id,
      requirement.mandatory,
    ])));
    setDefaultLevels(Object.fromEntries((payload.defaults ?? []).map((row: ExpectationDefault) => [
      row.id,
      String(row.minimumProficiency),
    ])));
    setDefaultMandatory(Object.fromEntries((payload.defaults ?? []).map((row: ExpectationDefault) => [
      row.id,
      row.mandatory,
    ])));
    setDefaultActive(Object.fromEntries((payload.defaults ?? []).map((row: ExpectationDefault) => [
      row.id,
      row.active,
    ])));
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  const skillById = useMemo(() => new Map(skills.map((skill) => [skill.id, skill])), [skills]);
  const profileById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const familyById = useMemo(() => new Map(families.map((family) => [family.id, family])), [families]);
  const levelById = useMemo(() => new Map(levels.map((level) => [level.id, level])), [levels]);

  async function createSkill(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/performance/competencies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        entityType: "skill",
        ...skillForm,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not create HCM skill.");
      return;
    }
    setSkillForm({ code: "", name: "", category: "General", description: "" });
    setShowSkill(false);
    await load();
    setNotice("HCM skill created for job-profile competency governance.");
  }

  async function createRequirement(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/performance/competencies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        entityType: "requirement",
        jobProfileId: Number(requirementForm.jobProfileId),
        skillId: Number(requirementForm.skillId),
        minimumProficiency: Number(requirementForm.minimumProficiency),
        mandatory: requirementForm.mandatory,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not add job-profile skill requirement.");
      return;
    }
    setRequirementForm({ jobProfileId: "", skillId: "", minimumProficiency: "3", mandatory: true });
    setShowRequirement(false);
    await load();
    setNotice("Job-profile skill requirement added.");
  }

  async function createDefault(event: React.FormEvent) {
    event.preventDefault();
    if (!defaultForm.jobFamilyId && !defaultForm.jobLevelId) {
      setNotice("Choose a job family, a job level, or both for the inherited expectation.");
      return;
    }
    const response = await fetch("/api/performance/competencies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        entityType: "expectation_default",
        jobFamilyId: defaultForm.jobFamilyId ? Number(defaultForm.jobFamilyId) : null,
        jobLevelId: defaultForm.jobLevelId ? Number(defaultForm.jobLevelId) : null,
        skillId: Number(defaultForm.skillId),
        minimumProficiency: Number(defaultForm.minimumProficiency),
        mandatory: defaultForm.mandatory,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not create inherited competency expectation.");
      return;
    }
    setDefaultForm({ jobFamilyId: "", jobLevelId: "", skillId: "", minimumProficiency: "3", mandatory: false });
    setShowDefault(false);
    await load();
    setNotice("Inherited competency expectation created.");
  }

  async function saveRequirement(requirement: Requirement) {
    const response = await fetch("/api/performance/competencies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        entityType: "requirement",
        id: requirement.id,
        minimumProficiency: Number(requirementLevels[requirement.id] ?? requirement.minimumProficiency),
        mandatory: requirementMandatory[requirement.id] ?? requirement.mandatory,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not update job-profile skill requirement.");
      return;
    }
    await load();
    setNotice("Job-profile proficiency expectation updated.");
  }

  async function saveDefault(row: ExpectationDefault) {
    const response = await fetch("/api/performance/competencies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        entityType: "expectation_default",
        id: row.id,
        minimumProficiency: Number(defaultLevels[row.id] ?? row.minimumProficiency),
        mandatory: defaultMandatory[row.id] ?? row.mandatory,
        active: defaultActive[row.id] ?? row.active,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not update inherited competency expectation.");
      return;
    }
    await load();
    setNotice("Inherited competency expectation updated.");
  }

  async function saveMapping(template: Template) {
    const response = await fetch("/api/performance/competencies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        entityType: "template_mapping",
        templateId: template.id,
        skillId: mappingSkill[template.id] ? Number(mappingSkill[template.id]) : null,
        jobProfileId: mappingProfile[template.id] ? Number(mappingProfile[template.id]) : null,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not map competency to job architecture.");
      return;
    }
    await load();
    setNotice("Performance competency mapped to job-profile skill architecture.");
  }

  return (
    <article className="card" style={{ padding: 20 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">JOB-PROFILE COMPETENCIES</div>
          <h2>Turn job architecture into review expectations</h2>
          <p>Mandatory job skills carry a 1–5 proficiency expectation into each employee review. A review cannot open if its cycle is missing a competency for a mandatory job skill.</p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
          <button className="secondary-button" type="button" onClick={() => setShowSkill((value) => !value)}><Plus size={14} /> Skill</button>
          <button className="secondary-button" type="button" onClick={() => setShowDefault((value) => !value)}><ShieldCheck size={14} /> Inherited default</button>
          <button className="primary-button" type="button" onClick={() => setShowRequirement((value) => !value)}><BriefcaseBusiness size={14} /> Profile override</button>
        </div>
      </div>

      {showSkill && (
        <form onSubmit={createSkill} style={{ marginBottom: 16 }}>
          <div className="setting-form">
            <label>Code<input required value={skillForm.code} onChange={(event) => setSkillForm({ ...skillForm, code: event.target.value })} /></label>
            <label>Name<input required value={skillForm.name} onChange={(event) => setSkillForm({ ...skillForm, name: event.target.value })} /></label>
            <label>Category<input value={skillForm.category} onChange={(event) => setSkillForm({ ...skillForm, category: event.target.value })} /></label>
            <label style={{ gridColumn: "1 / -1" }}>Description<textarea rows={2} value={skillForm.description} onChange={(event) => setSkillForm({ ...skillForm, description: event.target.value })} /></label>
          </div>
          <div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowSkill(false)}>Cancel</button><button className="primary-button">Create skill</button></div>
        </form>
      )}

      {showDefault && (
        <form onSubmit={createDefault} style={{ marginBottom: 16 }}>
          <div className="setting-form">
            <label>Job family<select value={defaultForm.jobFamilyId} onChange={(event) => setDefaultForm({ ...defaultForm, jobFamilyId: event.target.value })}><option value="">Any family</option>{families.filter((family) => family.active).map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}</select></label>
            <label>Job level<select value={defaultForm.jobLevelId} onChange={(event) => setDefaultForm({ ...defaultForm, jobLevelId: event.target.value })}><option value="">Any level</option>{levels.filter((level) => level.active).map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}</select></label>
            <label>Skill<select required value={defaultForm.skillId} onChange={(event) => setDefaultForm({ ...defaultForm, skillId: event.target.value })}><option value="">Select skill</option>{skills.filter((skill) => skill.active).map((skill) => <option key={skill.id} value={skill.id}>{skill.code} · {skill.name}</option>)}</select></label>
            <label>Minimum proficiency<input type="number" min="1" max="5" step="1" value={defaultForm.minimumProficiency} onChange={(event) => setDefaultForm({ ...defaultForm, minimumProficiency: event.target.value })} /></label>
            <label><input type="checkbox" checked={defaultForm.mandatory} onChange={(event) => setDefaultForm({ ...defaultForm, mandatory: event.target.checked })} /> Mandatory when inherited</label>
          </div>
          <p>Precedence is profile override → family + level → level → family. At least one family/level scope is required.</p>
          <div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowDefault(false)}>Cancel</button><button className="primary-button">Add inherited default</button></div>
        </form>
      )}

      {showRequirement && (
        <form onSubmit={createRequirement} style={{ marginBottom: 16 }}>
          <div className="setting-form">
            <label>Job profile<select required value={requirementForm.jobProfileId} onChange={(event) => setRequirementForm({ ...requirementForm, jobProfileId: event.target.value })}><option value="">Select profile</option>{profiles.filter((profile) => profile.active).map((profile) => <option key={profile.id} value={profile.id}>{profile.title} · {profile.level}</option>)}</select></label>
            <label>Skill<select required value={requirementForm.skillId} onChange={(event) => setRequirementForm({ ...requirementForm, skillId: event.target.value })}><option value="">Select skill</option>{skills.filter((skill) => skill.active).map((skill) => <option key={skill.id} value={skill.id}>{skill.code} · {skill.name}</option>)}</select></label>
            <label>Minimum proficiency<input type="number" min="1" max="5" step="1" value={requirementForm.minimumProficiency} onChange={(event) => setRequirementForm({ ...requirementForm, minimumProficiency: event.target.value })} /></label>
            <label><input type="checkbox" checked={requirementForm.mandatory} onChange={(event) => setRequirementForm({ ...requirementForm, mandatory: event.target.checked })} /> Mandatory job skill</label>
          </div>
          <div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowRequirement(false)}>Cancel</button><button className="primary-button">Add requirement</button></div>
        </form>
      )}

      <section className="module-grid two" style={{ marginBottom: 16 }}>
        <div>
          <div className="card-kicker">COVERAGE</div>
          {coverage.length === 0 && <div className="empty-state">No job profiles available.</div>}
          {coverage.map((row) => (
            <div className="leave-request" key={row.jobProfileId}>
              <div className="inline-icon mint">{row.complete ? <BadgeCheck size={15} /> : <ShieldCheck size={15} />}</div>
              <div style={{ flex: 1 }}>
                <strong>{row.title}</strong>
                <span>{row.family} · {row.level} · {row.mappedMandatorySkills}/{row.mandatorySkills} mandatory skills mapped · {row.inheritedSkills} inherited expectation(s)</span>
                {row.missing.length > 0 && <span>Missing: {row.missing.map((item) => item.name + " (≥" + item.minimumProficiency + ", " + item.source.replaceAll("_", " ") + ")").join(", ")}</span>}
              </div>
              <span className={"employee-status-pill " + (row.complete ? "good" : "warn")}>{row.complete ? "Ready" : "Gap"}</span>
            </div>
          ))}
        </div>

        <div>
          <div className="card-kicker">INHERITED DEFAULTS</div>
          <p>Use family and level defaults to avoid repeating the same competency expectation on every job profile. Profile requirements override inherited values.</p>
          {defaults.length === 0 && <div className="empty-state">No inherited expectations yet.</div>}
          {defaults.map((row) => {
            const scope = [
              row.jobFamilyId ? familyById.get(row.jobFamilyId)?.name ?? "Family" : null,
              row.jobLevelId ? levelById.get(row.jobLevelId)?.name ?? "Level" : null,
            ].filter(Boolean).join(" + ");
            return (
              <div className="employee-edit-card" key={row.id} style={{ marginBottom: 10 }}>
                <strong>{scope} · {skillById.get(row.skillId)?.name ?? "Skill"}</strong>
                <div className="setting-form" style={{ marginTop: 8 }}>
                  <label>Expected 1–5<input type="number" min="1" max="5" step="1" value={defaultLevels[row.id] ?? row.minimumProficiency} onChange={(event) => setDefaultLevels((current) => ({ ...current, [row.id]: event.target.value }))} /></label>
                  <label><input type="checkbox" checked={defaultMandatory[row.id] ?? row.mandatory} onChange={(event) => setDefaultMandatory((current) => ({ ...current, [row.id]: event.target.checked }))} /> Mandatory</label>
                  <label><input type="checkbox" checked={defaultActive[row.id] ?? row.active} onChange={(event) => setDefaultActive((current) => ({ ...current, [row.id]: event.target.checked }))} /> Active</label>
                  <button className="secondary-button" type="button" onClick={() => void saveDefault(row)}>Save</button>
                </div>
              </div>
            );
          })}
        </div>

        <div>
          <div className="card-kicker">JOB SKILL EXPECTATIONS</div>
          {requirements.length === 0 && <div className="empty-state">No job-profile skill requirements yet.</div>}
          {requirements.map((requirement) => (
            <div className="employee-edit-card" key={requirement.id} style={{ marginBottom: 10 }}>
              <strong>{profileById.get(requirement.jobProfileId)?.title ?? "Job profile"} · {skillById.get(requirement.skillId)?.name ?? "Skill"}</strong>
              <div className="setting-form" style={{ marginTop: 8 }}>
                <label>Expected 1–5<input type="number" min="1" max="5" step="1" value={requirementLevels[requirement.id] ?? requirement.minimumProficiency} onChange={(event) => setRequirementLevels((current) => ({ ...current, [requirement.id]: event.target.value }))} /></label>
                <label><input type="checkbox" checked={requirementMandatory[requirement.id] ?? requirement.mandatory} onChange={(event) => setRequirementMandatory((current) => ({ ...current, [requirement.id]: event.target.checked }))} /> Mandatory</label>
                <button className="secondary-button" type="button" onClick={() => void saveRequirement(requirement)}>Save</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div>
        <div className="card-kicker">COMPETENCY → SKILL MAPPING</div>
        <p>Map each review competency to an HCM skill. Optionally scope it to one job profile; leaving the profile blank makes the competency reusable anywhere that skill is required.</p>
        {templates.length === 0 && <div className="empty-state">Create competency templates in Performance Governance first.</div>}
        {templates.map((template) => (
          <div className="employee-edit-card" key={template.id} style={{ marginBottom: 10 }}>
            <div className="employee-list-card-head">
              <div><strong>{template.name}</strong><span>{template.code}</span></div>
              <Link2 size={16} />
            </div>
            <div className="setting-form">
              <label>HCM skill<select value={mappingSkill[template.id] ?? ""} onChange={(event) => setMappingSkill((current) => ({ ...current, [template.id]: event.target.value }))}><option value="">Not mapped</option>{skills.filter((skill) => skill.active).map((skill) => <option key={skill.id} value={skill.id}>{skill.code} · {skill.name}</option>)}</select></label>
              <label>Job profile scope<select value={mappingProfile[template.id] ?? ""} onChange={(event) => setMappingProfile((current) => ({ ...current, [template.id]: event.target.value }))}><option value="">Reusable across profiles</option>{profiles.filter((profile) => profile.active).map((profile) => <option key={profile.id} value={profile.id}>{profile.title} · {profile.level}</option>)}</select></label>
              <button className="secondary-button" type="button" onClick={() => void saveMapping(template)}>Save mapping</button>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
