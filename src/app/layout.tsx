import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
// One stylesheet in four parts, in cascade order (later parts override earlier ones: keep this order).
import "./styles/1-core.css";
import "./styles/2-tools.css";
import "./styles/3-reading-and-wide.css";
import "./styles/4-panels-and-track.css";

export const metadata: Metadata = {
  title: "InvestHepi",
  description: "Catch up on market news fast, with an AI read on what it means for your stocks.",
  applicationName: "InvestHepi",
  appleWebApp: { capable: true, title: "InvestHepi", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f5f5f7",
};

// Apply the saved theme before first paint so there's no light/dark flash.
const themeScript = `(function(){try{var t=JSON.parse(localStorage.getItem('ih-theme')||'"system"');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',d?'#000000':'#f5f5f7')}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
