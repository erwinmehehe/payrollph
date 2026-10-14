import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = (path: string) => readFileSync(path, "utf8");

function rule(source: string, selector: string): string {
  const start = source.indexOf(selector + " {");
  assert.ok(start >= 0, `Missing CSS selector: ${selector}`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  assert.ok(close > open);
  return source.slice(open + 1, close);
}

test("HR employee avatars remain circular and centered", () => {
  const theme = css("src/app/workspace-theme.css");
  const panel = css("src/app/workspace-panels.css");
  const avatar = rule(theme, ".app-shell .mockup-person .avatar");
  assert.match(avatar, /display:\s*grid\s*;/);
  assert.match(avatar, /place-items:\s*center\s*;/);
  assert.match(avatar, /white-space:\s*nowrap\s*;/);
  const cleanAvatar = rule(panel, ".app-shell.clean-shell .clean-record-overview .mockup-person .avatar");
  assert.match(cleanAvatar, /place-items:\s*center\s*;/);
  assert.match(cleanAvatar, /font-size:\s*11px\s*;/);
  assert.match(cleanAvatar, /width:\s*34px\s*;/);
  assert.match(cleanAvatar, /height:\s*34px\s*;/);
});

test("employee subtitle selectors cannot override the shared avatar span", () => {
  const theme = css("src/app/workspace-theme.css");
  const panel = css("src/app/workspace-panels.css");
  const global = css("src/app/globals.css");
  for (const className of ["mockup-person", "role-person"]) {
    assert.ok(!theme.includes("." + className + " span"), `Broad ${className} span selector would also match avatar initials`);
    assert.ok(theme.includes("." + className + " > div > span"));
  }
  assert.ok(!panel.includes(".mockup-person span"), "Clean-shell body font must not override avatar initials");
  assert.ok(!panel.includes(".person-cell span"), "Employee table subtitle font must not override avatar initials");
  assert.ok(!global.includes(".mini-person span"), "Mini-directory typography must not override avatar initials");
  assert.ok(global.includes(".mini-person > div > span"));
});

test("HR dashboard action labels fit in their column on desktop", () => {
  const theme = css("src/app/workspace-theme.css");
  const columns = rule(theme, ".app-shell .hr-mockup-table .mockup-table-row");
  assert.match(columns, /minmax\(120px,max-content\)/);
  const action = rule(theme, ".app-shell .hr-mockup-table .mockup-table-row > button");
  assert.match(action, /min-width:\s*120px/);
  assert.match(action, /white-space:\s*nowrap/);
  assert.match(action, /justify-self:\s*end/);
});

test("dashboard employee cells use the shared Avatar component", () => {
  const source = readFileSync("src/components/workspace/role-overview-v2.tsx", "utf8");
  assert.ok(source.includes('className="mockup-person"><Avatar initials={employee?.avatarInitials ?? "?"}'));
  assert.ok(source.includes('title={"Employees needing attention ("'));
});
