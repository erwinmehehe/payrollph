import { strict as assert } from "node:assert";
import { test } from "node:test";
import { peopleAnalyticsReportQuery } from "../src/lib/people-analytics-report-query";

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
