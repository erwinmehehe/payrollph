import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseAttendanceAnalysisRead, parseAttendanceOperationsRead,
  readVerifiedAttendanceAnalysis, readVerifiedAttendanceOperations } from "../src/lib/attendance-exception-read";
const scope = { organizationId: 41, start: "2026-10-01", end: "2026-10-14" };
const row = { employee: { id: 3, employeeNo: "E-3", name: "Test", orgUnitId: null },
  analysis: { date: "2026-10-01", source: "pattern", isRestDay: false,
    scheduledSegments: 1, punchCount: 1, workedMinutes: 360, overtimeMinutes: 0,
    tardinessMinutes: 0, undertimeMinutes: 0, reviewRequired: true,
    exceptions: [{ kind: "tardy", severity: "warning", message: "Late" }] } };
const analysis = { organizationId: 41, range: { startDate: scope.start, endDate: scope.end, days: 14 },
  summary: { blockers: 0, warnings: 1, info: 0, employeesAffected: 1 }, days: [row] };
const event = { id: 18, employeeId: 3, workDate: "2026-10-01", exceptionKind: "late",
  severity: "warning", message: "Late", status: "open", ownerUserId: null,
  ownerName: null, slaDueAt: null, ageHours: null, slaStatus: "untracked", resolvedAt: null,
  resolutionNote: null, resolvedByName: null, resolutionRecordedAt: null,
  employee: { id: 3, employeeNo: "E-3", firstName: "Test", lastName: "Person", orgUnitId: null } };
const operations = { organizationId: 41, range: { startDate: scope.start, endDate: scope.end },
  summary: { open: 1, overdue: 0, unassigned: 1, resolved: 0 }, exceptions: [event], ownerCandidates: [] };
test("attendance analysis validates employer, selected range, every row, and aggregate counts",()=>{
  assert.deepEqual(parseAttendanceAnalysisRead(analysis,41,scope.start,scope.end),analysis);
  const empty = { ...analysis, summary: {blockers:0,warnings:0,info:0,employeesAffected:0}, days:[] };
  assert.deepEqual(parseAttendanceAnalysisRead(empty,41,scope.start,scope.end),empty);
  for(const v of [null,{}, {...analysis,organizationId:42}, {...analysis,days:undefined},
    {...analysis,range:{...analysis.range,days:0}}, {...analysis,summary:{...analysis.summary,warnings:0}},
    {...analysis,days:[{...row,analysis:{...row.analysis,exceptions:undefined}}]},
    {...analysis,days:[{...row,analysis:{...row.analysis,date:"2026-09-01"}}]}])
      assert.equal(parseAttendanceAnalysisRead(v,41,scope.start,scope.end),null);
});
test("attendance operational exception read scopes owner/SLAs and cross-checks counts",()=>{
  assert.deepEqual(parseAttendanceOperationsRead(operations,41,scope.start,scope.end),operations);
  const empty={...operations,summary:{open:0,overdue:0,unassigned:0,resolved:0},exceptions:[]};
  assert.deepEqual(parseAttendanceOperationsRead(empty,41,scope.start,scope.end),empty);
  for(const v of [null, {}, {...operations,organizationId:42}, {...operations,ownerCandidates:undefined},
    {...operations,summary:{...operations.summary,open:0}},
    {...operations,exceptions:[{...event,employee:{...event.employee,id:99}}]},
    {...operations,exceptions:[{...event,ownerUserId:"3"}]}])
      assert.equal(parseAttendanceOperationsRead(v,41,scope.start,scope.end),null);
});
test("attendance GET reads fail closed on HTTP, JSON, wrong employer and partial; retry restores",async()=>{
  let status=502,invalid=false,body:unknown=analysis,requests=0;
  const fetcher=(async()=>{requests++;return {ok:status===200,json:async()=>{
    if(invalid)throw SyntaxError("invalid JSON");return body;
  }} as Response;}) as typeof fetch;
  await assert.rejects(()=>readVerifiedAttendanceAnalysis(41,scope.start,scope.end,fetcher),/unavailable/);
  status=200;invalid=true;
  await assert.rejects(()=>readVerifiedAttendanceAnalysis(41,scope.start,scope.end,fetcher),/unreadable/);
  invalid=false;body={...analysis,organizationId:42};
  await assert.rejects(()=>readVerifiedAttendanceAnalysis(41,scope.start,scope.end,fetcher),/different employer/);
  body={...analysis,summary:{}};
  await assert.rejects(()=>readVerifiedAttendanceAnalysis(41,scope.start,scope.end,fetcher),/incomplete/);
  body=analysis;assert.deepEqual(await readVerifiedAttendanceAnalysis(41,scope.start,scope.end,fetcher),analysis);
  body=operations;assert.deepEqual(await readVerifiedAttendanceOperations(41,scope.start,scope.end,fetcher),operations);
  assert.equal(requests,6);
});
test("attendance UI gates both independent exception counts",()=>{
 const ui=readFileSync("src/components/workspace/attendance-exceptions-panel.tsx","utf8");
 const api=readFileSync("src/app/api/workforce/attendance-exceptions/route.ts","utf8");
 const events=readFileSync("src/app/api/workforce/attendance-exception-events/route.ts","utf8");
 assert.match(ui,/readVerifiedAttendanceAnalysis/);
 assert.match(ui,/readVerifiedAttendanceOperations/);
 assert.match(ui,/onRetry=\{\(\) => void load\(\)\}/);
 assert.match(api,/organizationId,\s+range/);
 assert.match(events,/organizationId,\s+range/);
});
