# Offline load test (B4): 50 requests at once against mocks

Planner reply to Checkpoint 4c, B4: "50 imports at the same time against mocks", plus a small live test (the last section).
Run on 2026-10-05 on the working copy of the time (commit 2fc38be plus uncommitted Phase 7b work): `npx tsx scripts/load-test.ts`, now `npm run load:test` (i9-10850K, Node 22.18; 4.4 minutes; options in the script's header). Its own tests: `scripts/load-test.test.ts`. A second agent verified this report; its corrections are applied below. The first version cited line numbers in that working copy; the fixes since (Fixed after the test, at the end) moved the code, so functions are named instead. A review of those fixes found four more problems, fixed since (Review of the fixes); the last table is the rerun after them.

## Method

- **Real server code, in one process:** `withRoute` (origin check, per-IP limit, work budget, deadline, log), the ESPN and Sleeper import handlers, the ESPN model handler, the adapters, the crosswalk and the model build. They run over the real HTTP client (pacing, single-flight, cross-instance lock, outbound budgets, deadlines).
- **Upstash:** FakeRedis with 2 ms a command, shared by every instance. Each instance is built as `deps.ts`, `budget.ts` and `rateLimit.ts` build it on Vercel with the store connected; `@upstash/ratelimit` runs for real. Every scenario starts with an empty store and new instances (6w excepted).
- **Platforms:** a mocked fetch answers from the committed fixtures (Parker's ESPN league, the Sleeper test league, the shared captures) after seeded delays: ESPN 300–900 ms, Sleeper 80–250, FantasyCalc 150–400, GitHub 100–300. Sleeper's public lists are padded to live-like row counts, so a warm League page build costs 0.5 s of CPU, close to the 0.35–0.55 s live data cost at Checkpoint 7a. ESPN's committed free-agent lists are shorter than live (about 60 players a position, not 500).
- **Visitors:** 50 requests started together, each visitor in its own /24. ⚠️ One process plays every instance, so the multi-instance runs (m) share one CPU.
- **Offline:** `OFFERSHEET_NETWORK=off` can't be used, because the client under test refuses before it calls the mock (`http.ts`, `live()` calls `refuseIfNetworkOff` first). The script blocks fetch, sockets and DNS instead and drops the KV_*/UPSTASH_* variables: 0 connection attempts.

## Results (the test as first run, before the fixes)

| Scenario (instances) | Answers | Latency p50 / p95 / max | Sent: ESPN / Sleeper / FC / GitHub | Upstash commands · MB | CPU s (a request) | Heap growth |
|---|---|---|---|---|---|---|
| 1 Same public ESPN league, server path (1) | 50 × 200 | 19.5 / 19.5 / 19.5 s | 13 / 10 / 0 / 1 | 1,473 · 1.1 | 4.5 (0.09) | 153 MB |
| 1m The same (10) | 50 × 200 | 20.0 / 20.8 / 20.8 s | 119 / 10 / 0 / 1 | 2,538 · 10.7 | 8.0 (0.16) | 295 MB |
| 2 50 ESPN leagues, server path (1) | 3 × 200, 47 × 504 SOURCE_SLOW | 44.0 / 44.0 / 44.5 s | 35 (82 counted) / 10 / 0 / 1 | 1,235 · 2.3 | 1.5 (0.03) | 40 MB |
| 2m The same (10) | 30 × 200, 20 × 504 SOURCE_SLOW | 44.0 / 44.5 / 44.6 s | 330 (353 counted) / 10 / 0 / 1 | 3,393 · 21.9 | 8.1 (0.16) | 257 MB |
| 3 ESPN browser uploads, 316 KB each (1) | 50 × 200 | 6.5 / 6.6 / 6.6 s | 1 / 10 / 0 / 1 | 789 · 0.5 | 5.5 (0.11) | 340 MB |
| 4 Sleeper browser uploads (1) | 50 × 200 | 7.7 / 7.7 / 7.7 s | 0 / 14 / 0 / 1 | 956 · 0.6 | 5.5 (0.11) | 34 MB |
| 5 One IP, 50 server-path imports (1) | 30 × 200, 20 × 429 RATE_LIMITED | 18.9 s (all) | 13 / 10 / 0 / 1 | 1,028 · 1.1 | 2.7 (0.05) | 101 MB |
| 5b The same IP at 480 of its 500 units (1) | 3 × 200, 27 × 503 BUSY, 20 × 429 | 0.0 / 18.1 / 18.1 s | 13 / 10 / 0 / 1 | 560 · 1.1 | 1.2 (0.02) | 38 MB |
| 6 League page builds, signed imports, cold (1) | 50 × 200 | 22.8 / 22.8 / 22.8 s | 1 / 21 / 1 / 0 | 1,984 · 1.4 | 23.3 (0.47) | 1,694 MB |
| 6m The same (10) | 50 × 200 | 23.4 / 24.3 / 24.3 s | 1 / 21 / 1 / 0 | 2,482 · 23.4 | 31.9 (0.64) | 1,949 MB |
| 6w The same, public data warm (1) | 50 × 200 | 11.0 / 21.0 / 21.9 s | 0 / 0 / 0 / 0 | 650 · 0.0 | 26.5 (0.53) | 354 MB |

**Checks**
- ✅ **Errors:** no INTERNAL 500 anywhere. Every refusal was 429 RATE_LIMITED, 503 BUSY or 504 SOURCE_SLOW. No answer came past its deadline + 5 s, and there were 0 unhandled rejections.
- ✅ **Politeness:** one request at a time per host per instance, with gaps of at least 600 ms to ESPN and 120 ms to Sleeper. Sleeper's busiest minute had 21 calls (its limit is 1,000). The browser's 250 ms ESPN gap isn't exercised server-side.
- ✅ **Single-flight:** 50 imports of one league read it once (12 league requests plus the schedule). Public data was fetched once even across 10 instances (crosswalk lists, ID map, projections, schedule, FantasyCalc).
- ⚠️ **Budgets:** the counters were shared and summed across instances, and refusals came in plain words. No scenario reached a budget's limit (5b reached only its visitor's own work budget), so that a limit holds across instances is inferred from the shared counters, not shown. Two accounting faults are listed under Defects (both fixed since).

## What bounds throughput

- **ESPN, server path:** pacing. Each request holds the host for its answer time plus 600 ms (about 1.2 s), so an instance makes about 37 ESPN requests within the 45 s import deadline. At 12–13 requests a league, that's 3 new leagues per instance per burst; the rest answer SOURCE_SLOW "Offer Sheet is busy". The same league costs one read, however many people import it.
- **Browser path:** CPU (about 0.1 s an upload) plus a cold instance's crosswalk build (10 Sleeper lists at its pacing). 50 uploads took 6.6 s (ESPN) and 7.7 s (Sleeper).
- **League page:** CPU (about 0.5 s a build) and memory.
  - In a cold burst, every build waits on the same single-flight fetches, then all of them work through the data in step. All 50 answered together at 22.8 s, holding 34 MB of heap each at once (1.7 GB).
  - With the public data warm (6w), builds run one after another: the median answer came at 11.0 s and the heap grew 354 MB.
  - ⚠️ The deadline doesn't bound CPU work: at 0.5–0.6 s a build, about 200 builds in step on one instance would all miss the 120 s maxDuration together (inferred from the per-build CPU; not run). Since the fixes at most 8 build at once on an instance.

## On Vercel with many instances

- **Pacing is per instance; budgets are global.** In 2m, 10 instances sent ESPN 330 requests in 44.6 s (7.4 a second; ⚠️ up to 10 at once, one per instance: inferred from the per-instance pacing, not measured across instances). Only the daily budget bounds a burst, and its slices leave at least 750 cookie-free requests open at any time.
- **League data isn't locked across instances (by design):** in 1m the 10 instances sent 118 ESPN league-data requests for the one league: about one read of it per instance (12 requests each), less 2 requests another instance's copy in the shared cache served. It varies by run (112–119). One instance alone sent 12.
- ⚠️ **Memory:** a Hobby function has 2 GB (Vercel's documented default; not checked here). If Fluid's in-function concurrency put about 50 cold builds on one instance, it would run out of memory and fail every request on it (⚠️ inferred from runs on this computer: 50 cold builds kept more than 1.27 GB live and ran out of memory at heap caps of 768–1,280 MB). Fixed since: at most 8 builds at once per instance.
- **Upstash commands per request:** about 29 for a cold import, 16 for an ESPN upload (15.8; a Sleeper upload 19.1), 40 for a cold build, 13 for a warm build. The free day is 16.7K commands and 333 MB. Cold instances sent one shared-cache read per request for each entry they missed (every GET a miss), but bytes came back about 1.6 copies of the public data per instance, not one per request: in 6m about 22 MB, 15–16 copies for 10 instances (one per request would have been 65–70 MB). The reads per request are fixed since (Fixed after the test).

## Defects (both fixed after the test: see the end)

1. **The outbound budget counted attempts that never went out.**
   - **Where:** `src/server/http.ts` (`live()`) took the budget (the day's counter and the group's share) before the request queued for the host's turn (`acquire()`). A request the deadline then cut in Offer Sheet's own queue had spent a unit without reaching ESPN. Two related sites in `src/server/budget.ts`: `takeShared` added attempts refused over the day's allowance to the day's counter, and `takeShareShared` added to a group's share even when it refused, against the local rule "a refused attempt isn't counted".
   - **Evidence:** scenario 2 counted 82 ESPN attempts and sent 35; 2m counted 353 and sent 330.
2. **The work budget counted refused charges.**
   - **Where:** `src/server/budget.ts` (`chargeShared`) incremented the client's, the group's and the server's day counters in one transaction, then compared. A charge refused for the client's limit stayed in its group's and the server's day.
   - **Evidence:** in 5b, 27 refused imports added 162 units to the server's day, for no work.
   - **Why it was worse:** units come from the declared Content-Length before the body is read (`admissionUnits`, charged by `withRoute` in `route.ts`), up to 29 for an upload. An instance learns a visitor is over its limit only from its first refusal (`refuse()` remembers it), so a concurrent burst lands whole on each instance. A visitor already over its own day could still spend everyone's.

## Other findings

- **Partial imports answer 200.** In 2, one of the 3 successes (10 of 30 in 2m) came back without free agents or player cards (ESPN_FREE_AGENTS_UNAVAILABLE, ESPN_PLAYER_CARDS_UNAVAILABLE). Offer Sheet's own queue cut those reads at the deadline, not ESPN. Consider SOURCE_SLOW, or a retry, when the cut was `busy`.
- **Cold bursts weren't coalesced (fixed).** `TieredCache.get` (`cache.ts`) sent one Upstash GET per request per missing key: 1,173 cache commands in 6 for about 23 keys. The test also suggested a cap on concurrent builds per instance (a semaphore of about 8), to bound memory and serve first come, first served. Both are done.
- **Test environment (not server code; fixed).** A fresh checkout here (core.autocrlf=true) writes all 125 tracked fixture files and `src/app/icon.svg` with CRLF (not 86 as first reported: the verifier found 41 of them unreadable there without core.longpaths), and 5 tests fail.
  - 4 DynastyProcess tests (3 in `dynastyProcess.test.ts`, 1 in `reduce.test.ts`): `padDynastyCsv` appends LF rows and csv-parse takes the first line's ending, so the padded map has 2,113 rows, under the 10,000 floor.
  - `make-icons.test.ts`, on the SVG's line endings.
  - The main folder passed only because its copies are LF. The load test normalizes the CSV for itself.

## Fixed after the test

Rerun on the fixed working copy, every scenario: `npm run load:test` (4.5 minutes from 00:18 UTC on 2026-10-06, on the same computer while other work ran: ⚠️ CPU and latency are noisier than the first run's). "Before" is a rerun of the unfixed working copy an hour earlier (scenarios 2, 5b and 6: the first run's numbers again, scenario 6's heap aside, 2,046 MB against 1,694, since other work had changed the code). Controls on the fixed code: `--build-slots 0` (no cap), and Node's heap limited to 768 MB (`NODE_OPTIONS=--max-old-space-size=768`). The review of these fixes changed three of them (1, 2 and 4); the notes say how, and Review of the fixes has the numbers.

| Fix | Before | After |
|---|---|---|
| 1. An outbound attempt counts when it goes out | 2: ESPN 82 counted / 35 sent; 2m: 353 / 330 | 2: 34 / 34; 2m: 322 / 322 |
| 2. A refused work charge costs no one anything | 5b: the day's counter 660 (162 for 27 refused imports) | 5b: 498 (all 162 given back; 162 more Upstash commands) |
| 3. At most 8 League page builds at once per instance | 6: heap +2,046 MB, all 50 answered at 22.9 s; at a 768 MB heap: out of memory (also on the fixed code without the cap) | 6: heap +546 MB, p50 20.7 s, p95 27.5, max 28.4; at 768 MB: 50 × 200, 366 MB in use at the peak, the same latency |
| 4. One shared-cache read per entry in a burst | 6: 1,173 cache commands, 1,984 in all | 6: 46, 831 in all |
| 5. `.gitattributes` | a fresh checkout: 126 of 126 files with CRLF, 5 tests fail | none with CRLF; those 3 test files' 35 tests pass |

1. **Outbound budget** (`src/server/http.ts` `live()`, `src/server/budget.ts`): as first fixed, the budget was taken once `acquire()` had granted the host's turn, and a refusal there handed the turn on without a gap (no request went out). The review found that this held the turn through the count's round trips; since then an attempt is counted while it waits, once it's next in line, and one that doesn't go out gets its count back (Review of the fixes, 1). A limit the process already knows is reached (`OutboundBudget.refusedAlready`) still refuses before the queue. A refused attempt counts nowhere: the process's own counts check every limit first, and with Redis `takeShared` gives back what it counted (`giveBack`: one transaction, the same expiries). Tests: `http.limits.test.ts` "an attempt counts only when it goes out"; `budget.test.ts` "a refused attempt or charge counts nowhere".
2. **Work budget** (`createDailyQuota`): `chargeLocal` checks every scope before counting; with Redis a refusal gives its units back (`giveBackUnits`). As first fixed, `chargeShared` counted every scope in one transaction, remembered a refusal, then gave its units back: 6 more Upstash commands for each refused charge already in flight (5b: the work budget's commands 186 → 348), and the units in flight could still refuse other visitors' charges (Review of the fixes, 3). Since the review the client's own count comes first, alone, and a refusal by the group or the day is judged again on the give-back's answer (5b: 132 commands). The feedback route's daily copies follow the same rule. Tests: `budget.test.ts`; `route.test.ts` and `feedback/handler.test.ts`, which encoded the old counting, updated.
3. **Build cap** (`src/server/buildSlots.ts`; `limits.modelBuildLimits`: 8 at once, a waiting build gives up with less than 30 s of its 90 s deadline left, Retry-After 60): both model handlers take a slot around the build only (not the league read); waiting builds go in the order their requests arrived; a signed import the instance remembers needs none. Refused: BUSY, "Offer Sheet is busy right now. Try again in a minute." (`respond.ts` `buildsBusyResponse`). Over four capped runs the heap's peak growth was 546–1,070 MB (⚠️ a peak counts garbage not yet collected; the 768 MB run shows what's live); without the cap, 2,048. The cost, measured: CPU 22.5–23.2 s for the 50 builds uncapped, 26.0–30.5 s capped (0.52–0.61 s a build, about a warm build's 0.51–0.54 in 6w; 33.2 s under the 768 MB limit), and the last answer 3–6 s later (⚠️ our reading: uncapped, all 50 joined the same in-flight fetches and shared one parse of each body; capped, the builds after the first 8 read the bodies from the instance's memory and parse them for themselves). 6m is unchanged (5 builds per instance, under the cap): heap +2,032 MB for the ten instances in one process. Tests: `buildSlots.test.ts` (4); one in each model handler's tests.
4. **Cache reads** (`src/server/cache.ts` `TieredCache`): concurrent reads of a key share one Upstash read; each caller still applies its own maxAge and keeps the copy in memory only when it accepts it; a failed read is a miss for all of them, and nothing is remembered after. That alone does it: the waiters of one single-flight fetch move on together, so their next reads land within one round trip (without the build cap: 47 cache commands in 6, 48 in 1). A second change tried with it (a request finding a fetch of its entry in flight joins it without reading the cache) saved one command more in 6 and nothing in 1, so it was dropped. Since the review, a caller that joined a read sent before it began, and can't use its answer, reads once more (Review of the fixes, 2): 69 cache commands in 6, 61 in 1. Upstash commands per request now (the last table): a cold import 17.0 (29.5 before the fixes), an ESPN upload 14.8 (15.8), a Sleeper upload 15.3 (19.1), a cold build 17.1 (39.7), a warm build 13 (13). In 6m 12.0 MB came back, about one copy (1.4 MB) for each of the 9 instances that didn't fetch the data itself (about 22 MB before the fixes). Tests: `cache.test.ts`.
5. **Line endings** (`.gitattributes`: `fixtures/** -text`, `src/app/icon.svg -text`: no conversion, binary-safe unlike `eol=lf`). Checked on a simulated fresh checkout (`git checkout-index` with core.autocrlf=true into an empty folder); every tracked file still matches its committed blob (126 of 126), so `git status` shows only the new file.
6. `npm run load:test` runs the script; `--build-slots N` sets each instance's cap (0: none).

## Review of the fixes

A review of the fixes above (2026-10-06), with drivers of its own in git-ignored `data-local/review-7b-concurrency/`, found four problems. All four are fixed: the review's drivers for them now fail at the assertions that showed each problem.

| Finding | Before | After |
|---|---|---|
| 1. The outbound budget's count held the host's turn | the review's driver, a count answering in 400 ms: three ESPN requests went out at 400, 1,400 and 2,400 ms (400, 1,000 and 1,600 before the fixes); scenario 2 at 200 ms an Upstash command: 19 ESPN requests sent, the smallest gap 809 ms, 96 budget commands | 400, 1,000 and 1,600 ms; scenario 2 at 200 ms: 21 sent, the smallest gap 606 ms, 112 budget commands |
| 2. A cache read could miss a write that finished before it began | the review's timeline (two instances, one slow GET): the lock's waiter joined a read sent before the holder's write, missed the holder's copy and fetched again (2 fetches) | 1 fetch; scenario 6: 69 cache commands (46) |
| 3. A burst its client's limit refused held its units in everyone's counters | another visitor's charge that fit was refused, and its instance then refused everyone (the server's day until its allowance grew, a group until midnight) | it's charged, and nothing is remembered; 5b: the work budget's commands 132 (348) |
| 4. No test pinned the shared read's "at any age" | sending the first caller's maxAge to Redis passed all 52 cache tests | a new test fails on it, and only that one |

1. **Counted while it waits** (`src/server/http.ts` `live()`, `acquire`, `tellNext`; `src/server/budget.ts` `refund`; `limits.budgets.countAheadMinMs`). An attempt is counted from the moment it's next in line at its host, so the count's round trips overlap the turn ahead of it and the host's gap instead of holding the turn. A refusal takes it out of the queue at once. An attempt that doesn't go out after all gets its count back (`OutboundBudget.refund`, with a receipt `take` fills in): the deadline cut its wait, or its count came back too late to leave it a second (`deadlines.minAttemptMs`). That second case is then put down to Offer Sheet's own store ("busy", "upstash"), not to ESPN. Before, a count of 1.15 s with 1.3 s left gave the fetch about 150 ms; it was counted as sent and reported as ESPN being slow.
   - The review suggested counting every attempt as it queues. Only the one next in line is counted ahead, because every queued attempt would otherwise sit in the counters for its whole wait (a counter read meanwhile looks fuller than it is) and need a refund when cut.
   - A first version counted each waiter as the deadline's cuts brought it to the front, then gave the count back (scenario 2 at 200 ms: 432 budget commands). So an attempt whose wait its deadline cuts within a second is counted only if its turn comes: 112.
   - ⚠️ At 200 ms a command the gain is small (21 requests sent against 19). The slow store slows every import's cache reads and writes, the lock and the rate limit too. An import's next request reaches the queue only after its previous answer's cache write and its own cache read (400 ms at that latency), and its count adds two more round trips. So back-to-back requests of one import still go out about 800 ms apart, against 1,000 before; the smallest gap, 606 ms, came between requests that were already waiting.
   - At the default 2 ms: 34 of 34 attempts counted in 2, 329 of 329 in 2m.
   - Tests: `http.limits.test.ts`, 5 new (the overlap, a count too slow to send, a refusal leaving the queue, only the attempt next in line counted, no counting cascade at the deadline); `budget.test.ts`, 3 new (refunds with and without Redis).
2. **A cache read sees every write that finished before it began** (`TieredCache.get`). A caller that joined a read already in flight, and can't use its answer (a miss, or a copy too old for it), reads once more. That read is sent after the first one settled, and other callers can share it.
   - Cost: one more GET only where the first answer was of no use. That means a cold burst's misses (scenario 6: 69 cache commands against 46; 1: 61 against 48) and a Refresh joining an older copy. While the breaker leaves Redis alone after a failure, the extra read sends nothing.
   - Tests: `cache.test.ts` (the review's case: a read that begins after another instance's finished write and joins a read sent before it); `httpLock.test.ts` (the review's lock timeline: one fetch).
   - The review's control (the code before the shared read) fetched twice in 2 of 3 runs here. In that timeline, a request whose read straddled the end of the waiter's fetch took the free lock and fetched again: the HTTP client's documented "may fetch again" case. With the fix that request joins the waiter's fetch, so the timeline fetches once in every run.
3. **The work charge** (`createDailyQuota` `chargeShared`). The client's own count comes first, alone. Only a charge it allows goes on to its group's and the server's day, so a burst from a visitor over its own day never reaches anyone else's counter.
   - The review's case (5 charges of 10 from a client over its limit on one instance, and another visitor's charge of 5 on another, with the day at 60 of 100): that charge was refused "day" before; now it's charged.
   - A refusal by the group or the day is judged again on the give-back's own answer. A charge that fits there is charged again, once, and only a limit still reached there is remembered.
   - Cost: a refusal by the client's limit is 4 commands instead of 12 (5b: the work budget's 348 → 132, all Upstash 636 → 433). An allowed charge takes 2 round trips instead of 1, with the same 6 commands.
   - ⚠️ What's left, now said in `budget.ts`'s header: a charge the group or the day refused holds its units there until its give-back lands. Another charge at that limit's edge can then still be refused, and the limit remembered for its instance, when its own give-back lands first. Such a charge is at the edge already, 29 units at most, never a burst from a visitor over its own day.
   - Tests: `budget.test.ts`, 3 new (the review's burst; the same with the refusing instance's give-backs held, which only the separate client count fixes; the re-judging, which only the re-judge fixes) and 3 updated for the separate client count.
4. **The test** (`cache.test.ts`): a picky caller (1 minute) starts the shared read, and lenient callers (1 hour) join it while its GET is held. The lenient callers get the 30-minute-old copy, memory keeps it, the picky caller misses, and there is exactly one GET.

**Every scenario, after the review's fixes** (`npm run load:test`, 4.5 minutes from 01:31 UTC on 2026-10-06, the same computer while other work ran; ⚠️ the heap's peak varies with when garbage is collected, as in 4 and 6w against the first fixes' run). Checks: no 500s, no answer past its deadline + 5 s, 0 unhandled rejections, every host paced, 0 connection attempts.

| Scenario (instances) | Answers | Latency p50 / p95 / max | Sent: ESPN / Sleeper / FC / GitHub | Upstash commands · MB | CPU s (a request) | Heap growth |
|---|---|---|---|---|---|---|
| 1 (1) | 50 × 200 | 19.8 / 19.9 / 19.9 s | 13 / 10 / 0 / 1 | 849 · 1.1 | 4.9 (0.10) | 154 MB |
| 1m (10) | 50 × 200 | 19.7 / 20.6 / 20.6 s | 120 / 10 / 0 / 1 | 2,111 · 10.5 | 8.0 (0.16) | 294 MB |
| 2 (1) | 3 × 200, 47 × 504 SOURCE_SLOW | 44.0 / 44.1 / 44.1 s | 34 (34 counted) / 10 / 0 / 1 | 931 · 2.2 | 1.6 (0.03) | 41 MB |
| 2m (10) | 30 × 200, 20 × 504 SOURCE_SLOW | 44.0 / 44.6 / 44.8 s | 329 (329 counted) / 10 / 0 / 1 | 3,321 · 21.8 | 9.8 (0.20) | 275 MB |
| 3 (1) | 50 × 200 | 6.5 / 6.6 / 6.6 s | 1 / 10 / 0 / 1 | 741 · 0.5 | 5.6 (0.11) | 344 MB |
| 4 (1) | 50 × 200 | 7.5 / 7.5 / 7.5 s | 0 / 14 / 0 / 1 | 764 · 0.6 | 4.7 (0.09) | 166 MB |
| 5 (1) | 30 × 200, 20 × 429 RATE_LIMITED | 19.0 s (all) | 13 / 10 / 0 / 1 | 607 · 1.1 | 2.9 (0.06) | 98 MB |
| 5b (1) | 3 × 200, 27 × 503 BUSY, 20 × 429 | 0.0 / 18.1 / 18.1 s | 13 / 10 / 0 / 1 | 433 · 1.1 | 1.1 (0.02) | 43 MB |
| 6 (1) | 50 × 200 | 19.1 / 25.1 / 25.8 s | 1 / 21 / 1 / 0 | 854 · 1.4 | 25.9 (0.52) | 520 MB |
| 6m (10) | 50 × 200 | 23.7 / 24.6 / 24.6 s | 1 / 21 / 1 / 0 | 1,872 · 13.4 | 29.3 (0.59) | 1,974 MB |
| 6w (1) | 50 × 200 | 11.0 / 21.0 / 21.9 s | 0 / 0 / 0 / 0 | 650 · 0.0 | 25.3 (0.51) | 63 MB |

The slow store, before and after the review's fix 1 (`npm run load:test -- --scenarios 2 --redis-ms 200`):

| Scenario 2, Upstash at 200 ms a command | Answers | 200s' latency p50 | ESPN sent (counted) | ESPN's smallest gap | Upstash commands (budgets) |
|---|---|---|---|---|---|
| Before (the first fixes) | 2 × 200, 48 × 504 SOURCE_SLOW | 37.4 s | 19 (19) | 809 ms | 814 (96) |
| After | 2 × 200, 48 × 504 SOURCE_SLOW | 35.0 s | 21 (21) | 606 ms | 832 (112) |

Still open:
- Partial imports that answer 200 (Other findings).
- A build refused for a busy instance isn't counted in `usage:report`'s refusals (withRoute logs it as an error_response, BUSY 503).
- The capped burst's extra CPU (each later build parsing the cached bodies for itself) could be saved by sharing parsed bodies within an instance.
- Scenario 6's answers carry NO_SLEEPER_ID ×50 since the first fixes' rerun; not looked into.
- The outbound budget still remembers a day refusal that an attempt's in-flight count caused. Each attempt counts one, so that edge is a few attempts of a day of thousands (`budget.ts`'s header).
- Refunds are sent once their count is known, after the attempt gave up; one an instance never sends (it stopped first) leaves its count.

## The small live test (2026-10-06, the protected preview)
Run by the lead on the Checkpoint 7b preview (commit 364d7ef), within the politeness limits. The public ESPN test league 899513 was sent through the server path (`vercel curl`, the owner's bypass), with each burst's requests started together:
- **5 imports** (`POST /api/import/espn`): 5 × 200 in 10.0–10.5 s, all 10 teams.
- **5 League page builds** (`POST /api/model/espn`): 5 × 200 in 6.55–6.76 s, 231 KB each.
- **`/api/health`** before the bursts: the shared store, and its check reused within 5 minutes (the second call answered from the first).
- ⚠️ Not measured: ESPN requests per burst (Vercel's logs weren't read). Single-flight shares one read per instance.
The production build's own run on Parker's league (`npm run check:browser -- --live --team 3`, 2026-10-06) gave 126 passed, 0 failed, 3 skipped. The browser read the league in 5.7 s (23 platform reads), the League page took 4.1 s, and a full search 5.5 s.
