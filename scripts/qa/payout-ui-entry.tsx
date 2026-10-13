import React from "react";
import { createRoot } from "react-dom/client";
import { ExportsView } from "../../src/components/workspace/exports";
import { PayoutProfilesPanel } from "../../src/components/payout-profiles-panel";
import { payoutUiFixture } from "../../tests/fixtures/payout-ui";

const options = new URLSearchParams(location.search);
const enabled = options.get("enabled") === "on";
const role = options.get("role") ?? "owner";
const data = payoutUiFixture(enabled, role);
createRoot(document.getElementById("root")!).render(<main style={{ maxWidth: 1200, margin: "auto", padding: 16 }}>
  {options.get("view") === "profiles"
    ? <PayoutProfilesPanel organizationId={1} setNotice={() => {}} />
    : <ExportsView data={data} notify={() => {}} onRefresh={async () => {}} />}
</main>);
