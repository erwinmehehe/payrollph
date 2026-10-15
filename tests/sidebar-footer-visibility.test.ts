import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Overview and mockup pages never conceal workspace account navigation", () => {
  const theme = readFileSync("src/app/workspace-theme.css", "utf8");
  const shell = readFileSync("src/components/workspace/shell.tsx", "utf8");
  const globals = readFileSync("src/app/globals.css", "utf8");

  // A mockup-only CSS rule previously hid Settings (and sign-out) whenever
  // the user returned to Overview. CSS made the button's box zero-sized.
  assert.doesNotMatch(theme,
    /\.app-shell\[data-workspace-page=["']Overview["']\]\s+\.sidebar-bottom\s*\{\s*display\s*:\s*none\b/i);
  assert.doesNotMatch(theme,
    /\.app-shell:has\(\.mockup-role-page\)\s+\.sidebar-bottom\s*>\s*\.nav-item:first-child\s*\{\s*display\s*:\s*none\b/i);

  assert.match(shell, /data-nav-name="Settings"/);
  assert.match(shell, /aria-label="Settings"/);
  assert.match(globals, /grid-template-rows:\s*auto\s+auto\s+minmax\(0,\s*1fr\)\s+auto\s*;/);
  assert.match(globals, /\.side-navigation\s*\{[^}]*min-height:\s*0\s*;/s);

  // Runtime verification for both widths remains in nav-sweep.spec.mjs.
  const sweep = readFileSync("tests/e2e/nav-sweep.spec.mjs", "utf8");
  assert.match(sweep, /Focus(ed)? Settings navigation regression|NAV_SWEEP_FOCUS_PAGE/);
  assert.match(sweep, /NAV_SWEEP_LAYOUT_DIAGNOSTIC/);
});
