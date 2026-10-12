import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import { EMPTY_WORKFLOW_UI_FLAGS } from "../src/lib/workflow-ui-flags";
import { firstPayrollPreview } from "../src/lib/first-payroll-preview";
import { parseEmployeeImportPreview, makeEmployeeImportErrorCsv } from "../src/lib/employee-import-preview";
import { projectReportRows, exportProjectedReportCsv } from "../src/lib/report-builder-view";
import { loanDisplaySchedule } from "../src/lib/loan-schedule-view";
import { FirstPayrollInline } from "../src/components/workspace/first-payroll-inline";
import { FirstPayrollReadinessCard } from "../src/components/workspace/first-payroll-readiness";
import { MoreModulesPage } from "../src/components/workspace/more-modules-page";
import { WorkflowUiProvider } from "../src/components/workspace/workflow-ui-context";
import { EmployeeRequestPanel, EmployeeCaseInbox } from "../src/components/workspace/employee-case-ui";
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

test("all ten workflow UI flags are default OFF and require exact true", () => {
  const flags = {
    firstPayrollInline: "FIRST_PAYROLL_INLINE_UI_ENABLED",
    importReview: "IMPORT_REVIEW_UI_ENABLED",
    coreOnlyNav: "CORE_ONLY_NAV_UI_ENABLED",
    faceOfflinePunch: "FACE_OFFLINE_PUNCH_UI_ENABLED",
    rosterPublish: "ROSTER_PUBLISH_UI_ENABLED",
    approvalBuilder: "APPROVAL_BUILDER_UI_ENABLED",
    reportBuilder: "REPORT_BUILDER_UI_ENABLED",
    benefitsLoans: "BENEFITS_LOANS_UI_ENABLED",
    recruitmentJourney: "RECRUITMENT_JOURNEY_UI_ENABLED",
    employeeCases: "EMPLOYEE_CASES_UI_ENABLED",
  } as const;
  assert.ok(Object.values(EMPTY_WORKFLOW_UI_FLAGS).every(value => value === false));
  for (const [key, env] of Object.entries(flags)) {
    for (const value of [undefined,"", "false", "TRUE", "1", "true "])
      assert.equal(criticalReleaseFlagEnabled(key as keyof typeof flags, { [env]: value }), false);
    assert.equal(criticalReleaseFlagEnabled(key as keyof typeof flags, { [env]: "true" }), true);
  }
});

test("first payroll preview performs actual readiness transitions and blockers", () => {
  const rows = firstPayrollPreview(readiness);
  assert.equal(rows.length, 7);
  assert.equal(rows.find(row => row.step.key === "people")?.kind, "blocker");
  assert.match(rows.find(row => row.step.key === "people")?.message ?? "", /missing bank/);
  assert.equal(rows.find(row => row.step.key === "time")?.kind, "blocker");
  assert.equal(rows.find(row => row.step.key === "company")?.kind, "complete");
  assert.equal(rows.find(row => row.step.key === "approval")?.kind, "blocker");
  const released = firstPayrollPreview({
    ...readiness, ready: true, completed: 5, employeesMissingPayout: 0,
    checkerCount: 1, firstPayrollStarted: true, firstPayrollReleased: true, payrollRunCount: 1,
    items: readiness.items.map(item => ({ ...item, ready: true })),
  });
  assert.equal(released.find(row => row.step.key === "approval")?.kind, "complete");
  assert.equal(released.find(row => row.step.key === "exports")?.kind, "review");
});

test("CSV import preview resolves multiline quotes and server row findings", () => {
  const csv = "Employee No,Name,Notes\r\nE-1,\"Doe, Jane\",\"multi\nline\"\r\nE-2,John,ok\r\n";
  const parsed = parseEmployeeImportPreview(csv, [{ line: 4, problems: ["Missing bank"] }]);
  assert.deepEqual(parsed.headers, ["Employee No", "Name", "Notes"]);
  assert.equal(parsed.total, 2);
  assert.deepEqual(parsed.rows.map(row=>row.line), [2,4]);
  assert.equal(parsed.rows[0].cells[1], "Doe, Jane");
  assert.equal(parsed.rows[0].cells[2], "multi\nline");
  assert.deepEqual(parsed.rows[1].problems, ["Missing bank"]);
  assert.throws(() => parseEmployeeImportPreview("a,b\n\"unterminated"), /unclosed quoted/);
});

test("CSV errors download includes original line and avoids spreadsheet formulas", () => {
  const csv = "Employee No,Name\n=2+2,Jane\nE-2,John";
  const result = makeEmployeeImportErrorCsv(csv, [{ line: 2, problems:["Missing payout; verify"] }]);
  assert.match(result, /"Source line"/);
  assert.match(result, /"'=2\+2"/);
  assert.match(result, /"Missing payout; verify"/);
  assert.doesNotMatch(result, /"E-2","John"/);
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

test("flagged seven-step drawer and core-only More modules execute real React rendering", () => {
  const html = renderToStaticMarkup(createElement(FirstPayrollInline, {
    readiness, organizationId:1, canAssign:true, allowedPages:["Settings","People","Payroll","Approvals","Exports"],
    onPage: (_: string) => {}, onNewRun:()=>{},
  }));
  assert.match(html, /Readiness preview/);
  assert.match(html, /Send to responsible team/);
  assert.match(html, /seven|Export payslips/i);
  const more = renderToStaticMarkup(createElement(MoreModulesPage,{
    visiblePages:["Overview","More modules"],
    allowedPages:["Exports"],
    onPage: (_:string) => {},
  }));
  assert.match(more,/More modules/);
  assert.match(more,/Open Exports/);
  assert.match(more,/Not available to this role/);
  assert.doesNotMatch(more, /Open Discipline/);
});

test("new request, HR review and offline consent screens have useful loading/empty state", () => {
  const employee = renderToStaticMarkup(createElement(EmployeeRequestPanel,{organizationId:1}));
  assert.match(employee,/Ask HR/);
  assert.match(employee,/Request category/);
  assert.match(employee,/Loading requests/);
  const hr = renderToStaticMarkup(createElement(EmployeeCaseInbox,{organizationId:1}));
  assert.match(hr,/Employee requests inbox/);
  assert.doesNotMatch(hr,/Send request to HR/);
  const camera = renderToStaticMarkup(createElement(FaceOfflinePunchPanel,{organizationId:1,employeeId:1}));
  assert.match(camera,/camera preview/i);
  assert.match(camera,/not face verification/i);
  const review = renderToStaticMarkup(createElement(OfflinePunchReviewQueue,{organizationId:1}));
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
