import assert from "node:assert/strict";
import { asc, eq } from "drizzle-orm";
import { auditBusinessSnapshot } from "./tenant-table-invariants.mjs";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
let runtimePromise;
const runtime = () => runtimePromise ??= Promise.all([
  import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
]).then(([database, schema]) => ({ db: database.db, schema }));
const tableNames = ["hcmSkills", "jobProfiles", "jobFamilies", "jobLevels", "hcmJobProfileSkillRequirements",
  "hcmSkillExpectationDefaults", "performanceTemplates", "performanceCycles", "performanceReviews",
  "performanceReviewItems", "performanceGoals", "performanceOneOnOnes", "performanceFeedback",
  "performanceSkillDevelopmentPlans", "performanceSkillDevelopmentMilestones",
  "performanceSkillDevelopmentPlanEvents", "employeePayProfiles", "payrollRuns", "auditEvents"];
function engine() {
  const state = async orgId => {
    const { db, schema: t } = await runtime(); const result = {};
    for (const name of tableNames) result[name] = await db.select().from(t[name])
      .where(eq(t[name].organizationId, orgId)).orderBy(asc(t[name].id));
    result.auditEvents = auditBusinessSnapshot(result.auditEvents); return result;
  };
  const seed = async e => {
    if (e.seeded.performanceDevelopment) return e.seeded.performanceDevelopment;
    const { db, schema: t } = await runtime();
    const insert = async (name, values) => (await db.insert(t[name]).values({ organizationId: e.org.id, ...values }).returning())[0];
    const skill = await insert("hcmSkills", { code: e.marker, name: e.marker + " skill" });
    const family = await insert("jobFamilies", { code: e.marker, name: e.marker });
    const level = await insert("jobLevels", { code: e.marker, name: e.marker, rank: 1 });
    const profile = await insert("jobProfiles", { title: e.marker, familyId: family.id });
    const requirement = await insert("hcmJobProfileSkillRequirements", { jobProfileId: profile.id, skillId: skill.id, minimumProficiency: 4 });
    const expectation = await insert("hcmSkillExpectationDefaults", { jobFamilyId: family.id, skillId: skill.id, minimumProficiency: 4 });
    const template = await insert("performanceTemplates", { code: e.marker, name: e.marker, type: "competency" });
    const goal = await insert("performanceGoals", { employeeId: e.worker.id, scope: "employee", title: e.marker });
    const completed = [];
    for (const [startDate, endDate] of [["2026-01-01", "2026-02-01"], ["2026-02-02", "2026-03-01"]]) {
      const cycle = await insert("performanceCycles", { name: e.marker + startDate, startDate, endDate, status: "completed" });
      const review = await insert("performanceReviews", { employeeId: e.worker.id, cycleId: cycle.id, status: "completed", finalScore: "2.00" });
      const item = await insert("performanceReviewItems", { reviewId: review.id, templateId: template.id,
        skillId: skill.id, expectedProficiency: 4, finalScore: "2.00" });
      completed.push({ cycle, review, item });
    }
    const otherSkill = await insert("hcmSkills", { code: e.marker + "-OTHER", name: e.marker + " other skill" });
    const plan = await insert("performanceSkillDevelopmentPlans", { employeeId: e.worker.id, skillId: otherSkill.id,
      title: e.marker + " existing plan", objective: e.marker + " existing fictional objective", targetProficiency: "4.00",
      targetDate: "2026-12-01", createdByUserId: e.owner.id, createdByName: e.owner.name });
    const result = { id: skill.id, skill, family, level, profile, requirement, expectation, template, goal, completed, plan };
    e.seeded.performanceDevelopment = result; return result;
  };
  const created = (before, after, name, c, predicate) => {
    assert.equal(after[name].length, before[name].length + 1, name + ": exactly one own row");
    const rows = after[name].filter(r => !before[name].some(old => old.id === r.id));
    assert.equal(rows.length, 1); const row = rows[0];
    assert.equal(row.organizationId, c.orgId); assert.ok(predicate(row)); return row;
  };
  const unchanged = (before, after, names) => names.forEach(name => assert.deepEqual(after[name], before[name], name));
  const audit = (before, after, c, action) => {
    const rows = after.auditEvents.filter(r => !before.auditEvents.some(old => old.id === r.id));
    assert.ok(rows.some(r => r.organizationId === c.orgId && r.actor === c.owner.name && r.action === action), action);
  };
  // Every extra branch uses real HTTP with the same attacker session; exact own,
  // genuine victim-org denial and forged victim-resource denial precede credit.
  const firstActions = new Map(), counts = { pairs: 0, forged: 0, discrimination: 0 };
  const extra = async (c, io, method, route, body, foreign, forged, check) => {
    const before = JSON.parse(JSON.stringify(await state(c.orgId)));
    const owned = io.expectStatus(await io.request("/api/" + route, { method, cookie: io.cookie, body }), method === "POST" ? 201 : 200, route + " extra own action");
    const after = JSON.parse(JSON.stringify(await state(c.orgId)));
    assert.notDeepEqual(after, before); check(before, after, owned);
    unchanged(before, after, ["employeePayProfiles", "payrollRuns"]);
    const key = method + route + body.entityType + (body.visibility ?? "");
    if (c.rank === 1) firstActions.set(key, { before, after, owned });
    else { const first = firstActions.get(key); assert.ok(first); await assert.rejects(async () => check(first.before, first.after, first.owned), "additional action proof accepts another employer's data"); counts.discrimination++; }
    const victim = io.expectStatus(await io.request("/api/" + route, { method, cookie: io.cookie, body: foreign }), 403, route + " extra victim organization");
    assert.ok(!victim.text.includes(c.victim.marker));
    for (const forgedBody of forged) {
      const denied = io.expectStatus(await io.request("/api/" + route, { method, cookie: io.cookie, body: forgedBody }), 404, route + " extra forged resource");
      assert.ok(!denied.text.includes(c.victim.marker)); counts.forged++;
    }
    assert.deepEqual(JSON.parse(JSON.stringify(await state(c.orgId))), after, "extra refusals leave own state unchanged");
    counts.pairs++; return owned.json;
  };
return { state, seed, created, unchanged, audit, extra, counts };
}

export const METHODS = Object.freeze(["POST performance/competencies", "PATCH performance/competencies", "POST performance/continuous", "POST performance/development-plans"]);
export function verifyCredit(key, method, read = file => readFileSync(file, "utf8")) {
  assert.ok(METHODS.includes(key), "only independently completed development methods may leave the historical hold");
  assert.equal(method.status, "COVERED");
  assert.equal(method.testedBy?.file, "scripts/qa/tenant-write-table-http.mjs");
  assert.equal(method.testedBy.rowFile, "scripts/qa/tenant-table-rows/write/performance-growth.mjs");
  const proof = method.testedBy.supplementalProof;
  assert.equal(proof?.file, "scripts/qa/tenant-performance-development-actions.mjs");
  const source = read(proof.file).replaceAll("\r\n", "\n");
  assert.equal(proof.sha256, createHash("sha256").update(source).digest("hex"), "additional action proof source drift");
  for (const [field, fragment] of [["ownPositiveLine", "const owned = io.expectStatus"], ["foreignDenialLine", "const victim = io.expectStatus"], ["forgedSelectorLine", "const denied = io.expectStatus"], ["unchangedDbLine", "all supplemental victim tables and audit remain unchanged"]]) assert.ok(source.split("\n")[proof[field]-1]?.includes(fragment), field);
  assert.ok(proof.scope.includes("All supported entityType actions"));
  assert.ok(method.testedBy.evidence.includes("14 pairs/7 discrimination/26 forged"));
}
let proof, victimBefore, victimId;
const fixtures = new Map();
const plain = value => JSON.parse(JSON.stringify(value));
export async function prepare(rows, employers) {
  proof = undefined; fixtures.clear();
  if (!rows.some(row => METHODS.includes(row.key))) return;
  proof = engine();
  for (const e of [employers[1], employers[2], employers[0]]) fixtures.set(e.org.id, await proof.seed(e));
  victimId = employers[0].org.id; victimBefore = plain(await proof.state(victimId));
}
export async function finish() {
  if (proof) { assert.deepEqual(plain(await proof.state(victimId)), victimBefore, "all supplemental victim tables and audit remain unchanged"); assert.deepEqual(proof.counts, { pairs: 14, forged: 26, discrimination: 7 }); console.log(JSON.stringify({ kind: "performance-development-actions", ...proof.counts, victimDatabaseUnchanged: true })); }
}
export async function exercise(key, c, io) {
  if (!METHODS.includes(key)) return;
  assert.ok(proof && fixtures.has(c.orgId), "additional proof fixtures required");
  const { state, created, extra } = proof;
  const own = fixtures.get(c.orgId), victim = fixtures.get(c.victim.org.id);
  if (key === "POST performance/competencies") {
    const skillBody = { organizationId: c.orgId, entityType: "skill", code: c.marker + "-SUPPLEMENT", name: c.marker + " supplementary skill" };
    const skill = await extra(c, io, "POST", "performance/competencies", skillBody, { ...skillBody, organizationId: c.victim.org.id }, [],
      (b, a, r) => { const row = created(b, a, "hcmSkills", c, x => x.code === skillBody.code.toUpperCase() && x.createdByUserId === c.owner.id); assert.equal(r.json.id, row.id); });
    const body = { organizationId: c.orgId, entityType: "expectation_default", jobFamilyId: own.family.id, jobLevelId: own.level.id, skillId: skill.id, minimumProficiency: 3 };
    await extra(c, io, "POST", "performance/competencies", body, { ...body, organizationId: c.victim.org.id },
      [{ ...body, jobFamilyId: victim.family.id }, { ...body, jobLevelId: victim.level.id }, { ...body, skillId: victim.skill.id }],
      (b, a, r) => { const row = created(b, a, "hcmSkillExpectationDefaults", c, x => x.skillId === skill.id && x.jobFamilyId === own.family.id && x.jobLevelId === own.level.id); assert.equal(r.json.id, row.id); });
  }
  if (key === "PATCH performance/competencies") {
    const body = { organizationId: c.orgId, entityType: "template_mapping", templateId: own.template.id, skillId: own.skill.id, jobProfileId: own.profile.id };
    await extra(c, io, "PATCH", "performance/competencies", body, { ...body, organizationId: c.victim.org.id },
      [{ ...body, templateId: victim.template.id }, { ...body, skillId: victim.skill.id }, { ...body, jobProfileId: victim.profile.id }],
      (b, a, r) => { const row = a.performanceTemplates.find(x => x.id === own.template.id); assert.equal(row.organizationId, c.orgId); assert.equal(row.skillId, own.skill.id); assert.equal(row.jobProfileId, own.profile.id); assert.equal(r.json.id, row.id); });
    const inherited = { organizationId: c.orgId, entityType: "expectation_default", id: own.expectation.id, minimumProficiency: 2, mandatory: true };
    await extra(c, io, "PATCH", "performance/competencies", inherited, { ...inherited, organizationId: c.victim.org.id }, [{ ...inherited, id: victim.expectation.id }],
      (b, a, r) => { const row = a.hcmSkillExpectationDefaults.find(x => x.id === own.expectation.id); assert.equal(row.organizationId, c.orgId); assert.equal(row.minimumProficiency, 2); assert.equal(r.json.id, row.id); });
  }
  if (key === "POST performance/continuous") for (const visibility of ["employee_shared", "manager_private"]) {
    const body = { organizationId: c.orgId, entityType: "feedback", employeeId: c.workerId, goalId: own.goal.id, feedbackType: "development", visibility, content: c.marker + " " + visibility };
    await extra(c, io, "POST", "performance/continuous", body, { ...body, organizationId: c.victim.org.id },
      [{ ...body, employeeId: c.victim.worker.id }, { ...body, goalId: victim.goal.id }],
      (b, a, r) => { const row = created(b, a, "performanceFeedback", c, x => x.employeeId === c.workerId && x.visibility === visibility && x.content === body.content); assert.equal(row.authorUserId, c.owner.id); assert.equal(r.json.id, row.id); });
  }
  if (key === "POST performance/development-plans") {
    const body = { organizationId: c.orgId, entityType: "plan", employeeId: c.workerId, skillId: own.skill.id, title: c.marker + " new verified-gap plan", objective: c.marker + " fictional skill improvement", targetDate: "2026-12-01", targetProficiency: 4 };
    await extra(c, io, "POST", "performance/development-plans", body, { ...body, organizationId: c.victim.org.id },
      [{ ...body, employeeId: c.victim.worker.id }, { ...body, skillId: victim.skill.id }],
      (b, a, r) => {
        const row = created(b, a, "performanceSkillDevelopmentPlans", c, x => x.employeeId === c.workerId && x.skillId === own.skill.id && x.title === body.title);
        assert.equal(row.sourceCycleId, own.completed[1].cycle.id); assert.equal(row.currentProficiency, "2.00"); assert.equal(row.targetProficiency, "4.00");
        assert.equal(row.createdByUserId, c.owner.id); assert.equal(r.json.id, row.id);
        assert.deepEqual(a.performanceReviews, b.performanceReviews); assert.deepEqual(a.performanceReviewItems, b.performanceReviewItems);
      });
  }
  const current = plain(await state(c.orgId));
  assert.ok(current.auditEvents.some(e => e.organizationId === c.orgId && e.actor === c.owner.name));
  assert.deepEqual(plain(await state(victimId)), victimBefore, "each action leaves every victim record unchanged");
}
