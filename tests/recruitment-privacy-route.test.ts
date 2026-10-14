import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { applicantPrivacyControlsEnabled } from "../src/lib/recruitment-applicant-privacy";
const require = createRequire(import.meta.url);

test("actual privacy handlers gate off, held, anonymous, role, MFA and origin before database access", async () => {
  const saved = { ...process.env };
  process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
  const restorers: Array<() => void> = [];
  function patch(path: string, overrides: Record<string, unknown>) {
    const id = require.resolve(path), original = require(id), entry = require.cache[id]!;
    entry.exports = { ...original, ...overrides };
    restorers.push(() => { entry.exports = original; });
  }
  let sessionReads = 0, dbReads = 0;
  let actor: { id: number; name: string } | null = null;
  let roleDenied = false, companyWide = true, mfaDenied = false;
  patch("../src/db", { db: { transaction: () => { dbReads++; throw new Error("Unexpected database access"); } } });
  patch("../src/lib/auth", { getSessionUser: async () => { sessionReads++; return actor; } });
  patch("../src/lib/access", {
    assertOrganizationRole: async () => roleDenied ? Response.json({}, { status: 403 }) : null,
    getAccess: async () => ({ companyWide }),
  });
  patch("../src/lib/security-request", {
    // Keep the actual same-origin guard; adapt MFA/rate-limit infrastructure only.
    requireSensitiveActionMfa: () => mfaDenied ? Response.json({}, { status: 403 }) : null,
    enforceSensitiveActionRateLimit: async () => null,
  });
  try {
    const { GET, PATCH } = await import("../src/app/api/recruitment/privacy/route");
    const get = () => new Request("https://example.test/api/recruitment/privacy?organizationId=1&applicantId=2");
    const mutate = (origin = "https://example.test") => new Request("https://example.test/api/recruitment/privacy", {
      method: "PATCH", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ organizationId: 1, applicantId: 2, action: "erase" }),
    });
    for (const flag of [undefined, "false", "True"]) {
      if (flag === undefined) delete process.env.APPLICANT_PRIVACY_CONTROLS_ENABLED;
      else process.env.APPLICANT_PRIVACY_CONTROLS_ENABLED = flag;
      assert.equal((await GET(get())).status, 404);
      assert.equal((await PATCH(mutate())).status, 404);
    }
    process.env.APPLICANT_PRIVACY_CONTROLS_ENABLED = "true";
    process.env.MULTI_ENTITY_ENABLED = "true";
    assert.equal(applicantPrivacyControlsEnabled(), false);
    assert.equal((await GET(get())).status, 404);
    assert.equal((await PATCH(mutate())).status, 404);
    assert.equal(sessionReads, 0);
    delete process.env.MULTI_ENTITY_ENABLED;
    assert.equal((await GET(get())).status, 401);
    assert.equal((await PATCH(mutate())).status, 401);
    actor = { id: 7, name: "Synthetic administrator" };
    roleDenied = true;
    assert.equal((await GET(get())).status, 403);
    assert.equal((await PATCH(mutate())).status, 403);
    roleDenied = false; companyWide = false;
    assert.equal((await GET(get())).status, 403);
    assert.equal((await PATCH(mutate())).status, 403);
    companyWide = true; mfaDenied = true;
    assert.equal((await GET(get())).status, 403);
    assert.equal((await PATCH(mutate())).status, 403);
    mfaDenied = false;
    assert.equal((await PATCH(mutate("https://foreign.test"))).status, 403);
    assert.equal(dbReads, 0);
  } finally {
    for (const restore of restorers.reverse()) restore();
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
