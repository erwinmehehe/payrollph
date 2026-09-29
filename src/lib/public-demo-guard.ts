import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";

export async function isPublicDemoOrganization(organizationId: number) {
  const [organization] = await db
    .select({ accountType: organizations.accountType })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return organization?.accountType === "public-demo";
}

export async function denyPublicDemoSideEffect(
  organizationId: number,
  action = "This action",
): Promise<Response | null> {
  if (!(await isPublicDemoOrganization(organizationId))) return null;
  return Response.json({
    error: `${action} is disabled in the public demo workspace.`,
    demoRestriction: true,
  }, { status: 403 });
}
