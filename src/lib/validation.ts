export function passwordIssues(password: string) {
  const issues: string[] = [];
  if (password.length < 12) issues.push("Must be at least 12 characters.");
  if (!/[a-z]/.test(password)) issues.push("Must include a lowercase letter.");
  if (!/[A-Z]/.test(password)) issues.push("Must include an uppercase letter.");
  if (!/[0-9]/.test(password)) issues.push("Must include a number.");
  return issues;
}

export function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
