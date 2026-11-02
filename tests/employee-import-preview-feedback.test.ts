import assert from "node:assert/strict";
import test from "node:test";
import { employeeImportFailureMessage, employeeImportNetworkFailure } from "../src/lib/employee-import-preview-feedback";

test("blocked HR imports explain the action without leaking server internals", () => {
  assert.match(employeeImportFailureMessage(401, "preview"), /Sign in again/);
  assert.match(employeeImportFailureMessage(403, "preview"), /cannot import/);
  assert.match(employeeImportFailureMessage(402, "preview"), /seat limit/);
  assert.match(employeeImportFailureMessage(422, "preview"), /CSV did not pass validation/);
  assert.match(employeeImportFailureMessage(409, "preview"), /Refresh the preview/);
  assert.match(employeeImportFailureMessage(429, "preview"), /Too many requests/);
  assert.doesNotMatch(employeeImportFailureMessage(500, "preview"), /SQL|database|stack/i);
});

test("ambiguous commit failures require directory check before another write", () => {
  for (const message of [
    employeeImportFailureMessage(409, "commit"),
    employeeImportFailureMessage(500, "commit"),
    employeeImportNetworkFailure("commit"),
  ]) {
    assert.match(message, /Check the employee directory/i);
    assert.doesNotMatch(message, /safe to retry|nothing was imported/i);
  }
});
