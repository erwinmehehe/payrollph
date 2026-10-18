import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const planning = readFileSync("src/components/workforce-planning-panel.tsx", "utf8");
const allocations = readFileSync("src/components/workforce-plan-allocation-panel.tsx", "utf8");
const bi = readFileSync("src/components/enterprise-bi-export-panel.tsx", "utf8");
const preflight = readFileSync("docs/sql/issue-1031-workforce-bi-read-only-preflight.sql", "utf8");

test("workforce planning preserves an honest unavailable state when its authoritative GET fails", () => {
  assert.match(planning, /const \[loadError, setLoadError\] = useState<string \| null>\(null\)/);
  const loadStart = planning.indexOf("  const load = useCallback(async () => {");
  const effectStart = planning.indexOf(
    "  useEffect(() => {",
    loadStart,
  );
  assert.ok(loadStart >= 0 && effectStart > loadStart, "tenant-scoped loader must precede its cleanup effect");
  const effectCleanup = planning.slice(effectStart, planning.indexOf("  // Explicit user/mutation reloads", effectStart));
  assert.match(effectCleanup, /queueMicrotask/);
  assert.match(effectCleanup, /controller\.abort\(\)/);
  assert.match(effectCleanup, /invalidateInFlightLoad\(\)/);
  const firstRead = planning.slice(loadStart, effectStart);
  assert.match(firstRead, /const revision = \+\+loadRevisionRef\.current/);
  assert.match(firstRead, /revision !== loadRevisionRef\.current/);
  const deniedStart = firstRead.indexOf("if (!response.ok) {");
  const firstAuthorizedRow = firstRead.indexOf("setProfiles(", deniedStart);
  assert.ok(deniedStart >= 0 && firstAuthorizedRow > deniedStart, "failure must revoke access before showing workforce rows");
  const deniedRead = firstRead.slice(deniedStart, firstAuthorizedRow);
  assert.match(deniedRead, /setLoadedOrganizationId\(null\)/);
  assert.match(deniedRead, /setLoadError\(/);
  assert.match(planning, /if \(loadError\) \{[\s\S]*?role="alert"[\s\S]*?Retry[\s\S]*?return \(/);
  const loadRead = firstRead;
  assert.doesNotMatch(loadRead, /setNotice\(/, "initial workforce load must not emit a success-style toast");
  assert.match(planning, /if \(loading \|\| \(!loadError && loadedOrganizationId !== organizationId\)\) \{[\s\S]*?role="status" aria-busy="true"/, "withhold stale organization data while loading or switching tenants");
  assert.match(planning, /revision !== loadRevisionRef\.current/);
});

test("allocation fetch failures revoke old access and never present empty planning evidence as success", () => {
  const start = allocations.indexOf("  const load = useCallback(");
  const end = allocations.indexOf("  useEffect(() => {", start);
  assert.ok(start >= 0 && end > start, "allocation loader must precede its mount effect");
  const firstRead = allocations.slice(start, end);

  const deniedStart = firstRead.indexOf("if (!response.ok) {");
  const successfulStart = firstRead.indexOf("const nextAllocations: Allocation[]", deniedStart);
  assert.ok(deniedStart >= 0 && successfulStart > deniedStart, "failure must revoke access before publishing valid allocations");
  const deniedRead = firstRead.slice(deniedStart, successfulStart);
  for (const revocation of ["setLoadedOrganizationId(null);", "setAccess(null);", "setAllocations([]);", "setSubmissions([]);", "setLoadError("]) {
    assert.ok(deniedRead.includes(revocation), "missing failure revocation: " + revocation);
  }

  assert.match(allocations, /if \(loadError\) \{[\s\S]*?role="alert"[\s\S]*?Retry/);
  assert.match(allocations, /if \(loading \|\| \(!loadError && loadedOrganizationId !== organizationId\)\) \{[\s\S]*?Loading workforce allocations/, "withhold previous allocation evidence during load or tenant switch");

  // The new callback uses both request revision ownership AND AbortSignal
  // cancellation, replacing the old bare revision inequality. Neither a
  // superseded request nor an unmounted child may republish tenant evidence.
  assert.match(firstRead, /const revision = \+\+loadRevisionRef\.current/);
  assert.match(firstRead, /const isCurrent = \(\) => !signal\?\.aborted && revision === loadRevisionRef\.current/);
  assert.match(firstRead, /if \(!isCurrent\(\)\) return;/);
  assert.match(firstRead, /\{ cache: "no-store", signal \}/);

  const mountEffect = allocations.slice(end, allocations.indexOf("  const selectedPlan =", end));
  assert.match(mountEffect, /const controller = new AbortController\(\)/);
  assert.match(mountEffect, /queueMicrotask\(\(\) => \{/);
  assert.match(mountEffect, /if \(!controller\.signal\.aborted\) void load\(controller\.signal\)/);
  assert.match(mountEffect, /controller\.abort\(\)/);
  assert.match(mountEffect, /loadRevisionRef\.current \+= 1/);
  assert.doesNotMatch(mountEffect, /set(?:Loading|LoadError|LoadedOrganizationId|Access|Allocations|Submissions)\(/, "mount effect cannot publish or reset tenant evidence synchronously");

  assert.doesNotMatch(firstRead, /setNotice\(/, "initial allocation load must not emit a success-style toast");
});

test("BI errors revoke stale datasets and scopes, disable export, and provide manual retry", () => {
  for (const statement of ["setDefinitions([]);", "setLegalEntities([]);", "setOrgUnits([]);", "setDynamicGroups([]);"]) {
    assert.ok(bi.includes(statement), statement);
  }
  assert.match(bi, /reloadRevision, setReloadRevision/);
  assert.match(bi, /\[organizationId, reloadRevision\]/);
  assert.match(bi, /loadError && \([\s\S]*?role="alert"[\s\S]*?Retry/);
  assert.match(bi, /disabled=\{!definitionsReady \|\| exporting \|\| !scopedDefinitions\.length\}/);
  assert.match(bi, /resolvedRead\?\.organizationId === organizationId/, "a prior tenant's definitions cannot enable an export");
  assert.match(bi, /resolvedRead\?\.revision === reloadRevision/, "a prior retry cannot authorize export before the new fetch settles");
  assert.match(bi, /const loading = !readSettled/, "derive pending status before effects run");
  assert.match(bi, /signal: controller\.signal/, "cancel stale or unmounted BI requests");
  assert.match(bi, /return \(\) => controller\.abort\(\)/, "cleanup aborts stale requests");
  const effectIntro = bi.slice(bi.indexOf("  useEffect(() => {"), bi.indexOf(".then(async (response) => {"));
  assert.doesNotMatch(effectIntro, /set(?:Loading|LoadError|Definitions|ResolvedRead)\(/, "no synchronous effect state writes");
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
