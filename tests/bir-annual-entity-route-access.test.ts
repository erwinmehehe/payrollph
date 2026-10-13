import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);

test("actual BIR candidate/evidence handlers deny another employer before tax source reads", async () => {
  process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
  const oldFlag = process.env.BIR_1604C_DAT_CANDIDATE_ENABLED;
  const oldEntityFlag = process.env.MULTI_ENTITY_ENABLED;
  process.env.BIR_1604C_DAT_CANDIDATE_ENABLED = "true";
  process.env.MULTI_ENTITY_ENABLED = "true";
  const restorers: Array<() => void> = [];
  function patch(path: string, overrides: Record<string, unknown>) {
    const id = require.resolve(path);
    const original = require(id);
    const entry = require.cache[id]!;
    entry.exports = { ...original, ...overrides };
    restorers.push(() => { entry.exports = original; });
  }
  let sourceReads = 0;
  let caller: { id: number; name: string } | null = { id: 1, name: "Synthetic payroll operator" };
  // Adapt session/org-role/transport infrastructure; execute the production
  // handlers, shared guard and real employer resource policy. No DB/provider IO.
  patch("../src/lib/auth", { getSessionUser: async () => caller });
  patch("../src/lib/access", { assertOrganizationRole: async () => null,
    getAccess: async () => ({ companyWide: true, role: "payroll" }) });
  patch("../src/lib/security-request", { enforceSameOriginMutation: () => null,
    requireSensitiveActionMfa: () => null, enforceSensitiveActionRateLimit: async () => null });
  patch("../src/lib/multi-entity-server", { resolveMultiEntityContext: async () => ({
    ok: true, context: { enabled: true, group: false, role: "payroll", legalEntityId: 11, entities: [] },
  }) });
  patch("../src/lib/bir-annual-employer-source", { loadBirAnnualEmployerSource: async () => {
    sourceReads++; throw new Error("Unauthorized tax source reached");
  } });
  try {
    const candidate = await import("../src/app/api/bir/annual-employer/candidate/route");
    const evidence = await import("../src/app/api/bir/annual-employer/module-evidence/route");
    const legacy = await import("../src/app/api/year-end/route");
    const url = "https://example.test/api/bir/annual-employer?organizationId=1&legalEntityId=22&taxYear=2026";
    const post = (mode: string) => new Request(url, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({
        organizationId: 1, legalEntityId: 22, taxYear: 2026, mode,
        sourceDigest: "a".repeat(64), records: [],
      }) });
    for (const response of [await candidate.POST(post("template")),
      await evidence.GET(new Request(url)), await evidence.POST(post("observe"))]) {
      assert.equal(response.status, 403);
      assert.doesNotMatch(await response.text(), /TIN|sourceDigest|records|moduleV7/i);
    }
    assert.equal(sourceReads, 0);
    for (const response of [await legacy.GET(new Request(url)), await legacy.POST(post("annualize"))]) {
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, "ENTITY_YEAR_END_DEFERRED");
    }
    caller = null;
    assert.equal((await candidate.POST(post("template"))).status, 401);
    assert.equal((await evidence.GET(new Request(url))).status, 401);
    assert.equal((await evidence.POST(post("observe"))).status, 401);
    assert.equal(sourceReads, 0);
    caller = { id: 1, name: "Synthetic payroll operator" };
    process.env.BIR_1604C_DAT_CANDIDATE_ENABLED = "false";
    assert.equal((await candidate.POST(post("template"))).status, 404);
    assert.equal((await evidence.GET(new Request(url))).status, 404);
    assert.equal((await evidence.POST(post("observe"))).status, 404);
    assert.equal(sourceReads, 0);
  } finally {
    for (const restore of restorers.reverse()) restore();
    if (oldFlag === undefined) delete process.env.BIR_1604C_DAT_CANDIDATE_ENABLED;
    else process.env.BIR_1604C_DAT_CANDIDATE_ENABLED = oldFlag;
    if (oldEntityFlag === undefined) delete process.env.MULTI_ENTITY_ENABLED;
    else process.env.MULTI_ENTITY_ENABLED = oldEntityFlag;
  }
});
