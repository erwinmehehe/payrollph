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
            background: "radial-gradient(circle, rgba(97,97,255,.28), rgba(97,97,255,0))",
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
            <div
              style={{
                display: "flex",
                width: 58,
                height: 58,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                background: "#11141F",
                color: "#fff",
                fontSize: 30,
                fontWeight: 700,
              }}
            >
              ✓
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-1px" }}>linaw</div>
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

          <div style={{ display: "flex", gap: 18, fontSize: 18, fontWeight: 700, color: "#4A4AE0" }}>
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
