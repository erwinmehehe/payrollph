import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const planning = readFileSync("src/components/workforce-planning-panel.tsx", "utf8");
const allocations = readFileSync("src/components/workforce-plan-allocation-panel.tsx", "utf8");
const bi = readFileSync("src/components/enterprise-bi-export-panel.tsx", "utf8");
const preflight = readFileSync("docs/sql/issue-1031-workforce-bi-read-only-preflight.sql", "utf8");

test("workforce planning preserves an honest unavailable state when its authoritative GET fails", () => {
  assert.match(planning, /const \[loadError, setLoadError\] = useState<string \| null>\(null\)/);
  const firstRead = planning.slice(planning.indexOf("  const load = useCallback("), planning.indexOf("  useEffect(() => { void load(); }, [load]);"));
  const deniedRead = firstRead.slice(firstRead.indexOf("if (!response.ok) {"), firstRead.indexOf("setProfiles("));
  assert.match(deniedRead, /setLoadedOrganizationId\(null\)/);
  assert.match(deniedRead, /setLoadError\(/);
  assert.match(planning, /if \(loadError\) \{[\s\S]*?role="alert"[\s\S]*?Retry[\s\S]*?return \(/);
  const loadRead = planning.slice(planning.indexOf("  const load = useCallback("), planning.indexOf("  useEffect(() => { void load(); }, [load]);"));
  assert.doesNotMatch(loadRead, /setNotice\(/, "initial workforce load must not emit a success-style toast");
  assert.match(planning, /if \(loading \|\| \(!loadError && loadedOrganizationId !== organizationId\)\) \{[\s\S]*?role="status" aria-busy="true"/, "withhold stale organization data while loading or switching tenants");
  assert.match(planning, /revision !== loadRevisionRef\.current/);
});

test("allocation fetch failures revoke old access and never present empty planning evidence as success", () => {
  const firstRead = allocations.slice(allocations.indexOf("  const load = useCallback("), allocations.indexOf("  useEffect(() => { void load(); }, [load]);"));
  const deniedRead = firstRead.slice(firstRead.indexOf("if (!response.ok) {"), firstRead.indexOf("setAllocations(payload.allocations"));
  for (const revocation of ["setLoadedOrganizationId(null);", "setAccess(null);", "setAllocations([]);", "setSubmissions([]);", "setLoadError("]) {
    assert.ok(deniedRead.includes(revocation), revocation);
  }
  assert.match(allocations, /if \(loadError\) \{[\s\S]*?role="alert"[\s\S]*?Retry/);
  assert.match(allocations, /if \(loading \|\| \(!loadError && loadedOrganizationId !== organizationId\)\) \{[\s\S]*?Loading workforce allocations/, "withhold previous allocation evidence during load or tenant switch");
  assert.match(allocations, /revision !== loadRevisionRef\.current/);
  const initialRead = allocations.slice(allocations.indexOf("  const load = useCallback("), allocations.indexOf("  useEffect(() => { void load(); }, [load]);"));
  assert.doesNotMatch(initialRead, /setNotice\(/, "initial allocation load must not emit a success-style toast");
});

test("BI errors revoke stale datasets and scopes, disable export, and provide manual retry", () => {
  for (const statement of ["setDefinitions([]);", "setLegalEntities([]);", "setOrgUnits([]);", "setDynamicGroups([]);"]) {
    assert.ok(bi.includes(statement), statement);
  }
  assert.match(bi, /reloadRevision, setReloadRevision/);
  assert.match(bi, /\[organizationId, reloadRevision\]/);
  assert.match(bi, /loadError && \([\s\S]*?role="alert"[\s\S]*?Retry/);
  assert.match(bi, /disabled=\{!definitionsReady \|\| exporting \|\| !scopedDefinitions\.length\}/);
  assert.match(bi, /loadedOrganizationId === organizationId/, "a prior tenant\'s definitions cannot enable an export");
  assert.match(bi, /scopedLegalEntities\.map/);
  assert.match(bi, /scopedOrgUnits\.filter/);
  assert.match(bi, /scopedDynamicGroups\.map/);
});

test("the migration preflight is catalog-only and never alters live data", () => {
  assert.match(preflight, /pg_catalog\.pg_attribute/);
  assert.match(preflight, /to_regclass/);
  for (const name of ["user_permission_assignments", "permission_sets", "dynamic_worker_groups", "job_profiles", "positions", "position_assignments", "workforce_timesheets"]) {
    assert.ok(preflight.includes(name), name);
  }
  const executable = preflight.replace(/--[^\n]*/g, "");
  assert.doesNotMatch(executable, /\b(?:CREATE|ALTER|DROP|DELETE|UPDATE|INSERT|TRUNCATE)\b/i);
});
