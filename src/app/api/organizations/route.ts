import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, userOrganizations } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { assertMembership, getAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";

/** Roles permitted to rename the legal entity / workspace defaults. */
const ADMINS = new Set(["admin", "owner", "bookkeeper"]);

export async function PUT(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Organization settings");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;

  const [membership] = await db.select().from(userOrganizations)
    .where(and(eq(userOrganizations.userId, user.id), eq(userOrganizations.organizationId, organizationId)))
    .limit(1);
  const role = membership?.role ?? "";
  if (!ADMINS.has(role)) {
    return Response.json({ error: `Your role (${role || "member"}) cannot edit the organization profile.` }, { status: 403 });
  }
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Organization-wide settings require company-wide administrator access." }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  const [existing] = await db.select().from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!existing) return Response.json({ error: "Organization not found." }, { status: 404 });

  const name = body.name === undefined ? existing.name : String(body.name ?? "").trim();
  const legalName = body.legalName === undefined ? existing.legalName : String(body.legalName ?? "").trim();
  if (name.length < 2) return Response.json({ error: "Company name must be at least 2 characters." }, { status: 422 });

  const clean = (value: unknown) => {
    if (value === undefined) return undefined;
    const text = String(value ?? "").trim();
    return text || null;
  };
  const birTinRaw = clean(body.birTin);
  const birTin = birTinRaw === undefined || birTinRaw === null ? birTinRaw : birTinRaw.replace(/\D/g, "");
  if (typeof birTin === "string" && birTin.length !== 9) {
    return Response.json({ error: "BIR employer TIN must contain exactly 9 digits." }, { status: 422 });
  }
  const birBranchRaw = clean(body.birBranchCode);
  const birBranchCode = birBranchRaw === undefined || birBranchRaw === null
    ? birBranchRaw
    : birBranchRaw.replace(/\D/g, "").padStart(4, "0");
  if (typeof birBranchCode === "string" && birBranchCode.length !== 4) {
    return Response.json({ error: "BIR branch code must contain at most 4 digits." }, { status: 422 });
  }

  const governmentFields = {
    birTin,
    birBranchCode,
    sssEmployerNo: clean(body.sssEmployerNo),
    philHealthEmployerNo: clean(body.philHealthEmployerNo),
    pagIbigEmployerNo: clean(body.pagIbigEmployerNo),
  };
  const governmentPatch = Object.fromEntries(
    Object.entries(governmentFields).filter(([, value]) => value !== undefined),
  );

  const [updated] = await db.update(organizations).set({
    name,
    legalName: legalName || name,
    ...governmentPatch,
  }).where(eq(organizations.id, organizationId)).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Organization profile updated",
    resource: updated.name,
    metadata: {
      legalName: updated.legalName,
      governmentFieldsUpdated: Object.keys(governmentPatch),
    },
  });

  return Response.json({ ok: true, organization: updated });
}
