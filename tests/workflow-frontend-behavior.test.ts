import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import { EMPTY_WORKFLOW_UI_FLAGS, resolveWorkflowUiFlags } from "../src/lib/workflow-ui-flags";
import { projectReportRows, exportProjectedReportCsv } from "../src/lib/report-builder-view";
import { loanDisplaySchedule } from "../src/lib/loan-schedule-view";
import { FirstPayrollReadinessCard } from "../src/components/workspace/first-payroll-readiness";
import { WorkflowUiProvider } from "../src/components/workspace/workflow-ui-context";
import { FaceOfflinePunchPanel } from "../src/components/workspace/face-offline-punch";
import { OfflinePunchReviewQueue } from "../src/components/workspace/offline-punch-review";
import { CareersBoard } from "../src/components/careers-board";
import type { FirstPayrollReadiness } from "../src/lib/first-payroll-readiness";

const readiness: FirstPayrollReadiness = {
  ready: false, completed: 2, total: 5, activeEmployees: 3,
  employeesMissingPayout: 1, payrollOfficerCount: 1, checkerCount: 0,
  firstPayrollStarted: false, firstPayrollReleased: false, payrollRunCount: 0,
  items: [
    { key: "workspace", label: "Company workspace", detail: "Employer set", ready: true, actionPage: "Settings", actionLabel: "Settings" },
    { key: "employees", label: "Active roster", detail: "3 workers", ready: true, actionPage: "People", actionLabel: "People" },
    { key: "payout", label: "Payout details", detail: "One worker missing bank", ready: false, actionPage: "People", actionLabel: "Payout" },
    { key: "payroll-officer", label: "Payroll maker", detail: "Maker assigned", ready: true, actionPage: "Settings", actionLabel: "Team" },
    { key: "checker", label: "Checker", detail: "No checker assigned", ready: false, actionPage: "Settings", actionLabel: "Team" },
  ],
};

test("all six remaining draft workflow UI flags are default OFF and require exact true", () => {
  const flags = {
    workflowFirstPayrollAdvisory: "FIRST_PAYROLL_INLINE_UI_ENABLED",
    faceOfflinePunch: "FACE_OFFLINE_PUNCH_UI_ENABLED",
    approvalBuilder: "APPROVAL_BUILDER_UI_ENABLED",
    reportBuilder: "REPORT_BUILDER_UI_ENABLED",
    benefitsLoans: "BENEFITS_LOANS_UI_ENABLED",
    recruitmentJourney: "RECRUITMENT_JOURNEY_UI_ENABLED",
  } as const;
  assert.ok(Object.values(EMPTY_WORKFLOW_UI_FLAGS).every(value => value === false));
  for (const [key, env] of Object.entries(flags)) {
    for (const value of [undefined,"", "false", "TRUE", "1", "true "])
      assert.equal(criticalReleaseFlagEnabled(key as keyof typeof flags, { [env]: value }), false);
    assert.equal(criticalReleaseFlagEnabled(key as keyof typeof flags, { [env]: "true" }), true);
  }
});

test("saved report selection/filters never fabricate unauthorized columns or data", () => {
  const source = { columns: ["Name","Gross","Secret"], rows: [
    ["A","100","keep"],["B","200","hidden"],
  ] };
  const projection = projectReportRows({
    ...source, selectedFields: ["Name","Gross","NotInSource"],
    filters: [{ field:"Name", operator:"equals", value:"A" }],
  });
  assert.deepEqual(projection.columns, ["Name","Gross"]);
  assert.deepEqual(projection.rows, [["A","100"]]);
  assert.deepEqual(projectReportRows({
    ...source, selectedFields:["Name"], filters:[{ field:"Unauthorized",operator:"contains",value:"x" }],
  }).rows, []);
  assert.match(exportProjectedReportCsv(["Name"],[["=cmd"]]), /"'=cmd"/);
});

test("display-only loan schedule never overpays centavos and skips pending loans", () => {
  const rows = loanDisplaySchedule({
    balance:"1000.01", installment:"333.34", startsOn:"2026-01-15",status:"active",
  });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.amount), [333.34,333.34,333.33]);
  assert.equal(rows.at(-1)?.projectedBalance, 0);
  assert.equal(loanDisplaySchedule({balance:1000,installment:200,startsOn:"2026-01-15",status:"pending_approval"}).length,0);
  assert.equal(loanDisplaySchedule({balance:10,installment:0,startsOn:"2026-01-15",status:"active"}).length,0);
});

test("flag-off first-payroll card retains the original UI and has no inline drawer", () => {
  const props = { readiness, onPage: (_:string) => {}, onNewRun: () => {},
    allowedPages: ["People","Settings","Payroll","Approvals","Exports"], guided:true };
  const legacy = renderToStaticMarkup(createElement(FirstPayrollReadinessCard, props));
  const disabled = renderToStaticMarkup(createElement(WorkflowUiProvider, {
    flags:EMPTY_WORKFLOW_UI_FLAGS,
  }, createElement(FirstPayrollReadinessCard, props)));
  assert.equal(disabled, legacy);
  assert.doesNotMatch(disabled, /data-first-payroll-inline/);
  assert.match(legacy, /Guided first payroll journey/);
});

test("unverified offline camera and reviewer queue keep explicit empty/loading states", () => {
  const camera = renderToStaticMarkup(createElement(FaceOfflinePunchPanel,{ organizationId:1,employeeId:1 }));
  assert.match(camera,/camera preview/i);
  assert.match(camera,/not face verification/i);
  const review = renderToStaticMarkup(createElement(OfflinePunchReviewQueue,{ organizationId:1 }));
  assert.match(review,/Unverified offline punch claims/);
  assert.match(review,/Loading offline claims/);
});

test("public careers displays published job card or grounded empty state", () => {
  const empty = renderToStaticMarkup(createElement(CareersBoard,{
    organizationId:1, organizationName:"Example Ltd",jobs:[],
  }));
  assert.match(empty,/No published openings/);
  const html = renderToStaticMarkup(createElement(CareersBoard,{
    organizationId:1, organizationName:"Example Ltd",
    jobs:[{id:4,title:"Payroll Analyst",department:"Finance",employmentType:"Full-time",
      description:"Work with payroll reconciliation."}],
  }));
  assert.match(html,/Payroll Analyst/);
  assert.match(html,/Apply for this role/);
  assert.doesNotMatch(html,/bank account/i);
});

test("canonical HR Requests flag remains separate from the six optional UI controls", () => {
  assert.equal(criticalReleaseFlagEnabled("employeeHrCases", { EMPLOYEE_HR_CASES_ENABLED: "true" }), true);
  assert.equal(criticalReleaseFlagEnabled("employeeHrCases", { EMPLOYEE_CASES_UI_ENABLED: "true" }), false);
  const flags = resolveWorkflowUiFlags({
    EMPLOYEE_HR_CASES_ENABLED: "true",
    EMPLOYEE_CASES_UI_ENABLED: "true",
    MULTI_ENTITY_ENABLED: "false",
  });
  assert.equal(Object.keys(flags).length, 6);
  assert.ok(Object.values(flags).every(value => value === false));
  assert.equal("employeeCases" in flags, false);
  assert.ok(Object.values(resolveWorkflowUiFlags({ MULTI_ENTITY_ENABLED: "true" })).every(value => value === false));
});
