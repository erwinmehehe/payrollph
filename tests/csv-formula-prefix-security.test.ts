import assert from "node:assert/strict";
import test from "node:test";
import { escapeCsvCell, toCsv } from "../src/lib/csv";

test("formula prefixes remain escaped after whitespace and invisible format characters", () => {
  for (const value of [
    "=1+1", " +SUM(A1:A2)", "\t=1+1", "\r\n@SUM(A1:A2)",
    '\u00a0=HYPERLINK("https://example.test")',
    "\uFEFF=1+1", "\u200B=1+1", "\u2060-1+2",
    " \u200C@SUM(A1:A2)", "\n-2+4", ' -HYPERLINK("https://example.test")',
  ]) {
    const expected = '"' + "'" + value.replaceAll('"', '""') + '"';
    assert.equal(escapeCsvCell(value), expected, JSON.stringify(value));
  }
});

test("genuine negative amounts, whitespace and benign text retain source representation", () => {
  for (const value of ["-12", "-12.50", " -12.50", "\u200B-0.5", "  hello", "\u200Binfo", "0", ""]) {
    assert.equal(escapeCsvCell(value), '"' + value + '"', JSON.stringify(value));
  }
});

test("CSV preserves quoted commas and escaping while neutralizing imported journal labels", () => {
  const content = toCsv({ columns: ["Label", "Amount"], rows: [[
    ' \u200B=HYPERLINK("https://example.test","Go")', "-123.45",
  ]] });
  assert.ok(content.includes('"\' \u200B=HYPERLINK(""https://example.test"",""Go"")"'));
  assert.ok(content.includes('"-123.45"'));
});
