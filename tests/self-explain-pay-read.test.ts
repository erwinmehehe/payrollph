import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseSelfExplainPayRead, readVerifiedSelfExplainPay } from "../src/lib/self-explain-pay-read";

const scope = { organizationId: 41, employeeId: 7, entryId: 112, periodLabel: "October 2026" };
const run = { id: 18, periodLabel: "October 2026", payDate: "2026-10-20", ruleVersion: "2026" };
const base = {
  organizationId: 41, employeeId: 7, entryId: 112, run, previousRun: null,
  explanation: {
    currentGross: 2000, currentDeductions: 200, currentNet: 1800,
    previousGross: null, previousDeductions: null, previousNet: null,
    netDelta: null, netPercent: null, ruleVersion: null, context: {},
    lines: [],
  },
};

test("self explanation requires employer, employee, exact entry and the requested pay period", () => {
  assert.deepEqual(parseSelfExplainPayRead(base, scope), base, "verified empty component list is valid");
  const line = { code: "BASE", label: "Basic", direction: "earning", previous: null,
    current: 2000, delta: null, netEffectDelta: null, reason: "Stored payroll", notes: [] };
  assert.ok(parseSelfExplainPayRead({ ...base, explanation: { ...base.explanation, lines: [line] } }, scope));
  const variants: unknown[] = [
    null, {}, { ...base, organizationId: 42 }, { ...base, employeeId: 9 },
    { ...base, entryId: 113 }, { ...base, organizationId: undefined },
    { ...base, run: { ...run, periodLabel: "September 2026" } },
    { ...base, run: { ...run, id: undefined } },
    { ...base, previousRun: {} },
    { ...base, explanation: { ...base.explanation, lines: undefined } },
    { ...base, explanation: { ...base.explanation, currentNet: undefined } },
    { ...base, explanation: { ...base.explanation, currentNet: Number.NaN } },
    { ...base, explanation: { ...base.explanation, netDelta: 0 } },
    { ...base, explanation: { ...base.explanation, lines: [{ ...line, current: "2000" }] } },
  ];
  for (const value of variants) assert.equal(parseSelfExplainPayRead(value, scope), null, JSON.stringify(value));
});

test("self explanation rejects non-OK, unreadable JSON and foreign payload; retry fetches fresh verified data", async () => {
  let status = 500, malformed = false, value: unknown = base, attempts = 0;
  const fetcher = (async () => {
    attempts++;
    return { ok: status === 200, json: async () => {
      if (malformed) throw new SyntaxError("invalid example");
      return value;
    } } as Response;
  }) as typeof fetch;
  await assert.rejects(() => readVerifiedSelfExplainPay(scope, fetcher), /unavailable/);
  status = 200;
  malformed = true;
  await assert.rejects(() => readVerifiedSelfExplainPay(scope, fetcher), /unreadable/);
  malformed = false;
  value = { ...base, organizationId: 99 };
  await assert.rejects(() => readVerifiedSelfExplainPay(scope, fetcher), /different payslip/);
  value = { ...base, explanation: { ...base.explanation, lines: undefined } };
  await assert.rejects(() => readVerifiedSelfExplainPay(scope, fetcher), /incomplete/);
  value = base;
  assert.deepEqual(await readVerifiedSelfExplainPay(scope, fetcher), base);
  assert.equal(attempts, 5);
});

test("employee explanation UI shows no amounts on unavailable and has scoped retry", () => {
  const ui = readFileSync("src/components/employee-explain-pay.tsx", "utf8");
  const api = readFileSync("src/app/api/self/payslips/[id]/explain/route.ts", "utf8");
  assert.match(ui, /readVerifiedSelfExplainPay\(/);
  assert.match(ui, /organizationId, employeeId, entryId, period, revision/);
  assert.match(ui, /Retry explanation/);
  assert.doesNotMatch(ui, /setPayload\(body as ExplainPayload\)/);
  assert.match(api, /organizationId: employee\.organizationId/);
  assert.match(api, /employeeId: session\.employeeId/);
  assert.match(api, /entryId,/);
});
