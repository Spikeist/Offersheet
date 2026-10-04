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
   - commit
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

10. **Engine rules:**
    - All the math lives in pure, deterministic, unit-tested functions under `src/engine/`: no I/O, and no `Date.now()` (pass the time in instead).
    - Every tunable number comes from `src/engine/config.ts` (Section 15).
    - All randomness uses a seeded PRNG.

11. **Dependencies:** pick boring, maintained libraries. No paid services, no AI API calls, and no payments, ads or accounts.

12. **Keep the Phase 0 quality gates:**
    - the pre-commit leak check (`npm run check:leaks`)
    - the ✅/⚠️ rules: ✅ only when data verifies a claim; inferred, derived or small-sample results are ⚠️; a gap with a working workaround is ⚠️, not ❌
    - an adversarial review pass before every checkpoint

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
- **Lineup and roster:** `settings.rosterSettings.lineupSlotCounts` (slotId → count) and `settings.rosterSettings.positionLimits`.
- **Schedule settings:** `settings.scheduleSettings`, which includes `matchupPeriodCount`, `playoffTeamCount`, the `matchupPeriods` mapping from matchup period to scoring periods, and playoff round length.
- **Seeding tiebreaker** (Phase 3): `settings.scheduleSettings.playoffSeedingRule`, one of `settings.typeNames.recordSeedingRuleTypes` in `GET /seasons/{season}?view=proTeamSchedules_wl` (UNKNOWN, H2H_RECORD, TOTAL_POINTS_SCORED, INTRA_DIVISION_RECORD, TOTAL_POINTS_AGAINST, RAW_STAT).
  - TOTAL_POINTS_SCORED → points for (✅ both test leagues; ESPN's own `teams[].playoffSeed` order in Parker's league is win % then points for).
  - H2H_RECORD → head-to-head record and INTRA_DIVISION_RECORD → division record (⚠️ read from espn-api's standings code at commit 663d726; not seen live).
  - UNKNOWN (ESPN's placeholder: no rule reported), a missing value, TOTAL_POINTS_AGAINST and RAW_STAT → unknown: points for is assumed, with a warning.
  - Division winners are seeded first (✅ ESPN's help center, "H2H Points League Playoff Seeding: How Tiebreakers Work", support.espn.com/hc/en-us/articles/360058038711, updated 2026-08-11: "Division winners always occupy the top seeds.").
  - ⚠️ The same article describes ties of 3+ teams seed by seed: "determine the top seed among the tied group, remove that team, then repeat for the next seed", and "After each seed is assigned, the tiebreaker process resets from Step 1 (H2H Record)". The simulator follows espn-api's grouped order instead (Section 8); following ESPN's documented procedure is Phase 6 work (Checkpoint 3 answer 7, low priority: Parker's league uses points for). The two differ only in multi-way ties that head-to-head doesn't settle; with points for (Parker's rule) a tie on win % is settled by points for at once.
- **Trades:** `settings.tradeSettings`, which includes `deadlineDate` (epoch ms) and the veto and review settings.
- **FAAB:** `settings.acquisitionSettings`.
- **Waiver order and FAAB left** (Phase 4b, for the free-agent allocation in Section 7): `teams[].waiverRank` → `Team.waiverRank`, 1 = first claim (✅ at the weekly reset rank = number of teams + 1 − `playoffSeed` for 20 of 20 teams in both test leagues). ⚠️ Parker's league resets its order weekly and a team that claims a player moves to the back for the rest of the week, so mid-week the rank read is the live order, and the allocation depends on the day the league is imported (a planner question at Checkpoint 4b). FAAB left = `settings.acquisitionSettings.acquisitionBudget − teams[].transactionCounter.acquisitionBudgetSpent` (⚠️ 0–33 spent of 200 in the public test league; not cross-checked against winning bids). A rank that isn't a whole number ≥ 1, or a negative or unreadable budget, is left out.
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
  - **Trade review:** `veto_auto_poll = 1` → `league_vote`; anything else → `none`.
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
  - **Waiver order and FAAB left** (Phase 4b): `rosters[].settings.waiver_position` → `Team.waiverRank` (a 1..n permutation in all 18 surveyed 2026 leagues; position 1 is the first claim, ✅ in two reverse-standings leagues where it runs exactly opposite the standings, ⚠️ read the same way for rolling waivers). FAAB left (`waiver_type` 2) = `waiver_budget − waiver_budget_used`, which can exceed the budget after FAAB is traded (one league has 205 left of 100). The committed minimized fixtures from strangers' leagues keep no real waiver orders (a permutation could fingerprint a league); tests set made-up values inline.

**Undocumented endpoints (verified live 2026-09-29, may change)**
- **Weekly projections:** `GET https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular&position=RB` returns an array of `{player_id, week, stats: {pass_yd, rush_yd, rec, rec_yd, rec_td, …, pts_ppr, pts_half_ppr, pts_std}, last_modified}`.
  - Future weeks exist (week 15 verified).
  - Future weeks are refreshed in season (Phase 0: `last_modified` 2026-09-28 for weeks 5–18), and QB/RB/WR/TE values vary by opponent. Section 6 uses them for week shape.
  - **Pre-game snapshots** (Checkpoint 2 answer 4): Sleeper re-stamps past weeks' projections after the games, so the weekly projections a model build loads (the League page under `npm run dev`, and `npm run league:report`) are archived in git-ignored `data-local/` whenever they were fetched before that week's first kickoff: only the fields we use, compressed, and only the last pre-kickoff snapshot per week. `npm run snapshot:projections` does it by hand for the current week and the next one, all nine positions (for example on Wednesday nights). No scheduled task runs on Parker's computer. Phase 6 refits the stat SDs (Section 5) on these true pre-game numbers.
    - This is narrower than "the app or a script": a Sleeper import's own projection weeks (this week and the next 2, which rank free agents) aren't archived when fetched, but they share the model build's cache entries, so the League page archives them when it reads them; the probes and `npm run import:report` archive nothing.
    - Phase 3 details: files are `data-local/projection-snapshots/<season>/week-WW.json.gz`, one group per requested position, each with its fetch time and Sleeper's latest `last_modified`. Stats keep Sleeper's raw keys (so Phase 6 compares like with like against `/stats`) minus the fantasy-point totals (pts_ppr, pts_half_ppr, pts_std, pts_idp; a team defense's `pts_allow` is a stat and stays), ADP and ranks, at 3 decimals: about 37–39 KB per week for all 9 positions (about 1,250 players). "Before kickoff" uses the NFL schedule's first kickoff of the week; a week after the current one counts as before kickoff when its times are unknown. The archive is off in production and in tests.
- **Season projections:** `/projections/nfl/{season}?season_type=regular&position=QB`.
- **Multiple positions:** try `position[]=QB&position[]=RB`, and fall back to one call per position.
- **Actual stats:** `/stats/nfl/{season}/{week}?season_type=regular`. Verified in Phase 0: with it, the scoring oracle reproduces league points exactly. Rows carry `gp` 1 when the player played and no `gp` otherwise.
- **Stubs (Phase 2):** a projection row without scorable stats is a stub (a bye, an injured or teamless player, or a backup Sleeper doesn't project). Only rows with stats count as projections. Season projections carry `gp` 18 on every row and their span is unverified (⚠️), so the model uses them only as a last-resort base rate, divided by 17 games.
- **What the model fetches:** weekly projections from 3 weeks back (an injured player's most recent healthy projection) through the last fantasy week, and stats for every completed week, one request at a time. Each NFL week's projections are cached separately: served for 6 hours for past (lookback) weeks, the current week and the next 2, and for 24 hours for later weeks (Checkpoint 2); every week's copy is kept 24 hours, whichever request stored it, so the outage logic below always knows what the cache holds. Stats and season projections: 6 hours. Requests for the same cached data that overlap share one download (single-flight). If Sleeper stops answering (each request: 20 s timeout, 1 retry), the build stops asking for the rest (one warning) and remembers the outage in-process for 5, then 10, then at most 15 minutes, still reading copies the server cache holds, so a Sleeper outage can't stall the League page. A league renewed for next season (January–February) loads trade values only until its season starts.

**My team**
- The roster whose `owner_id` or `co_owners` matches the user_id.

**Browser fetching (check in Phase 1)**
- Find out whether `api.sleeper.app` sends CORS headers. Verified in Phase 1 (`npm run check:sleeper-cors`, `reports/probe-output/sleeper-cors.md`): `/v1/state/nfl`, `/projections`, `/v1/league/{id}` and `/v1/league/{id}/rosters` all answer a cross-origin GET with `Access-Control-Allow-Origin: *`; the other league endpoints are inferred to match. Browser fetching itself is deferred to Phase 7.
- If it does, fetch Sleeper data from the user's browser in production. Each user's requests then count against their own IP, not against our server's shared limit.
- Keep the normalizer code shared between browser and server.

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
- The redirect URI must be HTTPS. Locally, run `next dev --experimental-https` and register `https://localhost:3000/api/auth/yahoo/callback`.

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
- **Which number (Phase 2):** a league's values are `value` from a request in the league's own format. `redraftValue` is FantasyCalc's baseline (12 teams, PPR, no TE premium) and is never used. Keeper leagues request both formats: dynasty values for the long term, redraft values for perception (Section 9). Phase 4b: dynasty leagues also request the redraft list in their own format, read only by the market blend (Section 6 step 8; `MarketInputs.seasonValues`). It is asked only after the league's own list loaded and only while weeks are left to project, once a day like any format; when the league's own list failed or came from a saved copy, the later lists (this one, and a keeper league's redraft list) are asked once without a retry.
- **Our mapping** (approved at Checkpoint 2; ⚠️ until FantasyCalc confirms it, which the Phase 7 email asks): a TE premium (a TE's minus a WR's points per catch) below 0.75 asks for `te+`, 0.75 or more for `te++`. Ties in `numTeams` and `ppr` go to the larger option. Every substitution is noted in the Import Report.
- Terms:
  - non-commercial use only
  - fetch at most **once per day per format**
  - show a **visible link to FantasyCalc.com** wherever values appear. Their terms want it next to the values, so trade cards and the League table get a small "Values: FantasyCalc" link as well as the footer.
  - use only the documented endpoints (`/values/current` and `/players`)
  - never call the per-player history endpoints
  - email FantasyCalc before a public launch (Phase 7), and ask them to confirm what `te+` and `te++` mean
- **Local archive** (Phase 4b; planner reply to Checkpoint 4, item 7; `src/server/fantasyCalcArchive.ts`): every FantasyCalc list a model build loads is also written to git-ignored `data-local/fantasycalc-snapshots/<season>/<UTC day>/<format>.json.gz`, the first copy of each day kept, with only what a Phase 6 backtest of the market blend needs (FantasyCalc id, Sleeper and ESPN ids, position, value, redraftValue, overall and position rank). It adds no request and is never published, so it fits the terms as we read them (⚠️ they encourage caching on our own server and forbid reproducing their content on another website; they say nothing about archives). Like the projection archive (Section 2.3) it is off in production, on Vercel and in tests, never throws into a build, and logs only an error's name. `next.config.ts` keeps `data-local/`, `fixtures/`, `.cache/` and `reports/` out of the server bundles' file traces, so a deploy built on this computer can't upload them.

**DynastyProcess player ID crosswalk**
- `https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv` (verified 2026-09-29).
- Columns include mfl_id, sportradar_id, fantasypros_id, gsis_id, sleeper_id, espn_id, yahoo_id, fleaflicker_id, cbs_id, ktc_id, name, merge_name, position, team and birthdate.
- Refresh daily.

**Player ID crosswalk rules** (Checkpoint 1 answers)
- A player no ID source knows is matched on exact name + position + NFL team, but only when exactly one active player fits, and never when he has no NFL team. Flag each such match in the Import Report.
- A lower-priority ID source may override the top source, when the top source links an id that isn't an active fantasy player (a stale or wrong link), only when the two agree on name and position, plus either NFL team or GSIS id. "The two" are the top source's own row and the active Sleeper record the lower source links. Log every override in the Import Report notes, and keep a test for the players it fixes (Phase 2: 5 platform ids of 2 players, Sam Hartman and Chris Jones; both are wrong links in DynastyProcess, not stale duplicates).

**NFL schedule and bye weeks**
- ESPN `proTeamSchedules_wl` for bye weeks, and for kickoff times (`date`, epoch ms). Games marked `startTimeTBD` (weeks 16–18 until the NFL sets them) carry placeholder times and are treated as unknown. Byes and kickoffs are keyed by Sleeper team codes (WAS, LAR).
- nflverse `https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv`. Verified: it has all 272 regular-season games for 2026.
- Phase 4: each NFL team's weekly opponent and home/away, from the current week on (games without a set time included; WSH read as WAS), go into the model inputs for "Streaming picks this week" (about 15 KB at week 4).

### 2.10 Cache rules

| Data | Refresh at most every |
|---|---|
| Sleeper players DB | 24 h |
| FantasyCalc values (per format) | 24 h |
| DynastyProcess ID map | 24 h |
| NFL schedule and byes | 7 days |
| Projections (Sleeper and ESPN): the current NFL week and the next 2 | 6 h |
| Projections for later NFL weeks | 24 h |
| Sleeper actual stats | 6 h |
| League data (settings, rosters, transactions) | 10 min, plus a manual "Refresh" button |

- Each NFL week's projections are a cache entry of their own. Requests for the same cached data that overlap share one fetch (single-flight), in production and in development.
- **Private-league data** (ESPN with cookies, MFL with a login, Yahoo) must be cached under a key that includes a hash of the user's credentials or session. Never key it by league ID alone, or anyone who enters that league ID would see the private data. Public data can be keyed by league ID.
- Cached entries are **deleted** when their retention ends: league data after 10 minutes (Refresh shortens how old a copy may be, not how long it's kept); public league-independent data (player lists, ID maps, the NFL schedule) after up to 7 days, so a saved copy can stand in while a source is down. ESPN member IDs (SWIDs) are replaced by one-way pseudonyms before anything is cached.

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

**Cache**
- Build a `Cache` interface.
- For development, implement it with files in `.cache/` (git-ignored).
- A KV-store version can be added when we deploy.

**Built for public use**
- The engine runs in the browser, so trade searches cost the server nothing.
- Server routes only fetch and normalize data. In production they need:
  - a shared cache store (for example Upstash Redis's free tier)
  - per-IP rate limits
  - friendly "this data source is down" messages
- ESPN, Yahoo and private MFL requests must stay on the server, because they carry cookies or secrets.

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
  draftPicks?: DraftPick[];          // where the platform supports traded picks
  warnings: ImportWarning[];         // anything we couldn't map, with platform field paths
}

interface LeagueSettings {
  numTeams: number;
  leagueType: 'redraft'|'keeper'|'dynasty';
  lineup: SlotDef[];                 // starting slots only
  benchSlots: number; irSlots: number; taxiSlots: number;
  irEligible?: PlayerInfo['injury'][]; // statuses an IR slot takes, when known (Phase 4b; absent = IR and PUP)
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
  faabBudget?: number;
  unknownSettings?: ('tradeDeadline'|'tradeReview'|'playoffs'|'playoffSeeding'|'seedingTiebreaker')[]; // not exposed or unreadable: the Import Report says "unknown"
}

interface SlotDef { slot: string; count: number; eligible: Pos[] } // e.g. { slot: 'FLEX', count: 1, eligible: ['RB','WR','TE'] }

interface Scoring {
  perStat: Record<string, number>;                              // per-unit: canonical (Sleeper) stat key → points per unit
  byPosition?: Partial<Record<Pos, Record<string, number>>>;    // per-position REPLACEMENT rate for a key (e.g. ESPN pointsOverrides: TE rec = 1.5)
  rules: ScoringRule[];                                         // everything that isn't a plain per-unit rate (Section 5)
  unmapped: { platformKey: string; label: string; points: number }[];               // shown in the Import Report
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
  waiverRank?: number;               // 1 = first claim, when the platform reports it (Phase 4b, Section 7)
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
interface ImportWarning { code: string; message: string; platformPath?: string }

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
- **Who:** QB, RB, WR and TE players (`config.marketBlend.positions`, by their own position) with a real FantasyCalc value (never an estimate) in this season's list: redraft leagues the league's list, keeper leagues the redraft list, dynasty leagues FantasyCalc's redraft list in the league's own format (the planner: "dynasty leagues use redraftValue here too, since B_win is about this season"; ⚠️ read as the redraft list's own `value` in the league's format, since FantasyCalc's `redraftValue` field is its 12-team PPR baseline, which Section 2.9 never uses). Everyone else keeps his projection. No list, no blend: when FantasyCalc loaded without this season's list (a dynasty or keeper league's redraft list missing) the League page says the blend is off; when FantasyCalc is down, its own warning says so.
- **The planner's formula:** ROS′ = (1 − w) × ROS + w × R_pos(v), w = `config.marketBlend.weight` = 0.5, R_pos a monotone increasing curve of our ROS on market value per position, and each weekly p scaled by ROS′ / ROS, so byes, availability and week shape stay intact; ROS 0 stays 0.
- **As built** (⚠️ reported at Checkpoint 4b, a planner question): the same formula **per game played**. b′ = (1 − w) × b + w × R_pos(v), where b is his base rate (step 1) and R_pos is the isotonic (pool adjacent violators) fit of the base rates of the position's healthy players (no injury tag, a game left, b > 0; rostered and modeled free agents alike) on value. His factor f = b′ / b scales b, every weekly p, each week's σ (recomputed, step 5) and his ROS, so ROS′ = (1 − w) × ROS + w × (his ROS at the market's rate). Why not totals: a total mixes in how many games he plays, which his value prices only roughly. On totals an OUT or IR player whose value holds up got the whole season's gap squeezed into the few games he plays (up to ×1.58 on Parker's data; a test IR receiver back in week 16 went from 16 to 37 points a game), injured players' small totals pulled the curve down for the healthy players valued like them, a player whose bye is done looked a game better than an equal one whose bye is ahead, and a build after the week's first kickoff blended differently from one before it. Per game, byes, availability and the week shape stay entirely ours, and the factors don't depend on the moment. ⚠️ The price: an injured player's full-strength b is compared with what healthy players valued like him score, while his value is also discounted for the games he misses, so part of that discount counts twice (A.J. Brown, on IR until week 8: f 0.930), erring the way the planner asked ("the market's injury discount is part of the projection").
- **The curve:** each curve point reads the curve fitted without him (leave-one-out). Fitted with him, every player in the same order as the trend sat on the curve himself and got f = 1 however far he was from it (Garrett Wilson 1.000), so the blend corrected only rank inversions. ⚠️ The two players at the ends of a position's value range read the curve with their own point in it (fitted without them, it would have to extrapolate: Josh Allen, valued 2.7 times the next healthy QB, came out at f 0.885); beyond the curve's ends it reads flat. Injured and tagged players are read off the curve but don't shape it. A position with fewer than `minPlayers` (10) curve points gets no blend.
- **Where it applies:** once per build, before the projection table, so everything reads blended points: ROS shown to users (step 7), free agents, needs, trade chips, V*, both lineups of every trade, the season simulation, the estimate curve for unvalued players and the waiver credit W. A rebuild before the week's first kickoff uses the same factors.
- **Shown** in the League page's player breakdown: "Our projection 210 · Trade market 170 · Used 190" (rest-of-season points; "Trade market" is his ROS at the market's points per game), with a short explanation under it.
- Parker's league (2026-10-04 data): 193 players blended; f from 0.84 to 1.60 (median 1.00); the largest are an IR player and backups the market values on upside (Jordyn Tyson, on IR, 1.60; Marvin Harrison Jr. 1.37), the smallest players we rate above the market (Emanuel Wilson 0.84, Zay Flowers 0.86); Garrett Wilson 1.02, so the market agrees with us on him (Checkpoint 4b).

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
- ω = 1 for regular-season weeks and `config.playoffWeight` (1.25) for playoff weeks.
- Also report **PPW**: the average LV over the remaining regular-season weeks.

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

**IR players** (Phase 4b; planner reply to Checkpoint 4, change 5 and answer 11; `src/engine/returners.ts`)
- **Returners:** each team's IR players with a model and an expected return week (Section 6 step 3) join its lineup pool. They ride with the team's lineup rows like streaming rows (`StreamSpec.returners`): no active roster spot while on IR, never dropped by V* or a free-agent move, never counted for the lineup-fill rule (they can't play now); their own availability keeps them out until they're back. This applies to every team, every lineup (V* included) and the season simulation.
- **The roster spot from the return week** (displacement): when the active roster plus the returners back by week R is over `maxRosterSize` (⚠️ a roster already over before is held to its own count, as legality does), or a returner's position would go over its `positionLimits`, from R on the lowest keep value player goes (§7 keep value: his removal cost over weeks ≥ R in the evaluation's lineup mode; ties by perception value, then id; dynasty and keeper leagues with long-term values: plus normalized market value), one per returner past the room, in R order; at the returner's position when its limit binds. ⚠️ When nobody can go (everyone without a model or needed), the roster runs over and nothing is dropped. ⚠️ Our readings (Phase 4b reviews): the returner himself can be the one released when he's the least useful (so a return never weakens a team); a position limit that binds drops at the returner's position; never a player the lineup or a position's minimum needs; never the last rostered player at a position the team streams (the streamed slot needs that roster spot); a player just received in a trade can be the one displaced. It is applied by a masked copy of his row.
- ⚠️ The displacement is applied to **final evaluations only**: the League model's teams as they stand (strength, needs, PPW, ROS, the weekly scores and the League page odds) and the trade context's baselines and both sides of every exact trade after V* (B, n, h, the simulation). The marginal machinery (V*'s move search, screening, lineup costs, MV_add, chips, partner fit) compares like with like without it: a constant per team.
- `TeamModel.players` holds returners too (lineup cost = his removal cost from V*(T)'s lineups; no active spot opens), so the give pool can rank them; trade chips and throw-ins stay active-roster only. `irReturners: false` (a report switch the app never sets) restores Checkpoint 4's rule.
- Parker's league (2026-10-03 data): 7 IR players on 7 teams, every one a returner (Caleb Williams on Team 1 back in week 5, A.J. Brown on Team 5 in week 8, Alec Pierce on Parker's Team 3 in week 7, …), and every team with one must drop someone at R (all rosters full). Team 1 gains 3.8 points a week as rosters stand (Williams outscores its QB most weeks and covers his week-8 bye); Parker's own returner adds 0.1.

**Marginal values**
- `MV_add(T, j) = ROS(T + j − autoDrop) − ROS(T)`
- `MV_lose(T, i) = ROS(T) − ROS(T − i + autoAdd)`
- Phase 2 decision: measure MV_lose from the team after its best single free-agent move, `V(T)` = the best of T itself, T plus the best free agent when an active-roster spot is open, and every `T − i + autoAdd_i`. So `MV_lose(T, i) = V(T) − ROS(T − i + autoAdd_i)`, which is never negative. The formula as first written went negative for every bench player whenever a free agent beat one of the team's starters: 107 of 157 players in Parker's league, because a free-agent kicker beat several teams' kickers. The difference is one constant per team, so rankings within a roster (the surplus score) don't change. The team's best move (add, drop or an open spot, and its ROS gain) is shown on the League page, chosen by scenario ROS when scenarios ran, else by EV ROS. (Phase 4 replaced V(T), its one move and the pinned move with the optimizer below; the League page's best move became "Free-agent pickups that would help".)
- **Free-agent-optimized baseline everywhere a trade is scored** (Checkpoint 2 answer 1; Checkpoint 3 answer 2 and model change 2): B, n, MV_add, MV_lose and trade chips compare rosters after each one's free-agent optimizer, V*(X), both before and after the trade. A trade must never get credit for a free-agent pickup the user could make anyway, and an open roster spot is worth only what the best free agent adds.
  - **The optimizer V*(X):** repeatedly apply the best add/drop while it improves ROS by at least `config.faMinGain` (default 3 points), at most `config.faMaxMoves` moves (default 5). Never drop a player the team needs to fill its starting lineup. Streamed positions (below) are excluded: their slots are valued by streaming. In dynasty and keeper leagues, never drop a player whose dynasty value exceeds the added player's by more than `config.faDynGuard`.
  - `MV_add(T, j) = ROS(V*(T + j − autoDrop)) − ROS(V*(T))` and `MV_lose(T, i) = ROS(V*(T)) − ROS(V*(T − i))`. The same optimizer runs for every team, before and after every trade.
  - **One free agent, one team** (Phase 4b; planner reply to Checkpoint 4, change 3; it replaces Checkpoint 4's known approximation that each team was optimized on its own, so two teams could count on the same free agent). The League model runs each team's V* in order, each against the pool minus the free agents earlier teams claimed. The order: FAAB leagues by budget left, most first, when every team reports one (ties: the better waiver rank, then snapshot order); else the platform's waiver order (`Team.waiverRank`) when every team has one; else each team's best available gain first (its first move against the full pool, in the optimizer's judging mode; ties: snapshot order). `LeagueModel.faAllocation` records the basis and the order, and the League page says it ("Free-agent pickups: each free agent goes to one team only, in your league's waiver order. Your team picks 10th of 10."). ⚠️ A team claims every free agent its run adds, even one a later move of the same run swaps away: then the allocation is exactly deterministic and no free agent is listed for two teams. Every later run of a team (lineup costs, MV_add for chips and the get pool, chips that stay chips) draws from the pool minus the other teams' claims, excl(T); partner fit runs no optimizer. Streaming is unchanged: the streamRank-th best already allows for competition.
  - **In trade evaluation** the two trading teams re-optimize in allocation order, legality's adds included, each from the pool minus every other team's claims (every other team keeps its baseline); the team that goes second also can't take what the first adds, nor the first team's baseline claims unless no team sits between them in the order. ⚠️ So a pickup a trading team gives up goes to nobody when a team sits between them (every team ahead had him in its pool and passed; the ones between would want him first). A trade that changes nothing reproduces the baseline exactly (⚠️ but for free agents whose gains tie within 1e-9, which never happened on Parker's data or in 60 random leagues). Screening's legality adds skip each side's baseline exclusion. `faAllocation: "independent"` (a report switch the app never sets) restores Checkpoint 4's rule.
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
  - A player is a trade chip if `gap_i ≥ config.chipMinGap` (default 10 ROS points). In plain words, he's worth at least 10 more points to some other team than to his own.
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
- **Common random numbers:** sim n draws z[n][week][team] from its own stream (seed, "season", n) by Box–Muller, so the first 1,000 sims of the 5,000-sim matrix are the 1,000-sim matrix. (Phase 4: the trade search draws one 6,000-season matrix in two blocks instead, the screening reading the first 1,000 and the final run the next 5,000; Section 12.) Identical inputs give identical odds bit for bit.
- **The week in progress:** live scores aren't read (reading them is Phase 6 work, Checkpoint 3 answer 6), so its games are simulated from projections as if none had started (the players rebuilt 1 ms before the week's first kickoff), and the page says so. ⚠️ They use today's rosters and injury news: a player hurt in a game he already played counts as missing it, and a player traded after his game moves that week's points to his new team (the app keeps no record of rosters or tags at kickoff).
- **Games:** a decided regular-season matchup is already in the records; with a readable score it also counts for head-to-head and division records. An undecided matchup in the current or a later week is simulated. A finished week whose matchups aren't decided yet (ESPN before it processes the week, Sleeper before `last_scored_leg` moves) is left out, with a warning, until they are: the records don't count it yet either. Records are cross-checked against the decided games. A head-to-head league whose remaining schedule didn't load (no undecided game with an opponent left while some remaining weeks have no matchups) gets no odds, with a warning naming the missing weeks, rather than today's standings printed as final.
- **Median games:** the top ⌊N/2⌋ scores of the week win (⚠️ with an odd N the middle team loses); a multi-week matchup gets one median game (⚠️ our reading).
- **Points-only leagues:** standings by points for; their playoffs are simulated head to head (⚠️ assumed).
- **Standings** follow espn-api's recursive order (a group still tied moves on to the next criterion, never back): points for = win %, points for, head-to-head, division record, more points against; head-to-head = win %, head-to-head, points for, division record, points against; division record = win %, division record, head-to-head, points for, points against (⚠️ our order: espn-api puts division record before win %). Then team index stands in for the coin flip. Head-to-head among 3+ tied teams counts only when every pair met equally often. Division record is each team's own record against its division (espn-api's code; its docstring says otherwise, ⚠️). Division winners are seeded first when the platform says so: ESPN documents it for every league with divisions (Section 2.2); Sleeper for some layouts (Section 2.3, inferred for the rest, with a note). A fixed bracket is assumed, with a note, when the platform doesn't report re-seeding.
- **Playoffs:** seeds 1..N, a bracket of the next power of two with byes for the top seeds; a fixed standard bracket (6 teams: 4 v 5 and 3 v 6, seed 1 meets the 4/5 winner, seed 2 the 3/6 winner, ESPN's bracket) or re-seeding after each round. A multi-week round sums its weeks; a tied playoff game goes to the better seed (Sleeper documents this). Finished playoff games are replayed from their results; a finished round without results makes bye and title odds unknown. Once the standings are final, the platform's scheduled winners'-bracket games are checked against our bracket: a game that gives one of our teams a different opponent, or puts one of our bye teams in round 1, makes bye and title odds unknown, with a warning. Sleeper's playoff matchups aren't imported yet, so once a Sleeper playoff round has been played its title odds show as unknown.
- **Outputs:** P(playoffs), P(bye), P(title), the expected final record, the final-seed distribution, today's rank by the same rules, and each remaining week's chance to win (and to beat the median). A team is shown as eliminated (§8's "Your season's over" message, redraft leagues; its partner cards are hidden too) only when it's certain, never from simulation counts. After the regular season: it lost a playoff game, or it trails at least as many teams as there are playoff spots on numbers the platform reports (win %, then points for when that's the league's own tiebreaker). Before that: at least as many teams as there are spots have a worst-case win % above its best case, counting every result still to come (remaining games, median games, finished games not scored yet), and, with 2+ divisions, a division rival is one of them.
- **Exact title odds** (Phase 4, track S; a variance cut, not a model change): given a simulated season's seeding, each team's title chance is computed exactly instead of drawing its playoff games. A game between A and B over a round's weeks W is won by A with probability Φ((Σ_W μ_A − Σ_W μ_B) / sqrt(Σ_W σ_A² + Σ_W σ_B²)) (independent normal weekly scores; a tie has probability 0), a fixed bracket by dynamic programming over its slots, a re-seeding bracket by listing outcomes from the round with at most `config.simulation.exactReseedTeams` (8) teams left (earlier rounds drawn). Played rounds use their results; the unknown-odds rules are unchanged. P(title) is the average over seasons, the same expectation as before; P(playoffs), P(bye), seeds, records and weekly odds are bit-identical. On Parker's league the seed-to-seed SD of a +3 pts/wk ΔCH fell from 0.52 to 0.11 percentage points and B's from 0.39 to 0.21, at about the same speed (5,000 seasons 11.8 ms). `SimOptions.titleMode: "sampled"` keeps the old draw for tests.
- **Runtime** (Parker's league, Node, Checkpoint 3): 1,000 seasons in 5.8 ms and 5,000 in 30 ms (16 ms of it drawing the matrix); the whole League model with 32 scenarios takes 125 ms without the simulation and 155 ms with it.

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
- Phase 4b (IR players tradable): the credit counts **active** roster spots after legality's IR moves (Section 7 rule 5). An IR player leaving an IR slot opens no active spot, and one received into an open IR slot uses none, so each side's spots come from its own moves (`market.ActiveSpots`) and the two packages no longer mirror each other exactly when IR players move. Every player still counts at max(v, W).

**Formula.** For side X, which receives the set R and gives the set G:

```
PV_recv = Σ_R v + max(0, |G| − |R|) × W
PV_give = Σ_G v + max(0, |R| − |G|) × W
g_mkt(X) = (PV_recv − PV_give) / PV_give
```

Since Phase 4b (below): each v counts at max(v, W), and the credit counts the active roster spots X's trade opens, s_X = (its active players given) − (players received onto its active roster), so PV_recv adds max(0, s_X) × W and PV_give max(0, −s_X) × W. With no IR player moving, s_X = |G| − |R| as above.

Examples with W = 400:

| Partner receives | Partner gives | g_mkt |
|---|---|---|
| a 10,000 player | 5,000 + 5,000 | +4.0% |
| 5,000 + 5,000 | a 10,000 player | −3.8% |

**The value floor** (Phase 4b; planner reply to Checkpoint 4, change 4; replaces Phase 4's lead decision N10)
- In every package sum each player counts at max(v, W), before the stud exponent (`market.packageValues`, the one place every sum goes through). That covers my g_mkt and B's market term, ΔDyn (long-term values and the long-term W), the partner's g and its perceived g (max(v, W) × (1 + e), Section 11), hist, the card's values, the Market check, the hide threshold, the veto rule and the screening window. MyDynTotal (Section 10) and picks stay unfloored.
- Why: a player worth less than the best free agent is replaceable, and every team's free-agent-optimized roster (Section 7) already counts that replacement.
- Results: an even swap of two such players gives g = 0 on both sides; dumping one for nothing gives g = 0; one thrown in adds no value difference, and the complexity term still counts him. ⚠️ Both sums still grow by W, so each side's g moves toward 0: a cheap throw-in can lift a trade past the veto, the Market check or the hide threshold (small on Parker's league: none of the shown trades flips).

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
B_win = 100 × (0.35 × ΔPO + 0.65 × ΔCH)             // in percentage points
B     = B_win + κ × clamp(g_mkt(me), −0.5, 0.5)      // the market term; κ from "Protect my trade value"
```

**Bench value** (planner addendum to Checkpoint 3, §3; `reports/planner-reply-3b.md`). My own players have two kinds of value beyond the starting lineup:
- **Depth for injuries and byes:** already in B_win, through the scenario lineups (Section 7). It stays there.
- **Trade value for later deals before my deadline:** the market term's weight is a user setting, **"Protect my trade value"**: Low κ = 2, Medium κ = 4 (the default), High κ = 8 (it was a fixed 1.0 before the addendum). At Medium, giving 25% more value than you get (g_mkt(me) = −0.20) costs 0.8 B, about 0.4 points a week in Parker's league.
- The Market check warning (−15%) and the hide threshold (−35%) are unchanged. Dynasty and keeper leagues have no market term (B_future carries the value change), so the setting is offered in redraft leagues only.
- Phase 4b (planner reply to Checkpoint 4, change 4): every package floors each player at W on both sides (Section 9), so the market term reads the same g_mkt(me) as the card, and ΔDyn is floored the same way on long-term values. It replaces Phase 4's lead decision N10, which floored only the players I give, in the market term and ΔDyn (an even swap of two players worth less than W then read as giving W for v).

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
- Phase 4 details (`src/engine/benefit.ts`): when title odds are unknown but playoff odds aren't (a played playoff round without a result we can match, or a league that lists fewer playoff rounds than its bracket needs), B_win = 100 × (0.35 + 0.65) × ΔPO, so B stays on the Trade Score's scale, and the search says so once (approved by the lead, ⚠️). An unknown P(playoffs) gives λ 0.5. Dynasty and keeper B has no market term: B_future carries the value change. Picks take no roster spot, so they earn no waiver credit. B ≤ 0, or a B not known yet, gives no Trade Score or Overall.

**Trade Score (shown as "Helps you")**
- `Trade Score = round(100 × (1 − e^(−B / B_ref)))` when B > 0, with B_ref = 6 (Checkpoint 3 answer 1; it was 5).
- Trades with B ≤ 0 are hidden by default.
- Sample values:

| B | 1 | 2 | 3 | 5 | 8 | 10 |
|---|---|---|---|---|---|---|
| Trade Score | 15 | 28 | 39 | 57 | 74 | 81 |

- **Planner's check:** in a 12-team toy simulation with 10 weeks left, +1 point per week of lineup gain gave B ≈ 1.7, +3 gave B ≈ 5, and +6 gave B ≈ 10. In Parker's league (Checkpoint 3, 11 regular-season weeks left) they gave B ≈ 2.05, 6.3 and 12.4, so B_ref became 6: those score 29, 65 and 87.

**Three numbers on every trade**

| Number | What it is | Formula |
|---|---|---|
| **Helps you** | How much the trade improves your team, 0–100 | The Trade Score above: round(100 × (1 − e^(−B/6))) |
| **Chance they accept** | Estimated %, labeled "Est." | P_complete (Section 11) |
| **Overall** | The expected gain, 0–100 | round(100 × (1 − e^(−(B × P_complete)/6))) |

- Overall is how much a trade helps, discounted by the chance it actually happens. It's always at or below Helps you.
- Phase 4 reading (⚠️, §11's "show both numbers when they differ"): the card prints P_accept with its label as "Chance they accept", and when the veto rule cuts it, P_complete next to it ("about 25% it goes through"). Overall, the ranking, the sorts and the offer-first steps' thresholds use P_complete.
- Sample values:

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
- ΔDyn, in dynasty leagues
- value given and value received

---

## 11. Acceptance probability

This estimates P(the partner accepts). It's a model, not a promise, so the UI labels it "Est." and rounds it to the nearest 5%.

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
  - ⚠️ Everything except the acceptance g stays without the premium (floored at W like every package since Phase 4b): TradeEvaluation.gPartner (the card and the report), hist (past trades), the §12 screening window, and the veto rule (league members judge a trade by the market, not by the owner's attachment).
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
- **Display:** never shown as 0% (the clamp's 2% shows as 5%), and the label is judged on the shown value (14.9% shows "15%" and reads "Possible").

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
- **Phase 4b** (Checkpoint 4 answer 8): the record also keeps which version was sent: "Offer first", "Full trade" or "Plan B". A card that shows two versions asks which one on the first outcome pressed, worded for that outcome ("Which version did you send?", "… did they accept?", "… did they turn down?", "… did they counter?"); a plain card records the full trade; clearing the outcome clears the version, and the card's "Version:" line says "an earlier one (…)" when the version recorded is no longer one the card shows. The record keeps the sent version's trade key and estimate (⚠️ not its model inputs: Phase 6 re-evaluates them), the export carries it, `npm run feedback:summary` counts outcomes by version, and older records read as unknown. Phase 6 analyzes it.
- **Phase 7 (public launch):**
  - Send reports and outcomes to a small server-side store on a free tier.
  - Store only anonymized data: player IDs and positions, league format settings, model inputs and scores, and the reason and the outcome.
  - Never store league IDs, team names, owner names, usernames, SWIDs or cookies.
  - Say so plainly in the UI and in the privacy policy, give users an opt-out toggle, and rate-limit submissions.
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
- "Protect my trade value": Low / Medium (default) / High, redraft leagues (Section 10)
- untouchables
- must-include players
- positions to target or avoid
- include P, K, DEF and IDP (excluded by default, Section 9)
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
   - If the max per side is 3, extend the best 40 of those once more, the same way.
   - Drop any trade whose g_mkt(P) falls outside [−0.35, 0.6].
   - Keep this partner's top 30 by the screening objective.

3. **Exact evaluation.** Take at most 200 trades across all partners, the best by screening objective. For each: check legality, work out drops and adds, solve exact lineups for both teams over the availability scenarios (Section 7), then compute n, h and P_accept.

4. **Screening simulation.** Run 1,000 simulations with common random numbers on every exactly-evaluated trade to get a first B.

5. **Final simulation.** Take the top 40 by B × P_complete and rerun them with 5,000 simulations. This gives the final B, Trade Score and P_complete.

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
- **Dominance pruning** (⚠️ lead decision N11, reported at Checkpoint 4; in the spirit of §13's filler rule): after the beams and the g window, a screened trade that gives one of my players worth less than the waiver credit W is dropped when the same trade without him (my side keeping a player) is inside the value window too and screened at least as well. Under §9's waiver credit (and since Phase 4b the value floor, which counts him at W) such a player pulls the partner's g toward 0 and adds a player to the trade, so these variants were dominated, yet they took 85 of the 200 exact-evaluation slots on Parker's league (the 2026-10-01 data; 77 on the live data of 2026-10-03, 9 with the pruning).
- **Finalists:** the 40 picked with §13's per-core, per-partner and (Phase 4b) per-given-player caps one looser, their window covering all 40 finalists (Phase 4b final review: a top-20 window let finalists 21–40 be mostly players already at a cap, and the list showed 16 cards), then filled by EG; the strict §13 rules apply in the final ranking (21 of the 25 a full 5,000-season ranking of all 200 would show make it). Then the ranking (rank.ts), then the offer-first steps for the shown trades (§13) and their words (explain.ts, after the steps, so the pitch names the offer-first version).
- **Determinism and progress:** the same inputs give the same result; the generator yields every 100 screens, every 5 screening simulations and after each exact evaluation or final simulation (typically under 40 ms of work between yields on Parker's league in Node; a garbage-collection pause or a cold start can exceed it, and the report measures the longest), so the worker can slice and stop it. Parker's league (final numbers, the 2026-10-01 data, Node, median of 3): context 0.26 s, screening 2.0 s, exact 1.8 s, screening simulation 0.5 s, final simulation 0.5 s, steps and words 0.1 s, about 5 s in all; in the production browser worker (live league, 375 px) a first Trade Finder visit took 5.1–6.8 s and a warm search 2.8 s. Phase 4b (the 2026-10-04 data, Node, warm median of 3): context 0.25 s, screening 1.7 s, exact 1.25 s, screening simulation 0.5 s, final simulation 0.47 s, steps, Plan B and words 0.19 s, about 4.1 s; the same search again on its context 2.9 s; in the production browser worker 4.3 s (`npm run check:browser`).
- **Consistency (Checkpoint 4):** before and after both use V* judged in the lineups B is measured in, so no trade gets credit for a pickup I could make anyway: a test reproduces a sub-threshold depth pickup with a trade and gets ΔPO = ΔCH = ΔEW = 0 exactly, in EV and in scenario lineups.
- ⚠️ Known approximations: screening isn't re-optimized; a free agent a trading team gives up goes to nobody when a team sits between the two in the allocation order (Section 7); IR players: a player received from an active roster never uses an open IR slot, teams never move their own active OUT players into one, and the displacement is applied to final evaluations only (Section 7); the review period isn't modeled (Phase 6); picks are deferred (Phase 5).

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
- At most 3 trades in the top 20 that give the same player of mine (Phase 4b; Checkpoint 4 answer 7; `perGivenPlayerInTop20`).

**Each trade card shows**
- You give / You get
- the three numbers: Helps you, Chance they accept (with its label) and Overall
- risk flags, separately: "depends on an injured player", "Market check" (Section 10)
- key numbers: ΔPPW, ΔPO, ΔCH, value given and value received, with a small "Values: FantasyCalc" link
- ROS points given and received (Section 6), for example "You get 142 ROS pts, give 118"
- any required drops and adds (Phase 4b: and IR moves: a received IR player who goes into an open IR slot, "Jordan Mason goes to your IR slot (no roster spot until he's back).", and a drop from a returner's week, "From week 7, when Alec Pierce comes back from IR, you'd drop Marvin Harrison Jr."; only drops the trade causes, not the ones the team faces anyway)
- "Harder to get" next to tagged players I'd get (Section 11)
- "How to offer it": the offer-first steps, when they qualify (below)
- injury tags in words under every player in the trade who isn't healthy, on either side, and "If they say no, try:" (Plan B) on a card without steps (Phase 4b, below)
- the outcome and Report buttons (Section 11)
- **plain-English reasons**, built from the features, such as:
  - "Your RB2 spot goes from 9.1 to 14.3 projected points per week"
  - "They're 11th of 12 at TE, and this gives them a starter"
  - "They give up 8% more trade value than they get, so expect pushback"
  - "Active trader: 3 trades this season"
- a **copy-ready pitch message** that leads with what the partner gains. Use templates, not AI calls.

**Phase 4 details: ranking** (`src/engine/rank.ts`)
- Sorts: Overall = EG = B × P_complete; Helps you = B; Chance they accept = P_complete among trades with B > 0, the rest after. Unknown numbers sort last; ties: EG, then the trade's key, then the furthest-evaluated copy (final > exact > screened, more seasons, then B). The output never depends on input order.
- Hidden by default and counted: B ≤ 0 or unknown first, else g_mkt(me) < −0.35.
- ⚠️ A search limited to one partner (the partner filter, or must-include players of theirs) drops the per-partner cap (it would cap the list at 3); the core, filler and given-player rules still apply. The all-teams list is unchanged (final review of Phase 4).
- Diversity, greedily in Overall order, each trade against those already kept, in this order: (1) filler: a kept trade with the same partner whose assets are a proper subset of this one's and |B − B_kept| < 0.2 × B_kept (only the bigger variant ranked below is dropped: a variant that ranks above its smaller trade isn't filler); (2) core: 2 kept trades already share its core, the highest-value asset on each side (ties: the smaller id); (3) the partner already has 3 of the first `partnerCapTop` (20) kept; (4) (Phase 4b) 3 of the first 20 kept already give one of its players of mine. A trade several rules drop counts once, under the first. Stop at 25.

**Phase 4 details: reasons and pitch** (`src/engine/explain.ts`, templates only; thresholds in `config.explain`, display only)
- Reasons, most important first, in four groups (⚠️ our grouping): (1) why it helps me: my biggest slot gain ("Your RB2 spot goes from 9.1 to 14.3 projected points per week"), else my lineup's weekly gain, else my playoff-week gain; long-term value in dynasty and keeper leagues (first when λ ≥ 0.5); the odds change (one decimal, as the card prints it); risky weeks it covers ("Covers your risky week 13: +6.2 projected points that week"; the detail doesn't say whether byes or a tough matchup made it risky); "In the regular season …" when a playoffs line is shown; in redraft, "Mostly a trade-value win …" when the market term itself is positive and at least B_win (and g_mkt(me) ≥ 5%). (2) Their side, at most 3 lines, the ones that moved the acceptance estimate most (logit terms ≥ 0.1, the value line always a candidate): a hole filled ("They're 9th of 10 at TE, and this gives them a starter", the rank quoted only in the bottom half; otherwise "Their TE spot is weak over the next 3 weeks …"), their slot or lineup change, trade value from their side (exact readings of the package values: "they give up X% more than they get" is X = the partner's own PV_give ÷ PV_recv − 1 (= g_mkt(me) unless an IR player moves, Phase 4b), and "Even on trade value: each side gets about what it gives" only when both sides are even (else "About even on trade value from their side."); above 100% as a multiple, "about 9.3 times as much"), activity, history, context, hot players, the deadline. (3) Caveats: injured players I'd get, my biggest slot loss, risky weeks it weakens, lower odds, long-term value lost, veto risk. The market check is left to its card flag (one basis, g_mkt(me), not repeated in the reasons). (4) The long-term-values-missing sentence (Checkpoint 2).
- **The star premium's reason** (addendum §1, N7): whenever a player they give carries a premium, the reason names him and why ("Jaxon Smith-Njigba is their best player and a top-12 player by trade value, so expect them to want a little extra."). It always gets one of the partner places (it replaces the lowest-weight line other than the value line). ⚠️ When, counting the premium, they still come out ahead by at least 5%, it reads "…but even if they rate him a bit above his trade value, they'd still come out ahead" instead (a "little extra" next to a 40% value gain contradicted the card), and the value line drops "which makes a yes more likely" when the premium leaves them under 5% in their own eyes.
- The pitch greets without a team name, leads with what the partner gains (the hole it fills, naming the player only when exactly one player sent can play that slot; their slot or lineup gain; the trade value they gain only between 5% and 25%, since a bigger gain tells a sharp manager it's an overpay; since Phase 4b that figure is FantasyCalc's own (raw values, no floor or roster-spot credit: the number the partner can check), quoted only when every player in the version has a FantasyCalc value), names the trade from their side and closes. It never says what the user gains.

**Offer first / if they say no** (planner addendum to Checkpoint 3, §4)
- A **throw-in** is a player on my side whose loss costs me at most `throwInMaxCost` (5) ROS points against my free-agent-optimized roster, measured with scenario lineups (so a backup who covers injuries and byes isn't free); never an untouchable, a must-include player or an excluded position.
- Every shown trade gets two steps: (1) if the ranked trade includes a throw-in (and my side keeps a player without it): **offer first** the lean version without my lowest-value throw-in; **if they say no, add** that throw-in (the full ranked trade). (2) Otherwise: offer first the ranked trade; if they say no, add the single throw-in from my roster that raises acceptance the most while B stays at least 80% of the offer's B.
- Each step shows its estimated acceptance. A step shows only when it raises the chance they accept by at least 5 points and the offer-first version is at least 10% likely. Each variant is evaluated exactly with the 1,000-season screening simulation, legality re-checked. The pitch uses the offer-first version; the ranking stays on the ranked trade's numbers.
- Phase 4 readings (`src/engine/evaluate.ts`): the thresholds read P_complete (each step prints its P_accept, as the card's headline does, with P_complete when the veto cuts it); both versions' B come from the screening block (a fair comparison; the card keeps the ranked trade's final numbers); every version must help me (B > 0), so the 80% rule only compares positive B; case 2 stays within max players per side (the Analyzer's limit there); ⚠️ for speed, case 2 evaluates exactly only the 2 best candidates by the screening's quick acceptance (`steps.preScreen`; 0 misses on Parker's league, 1 of 82 in synthetic leagues); the Analyzer shows steps only for a trade the Finder could show (B > 0, not hidden).
- Steps rarely show on Parker's league: 0 of 25 shown trades on the 2026-10-01 data (the best was +4.5: Hall + Bo Nix → Swift, 20.0% → 24.5%), 2 of 22 on the live data of 2026-10-03. Under §9's waiver credit a throw-in raises the partner's g only when he's worth more than W × (1 + their g), so with partners already gaining 25–38% few throw-ins clear the bar, and each extra player costs −0.25 logit. A planner question at Checkpoint 4: the planner kept the rules (answer 2: a throw-in worth less than the best free agent really adds nothing). Since Phase 4b's value floor such a throw-in adds no value difference but pulls the partner's g toward 0 (Section 9), which is what the steps on Parker's cards now come from.

**Phase 4b details: tags, Plan B and the given-player cap** (planner reply to Checkpoint 4, change 6; `src/engine/explain.ts`, `planB.ts`, `rank.ts`)
- **Injury tags:** every player on either side whose status isn't ACTIVE gets a tag in words: "Questionable", "Out — expected back week 8", "On IR — expected back week 8", "On the PUP list — expected back week 9", "Out for the season", "Suspended", "Not an active NFL player". ⚠️ A return week shows only when the model counts on it (Section 6): OUT from next week on; IR, PUP and SUSPENDED after this week; a Q/D/P player's far ESPN date only when his projection follows it ("Questionable — ESPN expects him back week 8"). Other wordings: "Suspended for the season", "Doubtful — ESPN expects him back week 16". When a player I'd get is hurt, the card says once: "<name>: his projection assumes he returns at full strength, blended with the trade market." For OUT, IR and PUP players that sentence is part of the "depends on an injured player" flag; for Probable, Questionable and Doubtful ones it sits under the player lists (not for SUSPENDED or NA); ⚠️ it is said even for a player the blend doesn't reach (no real FantasyCalc value). The card leaves out the reasons' own injured caveat, so the message shows in the tag and the flag only. The tags come with the words (`withWords`), so the Finder's cards and the Analyzer show the same; a player only a Plan B box names gets the search's tag for him when any idea has him (⚠️ else the snapshot's, without an ESPN far date).
- **Plan B ("If they say no, try:")**, on a Finder card without steps: among the search's exactly evaluated trades with the same partner, one that differs in at least one player, has B > 0, "Helps you" at least half the card's (`search.planB.minHelpsShare`, judged on the printed scores) and isn't hidden by the market guard; a different package for the same players of theirs first, else a different set of their players; then the best Overall, then the key. ⚠️ Our additions: it must also be at least `steps.minAcceptGain` (5 points of P_complete) likelier to go through than its card (by the planner's rules alone, 14 boxes on the 16 cards of Parker's 2026-10-04 data, 8 of them less likely to be accepted than their card, often the card plus a throw-in the steps had already rejected; with the bar 5 of 16 cards get one, none less likely; a planner question), and at most 3 Plan B boxes in the top 20 may add the same player of mine. It is never a trade shown as a card (Phase 4b final review: a box naming the card above it was circular advice). A candidate that wasn't a finalist gets the final simulation, so the box's three numbers are on the card's basis; up to `planB.tries` (3) candidates are tried (a finalist needs no new simulation; one the box cap skips doesn't count). The box, after the card's flags, facts, reasons and message, shows its players with their tags, its three numbers, its own "Message to send them" (a follow-up naming the Plan B trade) and "Open in Analyzer", which evaluates it as one offer, without steps. No Plan B in the Analyzer.
- **The given-player cap** counts each player of mine on a trade's side (a 2-for-1 counts for both) within the partner cap's top-20 window, after the filler, core and partner rules; the finalists' ranking relaxes it by one like the others; a one-partner search keeps it.

**Trade Analyzer**
- The user builds any trade, including counteroffers, and sees the same evaluation.

---

## 14. UI (MVP)

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

   **The user must be able to tell at a glance whether we got their league right.**
3. **League:**
   - a team table: record, points-for, projected points per week, and needs and trade-chip chips, with a small "Values: FantasyCalc" link. The chips once labeled "Surplus" read "Trade chips" (Checkpoint 2); "Needs" stay as they are. A chip reads like "C. McCaffrey: worth +33 to Team 2 · costs you 6.1 pts/wk", with a "starter" tag when he starts for his own team (Checkpoint 3 answer 3), and a tooltip giving what that team gains and what his own team loses. A player with conflicting ESPN signals (Section 6) shows the note in his row
   - Phase 3: a standings table in today's order by the league's rules (record, points for, playoff, bye and title odds, the projected final record, and notes on the rules simulated), and your remaining games (opponent, both teams' projected points, your chance to win and to beat the median, your likely starters on bye, and risky weeks flagged in words: under 40% to win, or 3+ likely starters on bye in a week that counts). A redraft team that is certainly out sees "Your season's over — no trade helps this year." and no partner cards. The risky-week thresholds are `config.leaguePage` (Section 15). A browser holding an import saved by an older version sees "Offer Sheet was updated. Import your league again to see the new numbers." instead of "No league imported yet"
   - a positional strength heatmap
   - best trade partners
   - roster tables with each player's ROS points (Section 6), regular season and playoffs, games left and bye status; tapping or hovering shows the week-by-week breakdown
   - Phase 4b: a line above the rosters says how free agents are shared out and where my team picks (Section 7), and the player breakdown shows the market blend ("Our projection 210 · Trade market 170 · Used 190", Section 6 step 8; a player at the top or bottom of his position's value range, whose market number is his own, reads "Trade market: no comparison (top value at his position)").
   - Phase 4: each roster shows the free-agent pickups the optimizer would make for that team (Section 7; K and DEF never among them; each with the gain it was chosen by: with injuries and byes simulated when scenarios ran, the expected-value gain in its tooltip), and the page lists "Streaming picks this week": the top 3 K and top 3 D/ST free agents for the current week, each with its projection and opponent.
   - Phase 4 (planner addendum to Checkpoint 3, §2): a "Harder to get" tag (in words, not color alone) on other teams' tagged players in roster tables, trade chips and partner rows (⚠️ never on my own roster, where it would read as advice about my own players). Partner rows lead with the best untagged target ("Best of their trade chips: C. Olave, +4.7/wk"; "Best target" until Phase 4b, Checkpoint 4 answer 9); when the single best player for me is tagged, he follows ("Bigger upgrade, harder to get: J. Smith-Njigba, +7.4/wk"); the rest follow under "They could also give". Each partner card ends with "See trade ideas with Team X →", which opens the one-partner Trade Finder (`/trades?partner=<id>`). ⚠️ Lead decision N12: every lead line needs at least `needs.bestTargetMin` (1 point a week, as printed): "Best of their trade chips" is the best untagged chip that reaches it; when none does and the single best chip is tagged, he leads alone as "Best of their trade chips, harder to get" if he reaches it too (a "+0.1/wk" lead next to a "+7.2/wk" star read oddly). Targets come from the partner's trade chips, so they can differ from the Trade Finder's best ideas with that team.
   - Phase 2: each roster also showed the team's best free-agent move (Section 7), and the best available free agents by position. In keeper leagues the values shown are redraft (perception) values. Playoff-weighted numbers (lineup cost, the move's gain) are labeled "lineup pts (playoffs count 1.25×)", never "ROS pts". One-sided partners are badged "Would start for you". While a week is under way, the header, team note and heatmap captions say which weeks team numbers count. Stored model inputs are reused only while under 6 hours old (the projections TTL).
4. **Trade Finder:** the controls and the ranked trade cards (Section 13).
   - Phase 4 (`/trades`): a partner filter (all teams or one; `?partner=<team id>` in the address, written back when picked), the sort (Overall default, Helps you, Chance they accept; re-sorting doesn't search again), a progress bar with plain stage names and Stop (the search runs in the Web Worker in ~40 ms slices, so Stop or a newer search is seen between slices), hidden-trade counts, the notes (including each evaluation's own, such as the week-in-progress or keeper notes) and warnings, links to Settings and the Analyzer, and empty states (no team picked, season over, deadline passed, nothing found). Any settings change starts a new search with the last ideas dimmed; Stop keeps them.
   - Each card: give/get, Helps you / Chance they accept ("Est.", the label, P_complete when the veto rule cuts it) / Overall (B ≤ 0 scores 0; an unknown B shows —), risk flags apart ("Market check: you'd get 22% less trade value than you give", the injured flag), "Your lineup +3.5 pts a week", playoff and title odds in percentage points ("+4.1 percentage points (62% to 66%)"), values given and received with a small "Values: FantasyCalc" link, "You get 142 ROS pts, give 118", required drops and adds, the reasons, the pitch behind a "Message to send them" disclosure with Copy, "Open in Analyzer", and the feedback buttons (Section 11) saved in this browser.
   - Phase 4b: injury tags under the players, the "If they say no, try:" box (Section 13), and in the trade values a note that a player worth less than the best free agent counts at that free agent's value (Section 9). The roster moves include IR moves (Section 13). When the veto cuts a chance below the 5% display floor the card says "under 5% it goes through". When the starting lineup moves the other way from the raw ROS points, a line says so ("Your starting lineup still gains 5 ROS pts: ROS points count each player's projected points whether he starts or not."). How to read says the chance is never above 85% and that it weighs what the trade adds to or costs their starting lineup. The focus ring is a darker gold on light backgrounds (4.7:1 on white). Every browser holding a pre-4b import must import again (the stored import's format is 3).
   - "How to read a trade idea" is worded per league type (dynasty and keeper: long-term value weighed by Win now ↔ Future; keeper: keeper costs aren't counted).
   - Phase 4 finish: the Finder states "Your odds before any trade" with a note that they count each team's helpful free-agent pickups (so they can differ from the League page's, with rosters as they stand); a week in progress is noted once for the whole list; a "Doesn't help you" flag says why (redraft: your chances rise but you'd give up more trade value than your "Protect my trade value" setting allows; dynasty and keeper: this season against long-term value by Win now ↔ Future); a one-partner search shows more than 3 ideas (§13); the Finder and the Analyzer share one engine worker, so its context survives page changes, and the Finder shows its last searches again at once (in memory, while no kickoff or deadline change has happened) and brings the card you came back from into view.
5. **Trade Analyzer.**
   - Phase 4 (`/analyzer`): pick the partner, then players from both active rosters (Phase 4b: and IR, an IR player's detail ending in "IR slot"; taxi players can't be traded yet), up to `config.search.analyzerMaxPerSide` (4) a side; Evaluate shows the same card or the reason the trade can't be made. A result for an older trade, settings or league data is dimmed and says so. `?partner=&give=&get=` (team and player ids only, never league ids or names) prefills and evaluates a trade, and Evaluate writes the trade back into the address (replaceState). Links that carry ids never prefetch, so the server sees an address only when the user opens it.
   - The Analyzer shows "Your odds before this trade" above the card (the card's odds get the same end percents as on the Finder), puts its status line above the form, brings an automatically evaluated trade (from a card's link) into view with its heading focused, and links back to the Finder's last address. It shows "How to read the evaluation" under its card (the Finder's explainer, worded for a trade you built, including "Harder to get" and "How to offer it").
   - Nav: League, Trades (marked current on the Analyzer too), Settings; "Import report" reads "Report" on phones so five links fit at 375 px. The League page's partner cards link to the Trade Finder for that team; the Import Report points to it.
6. **Settings:**
   - playoff weight
   - Win now ↔ Future
   - max players per side
   - untouchables
   - include P/K/DEF/IDP and draft picks
   - "Export feedback" (Section 11)
   - Phase 4 (`/settings`): also "Protect my trade value" (Low / Medium / High; redraft leagues only, where "Win now ↔ Future" sits in dynasty and keeper leagues), "Positions I stream weekly" (K and D/ST by default; QB and TE when the league starts them), must-include players and positions to target or avoid. Settings are kept per league in this browser's localStorage (`offersheet:settings:v1`, filed under a short code made from the league ID) and go with every engine request; the League page recomputes only when a setting it reads changes (streamed positions, playoff weight). Win now ↔ Future and draft picks show only in dynasty and keeper leagues. Conflicting choices are prevented (a player both untouchable and must-include; a position both targeted and avoided). Feedback is kept in localStorage too (`offersheet:feedback:v1`, newest 500); its export numbers leagues (league-1, league-2) instead of their codes; `npm run feedback:summary -- <file>` summarizes it. The privacy page says all of this.

**Home page and privacy**
- A placeholder landing page for Offer Sheet is already live (Section 17, Phase 7). The app's home page should carry over its wording: what the app does, how it works, and the platforms it supports.
- The privacy policy lives at `/privacy`. It must match what the app actually does, so update it whenever data handling changes.

**Footer and layout**
- The footer shows:
  - "Trade values: FantasyCalc" with a link
  - the Yahoo attribution whenever Yahoo data is shown
  - "Not affiliated with ESPN, Yahoo, Sleeper, Fleaflicker, MFL or Fantrax."
- Design mobile-first and make it work at 375 px wide. Keep it clean, sporty and easy to read.
- Phase 4 finish: every button and link meant to be tapped is at least 44 px tall on phones, the Import Report's and the Connect page's small buttons included.

---

## 15. Config defaults (`src/engine/config.ts`)

This is the single source of truth. Every number listed here must be read from config, never hardcoded.

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
| market blend (`marketBlend`) | weight 0.5; QB, RB, WR, TE with a real FantasyCalc value; per game, leave-one-out; a position needs ≥ 10 healthy valued players (`minPlayers`) | 6 |
| count-stat distribution (TDs, receptions, interceptions, sacks, FGs made, 2-point conversions, fumbles) | Poisson with mean = projection; exact P(X ≥ k) | 5 |
| statSd: per-stat SD for normal expected-value rules | completion % 10; D/ST points allowed 9 (measured 9.7); D/ST yards allowed 77 (⚠️ measured on weeks 1–3) | 5 |
| yardageSd: yardage SD = a + b × projected mean, at least 1 | pass_yd 0 + 0.341, rush_yd 3.9 + 0.48, rec_yd 8.8 + 0.50, kr_yd 20.2 + 0.56, pr_yd 3.7 + 1.45; other yardage 0.5 × mean (⚠️ measured on weeks 1–3, `npm run measure:stat-sd`) | 5 |
| statGrid: stat resolution for expected-value bounds | counts 1; IDP sacks 0.5; completion % continuous | 5 |
| statFloor | points and yards allowed ≥ 0; yardage ≥ 0; a floored normal keeps its mean at the projection | 5 |
| ESPN / Sleeper projection agreement needed to average them | within 10% on average (Σ\|E − S\| / Σ S) | 6 |
| projection lookback | 3 weeks | 6 |
| season projection per game | ÷ 17 games (⚠️ the season line's span is unverified) | 6 |
| P's injury risk and σ | K's (an assumption) | 6 |
| playoffWeight | 1.25 | 7 |
| needZThreshold | −0.5 | 7 |
| availability scenarios S (common random numbers), seed | 32, 20260929 | 7 |
| known return week R | 25% / 50% / 25% over R − 1, R, R + 1 (the split is an assumption), never earlier than the status allows; Q/D/P use it only 2+ weeks out, OUT only from next week | 6, 7 |
| an IR player's expected return week | the first week his chance of being back reaches 0.5 (`returnWeekQuantile`, Phase 4b) | 6, 7 |
| IR slot statuses when the platform doesn't say (`lineups.irEligibleDefault`) | IR and PUP (the ESPN adapter sets IR and OUT, from ESPN's help center; Sleeper reads its reserve_allow_* flags) | 7 |
| a Q/D/P player's ESPN return date counts only this far out (`projections.returnConflictWeeks`) | 2 weeks | 6 |
| League page risky week (`leaguePage`) | under 40% to win (`riskyWinChance`, judged on the printed whole percent), or 3+ likely starters on bye (`riskyByes`) in a week that counts | 8, 14 |
| League page needs, trade chips and partners | chip: gap ≥ 10 ROS points (`chipMinGap`); 3 need and 3 trade-chip chips per team; 3 partners; partner fit counts at most `maxPerSide` chips per side that stay chips together | 7 |
| chip search screen (starter-limit leagues only) | the 3 other teams with the largest exact EV gain per player (`chipScreenTeams`) | 7 |
| stale ESPN return date (Q/D/P, 2+ weeks out) | Sleeper projects him this week at ≥ 50% of his healthy base rate (`staleReturnShare`) → the date is stale | 6 |
| FantasyCalc TE premium → te++ | premium ≥ 0.75 per catch, else te+ (approved at Checkpoint 2; ⚠️ until FantasyCalc confirms) | 2.9 |
| sims (final / screening), seed | 5000 / 1000, 20260930 | 8 |
| valueFloor | 1% of the top value | 9 |
| unvalued-player estimate: minimum valued players per position for the curve | 10 | 9 |
| trade-search default exclusions | P, K, DEF, IDP | 9 |
| waiverCreditMin | 1% of the top value | 9 |
| studExponent | 1.0 | 9 |
| benefit weights (ΔPO / ΔCH) | 0.35 / 0.65 | 10 |
| market term weight κ, "Protect my trade value" (`protectValue`) | Low 2 / Medium 4 (default, `protectValueDefault`) / High 8; redraft only (1.0 before the addendum) | 10 |
| value floor | every player counts at max(v, W) in every package sum, both sides (Phase 4b) | 9 |
| star premium (`acceptance.starPremium`) | e_rank #1 0.10, #2 0.05; e_elite 0.10 for the top 12 by FantasyCalc value (`eliteTop`); dynasty, partner's P(playoffs) < 25%: × 0.5 for RBs and WRs aged 27+; "Harder to get" at e ≥ 0.15 (`harderToGetMin`) | 11 |
| B_future scale | 40 | 10 |
| λ defaults | 0.35 / 0.5 / 0.75; keeper 0.2 | 10 |
| Trade Score and Overall B_ref | 6 (Checkpoint 3; was 5) | 10 |
| streaming positions | default K and DEF (user can add QB or TE); replacement = the 3rd best free agent that week (`streamRank`); another team streams a position after 2+ adds there this season | 7 |
| free-agent optimizer | moves of at least 3 ROS points (`faMinGain`), at most 5 moves (`faMaxMoves`); dynasty guard `faDynGuard` 0.05 × the top dynasty value; never K or DEF (`optimizerExcluded`) | 7 |
| market check / hide thresholds | −0.15 / −0.35 | 10 |
| "depends on an injured player" statuses | OUT, IR, PUP (`benefit.injuredStatuses`) | 10 |
| acceptance β's | see Section 11; β_need 1.2 in redraft and keeper leagues, 0.6 in dynasty (`beta.need`, `beta.needDynasty`; Phase 4b) | 11 |
| P_accept clamp | [0.02, 0.85] (0.95 before Phase 4b) | 11 |
| veto rule | g < −0.30 → × 0.5 | 11 |
| max players per side | 2 (user can allow 3) | 12 |
| give pool / get pool size | 10 / 10 untagged + 3 "Harder to get" (`getPoolTagged`) | 12 |
| offer-first steps | throw-in: lineup cost ≤ 5 ROS points (`throwInMaxCost`); a step shows when it adds ≥ 5 points of acceptance (`steps.minAcceptGain`) and the offer first is ≥ 10% likely (`minOfferFirst`); an added throw-in keeps B ≥ 80% of the offer's (`minBShare`); case 2 evaluates the best 2 candidates exactly (`preScreen`) | 13 |
| League page "Best of their trade chips" floor | 1 projected point a week, as printed, for every lead line (`needs.bestTargetMin`, N12) | 14 |
| extension beams (2nd / 3rd player) | 60 / 40 | 12 |
| kept per partner | 30 | 12 |
| exact-evaluation max (all partners) | 200 | 12 |
| screening g_mkt(P) window | [−0.35, 0.6] | 12 |
| final-simulation finalists | 40 | 12 |
| results shown | 25 | 12 |
| diversity caps | 3 per partner in the top 20 (`partnerCapTop`); 2 per core; 3 per given player of mine in the top 20 (`perGivenPlayerInTop20`, Phase 4b) | 13 |
| Plan B (`search.planB`) | Helps you ≥ 50% of the card's (`minHelpsShare`); up to 3 candidates tried (`tries`); ⚠️ and P_complete ≥ the card's + `steps.minAcceptGain`, never a card shown, and at most `ranking.perGivenPlayerInTop20` (3) boxes in the top 20 add the same player of mine | 13 |
| extension pairing (one player added to each side) | the 5 best single additions per side (`pairExtensionTop`) | 12 |
| Trade Analyzer players per side | 4 (`analyzerMaxPerSide`) | 13 |
| search progress (responsiveness, not a model number) | yield every 100 screens / 5 screening simulations (`yieldEveryScreens`, `yieldEverySims`) | 12 |
| exact title odds: re-seeding brackets computed exactly from | 8 teams left (`exactReseedTeams`; a speed limit) | 8 |
| explanation thresholds (`explain`, display only) | slot change 1 pt/wk; lineup change 0.5; playoff gain 1; risky week 3; even value ±5%; partner reasons need a 0.1-logit term, at most 3; long-term value 1%, first when λ ≥ 0.5; hole rank quoted in the bottom half; value as a multiple above 100%; pitch mentions value up to 25% | 13 |
| filler cutoff | 0.2 × B | 13 |
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
- `npm run probe:all` runs the live checks by hand.
- `npm run check:browser -- --team <id>` (Phase 4b; after `npm run build`) runs the production build in headless Chrome on Parker's league at 375 px: every page, a full Trade Finder search with its timings, a card's buttons, the Analyzer and Settings; no sideways overflow, no console errors, tap targets of at least 44 px, "Harder to get" never on his own players. The league id is read from `.env.local` and never printed; output and screenshots are cleaned of league names and stay in git-ignored `.cache/check-browser/`.
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
- outcome feedback and the refit script
- error and loading states
- accessibility
- performance work

**Then:** Checkpoint 6.

### Phase 7 — Public launch, only when Parker asks

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
- an email to FantasyCalc before launch (Section 2.9), which also asks them to confirm the te+/te++ meaning
- basic SEO: title, description and an Open Graph image
- an attribution check: FantasyCalc everywhere values show, and Yahoo everywhere Yahoo data shows

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
- **FantasyCalc:** show a link on every page that shows values, and fetch at most once per day per format.
- **Credentials:** ESPN cookies and Yahoo tokens only ever go to their own platform. Never log them, and never store them on the server. Never ask for ESPN passwords.
- **Feedback data (Phase 7):** store only the anonymized fields in Section 11. Say so in the UI and the privacy policy, and offer an opt-out.

---

## 20. Out of scope for the MVP

- sending trade offers, or making roster moves on any platform
- accounts and payments
- other sports
- AI-generated text (templates only for now)
- keeper-cost modeling (the UI says it isn't modeled)