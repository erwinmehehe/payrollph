import assert from "node:assert/strict";
import test from "node:test";
import {
  canRevoke,
  describeUserAgent,
  emailChangeIssues,
  isSessionActive,
  passwordChangeIssues,
  sessionsSummary,
  shouldRevokeOnCredentialChange,
  toSessionViews,
  type SessionLike,
} from "../src/lib/account";

const NOW = new Date("2026-03-16T09:00:00Z");
const future = "2026-03-30T09:00:00Z";

function session(over: Partial<SessionLike> = {}): SessionLike {
  return {
    id: 1,
    userId: 7,
    createdAt: "2026-03-01T09:00:00Z",
    expiresAt: future,
    revokedAt: null,
    lastSeenAt: "2026-03-16T08:00:00Z",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
    ip: "203.0.113.5",
    ...over,
  };
}

test("password change requires the current password and a policy-valid new one", () => {
  const problems = passwordChangeIssues({
    currentPassword: "",
    newPassword: "short",
    confirmPassword: "short",
    reusesCurrent: false,
  });
  assert.ok(problems.includes("Enter your current password."));
  assert.ok(problems.some((p) => /10 characters|uppercase|number/i.test(p)));
});

test("password change rejects reusing the current password", () => {
  const problems = passwordChangeIssues({
    currentPassword: "Str0ngPassw0rd!",
    newPassword: "Str0ngPassw0rd!",
    confirmPassword: "Str0ngPassw0rd!",
    reusesCurrent: true,
  });
  assert.ok(problems.some((p) => p.includes("different from your current")));
});

test("password change rejects mismatched confirmation only", () => {
  const problems = passwordChangeIssues({
    currentPassword: "Str0ngPassw0rd!",
    newPassword: "N3wPasswordHere",
    confirmPassword: "N3wPasswordDifferent",
    reusesCurrent: false,
  });
  assert.deepEqual(problems, ["New password and confirmation do not match."]);
});

test("a valid password change produces no problems", () => {
  const problems = passwordChangeIssues({
    currentPassword: "Str0ngPassw0rd!",
    newPassword: "N3wPasswordHere",
    confirmPassword: "N3wPasswordHere",
    reusesCurrent: false,
  });
  assert.deepEqual(problems, []);
});

test("email change requires a password, a valid and different address", () => {
  assert.deepEqual(
    emailChangeIssues({ email: "new@corp.ph", currentEmail: "old@corp.ph", password: "hunter2" }),
    [],
  );
  const bad = emailChangeIssues({ email: "nope", currentEmail: "old@corp.ph", password: "" });
  assert.ok(bad.some((p) => p.includes("valid email")));
  assert.ok(bad.some((p) => p.includes("Confirm your current password")));
  assert.ok(
    emailChangeIssues({ email: "OLD@corp.ph", currentEmail: "old@corp.ph", password: "x" })
      .some((p) => p.includes("same as your current")),
    "case-insensitive comparison so users are not confused",
  );
});

test("a wrong current password does not falsely claim password reuse", () => {
  // This was a real bug: matchesCurrent conflated "current password wrong" with
  // "new password equals current", so users saw a nonsense second message.
  const problems = passwordChangeIssues({
    currentPassword: "WrongButWellFormed1",
    newPassword: "CompletelyDifferent2",
    confirmPassword: "CompletelyDifferent2",
    reusesCurrent: false,
  });
  assert.deepEqual(problems, [], "the route adds the wrong-password message separately");
});

test("the UI password checklist must match the server policy", () => {
  const panel = require("node:fs").readFileSync("src/components/account-panel.tsx", "utf8");
  assert.ok(panel.includes("next.length >= 12"), "UI must require the same 12-char minimum as passwordIssues");
  assert.ok(!panel.includes("At least 10 characters"), "UI must not advertise a weaker policy than the server");
});

test("user agents become readable device labels", () => {
  assert.equal(describeUserAgent(null), "Unknown device");
  assert.equal(
    describeUserAgent("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"),
    "Chrome on Windows",
  );
  assert.equal(
    describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17 Mobile/15E148 Safari/604.1"),
    "Safari on iOS",
  );
  assert.equal(
    describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"),
    "Chrome on macOS",
  );
});

test("revocation rules block self-lockout and cross-account revocation", () => {
  assert.equal(canRevoke(session({ id: 3, userId: 7 }), 7, 3).ok, false, "cannot revoke the session in use");
  assert.equal(canRevoke(session({ id: 4, userId: 7 }), 7, 9).ok, true);
  assert.equal(canRevoke(session({ id: 4, userId: 99 }), 7, null).ok, false, "cannot revoke another user's session");
  assert.equal(canRevoke(session({ id: 4, userId: 7, revokedAt: NOW }), 7, null).ok, false, "already revoked");
});

test("credential changes revoke everything except the live session", () => {
  assert.equal(shouldRevokeOnCredentialChange(session({ id: 1 }), 1), false);
  assert.equal(shouldRevokeOnCredentialChange(session({ id: 2 }), 1), true);
  assert.equal(shouldRevokeOnCredentialChange(session({ id: 2 }), null), true, "no keep id revokes all");
  assert.equal(shouldRevokeOnCredentialChange(session({ id: 5, revokedAt: NOW }), 1), false);
});

test("expired and revoked sessions are not treated as active", () => {
  assert.equal(isSessionActive(session(), NOW), true);
  assert.equal(isSessionActive(session({ expiresAt: "2026-03-01T09:00:00Z" }), NOW), false);
  assert.equal(isSessionActive(session({ revokedAt: NOW }), NOW), false);
});

test("session list puts the current device first and counts the rest", () => {
  const views = toSessionViews(
    [
      session({ id: 10, lastSeenAt: "2026-02-01T09:00:00Z" }),
      session({ id: 11, userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/125.0" }),
      session({ id: 12, revokedAt: NOW }),
    ],
    10,
    NOW,
  );
  assert.equal(views[0].id, 10, "current session first");
  assert.equal(views[0].current, true);
  assert.equal(views[1].active, true);
  assert.equal(views[2].active, false, "revoked sorts last");

  const summary = sessionsSummary(views);
  assert.equal(summary.total, 3);
  assert.equal(summary.active, 2);
  assert.equal(summary.otherActive, 1);
  assert.equal(summary.revoked, 1);
});
