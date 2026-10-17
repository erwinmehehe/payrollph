import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const approvalPath = "src/components/approval-chain-admin.tsx";
const groupPath = "src/components/dynamic-worker-groups-panel.tsx";
const read = (path: string) => readFileSync(path, "utf8");

test("approval routing and dynamic worker group drafts remount on employer change", () => {
  const approval = read(approvalPath);
  const groups = read(groupPath);
  assert.match(approval, /ApprovalChainAdminContent key=\{props\.organizationId\}/);
  assert.match(groups, /DynamicWorkerGroupsContent key=\{props\.organizationId\}/);
  assert.ok(approval.indexOf("function ApprovalChainAdminContent(") < approval.indexOf("const [steps, setSteps]"));
  assert.ok(groups.indexOf("function DynamicWorkerGroupsContent(") < groups.indexOf("const [conditions, setConditions]"));
  assert.ok(groups.indexOf("function DynamicWorkerGroupsContent(") < groups.indexOf("const [preview, setPreview]"));
});

test("both initial GETs run after synchronous effects and cancel retired read owners", () => {
  for (const path of [approvalPath, groupPath]) {
    const source = read(path);
    assert.match(source, /const revision = \+\+loadRevisionRef\.current/);
    assert.match(source, /const isCurrent = \(\) => mountedRef\.current && !controller\.signal\.aborted && revision === loadRevisionRef\.current/);
    assert.match(source, /loadControllerRef\.current\?\.abort\(\)/);
    assert.match(source, /queueMicrotask\(\(\) => \{ if \(!retired\) void load\(\); \}\)/);
    assert.match(source, /retired = true;\s*mountedRef\.current = false;\s*loadRevisionRef\.current \+= 1/);
    assert.match(source, /signal: controller\.signal/);
    assert.match(source, /if \(!isCurrent\(\)\) return;/);
    assert.doesNotMatch(source, /useEffect\(\(\) => \{ void load\(\); \}, \[load\]\)/);
    assert.equal((source.match(/\buseEffect\(/g) ?? []).length, 1);
  }
});

test("dynamic membership previews use independent abortable last-request ownership", () => {
  const source = read(groupPath);
  assert.match(source, /const revision = \+\+previewRevisionRef\.current/);
  assert.match(source, /revision === previewRevisionRef\.current/);
  assert.match(source, /previewControllerRef\.current\?\.abort\(\)/);
  assert.match(source, /previewRevisionRef\.current \+= 1/);
  assert.match(source, /previewGroupId=\$\{group\.id\}/);
  assert.match(source, /if \(isCurrent\(\)\) setPreviewingId\(null\)/);
});

test("retired mutations cannot announce success or alter current employer UI", () => {
  const approval = read(approvalPath);
  const groups = read(groupPath);
  assert.match(approval, /if \(!mountedRef\.current\) return;/);
  assert.match(approval, /if \(mountedRef\.current\) await onChanged\?\.\(\)/);
  assert.match(approval, /if \(mountedRef\.current\) setSaving\(false\)/);
  assert.match(groups, /if \(!mountedRef\.current\) return;/);
  assert.match(groups, /if \(mountedRef\.current\) setNotice\(/);
  assert.match(groups, /if \(mountedRef\.current\) setSaving\(false\)/);
});

test("sensitive approval and group mutations and server-side gates remain unchanged", () => {
  const approval = read(approvalPath);
  const groups = read(groupPath);
  const approvalRoute = read("src/app/api/approval-chains/route.ts");
  const groupRoute = read("src/app/api/dynamic-worker-groups/route.ts");
  for (const key of ['action: "save-policy"', 'action: "set-active"', 'organizationId', 'minimumAmount', 'method: "POST"']) {
    assert.ok(approval.includes(key), "Missing approval boundary: " + key);
  }
  for (const key of ['action: "save-group"', 'action: "set-active"', 'organizationId', 'previewGroupId', 'method: "POST"']) {
    assert.ok(groups.includes(key), "Missing group boundary: " + key);
  }
  assert.ok(approvalRoute.includes("requireSensitiveActionMfa"));
  assert.ok(approvalRoute.includes("enforceSameOriginMutation"));
  assert.ok(groupRoute.includes("requireSensitiveActionMfa"));
  assert.ok(groupRoute.includes("previewDynamicWorkerGroup"));
});

test("only the two resolved per-file lint allowances are removed", () => {
  const manifest = JSON.parse(read("eslint-suppressions.json")) as Record<string, unknown>;
  assert.equal(manifest[approvalPath], undefined);
  assert.equal(manifest[groupPath], undefined);
  assert.ok(read("scripts/check-lint-warning-debt.mjs").includes("warningDebt"));
});
