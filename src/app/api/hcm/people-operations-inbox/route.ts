import {
  assertOrganizationRole,
  getAccess,
  PEOPLE_ADMIN_ROLES,
} from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { loadPeopleOperationsInbox } from "@/lib/hcm-people-operations-inbox-server";
import type { PeopleOpsCategory, PeopleOpsPriority } from "@/lib/hcm-people-operations-inbox";

export const dynamic = "force-dynamic";

const CATEGORIES = new Set(["all", "employment", "onboarding", "position", "performance", "separation"]);
const PRIORITIES = new Set(["all", "review", "follow_up", "source_check"]);

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const organizationId = Number(params.get("organizationId"));
  const page = Number(params.get("page") ?? "1");
  const pageSize = Number(params.get("pageSize") ?? "20");
  const category = params.get("category") ?? "all";
  const priority = params.get("priority") ?? "all";
  const search = (params.get("q") ?? "").trim();

  if (!Number.isSafeInteger(organizationId) || organizationId <= 0
    || !Number.isSafeInteger(page) || page < 1 || page > 100000
    || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50
    || !CATEGORIES.has(category) || !PRIORITIES.has(priority)
    || search.length > 80) {
    return Response.json({ error: "Invalid organization, pagination or inbox filter." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id, organizationId, PEOPLE_ADMIN_ROLES,
    "Company-wide People administration is required to review this inbox.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "The People Operations Inbox requires company-wide HR access." }, { status: 403 });
  }

  const payload = await loadPeopleOperationsInbox(organizationId, {
    page, pageSize,
    category: category as PeopleOpsCategory | "all",
    priority: priority as PeopleOpsPriority | "all",
    search,
  });

  return Response.json(payload, { headers: { "Cache-Control": "private, no-store" } });
}
