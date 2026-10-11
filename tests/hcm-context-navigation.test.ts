import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildHcmNavigation, hcmDirectoryHref,
} from "../src/lib/hcm-context-navigation";
import { roleHasPeopleWorkspace } from "../src/lib/workspace-role-ui";

const pilotEnv = {
  HCM_PEOPLE_HOME_ENABLED: "true",
  NEXT_PUBLIC_HCM_PEOPLE_HOME_ENABLED: "true",
  HCM_PEOPLE_HOME_ORG_IDS: "17,18",
  HCM_PROCESS_MONITOR_ENABLED: "true",
  HCM_PROCESS_MONITOR_ORG_IDS: "17,18",
  NEXT_PUBLIC_HCM_PROCESS_MONITOR_ENABLED: "true",
  NEXT_PUBLIC_HCM_PROCESS_MONITOR_ORG_IDS: "17,18",
  HCM_WORKER_360_ENABLED: "true",
  NEXT_PUBLIC_HCM_WORKER_360_ENABLED: "true",
} as const;
const hr = { role: "hr", companyWide: true };
const bookkeeper = { role: "bookkeeper", companyWide: true };
function links(org = 17, current: "peopleHome" | "processMonitor" | "worker360" | "actionCenter" | "orgExplorer" = "peopleHome",
  access = hr, env: Record<string, string> = pilotEnv, employeeId: number | null = null) {
  return buildHcmNavigation({
    organizationId: org, access, current, employeeId,
  }, env);
}

test("HCM navigation is entirely off by default and cannot infer an employer or employee", () => {
  assert.equal(hcmDirectoryHref(0), null);
  assert.equal(hcmDirectoryHref(Number.NaN), null);
  assert.equal(hcmDirectoryHref(17), "/app?organizationId=17&workspacePage=People");
  assert.deepEqual(links(0), []);
  assert.deepEqual(links(Number.MAX_SAFE_INTEGER + 1), []);
  assert.deepEqual(links(17, "peopleHome", { role: "hr", companyWide: false }), []);
  assert.deepEqual(links(17, "peopleHome", { role: "manager", companyWide: true }), []);
  const withoutFlags = links(17, "peopleHome", hr, {});
  assert.deepEqual(withoutFlags.map((link) => link.id), ["inbox", "directory"]);
  assert.ok(withoutFlags.every((link) => !link.href.includes("employeeId=")));
});

test("only exact company/role/flags allow cross-module HCM links", () => {
  assert.deepEqual(links().map((link) => link.id),
    ["peopleHome", "processMonitor", "actionCenter", "inbox", "directory"]);
  assert.deepEqual(links(18).map((link) => link.id),
    ["peopleHome", "processMonitor", "actionCenter", "inbox", "directory"]);
  assert.deepEqual(links(19).map((link) => link.id), ["inbox", "directory"]);
  assert.deepEqual(links(17, "peopleHome", bookkeeper).map((link) => link.id),
    ["peopleHome"],
    "Bookkeeper People Home does not imply People directory, HCM Inbox or Process Monitor access.");
  for (const role of ["employee", "manager", "payroll", "checker"]) {
    assert.deepEqual(links(17, "peopleHome", { role, companyWide: true }), []);
  }
  assert.deepEqual(links(17, "peopleHome", hr, {
    ...pilotEnv, HCM_PROCESS_MONITOR_ORG_IDS: "018,19",
  }).map((link) => link.id), ["peopleHome", "actionCenter", "inbox", "directory"]);
  assert.deepEqual(links(17, "peopleHome", hr, {
    ...pilotEnv, NEXT_PUBLIC_HCM_PROCESS_MONITOR_ORG_IDS: "018,19",
  }).map((link) => link.id), ["peopleHome", "actionCenter", "inbox", "directory"]);
  assert.deepEqual(links(17, "peopleHome", hr, {
    ...pilotEnv, NEXT_PUBLIC_HCM_PROCESS_MONITOR_ENABLED: "false",
  }).map((link) => link.id), ["peopleHome", "actionCenter", "inbox", "directory"]);
  assert.deepEqual(links(17, "peopleHome", hr, {
    ...pilotEnv, HCM_PEOPLE_HOME_ENABLED: "false",
  }).map((link) => link.id), ["processMonitor", "inbox", "directory"]);
});

test("Organization Explorer navigation is tenant-allowlisted, role-scoped and default-off", () => {
  const explorer = {
    ...pilotEnv,
    HCM_ORG_EXPLORER_ENABLED: "true",
    HCM_ORG_EXPLORER_ORG_IDS: "17,18",
    NEXT_PUBLIC_HCM_ORG_EXPLORER_ENABLED: "true",
    NEXT_PUBLIC_HCM_ORG_EXPLORER_ORG_IDS: "17,18",
  };
  const selected = links(17, "orgExplorer", hr, explorer);
  const org = selected.find((link) => link.id === "orgExplorer");
  assert.equal(org?.href, "/hcm/org-explorer?organizationId=17");
  assert.equal(org?.current, true);
  assert.equal(links(18, "peopleHome", hr, explorer).find(
    (link) => link.id === "orgExplorer",
  )?.href, "/hcm/org-explorer?organizationId=18");
  assert.ok(!links(19, "orgExplorer", hr, explorer).some((link) => link.id === "orgExplorer"));
  assert.ok(!links(17, "orgExplorer", bookkeeper, explorer)
    .some((link) => link.id === "orgExplorer"));
  for (const changed of [
    { ...explorer, HCM_ORG_EXPLORER_ENABLED: "false" },
    { ...explorer, HCM_ORG_EXPLORER_ORG_IDS: "18" },
    { ...explorer, NEXT_PUBLIC_HCM_ORG_EXPLORER_ENABLED: "false" },
    { ...explorer, NEXT_PUBLIC_HCM_ORG_EXPLORER_ORG_IDS: "18" },
    { ...explorer, HCM_ORG_EXPLORER_ORG_IDS: "017" },
  ]) {
    assert.ok(!links(17, "orgExplorer", hr, changed)
      .some((link) => link.id === "orgExplorer"));
  }
});

test("People directory links follow the workspace role page entitlement", () => {
  for (const role of ["owner", "admin", "hr", "payroll"]) {
    assert.equal(roleHasPeopleWorkspace(role), true, role);
  }
  for (const role of ["bookkeeper", "manager", "checker", "employee", "invalid"]) {
    assert.equal(roleHasPeopleWorkspace(role), false, role);
  }
  assert.equal(roleHasPeopleWorkspace(null), false);
  assert.deepEqual(links(17, "peopleHome", bookkeeper, {}).map((link) => link.id), []);
  assert.deepEqual(links(17, "peopleHome", { role: "owner", companyWide: true }).map((link) => link.id),
    ["peopleHome", "processMonitor", "actionCenter", "inbox", "directory"]);
});

test("HCM links preserve selected employer and worker context, never a guessed worker", () => {
  const menu = links(18, "worker360", hr, pilotEnv, 209);
  const worker = menu.find((link) => link.id === "worker360");
  assert.equal(worker?.href, "/hcm/worker-360?organizationId=18&employeeId=209");
  assert.equal(worker?.current, true);
  assert.ok(menu.find((link) => link.id === "peopleHome")?.href.endsWith("organizationId=18"));
  assert.ok(menu.find((link) => link.id === "processMonitor")?.href.endsWith("organizationId=18"));
  assert.equal(menu.find((link) => link.id === "actionCenter")?.href,
    "/hcm/action-center?organizationId=18");
  assert.ok(menu.every((link) => !link.href.includes("organizationId=17")));
  assert.ok(menu.every((link) => !link.href.includes("employeeId=") || link.id === "worker360"));
  assert.ok(links(18, "worker360", hr, pilotEnv, null).every((link) => link.id !== "worker360"));
  assert.ok(links(18, "worker360", hr, pilotEnv, -3).every((link) => link.id !== "worker360"));
  assert.ok(links(18, "worker360", hr, {
    ...pilotEnv, HCM_WORKER_360_ENABLED: "false",
  }, 209).every((link) => link.id !== "worker360"));
});

test("HCM current-page links cannot bypass disabled public discovery flags", () => {
  const monitorOff = { ...pilotEnv, NEXT_PUBLIC_HCM_PROCESS_MONITOR_ENABLED: "false" };
  assert.ok(!links(17, "processMonitor", hr, monitorOff)
    .some((link) => link.id === "processMonitor"));
  const employerOff = { ...pilotEnv, NEXT_PUBLIC_HCM_PROCESS_MONITOR_ORG_IDS: "18" };
  assert.ok(!links(17, "processMonitor", hr, employerOff)
    .some((link) => link.id === "processMonitor"));
  const workerOff = { ...pilotEnv, NEXT_PUBLIC_HCM_WORKER_360_ENABLED: "false" };
  assert.ok(!links(17, "worker360", hr, workerOff, 209)
    .some((link) => link.id === "worker360"));
  assert.ok(links(17, "processMonitor", hr).some((link) => link.id === "processMonitor"));
  assert.ok(links(17, "worker360", hr, pilotEnv, 209)
    .some((link) => link.id === "worker360"));
});

test("existing HCM server pages reuse scoped navigation without broadening permissions", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  const home = read("src/app/hcm/command-center/page.tsx");
  const actionCenter = read("src/app/hcm/action-center/page.tsx");
  const monitor = read("src/app/hcm/process-monitor/page.tsx");
  const worker = read("src/app/hcm/worker-360/page.tsx");
  const workerClient = read("src/components/hcm-worker-360.tsx");
  const component = read("src/components/hcm-context-navigation.tsx");
  for (const source of [home, actionCenter, monitor, worker]) {
    assert.ok(source.includes("HcmContextNavigation"));
    assert.ok(source.includes("assertOrganizationRole"));
    assert.ok(source.includes("getSessionUser()"));
    assert.ok(source.includes("getAccess("));
  }
  assert.ok(home.includes("peopleHomeEnabledForOrganization(organizationId)"));
  assert.ok(home.includes("canOpenSource(item.sourceUrl)"));
  assert.ok(actionCenter.includes("peopleHomeEnabledForOrganization(organizationId)"));
  assert.ok(actionCenter.includes("roleHasPeopleWorkspace(access?.role)"));
  assert.ok(actionCenter.includes("<HcmBusinessProcessInbox"));
  assert.ok(actionCenter.includes('current="actionCenter"'));
  assert.ok(read("src/components/linaw-workspace.tsx")
    .includes("roleHasPeopleWorkspace(initialData.access?.role)"));
  assert.ok(monitor.includes("monitorEnabledForEmployer(organizationId)"));
  assert.ok(links(17, "actionCenter").find(link => link.id === "actionCenter")?.current);
  assert.ok(!links(17, "actionCenter", bookkeeper).some(link => link.id === "actionCenter"));
  assert.ok(worker.includes('HCM_WORKER_360_ENABLED !== "true"'));
  assert.ok(workerClient.includes("/app?organizationId="));
  assert.ok(component.includes('aria-label="HCM workspace navigation"'));
  assert.ok(component.includes('aria-current={link.current ? "page"'));
  assert.ok(!component.includes("db."));
  assert.ok(!component.includes("fetch("));
});
