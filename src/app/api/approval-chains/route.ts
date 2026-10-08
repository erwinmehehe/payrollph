import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalChainPolicies } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, ORG_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { validateApprovalChainSteps } from "@/lib/approval-chains";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    ORG_ADMIN_ROLES,
    "Only company-wide administrators can manage approval chains.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Approval-chain administration requires company-wide access." }, { status: 403 });
  }

  const policies = await db.select().from(approvalChainPolicies)
    .where(eq(approvalChainPolicies.organizationId, organizationId))
    .orderBy(approvalChainPolicies.code);
  return Response.json({ policies });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const demoDenied = publicDemoMutationDenied(user.email, "Approval chains");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    ORG_ADMIN_ROLES,
    "Only company-wide administrators can manage approval chains.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Approval-chain administration requires company-wide access." }, { status: 403 });
  }

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `approval-chain-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "save-policy") {
    const id = body.id ? Number(body.id) : null;
    const code = String(body.code ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim();
    const purpose = String(body.purpose ?? "automation").trim().toLowerCase();
    const steps = validateApprovalChainSteps(body.steps);
    if (!["automation", "workforce_plan"].includes(purpose)) {
      return Response.json({ error: "Approval-chain purpose must be automation or workforce_plan." }, { status: 400 });
    }
    if (!/^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$/.test(code) || !name || !steps) {
      return Response.json({
        error: "A valid code, name, and 1-12 ordered approval steps are required.",
      }, { status: 400 });
    }

    if (id) {
      const [existing] = await db.select().from(approvalChainPolicies).where(and(
        eq(approvalChainPolicies.id, id),
        eq(approvalChainPolicies.organizationId, organizationId),
      )).limit(1);
      if (!existing) return Response.json({ error: "Approval chain not found." }, { status: 404 });

      const [updated] = await db.transaction(async (tx) => {
        if (existing.active && purpose === "workforce_plan") {
          await tx.update(approvalChainPolicies).set({
            active: false,
            updatedAt: new Date(),
          }).where(and(
            eq(approvalChainPolicies.organizationId, organizationId),
            eq(approvalChainPolicies.purpose, "workforce_plan"),
            eq(approvalChainPolicies.active, true),
          ));
        }
        return tx.update(approvalChainPolicies).set({
          code,
          name: name.slice(0, 160),
          purpose: purpose.slice(0, 40),
          steps,
          active: existing.active,
          version: existing.version + 1,
          updatedAt: new Date(),
        }).where(and(
          eq(approvalChainPolicies.id, id),
          eq(approvalChainPolicies.organizationId, organizationId),
        )).returning();
      });

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Approval chain policy updated",
        resource: updated.name,
        metadata: { policyId: updated.id, code: updated.code, purpose: updated.purpose, version: updated.version, stepCount: steps.length, minimumAmounts: steps.map((step) => step.minimumAmount ?? 0) },
      });
      return Response.json(updated);
    }

    try {
      const [created] = await db.transaction(async (tx) => {
        if (purpose === "workforce_plan") {
          await tx.update(approvalChainPolicies).set({
            active: false,
            updatedAt: new Date(),
          }).where(and(
            eq(approvalChainPolicies.organizationId, organizationId),
            eq(approvalChainPolicies.purpose, "workforce_plan"),
            eq(approvalChainPolicies.active, true),
          ));
        }
        return tx.insert(approvalChainPolicies).values({
          organizationId,
          code,
          name: name.slice(0, 160),
          purpose: purpose.slice(0, 40),
          version: 1,
          steps,
          active: true,
          createdByUserId: user.id,
        }).returning();
      });

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Approval chain policy created",
        resource: created.name,
        metadata: { policyId: created.id, code: created.code, purpose: created.purpose, version: created.version, stepCount: steps.length, minimumAmounts: steps.map((step) => step.minimumAmount ?? 0) },
      });
      return Response.json(created, { status: 201 });
    } catch {
      return Response.json({ error: "An approval chain with this code already exists." }, { status: 409 });
    }
  }

  if (action === "set-active") {
    const id = Number(body.id);
    if (!Number.isInteger(id)) return Response.json({ error: "id is required." }, { status: 400 });
    const [existing] = await db.select().from(approvalChainPolicies).where(and(
      eq(approvalChainPolicies.id, id),
      eq(approvalChainPolicies.organizationId, organizationId),
    )).limit(1);
    if (!existing) return Response.json({ error: "Approval chain not found." }, { status: 404 });

    const nextActive = Boolean(body.active);
    const [updated] = await db.transaction(async (tx) => {
      if (nextActive && existing.purpose === "workforce_plan") {
        await tx.update(approvalChainPolicies).set({
          active: false,
          updatedAt: new Date(),
        }).where(and(
          eq(approvalChainPolicies.organizationId, organizationId),
          eq(approvalChainPolicies.purpose, "workforce_plan"),
          eq(approvalChainPolicies.active, true),
        ));
      }
      return tx.update(approvalChainPolicies).set({
        active: nextActive,
        updatedAt: new Date(),
      }).where(and(
        eq(approvalChainPolicies.id, id),
        eq(approvalChainPolicies.organizationId, organizationId),
      )).returning();
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: updated.active ? "Approval chain policy enabled" : "Approval chain policy disabled",
      resource: updated.name,
      metadata: { policyId: updated.id, code: updated.code, purpose: updated.purpose, version: updated.version },
    });
    return Response.json(updated);
  }

  return Response.json({ error: "Unsupported approval-chain action." }, { status: 400 });
}
