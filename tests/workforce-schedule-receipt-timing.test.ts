import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as receiptHelpers from "../src/lib/workforce-schedule-receipt";
import type { ReceiptSourceDay, ScheduleReceiptView } from "../src/lib/workforce-schedule-receipt";

// Execute the actual service with a deterministic clock and an isolated DB
// double. These are service control-flow tests, NOT PostgreSQL integration.
// The real parser, snapshot projection and content hashing remain in use.
const who = { organizationId: 1, employeeId: 2, userId: 3 };
const beforeMidnight = "2031-01-01T15:59:59.000Z";
const afterMidnight = "2031-01-01T16:00:01.000Z";
const day = (date: string): ReceiptSourceDay => ({
  date, source: "pattern", isRestDay: false, assignmentId: 4, patternId: 5,
  overrideId: null, worksiteId: null, workLocationOrgUnitId: null,
  segments: [{ shiftDefinitionId: 6, shiftCode: "DAY", shiftName: "Fictional shift",
    segmentOrder: 1, startTime: "09:00", endTime: "17:00", breakMinutes: 60, spansMidnight: false }],
});
function request(date = "2031-01-01") {
  return { workDate: date, acknowledged: true,
    snapshotHash: receiptHelpers.scheduleReceiptHash(who.organizationId, who.employeeId,
      receiptHelpers.snapshotForReceipt(day(date), null)!) };
}
type Row = Record<string, unknown>;
type SqlToken = { text: string; parameters: unknown[] };
type Confirmation = { created: boolean; workDate: string; snapshotHash: string; acknowledgedAt: string };
type DayClock = string | (() => string);
type Service = {
  readScheduleReceiptView: (identity: typeof who, clock?: DayClock) => Promise<ScheduleReceiptView>;
  acknowledgeScheduleReceipt: (identity: typeof who, body: unknown, clock?: DayClock) => Promise<Confirmation>;
};
function fixture(options: { now?: string; afterLock?: string; afterSource?: string;
  afterReceiptRead?: string; afterInsert?: string; existing?: Date } = {}) {
  let now = new Date(options.now ?? beforeMidnight);
  let transactions = 0;
  const committed: Row[] = [];
  const audits: Row[] = [];
  const table = (name: string) => new Proxy({}, { get: (_target, key) => name + "." + String(key) });
  const schema = { auditEvents: table("audit"), employees: table("employees"),
    userOrganizations: table("memberships"), users: table("users"), worksites: table("sites") };
  const receipts = table("receipts");
  const move = (instant?: string) => { if (instant) now = new Date(instant); };
  const currentDay = () => new Date(now.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 10);
  const expression = (...parameters: unknown[]) => ({ parameters });
  const sql = (strings: TemplateStringsArray, ...parameters: unknown[]): SqlToken => ({ text: strings.join("?"), parameters });
  class Query implements PromiseLike<Row[]> {
    private source: unknown;
    from(source: unknown) { this.source = source; return this; }
    innerJoin(..._args: unknown[]) { return this; }
    where(..._args: unknown[]) { return this; }
    orderBy(..._args: unknown[]) { return this; }
    limit(..._args: unknown[]) { return this; }
    for(..._args: unknown[]) { return this; }
    private rows() {
      if (this.source === schema.employees) return [{ id: who.employeeId }];
      if (this.source === receipts) {
        move(options.afterReceiptRead);
        return options.existing ? [{ snapshotHash: request().snapshotHash, acknowledgedAt: options.existing }] : [];
      }
      return [];
    }
    then<T = Row[], U = never>(resolve?: ((value: Row[]) => T | PromiseLike<T>) | null,
      reject?: ((reason: unknown) => U | PromiseLike<U>) | null): PromiseLike<T | U> {
      return Promise.resolve(this.rows()).then(resolve, reject);
    }
  }
  const db = { transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
    transactions++;
    const startedAt = new Date(now);
    const pending: Row[] = [], pendingAudits: Row[] = [];
    const tx = {
      execute: async (statement: SqlToken) => {
        if (statement.text.includes("pg_advisory_xact_lock")) move(options.afterLock);
      },
      select: () => new Query(),
      insert: (target: unknown) => ({ values: (values: Row) => {
        if (target === receipts) {
          // Model PostgreSQL's transaction-time DEFAULT now() separately from
          // an explicit wall-clock timestamp evaluated at the receipt INSERT.
          const value = values.acknowledgedAt as SqlToken | Date | undefined;
          const recordedAt = value instanceof Date ? value
            : value?.text.includes("clock_timestamp()") ? new Date(now) : startedAt;
          const row = { ...values, id: 1, acknowledgedAt: recordedAt };
          pending.push(row); move(options.afterInsert);
          return { returning: async () => [row] };
        }
        pendingAudits.push(values);
        return Promise.resolve();
      } }),
    };
    const result = await callback(tx);
    committed.push(...pending); audits.push(...pendingAudits);
    return result;
  } };
  const source = readFileSync("src/lib/workforce-schedule-receipt-server.ts", "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }, reportDiagnostics: true });
  assert.equal(compiled.diagnostics?.length ?? 0, 0);
  const exports: Record<string, unknown> = {};
  const dependencies: Record<string, unknown> = {
    "drizzle-orm": { and: expression, desc: expression, eq: expression, inArray: expression, sql },
    "@/db": { db }, "@/db/schema": schema,
    // Manager-only imports exist in the same production service module. The
    // synthetic timing harness invokes employee methods only, so supply
    // explicit inert dependencies rather than loading a real auth/database path.
    "@/lib/access": { PEOPLE_ADMIN_ROLES: ["owner", "admin", "bookkeeper", "hr"] },
    "./workforce-schedule-receipt-review": {
      managerReceiptDays: () => { throw new Error("Manager method used in employee timing fixture."); },
      summarizeManagerReceiptDays: () => { throw new Error("Manager method used in employee timing fixture."); },
    },
    "./workforce-schedule-receipt-schema": { workforceScheduleReceipts: receipts },
    "./workforce-schedule-receipt": receiptHelpers,
    "./workforce-employee-upcoming-week": { manilaWorkDate: currentDay },
    "./workforce-schedule-window": { resolveEmployeeScheduleWindow: async (input: { startDate: string; endDate: string }) => {
      move(options.afterSource);
      const days: ReceiptSourceDay[] = [];
      for (const cursor = new Date(input.startDate + "T00:00:00Z"); cursor.toISOString().slice(0, 10) <= input.endDate;
        cursor.setUTCDate(cursor.getUTCDate() + 1)) days.push(day(cursor.toISOString().slice(0, 10)));
      return days;
    } },
  };
  new Script(compiled.outputText, { filename: "receipt-service-under-test.cjs" }).runInNewContext({
    exports, require: (name: string) => {
      if (!Object.hasOwn(dependencies, name)) throw new Error("Unexpected service dependency: " + name);
      return dependencies[name];
    },
  });
  return { service: exports as unknown as Service, committed, audits, currentDay,
    transactionCount: () => transactions };
}
function windowChanged(error: unknown) {
  return !!error && typeof error === "object" && "code" in error
    && error.code === "SCHEDULE_RECEIPT_WINDOW_CHANGED";
}
test("receipt POST revalidates the Philippine date after waiting for the roster lock", async () => {
  const f = fixture({ afterLock: afterMidnight });
  await assert.rejects(() => f.service.acknowledgeScheduleReceipt(who, request()), windowChanged);
  assert.equal(f.committed.length, 0); assert.equal(f.audits.length, 0);
});
test("receipt GET starts its seven-day view after lock acquisition, not before midnight", async () => {
  const f = fixture({ afterLock: afterMidnight });
  const view = await f.service.readScheduleReceiptView(who);
  assert.equal(view.days[0].date, "2031-01-02");
  assert.equal(view.days[6].date, "2031-01-08");
});
test("midnight during source reads cannot authorize yesterday's new receipt", async () => {
  const f = fixture({ afterSource: afterMidnight });
  await assert.rejects(() => f.service.acknowledgeScheduleReceipt(who, request()), windowChanged);
  assert.equal(f.committed.length, 0); assert.equal(f.audits.length, 0);
});
test("a GET that crosses midnight during source reads requests a refresh instead of returning an old week", async () => {
  const f = fixture({ afterSource: afterMidnight });
  await assert.rejects(() => f.service.readScheduleReceiptView(who), windowChanged);
});
test("a duplicate response cannot bypass the current receipt date window", async () => {
  const f = fixture({ afterReceiptRead: afterMidnight, existing: new Date("2031-01-01T01:00:00.000Z") });
  await assert.rejects(() => f.service.acknowledgeScheduleReceipt(who, request()), windowChanged);
  assert.equal(f.committed.length, 0); assert.equal(f.audits.length, 0);
});
test("a day rollover at insertion rolls back the tentative receipt and audit", async () => {
  const f = fixture({ afterInsert: afterMidnight });
  await assert.rejects(() => f.service.acknowledgeScheduleReceipt(who, request()), windowChanged);
  assert.equal(f.committed.length, 0); assert.equal(f.audits.length, 0);
});
test("a target still in the current window remains valid after midnight", async () => {
  const f = fixture({ afterLock: afterMidnight });
  const result = await f.service.acknowledgeScheduleReceipt(who, request("2031-01-02"));
  assert.equal(result.created, true); assert.equal(result.workDate, "2031-01-02");
  assert.equal(f.committed.length, 1); assert.equal(f.audits.length, 1);
});
test("new receipt timestamp represents recording time after the lock wait", async () => {
  const f = fixture({ now: "2031-01-01T01:00:00.000Z", afterLock: "2031-01-01T01:30:00.000Z" });
  const result = await f.service.acknowledgeScheduleReceipt(who, request());
  assert.equal(result.acknowledgedAt, "2031-01-01T01:30:00.000Z");
});
test("unchanged duplicate preserves its original timestamp and performs no writes", async () => {
  const original = new Date("2031-01-01T01:00:00.000Z");
  const f = fixture({ now: "2031-01-01T01:59:59.000Z", afterLock: "2031-01-01T02:00:00.000Z", existing: original });
  const result = await f.service.acknowledgeScheduleReceipt(who, request());
  assert.equal(result.created, false); assert.equal(result.acknowledgedAt, original.toISOString());
  assert.equal(f.committed.length, 0); assert.equal(f.audits.length, 0);
});
test("explicit fixed test dates stay supported and invalid requests never start a transaction", async () => {
  const f = fixture();
  const view = await f.service.readScheduleReceiptView(who, "2040-02-29");
  assert.equal(view.days[0].date, "2040-02-29");
  const initial = f.transactionCount();
  await assert.rejects(() => f.service.acknowledgeScheduleReceipt(who, { ...request(), acknowledged: false }));
  assert.equal(f.transactionCount(), initial);
});
