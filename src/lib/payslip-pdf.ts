/**
 * Dependency-free PDF writer for payslips.
 *
 * Produces a valid PDF 1.4 document with Helvetica text only, which is enough
 * for a payslip: fixed layout, no images, no custom fonts. Avoiding a PDF
 * library keeps the server bundle small and removes a native-dependency risk.
 */

type Line = { label: string; amount: string; note?: string };

const PAGE_WIDTH = 595.28; // A4 in points
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;

function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    // Strip anything outside WinAnsi-safe ASCII to keep the font honest.
    .replace(/[^\x20-\x7E]/g, "");
}

type Op = { text: string; x: number; y: number; size: number; bold: boolean; gray: [number, number, number] };

function buildContentStream(ops: Op[]) {
  let out = "";
  for (const op of ops) {
    const [r, g, b] = op.gray;
    out += `BT /${op.bold ? "F2" : "F1"} ${op.size} Tf ${r} ${g} ${b} rg 1 0 0 1 ${op.x.toFixed(2)} ${op.y.toFixed(2)} Tm (${escapeText(op.text)}) Tj ET\n`;
  }
  return out;
}

function wrap(text: string, maxChars: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > maxChars) {
      if (current) lines.push(current.trim());
      current = word;
    } else current = `${current} ${word}`;
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

export type PayslipPdfInput = {
  employerName: string;
  employeeName: string;
  employeeNo: string;
  title: string;
  periodLabel: string;
  payDate: string;
  ruleVersion: string;
  gross: number;
  deductions: number;
  net: number;
  lines: Line[];
  contributions: Line[];
  flags?: string[];
  advisories?: string[];
};

export function renderPayslipPdf(input: PayslipPdfInput): Buffer {
  const ops: Op[] = [];
  let y = PAGE_HEIGHT - MARGIN;
  const push = (text: string, x: number, size = 9, bold = false, gray: [number, number, number] = [0.09, 0.15, 0.12]) => {
    ops.push({ text, x, y, size, bold, gray });
    y -= size + 5;
  };

  const money = (value: number) =>
    `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  push(input.employerName.toUpperCase(), MARGIN, 13, true, [0.07, 0.24, 0.21]);
  push("Statement of compensation and deductions", MARGIN, 8, false, [0.42, 0.47, 0.45]);
  y -= 6;

  const meta: [string, string][] = [
    ["Employee", `${input.employeeName} (${input.employeeNo})`],
    ["Position", input.title],
    ["Period", input.periodLabel],
    ["Pay date", input.payDate],
    ["Rule version", input.ruleVersion],
  ];
  for (const [label, value] of meta) {
    ops.push({ text: `${label}`, x: MARGIN, y, size: 8, bold: false, gray: [0.5, 0.55, 0.53] });
    ops.push({ text: value, x: MARGIN + 90, y, size: 9, bold: true, gray: [0.09, 0.15, 0.12] });
    y -= 14;
  }
  y -= 8;

  const section = (heading: string, rows: Line[]) => {
    push(heading, MARGIN, 9, true, [0.09, 0.42, 0.36]);
    if (rows.length === 0) { push("None", MARGIN + 6, 8, false, [0.55, 0.58, 0.56]); y -= 4; return; }
    for (const row of rows) {
      ops.push({ text: row.label, x: MARGIN + 8, y, size: 9, bold: false, gray: [0.12, 0.19, 0.16] });
      ops.push({ text: row.amount, x: PAGE_WIDTH - MARGIN - 110, y, size: 9, bold: true, gray: [0.12, 0.19, 0.16] });
      y -= 13;
      if (row.note) {
        for (const wrapped of wrap(row.note, 92).slice(0, 3)) {
          ops.push({ text: wrapped, x: MARGIN + 16, y, size: 6.8, bold: false, gray: [0.52, 0.56, 0.54] });
          y -= 9;
        }
      }
    }
    y -= 8;
  };

  section("EARNINGS", input.lines);
  ops.push({ text: "GROSS PAY", x: MARGIN, y, size: 9, bold: true, gray: [0.09, 0.15, 0.12] });
  ops.push({ text: money(input.gross), x: PAGE_WIDTH - MARGIN - 110, y, size: 9, bold: true, gray: [0.09, 0.15, 0.12] });
  y -= 20;

  section("DEDUCTIONS", input.contributions);
  ops.push({ text: "TOTAL DEDUCTIONS", x: MARGIN, y, size: 9, bold: true, gray: [0.09, 0.15, 0.12] });
  ops.push({ text: money(input.deductions), x: PAGE_WIDTH - MARGIN - 110, y, size: 9, bold: true, gray: [0.09, 0.15, 0.12] });
  y -= 26;

  ops.push({ text: "NET PAY", x: MARGIN + 8, y, size: 12, bold: true, gray: [0.06, 0.35, 0.28] });
  ops.push({ text: money(input.net), x: PAGE_WIDTH - MARGIN - 130, y, size: 12, bold: true, gray: [0.06, 0.35, 0.28] });
  y -= 24;

  for (const note of [...(input.advisories ?? []), ...(input.flags ?? [])].slice(0, 6)) {
    for (const wrapped of wrap(`Note: ${note}`, 96).slice(0, 2)) {
      ops.push({ text: wrapped, x: MARGIN, y, size: 7.5, bold: false, gray: [0.55, 0.42, 0.18] });
      y -= 11;
    }
  }

  ops.push({
    text: `Every amount traces to its inputs and to rule version ${input.ruleVersion}.`,
    x: MARGIN, y: MARGIN + 12, size: 7, bold: false, gray: [0.52, 0.56, 0.54],
  });

  const content = buildContentStream(ops);
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}
