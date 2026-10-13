import assert from "node:assert/strict";
import test from "node:test";
import { leadRetentionDays, leadRetentionCutoff } from "../src/lib/lead-retention-policy";

test("flag-off retains the existing 365-day lead purge window", () => {
  assert.equal(leadRetentionDays({ MARKETING_LEAD_RETENTION_DAYS: "30" }), 365);
});
test("approved configured lead retention computes the precise UTC cutoff", () => {
  const env = { CONFIGURABLE_LEAD_RETENTION_ENABLED: "true", MARKETING_LEAD_RETENTION_DAYS: "30" };
  assert.equal(leadRetentionDays(env), 30);
  assert.equal(leadRetentionCutoff(Date.parse("2026-10-12T00:00:00Z"), env).toISOString(), "2026-09-12T00:00:00.000Z");
});
test("invalid retention cannot cause accidental mass deletion", () => {
  for (const raw of ["0", "-1", "1.5", "NaN", "3651", "999999999999999999"]) {
    assert.throws(() => leadRetentionDays({ CONFIGURABLE_LEAD_RETENTION_ENABLED: "true", MARKETING_LEAD_RETENTION_DAYS: raw }));
  }
});
