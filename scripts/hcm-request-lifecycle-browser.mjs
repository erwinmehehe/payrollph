import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
// Local runtime fallback; CI installs its own pinned Playwright.
const { chromium } = require(process.env.HCM_BROWSER_PLAYWRIGHT_MODULE ?? "playwright");
await mkdir("qa-artifacts", { recursive: true });
await build({
  entryPoints: ["tests/fixtures/hcm-request-lifecycle.jsx"], bundle: true,
  outfile: "qa-artifacts/hcm-request-lifecycle.js", platform: "browser", jsx: "automatic",
  // This standalone esbuild fixture is intentionally NOT a Next.js build.
  // Supply public calendar flags as default OFF rather than leaving browser
  // code with an unbound Node process object.
  define: {
    "process.env.NEXT_PUBLIC_HCM_TEAM_LEAVE_CALENDAR_ENABLED": JSON.stringify("false"),
    "process.env.NEXT_PUBLIC_HCM_TEAM_LEAVE_CALENDAR_ORG_IDS": JSON.stringify(""),
  },
  plugins: [{ name: "read-only-link-fixture", setup(builder) {
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "import React from 'react'; export default function Link(props) { return React.createElement('a', props); }", resolveDir: process.cwd() }));
  } }],
});
const bundle = await readFile("qa-artifacts/hcm-request-lifecycle.js");
const server = createServer((request, response) => {
  response.setHeader("Content-Type", request.url === "/bundle.js" ? "text/javascript" : "text/html");
  response.end(request.url === "/bundle.js" ? bundle : '<div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"],
  executablePath: process.env.HCM_BROWSER_EXECUTABLE || undefined });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const base = `http://127.0.0.1:${server.address().port}`;
async function requestId(fragment, method = "GET") {
  try {
    await page.waitForFunction(({ fragment, method }) => window.pending.some(r => !r.done && !r.options.signal?.aborted && r.url.includes(fragment) && (r.options.method ?? "GET") === method), { fragment, method });
  } catch (error) {
    // Previous failures hid the actual component exception behind a timeout.
    throw new Error(`Expected pending ${method} ${fragment}; browser errors: ${errors.join(" | ") || "none"}`, { cause: error });
  }
  return page.evaluate(({ fragment, method }) => window.pending.findLastIndex(r => !r.done && !r.options.signal?.aborted && r.url.includes(fragment) && (r.options.method ?? "GET") === method), { fragment, method });
}
async function complete(id, body, status = 200) { await page.evaluate(({id,body,status}) => window.complete(id,body,status), {id,body,status}); }
async function visible(text) { await page.getByText(text, { exact: true }).waitFor(); }
async function absent(text) { assert.equal(await page.getByText(text, { exact: true }).count(), 0, `Unexpected stale text: ${text}`); }
function item(id, title, organizationId) { return {id,organizationId,title,detail:"",caseType:"follow_up",status:"open",ownerTeam:"HR Operations",ownerUserId:1,ownerName:"Synthetic owner",dueAt:null,escalateAt:null,escalationLevel:0,overdue:false}; }

function scopedTeam(organizationId, name = "SYNTHETIC_TEAM_WORKER") {
  return {
    organizationId, observedAt: "2026-10-20T00:00:00.000Z",
    scope: {kind:"company", orgUnitId:null}, query:"", statusFilter:"all",
    warning:"Synthetic read-only page", page:{size:25,hasMore:false,nextCursor:null},
    summary:{employeeRecordsThisPage:1,pendingLeaveRecordsThisPage:0,pendingOvertimeRecordsThisPage:0,
      pendingAttendanceCorrectionsThisPage:0,incompletePunchRecordsThisPage:0},
    items:[{id:18,employeeNo:"FIX-018",name,jobTitle:"Analyst",employmentType:"Regular",
      status:"Active",orgUnitName:"Synthetic Field Unit",orgUnitIntegrity:"verified",
      pendingLeaveRecords:0,pendingOvertimeRecords:0,pendingAttendanceCorrections:0,incompletePunchRecords:0}],
  };
}
function scopedOrg(tenantId, unitName = "Synthetic Field Unit") {
  return {
    tenantId, observedAt:"2026-10-20T00:00:00.000Z",currentBusinessDate:"2026-10-20",
    sources:["org_units","positions","job_profiles"],integrity:"ready",unlinkedPositionRecords:0,
    units:[{id:11,parentId:null,name:unitName,code:"FIX-UNIT",type:"Department",depth:0,
      relationship:"root",positionRecordCount:1}],
    positions:[{id:33,code:"FIX-POS-33",status:"Active",jobTitle:"Analyst",orgUnitId:11,
      supervisoryOrgUnitId:null,reportingUnitId:11,relationship:"linked"}],
  };
}
function scopedHistory() {
  return {
    tenantId:17,positionId:33,observedAt:"2026-10-20T00:00:00.000Z",
    position:{source:"positions",id:33,code:"FIX-POS-33",status:"Active",currentJobTitle:"Analyst"},
    history:{source:"position_assignments",preview:{hasMore:false,partial:false,
      items:[{id:45,employeeId:18,assignmentType:"Primary",effectiveFrom:"2026-10-01",
        effectiveUntil:null}]}},
  };
}
function scopedCalendar(organizationId, employeeName = "SYNTHETIC_LEAVE_WORKER") {
  return {
    organizationId, scope:{kind:"company",orgUnitId:null},month:"2026-10",
    observedAt:"2026-10-20T00:00:00.000Z",
    dates:{start:"2026-10-01",end:"2026-10-31"},notice:"Synthetic request",
    summary:{approvedRequestRecords:1,pendingRequestRecords:0},
    cases:[{requestId:77,employeeId:18,employeeNo:"FIX-018",employeeName,
      status:"Approved",startDate:"2026-10-01",endDate:"2026-10-31"}],
  };
}

try {
  await page.goto(base + "/?organizationId=1");
  await page.evaluate(() => window.renderView("queue"));
  // The synthetic API fixture must carry the employer ID that the real GET
  // explicitly selects. Omitting it tests a malformed response, not an owned read.
  await complete(await requestId("work-items?organizationId=1"), {items:[item(11,"Employer A case",1),item(12,"Second A case",1)],owners:[{id:1,name:"Synthetic owner"}]});
  await visible("Employer A case");
  await page.getByRole("button", {name:"Assign / SLA"}).first().click();
  const oldHistory = await requestId("caseId=11");
  await page.getByRole("button", {name:"Cancel", exact:true}).click();
  await page.getByRole("button", {name:"Assign / SLA"}).nth(1).click();
  const currentHistory = await requestId("caseId=12");
  await complete(oldHistory, {events:[{id:1,eventType:"STALE_HISTORY",actorName:null,createdAt:"2026-10-11T00:00:00Z"}]});
  await complete(currentHistory, {events:[]});
  await visible("No history recorded.");
  assert.ok(!(await page.locator("body").innerText()).includes("STALE HISTORY"));
  // A retired editor inside the same tenant must not close a newly opened case.
  await page.getByRole("button", {name:"Save changes"}).click();
  const retiredEditorSave = await requestId("/api/hcm/work-items", "PATCH");
  await page.getByRole("button", {name:"Cancel",exact:true}).click();
  await page.getByRole("button", {name:"Assign / SLA"}).first().click();
  await complete(retiredEditorSave, {});
  await page.getByRole("heading",{name:"Assign #11",exact:true}).waitFor();
  await complete(await requestId("caseId=11"), {events:[]});
  await visible("No history recorded.");
  await page.getByRole("button", {name:"Save changes"}).click();
  const oldSave = await requestId("/api/hcm/work-items", "PATCH");
  await page.getByRole("spinbutton", {name:"Organization ID"}).fill("2");
  await absent("Employer A case");
  assert.equal(await page.getByRole("dialog").count(), 0);
  const tenantBRead = await requestId("work-items?organizationId=2");
  await complete(oldSave, {});
  await complete(tenantBRead, {items:[item(21,"Employer B case",2)],owners:[]});
  await visible("Employer B case");
  assert.equal(await page.evaluate(() => window.pending.filter(r=>r.url.includes("work-items?organizationId=2")).length), 2, "StrictMode creates two reads; old save must not add another");
  await page.getByRole("button", {name:"Refresh",exact:true}).click();
  await absent("Employer B case");
  await absent("No work items found for this filter.");
  await complete(await requestId("work-items?organizationId=2"), {error:"Synthetic queue outage"}, 503);
  await visible("Synthetic queue outage");
  await absent("Employer B case");
  await page.getByRole("combobox", {name:"Queue",exact:true}).selectOption("resolved");
  await absent("Synthetic queue outage");
  await complete(await requestId("status=resolved"), {items:[],owners:[]});
  await visible("No work items found for this filter.");
  await page.getByRole("spinbutton", {name:"Organization ID"}).fill("");
  await visible("Choose a valid organization to load its queue.");

  // My Team already masks by full query scope; verify loading is render-derived.
  await page.evaluate(() => window.renderView("team", {organizationId:1}));
  const staleTeam = await requestId("my-team?organizationId=1");
  await page.evaluate(() => window.renderView("team", {organizationId:2}));
  await complete(staleTeam, {error:"STALE_TEAM_ERROR"}, 403);
  await complete(await requestId("my-team?organizationId=2"), {organizationId:2,query:"",statusFilter:"all",scope:{kind:"company",orgUnitId:null},items:[],page:{size:25,hasMore:false,nextCursor:null},summary:{employeeRecordsThisPage:0,pendingLeaveRecordsThisPage:0,pendingOvertimeRecordsThisPage:0,pendingAttendanceCorrectionsThisPage:0,incompletePunchRecordsThisPage:0},observedAt:"2026-10-11T00:00:00Z",warning:"Fictional safe-empty team page"});
  await visible("Employee records / this page");
  // Revisiting a tenant while the intervening tenant's request is still pending
  // must not reuse the retired tenant's completed response.
  await page.evaluate(() => window.renderView("team", {organizationId:1}));
  const interveningTeam = await requestId("my-team?organizationId=1");
  await page.evaluate(() => window.renderView("team", {organizationId:2}));
  await absent("Employee records / this page");
  await complete(interveningTeam, {error:"RETIRED_TEAM_ERROR"}, 403);
  await complete(await requestId("my-team?organizationId=2"), {organizationId:2,query:"",statusFilter:"all",scope:{kind:"company",orgUnitId:null},items:[],page:{size:25,hasMore:false,nextCursor:null},summary:{employeeRecordsThisPage:0,pendingLeaveRecordsThisPage:0,pendingOvertimeRecordsThisPage:0,pendingAttendanceCorrectionsThisPage:0,incompletePunchRecordsThisPage:0},observedAt:"2026-10-11T00:00:00Z",warning:"Fictional safe-empty team page"});
  await visible("Employee records / this page");
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await absent("Employee records / this page");
  await complete(await requestId("my-team?organizationId=2"), {error:"unavailable"}, 503);
  await visible("Team records unavailable");

  // Behavioral read-state assertions use the actual rendered React surfaces,
  // not source-code regex matching. No fixture contains real worker data.
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  await complete(await requestId("my-team?organizationId=2"),{error:"auth expired"},401);
  await visible("Sign in required");
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  await complete(await requestId("my-team?organizationId=2"),{error:"denied"},403);
  await visible("Team access denied");
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  await complete(await requestId("my-team?organizationId=2"),
    {...scopedTeam(2),items:[null]});
  await visible("Team records unavailable");
  await page.getByRole("alert").getByText(/response did not match the requested employer/i).waitFor();
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  await page.evaluate(index => window.completeMalformed(index),
    await requestId("my-team?organizationId=2"));
  await page.getByRole("alert").getByText(/response did not match the requested employer/i).waitFor();
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  await complete(await requestId("my-team?organizationId=2"),scopedTeam(999,"FOREIGN_TEAM_WORKER"));
  await page.getByRole("alert").getByText(/response did not match the requested employer/i).waitFor();
  await absent("FOREIGN_TEAM_WORKER");
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  await page.evaluate(index => window.rejectRequest(index),await requestId("my-team?organizationId=2"));
  await page.getByRole("alert").getByText(/request could not reach the source/i).waitFor();
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  await complete(await requestId("my-team?organizationId=2"),scopedTeam(2));
  await visible("SYNTHETIC_TEAM_WORKER");
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await absent("SYNTHETIC_TEAM_WORKER");
  await complete(await requestId("my-team?organizationId=2"),{error:"revoked"},403);
  await visible("Team access denied");
  await absent("SYNTHETIC_TEAM_WORKER");

  // Organization Explorer rejects malformed rows before rendering and keeps
  // position history retry independent of an already verified hierarchy.
  await page.evaluate(() => window.renderView("org",{organizationId:17}));
  await complete(await requestId("org-explorer?organizationId=17"),{error:"denied"},403);
  await visible("Organization access denied");
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  await complete(await requestId("org-explorer?organizationId=17"),
    {...scopedOrg(17),units:[null]});
  await visible("Organization data unavailable");
  await page.getByRole("alert").getByText(/response did not match the requested employer/i).waitFor();
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  await complete(await requestId("org-explorer?organizationId=17"),
    {...scopedOrg(17),positions:[null]});
  await page.getByRole("alert").getByText(/response did not match the requested employer/i).waitFor();
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  await complete(await requestId("org-explorer?organizationId=17"),scopedOrg(17));
  await visible("Synthetic Field Unit");
  await page.getByRole("button",{name:/FIX-POS-33/}).click();
  const initialOrgReads = await page.evaluate(() =>
    window.pending.filter(r=>r.url.includes("org-explorer?organizationId=17")).length);
  await complete(await requestId("position-history?organizationId=17"),
    {...scopedHistory(),history:{source:"position_assignments",
      preview:{hasMore:false,partial:false,items:[null]}}});
  await visible("Position history unavailable");
  await page.getByRole("button",{name:"Retry position history",exact:true}).click();
  await complete(await requestId("position-history?organizationId=17"),scopedHistory());
  await visible("Recorded worker reference #18");
  assert.equal(await page.evaluate(() =>
    window.pending.filter(r=>r.url.includes("org-explorer?organizationId=17")).length),
    initialOrgReads,"Position-history retry must not refetch the organization");
  await page.getByRole("button",{name:"Refresh sources",exact:true}).click();
  await absent("Recorded worker reference #18");
  await absent("Synthetic Field Unit");
  await complete(await requestId("org-explorer?organizationId=17"),{error:"source outage"},503);
  await visible("Organization data unavailable");
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  const oldOrg = await requestId("org-explorer?organizationId=17");
  await page.evaluate(() => window.renderView("org",{organizationId:18}));
  await complete(oldOrg,scopedOrg(17,"FOREIGN_ORG_UNIT"));
  await absent("FOREIGN_ORG_UNIT");
  await complete(await requestId("org-explorer?organizationId=18"),
    scopedOrg(18,"Second Employer Unit"));
  await visible("Second Employer Unit");
  await page.getByRole("button",{name:"Refresh sources",exact:true}).click();
  await absent("Second Employer Unit");
  await complete(await requestId("org-explorer?organizationId=18"),{error:"session ended"},401);
  await visible("Sign in required");

  // Team Leave Calendar must not display stale or unauthenticated private
  // employee records, including after tenant changes and rejected transport.
  await page.evaluate(() => window.renderView("calendar",{organizationId:17,initialMonth:"2026-10"}));
  await complete(await requestId("team-leave-calendar?organizationId=17"),
    {...scopedCalendar(17),cases:[null]});
  await visible("Leave records unavailable");
  await page.getByRole("alert").getByText(/response did not match the requested employer/i).waitFor();
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  await complete(await requestId("team-leave-calendar?organizationId=17"),{error:"denied"},403);
  await visible("Leave calendar access denied");
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  await complete(await requestId("team-leave-calendar?organizationId=17"),{error:"sign in"},401);
  await visible("Sign in required");
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  await complete(await requestId("team-leave-calendar?organizationId=17"),{error:"outage"},503);
  await visible("Leave records unavailable");
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  await page.evaluate(index => window.rejectRequest(index),
    await requestId("team-leave-calendar?organizationId=17"));
  await page.getByRole("alert").getByText(/request could not reach the source/i).waitFor();
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  await complete(await requestId("team-leave-calendar?organizationId=17"),
    scopedCalendar(99,"FOREIGN_LEAVE_WORKER"));
  await page.getByRole("alert").getByText(/response did not match the requested employer/i).waitFor();
  await absent("FOREIGN_LEAVE_WORKER");
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  await complete(await requestId("team-leave-calendar?organizationId=17"),scopedCalendar(17));
  await visible("SYNTHETIC_LEAVE_WORKER");
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await absent("SYNTHETIC_LEAVE_WORKER");
  const staleCalendar = await requestId("team-leave-calendar?organizationId=17");
  await page.evaluate(() => window.renderView("calendar",{organizationId:18,initialMonth:"2026-10"}));
  await complete(staleCalendar,scopedCalendar(17));
  await absent("SYNTHETIC_LEAVE_WORKER");
  await complete(await requestId("team-leave-calendar?organizationId=18"),
    scopedCalendar(18,"SYNTHETIC_LEAVE_EMPLOYER_18"));
  await visible("SYNTHETIC_LEAVE_EMPLOYER_18");

  await page.evaluate(() => window.renderView("worker", {organizationId:1,employeeId:11,initialAsOfDate:"2026-10-11"}));
  await complete(await requestId("worker-360?organizationId=1"), {}, 403);
  await visible("This worker is not available to your current employer and role.");
  await page.evaluate(() => window.renderView("worker", {organizationId:2,employeeId:22,initialAsOfDate:"2026-10-11"}));
  await absent("This worker is not available to your current employer and role.");
  await visible("Loading authorized worker records…");
  await complete(await requestId("worker-360?organizationId=2"), {}, 503);
  await visible("The Worker 360 source is currently unavailable.");

  await page.evaluate(() => window.renderView("inbox", {organizationId:1}));
  const staleInbox = await requestId("people-operations-inbox?organizationId=1");
  const beforeSameScopeRender = await page.evaluate(() => window.pending.length);
  await page.evaluate(async () => {
    window.renderView("inbox", { organizationId: 1 });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  assert.equal(await page.evaluate(() => window.pending.length), beforeSameScopeRender,
    "Unchanged employer scope must not restart the request on a parent rerender");
  assert.equal(await page.evaluate(id => window.pending[id].options.signal.aborted, staleInbox), false,
    "The original same-scope request must remain active");

  await page.evaluate(() => window.renderView("inbox", {organizationId:2}));
  await complete(staleInbox, {error:"STALE_INBOX_ERROR"}, 403);
  await complete(await requestId("people-operations-inbox?organizationId=2"), {error:"Current inbox unavailable"}, 503);
  await visible("Current inbox unavailable");
  await absent("STALE_INBOX_ERROR");
  // The inbox exposes a recovery-specific label after a failed employer-scoped read.
  await page.getByRole("button",{name:"Retry inbox",exact:true}).click();
  await absent("Current inbox unavailable");
  await visible("Loading tenant-scoped HR follow-ups…");
  await complete(await requestId("people-operations-inbox?organizationId=2"), {organizationId:1,items:[{employeeName:"FOREIGN_INBOX_WORKER"}]});
  await visible("The People Operations Inbox returned an unexpected tenant or legal-employer scope.");
  await absent("FOREIGN_INBOX_WORKER");

  // Switching employers inside one tenant is a private-data boundary.
  // Old responses must not be displayed, even if transport ignores abort.
  await page.evaluate(() => window.renderView("inbox", {
    organizationId: 1, multiEntityEnabled: true, legalEntityId: 101,
  }));
  const oldEmployer = await requestId("people-operations-inbox?organizationId=1&legalEntityId=101");
  await page.evaluate(() => window.renderView("inbox", {
    organizationId: 1, multiEntityEnabled: true, legalEntityId: 102,
  }));
  await complete(oldEmployer, { organizationId: 1, legalEntityId: 101,
    rows: [{ employeeName: "OLD_EMPLOYER_PERSON" }], summary: { total: 1 } });
  await complete(await requestId("people-operations-inbox?organizationId=1&legalEntityId=102"),
    { error: "Selected employer unavailable" }, 503);
  await visible("Selected employer unavailable");
  await absent("OLD_EMPLOYER_PERSON");
  const beforeGroupSelection = await page.evaluate(() => window.pending.length);
  await page.evaluate(() => window.renderView("inbox", {
    organizationId: 1, multiEntityEnabled: true, legalEntityId: null,
  }));
  await visible("Select one authorized legal employer before loading People Operations.");
  assert.equal(await page.evaluate(() => window.pending.length), beforeGroupSelection,
    "An unselected legal employer cannot issue an organization-only read");
  // The lifecycle panel must not retain old private details after a manual
  // refresh: a user's People permission could have been revoked in the meantime.
  const lifecycleA = { organizationId: 1, legalEntityId: 101,
    today: "2026-10-14", policy: { actionWindowDays: 30 },
    summary: { total: 1, actionRequired: 1, upcoming: 0, inProgress: 0,
      unconfigured: 0, handoffReady: 0 },
    rows: [{ employeeId: 11, employeeNo: "A1-001",
      employeeName: "LIFECYCLE_PRIVATE_A1", employeeStatus: "Active",
      state: "action_required", severity: "warning", action: "configure_terms",
      dueDate: null, daysUntil: null, label: "Review source",
      detail: "Fictional employee workflow", term: null, decision: null }],
  };
  await page.evaluate(() => window.renderView("lifecycle", {
    organizationId: 1, multiEntityEnabled: true, legalEntityId: 101,
  }));
  await complete(await requestId("lifecycle-readiness?organizationId=1&legalEntityId=101"), lifecycleA);
  await visible("LIFECYCLE_PRIVATE_A1");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await visible("Loading employment lifecycle readiness…");
  await absent("LIFECYCLE_PRIVATE_A1");
  const oldLifecycleRefresh = await requestId("lifecycle-readiness?organizationId=1&legalEntityId=101");

  // Same-tenant employer switch: ignore even a successful late response
  // from A1, then handle the current employer's unavailable backend safely.
  await page.evaluate(() => window.renderView("lifecycle", {
    organizationId: 1, multiEntityEnabled: true, legalEntityId: 102,
  }));
  await complete(oldLifecycleRefresh, lifecycleA);
  await absent("LIFECYCLE_PRIVATE_A1");
  await complete(await requestId("lifecycle-readiness?organizationId=1&legalEntityId=102"),
    { error: "Selected lifecycle employer unavailable" }, 503);
  await visible("Selected lifecycle employer unavailable");
  await absent("LIFECYCLE_PRIVATE_A1");

  // Server echoes must be checked, not trusted solely because the request
  // URL was scoped; an accidental A2 payload in A1 must fail closed.
  await page.evaluate(() => window.renderView("lifecycle", {
    organizationId: 1, multiEntityEnabled: true, legalEntityId: 101,
  }));
  await complete(await requestId("lifecycle-readiness?organizationId=1&legalEntityId=101"),
    { ...lifecycleA, legalEntityId: 102 });
  await visible("Employment lifecycle returned an unexpected tenant or legal employer.");
  await absent("LIFECYCLE_PRIVATE_A1");

  const lifecycleRequestCount = await page.evaluate(() => window.pending.length);
  await page.evaluate(() => window.renderView("lifecycle", {
    organizationId: 1, multiEntityEnabled: true, legalEntityId: null,
  }));
  await visible("Select one authorized legal employer before loading employment lifecycle information.");
  assert.equal(await page.evaluate(() => window.pending.length), lifecycleRequestCount,
    "Missing legal employer must not issue an organization-only lifecycle read");
  await absent("LIFECYCLE_PRIVATE_A1");

  assert.deepEqual(errors, []);
  console.log("HCM request lifecycle browser QA passed: tenant/filter/editor isolation, late history, stale save, My Team, org explorer, position history and team leave read failures, retries and stale-scope discard, Worker 360, People Ops and legal-employer lifecycle (StrictMode; transport ignores abort).");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
