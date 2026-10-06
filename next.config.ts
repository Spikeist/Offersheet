import type { NextConfig } from "next";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Security headers on every response (planner reply to Checkpoint 4c, Part B: B3's pages and B4's "Security review:
 * session cookies, same-origin checks, headers"). They're computed when the config loads: at build time for a
 * production build (the build writes them into its routes manifest, which `next start` and Vercel serve), so
 * NODE_ENV and VERCEL_ENV are the build's.
 *
 * - Production builds (Vercel, the stable copy, check:browser) send a full Content-Security-Policy. It allows inline
 *   scripts and styles ('unsafe-inline'): Next's App Router puts its page data in inline scripts, and nonces would make
 *   every page dynamic (no static pages, a function call per view on the Hobby plan). Everything else is the site's own
 *   ('self'), plus, for connect-src, the two hosts the browser reads league data from itself (BROWSER_FETCH_ORIGINS:
 *   Sleeper, and ESPN's public leagues; Part B's browser fetching). No eval: zod, the one library that probes for it,
 *   runs jitless wherever it runs in the browser. No upgrade-insecure-requests: Vercel already redirects to HTTPS and
 *   sends HSTS, and the stable copy is served over plain http://127.0.0.1:3000.
 * - Vercel preview builds (VERCEL_ENV "preview" at build time) also allow the Vercel Toolbar's sources, which Vercel
 *   adds to previews (VERCEL_TOOLBAR_SOURCES).
 * - OFFERSHEET_CSP_REPORT_ONLY=1 at build time sends the full policy as Content-Security-Policy-Report-Only instead
 *   (the browser reports what it would block, in its console, and blocks nothing), for a first preview; framing stays
 *   forbidden by an enforced frame-ancestors 'none', so the report-only copy leaves frame-ancestors out (it would only
 *   report what the enforced one already blocks).
 * - `next dev` keeps the frame-ancestors-only policy (React's development build needs eval, hot reload its own sockets).
 * - Always: no framing by other sites (the Connect page takes ESPN cookies), no MIME sniffing, the Referer kept to our
 *   own origin, and a Permissions-Policy turning off what Offer Sheet never uses (camera, microphone, location, payments,
 *   USB, ad topics). The clipboard stays allowed: the trade cards' Copy button writes to it.
 * No HSTS: Vercel sends it (*.vercel.app is preloaded), and the stable copy is plain HTTP on this computer.
 */

/** Hosts the browser reads league data from itself: Sleeper's API and ESPN's league API (public leagues). */
export const BROWSER_FETCH_ORIGINS = ["https://api.sleeper.app", "https://lm-api-reads.fantasy.espn.com"] as const;

/** The Vercel Toolbar's sources on preview deployments (vercel.com/docs/vercel-toolbar/managing-toolbar, 2026-08-11). */
export const VERCEL_TOOLBAR_SOURCES: Readonly<Record<string, readonly string[]>> = {
  "script-src": ["https://vercel.live"],
  "connect-src": ["https://vercel.live", "wss://ws-us3.pusher.com"],
  "img-src": ["https://vercel.live", "https://vercel.com", "blob:"],
  "frame-src": ["https://vercel.live"],
  "style-src": ["https://vercel.live"],
  "font-src": ["https://vercel.live", "https://assets.vercel.com"],
};

/** The policy `next dev` keeps, and the enforced part of a report-only build: only framing is forbidden. */
export const FRAMING_ONLY_CSP = "frame-ancestors 'none'";

export const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()";

/** The production Content-Security-Policy (pure); `reportOnly` leaves out frame-ancestors, which the enforced FRAMING_ONLY_CSP sent beside it covers. */
export function contentSecurityPolicy(opts: { vercelPreview: boolean; reportOnly?: boolean }): string {
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'"]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:"]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'", ...BROWSER_FETCH_ORIGINS]],
    ["worker-src", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["frame-src", ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives
    .filter(([name]) => !(opts.reportOnly && name === "frame-ancestors"))
    .map(([name, sources]) => {
      const extra = opts.vercelPreview ? (VERCEL_TOOLBAR_SOURCES[name] ?? []) : [];
      // 'none' can't be combined with sources: a directive that gains one drops it.
      const kept = extra.length ? sources.filter((s) => s !== "'none'") : sources;
      return `${name} ${[...kept, ...extra.filter((s) => !kept.includes(s))].join(" ")}`;
    })
    .join("; ");
}

/** Every response's security headers, for this build (pure but for the default `env`). */
export function securityHeaders(env: Env = process.env): Array<{ key: string; value: string }> {
  const production = env.NODE_ENV === "production";
  const vercelPreview = env.VERCEL_ENV === "preview";
  const csp = !production
    ? [{ key: "Content-Security-Policy", value: FRAMING_ONLY_CSP }]
    : env.OFFERSHEET_CSP_REPORT_ONLY === "1"
      ? [
          { key: "Content-Security-Policy", value: FRAMING_ONLY_CSP },
          { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy({ vercelPreview, reportOnly: true }) },
        ]
      : [{ key: "Content-Security-Policy", value: contentSecurityPolicy({ vercelPreview }) }];
  return [
    ...csp,
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "same-origin" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
  ];
}

const nextConfig: NextConfig = {
  /** No "X-Powered-By: Next.js" header. */
  poweredByHeader: false,
  /**
   * No image optimizer (B4 security review): no page uses next/image (the icons and the sharing image are files and
   * metadata routes of their own), and /_next/image would otherwise be open to anyone, outside withRoute's rate limits
   * and work budget, every width and format of the app's own images a transformation counted against the Hobby plan.
   * `next start` then answers /_next/image with a 404, and a Vercel build sets no image optimization up.
   */
  images: { unoptimized: true },
  /**
   * Keep local data out of the server bundles' file traces: the archives under data-local/, raw captures under
   * fixtures/, the file cache and the reports could otherwise be listed in a route's trace (a literal default path in
   * src/server/projectionArchive.ts and fantasyCalcArchive.ts is enough) and uploaded with a deploy built on this
   * computer (Phase 4b review of track G).
   */
  outputFileTracingExcludes: { "*": ["data-local/**", "fixtures/**", ".cache/**", "reports/**"] },
  headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
};

export default nextConfig;
