# The beta's infrastructure: cache, limits, budgets and the free tiers (Checkpoints 7a and 7b)

Written for the planner and Parker at Checkpoint 7a, updated for Checkpoint 7b (`reports/planner-reply-7a.md`) and for the
launch since (Checkpoint 7d: the third firewall rule, `reports/planner-reply-7c.md`, answer 4). Production stays off until
Parker's "go". Numbers: `npm run measure:cache`, `measure:upload` and `load:test` (`reports/load-test.md`),
the offline route drivers (an i9 desktop; ⚠️ Vercel's CPUs may be slower) and `src/server/limits.ts`. CLAUDE.md Section 3
is the reference; this is the summary with the arithmetic.

**Where things run:** pages and the engine in the visitor's browser, which also reads public ESPN and Sleeper leagues and
uploads them; the server routes (import, model, ESPN session, feedback, health, snapshot cron, each in `withRoute`) on
Vercel Hobby (`offersheet`, iad1, Fluid compute), which reads private ESPN leagues itself; the shared store on Upstash's
free plan (Vercel Marketplace, connected by Parker), Vercel only: US East (✅ the store's settings read through Vercel's API
on 2026-10-05: primary region iad1, AWS us-east-1, no read regions, eviction and auto-upgrade off) with backups off (✅ Parker
checked Upstash's console on 2026-10-05).

## The shared cache and browser reads (B1)

- **What's cached:** league-independent data (Sleeper projections, stats and player lists; the DynastyProcess map;
  FantasyCalc lists, `/values/current` only since its conditions; the NFL schedule) and league data the server reads
  itself. League data a browser sends is never cached.
- **Keys and values:** `os:<env>:c:` + an HMAC of the cache key (no league id, username or cookie fingerprint reaches
  Upstash); values gzipped, AES-256-GCM encrypted, bound to their key and deleted at their CLAUDE.md §2.10 retention.
- **FantasyCalc every 3 hours (7b; planner reply to Checkpoint 7a, §5.4):** a list is fresh for 3 hours (a day at 7a),
  so each format is asked for at most once every 3 hours, and only when a League page build or the snapshot cron (a
  format in use without today's copy) needs it (⚠️ in an outage each instance asks again within 15 minutes). Lists are
  kept 90 days as the outage fallback.
- **Tiers:** a 64 MB memory tier per instance in front of Upstash; each command waits at most 1 s, and a failure pauses
  Upstash for 60 s on that instance. Public data has a 20 s cross-instance lock. 7b: concurrent reads of one entry on an
  instance share one Upstash GET (50 cold League page builds on one instance: 69 cache commands, 1,173 before).
- **Browser reads:** the browser uploads a public league's parts gzipped (Parker's ESPN league 515 KB, Sleeper 13 KB),
  and the server replays them through the adapter. The answer is signed (15 minutes), so the League page sends it back
  (about 24 KB gzip) and the model route reads no league data; a replay costs a lookup.

## Limits and budgets (B1; B4 changes marked 7b)

| Mechanism | Rule | Over it |
|---|---|---|
| Per-IP window | import 30 and model 30 per 10 min, counted in Upstash. 7b: session 20, health 12 and cron 10 per 10 min and feedback 60 an hour count per instance (they ask no platform anything; in Upstash one IPv4 address at their limits all day could spend about 24,000 commands). IPv6 by /64, plus its /48 at 10×. Every per-visitor count is kept under an HMAC of the address or its block, never the address; window counts go within an hour, day counts a minute after midnight UTC | 429 "You're going a bit fast. Try again in about N minutes." |
| Daily work budget (Vercel) | Units of ~100 ms CPU or ~75 KB of body (7b: or ~500 KB unpacked, whichever costs more): 500 per visitor, 2,000 per address block (IPv4 /24, IPv6 /48), 4,000 per server a day, in 2-hour slices. 7b: a refused charge costs no one anything (its units go back; a visitor over its own day never reaches the shared counters) | BUSY: the capacity message, or the visitor's own share |
| Outbound budgets (server's own requests) | ESPN 4,000 (1,000 kept for cookie requests; 7b: at most 50 of them per address block), Sleeper 15,000, FantasyCalc 1,500 (7b, was 200: the 3-hour rule's bound for all 144 formats, 1,152 a day, plus room for the slices and retries), GitHub 100 a day; per address block ESPN 400, Sleeper 1,500. 7b: an attempt counts once it's next in line to go out, and gets its count back if it doesn't | League import: BUSY. Public data: the saved copy |
| League page builds (7b) | 8 at once per instance, first come first served; a waiting build gives up with under 30 s of its 90 s left | BUSY "Offer Sheet is busy right now. Try again in a minute." (Retry-After 60) |
| Deadlines | import 45 s, model 90 s, session, feedback and health 10 s, cron 110 s (maxDuration 60/120/15/15/15/120) | SOURCE_SLOW naming the slow source |
| Uploads | league 2 MB packed / 6 MB unpacked; signed import 1 MB / 4 MB; model work ≤ 60,000 | BAD_UPLOAD → the browser asks the server instead |
| Feedback store | 100 copies a day stored; 30 per visitor and 60 per address block a day; ≤ 2,048 B a copy | 429 past a visitor's or block's day; past 100 a day the oldest go; a bigger copy 400 (copies are fire-and-forget: the user sees nothing) |
| Error log | the newest 1,000 lines a day, 14 days. 7b: one "rate_limited" line per 10 min per instance, and one a minute of each repeating failure | The rest dropped (the usage counters still count every refusal) |

- **The capacity message (7b; planner reply to Checkpoint 7a, §2 question 7):** the server's day or slice of work, or a
  platform's day, used up: "The beta is at capacity today. It resets at <time>." (when the next slice opens more of the
  day, else midnight UTC; in the visitor's time zone). A visitor's or block's own day: "Your connection has used today's
  share of requests to … It resets at …". Both count for `usage:report`.
- **The Vercel WAF** (production's first layer; reply §2 question 7): rate limiting is on Hobby: 1 rule, a fixed
  window of 10 s to 10 minutes, keyed by IP or JA4, 1,000,000 requests included (✅ Vercel's docs, "WAF Rate Limiting",
  updated 2026-08-28, read 2026-10-05). The plan, set at
  launch: one rule on `/api/*` by IP, 80 requests per 10 minutes (7a's "about 60–80", confirmed at Checkpoint 7c,
  planner reply to Checkpoint 7b, §4: above every route's own limit, import 30, model 30, session 20, health 12, cron
  10 per 10 minutes and feedback 60 an hour and 30 a day, so a user who overuses any one of them gets the app's own
  answer first; a normal session makes 3–8 `/api` requests, 12 with every fallback, and a 10-league Sleeper batch
  about 21; ⚠️ only a mix of every kind past 80, or many people behind one address, meets the firewall first, and its
  429 then reads the same "You're going a bit fast"), answering 429 over the limit:
  never Deny (a 403, which the app shows as "Something went wrong on our side", and a browser read whose upload gets
  it tries again through the server) and never a challenge (it sets Vercel's `_vcrcs` cookie, which the privacy page's
  cookie line doesn't cover). In the same step (Parker, 2026-10-07), a second custom rule denies Vercel's image
  optimizer, `/_next/image` and `/_vercel/image`: the app doesn't use it, and Vercel still answers both paths despite
  `images.unoptimized` (the 7b preview, 2026-10-07: `?url=/apple-icon.png&w=32` gave the same 348-byte PNG on both
  paths and `w=64` a 605-byte one on `/_vercel/image`; `w=33` on `/_next/image` and `icon.svg` on `/_vercel/image`
  got 400).
  Hobby allows 3 custom rules; these are 2 of them, and the third denies cross-site API requests (next bullet). The
  steps: "Launch-day steps" below.
- **A third rule denies cross-site API requests, first** (required since the planner's reply to Checkpoint 7c, answer 4:
  "deny `/api/` requests whose `Sec-Fetch-Site` header is `cross-site`. Put it before the rate-limit rule so those
  requests don't count toward a visitor's limit."; Checkpoint 7c's review of the limit, `reports/security-review.md`,
  finding 15): `withRoute` refuses a cross-site request before counting it (BAD_ORIGIN; `route.test.ts`: "another
  site's `<img>` GETs can't lock a visitor out"), but the firewall's rate limit counts it first, so without the rule a
  page on another site could make a visitor's browser send 80 requests to `/api/health` and lock that visitor out of
  `/api` for up to 10 minutes. The rule, "Deny cross-site API requests": if *Request Path* starts with `/api/` AND
  *Request Header* `sec-fetch-site` equals `cross-site`, then *Deny*, first in the list, above "API rate limit" (then
  "Block image optimizer").
  - **The order** (the planner: "Check that Vercel applies the rules in that order"; Vercel's docs, read by the lead on
    2026-10-09): "Deny: Blocks the request and no further rules are evaluated." (Rule Configuration Reference, updated
    2025-04-21) and "You also have the ability to re-order the precedence of each custom rule." (WAF Custom Rules,
    updated 2026-09-10). So a Deny placed above the rate limit ends a cross-site request before the rate limit sees it
    (✅ Vercel's docs; ⚠️ not tried live: only a visitor past 80 requests could show it).
  - **Room on Hobby:** "Hobby projects can have up to 3 total custom firewall rules" (WAF Rate Limiting, updated
    2026-08-28), the rate limit among them: the three rules use all three. **If Vercel refuses a third rule anyway,**
    the cross-site condition becomes a third OR group of "Block image optimizer" (*Request Path* starts with `/api/` AND
    *Request Header* `sec-fetch-site` equals `cross-site`), and that rule then moves above "API rate limit".
  - **Who it touches:** current browsers send `Sec-Fetch-Site` on every request (⚠️ an old browser that sends none
    passes the rule and is counted, as before it); the app's own pages ask `/api` same-origin, a typed address sends
    `none`, and the cron, `vercel curl`, the store-reading scripts and `prod:deploy`'s other requests send none, so the
    rule touches none of them. A link on another site (a search result, a post) opens a page with `cross-site` too:
    the path condition is what leaves pages alone.
  - **Later, for Phase 5** (review of Checkpoint 7d, PD7D-3): an `/api/` address another site sends the browser to
    arrives `cross-site`, and both this rule and `withRoute`'s same-origin check (BAD_ORIGIN) refuse it. Yahoo's OAuth
    callback is one (CLAUDE.md §2.4: `/api/auth/yahoo/callback`, which Yahoo's login sends the browser back to), and
    perhaps the planned Chrome extension's requests (⚠️ what `Sec-Fetch-Site` an extension sends isn't checked; an
    `Origin` of `chrome-extension://…` already fails `withRoute`'s check). Each needs an exception in this rule (a
    condition that leaves its path out) and in `withRoute`, or an address outside `/api/`. The rule lives only in
    Vercel's dashboard, where no test sees it.
  - **The check** (the planner: "a request with that header gets 403, and the app still works"): `npm run prod:deploy`
    asks `/api/health` on the production domain with `Sec-Fetch-Site: cross-site` (403 expected) and with `same-origin`
    (not denied: the landing page's 404 before the deploy, the health check's 200 after), and `/` opened from another
    site (not denied: the landing page's 200 before, the app's 200 after; a 403 there means the rule lost its path
    condition, review of the policy-deploy track, PD-1), in the dry run, before a live upload, after it, and with
    `--verify`. The app answers a cross-site request with a 403 of its own (BAD_ORIGIN), but only after the rate limit
    counted it, so the check tells the two apart by the app's JSON and fails on the app's.

## Health check, usage counters and the snapshot cron (7b)

- **`/api/health`** (reply §1): the instance's store (shared, memory or file), why it isn't shared, and a timed SET, GET
  and DEL of a random key (on the preview, 2026-10-05: writes 5–8 ms once warm, as expected in the same region); never an
  address, token or value. An instance checks
  Upstash at most once every 5 minutes (3 commands, at most 864 a day); 12 requests per 10 minutes per IP; no work units.
- **Usage counters** (`src/server/usage.ts`): one key per counter and UTC day, no identifiers: League page builds
  (FantasyCalc's "sessions"), imports by platform and path, refusals (capacity, visitor, rate), work units, outbound
  requests. Written after the answer, 4 commands a request; refusals are held for a later write, on their own at most
  every 5 minutes per instance (⚠️ a floor). Kept 400 days. `npm run usage:report -- --live` (one MGET): the month's
  sessions against FantasyCalc's 10,000 (warning from 8,000), today's units and requests against their budgets, refusals.
- **The snapshot cron** (reply §6.3; `vercel.json`, `src/server/snapshots.ts`): `0 20 * * *` UTC, production only (on
  Hobby once a day within that hour). CRON_SECRET or a bare 401, a 10-minute lock, idempotent saves: this and next week's
  Sleeper projections while their first kickoff is ahead (the last pre-kickoff copy wins), and today's FantasyCalc list
  of each format League pages read yesterday or today, at most 12 a day, taking turns. Since Checkpoint 7c (planner
  reply to Checkpoint 7b, question 4), last and only with 45 s of the run's deadline left, the day's rest-of-season
  levels: every offense player's mean of Sleeper's own standard, half-PPR and PPR projections over the weeks still ahead
  through week 18 (`src/server/projectionLevels.ts`), never a league's scoring, the blend or FantasyCalc; one record a
  UTC day (SET NX), all or nothing, at most one Sleeper request a week, usually none (League page builds cache the same
  lists). Kept 730 days (`npm run snapshot:pull -- --live` copies them to `data-local/`). ⚠️ About a hundred commands and
  under 1 MB a run (our count); the levels add about 15 more (a cache read a week and the record's SET) and up to about
  0.5 MB read on a cold instance (⚠️ our estimate: 14 weeks of about 32 KB each in the cached form).
- **Snapshot storage** (`snapshotLimits`): a projection week about 52 KB, a list 6.2 KB (redraft) to 11.6 KB (dynasty),
  a day's levels about 8 KB (524 players on 2026-10-07: about 1.5 MB a season, 3 MB for the two seasons kept). Two
  seasons at the cap every day, dynasty lists only: about 108 MB with the levels, which fits the free 256 MB beside the
  feedback store's bound (about 75 MB) and the cache, log and counters (a few MB). ⚠️ Expected: about 22 MB a year.

## Free-tier arithmetic (per session; a session = Connect import + League page)

| Session | Upstash commands | Upstash bytes | Vercel CPU | Fast Origin Transfer | Work units |
|---|---|---|---|---|---|
| ESPN browser path, warm instances | ~26 | ~2 KB | ~0.5 s | ~0.84 MB (the upload is 65%) | 15 |
| ESPN browser path, cold instances | ~60 | ~2.1 MB read ⚠️ | ~0.8 s ⚠️ | same | 15 |
| Sleeper browser path, warm | ~26 | ~2 KB | ~0.5 s | ~0.30 MB | 8 |
| Private ESPN (server reads), new league | ~100 | ~1.9 MB written (10 min) | ~0.9 s | ~0.29 MB | 11 |
| A feedback press | ~7 | ~1 KB | ms | ~3 KB | 0 |
| Keeping public data fresh, per day | ~1,300–2,000 ⚠️ | ~15–30 MB ⚠️ | ~5–20 s | 0 | — |

- **Commands** (`npm run load:test`): a warm request costs 13 (the rate limit 3, the work budget 6, the usage counters
  4). A cold instance (memory empty, Upstash warm) adds a GET per public entry: about 12 for an ESPN upload, 23 for a
  build. A new private league adds 4 per ESPN request (its block's share and the day) and its cache reads and writes.
- ⚠️ **Derived:** cold bytes are the upload's crosswalk lists (about 1.1 MB as stored now, `npm run measure:cache`) plus
  the build's public data (about 1.0 MB); 7a's 3.9 MB and 1.1 s also counted the crosswalk a build no longer reads (final
  review F3: 1.43 MB, about 0.28 s) and FantasyCalc's `/players` (about 0.27 MB). Public data: 7a's estimate plus
  FantasyCalc every 3 hours (about 35 commands and 0.4–0.8 MB a day more per format; about 12 formats) and the cron.
- **Allowances,** a month (a day): Upstash 500K commands (16.7K), 10 GB bandwidth (333 MB) and 256 MB of storage;
  Vercel 4 h Active CPU (480 s), 10 GB Fast Origin Transfer (333 MB) and 1M invocations (33K).

### What binds first

- **Warm instances:** the work budget, by design: about 270 ESPN sessions a day, or 500 Sleeper ones. Next: Fast
  Origin Transfer for ESPN (about 400) and Upstash commands for Sleeper (about 550).
- **Cold instances:** Upstash bandwidth, at about 150 ESPN sessions a day (80–140 at 7a), then commands (about 240).
- **Private ESPN, new leagues:** Upstash commands, at about 145 a day (bandwidth about 165); on cold instances
  bandwidth, at about 80. ESPN's budget allows about 180–330 a day.
- **The work budget** caps the whole server at about 400 CPU-seconds and 300 MB a day, inside the monthly allowances,
  so Vercel can't pause the project. The price: on a very busy day everyone gets the capacity message until the next slice.
- **Overall:** ⚠️ roughly 150–500 sessions a day, about 4,500–15,000 a month. FantasyCalc's free use (7b) holds under
  about 10,000 a month (about 330 a day), so a busy month can reach it first; `usage:report` warns from 8,000.
- **Cutting cold-instance reads with Vercel's CDN** (reply §2 question 7: "if it's cheap"): not built; ship as is and
  revisit with real traffic. A public `s-maxage` route for the shared data bundles would (1) republish FantasyCalc's lists,
  which their conditions forbid displaying or reproducing, and Sleeper's and the GPL DynastyProcess map's data to anyone;
  (2) be unreachable on protected previews without a managed bypass secret; (3) be a 0.5–1 MB public response anyone can
  request repeatedly, paid in Fast Data Transfer and edge requests (running out pauses a Hobby project). Cold reads already
  fell from about 3.9 to about 2.1 MB (no `/players`; builds no longer read the crosswalk) and from 1,173 to 69 cache
  commands in a cold burst (shared reads). If Upstash bandwidth binds, the cheaper next step is caching a compact built
  crosswalk instead of the 1.1 MB of raw lists an import reads cold.

## When a limit is hit

| Limit | What happens | What the user sees |
|---|---|---|
| Upstash commands or bandwidth | Everything falls back per instance: memory cache, per-process limits and budgets, console-only log; usage counts and snapshots aren't stored | Nothing; feedback copies aren't stored. Lasts until Upstash's monthly reset |
| Upstash storage | Writes are refused; it recovers as entries expire | Nothing |
| Our work budget or outbound budgets | Requests are refused with BUSY | "The beta is at capacity today. It resets at <time>.", or the visitor's own share |
| Builds at once on an instance | A build that waits too long is refused with BUSY | "Offer Sheet is busy right now. Try again in a minute." |
| Vercel allowance | The project is paused (503) for up to 30 days | "Offer Sheet isn't available right now. Try again later." The work budget exists to prevent this |

## The load test (B4; details in `reports/load-test.md`)

- `npm run load:test`, offline: 50 requests at once through the real routes, HTTP client, budgets and rate limiter, on 1
  and 10 instances, against mocked platforms and an in-memory Upstash. No 500s, no answer past its deadline + 5 s, every
  host paced (ESPN at least 600 ms apart, Sleeper 120 ms), public data fetched once across 10 instances.
- Bounds: server-path ESPN imports by pacing (about 37 ESPN requests per instance in the 45 s deadline: 3 new leagues;
  the rest SOURCE_SLOW, "Offer Sheet is busy"); uploads by CPU (about 0.1 s each); builds by CPU (0.5 s) and memory.
- Fixed after it: outbound attempts counted when they go out (82 counted for 35 sent; now 34 of 34); refused work
  charges given back (162 units for 27 refused imports); the build cap (50 cold builds ran out of memory at a 768 MB
  heap; capped, 366 MB live at the peak); shared cache reads. Upstash commands per request now: cold server-path import
  17.0, ESPN upload 14.8, Sleeper upload 15.3, cold build 17.1, warm build 13.
- Still open: partial imports answer 200 (free agents or player cards cut by Offer Sheet's own queue). The small live
  test ran on 2026-10-06 on the protected preview (`reports/load-test.md`, last section).

## Launch-day steps (Tuesday, October 13, 2026)

Parker does steps 1–4 and then gives the go; no deployment reaches production before it, and production deploys only
through `npm run prod:deploy` (planner reply to Checkpoint 7b, §2; CLAUDE.md §16 and §19). Every command is PowerShell,
one per line, in the project folder. (Upstash, the protection check and the phone were Checkpoint 7a's steps.)

**The tag:** `checkpoint-7d`, approved by Parker on 2026-10-14 (the planner, reply to Checkpoint 7c: "If 7d is approved
in time, production deploys `checkpoint-7d` instead"). The script refuses any tag but the newest checkpoint, so a wrong
one stops at its first line.

1. **Production's secrets** (PowerShell, one per line; each makes a random value and gives it to Vercel without
   showing it):
   ```
   npm run vercel:secret -- --live --env production
   npm run vercel:secret -- --live --name CRON_SECRET
   ```
2. **The firewall rules, in one sitting, in this order** (Vercel → offersheet → Firewall → Configure → New Rule, once per
   rule; then review and publish the changes). Vercel applies the rules in their order and a Deny stops the rest (its
   docs, quoted above), so if it lists them otherwise, drag them into this order before publishing:
   1. **"Deny cross-site API requests"** (first; planner reply to Checkpoint 7c, answer 4; `reports/security-review.md`,
      finding 15): if *Request Path* starts with `/api/` AND *Request Header* `sec-fetch-site` equals `cross-site`, then
      *Deny*. First, so another site's requests are denied before the rate limit counts them toward a visitor's 80. Both
      conditions, in one group: without the path one, the rule would deny every page opened from a link on another site.
   2. **"API rate limit":** if *Request Path* starts with `/api/`, then *Rate Limit*: fixed window, 10 minutes, 80
      requests, keyed by IP; over the limit, *Too Many Requests (429)*. Not *Deny* (a 403, which the app shows as
      "Something went wrong on our side") and never *Challenge* (it sets Vercel's `_vcrcs` cookie, which the privacy
      page's cookie line doesn't cover).
   3. **"Block image optimizer":** if *Request Path* starts with `/_next/image`, OR *Request Path* starts with
      `/_vercel/image`, then *Deny*. The app doesn't use Vercel's image optimizer (`reports/security-review.md`,
      finding 8).

   **If Vercel refuses a third rule** (Hobby allows 3 custom rules, the rate limit among them, so it shouldn't): add the
   cross-site condition to "Block image optimizer" as a third OR group with both conditions (*Request Path* starts with
   `/api/` AND *Request Header* `sec-fetch-site` equals `cross-site`), and move that rule above "API rate limit". The
   checks below read either setup the same way.

   **Done on 2026-10-14 with the Vercel CLI** (the dashboard didn't offer Parker the header condition): `vercel@62.2.0
   firewall rules add` once per rule, in this order, each with `--project offersheet` (no link, so nothing is written into
   this folder), the conditions as `--condition` JSON (path `pre` `/api/`, header `sec-fetch-site` `eq` `cross-site`; the
   rate limit `--action rate_limit --rate-limit-algo fixed_window --rate-limit-window 600 --rate-limit-requests 80
   --rate-limit-keys ip --rate-limit-action rate_limit`; the image paths as two `--or` groups), no `--duration`; run from a
   Node script with an argument array (no shell, so PowerShell can't mangle the JSON), the way `scripts/lib/vercelCli.ts`
   runs the CLI. Then `vercel firewall diff` (3 rules added, nothing else), `vercel firewall publish`, and `vercel firewall
   rules list --expand` shows them live in this order (every `actionDuration` null; the rate limit's action `rate_limit`,
   429). To change one later: `vercel firewall rules edit|reorder|remove … --project offersheet`, then `publish`.

   **The check** (the planner: "a request with that header gets 403, and the app still works"): step 4's dry run asks
   `/api/health` on the production domain with `Sec-Fetch-Site: cross-site` (it must get the firewall's 403) and with
   `same-origin` (it must not be denied: the landing page answers 404), on its "Cross-site API requests" line, and on
   the same line the home page as a link on another site opens it (it must not be denied: a 403 there means the
   cross-site condition lost its `/api/` path condition, which would turn away everyone arriving from a search result or
   a post); step 5 asks all three again once the app serves (the same-origin one then gets the health check's 200), and
   step 6 shows the app working on a phone (a typed address, which sends `Sec-Fetch-Site: none`). ⚠️ The order itself
   isn't asked: only a visitor past 80 requests could show it (Vercel's docs above say a Deny ends the list).
3. **Next:** on the latest 16.3.x patch. `npm view next@16.3 version` lists every 16.3 release; the last one must be
   16.3.8, the version the lock file pins (step 4's "Next" line asks the same). A newer 16.3 patch means stop: it needs a
   commit and a new approved tag, so launch on the approved tag with the patch next, or wait for the new tag's approval. A
   newer minor (16.4 and up) isn't a patch and doesn't stop the launch. (Not `npm outdated next`: with the exact pin its
   "Wanted" is always 16.3.8, and its "Latest" is npm's newest release of any line, so it can't tell whether a 16.3 patch
   exists.)
4. **The dry run** (it uploads nothing):
   ```
   npm run prod:deploy -- --checkpoint checkpoint-7d
   ```
   It checks that the tag is annotated and the newest checkpoint, exports it into a clean copy (every file byte for byte
   the tag), and runs every check: the build's files and `vercel.json`; what the checks after the deploy will compare
   production with, read from the tag itself (its own Content-Security-Policy and its app pages); Vercel's own dry run in
   the copy (exactly the copy's files, nothing private); the leak check over the copy; Deployment Protection (Standard:
   the line names the setting Vercel reports, `all_except_custom_domains` at Checkpoint 7c's dry run); Production's
   variables by name (`SESSION_SECRET` and `CRON_SECRET` from step 1, the store's from Checkpoint 7a, none that must not
   be there); the production domain; `/_next/image` and `/_vercel/image` answering 403 there already, and the cross-site
   check (step 2's rules, published); the rollback target (the deployment production serves now: the landing page,
   `offersheet-dtgsgk03x-parker-daniels.vercel.app` on 2026-10-07) and Next's newest patch. Every line must be ✅ (⚠️
   lines are notes). It ends with the rollback steps.

**Parker writes "go."**

5. **The deploy:**
   ```
   npm run prod:deploy -- --live --checkpoint checkpoint-7d
   ```
   It repeats every check and uploads only when all pass: the copy goes up with `vercel deploy --prod` and Vercel builds
   it (about 2–3 minutes; a build that fails never takes the domain). Then it checks https://offersheet.vercel.app:
   `/api/health` shows production and the shared store; the 10 app pages answer 200 with the tag's own
   Content-Security-Policy, the footer's FantasyCalc link and nothing loaded from another site; robots.txt names the
   production sitemap; the cron route answers 401 without its secret; `/_next/image` and `/_vercel/image` answer 403
   ("Block image optimizer"); a cross-site `/api/health` gets the firewall's 403, a same-origin one the health check's
   200, and the home page opened from another site the app's 200; `.env.local` is unchanged. It ends by printing the
   rollback steps.

   If a check after the deploy fails, or the domain takes longer than a minute to switch, ask it again without
   deploying (no Vercel CLI, nothing uploaded):
   ```
   npm run prod:deploy -- --verify --checkpoint checkpoint-7d
   ```
   Never run `--live` a second time to check: Hobby's Instant Rollback reaches only the previous production deployment,
   so a second deploy would leave no way back to the landing page. (The launch, 2026-10-14: the first page check right
   after the switch caught the landing page still cached at `/`, and `--verify` a minute later passed every check.)
6. **The phone:** Parker opens https://offersheet.vercel.app on his phone and imports his league.
7. **The cron's first run** (after 20:00 UTC): `npm run beta:log -- --live --env production` shows a `snapshot_run`
   line (once the read-only store variables below are typed in).

**If something's wrong, the rollback** (as the script prints it; seconds, no rebuild):
1. Vercel → offersheet → Deployments → the deployment production served before the deploy (the landing page; the
   script names it) → ⋯ → Instant Rollback → Confirm. Or in PowerShell, from your home folder (never the project
   folder):
   ```
   cd ~
   npx --yes vercel@62.2.0 rollback https://offersheet-dtgsgk03x-parker-daniels.vercel.app
   ```
   (⚠️ The CLI way hasn't been tried; the dashboard is the first way back.)
2. Hobby rolls back only to the previous production deployment, so this works until the next production deploy.
3. After a rollback Vercel stops giving new production deployments the domain: Undo Rollback in the dashboard before the
   next `npm run prod:deploy` can take it. `vercel promote`, `alias` and `redeploy` stay off-limits (CLAUDE.md §19).

A rollback leaves the environment variables, the firewall rules and the Upstash data as they are. The landing page has
no cron (⚠️ assumed), so the daily snapshots stop until the app serves again.

Until launch crons don't run, so `npm run snapshot:projections` by hand still keeps the pre-game projections. After
launch, to read the store from this PC: in Vercel, open Storage → upstash-kv-alizarin-saddle and type the values of
`KV_REST_API_URL` and `KV_REST_API_READ_ONLY_TOKEN` into `.env.local` as `READONLY_STORE_URL` and
`READONLY_STORE_TOKEN`, by hand. Then, for production (`usage:report`, `beta:log` and `feedback:report` read the
previews unless told otherwise; `snapshot:pull` reads production by default):
```
npm run usage:report -- --live --env production
npm run beta:log -- --live --env production
npm run feedback:report -- --live --env production
npm run snapshot:pull -- --live
```
The app never reads those two names, and the scripts read only after the store refuses a write made with the token;
otherwise they stop and read nothing (`scripts/lib/storeReader.ts`; ⚠️ the refusal's wording is assumed until the
first such run).

## A normal deploy (after launch: Checkpoint 7e on)

The planner (reply to Checkpoint 7d): "The one-time launch steps (secrets and firewall rules) are done, so a normal
deploy is the dry run, Parker's go, the deploy with its checks, and his phone check." PowerShell, one command per line,
in the project folder, with the approved tag (for Checkpoint 7e, `checkpoint-7e`, once Parker approves it and it's
tagged):

1. **The dry run** (it uploads nothing; every line must be ✅; it names the rollback target, the deployment production
   serves until then: `checkpoint-7d`'s, offersheet-e50m4rlg3-parker-daniels.vercel.app, until 7e deploys):
   ```
   npm run prod:deploy -- --checkpoint checkpoint-7e
   ```

**Parker writes "go."**

2. **The deploy**, then the checks again only with `--verify`, never a second `--live` (Hobby's Instant Rollback reaches
   only the previous production deployment):
   ```
   npm run prod:deploy -- --live --checkpoint checkpoint-7e
   npm run prod:deploy -- --verify --checkpoint checkpoint-7e
   ```
3. **The phone:** open https://offersheet.vercel.app, reload any Offer Sheet tab left open from before the deploy, and
   check the League page and a trade card. (⚠️ Until Phase 5 makes the league store keep fields it doesn't know, a tab
   still running the previous version erases the new version's settings and feedback steps when it saves: CLAUDE.md §17,
   Phase 5.)

**The rollback** is the one above (Vercel → offersheet → Deployments → the deployment the dry run names → ⋯ → Instant
Rollback → Confirm). ⚠️ After a rollback to 7d, 7d drops 7e's new settings ("Drop from the same position", return weeks)
the next time it saves a setting in a browser, and a feedback press there drops a 7e step's version (the same Phase 5
item); a roll forward then starts those settings from their defaults.
