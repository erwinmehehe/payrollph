import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  scopedReadFailureForHttpStatus,
  scopedReadFailureMessage,
} from "../src/lib/hcm-scoped-read-failure";

test("role-scoped read failures distinguish authentication, denial and failed sources", () => {
  assert.equal(scopedReadFailureForHttpStatus(401), "sign_in");
  assert.equal(scopedReadFailureForHttpStatus(403), "forbidden");
  for (const status of [404, 408, 429, 500, 502, 503, 504]) {
    assert.equal(scopedReadFailureForHttpStatus(status), "server");
  }
  for (const reason of ["sign_in", "forbidden", "server", "network", "invalid"] as const) {
    assert.ok(scopedReadFailureMessage(reason).length >= 45);
    assert.match(scopedReadFailureMessage(reason), /no records|not an empty record set/i);
  }
});

test("My Team, Org Explorer and Team Leave keep denied, invalid and network reads out of ready data", () => {
  for (const path of [
    "src/components/hcm-my-team.tsx",
    "src/components/hcm-org-explorer.tsx",
    "src/components/hcm-team-leave-calendar.tsx",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /scopedReadFailureForHttpStatus\(response\.status\)/, path);
    assert.match(source, /failure: "invalid"/, path);
    assert.match(source, /failure: "network"/, path);
    assert.match(source, /scopedReadFailureMessage\(/, path);
    assert.match(source, /controller\.abort\(\)/, path);
    assert.match(source, /role="alert"/, path);
  }
  const org = readFileSync("src/components/hcm-org-explorer.tsx", "utf8");
  assert.match(org, /data\.tenantId !== organizationId/);
  assert.match(org, /data\.positionId !== selectedPositionId/);
  assert.match(org, /setHistoryRevision\(\(value\) => value \+ 1\)/,
    "position history must be independently retryable without reloading the organization");
  const team = readFileSync("src/components/hcm-my-team.tsx", "utf8");
  assert.match(team, /stored\?\.scopeKey === scopeKey/);
  const leave = readFileSync("src/components/hcm-team-leave-calendar.tsx", "utf8");
  assert.match(leave, /loaded\?\.requestKey === requestKey/);
});
