import assert from "node:assert/strict";
import test from "node:test";
import { findFilingForm, FILING_FORMS } from "../src/lib/filing-evidence";
import { officialFilingGuidance, PH_FILING_PORTALS } from "../src/lib/ph-filing-portal-guidance";

test("every filing-evidence form has official portal instructions, without claiming a certified worksheet", () => {
  for (const definition of FILING_FORMS) {
    const guide = officialFilingGuidance(definition.agency, definition.form);
    assert.ok(guide, `missing official instructions for ${definition.agency} ${definition.form}`);
    assert.ok(guide?.officialInstructionsUrl.startsWith("https://"));
    assert.ok(guide?.officialPortalUrl.startsWith("https://"));
    assert.equal(guide?.worksheetStatus, "reconciliation-only");
    assert.ok(guide!.acceptanceEvidence.length > 20);
  }
  assert.equal(PH_FILING_PORTALS.length, FILING_FORMS.length + 1, "BIR 2316 annual certificate has separate guidance");
  assert.equal(officialFilingGuidance("BIR", "2316")?.form, "2316");
});

test("official workflow references remain agency-specific and version proof remains independent", () => {
  assert.match(officialFilingGuidance("SSS", "R-3")!.notes, /not an authorized/);
  assert.match(officialFilingGuidance("PhilHealth", "RF-1")!.notes, /not upload-format certification/);
  assert.match(officialFilingGuidance("Pag-IBIG", "MCRF")!.workflow, /eSRS/);
  assert.match(officialFilingGuidance("BIR", "1601-C")!.notes, /No PayrollPH.*import capability/);
  assert.match(officialFilingGuidance("BIR", "1604-C")!.notes, /never certifies an official DAT/);
  assert.deepEqual(findFilingForm("BIR", "1601-C")?.submissionMethods, ["manual_entry"]);
  assert.equal(findFilingForm("BIR", "2316"), null, "2316 is not a supported agency-file upload");
});
