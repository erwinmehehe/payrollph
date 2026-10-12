import assert from "node:assert/strict";
import test from "node:test";
import { activeApiScopes, normalizeScopes } from "../src/lib/developer-api-scopes";

test("API token scopes allow only core scopes while extension is off", () => {
  assert.deepEqual(
    normalizeScopes(["employees:read", "payslips:read", "events:read", "rawsql:read", "employees:read"], false),
    ["employees:read"],
  );
  assert.deepEqual(
    normalizeScopes(["org-units:read", "payslips:read"], false),
    ["employees:read", "payroll:read"],
  );
});

test("enabled v1 extension accepts only documented scopes and deduplicates", () => {
  assert.deepEqual(
    normalizeScopes(["org-units:read", "events:read", "payslips:read", "events:read", "admin:*"], true),
    ["org-units:read", "events:read", "payslips:read"],
  );
  assert.deepEqual(normalizeScopes("rawsql:read", true), ["employees:read", "payroll:read"]);
  assert.deepEqual(normalizeScopes([], true), ["employees:read", "payroll:read"]);
});

test("published developer API scopes respect the release flag", () => {
  assert.deepEqual(activeApiScopes(false), ["employees:read", "employees:write", "payroll:read"]);
  assert.deepEqual(activeApiScopes(true), [
    "employees:read", "employees:write", "payroll:read",
    "org-units:read", "payslips:read", "events:read",
  ]);
});
