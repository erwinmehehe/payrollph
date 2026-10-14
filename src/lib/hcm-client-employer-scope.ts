/** The organization alone does not uniquely identify an HCM employer.
 * Keep the selected legal employer in each request, response comparison and
 * component remount key. Pure so the client can test it without PII or a DB.
 */
export type HcmReadScope = {
  organizationId: number;
  multiEntityEnabled: boolean;
  legalEntityId: number | null;
};

export function hcmReadScopeValid(scope: HcmReadScope): boolean {
  if (!Number.isSafeInteger(scope.organizationId) || scope.organizationId <= 0) return false;
  return !scope.multiEntityEnabled ||
    (Number.isSafeInteger(scope.legalEntityId) && scope.legalEntityId !== null && scope.legalEntityId > 0);
}

export function hcmReadScopeParams(scope: HcmReadScope): URLSearchParams | null {
  if (!hcmReadScopeValid(scope)) return null;
  const params = new URLSearchParams({ organizationId: String(scope.organizationId) });
  if (scope.multiEntityEnabled) params.set("legalEntityId", String(scope.legalEntityId));
  return params;
}

export function hcmReadScopeKey(scope: HcmReadScope): string {
  return JSON.stringify([scope.organizationId, scope.multiEntityEnabled,
    scope.multiEntityEnabled ? scope.legalEntityId : null]);
}

export function hcmResponseMatchesReadScope(
  payload: unknown,
  scope: HcmReadScope,
): boolean {
  if (!hcmReadScopeValid(scope) || typeof payload !== "object" || payload === null ||
    Array.isArray(payload)) return false;
  const response = payload as Record<string, unknown>;
  if (response.organizationId !== scope.organizationId) return false;
  // A modern HCM response MUST prove the employer id. A legacy single-
  // employer response has legalEntityId:null (never broaden a scoped view).
  return scope.multiEntityEnabled
    ? response.legalEntityId === scope.legalEntityId
    : response.legalEntityId === null;
}
