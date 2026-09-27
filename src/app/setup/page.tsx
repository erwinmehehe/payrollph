import { needsSetup } from "@/app/api/setup/route";
import { SetupWizard } from "@/components/setup-wizard";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  return <SetupWizard needsSetup={await needsSetup()} />;
}
