import { redirect } from "next/navigation";
import { LinawWorkspace } from "@/components/linaw-workspace";
import { SelfServicePortal } from "@/components/self-service-portal";
import { getSessionUser } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getSessionUser();

  // Signed out: show the public product page so the design is previewable
  // without an account. Sign-in lives at /login.
  if (!user) redirect("/welcome");

  // Employees get the self-service portal; admins get the workspace.
  if (user.role === "employee") return <SelfServicePortal />;

  const data = await getDashboardData();
  return <LinawWorkspace initialData={data} />;
}
