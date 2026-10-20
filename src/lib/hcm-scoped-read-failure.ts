/**
 * Fail-closed read-state classification for role-scoped HCM/HR views.
 * Do not turn a failed, denied or malformed response into a verified empty list.
 * Deliberately avoid rendering untrusted API error bodies (which can contain PII).
 */
export type ScopedReadFailure =
  | "sign_in"
  | "forbidden"
  | "server"
  | "network"
  | "invalid";

export function scopedReadFailureForHttpStatus(status: number): ScopedReadFailure {
  if (status === 401) return "sign_in";
  if (status === 403) return "forbidden";
  // Includes 404, 429, unexpected redirects and all 5xx; none certify empty data.
  return "server";
}

export function scopedReadFailureMessage(reason: ScopedReadFailure): string {
  switch (reason) {
    case "sign_in":
      return "Your session is no longer authorized for this read. Sign in again before retrying; no records were loaded.";
    case "forbidden":
      return "Your current role or employer scope does not allow this view. Ask an authorized administrator if access is expected. No records were loaded.";
    case "server":
      return "The source could not complete this request. Try again later. An unsuccessful response is not an empty record set.";
    case "network":
      return "The request could not reach the source. Check your connection and retry; no records were confirmed as empty.";
    case "invalid":
      return "The response did not match the requested employer or expected data shape and was discarded. No records were confirmed as empty.";
  }
}

/**
 * A rejected fetch is a network failure. A successful HTTP request that
 * cannot parse or validate is invalid DATA, never a network outage.
 * The calling effect retains AbortController + request-scope gating so an
 * aborted/stale request cannot publish a result.
 */
export type ScopedReadResult<T> =
  | { status: "ready"; data: T }
  | { status: "unavailable"; failure: ScopedReadFailure };

export async function readScopedResponse<T>(
  fetchResponse: () => Promise<Response>,
  validate: (payload: unknown) => payload is T,
): Promise<ScopedReadResult<T>> {
  let response: Response;
  try {
    response = await fetchResponse();
  } catch {
    return { status: "unavailable", failure: "network" };
  }
  if (!response.ok) {
    return { status: "unavailable", failure: scopedReadFailureForHttpStatus(response.status) };
  }
  try {
    const payload: unknown = await response.json();
    if (validate(payload)) return { status: "ready", data: payload };
  } catch {
    // Invalid/malformed successful response body or broken payload shape.
  }
  return { status: "unavailable", failure: "invalid" };
}
