import { DEMO_MODE } from "@/db/seed";
import { AuthScreen } from "@/components/auth-screen";
import { count } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const [{ value }] = await db.select({ value: count() }).from(users);
  return <AuthScreen demoMode={DEMO_MODE} setupAvailable={value === 0} />;
}
