import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";
import {
  managerReceiptDays, summarizeManagerReceiptDays,
} from "../src/lib/workforce-schedule-receipt-review";
import { receiptDates } from "../src/lib/workforce-schedule-receipt";

const dates = receiptDates("2026-10-10");
const hash = (letter: string) => letter.repeat(64);
const projected = dates.map((date, index) => ({
  date, snapshotHash: index === 2 ? null : hash("abcdef0"[index]),
}));

test("manager sees only current-content receipts; historical content is changed, never acknowledged", () => {
  const result = managerReceiptDays(projected, [
    { workDate: dates[0], snapshotHash: hash("a"), acknowledgedAt: new Date("2026-10-10T02:30:00Z") },
    { workDate: dates[1], snapshotHash: hash("z"), acknowledgedAt: new Date("2026-10-10T02:30:00Z") },
  ], new Set([dates[0], dates[1], dates[4]]));
  assert.deepEqual(result.map(day => day.state),
    ["acknowledged", "changed", "unavailable", "pending", "changed", "pending", "pending"]);
  assert.equal(result[0].acknowledgedAt, "2026-10-10T02:30:00.000Z");
  assert.equal(result[1].acknowledgedAt, null);
  assert.deepEqual(summarizeManagerReceiptDays(result), {
    acknowledged: 1, changed: 2, unavailable: 1, pending: 3,
  });
  assert.ok(!JSON.stringify(result).includes(hash("a")), "never expose content hashes in manager view");
});

test("a receipt on another date cannot confirm the selected day's shift", () => {
  const sameHash = projected.filter(day => day.snapshotHash !== null);
  const result = managerReceiptDays(projected, [{
    workDate: dates[1], snapshotHash: sameHash[0].snapshotHash!,
    acknowledgedAt: new Date("2026-10-10T02:30:00Z"),
  }], new Set([dates[1]]));
  assert.equal(result[0].state, "pending");
  assert.equal(result[1].state, "changed");
});

test("manager classification fails closed on duplicate, missing, out-of-order and malformed source evidence", () => {
  assert.throws(() => managerReceiptDays(projected.slice(1), [], new Set()), /seven-day/);
  assert.throws(() => managerReceiptDays([...projected.slice(0, 6), projected[5]], [], new Set()), /seven-day/);
  assert.throws(() => managerReceiptDays([projected[1], projected[0], ...projected.slice(2)], [], new Set()), /seven-day/);
  assert.throws(() => managerReceiptDays([{ ...projected[0], date: "2026-02-30" }, ...projected.slice(1)], [], new Set()), /Invalid work date/);
  assert.throws(() => managerReceiptDays([{ ...projected[0], snapshotHash: "not-valid" }, ...projected.slice(1)], [], new Set()), /Malformed/);
  assert.throws(() => managerReceiptDays(projected, [{
    workDate: dates[0], snapshotHash: hash("a"), acknowledgedAt: new Date("invalid"),
  }], new Set()), /timestamp/);
});

type Gate = "ok" | "disabled" | "guest" | "role" | "unit" | "missing";
type Review = { employee: { employeeNo: string; name: string }; account: "ready"; boundary: string;
  days: Array<{ date: string; state: "pending"; acknowledgedAt: null }>;
  summary: { pending: number; acknowledged: number; changed: number; unavailable: number };
};
const serverValue: Review = {
  employee: { employeeNo: "E19", name: "Fictional Employee" },
  account: "ready", boundary: "A receipt means content was seen, not attendance.",
  days: dates.map(date => ({ date, state: "pending", acknowledgedAt: null })),
  summary: { pending: 7, acknowledged: 0, changed: 0, unavailable: 0 },
};

function routeFixture(gate: Gate = "ok") {
  let serviceCalls = 0, scopeCalls = 0;
  let observed: unknown;
  class ScheduleReceiptError extends Error {
    code = "RECEIPT_REVIEW_DENIED"; status = 403;
  }
  const dependencies: Record<string, unknown> = {
    "drizzle-orm": { and: (...args: unknown[]) => args, eq: (...args: unknown[]) => args },
    "@/db": { db: { select: () => ({ from: () => ({ where: () => ({
      limit: async () => gate === "missing" ? [] : [{ orgUnitId: 5 }],
    }) }) }) } },
    "@/db/schema": { employees: { orgUnitId: "org_unit_id", organizationId: "organization_id", id: "employee_id" } },
    "@/lib/access": {
      PEOPLE_ADMIN_ROLES: ["owner", "admin", "bookkeeper", "hr"],
      assertOrganizationRole: async () => {
        scopeCalls++;
        return gate === "role" ? Response.json({ error: "Role denied" }, { status: 403 }) : null;
      },
      getAccess: async () => ({ orgUnitId: gate === "unit" ? 6 : 5, companyWide: false }),
      assertScope: (access: { orgUnitId: number }, employeeOrgUnitId: number) => ({
        ok: access.orgUnitId === employeeOrgUnitId,
      }),
    },
    "@/lib/auth": { getSessionUser: async () => gate === "guest" ? null : { id: 7, role: "hr" } },
    "@/lib/workforce-schedule-receipt": {
      validReceiptId: (id: unknown) => Number.isSafeInteger(id) && Number(id) > 0 && Number(id) < 2147483648,
      receiptPilotAllowed: (organizationId: number, enabled: string, ids: string) =>
        gate !== "disabled" && enabled === "true" && ids === "19" && organizationId === 19,
    },
    "@/lib/workforce-schedule-receipt-server": {
      ScheduleReceiptError,
      readManagerScheduleReceiptView: async (who: unknown) => {
        observed = who;
        serviceCalls++;
        return serverValue;
      },
    },
  };
  const source = readFileSync("src/app/api/workforce/schedule-receipt-review/route.ts", "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }, reportDiagnostics: true });
  assert.equal(compiled.diagnostics?.length ?? 0, 0);
  const exports: Record<string, unknown> = {};
  new Script(compiled.outputText, { filename: "actual-manager-receipt-route.js" }).runInNewContext({
    exports, Response, Request, URL,
    process: { env: { WFM_SCHEDULE_RECEIPTS_ENABLED: "true", WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS: "19" } },
    require: (name: string) => {
      assert.ok(name in dependencies, "Unexpected route import " + name);
      return dependencies[name];
    },
  });
  return {
    get: exports.GET as (request: Request) => Promise<Response>,
    stats: () => ({ serviceCalls, scopeCalls, observed }),
  };
}
const url = (query = "organizationId=19&employeeId=23") =>
  new Request("https://example.invalid/api/workforce/schedule-receipt-review?" + query);

test("manager route gets exactly a selected employee, with no-store protection", async () => {
  const api = routeFixture();
  const response = await api.get(url());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.deepEqual(JSON.parse(await response.text()), serverValue);
  assert.equal(JSON.stringify(api.stats().observed),
    JSON.stringify({ managerUserId: 7, organizationId: 19, employeeId: 23 }));
  assert.equal(api.stats().serviceCalls, 1);
});

test("disabled flag, absent session, role denied, outside-unit employee and missing worker fail before service reads", async () => {
  for (const [gate, expected] of [
    ["disabled", 404], ["guest", 401], ["role", 403], ["unit", 403], ["missing", 403],
  ] as Array<[Gate, number]>) {
    const api = routeFixture(gate);
    const response = await api.get(url());
    assert.equal(response.status, expected, gate);
    assert.equal(api.stats().serviceCalls, 0, gate);
  }
});

test("caller cannot request another date, duplicate scope parameters or invalid employee IDs", async () => {
  const api = routeFixture();
  for (const query of [
    "organizationId=19&employeeId=23&startDate=2026-10-01",
    "organizationId=19&organizationId=19&employeeId=23",
    "organizationId=19&employeeId=0", "organizationId=19&employeeId=-3",
    "organizationId=19&employeeId=2147483648",
    "employeeId=23", "organizationId=19",
  ]) {
    assert.equal((await api.get(url(query))).status, 400, query);
  }
  assert.equal(api.stats().serviceCalls, 0);
});

test("the manager path is read-only, enforces tenant scope twice, and does not transmit receipt snapshots", () => {
  const api = readFileSync("src/app/api/workforce/schedule-receipt-review/route.ts", "utf8");
  const server = readFileSync("src/lib/workforce-schedule-receipt-server.ts", "utf8");
  assert.ok(api.includes("assertOrganizationRole(") && api.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(api.includes("assertScope(access, employee.orgUnitId)"));
  assert.ok(api.includes("receiptPilotAllowed("));
  assert.ok(!api.includes("export async function POST"));
  assert.ok(server.includes("async function projectedDays("));
  assert.ok(server.includes("pg_advisory_xact_lock(6107,"));
  assert.ok(server.includes("readManagerScheduleReceiptView("));
  assert.ok(server.includes("eq(employees.organizationId, input.organizationId)"));
  assert.ok(server.includes("eq(userOrganizations.organizationId, input.organizationId)"));
  assert.ok(server.includes("manager.orgUnitId !== employee.orgUnitId"));
  assert.ok(server.includes("eq(receipts.acknowledgedByUserId, userId)"));
  assert.ok(server.includes("groupBy(receipts.workDate)"));
  const managerFunction = server.slice(server.indexOf("export async function readManagerScheduleReceiptView("));
  assert.ok(!managerFunction.includes("tx.insert("));
  assert.ok(!managerFunction.includes("tx.update("));
  assert.ok(!managerFunction.includes("tx.delete("));
});

test("manager roster surfaces review only behind the employee-receipt UI gate", () => {
  const roster = readFileSync("src/components/workspace/workforce-team-roster-panel.tsx", "utf8");
  const component = readFileSync("src/components/workspace/workforce-schedule-receipt-review.tsx", "utf8");
  assert.ok(roster.includes('process.env.NEXT_PUBLIC_WFM_SCHEDULE_RECEIPTS_ENABLED === "true"'));
  assert.ok(roster.includes("payload?.rows.some(row => row.employee.id === receiptSelection.employee.id)"));
  assert.ok(roster.includes("receiptSelection.scopeKey === scopeKey"));
  assert.ok(component.includes('fetch("/api/workforce/schedule-receipt-review?"'));
  assert.ok(component.includes("pending.current?.abort()"));
  assert.ok(component.includes("snapshot?.scope === scope"));
  assert.ok(!component.includes('/api/payroll'));
  assert.ok(!component.includes('method: "POST"'));
});
