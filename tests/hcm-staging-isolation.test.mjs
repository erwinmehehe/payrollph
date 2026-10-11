import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  verifyStagingConfiguration,
  verifyStagingDatabase,
} from "../scripts/verify-hcm-staging-isolation.mjs";

const sha = (v) => createHash("sha256").update(v).digest("hex");
const ok = {
  HCM_STAGING_GATE: "true",
  HCM_STAGING_PROJECT_ID: "prj_dedicated_hcm_staging",
  EXPECTED_HCM_STAGING_PROJECT_ID: "prj_dedicated_hcm_staging",
  DATABASE_URL: "postgresql://readonly@staging-db.example.test/hcm_synthetic",
  PRODUCTION_DATABASE_URL_SHA256: sha("postgresql://prod@production-db.example.test/payroll"),
  HCM_STAGING_EXPECTED_DB_MARKER: "payrollph_hcm_qa",
  HCM_PEOPLE_HOME_ENABLED: "false",
  NEXT_PUBLIC_HCM_PEOPLE_HOME_ENABLED: "false",
};
const fakeConnect = (rows) => () => ({
  async connect() {},
  async query(statement) {
    assert.ok(statement.includes("current_setting('payrollph.environment'"));
    return { rows };
  },
  async end() {},
});

test("staging isolation fails closed with missing project attestation or production env", () => {
  for (const changed of [
    { ...ok, HCM_STAGING_GATE: "false" },
    { ...ok, VERCEL_ENV: "production" },
    { ...ok, EXPECTED_HCM_STAGING_PROJECT_ID: "prj_different" },
    { ...ok, HCM_STAGING_PROJECT_ID: "" },
    { ...ok, PRODUCTION_DATABASE_URL_SHA256: "" },
    { ...ok, HCM_STAGING_EXPECTED_DB_MARKER: "" },
    { ...ok, HCM_PEOPLE_HOME_ENABLED: "true" },
    { ...ok, NEXT_PUBLIC_HCM_PEOPLE_HOME_ENABLED: "true" },
    { ...ok, DATABASE_URL: "postgresql://prod@production-db.example.test/payroll",
      PRODUCTION_DATABASE_URL_SHA256: sha("postgresql://prod@production-db.example.test/payroll") },
  ]) assert.throws(() => verifyStagingConfiguration(changed));
});

test("missing DB-side marker and write-capable DB login are NO-GO", async () => {
  await assert.rejects(
    verifyStagingDatabase(ok, fakeConnect([{ marker: "", read_only: "on", database_name: "qa" }])),
    /marker/i,
  );
  await assert.rejects(
    verifyStagingDatabase(ok, fakeConnect([{ marker: "payrollph_hcm_qa", read_only: "off", database_name: "qa" }])),
    /read-only/i,
  );
});

test("valid read-only isolated DB attestation returns redacted evidence, not secrets", async () => {
  const result = await verifyStagingDatabase(ok,
    fakeConnect([{ marker: "payrollph_hcm_qa", read_only: "on", database_name: "qa" }]));
  assert.equal(result.gate, "PASS");
  assert.equal(result.dbReadOnly, true);
  assert.equal(result.realEmployerAccepted, false);
  assert.equal(result.releaseApproved, false);
  assert.ok(!JSON.stringify(result).includes("postgresql://"));
  assert.ok(!JSON.stringify(result).includes("production-db.example.test"));
});
