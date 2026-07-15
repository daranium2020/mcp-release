import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Content-Security-Policy for the production application.
//
// 'unsafe-inline' is required in two places and cannot be removed without
// a larger architectural change:
//
//   script-src: Next.js App Router embeds RSC (React Server Component)
//   payload data as inline <script> tags during static generation. These
//   tags contain pre-rendered page state and cannot use per-request nonces
//   without switching every statically-generated page to dynamic rendering.
//
//   style-src: Next.js injects inline <style data-precedence="..."> tags
//   to control CSS module loading order. These are required for correct
//   visual rendering and cannot be externalized.
//
// 'unsafe-eval' is added only in development mode to support webpack's
// hot-module replacement. It is never present in production builds.
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  experimental: {
    // tsconfig paths map @mcp-release/* to source .ts files (no dist/ needed
    // for tsc --noEmit). Next.js applies those paths via JsConfigPathsPlugin,
    // so webpack follows the source tree. Source files import peers as
    // './report.js' (TypeScript moduleResolution:Bundler convention), which
    // webpack cannot resolve without this alias. extensionAlias tells the
    // resolver to also try .ts/.tsx when a .js import cannot be found.
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
          },
          // HSTS is applied only in production (HTTPS). The header has no
          // effect over HTTP but browsers cache it, so skip it in development.
          ...(isDev
            ? []
            : [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains",
                },
              ]),
        ],
      },
    ];
  },
};

export default nextConfig;
