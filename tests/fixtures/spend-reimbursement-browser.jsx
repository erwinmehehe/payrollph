import React from "react";
import { createRoot } from "react-dom/client";
import { ExpensesPanel } from "../../src/components/wallet-panel";
function Fixture() {
  const [notice, setNotice] = React.useState("");
  return <main style={{ padding: 16, maxWidth: 1200, margin: "auto" }}>
    <p>Isolated component preview · Fictional records · No live employer or payments</p>
    {notice && <p role="status">{notice}</p>}
    <ExpensesPanel organizationId={1} setNotice={setNotice} reviewModeEnabled={window.fixtureMode !== "off"} />
  </main>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
