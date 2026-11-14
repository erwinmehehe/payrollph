import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Static regression contracts for the existing tenant-scoped SSR/client boundary.
// They do not replace authenticated Chromium, real HTTP, or PostgreSQL evidence.
const page = readFileSync("src/app/hcm/org-explorer/page.tsx", "utf8");
const client = readFileSync("src/components/hcm-org-explorer.tsx", "utf8");

function assertInOrder(source, needles, label) {
  let previous = -1;
  for (const needle of needles) {
    const next = source.indexOf(needle, previous + 1);
    assert.ok(next > previous, label + ": missing/out-of-order guard: " + needle);
    previous = next;
  }
}

test("SSR verifies explicit employer, active role, and plan before mounting client", () => {
  assertInOrder(page, [
    'if (process.env.HCM_ORG_EXPLORER_ENABLED !== "true") notFound();',
    "const user = await getSessionUser();",
    'if (!user) redirect("/login");',
    "const organizationId = hcmOrgExplorerPositiveId(",
    "if (!organizationId) notFound();",
    "if (!hcmOrgExplorerEnabledForEmployer(organizationId)) notFound();",
    "const denied = await denyHcmOrgExplorer(user.id, organizationId);",
    "if (denied) notFound();",
    "const access = await getAccess(user.id, organizationId);",
    "if (!access) notFound();",
    "const enterpriseDenied = await denyOptInEnterpriseHcmPlan(organizationId);",
    "if (enterpriseDenied) notFound();",
    "<HcmOrgExplorerClient organizationId={organizationId} />",
  ], "Org Explorer SSR");
  assert.ok(page.includes('typeof params.organizationId === "string" ? params.organizationId : null'),
    "Repeated organizationId query keys must not fall back to a first selected employer");
});

test("graph and history reads bind both fetches and payload validators to the employer", () => {
  assert.ok(client.includes('fetch("/api/hcm/org-explorer?organizationId=" + organizationId'),
    "Graph query must use the currently selected employer");
  assert.ok(client.includes("validOrgExplorerResponse(payload, organizationId)"),
    "Graph payload must be checked against the selected employer");
  assert.ok(client.includes("organizationId: String(organizationId), positionId: String(selectedPositionId)"),
    "Position history query must bind the selected position and employer together");
  assert.ok(client.includes("validPositionHistoryResponse(payload, organizationId, selectedPositionId)"),
    "Position history payload must validate both selected resource identifiers");
  assert.equal((client.match(/cache: "no-store"/g) ?? []).length, 2,
    "Both tenant-private HTTP reads must explicitly avoid cached responses");
});

test("late responses and previously selected employer data cannot mount after scope switch", () => {
  assert.ok(client.includes('const graphScope = organizationId + ":" + revision;'));
  assert.ok(client.includes('const unitScope = graphScope + ":" + selectedUnitId;'));
  assert.ok(client.includes('const positionScope = unitScope + ":" + selectedPositionId + ":" + historyRevision;'));
  assert.ok(client.includes('graph?.scope === graphScope && graph.status === "ready"'),
    "Previously loaded employer graph must not remain visible after a scope change");
  assert.ok(client.includes("selectedUnitChoice?.scope === graphScope"),
    "Previously selected organization unit must not be reused across graph scopes");
  assert.ok(client.includes("selectedPositionChoice?.scope === unitScope"),
    "Previously selected position must not be reused across organization units");
  assert.ok(client.includes("history?.scope === positionScope ? history : null"),
    "Previously loaded position history must not appear under a new employer/position");
  assert.ok(client.includes('selectedPosition && activeHistory?.status === "ready"'),
    "History must be hidden until the position is present in the current graph");
  assert.ok(client.includes("if (selectedPositionId === null || !current || !selectedPosition) return;"),
    "History must not fetch a stale or non-visible position");
});

test("both async tenant reads abort in-flight requests and ignore late completions", () => {
  assert.equal((client.match(/new AbortController\(\)/g) ?? []).length, 2);
  assert.equal((client.match(/controller\.abort\(\)/g) ?? []).length, 2);
  assert.equal((client.match(/if \(controller\.signal\.aborted\) return;/g) ?? []).length, 2);
  assert.ok(client.includes('setGraph({ scope: graphScope, status: "unavailable", data: null'),
    "Graph failures must not preserve old employer records");
  assert.ok(client.includes('setHistory({ scope: positionScope, status: "unavailable", data: null'),
    "History failures must not preserve stale private records");
});
