import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isDemoUserEmail } from "../src/lib/demo";

const root = path.resolve(process.cwd());
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("fixed public-demo identities are recognized without catching real users", () => {
  assert.equal(isDemoUserEmail("celine@linaw.ph"), true);
  assert.equal(isDemoUserEmail("JONAS.REYES@LINAW.PH"), true);
  assert.equal(isDemoUserEmail("mika@linaw.ph"), true);
  assert.equal(isDemoUserEmail("owner@customer.ph"), false);
});

test("public demo launcher is feature-gated, rate-limited and repairs memberships", () => {
  const source = read("src/app/api/auth/demo-switch/route.ts");
  assert.match(source, /if \(!DEMO_MODE\)/);
  assert.match(source, /rateLimitDistributed\(`public-demo:/);
  assert.match(source, /db\.delete\(userOrganizations\)/);
  assert.match(source, /DEMO_ORGANIZATION_NAMES/);
  assert.doesNotMatch(source, /const orgs = await db\.select\(\)\.from\(organizations\)/);
});

test("normal password login cannot be used for shared demo identities", () => {
  const source = read("src/app/api/auth/login/route.ts");
  assert.match(source, /DEMO_MODE && isDemoUserEmail\(email\)/);
  assert.doesNotMatch(source, /demoTotpCode/);
});

test("high-risk external side effects are disabled for demo sessions", () => {
  const guarded = [
    "src/app/api/billing/route.ts",
    "src/app/api/invitations/route.ts",
    "src/app/api/developer/route.ts",
    "src/app/api/payroll-runs/[id]/exports/route.ts",
    "src/app/api/account/email/route.ts",
    "src/app/api/account/password/route.ts",
    "src/app/api/account/profile/route.ts",
    "src/app/api/account/sessions/route.ts",
    "src/app/api/auth/totp/setup/route.ts",
    "src/app/api/organizations/route.ts",
  ];
  for (const file of guarded) {
    assert.match(read(file), /demoMutationBlocked/, `${file} must guard demo mutations`);
  }
});

test("demo payroll release keeps the sandbox interaction but suppresses email and webhooks", () => {
  const source = read("src/app/api/payroll-runs/[id]/release/route.ts");
  assert.match(source, /if \(!user\.demo\)/);
  assert.match(source, /demoSideEffectsSuppressed: user\.demo/);
});

test("marketing and workspace expose the demo conversion funnel", () => {
  const welcome = read("src/app/welcome/page.tsx");
  const workspace = read("src/components/linaw-workspace.tsx");
  assert.match(welcome, /Try Live Demo/);
  assert.match(welcome, /href="\/book-demo"/);
  assert.match(welcome, /href="\/signup"/);
  assert.match(workspace, /Public demo workspace/);
  assert.match(workspace, /Create account/);
  assert.match(workspace, /Book demo/);
});

test("self-serve signup is rate limited and creates isolated owner membership", () => {
  const source = read("src/app/api/signup/route.ts");
  assert.match(source, /rateLimitDistributed\(`signup:/);
  assert.match(source, /db\.transaction/);
  assert.match(source, /role: "owner"/);
  assert.match(source, /status: "trialing"/);
  assert.match(source, /trialEndsAt/);
});
