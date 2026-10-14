import { ImageResponse } from "next/og";

export const alt =
  "SellerLabel — Flipkart, Amazon, and Meesho PDFs to print-ready labels";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#050505",
        color: "#ffffff",
        fontFamily: "monospace",
        padding: "58px 64px",
        border: "2px solid #ffffff",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 24,
          letterSpacing: "-1px",
        }}
      >
        <span>SELLERLABEL</span>
        <span style={{ color: "#a3a3a3" }}>PRIVATE / PRINT READY</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            fontSize: 72,
            fontWeight: 800,
            letterSpacing: "-6px",
            lineHeight: 1,
          }}
        >
          MARKETPLACE PDFS
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 10,
            fontSize: 72,
            fontWeight: 800,
            letterSpacing: "-6px",
            lineHeight: 1,
          }}
        >
          → PRINT-READY LABELS
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 34,
            color: "#a3a3a3",
            fontSize: 26,
          }}
        >
          FLIPKART / AMAZON / MEESHO / MIXED BATCHES
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          borderTop: "1px solid #555555",
          paddingTop: 24,
          color: "#d4d4d4",
          fontSize: 21,
        }}
      >
        <span>100 × 150 MM</span>
        <span>BARCODE + QR VALIDATION</span>
        <span>ONE PDF</span>
      </div>
    </div>,
    size,
  );
}
