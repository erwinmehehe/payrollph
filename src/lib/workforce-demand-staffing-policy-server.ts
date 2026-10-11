import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents, jobProfiles, workforceDemandStaffingPolicies,
  workforceDemandStaffingPolicyEvents, worksites,
} from "@/db/schema";
import { demandSha256 } from "./workforce-issued-demand-evidence";
import {
  type StaffingPolicyDraft, type StaffingPolicySpec, type StaffingPolicyTransition,
  policySpec, policyDatesOverlap, samePolicyScope,
} from "./workforce-demand-staffing-policy";
import { operationalDemandSiteAuthorized } from "./workforce-operational-demand-scope";
import { manilaCalendarDate } from "./payroll-period-ui";

type Access = {
  organizationId: number; companyWide: boolean; orgUnitId: number | null;
};
type PolicyRow = typeof workforceDemandStaffingPolicies.$inferSelect;
type EventRow = typeof workforceDemandStaffingPolicyEvents.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class StaffingPolicyConflict extends Error {}
export class StaffingPolicyUnauthorized extends Error {}

function policyFromRow(row: PolicyRow): StaffingPolicySpec {
  return {
    organizationId: row.organizationId, worksiteId: row.worksiteId,
    jobProfileId: row.jobProfileId,
    metricKind: row.metricKind as StaffingPolicySpec["metricKind"],
    intervalMinutes: row.intervalMinutes as 15 | 30 | 60,
    effectiveFrom: String(row.effectiveFrom), effectiveUntil: String(row.effectiveUntil),
    productiveUnitsPerWorkerHour: Number(row.productiveUnitsPerWorkerHour),
    serviceTargetCoveragePercent: Number(row.serviceTargetCoveragePercent),
    rationale: row.rationale,
  };
}
function contentHash(spec: StaffingPolicySpec, version: number) {
  return demandSha256({ version, spec: policySpec(spec) });
}
export function policyEventReceipt(input: {
  organizationId: number; policyId: number; actorUserId: number;
  action: string; occurredAt: string; policySha256: string;
  priorPolicyId: number | null; decisionNote: string;
}) {
  return demandSha256(input);
}
function validPolicyRow(row: PolicyRow) {
  return contentHash(policyFromRow(row), row.version) === row.contentSha256;
}
function validApprovalReceipt(row: PolicyRow, event: EventRow | undefined) {
  if (!event || event.organizationId !== row.organizationId ||
    event.policyId !== row.id || event.action !== "approved" ||
    event.policySha256 !== row.contentSha256 ||
    row.decidedByUserId !== event.actorUserId ||
    row.decidedAt?.toISOString() !== event.occurredAt.toISOString()) return false;
  return event.receiptSha256 === policyEventReceipt({
    organizationId: event.organizationId, policyId: event.policyId,
    actorUserId: event.actorUserId, action: event.action,
    occurredAt: event.occurredAt.toISOString(),
    policySha256: event.policySha256, priorPolicyId: event.priorPolicyId,
    decisionNote: event.decisionNote,
  });
}
async function ensureScope(tx: Tx, spec: {
  organizationId: number; worksiteId: number; jobProfileId: number | null;
}, access: Access) {
  if (!access.companyWide || access.organizationId !== spec.organizationId) {
    throw new StaffingPolicyUnauthorized("Company-wide People administrator required.");
  }
  const [site] = await tx.select({
    organizationId: worksites.organizationId, orgUnitId: worksites.orgUnitId,
    active: worksites.active, timezone: worksites.timezone,
  }).from(worksites).where(and(
    eq(worksites.organizationId, spec.organizationId),
    eq(worksites.id, spec.worksiteId),
  )).limit(1);
  if (!site || !operationalDemandSiteAuthorized(access,site) ||
    site.timezone !== "Asia/Manila") {
    throw new StaffingPolicyUnauthorized("Active Philippine worksite not in employer scope.");
  }
  if (spec.jobProfileId !== null) {
    const [role] = await tx.select({id:jobProfiles.id}).from(jobProfiles).where(and(
      eq(jobProfiles.organizationId,spec.organizationId),
      eq(jobProfiles.id,spec.jobProfileId),
      eq(jobProfiles.active,true),
    )).limit(1);
    if (!role) throw new StaffingPolicyUnauthorized("Job profile is unavailable for employer.");
  }
}
async function addEvent(tx: Tx, input: {
  organizationId: number; policyId: number; actorUserId: number;
  action: "created" | "submitted" | "approved" | "rejected" | "superseded";
  at: Date; policySha256: string;
  priorPolicyId?: number | null; decisionNote?: string;
}) {
  const event = {
    organizationId: input.organizationId, policyId: input.policyId,
    actorUserId: input.actorUserId, action: input.action,
    occurredAt: input.at, policySha256: input.policySha256,
    priorPolicyId: input.priorPolicyId ?? null,
    decisionNote: input.decisionNote ?? "",
  };
  const receiptSha256 = policyEventReceipt({
    ...event, occurredAt: event.occurredAt.toISOString(),
  });
  await tx.insert(workforceDemandStaffingPolicyEvents).values({
    ...event, receiptSha256,
  });
  await tx.insert(auditEvents).values({
    organizationId: input.organizationId,
    actor: "WFM administrator user:" + input.actorUserId,
    action: "WFM staffing policy " + input.action,
    resource: "staffing-policy:" + input.policyId,
    metadata: {
      policyId: input.policyId, action: input.action,
      policySha256: input.policySha256, receiptSha256,
      priorPolicyId: event.priorPolicyId,
    },
  });
  return receiptSha256;
}
async function lockOrganization(tx: Tx, organizationId: number) {
  await tx.execute(sql`select pg_advisory_xact_lock(8864, ${organizationId})`);
}
function scopeWhere(spec: StaffingPolicySpec) {
  return and(
    eq(workforceDemandStaffingPolicies.organizationId,spec.organizationId),
    eq(workforceDemandStaffingPolicies.worksiteId,spec.worksiteId),
    spec.jobProfileId === null ? isNull(workforceDemandStaffingPolicies.jobProfileId)
      : eq(workforceDemandStaffingPolicies.jobProfileId,spec.jobProfileId),
    eq(workforceDemandStaffingPolicies.metricKind,spec.metricKind),
    eq(workforceDemandStaffingPolicies.intervalMinutes,spec.intervalMinutes),
  );
}

export async function createStaffingPolicyDraft(input: {
  spec: StaffingPolicyDraft; actorUserId: number; access: Access;
}) {
  const {idempotencyKey, ...raw} = input.spec;
  const spec = policySpec(raw);
  return db.transaction(async tx => {
    await lockOrganization(tx,spec.organizationId);
    await ensureScope(tx,spec,input.access);
    if (spec.effectiveFrom < manilaCalendarDate()) {
      throw new StaffingPolicyConflict("Retroactive productivity proposals are not allowed.");
    }
    const [priorRequest] = await tx.select().from(workforceDemandStaffingPolicies)
      .where(and(
        eq(workforceDemandStaffingPolicies.organizationId,spec.organizationId),
        eq(workforceDemandStaffingPolicies.idempotencyKey,idempotencyKey),
      )).limit(1);
    if (priorRequest) {
      if (!validPolicyRow(priorRequest) ||
        JSON.stringify(policyFromRow(priorRequest)) !== JSON.stringify(spec)) {
        throw new StaffingPolicyConflict("Idempotency key already belongs to another policy.");
      }
      return { id:priorRequest.id, version:priorRequest.version,
        status:priorRequest.status, replayed:true,
        contentSha256:priorRequest.contentSha256 };
    }
    const rows = await tx.select({
      version: workforceDemandStaffingPolicies.version,
    }).from(workforceDemandStaffingPolicies).where(scopeWhere(spec))
      .orderBy(desc(workforceDemandStaffingPolicies.version)).limit(1);
    const version = (rows[0]?.version ?? 0) + 1;
    if (version > 10000) throw new StaffingPolicyConflict("Policy revision limit reached.");
    const hash = contentHash(spec,version);
    const [created] = await tx.insert(workforceDemandStaffingPolicies).values({
      ...spec, version,
      productiveUnitsPerWorkerHour: spec.productiveUnitsPerWorkerHour.toFixed(4),
      serviceTargetCoveragePercent: spec.serviceTargetCoveragePercent.toFixed(2),
      contentSha256:hash, idempotencyKey, status:"draft",
      proposedByUserId:input.actorUserId,
    }).returning({id:workforceDemandStaffingPolicies.id});
    await addEvent(tx,{
      organizationId:spec.organizationId,policyId:created.id,
      actorUserId:input.actorUserId,action:"created",
      at:new Date(),policySha256:hash,
    });
    return {id:created.id,version,status:"draft",replayed:false,contentSha256:hash};
  });
}

export async function transitionStaffingPolicy(input: {
  change: StaffingPolicyTransition;
  actorUserId: number; actorRole: string; access: Access;
}) {
  const {change,actorUserId}=input;
  return db.transaction(async tx => {
    await lockOrganization(tx,change.organizationId);
    const [row] = await tx.select().from(workforceDemandStaffingPolicies).where(and(
      eq(workforceDemandStaffingPolicies.organizationId,change.organizationId),
      eq(workforceDemandStaffingPolicies.id,change.policyId),
    )).limit(1);
    if (!row) throw new StaffingPolicyConflict("Policy does not exist for this employer.");
    await ensureScope(tx,policyFromRow(row),input.access);
    if (!validPolicyRow(row)) throw new StaffingPolicyConflict("Stored policy content hash does not match.");
    const at = new Date();
    if (change.action === "submit") {
      if (row.status !== "draft" || row.proposedByUserId !== actorUserId) {
        throw new StaffingPolicyConflict("Only the draft author can submit an unchanged proposal.");
      }
      const [updated] = await tx.update(workforceDemandStaffingPolicies).set({
        status:"submitted",submittedByUserId:actorUserId,submittedAt:at,updatedAt:at,
      }).where(and(
        eq(workforceDemandStaffingPolicies.id,row.id),
        eq(workforceDemandStaffingPolicies.status,"draft"),
      )).returning({id:workforceDemandStaffingPolicies.id});
      if(!updated)throw new StaffingPolicyConflict("Policy was changed concurrently.");
      await addEvent(tx,{organizationId:row.organizationId,policyId:row.id,
        actorUserId,action:"submitted",at,policySha256:row.contentSha256});
      return {id:row.id,status:"submitted",contentSha256:row.contentSha256};
    }
    if (!["owner","admin"].includes(input.actorRole) ||
      row.proposedByUserId===actorUserId || row.submittedByUserId===actorUserId) {
      throw new StaffingPolicyUnauthorized("Independent company owner/admin approver required.");
    }
    if (row.status !== "submitted" || row.submittedByUserId === null) {
      throw new StaffingPolicyConflict("Only a submitted policy can be decided.");
    }
    if (change.action === "approve" && String(row.effectiveFrom) < manilaCalendarDate()) {
      throw new StaffingPolicyConflict("Cannot approve a policy whose effective period already started.");
    }
    let replaced:PolicyRow|null=null;
    if (change.action === "approve") {
      const approved = await tx.select().from(workforceDemandStaffingPolicies).where(and(
        scopeWhere(policyFromRow(row)),
        eq(workforceDemandStaffingPolicies.status,"approved"),
        lte(workforceDemandStaffingPolicies.effectiveFrom,row.effectiveUntil),
        gte(workforceDemandStaffingPolicies.effectiveUntil,row.effectiveFrom),
      )).orderBy(asc(workforceDemandStaffingPolicies.id));
      if (approved.length > 1) throw new StaffingPolicyConflict("Conflicting approved policy windows.");
      if (approved.length === 1) {
        const previous=approved[0];
        if (!validPolicyRow(previous) ||
          String(previous.effectiveFrom) !== String(row.effectiveFrom) ||
          String(previous.effectiveUntil) !== String(row.effectiveUntil)) {
          throw new StaffingPolicyConflict("Overlapping policy windows need explicit, whole-window revision.");
        }
        replaced=previous;
        await tx.update(workforceDemandStaffingPolicies).set({
          status:"superseded",updatedAt:at,
        }).where(and(
          eq(workforceDemandStaffingPolicies.id,previous.id),
          eq(workforceDemandStaffingPolicies.status,"approved"),
        ));
        await addEvent(tx,{
          organizationId:previous.organizationId,policyId:previous.id,actorUserId,
          action:"superseded",at,policySha256:previous.contentSha256,
          priorPolicyId:null,decisionNote:"Replaced by newly approved policy #" + row.id,
        });
      }
    }
    const status=change.action==="approve"?"approved":"rejected";
    const [updated]=await tx.update(workforceDemandStaffingPolicies).set({
      status,decidedByUserId:actorUserId,decidedAt:at,updatedAt:at,
    }).where(and(
      eq(workforceDemandStaffingPolicies.id,row.id),
      eq(workforceDemandStaffingPolicies.status,"submitted"),
    )).returning({id:workforceDemandStaffingPolicies.id});
    if(!updated)throw new StaffingPolicyConflict("Policy decision changed concurrently.");
    const receiptSha256=await addEvent(tx,{
      organizationId:row.organizationId,policyId:row.id,actorUserId,
      action:status,at,policySha256:row.contentSha256,
      priorPolicyId:replaced?.id??null,
      decisionNote:change.decisionNote.trim(),
    });
    return {id:row.id,status,version:row.version,
      contentSha256:row.contentSha256,
      approvalReceiptSha256:change.action==="approve"?receiptSha256:null,
      supersededPolicyId:replaced?.id??null};
  });
}

export async function readStaffingPolicies(input: {
  organizationId: number; worksiteId: number; jobProfileId: number|null;
  metricKind: StaffingPolicySpec["metricKind"]; intervalMinutes:15|30|60;
  mode:"approved"|"manage";
}) {
  const spec:StaffingPolicySpec={
    organizationId:input.organizationId,worksiteId:input.worksiteId,
    jobProfileId:input.jobProfileId,metricKind:input.metricKind,
    intervalMinutes:input.intervalMinutes,effectiveFrom:"2000-01-01",
    effectiveUntil:"2100-01-01",productiveUnitsPerWorkerHour:1,
    serviceTargetCoveragePercent:100,rationale:"Scope-only authorized read",
  };
  const rows=await db.select().from(workforceDemandStaffingPolicies)
    .where(and(scopeWhere(spec),input.mode==="approved"?
      eq(workforceDemandStaffingPolicies.status,"approved"):undefined))
    .orderBy(desc(workforceDemandStaffingPolicies.version)).limit(80);
  const ids=rows.map(row=>row.id);
  const decisions=ids.length?await db.select().from(workforceDemandStaffingPolicyEvents)
    .where(and(eq(workforceDemandStaffingPolicyEvents.organizationId,input.organizationId),
      eq(workforceDemandStaffingPolicyEvents.action,"approved"),
      inArray(workforceDemandStaffingPolicyEvents.policyId, ids),
    )):[];
  const byPolicy=new Map(decisions.map(event=>[event.policyId,event]));
  return rows.map(row=>{
    const spec=policyFromRow(row);
    const approval=byPolicy.get(row.id);
    const integrity=validPolicyRow(row) &&
      (row.status!=="approved" || validApprovalReceipt(row,approval))?
      "matches_hash" as const:"source_review" as const;
    return {
      ...spec,id:row.id,version:row.version,status:row.status,
      createdAt:row.createdAt.toISOString(),
      submittedAt:row.submittedAt?.toISOString()??null,
      approvedAt:row.status==="approved"?row.decidedAt?.toISOString()??null:null,
      contentSha256:row.contentSha256,
      approvalReceiptSha256:approval?.receiptSha256??null,
      approvalIntegrity:integrity,
    };
  });
}
