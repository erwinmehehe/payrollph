import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  visibleMonthCloseRead,
  type MonthCloseScope,
  type MonthCloseObserved,
} from "../src/lib/payroll-month-close-read";

const scope = (organizationId: number, month: string, revision = 0): MonthCloseScope =>
  ({ organizationId, month, revision });

test("payroll month close hides another employer, month, revision and revisited snapshot", () => {
  const september = scope(11, "2026-09");
  const cert: MonthCloseObserved<{ certificationValid: boolean }> = {
    scope: september,
    payload: { certificationValid: true },
    error: "",
  };
  assert.deepEqual(visibleMonthCloseRead(september, cert), {
    state: { certificationValid: true }, loading: false, error: "",
  });

  for (const newerScope of [
    scope(12, "2026-09"),
    scope(11, "2026-08"),
    scope(11, "2026-09", 1),
    scope(11, "2026-09"), // A -> B -> A: same values, new memo identity
  ]) {
    assert.deepEqual(visibleMonthCloseRead(newerScope, cert), {
      state: null, loading: true, error: "",
    }, "a stale month-close certification must not be rendered");
  }
  assert.deepEqual(visibleMonthCloseRead(september, null), {
    state: null, loading: true, error: "",
  });
});

test("month-close read failure is scoped and cannot reveal certification state", () => {
  const current = scope(11, "2026-09");
  const denied: MonthCloseObserved<{ certificationValid: boolean }> = {
    scope: current, payload: null, error: "Not authorized",
  };
  assert.deepEqual(visibleMonthCloseRead(current, denied), {
    state: null, loading: false, error: "Not authorized",
  });
  assert.deepEqual(visibleMonthCloseRead(scope(11, "2026-08"), denied), {
    state: null, loading: true, error: "",
  });
});

test("month-close component aborts old reads and never resets loading in an effect", () => {
  const src = readFileSync("src/components/workspace/payroll-month-close-panel.tsx", "utf8");
  assert.match(src, /const requestScope = useMemo<MonthCloseScope>/);
  assert.match(src, /visibleMonthCloseRead\(requestScope, observed\)/);
  assert.match(src, /\[organizationId, month, refreshRevision\]/);
  assert.match(src, /new AbortController\(\)/);
  assert.match(src, /signal: controller\.signal/);
  assert.match(src, /if \(!active\) return/);
  assert.match(src, /active = false; controller\.abort\(\)/);
  assert.match(src, /setObserved\(\{ scope: requestScope, payload: body as State, error: "" \}\)/);
  assert.doesNotMatch(src, /setLoading\(true\)/);
  assert.doesNotMatch(src, /setState\(null\)/);
  assert.match(src, /const refresh = \(\) => setRefreshRevision/);
  assert.match(src, /method: "POST"/);
  assert.match(src, /independently certified/);
});
