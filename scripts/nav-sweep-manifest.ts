/**
 * Generate the navigation contract from the application's live menu sources.
 * Never maintain a second handwritten list of workspace destinations.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { INVITABLE_ROLES } from "../src/lib/roles";
import { ROLE_PRIMARY_PAGES, workspacePagesForRole } from "../src/lib/workspace-role-ui";
import { NAVIGATION, tenantNavigationPages } from "../src/components/workspace/nav";
import { employeeNavigationTabs } from "../src/lib/employee-navigation";

const roles = [...new Set([
  ...INVITABLE_ROLES.map((role) => role.id),
  ...Object.keys(ROLE_PRIMARY_PAGES),
])].filter((role) => role !== "group_hr"); // default-off multi-entity-only role

const knownPages = new Set(NAVIGATION.flatMap((group) => group.items.map((item) => item.name)));
// Static shell contract: a menu entry is not implemented just because it exists
// in the nav model. Every reachable key must render a real workspace page.
// Keep this derived from the actual JSX rather than a second hand-maintained map.
const workspaceSource = readFileSync("src/components/linaw-workspace.tsx", "utf8");
const renderedPages = new Set([...workspaceSource.matchAll(/\bpage === "([^"]+)"/g)]
  .map((match) => match[1]));
for (const page of knownPages) {
  assert.ok(renderedPages.has(page), "Navigation key has no workspace page renderer: " + page);
}
// Primary tabs can reorder only authorized destinations. This catches stale
// role menus without granting access to the missing destination.
for (const [role, primaryPages] of Object.entries(ROLE_PRIMARY_PAGES)) {
  const allowed = workspacePagesForRole(role);
  for (const page of primaryPages) {
    assert.ok(knownPages.has(page), "Unknown primary navigation key: " + role + "/" + page);
    if (allowed) {
      assert.ok(allowed.includes(page), "Primary tab outside role scope: " + role + "/" + page);
    }
  }
}
const records = roles.map((role) => {
  const pages = role === "employee"
    ? employeeNavigationTabs(false).allTabs.map((tab) => "employee-" + tab)
    : tenantNavigationPages({
        enabled: false, // reflect the untouched default-off core-navigation flag
        rolePages: workspacePagesForRole(role),
        isFreelancer: false,
        companyWide: role !== "manager",
        canManageModules: ["owner", "admin", "bookkeeper"].includes(role),
      });
  assert.ok(pages.length, "No pages derived for role " + role);
  assert.equal(new Set(pages).size, pages.length, "Duplicate nav item for " + role);
  if (role !== "employee") {
    for (const page of pages) assert.ok(knownPages.has(page), "Unknown nav key " + page);
  }
  return { role, pages, path: "/app" };
});

// Source inventory of error emission patterns, including nested components.
// The browser sweep uses real .toast.err and alert/notice DOM selectors, not
// just the two panels initially named in the bug report.
const paths: string[] = [];
function walk(folder: string) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const name = path.join(folder, entry.name);
    if (entry.isDirectory()) walk(name);
    else if (/\.tsx?$/.test(entry.name)) paths.push(name);
  }
}
walk("src/components");
const errorEmitters = paths.flatMap((file) => {
  const source = readFileSync(file, "utf8");
  const notifyError = /\bnotify\s*\([\s\S]{0,320}?["']err["']/g;
  const alert = /role=["']alert["']|notice-(?:red|danger|amber)|empty-state error|toast\.err/g;
  const notifyMatches = [...source.matchAll(notifyError)].length;
  const alertMatches = [...source.matchAll(alert)].length;
  return notifyMatches || alertMatches
    ? [{ file: file.replaceAll("\\", "/"), notifyError: notifyMatches, errorSurfaces: alertMatches }]
    : [];
});
assert.ok(errorEmitters.some((row) => row.file.endsWith("workspace/ui.tsx")), "Toast renderer not discovered");
mkdirSync("qa-artifacts/nav-sweep", { recursive: true });
const manifest = {
  source: ["src/components/workspace/nav.ts", "src/lib/workspace-role-ui.ts",
    "src/lib/roles.ts", "src/lib/employee-navigation.ts"],
  excludedRoles: [{ role: "group_hr", reason: "Default-off multi-entity capability" }],
  navItemCount: knownPages.size,
  renderedPageCount: renderedPages.size,
  primaryRoleContractChecked: Object.keys(ROLE_PRIMARY_PAGES).length,
  roles: records,
  errorEmitters,
};
writeFileSync("qa-artifacts/nav-sweep/manifest.json", JSON.stringify(manifest, null, 2));
console.log("Navigation sweep manifest: " + records.map((row) => row.role + "=" + row.pages.length).join(", "));
console.log("Component error-emitter inventory: " + errorEmitters.length + " files.");
