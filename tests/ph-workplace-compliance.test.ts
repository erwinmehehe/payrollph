import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import {
  phCivilDate, positiveId, limitedText, isOneOf, validDateRange, sha256Digest,
  mayAdvanceDoleRecord, mayReadProtectedCase, mayTransitionProtectedCase, protectedCaseDetailRequiresMfa,
  PROTECTED_CASE_STATES, DOLE_EXTENDED_REPORT_TYPES,
} from "../src/lib/ph-workplace-compliance-policy";
import { sealWorkplaceStatement, openWorkplaceStatement } from "../src/lib/ph-workplace-statement-crypto";
import { workplacePilotFlagEnabled, workplacePilotFlagInventory, PH_WORKPLACE_PILOT_FLAGS } from "../src/lib/ph-workplace-release-flags";

test("three protected workplace modules remain disabled without explicit true flags", () => {
  for (const flag of ["phDoleExtended", "phOshRecords", "phProtectedCases"] as const) {
    assert.equal(workplacePilotFlagEnabled(flag, {}), false);
  }
});
test("PH civil dates reject impossible dates and never coerce time zones", () => {
  assert.equal(phCivilDate("2026-02-29"), null);
  assert.equal(phCivilDate("2024-02-29"), "2024-02-29");
  assert.equal(phCivilDate("2026-11-16T00:00:00Z"), null);
  assert.equal(validDateRange("2026-12-01", "2026-11-30"), false);
  assert.equal(validDateRange("2026-11-01", "2026-11-30"), true);
  assert.equal(positiveId("1.0"), null);
  assert.equal(positiveId("01"), null);
  assert.equal(positiveId("7"), 7);
});
test("evidence inputs reject invalid lengths, plain SHA and unsupported DOLE report names", () => {
  assert.equal(sha256Digest("ABC"), null);
  assert.equal(sha256Digest("a".repeat(64)), "a".repeat(64));
  assert.equal(limitedText("PRIVATE\nTEXT", 3), null);
  assert.equal(isOneOf("wair", Object.keys(DOLE_EXTENDED_REPORT_TYPES)), true);
  assert.equal(isOneOf("certified_auto_submission", Object.keys(DOLE_EXTENDED_REPORT_TYPES)), false);
});
test("DOLE receipt recording is not independent acceptance and review requires second signer", () => {
  assert.equal(mayAdvanceDoleRecord("draft", "submitted_recorded", { hasReceipt: false, independentReviewer: false }), false);
  assert.equal(mayAdvanceDoleRecord("draft", "submitted_recorded", { hasReceipt: true, independentReviewer: false }), true);
  assert.equal(mayAdvanceDoleRecord("submitted_recorded", "accepted_recorded", { hasReceipt: true, independentReviewer: false }), true);
  assert.equal(mayAdvanceDoleRecord("accepted_recorded", "independently_reviewed", { hasReceipt: true, independentReviewer: false }), false);
  assert.equal(mayAdvanceDoleRecord("accepted_recorded", "independently_reviewed", { hasReceipt: true, independentReviewer: true }), true);
  assert.equal(mayAdvanceDoleRecord("rejected_recorded", "independently_reviewed", { hasReceipt: true, independentReviewer: true }), false);
});
test("complaint readers are limited to creator or named investigator/reviewer", () => {
  const claim = { viewerId: 90, creatorId: 1, investigatorId: 2, reviewerId: 3 };
  assert.equal(mayReadProtectedCase(claim), false);
  for (const id of [1, 2, 3]) assert.equal(mayReadProtectedCase({ ...claim, viewerId: id }), true);
  assert.equal(mayReadProtectedCase({ viewerId: 3, creatorId: 1, investigatorId: 2, reviewerId: null }), false);
});
test("appointed officers must have MFA even when their global account role is employee", () => {
  assert.equal(protectedCaseDetailRequiresMfa("employee", false), false);
  assert.equal(protectedCaseDetailRequiresMfa("employee", true), true);
  assert.equal(protectedCaseDetailRequiresMfa("admin", false), true);
  assert.equal(protectedCaseDetailRequiresMfa("admin", true), true);
  const route = readFileSync("src/pilots/workplace/api/protected-cases.ts", "utf8");
  assert.ok(route.includes("protectedCaseDetailRequiresMfa(session.role, officer)"));
  assert.ok(route.includes("requireSensitiveActionMfa(session)"));
});
test("case decisions require independent reviewer and valid state machine", () => {
  assert.deepEqual([...PROTECTED_CASE_STATES], ["intake", "investigating", "review_pending", "closed"]);
  const base = { actorId: 2, creatorId: 1, investigatorId: 2, reviewerId: 3 };
  assert.equal(mayTransitionProtectedCase({ ...base, current: "intake", next: "investigating" }), true);
  assert.equal(mayTransitionProtectedCase({ ...base, current: "investigating", next: "review_pending" }), true);
  assert.equal(mayTransitionProtectedCase({ ...base, actorId: 2, current: "review_pending", next: "closed" }), false);
  assert.equal(mayTransitionProtectedCase({ ...base, actorId: 3, current: "review_pending", next: "closed" }), true);
  assert.equal(mayTransitionProtectedCase({ ...base, reviewerId: 2, current: "investigating", next: "review_pending" }), false);
  assert.equal(mayTransitionProtectedCase({ ...base, reviewerId: 1, current: "investigating", next: "review_pending" }), false);
  assert.equal(mayTransitionProtectedCase({ ...base, actorId: 1, current: "review_pending", next: "closed" }), false);
});
test("case statement encryption fails closed without a key and uses domain-separated AEAD", () => {
  const oldEnv = { PII_ENCRYPTION_KEY: "11".repeat(32) };
  const statement = "A fictional private workplace concern for restricted pilot testing.";
  assert.throws(() => sealWorkplaceStatement(statement, {}), /not configured/);
  const binding = { organizationId: 7, legalEntityId: 9, caseId: 41 };
  const sealed = sealWorkplaceStatement(statement, binding, oldEnv);
  assert.equal(sealed.includes(statement), false);
  assert.match(sealed, /^enc:ph-workplace-case:v2:/);
  assert.equal(openWorkplaceStatement(sealed, binding, oldEnv), statement);
  const rotation = { PII_ENCRYPTION_KEY: "22".repeat(32), PII_ENCRYPTION_KEY_PREVIOUS: "11".repeat(32) };
  assert.equal(openWorkplaceStatement(sealed, binding, rotation), statement);
  assert.throws(() => openWorkplaceStatement(sealed, binding, { PII_ENCRYPTION_KEY: "22".repeat(32) }));
  const parts = sealed.split(":");
  const last = parts.at(-1)!;
  // Replace a *decoded ciphertext byte* rather than a potentially unused
  // trailing base64 bit to guarantee GCM authentication failure.
  const bytes = Buffer.from(last, "base64url");
  bytes[0] ^= 1;
  parts[parts.length - 1] = bytes.toString("base64url");
  assert.throws(() => openWorkplaceStatement(parts.join(":"), binding, oldEnv));
  assert.throws(() => openWorkplaceStatement(statement, binding, oldEnv));
  for (const changed of [
    { ...binding, organizationId: 8 }, { ...binding, legalEntityId: 10 },
    { ...binding, caseId: 42 },
  ]) assert.throws(() => openWorkplaceStatement(sealed, changed, oldEnv),
    "A case's ciphertext must fail authentication under another tenant/entity/case ID");
  assert.throws(() => sealWorkplaceStatement(statement, { ...binding, caseId: 0 }, oldEnv));
});
test("new APIs do not write raw statements to the audit metadata or call external portals", () => {
  const conduct = readFileSync("src/pilots/workplace/api/protected-cases.ts", "utf8");
  const dole = readFileSync("src/pilots/workplace/api/dole-extended.ts", "utf8");
  assert.ok(conduct.includes("sealWorkplaceStatement(statement, {"));
  assert.ok(conduct.includes('sealedStatement: "pending:transaction-only"'));
  assert.ok(conduct.includes("await tx.insert(workplaceCaseAuditTrail).values({"));
  assert.ok(conduct.includes("actorUserId: session.id"));
  assert.ok(conduct.includes("openWorkplaceStatement(row.sealedStatement, {"));
  assert.ok(conduct.includes("mayReadProtectedCase("));
  assert.ok(conduct.includes("recordAuditEvent("));
  assert.ok(!conduct.includes("metadata: { statement"));
  assert.ok(!dole.includes("fetch(\"https://reports.dole.gov.ph"));
  assert.ok(dole.includes("agencySubmissionPerformed: false"));
});


test("workplace schema is isolated from source-sealed payroll schema and included in sandbox Drizzle sources", () => {
  const core = readFileSync("src/db/schema.ts", "utf8");
  const isolated = readFileSync("src/db/workplace-compliance-schema.ts", "utf8");
  const config = readFileSync("drizzle.config.ts", "utf8");
  const sandboxConfig = readFileSync("drizzle.workplace-pilot.config.ts", "utf8");
  assert.doesNotMatch(core, /export const (doleExtendedReports|oshSafetyEvents|oshTrainingRecords|workplaceCaseOfficers|workplaceProtectedCases)\s*=/);
  for (const table of ["doleExtendedReports", "oshSafetyEvents", "oshTrainingRecords", "workplaceCaseOfficers", "workplaceProtectedCases", "workplaceCaseAuditTrail", "workplaceCaseReassignmentRequests"]) {
    assert.ok(isolated.includes("export const " + table + " = pgTable("), table);
  }
  assert.ok(!config.includes("./src/db/workplace-compliance-schema.ts"));
  assert.ok(sandboxConfig.includes("./src/db/workplace-compliance-schema.ts"));
  assert.ok(sandboxConfig.includes("assertIsolatedDbPushTarget(process.env.DATABASE_URL, process.env)"));
});

test("private allegation narratives are retrieved only by one authorized detail read, not bulk case lists", () => {
  const route = readFileSync("src/pilots/workplace/api/protected-cases.ts", "utf8");
  const employee = readFileSync("src/components/employee-workplace-concern.tsx", "utf8");
  const console = readFileSync("src/components/workplace-compliance-console.tsx", "utf8");
  assert.ok(route.includes('getAll("caseId")'));
  assert.ok(route.includes("requestedCaseId ? 1 : 50"));
  assert.ok(route.includes("caseId"));
  assert.ok(route.includes("requestedCaseId") && route.includes("authorized.map(presentCase)"));
  assert.ok(route.includes("requireSensitiveActionMfa(session)"));
  assert.ok(route.includes("mayReadProtectedCase({"));
  assert.ok(employee.includes("<PrivateWorkplaceStatement"));
  assert.ok(console.includes("<PrivateWorkplaceStatement"));
  assert.ok(!employee.includes("{c.statement}"));
  assert.ok(!console.includes("String(r.statement ??"));
});


test("confidential case statements remain bound to their exact employer and case", () => {
  const component = readFileSync("src/components/private-workplace-statement.tsx", "utf8");
  assert.ok(component.includes('const scopeKey = organizationId + ":" + caseId;'));
  assert.ok(component.includes("revealed?.scopeKey === scopeKey"));
  assert.ok(component.includes("setRevealed({ scopeKey, statement: record.statement })"));
  assert.ok(component.includes("}, [scopeKey]);"));
});
test("workplace pilot gate metadata is complete, distinct, exact-true and separately reviewed", () => {
  const entries = workplacePilotFlagInventory();
  assert.equal(entries.length, 3);
  assert.equal(new Set(entries.map(x => x.env)).size, 3);
  for (const entry of entries) {
    assert.ok(entry.owner && entry.risk && entry.approval);
    assert.equal(entry.defaultEnabled, false);
    assert.equal(entry.releaseApproved, false);
    const flag = entry.key as keyof typeof PH_WORKPLACE_PILOT_FLAGS;
    for (const value of [undefined, "TRUE", "on", "1", "", "false"]) {
      assert.equal(workplacePilotFlagEnabled(flag, { [entry.env]: value }), false);
    }
    assert.equal(workplacePilotFlagEnabled(flag, { [entry.env]: "true" }), true);
  }
  assert.throws(() => workplacePilotFlagEnabled("inventedGate" as never, {}),
    /Unknown workplace release-critical/);
});
test("original source-sealed release registry is not modified by workplace pilot", () => {
  const global = readFileSync("src/lib/critical-release-flags.ts", "utf8");
  assert.ok(!global.includes("PH_DOLE_EXTENDED_REPORTS_ENABLED"));
  assert.ok(!global.includes("PH_PROTECTED_WORKPLACE_CASES_ENABLED"));
  const workplace = readFileSync("src/lib/ph-workplace-context.ts", "utf8");
  assert.ok(workplace.includes('workplacePilotFlagEnabled(flag)'));
  assert.ok(workplace.includes('criticalReleaseFlagEnabled("multiEntity")'));
});


test("protected intake and reviewer assignment lock active officer records in the same transaction", () => {
  const route = readFileSync("src/pilots/workplace/api/protected-cases.ts", "utf8");
  assert.ok(route.includes("INTAKE_OFFICER_UNAVAILABLE"));
  assert.ok(route.includes("REVIEWER_UNAVAILABLE"));
  assert.ok(route.includes('eq(workplaceCaseOfficers.active, true)'));
  assert.ok(route.includes('eq(userOrganizations.active, true)'));
  assert.ok(route.includes('.for("update").limit(1)'));
  assert.ok(route.includes('actor: "confidential-case-intake"'));
  assert.ok(route.includes('actor: "confidential-case-review"'));
  assert.ok(!route.includes('actor: "protected-case-user:"'));
  assert.ok(!route.includes('actor: "protected-case-officer:"'));
});


test("unreviewed workplace HTTP and SSR entrypoints remain unregistered until two-employer HTTP proof", () => {
  for (const path of [
    "src/app/api/compliance/dole-extended/route.ts",
    "src/app/api/compliance/osh-events/route.ts",
    "src/app/api/compliance/osh-training/route.ts",
    "src/app/api/workplace/case-officers/route.ts",
    "src/app/api/workplace/protected-cases/route.ts",
    "src/app/api/workplace/case-reassignments/route.ts",
    "src/app/self/workplace-concern/page.tsx",
    "src/app/workspace/workplace-compliance/page.tsx",
  ]) assert.equal(existsSync(path), false, "Unproved live route must stay absent: " + path);
  for (const path of [
    "src/pilots/workplace/api/dole-extended.ts",
    "src/pilots/workplace/api/osh-events.ts",
    "src/pilots/workplace/api/osh-training.ts",
    "src/pilots/workplace/api/case-officers.ts",
    "src/pilots/workplace/api/protected-cases.ts",
    "src/pilots/workplace/api/case-reassignments.ts",
    "src/pilots/workplace/ui/employee-workplace-concern.tsx",
    "src/pilots/workplace/ui/employer-workplace-compliance.tsx",
  ]) assert.equal(existsSync(path), true, "Pilot implementation source must remain available: " + path);
});

test("restricted audit and case reassignment schema preserve composite tenant case references", () => {
  const schema = readFileSync("src/db/workplace-compliance-schema.ts", "utf8");
  const sql = readFileSync("docs/engineering/migration-candidates/0139_ph_workplace_compliance_foundation.sql", "utf8");
  const route = readFileSync("src/pilots/workplace/api/protected-cases.ts", "utf8");
  for (const name of ["workplace_cases_scope_id_uk", "workplace_case_audit_scope_fk",
    "workplace_case_reassignment_scope_fk", "workplace_case_reassignment_one_pending_uk"]) {
    assert.ok(schema.includes(name), "Drizzle requires " + name);
    assert.ok(sql.includes(name), "SQL candidate requires " + name);
  }
  assert.ok(route.includes('actorUserId: session.id'));
  assert.ok(route.includes("await tx.insert(workplaceCaseAuditTrail).values({"));
  assert.ok(!route.includes("metadata: { actorUserId"));
});

test("independent case transfer cannot be applied by one admin or a case participant", () => {
  const transfer = readFileSync("src/pilots/workplace/api/case-reassignments.ts", "utf8");
  const console = readFileSync("src/components/workplace-compliance-console.tsx", "utf8");
  assert.ok(transfer.includes('["owner", "admin"].includes(role.role)'));
  assert.ok(transfer.includes('status: "pending"'));
  assert.ok(transfer.includes("session.id === record.requestedByUserId"));
  assert.ok(transfer.includes("independentCaseAdmin("));
  assert.ok(transfer.includes("verifiedReplacement("));
  assert.ok(transfer.includes('eq(workplaceCaseReassignmentRequests.status, "pending")'));
  assert.ok(transfer.includes('if (record.officerRole === "investigator" && caseRow.status === "review_pending")'));
  assert.ok(transfer.includes(".for(\"update\").limit(1)"));
  assert.ok(transfer.includes('action: "reassignment_requested"'));
  assert.ok(transfer.includes('"reassignment_approved"'));
  assert.ok(!transfer.includes("openWorkplaceStatement("));
  assert.ok(console.includes('/api/workplace/case-reassignments'));
});

test("a self-reported digest never claims an unearned cryptographic verification", () => {
  const schema = readFileSync("src/db/workplace-compliance-schema.ts", "utf8");
  const candidate = readFileSync("docs/engineering/migration-candidates/0139_ph_workplace_compliance_foundation.sql", "utf8");
  const training = readFileSync("src/pilots/workplace/api/osh-training.ts", "utf8");
  const dole = readFileSync("src/pilots/workplace/api/dole-extended.ts", "utf8");
  const osh = readFileSync("src/pilots/workplace/api/osh-events.ts", "utf8");
  const ui = readFileSync("src/components/workplace-compliance-console.tsx", "utf8");
  assert.ok(schema.includes('attestedByUserId: integer("attested_by_user_id")'));
  assert.ok(schema.includes('attestedAt: timestamp("attested_at"'));
  assert.ok(candidate.includes("attested_by_user_id integer REFERENCES users(id)"));
  assert.ok(candidate.includes("attested_at timestamptz"));
  assert.ok(training.includes('body.action !== "attest"'));
  assert.ok(training.includes("old.attestedAt"));
  assert.ok(training.includes("artifactDigestVerified: false"));
  assert.ok(dole.includes("artifactDigestVerified: false"));
  assert.ok(osh.includes("artifactDigestVerified: false"));
  assert.ok(ui.includes('value="attest"'));
  assert.ok(!training.includes("verifiedAt: new Date()"));
});
