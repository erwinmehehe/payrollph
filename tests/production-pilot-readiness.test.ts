import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { INVITABLE_ROLES, isInvitableRole } from "../src/lib/roles";
import { buildFirstPayrollReadiness } from "../src/lib/first-payroll-readiness";

const read = (path: string) => readFileSync(path, "utf8");

test("real workspaces can provision payroll and checker roles", () => {
  assert.equal(isInvitableRole("payroll"), true);
  assert.equal(isInvitableRole("checker"), true);
  assert.equal(isInvitableRole("unknown"), false);
  const ids = INVITABLE_ROLES.map((role) => role.id);
  assert.ok(ids.includes("owner"));
  assert.ok(ids.includes("hr"));
  assert.ok(ids.includes("payroll"));
  assert.ok(ids.includes("checker"));
  assert.ok(ids.includes("employee"));

  const invitations = read("src/app/api/invitations/route.ts");
  assert.ok(invitations.includes("isInvitableRole(role)"));
  assert.ok(!invitations.includes('["owner", "admin", "hr", "bookkeeper", "employee"].includes'));
  assert.ok(invitations.includes("members: memberRows"));
});

test("owners have a real team access surface for maker-checker staffing", () => {
  const settings = read("src/components/workspace/panels.tsx");
  assert.ok(settings.includes('label: "Team & access"'));
  assert.ok(settings.includes("<TeamAccessSettings"));
  assert.ok(settings.includes("INVITABLE_ROLES.map"));
  assert.ok(settings.includes("Payroll Officer prepares and submits payroll"));
  assert.ok(settings.includes("Checker independently reviews it"));
});

test("real employee payout details are captured and encrypted", () => {
  const api = read("src/app/api/employees/route.ts");
  const hire = read("src/components/new-hire-modal.tsx");
  const people = read("src/components/workspace/people.tsx");

  assert.ok(api.includes("encryptBankAccount(bankAccount)"));
  assert.ok(api.includes("maskBankAccount(created.bankAccount)"));
  assert.ok(api.includes("Employee payout details updated"));
  assert.ok(api.includes("Bank account and bank code must be provided together"));
  assert.ok(hire.includes('bankAccount: ""'));
  assert.ok(hire.includes('bankCode: ""'));
  assert.ok(hire.includes("encrypted at rest"));
  assert.ok(people.includes("PAYOUT DETAILS"));
  assert.ok(people.includes("Submit payout change"));
  assert.ok(people.includes("replacementBankAccount"));
});

test("fresh tenant pilot stays out of demo provisioning and proves the five handoff stages", () => {
  const pilot = read("scripts/pilot-payroll-qa.ts");
  const workflow = read(".github/workflows/pilot-payroll-qa.yml");

  assert.ok(pilot.includes('tenant: "fresh-non-demo"'));
  assert.ok(pilot.includes("payroll-submitted-by-payroll-officer"));
  assert.ok(pilot.includes("payroll-approved-by-independent-checker"));
  assert.ok(pilot.includes("owner-released-payroll"));
  assert.ok(pilot.includes("paymongo-preflight-fails-closed-without-provider-credentials"));
  assert.ok(pilot.includes("employee-payslip-available"));
  assert.ok(pilot.includes("advanced-wfm-schedules-assigned"));
  assert.ok(pilot.includes("wfm-attendance-exception-owned-with-sla"));
  assert.ok(pilot.includes("wfm-self-service-schedule-scoped"));
  assert.ok(pilot.includes("wfm-self-service-correction-requested"));
  assert.ok(pilot.includes("/api/self/workforce"));
  assert.ok(pilot.includes("wfm-attendance-correction-approved-four-eyes"));
  assert.ok(pilot.includes("wfm-attendance-exception-resolution-evidence-recorded"));
  assert.ok(pilot.includes("wfm-schedule-evidence-reconciled-into-payroll"));
  assert.ok(pilot.includes("/api/workforce/attendance-exception-events"));
  assert.ok(pilot.includes("exceptionOwnerUserId"));
  assert.ok(pilot.includes("exceptionResolutionRecordedAt"));
  assert.ok(pilot.includes('trace?.workforceSchedule?.mode'));
  assert.ok(pilot.includes('"calendar-segmented"'));
  assert.ok(pilot.includes("isEncryptedBankAccount"));
  assert.ok(workflow.includes('DEMO_MODE: "false"'));
  assert.ok(workflow.includes("scripts/pilot-payroll-qa.ts"));
  assert.ok(workflow.includes('"src/lib/workforce-**"'));
  assert.ok(workflow.includes('"src/app/api/workforce/**"'));
  assert.ok(workflow.includes('"tests/workforce-*.test.ts"'));
});


test("production rollout verifier requires protected live readiness and critical pilot gates", () => {
  const script = read("scripts/live-production-readiness.ts");
  const workflow = read(".github/workflows/production-rollout-readiness.yml");

  assert.ok(script.includes('unauthenticated.status'));
  assert.ok(script.includes('PRODUCTION_READINESS_TOKEN'));
  assert.ok(script.includes('"production-security-config"'));
  assert.ok(script.includes('"seeded-credentials"'));
  assert.ok(script.includes('"email-delivery"'));
  assert.ok(script.includes('"bank-data-encryption"'));
  assert.ok(script.includes('"government-id-encryption"'));
  assert.ok(script.includes('"malware-scanning"'));
  assert.ok(script.includes('payload.manualLaunch?.ready'));
  assert.ok(script.includes('payload.status'));
  assert.ok(workflow.includes('workflow_dispatch'));
  assert.ok(workflow.includes('secrets.PRODUCTION_READINESS_TOKEN'));
  assert.ok(workflow.includes('rollout_mode'));
  assert.ok(workflow.includes('scripts/live-production-readiness.ts'));
  assert.ok(script.includes("blockerRemediation"));
  assert.ok(script.includes("remediationSummary"));
  assert.ok(script.includes("Production Bank Encryption"));
  assert.ok(script.includes("encrypt-government-ids.ts"));
  assert.ok(script.includes("provider-delivered event"));
});

test("manual launch playbook matches evidence-based production gates", () => {
  const playbook = read("MANUAL_LAUNCH.md");

  assert.ok(playbook.includes("Clear the critical production gates first"));
  assert.ok(playbook.includes("APP_BASE_URL"));
  assert.ok(playbook.includes("TOTP_ENCRYPTION_KEY"));
  assert.ok(playbook.includes("Production Bank Encryption"));
  assert.ok(playbook.includes("RESEND_WEBHOOK_SECRET"));
  assert.ok(playbook.includes("/api/webhooks/resend"));
  assert.ok(playbook.includes("provider reports the message as delivered"));
  assert.ok(!playbook.includes("Set `RESEND_API_KEY` in your environment and redeploy.\n5. Confirm"));
});


test("first payroll readiness is computed from real workspace state", () => {
  const readiness = read("src/lib/first-payroll-readiness.ts");
  const dashboard = read("src/lib/dashboard-data.ts");
  const workspace = read("src/components/linaw-workspace.tsx");

  assert.ok(readiness.includes('"payroll-officer"'));
  assert.ok(readiness.includes('"checker"'));
  assert.ok(readiness.includes('"payout"'));
  assert.ok(readiness.includes('employee.bankAccount?.trim()'));
  assert.ok(readiness.includes('employee.bankCode?.trim()'));
  assert.ok(dashboard.includes("buildFirstPayrollReadiness"));
  assert.ok(dashboard.includes("userOrganizations.role"));
  assert.ok(workspace.includes("<FirstPayrollReadinessCard"));
  assert.ok(workspace.includes('onNewRun={() => setNewPayrollOpen(true)}'));
});

test("payroll creation fails closed when active employee payout details are incomplete", () => {
  const route = read("src/app/api/payroll-runs/route.ts");
  assert.ok(route.includes('"PAYOUT_DETAILS_REQUIRED"'));
  assert.ok(route.includes("missingEmployeeIds"));
  assert.ok(route.includes("Complete payout details before starting payroll"));
});


test("first payroll readiness only turns green when all operational prerequisites exist", () => {
  const blocked = buildFirstPayrollReadiness({
    workspaceName: "Acme Philippines Inc.",
    employees: [{ status: "Active", bankAccount: null, bankCode: null }],
    memberships: [{ role: "owner" }],
    payrollStatuses: [],
  });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.employeesMissingPayout, 1);
  assert.equal(blocked.payrollOfficerCount, 0);
  assert.equal(blocked.checkerCount, 0);

  const ready = buildFirstPayrollReadiness({
    workspaceName: "Acme Philippines Inc.",
    employees: [{ status: "Active", bankAccount: "enc:v1:test", bankCode: "BPI" }],
    memberships: [{ role: "owner" }, { role: "payroll" }, { role: "checker" }],
    payrollStatuses: [],
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.completed, ready.total);
});


test("sanitized pilot readiness can prove production without duplicating the readiness secret into CI", () => {
  const route = read("src/app/api/readiness/pilot-status/route.ts");
  const script = read("scripts/live-production-readiness.ts");

  assert.ok(route.includes('import { buildReadinessPayload }'));
  assert.ok(route.includes('await buildReadinessPayload()'));
  assert.ok(route.includes('"Cache-Control": "no-store"'));
  assert.ok(route.includes("criticalBlockers"));
  assert.ok(route.includes("pilotReady"));
  assert.ok(route.includes("fullLaunchReady"));
  assert.ok(script.includes("/api/readiness/pilot-status"));
  assert.ok(script.includes('source: "server-internal-sanitized"'));
  assert.ok(script.includes("token.length >= 24"));
  assert.ok(script.includes("unauthenticated.status"));
});


test("optional operator endpoints stay protected without blocking a controlled pilot", () => {
  const readiness = read("src/app/api/readiness/route.ts");
  const jobs = read("src/app/api/jobs/tick/route.ts");
  const preflight = read("scripts/security-preflight.ts");

  assert.ok(readiness.includes('key: "readiness-diagnostics-token"'));
  assert.ok(readiness.includes('key: "remote-scheduler-token"'));
  assert.ok(readiness.includes('blocks: "scale"'));
  assert.ok(readiness.includes('configured("TOTP_ENCRYPTION_KEY")'));
  assert.ok(jobs.includes('operationalSecret("worker")'));
  assert.ok(jobs.includes("constantTimeSecretEqual"));
  assert.ok(preflight.includes('operationalSecretSource("worker")'));
  assert.ok(preflight.includes('operationalSecretSource("readiness")'));
});


test("production pilot sign-off verifies independent figures server-side instead of trusting checkboxes", () => {
  const route = read("src/app/api/payroll-runs/[id]/pilot-signoff/route.ts");
  const card = read("src/components/workspace/production-pilot-signoff.tsx");
  const bankProof = read("src/lib/pilot-bank-dry-run-evidence.ts");

  assert.ok(route.includes("figuresFromEntries"), "server must derive reconciliation totals from stored payroll entries");
  assert.ok(route.includes('new Set(["WHT"])'), "server must independently total withholding tax");
  assert.ok(route.includes('new Set(["SSS", "PHIC", "HDMF"])'), "server must independently total statutory contributions");
  assert.ok(route.includes("Math.abs(variance) > 0.01"), "money reconciliation must fail outside one-cent tolerance");
  assert.ok(route.includes('mismatches.push("employeeCount")'), "employee count must match exactly");
  assert.ok(route.includes("independentSourceConfirmed"), "sign-off must confirm figures came from an independent source");
  assert.ok(route.includes("employeeLevelReconciliationConfirmed"), "human independent reviewer must attest to per-employee reconciliation");
  assert.ok(route.includes("reconciliationReportSha256"), "signoff must link to a private independently reviewed reconciliation report");
  assert.ok(route.includes("reconciledEmployeeCount !== entries.length"), "signoff must block a partial employee population");
  assert.ok(route.includes("isValidPilotBankDryRunEvidence"), "pilot signoff must validate audited bank preview evidence server-side");
  assert.ok(bankProof.includes('event.action !== "Bank file dry-run generated"'), "only preview events can count as no-money proof");
  assert.ok(route.includes("!payoutCompleted && !dryRunBankExport"), "sign-off must require either completed payout proof or no-money bank export");
  assert.ok(bankProof.includes("exportedAt < releaseTime"), "no-money preview must be generated after payroll release");
  assert.ok(bankProof.includes("meta.bankExportMissingDestinations !== 0"), "bank preview cannot have missing or nullable payout destinations");
  assert.ok(bankProof.includes("meta.bankExportMissingPaymentSnapshots !== 0"), "bank preview must use immutable payroll payment snapshots");
  assert.ok(bankProof.includes("meta.bankExportMissingIdentitySnapshots !== 0"), "bank preview must use immutable identity snapshots");
  assert.ok(bankProof.includes("meta.bankExportRowCount !== expected.employeeCount"), "bank preview roster must match released employee count");
  assert.ok(bankProof.includes("nonNegativeCents(meta.bankExportTotalNet) !== expectedCents"), "preview sum must match released net pay in cents");
  assert.ok(route.includes("bankExportSha256"), "no-money preview must have a recorded SHA-256 integrity hash");
  const exportRoute = read("src/app/api/payroll-runs/[id]/exports/route.ts");
  assert.ok(exportRoute.includes('createHash("sha256").update(file.body)'));
  assert.ok(exportRoute.includes("bankExportMissingDestinations"));
  assert.ok(exportRoute.includes("bankExportMissingIdentitySnapshots"));
  assert.ok(exportRoute.includes("bankExportSyntheticDemoDestinations"));
  assert.ok(route.includes("independentFigures"), "audit evidence must preserve the submitted independent totals");
  assert.ok(route.includes("verifiedFigures"), "audit evidence must preserve the server-derived totals");
  assert.ok(route.includes("reconciliationVariances"), "audit evidence must preserve reconciliation variances");
  assert.ok(!route.includes("REQUIRED_CHECKS"), "server must not accept checkbox-only reconciliation");
  assert.ok(card.includes("INDEPENDENT FIGURES"), "owner UI must collect the external reconciliation totals");
  assert.ok(card.includes("employeeLevelReconciliationConfirmed"), "owner UI must require employee-level reconciliation attestation");
  assert.ok(card.includes("setSelectedRunId"), "owner must choose the actual released run to sign off");
  assert.ok(card.includes("setEvidenceReference(\"\")"), "switching runs must clear prior evidence references");
  assert.ok(card.includes("setIndependentSourceConfirmed(false)"), "switching runs must reset the independent reviewer attestation");
  assert.ok(card.includes("A recorded bank-file dry-run"), "owner UI must disclose no-money bank-file sign-off path");
  assert.ok(card.includes("Verify figures & sign off pilot"), "owner UI must make server verification explicit");
  assert.ok(!card.includes("matches the independently prepared expected result"), "old trust-me match toggles must be removed");
});


test("a no-money payroll pilot cannot silently clear the broad-launch production gate", () => {
  const readiness = read("src/app/api/readiness/route.ts");
  const signoff = read("src/app/api/payroll-runs/[id]/pilot-signoff/route.ts");
  const card = read("src/components/workspace/production-pilot-signoff.tsx");

  assert.ok(readiness.includes("->> 'payoutEvidenceMode' = 'completed-payout'"),
    "the GA signoff gate must require separately recorded completed-payout evidence");
  assert.ok(readiness.includes("->> 'payoutEvidenceMode' = 'no-money-bank-file-dry-run'"),
    "no-money reconciliations must be counted separately");
  assert.ok(readiness.includes("Bank-file previews do not prove settlement"),
    "launch readiness must explicitly disclose that a preview cannot satisfy settlement");
  assert.ok(signoff.includes('payoutEvidenceMode: payoutCompleted ? "completed-payout" : "no-money-bank-file-dry-run"'),
    "signoff must record the real evidence mode, never infer money movement from a dry run");
  assert.ok(signoff.includes('metadata.payoutEvidenceMode === "completed-payout"'),
    "a no-money record may be upgraded only after the completed-payout path is separately verified");
  assert.ok(card.includes("No-money payroll pilot reconciled"),
    "the Owner UI must not call a no-money preview an externally paid pilot");
  assert.ok(card.includes("Record completed-payout evidence"),
    "the Owner must be able to provide a separate reviewed settlement attestation later");
});
