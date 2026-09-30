# Checkpoint 1: ESPN and Sleeper import, ID crosswalk, scoring engine, Import Report
Status: ⚠️ Done with issues. Every Phase 1 build item works and is tested. Your league imports live, and every scoring check meets its target. Three rule types (stepped, bounded, per-game) have only indirect or no platform evidence, and a few settings are inferred. All are marked ⚠️ below.

## What works
- **ESPN import:** paste a league link, or text around a link, or an ID.
  - Your public league imports live in about 8 s cold (13 requests at ESPN's pacing) and 0.2 s from cache.
  - A private league offers the two §14 choices: a copy-ready message asking the commissioner to make it viewable, or cookies on a computer (session-only cookie, "Forget my credentials"). No password is ever asked.
  - Wrong season → "League not found for that season." ESPN outages are reported as outages. Private-league paths are tested with mocks.
- **Sleeper import:** by username (picker when there are several leagues; guillotine disabled) or league ID/link.
  - Handles best ball, trade review, position limits, re-seeding, the draft-pick table, and inactive players.
  - The pinned test league imports live in 7.8 s.
- **Player IDs:** every one of your 164 rostered players gets a canonical Sleeper ID. 163 come through the ID sources. 1 rookie kicker is matched by exact name, position and team, and flagged. D/ST 12/12.
  - The crosswalk survives outages: it uses saved copies, keeps serving during rebuilds, and a Sleeper outage costs 2 requests, down from 40.
- **Scoring engine and maps** for ESPN, Sleeper, MFL and Fleaflicker (MFL and Fleaflicker are scoring only; import is Phase 5), with every rule kind. Expected values now handle half-sacks, the points-allowed floor, and players who didn't play.
- **Import Report** at 375 px:
  - At-a-glance tiles; scoring, lineup, season, trade rules, teams, players, notes, warnings and data timestamps.
  - A "Your team" picker, a Refresh button (at most once a minute), and "unknown" states.
- **Privacy and security:**
  - Credentials live only in the POST body and a sealed, httpOnly, session-only cookie (no Max-Age/Expires; the seal dies after 12 h).
  - ESPN member IDs (SWIDs) are one-way pseudonymized before anything is cached, and cached data is deleted when its time is up.
  - Same-origin checks and security headers. The pre-commit leak check is now committed (`.githooks/`).
- **Sleeper allows browsers to read its API** (CORS `*` on 4 endpoints). Browser fetching is deferred to Phase 7.

## Your league's Import Report, in words (full text: `reports/import-report.md`, names replaced)
- **League:** ESPN, 2026, week 4, 10 teams, redraft. Your team (Team 3, 1–2) is found from your cookies, which come from .env.local in development. Without cookies (the public-link path a leaguemate gets), it asks you to pick.
- **Scoring:**
  - Half-PPR (0.5 per catch at every position, no TE premium); 4-point passing TDs; 1 point per 25 passing yards and per 10 rushing/receiving yards; 6 per rushing or receiving TD; −2 per interception or lost fumble.
  - Kicking: FG 0–39 = 3, 40–49 = 3, 50+ = 5, extra point 1, missed FG −2.
  - D/ST: sack 1, INT 2, fumble recovery 2, TD 6, safety 2, blocked kick 2; points allowed 0 → +5 … 46+ → −7 (18–21 scores 0).
  - Not counted: 1-point safety (+1) and blocked punt/FG return TD (+6).
- **Lineup:** QB, 2 RB, 2 WR, TE, FLEX (RB/WR/TE), D/ST, K; 7 bench, 1 IR, no taxi; 16 active spots. Position caps: QB 4, RB 8, WR 8, TE 3, K 3, D/ST 3.
- **Season:** regular season weeks 1–14; playoffs weeks 15–17 with 6 teams and 2 byes (derived); fixed bracket.
- **Trades:** deadline Wed Dec 2, 2026, 11:00 AM CST (NFL week 13); league vote (24-hour review, 4 votes veto); no FAAB.
- **Activity:** 0 completed trades (1 accepted trade is in review and noted); 59 players added (33 by waiver claim); 49 dropped.
- **Players:** 164 rostered (7 on IR) and 255 free agents, the top 50 per position by rest-of-season projection. Expected return weeks are known for 22 of 22 injured players.
- **Sleeper:** `SLEEPER_*` is blank, so you have no Sleeper league. The same report for the pinned public test league (12-team dynasty, superflex, re-seeded playoffs, deadline week 11) imports live with 0 warnings.

## All warnings
- **Your league (4):**
  1. The 1-point safety rule isn't counted.
  2. The blocked punt/FG return TD rule isn't counted.
  3. 10 players are in no ID source and were matched by exact name, position and team: 1 rostered kicker and 9 free agents.
  4. The ID sources disagree on one free-agent QB's ESPN id.
- **Your league's notes (7):** derived byes; the review reading; the position-cap reading; return weeks 22/22; 1 questionable player expected out 4+ weeks; 1 trade in review; ESPN's per-team trade counters are ahead of the listed trades.
- **Sleeper test league:** 0 warnings.

## Scoring oracle, per rule type (`reports/oracle-results.md`)
- **All 12 suites meet §5's 99%,** except the exotic Fleaflicker keeper league (86.3%, held to a regression pin; 25 of its 82 rules have no Sleeper stat). Overall 6597/6639 player-weeks.
  - ESPN, your league: 331/331
  - ESPN public league, weeks 2–3: 498/498
  - Sleeper: 808/808 across 5 leagues
  - MFL: 222/222
  - Fleaflicker conventional league: 140/141
- **A rule type now counts only where a wrong reading would change the points** (review fix; the old counts overstated coverage).
  - ✅ **per-unit:** 2209 cases.
  - ✅ **byPosition:** the ESPN public test league's position overrides match 498/498 read as replacements, versus 450/498 as additions.
  - ✅ **threshold:** 78 cases.
  - ✅ **range:** 150 cases.
  - ✅ **composite:** 33 cases.
  - ⚠️ **stepped:** 3553 cases, all from ESPN's own every-N counts, not league points.
  - ⚠️ **bounded:** no league in our data has one.
  - ⚠️ **per-game:** 9 cases from one derived Fleaflicker rule, plus 15 idle weeks correctly scored 0.

## CLAUDE.md sections changed since Checkpoint 0
- **From the planner's reply:** §0 (items 6 and 12), §1, §2.2 (Login, Errors, Key JSON paths), §2.3 (Documented endpoints, League fields, Undocumented endpoints), §2.5, §2.6, §2.9 (FantasyCalc), §3 (Folder layout), §4, §5 (Points formula, oracle), §6 (steps 1–3), §7 (Weekly lineup value, Roster legality), §8 (Standings and playoffs), §9 (Player values), §10 (Trade Score, the three numbers, Guards), §11 (Feedback), §12 (User settings), §13 (Ranking, card contents), §14, §15, §16, §17 (Phase 1, Phase 4, Phase 7) and §19.
- **From Phase 1 findings:**
  - §2.2: the public league has drafted; trades in review; trade counters; injury return dates; keeperCountFuture.
  - §2.3: inferred Sleeper readings; the deadline is a league week; CORS result.
  - §2.10: retention, saved public copies, SWID pseudonyms.
  - §4: leagueWeek, unknownSettings, NA, a sportradar id, the return-week note.
  - §5: stat grid and floor, missing stats, gp; bonus_fd fill.
  - §6: NA availability.
  - §15: yds_allow SD 70 (⚠️ one week), statGrid, statFloor, P σ, NA, free agents.
  - §17: Phase 0 step 3.

## What doesn't / open issues
- ⚠️ **ESPN:**
  - Other teams' completed trades come without their players. Refilling them from player cards is planned for Phase 4.
  - Keeper and dynasty detection, IDP scoring and a 0-hour review are inferred and have never been seen live.
  - Private leagues are tested only with mocks.
- ⚠️ **Sleeper:**
  - 200-yard receiving/rushing tiers are treated as exclusive by analogy; none fired in weeks 1–3.
  - 4 flag keys never fired.
  - The draft-pick window (next 3 seasons) is inferred.
  - Playoff matchups aren't imported until Phase 3.
- ⚠️ **Expected values for low-count and rate stats** use §5's SD = 0.5 × mean, which values a "2+ TD" bonus at about 0 (Question 3).
- **UI:** at 375×812 the Import button sits below the platform picker. Results now scroll into view and take focus; a compact picker is a design call.
- **Dev:** your own league always uses your .env.local cookies in `npm run dev`. `npm run import:report -- --no-cookies` shows the public path. `.next/` can hold copies of .env.local values (see README).
- **Deferred:** the FantasyCalc format-substitution note (Phase 2); background crosswalk rebuilds need `waitUntil` on Vercel (Phase 7).

## Decisions I made
- SWIDs are replaced by one-way pseudonyms before ESPN bodies are cached.
- Cache retention: league data about 10 min, closed weeks 6 h, public data 7 days as a stand-in during outages. The privacy page says so.
- Free agents are ranked by ESPN's rest-of-season line, and for Sleeper by the mean over the next 3 weeks, so byes don't hide players.
- Engine:
  - no rule fires on a line without games played
  - bounds sit between grid points (half sacks)
  - points allowed can't go below 0
  - a stat missing from a projection scores 0
- MFL "every half sack" rules are per-unit rates.
- Return TDs, forced fumbles and fumble recoveries use Sleeper's player keys.
- A team from a pasted ESPN team link is a hint to confirm ("From your link — check it"), never "Found by ESPN".
- "Not active" (injury NA) is used only when every Sleeper player list loaded; an unknown injury status counts as healthy, with a warning.
- The home page carries over the live landing page's wording, with "Trade Score" replaced by the three numbers and availability badges.
- JSON posts must be same-origin (Origin and Sec-Fetch-Site) with content-type JSON; security headers were added; `npm run dev` listens on 127.0.0.1.
- New config keys: statGrid, statFloor, yds_allow SD 70, NA 0, freeAgentsPerPosition 50, freeAgentRankWeeks 3.

## Numbers
- 1024 tests pass (93 files); typecheck and lint clean; check:leaks 0 hard, 14 soft (pre-existing, unchanged); `next build` OK.
- 375 px: no horizontal overflow on any page or state. Error, private-league and Sleeper-picker results land in view with focus; the Forget confirmation takes focus (headless Edge).
- Timings:
  - ESPN import cold 8.1 s at week 4; about 22 requests (~12.6 s) at week 13; cached 0.2 s.
  - Sleeper import 7.8 s.
  - Crosswalk from cache 0.6 s; first live build about 3 s.
- The adversarial review (7 lenses, each checked by a skeptic) found 75 findings: 73 confirmed, 0 blockers, all fixed or declined with a reason. The probe matrix is unchanged from Checkpoint 0.

## Questions (numbered, each answerable in one line)
1. For players no ID source knows (1 rostered kicker today), is it OK to match them by exact name + position + NFL team when exactly one active player fits, and flag each one?
2. OK to let a lower-priority ID source win when it's clearly the same player (name, position, and team or GSIS id) and the top source points to a stale record? This fixes 2 players.
3. In Phase 2, should count stats use SD = max(0.5×mean, √mean) (or an exact Poisson value) and completion % an SD of about 10, instead of §5's 0.5 × mean?
4. Keep the exotic Fleaflicker keeper league as a regression pin (86%) until Phase 5?
5. Should ESPN's PROBABLE injury status count as QUESTIONABLE (current) or ACTIVE?
6. Should `npm run dev` skip your .env.local cookies for your own league, so you see the same public-link flow as your leaguemates?
7. Treat Sleeper's 200-yard receiving and rushing bonuses as exclusive tiers, like passing, before a 200-yard game confirms it?
8. Assume Sleeper's tradable future picks cover the next 3 seasons, extended when a later pick has been traded?
9. Do you know an ESPN league with a TE premium, IDP, keepers or "every N yards" scoring we could read, with its owner's OK?

## How Parker can try it (PowerShell)
```powershell
npm install
npm run dev
```
Then open http://localhost:3000/connect and paste your ESPN league link. Other checks:
```powershell
npm test
npm run import:report -- --no-cookies
npm run oracle:report
```
