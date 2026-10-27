import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("HRIS More HR tools is a keyboard-focusable native disclosure with a 44px touch target", () => {
  const component = readFileSync("src/components/hris-home-shortcuts.tsx", "utf8");
  const disclosure = component.match(/<details className="[^"]+">\s*<summary className="([^"]+)">\s*More HR tools\s*<\/summary>/);
  assert.ok(disclosure, "Keep the native details/summary keyboard and expanded-state semantics");
  for (const className of ["min-h-11", "focus-visible:outline-2", "focus-visible:outline-offset-2", "focus-visible:outline-emerald-700"]) {
    assert.ok(disclosure[1].split(/\s+/).includes(className), "Missing disclosure class: " + className);
  }
  assert.ok(!component.includes('onClick={() => setAdditionalActionsOpen('),
    "Disclosure must not introduce a secondary state or click-only handler");
});

test("Additional HR action buttons retain 44px click targets and visible keyboard focus", () => {
  const component = readFileSync("src/components/hris-home-shortcuts.tsx", "utf8");
  const button = component.match(/additionalActions\.map\(\(action\) => \(\s*<button[\s\S]*?className="([^"]+)"/);
  assert.ok(button, "Additional actions must stay real keyboard-activatable buttons");
  for (const className of ["min-h-11", "focus-visible:outline-2", "focus-visible:outline-offset-2"]) {
    assert.ok(button[1].split(/\s+/).includes(className), "Missing additional action class: " + className);
  }
  assert.match(component, /onClick=\{\(\) => onPage\(action\.page\)\}/,
    "Keep the existing authorized tool-navigation behavior");
});
