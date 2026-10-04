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
  /**
   * Keep local data out of the server bundles' file traces: the archives under data-local/, raw captures under
   * fixtures/, the file cache and the reports could otherwise be listed in a route's trace (a literal default path in
   * src/server/projectionArchive.ts and fantasyCalcArchive.ts is enough) and uploaded with a deploy built on this
   * computer (Phase 4b review of track G).
   */
  outputFileTracingExcludes: { "*": ["data-local/**", "fixtures/**", ".cache/**", "reports/**"] },
  headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
