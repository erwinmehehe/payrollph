const PUBLIC_DEMO_IDENTITY_EMAILS = new Set([
  "celine@linaw.ph",
  "owner.demo@linaw.ph",
  "hr.demo@linaw.ph",
  "payroll.demo@linaw.ph",
  "checker.demo@linaw.ph",
  "jonas.reyes@linaw.ph",
]);

export function isPublicDemoIdentity(email: string | null | undefined) {
  return typeof email === "string" && PUBLIC_DEMO_IDENTITY_EMAILS.has(email.trim().toLowerCase());
}

export function publicDemoMutationDenied(email: string | null | undefined, action = "This action") {
  if (!isPublicDemoIdentity(email)) return null;
  return Response.json(
    { error: `${action} is disabled in the shared public demo.` },
    { status: 403 },
  );
}
