export const DEMO_BOOKKEEPER_EMAIL = "celine@linaw.ph";
export const DEMO_EMPLOYEE_EMAIL = "jonas.reyes@linaw.ph";
export const DEMO_FREELANCER_EMAIL = "mika@linaw.ph";

export const DEMO_USER_EMAILS = [
  DEMO_BOOKKEEPER_EMAIL,
  DEMO_EMPLOYEE_EMAIL,
  DEMO_FREELANCER_EMAIL,
] as const;

// These are the fixed organizations created by src/db/seed.ts for the public
// sandbox. Demo identities must never be granted membership outside this set.
export const DEMO_ORGANIZATION_NAMES = [
  "Demo · Loom & Local",
  "Demo · Mantra Studio",
  "Demo · Santos Retail Group",
  "Demo · Mika, self-employed",
] as const;

export function isDemoUserEmail(email: string | null | undefined) {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return DEMO_USER_EMAILS.some((candidate) => candidate === normalized);
}

export function demoMutationBlocked(action: string) {
  return Response.json({
    error: `${action} is disabled in the public demo. Create your own workspace to use this feature.`,
    demo: true,
    createAccountUrl: "/signup",
    bookDemoUrl: "/book-demo",
  }, { status: 403 });
}
