export function platformOperatorEmails(env: NodeJS.ProcessEnv = process.env) {
  return (env.PLATFORM_OPERATOR_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function platformOperatorConfigured(env: NodeJS.ProcessEnv = process.env) {
  return platformOperatorEmails(env).length > 0;
}

export function isPlatformOperator(email: string | null | undefined, env: NodeJS.ProcessEnv = process.env) {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return platformOperatorEmails(env).includes(normalized);
}
