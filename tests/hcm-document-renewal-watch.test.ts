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


test("source-wide search and expiry filters are applied before SQL page limits", () => {
  const route = readFileSync("src/app/api/hcm/document-renewal-watch/route.ts", "utf8");
  const model = readFileSync("src/lib/hcm-document-renewal-watch.ts", "utf8");
  assert.match(route, /params\.get\("q"\)/);
  assert.match(route, /params\.get\("state"\)/);
  assert.match(route, /params\.get\("expiry"\)/);
  assert.match(route, /q\.length > 80/);
  assert.match(route, /escapeLike\(q\)/);
  assert.match(route, /ilike\(employee\.employeeNo, search\)/);
  assert.match(route, /ilike\(employee\.firstName, search\)/);
  assert.match(route, /ilike\(employee\.lastName, search\)/);
  assert.match(route, /ilike\(requirement\.name, search\)/);
  assert.ok(route.includes("const statePredicate = "));
  assert.ok(route.includes("const expiryPredicate = "));
  assert.match(route, /searchPredicate,\s+statePredicate,\s+expiryPredicate/);
  assert.ok(route.indexOf("searchPredicate,") < route.indexOf(".limit(limit + 1)"));
  assert.ok(route.includes('["owner", "admin", "hr"].includes(access.role)'));
  assert.match(route, /private, no-store/);
  assert.ok(model.includes("DOCUMENT_WATCH_STATES"));
  assert.ok(model.includes("DOCUMENT_WATCH_EXPIRIES"));
});

test("document watch stays in the authorized workspace and opens the existing People drawer", () => {
  const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");
  const ui = readFileSync("src/components/hcm-document-renewal-watch.tsx", "utf8");
  assert.match(workspace, /NEXT_PUBLIC_HCM_DOCUMENT_RENEWAL_WATCH_ENABLED === "true"/);
  assert.match(workspace, /data\.access\?\.companyWide === true/);
  assert.match(workspace, /availablePages\.includes\("Documents"\)/);
  assert.match(workspace, /availablePages\.includes\("People"\)/);
  assert.match(workspace, /data\.employees\.some\(\(employee\) => employee\.id === employeeId\)/);
  assert.match(workspace, /setFocusEmployeeId\(employeeId\)/);
  assert.match(workspace, /setPage\("People"\)/);
  assert.match(ui, /new AbortController\(\)/);
  assert.match(ui, /controller\.abort\(\)/);
  assert.match(ui, /data\.organizationId !== organizationId/);
  assert.match(ui, /data\.filters\?\.q !== searchQuery/);
  assert.match(ui, /data\.filters\?\.state !== stateFilter/);
  assert.match(ui, /data\.filters\?\.expiry !== expiryFilter/);
  assert.match(ui, /data\.page\.hasMore/);
  assert.match(ui, /onOpenEmployee\(item\.employeeId\)/);
  assert.ok(!ui.includes('method: "POST"'));
  assert.ok(!ui.includes("bankAccount"));
  assert.ok(!ui.includes("documentUrl"));
});

test("recorded expiry rules distinguish missing submissions and explicit waivers", () => {
  assert.equal(classifyDocumentRenewal({ ...base, status: "missing", expiresAt: "2026-10-08" }, "2026-10-10"), "expired");
  assert.equal(classifyDocumentRenewal({ ...base, status: "expiring", expiresAt: null }, "2026-10-10"), "expiring");
  assert.equal(classifyDocumentRenewal({ ...base, status: "waived", expiresAt: "2026-10-08" }, "2026-10-10"), "waived");
  assert.throws(() => classifyDocumentRenewal(base, "October 10 2026"), /Expected ISO date/);
});
