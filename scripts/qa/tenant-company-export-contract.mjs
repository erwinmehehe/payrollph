import assert from "node:assert/strict";
import { requireDisposablePiiApprovalEnv } from "./tenant-pii01-approval-contract.mjs";

export function requireExportProof(env = process.env) {
  requireDisposablePiiApprovalEnv(env);
  assert.equal(env.TENANT_COMPANY_EXPORT_MODE, "fictional-ci-only");
  assert.ok(["true", "false"].includes(env.MULTI_ENTITY_ENABLED));
  for (const key of ["MALWARE_SCAN_URL", "MALWARE_SCAN_TOKEN", "DOCUMENT_OBJECT_STORAGE_ENDPOINT", "OPENAI_API_KEY"])
    assert.ok(!env[key], "EXPORT_PROOF_REFUSED: " + key);
}

export function proveEmployeeExport(response, own, excluded) {
  assert.equal(response.status, 200);
  assert.match(response.type, /^text\/csv/);
  assert.match(response.cache, /private/);
  assert.match(response.cache, /no-store/);
  assert.equal(response.nosniff, "nosniff");
  // Employee numbers are CSV field 1, not substring searches: the legitimate
  // second-entity fixture intentionally starts with the primary employee number
  // (and uses that marker in its display name). A substring probe falsely
  // declares an otherwise correctly isolated secondary-entity export a leak.
  const [header, ...rows] = response.text.replaceAll("\r\n", "\n").trimEnd().split("\n");
  // A one-column or truncated header can make a malformed export appear valid.
  // Check all six production CSV columns before interpreting any employee rows.
  assert.equal(header, "Employee no.,Name,Title,Status,Type,Basic rate",
    "employee CSV header missing or altered");
  const employeeNumbers = rows.filter(Boolean).map(row => {
    const firstCell = /^(?:"((?:[^"]|"")*)"|([^,]*))(?:,|$)/.exec(row);
    assert.ok(firstCell, "malformed employee CSV row");
    return firstCell[1] === undefined ? firstCell[2] : firstCell[1].replaceAll('""', '"');
  });
  assert.ok(employeeNumbers.includes(own), "missing genuine own employee");
  assert.ok(!employeeNumbers.includes(excluded), "accepts another employer's data");
}
