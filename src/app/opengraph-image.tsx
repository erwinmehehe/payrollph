import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Linaw Philippine payroll software";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          background: "#F7F8FC",
          color: "#11141F",
          padding: "72px",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 520,
            height: 520,
            right: -120,
            top: -180,
            borderRadius: 999,
            background: "radial-gradient(circle, rgba(8,119,255,.28), rgba(8,119,255,0))",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 430,
            height: 430,
            left: -120,
            bottom: -220,
            borderRadius: 999,
            background: "radial-gradient(circle, rgba(18,183,106,.20), rgba(18,183,106,0))",
          }}
        />

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <svg width="58" height="64" viewBox="0 0 36 40" fill="none"><path d="M17 38C5 32 3 21 3 5C14 10 17 17 17 27V38Z" fill="#2889F5"/><path d="M20 24C20 11 25 6 34 2C35 13 30 20 20 24Z" fill="#10B8A0"/><path d="M18 38V17" stroke="#B9DFFF" strokeWidth="1.5"/></svg>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-1px" }}>Linaw</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#7C82A1", letterSpacing: "2px", textTransform: "uppercase" }}>
                Philippine Payroll
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", maxWidth: 900 }}>
            <div style={{ fontSize: 64, lineHeight: 1.03, fontWeight: 700, letterSpacing: "-3px" }}>
              Philippine payroll software you can verify before you pay.
            </div>
            <div style={{ marginTop: 26, fontSize: 24, lineHeight: 1.45, color: "#5B6080" }}>
              Calculations, exceptions, checker approval, payslips and controlled payroll outputs in one workflow.
            </div>
          </div>

          <div style={{ display: "flex", gap: 18, fontSize: 18, fontWeight: 700, color: "#0868dc" }}>
            <span>Role-based approvals</span>
            <span>·</span>
            <span>Philippine statutory payroll</span>
            <span>·</span>
            <span>Live demo</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
