/**
 * Source-pinned, provisional tenant-isolation evidence for the three
 * GET/POST/PATCH /api/self/performance methods. No blanket coverage credit.
 * Pure functions only: no application/database imports before the CI guard.
 */
import assert from "node:assert/strict";

export const ENDPOINT="/api/self/performance";
export const METHODS=Object.freeze(["GET","POST","PATCH"]);
export const ROUTE_PATH="src/app/api/self/performance/route.ts";
export const ROUTE_BLOB_SHA="b85a8c7cbc40512c3d77da503c744ac7eb5748dd";

export function requireDisposablePerformance(env=process.env) {
  const required={
    GITHUB_ACTIONS:"true",CI:"true",NODE_ENV:"production",
    TENANT_SECOND_PASS_MODE:"isolated-ci-only",
    TENANT_SELF_PERFORMANCE_MODE:"fictional-only",
    DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL:"http://127.0.0.1:3000",
    DEMO_MODE:"false",
    WORKER_ENABLED:"false",CENTRAL_SCHEDULER_ENABLED:"false",
    PAYMONGO_DISBURSEMENTS_ENABLED:"false",XENDIT_PAYOUTS_ENABLED:"false",
    XENDIT_BILLING_ENABLED:"false",
    HCM_OVERPAYMENT_PREVIEW_ENABLED:"false",PAYROLL_OVERPAYMENT_REVIEW_ENABLED:"false",
  };
  for(const [key,value] of Object.entries(required)){
    assert.equal(env[key],value,"PERFORMANCE_TENANT_REFUSED: "+key);
  }
  assert.ok(String(env.WORKER_TOKEN||"").startsWith("ci-worker-token-"),
    "PERFORMANCE_TENANT_REFUSED: fictional worker credential only");
  for(const name of ["PAYMONGO_SECRET_KEY","XENDIT_SECRET_KEY",
    "XENDIT_PAYOUT_SECRET_KEY","RESEND_API_KEY","POSTMARK_SERVER_TOKEN",
    "SMTP_URL","STRIPE_SECRET_KEY","DATABASE_URL_DIRECT"]){
    assert.ok(!env[name],"PERFORMANCE_TENANT_REFUSED: external provider "+name);
  }
  for(const name of ["VERCEL","VERCEL_URL","VERCEL_ENV","NEON_DATABASE_URL","NEON_API_KEY"]){
    assert.ok(!env[name],"PERFORMANCE_TENANT_REFUSED: hosted environment "+name);
  }
}

export function assertNoLeak(response,forbidden=[]){
  const serialized=String(response?.text??JSON.stringify(response?.json??{}));
  for(const marker of forbidden){
    if(marker)assert.ok(!serialized.includes(marker),"other employee or employer marker leaked: "+marker);
  }
}

export function assertOwnRead(response,actor,forbidden=[],agendaCount=1,score=null){
  assert.equal(response.status,200,"real owner employee GET must return 200");
  const data=response.json;
  assert.ok(data&&typeof data==="object");
  assert.deepEqual(Object.keys(data).sort(),["feedback","goals","oneOnOnes","reviews"]);
  assert.ok(Array.isArray(data.reviews)&&data.reviews.length===1,"nonempty, exact own review mandatory");
  assert.ok(Array.isArray(data.goals)&&data.goals.length===1,"nonempty own goal mandatory");
  assert.ok(Array.isArray(data.oneOnOnes)&&data.oneOnOnes.length===1,"nonempty own 1:1 mandatory");
  assert.ok(Array.isArray(data.feedback)&&data.feedback.length===1,"shared feedback only");
  const review=data.reviews[0],meeting=data.oneOnOnes[0];
  assert.equal(review.id,actor.profile.review.id);
  assert.equal(review.organizationId,actor.org.id);
  assert.equal(review.employeeId,actor.worker.id);
  assert.equal(review.cycle.id,actor.profile.cycle.id);
  assert.equal(review.cycle.organizationId,actor.org.id);
  assert.equal(review.items.length,1,"exact one scoped competency required");
  assert.equal(review.items[0].id,actor.profile.item.id);
  assert.equal(review.items[0].template.id,actor.profile.template.id);
  assert.equal(review.items[0].cycleTemplate.id,actor.profile.cycleTemplate.id);
  if(score!==null)assert.equal(review.selfScore,score);
  assert.equal(data.goals[0].id,actor.profile.goal.id);
  assert.equal(data.goals[0].employeeId,actor.worker.id);
  assert.equal(meeting.id,actor.profile.meeting.id);
  assert.equal(meeting.status,"scheduled");
  assert.ok(meeting.agenda.includes(actor.profile.marker));
  assert.ok(!Object.hasOwn(meeting,"privateManagerNotes"),"private manager notes cannot appear in ESS");
  assert.ok(Array.isArray(meeting.agendaContributions)&&meeting.agendaContributions.length===agendaCount);
  assert.ok(meeting.agendaContributions.some(x=>x.id===actor.profile.seedAgenda.id));
  assert.ok(Array.isArray(meeting.actionItems)&&meeting.actionItems.length===1,"private action item must be hidden");
  assert.equal(meeting.actionItems[0].id,actor.profile.sharedAction.id);
  assert.equal(data.feedback[0].id,actor.profile.sharedFeedback.id);
  assertNoLeak(response,forbidden);
  return data;
}

export function assertOwnPost(response,actor,content){
  assert.equal(response.status,201,"own agenda contribution must be persisted via actual HTTP 201");
  const row=response.json;
  assert.ok(row&&Number.isSafeInteger(row.id)&&row.id>0);
  assert.equal(row.organizationId,actor.org.id);
  assert.equal(row.employeeId,actor.worker.id);
  assert.equal(row.oneOnOneId,actor.profile.meeting.id);
  assert.equal(row.authorUserId,actor.self.userId);
  assert.equal(row.authorEmployeeId,actor.worker.id);
  assert.equal(row.authorName,actor.self.name);
  assert.equal(row.content,content);
  return row;
}

export function assertOwnPatch(response,actor,input){
  assert.equal(response.status,200,"own self-assessment must succeed via HTTP 200");
  const row=response.json;
  assert.ok(row&&typeof row==="object");
  assert.equal(row.id,actor.profile.review.id);
  assert.equal(row.organizationId,actor.org.id);
  assert.equal(row.employeeId,actor.worker.id);
  assert.equal(row.cycleId,actor.profile.cycle.id);
  assert.equal(row.selfScore,input.selfScore);
  assert.equal(row.employeeReflection,input.employeeReflection);
  assert.ok(Array.isArray(row.items)&&row.items.length===1);
  assert.equal(row.items[0].id,actor.profile.item.id);
  assert.equal(row.items[0].reviewId,actor.profile.review.id);
  assert.equal(row.items[0].selfScore,input.itemScore);
  assert.equal(row.items[0].employeeComment,input.employeeComment);
  return row;
}

export function assertDenied(response,status,markers=[]){
  assert.equal(response.status,status,
    "must fail with exact status; response "+String(response.text).slice(0,140));
  assert.ok(response.json&&typeof response.json.error==="string","denied response needs an error");
  for(const k of ["reviews","goals","oneOnOnes","feedback","items","content","employeeReflection"]){
    assert.ok(!Object.hasOwn(response.json,k),"denied response leaked "+k);
  }
  assertNoLeak(response,markers);
}
export function assertUnchanged(before,after,label){
  assert.deepEqual(after,before,label+" must preserve real employer HR, payroll and audit rows");
}
export function assertOneAuditAdded(before,after,actor,action,metadataKey,resourceId){
  assert.equal(after.audit.length,before.audit.length+1,"exactly one audit event required");
  assert.deepEqual(after.audit.slice(0,before.audit.length),before.audit,
    "existing audit events must be unchanged");
  const event=after.audit.at(-1);
  assert.equal(event.organizationId,actor.org.id);
  assert.equal(event.actor,actor.self.name);
  assert.equal(event.action,action);
  assert.equal(event.metadata?.[metadataKey],resourceId);
  return event;
}
