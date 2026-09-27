export type MailProvider = "none" | "resend" | "postmark" | "smtp";

export function activeMailProvider(env: NodeJS.ProcessEnv = process.env): MailProvider {
  if (env.RESEND_API_KEY) return "resend";
  if (env.POSTMARK_SERVER_TOKEN) return "postmark";
  if (env.SMTP_URL) return "smtp";
  return "none";
}

export function deliveryCapable(env: NodeJS.ProcessEnv = process.env) {
  return activeMailProvider(env) !== "none";
}
