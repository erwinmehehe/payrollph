import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  phCivilDate, positiveId, limitedText, isOneOf, validDateRange, sha256Digest,
  mayAdvanceDoleRecord, mayReadProtectedCase, mayTransitionProtectedCase,
  PROTECTED_CASE_STATES, DOLE_EXTENDED_REPORT_TYPES,
} from "../src/lib/ph-workplace-compliance-policy";
import { sealWorkplaceStatement, openWorkplaceStatement } from "../src/lib/ph-workplace-statement-crypto";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";

test("three protected workplace modules remain disabled without explicit true flags", () => {
  for (const flag of ["phDoleExtended", "phOshRecords", "phProtectedCases"] as const) {
    assert.equal(criticalReleaseFlagEnabled(flag, {}), false);
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
  const sealed = sealWorkplaceStatement(statement, oldEnv);
  assert.equal(sealed.includes(statement), false);
  assert.match(sealed, /^enc:ph-workplace-case:v1:/);
  assert.equal(openWorkplaceStatement(sealed, oldEnv), statement);
  const rotation = { PII_ENCRYPTION_KEY: "22".repeat(32), PII_ENCRYPTION_KEY_PREVIOUS: "11".repeat(32) };
  assert.equal(openWorkplaceStatement(sealed, rotation), statement);
  assert.throws(() => openWorkplaceStatement(sealed, { PII_ENCRYPTION_KEY: "22".repeat(32) }));
  const parts = sealed.split(":");
  const last = parts.at(-1)!;
  // Replace a *decoded ciphertext byte* rather than a potentially unused
  // trailing base64 bit to guarantee GCM authentication failure.
  const bytes = Buffer.from(last, "base64url");
  bytes[0] ^= 1;
  parts[parts.length - 1] = bytes.toString("base64url");
  assert.throws(() => openWorkplaceStatement(parts.join(":"), oldEnv));
  assert.throws(() => openWorkplaceStatement(statement, oldEnv));
});
test("new APIs do not write raw statements to the audit metadata or call external portals", () => {
  const conduct = readFileSync("src/app/api/workplace/protected-cases/route.ts", "utf8");
  const dole = readFileSync("src/app/api/compliance/dole-extended/route.ts", "utf8");
  assert.ok(conduct.includes("sealWorkplaceStatement(statement)"));
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
  for (const table of ["doleExtendedReports", "oshSafetyEvents", "oshTrainingRecords", "workplaceCaseOfficers", "workplaceProtectedCases"]) {
    assert.ok(isolated.includes("export const " + table + " = pgTable("), table);
  }
  assert.ok(!config.includes("./src/db/workplace-compliance-schema.ts"));
  assert.ok(sandboxConfig.includes("./src/db/workplace-compliance-schema.ts"));
  assert.ok(sandboxConfig.includes("assertIsolatedDbPushTarget(process.env.DATABASE_URL, process.env)"));
});

test("private allegation narratives are retrieved only by one authorized detail read, not bulk case lists", () => {
  const route = readFileSync("src/app/api/workplace/protected-cases/route.ts", "utf8");
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
