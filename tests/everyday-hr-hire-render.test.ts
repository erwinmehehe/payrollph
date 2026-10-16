import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HrisOnboardingChecklist } from "../src/components/hris-onboarding-checklist";
import { NewHireModal } from "../src/components/new-hire-modal";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";

const props = {
  organizationId: 1, employees: [],
  onRefresh: async () => {}, onOpenEmployee: () => {},
};

test("disabled hire shortcut renders exactly the pre-PR loading and empty snapshots", () => {
  const snapshots = JSON.parse(readFileSync("tests/fixtures/everyday-hr-hire-off-snapshots.json", "utf8"));
  // Captured by executing the actual main component at snapshots.source.
  for (const [index, provisioning] of [undefined, []].entries()) {
    const enabled = criticalReleaseFlagEnabled("everydayHrHire", {});
    const html = renderToStaticMarkup(createElement(HrisOnboardingChecklist, {
      ...props, provisioning, onAddEmployee: enabled ? () => {} : undefined,
    }));
    assert.equal(createHash("sha256").update(html).digest("hex"), snapshots.hashes[index]);
    assert.ok(!html.includes("Add employee &amp; start onboarding"));
  }
});

test("enabled authorized callback renders the hire action in loading and empty states", () => {
  assert.equal(criticalReleaseFlagEnabled("everydayHrHire", { EVERYDAY_HR_HIRE_ENABLED: "true" }), true);
  for (const provisioning of [undefined, []]) {
    const html = renderToStaticMarkup(createElement(HrisOnboardingChecklist, {
      ...props, provisioning, onAddEmployee: () => {},
    }));
    assert.match(html, /Add employee &amp; start onboarding/);
    assert.match(html, /type="button"/);
  }
});

test("actual hire form preserves UTC by default and shows Manila after opt-in", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-14T16:00:00Z").getTime() });
  const render = (everydayHrHireEnabled?: boolean) => renderToStaticMarkup(createElement(NewHireModal, {
    organizationId: 1, onClose: () => {}, onCreated: () => {}, everydayHrHireEnabled,
  }));
  assert.equal(render(), render(false));
  assert.match(render(false), /type="date"[^>]*value="2026-10-14"/);
  assert.match(render(true), /type="date"[^>]*value="2026-10-15"/);
});
