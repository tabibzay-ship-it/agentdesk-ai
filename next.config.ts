import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

function supabaseConnectionSources(): string[] {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) return [];

  const url = new URL(value);
  // A deployment variable must not become additional CSP directives. Credentials,
  // paths and non-HTTP endpoints are not valid Supabase project base URLs.
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (isProduction && url.protocol !== "https:") ||
    url.username || url.password || url.search || url.hash ||
    (url.pathname !== "/" && url.pathname !== "") ||
    !/^https?:\/\/[a-z0-9.:[\]-]+$/i.test(url.origin)
  ) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid project origin (HTTPS in production).");
  }

  return [url.origin, url.origin.replace(/^http/, "ws")];
}

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js static pages include inline hydration scripts; a nonce policy would
  // require changing every page to dynamic rendering. Never allow eval in prod.
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self' ${supabaseConnectionSources().join(" ")}${isProduction ? "" : " ws: wss:"}`.trim(),
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // The installed widget uses a script and customer-page DOM, not an iframe.
  // Deny framing AgentDesk pages without restricting cross-origin widget loads.
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  ...(isProduction ? [{
    key: "Strict-Transport-Security",
    value: "max-age=31536000",
  }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  // pdfjs loads its companion worker at runtime on the server. Keeping the
  // package external prevents Turbopack from relocating only the main module
  // while leaving pdf.worker.mjs behind in node_modules.
  serverExternalPackages: ["pdfjs-dist"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        source: "/api/:path*",
        headers: [{
          key: "Cache-Control",
          value: "private, no-store, max-age=0",
        }],
      },
    ];
  },
};

export default nextConfig;
