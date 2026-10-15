/**
 * Role + visible page + exact API method/path + exact expected HTTP status.
 * Do not whitelist a role's entire 403 class or any 5xx response.
 * No current navigation failures are treated as expected: accessible
 * destinations are supposed to load for their role.
 *
 * Example after independently proving a legitimate denial:
 * { role: "checker", page: "Example", method: "GET",
 *   apiPath: "/api/example", status: 403, reason: "Documented RBAC" }
 */
export const EXPECTED_DENIED = Object.freeze([]);

export function isExpectedDenied({ role, page, method, apiPath, status }) {
  return EXPECTED_DENIED.some((rule) =>
    rule.role === role &&
    rule.page === page &&
    rule.method === method &&
    rule.apiPath === apiPath &&
    rule.status === status &&
    (status === 401 || status === 403) &&
    typeof rule.reason === "string" && rule.reason.trim().length > 0);
}
