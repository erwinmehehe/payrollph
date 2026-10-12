/** Reviewer choices are explicit; offline server receipt is never an automatic clock time. */
export type ReviewedTimeSource="device"|"server";
export function validReviewTimeSource(source:unknown):source is ReviewedTimeSource {
  return source==="device"||source==="server";
}
export function canApproveReviewedPunch(note:string,timeSource:unknown,busy:boolean):boolean {
  return !busy&&note.trim().length>=10&&validReviewTimeSource(timeSource);
}
export function punchTimestampGapMinutes(deviceTime:string,serverTime:string):number|null {
  const device=Date.parse(deviceTime),server=Date.parse(serverTime);
  if(!Number.isFinite(device)||!Number.isFinite(server))return null;
  return Math.round(Math.abs(server-device)/60000);
}
