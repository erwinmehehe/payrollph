import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  assertPeopleAnalyticsSnapshot,
  peopleAnalyticsExportQuery,
  peopleAnalyticsReportQuery,
} from "../src/lib/people-analytics-report-query";

test("JSON and CSV use the same canonical selected-employer scope", () => {
  const json = peopleAnalyticsReportQuery(22, 90, "2026-11-01");
  const csv = peopleAnalyticsReportQuery(22, 90, "2026-11-01", "csv");
  assert.equal(json.get("organizationId"), "22");
  assert.equal(json.get("key"), "people");
  assert.equal(json.get("windowDays"), csv.get("windowDays"));
  assert.equal(json.get("asOf"), csv.get("asOf"));
  assert.equal(json.get("format"), null);
  assert.equal(csv.get("format"), "csv");
});

test("empty date delegates to the API's Manila-day default", () => {
  const query = peopleAnalyticsReportQuery(22, 30);
  assert.equal(query.has("asOf"), false);
});

test("reject malformed dates, identifiers and windows", () => {
  assert.throws(() => peopleAnalyticsReportQuery(0, 90));
  assert.throws(() => peopleAnalyticsReportQuery(1.1, 90));
  assert.throws(() => peopleAnalyticsReportQuery(22, 7 as 30));
  assert.throws(() => peopleAnalyticsReportQuery(22, 30, "2026-02-30"));
  assert.throws(() => peopleAnalyticsReportQuery(22, 30, "2026-01-01&organizationId=88"));
});

test("export pins the exact server-verified snapshot date rather than selecting a new today", () => {
  // The dashboard could be loaded before midnight, then exported afterwards.
  const snapshot = { asOf: "2026-11-20", windowDays: 90 };
  assert.doesNotThrow(() => assertPeopleAnalyticsSnapshot(snapshot, 90, ""));
  const query = peopleAnalyticsExportQuery(22, 90, "", snapshot);
  assert.equal(query.get("organizationId"), "22");
  assert.equal(query.get("key"), "people");
  assert.equal(query.get("format"), "csv");
  assert.equal(query.get("windowDays"), "90");
  assert.equal(query.get("asOf"), "2026-11-20");
});

test("rejects a response or export with a mismatched reporting window or date", () => {
  const snapshot = { asOf: "2026-11-20", windowDays: 90 };
  assert.throws(() => assertPeopleAnalyticsSnapshot(snapshot, 30, ""));
  assert.throws(() => assertPeopleAnalyticsSnapshot(snapshot, 90, "2026-11-19"));
  assert.throws(() => peopleAnalyticsExportQuery(22, 30, "", snapshot));
  assert.throws(() => peopleAnalyticsExportQuery(22, 90, "2026-11-21", snapshot));
  assert.doesNotThrow(() => peopleAnalyticsExportQuery(22, 90, "2026-11-20", snapshot));
});

test("refuses missing or non-calendar source dates without inventing an export date", () => {
  for (const invalid of ["", "2026-02-30", "2026-11-20&organizationId=99"]) {
    assert.throws(() => peopleAnalyticsExportQuery(22, 90, "", {
      asOf: invalid, windowDays: 90,
    }));
  }
});
