"use client";

import ModernHome from "./ModernHome";

export type PublicPlan = {
  id: number;
  name: string;
  monthlyBase: string;
  perEmployee: string;
  modules: unknown;
  version: string;
  active?: boolean;
};

export default function ClaudeHomepage({ plans }: { plans: PublicPlan[] }) {
  return <ModernHome plans={plans} />;
}
