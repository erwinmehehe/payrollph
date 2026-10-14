import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("homepage, demo and app use one additive visual layer", () => {
  const layout = read("src/app/layout.tsx");
  const home = read("src/components/marketing/claude-home/App.tsx");
  const app = read("src/components/workspace/shell.tsx");
  const demo = read("src/components/marketing/demo-role-picker.tsx");
  assert.match(layout, /import "\.\/experience-refresh\.css";/);
  assert.match(home, /<ExperienceJourney \/>/);
  assert.match(app, /data-demo=\{displayRole \? "true" : undefined\}/);
  assert.match(demo, /linaw-demo-role-picker/);
});

test("public journey links to real marketing destinations without performing mutations", () => {
  const component = read("src/components/marketing/experience-journey.tsx");
  for (const page of ["/hris", "/hcm", "/workforce-management", "/time-and-attendance", "/small-business-payroll", "/demo", "/employee-self-service", "/compliance"]) {
    assert.ok(component.includes('href: "' + page + '"'), "missing destination " + page);
  }
  assert.ok(!component.includes("fetch("), "marketing journey must not mutate user data");
  assert.ok(component.includes("prepared filing data is not proof"));
});

test("demo failure offers interactive preview without bypassing server role checks", () => {
  const component = read("src/components/marketing/demo-role-picker.tsx");
  assert.ok(component.includes('fetch("/api/auth/demo-switch"'));
  assert.ok(component.includes('href="/#demo"'));
  assert.ok(component.includes('role="tabpanel" id="demo-role-panel"'));
  assert.ok(component.includes("aria-labelledby={\`demo-role-tab-\${selected.id}\`}"));
  assert.ok(!component.includes("localStorage"));
});
