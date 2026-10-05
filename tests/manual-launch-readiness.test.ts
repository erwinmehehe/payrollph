import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../src/app/api/readiness/route";

// Some launch-blocking gates (billing, bank submission, government filing)
// have a legitimate manual workaround for a pilot SME launch: manual
// invoicing via scripts/manual-activate-subscription.ts, hand-uploading the
// already-generated bank files, and manually entering the already-generated
// DRAFT government forms. Others (a live review-account password, seeded
// demo credentials, no email provider at all) do not. Those must still be
// fixed even for a manual-ops pilot. /api/readiness should say so explicitly
// rather than reporting one flat pass/fail.

test("readiness reports which launch blockers have a manual workaround", async () => {
  const response = await GET(new Request("http://localhost/api/readiness"));
  const body = await response.json();

  const billing = body.gates.find((g: { key: string }) => g.key === "billing");
  const bank = body.gates.find((g: { key: string }) => g.key === "bank-validation");
  const gov = body.gates.find((g: { key: string }) => g.key === "gov-bir-alphalist");
  const monthlyBir = body.gates.find((g: { key: string }) => g.key === "gov-bir-1601c");
  const email = body.gates.find((g: { key: string }) => g.key === "email-delivery");

  assert.ok(billing.manualWorkaround?.includes("manual-activate-subscription"));
  assert.ok(bank.manualWorkaround?.toLowerCase().includes("upload"));
  assert.ok(gov.manualWorkaround?.toLowerCase().includes("ades") || gov.manualWorkaround?.toLowerCase().includes("eafs"));
  assert.ok(monthlyBir.manualWorkaround?.includes("eBIRForms/eFPS"));
  assert.ok(monthlyBir.manualWorkaround?.toLowerCase().includes("acknowledgement"));
  // Email has no manual workaround field. An admin manually relaying reset
  // tokens is not something this readiness check should ever bless.
  assert.equal(email.manualWorkaround, undefined);

  assert.ok(typeof body.manualLaunch.ready === "boolean");
  assert.ok(typeof body.manualLaunch.summary === "string");
});
