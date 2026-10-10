import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { classifyDocumentRenewal, documentWatchEnabled } from "../src/lib/hcm-document-renewal-watch";

const base = {
  status: "verified", dueAt: null, expiresAt: null,
  renewalLeadDays: 30, expiryRequired: true,
};
test("renewal dates compare in Manila business-day strings without timezone drift", () => {
  assert.equal(classifyDocumentRenewal({ ...base, expiresAt: "2026-10-09" }, "2026-10-10"), "expired");
  assert.equal(classifyDocumentRenewal({ ...base, expiresAt: "2026-10-10" }, "2026-10-10"), "expiring");
  assert.equal(classifyDocumentRenewal({ ...base, expiresAt: "2026-11-09" }, "2026-10-10"), "expiring");
  assert.equal(classifyDocumentRenewal({ ...base, expiresAt: "2026-11-10" }, "2026-10-10"), "current");
});
test("missing, overdue, submitted and waived are not presented as verified", () => {
  assert.equal(classifyDocumentRenewal({ ...base, status: "missing", dueAt: "2026-10-09" }, "2026-10-10"), "overdue");
  assert.equal(classifyDocumentRenewal({ ...base, status: "missing", dueAt: "2026-10-10" }, "2026-10-10"), "missing");
  assert.equal(classifyDocumentRenewal({ ...base, status: "submitted" }, "2026-10-10"), "submitted");
  assert.equal(classifyDocumentRenewal({ ...base, status: "waived", expiresAt: "2026-01-01" }, "2026-10-10"), "waived");
});
test("watch defaults off, no implicit preview or production enablement", () => {
  assert.equal(documentWatchEnabled({ NODE_ENV: "test" } as NodeJS.ProcessEnv), false);
  assert.equal(documentWatchEnabled({ NODE_ENV: "test", HCM_DOCUMENT_RENEWAL_WATCH_ENABLED: "false" } as NodeJS.ProcessEnv), false);
  assert.equal(documentWatchEnabled({ NODE_ENV: "test", HCM_DOCUMENT_RENEWAL_WATCH_ENABLED: "true" } as NodeJS.ProcessEnv), true);
});
test("route requires authenticated company-wide HR, scopes all joins, limits SQL and is read-only", () => {
  const s = readFileSync("src/app/api/hcm/document-renewal-watch/route.ts", "utf8");
  assert.ok(s.includes("documentWatchEnabled()"));
  assert.ok(s.includes("getSessionUser()"));
  assert.ok(s.includes("assertOrganizationRole("));
  assert.ok(s.includes("!access?.companyWide"));
  assert.ok(s.includes("eq(compliance.organizationId, organizationId)"));
  assert.ok(s.includes("eq(worker.organizationId, organizationId)"));
  assert.ok(s.includes("eq(req.organizationId, organizationId)"));
  assert.ok(s.includes(".limit(limit + 1)"));
  assert.ok(s.includes('"Cache-Control": "private, no-store"'));
  assert.ok(!s.includes("export async function POST"));
  assert.ok(!s.includes("db.update("));
  assert.ok(!s.includes("db.insert("));
});
