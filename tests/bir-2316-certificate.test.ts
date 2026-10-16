import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
import { prepare2316Certificate } from "../src/lib/bir-2316-certificate";
import { historical2316Employer } from "../src/lib/bir-2316-employer";
import { render2316CertificatePdf } from "../src/lib/bir-2316-pdf";
import { certificateReview, certificateSource } from "./fixtures/bir-2316-certificate";
test("complete explicit mapping reconciles all numbered amounts; browser withholding cannot override ledger", () => {
  const input = { ...certificateReview(), actualPresentWithheld: "99999999.00" };
  const result = prepare2316Certificate(certificateSource, input);
  assert.equal(result.ok, true); assert.equal(result.amounts["25A"], 500000);
  assert.equal(result.amounts["38"], 10000000); assert.equal(result.amounts["52"], 50000000);
  assert.equal(result.amounts["28"], 500000); assert.deepEqual(result.issues, []);
});
test("missing mapping, false zero evidence, one cent variance, malformed dates and unsigned acknowledgement block", () => {
  for (const change of [
    { detailItems: {} }, { peraCredit: "" }, { previousEmployer: { status: "" } }, { acknowledged: false },
    { detailItems: { ...certificateReview().detailItems, "39": "500000.01" } },
    { detailItems: { ...certificateReview().detailItems, "44A": "1.00", "39": "499999.00" } },
    { detailItems: { ...certificateReview().detailItems, "30": "1.00", "35": "9999.00" } },
    { previousEmployer: { status: "none-confirmed", taxWithheld: "5.00" } },
  ]) assert.equal(prepare2316Certificate(certificateSource, { ...certificateReview(), ...change }).ok, false);
  assert.equal(prepare2316Certificate({ ...certificateSource, birthDate: "2025-99-01" }, certificateReview()).ok, false);
  assert.equal(prepare2316Certificate({ ...certificateSource, withholding: undefined }, certificateReview()).ok, false);
  assert.equal(prepare2316Certificate({ ...certificateSource, withholding: { ...certificateSource.withholding!, issues: ["UNSETTLED_ADJUSTMENT"] } }, certificateReview()).ok, false);
});
test("previous employer and PERA need references and reconcile against approved combined source", () => {
  const review = { ...certificateReview(), previousEmployer: { status: "verified", name: "Prior Fictional Co.", tin: "987654321-0001", address: "Prior Street", zip: "1000", reference: "Fictional prior 2316", taxableCompensation: "100000.00", taxWithheld: "900.00" }, peraCredit: "100.00" };
  assert.equal(prepare2316Certificate(certificateSource, review).ok, false, "current present-only annualization must not accept extra credit");
  const source = { ...certificateSource, summary: { ...certificateSource.summary, taxDue: "6000.00" } };
  const prepared = prepare2316Certificate(source, review);
  assert.equal(prepared.ok, true); assert.equal(prepared.amounts["23"], 60000000); assert.equal(prepared.amounts["25B"], 90000); assert.equal(prepared.amounts["27"], 10000);
});
test("historical employer resolves frozen inactive entity after employee transfer; no tenant or org fallback", () => {
  const legacy = { name: "Workspace", legalName: null, birTin: "999999999", birBranchCode: "0000" };
  const entities = [{ id: 7, organizationId: 1, legalName: "Historical Co.", birTin: "123456789", birBranchCode: "0001" }, { id: 8, organizationId: 1, legalName: "New employer", birTin: "987654321", birBranchCode: "0002" }];
  const input = { organizationId: 1, snapshot: { sourceFingerprint: { employeeLegalEntityId: 7 } }, entities, legacy };
  assert.deepEqual(historical2316Employer(input), { ok: true, name: "Historical Co.", tin: "123456789-0001", legalEntityId: 7 });
  for (const change of [{ organizationId: 2 }, { entities: [entities[1]] }, { snapshot: {} }, { snapshot: { sourceFingerprint: { employeeLegalEntityId: null } } }, { entities: [{ ...entities[0], birBranchCode: "" }] }]) assert.equal(historical2316Employer({ ...input, ...change }).ok, false);
  assert.equal(historical2316Employer({ ...input, entities: [], snapshot: { sourceFingerprint: { employeeLegalEntityId: null } } }).ok, true);
});
test("actual prescribed template output has all mapped values and leaves signature fields untouched", async () => {
  const bytes = await render2316CertificatePdf(certificateSource, certificateReview());
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1); assert.equal(pdf.getPage(0).getWidth(), 612); assert.equal(pdf.getPage(0).getHeight(), 936);
  assert.equal(pdf.getForm().getFields().length, 0, "original template has no AcroForm; do not invent certified fields");
  const contents = pdf.getPage(0).node.Contents();
  assert.ok(contents && "size" in contents);
  let operations = "";
  for (let i = 0; i < contents.size(); i++) { const stream = pdf.context.lookup(contents.get(i)); if (stream instanceof PDFRawStream) operations += Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1"); }
  for (const value of ["Santos, Maria", "Synthetic Employer Co.", "500,000.00", "100,000.00", "5,000.00", "DRAFT - UNSIGNED"]) assert.ok(operations.toUpperCase().includes(Buffer.from(value, "latin1").toString("hex").toUpperCase()), value + " must be painted in PDF content");
  assert.match(pdf.getTitle()!, /Unsigned/);
  if (process.env.BIR_2316_PDF_QA === "true") { await mkdir("qa-artifacts/bir-1604c", { recursive: true }); await writeFile("qa-artifacts/bir-1604c/2316-unsigned-synthetic.pdf", bytes); }
  await assert.rejects(render2316CertificatePdf(certificateSource, {}), /REVIEW_INCOMPLETE/);
});
