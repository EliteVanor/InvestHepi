import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon for iOS (needs a PNG). Same mark as icon.svg. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0b0b0f" }}>
        <svg width="140" height="140" viewBox="0 0 64 64">
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#0a84ff" />
              <stop offset=".55" stopColor="#5e5ce6" />
              <stop offset="1" stopColor="#bf5af2" />
            </linearGradient>
          </defs>
          <path d="M10 46 L26 30 L36 38 L54 18" fill="none" stroke="url(#g)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="54" cy="18" r="5" fill="#fff" />
        </svg>
      </div>
    ),
    size,
  );
}
