import { createHmac } from "node:crypto";

/** HMAC pseudonym never exposes worker/user ID, still allows one response per survey. */
export function anonymousSurveyResponderHash(input: {
 organizationId:number;surveyId:number;userId:number;secret:string;
}) {
 const {organizationId,surveyId,userId,secret}=input;
 if(![organizationId,surveyId,userId].every(v=>Number.isSafeInteger(v)&&v>0)
  ||secret.length<32)throw Error("Survey anonymity signing key or respondent scope invalid.");
 return createHmac("sha256",secret)
   .update(`pulse:v1:${organizationId}:${surveyId}:${userId}`).digest("hex");
}
export const MINIMUM_ANONYMOUS_GROUP_SIZE=5;
/** No interim totals: release one sealed survey aggregate only after closure. */
export function aggregateClosedPulse(input:{
 status:"open"|"closed";scores:readonly number[];
}):{visible:false}|{visible:true;count:number;average:number;distribution:number[]} {
 if(input.status!=="closed"||input.scores.length<MINIMUM_ANONYMOUS_GROUP_SIZE)
   return {visible:false};
 const totals=[0,0,0,0,0];
 let sum=0;
 for(const score of input.scores){
  if(!Number.isInteger(score)||score<1||score>5)throw Error("Invalid pulse score.");
  totals[score-1]+=1;sum+=score;
 }
 return {visible:true,count:input.scores.length,
  average:Math.round(sum/input.scores.length*100)/100,distribution:totals};
}
/** The goal writer and reviewer must be different human user IDs. */
export function canIndependentlyReviewGoal(input:{
 makerUserId:number;reviewerUserId:number;
 subjectEmployeeId:number;reviewerEmployeeId?:number|null;alreadyReviewed:boolean;
}){
 return Number.isSafeInteger(input.makerUserId)&&input.makerUserId>0
  &&Number.isSafeInteger(input.reviewerUserId)&&input.reviewerUserId>0
  &&Number.isSafeInteger(input.subjectEmployeeId)&&input.subjectEmployeeId>0
  &&(input.reviewerEmployeeId==null ||
      (Number.isSafeInteger(input.reviewerEmployeeId) && input.reviewerEmployeeId>0))
  &&input.makerUserId!==input.reviewerUserId
  // Compare employee IDs to employee IDs, not user IDs to employee IDs.
  &&(input.reviewerEmployeeId==null||input.reviewerEmployeeId!==input.subjectEmployeeId)
  &&!input.alreadyReviewed;
}


/**
 * Never query or reveal individual answers after closure. A sealed aggregate
 * is visible only if it represents >=5 scores and the retained distribution,
 * count and rounded mean are internally consistent.
 */
export function revealSealedPulseAggregate(input: {
  status: "open" | "closed";
  count: number | null;
  average: string | null;
  distribution: unknown;
}): ReturnType<typeof aggregateClosedPulse> {
  const { status, count, average, distribution } = input;
  if (status !== "closed" || count === null ||
      !Number.isSafeInteger(count) || count < MINIMUM_ANONYMOUS_GROUP_SIZE ||
      !Array.isArray(distribution) || distribution.length !== 5 ||
      !distribution.every(value => Number.isSafeInteger(value) && value >= 0)) {
    return { visible: false };
  }
  const total = distribution.reduce((sum: number, value: number) => sum + value, 0);
  if (total !== count) return { visible: false };
  const weighted = distribution.reduce(
    (sum: number, value: number, index: number) => sum + value * (index + 1), 0
  );
  const mean = Math.round(weighted / count * 100) / 100;
  if (typeof average !== "string" || !/^[1-5](?:\.\d{1,2})?$/.test(average) ||
      Number(average) !== mean) {
    return { visible: false };
  }
  return { visible: true, count, average: mean, distribution };
}
