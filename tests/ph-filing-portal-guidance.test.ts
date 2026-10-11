import assert from "node:assert/strict";
import test from "node:test";
import { findFilingForm, FILING_FORMS, parseFilingOutcome } from "../src/lib/filing-evidence";
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
  assert.match(officialFilingGuidance("SSS", "R-3")!.notes, /no verified agency import acceptance/);
  assert.match(officialFilingGuidance("PhilHealth", "RF-1")!.notes, /not upload-format certification/);
  assert.match(officialFilingGuidance("Pag-IBIG", "MCRF")!.workflow, /eSRS/);
  assert.match(officialFilingGuidance("BIR", "1601-C")!.notes, /No PayrollPH.*import capability/);
  assert.match(officialFilingGuidance("BIR", "1604-C")!.notes, /never certifies an official DAT/);
  assert.deepEqual(findFilingForm("BIR", "1601-C")?.submissionMethods, ["manual_entry"]);
  assert.equal(findFilingForm("BIR", "2316"), null, "2316 is not a supported agency-file upload");
});

test("receipt dates reject impossible and non-ISO calendar input", () => {
  const input = {
    outcome: "accepted", submissionMethod: "manual_entry",
    agencyReference: "BIR-RECEIPT-0001", submittedAt: "2026-10-10",
  };
  const now = new Date("2026-10-11T10:00:00Z");
  assert.equal(parseFilingOutcome(input, now).ok, true);
  for (const submittedAt of ["2026-02-30", "2026-13-01", "2026-00-01", "10/10/2026", "2026-10-11Tbad"]) {
    assert.equal(parseFilingOutcome({ ...input, submittedAt }, now).ok, false, submittedAt);
  }
});
