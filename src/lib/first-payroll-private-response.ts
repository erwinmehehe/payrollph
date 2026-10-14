/** Private payroll-preview responses must never be stored by intermediaries. */
export const PRIVATE_PREVIEW_CACHE_CONTROL = "private, no-store" as const;

export function privatePreviewJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": PRIVATE_PREVIEW_CACHE_CONTROL },
  });
}

/** Preserve the role-denial status/body/headers while rejecting caching. */
export function privatePreviewDenied(response: Response): Response {
  response.headers.set("Cache-Control", PRIVATE_PREVIEW_CACHE_CONTROL);
  return response;
}
