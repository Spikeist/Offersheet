# CLAUDE.md — Offer Sheet

The product is called **Offer Sheet**. Its first working name was Fantasy Trade Finder, which is why the project folder is still called `fantasy-trade-finder`. Don't rename the folder.

This is the complete spec for the project. The planner wrote it on 2026-09-29. The planner is a separate Claude chat that Parker works with. Parker owns the project and passes your checkpoint reports to the planner. The planner then sends back approvals and changes.

**New session?** Read this whole file first. Then read `reports/STATUS.md` and the latest `reports/checkpoint-*.md` to see where things stand, and continue from there. Don't restart finished phases.

**Timing:** It's late September 2026, week 4 of the NFL season, and most fantasy trade deadlines fall in November. Getting a working ESPN + Sleeper version quickly matters more than supporting many platforms.

**Priority (Checkpoint 1):** Parker's trade deadline is Wed Dec 2 (NFL week 13). Getting his ESPN league working end to end, through Phase 4 trade suggestions, comes before breadth. Aim to have Phase 4 running on his league by early November.

---

## 0. How to work on this project

1. **Work one phase at a time** (Section 17). At the end of each phase:
   - make sure tests, typecheck and lint all pass
   - commit; once Parker approves the checkpoint, tag its commit `checkpoint-<name>` (an annotated local tag, for example `checkpoint-7a`): Parker's stable copy serves the newest such tag (item 13), so it moves only to approved work (Part A of Phase 7a was tagged `checkpoint-7a-part-a` at once, because the planner asked for it in the stable copy right away)
   - write the checkpoint report (Section 18) to `reports/checkpoint-N.md` and show it
   - update `reports/STATUS.md`
   - **stop** until Parker says to continue

2. **Phase 0 is a gate.** Build no app features until Parker approves Checkpoint 0.

3. **Don't guess when reality differs from this spec.** An endpoint may have moved, a field may be missing, or a number may look wrong. Don't work around it silently. Record the evidence in your report: the URL (with secrets removed), the HTTP status, the JSON path, and a sample value. Then propose options. If the problem blocks progress, stop and ask.

4. **Git is local only.** Run `git init` and commit at every checkpoint. Never add a remote, push, or create a GitHub repo unless Parker explicitly asks.

5. **Secrets live only in `.env.local`,** which must be git-ignored from the very first commit.
   - Never ask Parker to paste a secret into chat. Tell him which variable to fill in.
   - Never print, log, or write secrets into reports, fixtures, commits or error messages. Redact cookie and token values everywhere.
   - Never display the contents of `.env.local`. To check it, write a script that reports only "set" or "blank" for each variable.
   - Generate `SESSION_SECRET` with a script that writes it straight into `.env.local` without echoing it.
   - Treat the ESPN **SWID** as a secret everywhere. Besides the cookie, it also appears in ESPN responses (`teams[].owners[]`, `members[].id`) and in the fan-API URL path.
   - Parker may have created `.env.local` before you start. Use these variable names; blank means "not available":
     ```
     ESPN_LEAGUE_ID, ESPN_SEASON, ESPN_S2, ESPN_SWID
     SLEEPER_USERNAME, SLEEPER_LEAGUE_ID
     FLEAFLICKER_LEAGUE_ID, FANTRAX_LEAGUE_ID
     MFL_LEAGUE_ID, MFL_USERNAME, MFL_PASSWORD   (the MFL login is only needed for private MFL leagues)
     YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET
     SESSION_SECRET   (you generate this one)
     USE_ENV_COOKIES  (not a secret; development only: 1 = import Parker's ESPN league with the ESPN_S2/ESPN_SWID cookies above)
     READONLY_STORE_URL, READONLY_STORE_TOKEN   (optional, typed in by hand: the Upstash store's REST address and its read-only token, the values of Vercel's KV_REST_API_URL and KV_REST_API_READ_ONLY_TOKEN, read only by the --live scripts that read the store: beta:log, usage:report, feedback:report, snapshot:pull. The app never reads these two names, and the store's own variables, KV_* and UPSTASH_*, don't belong in .env.local: nothing local reads them)
     CRON_SECRET      (Phase 7b; leave blank: it lives on Vercel's production, made by `npm run vercel:secret -- --live --name CRON_SECRET`; set it here only to call /api/cron/snapshot on `npm run dev`)
     ```
   - Mirror these names in `.env.example`, with no values.
   - By default `npm run dev` imports Parker's league through the public-link flow, the same one a leaguemate gets. The `.env.local` ESPN cookies are used only with `USE_ENV_COOKIES=1`.

6. **Leaguemates' privacy:**
   - Raw API captures go in `fixtures/raw/`, which is git-ignored.
   - Committed fixtures go in `fixtures/sanitized/`. Replace all of these with placeholders such as "Team 3":
     - team names and owner names
     - usernames and user IDs, SWIDs, and owner/member IDs
     - league IDs (anyone can look up a Sleeper league's members from its ID)
   - Reports follow the same rules.
   - Data crawled from other people's leagues (Phase 6) stays in git-ignored folders. Reports show only aggregate numbers.
   - **Strangers' test leagues** (public leagues used when Parker has none on a platform): keep their full sanitized fixtures in git-ignored `data-local/`. Commit only minimized fixtures, in `fixtures/sanitized/min/`: just the fields the tests read, a subset of each roster, and shifted timestamps.
   - **No new crawls of strangers' leagues without asking Parker first.**

7. **Parker's machine:** Windows and PowerShell. The project lives at `D:\Source Code\VS Code\fantasy-trade-finder`, and that path contains spaces.
   - Quote paths.
   - Keep npm scripts cross-platform.
   - Use `tsx` to run TypeScript scripts.
   - Write any commands meant for Parker in PowerShell syntax: one command per line, no `&&`, no bash-only syntax.
   - Cache and fixture filenames must be hashes (for example sha256 of the cache key), never raw keys. Keys contain characters such as `:` and `?` that Windows doesn't allow in filenames.

8. **Scaffolding gotcha:** `create-next-app` refuses to run in a folder that isn't empty. Scaffold into a temporary folder, then move the files in. Keep `CLAUDE.md`, `.env.local` and `reports/`.

9. **Be polite to data sources:**
   - Follow the cache rules in Section 2.10.
   - Don't fire floods of parallel requests.
   - Back off exponentially on 429 and 5xx responses.
   - **Scripts are offline by default** (planner reply to Checkpoint 4c, A5; `scripts/lib/runMode.ts`): verification and report scripts never touch the network unless given `--live`. Reports read a saved dump (`--dump <folder>`, `--offline <folder>` kept as an alias; by default the newest `data-local/parker-league*` dump), and `npm run league:report` and `trade:report` archive projections and FantasyCalc lists only with `--live`; `check:browser`, the probes (`probe:all` included), `check:sleeper-cors` and `measure:stat-sd` refuse to run without `--live`, and so do the scripts that talk to Vercel (`preview:deploy`, `vercel:secret`) or read the shared store (`beta:log`, and since Phase 7b `usage:report`, `feedback:report` and `snapshot:pull`). Belt and braces: a script run without `--live` sets `OFFERSHEET_NETWORK=off`, and then the server's HTTP client refuses every live fetch (`NetworkOffError`; the cache is still read). `snapshot:projections` stays live (fetching is its job). `npm run load:test` (Phase 7b) is offline by construction: it can't set `OFFERSHEET_NETWORK=off` (the client under test would refuse its mocks), so it blocks fetch, sockets and DNS for its own process, drops the KV_*, UPSTASH_* and READONLY_STORE_* variables and never reads `.env.local`.
   - Every script that runs code at its top level does it under `isMainModule(import.meta.url)` (exact resolved file paths), so importing it never runs it; `runMode.test.ts` fails on an unguarded top-level `main()` or `runProbe()` under `scripts/`. (A scratch driver named `run-trade-report.ts` once matched a file-name guard and ran the live report.)

10. **Engine rules:**
    - All the math lives in pure, deterministic, unit-tested functions under `src/engine/`: no I/O, and no `Date.now()` (pass the time in instead).
    - Every tunable number comes from `src/engine/config.ts` (Section 15).
    - All randomness uses a seeded PRNG.

11. **Dependencies:** pick boring, maintained libraries. No paid services, no AI API calls, and no payments, ads or accounts.

12. **Keep the Phase 0 quality gates:**
    - the pre-commit leak check (`npm run check:leaks`)
    - the ✅/⚠️ rules: ✅ only when data verifies a claim; inferred, derived or small-sample results are ⚠️; a gap with a working workaround is ⚠️, not ❌
    - an adversarial review pass before every checkpoint

13. **Parker's stable copy** (planner reply to Checkpoint 4c, A1; `scripts/stable.ts`): Parker uses the app every week while development goes on, so `npm run stable` runs the newest `checkpoint-*` tag from its own git worktree, the sibling folder `D:\Source Code\VS Code\fantasy-trade-finder-stable`, and serves a production build at **http://127.0.0.1:3000**, the address his saved leagues, settings and feedback live under. **Development runs on port 3001** (`npm run dev`).
    - Each run: one at a time per copy (a named pipe on Windows; a second run says "npm run stable is already running in another window"); a forced detached checkout of the checkpoint (moving to a newer tag, and repairing a copy a stopped run left half made: git's "initializing" lock and stale `index.lock` cleared, a missing or emptied folder created again; a folder that isn't this repo's worktree is never touched); `.env.local` copied in as a file, never read or printed; `npm ci` only when the lock file changed, `npm run build` only when the commit changed; then `next start -H 127.0.0.1 -p 3000`. Options: `--no-serve`, `--stay` (no update), `--ref <tag>`, `--port <n>` and `--dir <folder>` (testing).
    - It shares the main folder's `data-local/` (`OFFERSHEET_DATA_LOCAL`: the projection snapshots and FantasyCalc lists keep landing there; the archives run under `next start` only when this is set, never on Vercel) and file cache (`OFFERSHEET_CACHE_DIR`, Section 2.10).
    - `npm run stable` runs the development folder's copy of `scripts/stable.ts`, which imports only Node built-ins and two dependency-free script modules (`stable.test.ts` checks the import graph), so app work can't break the start command; ⚠️ that script, those modules and tsx still come from the development folder.

---

## 1. What we're building

A web app that works on phones and desktops. It does five things:

1. **Imports a league.** It pulls in the user's fantasy football league from any of these:
   - ESPN
   - Sleeper
   - Yahoo, once Yahoo approves API access
   - Fleaflicker
   - MyFantasyLeague (MFL)
   - Fantrax, public leagues only
   - manual entry
2. **Understands the league exactly:**
   - scoring rules
   - starting lineup slots
   - bench, IR and taxi squad
   - playoff format and trade deadline
   - whether it's redraft, keeper or dynasty
   - every roster
3. **Works out needs and trade chips.** It finds what the user's team needs, and what every other team needs and has to spare.
4. **Searches and ranks trades.** It looks at possible trades with every other team. For each trade it computes:
   - **Helps you:** how much the trade helps the user's team, a 0–100 score (the Trade Score), backed by the change in playoff odds, title odds and weekly points
   - **Chance they accept:** an estimated chance the other manager accepts
   - **Overall:** a 0–100 score that combines the two and ranks trades by default (Section 10)

   Everything is optimized for the user's team. The partner's side matters only because it affects whether they'll accept.
5. **Explains each suggestion** in plain English and offers a copy-ready message to send the other manager.

The app is **read-only**. It never sends offers or changes anything on any platform.

**Who it's for:** Parker's own leagues first, then anyone. It becomes a free public website that can also be installed on a phone's home screen (a PWA). It stays free and non-commercial: no ads, no payments and no paywalls (see Section 19). A native app-store version is out of scope unless Parker asks for one later.

---

## 2. Data access

The planner verified this on 2026-09-29. Phase 0 re-verifies it.

### 2.1 Summary

| Platform | Status | What the user provides | Has everything we need? | Phase |
|---|---|---|---|---|
| ESPN | Works, but the API is unofficial and undocumented | League ID and season. Private leagues also need the `espn_s2` and `SWID` cookies. | Yes: settings, scoring, rosters, schedule, transactions and projections | 0–1 |
| Sleeper | Works. Official read-only API, free for non-commercial use | Username or league ID | Yes. Projections come from an undocumented endpoint. | 0–1 |
| Yahoo | Official API, but Yahoo must approve access first. Parker has applied. | Yahoo login (OAuth) | Yes, once approved | 5, behind a feature flag |
| Fleaflicker | Works. Public API, no login | League ID | Yes | 5 |
| MyFantasyLeague | Works. Official API | League ID. Private leagues also need an MFL login. | Yes, including league-scored projections | 5 |
| Fantrax | Public leagues only | League ID | Partly. Whether scoring rules are exposed is unverified. | 5 (stretch goal) |
| NFL.com, CBS, others | No usable API | Manual import | Through manual entry | 5 |

### 2.2 ESPN (priority 1)

**Host**
- Use `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl`.
- The old `fantasy.espn.com/apis/v3` host is unreliable and often returns HTML instead of JSON.

**League request**
- `GET /seasons/{season}/segments/0/leagues/{leagueId}?view=mSettings&view=mTeam&view=mRoster&view=mMatchup&view=mStatus`
- Repeat the `view` parameter to combine views.
- Other views you'll need: `mTransactions2`, `mDraftDetail`, `mMatchupScore`, `mStandings` and `kona_player_info`.
- Add `scoringPeriodId={week}` when you need a specific week's player stats or projections.

**Login**
- ESPN leagues are **private by default**. Only the league manager can make one viewable, under League → Settings → Basic Settings → "Make League Viewable to Public". Section 14 describes how users connect.
- Private leagues need the header `Cookie: espn_s2=<value>; SWID=<value>`. The SWID value includes its curly braces.
- Public leagues need no cookies. Parker's league is viewable to the public, so it needs none. Test the private-league error paths with mocks until a real private league is available.
- ESPN leagues with rare settings (TE premium, IDP, keepers, "every N yards" scoring) will come from volunteer leagues during a beta. Don't block on them.
- Never ask for ESPN passwords.
- The Connect page takes an `espn_s2` of at most 2,000 characters (Phase 7b, B4 security review; `src/lib/espnCredentials.ts`; 4,000 before): the two cookies are sealed into one session cookie, which holds at most 4,096 bytes, so a longer value passed the checks and failed the save (500). The longest accepted one seals into 3,055 bytes; real values are a few hundred characters. A value that still doesn't fit answers INVALID_REQUEST (`SessionTooLargeError`), not logged.
- Verified 2026-09-29: public league 899513 returns 2026 `mSettings` with no login, including `settings.scoringSettings.scoringItems` and `settings.rosterSettings.lineupSlotCounts`. Phase 0 found it has drafted (rosters and weekly stat lines), so it also serves the scoring oracle.
- Other developers reported in September 2026 that private-league reads with the cookies still work.

**Errors**
- An HTML response (a login page), a 401 or a 403 means one of these:
  - the cookies are bad or expired
  - the league is private and no cookies were sent
  - the league hasn't been activated for this season
- A wrong season returns HTTP 404 JSON with `details[].type = "GENERAL_NOT_FOUND"` (verified in Phase 0). Show "League not found for that season."
- Show a clear error to the user. Don't retry in a loop.

**Key JSON paths**
- **Scoring:** `settings.scoringSettings.scoringItems[]` holds `{statId, points, pointsOverrides}`. `pointsOverrides` is how position-specific scoring works, such as a TE premium. It maps the player's **`defaultPositionId`** (not a lineupSlotId) to points that **replace** the base points (verified in Phase 0; see `reports/data-access.md`).
  - Phase 7b (planner reply to Checkpoint 7a, §5.1; `normalize.ts` withScoredThisSeason): each rule we can't count (`Scoring.unmapped`) says whether its stat scored this season (`scoredThisSeason`: a value other than 0 on an actual season line, statSourceId 0 and statSplitTypeId 0, of a rostered player or a listed free agent; a stat that never appears on weekly lines, points and yards allowed, never counts; unknown when no season line came back), so the notices (Section 14) can tell a rule that matters from a rare one.
- **Lineup and roster:** `settings.rosterSettings.lineupSlotCounts` (slotId → count) and `settings.rosterSettings.positionLimits`.
- **Schedule settings:** `settings.scheduleSettings`, which includes `matchupPeriodCount`, `playoffTeamCount`, the `matchupPeriods` mapping from matchup period to scoring periods, and playoff round length.
- **Seeding tiebreaker** (Phase 3): `settings.scheduleSettings.playoffSeedingRule`, one of `settings.typeNames.recordSeedingRuleTypes` in `GET /seasons/{season}?view=proTeamSchedules_wl` (UNKNOWN, H2H_RECORD, TOTAL_POINTS_SCORED, INTRA_DIVISION_RECORD, TOTAL_POINTS_AGAINST, RAW_STAT).
  - TOTAL_POINTS_SCORED → points for (✅ both test leagues; ESPN's own `teams[].playoffSeed` order in Parker's league is win % then points for).
  - H2H_RECORD → head-to-head record and INTRA_DIVISION_RECORD → division record (⚠️ read from espn-api's standings code at commit 663d726; not seen live).
  - UNKNOWN (ESPN's placeholder: no rule reported), a missing value, TOTAL_POINTS_AGAINST and RAW_STAT → unknown: points for is assumed, with a warning.
  - Division winners are seeded first (✅ ESPN's help center, "H2H Points League Playoff Seeding: How Tiebreakers Work", support.espn.com/hc/en-us/articles/360058038711, updated 2026-08-11: "Division winners always occupy the top seeds.").
  - ⚠️ The same article describes ties of 3+ teams seed by seed: "determine the top seed among the tied group, remove that team, then repeat for the next seed", and "After each seed is assigned, the tiebreaker process resets from Step 1 (H2H Record)". The simulator follows espn-api's grouped order instead (Section 8); following ESPN's documented procedure is Phase 6 work (Checkpoint 3 answer 7, low priority: Parker's league uses points for). The two differ only in multi-way ties that head-to-head doesn't settle; with points for (Parker's rule) a tie on win % is settled by points for at once.
- **Trades:** `settings.tradeSettings`, which includes `deadlineDate` (epoch ms) and the veto and review settings. The review period, `revisionHours`, becomes `LeagueSettings.tradeReviewHours` as reported (Phase 7b, for the Trade Finder's best-time line, Section 14; a number ≥ 0, else unknown; 24 in both test leagues, Parker's included).
- **FAAB:** `settings.acquisitionSettings`.
- **Waiver order and FAAB left** (Phase 4b, for the free-agent allocation in Section 7; Phase 4c, planner reply to Checkpoint 4b answer 2: "use the weekly reset order when the league resets weekly … the live order for rolling waivers. The baseline must not depend on which day someone imports"; `src/adapters/espn/waivers.ts`): `teams[].waiverRank` is ESPN's live rank, 1 = first claim. A league whose order resets weekly (`settings.acquisitionSettings.waiverOrderReset` true, as Parker's, `acquisitionType` WAIVERS_TRADITIONAL) goes back to reverse standings at ESPN's weekly standings update (⚠️ read from timestamps: `status.waiverLastExecutionDate` and `standingsUpdateDate` 0.1 s apart), and a team that claims a player moves to the back for the rest of the week. So `Team.waiverRank` holds the reset order, number of teams + 1 − `teams[].playoffSeed` (✅ 20 of 20 teams at the reset in both test leagues, which seed by points for; ⚠️ under other seeding rules; with 2+ divisions, whose winners seed first, or seeds that aren't 1..n, the reverse of the overall standings, ⚠️), `Team.liveWaiverRank` keeps ESPN's rank, and `settings.waiverOrderUsed` is "weeklyReset". Rolling waivers (`waiverOrderReset` false, ⚠️ from the field's name; not seen) use the live rank ("live"); so does a league whose flag is missing, or whose order resets but has no games played yet (no standings to reset to), each with a warning. A FAAB league whose order resets weekly (`isUsingAcquisitionBudget`, like the public test league) breaks ties between equal budgets by the reset order once games have been played (`liveWaiverRank` keeps ESPN's rank; before any game the live rank, with a warning that a tie may depend on the day of the import); the budgets themselves are read as they stand. A commissioner-edited order (`status.isWaiverOrderEdited`, never seen true) keeps the reset order, with a warning that the edit lasts until the next reset (⚠️ our reading: the weekly reset overrides it). `acquisitionType` FREEAGENCY (⚠️ read as no waivers; not seen): no ranks, so free agents go to the team that gains the most first, with a warning. On 2026-10-04 Parker's league's live order was Team 5 > 8 > 6 > 4 > 9 > 7 > 2 > 1 > 10 > 3 (Parker last after his own claim) and its reset order Team 2 > 4 > 10 > 3 > 5 > 9 > 8 > 1 > 7 > 6 (Parker 4th). The Import Report says which order is used ("Waiver order used: Weekly reset (reverse standings)"). FAAB left = `settings.acquisitionSettings.acquisitionBudget − teams[].transactionCounter.acquisitionBudgetSpent` (⚠️ 0–33 spent of 200 in the public test league; not cross-checked against winning bids). A rank that isn't a whole number ≥ 1, or a negative or unreadable budget, is left out.
- **Keepers:** `settings.draftSettings.keeperCount`, and `keeperCountFuture` for next season (the league type uses the larger; its meaning is inferred).
- **Teams:**
  - `teams[]`: `id`, the team name, `owners[]` (SWIDs), record and points
  - `members[]`: `id` (the SWID) and `displayName`
- **Rosters:** `teams[].roster.entries[]` holds `lineupSlotId` and `playerPoolEntry.player`. The player object has `fullName`, `defaultPositionId`, `eligibleSlots`, `proTeamId`, `injuryStatus` and `stats[]`.
- **Positions outside the usual set:** map TQB (team QB) to QB, with an Import Report warning. P maps to P. HC (head coach) is unmapped, with a warning.
- **Schedule:** `schedule[]` holds `matchupPeriodId`, `home.teamId`, `away.teamId` and `playoffTierType`.
  - Phase 3: it also holds `winner` (HOME, AWAY, TIE or UNDECIDED: `settings.typeNames.winnerTypes`) and `home/away.totalPoints`. A matchup is decided once `winner` isn't UNDECIDED, and its final score is read from those fields; an unreadable one stays decided without a score. In Parker's league, weeks 1–3 rebuild ESPN's own W-L-T, points for and points against for all 10 teams exactly.
  - A matchup period that spans several NFL weeks is listed once, with all its weeks.
- **Status:** `status.currentMatchupPeriod` and `status.latestScoringPeriod`.
- **Transactions** (`mTransactions2`): a trade still in its review period comes back as `TRADE_ACCEPT` with no `status` and without the other side's players (seen live in Phase 1). `teams[].transactionCounter.trades` counts every team's trades, including ones in review.
  - **When a trade counts as completed** (Phase 4, seen live 2026-10-01 on one trade, ⚠️): after the review period the accepting team's `TRADE_ACCEPT` can still have no status, and the only `EXECUTED` row can be a `TRADE_UPHOLD` from a team that isn't in the trade (`isLeagueManager: false`): a member's vote, cast mid-review, not proof the trade went through. So a trade completes through an `EXECUTED` `TRADE_ACCEPT` or the rosters (its players carry `acquisitionType: "TRADE"` on their new teams); otherwise it is "in review" until its review period plus 24 hours ends, then unresolved and not counted (the Import Report says it may have been vetoed, or its players dropped since). An UPHOLD by the league manager hasn't been seen yet.
  - **Refill** (approved at Checkpoint 1; Phase 4): a completed trade listed without its players is rebuilt from the roster entries acquired by trade inside its time window (`acquisitionDate`, grouped within a minute, from 5 minutes before its first row to 1 day after its review period), each player moving from the other team to the one he's on now (`Transaction.refilled`). A trade that lists its players but shows only partly on the rosters is matched the same way and keeps all its players. A trade only the rosters show (no rows at all, for example a week whose transactions didn't load) is rebuilt only when its players went to exactly 2 teams, after the league's activation date, in a known NFL week, and both teams' ESPN counters show more trades than are listed. When the rosters show what one team received but not its partner, the trade is listed without the partner (`ESPN_TRADE_PARTNER_UNKNOWN`); `ESPN_TRADE_WITHOUT_PLAYERS` is left for trades nothing can rebuild. A rebuilt trade's moves include the accepting team's drop (`to: null`). Parker's live trade (Team 6 ↔ Team 10) is rebuilt with no warnings, and the trades listed now match ESPN's counters. The matching windows are adapter constants (import heuristics), not config.
  - **Move positions** (Phase 4): ESPN's transaction items carry no position, so each move takes it from the rosters, then the free-agent lists, the team-defense id, and a single-position lineup slot (141 of 141 live moves). Sleeper moves take it from the players DB the import already loads.
- **IR slots** (Phase 4b): ESPN's IR slot takes OUT and IR players (✅ ESPN's help center, "Players on Injured Reserve (IR)", support.espn.com/hc/en-us/articles/115003849911, updated 2026-08-18: "players with either the Out (O) or Injured/Reserve (IR) status may be placed into the IR slot"; "Suspended players (SSPD) are NOT eligible"; Questionable and Doubtful players may stay in the slot but can't be placed there). 2 of the 7 IR-slot players in Parker's league were OUT on 2026-10-03. The adapter sets `irEligible` to IR and OUT.
- **Injury return dates:** `view=kona_playercard` (espn-api's `get_player_card` filter) gives `injuryDetails.expectedReturnDate` for injured players (22 of 22 in Parker's league); fetch it for injured rostered players and map it to `injuryReturnWeek`.
- **Stats entries:**
  - `statSourceId`: 0 = actual, 1 = projected
  - `statSplitTypeId`: 0 = season, 1 = single week
  - `scoringPeriodId` and `seasonId`
  - `stats`: statId → value
  - `appliedTotal`: points under *this league's* scoring, when fetched through the league endpoint

**Players, projections and free agents**
- Use `view=kona_player_info` on the league endpoint. It needs an `X-Fantasy-Filter` JSON header to raise the result limit and to filter by status (free agents and waivers).
- Copy working filter payloads from `cwendt94/espn-api`, specifically `league.free_agents()` and `player_info()`. Don't invent them.
- For a league-independent player pool, use `GET /seasons/{season}/segments/0/leaguedefaults/3?scoringPeriodId={week}&view=kona_player_info`. Verified 2026-09-29: it returns 2026 projected stats with statSourceId 1.
- **League-scored weekly projections (Phase 2):** on the league endpoint, `kona_player_info` returns weekly lines only for the requested `scoringPeriodId`. The main league request's `mRoster` carries every rostered player's previous- and current-week projections (statSourceId 1, statSplitTypeId 1), and the free-agent calls carry the current week. Their `appliedTotal` is exactly Σ stat × the league's scoring items (0.000 difference on every line). An empty line (no stats) means "not projected". `leaguedefaults/3` returns weeks 1–18 in one call, but its `appliedTotal` uses ESPN's default scoring. The model therefore uses the current and previous week from the import itself and makes no extra ESPN request.
- **Waiver status** (Phase 7b, for the League page's Waiver upgrades, Section 14; `src/adapters/espn/freeAgentStatus.ts`): the free-agent calls answer each player with ESPN's `status` (✅ in every capture: FREEAGENT or WAIVERS unrostered, ONTEAM rostered) and, for WAIVERS, `waiverProcessDate` (epoch ms, when ESPN runs the claims; ✅ on every WAIVERS row of the Phase 0 captures). Each kept free agent's status goes to `LeagueSnapshot.freeAgentStatus`: FREEAGENT → "Free agent now", WAIVERS → "On waivers until Wed" (no date: "On waivers"), anything else → none shown. The schema keeps both fields, so a league the browser read gets the same statuses.

**NFL bye weeks**
- `GET /seasons/{season}?view=proTeamSchedules_wl` → `settings.proTeams[].byeWeek`. Verified 2026-09-29.

**My team**
- For cookie users: the team whose `owners` contains the user's SWID.
- For public leagues without cookies: ask the user to pick their team.

**ID tables**
- Lineup slot IDs, position IDs, pro team IDs and stat IDs: port them from `cwendt94/espn-api` (`espn_api/football/constant.py`, MIT license) into TypeScript, with credit. Never hand-guess IDs.

**Optional**
- A cookie user's leagues can be listed via `https://fan.api.espn.com/apis/v2/fans/{SWID}`, which saves typing the league ID. Verify it before relying on it.

### 2.3 Sleeper (priority 1)

**Terms and limits**
- Docs are at https://docs.sleeper.com.
- Free for **non-commercial** use, read-only, no login. Stay under 1,000 calls per minute.

**Documented endpoints (base `https://api.sleeper.app/v1`)**
- `/user/{username}` → `user_id`
- `/user/{user_id}/leagues/nfl/{season}`
- `/league/{id}`, plus `/rosters`, `/users`, `/matchups/{week}`, `/transactions/{week}`, `/traded_picks` and `/drafts`
  - future weeks of `/matchups/{week}` give the schedule through `matchup_id`
- `/state/nfl` (verified 2026-09-29: week 4 of 2026)
- `/players/nfl`
  - about 15 MB (14.7 MB measured in Phase 0), so fetch it **at most once per day**, with the `position` and `active` filters
  - it accepts `?position=QB&active=true` filters
  - cache it for 24 hours on the server, and never send the whole thing to the browser

**League fields**
- `scoring_settings`: keys are Sleeper stat keys.
- `roster_positions`: for example QB, RB, WR, TE, FLEX, SUPER_FLEX, REC_FLEX, WRRB_FLEX, K, DEF, DL, LB, DB, IDP_FLEX and BN.
- `settings`: `playoff_week_start`, `playoff_teams`, `trade_deadline`, `type`, `reserve_slots`, `taxi_slots`, `waiver_budget`, `league_average_match`, `num_teams` and more.
- **Check the meaning of every numeric code against real leagues in Phase 0** rather than assuming it: league type, the "no deadline" value for the trade deadline, playoff round type, and so on.
- Phase 0 verified the codes against 250 public leagues (`reports/probe-output/sleeper-codes.md`). Decisions:
  - **Trade review:** `veto_auto_poll = 1` → `league_vote`; anything else → `none`. The review period (Phase 7b, `LeagueSettings.tradeReviewHours`, for the Trade Finder's best-time line, Section 14): with the veto vote, `trade_review_days` × 24, the vote's length (⚠️ 3 of 3 polled trades in Phase 0 took at least that long, below the 3-league minimum; 0, 1 or 2 days in the 250 crawled 2026 leagues); with `veto_auto_poll` 0, 0 hours (⚠️ Phase 0 found `trade_review_days` alone holds no trade); with `veto_auto_poll` missing (its "none" only assumed, with its warning) or a code we don't know, unknown.
  - **Position limits** (`position_limit_*`) apply to the active roster only; IR is exempt.
  - **Guillotine leagues** (`type` 3): reject them at import for the MVP, with a friendly message.
  - **Best-ball leagues** (`best_ball = 1`): allowed, with an Import Report note that lineups are set automatically.
  - **Inferred readings, shown with a warning:** `trade_deadline` 99 = no deadline (1 of 5 leagues). Any other deadline code, or a missing one, is shown as unknown. A missing `playoff_round_type`, `league_average_match` or `playoff_seed_type` uses the default with a warning.
  - **Standings tiebreaker** (✅ documented, Phase 3): "If two or more teams finish with the same record, the default standings tiebreakers are: Points For, Higher Points Against." Further ties are a coin flip unless the commissioner seeds by hand ("custom seeding", which the API doesn't show), and "If any playoff matchups end with a tie score, the winner is automatically the higher seed" (`support.sleeper.com/en/articles/4238872`).
  - **Division winners** (Phase 3, `support.sleeper.com/en/articles/2203518`): "The winners of each division automatically make the playoffs." Their seeds are documented for two layouts only: in 6-team playoff leagues with 2 divisions, "The bye week goes to the 2 division winners with the best record, based on Overall Record > Points For > Points Against", and in 4-division leagues "The top 4 seeds will always be given to division winners". Division winners first is ✅ for those layouts and ⚠️ inferred for the others (Phase 0 saw it in 2 of 2 leagues), with a warning. It is decided whatever `playoff_seed_type` says; when the seed type is missing, the fixed bracket is assumed (with a note) but division winners still come first.
  - **Final scores** (Phase 3): matchups are decided through `settings.last_scored_leg` (Phase 0 saw it equal the last completed week in 178 of 178 in-season leagues), falling back to `leg − 1`, then the NFL week − 1. "Before `leagueWeek`" would have dropped a finished week the records already count. A team's score is `custom_points` when it's a number (⚠️ read as a commissioner override from its name; null in all 4,940 cached rows), else `points`. Playoff matchups aren't imported yet.
  - **The deadline week is a league week:** trades complete through league week (`settings.leg`) D, which can lag the NFL week by a day; the snapshot carries it as `leagueWeek`.
  - **Yardage bonus tiers are exclusive** (✅ documented): Sleeper's help center labels them "100-199 Yard Rushing Game" and "200+ Yard Rushing Game" and says "The yard ranges are strict and do not stack" (`support.sleeper.com/en/articles/3998131`). The same holds for receiving and for combined rush + rec yards.
  - **Tradable future picks** (✅ documented): "the current season + up to 3 future years", and leagues can't change that (`support.sleeper.com/en/articles/4047901`).
  - **IR slots** (Phase 4b): IR and PUP players always; OUT, DOUBTFUL, SUSPENDED and NA players when `settings.reserve_allow_out`, `_doubtful`, `_sus` or `_na` is 1 (✅ the public test league: `reserve_allow_out` 1 with 3 OUT players in its IR slots, and a PUP player there with no flag of its own; the flags are 0/1 in 244 of 250 crawled leagues). None reported: `irEligible` absent (the engine's default, IR and PUP). ⚠️ Sleeper's DNR and COV statuses (read as OUT) have their own flags; OUT follows `reserve_allow_out` alone.
  - **Waiver order and FAAB left** (Phase 4b): `rosters[].settings.waiver_position` → `Team.waiverRank` (a 1..n permutation in all 18 surveyed 2026 leagues; position 1 is the first claim, ⚠️ read the same way for rolling waivers). Phase 4c (`src/adapters/sleeper/waivers.ts`): `waiver_type` 1 resets to reverse standings each week (✅ 3 of 3 surveyed 2026 leagues: two read before their weekly run match exactly, and the third reads as the reset order with that week's claimants moved to the back, ⚠️ read so), so `waiver_position` is a live order there too: `Team.waiverRank` is computed from the standings (worst win % first, then fewer points for, then fewer points against, then roster id; points against never decided a place in the evidence), `Team.liveWaiverRank` keeps `waiver_position`, and `waiverOrderUsed` is "weeklyReset" (with divisions the overall standings, with a warning; before any game the live order, with a warning). `waiver_type` 0 is read as rolling waivers (⚠️ by elimination): the live order. `waiver_type` 2 is FAAB. A missing or unknown type keeps the live order, with a warning. FAAB left (`waiver_type` 2) = `waiver_budget − waiver_budget_used`, which can exceed the budget after FAAB is traded (one league has 205 left of 100). The committed minimized fixtures from strangers' leagues keep no real waiver orders (a permutation could fingerprint a league); tests set made-up values inline.

**Undocumented endpoints (verified live 2026-09-29, may change)**
- **Weekly projections:** `GET https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular&position=RB` returns an array of `{player_id, week, stats: {pass_yd, rush_yd, rec, rec_yd, rec_td, …, pts_ppr, pts_half_ppr, pts_std}, last_modified}`.
  - Future weeks exist (week 15 verified).
  - Future weeks are refreshed in season (Phase 0: `last_modified` 2026-09-28 for weeks 5–18), and QB/RB/WR/TE values vary by opponent. Section 6 uses them for week shape.
  - **Pre-game snapshots** (Checkpoint 2 answer 4): Sleeper re-stamps past weeks' projections after the games, so the weekly projections a model build loads (the League page under `npm run dev` or the stable copy, Section 0.13, and `npm run league:report -- --live` or `trade:report -- --live`) are archived in git-ignored `data-local/` whenever they were fetched before that week's first kickoff: only the fields we use, compressed, and only the last pre-kickoff snapshot per week. `npm run snapshot:projections` does it by hand for the current week and the next one, all nine positions (for example on Wednesday nights). No scheduled task runs on Parker's computer. Phase 6 refits the stat SDs (Section 5) on these true pre-game numbers.
    - This is narrower than "the app or a script": a Sleeper import's own projection weeks (this week and the next 2, which rank free agents) aren't archived when fetched; until Checkpoint 7a they shared the model build's cache entries, so the League page archived them when it read them. Since Checkpoint 7a's reducers (Section 3, "The shared cache") the import reads its weeks in their own "import form" (stub rows kept: the import reads injured players' teams and tags from them) under keys of their own, and the model build its "model form"; the archive files every pre-kickoff week the model build reads, as before. ⚠️ The two forms are fetched and refreshed separately, so an import's injury tags and the model's projections of the same week can be up to about 6 hours apart. The probes and `npm run import:report` archive nothing.
    - Phase 3 details: files are `data-local/projection-snapshots/<season>/week-WW.json.gz`, one group per requested position, each with its fetch time and Sleeper's latest `last_modified`. Stats keep Sleeper's raw keys (so Phase 6 compares like with like against `/stats`) minus the fantasy-point totals (pts_ppr, pts_half_ppr, pts_std, pts_idp; a team defense's `pts_allow` is a stat and stays), ADP and ranks, at 3 decimals: about 37–39 KB per week for all 9 positions (about 1,250 players). "Before kickoff" uses the NFL schedule's first kickoff of the week; a week after the current one counts as before kickoff when its times are unknown. The archive is off in production and in tests, except under `next start` with `OFFERSHEET_DATA_LOCAL` set (the stable copy, which writes into the development folder's `data-local/`; never on Vercel).
    - **On production** (Phase 7b; planner reply to Checkpoint 7a, §6.3; `src/server/snapshots.ts`, Section 3 "The snapshot cron"): a daily Vercel cron (`0 20 * * *` UTC; on Hobby it runs once, sometime within that hour) fetches the current week and the next one while each week's first kickoff is still ahead, all nine positions, through the model build's own loader and cache (at most one Sleeper request a week a run), and merges them by the archive's rule, so the last pre-kickoff copy wins (⚠️ the next week too, as `snapshot:projections` does: each week gets a save every day for about a week before its kickoff, so a missed run costs a day's age, not the week's copy). A week whose first kickoff has passed is left alone; without the schedule only the next week counts as ahead. Stored in Upstash (gzip, base64; about 52 KB a week, kept 730 days: two seasons); `npm run snapshot:pull -- --live` copies them into these files (Section 16). Vercel runs crons on production only, so until launch `npm run snapshot:projections` by hand stays the way (optional). ⚠️ For Phase 6's base-rate stability work it isn't enough: it keeps each week before its own kickoff, while the later weeks' daily moves drive the swings (`reports/stability.md`).
- **Season projections:** `/projections/nfl/{season}?season_type=regular&position=QB`.
- **Multiple positions:** try `position[]=QB&position[]=RB`, and fall back to one call per position.
- **Actual stats:** `/stats/nfl/{season}/{week}?season_type=regular`. Verified in Phase 0: with it, the scoring oracle reproduces league points exactly. Rows carry `gp` 1 when the player played and no `gp` otherwise.
- **Stubs (Phase 2):** a projection row without scorable stats is a stub (a bye, an injured or teamless player, or a backup Sleeper doesn't project). Only rows with stats count as projections. Season projections carry `gp` 18 on every row and their span is unverified (⚠️), so the model uses them only as a last-resort base rate, divided by 17 games.
- **What the model fetches:** weekly projections from 3 weeks back (an injured player's most recent healthy projection) through the last fantasy week, and stats for every completed week, one request at a time. Each NFL week's projections are cached separately: served for 6 hours for past (lookback) weeks, the current week and the next 2, and for 24 hours for later weeks (Checkpoint 2); every week's copy is kept 24 hours, whichever request stored it, so the outage logic below always knows what the cache holds. Stats and season projections: 6 hours. Requests for the same cached data that overlap share one download (single-flight). If Sleeper stops answering (each request: 20 s timeout, 1 retry), the build stops asking for the rest (one warning) and remembers the outage in-process for 5, then 10, then at most 15 minutes, still reading copies the server cache holds, so a Sleeper outage can't stall the League page. A request cut by its own deadline (Checkpoint 7a) or (Phase 7b) by Offer Sheet's own Sleeper budget (the day's, or the visitor's network's share) stops only that build: Sleeper wasn't slow or wasn't asked, so no instance-wide hold starts (a share one visitor can use up must not hold every build on the instance off Sleeper). A league renewed for next season (January–February) loads trade values only until its season starts.

**My team**
- The roster whose `owner_id` or `co_owners` matches the user_id.

**Browser fetching (check in Phase 1)**
- Find out whether `api.sleeper.app` sends CORS headers. Verified in Phase 1 (`npm run check:sleeper-cors`, `reports/probe-output/sleeper-cors.md`): `/v1/state/nfl`, `/projections`, `/v1/league/{id}` and `/v1/league/{id}/rosters` all answer a cross-origin GET with `Access-Control-Allow-Origin: *`; the other league endpoints are inferred to match. Browser fetching itself is deferred to Phase 7.
- If it does, fetch Sleeper data from the user's browser in production. Each user's requests then count against their own IP, not against our server's shared limit.
- Keep the normalizer code shared between browser and server.
- Built at Checkpoint 7a (Section 3, "Browser reads"): every Sleeper league's own requests (user, the user's leagues, league, users, rosters, matchups, transactions, traded picks, drafts) go through the browser, which uploads them; the server adds its own projections and NFL state and normalizes. The league users' `metadata` is trimmed to `team_name` in the upload.

### 2.4 Yahoo (gated — Phase 5, behind `FEATURE_YAHOO`)

**Status on 2026-09-29**
- Official API: OAuth 2.0 and read-only.
- Since about May 2026, Yahoo requires an **approved application**. Apps without approval get 403 "This application is not authorized to perform this action".
- Parker has applied.
- Build the adapter against Yahoo's docs and fixtures. Until live calls succeed, the UI shows "Yahoo: coming soon".

**What happens after approval (from other developers' experience)**
1. Yahoo sends an agreement through DocuSign.
2. Yahoo emails asking for a Client ID.
3. Create a **new** app at developer.yahoo.com *after* access is enabled on the account. Apps created earlier can't be switched over.
4. Submit the new app's Client ID.
5. Probe once a day. Access has gone live a few days *after* the "you're live" email.

**OAuth 2.0**
- Authorize: `https://api.login.yahoo.com/oauth2/request_auth`
- Token: `https://api.login.yahoo.com/oauth2/get_token`
- Scope: `fspt-r`
- The redirect URI must be HTTPS. Locally, run `next dev --experimental-https` and register `https://localhost:3001/api/auth/yahoo/callback` (the development port since Checkpoint 7a; 3000 belongs to the stable copy, Section 0.13).

**API**
- Calls look like `https://fantasysports.yahooapis.com/fantasy/v2/...?format=json`. Resources:
  - `users;use_login=1/games;game_keys=nfl/leagues`
  - `league/{league_key}/settings`: roster_positions, stat_categories, stat_modifiers, playoff_start_week, num_playoff_teams, trade_end_date, uses_faab
  - `league/{key}/teams/roster`
  - `league/{key}/standings`
  - `league/{key}/scoreboard;week={n}`
  - `league/{key}/transactions;types=trade`
  - `league/{key}/players;status=A;start={n};count=25` (free agents, paginated)
- Look up the current NFL game key with `game/nfl`. Never hardcode it.
- Yahoo's JSON uses objects with numeric keys and arrays of single-key objects. Write a careful normalizer and test it with fixtures.

**Attribution (required)**
- Wherever Yahoo data appears, show "Fantasy data provided by Yahoo Fantasy" with the official Yahoo Fantasy logo, unmodified, linking back to Yahoo Fantasy.

**Throttling**
- Yahoo throttles heavy use. Cache each league for at least 10 minutes and batch requests.

### 2.5 Fleaflicker (Phase 5)

- Public API documented at https://www.fleaflicker.com/api-docs/index.html. Base URL: `https://www.fleaflicker.com/api/`.
- Endpoints:
  - `FetchLeagueRules?sport=NFL&league_id=`: roster slots and scoring. The JSON is protobuf-style and **omits fields whose value is zero**, so treat a missing field as 0.
  - `FetchLeagueRosters?sport=NFL&league_id=&season=`
  - `FetchLeagueStandings`
  - `FetchLeagueScoreboard?scoring_period=`
  - `FetchLeagueTransactions`
  - `FetchPlayerListing` (free agents)
  - `FetchUserLeagues`
- No login needed.
- Some settings exist only on the league's public HTML rules page (`/nfl/leagues/{leagueId}/rules`): playoff teams, weeks and byes, trade deadline, review period, tiebreakers, seeding and roster minimums (Phase 0). Read that page with a tolerant parser and cache it for 24 hours. If parsing fails, the Import Report asks the user for those settings.

### 2.6 MyFantasyLeague (Phase 5)

- Docs: `https://api.myfantasyleague.com/{year}/api_info`. Read them yourself; the planner's fetch tool was blocked there.
- Exports: `https://api.myfantasyleague.com/{year}/export?TYPE={type}&L={leagueId}&JSON=1`. Follow redirects to the league's `wwwNN` host.
- Useful TYPEs:
  - `league`, `rules`, `rosters`, `players`
  - `projectedScores`: already scored with the league's rules
  - `schedule`, `standings`, `transactions`, `futureDraftPicks`, `injuries`
  - `leagueSearch`: use it to find public test leagues
- Private leagues need the user's MFL login cookie (from the `login` request) or an API key.
- The trade deadline and review settings are visible only to league owners (Phase 0). Without an owner login, show "unknown" in the Import Report and let the user fill them in.
- Register a client User-Agent through MFL's API client program to get better rate limits.
- Check every one of these details on api_info before writing code.

### 2.7 Fantrax (Phase 5, stretch goal)

- Public endpoints under `https://www.fantrax.com/fxea/general/`:
  - `getLeagueInfo?leagueId=`
  - `getTeamRosters?leagueId=&period=`
  - `getStandings`
  - `getDraftPicks`
  - `getPlayerIds?sport=NFL`
  - `getAdp?sport=NFL`
- Works for public leagues only.
- Errors come back as **HTTP 200 with an `error` object** in the body.
- Check whether scoring rules are exposed. If they aren't, the user picks a scoring preset.

### 2.8 Manual import (NFL.com, CBS, anything else)

- **Scoring:** the user picks a preset and can edit the key values. Presets: Standard, Half-PPR or PPR; 4 or 6 points per pass TD; TE premium on or off.
- **League settings:** the user also sets lineup slots and playoff settings.
- **Rosters:** the user pastes each team's roster, one player per line, or uploads a CSV.
- **Matching:** fuzzy-match names, plus position and NFL team, against the player database. Show a screen where the user can confirm or fix each match.

### 2.9 Shared data sources

**FantasyCalc market values (verified 2026-09-29, both modes)**
- Request: `GET https://api.fantasycalc.com/values/current?isDynasty={true|false}&numQbs={1|2}&numTeams={n}&ppr={0|0.5|1}`
- Response fields:
  - `player`: `id`, `name`, `position`, `sleeperId`, `espnId`, `mflId`, `fleaflickerId`, `ffpcId`, `maybeTeam`, `maybeAge` and more
  - `value`, `redraftValue`, `overallRank`, `positionRank`, `trend30Day`, `maybeTier`, `maybeTradeFrequency`
- There is **no Yahoo ID**. For Yahoo players, use the DynastyProcess map below.
- Parameters:
  - `numQbs=2` if the league has a SUPER_FLEX or OP slot, or two or more QB slots.
  - `numTeams`: use the nearest supported value. Known values are 8, 10, 12 and 14. An unsupported value silently returns the 12-team values (Phase 0), so map it yourself (for example 16 → 14) and note the substitution in the Import Report.
  - `ppr`: the nearest of 0, 0.5 or 1, based on points per reception.
  - TE premium uses `tep`. Reported values are `te+` and `te++`. Leave the parameter out when there's no TE premium, and verify how it behaves.
- Check whether dynasty results include rookie draft picks, and how they're named.
- **Which number (Phase 2):** a league's values are `value` from a request in the league's own format. `redraftValue` is FantasyCalc's baseline (12 teams, PPR, no TE premium) and is never used. Keeper leagues request both formats: dynasty values for the long term, redraft values for perception (Section 9). Phase 4b: dynasty leagues also request the redraft list in their own format, read only by the market blend (Section 6 step 8; `MarketInputs.seasonValues`). It is asked only after the league's own list loaded and only while weeks are left to project, and like any format isn't asked again for 3 hours once a copy is cached (a day before Phase 7b). (Phase 4c: when FantasyCalc doesn't answer, an outage memory holds it off for 5, then 10, then at most 15 minutes in-process, as for Sleeper, so the later lists, this one and a keeper league's redraft list, are read from the server cache only; with no copy, a keeper league's redraft list gets its FANTASYCALC_REDRAFT_UNAVAILABLE warning, and a dynasty league's season list leaves the blend off, which the League model says.)
- **Our mapping** (approved at Checkpoint 2; ✅ confirmed by FantasyCalc on 2026-10-05, `reports/fantasycalc-permission.md`): a TE premium (a TE's minus a WR's points per catch) below 0.75 asks for `te+`, 0.75 or more for `te++`. Ties in `numTeams` and `ppr` go to the larger option. Every substitution is noted in the Import Report.
- Terms: FantasyCalc's conditions for free use (their reply of 2026-10-05, FantasyCalc to Parker: `reports/fantasycalc-permission.md`; planner reply to Checkpoint 7a, 5.4). Until then: once a day per format, the documented `/values/current` and `/players`, and a link next to the values.
  - non-commercial use only, and free while Offer Sheet stays under about **10,000 sessions a month** (or $2,000 a month in revenue; it has none). A session is a League page model build answered (each loads their values); `npm run usage:report -- --live` shows the month's against 10,000 and warns from 8,000, so Parker can write to them before we cross it.
  - call only **`/values/current`** (never `/players`, never the per-player history endpoints)
  - refresh each format's list **at most once every 3 hours, and only when someone needs it** (their values update every 3 hours): `TTL.fantasyCalc`, asked only by a model build that reads the list and finds no copy that fresh, and on production by the daily snapshot cron for a format a build read that day or the day before (the public archive, below)
  - a **link back to fantasycalc.com on every page that shows their data or anything derived from it**, at least one in plain server-rendered HTML: the footer's "Trade values: FantasyCalc", which the root layout renders around every page (check:browser checks the built HTML). Every link to FantasyCalc has `rel="noopener"` (no `nofollow`, no `noreferrer`) and `referrerpolicy="origin"` (`FANTASYCALC_LINK`, `src/components/league/ValuesCredit.tsx`), so FantasyCalc sees that a visit came from Offer Sheet, not from which page. The trade cards and the League page keep their small "Values: FantasyCalc" link.
  - **never display their values**: no FantasyCalc value number and no value comparison anywhere in the UI (cards, reasons, pitch messages, the League page, the Analyzer's Details; Sections 13 and 14), so Offer Sheet doesn't compete with their trade calculator or league analyzer. Our own outputs (the chance they accept, projections, Helps you, odds) stay, with the link. `src/lib/fantasyCalcHidden.test.ts` guards it with distinctive values.
  - the launch email: done. FantasyCalc approved on the understanding that Offer Sheet shows none of their values; Parker's first email had described our private daily copies (the local archive and the public archive, below), and they didn't object. Parker decided against a follow-up describing the Analyzer and the League page: it isn't a launch condition.
- **Local archive** (Phase 4b; planner reply to Checkpoint 4, item 7; `src/server/fantasyCalcArchive.ts`): every FantasyCalc list a model build loads is also written to git-ignored `data-local/fantasycalc-snapshots/<season>/<UTC day>/<format>.json.gz`, the first copy of each day kept, with only what a Phase 6 backtest of the market blend needs (FantasyCalc id, Sleeper and ESPN ids, position, value, redraftValue, overall and position rank). It adds no request and is never published, so it fits the terms as we read them (⚠️ their terms encourage caching on our own server and forbid reproducing their content on another website, and say nothing about archives; Parker's first email to FantasyCalc described these private daily copies, and they didn't object). Like the projection archive (Section 2.3) it is off in production (but for the stable copy, which sets `OFFERSHEET_DATA_LOCAL`), on Vercel and in tests, never throws into a build, and logs only an error's name. `next.config.ts` keeps `data-local/`, `fixtures/`, `.cache/` and `reports/` out of the server bundles' file traces, so a deploy built on this computer can't upload them.
- **The public archive** (Phase 7b; planner reply to Checkpoint 7a, §6.3; `src/server/snapshots.ts`): on production the daily snapshot cron (Section 3) also saves today's list of each format a League page build read yesterday or today (the builds record format keys only, a set per UTC day kept 3 days, nothing about the league), with the local archive's fields, gzipped in Upstash and kept 730 days (two seasons). At most 12 formats a UTC day (`snapshotLimits.fantasyCalcFormatsPerDay`); past it the formats take turns (none saved in the last 14 days first, `snapshotLimits.turnLookbackDays`, then the oldest saved), and the run names the ones left out. A list counts as today's only when FantasyCalc served it on the run's UTC day: a copy the cache holds from today costs no request, otherwise the loader asks within the 3-hour rule (never during an outage); a saved copy standing in during an outage isn't saved. `npm run snapshot:pull -- --live` copies them into the local archive (a day's file already there is kept).
- **`/players`, no longer called** (Phase 7b; FantasyCalc's conditions; `src/data/load.ts`): the player-ID crosswalk comes from Sleeper's player DB and DynastyProcess only. FantasyCalc's ids were its second source for ESPN, MFL and Fleaflicker ids (⚠️ measured offline on the 2026-10-05 cached bodies: ESPN ids mapped 7,421 → 7,393, the 28 lost all players DynastyProcess doesn't list, 9 of them on an NFL team, deep backups and rookies; MFL 6,445 → 6,415; Fleaflicker 930 → 520; Parker's league keeps 420 of its 421 players' ids, the other a free agent the name match finds; the crosswalk rules below lose one fix). The model inputs' `knownIds` are the players the value lists name (only the reports read it). The probes read FantasyCalc through the app's own HTTP client and cache entry (`scripts/lib/fantasycalc.ts`, `.cache/app`), so the 3-hour rule holds across the probes, the app and the stable copy, and they don't ask `/players` either.
- **The only market source** (planner reply to Checkpoint 4b, change 12): FantasyCalc is built from real trades, comes in each league's exact format and tested best among the free calculators. There is no good free second source of redraft trade values: KeepTradeCut has no API and its terms forbid scraping; FantasyPros needs a paid key and allows personal use only; DynastyProcess values are dynasty-only, expert-based and GPL-3.0 (a second dynasty source is Phase 6 work, after a license review).
- **Fallbacks** (Phase 4c; `src/server/modelInputs.ts`, `src/data/fantasyCalcValues.ts`, `market.ts`): each format's list is kept in the cache up to `config.market.fantasyCalcCurveDays` (90) days after it was fetched, still served fresh for 3 hours only (Phase 7b: once a format's list is cached, no request for it for 3 hours; 24 hours before), older copies only when FantasyCalc doesn't answer; the age comes from FantasyCalc's own fetch time. (1) A copy at most `fantasyCalcStaleDays` (7) days old stands in, with the note "Trade values from Sep 27: FantasyCalc didn't answer." (`MarketInputs.fallback` "saved"; a dynasty league's season list used only by the blend gets its own note and isn't a trade-values fallback). (2) Older, up to 90 days: our own value curve (`market.curveMarketValues`): per position, a monotone curve of the old list's values on today's rest-of-season points, fitted on healthy players with points left (`MarketPlayer.fit`, the blend's rule), and every player valued off it (source "estimate", no cap), with a clear banner (warning FANTASYCALC_VALUES_ESTIMATED: "… an injured player's value counts only the games he's expected to play. Read trade values as rough."). Then the blend is off (the League model says so: "The trade-market blend is off: FantasyCalc didn't answer and its newest values are too old, so projections aren't pulled toward the trade market."), the long-term term is off, the top-12 list comes from these estimates, and B's market term is off (κ = 0, Section 10: these values come from our own points, so the term would count them twice). ⚠️ W runs high there (Parker's 2026-10-04 data at Checkpoint 4c, before W left out claimed free agents: 1,299 against [value] fresh, 94 of 167 rostered players at or below it, against 61) because a free agent our model rates highly is read off the curve. In a keeper league whose redraft list is missing the dynasty list calibrates the perception curve, with a warning. (Until Phase 7b FantasyCalc's /players was asked when some list came fresh in that build.) (3) Older than 90 days or none: no values, as before, with a warning, and the search says once: "While FantasyCalc's trade values aren't available, the chance they accept treats every trade as even on trade value." Every path is tested. While FantasyCalc doesn't answer, an outage memory (`fantasyCalcGate`, the Sleeper gate's rule: 5, then 10, then at most 15 minutes in-process) keeps builds from asking again, still serving the copies the cache holds. Phase 7b (review of its server work): an answer the checks turn down (a short list, a changed shape, an error status) holds that format off for 3 hours too (`FantasyCalcGate.rejected`, ⚠️ per instance like the outage memory; a saved copy stands in meanwhile), so a bad format is asked at most once every 3 hours like a good one; and a request Offer Sheet itself held back (its deadline, or the day's FantasyCalc budget, Section 3) says nothing about FantasyCalc and starts no outage memory (read as an outage, anyone who spent the budget could hold every format off).

**DynastyProcess player ID crosswalk**
- License: GPL-3.0. Keep the map on the server, credit DynastyProcess, and review the license before any downloadable or app-store version (Section 19; planner reply to Checkpoint 4b, change 12).
- `https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv` (verified 2026-09-29).
- Columns include mfl_id, sportradar_id, fantasypros_id, gsis_id, sleeper_id, espn_id, yahoo_id, fleaflicker_id, cbs_id, ktc_id, name, merge_name, position, team and birthdate.
- Refresh daily.

**Player ID crosswalk rules** (Checkpoint 1 answers)
- A player no ID source knows is matched on exact name + position + NFL team, but only when exactly one active player fits, and never when he has no NFL team. Flag each such match in the Import Report.
- A lower-priority ID source may override the top source, when the top source links an id that isn't an active fantasy player (a stale or wrong link), only when the two agree on name and position, plus either NFL team or GSIS id. "The two" are the top source's own row and the active Sleeper record the lower source links. Log every override in the Import Report notes, and keep a test for the players it fixes (Phase 2: 5 platform ids of 2 players, Sam Hartman and Chris Jones; both are wrong links in DynastyProcess, not stale duplicates). Since Phase 7b, without FantasyCalc's `/players` rows, 3 ids of 1 player: Chris Jones's ESPN, Yahoo and GSIS ids, fixed through the Sleeper DB. ⚠️ A known regression (the lead's call: accept it, or pin a link): no source the app reads links Sam Hartman's active record, so his ESPN and MFL ids follow DynastyProcess's wrong link again and he reads as an inactive player; `src/data/crosswalk.test.ts` pins both, and that the rule still fixes him wherever a lower-priority source links his active record.

**NFL schedule and bye weeks**
- ESPN `proTeamSchedules_wl` for bye weeks, and for kickoff times (`date`, epoch ms). Games marked `startTimeTBD` (weeks 16–18 until the NFL sets them) carry placeholder times and are treated as unknown. Byes and kickoffs are keyed by Sleeper team codes (WAS, LAR).
- nflverse `https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv`. Verified: it has all 272 regular-season games for 2026.
- Phase 4: each NFL team's weekly opponent and home/away, from the current week on (games without a set time included; WSH read as WAS), go into the model inputs for "Streaming picks this week" (about 15 KB at week 4).

### 2.10 Cache rules

| Data | Refresh at most every |
|---|---|
| Sleeper players DB | 24 h |
| FantasyCalc values (per format) | 3 h, and only when a build needs it (FantasyCalc's conditions, Phase 7b; 24 h before); kept up to 90 days as a fallback, Section 2.9 |
| DynastyProcess ID map | 24 h |
| NFL schedule and byes | 7 days |
| Projections (Sleeper and ESPN): the current NFL week and the next 2 | 6 h |
| Projections for later NFL weeks | 24 h |
| Sleeper actual stats | 6 h |
| League data (settings, rosters, transactions) | 10 min, plus a manual "Refresh" button |

- Each NFL week's projections are a cache entry of their own. Requests for the same cached data that overlap share one fetch (single-flight), in production and in development.
- **Private-league data** (ESPN with cookies, MFL with a login, Yahoo) must be cached under a key that includes a hash of the user's credentials or session. Never key it by league ID alone, or anyone who enters that league ID would see the private data. Public data can be keyed by league ID.
- Cached entries are **deleted** when their retention ends: league data after 10 minutes (Refresh shortens how old a copy may be, not how long it's kept); public league-independent data (player lists, ID maps, the NFL schedule) after up to 7 days, so a saved copy can stand in while a source is down; FantasyCalc's value lists after 90 days (`config.market.fantasyCalcCurveDays`, Phase 4c), so an older list can still calibrate our own estimates during a long outage (Section 2.9). ESPN member IDs (SWIDs) are replaced by one-way pseudonyms before anything is cached.
- **On Vercel** (Checkpoint 7a, Section 3): the same rules, held by the shared cache (a per-instance memory tier in front of Upstash; HMAC'd keys, gzipped and encrypted values, deleted by Upstash's own expiry at the end of each retention). League data a visitor's browser sends is never cached. Since Phase 7b the shared store also holds the public archive (Sleeper's pre-game projections and FantasyCalc's daily lists, Sections 2.3 and 2.9: kept 730 days, two seasons; the formats in use, a set of format keys per UTC day, kept 3 days) and the usage counters (Section 3: per UTC day, no identifiers, kept 400 days after their day's last count).
- **One file cache for two copies** (Checkpoint 7a, A1): the stable copy (Section 0.13) reads and writes the development folder's `.cache/app`, so FantasyCalc stays at one request per format per refresh (a day then, 3 hours since Phase 7b; the probes read the same entries) and the platforms see one set of requests. It's safe because the HTTP client stores raw responses only (status, content type, body, fetch time), each written atomically with its own expiry, and reads an entry only in the shape and `CACHE_FORMAT` (`src/server/http.ts`, format 1) it stores: anything else is a miss, never an error or a stand-in copy. **Any change to what the client stores must bump `CACHE_FORMAT`** (new keys, so the other copy never reads it); FileCache's envelope and file names need the same care. ⚠️ Single-flight is per process, so the two copies can fetch the same resource at the same moment, and a bug that stores a wrong body under the right key reaches the other copy until the entry expires.

---

## 3. Tech stack and architecture

**Stack**
- Next.js (current stable, App Router), TypeScript in strict mode, Tailwind, Node 22 or newer, npm.
- zod validates every external response at the adapter boundary. Unknown fields are ignored. A missing required field produces a clear error that lists its JSON path.
- Vitest for tests.

**Server route handlers**
- They do all platform fetching and normalizing, and return one normalized `LeagueSnapshot` in JSON.
- Why the server: browsers can't send ESPN's cookies to ESPN from another site, Yahoo OAuth needs a secret, and there's CORS.

**Engine**
- The engine is pure TypeScript: projections → lineups → simulation → search → scoring.
- It runs in a **Web Worker in the browser**, which avoids server timeouts and costs nothing.
- The same code runs in Vitest and in Node scripts.

**Credentials**
- Keep credentials that users type in (ESPN cookies from Phase 1; MFL logins and Yahoo tokens from Phase 5) in an encrypted, httpOnly, **session-only** cookie, for example with iron-session.
  - Never store them on the server.
  - Offer a "Forget my credentials" button.
- For Parker during development: use `.env.local`, only when `USE_ENV_COOKIES=1` (Section 0.5).

**Saved leagues** (Phase 4c; planner reply to Checkpoint 4b, change 11; `src/lib/leagueStore.ts`)
- Every imported league is saved in the browser's IndexedDB (database `offersheet`): the import (the snapshot and the request summary, never credentials), "my team", the model inputs, every setting and the trade feedback, until the user removes the league or clears the site's data. Nothing of it is sent anywhere. Settings and feedback are filed under `leagueKey` (no season), as before; a saved league is that key plus its season.
- The pre-4c copies (sessionStorage `offersheet:import:v1`, `offersheet:model:v1`, the my-team keys; localStorage `offersheet:settings:v1`, `offersheet:feedback:v1`) move in once (per browser for settings and feedback, per tab for the tab's import, pick and model inputs), and stay untouched as a dormant copy that is never read again; removing a league or deleting feedback deletes them too.

**Cache**
- Build a `Cache` interface.
- For development, implement it with files in `.cache/` (git-ignored).
- A KV-store version can be added when we deploy. (Built at Checkpoint 7a: the shared cache below.)

**Built for public use**
- The engine runs in the browser, so trade searches cost the server nothing.
- Server routes only fetch and normalize data. In production they need:
  - a shared cache store (for example Upstash Redis's free tier)
  - per-IP rate limits
  - friendly "this data source is down" messages
- ESPN, Yahoo and private MFL requests must stay on the server, because they carry cookies or secrets.
- Built at Checkpoint 7a (planner reply to Checkpoint 4c, Part B; the details below and in `reports/beta-infrastructure.md`). Every server number of the beta lives in `src/server/limits.ts` (the engine's stay in `src/engine/config.ts`).

**The shared store** (Checkpoint 7a; `src/server/redis.ts`): one Upstash Redis database (free plan, through the Vercel Marketplace, region iad1) holds the server cache, the rate-limit counts, the request budgets, the error log and the anonymous feedback, and since Phase 7b the public-data archive (Sections 2.3 and 2.9) and the usage counters (below). It is used **on Vercel only** (`VERCEL` set; off Vercel no other variable switches it on), so KV_* values in `.env.local` never switch the local app, the stable copy, a script, tests or check:browser to Upstash. ⚠️ A VERCEL variable in `.env.local` (what `vercel env pull` writes; Section 19 forbids it, and `npm run check-env` warns) would make `npm run dev`, the stable copy and check:browser's `next start` act as a deployment, and use the store if the KV_* variables are there too. The scripts that read the store on purpose read with Upstash's read-only token, under names the app never reads (`READONLY_STORE_URL`, `READONLY_STORE_TOKEN`; `scripts/lib/storeReader.ts`, Section 16; Parker, 2026-10-07: "That way the token on my computer can't change anything, and local runs never touch the shared store."). Until then they opted into the app's own client with `OFFERSHEET_REDIS=1`, which is gone. Every key starts with `os:<VERCEL_ENV>:` (preview and production share the one free database). Identifying text (cache keys with league ids, usernames or credential fingerprints; a visitor's IP address) goes into a key only as an HMAC under a key derived from `SESSION_SECRET` (HKDF, one label per use), so a reader of the store can't test guesses. Without `SESSION_SECRET` (at least 32 characters) there is no client. ⚠️ Rotating `SESSION_SECRET` resets sessions, import tokens, cache keys and rate-limit buckets at once (accepted). A malformed address (for example the `rediss://` connection string, which carries the password) makes the SDK throw `UrlError`; every caller logs only that name and runs without the store.

**The shared cache** (Checkpoint 7a; `src/server/cache.ts`, `src/app/api/_lib/deps.ts` `selectServerCache`): on Vercel with Upstash, a per-instance memory tier (`MemoryLruCache`, 64 MB, least recently used first, swept every minute) in front of `RedisCache`; on Vercel without Upstash, the memory tier alone (a preview before the database is connected still works); anywhere else FileCache exactly as before (Section 2.10).
- `RedisCache` keeps the `Cache` contract: key `os:<env>:c:` + HMAC of the cache key; value = FileCache's envelope, gzipped, then encrypted with AES-256-GCM (a random IV per value, a second derived key, label `cache-enc/v2`, bound to the Redis key it's stored under as additional data, so a value copied to another key reads as a miss: final review SEC-5; ⚠️ the lead's addition, since the free plan has no encryption at rest and a private ESPN league's body names its members), written with `SET … PX` = the retention, so Upstash deletes it on time (a reader never deletes). An entry over 8 MB as stored isn't written.
- A slow or unreachable Upstash: each command waits at most 1 s (`SharedCacheBreaker`), the SDK retries once, and a failure pauses Upstash for this instance for 60 s (reads miss, writes are skipped, the memory tier serves), logged once. Measured: 12 of 12 requests answered in 1.5–2.4 s with Upstash unreachable (1 of 12 after 17 s before).
- Single-flight across instances for league-independent entries (`cache.public: true`): the first instance takes `SET … NX PX 20 s` and fetches; others poll the lock and read the holder's copy (age-bounded), waiting at most 8 s and never past their own deadline, then fetch anyway (`RedisCacheLock`). In-process single-flight stays.
- Shared reads (Phase 7b load test, finding 4; `TieredCache`): concurrent reads of one key share one Upstash read, which asks for the copy at any age; each caller applies its own maxAge and keeps the copy in memory only when it accepts it. A caller that joined a read sent before it began, and can't use its answer, reads once more (the review of the fixes: a lock waiter missed the holder's write and fetched again), so every read sees the writes that finished before it began. A cold burst then sends about one GET per entry (the load test's 50 cold League page builds: 1,173 shared-cache commands before, 69 after).
- Fetch-time reducers (`src/data/reduce.ts`): the big league-independent bodies keep only what our code reads (Sleeper weekly projections in a "model form" of real rows and an "import form" that keeps the stub rows the import reads for injured players' teams and tags; season projections; weekly stats; the 10 Sleeper player lists; the DynastyProcess CSV), proved deep-equal for every consumer (loaders, both archives, the import) on every cached body (`npm run measure:cache`). A reduced body is stored under a new key (`#<name>-r<version>-<fingerprint of the kept fields>`), so the stable copy (older code) never reads one; a reducer only reduces a body its consumers fully accept, else it caches the body as it came. FantasyCalc's lists and the ESPN NFL schedule aren't reduced (new keys would end their sharing with the stable copy). One projection week 193 → 32 KB gzip; a model build parses 40 → 6 MB and takes about 0.35–0.55 s of CPU (0.8–0.95 s before; it varies by run). ⚠️ Until the stable copy moves to a checkpoint with these reducers, the two copies fetch the reduced sources separately (up to twice a day).
- The outage memories (Sleeper, FantasyCalc, and since Phase 7b FantasyCalc's memory of answers its checks turned down) and the crosswalk memo stay per instance (⚠️).

**Server routes** (Checkpoint 7a; `src/app/api/_lib/route.ts`): every route is `withRoute(kind, handler)` with a literal `maxDuration` (`route.test.ts` scans every route.ts). In order: a cross-site request of any method is refused before it's counted (BAD_ORIGIN); a per-IP fixed window (import and model 30 per 10 minutes, session 20 per 10 minutes, feedback 60 an hour, and since Phase 7b health 12 and the cron 10 per 10 minutes; DELETE `/api/session/espn` is never limited; the visitor identified by an HMAC of `x-real-ip`, else the first `x-forwarded-for`, IPv6 by /64, never the address, and an IPv6 request counted against its /48 too, at 10 times the /64's limit (final review SEC-2: one person can hold a whole /48); `@upstash/ratelimit` on Vercel with Upstash, else per-process windows; a Redis failure falls back to the process's windows for 60 s; since Phase 7b, B4 security review, only import and model count in Upstash, `rateLimits.sharedKinds`: health, session, cron and feedback ask nothing of a platform and count in each instance's own windows, since a check in Upstash costs 2–3 commands and one address at those limits all day could have spent the free plan's commands for everyone); then the handler runs in a request scope (`src/server/deadline.ts`, AsyncLocalStorage) with its deadline (import 45 s, model 90 s, session, feedback and health 10 s, the snapshot cron 110 s; `maxDuration` 60, 120, 15, 15, 15, 120): the HTTP client never starts an attempt or a wait that would end past it, a request that joins another's fetch or the crosswalk's first build waits no longer than its own deadline, cache I/O ends at most 2 s past it. Over a limit: 429 RATE_LIMITED "You're going a bit fast. Try again in about N minutes."
- **Daily outbound budgets** (`src/server/budget.ts`; the server's own requests, retries included; the browser's reads don't count): ESPN 4,000, Sleeper 15,000, FantasyCalc 1,500 and GitHub 100 a UTC day, and per visitor's group (on Vercel; an IPv4 /24 or IPv6 /48) 400 ESPN and 1,500 Sleeper league requests a day. FantasyCalc's day (200 at Checkpoint 7a while a list was kept a day) is only a guard against a bug since Phase 7b: its own 3-hour rule binds first, and the day is sized to that rule's bound (the 144 formats a league can ask for, each refreshed every 3 hours, under the day's slices need 1,383), so nobody can spend it by asking for League pages in format after format and leave everyone's builds without values. The day comes in 12 slices of 2 hours (by the end of slice i at most (i + 1)/12 of the day spent, unused budget carried on, never less than a quarter), and 1,000 of ESPN's day are kept for requests that carry a visitor's ESPN cookies (private leagues have no browser path); since Phase 7b (B4 security review: anyone can paste made-up or throwaway cookies) each client takes at most 50 of that reserve a day (`budgets.reservedPerClientPerDay`), past it BUSY as for the day. Every counter is written with its expiry in one transaction (`RedisLike.incrExpire`). Phase 7b (load test, defect 1, and the review of its fix): an attempt is counted once it's next in line at its host (unless its deadline will cut the wait within a second, `budgets.countAheadMinMs`), so the count's round trips overlap the turn ahead instead of holding it; one that doesn't go out after all gets its count back, and a refused attempt counts nowhere (scenario 2 counted 82 ESPN attempts for 35 sent before; 34 for 34 after).
- **The daily work budget** (final review SEC-1, F1; `workLimits`; on Vercel only): Hobby pauses the whole project for up to 30 days once a month's Active CPU (4 h) or Fast Origin Transfer (10 GB) runs out, so every import and League page request costs units (about 100 ms of CPU or 75 KB of request body each: a browser-read Sleeper import about 3, an ESPN one about 10, a League page build from a signed import 4 plus its model work, a league the server reads itself 6 or 10), counted per UTC day against the visitor (IPv4 address or IPv6 /64, 500), its group (2,000) and the whole server (4,000, in slices like the budgets: about 400 CPU-seconds and 300 MB a day, under the 480 and 333 a month's allowance gives a day). Over: BUSY. A visitor this process already knows is over is refused before the rate limiter (no Redis command). ⚠️ The unit sizes were measured on an i9 desktop; Vercel's CPUs may be slower. Phase 7b (B4 security review): a gzip body also pays for its unpacked size, a unit per 500 KB unpacked past what its compressed bytes paid (`workLimits.unpackedUnitBytes`; charged as soon as it's unpacked, before anything reads it; over: BUSY, never BAD_UPLOAD), since repetitive JSON compresses without bound (a 17 KB body unpacked to 5.9 MB and took 0.7–0.9 s of CPU for its 3 units); real uploads pay nothing more. A refused charge costs no one anything (Phase 7b load test, defect 2, and the review of its fix): the client's own count comes first, alone, only a charge it allows goes on to its group's and the server's day, and a refusal gives every count it took back. Over a budget: a league import answers BUSY; league-independent data takes its usual saved-copy or warning path. The words (Phase 7b; planner reply to Checkpoint 7a, §2 question 7: "Never a broken page"): a refusal by the beta's shared capacity (the server's day of work or its slice, or a platform's server-wide day) reads "The beta is at capacity today. It resets at <time>.", a visitor's own share "Your connection has used today's share of requests to ESPN. It resets at <time>." (before: "Offer Sheet has used today's share of requests to ESPN. Try again in about N hours."); the answer carries Retry-After and `error.resetAt`, and the browser says the time in the visitor's own time zone (`src/lib/errors.ts` localizeResetTime: "It resets at 7:00 PM." or "… tomorrow.", the server's own "… UTC." otherwise). A request cut by its deadline or a budget is marked on its response (`HttpResponse.cut`), which the outage memories don't read as the source being down; an import whose league request failed after a cut answers SOURCE_SLOW (504) naming the slow source, or "Offer Sheet is busy right now." Each host's queue serves requests in the order their API requests arrived (measured under load: first-come order left most imports half done). ⚠️ Pacing is per instance; the budget is global.
- **The error log** (`src/server/log.ts`): `logEvent` takes a zod-strict allowlist (route, event, code, platform, status, error name, duration): one JSON line on the console (Vercel keeps 1 hour on Hobby) and, on Vercel with Upstash, one list per UTC day (newest 1,000, written in one transaction with its expiry, deleted 14 days after the day began). Never a URL, an id, a message, a cookie or an IP. No `console.error` in app code. `npm run beta:log -- --live` reads it (read-only: `READONLY_STORE_URL` and `READONLY_STORE_TOKEN` typed into `.env.local` by hand, Section 16). Since Phase 7b (B4 security review: a few addresses could push a day's real lines out of its 1,000) the lines a visitor can set off at will are throttled per instance: one "rate_limited" line per 10 minutes (the usage counters still count every refusal) and one line a minute of each repeating failure (`logLimits.refusalEveryMs`, `repeatEveryMs`).
- **League page builds at once** (Phase 7b load test, risk 3; `src/server/buildSlots.ts`, `limits.modelBuildLimits`): at most 8 per instance (50 cold builds on one instance held more than 1.27 GB live and ran out of memory at heap caps of 768–1,280 MB; a Hobby function has about 2 GB). The others wait in the order their requests arrived while more than 30 s of their 90 s deadline is left, then answer BUSY "Offer Sheet is busy right now. Try again in a minute." with Retry-After 60 (a moment's crowd, not a daily limit: no reset time, not counted as a refusal). A signed import the instance already built (the memo) needs no slot; the slot is held around the build only, not the league read.
- **The health route** (`/api/health`; planner reply to Checkpoint 7a, §1, the Upstash check; `src/app/api/health/handler.ts`): which store the instance runs on ("shared", "memory" or "file", and why it isn't shared, by name only: `storeReason`) and, with the shared store, a timed SET, GET and DEL of a random key under the deployment's prefix (each at most 2 s; a millisecond or two from iad1 says the database is in US East), with Vercel's environment and region; status "degraded" on Vercel when the store isn't shared or the check failed. An instance checks at most once every 5 minutes (`healthLimits.checkEveryMs`; B4: anyone may ask) and answers with that check and its age in between. Never an address, token, key, stored value or variable's content. Read on a protected preview through `vercel curl` (Section 16).
- **The snapshot cron** (`/api/cron/snapshot`; planner reply to Checkpoint 7a, §6.3; `vercel.json` `0 20 * * *`; `src/app/api/cron/snapshot`, `src/server/snapshots.ts`): what it saves is in Sections 2.3 and 2.9. Kind "cron" (10 per 10 minutes per IP, deadline 110 s, `maxDuration` 120, never charged to the work budget). A bare 401 (no body, nothing done or revealed) unless the request carries "Authorization: Bearer <CRON_SECRET>" with a `CRON_SECRET` of 32+ characters, compared in constant time through SHA-256 digests (Vercel sends it when the project has the variable); a missing secret is logged once. Then a lock (SET NX PX 10 minutes under a random token): an overlapping or duplicate delivery answers "locked" and does nothing, and every save is idempotent, so a missed run only leaves an older copy. No store: 503. One log line a run ("snapshot_run"). Off Vercel it writes the local archives (`next dev` with `CRON_SECRET` in its own environment: how it's tested locally).
- **Usage counters** (Phase 7b; planner reply to Checkpoint 7a, §2 question 7 and 5.4; `src/server/usage.ts`, read by `npm run usage:report -- --live`): per UTC day, one key per counter (`os:<env>:usage:<YYYY-MM-DD>:<name>`; `model_builds`: League page builds answered, FantasyCalc's "sessions"; `import_<espn|sleeper>_<browser|server>`: imports by platform and by who read the league; `refused_capacity`, `refused_visitor`, `refused_rate`: refusals by the beta's capacity, a visitor's own day and the rate limits; `work_units` charged; `outbound_<espn|sleeper|fantasycalc|github>`: the server's own requests that went out), with no identifiers at all, kept 400 days after the day's last count. On Vercel with Upstash only. Never written before an answer: a request's counts go in the after-response write with its log lines (one transaction, 2 commands a counter); refusals never cost a write of their own (they wait in the instance's memory for the next request that writes, or one at least 5 minutes after the last such write), so ⚠️ refusal counts are a floor.
- **B4's other fixes** (Phase 7b security review): `next.config.ts` turns the image optimizer off (`images: { unoptimized: true }`: no page uses next/image, and /_next/image ran outside withRoute's limits and work budget; ⚠️ Vercel's own optimizer still answers `/_next/image` and `/_vercel/image` for a local raster image (apple-icon.png, the only one tried), so a WAF rule denies both at launch, Section 19); `src/server/clientBundle.test.ts` walks every client entry ("use client" modules and Web Workers) and fails if one reaches server code (`src/server/*` but the plain numbers of `limits.ts`, `src/data/*`, `src/app/api/*`) or a server-only package (so the DynastyProcess map stays server-side); a browser-read upload whose platform failure only it reports answers BAD_UPLOAD (the server asked the platform nothing, so it isn't an outage it saw, and a forged upload can't make ESPN look down in the log); the Analyzer's link back to the Finder isn't prefetched (its address can carry a team id); and `.gitattributes` keeps `fixtures/**` and `src/app/icon.svg` byte-exact (`-text`) on a fresh Windows checkout (with core.autocrlf, 5 tests failed on CRLF copies).

**Browser reads** (Checkpoint 7a; `src/lib/browserHttp.ts`, `leagueFetch.ts`, `leagueRead.ts`; `src/adapters/upload.ts`; `src/app/api/_lib/upload.ts`): public ESPN leagues (when no ESPN cookies are connected) and Sleeper leagues are read by the visitor's browser, so each visitor's requests count against their own IP. The ESPN and Sleeper fetchers are split into a browser-safe league-data half (`src/adapters/{espn,sleeper}/leagueData.ts`) and a server-only public half; the browser runs the league-data half through a recording client (credentials "omit", no cookie ever, one request at a time per host: ESPN 250 ms apart, Sleeper 60 ms; 2 retries; 20 s timeout), keeps each body in its schema-kept form (zod runs jitless in the browser: no unsafe-eval in the CSP), pseudonymizes ESPN SWIDs with a pure-JS SHA-256 (the server's own pseudonyms), gzips the parts and POSTs them (`application/gzip`) to the same import route. The server re-checks everything (same origin; at most 2 MB compressed and 6 MB unpacked; strict zod: the platform's own URLs only, league-data reads only, each at most once, at most 120 parts, each at most 10 minutes old; caps on every list, the nesting depth and the scoring rules before the replay, and on the model's work after it, `modelWork` 60,000: BAD_UPLOAD), pseudonymizes SWIDs again, replays the parts through the same league-data half with its own cached public data (the NFL schedule, Sleeper's projections and, unless the browser's copy names the season being played, Sleeper's NFL state) and normalizes with the server's crosswalk (the GPL-3.0 DynastyProcess map stays server-side). The result is identical to the server's own read (proved on fixtures and Parker's full-size Phase 0 capture, `npm run measure:upload`). **Browser-supplied data is never written to the shared cache.** Measured: an ESPN upload 515 KB gzip (Parker's full-size capture; 12 requests), a Sleeper one 13 KB. The browser path's code (about 100 KB gzip) loads on demand, 1 s after the Connect page opens. Fallbacks to the server path (today's JSON request): a CORS failure, a network error or timeout, any part that got no answer at all (the read stops at the first one: `untilNoAnswer`), a chunk that fails to load, a browser that can't gzip (no CompressionStream; the League page too), an upload over the cap, or a BAD_UPLOAD, INVALID_REQUEST or INTERNAL answer. ESPN's 401, 403 or login page shows the private-league guidance when no cookies are connected (else the server is asked). Sleeper by username: the browser reads the username's leagues and offers them itself (the list is never uploaded; the username goes up only to find the user's team). ESPN's CORS answer was verified for https://offersheet.vercel.app and http://127.0.0.1:3000 (Checkpoint 7a: the origin echoed, credentials allowed, `x-fantasy-filter` preflight, max-age 600); ⚠️ undocumented by ESPN, so it can change.
- **Signed imports** (`src/server/importToken.ts`): every import the server answers carries an HMAC-SHA256 token over the canonical JSON of {snapshot, modelPart} (ESPN's league-scored projections; nothing for Sleeper), key derived from `SESSION_SECRET`, valid 15 minutes (at most 60 s in the future). The League page sends the saved import back (gzip) while its league data is under 10 minutes old (measured on one clock: `importDataAgeMs`), and the model route builds the inputs without reading any league data; otherwise it reads the league again first (in the browser where it can). Refresh always reads again, at most once a minute. No token or a bad one: the model route re-imports on the server, as before. A signed ESPN import is about 23 KB gzip (cap: 1 MB compressed, 4 MB unpacked). A build from a signed import needs no player-ID crosswalk (static NFL team codes), and each answer is kept in the instance's memory (`src/app/api/model/memo.ts`, never Redis, at most 24 MB) under the signed content's digest until its token expires, so a replay costs a lookup, not a build (final review SEC-1, F3).
- Sleeper projection and stat requests use one of two fixed position groups (offense, or offense plus DL/LB/DB), stats only through the latest NFL week whose games have begun, and a past season is idle, so a forged league can't make the server fetch arbitrary public resources.

**Folder layout**

```
src/
  adapters/{espn,sleeper,yahoo,fleaflicker,mfl,fantrax,manual}/  # fetch + normalize → LeagueSnapshot (+ scoringMap.ts each)
  data/       # FantasyCalc, ID crosswalk, NFL schedule, projection loaders
  engine/     # pure math: scoring, projections, lineup, needs, sim, market, acceptance, search, rank, explain, config.ts
  workers/    # Web Worker wrapping the engine
  app/        # Next.js pages + route handlers
  components/
scripts/      # probe-*.ts, backtests, calibration
fixtures/raw/ (git-ignored)   fixtures/sanitized/   fixtures/sanitized/min/ (minimized strangers' fixtures)
data-local/   # git-ignored: strangers' full fixtures and crawl data
reports/      # STATUS.md, checkpoint-N.md, data-access.md
```

---

## 4. Normalized data model

```ts
type Platform = 'espn'|'sleeper'|'yahoo'|'fleaflicker'|'mfl'|'fantrax'|'manual';
type Pos = 'QB'|'RB'|'WR'|'TE'|'K'|'P'|'DEF'|'DL'|'LB'|'DB';

interface LeagueSnapshot {
  platform: Platform; leagueId: string; season: number; name: string;
  fetchedAt: string;                 // ISO timestamp
  currentWeek: number;               // NFL week
  leagueWeek?: number;               // the platform's own league week when it can lag the NFL week (Sleeper settings.leg)
  settings: LeagueSettings;
  teams: Team[];
  myTeamId: string | null;
  players: Record<string, PlayerInfo>; // key = canonical id: Sleeper id when known, else `${platform}:${id}`
  schedule: Matchup[];               // all fantasy matchups, past and future
  transactions: Transaction[];       // this season
  freeAgents: string[];              // canonical ids: top 50 per position by projection, ranked by the mean over the next 3 weeks (`freeAgentRankWeeks`) so a bye doesn't hide one (derive as player DB minus rostered when needed)
  freeAgentStatus?: Record<string, FreeAgentStatus>; // each kept free agent's waiver status when the platform reports it (Phase 7b: ESPN only, Section 2.2; absent elsewhere and in older imports)
  draftPicks?: DraftPick[];          // where the platform supports traded picks
  warnings: ImportWarning[];         // anything we couldn't map, with platform field paths
}

interface LeagueSettings {
  numTeams: number;
  leagueType: 'redraft'|'keeper'|'dynasty';
  lineup: SlotDef[];                 // starting slots only
  benchSlots: number; irSlots: number; taxiSlots: number;
  irEligible?: PlayerInfo['injury'][]; // statuses an IR slot takes, when known (Phase 4b; absent = IR and PUP)
  waiverOrderUsed?: 'weeklyReset'|'live'|'faab'; // which order Team.waiverRank holds (Phase 4c, Sections 2.2, 2.3, 7)
  maxRosterSize: number;             // active roster, excluding IR/taxi
  positionLimits?: Partial<Record<Pos, number>>;            // max per position on the active roster (IR exempt)
  starterLimits?: Partial<Record<Pos, { min: number; max: number }>>; // per-position starter min–max (MFL); the lineup solver honors it
  rosterMinimums?: Partial<Record<Pos, number>>;            // enforced roster minimums (trade legality)
  bestBall?: boolean;                // the platform sets lineups automatically (Import Report note)
  scoring: Scoring;
  regularSeasonWeeks: number[];      // NFL weeks in the fantasy regular season
  playoffWeeks: number[];            // NFL weeks of fantasy playoffs, in order
  playoffTeams: number; playoffByes?: number;
  playoffRoundWeeks?: number[];      // weeks per round when rounds last more than one week
  medianGame: boolean;               // extra W/L vs the league median each week
  pointsOnly: boolean;               // no head-to-head
  divisions?: { id: string; teamIds: string[] }[];
  playoffSeeding?: { reseed: boolean; divisionWinnersFirst: boolean }; // when the platform reports it (Section 8)
  seedingTiebreaker?: 'pointsFor'|'headToHead'|'divisionRecord';   // the standings tiebreaker after win % (Section 8); absent = unknown (points for assumed)
  tradeDeadline: { week?: number; date?: string } | null;
  tradeReview: 'none'|'commissioner'|'league_vote';
  tradeReviewHours?: number;         // how long an accepted trade waits for review, in hours, when reported (Phase 7b: ESPN revisionHours; Sleeper trade_review_days × 24 with the veto vote, 0 without it; Sections 2.2, 2.3); absent = unknown
  faabBudget?: number;
  unknownSettings?: ('tradeDeadline'|'tradeReview'|'playoffs'|'playoffSeeding'|'seedingTiebreaker')[]; // not exposed or unreadable: the Import Report says "unknown"
}

interface SlotDef { slot: string; count: number; eligible: Pos[] } // e.g. { slot: 'FLEX', count: 1, eligible: ['RB','WR','TE'] }

interface Scoring {
  perStat: Record<string, number>;                              // per-unit: canonical (Sleeper) stat key → points per unit
  byPosition?: Partial<Record<Pos, Record<string, number>>>;    // per-position REPLACEMENT rate for a key (e.g. ESPN pointsOverrides: TE rec = 1.5)
  rules: ScoringRule[];                                         // everything that isn't a plain per-unit rate (Section 5)
  unmapped: { platformKey: string; label: string; points: number; scoredThisSeason?: boolean }[]; // shown in the Import Report; scoredThisSeason (Phase 7b, ESPN): its stat scored this season in this league (absent = unknown), so a rule that scored, or a common one, is a notice and a rare one a quiet line (Section 14)
}

type StatExpr = string | { sum: string[] };                     // one canonical key, or a composite stat such as pass_yd + rush_yd
type ScoringRule = { positions?: Pos[] } & (
  | { kind: 'threshold'; stat: StatExpr; min: number; points: number }            // stat ≥ min → points, e.g. 100+ rush yds
  | { kind: 'range'; stat: StatExpr; min?: number; max?: number; points: number } // bucket min ≤ stat ≤ max → points, e.g. D/ST points allowed 14–17
  | { kind: 'stepped'; stat: StatExpr; every: number; points: number; min?: number; max?: number } // points for every N units, counted within [min, max]
  | { kind: 'perUnit'; stat: StatExpr; points: number; min?: number; max?: number } // per-unit rate on a composite stat, or only within bounds
  | { kind: 'perGame'; points: number }                                            // constant per game played
);

interface Team {
  id: string; name: string; ownerName: string;
  roster: string[]; ir: string[]; taxi: string[];
  record: { w: number; l: number; t: number };
  pointsFor: number; pointsAgainst: number; divisionId?: string;
  waiverRank?: number;               // 1 = first claim: the order the free-agent allocation uses (Phase 4b, Section 7); the weekly reset order where the league resets weekly (Phase 4c)
  liveWaiverRank?: number;           // the platform's live rank in a weekly-reset league (Phase 4c)
  faabRemaining?: number;            // FAAB leagues: budget left, when the platform reports it
}

interface PlayerInfo {
  id: string; name: string; pos: Pos; eligible: Pos[]; nflTeam: string | null;
  injury: 'ACTIVE'|'PROBABLE'|'QUESTIONABLE'|'DOUBTFUL'|'OUT'|'IR'|'PUP'|'SUSPENDED'|'NA'; // NA = not an active NFL player (Sleeper's NA; retired or unsigned)
  injuryReturnWeek?: number; age?: number;   // injuryReturnWeek = last NFL week + 1: not back this season
  ids: Partial<Record<Platform | 'fantasycalc' | 'gsis' | 'sportradar', string>>;
}

interface Matchup {
  week: number; teamA: string; teamB: string | null; isPlayoff: boolean;
  weeks?: number[];                  // NFL weeks the matchup spans when more than one (ESPN multi-week periods)
  decided?: boolean;                 // the platform has decided it (Phase 3); its score can still be unreadable
  result?: { pointsA: number; pointsB: number | null; winnerId: string | null }; // the final score; winnerId null = a tie (or a bye)
}
interface Transaction {
  id: string; type: 'trade'|'add'|'drop'|'waiver'; week: number; timestamp: string;
  teams: string[]; moves: { playerId: string; from: string | null; to: string | null; pos?: Pos }[]; picks?: DraftPick[];
  refilled?: true;                  // ESPN: a trade rebuilt from roster acquisitions (Section 2.2); pos = the player's position at the move (streaming detection)
}
interface DraftPick { season: number; round: number; originalTeamId: string; ownerTeamId: string }
interface ImportWarning {
  code: string; message: string; platformPath?: string;
  players?: string[];                // Phase 7b: the canonical ids a player-level warning is about (ESPN_PLAYER_MATCHED_BY_NAME, ESPN_ID_CONFLICT, ESPN_ID_COLLISION), so the notices can tell whose roster each is on
  teams?: string[];                  // Phase 7b: the teams a warning's players without a canonical id were on (ESPN_POSITION_UNKNOWN)
}
type FreeAgentStatus = { kind: 'waivers'; until?: string } | { kind: 'freeAgent' }; // until: when the platform runs the claims (ISO)

// Outside the snapshot:
type WeeklyProjection = Record<string /*playerId*/, Record<number /*week*/, number /*points*/>>;
type MarketValues = Record<string /*playerId*/, { value: number; source: 'fantasycalc'|'estimate'|'floor' }>;
```

---

## 5. Scoring engine

**Canonical stat keys**
- Use **Sleeper's stat keys** as the canonical keys, because projections arrive in those keys.

**Per-platform mapping tables** (`src/adapters/*/scoringMap.ts`)
- ESPN statId → key
- Yahoo stat_id → key (use the names in `stat_categories`)
- Fleaflicker rule → key
- MFL rule code → key
- Anything that doesn't map goes into `scoring.unmapped` and appears in the Import Report with its point value. Never drop a rule silently.

**Points formula**
- points = Σ rate(k, pos) × stat[k], plus Σ `rules` (Section 4).
  - rate(k, pos) = `byPosition[pos][k]` if it exists, otherwise `perStat[k]`.
  - `byPosition` *replaces* the rate for that position. This is how ESPN's `pointsOverrides` work (keyed by `defaultPositionId`; verified in Phase 0).
  - Sleeper's position bonus keys, such as `bonus_rec_te`, stay ordinary `perStat` keys, because Sleeper's projections carry them as stats of their own. Projections lack `bonus_fd_*`, so those are filled in from `pass_fd + rush_fd + rec_fd` for QB/RB/WR/TE (never fullbacks, whom Sleeper doesn't give the bonus).
  - Rule kinds: per-unit (optionally on a composite stat or within bounds), threshold bonus, range bucket (bounded min–max, such as D/ST points allowed 14–17), stepped tier (points for every N units), composite stats (a sum of keys) and per-game constants. A rule with `positions` applies only to players at those positions.
- Projections are averages, not game logs, so evaluate threshold, range and stepped rules as **expected values** over a distribution around the projected stat (Checkpoint 1 answer; all of it in config, Section 15):
  - **Count stats** (TDs, receptions, interceptions, sacks, FGs made, 2-point conversions, fumbles): a **Poisson** distribution with mean = the projected value, with P(X ≥ k) computed exactly. A "2+ TD" bonus then gets its true expected value. Every stat that isn't yardage or a fixed-SD normal counts as a count, on its own grid (half sacks: 0.5 × Poisson(2 × mean)).
  - **Yardage stats:** a normal distribution with the **empirical SDs** from the stat-SD script (`npm run measure:stat-sd`), measured on every completed week so far rather than one week, floored at 0. Phase 2 fit SD = a + b × projected mean on weeks 1–3: pass_yd 0 + 0.341, rush_yd 3.9 + 0.48, rec_yd 8.8 + 0.50, kr_yd 20.2 + 0.56, pr_yd 3.7 + 1.45 (⚠️ Sleeper re-stamps past weeks' projections after the games, so these may understate forecast error until Phase 6 refits them on the archived pre-game snapshots, Section 2.3).
  - **Completion %:** a normal distribution with SD 10.
  - D/ST points allowed: a normal distribution with SD 9 (measured 9.7 on weeks 1–3); D/ST yards allowed: SD 77 (⚠️ measured on weeks 1–3). Any other continuous stat (none mapped today) uses SD = `config.bonusCv` × mean (default 0.5).
  - A floored normal is placed so its floored mean equals the projection (flooring a normal at the projection would inflate small means).
  - ⚠️ Volume counts are overdispersed relative to Poisson on weeks 1–3 (rush attempts 2.0, completions 1.9, receptions 1.3; TDs fit Poisson). Phase 6 moves rush attempts, completions and receptions to a negative binomial with the measured dispersion; TDs stay Poisson (Checkpoint 2 answer 3).
  - For normal distributions, bounds sit halfway between a stat's possible values (`config.statGrid`: counts 1, IDP sacks 0.5, ratios such as completion % continuous), and a stat's floor (`config.statFloor`: points allowed ≥ 0) puts the mass below it in the lowest bucket. A rule whose stat the projection doesn't carry scores 0.
  - Per-game constants count once per projected game. On actual stat lines they need games played (`gp`): a line without it is a game not played.

**Scoring oracle tests (required)**

This is how we prove we understood the league's scoring.
- Some platforms report both raw stats and league-scored points for completed weeks:
  - ESPN: `stats` plus `appliedTotal` with statSourceId 0
  - Sleeper: matchups `players_points`, compared with actual stats from Sleeper's stats endpoint. If that endpoint doesn't work, use nflverse weekly player stats mapped to canonical keys, and report which scoring keys that source can't cover.
- For those platforms, recompute points for every rostered player for the last 2 completed weeks.
- Target: at least 99% of players within 0.05 points of the platform's number.
- Report every mismatch along with its stat line.
- The oracle tests must cover **every rule type**: per-unit, `byPosition` replacement, threshold, range, stepped, bounded, composite and per-game.

---

## 6. Projection model

This covers every relevant player *i* (everyone rostered, plus the top 50 free agents at each position) and every remaining NFL week *w*, from the current week through the last fantasy playoff week.

**1. Base rate b_i** (points per game in this league's scoring)

- `proj_now_i` = the player's most recent **healthy** projection: the latest week a source projected him while active. Fall back to his season projection per game. Never use an injury-zeroed projection as a base rate. That would make an injured star look worthless for the rest of the season, which is exactly the buy-low case we want to find.
  - **ESPN leagues:** average ESPN's league-scored `appliedTotal` (statSourceId 1, statSplitTypeId 1) with Sleeper's stat projection × league scoring, but only if the two agree within 10% on average across the league's rostered players. Otherwise use Sleeper × league scoring and say so in the Import Report.
  - **MFL leagues:** Sleeper × league scoring is the primary source (the scoring engine matched MFL 604/604 in Phase 0). Log MFL's own `projectedScores` only as a sanity check; they ran about 19% lower in Phase 0.
  - **All others:** Sleeper stat projection × league scoring.
  - Log any player whose two sources disagree by more than 40%.
  - Phase 2 details: proj_now is the latest week at or before the current week with a Sleeper projection (the model fetches 3 weeks back), else his nearest later projected week; ESPN's value for that same week is averaged in. "Agree within 10% on average" is measured as Σ|E − S| / Σ S over rostered players both sources project this week, a ratio of sums so bench players with tiny projections don't dominate.
- `actual_ppg_i` = season-to-date points per game played, in league scoring. `g_i` = games played.
- `b_i = (1 − α_i)·(proj_now_i / m_{i,now}) + α_i·actual_ppg_i`, where `α_i = config.actualWeight × min(1, g_i / config.actualFullGames)`.
  - `m_{i,now}` is the week-shape factor (step 2) for the week that `proj_now_i` came from. Dividing by it takes that week's matchup out of the base rate, so the matchup isn't counted twice.
  - Defaults: `actualWeight` = 0.25, `actualFullGames` = 6.

**2. Week shape m_{i,w}**

- `m = clamp(S_{i,w} / mean_{w'} S_{i,w'}, 0.8, 1.2)`, where `S` is Sleeper's projection for that future week, taken over the weeks he's projected healthy. This captures opponent strength.
- Use 1 when data is missing, and in weeks where a source zeroes the player for injury.

**3. Availability a_{i,w}**

Keep *how good he is when he plays* (b and m) apart from *whether he plays* (a), so nothing is counted twice.
- 0 on bye weeks. Byes come only from the NFL schedule; an empty ESPN projection entry doesn't mean a bye.
- Map ESPN `DAY_TO_DAY` to QUESTIONABLE. ESPN `PROBABLE` keeps its own status.
- Injuries come only from `config.injury`, applied once:
  - **OUT:** 0 this week, 0.5 next week, 0.85 the week after, then 1
  - **DOUBTFUL:** 0.25 this week, then 1
  - **QUESTIONABLE:** 0.85 this week, then 1
  - **PROBABLE:** 0.95 this week, then 1
  - **IR or PUP:** 0 until `injuryReturnWeek` if known. Otherwise 0 for 4 weeks, then 0.8, then 1.
  - **SUSPENDED:** 0 for the known suspension length. Otherwise 0 for 2 weeks.
  - **NA** (not an active NFL player: Sleeper's NA, or retired/unsigned): 0 every week.
  - Platforms rarely give a return week or suspension length. When they don't, use the defaults above. Don't scrape news for them.
  - Phase 2 details: the tables are read as the cumulative chance he's back. A known return week R (ESPN's expected return date) spreads 25% / 50% / 25% over R − 1, R and R + 1 (the split is an assumption), never earlier than his status allows (OUT, IR, PUP and SUSPENDED miss this week); a suspension's return week is exact. IR and PUP use any known R; OUT uses R only when it's next week or later (a date this week or earlier gets the OUT table); QUESTIONABLE, DOUBTFUL and PROBABLE use R only when it's 2+ weeks away (the conflict below): a date this week or next is ignored, and the tag's one-week table applies. ESPN's "out for season" (last NFL week + 1) means 0 every remaining week.
  - **Conflicting ESPN signals** (Checkpoint 2 answer 6): a QUESTIONABLE, DOUBTFUL or PROBABLE player whose ESPN return date is 2+ weeks away gets Sleeper as the tiebreaker, since the tag and the date disagree.
    - If Sleeper still projects him this week, at 50% or more of his healthy base rate (`config.staleReturnShare`): the return date is stale. The one-week table for his tag applies this week, then he's healthy. The healthy base rate is step 1's base rate as if neither source had projected him this week: his latest healthy week before this one, else his nearest later healthy week, else ESPN's, the season line or points per game (Phase 3 review: the season line ÷ 17 alone counts the games he's projected to miss).
    - If Sleeper's projections for this week didn't load at all, there's nothing to break the tie: he follows the return date, and the note says the projections were missing.
    - Otherwise: follow the return date.
    - Either way the player shows the conflict as a note, for example "ESPN: questionable, return week 8 — using Sleeper's projection". Josh Jacobs is the test case: Sleeper doesn't project him in week 4, so he follows the return date.
  - **Q/D/P base rate** (Checkpoint 3 answer 5): for a QUESTIONABLE, DOUBTFUL or PROBABLE player, this week's projections (Sleeper's and ESPN's) are injury-cut, so they are ignored when computing his base rate b (step 1 as if neither source had projected him this week: the healthy base rate above), and this week's week shape is 1. His availability comes from the injury table only, applied once. Before this, a cut projection lowered b for the rest of the season and, in the stale-date case, counted the injury twice (Sleeper's cut × the tag's table).
    - Phase 4 (review of track A1): for these players proj_now is his nearest *later* healthy week first, then his latest earlier one. Next week's projection is past the one-week tag and carries his current role, so a backup promoted to starter this week who also carries a tag keeps his new role (taking the earlier week first cut one such player's ROS by 62%). The stale-date tiebreaker still compares with the healthy base rate above.
  - A player whose game this week has already kicked off counts 0 for this week: rest-of-season numbers count remaining games only. A player without an NFL team never plays.
  - **Expected return week** (Phase 4b, for IR players in Section 7): the first remaining week whose chance he's back (his return-week distribution above, before future injury risk) reaches `config.projections.returnWeekQuantile` (0.5). So an IR player with ESPN's date R comes back at R; without a date, 4 weeks from now; an OUT player next week; a healthy player sitting in an IR slot now; a player out for the season, NA or without an NFL team never.
- **Future injury risk** (new injuries to players who are healthy now; Checkpoint 1 addition). One two-state weekly model (healthy / out) serves both the expected values here and the availability scenarios in Section 7:
  - Recovery rate `r = 1 / d`, where d is the mean length of an injury. Default d = 2.5 weeks.
  - Weekly new-injury chance `h_pos = M_pos · r / (1 − M_pos)`, where `M_pos` is the long-run share of games missed.
  - A player healthy now is out k weeks ahead with probability `P_out(k) = M_pos × (1 − (1 − h − r)^k)`. Multiply it in: `a_{i,w} ×= 1 − P_out(k)`.
  - A player injured now starts the same model from his expected return week (ESPN gives it).
  - Default `M_pos`: QB 0.06, RB 0.14, WR 0.12, TE 0.14, K 0.02, DEF 0, IDP 0.10. Sources disagree on how much positions differ: FantasySquawk (2015–2025, top-150 ADP) found games missed per season of RB 2.8, WR 2.0, TE 2.8 and QB 1.0; Fantasy Index (top 20 per position, last 5 years) found every position played about 84–85% of games.

**4. Projected points**

- `p_{i,w} = b_i × m_{i,w} × a_{i,w}`

**5. Weekly standard deviation**

- `σ_{i,w} = c_pos × p_{i,w} + d_pos`
- Defaults (c/d): QB 0.30/3, RB 0.45/2, WR 0.50/2, TE 0.55/1.5, K 0.35/2.5, DEF 0.50/3, IDP 0.50/2.
- σ = 0 in a week he doesn't play (p = 0: a bye, a game already started, or no availability).

**6. Tuning**

- Phase 6 backtests these defaults on 2025 data (nflverse weekly stats) and tunes α and σ.
- Phase 6 also estimates `M_pos` and d from nflverse weekly data (2018–2025) for fantasy-relevant players, and replaces the defaults.

**7. Rest-of-season (ROS) points, shown to users** (Checkpoint 1 addition)

- `ROS_i = Σ_w p_{i,w}` over the remaining weeks, from the current week through the last fantasy playoff week, with expected availability (step 3, including future injury risk).
- Show it split into regular-season and playoff weeks, with games left and bye status (for example "bye done" or "bye wk 9"). Only remaining weeks count, so a player whose bye already passed automatically gets credit for one more game.
- Show ROS points on:
  - the League page roster tables, where tapping or hovering shows the week-by-week breakdown
  - trade cards, for example "You get 142 ROS pts, give 118"

**8. Market-blended projections** (Phase 4b; planner reply to Checkpoint 4, change 1; `src/engine/blend.ts`)

- **Why:** the trade search ranks thousands of trades by our own model's edge, so the top of its list fills with the places our projections disagree most with the market, and those are disproportionately where our projections are wrong (the optimizer's curse). At Checkpoint 4 the top ideas mostly sold Garrett Wilson and bought injury-tagged players. So projections are shrunk toward the market; κ can't fix it.
- **Who:** QB, RB, WR and TE players (`config.marketBlend.positions`, by their own position) with a real FantasyCalc value (never an estimate) in this season's list: redraft leagues the league's list, keeper leagues the redraft list, dynasty leagues FantasyCalc's redraft list in the league's own format (the planner: "dynasty leagues use redraftValue here too, since B_win is about this season"; ⚠️ read as the redraft list's own `value` in the league's format, since FantasyCalc's `redraftValue` field is its 12-team PPR baseline, which Section 2.9 never uses). Everyone else keeps his projection. No list, no blend: when FantasyCalc loaded without this season's list (a dynasty or keeper league's redraft list missing) the League page says the blend is off; when FantasyCalc is down, a saved list up to 7 days old still blends (Phase 4c, Section 2.9), an older one leaves the blend off with the League model's warning ("The trade-market blend is off: FantasyCalc didn't answer and its newest values are too old, …"), and with none FantasyCalc's own warning says so.
- **The planner's formula:** ROS′ = (1 − w) × ROS + w × R_pos(v), w = `config.marketBlend.weight` = 0.5, R_pos a monotone increasing curve of our ROS on market value per position, and each weekly p scaled by ROS′ / ROS, so byes, availability and week shape stay intact; ROS 0 stays 0.
- **As built** (⚠️ reported at Checkpoint 4b; kept by the planner, Checkpoint 4b answer 1, below): the same formula **per game played**. b′ = (1 − w) × b + w × R_pos(v), where b is his base rate (step 1) and R_pos is the isotonic (pool adjacent violators) fit of the base rates of the position's healthy players (no injury tag, a game left, b > 0; rostered and modeled free agents alike) on value. His factor f = b′ / b (clamped to [0.75, 1.35] since Phase 4c, below) scales b, every weekly p, each week's σ (recomputed, step 5) and his ROS, so ROS′ = (1 − w) × ROS + w × (his ROS at the market's rate). Why not totals: a total mixes in how many games he plays, which his value prices only roughly. On totals an OUT or IR player whose value holds up got the whole season's gap squeezed into the few games he plays (up to ×1.58 on Parker's data; a test IR receiver back in week 16 went from 16 to 37 points a game), injured players' small totals pulled the curve down for the healthy players valued like them, a player whose bye is done looked a game better than an equal one whose bye is ahead, and a build after the week's first kickoff blended differently from one before it. Per game, byes, availability and the week shape stay entirely ours, and the factors don't depend on the moment. ⚠️ The price: an injured player's full-strength b is compared with what healthy players valued like him score, while his value is also discounted for the games he misses, so part of that discount counts twice (A.J. Brown, on IR until week 8: f 0.930), erring the way the planner asked ("the market's injury discount is part of the projection").
- **The curve:** each curve point reads the curve fitted without him (leave-one-out). Fitted with him, every player in the same order as the trend sat on the curve himself and got f = 1 however far he was from it (Garrett Wilson 1.000), so the blend corrected only rank inversions. ⚠️ The two players at the ends of a position's value range read the curve with their own point in it (fitted without them, it would have to extrapolate: Josh Allen, valued 2.7 times the next healthy QB, came out at f 0.885); beyond the curve's ends it reads flat. Injured and tagged players are read off the curve but don't shape it. A position with fewer than `minPlayers` (10) curve points gets no blend.
- **Where it applies:** once per build, before the projection table, so everything reads blended points: ROS shown to users (step 7), free agents, needs, trade chips, V*, both lineups of every trade, the season simulation, the estimate curve for unvalued players and the waiver credit W. A rebuild before the week's first kickoff uses the same factors.
- **Shown** in the League page's player breakdown and his ROS hover, in words only since Phase 7b (planner reply to Checkpoint 7a, 5.4: no number of the market's, Section 2.9): "His projection leans up toward the trade market's view." (or down), "…, by the most it can: 35%." for a capped factor, and "The trade market barely moves his projection." when his printed ROS doesn't move (and for a player at either end of his position's value range, whose market number is his own), with how the lean works under it (visible, not a hover: phones). Phases 4b to 7a printed "Our projection 210 · Trade market 170 · Used 190" ("Trade market" = his ROS at the market's points per game), which gave away FantasyCalc's order and a price for each player; even "Our projection" alone would give the market's number back (2 × Used − ours), so the line names the direction only.
- Parker's league (Checkpoint 4b's 2026-10-04 data, before Phase 4c's clamp below): 193 players blended; f from 0.84 to 1.60 (median 1.00); the largest are an IR player and backups the market values on upside (Jordyn Tyson, on IR, 1.60; Marvin Harrison Jr. 1.37), the smallest players we rate above the market (Emanuel Wilson 0.84, Zay Flowers 0.86); Garrett Wilson 1.02, so the market agrees with us on him (Checkpoint 4b).
- **Per game stays** (planner reply to Checkpoint 4b, answer 1): the partial double count on injured players is a mild, conservative bias accepted on purpose (the market also prices re-injury risk and rust, and erring against injured players is the safe side of the optimizer's curse).
- **The factor is capped** (Phase 4c, change 4): f is clamped to `config.marketBlend.factorClamp` [0.75, 1.35] after the blend, since extreme factors are where data glitches and market hype concentrate; `PlayerBlend.clamped` marks a capped player ("market" stays the market's number, "used" = ours × the bound), and the League page's breakdown says so (in words since Phase 7b, above). `blend.blendRecords` lists every factor before the clamp with what explains it (base-rate source and fallback, games played, injury, age, how the curve was read) for the reports. Parker's league (2026-10-04 data): 193 players blended; f before the clamp from 0.842 to 1.595 (median 1.00); the clamp cut 2, both at the top: Jordyn Tyson (on IR, no game yet, 1.595 → 1.35) and Marvin Harrison Jr. (1.372 → 1.35); none reached 0.75 (the lowest, Emanuel Wilson, 0.842). 8 of the 10 most extreme carry no data flag (healthy, both projections averaged, 3 games played), so they are real disagreements with the market, not data glitches (Checkpoint 4c).

---

## 7. Lineups, team strength and needs

**Weekly lineup value**
- `LV(T, w)` = the highest total `p_{i,w}` over all legal assignments of team T's active roster (not taxi; IR players from their return, Phase 4b below) to the starting slots, honoring per-position starter min–max (`starterLimits`) when the league has them.
- Use an **exact** solver: max-weight bipartite matching, either Hungarian or min-cost flow (with bounds when `starterLimits` apply).
- A fast greedy method may be used **for screening only**, and only when the slot eligibility sets are nested (for example standard slots plus FLEX plus SUPER_FLEX). Greedy fills the most restrictive slots first.
- Property-test both solvers against brute force on random rosters.
- Phase 2: one exact solver serves both screening and exact evaluation, so there is no separate greedy. Points sit on players, so the players who can start together form a matroid, and taking players best first while re-seating starters along augmenting paths is exact; a min-cost-flow fallback handles mixed eligibility under starter limits. It is property-tested against brute force (2,440 cases) and runs about 1.5 million lineups a second. Starter limits count starters by primary position; the best `min` players at a limited position start even at 0 points; an unmet minimum is best effort.

**Availability scenarios: credit for depth** (Checkpoint 1 addition)
- Expected-value lineups undervalue depth. A bench RB never starts in the average-case lineup, but in real life he plays when a starter is hurt or on bye. Without this, the trade search overrates 2-for-1 consolidation trades that strip a team's depth.
- For exact evaluation (Section 12 step 3) and the season sim, `LV(T, w)` is the average over S availability scenarios. Default S = 32, with common random numbers.
- Draw each scenario from the Section 6 availability model:
  - injuries persist across weeks
  - currently injured players return around their expected week, give or take a week
  - byes come from the NFL schedule
- Solve the optimal lineup for each scenario.
- Screening (Section 12 step 2) may keep the fast expected-value lineup.
- Phase 2: scenario s of player i draws from a random stream keyed by (seed, player id, s), so his scenarios stay the same when he changes teams. Only active-roster players and free agents get scenarios; IR and taxi players never start. (Phase 4b: IR players get scenarios too, drawn from the same per-player streams, so nobody else's draws change; taxi players still never start.)

**Rest of season**
- `ROS(T) = Σ_w ω_w × LV(T, w)` over the remaining weeks.
- ω = 1 for regular-season weeks and, for playoff weeks, the automatic playoff-week weight below (Phase 7b; until then the user's setting, default `config.lineups.playoffWeight` 1.25, now its fallback).
- Also report **PPW**: the average LV over the remaining regular-season weeks.

**The automatic playoff-week weight** (Phase 7b; planner reply to Checkpoint 7a, §6.1, which replaces the 1.25 setting; `src/engine/league.ts` step 5c, `config.lineups.playoffWeightAuto`; `LeagueModel.playoffWeight`, `playoffWeightAuto`, `lineupThresholds`)
- ω = (B per point in playoff weeks) ÷ (B per point in regular-season weeks), for my team under my goal ("What does your league reward?", Section 10). Two extra season simulations on the headline's seasons (common random numbers): my weekly score + 3 in the remaining regular-season weeks team numbers count only (a week under way is left out), then in the playoff weeks only, each against the base run; B per point = B_win (ΔPO and ΔCH under the goal) ÷ (3 × the weeks changed). Clamped to [0.5, 4] (one per-point B not above 0 while the other is: that end) and ⚠️ rounded to 0.01 (ours); the pages print one decimal.
- ⚠️ The baseline (the lead's design): every team as it stands (the "as rosters stand" setup), before the free-agent allocation, since every V*(T), the allocation and W depend on ω. In that setup only the IR returners' roster spots read ω and W; they read ω₀ = 1.25 and W₀ = the best free agent's value (nothing claimed yet). The trade context measures ω on its own final block, the same seasons, so the League page and the search share one ω and one baseline.
- The fallback, `config.lineups.playoffWeight` (1.25), when it can't be measured: no team picked, no regular-season or no playoff week left to count, no odds, title odds unknown, neither run moving my odds, or a per-point B that isn't a number (`PlayoffWeightFallback`; Settings says why in words). Builds without a simulation (tests) don't measure it.
- ⚠️ One ω per build, mine, for every team (the planner's "per league, team and goal" read as my team and my goal), wherever ω was the setting: every ROS(T) and what reads it (the free-agent optimizer and the allocation order's gains, the near-tie tolerances, lineup costs, MV_add, trade chips and their cost per week, the chips that stay chips behind partner fit, the IR returners' roster spots, and in the search the screening's ΔROS, roster legality and the get pool). Not weighted, as before: players' own ROS points (Section 6 step 7; the planner: "The ROS points users see stay unweighted"), PPW, strength and needs, partner fit's per-week gains, the season simulation and B. So the other teams' pickups and chips follow my goal's weight of the playoff weeks.
- ⚠️ The thresholds in ROS lineup points keep the meaning they had at ω₀ (review of the engine track): `faMinGain`, `chipMinGap` and the search's `throwInMaxCost` are × Σω ÷ Σω₀ over the weeks team numbers count (`LineupThresholds`; the near-tie tolerances, `dropNearTieWeekly` × Σω, scale so already). Unscaled, Parker's headline playoff odds went from 60.2% ("Win the title", ω 1.98) to 58.9% ("Make the playoffs", ω 0.5: his own pickup, 2.85 lineup points, fell under 3 and went to a playoff rival) and the league's trade chips 36 / 27 / 15 by goal; scaled, 60.2% / 59.9% / 59.8% and 28 / 29 / 18.
- Parker's league (2026-10-04 09:24 UTC data, Team 3; `npm run league:report`): ω 1.98 under "Win the title" (B per point 0.1011 in the regular season, 0.2002 in the playoffs), 1.08 under Balanced, 0.5 under "Make the playoffs" (clamped low). Under "Win the title" the thresholds are × 1.159: a pickup must gain 3.48, a trade chip's gap reach 11.59, a throw-in cost at most 5.80. The labels say how playoff weeks count ("lineup pts (playoffs count 2.0×)"); Settings shows it read-only (Section 14).

**Roster legality after a trade**
- **Too many players** (above `maxRosterSize`, not counting IR and taxi): automatically drop the team's lowest "keep value" bench players. Keep value = marginal ROS contribution, plus normalized market value in dynasty leagues.
- **Too few players:** automatically add the best available free agent, meaning the one who most improves LV.
- Enforce `positionLimits` (on the active roster; IR is exempt) and `rosterMinimums`.
- Show any required drops and adds on the trade card.
- Phase 4 details (`src/engine/evaluate.ts`; lead decision M2):
  - Assets are players in this phase (draft picks are deferred, Section 12). Illegal, in plain English: a pick, no asset at all, a player twice, more than the per-side maximum (the search's max players per side; the Analyzer's `analyzerMaxPerSide`), or an asset not on that side's active roster or IR (Phase 4b; taxi players still aren't tradable). One empty side is legal (a 1-for-0 the Analyzer can build).
  - **IR moves first** (Phase 4b, legality rule 5; planner reply to Checkpoint 4, change 5): an IR player a team gives leaves its IR (the slot opens); an IR player it receives goes into an open IR slot when his status is one the slot takes (`settings.irEligible`, else IR and PUP), most ROS points first, else onto the active roster like anyone else. ⚠️ Only players received from the other team's IR are considered for a slot: a player received from an active roster joins the active roster whatever his status, and teams never move their own active OUT players into open slots.
  - Each side's active roster after the trade is its roster minus what it gives plus what it receives (received IR players as rule 5 places them). Then, in order: (1) a position over its `positionLimits` drops that position's lowest keep value player not just received (none: illegal); (2) over `maxRosterSize`, the lowest keep value players go one at a time, recomputed, never one just received, one the starting lineup needs, one a position's minimum needs, one rule 3 added, or (Phase 4b final review, ⚠️) the last rostered player at a position the team streams (the streamed slot needs that roster spot: before, a D/ST streamer could drop its only D/ST while its streaming row kept the slot filled); (3) a position under `rosterMinimums` adds the best free agent there (none: illegal), and rule 2 makes room again if needed; (4) each roster spot the trade opened adds the free agent who most improves the lineup (ties, including no gain: more ROS points, then the smaller id), within position limits, never a position the team streams. ⚠️ Phase 4b (review of track C): a K or D/ST, which V* never adds, comes in only to refill a starting slot the trade emptied (trading the only kicker still refills it); before, a team that doesn't stream them got a free-agent kicker or D/ST upgrade in any spot a trade opened (7 legality adds on the shown cards of Parker's 2026-10-03 data), credit for a pickup it could make anyway. ⚠️ A team already over a limit or the roster size before the trade is held only to its count then, and a minimum is enforced only up to the count it had before.
  - Keep value: what losing him costs the roster's lineup with nobody refilling his spot, in the evaluation's lineup mode (EV in screening, scenario lineups in exact evaluation); dynasty and keeper leagues with long-term values: that cost ÷ the roster's largest + v_dyn ÷ the top dynasty value (⚠️ our reading of "plus normalized market value"). Only players with a model are dropped. Ties: the lower perception value, then the smaller id.
  - These forced moves are the card's required drops and adds; then each side's free-agent optimizer (V*) runs from the post-legality roster.
  - ⚠️ **Near-ties** (Phase 4c, final review; `config.lineups.dropNearTieWeekly` 0.2 points a week): when two forced drops (legality's, or a returner's drop at his return) are within that much lineup value a week (× Σω over the counted weeks), the one with the lower trade value goes, values floored at W (so among players worth at most W the lineup still decides); and when V*'s best move would cut a player worth more than W, its free agent comes in instead for the droppable player worth least, as long as that swap gains at least the best gain minus the same tolerance, and more than 0 (the best move decides that a pickup happens, the near-tie only whom it cuts, so the swap may gain less than `faMinGain`). Only without long-term values (dynasty and keeper leagues with them keep the keep-value rule). Why: on a coin-flip tie the app told Parker to cut Kyle Monangai (worth [value], a trade asset of several cards) rather than a bench player worth less than W. The headline odds don't change on Parker's data; the odds as rosters stand move at most 0.26 points (Team 6 keeps its IR returner Jordyn Tyson and drops Emanuel Wilson from week 5).

**IR players** (Phase 4b; planner reply to Checkpoint 4, change 5 and answer 11; `src/engine/returners.ts`)
- **Returners:** each team's IR players with a model and an expected return week (Section 6 step 3) join its lineup pool. They ride with the team's lineup rows like streaming rows (`StreamSpec.returners`): no active roster spot while on IR, never dropped by V* or a free-agent move, never counted for the lineup-fill rule (they can't play now); their own availability keeps them out until they're back. This applies to every team, every lineup (V* included) and the season simulation.
- **The roster spot from the return week** (displacement): when the active roster plus the returners back by week R is over `maxRosterSize` (⚠️ a roster already over before is held to its own count, as legality does), or a returner's position would go over its `positionLimits`, from R on the lowest keep value player goes (§7 keep value: his removal cost over weeks ≥ R in the evaluation's lineup mode; ties by perception value, then id; dynasty and keeper leagues with long-term values: plus normalized market value), one per returner past the room, in R order; at the returner's position when its limit binds. ⚠️ When nobody can go (everyone without a model or needed), the roster runs over and nothing is dropped. ⚠️ Our readings (Phase 4b reviews): the returner himself can be the one released when he's the least useful (so a return never weakens a team, ⚠️ but by the near-tie rule below: since Phase 4c a return can weaken a team by at most `lineups.dropNearTieWeekly` to keep a returner worth more than W); a position limit that binds drops at the returner's position; never a player the lineup or a position's minimum needs; never the last rostered player at a position the team streams (the streamed slot needs that roster spot); a player just received in a trade can be the one displaced. It is applied by a masked copy of his row.
- ⚠️ The displacement is applied to **final evaluations only**: the League model's teams as they stand (strength, needs, PPW, ROS, the weekly scores and the League page odds) and the trade context's baselines and both sides of every exact trade after V* (B, n, h, the simulation). The marginal machinery (V*'s move search, screening, lineup costs, MV_add, chips, partner fit) compares like with like without it: a constant per team.
- `TeamModel.players` holds returners too (lineup cost = his removal cost from V*(T)'s lineups; no active spot opens), so the give pool can rank them; trade chips and throw-ins stay active-roster only. `irReturners: false` (a report switch the app never sets) restores Checkpoint 4's rule.
- Parker's league (2026-10-03 data): 7 IR players on 7 teams, every one a returner (Caleb Williams on Team 1 back in week 5, A.J. Brown on Team 5 in week 8, Alec Pierce on Parker's Team 3 in week 7, …), and every team with one must drop someone at R (all rosters full). Team 1 gains 3.8 points a week as rosters stand (Williams outscores its QB most weeks and covers his week-8 bye); Parker's own returner adds 0.1.

**Marginal values**
- `MV_add(T, j) = ROS(T + j − autoDrop) − ROS(T)`
- `MV_lose(T, i) = ROS(T) − ROS(T − i + autoAdd)`
- Phase 2 decision: measure MV_lose from the team after its best single free-agent move, `V(T)` = the best of T itself, T plus the best free agent when an active-roster spot is open, and every `T − i + autoAdd_i`. So `MV_lose(T, i) = V(T) − ROS(T − i + autoAdd_i)`, which is never negative. The formula as first written went negative for every bench player whenever a free agent beat one of the team's starters: 107 of 157 players in Parker's league, because a free-agent kicker beat several teams' kickers. The difference is one constant per team, so rankings within a roster (the surplus score) don't change. The team's best move (add, drop or an open spot, and its ROS gain) is shown on the League page, chosen by scenario ROS when scenarios ran, else by EV ROS. (Phase 4 replaced V(T), its one move and the pinned move with the optimizer below; the League page's best move became "Free-agent pickups that would help".)
- **Free-agent-optimized baseline everywhere a trade is scored** (Checkpoint 2 answer 1; Checkpoint 3 answer 2 and model change 2): B, n, MV_add, MV_lose and trade chips compare rosters after each one's free-agent optimizer, V*(X), both before and after the trade. A trade must never get credit for a free-agent pickup the user could make anyway, and an open roster spot is worth only what the best free agent adds.
  - **The optimizer V*(X):** repeatedly apply the best add/drop while it improves ROS by at least `config.faMinGain` (default 3 points; × Σω ÷ Σω₀ under the automatic playoff weight since Phase 7b, above), at most `config.faMaxMoves` moves (default 5). Never drop a player the team needs to fill its starting lineup. Streamed positions (below) are excluded: their slots are valued by streaming. In dynasty and keeper leagues, never drop a player whose dynasty value exceeds the added player's by more than `config.faDynGuard`.
  - `MV_add(T, j) = ROS(V*(T + j − autoDrop)) − ROS(V*(T))` and `MV_lose(T, i) = ROS(V*(T)) − ROS(V*(T − i))`. The same optimizer runs for every team, before and after every trade.
  - **One free agent, one team** (Phase 4b; planner reply to Checkpoint 4, change 3; it replaces Checkpoint 4's known approximation that each team was optimized on its own, so two teams could count on the same free agent). The League model runs each team's V* in order, each against the pool minus the free agents earlier teams claimed. The order: FAAB leagues by budget left, most first, when every team reports one (ties: the better waiver rank, then snapshot order); else the waiver order (`Team.waiverRank`: since Phase 4c the weekly reset order in leagues whose order resets weekly, so the baseline doesn't depend on the day of the import, Sections 2.2 and 2.3) when every team has one; else each team's best available gain first (its first move against the full pool, in the optimizer's judging mode; ties: snapshot order). `LeagueModel.faAllocation` records the basis and the order, and the League page says it (since Phase 4c "Free-agent pickups: each free agent goes to one team only. Your team picks 4th of 10." then "Waiver order used: Weekly reset (reverse standings)", Parker's 2026-10-04 09:24 UTC data; Phase 4b's line read "…one team only, in your league's waiver order. Your team picks 10th of 10.", ESPN's live order). ⚠️ A team claims every free agent its run adds, even one a later move of the same run swaps away: then the allocation is exactly deterministic and no free agent is listed for two teams. Every later run of a team (lineup costs, MV_add for chips and the get pool, chips that stay chips) draws from the pool minus the other teams' claims, excl(T); partner fit runs no optimizer. Streaming is unchanged: the streamRank-th best already allows for competition.
  - **In trade evaluation** the two trading teams re-optimize in allocation order, legality's adds included, each from the pool minus every other team's claims (every other team keeps its baseline); the team that goes second also can't take what the first adds, nor the first team's baseline claims unless no team sits between them in the order. ⚠️ So a pickup a trading team gives up goes to nobody when a team sits between them (every team ahead had him in its pool and passed; the ones between would want him first). A trade that changes nothing reproduces the baseline exactly (⚠️ but for free agents whose gains tie within 1e-9, which never happened on Parker's data or in 60 random leagues). Screening's legality adds skip each side's baseline exclusion. `faAllocation: "independent"` (a report switch the app never sets) restores Checkpoint 4's rule.
  - **Inactive teams make no pickups** (Checkpoint 7a; planner reply to Checkpoint 4c, A4; `acceptance.inactiveTeams`, `inactiveRuleBlock`): a team with no transaction in the last `config.allocation.inactiveWeeks` (5) weeks (the activity feature's window, Section 11, through one shared helper: transactions whose week is above (league week, else NFL week) − 5, any type, trades once completed; with fewer than 5 weeks played, none this season) is assumed to make no baseline pickups: V*(T) = T, it claims nobody (it keeps its place in the order), its lineup costs refill nothing, MV_add to it uses the pinned formula, its chips are judged on its roster as it stands, and ⚠️ it streams nothing (streaming is a pickup every week). After a trade an inactive partner makes no V* move either, and legality's rule 4 leaves the spot the trade opened empty (rules 1–3 still apply, so roster minimums still fill); an inactive team between me and the partner in the allocation order doesn't count as one between. ⚠️ Our readings: my own team is never inactive (the user is acting); nobody is inactive when the data can't tell: no transaction at all in the snapshot, transactions that may be incomplete (an adapter's warning that a week didn't load or couldn't be read, `TRANSACTIONS_INCOMPLETE_CODES`: ESPN's whatever week it names, Sleeper's when its league week is in the window or unnamed), or a completed trade in the window naming fewer than 2 teams. A Phase 5 adapter or a skipped week (Part B's request budgets) that can drop transactions must add its warning code there. Not modeled: an inactive team's IR returners still come back, and its lineups are still assumed optimal. The Import Report's "Inactive teams" row names them ("Team 6: inactive, no pickups assumed."; "None: every team has made a transaction this season."; "None assumed: …" when the data can't tell; my quiet team: "… (yours always counts as active)"), an inactive team's roster says no pickups are assumed, the pickups line counts only the teams that pick ("Your team picks 1st of the 3 teams expected to make pickups."), and the Streaming card says when an inactive team that streamed is assumed to have stopped. Parker's league (2026-10-04 09:24 UTC data): nobody is inactive (every team's last transaction is in week 4, Team 5's in week 3); made inactive by hand, Team 6 would add nobody (it adds Baker Mayfield and Kenny Gainwell), Parker's week-11 win chance against it would rise from 62% to 84%, and his odds from 59.9% / 10.5% to 64.7% / 11.7%.
  - Phase 4c (the weekly reset order): Parker's league (the 2026-10-04 09:24 UTC data): the reset order is Team 2 > 4 > 10 > 3 > 5 > 9 > 8 > 1 > 7 > 6, so Parker claims 4th and adds Malik Washington for Marvin Harrison Jr. (10th in ESPN's live order, he got none); his odds with every team's pickups are 59.9% / 10.5% (58.3% / 9.8% in the live order).
  - Parker's league (2026-10-04 data, live waiver order Team 5 > 8 > 6 > 4 > 9 > 7 > 2 > 1 > 10 > 3): 13 pickups of 13 different free agents. Each team on its own (today's other rules) gives 15 pickups of 7 (Mark Andrews on 5 teams), and the Checkpoint 4 model 21 of 9 (Andrews on 7 teams, Malik Washington on 6). Andrews goes to Team 5, Washington to Team 9; Parker, last after his own claim that week, gets none (in the weekly reset order he'd claim 4th, and add Washington).
  - It replaces Phase 2–3's one-move baseline V(X) and the pinned move (Bo Nix to Team 1 scored +83 lineup points with the one move re-picked and +45 pinned in track C's fixture with synthetic inputs; on Parker's real data Checkpoint 3 had him add at most +14.9 anywhere, a gap of 0.8. Checkpoint 4 reports +3.6 to Team 1 and +5.2 at most, a gap of 5.2, under the optimizer).
  - Phase 4 details (`src/engine/optimizer.ts`):
    - A move adds one free agent into an open active-roster spot, or in place of a droppable player (the best free agent for the roster without him). The best move has the largest exact ROS gain (Σ ω LV over the weeks team numbers count, the team's streaming rows included) in the lineups B is measured in: scenario lineups when scenarios run (review of track E: a depth pickup is worth 3–4× its expected-value gain there, so an optimizer judging moves in EV lineups skipped pickups B then credited to trades; Parker's +Malik Washington −Marvin Harrison Jr. gains 2.7 EV points but 8.1 in scenarios), else expected-value lineups; the threshold stays `faMinGain` (3) in those points; ties: an open spot first, then the lower-value drop, then the smaller ids. Exact: the scenario search matches brute force (60 random cases). ⚠️ Speed split: the League model's many re-runs (lineup costs, chip MV_add, chips staying chips) still judge moves in EV lineups, and so does every run under starter limits.
    - Free-agent candidates: free agents with a model, not K or DEF (`config.streaming.optimizerExcluded`) nor a position the team streams, within position limits after the move. Droppable: active-roster players with a model (one without projections isn't known to be worthless), not K, DEF or a streamed position, and not needed to fill the lineup: after the move every starting slot that could be filled still can be, by a structural matching that ignores points, byes and injuries. The dynasty guard applies only when dynasty values loaded: `faDynGuard` = 0.05 × the top dynasty value.
    - MV_lose and MV_add re-run the optimizer from V*(T)'s roster (minus him, or plus the newcomer minus the drop), memoized by roster. A run from scratch holds at most `faMaxMoves` pickups, and so does a re-run: past the cap a new pickup is an exchange, made only when giving back the pickup that then costs least (and bringing back the player its move dropped) still pays; a player who leaves opens a spot that takes back a dropped player when no free-agent move fills it. ⚠️ The greedy-path difference from runs from scratch (Parker's league, synthetic inputs): lineup costs within −3.6..+6.0 and MV_add within −5.0..+5.7 EV points.
    - MV_lose is floored at 0, and is 0 for a player V*(T) drops. MV_add's drop on a full roster is V*(T′)'s lowest keep value player (never the newcomer; often one of V*(T′)'s own pickups); when a position limit binds, its lowest keep value player at the newcomer's position. ⚠️ For speed the re-run after a newcomer runs only when he starts for the roster in some counted week (Parker's league: 10 of 1,413 player-team pairs change, 1 chip of 89 missed).
    - Parker's league (the 2026-10-01 data): 20 moves over 10 teams (0 to 5 a team, 2.0 on average) with moves judged in scenario lineups; 14 (1.4 a team) when they were judged in EV lineups.
- **Streaming positions** (Checkpoint 3 model change 1, from Parker): many managers stream K and D/ST every week, starting whichever available one is projected highest for that week's matchup.
  - A user setting, "Positions I stream weekly": default K and DEF; the user can add QB or TE. It's stored with the user's other settings.
  - A streamed slot is worth, each week, max(the best rostered player, the streaming replacement). The streaming replacement is the `config.streamRank`-th best free agent at that position that week, ranked by that week's projection (default 3rd: other teams stream too).
  - It applies to the user's team (their setting) and to any other team detected as a streamer at a position, meaning it made 2 or more adds at that position this season. Every other team uses its rostered players.
  - K and DEF are never part of the free-agent optimizer's moves. The League page lists "Streaming picks this week" instead: the top 3 K and top 3 D/ST free agents for the current week, each with its projection and opponent. This also removes, at the source, the negative lineup costs free-agent kickers caused.
  - K and DEF stay out of trade search by default (Section 9).
  - Phase 4 details: detection counts "add" and "waiver" moves to the team at the move's position (else the player's); unknown positions don't count; only positions the lineup starts; the user's own team follows only the setting. Each streamed position is one virtual lineup row (`stream:<POS>`: no roster spot; never dropped, traded, a chip or a free-agent move), so the exact solver values the slot at max(best rostered, replacement) every week and in every scenario. A league that starts two at a position still gets one streamer. Where a flex takes the position too (TE and FLEX, QB and SUPER_FLEX or OP), the streamer can also start in the flex when he beats its starter (accepted at the track A1 review and said on the page; Parker's K and D/ST aren't flex-eligible). The replacement is ranked by that week's expected points (availability included; fewer free agents → the last one; none → 0); on a game day the current week uses that week's points. Streaming counts in every team number: lineups, strength and needs, lineup costs, chips, partners, the simulator's weekly scores and trade evaluation.
  - autoDrop, when the active roster is full, is the player whose removal costs the lineup least with nobody refilling his spot (the newcomer takes it): the keep value's "marginal ROS contribution", in the same lineup mode, never the player just added; ties go to the lower value, then the smaller id. (Phase 3: a first version ranked drops by MV_lose, which assumes a free agent refills the spot, and dropped starting kickers with a near-equal free-agent twin; the review caught it.) The dynasty part of keep value, "plus normalized market value", arrives with Phase 4's roster legality.

**Needs and trade chips**
- **Strength:** for each team and slot type, the average starter points at that slot over the next 4 weeks and over the rest of the season.
- Compare strength to the league median as a z-score.
- **Needs:** slots with z ≤ −0.5, ranked.
- **Trade chips** (Checkpoint 2 answer 2; they replace the Phase 2 surplus rule, under which only 3 players in Parker's league qualified and Parker showed none, although he rosters Bo Nix behind Josh Allen in a 1-QB league while four teams need a QB, the classic trade chip):
  - `gap_i = maxOther_i − cost_i`, both in rest-of-season lineup points against free-agent-adjusted baselines: `maxOther_i` = the largest `MV_add(T′, i)` over other teams T′, and `cost_i` = `MV_lose(own team, i)`.
  - A player is a trade chip if `gap_i ≥ config.chipMinGap` (default 10 ROS points; × Σω ÷ Σω₀ under the automatic playoff weight since Phase 7b, above). In plain words, he's worth at least 10 more points to some other team than to his own.
  - Show up to 3 chips per team, ranked by gap, with the team where he'd help most and what he costs his own team (Checkpoint 3 answer 3), for example "Worth +33 to Team 2 · costs you 6.1 pts/wk" ("costs his team" on another team's chip: review of track A1). The per-week cost is the cost ÷ Σ ω over the weeks team numbers count. A chip who starts for his own team carries a "starter" tag: he's in his team's EV lineup after its free-agent pickups (V*) in at least half of the counted weeks in which he plays, never a player those pickups drop. The rule itself stays as written for the search.
  - Every chip joins the give pool G (Section 12).
  - Phase 3 details: candidates are active-roster players outside the trade-search exclusions (P, K, DEF and IDP, Section 9); IR and taxi players aren't candidates (Phase 4b keeps it so: IR players join the give pool through their surplus score, and partners' IR players the get pool by MV_add(me, j), Section 12). Chips need no trade values. The search is exact: scenario upper bounds decide which (player, team) pairs need a lineup solve (0 mismatches against brute force); `config.needs.chipScreenTeams` limits it only under starter limits (MFL), where nothing is bounded. Chips are ordered by gap, then the lower lineup cost, then player id: expected-value lineups give a starter and his backup the same gap, since each qualifies because the other covers him, and the backup is listed first.
- **Best trade partners:** teams whose trade chips match my needs and whose needs match my chips.
  - Mutual fits come first (planner, Checkpoint 2), scored sqrt(what their chips add to my lineup per week × what mine add to theirs). Then come one-sided fits, where their chips would start for me but I have none they need (a trade would likely cost me a starter), ranked by what they'd add.
- Strength uses slot instances (QB1, RB1, RB2, FLEX1 …: a slot's starters sorted by points), averaged over scenario lineups when they ran.
- Phase 2 review decisions:
  - **Game days:** once any game of the current week has kicked off, every team-level measure (ROS(T), PPW, strength, needs, lineup costs, the free-agent moves, trade chips, partner fit) skips that week: lineups are locking and its points are being scored. Players' own ROS points still count their games that haven't started.
  - **Partner fit** uses each side's joint gain (its chips added to the other roster at once), so two spare players competing for one slot aren't counted twice. The chips are added to the receiving team's roster after its free-agent optimizer (V*, expected-value lineups; Phase 2–3: its one-move T_V) with no auto drop, unlike MV_add for chips.
  - Phase 3: a side counts only chips that stay chips together, at most `config.search.maxPerSide`: its chips ordered by what each adds to the other team, taking a chip only if it is still a chip once the chips already taken have left its team. Chips come in groups, so adding a deep team's whole group inflated its fit (15.2 points per week joint against +7 for its best single chip). Each receiving team is measured after its free-agent optimizer (Phase 4; its best single move in Phase 3).

**Waiver upgrades** (Phase 7b; planner reply to Checkpoint 7a, §6.2; `src/engine/waivers.ts`, `league.ts` step 10, `LeagueModel.waiverUpgrades`; the League page, Section 14; display only: no odds, projection or trade number reads them)
- **Who's listed:** for my team, every free agent with a model who projects for more points than at least one of my active players at his primary position, in the list's terms. My players who score nothing there (on bye, out, a game already started) aren't compared, and the list names them; ⚠️ where none of mine at his position scores (nobody there, or all idle), the best 3 free agents there are listed (`config.waivers.perPositionCap`), and at most 3 rows at K and D/ST (`cappedPositions`) and at a position I stream in a one-week list.
- **The lists:** "Rest of season" (the default: every remaining week team numbers count, each counted once, unweighted like players' ROS points; positions I stream left out, their slots being filled from the free agents every week); "This week" (the first week team numbers count, the positions I stream included: K and D/ST for a streamer); and while a week is under way, "This week" for its games still to play (⚠️ ours: a player whose game has kicked off is locked where my best lineup before the first kickoff had him, can't be the drop, and a free agent whose game has started isn't listed) with "Next week" as the other one-week list.
- **Lineup gain** = ROS(R + a − k) − ROS(R) over the list's weeks, in scenario lineups (EV without scenarios). R is my active roster as it stands (pickups I can make now, not after the pickups the League model expects of me), with my IR returners (⚠️ no roster spot from their return) and, in the season list, my streaming rows (⚠️ one-week lists without them: that week's streaming pickup is the very decision). k is roster legality's drop for one pickup (none with an open spot and room at his position; else the lowest keep value among my active players with a model, never one a position's minimum or the starting lineup needs, never the last at a position I stream, at his position when its limit binds, near-ties to the lower trade value floored at W; ⚠️ keep values from the season list in every list: a drop is for good). Nobody can go: "No room".
- **"Depth only":** he adds `startsMinPoints` (0.05) or less in EV lineups of R − k, so what he gains comes from covering injuries and byes.
- **Order:** by the gain as shown (`gainDecimals` 1; every gain that shows as none is one tie), then the list's points, then the id; a pickup that can't be made last.
- ⚠️ Known approximations: an injured free agent who could go straight into an open IR slot is priced as taking an active spot; a pickup's effect on the other teams (one free agent, one team) isn't counted; each row is a single pickup against my roster as it stands, so two rows' gains don't add up.

---

## 8. Season simulator

**Weekly scores**
- Run a Monte Carlo over the remaining regular-season weeks.
- Each team's score is drawn from Normal(`LV(T,w)`, `σ_T,w`), where `σ_T,w = sqrt(Σ σ_{i,w}²)` over that week's optimal starters. `σ_T,w` also adds the spread of LV across the availability scenarios (Section 7).

**Standings and playoffs**
- Start from current records and points-for.
- Use the real remaining schedule. Add median games when `medianGame` is on.
- Rank points-only leagues by total points.
- Seed playoffs by wins, then points-for. Use divisions and tiebreakers when the platform reports them; otherwise warn.
  - Use the league's own seeding tiebreaker when the platform reports it (planner, Checkpoint 2). For ESPN, read it from the settings (`settings.scheduleSettings.playoffSeedingRule`), and warn if you can't.
- Model re-seeding after each round (Sleeper `playoff_seed_type` 1) and division-winners-first seeding whenever the platform reports them (`playoffSeeding`). Otherwise use the default seeding and show a warning.
- Give byes to top seeds when `playoffTeams` isn't a power of two.
- Handle single-week rounds, and multi-week rounds when the platform reports them.
- Outputs per team: P(playoffs), P(bye), P(title) and expected wins.
- Show each remaining week's risk, for example my chance to win each week's matchup. Parker's league has a real bye crunch in week 13 (his projection drops to 85.9), and the sim should show it.

**Common random numbers**
- Generate the matrix of random draws once, from a seed.
- Reuse it for the "before" run and for every "after" run, so trade deltas aren't just noise.
- Defaults: 5,000 simulations for final evaluation, 1,000 for screening.

**Phase 3 details** (the simulator: `src/engine/sim.ts`; wiring it to the League model: `src/engine/season.ts`)
- **Weekly score:** mean = LV (the scenario mean), σ² = the scenario average of Σ σ² over that scenario's starters who play (σ = c_pos × his points when he plays + d_pos) + the variance of LV across the scenarios: the law of total variance. Without scenarios, σ² = Σ σ_{i,w}² over the expected-value starters. Parker's weekly σ is about 21–27 points.
- **Common random numbers:** sim n draws z[n][week][team] from its own stream (seed, "season", n) by Box–Muller, so the first 1,000 sims of the 5,000-sim matrix are the 1,000-sim matrix. (Phase 4: the trade search draws one 6,000-season matrix in two blocks instead; since Phase 4c the final run reads the first 5,000, the League model's own seasons, and the screening the next 1,000; Section 12.) Identical inputs give identical odds bit for bit.
- **The week in progress:** live scores aren't read (reading them is Phase 6 work, Checkpoint 3 answer 6), so its games are simulated from projections as if none had started (the players rebuilt 1 ms before the week's first kickoff), and the page says so. ⚠️ They use today's rosters and injury news: a player hurt in a game he already played counts as missing it, and a player traded after his game moves that week's points to his new team (the app keeps no record of rosters or tags at kickoff).
- **Games:** a decided regular-season matchup is already in the records; with a readable score it also counts for head-to-head and division records. An undecided matchup in the current or a later week is simulated. A finished week whose matchups aren't decided yet (ESPN before it processes the week, Sleeper before `last_scored_leg` moves) is left out, with a warning, until they are: the records don't count it yet either. Records are cross-checked against the decided games. A head-to-head league whose remaining schedule didn't load (no undecided game with an opponent left while some remaining weeks have no matchups) gets no odds, with a warning naming the missing weeks, rather than today's standings printed as final.
- **Median games:** the top ⌊N/2⌋ scores of the week win (⚠️ with an odd N the middle team loses); a multi-week matchup gets one median game (⚠️ our reading).
- **Points-only leagues:** standings by points for; their playoffs are simulated head to head (⚠️ assumed).
- **Standings** follow espn-api's recursive order (a group still tied moves on to the next criterion, never back): points for = win %, points for, head-to-head, division record, more points against; head-to-head = win %, head-to-head, points for, division record, points against; division record = win %, division record, head-to-head, points for, points against (⚠️ our order: espn-api puts division record before win %). Then team index stands in for the coin flip. Head-to-head among 3+ tied teams counts only when every pair met equally often. Division record is each team's own record against its division (espn-api's code; its docstring says otherwise, ⚠️). Division winners are seeded first when the platform says so: ESPN documents it for every league with divisions (Section 2.2); Sleeper for some layouts (Section 2.3, inferred for the rest, with a note). A fixed bracket is assumed, with a note, when the platform doesn't report re-seeding.
- **Playoffs:** seeds 1..N, a bracket of the next power of two with byes for the top seeds; a fixed standard bracket (6 teams: 4 v 5 and 3 v 6, seed 1 meets the 4/5 winner, seed 2 the 3/6 winner, ESPN's bracket) or re-seeding after each round. A multi-week round sums its weeks; a tied playoff game goes to the better seed (Sleeper documents this). Finished playoff games are replayed from their results; a finished round without results makes bye and title odds unknown. Once the standings are final, the platform's scheduled winners'-bracket games are checked against our bracket: a game that gives one of our teams a different opponent, or puts one of our bye teams in round 1, makes bye and title odds unknown, with a warning. Sleeper's playoff matchups aren't imported yet, so once a Sleeper playoff round has been played its title odds show as unknown.
- **Outputs:** P(playoffs), P(bye), P(title), the expected final record, the final-seed distribution, today's rank by the same rules, and each remaining week's chance to win (and to beat the median). A team is shown as eliminated (§8's "Your season's over" message, redraft leagues; its partner cards are hidden too) only when it's certain, never from simulation counts. After the regular season: it lost a playoff game, or it trails at least as many teams as there are playoff spots on numbers the platform reports (win %, then points for when that's the league's own tiebreaker). Before that: at least as many teams as there are spots have a worst-case win % above its best case, counting every result still to come (remaining games, median games, finished games not scored yet), and, with 2+ divisions, a division rival is one of them.
- **Exact title odds** (Phase 4, track S; a variance cut, not a model change): given a simulated season's seeding, each team's title chance is computed exactly instead of drawing its playoff games. A game between A and B over a round's weeks W is won by A with probability Φ((Σ_W μ_A − Σ_W μ_B) / sqrt(Σ_W σ_A² + Σ_W σ_B²)) (independent normal weekly scores; a tie has probability 0), a fixed bracket by dynamic programming over its slots, a re-seeding bracket by listing outcomes from the round with at most `config.simulation.exactReseedTeams` (8) teams left (earlier rounds drawn). Played rounds use their results; the unknown-odds rules are unchanged. P(title) is the average over seasons, the same expectation as before; P(playoffs), P(bye), seeds, records and weekly odds are bit-identical. On Parker's league the seed-to-seed SD of a +3 pts/wk ΔCH fell from 0.52 to 0.11 percentage points and B's from 0.39 to 0.21, at about the same speed (5,000 seasons 11.8 ms). `SimOptions.titleMode: "sampled"` keeps the old draw for tests.
- **Runtime** (Parker's league, Node, Checkpoint 3): 1,000 seasons in 5.8 ms and 5,000 in 30 ms (16 ms of it drawing the matrix); the whole League model with 32 scenarios takes 125 ms without the simulation and 155 ms with it.
- **One baseline everywhere** (Phase 4c; planner reply to Checkpoint 4b, change 9; `src/engine/league.ts`, `season.ts`): `LeagueModel.odds`, the League page's headline, is every team after its free-agent pickups (V*(T) after the one-free-agent-one-team allocation, IR returners and the drop at their return, streaming rows), priced by the same functions the trade context uses (`finalRunLineups`, `pickupScore`; `TeamModel.scoreWithPickups`), on the same seasons as the trade search's final block: the trade baseline equals it exactly (tested on random leagues and on Parker's data). `LeagueModel.oddsAsRostersStand` keeps today's rosters as they stand (the page's second line); both runs share one drawn matrix. Every reader of odds on the League page (standings, remaining games, risky weeks, the star premium's P(playoffs)) reads the headline; "eliminated" reads no simulation counts. ⚠️ The headline moves at the week's first kickoff: before it, pickups can still play the current week; after it, the week in progress is held at its as-stands score and V*(T) is re-judged without it (Phase 2's game-day rule), so on Parker's data (2026-10-04 09:24 UTC, weekly reset order) one team's playoff odds moved 0.7 points (Team 9; title odds at most 0.1) and Parker's not at all at that moment (1.3 and 0.2 on the 00:51 UTC data in the live order); the odds as rosters stand don't move. Runtime: the League model about 220 ms (two 5,000-season runs on one matrix, 42 ms).
- **Win chance by week for a trade** (Phase 4c, change 9): each simulated evaluation carries my head-to-head win chance per remaining regular-season week, before and after (`TradeDetail.winChance`, from the same runs as B: the final block on cards and in the Analyzer, the screening block on steps); a multi-week game at its first week; a week without an opponent is left out; ⚠️ none in a points-only league (its games don't change the standings).

**Notes and edge cases**
- The simulation naturally captures that a trade changes the partner's strength too. Strengthening a rival can hurt you.
- **Regular season over:** simulate only the playoffs, for teams still alive.
- **User eliminated in a redraft league:** show "Your season's over — no trade helps this year." Dynasty and keeper leagues still use future value.

---

## 9. Market value layer: how managers perceive trades

**Player values**
- `v_i` = the FantasyCalc value in the league's format:
  - redraft leagues: redraft values
  - dynasty leagues: dynasty values
  - keeper leagues: dynasty values for the future term, redraft values for perception
- Players FantasyCalc doesn't value (its redraft list holds only about 198 players; it has no K, DEF or IDP) get an **estimated** value:
  - For each position, fit a monotone curve of FantasyCalc value against rest-of-season projected points, using the players who have values. Extrapolate to the unvalued players.
  - Cap each estimate at the lowest real value at that position.
  - If fewer than 10 players at a position have values, use min(`config.valueFloor`, the lowest real value at that position) instead. `valueFloor` is 1% of the top value.
- Exclude P, K, DEF and IDP from trade search by default, with a toggle to include them. HC is unmapped (Section 2.2), so it never appears.

**Package value: a waiver credit, the way FantasyCalc does it**
- The side that receives fewer players gets a fixed **waiver credit** for each open roster spot.
- **Why:** a third-party test of trade calculators against 3,003 community-judged trades found that this credit raised FantasyCalc's accuracy from 61% to 82%. KeepTradeCut's heavier "stud premium" adjustment did worse.
- Credit amount: `W` = the FantasyCalc value of the best available free agent in this league, with a minimum of `config.waiverCreditMin`.
- **Since Checkpoint 7a** (planner reply to Checkpoint 4c, A3 and answer 2: "consistent with one free agent, one team"): W = the value of the best free agent the baseline allocation (Section 7) leaves **unclaimed** (estimates count; at least `waiverCreditMin`). The allocation itself reads W (the near-tie cuts floor values at W), so W is a fixed point (`league.waiverCreditFixedPoint`): allocate with the best free agent's value, read the best unclaimed one, allocate again with it whenever some modeled player's value lies between the old and new W, until W repeats; at most `config.allocation.waiverCreditPasses` (4) allocations, and ⚠️ a cycle or the cap takes the smallest W tried with its allocation (never seen: on 60 random 10-team leagues 8 needed 1 allocation, 51 needed 2 and 1 needed 3). The long-term W of dynasty and keeper leagues leaves claimed free agents out too; `faAllocation: "independent"` keeps the old W. Parker's league (2026-10-04 09:24 UTC data): W [value] (Justin Herbert, claimed by Team 4) → [value] (KC Concepcion) after 2 allocations; Parker's pickup now cuts Romeo Doubs instead of Marvin Harrison Jr. ([value], now above W, so the near-tie rule keeps him; his odds stay 59.9% / 10.5%); the top card's chance they accept 55.0% → 50.9% (printed 55% → 50%), and 14 cards → 12. ⚠️ A side effect of the lower W, accepted: the near-tie rule (Section 7) now also protects players barely above W (Team 2 keeps Kalif Raymond, worth W + 20, and makes two small pickups instead of one; its EV lineup points 1,283.7 against 1,282.0).
- Phase 4b (IR players tradable): the credit counts **active** roster spots after legality's IR moves (Section 7 rule 5). An IR player leaving an IR slot opens no active spot, and one received into an open IR slot uses none, so each side's spots come from its own moves (`market.ActiveSpots`) and the two packages no longer mirror each other exactly when IR players move. Every player the neutral throw-in rule keeps (Phase 4c, below) still counts at max(v, W).

**Formula.** For side X, which receives the set R and gives the set G:

```
PV_recv = Σ_R v + max(0, |G| − |R|) × W
PV_give = Σ_G v + max(0, |R| − |G|) × W
g_mkt(X) = (PV_recv − PV_give) / PV_give
```

Since Phase 4b (below): after the neutral throw-ins leave (Phase 4c), each v counts at max(v, W), and the credit counts the active roster spots X's trade opens, s_X = (its active players given) − (players received onto its active roster), so PV_recv adds max(0, s_X) × W and PV_give max(0, −s_X) × W. With no IR player moving, s_X = |G| − |R| as above.

Examples with W = 400:

| Partner receives | Partner gives | g_mkt |
|---|---|---|
| a 10,000 player | 5,000 + 5,000 | +4.0% |
| 5,000 + 5,000 | a 10,000 player | −3.8% |

**The value floor** (Phase 4b; planner reply to Checkpoint 4, change 4; replaces Phase 4's lead decision N10)
- In every package sum each player counts at max(v, W), before the stud exponent (`market.packageValues`, the one place every sum goes through). That covers my g_mkt and B's market term, ΔDyn (long-term values and the long-term W), the partner's g and its perceived g (max(v, W) × (1 + e), Section 11), hist, the Market check, the hide threshold, the veto rule and the screening window (and the card's values until Phase 4c; from then until Phase 7b the card showed FantasyCalc's own values, and since then no value at all, Section 13). Since Phase 4c the neutral throw-ins leave first (below), then the floor applies to what's left. MyDynTotal (Section 10) and picks stay unfloored.
- Why: a player worth less than the best free agent is replaceable, and every team's free-agent-optimized roster (Section 7) already counts that replacement.
- Results: an even swap of two such players gives g = 0 on both sides; dumping one for nothing gives g = 0.

**Neutral throw-ins** (Phase 4c; planner reply to Checkpoint 4b, change 2 and answer 6; `market.packageValues`)
- Before either side's g and the market term are computed, a player worth at most W on the side giving more players is left out of both sides' totals, together with his roster-spot credit; then the floor and the credit apply to what's left. So a throw-in worth less than a free agent can never raise acceptance: he still counts as an extra player (c), and roster legality still handles the partner's drop. (Under Phase 4b's floor both sums grew by W, so each side's g moved toward 0 and a cheap throw-in could lift a trade past the veto, the Market check or the hide threshold.)
- ⚠️ Our reading of "drop any player worth at most W who's on the side giving more players": up to as many such players as that side gives beyond the other (each takes one open roster spot's credit with him), the lowest values first (ties by id), judged on raw values (the star premium never saves one). ⚠️ Then (ours, so the guarantee also holds when a cheap player of mine evens the count against a cheap extra of theirs) matched pairs of players worth at most W, one from each side, cheapest first, leave too, each with his roster-spot credit: A + x → B + c reads as A → B, the same as A → B + c. Without IR moves this equals leaving out every player worth at most W with his roster spot, so a cheap player added to either side moves neither g, both sides leave out the same players, and the two packages mirror each other. A player moving into or out of an IR slot opens no active spot, so leaving him out removes no credit (`ActiveSpots.inactive`, set for every caller); ⚠️ the one exception, documented in `market.ts`: a cheap IR mover left in, or more cheap players than their side's spot credits, can still move g (none among the exact trades on Parker's data). The guarantee is through value: with n, h and hot held fixed P_accept never rises, but a cheap player who fills the partner's lineup hole can still raise it (Parker's data has "if they say no, add him" steps adding Rico Dowdle, worth less than W, for about +8 points through n and h). It applies everywhere a package is summed: acceptance's g (quick and full), the veto, B's market term, ΔDyn, hist, the screening window. The card's value line used FantasyCalc's own values instead (Phases 4c to 7a; since Phase 7b the card shows no value, Section 13). W = 0 (a plain sum) leaves nobody out.
- ⚠️ **My free-agent moves after a trade** (Phase 4c, final review; `evaluate.freeAgentMovesOf`, `RosterChange.faMoves`): pickups and cuts my V* makes after the trade that the baseline's V* doesn't make count in g_mkt(me) and ΔDyn like traded players (a cut player as given, at max(v, W); a pickup as received), and the card names them ("This trade's numbers count on one more free-agent move: you'd drop X and pick up Malik Willis (QB, MIA) to start in week 7."; a lone drop says whom it makes room for, "the pickup the League page suggests"). Before, Bo Nix → Jadarian Price assumed a QB pickup for Josh Allen's week-7 bye that cut Kyle Monangai, without saying so, and read his value as kept. ⚠️ Limits: a cut the trade makes unnecessary isn't credited, and the partner's numbers read only the trade itself.
- ⚠️ A side effect (accepted): two of my players each worth less than W for one player worth their FantasyCalc sum and more than W reads as a large trade-value gain for me in the model's figures (one is left out, the other counts at W), so B's market term can lift Helps you well above what the odds alone give; the card's value line, on FantasyCalc's own values, read such a trade as even (Phases 4c to 7a). Since Phase 7b the term is priced in lineup points (Section 10), so the lift is at most κ_pts × 0.5 points a week (1 at Medium).

**Optional convexity**
- `config.studExponent` (default 1.0 = off) replaces v with v^γ.
- It's only for later calibration.

---

## 10. Our benefit and the Trade Score

Everything here is from the **user's** point of view.

**Measures**
- `ΔPO`, `ΔCH`, `ΔEW`: the change in my P(playoffs), my P(title) and my expected wins, from the simulation with common random numbers.
- `ΔPPW`: the change in my average weekly starting points in the regular season, and `ΔPPW_playoffs` for the playoff weeks.
- `g_mkt(me)`: my perceived market change (Section 9).

B compares my team before and after the trade, each after the free-agent optimizer (Section 7), so a trade never gets credit for a pickup I could make anyway.

**Redraft benefit**

```
B_win = 100 × (w_PO × ΔPO + w_CH × ΔCH)                     // in percentage points; the weights from "What does your league reward?" (below)
B     = B_win + (B₃ / 3) × κ × clamp(g_mkt(me), −0.5, 0.5)   // the market term, priced in lineup points (Phase 7b); κ from "Protect my trade value"
```

**Bench value** (planner addendum to Checkpoint 3, §3; `reports/planner-reply-3b.md`). My own players have two kinds of value beyond the starting lineup:
- **Depth for injuries and byes:** already in B_win, through the scenario lineups (Section 7). It stays there.
- **Trade value for later deals before my deadline:** the market term's weight is a user setting, **"Protect my trade value"**, priced in lineup points since Phase 7b (planner reply to Checkpoint 7a, §2 question 5; `config.benefit.protectValue`): κ = Low 1, Medium 2 (the default), High 4 projected points a week per 100% of trade value, and the term is (B₃ / 3) × κ × clamp(g_mkt(me)), on the same B₃ the evaluation's Helps you and Overall read (below), so on that scale it is worth exactly κ × clamp(g_mkt(me)) points a week in every league under every goal (`TradeEvaluation.marketWeekly`; the Analyzer's Details: "Trade value: −0.4 pts/week equivalent."). At Medium, giving 25% more value than you get (g_mkt(me) = −0.20) costs 0.4 points a week. Every B of an evaluation (its card, steps, Plan B, both simulations, the Analyzer) reads the B₃ its scores read. Before (the addendum to Checkpoint 3 until Checkpoint 7a): κ = 2 / 4 / 8 in B units (a fixed 1.0 before the addendum), so the same g cost a different lineup price in each league and under each goal (that example: 0.48 points a week under "Win the title" in Parker's league, B₃ 4.96, and 0.31 under "Make the playoffs", B₃ 7.63).
- The Market check warning (−15%) and the hide threshold (−35%) are unchanged. Dynasty and keeper leagues have no market term (B_future carries the value change), so the setting is offered in redraft leagues only. ⚠️ The planner's reply to Checkpoint 7a adds "Dynasty and keeper: the term stays inside the win-now part"; our reading is that there's no term there to place, so nothing changes (were one added, it would sit inside B_win's (1 − λ) share).
- Phase 4b (planner reply to Checkpoint 4, change 4): every package floors each player at W on both sides (Section 9), so the market term reads the same g_mkt(me) as the card's Market check (from Phase 4c to 7a the card's value line showed FantasyCalc's own values; since Phase 7b it shows none, Section 13), and ΔDyn is floored the same way on long-term values. It replaces Phase 4's lead decision N10, which floored only the players I give, in the market term and ΔDyn (an even swap of two players worth less than W then read as giving W for v).
- Phase 4c: the market term and ΔDyn leave out neutral throw-ins (Section 9). In the curve fallback (FantasyCalc unavailable for over 7 days, Section 2.9) κ = 0 (⚠️ lead decision: those values come from our own points, so the term would count lineup points a second time), and the search says once: "While FantasyCalc is unavailable, “Helps you” leaves trade value out, and the chance they accept uses our own estimates of trade value." The chance they accept, the Market check and the hide threshold still read the estimates. Phase 7b: ⚠️ κ = 0 also with no FantasyCalc values at all (ours: every g is 0 then, so the term is 0 either way; `marketWeekly` null says there's no term to show).

**What does your league reward?** (Phase 4c's "What matters most", planner reply to Checkpoint 4b, change 8; reworded in Phase 7b by what the league's prizes reward, planner reply to Checkpoint 7a, 5.2; `config.benefit.goals`, `TradeSettings.goal`): B_win's weights are a per-league setting. Never switched by playoff odds (the planner: "Win the title" already values making the playoffs, since you can't win without getting in, and switching a bubble team to "Make the playoffs" would push it toward safe moves exactly when it needs upside; the right choice depends on the league's prizes, not the team's odds). Helper line: "On the bubble? Keep “Only the champion.” It already counts getting into the playoffs." Since Phase 7b it also sets the automatic playoff-week weight (Section 7).

| Option (Phase 7b label; goal) | w_PO | w_CH |
|---|---|---|
| **Only the champion** (default; "Win the title", `title`) | 0.15 | 0.85 |
| Top finishers too ("Balanced", `balanced`: the weights before Phase 4c) | 0.35 | 0.65 |
| Making the playoffs ("Make the playoffs", `playoffs`) | 0.70 | 0.30 |

- Parker's main goal is the title. Phase 4c kept B_ref 6 and reported (a planner question at Checkpoint 4c) that on Parker's data a uniform +1, +3 and +6 points a week move ΔPO about twice as much as ΔCH (+3: +9.1 against +4.2 points), so a fixed B_ref read the same gain differently under each goal (under "Win the title" Helps you 23, 56, 83; Balanced 28, 63, 87). The planner's answer (Checkpoint 4c, answer 1): neither 6 nor 5; calibrate the scale per league and goal, B₃ below (Checkpoint 7a).

**Dynasty and keeper benefit**

```
B_future = 40 × ΔDyn / MyDynTotal    // ΔDyn = change in my roster's dynasty value, including picks and the waiver credit
                                     // gaining 10% of my roster's value ≈ +4
B = (1 − λ) × B_win + λ × B_future
```

- λ is a user slider from "Win now" to "Future".
- Default λ by my P(playoffs):
  - 0.5 or higher → 0.35
  - 0.2 to 0.5 → 0.5
  - below 0.2 → 0.75
- Keeper leagues default to λ = 0.2. Keeper costs aren't modeled, and the UI says so.
- When a keeper league's dynasty values couldn't be loaded, ΔDyn treats long-term values as missing, and the card says so.
- Phase 4 details (`src/engine/benefit.ts`): when title odds are unknown but playoff odds aren't (a played playoff round without a result we can match, or a league that lists fewer playoff rounds than its bracket needs), B_win = 100 × (w_PO + w_CH) × ΔPO = 100 × ΔPO under every goal, so B stays on the Trade Score's scale, and the search says so once (approved by the lead, ⚠️). An unknown P(playoffs) gives λ 0.5. Dynasty and keeper B has no market term: B_future carries the value change. Picks take no roster spot, so they earn no waiver credit. B ≤ 0, or a B not known yet, gives no Trade Score or Overall.

**Trade Score (shown as "Helps you")**
- `Trade Score = round(100 × (1 − e^(−B / B₃)))` when B > 0 (Checkpoint 7a; planner reply to Checkpoint 4c, A2). Before, the divisor was a fixed B_ref: 5 at first, 6 from Checkpoint 3 (answer 1) to Checkpoint 4c.
- **B₃, the self-calibrating scale** (`benefit.helpsScale`, `league.helpsCalibrationOf`): B₃ is the B of a uniform +3 projected points a week (`config.benefit.helpsGain`) for my team in every week a trade can change (the weeks team numbers count, regular season and playoffs; a week under way is left out, as every trade holds it as rosters stand; σ unchanged), on the same baseline (every team after its pickups: `LeagueModel.odds`), under the same goal, on the same seasons (the final block, common random numbers). ΔPO₃ and ΔCH₃ are simulated once per League model build (`LeagueModel.helpsCalibration`, step 8c, about 12 ms); the trade context runs the same function on its own final block (equal bit for bit, tested). B₃ for a search or an Analyzer evaluation, under its goal: in redraft leagues (and dynasty and keeper leagues without long-term values) B₃ = B_win₃, the B of that change with no market term (g_mkt(me) 0). In dynasty and keeper leagues with long-term values, since Phase 7b (planner reply to Checkpoint 7a, §2 question 6: "the dynasty scale follows the slider"), B₃ = B_ref(λ) = (1 − λ) × B_win₃ + λ × F₁₀, F₁₀ = the B_future of gaining 10% of my roster's long-term value (40 × `config.benefit.helpsFutureShare` 0.10 = 4), λ the trade's (the slider, else the default): a trade worth +3 points a week this season together with +10% long-term value reads 63 at every λ, and Helps you and Overall both read B_ref(λ). (Checkpoint 7a: (1 − min(λ, 0.75)) × B_win₃, the lead's cap `helpsLambdaMax` and its note: λ → 1 had shrunk the scale to the floor, so any long-term gain read about 100.) The title-unknown rule (playoff odds alone, scaled up) applies to B₃ as to B. So +1, +3 and +6 points a week read about 28, 63 and 86 in every redraft league under every goal (and wherever the scale is B_win₃); ⚠️ "about": B isn't linear in the gain (Parker, "Win the title": 28 / 63 / 88).
- **The floor:** B₃ (B_ref(λ) with long-term values) is at least `helpsFloor` (0.5). The note "Your title odds barely move with lineup changes right now." shows (once per search or evaluation) only when B₃ is floored (a floored B_ref(λ) needs λ under 1/8 and B_win₃ under the floor too); ⚠️ it names the playoff odds ("Your playoff odds barely move …") under "Make the playoffs" or when title odds are unknown. (Checkpoint 7a's Win now ↔ Future note, "Your Win now ↔ Future setting counts later seasons 90%, so adding 3 points a week … reads 33 on Helps you, not 63.", went with the cap in Phase 7b.)
- **Shown:** the "Helps you" tile's tooltip, "63 ≈ as good as adding 3 points a week to your lineup for the rest of the season."; ⚠️ the same sentence in the Finder's and Analyzer's info line, since a phone can't hover, and How to read gives the scale in words ("Whatever your league rewards, 63 is about as good as adding 3 points a week … (28 for 1 point a week, 86 for 6)." and, only when the floor note shows, "When that doesn't hold for your team right now, a note on the page says so."); the Analyzer's Details end with "Helps you N ≈ +X pts/week: as good as adding that to your lineup every week for the rest of the season.", X = 3 × B / B₃ to one decimal ("as costly as losing that …" for a negative B). Since Phase 7b ("the tooltip follows the mix"), in a dynasty or keeper league with long-term values: "63 ≈ as good as adding 3 points a week to your lineup this season together with 10% more long-term value for your roster, weighed by your Win now ↔ Future setting" with what each alone reads at the trade's λ (for example "(3 points a week alone reads 50, and 10% more long-term value alone reads 26)"), at Future "63 ≈ as good as adding 10% more long-term value to your roster.", at Win now the season's words; the Analyzer's line then reads "Helps you 45 ≈ +1.8 on a scale where +3 is as good as …" (⚠️ ours: never "+X% long-term value", which would read as the trade's own change). Every card, step, Plan B box and Analyzer result of a search uses its one B₃ (`TradeEvaluation.b3`; `TradeSearchResult.helpsScale` carries what the tooltip words).
- History (review of track SC, a planner question at Checkpoint 7a): until Phase 7b the scale calibrated lineup gains only. The redraft market term stayed in the Checkpoint 3 addendum's B units, so where B₃ was small (a weak team, the floor, title odds unknown after the regular season) a trade-value change read large on Helps you (Team 2 of Parker's league, B₃ 1.36: a pure +25% value gain read 52 at Medium; at the floor a +15% gain read 70), and in dynasty and keeper leagues at high λ a large long-term gain read near 100. The planner's reply to Checkpoint 7a answered both: the market term is priced on B₃ (above), and the dynasty scale follows the slider.
- Trades with B ≤ 0 are hidden by default.
- Sample values (B in units of B₃; at B₃ = 6, the old B_ref, these are B = 2, 3, 6, 9, 12 and 18):

| B / B₃ | 1/3 | 1/2 | 1 | 1.5 | 2 | 3 |
|---|---|---|---|---|---|---|
| Helps you | 28 | 39 | 63 | 78 | 86 | 95 |

- **Planner's check (history):** in a 12-team toy simulation with 10 weeks left, +1 point per week of lineup gain gave B ≈ 1.7, +3 gave B ≈ 5, and +6 gave B ≈ 10. In Parker's league (Checkpoint 3, 11 regular-season weeks left) they gave B ≈ 2.05, 6.3 and 12.4, so B_ref became 6. Checkpoint 7a, Parker's 2026-10-04 09:24 UTC data (13 weeks a trade can change, weeks 5–17): ΔPO₃ +9.08 and ΔCH₃ +4.23 points, so B₃ is 4.96 under "Win the title", 5.93 under Balanced and 7.63 under "Make the playoffs"; none floored. Phase 7b, the same data under the automatic playoff weight (ω 1.98, which changes the pickups behind the baseline): 4.94 under "Win the title" (5.88 and 7.53 for the other goals on that same model; ⚠️ the app builds each goal's model with that goal's own ω, so its B₃ there can differ a little).

**Three numbers on every trade**

| Number | What it is | Formula |
|---|---|---|
| **Helps you** | How much the trade improves your team, 0–100 | The Trade Score above: round(100 × (1 − e^(−B/B₃))) |
| **Chance they accept** | Estimated %, labeled "Est." | P_complete (Section 11) |
| **Overall** | The expected gain, 0–100 | round(100 × (1 − e^(−(B × P_complete)/B₃))) (B_ref 6 until Checkpoint 7a; B₃ = B_ref(λ) in dynasty and keeper leagues with long-term values since Phase 7b) |

- Overall is how much a trade helps, discounted by the chance it actually happens. It's always at or below Helps you.
- Phase 4 reading (⚠️, §11's "show both numbers when they differ"): the card prints P_accept with its label as "Chance they accept", and when the veto rule cuts it, P_complete next to it ("about 25% it goes through"). Overall, the ranking, the sorts and the offer-first steps' thresholds use P_complete.
- Sample values (at B₃ = 6; the same Helps you and chance give the same Overall at any B₃):

  | Helps you (B) | Chance they accept | Overall |
  |---|---|---|
  | 57 (B = 5) | 50% | 34 |
  | 81 (B = 10) | 30% | 39 |
  | 39 (B = 3) | 80% | 33 |
  | 74 (B = 8) | 60% | 55 |

- **Don't add extra factors to Overall.** Trade-value fairness, injuries, the number of players, manager activity and season context already feed into B or P_complete. Counting them again would double count and make Overall harder to explain.

**Guards** (shown as risk flags on the card, separate from the three numbers)
- If `g_mkt(me)` < −0.15, add a "Market check" warning.
- If `g_mkt(me)` < −0.35, hide the trade by default.
- Flag any trade that depends on a player who is currently OUT or on IR (Phase 4: OUT, IR or PUP, `benefit.injuredStatuses`; PUP is a reserve list like IR).

**Always show the numbers behind the score:**
- ΔPPW
- ΔPO and ΔCH
- ΔDyn, in dynasty leagues (in words since Phase 7b: "Up for your roster", "Down for your roster", "About the same for your roster")
- value given and value received (until Phase 7b; since then no trade value number or comparison shows anywhere, FantasyCalc's condition, Section 2.9: the card says "These numbers weigh each player's trade value." with the "Values: FantasyCalc" link, Section 13)

---

## 11. Acceptance probability

This estimates P(the partner accepts). It's a model, not a promise, so the UI labels it "Est." and rounds it to the nearest 5% (since Phase 4c a value under 5% shows as "<5%", never rounded up).

### Features (P = the partner)

| Feature | Definition |
|---|---|
| **g** | `g_mkt(P)` from Section 9, as the partner perceives it (the star premium below), clamped to [−0.5, 0.5]. `g⁺ = max(g, 0)` and `g⁻ = min(g, 0)`. |
| **n** | `ΔLineup_P / 5`, clamped to [−2, 2]. ΔLineup_P is the change in P's average weekly starting-lineup points, blended 50/50 between the next 4 weeks and the rest of the season. It is not the same as ΔPPW in Section 10. Both sides are measured after P's free-agent optimizer (Section 7), as for B. +5 points per week = 1 unit. |
| **h** | 1 if the trade gives P a starter at a slot where their current starter over the next 3 weeks is below 60% of the league median at that slot (an injury or bye hole). Otherwise 0. |
| **c** | Total players in the trade minus 2, so 0 for a 1-for-1. |
| **a** | Activity level (see below). |
| **hist** | The average `g_mkt(P)` over P's completed trades this season, at current values. Only used when P has at least 1 trade. Clamped to [−0.15, 0.15]. A positive value means P usually wins trades on value, so it *lowers* acceptance (see the minus sign in the model). |
| **ctx** | Season context (see below). |
| **hot** | Recency bias (see below). |
| **urg** | +0.2 within 7 days of the trade deadline. When the deadline is only given as a week number, apply it during the deadline week and the week before. |

**Activity (a).** Use the first rule that matches, in this order:
1. +1 if P made at least 2 trades this season, or at least 1 in the last 4 weeks
2. −2 if P had no transactions in the last 5 weeks
3. −1 if P had no transactions in the last 3 weeks
4. otherwise 0

**Which values g uses:** redraft values in redraft and keeper leagues, and dynasty values in dynasty leagues.

**Star premium** (planner addendum to Checkpoint 3, §1). Managers value their own best players a bit above market value.
- For each player j the partner gives, their perceived value is v′_j = max(v_j, W) × (1 + e_j) (the floor since Phase 4b, Section 9), e_j = e_rank + e_elite:
  - **e_rank** by j's rank by market value on the partner's roster (ties: more ROS points): #1 → 0.10, #2 → 0.05, others → 0. By market value, not lineup cost: managers think of "my best players" by name and value.
  - **e_elite** = 0.10 if j is among the top 12 overall by FantasyCalc value in the league's format.
  - **Dynasty only:** for a rebuilding partner (P(playoffs) below 25%), e is halved for RBs and WRs aged 27 or older.
  - No separate contender multiplier: contenders already weigh lineup gains more (n × 1.3).
- **Where it's used:** v′ replaces v for the partner's given players in the partner's g (quick and full acceptance). The waiver credit is unchanged. My g_mkt and B use values without the premium (floored at W like every package since Phase 4b).
- **Calibration:** these are starting assumptions. Phase 6 fits a scale factor for e alongside the β refit, from Accepted and Rejected outcomes and "They'd never accept" reports.
- **Card reason** when it applies ("Their best player (or a top-12 player): expect them to want a little extra."): see Section 13.
- Phase 4 readings (`src/engine/premium.ts`):
  - The rank counts every player the partner rosters (active, IR and taxi), by perception value (estimates and floors count; a player without a model counts 0), ties by more ROS points, then the smaller id. The top 12 is the whole FantasyCalc perception list for the format (FantasyCalc values only; ties at the cut by the smaller id). The trade context uses its own baseline's P(playoffs) for the dynasty halving; the League page uses the League model's odds.
  - ⚠️ Everything except the acceptance g stays without the premium (floored at W like every package since Phase 4b): TradeEvaluation.gPartner (the reasons' clauses and the report, and the Trade Analyzer's "Details" until Phase 7b; no card prints it since Phase 4c, no page since Phase 7b), hist (past trades), the §12 screening window, and the veto rule (league members judge a trade by the market, not by the owner's attachment).
  - v′ is applied before the stud exponent (identical at γ = 1).
- **Anchor tests** (default coefficients, W = 752, within ±0.5 points; through the real package and acceptance functions; Phase 4b's numbers, after the β_need change, Checkpoint 4's in brackets):

  | Case | P_accept |
  |---|---|
  | 1-for-1, equal raw value; partner's #1; top-12; contender; no lineup change | 10.9% |
  | 1-for-1, equal raw value; partner's #6; not top-12 | 35.4% (unchanged) |
  | Partner gets 4,000 + 3,500 + 3,500 for their #1 top-12 player (9,000); contender; n = 0.6; fills a hole | 32.8% (23.4%; 51.3% before the addendum) |
  | The same trade, where the RBs help them twice as much (n = 1.2) | 55.4% (32.8%) |
  | 1-for-1, equal raw value; partner's #2; not top-12 | 26.3% |
  | 1-for-1; partner's #1, not top-12; contender; partner gets 30% more raw value | 62.0% |

**"Harder to get"** (addendum §2): a player with e ≥ 0.15 for his owner (a top-12 player who is also his team's #1 or #2) is tagged on the League page and on trade cards (Sections 13 and 14). In Parker's league: every team's #1, plus two #2s (12 players).

**Phase 4 readings** (`src/engine/acceptance.ts`):
- **n:** the blend weight is config (`nBlendWeight` 0.5 on the next 4 weeks), from the first week team numbers count, every remaining week unweighted (regular season and playoffs).
- **h:** a hole is one of P's slot instances whose starter averages below 60% of the league median there over the next 3 weeks (P's V* lineups). The trade fills it when that instance's starter averages more after the trade and a received player who can play the slot starts for P. Instances are sorted by points within a slot, so a received RB better than P's RB1 fills an RB2 hole by pushing the old RB1 down (review of track B). A hole only a free agent fills doesn't count. ⚠️ A cascade through two different flex slots (a TE at W/T pushing a WR into a W/R hole) is missed.
- **c** is never below 0 (a 1-for-0 the Analyzer can build isn't simpler than a 1-for-1).
- **a:** "the last N weeks" are the transactions whose week is above (league week, else NFL week) − N; any transaction type counts; trades count only once completed.
- **hist:** the average of P's completed trades' g at current perception values; only the average is clamped (review of track B). A trade where P gave nothing of value counts +∞, so hist is +0.15. Left out: trades without both of P's sides (hidden, or refilled ESPN trades whose players were dropped since), with a player who has no current value, or with picks (until picks have values).
- **hot:** the last 2 completed NFL weeks (not his last 2 games), against Sleeper's past projection, else ESPN's; his points are Sleeper's stat lines scored with the league's rules (the model inputs' actual points), so a player without a Sleeper id is never hot. ⚠️ Sleeper re-stamps past projections after the games (Section 2.3).
- **urg:** from 7 days before the deadline date through the deadline; with only a week, the deadline week and the week before; 0 after.
- **Display:** rounded to the nearest 5%, and the label is judged on the shown value (14.9% shows "15%" and reads "Possible"). Phase 4c (planner reply to Checkpoint 4b, answer 5): a value under 5% shows as "<5%", never rounded up to 5% (before, the clamp's 2% showed as 5%).

**Context (ctx).** P(playoffs) here always comes from the baseline simulation (before any trade), computed once per search.
- **Redraft and keeper:** if P's P(playoffs) is below 5%, −0.8 (they've checked out).
- **Dynasty, rebuilding partner** (P(playoffs) below 25%): −0.25 for each RB or WR they'd receive who is 28 or older (the ages live in config).
- **Any league, contender partner** (P(playoffs) above 60%): multiply n by 1.3.

**Recency (hot)**
- +0.15 if a player P receives scored at least 1.5× his projection in each of the last 2 weeks.
- −0.15 if a player P gives up did that.
- Past-week projections come from Sleeper's projections endpoint for that past week, or from ESPN statSourceId 1 entries for that scoring period. Actual points come from the league's matchup data. If either is missing, hot = 0.

### Model

```
z = β0 + β_gain·g⁺ + β_loss·g⁻ + β_need·n + β_hole·h − β_cx·c + β_act·a − β_hist·hist + ctx + hot + urg
P_accept = clamp(σ(z), 0.02, 0.85)          // σ = logistic function (the cap was 0.95 before Phase 4b)
```

Default coefficients:

| β0 | β_gain | β_loss | β_need | β_hole | β_cx | β_act | β_hist |
|---|---|---|---|---|---|---|---|
| −0.6 | 6 | 9 | 1.2 (redraft, keeper) / 0.6 (dynasty) | 0.4 | 0.25 | 0.35 | 3 |

β_loss is larger than β_gain on purpose: people feel losses more than gains.

**Phase 4b** (planner reply to Checkpoint 4, change 2): β_need is 1.2 in redraft and keeper leagues (`beta.need`): there a manager's own lineup should weigh more (Checkpoint 4's top card showed 55% for a trade that cost the partner's lineup 4.7 points a week). Dynasty stays 0.6 (`beta.needDynasty`). The contender factor's extra term uses the same β_need. The cap is 0.85: no offer is a sure thing, and Overall still never exceeds Helps you.

**Veto risk**
- If `tradeReview` ≠ 'none' and g < −0.30: `P_complete = P_accept × 0.5`.
- Otherwise `P_complete = P_accept`.
- Rank on `P_complete`, and show both numbers when they differ.

**Required anchor tests**

With the default coefficients, unit tests must hit these values within ±0.5 points (Phase 4b; ±1 before). The planner computed them (redraft unless noted; Checkpoint 4's numbers in brackets where they changed):

| Scenario | P_accept |
|---|---|
| Even value; n = 0.5; fills a hole; active (a = +1) | 67.9% (61.1%) |
| Even value; nothing else | 35.4% |
| g = −0.10; n = 0.5; fills a hole | 37.8% (31.0%) |
| g = −0.20; nothing else | 8.3% |
| g = +0.15; n = −0.3 | 48.5% (53.0%) |
| Even value; inactive (a = −2) | 21.4% |
| 3-for-1 (c = 2); even value | 25.0% |
| g = +0.30; n = 0.5 | 85.0%, the cap (81.8%) |
| Dynasty: even value; n = 0.5; fills a hole; active | 61.1% |

**Labels**

| P_accept | Label |
|---|---|
| under 15% | Long shot |
| 15–35% | Possible |
| 35–55% | Decent |
| 55% and up | Likely |

**Feedback on every suggestion**

The model will be wrong in places, especially the acceptance estimate until it has real results to learn from.
- **On each trade card:**
  - outcome buttons: **Sent**, **Accepted**, **Rejected**, **Countered**
  - a **Report** button with these reasons: Doesn't help me · They'd never accept · Player info is wrong (injured, traded, wrong position) · League settings look wrong · Other, with an optional note
- **Phase 4 (local only):** store each report and outcome in the browser, together with the trade's model inputs and scores. Settings has an "Export feedback" button that downloads them as JSON. A script summarizes reports by reason and by model part.
- **Phase 4b** (Checkpoint 4 answer 8): the record also keeps which version was sent: "Offer first", "Full trade" or "Plan B". A card that shows two versions asks which one on the first outcome pressed, worded for that outcome ("Which version did you send?", "… did they accept?", "… did they turn down?", "… did they counter?"); a plain card records the full trade; clearing the outcome clears the version, and the card's "Version:" line says "an earlier one (…)" when the version recorded is no longer one the card shows. The record keeps the sent version's trade key and estimate, and since Phase 4c (planner reply to Checkpoint 4b, change 7 and answer 9) its model inputs too (`versionInputs`: the acceptance features g, n, h, c, a, hist, ctx, hot, urg and z, where g is the partner's perceived g with the star premium; the partner's g without the premium, `gPartner`, so the premium is the difference; B; and the goal B was weighted by), so Phase 6 can refit on the version actually sent; the export carries it, `npm run feedback:summary` counts outcomes by version, and older records read as unknown. Phase 6 analyzes it.
- **Phase 7 (public launch):**
  - Send reports and outcomes to a small server-side store on a free tier.
  - Store only anonymized data: player IDs and positions, league format settings, model inputs and scores, and the reason and the outcome.
  - Never store league IDs, team names, owner names, usernames, SWIDs or cookies.
  - Say so plainly in the UI and in the privacy policy, give users an opt-out toggle, and rate-limit submissions.
- **Built at Checkpoint 7a** (planner reply to Checkpoint 4c, B2; `src/lib/feedbackShare.ts`, `feedbackEvent.ts`, `src/server/feedbackSink.ts`, `src/app/api/feedback`):
  - **When:** a card's outcome or Report press is saved in the browser first, as before; once kept, and while Settings' **"Share anonymous feedback"** is on (the default; per browser, localStorage `offersheet:feedback-share:v1`), the record as it now stands goes as one anonymous copy to `POST /api/feedback`, 2 s later, debounced per record (Sent then Accepted sends one copy), once, with keepalive, failures silent; a waiting copy goes at once when the page hides. Turning sharing off, or undoing the press before the copy leaves, sends nothing. Presses on one card are shared in the order they were made, each copy built from the record as that press alone left it. A press that removes a record sends a take-back copy (no outcome or reason). The first copy a browser sends shows once, in the card's status line: "Sent anonymously to help improve Offer Sheet. You can turn this off in Settings."
  - **What a copy holds** (`FeedbackCopy`, a strict zod schema on the server: unknown fields refused at every level, every string a closed set or an exact pattern, every number bounded): a random share id per local record (`rid`, 16 random bytes, derived from nothing; later copies of the record carry it, so the latest copy per id is the record), kind (outcome or report), the outcome or reason, the version sent and, when it isn't the card's trade, that version's players (`versionTrade`), the platform, the season, week and goal the numbers were computed for (the record's `basis`), the league format (teams, league type, scoring keys, lineup slot counts by the positions a slot takes, playoff teams), the trade's players (canonical ids in the exact forms the app makes: Sleeper ids, team-defense codes, `espn:<id>`; and positions; no partner id), the card's numbers (Helps you, chance as printed, Overall, B, B₃, P_accept, P_complete, ΔPO, ΔCH, ΔPPW, both sides' g), the acceptance features and the sent version's inputs (with B₃, the scale's reason and its week). **Never:** league ids, team ids, team or owner names, usernames, SWIDs, cookies, the league's short hash, typed notes, IP addresses or a time finer than the day. A trade with a draft pick, or ids of another form, sends nothing.
  - **The store:** Upstash on Vercel only; each copy plus its UTC day (nothing else about the request) goes to one list per UTC day (`os:<env>:fb:YYYY-MM-DD`; final review SEC-3: a flood can only crowd out its own day) in one transaction (LPUSH, LTRIM to the newest `feedbackLimits.maxPerDay` 100, PEXPIRE to `retainDays` 365 after the list's UTC day began, so a day's list goes a year after that day began and no copy outlives the privacy page's "up to 12 months" (Phase 7b, `feedbackDayTtlMs`, the error log's rule; before, each write reset it to a full year, so a day's first copy could stay up to a day longer); 3 commands a copy); a stored copy is at most 2,048 bytes. Each visitor may send 30 copies a day and its group 60 (counted under the same HMACs as the work budget, deleted a minute after the UTC day ends); past that 429. No store (development, the stable copy, tests): 202 `{ stored: false }`; a failed write is logged by name and answers the same. A refused copy is logged as `feedback_invalid` with the failing field's code only, at most once every 10 minutes per instance. Rate limit: 60 copies an hour per IP (in each instance's own window since Phase 7b: Section 3). About 1 KB a copy; at most about 75 MB at the caps (45 MB with real copies).
  - **Reading it** (Phase 7b; planner reply to Checkpoint 7a, §4 privacy item 3: "read straight from Upstash and save only aggregate results and fitted numbers locally, never raw records"): `npm run feedback:report -- --live` (`--env production`, `--days N`) reads the day lists straight from the store (one LRANGE a day), checks every entry against the store's schema (one that doesn't parse is counted, never printed or kept) and keeps only totals, on the console and in git-ignored `data-local/feedback-report.md`: copies, records (a record's copies share its `rid`; the latest is the record) and take-backs; per record its outcome, reason, version sent, goal, platform and league type; the acceptance calibration (each record's predicted P_accept in the label bins against Accepted and Rejected); the refit's readiness; and the days to check (a day at the store's cap or far above a usual day: Phase 6 drops or down-weights them). Never a copy, an id, a player, a record's own numbers or a note. Phase 6's refit reads the store the same way and keeps only the fitted coefficients. It replaced `npm run feedback:pull` (Checkpoint 7a), which saved the copies themselves to `data-local/feedback-server/` and came with the privacy page's promise that the developer runs it at least monthly; that promise is gone ("We keep anonymous feedback for up to 12 months, then delete it."), and feedback:report says when an old `data-local/feedback-server/` folder is there, to be deleted. The local record (Export) keeps its `rid`, so Parker's export can be matched to its server copies.
- **How the data is used:**
  - "They'd never accept" and Rejected outcomes refit the acceptance coefficients. Once there are at least 30 outcomes, a Node script refits the β coefficients with logistic regression, using an L2 prior that pulls toward the defaults.
  - "Doesn't help me" triggers a review of the benefit and projection logic for those cases.
  - "Player info is wrong" and "League settings look wrong" go to a bug queue for the adapters.

**Phase 6 sanity check**
- Pull recent completed trades from public Sleeper leagues. Find leagues by snowballing through league member lists, and stay under the rate limits.
- Check that at least 80% of those trades have |g| ≤ 0.20 at current values.
- Report the distribution.

---

## 12. Trade search

**User settings**
- max players per side: default 2, allow 3 (Settings offers 1 to 3)
- "Protect my trade value": Low / Medium (default) / High, redraft leagues (Section 10; 1 / 2 / 4 points a week per 100% of trade value since Phase 7b)
- untouchables
- must-include players
- positions to target or avoid
- include P, K, DEF and IDP (excluded by default, Section 9)
- "What does your league reward?": Only the champion (default) / Top finishers too / Making the playoffs (Phase 7b's words, planner reply to Checkpoint 7a, 5.2; Phase 4c's "What matters most": Win the title / Balanced / Make the playoffs; Section 10). It weighs B and sets the automatic playoff-week weight (Section 7), so changing it searches again.
- no playoff-week weight setting since Phase 7b: the weight is automatic (Section 7), and Settings shows it read-only
- "Chance they accept: at least" Any / 10% (default) / 20% / 30% / 40% / 50%, the Trade Finder's filter (Phase 4c, Section 13)
- include draft picks (dynasty leagues). ⚠️ Phase 4: deferred to Phase 5 (a planner question at Checkpoint 4): the model inputs carry no pick values yet (FantasyCalc's pick rows are kept apart and not passed on) and only Sleeper and MFL report traded picks. The setting is kept; with it on in a dynasty or keeper league the search says "Draft picks aren't part of trade ideas yet.", and the Analyzer offers players only.

**Steps**

1. **Precompute** p, LV, ROS, MV_add and MV_lose for every team. Memoize LV by roster hash and week.

2. **For each partner P:**
   - **Give pool G:** my top 10 players by surplus score, plus every trade chip of mine (Section 7), excluding untouchables.
     - Surplus score = z(v_i) − z(MV_lose(me, i)), with both z-scores taken within my roster.
     - Sort highest first: high market value, small loss to my lineup.
   - **Get pool H:** P's top 10 players by `MV_add(me, j)`, keeping only those above 0. Since the planner's addendum (§2): the top 10 by MV_add(me, j) among untagged players, plus the top 3 "Harder to get" players, so star trades are still evaluated and rank on their honest acceptance.
   - **Must-include players** always go into the right pool, and every candidate trade must contain them.
   - **Screening objective** = my ΔROS (fast lineup method) × quick P_accept.
     - The quick P_accept is the Section 11 model using g, n (fast lineup method), h, c, a, hist and ctx.
     - It leaves out hot, urg and the veto rule.
   - Enumerate every 1-for-1 in G × H and score each one with the screening objective.
   - Take the best 60 and extend each by one more player, either from G (my side) or from H (their side). That produces 2-for-1, 1-for-2 and 2-for-2 trades.
   - Phase 4c (planner reply to Checkpoint 4b, change 1): also every 1-for-2 and 2-for-1 from the whole give and get pools, and every 2-for-2 from the first 6 of each pool (`search.exhaustive.twoForTwoTop`), through the same screening and funnel. Beam extension missed two-player packages when neither half helped alone (Wilson → Chuba Hubbard + Mike Evans).
   - If the max per side is 3, extend the best 40 of those once more, the same way.
   - Drop any trade whose g_mkt(P) falls outside [−0.35, 0.6].
   - Keep this partner's top 30 by the screening objective.

3. **Exact evaluation.** Take at most 200 trades across all partners, the best by screening objective. For each: check legality, work out drops and adds, solve exact lineups for both teams over the availability scenarios (Section 7), then compute n, h and P_accept.

4. **Screening simulation.** Run 1,000 simulations with common random numbers on every exactly-evaluated trade to get a first B.

5. **Final simulation.** Take the top 60 (40 before Phase 4c) by B × P_complete and rerun them with 5,000 simulations. This gives the final B, Trade Score and P_complete.

6. **Rank and diversify** (Section 13) and return the top 25.

**Performance target**
- 10 seconds or less for a 12-team league on a mid-range laptop, in the Web Worker, with a progress bar.
- Report actual timings at each checkpoint.

**Phase 4 details** (`src/engine/evaluate.ts`, `search.ts`; lead decisions M1–M8 and the reviews)
- **The context**, built once per search or Analyzer session: the League model's steps (projections, scenarios, values, streaming, every team's V*(T) and lineup costs, chips, surplus scores) with no simulation of its own; the baseline is every team at V*(T), each team's weekly score built from V*(T)'s lineups as TeamModel.score is (streaming rows included). ⚠️ A week in progress keeps each team's League-model week-0 score (rosters as they stand, before kickoff) before and after every trade: a trade or pickup can't change a week under way; a trade made before kickoff counts the current week in full (the platform's review period isn't modeled). Partner profiles, hot players, urgency, values, hole medians, slot ranks and my risky weeks are computed once. Notes that stop the search (the Analyzer still evaluates, except without a team): no team picked, no weeks left, my team certainly out in a redraft league, the deadline passed, no odds.
- **Pools:** active-roster players with a model (Phase 4b: and IR players with a model; taxi players never). G = my top 10 by surplus score (an IR returner's lineup cost is his removal cost from V*(me)'s lineups) after the filters (untouchables, excluded positions), plus my chips and my must-include players (must-include always stays, even when untouchable). H = each partner's top 10 untagged and top 3 "Harder to get" players by MV_add(me, j) in EV lineups (League-model rule) above 0, after the position filters (planner addendum §2), plus their must-include players. A partner's IR player is priced as a returner on V*(me) when I'd have an open IR slot and he's eligible, else like any player. Must-include ids on no active roster or IR are ignored with a note; on two or more other teams: no trades, a note; one partner's: only that partner is searched.
- **Screening:** EV lineups from V*(me) and V*(P) minus what goes plus what comes, legality in EV mode, ⚠️ not re-optimized (for speed); objective = my ΔROS × quick P_accept; exact shortcuts re-solve only the weeks a trade can change (checked against fresh solves on 2,800 trades). An extension adds one player from G, one from H, or one to each side (pairing the 5 best single additions per side); max per side 2 extends the best 60 seeds once (2-for-1, 1-for-2, 2-for-2), 3 extends the best 40 of those once more. Then the g_mkt(P) window [−0.35, 0.6] (market values floored at W, without the star premium), 30 per partner, 200 overall. Ties everywhere: the objective, then the key.
- **Exact evaluation:** legality in scenario lineups, then both sides' V* from scratch on the post-legality rosters, scenario lineups, n, h, g, the card's numbers and the explanation facts. Since Phase 4b the two sides go in free-agent allocation order, each from its own pool (Section 7, "One free agent, one team").
- **Simulations:** the baseline's setup with only my team's and the partner's rows replaced (common random numbers). The screening (1,000 seasons) and the final run (5,000) use separate blocks of one matrix, so the final numbers come from seasons that played no part in choosing the trades (review of track E: reusing them biased the shown B upward, +0.26 on average); the Analyzer and the baseline odds use the final block. Title odds are exact per season (Section 8).
- **Dominance pruning** (⚠️ lead decision N11, reported at Checkpoint 4; in the spirit of §13's filler rule): after the beams and the g window, a screened trade that gives one of my players worth at most the waiver credit W (less than W before Phase 4c) is dropped when the same trade without him (my side keeping a player) is inside the value window too and screened at least as well. Under §9's waiver credit (and Phase 4b's value floor, which counted him at W) such a player pulled the partner's g toward 0 and added a player to the trade; since Phase 4c's neutral throw-ins he moves neither g and only adds a player (the complexity term), so these variants are dominated, yet they took 85 of the 200 exact-evaluation slots on Parker's league (the 2026-10-01 data; 77 on the live data of 2026-10-03, 9 with the pruning).
- **Finalists:** the 60 (40 before Phase 4c) picked with §13's per-core, per-partner and (Phase 4b) per-given-player caps one looser (my must-include players exempt since Phase 4c), their window covering every finalist (Phase 4b final review: a top-20 window let finalists 21–40 of the then 40 be mostly players already at a cap, and the list showed 16 cards), then filled by EG, never one hidden by default; since Phase 4c they are chosen without the minimum chance, so a new minimum re-filters them without a new search. The strict §13 rules and the minimum chance apply in the final ranking (with Phase 4's 40 finalists, 21 of the 25 a full 5,000-season ranking of all 200 would show made it). Then the ranking (rank.ts), then the offer-first steps for the shown trades (§13) and their words (explain.ts, after the steps, so the pitch names the offer-first version).
- **Determinism and progress:** the same inputs give the same result; the generator yields every 100 screens, every 5 screening simulations and after each exact evaluation or final simulation (typically under 40 ms of work between yields on Parker's league in Node; a garbage-collection pause or a cold start can exceed it, and the report measures the longest), so the worker can slice and stop it. Parker's league (final numbers, the 2026-10-01 data, Node, median of 3): context 0.26 s, screening 2.0 s, exact 1.8 s, screening simulation 0.5 s, final simulation 0.5 s, steps and words 0.1 s, about 5 s in all; in the production browser worker (live league, 375 px) a first Trade Finder visit took 5.1–6.8 s and a warm search 2.8 s. Phase 4b (the 2026-10-04 data, Node, warm median of 3): context 0.25 s, screening 1.7 s, exact 1.25 s, screening simulation 0.5 s, final simulation 0.47 s, steps, Plan B and words 0.19 s, about 4.1 s; the same search again on its context 2.9 s; in the production browser worker 4.3 s (`npm run check:browser`).
- **Consistency (Checkpoint 4):** before and after both use V* judged in the lineups B is measured in, so no trade gets credit for a pickup I could make anyway: a test reproduces a sub-threshold depth pickup with a trade and gets ΔPO = ΔCH = ΔEW = 0 exactly, in EV and in scenario lineups.
- ⚠️ Known approximations: screening isn't re-optimized; a free agent a trading team gives up goes to nobody when a team sits between the two in the allocation order (Section 7); IR players: a player received from an active roster never uses an open IR slot, teams never move their own active OUT players into one, and the displacement is applied to final evaluations only (Section 7); the review period isn't modeled (Phase 6); picks are deferred (Phase 5).

**Phase 4c details** (planner reply to Checkpoint 4b; `src/engine/search.ts`, `rank.ts`, `pattern.ts`)
- **Exhaustive candidates** per partner on top of the beams (step 2): deduplicated by key with the beams, then the same legality, objective, g window, dominance pruning (since 4c a player worth at most W, as the neutral rule), keep-30 and 200 cap. ⚠️ Must-include players are in every candidate and don't count among a 2-for-2's first 6. With max 3 per side the third player extends the best 40 two-player trades among beams and exhaustive alike. `TradeSearchOptions.exhaustive: false` (a report switch) keeps the beams alone.
- **Lean companions** (⚠️ ours, in the spirit of change 2: a throw-in worth less than a free agent can only lower the chance they accept through value, so the app shouldn't suggest a pointless extra player): every trade that reaches exact evaluation and contains players the neutral rule leaves out brings its lean version (the same trade without them, when both sides keep a player, every must-include player stays and its g is inside the screening window) into exact evaluation too, on top of the 200, one per trade; the funnel decides between them, and the filler rule drops the bigger variant when the lean one ranks above it. Screening isn't re-optimized, so legality's free-agent add in the opened roster spot could make the bigger variant screen better (on the 2026-10-04 00:51 UTC data, live order, before the companions, Doubs + Nix → Metcalf was shown at 43.1% while Nix → Metcalf, never evaluated, reached 47.2% with the same Helps you). Companions skip the N11 pruning; stand-ins (cheap players left in for a roster-spot credit) bring none. `TradeSearchOptions.leanCompanions: false` (a report switch) turns them off.
- ⚠️ A cap on how many exact-evaluation slots may give the same player of mine (to fill the list) was measured and left out (the 2026-10-04 00:51 UTC data, live order: 17 of 25 cards without one): at most 3 trades per player within each partner's keep reached 21 cards alone, and 24 only together with at most 20 or 30 over all 200, both times by displacing a top-10 card (Harrison Jr. + Nix → Metcalf, Overall 6) for a lower one (Sutton → Goedert, Overall 5). On that data the 200 exact trades give a helping trade to only 8 of Parker's players, so the given-player cap binds first.
- **60 finalists** (`search.finalists`), chosen without the minimum-chance filter, so re-filtering is instant and consistent; no promise of a full list: on Parker's data 14 of 25 cards at 10%, because the 200 exact trades give only a few of his players and the given-player cap binds first.
- **The minimum chance** (Section 13) is applied in the ranking; `refilterSearch` re-ranks the same finalists for a new minimum and rebuilds the shown list's steps, Plan B, words and pattern note, reusing every evaluation already made (it equals a fresh search with that minimum, tested); the worker runs it without a new search.
- **Block order:** the final simulation reads seasons 1–5,000, the League model's own, and the screening the next 1,000 (Section 8), so a card's "before" is the League page's headline exactly.
- Parker's league (the 2026-10-04 09:24 UTC data, weekly reset order, Node, Checkpoint 4c): 17,215 trades screened (the beams alone 13,603), 206 evaluated exactly (the 200 and their lean companions), 60 finalists, 14 cards; warm median of 3: context 0.24 s, screening 2.45 s, exact 1.46 s, screening simulation 0.53 s, final simulation 0.71 s, steps, Plan B and words 0.23 s, 5.6 s in all (cold 5.7 s); a re-filter takes 11–38 ms; in the production browser worker a full search took 5.1 s (`npm run check:browser`, live data). Wilson → Hubbard + Evans is screened #1 of Team 4's 1,783 candidates and shows as card #3 (Helps you 30 / 35% / Overall 12); the beams alone never screen it.

---

## 13. Ranking, filters and explanations

**Ranking**
- Expected gain: `EG = B × P_complete`, shown as **Overall** (Section 10).
- Sort options:
  - **Overall** (EG): the default
  - **Helps you** (B)
  - **Chance they accept** (P_complete, among trades with B > 0)
- **Why Overall is the default:** a great trade nobody accepts is useless, and a trade that's sure to be accepted but barely helps is noise.

**Diversity rules**
- At most 3 trades per partner in the top 20.
- At most 2 trades sharing the same core, meaning the same highest-value player on each side.
- Drop variants that only add a filler player whose effect is under 0.2 × B.
- At most 3 trades in the top 20 that give the same player of mine (Phase 4b; Checkpoint 4 answer 7; `perGivenPlayerInTop20`). ⚠️ Phase 4c: my must-include players are exempt (they are in every trade; the cap cut such a search to 3 cards).
- **Minimum chance** (Phase 4c; planner reply to Checkpoint 4b, change 10 and answer 5): "Chance they accept: at least Any / 10% / 20% / 30% / 40% / 50%" (`ranking.minChanceOptions`), default 10%, saved per league. It is applied before the diversity caps, so the list fills with trades that qualify, judged on P_complete as the card prints it (nearest 5%: a trade at 7.5% passes "at least 10%"). It replaces nothing in our app (there was no hide-under-10% rule or long-shot toggle). ⚠️ When fewer than 5 ideas show (our reading of the planner's "qualify": counted on the list shown, which the variety caps can cut) and a lower setting would show more, the Finder says so and suggests one (`filter.few`; never at Any).

**Each trade card shows**
- You give / You get
- the three numbers: Helps you, Chance they accept (with its label) and Overall
- next to Helps you, the odds behind it (Phase 4c, change 9): "Title odds 12.1% → 13.4%" and "Playoff odds 65% → 69%" (before = the League page's headline odds, after = before + the trade's change), and "Win chance by week: Week 9: 68% → 64% · Week 13: 42% → 55%": the weeks whose win chance moves at least 3 points (`explain.weeklyLineMin`), up to 4 (`weeklyLineMax`), in week order; ⚠️ drops are kept first, then the largest gains (final review: showing where a trade costs me is the line's point). The reasons quote the odds change as the card prints it (whole points for playoffs, tenths for the title), so "60% → 65%" sits next to "by 5". When the roster spot is what trips the Market check, it says so ("Market check: you'd get 2 players for 1, and counting the roster spot that costs you, …"). It shows whether a trade only moves a bye problem to another week. Explained once on the page: "Helps you (0–100) sums up how much your title and playoff odds rise, minus a cost for giving away trade value or plus a credit for gaining it." (⚠️ the planner's sentence, with the credit added at the final review: in redraft leagues the market term works both ways)
- risk flags, separately: "depends on an injured player", "Market check" (Section 10)
- key numbers: ΔPPW, ΔPO, ΔCH (long-term value in words in dynasty and keeper leagues), then, when trade values are behind the card's numbers, "These numbers weigh each player's trade value." with a small "Values: FantasyCalc" link (Phase 7b; until then "Trade value: You give 6,500, you get 5,400 · Values: FantasyCalc": no value given or received shows since FantasyCalc's condition, Section 2.9)
- ROS points given and received (Section 6), for example "You get 142 ROS pts, give 118"
- any required drops and adds (Phase 4b: and IR moves: a received IR player who goes into an open IR slot, "Jordan Mason goes to your IR slot (no roster spot until he's back).", and a drop from a returner's week, "From week 7, when Alec Pierce comes back from IR, you'd drop Marvin Harrison Jr."; only drops the trade causes, not the ones the team faces anyway)
- "Harder to get" next to tagged players I'd get (Section 11)
- "How to offer it": the offer-first steps, when they qualify (below)
- injury tags in words under every player in the trade who isn't healthy, on either side, and "If they say no, try:" (Plan B) on a card without steps (Phase 4b, below)
- the outcome and Report buttons (Section 11)
- **plain-English reasons**, built from the features, such as:
  - "Your RB2 spot goes from 9.1 to 14.3 projected points per week"
  - "They're 11th of 12 at TE, and this gives them a starter"
  - "They give up more trade value than they get, so expect pushback." (with no percent since Phase 7b)
  - "Active trader: 3 trades this season"
- a **copy-ready pitch message** that leads with what the partner gains. Use templates, not AI calls.

**Phase 4 details: ranking** (`src/engine/rank.ts`)
- Sorts: Overall = EG = B × P_complete; Helps you = B; Chance they accept = P_complete among trades with B > 0, the rest after. Unknown numbers sort last; ties: EG, then the trade's key, then the furthest-evaluated copy (final > exact > screened, more seasons, then B). The output never depends on input order.
- Hidden by default and counted: B ≤ 0 or unknown first, else g_mkt(me) < −0.35.
- ⚠️ A search limited to one partner (the partner filter, or must-include players of theirs) drops the per-partner cap (it would cap the list at 3); the core, filler and given-player rules still apply. The all-teams list is unchanged (final review of Phase 4).
- Diversity, greedily in Overall order, each trade against those already kept, in this order: (1) filler: a kept trade with the same partner whose assets are a proper subset of this one's and |B − B_kept| < 0.2 × B_kept (only the bigger variant ranked below is dropped: a variant that ranks above its smaller trade isn't filler); (2) core: 2 kept trades already share its core, the highest-value asset on each side (ties: the smaller id); (3) the partner already has 3 of the first `partnerCapTop` (20) kept; (4) (Phase 4b) 3 of the first 20 kept already give one of its players of mine. A trade several rules drop counts once, under the first. Stop at 25.

**Phase 4 details: reasons and pitch** (`src/engine/explain.ts`, templates only; thresholds in `config.explain`, display only)
- Reasons, most important first, in four groups (⚠️ our grouping): (1) why it helps me: my biggest slot gain ("Your RB2 spot goes from 9.1 to 14.3 projected points per week"), else my lineup's weekly gain, else my playoff-week gain; long-term value in dynasty and keeper leagues (first when λ ≥ 0.5); the odds change (one decimal, as the card prints it); risky weeks it covers ("Covers your risky week 13: +6.2 projected points that week"; the detail doesn't say whether byes or a tough matchup made it risky); "In the regular season …" when a playoffs line is shown; in redraft, "Mostly a trade-value win …" when the market term itself is positive and at least B_win (and g_mkt(me) ≥ 5%). (2) Their side, at most 3 lines, the ones that moved the acceptance estimate most (logit terms ≥ 0.1, the value line always a candidate): a hole filled ("They're 9th of 10 at TE, and this gives them a starter", the rank quoted only in the bottom half; otherwise "Their TE spot is weak over the next 3 weeks …"), their slot or lineup change, trade value from their side (since Phase 4c by FantasyCalc's own values, "One value number" below: "By FantasyCalc's trade values, they give up X% more than they get", X = what they give ÷ what they get − 1 on FantasyCalc's plain sums, "… they get X% more than they give" the other way, "… the two sides are about even." within ±5%; above 100% as a multiple, "about 9.3 times as much as"; Phases 4–4b read the model's packages instead, X = the partner's PV_give ÷ PV_recv − 1; since Phase 7b in words only, from the model's own g_mkt(P), what the chance they accept reads: "They come out ahead on trade value, which makes a yes more likely." at 5% or more, "They give up more trade value than they get, so expect pushback." at −5% or less, else "The two sides are about even on trade value.", and nothing when no FantasyCalc value is behind the trade), activity, history, context, hot players, the deadline. (3) Caveats: injured players I'd get, my biggest slot loss, risky weeks it weakens, lower odds, long-term value lost, veto risk. The market check is left to its card flag (one basis, g_mkt(me), not repeated in the reasons). (4) The long-term-values-missing sentence (Checkpoint 2).
- **The star premium's reason** (addendum §1, N7): whenever a player they give carries a premium, the reason names him and why ("Jaxon Smith-Njigba is their best player and a top-12 player by trade value, so expect them to want a little extra."). It always gets one of the partner places (it replaces the lowest-weight line other than the value line). ⚠️ When, counting the premium, they still come out ahead by at least 5% (Phases 4c to 7a also by FantasyCalc's own values; since Phase 7b by their perceived g alone), it reads "…but even if they rate him a bit above his trade value, they'd still come out ahead" instead (a "little extra" next to a 40% value gain contradicted the card), and the value line drops "which makes a yes more likely" when the premium leaves them under 5% in their own eyes.
- The pitch greets without a team name, leads with what the partner gains (the hole it fills, naming the player only when exactly one player sent can play that slot; their slot or lineup gain; the trade value they gain only between 5% and 25%, since a bigger gain tells a sharp manager it's an overpay; since Phase 4b that figure is FantasyCalc's own (raw values, no floor or roster-spot credit: the number the partner can check), quoted only when every player in the version has a FantasyCalc value; since Phase 4c the reasons use the same number, below), names the trade from their side and closes. It never says what the user gains. Since Phase 7b it never mentions trade value either (FantasyCalc's condition, Section 2.9): at most two sentences of what the partner gains in his lineup, then the trade.

**Offer first / if they say no** (planner addendum to Checkpoint 3, §4)
- A **throw-in** is a player on my side whose loss costs me at most `throwInMaxCost` (5) ROS points (× Σω ÷ Σω₀ under the automatic playoff weight since Phase 7b, Section 7) against my free-agent-optimized roster, measured with scenario lineups (so a backup who covers injuries and byes isn't free); never an untouchable, a must-include player or an excluded position.
- Every shown trade gets two steps: (1) if the ranked trade includes a throw-in (and my side keeps a player without it): **offer first** the lean version without my lowest-value throw-in; **if they say no, add** that throw-in (the full ranked trade). (2) Otherwise: offer first the ranked trade; if they say no, add the single throw-in from my roster that raises acceptance the most while B stays at least 80% of the offer's B.
- Each step shows its estimated acceptance. A step shows only when it raises the chance they accept by at least 5 points and the offer-first version is at least 10% likely. Each variant is evaluated exactly with the 1,000-season screening simulation, legality re-checked. The pitch uses the offer-first version; the ranking stays on the ranked trade's numbers.
- Phase 4 readings (`src/engine/evaluate.ts`): the thresholds read P_complete (each step prints its P_accept, as the card's headline does, with P_complete when the veto cuts it); both versions' B come from the screening block (a fair comparison; the card keeps the ranked trade's final numbers); every version must help me (B > 0), so the 80% rule only compares positive B; case 2 stays within max players per side (the Analyzer's limit there); ⚠️ for speed, case 2 evaluates exactly only the 2 best candidates by the screening's quick acceptance (`steps.preScreen`; 0 misses on Parker's league, 1 of 82 in synthetic leagues); the Analyzer shows steps only for a trade the Finder could show (B > 0, not hidden).
- Steps rarely show on Parker's league: 0 of 25 shown trades on the 2026-10-01 data (the best was +4.5: Hall + Bo Nix → Swift, 20.0% → 24.5%), 2 of 22 on the live data of 2026-10-03. Under §9's waiver credit a throw-in raises the partner's g only when he's worth more than W × (1 + their g), so with partners already gaining 25–38% few throw-ins clear the bar, and each extra player costs −0.25 logit. A planner question at Checkpoint 4: the planner kept the rules (answer 2: a throw-in worth less than the best free agent really adds nothing). Under Phase 4b's value floor such a throw-in added no value difference but pulled the partner's g toward 0, which is where Checkpoint 4b's steps came from; since Phase 4c's neutral throw-ins (Section 9) he moves neither g, so steps come from throw-ins worth more than W or from the partner's lineup (n, h).

**Phase 4b details: tags, Plan B and the given-player cap** (planner reply to Checkpoint 4, change 6; `src/engine/explain.ts`, `planB.ts`, `rank.ts`)
- **Injury tags:** every player on either side whose status isn't ACTIVE gets a tag in words: "Questionable", "Out — expected back week 8", "On IR — expected back week 8", "On the PUP list — expected back week 9", "Out for the season", "Suspended", "Not an active NFL player". ⚠️ A return week shows only when the model counts on it (Section 6): OUT from next week on; IR, PUP and SUSPENDED after this week; a Q/D/P player's far ESPN date only when his projection follows it ("Questionable — ESPN expects him back week 8"). Other wordings: "Suspended for the season", "Doubtful — ESPN expects him back week 16". When a player I'd get is hurt, the card says once: "<name>: his projection assumes he returns at full strength, blended with the trade market." (Phase 4c: without ", blended with the trade market" while the blend is off for the whole league: FantasyCalc's curve fallback, no FantasyCalc values, or a dynasty or keeper league without this season's list) For OUT, IR and PUP players that sentence is part of the "depends on an injured player" flag; for Probable, Questionable and Doubtful ones it sits under the player lists (not for SUSPENDED or NA); ⚠️ it is said even for a player the blend doesn't reach (no real FantasyCalc value). The card leaves out the reasons' own injured caveat, so the message shows in the tag and the flag only. The tags come with the words (`withWords`), so the Finder's cards and the Analyzer show the same; a player only a Plan B box names gets the search's tag for him when any idea has him (⚠️ else the snapshot's, without an ESPN far date).
- **Plan B ("If they say no, try:")**, on a Finder card without steps: among the search's exactly evaluated trades with the same partner, one that differs in at least one player, has B > 0, "Helps you" at least half the card's (`search.planB.minHelpsShare`, judged on the printed scores) and isn't hidden by the market guard; a different package for the same players of theirs first, else a different set of their players; then the best Overall, then the key. ⚠️ Our additions: it must also be at least `steps.minAcceptGain` (5 points of P_complete) likelier to go through than its card (by the planner's rules alone, 14 boxes on the 16 cards of Parker's 2026-10-04 data, 8 of them less likely to be accepted than their card, often the card plus a throw-in the steps had already rejected; with the bar 5 of 16 cards get one, none less likely; kept by the planner, Checkpoint 4b answer 3), and at most 3 Plan B boxes in the top 20 may add the same player of mine. It is never a trade shown as a card (Phase 4b final review: a box naming the card above it was circular advice). A candidate that wasn't a finalist gets the final simulation, so the box's three numbers are on the card's basis; up to `planB.tries` (3) candidates are tried (a finalist needs no new simulation; one the box cap skips doesn't count). The box, after the card's flags, facts, reasons and message, shows its players with their tags, its three numbers, its own "Message to send them" (a follow-up naming the Plan B trade) and "Open in Analyzer", which evaluates it as one offer, without steps. No Plan B in the Analyzer.
- **The given-player cap** counts each player of mine on a trade's side (a 2-for-1 counts for both) within the partner cap's top-20 window, after the filler, core and partner rules; the finalists' ranking relaxes it by one like the others; a one-partner search keeps it.

**Phase 4c details: one value number, the pattern note, steps and Plan B** (planner reply to Checkpoint 4b, changes 3, 6 and 7)
- **One value number per card** (change 3; Phases 4c to 7a, replaced by "No value numbers" below): the card's value line, the reasons and the pitch use FantasyCalc's own values, the number a leaguemate can check: no floor, no roster-spot credit, no premium, no neutral-throw-in rule ("By FantasyCalc's trade values, they get 18% more."). ⚠️ A player FantasyCalc doesn't value is named instead of a percentage. The pitch mentions value only when the partner's own gain is at least +5% (⚠️ and still at most 25%: a bigger gain tells a sharp manager it's an overpay). The model's floored, credited and premium-adjusted figures stay internal; the Analyzer shows them under "Details". The Market check flag keeps its trigger (g_mkt(me) < −15% on the model's packages) and words it without that number. As built (`explain.ts`, `tradeView.ts`): "By FantasyCalc's trade values, they get 18% more than they give, which makes a yes more likely." (the closing clause only when the model's own g agrees; likewise "…, so expect pushback"), "By FantasyCalc's trade values, the two sides are about even.", "FantasyCalc has no trade value for X, so its values can't compare the two sides."; the fact line "Trade value: You give 6,500, you get 5,400 · Values: FantasyCalc" ("Unknown: FantasyCalc's trade values aren't available right now" without values); everything still worded from the model's figures says "counting roster spots" (the Market check, "Doesn't help you", the veto caveat, the hidden-ideas line, long-term value, and "Mostly a trade-value win" when FantasyCalc's own gain is under 5%) and gives no number of its own, except long-term value, which keeps the model's ΔDyn ("Long-term value: +350 for your roster, counting roster spots"; "Raises your roster's long-term value by 6%, counting roster spots."), and the hidden-ideas line, which quotes the hide threshold ("over 35% less trade value than you give"); the history reason gives no percent.
- **The pattern note** (change 6; `pattern.ts`): when at least 5 (`explain.patternMinCount`) of the top 10 (`patternTop`) without the given-player cap (⚠️ the other caps and the minimum chance as shown) give the same player of mine, one line above the list names him and the drivers that hold in at least half of those trades (`patternDriverShare`), at most 3 (`patternDriversMax`), in this order: bye cover (his bye is a counted week in which the trade raises my win chance by at least 3 points, `weeklyLineMin`; "your riskiest week" when it has my lowest baseline win chance, "one of your riskiest weeks" on a tie), where the incoming players' byes land (all done, or in weeks my win chance is at least 50%), the slot that usually gains most, and injury cover (scenario ΔPPW − EV ΔPPW ≥ 0.5 a week, `patternDepthCoverMin`). No driver holds: just the name. ⚠️ Exactly half (5 of 10) reads "Half of your best ideas trade …". Never a must-include player of mine. ⚠️ A bye in the second week of a multi-week matchup never counts as bye cover. Parker's league: "Most of your best ideas trade Garrett Wilson: his bye is in week 13, your riskiest week. The list shows 3 ideas that trade him, to make room for other ideas." (7 of the uncapped top 10 give him; the other drivers hold in fewer than half of those trades; the second sentence, from the final review, says why the list shows fewer)..
- **Offer-first steps** (⚠️ lead decision, Phase 4c): in case 1 the lean offer-first version must also print at least the user's minimum chance (max(`steps.minOfferFirst`, minimum), `evaluate.offerFirstBar`), so the app never suggests sending something below it; case 2's offer-first version is the card itself, which the filter already applied. Both bars are judged on the printed chance (the nearest 5%), and re-filtering recomputes the steps. Under the neutral throw-in rule a throw-in worth at most W can't raise acceptance through value, so steps come from throw-ins worth more than W or from the partner's lineup (n, h).
- **Folding** (⚠️ Phase 4c, final review; `search.foldedCards`): when a card's offer-first step names another card on the list, the lower-ranked of the two leaves the list and the list is re-ranked (re-filtering does the same), so two cards never suggest the same first message. Step versions come back in the player order asked for and are evaluated in key order, so a re-filter equals a fresh search.
- **The lean version when a side would be empty** (final review): when leaving out every cheap player would empty a side, the lean companion leaves out only the extra players (the planner's own step), so a card like Rico Dowdle → Jordan Mason + Kalif Raymond meets Dowdle → Mason (likelier, about as helpful). ⚠️ The filler rule also drops a bigger variant that is no more helpful and strictly less likely than its smaller version (untested on Parker's data; it fires on synthetic leagues).
- **Plan B** carries its acceptance features and the partner's g (for the feedback record, change 7) and its own odds lines, from its final-block simulation like a card's. ⚠️ It is never a card plus extra players (since the final review, of any value; worth at most W before) unless they make it at least `steps.minAcceptGain` (5 points) likelier than that card (`search.barredFromBoxes`, reading P_complete only: at Parker's scale B differences are inside simulation noise), never a trade a shown card with the same partner matches or beats on both Helps you (as printed) and P_complete (`dominatedByCard`), and never a version a card's steps already show.

**Phase 7b details: no value numbers** (planner reply to Checkpoint 7a, 5.4; FantasyCalc's condition 4, Section 2.9; `explain.ts`, `tradeView.ts`)
- No FantasyCalc value number, percent, multiple or comparison anywhere: not on the cards (their value line is gone: "These numbers weigh each player's trade value." and the "Values: FantasyCalc" link instead), not in the reasons (trade value in words from the model's own g, Phase 4 details above; history without a percent), not in the pitch (it never mentions trade value), not on the League page (no Value column, the blend in words: Section 6 step 8) and not in the Analyzer's Details, which give B's market term in points a week instead, "Trade value: −0.4 pts/week equivalent." (redraft; Sections 10 and 14), where Phases 4c to 7a listed the model's g figures. Our own outputs (Helps you, the chance they accept, Overall, odds, projections) stay. The Finder's warnings box ("Things to know") shows the search's notices only (Section 14). `src/lib/fantasyCalcHidden.test.ts` guards the words with distinctive values, and check:browser the built pages.
- Worded from the model's figures, as in Phase 4c and still without a number: the Market check ("Market check: counting roster spots, you'd give up more trade value than you get."), "Doesn't help you", the veto caveat, "Mostly a trade-value win: you get more trade value than you give." (the market term positive and at least B_win, g_mkt(me) ≥ 5%), and now long-term value ("Long-term value: Up for your roster"; "Raises your roster's long-term value."; Phase 4c printed the model's ΔDyn: "+350 for your roster, counting roster spots") and the hidden-ideas line ("… where, counting roster spots, you'd give up much more trade value than you get"; Phase 4c: "over 35% less trade value than you give").
- `ExplainContext.fantasyCalcValue` now only says whether a trade has any FantasyCalc value behind it: when none does (no lookup, or no player in the trade with a value and the model's g exactly 0), the reasons say nothing about trade value.

**Trade Analyzer**
- The user builds any trade, including counteroffers, and sees the same evaluation.

---

## 14. UI (MVP)

0. **Saved leagues** (Phase 4c; planner reply to Checkpoint 4b, change 11): a league switcher at the top of every page (`src/components/LeagueSwitcher.tsx`) lists every saved league (name, platform, season; the current one marked), with "Add league" (to Connect) and "Remove" with a confirmation that says what goes (the import, team pick, model inputs, settings and feedback; settings and feedback stay while another season of the league is saved) and offers to export its feedback first; it then says which league shows now. A new tab opens on the league used last (a league counts as used when a tab comes to show it). Each league keeps its own "my team", settings, model inputs, feedback, engine worker and Finder memory; the trade pages read an address only under the league it was first read under, so a switch never carries a partner or trade across. Below 1,024 px the nav has its own row. A banner says when the browser won't keep data (private mode without IndexedDB: the app works in page memory).
1. **Connect:** a platform picker, with the inputs and help text each platform needs. On phones the picker is compact (a segmented control or a select), so the league-link box and the Import button fit on the first screen. The ESPN cookie how-to must say plainly that the cookies work like a password and only stay in this browser session.

   **How users connect ESPN leagues** (leagues are private by default, Section 2.2):
   1. The user **pastes their ESPN league link** (or just the ID). If the league is viewable to the public, as Parker's is, they're done.
   2. **If the league is private,** offer two choices:
      - **Ask the commissioner** to turn on "Make League Viewable to Public". Give the user a copy-ready message to send. Once it's on, everyone in that league can connect with just the link, including on phones. Mention that it lets anyone with the link view league pages, but doesn't let them join.
      - **Connect with ESPN cookies** (desktop only). Walk them through it step by step, following the credential rules (Section 0.5, Section 3 and Phase 1).
   3. **Phase 7, before public launch:** build an Offer Sheet Chrome extension.
      - It reads the two ESPN cookies with one click, using the `cookies` permission scoped to `*.espn.com` only.
      - It sends them only to Offer Sheet's own site, over HTTPS, and only when the user explicitly clicks.
      - Plan for the Chrome Web Store listing, which has a one-time developer fee.
   4. **Never ask for ESPN passwords.**
   5. Phase 4c: every import is saved as a league and becomes the one shown. Sleeper: pick several leagues at once from the username's list (checkboxes; imported one after another, with progress and a result under each; the first that imports is shown; leaving the page stops the batch). ESPN: the session's cookies cover every league of that ESPN account, and the page says so when adding another.
2. **Import Report ("Here's what we understood")**
   - scoring highlights: reception points, pass TD points, TE premium, bonuses
   - scoring rules we couldn't map
   - lineup slots, bench, IR and taxi
   - playoff weeks and number of playoff teams
   - trade deadline and review type
   - league type
   - teams and owners
   - "Your team", which the user can change
   - data timestamps and warnings, including platform notes such as:
     - ESPN TQB mapped to QB, and HC not used
     - "lineups are set automatically" in best-ball leagues
     - a substituted FantasyCalc format (for example 16 teams → 14)
     - settings the platform doesn't expose, marked "unknown" for the user to fill in (MFL deadline and review; Fleaflicker rules-page fallback)
   - Sleeper guillotine leagues are rejected at import with a friendly message instead of a report.
   - Phase 2: a "Trade values" row names the FantasyCalc format (for example "10 teams · half-PPR · 1 QB · redraft"), with a note for each substitution; once the League page has loaded the league's inputs, the notes also say whether ESPN's and Sleeper's projections were averaged (Section 6).
   - Phase 3: a "Ties in the standings" row (points for, head-to-head record, division record, or "Unknown (points for assumed)"), and a "Final scores" row naming the weeks with final scores. The "Seeding" row says what the simulator will assume when the platform doesn't report it (for example "a fixed bracket (no re-seeding), the division winners seeded first, then the other teams by record").

   - Phase 4c: a "Waiver order used" row ("Weekly reset (reverse standings)", "Live order (rolling waivers)", "FAAB budget left (the most left picks first)", …; `importReport.waiverOrderText`).
   - Checkpoint 7a: an "Inactive teams" row (Section 7: "Team 6: inactive, no pickups assumed.", or why none is assumed).
   - Phase 7b (planner reply to Checkpoint 7a, §5.1, on codes, JSON paths, stat IDs and free-agent ID matching: "Users should never see that."; `src/lib/notices.ts`, `importReport.ts`, `ReportView.tsx`): only the collapsed **"Technical details (for bug reports)"** at the bottom shows them. A **Notices** tile ("None", "1 notice", "3 notices") and **"Things to know"** under the tiles (only when there is one) list the plain-language notices, said only when they can change what the user sees or decides: a player on the user's roster (on the League page also a likely starter on any roster) missing projections or matched uncertainly; a scoring rule not counted that is common or has scored this season (`scoredThisSeason`, Section 2.2); a setting that affects results unread, or projections, stats, trade values, free agents, injury details or the NFL schedule not loaded. Every warning code has its rule (`WARNING_RULES`; `notices.test.ts` checks it against every code in src/; a code it doesn't know is technical). Rare uncounted rules get one quiet line in the scoring card ("Two rare rules aren't counted: 1-point safeties and blocked-kick return touchdowns. They almost never happen."). An ESPN setting read with a caveat gets a small reading line under its row ("Our reading of a setting ESPN doesn't document.", "Worked out from the bracket: ESPN doesn't list byes."; Sleeper's such readings are notices). The "Your team" card says why the platform couldn't tell which team is the user's, where the user picks it. The technical details keep everything raw: every warning with its code and path (the ones behind notices too), the import's notes, the player-ID matching, players without projections, the schedule's gaps and the uncounted rules with their stat IDs; with no League model there, other teams' players are listed there and judged on the League page. Parker's league (2026-10-04 data, `reports/import-report.md`): "Notices: None", the quiet line, and 4 import warnings plus 3 players without a Sleeper id in the technical details.

   **The user must be able to tell at a glance whether we got their league right.**
3. **League:**
   - a team table: record, points-for, projected points per week, and needs and trade-chip chips, with a small "Values: FantasyCalc" link. The chips once labeled "Surplus" read "Trade chips" (Checkpoint 2); "Needs" stay as they are. A chip reads like "C. McCaffrey: worth +33 to Team 2 · costs you 6.1 pts/wk", with a "starter" tag when he starts for his own team (Checkpoint 3 answer 3), and a tooltip giving what that team gains and what his own team loses. A player with conflicting ESPN signals (Section 6) shows the note in his row
   - Phase 3: a standings table in today's order by the league's rules (record, points for, playoff, bye and title odds, the projected final record, and notes on the rules simulated), and your remaining games (opponent, both teams' projected points, your chance to win and to beat the median, your likely starters on bye, and risky weeks flagged in words: under 40% to win, or 3+ likely starters on bye in a week that counts). A redraft team that is certainly out sees "Your season's over — no trade helps this year." and no partner cards. The risky-week thresholds are `config.leaguePage` (Section 15). A browser holding an import saved by an older version sees "Offer Sheet was updated. Import your league again to see the new numbers." instead of "No league imported yet"
   - a positional strength heatmap
   - best trade partners
   - roster tables with each player's ROS points (Section 6), regular season and playoffs, games left and bye status; tapping or hovering shows the week-by-week breakdown
   - Phase 4c (planner reply to Checkpoint 4b, change 9): the headline odds are the one shared baseline, with every team's likely pickups (Section 8), the same as every trade card's "before"; "As rosters stand: …" follows as a smaller second line; the remaining games' projected points include the pickups too. The free-agent line names the waiver order used. When FantasyCalc is down, the values line says which day's values are used, or a banner says the values are our own estimates (Section 2.9). A capped blend factor is marked in the player breakdown (Section 6 step 8). As built (Parker's 2026-10-04 09:24 UTC data): "Your odds: 60% playoffs · 10.5% title" with "As rosters stand: 65% playoffs · 12.0% title" under it and "These odds count the free-agent pickups that would help each team (listed on its roster): trade ideas start from the same odds."; the standings' title column has one decimal like the cards; while a week is under way, "these odds count free-agent pickups from week 5 on: week 4 is played with today's rosters". Likely starters (the bye count in risky weeks) are the cards' own rule: players in my best lineup after my free-agent pickups in at least half the weeks they play, never a kicker or D/ST I stream (⚠️ the streaming replacement covers that bye; a streamed QB's or TE's replacement is much weaker, so theirs still count: `leaguePage.streamCoversBye`); on Parker's data week 13 has 3 such starters on bye (Hall, Wilson, Bowers; his kicker no longer counts) and stays risky. The free-agent line names the order ("Your team picks 4th of 10." then "Waiver order used: Weekly reset (reverse standings)"). A saved FantasyCalc list shows "Trade values from Sep 27: FantasyCalc didn't answer."; the curve fallback a banner ("FantasyCalc is unavailable") and every value marked as our estimate (until Phase 7b removed the Value column). A capped factor reads "Used 77 (capped: the market moves him up at most 35%)" (in words since Phase 7b: "…, by the most it can: 35%.", Section 6 step 8). Settings has a "Scoring" card with "What matters most" ("Win the title": "Weighs your title odds most (85%), playoff odds 15%."; since Phase 7b "What does your league reward?", "Only the champion"); in the curve fallback "Protect my trade value" says it changes nothing for now.
   - Phase 4b: a line above the rosters says how free agents are shared out and where my team picks (Section 7), and the player breakdown shows the market blend ("Our projection 210 · Trade market 170 · Used 190", Section 6 step 8; a player at the top or bottom of his position's value range, whose market number is his own, reads "Trade market: no comparison (top value at his position)"; in words only since Phase 7b: "His projection leans up toward the trade market's view.").
   - Phase 4: each roster shows the free-agent pickups the optimizer would make for that team (Section 7; K and DEF never among them; each with the gain it was chosen by: with injuries and byes simulated when scenarios ran, the expected-value gain in its tooltip), and the page lists "Streaming picks this week": the top 3 K and top 3 D/ST free agents for the current week, each with its projection and opponent.
   - Phase 4 (planner addendum to Checkpoint 3, §2): a "Harder to get" tag (in words, not color alone) on other teams' tagged players in roster tables, trade chips and partner rows (⚠️ never on my own roster, where it would read as advice about my own players). Partner rows lead with the best untagged target ("Best of their trade chips: C. Olave, +4.7/wk"; "Best target" until Phase 4b, Checkpoint 4 answer 9); when the single best player for me is tagged, he follows ("Bigger upgrade, harder to get: J. Smith-Njigba, +7.4/wk"); the rest follow under "They could also give". Each partner card ends with "See trade ideas with Team X →", which opens the one-partner Trade Finder (`/trades?partner=<id>`). ⚠️ Lead decision N12: every lead line needs at least `needs.bestTargetMin` (1 point a week, as printed): "Best of their trade chips" is the best untagged chip that reaches it; when none does and the single best chip is tagged, he leads alone as "Best of their trade chips, harder to get" if he reaches it too (a "+0.1/wk" lead next to a "+7.2/wk" star read oddly). Targets come from the partner's trade chips, so they can differ from the Trade Finder's best ideas with that team.
   - Phase 2: each roster also showed the team's best free-agent move (Section 7), and the best available free agents by position. In keeper leagues the values shown are redraft (perception) values (none shown since Phase 7b). Playoff-weighted numbers (lineup cost, the move's gain) are labeled "lineup pts (playoffs count 1.25×)", never "ROS pts" (since Phase 7b the automatic weight with one decimal, "(playoffs count 2.0×)", not said when it prints "1.0"; the explainer says where the weight comes from and never that playoff weeks matter more, since it can be below 1). One-sided partners are badged "Would start for you". While a week is under way, the header, team note and heatmap captions say which weeks team numbers count. Stored model inputs are reused only while under 6 hours old (the projections TTL).
   - Phase 7b (planner reply to Checkpoint 7a, §5.1, §5.4, §6.1 and §6.2):
     - The yellow banner shows the plain-language notices only, titled "Things to know" (Checkpoint 7a: "Some data is missing", with the model's warnings), judged with the League model: a player on my roster or a likely starter on any roster; everything technical stays in the Import Report's technical details. For Parker's league the planner expects no banner unless one of the 3 players without a Sleeper id is a likely starter (check:browser says so in an info line when one shows). FantasyCalc's curve fallback keeps its own banner. The Trade Finder's warnings box, also "Things to know", shows the search's notices only (`noticeWarnings`).
     - No trade value anywhere (Section 13, "No value numbers"): the roster tables lost their Value column and the breakdown its Value row; the blend is said in words (Section 6 step 8). The "Values: FantasyCalc" links stay (header, team table, rosters, free agents).
     - Lineup points carry the automatic playoff weight's label ("(playoffs count 2.0×)"; Section 7).
     - **Waiver upgrades** (`src/lib/waiversView.ts`, `src/components/league/WaiverUpgrades.tsx`; the rules: Section 7), a section between the trade partners and "Streaming picks this week", reached from the nav's "Waivers" (`/league#waivers`: it comes into view with its heading focused once the page has computed). A toggle: "Rest of season" (default) and "This week" (while a week is under way: "This week" for its games still to play, and "Next week"). One card per player at 375 px (no table): the player with position, NFL team, bye, injury tag and, when the platform reports it (ESPN), his waiver status ("On waivers until Wed" in the viewer's time zone, "Free agent now", "Was on waivers until Wed" once that's past); his ROS points and the week's projection; "Better than" (my players at his position he out-projects; when none of mine there plays, who and why: "No TE of yours plays in week 5 (B. Bowers: bye)"); the lineup gain to one decimal with whom he'd replace ("Drop R. Doubs", "Open roster spot", "No gain", "No room"); a "Depth only" tag (in words) when he wouldn't start in a normal week. The first 10 rows, then "Show all"; 44 px buttons. A redraft team that's out reads "Your season's over, so no pickup can help this year."
4. **Trade Finder:** the controls and the ranked trade cards (Section 13).
   - Phase 4 (`/trades`): a partner filter (all teams or one; `?partner=<team id>` in the address, written back when picked), the sort (Overall default, Helps you, Chance they accept; re-sorting doesn't search again), a progress bar with plain stage names and Stop (the search runs in the Web Worker in ~40 ms slices, so Stop or a newer search is seen between slices), hidden-trade counts, the notes (including each evaluation's own, such as the week-in-progress or keeper notes) and warnings, links to Settings and the Analyzer, and empty states (no team picked, season over, deadline passed, nothing found). Any settings change but the minimum chance starts a new search with the last ideas dimmed (since Phase 4c the minimum chance re-filters the last search's finalists); Stop keeps them.
   - Each card: give/get, Helps you / Chance they accept ("Est.", the label, P_complete when the veto rule cuts it) / Overall (B ≤ 0 scores 0; an unknown B shows —), risk flags apart (since Phase 4c "Market check: counting roster spots, you'd give up more trade value than you get.", with no number; Phase 4 printed "Market check: you'd get 22% less trade value than you give"; the injured flag), "Your lineup +3.5 pts a week", my title and playoff odds before → after next to the three numbers (since Phase 4c "Title odds 12.1% → 13.4% · Playoff odds 65% → 69%", or the change alone, "+4.1 percentage points", only when the odds before aren't known; Phase 4's "+4.1 percentage points (62% to 66%)" is gone), values given and received by FantasyCalc's own values ("Trade value: You give 6,500, you get 5,400") with a small "Values: FantasyCalc" link (Phases 4c to 7a; since Phase 7b "These numbers weigh each player's trade value." and the link instead), "You get 142 ROS pts, give 118", required drops and adds, the reasons, the pitch behind a "Message to send them" disclosure with Copy, "Open in Analyzer", and the feedback buttons (Section 11) saved in this browser.
   - Phase 4b: injury tags under the players, the "If they say no, try:" box (Section 13), and in the trade values a note that a player worth less than the best free agent counts at that free agent's value (Section 9; removed in Phase 4c, when the card's values became FantasyCalc's own). The roster moves include IR moves (Section 13). When the veto cuts a chance below the 5% display floor the card says "under 5% it goes through". When the starting lineup moves the other way from the raw ROS points, a line says so ("Your starting lineup still gains 5 ROS pts: ROS points count each player's projected points whether he starts or not."). How to read says the chance is never above 85% and that it weighs what the trade adds to or costs their starting lineup. The focus ring is a darker gold on light backgrounds (4.7:1 on white). Every browser holding a pre-4b import must import again (the stored import's format was 3; since Phase 4c it is 4, because `Team.waiverRank` now holds the order the allocation uses, so a 4b import reads "Offer Sheet was updated" with a one-click "Import again"; its "my team" pick, settings and feedback still move in).
   - Phase 4c: the "Chance they accept: at least …" control (Section 13; changing it re-filters at once, without a new search), the pattern note above the list, the odds lines next to Helps you and the weekly line on every card, "<5%" for chances under 5%, and FantasyCalc's own values in the value line, reasons and pitch (Section 13; until Phase 7b). "Your odds before any trade" now equal the League page's headline. As built: the odds line sits right under the three numbers ("Title odds 12.1% → 13.4% · Playoff odds 65% → 69%"; title with one decimal, "<0.1%" and ">99.9%" at the edges; playoffs whole percents), then the weekly line; offer-first steps show neither (their simulation is the screening block); Plan B boxes show both. The control reads "Chance they accept: at least" (Any, 10%–50%), saved with the league's settings; under it, in leagues that review trades, "Judged on the chance the trade goes through, which a league veto vote can cut." (or "the commissioner's review"). Changing only the minimum re-filters in the worker (`refilter`: `search.refilterSearch` on the last result's state; a fresh search when that state is gone); changing the goal searches again. Few ideas: "Only 4 trade ideas to show at “at least 50%”. Try a lower setting to see more."; none: "No trade ideas at this minimum chance". The hidden line counts the ideas below the minimum. The info line: "Helps you (0–100) sums up how much your title and playoff odds rise, minus a cost for giving away trade value or plus a credit for gaining it." (dynasty and keeper: "…, weighed against the change in your roster's long-term value."; without FantasyCalc's values or long-term values, just the odds). A card's feedback buttons wait for the browser to keep the press and show a refusal on the card. The week in progress reads "Week 4 is under way: every idea's odds play it with today's rosters, before and after the trade." (⚠️ the model's rule, not a platform one).
   - Checkpoint 7a: "Helps you" and Overall on B₃ (Section 10): the tile's tooltip and the info line say "63 ≈ as good as adding 3 points a week to your lineup for the rest of the season.", How to read gives the scale in words, and the scale notes (floor, λ) show with the search's notes. Phase 7b: the λ note is gone, and in dynasty and keeper leagues with long-term values the tooltip, the info line and How to read follow the mix B_ref(λ) (Section 10).
   - Phase 7b (planner reply to Checkpoint 7a, 5.3; `tradeView.ts` finderTimingLines): under the intro, in season (a game of the league's first week has kicked off, a fantasy week is left and the trade deadline hasn't passed), "Best time to look: Tuesday or Wednesday, after Monday night's game. Trade values and projections have caught up with the weekend, and a trade still has time to clear your league's 1-day review before Thursday." The review period comes from `tradeReviewHours` (Sections 2.2, 2.3: "1-day", "2-day", any whole number of days "N-day", else "N-hour"; "your league's review" when it isn't known; "…, and a trade still has time to go through before Thursday." when the league reviews nothing; ⚠️ never read from `tradeReview` "none" alone, which the adapters also give when they only assume it); ⚠️ ours (a planner question): a review longer than a day can't clear "before Thursday" when the trade is made on Wednesday, so the line says when it clears ("… caught up with the weekend. With your league's 2-day review, a trade made Tuesday clears on Thursday, and one made Wednesday on Friday." for a whole number of days up to 4; otherwise "… a trade made then can clear after Thursday night's game."). Under it, always when known, "Trade values updated 2 hours ago · Projections updated 5 hours ago." (FantasyCalc's list as served, a saved list's own time when one stands in; ⚠️ Sleeper's oldest projection week the inputs read), read at the page's clock (moved every minute and when its tab shows again), never the time of remembered ideas. The warnings box ("Things to know") shows the search's notices only. The goal's words follow Settings ("What does your league reward?").
   - "How to read a trade idea" is worded per league type (dynasty and keeper: long-term value weighed by Win now ↔ Future; keeper: keeper costs aren't counted).
   - Phase 4 finish: the Finder states "Your odds before any trade" with a note that they count each team's helpful free-agent pickups (since Phase 4c exactly the League page's headline odds: "As on the League page, they count the free-agent pickups that would help each team, and every trade idea's odds start from them."; before, the League page showed odds as rosters stand, so the two could differ); a week in progress is noted once for the whole list; a "Doesn't help you" flag says why (redraft: your chances rise but you'd give up more trade value than your "Protect my trade value" setting allows; dynasty and keeper: this season against long-term value by Win now ↔ Future); a one-partner search shows more than 3 ideas (§13); the Finder and the Analyzer share one engine worker (one per saved league since Phase 4c), so its context survives page changes, and the Finder shows its last searches again at once (in memory, while no kickoff or deadline change has happened) and brings the card you came back from into view.
5. **Trade Analyzer.**
   - Phase 4 (`/analyzer`): pick the partner, then players from both active rosters (Phase 4b: and IR, an IR player's detail ending in "IR slot"; taxi players can't be traded yet), up to `config.search.analyzerMaxPerSide` (4) a side; Evaluate shows the same card or the reason the trade can't be made. A result for an older trade, settings or league data is dimmed and says so. `?partner=&give=&get=` (team and player ids only, never league ids or names) prefills and evaluates a trade, and Evaluate writes the trade back into the address (replaceState). Links that carry ids never prefetch, so the server sees an address only when the user opens it.
   - Phase 4c: the same odds lines and weekly line as the Finder, and the model's own figures under "Details" (both sides' g on the model's packages, the partner's perceived g with the star premium, B's market term). Checkpoint 7a: Details end with "Helps you N ≈ +X pts/week …", X = 3 × B / B₃ (Section 10). Phase 7b (planner reply to Checkpoint 7a, §2 question 5 and 5.4): no trade-value figure in Details; in a redraft league B's market term as points a week, "Trade value: −0.4 pts/week equivalent." (left out when B has none: FantasyCalc's curve fallback or no values), in dynasty and keeper leagues that Helps you counts long-term value instead (or this season only, without long-term values), then "Helps you N ≈ …" (on the mix with long-term values: "Helps you 45 ≈ +1.8 on a scale where +3 is as good as …"). ⚠️ The points a week stay a points figure only while no page prints the rate between trade value and points, so Settings' "Protect my trade value" help gives none (a planner question). "Back to the Trade Finder" isn't prefetched (its address can carry a team id).
   - The Analyzer shows "Your odds before this trade" above the card (the card's odds get the same end percents as on the Finder), puts its status line above the form, brings an automatically evaluated trade (from a card's link) into view with its heading focused, and links back to the Finder's last address. It shows "How to read the evaluation" under its card (the Finder's explainer, worded for a trade you built, including "Harder to get" and "How to offer it").
   - Nav: League, Trades (marked current on the Analyzer too), Settings; "Import report" reads "Report" on phones so five links fit at 375 px. The League page's partner cards link to the Trade Finder for that team; the Import Report points to it. Phase 7b (planner reply to Checkpoint 7a, §6.2: "linked from the nav"): six links, Connect, Report, League, Waivers, Trades, Settings; "Waivers" goes to the League page's section (`/league#waivers`; never marked current itself; a tap while the section is on the page brings it into view and focuses its heading, since Next doesn't scroll to a hash the address already has). Six don't fit one row at 375 px, so below 640 px the nav is two rows of three centered 44 px links (44 px more header on a phone); from 640 px up one row as before.
6. **Settings:**
   - playoff weight (read-only since Phase 7b, planner reply to Checkpoint 7a, §6.1: the manual 1×–2× control is gone; Section 7). "Playoff weeks count: 2.0×, set automatically from your odds." with "It only affects shortlists, free-agent rankings (and so the pickups your odds count), needs and trade chips. Final scores come from playing out the season, which weighs each week by its real effect on your odds." (the planner's words; ⚠️ the pickups clause is ours, so it never reads as leaving the odds alone); the fallback says why ("1.3× (the default: your title odds aren't known)."). The page works it out in an engine worker of its own (`usePlayoffWeight.ts`) from the league's saved model inputs while they're fresh, again when the goal or another League-model setting changes; without fresh inputs "set automatically from your odds when the League page loads." An older stored `playoffWeight` setting is dropped on load.
   - Win now ↔ Future
   - max players per side
   - untouchables
   - include P/K/DEF/IDP and draft picks
   - "Export feedback" (Section 11)
   - Phase 4c: "What matters most": Win the title (default) / Balanced / Make the playoffs (Section 10), per league; the page also names a minimum chance saved on the Trade Finder and says "Reset to defaults" sets it back to 10%.
   - Phase 7b (planner reply to Checkpoint 7a, 5.2): the goal reads "What does your league reward?": Only the champion (default) / Top finishers too / Making the playoffs, each with its line ("Weighs your title odds most (85%), playoff odds 15%."), then "Pick what your league's prizes reward." and the helper line "On the bubble? Keep “Only the champion.” It already counts getting into the playoffs." "Protect my trade value" says what it does with no exchange rate (⚠️ review of Phase 7b, a planner question: "giving 25% more trade value than you get costs about 0.4 points a week" next to the Analyzer's "Trade value: −0.4 pts/week equivalent." read back as the trade's value comparison): "How much Helps you counts trade value, so you keep some for later deals before your trade deadline: giving up more value than you get lowers it, getting more raises it, in projected points a week, like a change to your lineup. High protects your value the most; Low goes for the biggest lineup gain now. Your bench's worth as cover for injuries and byes counts either way." The goal now sets ω too, so it's one of the settings the League page recomputes for.
   - Phase 4 (`/settings`): also "Protect my trade value" (Low / Medium / High; redraft leagues only, where "Win now ↔ Future" sits in dynasty and keeper leagues), "Positions I stream weekly" (K and D/ST by default; QB and TE when the league starts them), must-include players and positions to target or avoid. Settings are kept per league in this browser, filed under a short code made from the league ID (leagueKey): since Phase 4c in the league store's IndexedDB (database `offersheet`, Section 3), before that in localStorage (`offersheet:settings:v1`, now a dormant pre-4c copy) and go with every engine request; the League page recomputes only when a setting it reads changes (streamed positions, playoff weight; since Phase 7b streamed positions and the goal). Win now ↔ Future and draft picks show only in dynasty and keeper leagues. Conflicting choices are prevented (a player both untouchable and must-include; a position both targeted and avoided). Feedback is kept there too (since Phase 4c in IndexedDB, the newest 500 per league; before, localStorage `offersheet:feedback:v1`, the newest 500 in all); its export numbers leagues (league-1, league-2) instead of their codes; `npm run feedback:summary -- <file>` summarizes it. The privacy page says all of this.

**Home page and privacy**
- A placeholder landing page for Offer Sheet is already live (Section 17, Phase 7). The app's home page should carry over its wording: what the app does, how it works, and the platforms it supports.
- The privacy policy lives at `/privacy`. It must match what the app actually does, so update it whenever data handling changes.
- Built at Checkpoint 7a (planner reply to Checkpoint 4c, B3; `src/lib/site.ts` holds the landing page's words, the theme colors, `CONTACT_EMAIL` and `siteUrl()`):
  - **Home:** the live landing page's title ("Offer Sheet — fantasy football trade finder"), description and Open Graph words, the app's three numbers, a platform list with status (ESPN and Sleeper available; Yahoo "Waiting for Yahoo's approval"; Fleaflicker, MFL, Fantrax and manual entry "Later"), and a "Beta" pill next to the logo (a word, not color alone; tighter below 640 px so the league switcher keeps the logo's row down to 320 px).
  - **/privacy, /terms, /feedback:** the text lives in `PrivacyPolicy.tsx`, `TermsOfUse.tsx` and `FeedbackGuide.tsx`; each sentence about a Part B feature shows only while its switch in `POLICY_FEATURES` is on (browserReads, anonymousFeedback; Phase 7b added fantasyCalcHidden, publicArchive and feedbackTotalsOnly, on since 2026-10-05: all five on), and `pages.test.ts` fails when a switch disagrees with the code, both ways. Numbers (retention, windows, caps) are read from `src/server/limits.ts` and config. Whoever changes the text sets `PRIVACY_LAST_UPDATED` / `TERMS_LAST_UPDATED` (October 13, 2026 since 2026-10-07: the launch day, Parker's choice) and regenerates `reports/privacy-terms-draft.md` (`npx tsx data-local/policy/policy-to-text.ts --write`; the planner can't open the app). /feedback explains the card buttons and the anonymous copies and has no form (nothing the public types is stored on the server). Contact (Phase 7b; planner reply to Checkpoint 7a, 3): "Contact: offersheet.app@gmail.com" (`CONTACT_EMAIL`; until then "Contact: to be added before launch"), and no page, metadata, manifest, footer or sharing image names a person, only "Offer Sheet" (a test checks).
  - **The shorter policy** (Phase 7b; planner reply to Checkpoint 7a, §4; the final text: `reports/privacy-terms-draft.md`): "The short version" stays first, with "Offer Sheet sets no cookies, except one encrypted cookie if you connect a private ESPN league." and "per-visitor limits, counted under codes made from your IP address with a secret key, deleted within a day"; the implementation detail users don't need is gone (the browser database's name, tabs' session codes and messages, the old storage keys and their migration, how trade-page addresses carry ids, the in-memory reuse of signed imports, the limits' windows and counts). New facts: "We keep anonymous feedback for up to 12 months, then delete it." and "When we study it, we keep only totals and the numbers our estimates learn from it, never individual copies." (the monthly-download promise is gone); the public data kept to measure accuracy (Sleeper's pre-game projections and FantasyCalc's daily lists, up to 2 seasons, about no league or person beyond which formats were in use each day, never shown); the daily usage totals (about 13 months: the counters' 400 days); Upstash in US East with backups off; FantasyCalc's values used in our own numbers but never shown, a format's list not asked for again for 3 hours once the server has it, and only when needed, and its links telling it only that a visit came from Offer Sheet; the Gmail inbox. ⚠️ The detailed part is held at 1,250 words by a test (1,249 as shown; 3,042 at Checkpoint 7a): the planner asked for about 1,000, and the next cuts would drop facts. The iPhone storage sentence says "may" (one secondary source). Terms: "Your part" in the planner's words (connect only leagues you're in or may view, don't use Offer Sheet to collect information about other people, keep your ESPN cookies private), "You must be at least 13 to use Offer Sheet.", and trade values no longer among the numbers Offer Sheet quotes.
  - **Installable:** `manifest.ts` (id "/", start_url "/league", display standalone, theme #0b1f33, icons 192 and 512 "any" plus a separate 512 "maskable"), `icon.svg`, an opaque 180 px `apple-icon.png` and a PNG-in-ICO `favicon.ico`, all drawn by `scripts/make-icons.ts` (sharp, offline) from one mark (`src/components/logoGeometry.ts`: the app's navy football on a gold tile). No service worker.
  - **Sharing and search:** metadata with a title template and `metadataBase` (https:// + `VERCEL_PROJECT_PRODUCTION_URL`, else http://127.0.0.1:3000; never a canonical or og:url in the root layout), `opengraph-image.tsx` (1200×630, static), `robots.ts` (disallow /api/), `sitemap.ts` (the 5 public pages), `noindex` on /import, /league, /trades, /analyzer and /settings, and branded not-found, error and global-error pages that show nothing of an error's message.
  - **Headers** (`next.config.ts`): production builds send a full CSP (`default-src 'self'`, inline scripts and styles allowed for Next's bootstrap, `connect-src 'self' https://api.sleeper.app https://lm-api-reads.fantasy.espn.com`, `frame-ancestors 'none'`; the Vercel Toolbar's sources only on preview builds; `OFFERSHEET_CSP_REPORT_ONLY=1` at build sends it report-only); `next dev` keeps frame-ancestors only. Plus X-Frame-Options DENY, nosniff, Referrer-Policy same-origin, a Permissions-Policy that leaves the clipboard allowed, and no X-Powered-By.
  - **Errors from the host** (`errorForStatus`): a 502 or 503 that isn't our JSON (Vercel's own page; a paused Hobby project answers 503 for up to 30 days) reads "Offer Sheet isn't available right now. Try again later."; a 504 "Offer Sheet took too long to answer. Try again in a few minutes."; a firewall's 429 states its wait.
  - **Import Report:** a "League data read by" row ("Your browser, straight from ESPN" / "Offer Sheet's server") and Refresh at most once a minute. **Settings:** the "Share anonymous feedback" switch on the "Your trade feedback" card (Section 11).

**Footer and layout**
- The footer shows:
  - "Trade values: FantasyCalc" with a link
  - the Yahoo attribution whenever Yahoo data is shown
  - "Not affiliated with ESPN, Yahoo, Sleeper, Fleaflicker, MFL or Fantrax."
  - Checkpoint 7a: a links row "Feedback · Privacy · Terms" (44 px tap targets), the FantasyCalc link, the credits ("Projections and stats: Sleeper and ESPN · Player IDs: DynastyProcess · NFL schedule: ESPN"), "Offer Sheet is a free, independent beta. It is not affiliated with or endorsed by ESPN, Sleeper, Yahoo, Fleaflicker, MyFantasyLeague, Fantrax, FantasyCalc, DynastyProcess or the NFL." and "© 2026 Offer Sheet".
  - Phase 7b: "Trade values: FantasyCalc" is a plain link in the root layout's server-rendered footer, so it's in every page's HTML, with FantasyCalc's attributes (rel "noopener", referrerpolicy "origin"; Section 2.9). The credits name exactly the sources production uses (nothing from nflverse, which was Phase 0's cross-check only).
- Design mobile-first and make it work at 375 px wide. Keep it clean, sporty and easy to read.
- Phase 4 finish: every button and link meant to be tapped is at least 44 px tall on phones, the Import Report's and the Connect page's small buttons included.

---

## 15. Config defaults (`src/engine/config.ts`)

This is the single source of truth. Every number listed here must be read from config, never hardcoded.

The server's numbers for the public beta (Checkpoint 7a: cache tiers and timeouts, rate limits, budgets, deadlines, upload caps, the token's age, the error log and the feedback store) live in `src/server/limits.ts` instead, one block per part; Section 3 and `reports/beta-infrastructure.md` give the values. Phase 7b added `healthLimits.checkEveryMs` (a store check at most every 5 minutes per instance), `snapshotLimits` (the cron: lock 10 minutes, 12 FantasyCalc formats a UTC day, kept 730 days, the formats in use kept 3 days, 5 s per store command, a format started only with 15 s left, values at most 1,000,000 characters), `usageLimits` (counters kept 400 days, held refusals written at most every 5 minutes, FantasyCalc's 10,000 sessions a month with a warning from 8,000), `modelBuildLimits` (8 League page builds at once per instance, a waiting build gives up with less than 30 s left, Retry-After 60), the log throttle (`logLimits.refusalEveryMs` 10 minutes, `repeatEveryMs` 1 minute), `rateLimits.health` 12 and `cron` 10 per 10 minutes and `sharedKinds` (import, model), `deadlines.cronMs` 110 s, and in `budgets` FantasyCalc's day of 1,500 (200 before), `reservedPerClientPerDay` (ESPN 50) and `countAheadMinMs` (1 s), and `workLimits.unpackedUnitBytes` (500,000).

| Key | Default | Section |
|---|---|---|
| actualWeight / actualFullGames | 0.25 / 6 | 6 |
| weekShapeClamp | [0.8, 1.2] | 6 |
| injury table | see Section 6 | 6 |
| sigma c/d by position | see Section 6; P uses K's (an assumption) | 6 |
| NA availability | 0 every week | 6 |
| future injury risk: M_pos (long-run share of games missed) | QB 0.06, RB 0.14, WR 0.12, TE 0.14, K 0.02, DEF 0, IDP 0.10 | 6 |
| mean injury length d | 2.5 weeks | 6 |
| free agents kept per position | 50 (`freeAgentsPerPosition`), ranked by the mean projection over the next 3 weeks (`freeAgentRankWeeks`) | 4 |
| bonusCv | 0.5 | 5 |
| market blend (`marketBlend`) | weight 0.5; QB, RB, WR, TE with a real FantasyCalc value; per game, leave-one-out; a position needs ≥ 10 healthy valued players (`minPlayers`); the factor clamped to [0.75, 1.35] (`factorClamp`, Phase 4c) | 6 |
| FantasyCalc fallbacks (`market`) | a saved list stands in up to 7 days (`fantasyCalcStaleDays`); after that our own curve fitted to a list up to 90 days old (`fantasyCalcCurveDays`, also the cache retention of the lists) | 2.9 |
| count-stat distribution (TDs, receptions, interceptions, sacks, FGs made, 2-point conversions, fumbles) | Poisson with mean = projection; exact P(X ≥ k) | 5 |
| statSd: per-stat SD for normal expected-value rules | completion % 10; D/ST points allowed 9 (measured 9.7); D/ST yards allowed 77 (⚠️ measured on weeks 1–3) | 5 |
| yardageSd: yardage SD = a + b × projected mean, at least 1 | pass_yd 0 + 0.341, rush_yd 3.9 + 0.48, rec_yd 8.8 + 0.50, kr_yd 20.2 + 0.56, pr_yd 3.7 + 1.45; other yardage 0.5 × mean (⚠️ measured on weeks 1–3, `npm run measure:stat-sd`) | 5 |
| statGrid: stat resolution for expected-value bounds | counts 1; IDP sacks 0.5; completion % continuous | 5 |
| statFloor | points and yards allowed ≥ 0; yardage ≥ 0; a floored normal keeps its mean at the projection | 5 |
| ESPN / Sleeper projection agreement needed to average them | within 10% on average (Σ\|E − S\| / Σ S) | 6 |
| projection lookback | 3 weeks | 6 |
| season projection per game | ÷ 17 games (⚠️ the season line's span is unverified) | 6 |
| P's injury risk and σ | K's (an assumption) | 6 |
| playoff-week weight ω (`lineups.playoffWeight`, `lineups.playoffWeightAuto`) | automatic since Phase 7b: B per point in playoff weeks ÷ B per point in regular-season weeks, each from my score + 3 a week (`gain`), clamped to [0.5, 4] (`clamp`), rounded to 2 decimals (`decimals`); 1.25 (`playoffWeight`, the old setting's default) is its fallback and ω₀, the weight `faMinGain`, `chipMinGap` and `throwInMaxCost` were calibrated at (× Σω ÷ Σω₀ under ω) | 7 |
| needZThreshold | −0.5 | 7 |
| availability scenarios S (common random numbers), seed | 32, 20260929 | 7 |
| known return week R | 25% / 50% / 25% over R − 1, R, R + 1 (the split is an assumption), never earlier than the status allows; Q/D/P use it only 2+ weeks out, OUT only from next week | 6, 7 |
| an IR player's expected return week | the first week his chance of being back reaches 0.5 (`returnWeekQuantile`, Phase 4b) | 6, 7 |
| IR slot statuses when the platform doesn't say (`lineups.irEligibleDefault`) | IR and PUP (the ESPN adapter sets IR and OUT, from ESPN's help center; Sleeper reads its reserve_allow_* flags) | 7 |
| a Q/D/P player's ESPN return date counts only this far out (`projections.returnConflictWeeks`) | 2 weeks | 6 |
| League page risky week (`leaguePage`) | under 40% to win (`riskyWinChance`, judged on the printed whole percent), or 3+ likely starters on bye (`riskyByes`) in a week that counts; a kicker's or D/ST's bye doesn't count when the team streams it (`streamCoversBye`, Phase 4c) | 8, 14 |
| League page needs, trade chips and partners | chip: gap ≥ 10 ROS points (`chipMinGap`; × Σω ÷ Σω₀ since Phase 7b); 3 need and 3 trade-chip chips per team; 3 partners; partner fit counts at most `maxPerSide` chips per side that stay chips together | 7 |
| chip search screen (starter-limit leagues only) | the 3 other teams with the largest exact EV gain per player (`chipScreenTeams`) | 7 |
| stale ESPN return date (Q/D/P, 2+ weeks out) | Sleeper projects him this week at ≥ 50% of his healthy base rate (`staleReturnShare`) → the date is stale | 6 |
| FantasyCalc TE premium → te++ | premium ≥ 0.75 per catch, else te+ (approved at Checkpoint 2; ✅ confirmed by FantasyCalc on 2026-10-05) | 2.9 |
| sims (final / screening), seed | 5000 / 1000, 20260930 | 8 |
| valueFloor | 1% of the top value | 9 |
| unvalued-player estimate: minimum valued players per position for the curve | 10 | 9 |
| trade-search default exclusions | P, K, DEF, IDP | 9 |
| waiverCreditMin | 1% of the top value | 9 |
| W, the best free agent the allocation leaves unclaimed (`allocation.waiverCreditPasses`) | at most 4 allocations to reach the fixed point (Checkpoint 7a) | 9 |
| inactive teams make no pickups (`allocation.inactiveWeeks`) | no transaction in the last 5 weeks (0 turns the rule off; Checkpoint 7a) | 7 |
| studExponent | 1.0 | 9 |
| "What does your league reward?" ("What matters most" in Phase 4c; `benefit.goals`, `goalDefault`): ΔPO / ΔCH weights | Only the champion (`title`) 0.15 / 0.85 (default); Top finishers too (`balanced`) 0.35 / 0.65; Making the playoffs (`playoffs`) 0.70 / 0.30 (Phase 4c; 0.35 / 0.65 fixed before) | 10 |
| market term κ, "Protect my trade value" (`protectValue`) | Low 1 / Medium 2 (default, `protectValueDefault`) / High 4 projected points a week per 100% of trade value, the term (B₃ / 3) × κ × clamp(g_mkt(me)) (Phase 7b; from the addendum to Checkpoint 3 until Checkpoint 7a, Low 2 / Medium 4 / High 8 in B units; 1.0 before the addendum); redraft only | 10 |
| value floor | every player counts at max(v, W) in every package sum, both sides (Phase 4b) | 9 |
| star premium (`acceptance.starPremium`) | e_rank #1 0.10, #2 0.05; e_elite 0.10 for the top 12 by FantasyCalc value (`eliteTop`); dynasty, partner's P(playoffs) < 25%: × 0.5 for RBs and WRs aged 27+; "Harder to get" at e ≥ 0.15 (`harderToGetMin`) | 11 |
| B_future scale | 40 | 10 |
| λ defaults | 0.35 / 0.5 / 0.75; keeper 0.2 | 10 |
| "Helps you" scale B₃ (`benefit`) | the B of +3 pts a week (`helpsGain`), floored at 0.5 (`helpsFloor`); in dynasty and keeper leagues with long-term values B_ref(λ) = (1 − λ) × B_win₃ + λ × F₁₀, F₁₀ = 40 × `helpsFutureShare` (0.1) = 4 (Phase 7b; it replaced `helpsLambdaMax`, λ capped at 0.75 in B₃); replaced the fixed B_ref (6 from Checkpoint 3, 5 before) at Checkpoint 7a | 10 |
| streaming positions | default K and DEF (user can add QB or TE); replacement = the 3rd best free agent that week (`streamRank`); another team streams a position after 2+ adds there this season | 7 |
| free-agent optimizer | moves of at least 3 ROS points (`faMinGain`; × Σω ÷ Σω₀ since Phase 7b), at most 5 moves (`faMaxMoves`); dynasty guard `faDynGuard` 0.05 × the top dynasty value; never K or DEF (`optimizerExcluded`) | 7 |
| forced drops and V*'s cuts on a near-tie (`lineups.dropNearTieWeekly`) | within 0.2 lineup points a week, the lower trade value goes (floored at W); no long-term values only (Phase 4c) | 7 |
| market check / hide thresholds | −0.15 / −0.35 | 10 |
| "depends on an injured player" statuses | OUT, IR, PUP (`benefit.injuredStatuses`) | 10 |
| acceptance β's | see Section 11; β_need 1.2 in redraft and keeper leagues, 0.6 in dynasty (`beta.need`, `beta.needDynasty`; Phase 4b) | 11 |
| P_accept clamp | [0.02, 0.85] (0.95 before Phase 4b) | 11 |
| veto rule | g < −0.30 → × 0.5 | 11 |
| max players per side | 2 (user can allow 3) | 12 |
| give pool / get pool size | 10 / 10 untagged + 3 "Harder to get" (`getPoolTagged`) | 12 |
| offer-first steps | throw-in: lineup cost ≤ 5 ROS points (`throwInMaxCost`; × Σω ÷ Σω₀ since Phase 7b); a step shows when it adds ≥ 5 points of acceptance (`steps.minAcceptGain`) and the offer first prints ≥ 10% (`minOfferFirst`), and in case 1 at least the user's minimum chance too (`evaluate.offerFirstBar`, Phase 4c); an added throw-in keeps B ≥ 80% of the offer's (`minBShare`); case 2 evaluates the best 2 candidates exactly (`preScreen`) | 13 |
| League page "Best of their trade chips" floor | 1 projected point a week, as printed, for every lead line (`needs.bestTargetMin`, N12) | 14 |
| extension beams (2nd / 3rd player) | 60 / 40 | 12 |
| kept per partner | 30 | 12 |
| exact-evaluation max (all partners) | 200 | 12 |
| screening g_mkt(P) window | [−0.35, 0.6] | 12 |
| exhaustive candidates (`search.exhaustive`) | every 1-for-2 and 2-for-1 from the pools; 2-for-2 from the first 6 of each (`twoForTwoTop`, Phase 4c) | 12 |
| final-simulation finalists | 60 (40 before Phase 4c) | 12 |
| minimum chance (`ranking`) | options Any, 10%, 20%, 30%, 40%, 50% (`minChanceOptions`); default 10% (`minChanceDefault`); fewer than 5 shown ideas suggests a lower setting (`minChanceFew`) | 13 |
| results shown | 25 | 12 |
| diversity caps | 3 per partner in the top 20 (`partnerCapTop`); 2 per core; 3 per given player of mine in the top 20 (`perGivenPlayerInTop20`, Phase 4b; my must-include players exempt since Phase 4c) | 13 |
| Plan B (`search.planB`) | Helps you ≥ 50% of the card's (`minHelpsShare`); up to 3 candidates tried (`tries`); ⚠️ and P_complete ≥ the card's + `steps.minAcceptGain`, never a card shown, and at most `ranking.perGivenPlayerInTop20` (3) boxes in the top 20 add the same player of mine | 13 |
| extension pairing (one player added to each side) | the 5 best single additions per side (`pairExtensionTop`) | 12 |
| Trade Analyzer players per side | 4 (`analyzerMaxPerSide`) | 13 |
| search progress (responsiveness, not a model number) | yield every 100 screens / 5 screening simulations (`yieldEveryScreens`, `yieldEverySims`) | 12 |
| exact title odds: re-seeding brackets computed exactly from | 8 teams left (`exactReseedTeams`; a speed limit) | 8 |
| explanation thresholds (`explain`, display only) | slot change 1 pt/wk; lineup change 0.5; playoff gain 1; risky week 3; even value ±5%; partner reasons need a 0.1-logit term, at most 3; long-term value 1%, first when λ ≥ 0.5; hole rank quoted in the bottom half; (until Phase 7b: value as a multiple above 100%, `valueMultipleAbove`, and the pitch's value from 5% up to 25%, `pitchValueMax`, both removed with the value numbers); weekly lines: moves of 3+ points (`weeklyLineMin`), at most 4 (`weeklyLineMax`); pattern note: 5 of the top 10 (`patternMinCount`, `patternTop`), a driver in half his trades (`patternDriverShare`), at most 3 (`patternDriversMax`), injury cover 0.5 pts/wk (`patternDepthCoverMin`) (Phase 4c) | 13 |
| filler cutoff | 0.2 × B | 13 |
| "Waiver upgrades" (`waivers`, display only; Phase 7b) | a pickup starts when he adds more than 0.05 projected points in EV lineups (`startsMinPoints`), else "Depth only"; at most 3 rows (`perPositionCap`) at K and D/ST (`cappedPositions`), at a position I stream in a one-week list, and where none of my players scores; gains shown and ordered to 1 decimal (`gainDecimals`); 10 rows before "Show all" (`rowsShown`) | 7, 14 |
| acceptance feature constants | n scale 5; n blend 0.5 on the next 4 weeks (`nBlendWeight`); hole = below 60% of median over 3 weeks; activity windows 3 / 4 / 5 weeks; hot 1.5× over 2 weeks, ±0.15; urg +0.2 within 7 days; ctx −0.8, −0.25 at age 28+, ×1.3 | 11 |

---

## 16. Testing

- **Vitest unit tests** for every engine function, plus:
  - property tests of the lineup solver against brute force
  - the scoring oracle tests (Section 5), covering every rule type
  - the acceptance anchor tests (Section 11)
  - ESPN private-league error paths (401, 403, HTML login page), tested with mocks until a real private league is available
- **Simulation sanity tests:**
  - Σ P(title) = 1
  - Σ P(playoffs) = playoffTeams
  - a no-op trade has exactly zero delta under common random numbers
- **Adapter tests** run on sanitized fixtures, with no network.
- `npm run probe:all -- --live` runs the live checks by hand (every probe needs `--live` since Checkpoint 7a, Section 0.9).
- `npm run check:browser -- --live --team <id>` (Phase 4b; after `npm run build`; `--live` since Checkpoint 7a, Section 0.9) runs the production build in headless Chrome on Parker's league at 375 px: every page, a full Trade Finder search with its timings, a card's buttons, the Analyzer and Settings; no sideways overflow, no console errors, tap targets of at least 44 px, "Harder to get" never on his own players. The league id is read from `.env.local` and never printed; output and screenshots are cleaned of league names and stay in git-ignored `.cache/check-browser/`. Phase 4c: it reads saved data from IndexedDB (never creating the database), and `--second-league` adds the public ESPN test league 899513 through "Add league", checks every page shows it with its own settings and feedback, switches back (a partner picked on one league's Finder doesn't follow), and removes it from a trade page whose address names a team.
- Checkpoint 7a: check:browser also fails on any Content-Security-Policy violation (enforced or report-only, in a page or the Web Worker: workers report them only as CDP Audits issues), checks the Public pages (Home, Privacy, Terms, Feedback, a missing page, then the site files: headers, manifest and icons, the sharing image, robots.txt and the sitemap) even after a failed import, checks the header's first row at 320 px with the real league switcher, reports which path read the league ("League data read by"), and counts only the league's own data requests to ESPN and Sleeper as platform reads (any other request there, or to another host, fails).
- Phase 7b: check:browser also covers Checkpoint 7b (`scripts/check-browser/contracts.ts` holds the rules, `steps.ts` the steps): no FantasyCalc value or value comparison on the cards, the League page (every player breakdown opened) or the Analyzer; FantasyCalc's links (rel exactly "noopener", referrerpolicy "origin") in every app page's server HTML; no code, path or stat id above the Import Report's technical details, and a Notices step (the "Things to know" card, banner and warnings box speak plainly); the Waivers step and the nav's two rows of three at 375 px; the Trade Finder's freshness and best-time lines; Settings' goal wording, read-only playoff weight and trade-value help; the Analyzer's back link not prefetched. An "info" line (a new status, not a failure) says where the league's own data differs from what a check expected of it (with `--team`: Parker's league showing a notice or banner the planner expected it not to, its scoring card's quiet line reading differently, the blend reaching nobody).
- Phase 7b's guards in the unit tests: `src/lib/fantasyCalcHidden.test.ts` (no FantasyCalc value or comparison on the cards, the Trade Finder, the Analyzer with its Details, the League page with every breakdown, Settings or the Import Report, built from fixtures with distinctive values; Settings is also read for an exchange rate between trade value and points), `src/lib/notices.test.ts` (every warning code has its rule), `src/server/clientBundle.test.ts` (no client entry, a "use client" module or a Web Worker, reaches server code or a server-only package), `src/server/nextConfig.test.ts` (the image optimizer stays off and nothing imports next/image), and `src/app/pages.test.ts` (the policy pages' words both ways, the privacy page's detailed part at most 1,250 words, no person's name).
- Checkpoint 7a's offline measurements: `npm run measure:cache` (the shared cache: reducers proved equal on every cached body, sizes, Upstash commands and bytes per session through FakeRedis, CPU) and `npm run measure:upload` (browser uploads: sizes, server CPU, identical to the server's own read). `npm run beta:log -- --live`, and since Phase 7b `usage:report`, `feedback:report` (it replaced `feedback:pull`) and `snapshot:pull` (each with `-- --live`), read the shared store (read-only since 2026-10-07: `READONLY_STORE_URL` and `READONLY_STORE_TOKEN` typed into .env.local by hand, Upstash's read-only token under names the app never reads, no SESSION_SECRET; `scripts/lib/storeReader.ts` gives them the three read commands they use, and before the first read deletes a key nothing writes, which fails closed (review of the follow-ups, SEC-1): the reader opens only when Upstash refuses that DEL with its permission error (NOPERM), on the first try or on a second one a second later when the first got no clear answer; a carried-out DEL (a token that can write), or no clear answer twice, stops the script, and nothing is read; ⚠️ Upstash's wording of the refusal is assumed until the first live run: were it worded otherwise, every run would stop with "Couldn't confirm …", never reading with a token that could write; they print only whether each variable is set).
- Phase 7b's scripts:
  - `npm run usage:report -- --live` (`--env production` after the "go", `--days N`; read-only, one MGET): the month's sessions (League page builds answered) against FantasyCalc's 10,000 with a warning from 8,000, today's work units against the day's work budget and its current slice, today's outbound requests against each platform's day, the capacity refusals, the month to date and a line a day. Vercel's own usage isn't in the store: `npx --yes vercel@62.2.0 usage --group-by project --non-interactive`, run from a folder other than this one.
  - `npm run snapshot:pull -- --live` (production by default, `--env preview`): copies the cron's archive (Sections 2.3, 2.9) into `data-local/` (projection weeks merged, each day's list kept as first written), every record checked before it's written; running it again writes only what's new.
  - `npm run feedback:report -- --live` (`--env production`, `--days N`): the anonymous feedback in totals only (Section 11).
  - `npm run load:test` (B4; offline by construction, Section 0.9; about 4.5 minutes): 50 requests at once through the real route code (withRoute, the handlers, adapters, crosswalk and model build over the real HTTP client) against mocked platforms and FakeRedis, scenarios 1–6 with multi-instance variants (`--scenarios`, `--redis-ms`, `--build-slots`, `--imports`, `--spread`, `--seed`); results and the fixes it led to in `reports/load-test.md`. The small live test the planner asked for ran on 2026-10-06 on the protected preview (5 imports and 5 League page builds of the public test league 899513 through the server path, all 200; `reports/load-test.md`, last section; ⚠️ ESPN requests per burst weren't measured).
  - `npm run vercel:secret -- --live --name CRON_SECRET` gives production its cron secret (CRON_SECRET's default environment is production, since Vercel runs crons there only; never shown).
  - The health check on a protected preview: `npx --yes vercel@62.2.0 curl <preview address>/api/health -- -s` (the logged-in owner's automatic bypass of Deployment Protection; don't pass `--non-interactive` there, it goes to curl).
- `npm run preview:deploy -- --live` (Checkpoint 7a; `scripts/preview-deploy.ts`) makes a **protected preview** deployment and nothing else: it refuses production options, checks `.vercelignore` is the allowlist, dry-runs the Vercel CLI to see every file that would upload (nothing private, under 2,000 files and 50 MB, framework nextjs), checks that Deployment Protection is on, deploys with `--project offersheet` (never `vercel link`, which writes a token into .env.local, seen at Checkpoint 7a), and removes the deployment at once if its address answers an anonymous visitor. Final review SEC-8, SEC-9: it also refuses any file to upload that isn't committed as it is (untracked, or changed since the last commit), runs the leak scan over exactly the files it would upload, and checks (by name only) that the Preview environment has SESSION_SECRET. `npm run vercel:secret -- --live` gives an environment its own random SESSION_SECRET (piped to `vercel env add … --sensitive`, never printed or kept; `--env production` at Checkpoint 7b; `--replace` resets that environment's sessions, tokens, cache keys and counts).
- `npm test`, `npm run typecheck` and `npm run lint` must all pass before every checkpoint.

---

## 17. Phases

### Phase 0 — Data access gate (no app features)

1. **Scaffold** Next.js, TypeScript, Tailwind, Vitest and zod.
   - `.gitignore` must cover `.env*` (but keep `.env.example`), `.cache/` and `fixtures/raw/`.
   - Create `.env.example`.
   - Add at least one smoke test so `npm test` passes. Vitest exits with an error when there are no tests.
   - Run `git init` and make the first commit.

2. **Write probe scripts:**
   - `scripts/probe-espn.ts`
   - `scripts/probe-sleeper.ts`
   - `scripts/probe-shared.ts`: FantasyCalc, the ID map, the NFL schedule, and Sleeper and ESPN projections
   - `scripts/probe-fleaflicker.ts`
   - `scripts/probe-mfl.ts`
   - `scripts/probe-yahoo.ts`: only if the `YAHOO_*` variables are set; otherwise report "awaiting Yahoo approval"
   - Add `npm run probe:all`.

3. **Pick test leagues.** Use Parker's leagues from `.env.local` first. For any platform where he has no league:
   - **ESPN:** public league **899513**, season 2026. (Phase 0 found it has drafted, so it also serves the scoring oracle.)
   - **Sleeper:** ask Parker for any league ID or username.
   - **MFL:** find one with `leagueSearch`.
   - **Fleaflicker:** ask Parker, or try a known public league.
   - **Fantrax:** skip it unless someone has a public league ID.

4. **Check every item** in the Data Checklist below, for each platform. Print ✅, ⚠️ or ❌ with the JSON path and a sample value. Include no secrets and no leaguemates' names.

5. **Save** raw responses to `fixtures/raw/` and sanitized copies to `fixtures/sanitized/`.

6. **Write** `reports/data-access.md` (the platform × checklist matrix) and the Checkpoint 0 report. Then **stop**.

**Data Checklist**

| | Item | What to confirm |
|---|---|---|
| A | League basics | Season, current week, number of teams, regular-season weeks, playoff start week, number of playoff teams and byes, trade deadline, trade review/veto setting, league type (redraft/keeper/dynasty), median-game and points-only flags, divisions |
| B | Lineup | Every starting slot and its count, including FLEX variants, SUPER_FLEX/OP, K, DEF and IDP; bench, IR and taxi sizes; position limits; max roster size |
| C | Scoring | Every rule and its points: receptions (including position-specific), pass/rush/receiving yards and TDs, interceptions, fumbles, 2-point conversions, first downs, bonuses, kickers, DEF/DST and IDP. List anything unmapped. |
| D | Teams | IDs, names, owner display names, and which team is Parker's |
| E | Rosters | Every player on every team, including IR and taxi; position; NFL team; injury status; platform player ID |
| F | Schedule | Fantasy matchups for every remaining regular-season week; current W-L-T and points for/against |
| G | Transactions | This season's trades, with week or date and the players involved; add/drop counts per team |
| H | Free agents | Available players, either listed or derivable |
| I | Draft picks | Future pick ownership, for dynasty and keeper leagues (Sleeper `traded_picks`, MFL `futureDraftPicks`) |
| J | Projections | Current-week and future-week projections for each player, either league-scored or stat-level |
| K | Completed weeks | Actual stats plus league-scored points, for the scoring oracle |
| L | NFL schedule | Bye weeks and the NFL schedule |
| M | FantasyCalc match rate | The share of rostered QB/RB/WR/TE matched to FantasyCalc. Target: at least 98%. List the misses. |

### Phase 1 — ESPN and Sleeper import, ID crosswalk, scoring engine, Import Report

**Build**
- adapters that produce a `LeagueSnapshot`
- the player ID crosswalk (DynastyProcess map plus FantasyCalc IDs), so every player has a canonical ID from the start
- the scoring maps and oracle tests
- the Connect and Import Report pages
- "my team" detection
- ESPN credentials entered on the Connect page:
  - send them to the server in a POST body
  - keep them only in an encrypted, httpOnly, **session-only** cookie (no Expires or Max-Age)
  - never put them in a URL, localStorage or logs
  - Parker's own credentials can still come from `.env.local` in development, only with `USE_ENV_COOKIES=1` (Section 0.5)
- the ESPN connect flow from Section 14 (public link first; for private leagues, ask the commissioner or use cookies)
- the general scoring rules (Sections 4 and 5) and the model fields added after Checkpoint 0 (`P`, starter limits, roster minimums, best ball, playoff seeding)
- the Sleeper decisions from Section 2.3 (trade review, position limits, guillotine rejection, best-ball note)

**Checkpoint 1 includes**
- the Import Report contents for Parker's leagues, described in words
- the oracle results, per rule type
- all warnings
- every CLAUDE.md section changed since Checkpoint 0

### Phase 2 — Projections, lineup solver, market values, needs, League page

**Build**
- the projection model, including future injury risk (Section 6, step 3)
- rest-of-season points shown to users (Section 6, step 7)
- the lineup solver, with availability scenarios for exact evaluation (Section 7)
- FantasyCalc values
- needs, surplus and best trade partners
- the League page, without playoff odds (those arrive in Phase 3)
- the FantasyCalc format note in the Import Report (Section 14), deferred from Phase 1
- the Checkpoint 1 answers: count-stat distributions (Section 5), the PROBABLE status, the `USE_ENV_COOKIES` development default, the crosswalk rules (Section 2.9) and the compact phone picker (Section 14)

**Checkpoint 2 includes**
- Parker's projected points per week against the rest of the league
- ROS points and projected points per week for every rostered player in Parker's league
- the needs and surplus table for every team
- the FantasyCalc has-a-value and ID match rates
- lineup solver test results
- timings, including the runtime impact of the availability scenarios
- a before/after example of a bench player's value to his team under expected-value lineups versus scenario lineups
- every CLAUDE.md section changed since Checkpoint 1

### Phase 3 — Season simulator

**Build**
- the season simulator, with the weekly team σ adding the spread across availability scenarios (Section 8), and the league's own seeding tiebreaker when the platform reports it
- playoff, bye and title odds on the League page, and each remaining week's risk (Section 8)
- the Checkpoint 2 answers:
  - free-agent-adjusted baselines for MV_add as well as MV_lose (Section 7)
  - trade chips in place of surplus, and partners built from them (Section 7)
  - Sleeper as the tiebreaker for a far ESPN return date on a Q/D/P player, with the note (Section 6)
  - pre-game projection snapshots and `npm run snapshot:projections` (Section 2.3)
  - per-week projection caching and single-flight fetches (Section 2.10)

**Checkpoint 3 includes**
- playoff, bye and title odds for all teams in Parker's league, next to the current standings
- simulation runtime at 1,000 and at 5,000 simulations
- the no-op check: a trade that changes nothing moves no odds
- a Trade Score scale check: for Parker's team, B and the Trade Score from a hypothetical +1, +3 and +6 projected points per week for the rest of the season. The planner's toy league gave B ≈ 1.7 / 5 / 10. If Parker's league differs a lot, propose a new B_ref.
- every CLAUDE.md section changed since Checkpoint 2

### Phase 4 — Trade search, benefit, acceptance, Trade Finder and Analyzer

**Build** what Sections 10–13 specify, plus the Checkpoint 3 decisions:
- first, streaming positions (Section 7, model change 1), because they change baselines, needs, chips and B; then the free-agent optimizer (model change 2) everywhere a trade is scored
- B_ref 6, the Q/D/P base-rate rule (Section 6), and the chip display (cost and starter tag)
- the three numbers on every card, sortable, with Overall as the default sort; ROS points given and received, required drops and adds, risk flags, plain-English reasons and the copy-ready pitch message (Sections 10 and 13)
- the feedback buttons (Sent / Accepted / Rejected / Countered, and Report with its reasons), stored locally, with a JSON export and the summary script (Section 11)
- other teams' completed ESPN trades, which come without their players, refilled from player data, so the activity and hist features have data (approved at Checkpoint 1)
- the Trade Analyzer: the user builds any trade, including counteroffers, and sees the same evaluation
- the Settings page (Section 14 item 6), including "Positions I stream weekly"
- every trade chip joins the give pool; in a keeper league without dynasty values ΔDyn is missing and the card says so (Checkpoint 2)
- performance: 10 seconds or less for Parker's league, in the Web Worker, with a progress bar

**Checkpoint 4 includes**
- Parker's top 10 trades: for each, give/get, the three numbers, ΔPPW, ΔPO, ΔCH, ROS points in and out, g_mkt for both sides, the partner's n, the reasons and the pitch message
- a realism check on the top 25: the distribution of g_mkt(partner). If most suggestions ask partners to give up more than 15% in value, say so: the search would be favoring lopsided offers
- a consistency check: no suggested trade's B comes from free-agent pickups. Confirm it holds by construction, and show one test
- the acceptance anchor tests, still within ±1 point
- runtime, total and per stage (screening, exact evaluation, screening sim, final sim)
- one example evaluated in the Trade Analyzer: a trade that looks great for Parker but that the model gives a low acceptance chance, and why
- the free-agent optimizer: the Bo Nix → Team 1 example, McCaffrey's chip gap under the new baseline, and how many moves teams typically make
- every CLAUDE.md section changed since Checkpoint 3
- the planner's addendum (`reports/planner-reply-3b.md`), applied before the reports were regenerated: the star premium (§11), "Harder to get" (§11, §14), "Protect my trade value" (§10), and "Offer first / if they say no" (§13); and in the report: Parker's top 10 before vs after the addendum with the three numbers and any "Harder to get" players, the Smith-Njigba example under the old and new models, the g_mkt(me) distribution of the top 25 before and after, and how many cards show an "If they say no" step

### Phase 4b — The planner's reply to Checkpoint 4 (`reports/planner-reply-4.md`)

**Why:** the live results at Checkpoint 4 showed the model wasn't ready for Parker to act on. The top ideas mostly sold Garrett Wilson (15 of 22) and bought injury-tagged players (8 of the top 10): the search ranks thousands of trades by our own model's edge, so its top fills with the places our projections disagree most with the market (the optimizer's curse). And the acceptance estimate rated trades that cost the partner's lineup too high.

**Build**
- market-blended projections (Section 6 step 8)
- the acceptance rebalance: β_need 1.2 in redraft and keeper leagues, the 0.85 cap, the new anchor tables (Section 11)
- one free agent, one team, in waiver order (Section 7)
- the value floor at W on both sides, replacing lead decision N10 (Sections 9 and 10)
- IR players: their return counted in team strength, tradable, IR-slot legality (Sections 6, 7 and 12)
- cards and pages: injury tags, Plan B, at most 3 trades in the top 20 giving the same player of mine, "Best of their trade chips" and "See trade ideas with Team X →", and the version sent in the feedback (Sections 11, 13 and 14)
- `npm run check:browser` and the local FantasyCalc archive (Sections 2.9 and 16)
- the answers to Checkpoint 4's questions: κ stays Medium; the throw-in rules stay; N11 and N12 are confirmed; up to about 3 lineup points per player from pickups is accepted; draft picks wait for Phase 5; cold load times are accepted until Phase 7's shared cache; the review period goes to Phase 6; after 4b the order stays Phase 5 → 6 → 7

**Checkpoint 4b includes**
- Parker's top 10, before (Checkpoint 4) and after, with the three numbers, injury flags, how many receive an injury-tagged player and how many give Garrett Wilson
- blend sensitivity: the median g_mkt(you) of the top 10 and the top 25 at `marketBlend` 0, 0.25 and 0.5
- Parker's odds over time (Checkpoint 3: 78.6% / 19.7%; Checkpoint 4: 67.8% / 13.3% as rosters stand, 62.9% / 11.6% with pickups; now), each move explained by cause: roster and injury news, streaming, the pickup baseline, and model changes
- the free-agent allocation: how many duplicate pickups went away, where Mark Andrews lands, and whether any top trade still depends on a pickup another team would make first
- cards: how many show Plan B and how many an offer-first step
- the new anchor tables passing
- runtime, total and per stage
- every CLAUDE.md section changed since Checkpoint 4

### Phase 4c — The planner's reply to Checkpoint 4b (`reports/planner-reply-4b.md`)

**Why:** Parker plans to send his first real offers from the Phase 4c list. The planner approved Checkpoint 4b and asked for these changes first; items 8–12 came from Parker's first look at the site.

**Build**
- exhaustive two-player candidates per partner and 60 finalists (Section 12)
- throw-ins worth at most W left out of both sides' totals (Sections 9, 10 and 11)
- one value number per card: FantasyCalc's own values in the reasons and the pitch (Section 13)
- the blend factor capped at [0.75, 1.35] (Section 6 step 8)
- the weekly reset waiver order (Sections 2.2, 2.3 and 7)
- the pattern note (Section 13)
- the sent version's model inputs in the feedback (Section 11)
- "What matters most" (Section 10)
- real odds on every card, and one baseline everywhere (Sections 8, 13 and 14)
- the minimum-chance filter (Sections 12–14)
- saved leagues and the league switcher (Sections 3 and 14)
- FantasyCalc fallbacks (Section 2.9)
- the answers to Checkpoint 4b's questions: the per-game blend stays, its partial double count on injured players accepted on purpose; the weekly reset order; Plan B's 5-point bar stays; the given-player cap of 3 stays, with the pattern note; long shots give way to the minimum-chance filter, and a chance under 5% shows as "<5%"; throw-ins are neutral; a pickup a trading team releases going to nobody is accepted; OUT players into open IR slots wait for Phase 6; the sent version's inputs are stored now. Also approved: dynasty blend values from the format's own list, the claim rules, the Plan B rules, the IR rules, the K/D-ST refill rule, and removing the before/after variants.

**Checkpoint 4c (short) includes**
- Parker's top 10 under "Win the title": the three numbers, title and playoff odds before → after, the weekly lines, injury tags, Plan B and offer-first counts, and the pattern note if it shows
- the goal setting: how the top 10 changed from Balanced to "Win the title"
- the search gap: Hubbard + Evans (or better) found, the new screened count and runtime
- the blend: the 10 most extreme factors before the clamp, with reasons
- Parker's odds with the weekly reset waiver order, on the one shared baseline
- multiple leagues: the migration kept settings and feedback, and switching works (one test league added)
- anything else that looks off, in one paragraph

### Phase 7a — Small fixes, then the public beta's infrastructure (`reports/planner-reply-4c.md`)

**Why:** Checkpoint 4c is the first list Parker sends real offers from, and trade deadlines are in November. Real users' Accepted and Rejected outcomes are what calibrate the acceptance model, so a free public beta with ESPN and Sleeper (Phase 7, pulled ahead) comes before Phase 5 and 6. **Production goes live only on Parker's explicit "go" at Checkpoint 7b**; until then, protected preview deployments (Vercel Authentication) only. After launch: Phase 5, then Phase 6, then the Chrome extension.

**Part A, small fixes (done first; committed and tagged `checkpoint-7a-part-a`)**
- A1: Parker's stable copy, `npm run stable` on port 3000; development on 3001 (Section 0.13)
- A2: "Helps you" calibrates itself per league and goal, B₃ (Section 10)
- A3: W = the best free agent no team is predicted to claim (Section 9)
- A4: inactive teams make no baseline pickups (Section 7)
- A5: scripts are offline by default (Section 0.9)
- the answers to Checkpoint 4c's questions: B_ref calibrated (A2); W unclaimed (A3); the throw-in additions (matched pairs, lean versions, Plan B bars) stay; every lead decision OK; injury tags fine (Parker refreshes after Monday night's game, when the tags update, before he sends offers)

**Part B, the beta (B1–B3; B4 is Checkpoint 7b)**
- B1 infrastructure: a shared server cache (Upstash Redis's free tier through the Vercel Marketplace, single-flight, hashed keys, private-league data keyed by a credential hash); per-IP rate limits on every server route; outbound pacing and a daily request budget per platform, especially ESPN; Sleeper and public ESPN leagues fetched from the user's browser (private ESPN stays on the server); friendly "the data source is down" messages; error logging that never records credentials or league data
- B2: the anonymized server-side feedback store, with an opt-out and rate limits (Section 11)
- B3: the home page with the landing page's wording and a "Beta" label, `/privacy` rewritten to match, `/terms`, the footer (a feedback link, the attributions, "Not affiliated with ESPN or Sleeper…"), a PWA manifest and icons, an SEO title, description and Open Graph image, everything at 375 px; the Connect page keeps both private-ESPN paths

**Part B as built** (Checkpoint 7a; two build waves of five tracks, each built, reviewed and fixed, then a final review)
- B1: the shared store and cache, the server routes' limits, budgets, deadlines and error log, and browser reads with signed imports (Section 3); the policy switches and the deploy script (Sections 14 and 16). Upstash is used on Vercel only; locally everything runs as before.
- B2: the anonymous feedback store (Section 11).
- B3: the pages, installable app, sharing image, search files, error pages and headers (Section 14).
- Deploying: `.vercelignore` (an allowlist: src, public and the build's config files), `vercel.json` (framework nextjs, iad1), `engines.node` "22.x" (the project defaulted to Node 24), `SESSION_SECRET` set for Preview (generated, never shown), and `npm run preview:deploy -- --live` (Section 16). The project `offersheet` has Fluid compute on (300 s default), Standard Protection with Vercel Authentication, and isn't connected to git.

**Checkpoint 7a includes**
- the stable-copy commands
- B₃ for Parker under each goal, and his top 10 on the new scale
- the cache and rate-limit design and the free-tier limits
- the drafts of the privacy and terms pages
- anything that needs Parker to act, with click-by-click steps
- a protected preview Parker can open on his phone

### Phase 7b — Readiness (B4), then go/no-go

- a security review: session cookies, same-origin checks, headers and a dependency audit (one focused pass)
- a load test: 50 imports at the same time against mocks, plus a small live test within the politeness limits
- base-rate stability (moved up from Phase 6): measure day-to-day odds swings that injuries and results don't explain; if large, smooth the base rate (for example the average of the last 2–3 pre-game projections)
- terms: Parker emails FantasyCalc before launch (the te+/te++ question and our private daily copies), and launch waits for their answer or a few days without objection; Sleeper allows non-commercial use; ESPN's API is unofficial (polite requests, a clear failure if blocked); the DynastyProcess map stays server-side (GPL-3.0). FantasyCalc answered on 2026-10-05: free use under conditions (Section 2.9).
- Checkpoint 7b: B4's results and a go/no-go list. Production waits for Parker's go.

**The planner's reply to Checkpoint 7a** (`reports/planner-reply-7a.md`): Checkpoint 7a approved once the Upstash check passes and Parker confirms the preview on his phone (then tag `checkpoint-7a`). Sections 1–5 are launch blockers, section 6 comes after them (the waiver view may ship right after launch). §1 the Upstash check; §2 the planner's answers (question 5: "Protect my trade value" in lineup points; 6: the dynasty scale follows the slider; 7: beta capacity, the capacity message, `usage:report`, fewer cold Upstash reads if cheap, the WAF rule on Hobby); §3 Parker's answers (contact offersheet.app@gmail.com, "Offer Sheet" with no personal name, the icon kept, feedback kept 12 months); §4 the privacy and terms edits; §5 plain-language notices (5.1), the goal framed by what the league rewards (5.2), freshness and the best time to look (5.3), FantasyCalc's conditions (5.4); §6 the automatic playoff-week weight (6.1), waiver upgrades (6.2), the automatic pre-game snapshots (6.3).

**Phase 7b as built** (three build waves, with reviews along the way, then a final review)
- §1: `/api/health` (Section 3), read on a preview through `vercel curl` (Section 16).
- §2: the market term priced in lineup points and B_ref(λ) (Section 10); the capacity message, the per-visitor BUSY words and the usage counters with `npm run usage:report` (Sections 3, 16); on an instance, concurrent reads of a shared-cache entry share one Upstash read, so a cold burst reads each about once (Section 3; ⚠️ the planner's example, serving the public data from Vercel's CDN, wasn't built).
- §3: `CONTACT_EMAIL`, no person's name anywhere (Section 14); feedback kept 365 days from its day (Section 11).
- §4: the shorter privacy policy and the terms' edits (Section 14; final text in `reports/privacy-terms-draft.md`); `feedback:report` keeps totals only (Section 11); the public archive is said.
- §5.1: notices (Section 14: the Import Report, the League page's banner, the Finder's warnings box; `scoredThisSeason`, `ImportWarning.players` and `.teams`, Sections 2.2 and 4). §5.2: "What does your league reward?" (Sections 10, 12, 14). §5.3: the best-time and freshness lines, with `LeagueSettings.tradeReviewHours` (Sections 2.2, 2.3, 14). §5.4: FantasyCalc's conditions (Sections 2.9, 13, 14, 19): no value numbers, the links, 3-hour refreshes, `/values/current` only; `reports/fantasycalc-permission.md`.
- §6.1: the automatic playoff-week weight (Section 7; read-only in Settings). §6.2: Waiver upgrades (Sections 7, 14) with ESPN's waiver status (Section 2.2). §6.3: the snapshot cron and `snapshot:pull` (Sections 2.3, 2.9, 3).
- B4 security review: the fixes in Section 3 ("B4's other fixes", the rate limits' shared kinds, the unpacked-size pricing, the cookie reserve's per-client share, the log throttle, the health check's 5 minutes) and Section 2.2 (`espn_s2` at most 2,000 characters). B4 load test: `npm run load:test` (Section 16) and its fixes (attempts counted when next in line, refused work given back, 8 builds at once per instance, shared cache reads, `.gitattributes`); `reports/load-test.md`, which lists what's still open (⚠️ partial imports answer 200, a busy-instance refusal isn't in usage:report's refusals); the small live test ran on 2026-10-06 on the protected preview (Section 16). B4 base-rate stability: `reports/stability.md` (no smoothing for launch: refreshes about a day apart stayed under the bar, ⚠️ the lead's bar; a 2-pull mean is ready if wanted, and Phase 6 re-measures).
- Also: a budget cut no longer starts Sleeper's instance-wide hold (Section 2.3); FantasyCalc's `/players` no longer called (Section 2.9).

**Checkpoint 7b includes** (the planner's list)
- Upstash: the check's results (the variables on Preview and Production, names only; the preview on the shared store; the database in US East with backups off).
- Privacy and terms: the final, shortened text.
- Notices: what Parker's league shows after the cleanup.
- Parker's numbers: his B₃, his automatic playoff weight, and his top 10 under the new trade-value pricing, briefly.
- The waiver upgrades view: the top rows for Parker's team, or a note that it ships right after launch.
- B4: the security findings, the load test, and the stability numbers (with smoothing if it was needed).
- Capacity: the capacity message and the `usage:report` output.
- The snapshot cron: configured, and tested locally by calling the route with the secret.
- The go/no-go list: FantasyCalc's conditions met (5.4: no value numbers anywhere in the UI, the backlink in server HTML on every app page, the 3-hour caching); the contact email; the launch dates; and section 4's checks: no league ID, username, SWID or cookie ever in a URL or query string (Vercel logs addresses for an hour); Upstash in US East with backups off; no analytics or third-party scripts; the footer and terms credit exactly the sources production uses; the iPhone storage sentence checked on a real iPhone, else "may"; "Last updated" set to launch day.

**After approval** (Parker, 2026-10-07: "Checkpoint 7b's build is approved. … This is not the go for production.")
- Tagged `checkpoint-7b`, so `npm run stable` serves it. The planner's answers to Checkpoint 7b's questions 3–7 are pending; production waits for Parker's go on launch day.
- Launch day: Tuesday, October 13, 2026, also the privacy and terms pages' "Last updated" (Section 14).
- At launch, in the same step as the `/api/*` rate-limit rule, a WAF rule that denies `/_next/image` and `/_vercel/image` (Section 19).
- The launch-day order (Section 19): production's secrets and both WAF rules before the go, the deploy after it. How to deploy production is still open (a question for Parker).
- The scripts that read the shared store use a read-only token under names the app never reads (Sections 0.5, 3 and 16), and the app's `OFFERSHEET_REDIS` opt-in is gone. Parker sets the two variables up after launch.

### Phase 5 — More platforms

**Build**
- Fleaflicker
- MFL
- Fantrax, public leagues only
- manual import
- the Yahoo adapter behind `FEATURE_YAHOO`, switched on when approval lands
- session-only credentials for MFL logins and Yahoo tokens, with the same rules as ESPN in Phase 1
- the exotic Fleaflicker keeper league's scoring, which stays a regression pin at 86% until then
- draft picks in trades (deferred from Phase 4; Checkpoint 4 answer 6): FantasyCalc's pick values in the model inputs, the platforms' traded picks (Sleeper `traded_picks`, MFL `futureDraftPicks`), picks in the search pools and packages

**Checkpoint 5 includes**
- the data-checklist matrix for each new platform
- oracle results

### Phase 6 — Calibration and polish

**Build**
- a projection backtest on 2025, comparing Sleeper's 2025 weekly projections (same endpoint, season 2025) with nflverse weekly actuals, to tune α and σ. If the 2025 projections aren't available, tune σ from actuals only and report that α couldn't be tuned.
- estimates of the injury model's `M_pos` and d from nflverse weekly data (2018–2025) for fantasy-relevant players, replacing the defaults (Section 6)
- a negative binomial for rush attempts, completions and receptions, with the measured dispersion (TDs stay Poisson), and the stat SDs refit on the archived pre-game projection snapshots (Sections 2.3 and 5)
- live game-day scores, so the odds count points already scored in the week in progress (Checkpoint 3 answer 6)
- ESPN's documented seed-by-seed procedure for ties among 3+ teams (Checkpoint 3 answer 7, low priority)
- the acceptance sanity check against real Sleeper trades
- the platforms' trade review periods (Checkpoint 4: a trade made before kickoff counts the current week in full today)
- which version was sent (offer first, full trade, Plan B): analyze the feedback records (Checkpoint 4 answer 8)
- a backtest of `marketBlend` on the archived FantasyCalc lists (Section 2.9) and the pre-game projection snapshots (Section 2.3)
- base-rate stability (Checkpoint 4b): one projection refresh moved Parker's playoff odds by 10 points. Measure day-to-day odds swings that injuries and results don't explain, and smooth the base rate if they're large (for example, average the last 2–3 pre-game projections)
- OUT players into open IR slots (Checkpoint 4b answer 8)
- a second dynasty value source: DynastyProcess for dynasty leagues (a median after normalizing), only after a license review (it is GPL-3.0)
- outcome feedback and the refit script
- error and loading states
- accessibility
- performance work

**Then:** Checkpoint 6.

### Phase 7 — Public launch, only when Parker asks

(Pulled ahead as Phases 7a and 7b above, planner reply to Checkpoint 4c; this list stays the reference for what launch needs.)

**Hosting**
- Use Vercel's free Hobby plan. It only allows non-commercial use: ads or payments would break its terms, but asking for donations doesn't.
- A placeholder landing page is already live on Parker's Vercel project, `offersheet`. Deploy the app to **that same project** so the web address doesn't change, and move the landing page's copy into the app's home page.
- A custom domain is optional. offersheet.app was unregistered on 2026-09-29.

**Add before going public**
- a privacy policy at `/privacy` and terms of use at `/terms`
- environment variables and the session secret in Vercel
- a shared cache store and per-IP rate limits on server routes
- error logging that never records credentials or league data
- installable PWA support: a manifest and icons
- a feedback link
- the server-side feedback store: anonymized, rate-limited, with an opt-out (Section 11)
- the Offer Sheet Chrome extension for ESPN cookies (Section 14)
- an email to FantasyCalc before launch (Section 2.9), which also asks them to confirm the te+/te++ meaning (done: they answered on 2026-10-05, confirming the mapping, with conditions for free use)
- basic SEO: title, description and an Open Graph image
- an attribution check: FantasyCalc everywhere values show (since their conditions, a link in the server HTML of every page), and Yahoo everywhere Yahoo data shows
- the DynastyProcess ID map is GPL-3.0: keep it server-side, credit DynastyProcess, and review the license before any downloadable or app-store version (Checkpoint 4b, change 12)

**Load test**
- 50 league imports at the same time, without hitting any platform's rate limits.

**Don't deploy before Parker asks.**

---

## 18. Checkpoint report format

```
# Checkpoint N — <phase name>
Status: ✅ Done | ⚠️ Done with issues | ❌ Blocked

## What works
- plain-English bullets

## What doesn't / open issues
- issue — evidence (URL without secrets, HTTP status, JSON path) — options

## Decisions I made
- decision — why

## Numbers
- tests passing; checklist ✅/⚠️/❌ counts; runtimes; match rates

## Questions (numbered, each answerable in one line)
1. …

## How Parker can try it
- exact commands / URL
```

- Keep it under about 150 lines.
- No secrets.
- No real names of leaguemates. Use placeholders such as "Team 3".

---

## 19. Terms, attribution and privacy

- **The plan is a free public app, and it must stay non-commercial.** Ads, payments or paywalls would break:
  - Vercel Hobby's terms (non-commercial only)
  - Sleeper's API terms (non-commercial only)
  - FantasyCalc's terms (non-commercial only)

  They'd also make ESPN's unofficial API a bigger risk. Don't add any of them unless Parker and the planner decide to, and get the licenses first.
- **ESPN:** the API is unofficial and can change or break at any time. Keep it isolated behind its adapter, and fail loudly with a clear message.
- **Yahoo:** follow the API Access and Use Agreement and the attribution rules. Read-only.
- **FantasyCalc** (its conditions for free use, 2026-10-05: `reports/fantasycalc-permission.md`, Section 2.9; until then: a link on every page that shows values, and at most one fetch a day per format): non-commercial, and free while under about 10,000 sessions a month (`npm run usage:report -- --live` warns from 8,000, so Parker can write to them first); call only `/values/current`, each format at most once every 3 hours and only when someone needs it; a link back to fantasycalc.com on every page that shows anything derived from their values, at least one in plain server-rendered HTML (the footer), with `rel="noopener"` and `referrerpolicy="origin"`; and never display their values: no value numbers and no value comparisons anywhere in the UI.
- **DynastyProcess:** the player ID map (Section 2.9) is GPL-3.0. It stays on the server, the app credits DynastyProcess, and its license is reviewed before any downloadable or app-store version (Phase 7).
- **Saved leagues** (Phase 4c): imports, picks, settings, model inputs and feedback stay in the user's own browser (IndexedDB) until removed; the privacy page says so. Credentials are never stored.
- **Credentials:** ESPN cookies and Yahoo tokens only ever go to their own platform. Never log them, and never store them on the server. Never ask for ESPN passwords.
- **Feedback data (Phase 7):** store only the anonymized fields in Section 11. Say so in the UI and the privacy policy, and offer an opt-out. (Built at Checkpoint 7a: Section 11.)
- **The beta's providers** (Checkpoint 7a): Vercel hosts the app (Hobby: non-commercial; request logs kept 1 hour); Upstash (through Vercel's Marketplace, US East; the privacy page also says backups are off, ⚠️ checked by Parker in Upstash's console) holds the server cache (encrypted), the rate-limit counts, the request budgets, the error log and the anonymous feedback, and since Phase 7b the public-data archive (Sleeper's pre-game projections and FantasyCalc's daily lists, up to 2 seasons, about no league or person beyond which formats were in use each day) and the usage counters (daily totals with no identifiers, about 13 months). The privacy page names both and says what each holds and for how long; it also names Google, which keeps the emails people send to Offer Sheet's Gmail inbox. A visitor's browser reads public ESPN and Sleeper leagues itself (those platforms see the visitor's IP address and which league), without cookies.
- **Deploying:** protected previews only (`npm run preview:deploy -- --live`, Section 16) until Parker's "go" at Checkpoint 7b. Never `vercel --prod`, `--public` or `promote`, never `vercel link` or `vercel env pull` in this folder (both write into .env.local); `.vercelignore` must stay the allowlist.
  - Production, only on Parker's "go" (Phase 7b; launch day, Tuesday, October 13, 2026). On launch day, before the go: its own `SESSION_SECRET` (`npm run vercel:secret -- --live --env production`) and `CRON_SECRET` (`npm run vercel:secret -- --live --name CRON_SECRET`: production is its default, since Vercel runs crons on production deployments only; without it the cron route answers 401 and saves nothing) and the two WAF rules below; after the go, the production deploy, of the newest approved commit (the `checkpoint-7b` tag's policy pages still say October 5). `vercel.json` already schedules the cron. ⚠️ How to deploy production is still open (a question for Parker): `preview:deploy` refuses production, and this section rules out `vercel --prod`.
  - One Vercel WAF rate-limit rule on `/api/*`, set at launch: by IP, about 60–80 requests per 10 minutes (Checkpoint 7a's figure, `reports/beta-infrastructure.md`), over the limit Too Many Requests (429) only: never Deny (a 403, which the app shows as "Something went wrong on our side", and a browser read whose upload gets it tries again through the server; review of the follow-ups, DOC-1) and never a challenge: a challenge sets Vercel's own cookie (`_vcrcs`), against the privacy page's "Offer Sheet sets no cookies, except one encrypted cookie if you connect a private ESPN league." ⚠️ Per Vercel's docs Hobby offers one such rule (a fixed window of 10 s to 10 minutes, keyed by IP or JA4); were it missing, the app's own limits stand alone (Section 3). (Protected previews also set Vercel's own `_vercel_jwt`: `reports/privacy-terms-draft.md`.)
  - In the same step (Parker, 2026-10-07), a WAF custom rule that denies Vercel's image optimizer: request path starts with `/_next/image` OR starts with `/_vercel/image`, action Deny (403, never a challenge). The app doesn't use it, and Vercel still answers both paths despite `images.unoptimized` (the 7b preview, 2026-10-07: `?url=/apple-icon.png&w=32` gave the same 348-byte PNG on both paths and `w=64` a 605-byte one on `/_vercel/image`; `w=33` on `/_next/image` and `icon.svg` on `/_vercel/image` got 400; on 2026-10-06 other sites' images got 400 on `/_next/image`). Hobby allows 3 custom rules; these two are 2 of them. Launch-day steps: `reports/beta-infrastructure.md`, "Launch-day steps".

---

## 20. Out of scope for the MVP

- sending trade offers, or making roster moves on any platform
- accounts and payments
- other sports
- AI-generated text (templates only for now)
- keeper-cost modeling (the UI says it isn't modeled)