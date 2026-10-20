import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("People administration cards have distinct tenant-scoped React keys", () => {
  const source = readFileSync("src/components/workspace/people.tsx", "utf8");
  const adminPanel = source.slice(source.indexOf('Employee administration <span>'), source.indexOf("<HcmEmploymentLifecycleActionCenter"));
  assert.ok(adminPanel.includes('key={`hcm-bp-admin:${data.selectedOrganization.id}`}'),
    "Business-process administration needs a unique component-scoped key");
  assert.ok(adminPanel.includes('key={`hcm-bp-inbox:${data.selectedOrganization.id}`}'),
    "Business-process inbox needs a different component-scoped key");
  assert.doesNotMatch(adminPanel, /<(?:HcmBusinessProcessAdmin|HcmBusinessProcessInbox)\s+key=\{data\.selectedOrganization\.id\}/,
    "Simultaneously visible People panels must not reuse the numeric tenant ID as their key");
});

test("Recruitment cards have distinct tenant-scoped React keys", () => {
  const source = readFileSync("src/components/linaw-workspace.tsx", "utf8");
  const recruitment = source.slice(source.indexOf('{page === "Recruitment" && ('), source.indexOf('{page === "Performance" &&'));
  assert.ok(recruitment.includes('key={`hris-onboarding:${data.selectedOrganization.id}`}'));
  assert.ok(recruitment.includes('key={`recruitment-panel:${data.selectedOrganization.id}`}'));
  assert.doesNotMatch(recruitment, /<(?:HrisOnboardingChecklist|RecruitmentPanel)[^>]*?key=\{data\.selectedOrganization\.id\}/s);
});
