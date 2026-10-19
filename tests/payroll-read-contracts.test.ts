import assert from "node:assert/strict";
import test from "node:test";
import {
  isVerifiedAssuranceRead,
  isVerifiedReleaseChecklist,
  type PayrollReadScope,
} from "../src/lib/payroll-read-contracts";

const scope: PayrollReadScope = { organizationId: 41, legalEntityId: 7, runId: 93 };
const keys = ["inputs", "attendance", "calculation", "exceptions", "statutory", "approval", "bank"];

function checklist() {
  return {
    ...scope,
    ready: true,
    approvalStatus: "Approved",
    items: keys.map((key) => ({
      key, label: key, detail: "Independently checked", passed: true, blocking: true,
    })),
    assuranceSummary: {
      high: 0, medium: 0, info: 0, blocking: 0, materialChanges: 0, comparedEmployees: 0,
    },
    assuranceFindings: [],
  };
}

const breakdown = {
  gross: 100, sss: 0, philHealth: 0, pagIbig: 0, withholdingTax: 0,
  otherDeductions: 0, net: 100,
};

function assurance() {
  return {
    ...scope,
    previousRun: null,
    summary: {
      high: 0, medium: 0, info: 0, blocking: 0, materialChanges: 0, comparedEmployees: 0,
    },
    findings: [],
    comparisons: [{
      employeeId: 11, currentGross: 100, previousGross: null, grossDelta: null,
      currentNet: 100, previousNet: null, netDelta: null, netPercent: null,
      currentDeductions: 0, previousDeductions: null,
      currentComponents: { ...breakdown }, previousComponents: null,
      lineChanges: [], hasMaterialChange: false,
    }],
  };
}

test("release checklist accepts complete tenant-owned 7/8-key evidence", () => {
  const value = checklist();
  assert.equal(isVerifiedReleaseChecklist(value, scope), true);
  value.items.push({ key: "connected", label: "HRIS and WFM", detail: "Verified", passed: true, blocking: true });
  assert.equal(isVerifiedReleaseChecklist(value, scope), true);
});

test("release checklist rejects missing, wrong-employer and duplicate evidence", () => {
  const value = checklist();
  for (const override of [
    { organizationId: 42 }, { legalEntityId: 99 }, { runId: 94 },
    { organizationId: undefined }, { legalEntityId: undefined }, { runId: undefined },
    { items: [] }, { items: value.items.slice(1) },
    { items: [...value.items, value.items[0]] },
    { items: value.items.map((item, index) => index === 2 ? { ...item, label: "" } : item) },
    { items: value.items.map((item, index) => index === 2 ? { ...item, blocking: "no" } : item) },
    { items: value.items.map((item, index) => index === 2 ? { ...item, key: "unexpected" } : item) },
    { ready: "true" }, { approvalStatus: null },
    { assuranceSummary: {} }, { assuranceFindings: null },
    { assuranceFindings: [{ code: "BAD", severity: "high", blocking: true, title: "Bad", detail: "Bad", employeeId: 19 }] },
  ]) {
    assert.equal(isVerifiedReleaseChecklist({ ...value, ...override }, scope), false, JSON.stringify(override));
  }
});

test("release-checklist readiness must match required blocking items, never partial successes", () => {
  const value = checklist();
  const incomplete = {
    ...value, ready: true,
    items: value.items.map((item, index) => index === 3 ? { ...item, passed: false } : item),
  };
  assert.equal(isVerifiedReleaseChecklist(incomplete, scope), false);
  assert.equal(isVerifiedReleaseChecklist({ ...incomplete, ready: false }, scope), true);
  assert.equal(isVerifiedReleaseChecklist({ ...value, ready: false }, scope), false);
  assert.equal(isVerifiedReleaseChecklist({ ...value, items: value.items.map((item) => ({ ...item, blocking: false })) }, scope), false);
});

test("assurance permits verified first payroll but rejects false-zero, stale, partial and duplicate results", () => {
  const value = assurance();
  assert.equal(isVerifiedAssuranceRead(value, scope), true);
  for (const override of [
    { organizationId: 42 }, { legalEntityId: null }, { runId: 94 },
    { summary: { ...value.summary, blocking: 2 } },
    { findings: null }, { comparisons: undefined }, { summary: {} },
    { comparisons: [{ ...value.comparisons[0], currentNet: "100" }] },
    { comparisons: [{ ...value.comparisons[0], currentNet: Number.NaN }] },
    { comparisons: [{ ...value.comparisons[0], previousComponents: {} }] },
    { comparisons: [...value.comparisons, value.comparisons[0]] },
    { findings: [{ code: "BLOCK", severity: "high", blocking: true, title: "Blocked", detail: "Bad" }] },
    { findings: [{ code: "BLOCK", severity: "high", blocking: true, title: "Blocked", detail: "Bad", current: Infinity }] },
  ]) {
    assert.equal(isVerifiedAssuranceRead({ ...value, ...override }, scope), false, JSON.stringify(override));
  }
});

test("real blocking assurance results require internally consistent summary and row detail", () => {
  const value = assurance();
  const blocked = {
    ...value,
    summary: { ...value.summary, high: 1, blocking: 1 },
    findings: [{ code: "MANDATORY_SHORTFALL", severity: "high", blocking: true, title: "Uncollected", detail: "Must reconcile", employeeId: 11 }],
  };
  assert.equal(isVerifiedAssuranceRead(blocked, scope), true);
  assert.equal(isVerifiedAssuranceRead({ ...blocked, summary: value.summary }, scope), false);
  assert.equal(isVerifiedAssuranceRead({
    ...blocked, comparisons: [{ ...value.comparisons[0], lineChanges: [{ code: "BASIC", label: "Basic", delta: 100 }] }],
  }, scope), false);
});

test("unscoped legacy payroll-read responses are not acceptable", () => {
  const withoutIdentity = ({ runId: _runId, organizationId: _org, legalEntityId: _entity, ...fields }: Record<string, unknown>) => fields;
  assert.equal(isVerifiedReleaseChecklist(withoutIdentity(checklist()), scope), false);
  assert.equal(isVerifiedAssuranceRead(withoutIdentity(assurance()), scope), false);
});
