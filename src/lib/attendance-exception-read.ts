export type ExceptionItem = {
  kind: string; severity: "info" | "warning" | "blocker"; message: string;
  punchId?: number; minutes?: number;
};
export type AttendanceRow = {
  employee: { id: number; employeeNo: string; name: string; orgUnitId: number | null };
  analysis: {
    date: string; source: "pattern" | "override" | "unassigned"; isRestDay: boolean;
    scheduledSegments: number; punchCount: number; workedMinutes: number;
    overtimeMinutes: number; tardinessMinutes: number; undertimeMinutes: number;
    reviewRequired: boolean; exceptions: ExceptionItem[];
  };
};
export type AttendanceAnalysisRead = {
  organizationId: number; range: { startDate: string; endDate: string; days: number };
  summary: { blockers: number; warnings: number; info: number; employeesAffected: number };
  days: AttendanceRow[];
};
export type OperationalException = {
  id: number; employeeId: number; workDate: string; exceptionKind: string;
  severity: "info" | "warning" | "blocker"; message: string; status: "open" | "resolved";
  ownerUserId: number | null; ownerName: string | null; slaDueAt: string | null;
  ageHours: number | null; slaStatus: "resolved" | "on_track" | "overdue" | "untracked";
  resolvedAt: string | null; resolutionNote: string | null; resolvedByName: string | null;
  resolutionRecordedAt: string | null;
  employee: {
    id: number; employeeNo: string; firstName: string; lastName: string; orgUnitId: number | null;
  } | null;
};
export type OwnerCandidate = {
  userId: number; role: string; orgUnitId: number | null; name: string; email: string;
};
export type AttendanceOperationsRead = {
  organizationId: number; range: { startDate: string; endDate: string };
  summary: { open: number; overdue: number; unassigned: number; resolved: number };
  exceptions: OperationalException[]; ownerCandidates: OwnerCandidate[];
};
const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const positive=(v:unknown)=>typeof v==="number"&&Number.isSafeInteger(v)&&v>0;
const count=(v:unknown)=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
const text=(v:unknown)=>typeof v==="string"&&v.trim().length>0;
const optionalText=(v:unknown)=>v===null||typeof v==="string";
const optionalId=(v:unknown)=>v===null||positive(v);
function date(v:unknown):v is string {
  if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
  const d=new Date(v+"T00:00:00Z");
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;
}
const severity=(v:unknown)=>v==="info"||v==="warning"||v==="blocker";
function exception(v:unknown):v is ExceptionItem {
  return record(v)&&text(v.kind)&&text(v.message)&&severity(v.severity)&&
    (v.punchId===undefined||positive(v.punchId))&&
    (v.minutes===undefined||count(v.minutes));
}
function day(v:unknown,start:string,end:string):v is AttendanceRow {
  if(!record(v)||!record(v.employee)||!record(v.analysis))return false;
  const e=v.employee,a=v.analysis;
  return positive(e.id)&&typeof e.employeeNo==="string"&&text(e.name)&&optionalId(e.orgUnitId)&&
    date(a.date)&&a.date>=start&&a.date<=end&&
    ["pattern","override","unassigned"].includes(String(a.source))&&
    typeof a.isRestDay==="boolean"&&typeof a.reviewRequired==="boolean"&&
    [a.scheduledSegments,a.punchCount,a.workedMinutes,a.overtimeMinutes,
      a.tardinessMinutes,a.undertimeMinutes].every(count)&&
    Array.isArray(a.exceptions)&&a.exceptions.every(exception);
}
function scope(v:unknown,org:number,start:string,end:string):v is Record<string,unknown> & {range:Record<string,unknown>} {
  return positive(org)&&date(start)&&date(end)&&start<=end&&record(v)&&
    v.organizationId===org&&record(v.range)&&
    v.range.startDate===start&&v.range.endDate===end;
}
/** Arithmetic cross-check prevents partial success from looking like zero blockers. */
export function parseAttendanceAnalysisRead(
  value:unknown,org:number,start:string,end:string,
):AttendanceAnalysisRead|null{
  if(!scope(value,org,start,end)||!record(value.summary)||!Array.isArray(value.days)||
    !value.days.every(v=>day(v,start,end)))return null;
  const expectedDays=Math.floor((Date.parse(end+"T00:00:00Z")-
    Date.parse(start+"T00:00:00Z"))/86400000)+1;
  if(!count(value.range.days)||value.range.days!==expectedDays||expectedDays>42 ||
    ![value.summary.blockers,value.summary.warnings,value.summary.info,
      value.summary.employeesAffected].every(count))return null;
  const rows=value.days as AttendanceRow[];
  const exceptions=rows.flatMap(v=>v.analysis.exceptions);
  const affected=new Set(rows.filter(v=>v.analysis.exceptions.some(x=>x.severity!=="info"))
    .map(v=>v.employee.id)).size;
  if(exceptions.filter(v=>v.severity==="blocker").length!==value.summary.blockers||
    exceptions.filter(v=>v.severity==="warning").length!==value.summary.warnings||
    exceptions.filter(v=>v.severity==="info").length!==value.summary.info||
    affected!==value.summary.employeesAffected)return null;
  return value as AttendanceAnalysisRead;
}
function operational(v:unknown,start:string,end:string):v is OperationalException {
  if(!record(v)||!positive(v.id)||!positive(v.employeeId)||
     !date(v.workDate)||v.workDate<start||v.workDate>end||
     !text(v.exceptionKind)||!severity(v.severity)||!text(v.message)||
     !(v.status==="open"||v.status==="resolved")||
     !optionalId(v.ownerUserId)||!optionalText(v.ownerName)||
     !optionalText(v.slaDueAt)||!(v.ageHours===null||
       (typeof v.ageHours==="number"&&Number.isFinite(v.ageHours)&&v.ageHours>=0))||
     !["resolved","on_track","overdue","untracked"].includes(String(v.slaStatus))||
     !optionalText(v.resolvedAt)||!optionalText(v.resolutionNote)||
     !optionalText(v.resolvedByName)||!optionalText(v.resolutionRecordedAt))return false;
  if(v.employee!==null){
    if(!record(v.employee)||v.employee.id!==v.employeeId||
      typeof v.employee.employeeNo!=="string"||typeof v.employee.firstName!=="string"||
      typeof v.employee.lastName!=="string"||!optionalId(v.employee.orgUnitId))return false;
  }
  return true;
}
function owner(v:unknown):v is OwnerCandidate{
  return record(v)&&positive(v.userId)&&text(v.role)&&optionalId(v.orgUnitId)&&
    text(v.name)&&typeof v.email==="string";
}
export function parseAttendanceOperationsRead(
  value:unknown,org:number,start:string,end:string,
):AttendanceOperationsRead|null{
  if(!scope(value,org,start,end)||!record(value.summary)||
     !Array.isArray(value.exceptions)||!value.exceptions.every(v=>operational(v,start,end))||
     !Array.isArray(value.ownerCandidates)||!value.ownerCandidates.every(owner)||
     ![value.summary.open,value.summary.overdue,value.summary.unassigned,
       value.summary.resolved].every(count))return null;
  const rows=value.exceptions as OperationalException[];
  if(new Set(rows.map(x=>x.id)).size!==rows.length||
     new Set((value.ownerCandidates as OwnerCandidate[]).map(x=>x.userId)).size!==value.ownerCandidates.length||
     rows.filter(x=>x.status==="open").length!==value.summary.open||
     rows.filter(x=>x.status==="resolved").length!==value.summary.resolved||
     rows.filter(x=>x.status==="open"&&x.slaStatus==="overdue").length!==value.summary.overdue||
     rows.filter(x=>x.status==="open"&&x.ownerUserId===null).length!==value.summary.unassigned)return null;
  return value as AttendanceOperationsRead;
}
async function fetchVerified<T>(
  path:string,org:number,start:string,end:string,validator:(v:unknown,o:number,s:string,e:string)=>T|null,
  fetcher:typeof fetch,signal?:AbortSignal,
):Promise<T>{
  if(!positive(org)||!date(start)||!date(end)||end<start)throw Error("Attendance evidence unavailable. Retry.");
  const search=new URLSearchParams({organizationId:String(org),startDate:start,endDate:end});
  const response=await fetcher("/api/workforce/"+path+"?"+search.toString(),{cache:"no-store",signal});
  if(!response.ok)throw Error("Attendance evidence unavailable. Retry.");
  let body:unknown;
  try{body=await response.json();}catch{throw Error("Attendance evidence unreadable. Retry.");}
  const verified=validator(body,org,start,end);
  if(!verified)throw Error("Attendance evidence incomplete or for a different employer/range. Retry.");
  return verified;
}
export function readVerifiedAttendanceAnalysis(
  org:number,start:string,end:string,fetcher:typeof fetch=fetch,signal?:AbortSignal,
):Promise<AttendanceAnalysisRead>{
  return fetchVerified("attendance-exceptions",org,start,end,parseAttendanceAnalysisRead,fetcher,signal);
}
export function readVerifiedAttendanceOperations(
  org:number,start:string,end:string,fetcher:typeof fetch=fetch,signal?:AbortSignal,
):Promise<AttendanceOperationsRead>{
  return fetchVerified("attendance-exception-events",org,start,end,parseAttendanceOperationsRead,fetcher,signal);
}
