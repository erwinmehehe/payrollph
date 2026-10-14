import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { employeeHrCasesEnabled } from "../src/lib/hr-case-activation";
const require = createRequire(import.meta.url);

test("actual HR case handlers remain unavailable while off or multi-entity HCM is deferred", async () => {
  process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
  const oldCase = process.env.EMPLOYEE_HR_CASES_ENABLED;
  const oldMulti = process.env.MULTI_ENTITY_ENABLED;
  const authId = require.resolve("../src/lib/auth");
  const original = require(authId);
  let sessionReads = 0;
  require.cache[authId]!.exports = { ...original, getSessionUser: async () => { sessionReads++; return null; } };
  try {
    const route = await import("../src/app/api/hr-cases/route");
    for (const env of [{}, { EMPLOYEE_HR_CASES_ENABLED: "true", MULTI_ENTITY_ENABLED: "true" }]) {
      delete process.env.EMPLOYEE_HR_CASES_ENABLED;
      delete process.env.MULTI_ENTITY_ENABLED;
      Object.assign(process.env, env);
      assert.equal(employeeHrCasesEnabled(env), false);
      for (const method of ["GET", "POST", "PATCH"] as const) {
        const response = await route[method](new Request("https://example.test/api/hr-cases", { method }));
        assert.equal(response.status, 404);
      }
    }
    assert.equal(sessionReads, 0, "Held routes must not load session or sensitive case rows");
  } finally {
    require.cache[authId]!.exports = original;
    if (oldCase === undefined) delete process.env.EMPLOYEE_HR_CASES_ENABLED;
    else process.env.EMPLOYEE_HR_CASES_ENABLED = oldCase;
    if (oldMulti === undefined) delete process.env.MULTI_ENTITY_ENABLED;
    else process.env.MULTI_ENTITY_ENABLED = oldMulti;
  }
});
