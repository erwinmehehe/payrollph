import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { workflowEntityHold } from "@/lib/workflow-entity-hold";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { rateLimitDistributed } from "@/lib/rate-limit";
import { careersNoticeConfig, careersSchemaReady, canManagePublicCareers } from "@/lib/careers-privacy-gates";

export const dynamic = "force-dynamic";
const unavailable = () => Response.json({ error: "Careers publishing unavailable." }, { status: 404 });

export async function PATCH(request: Request) {
  // A multi-entity request must be denied explicitly even when notice
  // configuration is absent; never fall through to role or data queries.
  const hold = workflowEntityHold(); if (hold) return hold;
  if (!careersNoticeConfig()) return unavailable();
  const origin = enforceSameOriginMutation(request); if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const requisitionId = Number(body.requisitionId);
  if (![organizationId, requisitionId].every(n => Number.isSafeInteger(n) && n > 0) ||
      typeof body.published !== "boolean" || typeof body.expectedPublished !== "boolean" ||
      body.expectedPublished === body.published) {
    return Response.json({ error: "Expected/current publication state and a valid employer/requisition are required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access || !canManagePublicCareers(access)) {
    return Response.json({ error: "Company-wide HR authorization is required." }, { status: 403 });
  }
  const mfa = requireSensitiveActionMfa(user);
  if (mfa) return mfa;

  // A privileged publish operation may not silently fall back to a local-only
  // rate counter during Postgres outage; it must be shared across instances.
  const rate = await rateLimitDistributed("careers-publish:" + user.id + ":" + organizationId, {
    limit: 8, windowMs: 5 * 60_000,
  });
  if (rate.mode !== "distributed-postgres") {
    return Response.json({ error: "Publishing security check is unavailable." }, { status: 503 });
  }
  if (!rate.allowed) {
    return Response.json({ error: "Too many publishing attempts." }, {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))) },
    });
  }
  if (!await careersSchemaReady()) {
    return Response.json({ error: "Careers publishing database prerequisites are unavailable." }, { status: 503 });
  }

  // Compare-and-swap closes stale-tab toggles and parallel duplicate audits.
  // Even a previously published, since-filled job may be UNpublished, never
  // newly published. A linked position must still be open in this employer.
  const saved = await db.transaction(async tx => {
    const result = await tx.execute<{ id: number; careers_published: boolean }>(sql`
      update job_requisitions as req
         set careers_published = ${body.published}
       where req.id = ${requisitionId}
         and req.organization_id = ${organizationId}
         and req.careers_published = ${body.expectedPublished}
         and (${body.published} = false or (
           req.status in ('open', 'interviewing')
           and req.position_id is not null
           and exists (
             select 1 from positions as p
              where p.id = req.position_id
                and p.organization_id = req.organization_id
                and p.status = 'open'
           )
         ))
       returning req.id, req.careers_published
    `);
    const row = result.rows[0];
    if (!row) return null;
    await tx.insert(auditEvents).values({
      organizationId, actor: user.name,
      action: row.careers_published ? "Careers requisition published" : "Careers requisition unpublished",
      resource: String(row.id),
      metadata: { requestedByUserId: user.id, requisitionId: row.id },
    });
    return row;
  });
  if (!saved) return Response.json({
    error: "Requisition publication or position status changed; reload before trying again.",
  }, { status: 409 });
  return Response.json({ id: saved.id, published: saved.careers_published }, {
    headers: { "Cache-Control": "no-store" },
  });
}
