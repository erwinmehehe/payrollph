import { getPublicPricingPlans } from "@/lib/pricing-catalog";
import ClaudeHomepage from "@/components/marketing/claude-home/App";

export async function SoftwareHome() {
  const plans = await getPublicPricingPlans();
  return <ClaudeHomepage plans={plans} />;
}
