import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("quick search inspects only the currently authorized loaded employer records", () => {
  const source = readFileSync("src/components/workspace/people.tsx", "utf8");
  assert.match(source, /data\.employees\.filter\(\(employee\) =>/);
  assert.match(source, /Searching \{data\.employees\.length\} loaded, authorized employee records only/);
  assert.match(source, /Other employers and restricted departments are not searched/);
  assert.match(source, /aria-describedby="people-search-scope"/);
  assert.match(source, /No matching records.*authorized snapshot/);
});

test("employee selection never renders a stale prior-employer worker object", () => {
  const source = readFileSync("src/components/workspace/people.tsx", "utf8");
  assert.match(source, /picked\.organizationId === data\.selectedOrganization\.id/);
  assert.match(source, /const selected = data\.employees\.find\(\(employee\) => employee\.id === selectedId\)/);
  assert.match(source, /setPicked\(\{ organizationId: data\.selectedOrganization\.id, employeeId: employee\.id \}\)/);
  assert.ok(!source.includes("const selected = picked ??"), "never render a stale selected worker snapshot");
});

test("import preview retains a receipt gate and protects ambiguous commit outcomes", () => {
  const ui = readFileSync("src/components/employee-import-preview-panel.tsx", "utf8");
  assert.match(ui, /employeeImportFailureMessage/);
  assert.match(ui, /employeeImportNetworkFailure/);
  assert.match(ui, /previewToken: receipt/);
  assert.match(ui, /!receipt \|\| result\.blockingErrorCount > 0/);
  assert.match(ui, /Check the employee directory before another commit/);
  assert.match(ui, /aria-label=\{\`Skip row \$\{row\.line\}\`\}/);
  assert.ok(!ui.includes("setReceipt(body.previewToken)"), "never trust an unvalidated preview token");
});
