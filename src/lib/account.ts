/**
 * Pure account-security rules. No database, no Next.js imports — every rule a
 * route enforces is expressed here so it can be unit-tested directly.
 */
import { passwordIssues, validEmail } from "@/lib/validation";

export type SessionLike = {
  id: number;
  userId: number;
  createdAt: Date | string;
  expiresAt: Date | string;
  revokedAt: Date | string | null;
  lastSeenAt: Date | string | null;
  userAgent: string | null;
  ip: string | null;
};

export type SessionView = SessionLike & {
  label: string;
  current: boolean;
  active: boolean;
  expiresSoon: boolean;
};

export function passwordChangeIssues(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  /** True when the NEW password equals the existing one (caller checks the hash). */
  reusesCurrent: boolean;
}) {
  const problems: string[] = [];
  if (!input.currentPassword) problems.push("Enter your current password.");
  if (input.newPassword !== input.confirmPassword) problems.push("New password and confirmation do not match.");
  problems.push(...passwordIssues(input.newPassword));
  if (input.reusesCurrent) problems.push("New password must be different from your current password.");
  return problems;
}

export function emailChangeIssues(input: { email: string; currentEmail: string; password: string }) {
  const problems: string[] = [];
  if (!input.password) problems.push("Confirm your current password to change your email.");
  if (!validEmail(input.email)) problems.push("Enter a valid email address.");
  if (input.email.trim().toLowerCase() === input.currentEmail.trim().toLowerCase()) {
    problems.push("The new email is the same as your current one.");
  }
  return problems;
}

/** Coarse but honest device labelling — no external UA parser dependency. */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser =
    /Edg\//.test(ua) ? "Edge"
      : /OPR\//.test(ua) ? "Opera"
        : /Chrome\//.test(ua) ? "Chrome"
          : /Firefox\//.test(ua) ? "Firefox"
            : /Safari\//.test(ua) ? "Safari"
              : "Browser";
  const os =
    /Windows/.test(ua) ? "Windows"
      : /Android/.test(ua) ? "Android"
        : /(iPhone|iPad|iPod)/.test(ua) ? "iOS"
          : /Mac OS X/.test(ua) ? "macOS"
            : /Linux/.test(ua) ? "Linux"
              : /CrOS/.test(ua) ? "ChromeOS"
                : "Unknown OS";
  return `${browser} on ${os}`;
}

export function isSessionActive(session: SessionLike, now = new Date()) {
  if (session.revokedAt) return false;
  return new Date(session.expiresAt).getTime() > now.getTime();
}

/**
 * Builds the view the account UI renders. `currentId` is the session serving the
 * request — it is never revocable from this screen, so a user cannot lock
 * themselves out mid-edit.
 */
export function toSessionViews(sessions: SessionLike[], currentId: number | null, now = new Date()): SessionView[] {
  return sessions
    .map((session) => ({
      ...session,
      label: describeUserAgent(session.userAgent),
      current: session.id === currentId,
      active: isSessionActive(session, now),
      expiresSoon: new Date(session.expiresAt).getTime() - now.getTime() < 48 * 3600 * 1000,
    }))
    .sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      if (a.active !== b.active) return a.active ? -1 : 1;
      return new Date(b.lastSeenAt ?? b.createdAt).getTime() - new Date(a.lastSeenAt ?? a.createdAt).getTime();
    });
}

/** A user may revoke their own non-current sessions only. */
export function canRevoke(session: SessionLike, actorUserId: number, currentSessionId: number | null) {
  if (session.userId !== actorUserId) return { ok: false as const, reason: "Session does not belong to this account." };
  if (session.id === currentSessionId) return { ok: false as const, reason: "You cannot revoke the session you are using now." };
  if (session.revokedAt) return { ok: false as const, reason: "Session is already revoked." };
  return { ok: true as const };
}

/**
 * After a password or email change, every other session is revoked. We keep the
 * live token so the user stays signed in on the device that made the change.
 */
export function shouldRevokeOnCredentialChange(session: SessionLike, keepSessionId: number | null) {
  if (session.revokedAt) return false;
  if (keepSessionId != null && session.id === keepSessionId) return false;
  return true;
}

export function sessionsSummary(views: SessionView[]) {
  const active = views.filter((v) => v.active);
  return {
    total: views.length,
    active: active.length,
    otherActive: active.filter((v) => !v.current).length,
    expired: views.filter((v) => !v.active && !v.revokedAt).length,
    revoked: views.filter((v) => Boolean(v.revokedAt)).length,
  };
}
