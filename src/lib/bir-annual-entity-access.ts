import { resolveMultiEntityContext, assertEntityResource } from "@/lib/multi-entity-server";

/** Company-wide org roles are not cross-employer grants. Check before tax reads. */
export async function assertBirAnnualEntityAccess(
  userId: number, organizationId: number, legalEntityId: number, request: Request,
) {
  const scope = await resolveMultiEntityContext({ userId, organizationId, request });
  if (!scope.ok) return scope.response;
  return assertEntityResource(scope.context, legalEntityId);
}
