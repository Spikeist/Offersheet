import type { NextConfig } from "next";

/**
 * Security headers on every response. Deliberately no script-src CSP (Next's inline bootstrap
 * scripts would need nonces); these only stop other sites from framing the pages (the Connect page
 * takes ESPN cookies), stop MIME sniffing, and keep full URLs out of the Referer header.
 */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
