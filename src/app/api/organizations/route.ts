import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, userOrganizations } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { assertPermission } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { demoMutationBlocked } from "@/lib/demo";

export const dynamic = "force-dynamic";

/** Roles permitted to rename the legal entity / workspace defaults. */
const ADMINS = new Set(["admin", "owner"]);

export async function PUT(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (user.demo) return demoMutationBlocked("Changing organization settings");

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const denied = await assertPermission(user.id, organizationId, "organization:write");
  if (denied) return denied;

  const [membership] = await db.select().from(userOrganizations)
    .where(and(eq(userOrganizations.userId, user.id), eq(userOrganizations.organizationId, organizationId)))
    .limit(1);
  const role = membership?.role ?? "";
  if (!ADMINS.has(role)) {
    return Response.json({ error: `Your role (${role || "member"}) cannot edit the organization profile.` }, { status: 403 });
  }

  const [current] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!current) return Response.json({ error: "Organization not found." }, { status: 404 });
  const name = String(body.name ?? "").trim();
  const legalName = String(body.legalName ?? "").trim();
  if (name.length < 2) return Response.json({ error: "Company name must be at least 2 characters." }, { status: 422 });
  const annualDivisorRaw = body.payrollAnnualDivisor == null ? Number(current.payrollAnnualDivisor) : Number(body.payrollAnnualDivisor);
  if (!Number.isFinite(annualDivisorRaw) || annualDivisorRaw < 200 || annualDivisorRaw > 400) return Response.json({ error: "Annual pay divisor must be between 200 and 400 days." }, { status: 422 });
  const statutoryDeductionMode = String(body.statutoryDeductionMode ?? current.statutoryDeductionMode ?? "split_evenly");
  if (!["split_evenly", "second_cutoff"].includes(statutoryDeductionMode)) return Response.json({ error: "Statutory deduction mode must be split_evenly or second_cutoff." }, { status: 422 });
  const [updated] = await db.update(organizations).set({ name, legalName: legalName || name, payrollAnnualDivisor: annualDivisorRaw.toFixed(2), statutoryDeductionMode }).where(eq(organizations.id, organizationId)).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Organization profile updated",
    resource: updated.name,
    metadata: { legalName: updated.legalName, payrollAnnualDivisor: updated.payrollAnnualDivisor, statutoryDeductionMode: updated.statutoryDeductionMode },
  });

  return Response.json({ ok: true, organization: updated });
}
