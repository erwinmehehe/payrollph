import { createHmac } from "node:crypto";

export const DEFAULT_PUNCH_PHOTO_RETENTION_DAYS = 90;
export const DEFAULT_OFFLINE_SKEW_MINUTES = 5;
export const PHOTO_CONSENT_PURPOSE = "Optional time-punch identity evidence for a human attendance reviewer. No automatic facial matching, rejection, wage deduction or payroll release. Image retained for 90 days by default unless a justified legal hold applies.";

export function mayUploadPunchPhoto(input: {
  featureEnabled: boolean; siteEnabled: boolean; employeeConsented: boolean | null;
}) {
  return input.featureEnabled && input.siteEnabled && input.employeeConsented === true;
}

export function classifyOfflinePunch(input: {
  deviceTimestamp: string; serverReceivedAt: string;
  skewThresholdMinutes?: number;
  sharedDevice?: boolean;
  impossibleTravel?: boolean;
}) {
  const deviceAt = Date.parse(input.deviceTimestamp);
  const receivedAt = Date.parse(input.serverReceivedAt);
  const threshold = input.skewThresholdMinutes ?? DEFAULT_OFFLINE_SKEW_MINUTES;
  if (!Number.isFinite(deviceAt) || !Number.isFinite(receivedAt)
    || !Number.isSafeInteger(threshold) || threshold < 1 || threshold > 180) {
    throw new Error("Offline punch timestamps or skew threshold are invalid.");
  }
  const flags:string[] = [];
  if (Math.abs(deviceAt - receivedAt) > threshold * 60_000) flags.push("offline-synced");
  if (input.sharedDevice) flags.push("same-device-multiple-employees");
  if (input.impossibleTravel) flags.push("impossible-travel");
  return { status:"pending_review" as const, flags,
    deviceTimestamp:new Date(deviceAt).toISOString(),
    serverReceivedAt:new Date(receivedAt).toISOString(),
  };
}

export function worksiteImpossibleTravel(input:{
  first:{latitude:number;longitude:number;timestamp:string};
  second:{latitude:number;longitude:number;timestamp:string};
  maxKph?:number;
}){
  const a=input.first,b=input.second;
  const hours=(Date.parse(b.timestamp)-Date.parse(a.timestamp))/3_600_000;
  if (!Number.isFinite(hours) || hours <= 0) return false;
  const valid=(x:{latitude:number;longitude:number})=>
    Number.isFinite(x.latitude)&&Math.abs(x.latitude)<=90
    &&Number.isFinite(x.longitude)&&Math.abs(x.longitude)<=180;
  if (!valid(a)||!valid(b)) return false;
  const rad=Math.PI/180;
  const h=Math.sin((b.latitude-a.latitude)*rad/2)**2
    +Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)
      *Math.sin((b.longitude-a.longitude)*rad/2)**2;
  const kilometres=6371.0088*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  return kilometres/hours>(input.maxKph??250);
}

/** Caller controls the backing store; purge cannot touch payroll evidence. */
export async function executePunchPhotoPurge(store:{
  listExpired:(now:Date,limit:number)=>Promise<readonly string[]>;
  deleteExpired:(ids:readonly string[],now:Date)=>Promise<number>;
},now:Date,limit=100){
  if(!Number.isFinite(now.getTime())||!Number.isSafeInteger(limit)||limit<1||limit>1000)
    throw new Error("Invalid photo purge date or batch size.");
  const ids=await store.listExpired(now,limit);
  if(ids.length>limit)throw new Error("Purge candidate selection exceeded its cap.");
  if(!ids.length)return 0;
  return store.deleteExpired(ids,now);
}

export function opaqueDeviceTokenHash(token:string, secret:string) {
  if(!/^[a-f0-9-]{36}$/i.test(token) || secret.length<32)
    throw new Error("Valid random device token and server-side hash key required.");
  return createHmac("sha256",secret).update("wfm-device-v1:").update(token).digest("hex");
}
