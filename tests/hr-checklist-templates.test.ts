import assert from "node:assert/strict";
import test from "node:test";
import { HR_CHECKLIST_TEMPLATES, hrChecklistCsv } from "../src/lib/hr-checklist-templates";

test("template library includes six distinct, useful blank checklists", () => {
  assert.equal(HR_CHECKLIST_TEMPLATES.length, 6);
  assert.equal(new Set(HR_CHECKLIST_TEMPLATES.map((x) => x.slug)).size, 6);
  for (const template of HR_CHECKLIST_TEMPLATES) {
    assert.match(template.slug, /^[a-z0-9-]+$/);
    assert.ok(template.title && template.description && template.audience);
    assert.ok(template.sections.length >= 2);
    assert.ok(template.sections.every((section) => section.title && section.items.length >= 3));
  }
});

test("CSV export is blank, has one row per item and escapes untrusted spreadsheet syntax", () => {
  for (const template of HR_CHECKLIST_TEMPLATES) {
    const csv = hrChecklistCsv(template);
    assert.ok(csv.startsWith("\uFEFF\"Section\",\"Checklist item\",\"Owner\",\"Target date\",\"Status\",\"Notes\""));
    const rows = csv.trim().split("\r\n");
    const expected = 1 + template.sections.reduce((total, section) => total + section.items.length, 0);
    assert.equal(rows.length, expected);
    assert.ok(rows.slice(1).every((row) => row.endsWith(',"","","",""')));
    assert.equal(csv.includes("employeeNo"), false);
  }
  const formula = hrChecklistCsv({
    slug: "synthetic",
    title: "Synthetic",
    category: "test",
    audience: "test",
    description: "test",
    sections: [{ title: "Test", items: ['=IMPORT("source")'] }],
  });
  assert.ok(formula.includes("'=IMPORT("));
  assert.ok(formula.includes('""source""'));
});
