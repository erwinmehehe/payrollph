import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { visibleScopedEmployeeDirectory } from "../src/lib/scoped-employee-directory";

const employerOne = [{ id: 1, firstName: "Fictional", lastName: "One" }];
const source = { organizationId: 41, employees: employerOne };

test("directory is masked synchronously whenever selected employer or role changes", () => {
  assert.equal(visibleScopedEmployeeDirectory(source, 41, true), employerOne);
  assert.deepEqual(visibleScopedEmployeeDirectory(source, 42, true), []);
  assert.deepEqual(visibleScopedEmployeeDirectory(source, 41, false), []);
  assert.deepEqual(visibleScopedEmployeeDirectory(source, 0, true), []);
  assert.deepEqual(visibleScopedEmployeeDirectory(null, 41, true), []);
  assert.deepEqual(employerOne, [{ id: 1, firstName: "Fictional", lastName: "One" }]);
});

test("unauthorized and old-employer data cannot reappear while the next fetch is pending", () => {
  const permitted = visibleScopedEmployeeDirectory(source, 41, true);
  const changedEmployer = visibleScopedEmployeeDirectory(source, 42, true);
  const revoked = visibleScopedEmployeeDirectory(source, 41, false);
  assert.equal(permitted.length, 1);
  assert.equal(changedEmployer.length, 0);
  assert.equal(revoked.length, 0);
  const newSource = { organizationId: 42, employees: [{ id: 2, firstName: "Fictional", lastName: "Two" }] };
  assert.equal(visibleScopedEmployeeDirectory(newSource, 42, true)[0].id, 2);
  assert.deepEqual(visibleScopedEmployeeDirectory(newSource, 41, true), []);
});

test("wallet employee fetch cancels obsolete requests and gates every render, not only effects", () => {
  const src = readFileSync("src/components/wallet-panel.tsx", "utf8");
  assert.match(src, /if \(!allowed\) return;/);
  assert.match(src, /new AbortController\(\)/);
  assert.match(src, /cache: "no-store", signal: controller\.signal/);
  assert.match(src, /if \(!controller\.signal\.aborted\)/);
  assert.match(src, /return \(\) => controller\.abort\(\)/);
  assert.match(src, /return visibleScopedEmployeeDirectory\(snapshot, organizationId, allowed\)/);
  assert.doesNotMatch(src, /\.then\(setEmployees\)/);
});
