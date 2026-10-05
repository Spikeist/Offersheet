# The beta's infrastructure: cache, limits, budgets and the free tiers (Checkpoint 7a)

Written for the planner and Parker. Production stays off until Parker's "go" at Checkpoint 7b; everything here runs on
protected previews. Numbers come from `npm run measure:cache`, `npm run measure:upload`, the final review's offline route
driver (this PC, an i9 desktop, Node 22; ⚠️ Vercel's CPUs may be slower) and the code's constants (`src/server/limits.ts`).
CLAUDE.md Section 3 is the reference; this is the summary with the arithmetic.

## Where things run

| Piece | Where | Notes |
|---|---|---|
| Pages, the engine (trade search, odds) | Static files; the visitor's browser | Trade searches cost the server nothing |
| Server routes (import, model, ESPN session, feedback) | Vercel Hobby, project `offersheet`, iad1, Fluid compute | `withRoute` on every route |
| Shared store | Upstash Redis free plan (Vercel Marketplace), to be created in US East | Vercel only; local runs unchanged |
| Public ESPN and Sleeper league reads | The visitor's browser (CORS), uploaded to our server | Private ESPN stays on the server |

## The shared cache (B1)

- **What's cached:** league-independent data (Sleeper projections, stats, player lists; the DynastyProcess map;
  FantasyCalc lists; the NFL schedule) and league data our server reads itself (private ESPN with cookies; leagues a
  browser couldn't read). League data a browser sends is never cached.
- **Keys:** `os:<preview|production>:c:` + HMAC-SHA256 of the cache key, under a key derived from SESSION_SECRET. League
  ids, usernames and cookie fingerprints never reach Upstash. Private ESPN data stays keyed by a cookie fingerprint.
- **Values:** gzipped, then AES-256-GCM encrypted with a second derived key and bound to their Redis key, so Upstash
  holds only ciphertext. Each value expires with its §2.10 retention (league data 10 minutes, public data up to 7 days,
  FantasyCalc lists 90 days).
- **Tiers and failure:**
  - A per-instance memory tier (64 MB) sits in front of Upstash.
  - Each Upstash command waits at most 1 s. A failure pauses Upstash for 60 s per instance, so the app runs on memory.
  - Measured with Upstash unreachable: 12 of 12 requests answered in 1.5–2.4 s.
- **Single-flight across instances** for public data: a 20 s lock; waiters take the holder's copy, at most 8 s.
- **Smaller bodies:** public bodies are reduced to the fields our code reads, proved identical for every reader, under
  new keys.
  - One Sleeper projection week: 193 → 32 KB gzip.
  - A model build parses 40 → 6 MB, and its CPU drops from 0.9 to 0.4–0.6 s.

## Browser reads and signed imports (B1)

- **Upload:** the browser reads the league itself (credentials omitted, paced, retried) and uploads the parts gzipped.
  - ESPN, Parker's full-size league: 12 requests, 7.8 MB decoded → a 515 KB upload. Sleeper: 13 KB.
  - The server checks every part, replays it through the same adapter and gets an identical snapshot (proved on
    fixtures and Parker's capture).
- **Signed import:** the import comes back with an HMAC token (15 minutes). The League page sends it back (23 KB gzip),
  and the model route builds without reading any league data. A replay of the same signed import costs a lookup.
- **Live check:** `npm run check:browser -- --live --team 3` read Parker's league in the browser (23 ESPN reads),
  uploaded it, built the League page from the signed import and ran a full search. 84 passed, 0 failed.

## Limits and budgets (B1, after the final review)

| Mechanism | Rule | Over it |
|---|---|---|
| Per-IP window | import 30 and model 30 per 10 min; session 20 per 10 min; feedback 60 an hour. IPv6 by /64, plus its /48 at 10× | 429 "You're going a bit fast. Try again in about N minutes." |
| Daily work budget (Vercel) | Units of ~100 ms CPU or ~75 KB body: 500 per visitor, 2,000 per address block (IPv4 /24, IPv6 /48), 4,000 per server per day, in 2-hour slices | BUSY until the next slice or day |
| Outbound budgets (server's own requests) | ESPN 4,000 (1,000 kept for cookie requests), Sleeper 15,000, FantasyCalc 200, GitHub 100 a day; per address block ESPN 400, Sleeper 1,500 | League import: BUSY ("…used today's share of requests to ESPN…"). Public data: the saved copy |
| Deadlines | import 45 s, model 90 s, session and feedback 10 s (maxDuration 60/120/15/15) | SOURCE_SLOW naming the slow source |
| Uploads | league 2 MB packed / 6 MB unpacked; signed import 1 MB / 4 MB; model work ≤ 60,000 | BAD_UPLOAD → the browser asks the server instead |
| Feedback store | 100 copies a day stored; 30 per visitor and 60 per address block a day; ≤ 2,048 B a copy | 429 (copies are fire-and-forget: the user sees nothing) |

- Every counter keys on an HMAC of the IP address (or its block), never the address itself.
- Short-window counts are deleted within an hour. Day counts are deleted a minute after midnight UTC.
- Production's first layer at 7b: one Vercel WAF rate-limit rule on `/api/*` (about 60–80 per 10 minutes per IP).

## Free-tier arithmetic (per session; a session = Connect import + League page)

| Session | Upstash commands | Upstash bytes | Vercel CPU | Fast Origin Transfer |
|---|---|---|---|---|
| ESPN browser path, warm instance | ~9 | ~2 KB | ~0.5 s | ~0.84 MB (the upload is 65%) |
| ESPN browser path, cold instances | ~57 | ~3.9 MB read | ~1.1 s | same |
| Sleeper browser path, warm | ~9 | ~2 KB | ~0.5 s | ~0.30 MB |
| Private ESPN (server reads), new league | ~60 | ~1.9 MB written (10 min) | ~0.9 s | ~0.29 MB |
| A feedback press | 5–9 | ~1 KB | ms | ~3 KB |
| Keeping public data fresh, per day | ~900–1,500 | ~10–20 MB | ~5–20 s | 0 |

### The allowances

| Allowance | Free amount | A day |
|---|---|---|
| Upstash commands | 500K a month | 16.7K |
| Upstash bandwidth | 10 GB a month | 333 MB |
| Vercel Active CPU | 4 h a month | 480 s |
| Fast Origin Transfer | 10 GB a month | 333 MB |
| Invocations | 1M a month | 33K |

### What binds first

- **Cold instances:** Upstash bandwidth binds first, at about 80–140 sessions a day.
- **Warm instances:**
  - ESPN sessions are bound by Fast Origin Transfer, at about 400 a day.
  - Sleeper sessions are bound by CPU, at about 450–900 a day, then by CDN requests, at about 670.
- **Private ESPN:** Upstash bandwidth binds first, at about 170 a day warm and 57 cold. The ESPN budget allows about
  180–330 cold private imports a day.
- **The work budget** caps the whole server at about 400 CPU-seconds and 300 MB a day. That stays inside the monthly
  allowances, so Vercel can't pause the project. The price: on a very busy day everyone gets BUSY until the next slice.
- **Overall:** the free tiers carry roughly 100–400 sessions a day, about 3,000–12,000 a month.

## When a limit is hit

| Limit | What happens | What the user sees |
|---|---|---|
| Upstash commands or bandwidth | Everything falls back per instance: memory cache, per-process limits and budgets, console-only log | Nothing; feedback copies aren't stored. Lasts until Upstash's monthly reset |
| Upstash storage | Writes are refused; it recovers as entries expire | Nothing |
| Our work budget or outbound budgets | Requests are refused with BUSY | A clear message with the wait |
| Vercel allowance | The project is paused (503) for up to 30 days | "Offer Sheet isn't available right now. Try again later." The work budget exists to prevent this |

## Parker's setup steps

The click-by-click steps for Upstash, the protection check and the phone are in Checkpoint 7a, "How Parker can try it".
