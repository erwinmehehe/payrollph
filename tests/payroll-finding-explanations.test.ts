import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AssuranceFinding } from "../src/lib/payroll-assurance";
import { automationModelAllowedForOrganization } from "../src/lib/automation-model-consent";
import {
  generatePayrollFindingExplanation,
  payrollExplanationAccess,
  PAYROLL_FINDING_EXPLANATION_TEMPLATES,
} from "../src/lib/payroll-finding-explanations";
import {
  CRITICAL_RELEASE_FLAGS, criticalReleaseFlagEnabled,
} from "../src/lib/critical-release-flags";

const syntheticConsent = {
  PAYROLL_EXPLANATION_AI_ENABLED: "true",
  OPENAI_AUTOMATION_DRAFT_ENABLED: "true",
  OPENAI_API_KEY: "synthetic-never-used-placeholder",
  OPENAI_AUTOMATION_DPA_CONFIRMED: "true",
  OPENAI_AUTOMATION_ZERO_RETENTION_CONFIRMED: "true",
  OPENAI_AUTOMATION_NOTICE_CONFIRMED: "true",
  OPENAI_AUTOMATION_APPROVED_ORG_IDS: "17,29",
} as const;

function finding(code: string, blocking: boolean, extra: Partial<AssuranceFinding> = {}): AssuranceFinding {
  return {
    code, blocking, severity: blocking ? "high" : "medium",
    title: "Fictional Private Employee DONT-ECHO",
    detail: "Synthetic employee account 9988776655, raw confidential details not for explanation",
    employeeId: 81234567,
    current: 1234567,
    ...extra,
  };
}

test("Privacy owns a default-off explanation flag with the exact openAiDrafts approval", () => {
  const control = CRITICAL_RELEASE_FLAGS.payrollExplanationAi;
  assert.equal(control.env, "PAYROLL_EXPLANATION_AI_ENABLED");
  assert.equal(control.owner, "Privacy");
  assert.equal(control.approval, CRITICAL_RELEASE_FLAGS.openAiDrafts.approval);
  for (const value of [undefined, "", "TRUE", "1", "false", "on"]) {
    assert.equal(criticalReleaseFlagEnabled("payrollExplanationAi",
      { PAYROLL_EXPLANATION_AI_ENABLED: value }), false);
  }
  assert.equal(criticalReleaseFlagEnabled("payrollExplanationAi",
    { PAYROLL_EXPLANATION_AI_ENABLED: "true" }), true);
});

test("flag-off has no explanation authorization even when the old model consent is present", () => {
  assert.equal(automationModelAllowedForOrganization(17, syntheticConsent), true);
  for (const flag of [undefined, "false", "TRUE", "1", ""]) {
    assert.equal(payrollExplanationAccess(17, {
      ...syntheticConsent, PAYROLL_EXPLANATION_AI_ENABLED: flag,
    }), "disabled");
  }
  const endpoint = readFileSync("src/app/api/payroll-runs/[id]/pre-run-readiness/route.ts", "utf8");
  const off = endpoint.indexOf('if (!criticalReleaseFlagEnabled("payrollExplanationAi"))');
  const consent = endpoint.indexOf("payrollExplanationAccess(run.organizationId)");
  const assurance = endpoint.indexOf("await buildPayrollAssurance(run.id)");
  assert.ok(off > 0 && off < consent && consent < assurance);
  assert.ok(endpoint.includes('new URL(request.url).searchParams.get("explain") !== "true"'));
  assert.ok(endpoint.indexOf('process.env.PAYROLL_EXPLANATION_AI_ENABLED !== "true"')
    < endpoint.indexOf('new URL(request.url).searchParams.get("explain")'),
    "default OFF must exit before parsing an opt-in request");
  assert.ok(endpoint.indexOf('process.env.PAYROLL_EXPLANATION_AI_ENABLED !== "true"') < off,
    "default OFF must not dynamically import explanation modules");
  assert.ok(endpoint.includes("return Response.json(readiness, {"),
    "flag-off continues to return the same phase-1 payload, not a decorated replacement");
  assert.ok(endpoint.includes("requireRunEmployer({"));
  assert.ok(endpoint.indexOf("if (employerDenied) return employerDenied;") < off);
});

test("per-tenant consent, DPA, retention, notice and key requirements reuse the existing gate", () => {
  assert.equal(payrollExplanationAccess(17, syntheticConsent), "allowed");
  assert.equal(payrollExplanationAccess(29, syntheticConsent), "allowed");
  for (const orgId of [0, -7, 999, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(payrollExplanationAccess(orgId, syntheticConsent), "consent-required");
  }
  for (const missing of [
    "OPENAI_AUTOMATION_DRAFT_ENABLED",
    "OPENAI_API_KEY",
    "OPENAI_AUTOMATION_DPA_CONFIRMED",
    "OPENAI_AUTOMATION_ZERO_RETENTION_CONFIRMED",
    "OPENAI_AUTOMATION_NOTICE_CONFIRMED",
    "OPENAI_AUTOMATION_APPROVED_ORG_IDS",
  ] as const) {
    const env: Record<string, string | undefined> = { ...syntheticConsent, [missing]: undefined };
    assert.equal(automationModelAllowedForOrganization(17, env), false, missing);
    assert.equal(payrollExplanationAccess(17, env), "consent-required", missing);
  }
  const endpoint = readFileSync("src/app/api/payroll-runs/[id]/pre-run-readiness/route.ts", "utf8");
  assert.ok(endpoint.includes('error: "PAYROLL_EXPLANATION_CONSENT_REQUIRED"'));
  assert.ok(endpoint.includes("status: 403"));
});

test("explanations use only source finding codes and blocking booleans, not employee details or amounts", () => {
  const originals = [
    finding("PRERUN_ATTENDANCE_MISSING", true),
    finding("MISSING_STATUTORY", false),
    finding("MISSING_BANK_DETAILS", true),
    finding("PRERUN_ATTENDANCE_MISSING", true),
  ];
  const snapshot = structuredClone(originals);
  const explanation = generatePayrollFindingExplanation(originals);
  assert.deepEqual(originals, snapshot, "explanations must not mutate any underlying finding");
  assert.match(explanation, /What's blocking: PRERUN_ATTENDANCE_MISSING, MISSING_BANK_DETAILS/);
  assert.match(explanation, /Why:/);
  assert.match(explanation, /Next:/);
  const references = [...explanation.matchAll(/\[([A-Z0-9_]+)\]/g)].map(match => match[1]);
  assert.deepEqual(references, ["PRERUN_ATTENDANCE_MISSING", "MISSING_STATUTORY", "MISSING_BANK_DETAILS"]);
  for (const privateValue of ["DONT-ECHO", "9988776655", "81234567", "1234567"]) {
    assert.ok(!explanation.includes(privateValue), "private field leaked to rendered explanation: " + privateValue);
  }
  assert.match(explanation, /This is not a payroll approval|approval gates remain authoritative/);
});

test("review-only findings never become new blockers and empty findings do not imply readiness", () => {
  const review = generatePayrollFindingExplanation([
    finding("MISSING_STATUTORY", false),
    finding("NO_PRIOR_PAYROLL", false, { severity: "info" }),
  ]);
  assert.match(review, /No supplied finding is marked blocking/);
  assert.match(review, /can be valid for a zero or excluded contribution/);
  assert.ok(!review.includes("marked blocking by existing findings"));
  const empty = generatePayrollFindingExplanation([]);
  assert.match(empty, /No pre-run or assurance findings were supplied/);
  assert.match(empty, /not a payroll approval/);
});

test("unknown valid source code stays an unmapped source finding; invalid code fails closed", () => {
  const unknown = generatePayrollFindingExplanation([finding("SYNTHETIC_UNMAPPED_CODE", false)]);
  assert.ok(unknown.includes("[SYNTHETIC_UNMAPPED_CODE]"));
  assert.ok(unknown.includes("not mapped to a template"));
  assert.doesNotMatch(unknown, /SYNTHETIC_ADDITIONAL_FINDING/);
  assert.throws(() => generatePayrollFindingExplanation([finding("PRERUN_PRIVATE\nINJECTED", true)]),
    /PAYROLL_EXPLANATION_INVALID_SOURCE_CODE/);
});

test("all and only current pre-run plus assurance codes have deterministic templates", () => {
  const preRun = readFileSync("src/lib/payroll-pre-run-readiness.ts", "utf8");
  const assurance = readFileSync("src/lib/payroll-assurance.ts", "utf8");
  const server = readFileSync("src/lib/payroll-assurance-server.ts", "utf8");
  const sourceCodes = new Set([
    ...[...preRun.matchAll(/"(PRERUN_[A-Z0-9_]+)"/g)].map(match => match[1]),
    ...[...assurance.matchAll(/code:\s*"([A-Z0-9_]+)"/g)].map(match => match[1]),
    ...[...server.matchAll(/code:\s*"([A-Z0-9_]+)"/g)].map(match => match[1]),
  ]);
  assert.equal(sourceCodes.size, 41);
  assert.deepEqual(new Set(Object.keys(PAYROLL_FINDING_EXPLANATION_TEMPLATES)), sourceCodes);
  for (const code of sourceCodes) {
    const block = PAYROLL_FINDING_EXPLANATION_TEMPLATES[code];
    assert.ok(block.what && block.why && block.next, code);
  }
});

test("no SDK, external request, payroll evaluator or write is introduced by explanation plumbing", () => {
  const source = readFileSync("src/lib/payroll-finding-explanations.ts", "utf8");
  const endpoint = readFileSync("src/app/api/payroll-runs/[id]/pre-run-readiness/route.ts", "utf8");
  const deps = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
  assert.ok(!Object.keys(deps.dependencies).some(key => /openai|anthropic|langchain|ai-sdk|@ai-sdk/i.test(key)));
  assert.doesNotMatch(source, /\bfetch\(|\baxios\b|new OpenAI|\.generateText\(|\.chat\.completions|\.responses\.create/);
  assert.doesNotMatch(source, /\b(?:CREATE|ALTER|DROP)\s+TABLE\b|\b(?:INSERT\s+INTO|UPDATE\s+[a-z_][a-z0-9_]*\s+SET|DELETE\s+FROM)\b/i);
  assert.ok(!endpoint.includes("evaluatePayrollPreRunReadiness("));
  assert.ok(!endpoint.includes("evaluatePayrollAssurance("));
  assert.ok(endpoint.indexOf("requireRunEmployer({") < endpoint.indexOf("generatePayrollFindingExplanation(["));
});
