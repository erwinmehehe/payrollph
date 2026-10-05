import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/compliance/contribution-issues/evidence/route.ts", "utf8");
const panel = readFileSync("src/components/workspace/statutory-contribution-issue-cases-panel.tsx", "utf8");

test("evidence export is restricted to company-wide payroll operators", () => {
  assert.ok(route.includes("getAccess(user.id, organizationId)"));
  assert.ok(route.includes("access.companyWide"));
  assert.ok(route.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit"));
});

test("evidence export includes immutable timeline and correction history", () => {
  assert.ok(route.includes("statutoryContributionIssueEvents"));
  assert.ok(route.includes("timeline: timeline.map"));
  assert.ok(route.includes("statutoryRemittanceCorrectionRequests"));
  assert.ok(route.includes("correctionHistory: corrections.map"));
  assert.ok(route.includes("originalSnapshot"));
  assert.ok(route.includes("proposedSnapshot"));
});

test("evidence pack separates reported snapshot, payroll, remittance, filing and certification evidence", () => {
  assert.ok(route.includes("reportedSnapshot: issue.employeeSnapshot"));
  assert.ok(route.includes("payrollEvidence"));
  assert.ok(route.includes("currentRemittanceEvidence"));
  assert.ok(route.includes("filingEvidence"));
  assert.ok(route.includes("certificationHistory"));
  assert.ok(route.includes('schemaVersion: "linaw-contribution-case-evidence-v2"'));
});

test("evidence export is hashed, audited and delivered as a private attachment", () => {
  assert.ok(route.includes("buildContributionEvidencePack(payload)"));
  assert.ok(route.includes("evidenceHashSha256"));
  assert.ok(route.includes("Employee contribution case evidence exported"));
  assert.ok(route.includes('"Cache-Control": "no-store, private"'));
  assert.ok(route.includes('"X-Content-Type-Options": "nosniff"'));
});

test("payroll case UI exposes evidence download for active and resolved cases", () => {
  assert.ok(panel.includes('Download size={13}'));
  const links = panel.match(/\/api\/compliance\/contribution-issues\/evidence\?/g) ?? [];
  assert.equal(links.length, 2);
});
