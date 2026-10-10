import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  philippineWorker360Date, projectWorker360Events, validWorker360Date,
} from "../src/lib/hcm-worker-360-projection";

const route = readFileSync("src/app/api/hcm/worker-360/route.ts", "utf8");
const loader = readFileSync("src/lib/hcm-worker-360-server.ts", "utf8");
const page = readFileSync("src/app/hcm/worker-360/page.tsx", "utf8");
const client = readFileSync("src/components/hcm-worker-360.tsx", "utf8");
const people = readFileSync("src/components/workspace/people.tsx", "utf8");

test("Philippine business date is not the UTC date across midnight", () => {
  assert.equal(philippineWorker360Date(new Date("2026-10-09T15:30:00Z")), "2026-10-09");
  assert.equal(philippineWorker360Date(new Date("2026-10-09T16:30:00Z")), "2026-10-10");
  assert.ok(validWorker360Date(philippineWorker360Date(new Date("2026-10-09T16:30:00Z"))));
});

test("Worker 360 API is disabled by default, read-only and session/permission protected", () => {
  assert.match(route, /HCM_WORKER_360_ENABLED !== "true"/);
  assert.match(route, /getSessionUser\(\)/);
  assert.match(route, /assertOrganizationRole/);
  assert.match(route, /PEOPLE_ADMIN_ROLES/);
  assert.match(route, /companyWide/);
  assert.match(route, /"owner", "admin", "hr"/);
  assert.match(route, /private, no-store/);
  assert.match(route, /validWorker360Date\(asOfDate\)/);
  assert.ok(!route.includes("primaryOrganizationId("));
  assert.ok(!route.includes("primaryCompanyOrganizationId("));
  assert.ok(!route.includes("export async function POST"));
  assert.ok(!route.includes("export async function PATCH"));
  assert.ok(!route.includes("export function philippineWorker360Date"), "Next route should expose only supported exports");
});

test("every Worker 360 database read is tenant + worker scoped and bounded in SQL", () => {
  for (const source of ["employees", "positionAssignments", "workerEmploymentEvents"]) {
    assert.match(loader, new RegExp("eq\\(" + source + "\\.organizationId, organizationId\\)"));
    assert.match(loader, new RegExp("eq\\(" + source + "\\.(?:employeeId|id), employeeId\\)"));
  }
  assert.match(loader, /eq\(positionAssignments\.assignmentType, "primary"\)/);
  assert.match(loader, /lte\(positionAssignments\.effectiveFrom, asOfDate\)/);
  assert.match(loader, /gte\(positionAssignments\.effectiveUntil, asOfDate\)/);
  assert.match(loader, /lte\(workerEmploymentEvents\.effectiveDate, asOfDate\)/);
  assert.match(loader, /orderBy\(desc\(positionAssignments\.effectiveFrom\), desc\(positionAssignments\.id\)\)\.limit\(2\)/);
  assert.match(loader, /WORKER_360_EVENT_PAGE_SIZE \+ 1/);
  assert.match(loader, /projectWorker360Events\(events, asOfDate, WORKER_360_EVENT_PAGE_SIZE\)/);
  assert.ok(!loader.includes("SELECT *"));
  assert.ok(!loader.includes("db.select().from"));
  assert.ok(!loader.includes("basicRate:"));
  assert.ok(!loader.includes("bankAccount:"));
  assert.ok(!loader.includes("actorName:"));
  assert.ok(!loader.includes("reason:"));
  assert.ok(!loader.includes("metadata:"));
});

test("untrusted source fields do not enter the event envelope", () => {
  const raw = [{
    id: 4, effectiveDate: "2026-10-10", eventType: "transfer",
    positionAssignmentId: 22, reason: "Sensitive reason", salary: "99999",
    metadata: { personalNotes: "Private" },
  }];
  const output = projectWorker360Events(raw, "2026-10-10", 25);
  assert.equal(output.items.length, 1);
  const json = JSON.stringify(output);
  for (const value of ["Sensitive reason", "99999", "Private", "personalNotes"]) {
    assert.ok(!json.includes(value));
  }
});

test("unknown legacy event codes retain truthful preview counts without raw text", () => {
  const events = Array.from({ length: 26 }, (_, index) => ({
    id: index + 1,
    effectiveDate: "2026-10-10",
    eventType: index === 25 ? "private free text / hr note" : "transfer",
    positionAssignmentId: null,
  }));
  const preview = projectWorker360Events(events, "2026-10-10", 25);
  assert.equal(preview.items.length, 25);
  assert.equal(preview.hasMore, true);
  assert.ok(preview.items.some((event) => event.eventType === "other"));
  assert.ok(!JSON.stringify(preview).includes("private free text"));
});

test("Worker 360 page and People workspace preserve selected tenant and UX request safety", () => {
  assert.match(page, /HCM_WORKER_360_ENABLED !== "true"/);
  assert.match(page, /assertOrganizationRole/);
  assert.match(page, /getAccess/);
  assert.match(page, /companyWide/);
  assert.ok(!page.includes("primaryCompanyOrganizationId"));
  assert.match(people, /NEXT_PUBLIC_HCM_WORKER_360_ENABLED === "true"/);
  assert.match(people, /\/hcm\/worker-360\?organizationId=\$\{data\.selectedOrganization\.id\}&employeeId=\$\{employee\.id\}/);
  assert.match(client, /new AbortController\(\)/);
  assert.match(client, /controller\.abort\(\)/);
  assert.match(client, /data\.tenantId !== organizationId/);
  assert.match(client, /data\.employeeId !== employeeId/);
  assert.match(client, /data\.asOfDate !== asOfDate/);
  assert.ok(!client.includes('method: "POST"'));
  assert.ok(!client.includes('method: "PATCH"'));
});
