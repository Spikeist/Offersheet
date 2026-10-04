# Planner reply to Checkpoint 4c

**Checkpoint 4c is approved.** This is the first list Parker will send offers from. The search-gap fix, the weekly lines and the multi-league switcher are exactly what was needed.

**What comes next:**
- **Part A:** small fixes. Do them first, commit, and tell Parker how to run the stable copy.
- **Part B:** prepare a free public beta with ESPN and Sleeper (Phase 7, pulled ahead). Stop at Checkpoint 7a.
- **Afterwards:** Phase 5 (more platforms), then Phase 6 (calibration with real feedback).

**Why launch first:** trade deadlines are in November. Real users' Accepted and Rejected outcomes are what calibrate the acceptance model. ESPN and Sleeper cover most leagues, and Yahoo is still awaiting approval.

---

## Answers to your questions

1. **B_ref:** neither 6 nor 5. **Calibrate it per league and goal** (A2), so "Helps you" means the same thing everywhere.
2. **W:** use the best free agent no team is predicted to claim (491). That's consistent with one free agent, one team.
3. **Throw-in additions** (matched pairs, lean versions, the Plan B bars): keep all of them.
4. **Lead decisions:** all OK.
5. **Injury tags:** fine as is. Most are this-week Questionable tags. Parker will refresh after Monday night's game, when the tags update, before he sends offers.

**Also:**
- Week 11: A4 handles teams that never make moves. An active team covering its bye is realistic.
- The accidental live fetch: A5.

---

## Part A — small fixes (do these first)

### A1. A stable copy for Parker
Parker will use the app every week while development continues, so give him a copy that in-progress work can't break.
- **`npm run stable`** updates a git worktree at the latest checkpoint commit, in `D:\Source Code\VS Code\fantasy-trade-finder-stable`. It installs, builds, and serves a production build on **port 3000**, so his saved leagues, settings and feedback (stored under 127.0.0.1:3000) keep working.
- **Development** moves to **port 3001**.
- Copy `.env.local` into the worktree without printing it.
- Keep projection snapshots writing to the main folder's `data-local/`.
- Tell Parker the exact PowerShell commands to start and update it.

### A2. A self-calibrating "Helps you" scale (§10)
- **B₃** = the B of a uniform +3 points a week for the user's team, for every remaining week, on the same baseline, under the same goal, with the same common random numbers. Compute it once per league model build.
- **Helps you** = 100 × (1 − e^(−B / B₃)). **Overall** = 100 × (1 − e^(−B·P / B₃)).
- So +1, +3 and +6 points a week read about 28, 63 and 86 in every league, under every goal.
- **Floor B₃ at 0.5.** When it's floored, note it: "Your title odds barely move with lineup changes right now."
- **Tooltip:** "63 ≈ as good as adding 3 points a week to your lineup for the rest of the season."
- **Analyzer Details:** show "≈ +X pts/week," where X = 3 × B / B₃.
- Update §10's sample table and tests.

### A3. W (§9)
- W = the value of the best free agent **not** claimed in the baseline allocation.

### A4. Inactive teams (§7)
- Teams with no transactions in the last 5 weeks (or none this season, if fewer than 5 weeks have passed) make **no** baseline pickups.
- Show this in the Import Report, for example "Team 6: inactive, no pickups assumed."

### A5. Scripts are offline by default
- Verification and report scripts never touch the network unless given `--live`.

---

## Part B — public beta with ESPN and Sleeper (Phase 7, pulled ahead)

**Goal:** a free public beta at Parker's existing Vercel project (`offersheet`, the Hobby plan), before most trade deadlines. Production goes live **only on Parker's explicit "go" at Checkpoint 7b.** Before that, use protected preview deployments (Vercel Authentication) only.

### B1. Infrastructure
- **Shared server cache:** Upstash Redis's free tier through the Vercel Marketplace, or an equal free store.
  - single-flight fetches
  - hashed keys
  - private-league data keyed by a credential hash (§2.10)
  - Give Parker click-by-click setup steps for anything he has to do in the dashboard.
- **Rate limits:** per IP on every server route. Outbound pacing and a daily request budget per platform, especially for ESPN.
- **Browser fetching:**
  - **Sleeper:** fetch from the browser (CORS verified) to spread the load across users.
  - **ESPN public leagues:** check whether `lm-api-reads` allows browser (CORS) reads. If it does, fetch them from the browser too.
  - **Private ESPN** always stays on the server.
- **Errors:** friendly "the data source is down" messages, and error logging that never records credentials or league data.

### B2. Feedback storage, server side (planner-reply-0 decision B)
- Store anonymized reports and outcomes: player IDs and positions, league format, model inputs and scores, the reason and the outcome.
- **Never store** league IDs, team or owner names, usernames, SWIDs or cookies.
- Add an opt-out toggle and rate limits.
- Use a free-tier store, for example the same Redis.

### B3. Pages and polish
- **Home:** carry over the landing page's wording and add a "Beta" label.
- **New pages:** `/privacy`, rewritten to match what the app really does, and `/terms`.
- **Footer:** a feedback link, the attributions (FantasyCalc wherever values show), and "Not affiliated with ESPN or Sleeper…".
- **Installable:** a PWA manifest and icons.
- **Sharing:** an SEO title and description, and an Open Graph image.
- **Layout:** everything works at 375 px.
- **Connect page:** ESPN private leagues keep the two paths, ask your commissioner or paste cookies. The Chrome extension comes after launch.

### B4. Readiness
- **Security review:** session cookies, same-origin checks, headers and a dependency audit. One focused pass is enough.
- **Load test:** 50 imports at the same time against mocks, plus a small live test within the politeness limits.
- **Base-rate stability (moved up from Phase 6):** public users will compare the numbers day to day. Measure day-to-day odds swings that injuries and results don't explain. If they're large, smooth the base rate, for example by averaging the last 2–3 pre-game projections.
- **Terms:**
  - **FantasyCalc:** Parker emails them before launch, including the te+/te++ question and our private daily copies. Launch waits until they answer or a few days pass without objection.
  - **Sleeper:** non-commercial use is allowed.
  - **ESPN:** the API is unofficial. Keep requests polite and fail clearly if they're blocked.
- **DynastyProcess ID map:** keep it server-side (GPL-3.0).

### Checkpoints
**Checkpoint 7a** covers Part A and B1–B3, with a protected preview Parker can open on his phone. It must include:
- the stable-copy commands
- B₃ for Parker under each goal, and his top 10 on the new scale
- the cache and rate-limit design and the free-tier limits
- the drafts of the privacy and terms pages
- anything that needs Parker to act, with click-by-click steps

**Checkpoint 7b** covers B4 and a go/no-go list. Production waits for Parker's go.

---

## After launch
- **Phase 5:** Yahoo when it's approved, plus Fleaflicker, MFL, manual import, Fantrax and draft picks.
- **Phase 6:** calibration with the real feedback.
- **The Chrome extension** for ESPN cookies.
