import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";
const supabaseOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
      : null;
  } catch {
    return null;
  }
})();
const connectSources = [
  "'self'",
  supabaseOrigin,
  supabaseOrigin?.replace(/^http/, "ws"),
  "https://*.r2.cloudflarestorage.com",
].filter(Boolean);
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://images.unsplash.com https://plus.unsplash.com https://api.dicebear.com https://*.r2.cloudflarestorage.com",
  "media-src 'self' blob: https://*.r2.cloudflarestorage.com",
  `connect-src ${connectSources.join(" ")}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

if (process.env.NEXT_PUBLIC_APP_URL) {
  try {
    const appUrl = new URL(process.env.NEXT_PUBLIC_APP_URL);
    const local = appUrl.hostname === "localhost" || appUrl.hostname === "127.0.0.1";
    if ((appUrl.protocol !== "https:" && !(local && appUrl.protocol === "http:")) || appUrl.username || appUrl.password || appUrl.pathname !== "/" || appUrl.search || appUrl.hash) {
      throw new Error();
    }
  } catch {
    throw new Error("NEXT_PUBLIC_APP_URL must be a bare HTTPS origin (HTTP is allowed only for localhost).");
  }
}

const nextConfig: NextConfig = {
  distDir: process.env.RGLRS_DIST_DIR || ".next",
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "plus.unsplash.com" }
    ]
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/:area(private-media|account-data)/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
