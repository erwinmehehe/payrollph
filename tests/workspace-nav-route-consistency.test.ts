import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NAVIGATION } from "../src/components/workspace/nav";
import { ROLE_PRIMARY_PAGES, workspacePagesForRole } from "../src/lib/workspace-role-ui";

test("every sidebar destination has a real workspace renderer, not an empty page", () => {
  const source = readFileSync("src/components/linaw-workspace.tsx", "utf8");
  const implemented = new Set([...source.matchAll(/\bpage === "([^"]+)"/g)]
    .map(match => match[1]));
  const navNames = NAVIGATION.flatMap(group => group.items.map(item => item.name));
  assert.equal(navNames.length, new Set(navNames).size, "Duplicate nav names");
  for (const name of navNames) {
    assert.ok(implemented.has(name), "Sidebar destination lacks a view: " + name);
  }
});

test("role-primary navigation is a subset of the real permitted role scope", () => {
  const known = new Set(NAVIGATION.flatMap(group => group.items.map(item => item.name)));
  for (const [role, primary] of Object.entries(ROLE_PRIMARY_PAGES)) {
    if (!primary) continue;
    assert.equal(new Set(primary).size, primary.length, "Duplicate primary tab for " + role);
    const allowed = workspacePagesForRole(role);
    for (const page of primary) {
      assert.ok(known.has(page), "Unrecognized primary tab: " + role + "/" + page);
      if (allowed) assert.ok(allowed.includes(page),
        "Stale primary tab outside scoped role: " + role + "/" + page);
    }
  }
});

test("manager navigation never presents company-wide analytics or planning as a primary tab", () => {
  assert.ok(!ROLE_PRIMARY_PAGES.manager?.includes("Analytics"));
  assert.ok(!ROLE_PRIMARY_PAGES.manager?.includes("Planning"));
  assert.ok(workspacePagesForRole("manager")?.includes("Approvals"));
  assert.ok(workspacePagesForRole("manager")?.includes("Performance"));
});
