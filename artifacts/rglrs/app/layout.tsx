import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";
import { SessionMonitor } from "@/components/session-monitor";
import { canonicalOrigin } from "@/lib/app-url";

export const metadata: Metadata = {
  metadataBase: new URL(canonicalOrigin),
  title: "RGLRS — Private social for the people who matter",
  description: "Share real life with the people who matter.",
  applicationName: "RGLRS",
  appleWebApp: { capable: true, title: "RGLRS", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "RGLRS",
    title: "RGLRS — Private social for the people who matter",
    description: "Share real life with the people who matter.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0F1115"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <PwaRegister />
        <SessionMonitor />
        {children}
      </body>
    </html>
  );
}
