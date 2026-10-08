# Security review before the beta (Checkpoint 7b, B4)

Written for the planner and Parker. It is the "one focused pass" the planner asked for in the reply to Checkpoint 4c (B4: session cookies, same-origin checks, headers, dependency audit), plus §4's go/no-go checks from the reply to Checkpoint 7a.

**Method:** four reviewers each took one area: sessions and credentials, request handling, headers/client/URLs, and dependencies. They read the code paths end to end and tested what they claimed, with scratch tests and drivers kept in git-ignored `data-local/security/`. A fifth agent then reproduced or refuted each finding and fixed the confirmed ones, with tests. The review ran on 2026-10-05 against the code after wave 1 (commit 2fc38be) and before waves 2 and 3. Apart from this review's own fixes, the later changes didn't touch sessions or headers; in the routes they added the load test's fixes (the build cap, the budgets' counting, shared cache reads: `reports/load-test.md`) and the snapshot archive's per-day retention.

**Checkpoint 7c** (2026-10-07; planner reply to Checkpoint 7b, §4): finding 15 is new (the firewall limit's review), finding 14 and the launch notes are brought up to date, and Next moved to 16.3.8 with source-map-js 1.2.2 (both security releases).

## Checked and found right (69 checks; the main ones)
- **ESPN cookie session:**
  - iron-session 9.0.1, cookie `offersheet_session`: HttpOnly, SameSite=Lax, Path=/, no Domain, Secure in production, no Max-Age or Expires (session-only), and a 12-hour seal enforced on the server.
  - The credentials go only to ESPN's league URLs: a digits-only league id, never on redirects to another host, never logged, never echoed. Browser storage never holds them.
  - "Forget" expires the cookie at once. A copy taken earlier stays valid up to 12 hours (the seal is stateless; the privacy page is accurate).
- **CSRF and same-origin:**
  - The Origin check, then Sec-Fetch-Site. Cross-site forms, no-cors requests and `Origin: null` are all refused before anything is counted.
  - JSON and gzip bodies need a CORS preflight, which Next answers without CORS headers.
- **Signed imports:**
  - HMAC-SHA256 over the canonical JSON, compared in constant time, valid 15 minutes, with at most 60 s of clock skew.
  - A forged or edited token only triggers a re-read that the requester pays for.
  - The model memo is consulted only after the signature verifies.
- **Uploads:**
  - Size caps while streaming, gunzip with a maximum output, strict UTF-8 and strict zod.
  - URLs are allowlisted. No part's URL is ever fetched, so there is no SSRF.
  - Deep nesting is caught. Replays are matched by exact URL.
- **New routes:**
  - `/api/health` returns state names and timings only.
  - `/api/cron/snapshot` takes a CRON_SECRET of at least 32 characters, compared in constant time. Without it, the answer is a bare 401 that reveals nothing, and its lock is released only by the holder.
- **Errors and logs:** fixed messages per code, with no stack trace and no `err.message`. The log is a strict allowlist: names, codes, statuses, durations.
- **Headers:**
  - The production CSP: `default-src 'self'`, script-src without unsafe-eval, connect-src limited to the site, Sleeper and ESPN's read host, and `frame-ancestors 'none'`.
  - Also X-Frame-Options DENY, nosniff, Referrer-Policy same-origin, a Permissions-Policy, and no X-Powered-By.
  - FantasyCalc links carry `rel="noopener"` and `referrerpolicy="origin"`, which overrides the page's policy for that one link.
- **Go/no-go checks:**
  - **URLs:** no league id, username, SWID or cookie in any of our URLs. API calls are POST bodies or bare GETs. Pages carry only team ids (small per-league integers) and player ids. Forms have no named fields before hydration.
  - **No analytics or third-party scripts:** none among the dependencies, no `next/script`, no remote fonts, and Upstash telemetry is off.
  - **Client bundles:** they hold no secret (no `NEXT_PUBLIC_*`), and the DynastyProcess map and crosswalk never reach them. The import graph from all 31 client entries and the worker reaches only next, react and zod.
- **Dependencies:**
  - **Audit:** `npm audit --omit=dev` on 2026-10-05 found 0 advisories in production dependencies. The one dev-only advisory (`braces`, via eslint-config-next) is unreachable from the build.
  - **Changes:** no dependency was added since checkpoint-7a, and the lockfile is unchanged.
  - **Lockfile:** every entry has sha512 integrity from the npm registry, and none of the September 2025 hijacked versions is present.
  - **Licenses:** MIT, Apache-2.0, ISC, BSD, 0BSD and CC-BY-4.0. sharp's optional libvips binaries (LGPL) run server-side only.

## Findings and what happened

| # | Area | Severity | Finding | Outcome |
|---|---|---|---|---|
| 1 | Credentials | low | An `espn_s2` between 2,778 and 4,000 characters passed the checks but couldn't fit the sealed cookie, so the save failed with a 500 and two log lines | Fixed: at most 2,000 characters (a 400 answer in words), with a backstop for an oversized cookie |
| 2 | Outbound budget | low | Any pasted cookie, even a made-up one, made requests "privileged" and could spend the 1,000 ESPN requests kept for private leagues | Fixed: each client may take at most 50 of that reserve a day |
| 3 | Work budget | medium | A 17 KB gzip upload that unpacks to 5.9 MB cost about 0.7 s of CPU for 3 units | Fixed: uploads are also priced by their unpacked size (500 KB a unit), charged right after gunzip |
| 4 | Upstash quota | medium | Every request to every route ran a shared rate-limit check in Upstash, and /api/health added 3 commands per call | Fixed: only import and model requests use the shared limiter (others count per instance); health checks the store at most once per 5 minutes per instance |
| 5 | Platform allowances | medium | Refusals happen inside the function, so they still count as Vercel invocations; floods of OPTIONS or 405 requests never reach our code | Deferred to launch: the Vercel WAF rule on `/api/*` (go/no-go list) |
| 6 | Error log | low | Rate-limit refusals and 5xx answers could fill a day's 1,000 log entries, and a forged upload could log "ESPN is down" | Fixed: a log throttle (one rate-limit line per 10 minutes per instance; repeats once a minute); forged uploads answer BAD_UPLOAD |
| 7 | Client bundles | low | Nothing tested that client code can't reach server modules, so "the DynastyProcess map stays server-side" rested on convention | Fixed: `src/server/clientBundle.test.ts` follows the import graph from every client entry |
| 8 | Next | low | Next's image optimizer (`/_next/image`) was on, unused and unlimited | Fixed in Next's config: `images.unoptimized` (`src/server/nextConfig.test.ts`). ⚠️ On the 7b preview, Vercel's own optimizer still answers `/_next/image` for a local icon (2026-10-06: `?url=/apple-icon.png&w=32` gave a 348-byte PNG; other widths and other sites' images got 400), so it was bounded to a few sizes of the app's own raster images. It answers on `/_vercel/image` too (2026-10-07: the same PNG at `w=32`, and 605 bytes at `w=64`; `icon.svg` got 400). At launch, in the same step as finding 5's rule, a WAF custom rule denies both paths (Parker, 2026-10-07) |
| 9 | Cookies | info | The cookie has no `__Host-` prefix | Accepted for `*.vercel.app`, which is on the public suffix list, so a sibling app can't set our cookies. Revisit with a custom domain |
| 10 | Licensing | info | Each saved ESPN import keeps the ESPN-to-Sleeper id pairs for its players, and DynastyProcess is the first source of those links | The map itself stays server-side. ⚠️ A per-league slice of id links reaches the user's browser: worth the GPL-3.0 review the spec plans before any downloadable version |
| 11 | Headers | info | No HSTS header of our own | ✅ Vercel adds it: the 7b preview answers `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (2026-10-06) |
| 12 | URLs | info | The Analyzer's "Back to the Trade Finder" link (`?partner=<team id>`) prefetched | Fixed: `prefetch={false}` |
| 13 | URLs | info | Phase 5: Yahoo team keys contain the league id | For Phase 5: put a per-league index in `?partner=`, not Yahoo's key |
| 14 | Dependencies | info | `braces` advisory (dev only) | Accepted: unreachable from the build. Checkpoint 7c (2026-10-07): the dev-only lint chain is unchanged (braces, micromatch, fast-glob, @next/eslint-plugin-next, eslint-config-next); one new advisory reached production dependencies, `source-map-js` 1.2.1 (GHSA-68fv-2mgg-jv7q, high: a crafted source map can block the event loop; reached only at build time, through postcss), fixed by 1.2.2; `npm audit --omit=dev`: 0 |
| 15 | Firewall | low | The WAF rule counts requests the app refuses before counting them (BAD_ORIGIN): a page on another site could make a visitor's browser send 80 cross-site requests to `/api/health` and lock that visitor out of `/api` for up to 10 minutes (Checkpoint 7c's review of the limit) | Proposed: a third custom rule above the rate limit denies `/api/` requests whose `sec-fetch-site` is `cross-site` (a planner question at Checkpoint 7c; `reports/beta-infrastructure.md`). Otherwise accepted: the visitor's own page must stay open on the hostile site, and the lockout ends with the window |

## For launch
- **The WAF rule** (finding 5): one Vercel rate-limit rule on `/api/*` by IP, 80 requests per 10 minutes (confirmed at Checkpoint 7c: above every route's own limit, so a user who overuses one route gets the app's own answer first; `reports/beta-infrastructure.md`). Over the limit it must answer 429 (Too Many Requests): not Deny (a 403, which the app shows as "Something went wrong on our side") and never a challenge, which would set a cookie the privacy page doesn't mention.
- **The image rule** (finding 8; Parker, 2026-10-07): in the same step, a custom rule that denies `/_next/image` and `/_vercel/image`. Hobby allows 3 custom rules; these are 2 of them. The steps: `reports/beta-infrastructure.md`, "Launch-day steps".
- **Next:** on 16.3.8 since Checkpoint 7c (2026-09-30's security release: one high and several medium advisories); stay on the latest 16.3.x patch before the go. `npm audit` can't see the libraries Next vendors.
- **Finding 15's rule** (optional, the planner's call): "Deny cross-site API requests", above the rate limit.
- **Optional hardening:** `"installCommand": "npm ci"` in `vercel.json`, so a lockfile drift fails the build.
