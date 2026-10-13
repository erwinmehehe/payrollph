import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FirstPayrollReadinessCard } from "../src/components/workspace/first-payroll-readiness";
import { buildFirstPayrollReadiness } from "../src/lib/first-payroll-readiness";
import { FIRST_PAYROLL_STEPS, buildFirstPayrollJourney } from "../src/lib/first-payroll-journey";

const base = { workspaceName: "Pilot Employer", employees: [{ status: "Active", bankAccount: "enc:v1:fixture", bankCode: "BPI" }], memberships: [{ role: "payroll" }, { role: "checker" }] };

test("new employer sees one ordered guided journey without false readiness", () => {
  const readiness = buildFirstPayrollReadiness({ workspaceName: "P", employees: [], memberships: [], payrollStatuses: [] });
  const steps = buildFirstPayrollJourney(readiness);
  assert.deepEqual(steps.map((step) => step.key), ["company", "people", "time", "reviewers", "payroll", "approval", "exports"]);
  assert.equal(steps.find((step) => step.key === "time")?.state, "upcoming");
  assert.equal(steps.find((step) => step.key === "payroll")?.state, "upcoming");
  assert.equal(steps.find((step) => step.key === "exports")?.state, "upcoming");
});

test("setup complete is not evidence that attendance was reviewed or release approved", () => {
  const steps = buildFirstPayrollJourney(buildFirstPayrollReadiness({ ...base, payrollStatuses: [] }));
  assert.equal(steps.find((step) => step.key === "people")?.state, "complete");
  assert.equal(steps.find((step) => step.key === "time")?.state, "review");
  assert.equal(steps.find((step) => step.key === "payroll")?.state, "available");
  assert.equal(steps.find((step) => step.key === "approval")?.state, "upcoming");
});

test("an in-progress run still requires independent review; released run still requires filing evidence", () => {
  const inProgress = buildFirstPayrollJourney(buildFirstPayrollReadiness({ ...base, payrollStatuses: ["Draft"] }));
  assert.equal(inProgress.find((step) => step.key === "approval")?.state, "review");
  assert.equal(inProgress.find((step) => step.key === "exports")?.state, "upcoming");
  const released = buildFirstPayrollJourney(buildFirstPayrollReadiness({ ...base, payrollStatuses: ["Released"] }));
  assert.equal(released.find((step) => step.key === "payroll")?.state, "complete");
  assert.equal(released.find((step) => step.key === "exports")?.state, "review");
});
test("settings destinations do not confuse employer data with reviewer membership setup", () => {
  const steps = buildFirstPayrollJourney(buildFirstPayrollReadiness({ ...base, payrollStatuses: [] }));
  assert.equal(steps.find((step) => step.key === "company")?.settingsTab, "organization");
  assert.equal(steps.find((step) => step.key === "reviewers")?.settingsTab, "team");
});

test("the first released payroll still presents the export handoff before ongoing runs begin", () => {
  const first = buildFirstPayrollReadiness({ ...base, payrollStatuses: ["Released"] });
  const later = buildFirstPayrollReadiness({ ...base, payrollStatuses: ["Released", "Draft"] });
  assert.equal(first.payrollRunCount, 1);
  assert.equal(later.payrollRunCount, 2);
  assert.equal(buildFirstPayrollJourney(first).find((step) => step.key === "exports")?.state, "review");
  const props = { readiness: first, guided: true, allowedPages: ["Payroll", "Exports"], onPage: () => {}, onNewRun: () => {} };
  assert.match(renderToStaticMarkup(createElement(FirstPayrollReadinessCard, props)), /Open exports/);
  assert.equal(renderToStaticMarkup(createElement(FirstPayrollReadinessCard, { ...props, readiness: later })), "");
});

test("self-serve owners receive a single guided journey without duplicate setup tiles", () => {
  const readiness = buildFirstPayrollReadiness({ ...base, payrollStatuses: [] });
  const props = {
    readiness, allowedPages: ["Settings", "People", "Time & attendance", "Payroll", "Approvals", "Exports"],
    onPage: () => {}, onNewRun: () => {},
  };
  const guided = renderToStaticMarkup(createElement(FirstPayrollReadinessCard, { ...props, guided: true }));
  const legacy = renderToStaticMarkup(createElement(FirstPayrollReadinessCard, { ...props, guided: false }));
  assert.match(guided, /Guided first payroll journey/);
  assert.doesNotMatch(guided, /class="first-payroll-grid"/);
  assert.match(legacy, /class="first-payroll-grid"/);
  assert.doesNotMatch(legacy, /Guided first payroll journey/);
  assert.equal(guided.includes("first-payroll-grid"), false);
  assert.equal(legacy.includes("first-payroll-grid"), true);
});

test("seven canonical journey steps own role handoff metadata, not duplicated component arrays",()=>{
  const keys=FIRST_PAYROLL_STEPS.map(x=>x.key);
  assert.deepEqual(keys,["company","people","time","reviewers","payroll","approval","exports"]);
  assert.deepEqual(new Set(keys).size,7);
  assert.equal(FIRST_PAYROLL_STEPS.find(x=>x.key==="time")?.owner,"hr");
  const journey = buildFirstPayrollJourney(buildFirstPayrollReadiness({ ...base, payrollStatuses: [] }));
  assert.deepEqual(journey.map(step => step.key), keys);
});
