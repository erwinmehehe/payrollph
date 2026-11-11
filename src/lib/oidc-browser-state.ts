import { timingSafeEqual } from "node:crypto";

/**
 * OAuth/OIDC callback state must belong to the browser that initiated the
 * login, not merely to any unconsumed state row in the shared database.
 *
 * A cookie scoped to the callback path is set only by the verified OIDC start
 * route. Random state values are 32 bytes encoded as lowercase hex.
 */
export const OIDC_BROWSER_STATE_COOKIE = "linaw_oidc_browser_state";
export const OIDC_BROWSER_STATE_PATH = "/api/auth/sso/callback";
export const OIDC_BROWSER_STATE_MAX_AGE_SECONDS = 10 * 60;

export function oidcBrowserStateMatches(state: unknown, browserState: unknown): boolean {
  if (typeof state !== "string" || typeof browserState !== "string" ||
      !/^[0-9a-f]{64}$/.test(state) || !/^[0-9a-f]{64}$/.test(browserState)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(state, "hex"), Buffer.from(browserState, "hex"));
}
