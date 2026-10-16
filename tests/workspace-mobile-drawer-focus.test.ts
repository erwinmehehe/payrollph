import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { wrapWorkspaceDrawerTabIndex } from "../src/lib/workspace-drawer-focus";

test("mobile drawer wraps keyboard focus at start and end", () => {
  assert.equal(wrapWorkspaceDrawerTabIndex(0, 5, true), 4);
  assert.equal(wrapWorkspaceDrawerTabIndex(4, 5, false), 0);
  assert.equal(wrapWorkspaceDrawerTabIndex(2, 5, true), null);
  assert.equal(wrapWorkspaceDrawerTabIndex(2, 5, false), null);
  assert.equal(wrapWorkspaceDrawerTabIndex(-1, 5, false), 0);
  assert.equal(wrapWorkspaceDrawerTabIndex(0, 0, true), null);
  assert.equal(wrapWorkspaceDrawerTabIndex(0, 0, false), null);
});

test("mobile navigation uses dialog focus, Escape restore and an accessible main skip link", () => {
  const source = readFileSync("src/components/workspace/shell.tsx", "utf8");
  assert.ok(source.includes('id="workspace-sidebar" ref={mobileDrawerRef}'));
  assert.ok(source.includes('role={drawer ? "dialog" : undefined}'));
  assert.ok(source.includes('aria-modal={drawer ? true : undefined}'));
  assert.ok(source.includes('onKeyDown={keepDrawerKeyboardFocus}'));
  assert.ok(source.includes("wrapWorkspaceDrawerTabIndex(currentIndex, buttons.length, event.shiftKey)"));
  assert.ok(source.includes('onClick={dismissMobileDrawer}'));
  assert.ok(source.includes('aria-controls="workspace-sidebar"'));
  assert.ok(source.includes('aria-expanded={drawer}'));
  assert.ok(source.includes('href="#workspace-main"'));
  assert.ok(source.includes('id="workspace-main" tabIndex={-1}'));
  assert.ok(source.includes("drawerOpenerRef.current?.focus()"));
  assert.ok(source.includes("mobileDrawerRef.current?.querySelector<HTMLButtonElement>"));
});

test("mobile drawer retains role-scoped navigation and never adds pages or API calls", () => {
  const source = readFileSync("src/components/workspace/shell.tsx", "utf8");
  assert.ok(source.includes("allowedItems"));
  assert.ok(source.includes("visiblePages.includes(item.name)"));
  assert.ok(source.includes("onPage(next)"));
  assert.ok(!source.includes('fetch('));
  assert.ok(!source.includes('window.location.assign('));
});
