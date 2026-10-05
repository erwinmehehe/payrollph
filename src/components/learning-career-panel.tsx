"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Award, BookOpen, CheckCircle2, Plus, RefreshCw, Target, TrendingUp, X } from "lucide-react";

type Access = { role: string; companyWide: boolean; orgUnitId: number | null };
type Employee = {
  id: number;
  firstName: string;
  lastName: string;
  title: string;
  orgUnitId: number | null;
  activePosition: { id: number; code: string; jobProfileId: number } | null;
  latestPerformanceReview: { id: number; finalScore: string | null; status: string } | null;
};
type JobProfile = { id: number; title: string; family: string; level: string; grade: string | null };
type Skill = { id: number; name: string; category: string; description: string | null; active: boolean };
type Requirement = { id: number; jobProfileId: number; skillId: number; requiredLevel: number; critical: boolean };
type EmployeeSkill = { id: number; employeeId: number; skillId: number; proficiencyLevel: number; source: string; verifiedAt: string | null; notes: string | null };
type DevelopmentPlan = { id: number; employeeId: number; performanceReviewId: number | null; title: string; targetDate: string | null; status: string; notes: string | null };
type PlanItem = { id: number; planId: number; skillId: number | null; title: string; activityType: string; targetLevel: number | null; dueDate: string | null; status: string; notes: string | null };
type Course = { id: number; code: string; title: string; provider: string; deliveryMode: string; skillId: number | null; awardedLevel: number | null; certificationName: string | null; validityMonths: number | null; active: boolean };
type Enrollment = { id: number; employeeId: number; courseId: number; developmentPlanItemId: number | null; status: string; dueDate: string | null; completedAt: string | null; score: string | null };
type Certification = { id: number; employeeId: number; skillId: number | null; name: string; issuer: string; issuedOn: string; expiresOn: string | null; effectiveStatus: string };
type Readiness = { employeeId: number; currentJobProfileId: number | null; targetJobProfileId: number; metRequirements: number; totalRequirements: number; criticalGaps: Array<{ skillId: number; requiredLevel: number; currentLevel: number }>; readinessPercent: number };

export function LearningCareerPanel({ organizationId, setNotice }: { organizationId: number; setNotice: (message: string) => void }) {
  const [access, setAccess] = useState<Access | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [jobProfiles, setJobProfiles] = useState<JobProfile[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [employeeSkills, setEmployeeSkills] = useState<EmployeeSkill[]>([]);
  const [plans, setPlans] = useState<DevelopmentPlan[]>([]);
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [readiness, setReadiness] = useState<Readiness[]>([]);
  const [loading, setLoading] = useState(true);

  const [showSkill, setShowSkill] = useState(false);
  const [showRequirement, setShowRequirement] = useState(false);
  const [showEmployeeSkill, setShowEmployeeSkill] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [showPlanItem, setShowPlanItem] = useState(false);
  const [showCourse, setShowCourse] = useState(false);
  const [showEnrollment, setShowEnrollment] = useState(false);
  const [selectedCareerEmployee, setSelectedCareerEmployee] = useState("");

  const [skillForm, setSkillForm] = useState({ name: "", category: "General", description: "" });
  const [requirementForm, setRequirementForm] = useState({ jobProfileId: "", skillId: "", requiredLevel: "3", critical: false });
  const [employeeSkillForm, setEmployeeSkillForm] = useState({ employeeId: "", skillId: "", proficiencyLevel: "3", notes: "" });
  const [planForm, setPlanForm] = useState({ employeeId: "", performanceReviewId: "", title: "", targetDate: "", notes: "" });
  const [itemForm, setItemForm] = useState({ planId: "", skillId: "", title: "", activityType: "training", targetLevel: "", dueDate: "", notes: "" });
  const [courseForm, setCourseForm] = useState({ code: "", title: "", provider: "Internal", deliveryMode: "self_paced", skillId: "", awardedLevel: "", certificationName: "", validityMonths: "" });
  const [enrollmentForm, setEnrollmentForm] = useState({ employeeId: "", courseId: "", developmentPlanItemId: "", dueDate: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/learning-career?organizationId=${organizationId}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setNotice(payload.error ?? "Could not load learning and career development.");
      setAccess(payload.access ?? null);
      setEmployees(payload.employees ?? []);
      setJobProfiles(payload.jobProfiles ?? []);
      setSkills(payload.skills ?? []);
      setRequirements(payload.requirements ?? []);
      setEmployeeSkills(payload.employeeSkills ?? []);
      setPlans(payload.developmentPlans ?? []);
      setPlanItems(payload.developmentPlanItems ?? []);
      setCourses(payload.courses ?? []);
      setEnrollments(payload.enrollments ?? []);
      setCertifications(payload.certifications ?? []);
      setReadiness(payload.careerReadiness ?? []);
      if (!selectedCareerEmployee && payload.employees?.length) setSelectedCareerEmployee(String(payload.employees[0].id));
    } finally {
      setLoading(false);
    }
  }, [organizationId, selectedCareerEmployee, setNotice]);

  useEffect(() => { void load(); }, [load]);

  const role = access?.role ?? "";
  const canArchitect = Boolean(access?.companyWide && ["owner", "admin", "bookkeeper", "hr"].includes(role));
  const canDevelop = ["owner", "admin", "bookkeeper", "hr", "manager"].includes(role);

  const employeeById = useMemo(() => new Map(employees.map((row) => [row.id, row])), [employees]);
  const skillById = useMemo(() => new Map(skills.map((row) => [row.id, row])), [skills]);
  const profileById = useMemo(() => new Map(jobProfiles.map((row) => [row.id, row])), [jobProfiles]);
  const courseById = useMemo(() => new Map(courses.map((row) => [row.id, row])), [courses]);
  const planById = useMemo(() => new Map(plans.map((row) => [row.id, row])), [plans]);

  const activePlans = plans.filter((plan) => plan.status === "active");
  const completedLearning = enrollments.filter((row) => row.status === "completed").length;
  const expiringCerts = certifications.filter((row) => row.effectiveStatus === "active" && row.expiresOn && {
    const days = (new Date(row.expiresOn + "T00:00:00Z").getTime() - Date.now()) / 86400000;
    return days >= 0 && days <= 90;
  }).length;
  const mobilityReady = readiness.filter((row) => row.readinessPercent >= 80 && row.criticalGaps.length === 0).length;
  const selectedReadiness = readiness
    .filter((row) => String(row.employeeId) === selectedCareerEmployee)
    .sort((a, b) => b.readinessPercent - a.readinessPercent);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/learning-career", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, ...body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Could not save learning data.");
    return payload;
  }

  async function addSkill(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({ entityType: "skill", ...skillForm });
      setSkillForm({ name: "", category: "General", description: "" });
      setShowSkill(false);
      await load();
      setNotice("Skill added to the competency catalog.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not add skill."); }
  }

  async function saveRequirement(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({ entityType: "requirement", jobProfileId: Number(requirementForm.jobProfileId), skillId: Number(requirementForm.skillId), requiredLevel: Number(requirementForm.requiredLevel), critical: requirementForm.critical });
      setRequirementForm({ jobProfileId: "", skillId: "", requiredLevel: "3", critical: false });
      setShowRequirement(false);
      await load();
      setNotice("Job competency requirement saved.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save requirement."); }
  }

  async function verifySkill(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({ entityType: "employee_skill", employeeId: Number(employeeSkillForm.employeeId), skillId: Number(employeeSkillForm.skillId), proficiencyLevel: Number(employeeSkillForm.proficiencyLevel), notes: employeeSkillForm.notes });
      setEmployeeSkillForm({ employeeId: "", skillId: "", proficiencyLevel: "3", notes: "" });
      setShowEmployeeSkill(false);
      await load();
      setNotice("Employee skill verified.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not verify employee skill."); }
  }

  async function createPlan(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "development_plan",
        employeeId: Number(planForm.employeeId),
        performanceReviewId: planForm.performanceReviewId ? Number(planForm.performanceReviewId) : null,
        title: planForm.title,
        targetDate: planForm.targetDate || null,
        notes: planForm.notes,
      });
      setPlanForm({ employeeId: "", performanceReviewId: "", title: "", targetDate: "", notes: "" });
      setShowPlan(false);
      await load();
      setNotice("Development plan created.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create development plan."); }
  }

  async function addPlanItem(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "plan_item",
        planId: Number(itemForm.planId),
        skillId: itemForm.skillId ? Number(itemForm.skillId) : null,
        title: itemForm.title,
        activityType: itemForm.activityType,
        targetLevel: itemForm.targetLevel ? Number(itemForm.targetLevel) : null,
        dueDate: itemForm.dueDate || null,
        notes: itemForm.notes,
      });
      setItemForm({ planId: "", skillId: "", title: "", activityType: "training", targetLevel: "", dueDate: "", notes: "" });
      setShowPlanItem(false);
      await load();
      setNotice("Development activity added.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not add development activity."); }
  }

  async function createCourse(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "course",
        code: courseForm.code,
        title: courseForm.title,
        provider: courseForm.provider,
        deliveryMode: courseForm.deliveryMode,
        skillId: courseForm.skillId ? Number(courseForm.skillId) : null,
        awardedLevel: courseForm.awardedLevel ? Number(courseForm.awardedLevel) : null,
        certificationName: courseForm.certificationName || null,
        validityMonths: courseForm.validityMonths ? Number(courseForm.validityMonths) : null,
      });
      setCourseForm({ code: "", title: "", provider: "Internal", deliveryMode: "self_paced", skillId: "", awardedLevel: "", certificationName: "", validityMonths: "" });
      setShowCourse(false);
      await load();
      setNotice("Learning course created.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create course."); }
  }

  async function assignCourse(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "enrollment",
        employeeId: Number(enrollmentForm.employeeId),
        courseId: Number(enrollmentForm.courseId),
        developmentPlanItemId: enrollmentForm.developmentPlanItemId ? Number(enrollmentForm.developmentPlanItemId) : null,
        dueDate: enrollmentForm.dueDate || null,
      });
      setEnrollmentForm({ employeeId: "", courseId: "", developmentPlanItemId: "", dueDate: "" });
      setShowEnrollment(false);
      await load();
      setNotice("Learning assigned.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not assign learning."); }
  }

  async function updateEnrollment(enrollment: Enrollment, status: "in_progress" | "completed") {
    const response = await fetch("/api/learning-career", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "enrollment_status", enrollmentId: enrollment.id, status }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setNotice(payload.error ?? "Could not update learning.");
    await load();
    setNotice(status === "completed" ? "Course completed; linked skill/certification evidence was updated." : "Course marked in progress.");
  }

  async function updatePlanItem(item: PlanItem, status: "in_progress" | "completed") {
    const response = await fetch("/api/learning-career", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "plan_item_status", itemId: item.id, status }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setNotice(payload.error ?? "Could not update development activity.");
    await load();
    setNotice("Development activity updated.");
  }

  const formCard = (title: string, kicker: string, close: () => void, children: React.ReactNode) => (
    <article className="card" style={{ padding: 20, marginBottom: 16 }}>
      <div className="card-header"><div><div className="card-kicker">{kicker}</div><h2>{title}</h2></div><button className="icon-button" onClick={close}><X size={16} /></button></div>
      {children}
    </article>
  );

  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">LEARNING, SKILLS &amp; CAREER</div>
          <h1>Turn performance gaps into development and mobility.</h1>
          <p>Define role competencies, verify employee skills, attach development plans to reviews, assign learning, track certifications, and calculate internal-mobility readiness from evidence.</p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          {canDevelop && <button className="secondary-button" onClick={() => setShowEmployeeSkill(!showEmployeeSkill)}><Target size={15} /> Verify skill</button>}
          {canDevelop && <button className="primary-button" onClick={() => setShowPlan(!showPlan)}><Plus size={15} /> Development plan</button>}
        </div>
      </div>

      <section className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="stat-card"><div className="stat-icon purple"><Target size={19} /></div><p>SKILLS CATALOG</p><h3>{skills.length}</h3><span>{requirements.length} job requirements</span></article>
        <article className="stat-card"><div className="stat-icon blue"><BookOpen size={19} /></div><p>ACTIVE PLANS</p><h3>{activePlans.length}</h3><span>{planItems.filter((item) => item.status !== "completed").length} open activities</span></article>
        <article className="stat-card"><div className="stat-icon mint"><CheckCircle2 size={19} /></div><p>LEARNING COMPLETE</p><h3>{completedLearning}</h3><span>{enrollments.filter((row) => row.status !== "completed" && row.status !== "cancelled").length} active enrollments</span></article>
        <article className="stat-card"><div className="stat-icon orange"><TrendingUp size={19} /></div><p>MOBILITY READY</p><h3>{mobilityReady}</h3><span>{expiringCerts} certifications expire within 90 days</span></article>
      </section>

      {showSkill && formCard("Add a reusable skill", "SKILLS CATALOG", () => setShowSkill(false),
        <form onSubmit={addSkill}><div className="setting-form">
          <label>Skill name<input required value={skillForm.name} onChange={(e) => setSkillForm({ ...skillForm, name: e.target.value })} placeholder="Payroll compliance" /></label>
          <label>Category<input required value={skillForm.category} onChange={(e) => setSkillForm({ ...skillForm, category: e.target.value })} placeholder="Finance" /></label>
          <label style={{ gridColumn: "1 / -1" }}>Description<textarea rows={2} value={skillForm.description} onChange={(e) => setSkillForm({ ...skillForm, description: e.target.value })} /></label>
        </div><div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowSkill(false)}>Cancel</button><button className="primary-button">Add skill</button></div></form>
      )}

      {showRequirement && formCard("Define a job-profile competency", "ROLE REQUIREMENT", () => setShowRequirement(false),
        <form onSubmit={saveRequirement}><div className="setting-form">
          <label>Job profile<select required value={requirementForm.jobProfileId} onChange={(e) => setRequirementForm({ ...requirementForm, jobProfileId: e.target.value })}><option value="">Select profile</option>{jobProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.title} · {profile.level}</option>)}</select></label>
          <label>Skill<select required value={requirementForm.skillId} onChange={(e) => setRequirementForm({ ...requirementForm, skillId: e.target.value })}><option value="">Select skill</option>{skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label>
          <label>Required level<select value={requirementForm.requiredLevel} onChange={(e) => setRequirementForm({ ...requirementForm, requiredLevel: e.target.value })}>{[1,2,3,4,5].map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
          <label><input type="checkbox" checked={requirementForm.critical} onChange={(e) => setRequirementForm({ ...requirementForm, critical: e.target.checked })} /> Critical for readiness</label>
        </div><div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowRequirement(false)}>Cancel</button><button className="primary-button">Save requirement</button></div></form>
      )}

      {showEmployeeSkill && formCard("Verify employee proficiency", "SKILL EVIDENCE", () => setShowEmployeeSkill(false),
        <form onSubmit={verifySkill}><div className="setting-form">
          <label>Employee<select required value={employeeSkillForm.employeeId} onChange={(e) => setEmployeeSkillForm({ ...employeeSkillForm, employeeId: e.target.value })}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>
          <label>Skill<select required value={employeeSkillForm.skillId} onChange={(e) => setEmployeeSkillForm({ ...employeeSkillForm, skillId: e.target.value })}><option value="">Select skill</option>{skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label>
          <label>Proficiency<select value={employeeSkillForm.proficiencyLevel} onChange={(e) => setEmployeeSkillForm({ ...employeeSkillForm, proficiencyLevel: e.target.value })}>{[1,2,3,4,5].map((level) => <option key={level} value={level}>Level {level}</option>)}</select></label>
          <label style={{ gridColumn: "1 / -1" }}>Evidence / notes<textarea rows={2} value={employeeSkillForm.notes} onChange={(e) => setEmployeeSkillForm({ ...employeeSkillForm, notes: e.target.value })} /></label>
        </div><div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowEmployeeSkill(false)}>Cancel</button><button className="primary-button">Verify skill</button></div></form>
      )}

      {showPlan && formCard("Create a development plan", "DEVELOPMENT", () => setShowPlan(false),
        <form onSubmit={createPlan}><div className="setting-form">
          <label>Employee<select required value={planForm.employeeId} onChange={(e) => {
            const employee = employeeById.get(Number(e.target.value));
            setPlanForm({ ...planForm, employeeId: e.target.value, performanceReviewId: employee?.latestPerformanceReview?.id ? String(employee.latestPerformanceReview.id) : "" });
          }}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>
          <label>Performance review<select value={planForm.performanceReviewId} onChange={(e) => setPlanForm({ ...planForm, performanceReviewId: e.target.value })}><option value="">No linked review</option>{employees.filter((employee) => String(employee.id) === planForm.employeeId && employee.latestPerformanceReview?.id).map((employee) => <option key={employee.latestPerformanceReview!.id} value={employee.latestPerformanceReview!.id}>Latest completed review · {employee.latestPerformanceReview?.finalScore ?? "—"}/5</option>)}</select></label>
          <label>Plan title<input required value={planForm.title} onChange={(e) => setPlanForm({ ...planForm, title: e.target.value })} placeholder="Ready for Senior Payroll Analyst" /></label>
          <label>Target date<input type="date" value={planForm.targetDate} onChange={(e) => setPlanForm({ ...planForm, targetDate: e.target.value })} /></label>
          <label style={{ gridColumn: "1 / -1" }}>Notes<textarea rows={2} value={planForm.notes} onChange={(e) => setPlanForm({ ...planForm, notes: e.target.value })} /></label>
        </div><div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowPlan(false)}>Cancel</button><button className="primary-button">Create plan</button></div></form>
      )}

      {showPlanItem && formCard("Add a development activity", "PLAN ACTIVITY", () => setShowPlanItem(false),
        <form onSubmit={addPlanItem}><div className="setting-form">
          <label>Development plan<select required value={itemForm.planId} onChange={(e) => setItemForm({ ...itemForm, planId: e.target.value })}><option value="">Select plan</option>{activePlans.map((plan) => <option key={plan.id} value={plan.id}>{employeeById.get(plan.employeeId)?.firstName} · {plan.title}</option>)}</select></label>
          <label>Skill<select value={itemForm.skillId} onChange={(e) => setItemForm({ ...itemForm, skillId: e.target.value })}><option value="">General development</option>{skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label>
          <label>Activity<input required value={itemForm.title} onChange={(e) => setItemForm({ ...itemForm, title: e.target.value })} placeholder="Shadow monthly payroll close" /></label>
          <label>Type<select value={itemForm.activityType} onChange={(e) => setItemForm({ ...itemForm, activityType: e.target.value })}><option value="training">Training</option><option value="mentoring">Mentoring</option><option value="project">Project</option><option value="coaching">Coaching</option><option value="certification">Certification</option><option value="reading">Reading</option></select></label>
          <label>Target level<select value={itemForm.targetLevel} onChange={(e) => setItemForm({ ...itemForm, targetLevel: e.target.value })}><option value="">No level target</option>{[1,2,3,4,5].map((level) => <option key={level} value={level}>Level {level}</option>)}</select></label>
          <label>Due date<input type="date" value={itemForm.dueDate} onChange={(e) => setItemForm({ ...itemForm, dueDate: e.target.value })} /></label>
        </div><div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowPlanItem(false)}>Cancel</button><button className="primary-button">Add activity</button></div></form>
      )}

      {showCourse && formCard("Create a course", "LEARNING CATALOG", () => setShowCourse(false),
        <form onSubmit={createCourse}><div className="setting-form">
          <label>Course code<input required value={courseForm.code} onChange={(e) => setCourseForm({ ...courseForm, code: e.target.value.toUpperCase() })} placeholder="PAY-201" /></label>
          <label>Title<input required value={courseForm.title} onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })} placeholder="Advanced PH Payroll Compliance" /></label>
          <label>Provider<input required value={courseForm.provider} onChange={(e) => setCourseForm({ ...courseForm, provider: e.target.value })} /></label>
          <label>Delivery<select value={courseForm.deliveryMode} onChange={(e) => setCourseForm({ ...courseForm, deliveryMode: e.target.value })}><option value="self_paced">Self-paced</option><option value="instructor_led">Instructor-led</option><option value="external">External</option><option value="on_the_job">On the job</option></select></label>
          <label>Verified skill<select value={courseForm.skillId} onChange={(e) => setCourseForm({ ...courseForm, skillId: e.target.value })}><option value="">No skill award</option>{skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label>
          <label>Awarded level<select value={courseForm.awardedLevel} onChange={(e) => setCourseForm({ ...courseForm, awardedLevel: e.target.value })}><option value="">No automatic level</option>{[1,2,3,4,5].map((level) => <option key={level} value={level}>Level {level}</option>)}</select></label>
          <label>Certification name<input value={courseForm.certificationName} onChange={(e) => setCourseForm({ ...courseForm, certificationName: e.target.value })} /></label>
          <label>Validity months<input type="number" min="1" max="240" value={courseForm.validityMonths} onChange={(e) => setCourseForm({ ...courseForm, validityMonths: e.target.value })} /></label>
        </div><div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowCourse(false)}>Cancel</button><button className="primary-button">Create course</button></div></form>
      )}

      {showEnrollment && formCard("Assign structured learning", "LEARNING ASSIGNMENT", () => setShowEnrollment(false),
        <form onSubmit={assignCourse}><div className="setting-form">
          <label>Employee<select required value={enrollmentForm.employeeId} onChange={(e) => setEnrollmentForm({ ...enrollmentForm, employeeId: e.target.value, developmentPlanItemId: "" })}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>
          <label>Course<select required value={enrollmentForm.courseId} onChange={(e) => setEnrollmentForm({ ...enrollmentForm, courseId: e.target.value })}><option value="">Select course</option>{courses.filter((course) => course.active).map((course) => <option key={course.id} value={course.id}>{course.code} · {course.title}</option>)}</select></label>
          <label>Development activity<select value={enrollmentForm.developmentPlanItemId} onChange={(e) => setEnrollmentForm({ ...enrollmentForm, developmentPlanItemId: e.target.value })}><option value="">No linked plan item</option>{planItems.filter((item) => planById.get(item.planId)?.employeeId === Number(enrollmentForm.employeeId)).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label>Due date<input type="date" value={enrollmentForm.dueDate} onChange={(e) => setEnrollmentForm({ ...enrollmentForm, dueDate: e.target.value })} /></label>
        </div><div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowEnrollment(false)}>Cancel</button><button className="primary-button">Assign course</button></div></form>
      )}

      <section className="module-grid two">
        <article className="card">
          <div className="card-header">
            <div><div className="card-kicker">CAREER READINESS</div><h2>Internal mobility based on evidence</h2><p>Critical skills count double. Readiness is calculated from verified proficiency against target-role requirements.</p></div>
          </div>
          <div style={{ padding: "0 16px 12px" }}>
            <select value={selectedCareerEmployee} onChange={(e) => setSelectedCareerEmployee(e.target.value)} style={{ width: "100%" }}>
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} · {employee.title}</option>)}
            </select>
          </div>
          {selectedReadiness.length === 0 && <div className="empty-state">Add job-profile skill requirements to calculate internal-mobility readiness.</div>}
          {selectedReadiness.slice(0, 6).map((row) => (
            <div className="leave-request" key={row.targetJobProfileId}>
              <div className="inline-icon purple"><TrendingUp size={16} /></div>
              <div style={{ flex: 1 }}>
                <strong>{profileById.get(row.targetJobProfileId)?.title ?? `Job profile #${row.targetJobProfileId}`}</strong>
                <span>{row.metRequirements}/{row.totalRequirements} requirements met · {row.criticalGaps.length} critical gaps</span>
                <div style={{ marginTop: 7, height: 6, background: "var(--canvas-subtle)", borderRadius: 99, overflow: "hidden" }}><div style={{ width: `${row.readinessPercent}%`, height: "100%", background: "var(--brand)" }} /></div>
              </div>
              <strong>{row.readinessPercent}%</strong>
            </div>
          ))}
        </article>

        <article className="card">
          <div className="card-header">
            <div><div className="card-kicker">COMPETENCY ARCHITECTURE</div><h2>Skills and role requirements</h2></div>
            {canArchitect && <div style={{ display: "flex", gap: 6 }}><button className="secondary-button" onClick={() => setShowSkill(true)}>Skill</button><button className="secondary-button" onClick={() => setShowRequirement(true)}>Requirement</button></div>}
          </div>
          {skills.length === 0 && <div className="empty-state">No skills configured.</div>}
          {skills.slice(0, 12).map((skill) => {
            const usedBy = requirements.filter((row) => row.skillId === skill.id);
            return <div className="leave-request" key={skill.id}><div className="inline-icon blue"><Target size={16} /></div><div style={{ flex: 1 }}><strong>{skill.name}</strong><span>{skill.category} · required by {usedBy.length} job profiles</span></div></div>;
          })}
        </article>
      </section>

      <article className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div><div className="card-kicker">DEVELOPMENT PLANS</div><h2>Performance-to-development follow-through</h2><p>Plans can inherit a completed performance review and break growth into trackable activities.</p></div>
          {canDevelop && <button className="secondary-button" onClick={() => setShowPlanItem(true)} disabled={!activePlans.length}><Plus size={14} /> Activity</button>}
        </div>
        <div className="data-table-wrap"><table className="data-table">
          <thead><tr><th>EMPLOYEE / PLAN</th><th>REVIEW</th><th>TARGET</th><th>ACTIVITIES</th><th>STATUS</th></tr></thead>
          <tbody>
            {plans.length === 0 && <tr><td colSpan={5}><div className="empty-state">No development plans yet.</div></td></tr>}
            {plans.map((plan) => {
              const items = planItems.filter((item) => item.planId === plan.id);
              const complete = items.filter((item) => item.status === "completed").length;
              return <tr key={plan.id}>
                <td><strong>{employeeById.get(plan.employeeId)?.firstName} {employeeById.get(plan.employeeId)?.lastName}</strong><small style={{ display: "block", color: "var(--muted)" }}>{plan.title}</small></td>
                <td>{plan.performanceReviewId ? `#${plan.performanceReviewId}` : "—"}</td>
                <td>{plan.targetDate ?? "—"}</td>
                <td>{complete}/{items.length} complete</td>
                <td><span className={plan.status === "completed" ? "status status-verified" : "status"}>{plan.status}</span></td>
              </tr>;
            })}
          </tbody>
        </table></div>
        {planItems.filter((item) => item.status !== "completed" && item.status !== "cancelled").slice(0, 8).map((item) => (
          <div className="leave-request" key={item.id}>
            <div className="inline-icon mint"><Target size={16} /></div>
            <div style={{ flex: 1 }}><strong>{item.title}</strong><span>{planById.get(item.planId)?.title} · {item.activityType}{item.skillId ? ` · ${skillById.get(item.skillId)?.name ?? "Skill"}` : ""}{item.dueDate ? ` · due ${item.dueDate}` : ""}</span></div>
            <div style={{ display: "flex", gap: 6 }}>{item.status === "planned" && <button className="secondary-button" onClick={() => void updatePlanItem(item, "in_progress")}>Start</button>}<button className="secondary-button" onClick={() => void updatePlanItem(item, "completed")}>Complete</button></div>
          </div>
        ))}
      </article>

      <section className="module-grid two" style={{ marginTop: 16 }}>
        <article className="card">
          <div className="card-header">
            <div><div className="card-kicker">LEARNING</div><h2>Course assignments</h2><p>Completion can verify a linked skill and close a development activity.</p></div>
            <div style={{ display: "flex", gap: 6 }}>{canArchitect && <button className="secondary-button" onClick={() => setShowCourse(true)}>Course</button>}{canDevelop && <button className="primary-button" onClick={() => setShowEnrollment(true)} disabled={!courses.length}>Assign</button>}</div>
          </div>
          {enrollments.length === 0 && <div className="empty-state">No learning assignments yet.</div>}
          {enrollments.slice(0, 12).map((enrollment) => (
            <div className="leave-request" key={enrollment.id}>
              <div className="inline-icon blue"><BookOpen size={16} /></div>
              <div style={{ flex: 1 }}><strong>{courseById.get(enrollment.courseId)?.title ?? `Course #${enrollment.courseId}`}</strong><span>{employeeById.get(enrollment.employeeId)?.firstName} {employeeById.get(enrollment.employeeId)?.lastName} · {enrollment.status}{enrollment.dueDate ? ` · due ${enrollment.dueDate}` : ""}</span></div>
              {enrollment.status === "assigned" && <button className="secondary-button" onClick={() => void updateEnrollment(enrollment, "in_progress")}>Start</button>}
              {["assigned", "in_progress"].includes(enrollment.status) && <button className="primary-button" onClick={() => void updateEnrollment(enrollment, "completed")}>Complete</button>}
            </div>
          ))}
        </article>

        <article className="card">
          <div className="card-header"><div><div className="card-kicker">CERTIFICATIONS</div><h2>Credential evidence and expiry</h2></div></div>
          {certifications.length === 0 && <div className="empty-state">No certifications recorded.</div>}
          {certifications.slice(0, 12).map((cert) => (
            <div className="leave-request" key={cert.id}>
              <div className="inline-icon orange"><Award size={16} /></div>
              <div style={{ flex: 1 }}><strong>{cert.name}</strong><span>{employeeById.get(cert.employeeId)?.firstName} {employeeById.get(cert.employeeId)?.lastName} · {cert.issuer}{cert.expiresOn ? ` · expires ${cert.expiresOn}` : " · no expiry"}</span></div>
              <span className={cert.effectiveStatus === "active" ? "status status-verified" : "status"}>{cert.effectiveStatus}</span>
            </div>
          ))}
        </article>
      </section>
    </div>
  );
}
