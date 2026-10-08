/**
 * Deployment-scoped rollout gate for the natural-language Automation Studio lane.
 *
 * This is deliberately separate from OPENAI_AUTOMATION_DRAFT_ENABLED:
 * disabling the provider must not silently expose the approved-template fallback.
 * Keep OFF until independent review and isolated staging acceptance are complete.
 * The manual Automation Studio builder, versions, preview and execution lanes
 * are never affected by this feature flag.
 *
 * Server runtime setting only. Do NOT use NEXT_PUBLIC_*.
 */
export function automationLanguageStudioEnabled(): boolean {
  return process.env.AUTOMATION_LANGUAGE_STUDIO_ENABLED === "true";
}
