import assert from "node:assert/strict";
import test from "node:test";
import { renderPayslipPdf } from "../src/lib/payslip-pdf";

const peso = (value: number) => `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const sample = {
  employerName: "Loom & Local Philippines Inc.",
  employeeName: "Mariel Santos",
  employeeNo: "LL-101",
  title: "Operations Lead",
  periodLabel: "Mar 1-15, 2026",
  payDate: "2026-03-18",
  ruleVersion: "PH-2026.01",
  gross: 21000,
  deductions: 4125.5,
  net: 16874.5,
  lines: [{ label: "Basic pay", amount: peso(21000), note: "12 paid days x 1750.00 daily" }],
  contributions: [
    { label: "SSS", amount: peso(900) },
    { label: "Withholding tax", amount: peso(3225.5) },
  ],
  advisories: ["DOLE-NCR-2026-03 hazard pay applied"],
  flags: [],
};

test("renders a structurally valid PDF with a correct xref table", () => {
  const buffer = renderPayslipPdf(sample);
  const text = buffer.toString("latin1");

  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));

  const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF$/)?.[1]);
  assert.ok(startxref > 0);
  const xref = text.slice(startxref);
  assert.ok(/^xref\n0 7\n/.test(xref), "xref must list all 6 objects plus the free entry");

  // Each declared offset must point exactly at "N 0 obj".
  const offsets = [...xref.matchAll(/^(\d{10}) 00000 n\s*$/gm)].map((match) => Number(match[1]));
  assert.equal(offsets.length, 6);
  offsets.forEach((offset, index) => {
    const at = text.slice(offset, offset + 12);
    assert.ok(at.startsWith(`${index + 1} 0 obj`), `object ${index + 1} offset wrong, saw "${at}"`);
  });
});

test("payslip content carries the figures and traceability note", () => {
  const text = renderPayslipPdf(sample).toString("latin1");
  assert.ok(text.includes("NET PAY"));
  assert.ok(text.includes("16,874.50"));
  assert.ok(text.includes("21,000.00"));
  assert.ok(text.includes("PH-2026.01"));
  assert.ok(text.includes("traces to its inputs"));
});

test("non-WinAnsi characters are sanitized so the PDF never corrupts", () => {
  const text = renderPayslipPdf({ ...sample, title: "Head of ₱ Operations – APAC" }).toString("latin1");
  assert.ok(!text.includes("₱"), "unsupported glyph must be stripped");
  assert.ok(!text.includes("–"), "en dash must be normalized to ASCII");
  assert.ok(text.includes("Head of"), "surrounding text must survive");
});

test("parentheses and backslashes are escaped inside PDF strings", () => {
  const text = renderPayslipPdf({ ...sample, employeeName: "Ana (Reyes) \\O'Brien" }).toString("latin1");
  assert.ok(text.includes("Ana \\(Reyes\\) \\\\O'Brien"));
});

test("long notes wrap instead of overflowing the page", () => {
  const long = "Repeat ".repeat(40).trim();
  const buffer = renderPayslipPdf({ ...sample, advisories: [long] });
  assert.ok(buffer.length > 0);
  const ops = (buffer.toString("latin1").match(/Tj/g) ?? []).length;
  assert.ok(ops > 12, `expected wrapped lines, got ${ops}`);
});

test("an empty payslip still renders a valid document", () => {
  const text = renderPayslipPdf({ ...sample, lines: [], contributions: [], advisories: [] }).toString("latin1");
  assert.ok(text.includes("None"));
  assert.ok(text.startsWith("%PDF-1.4"));
});
