# Offer Sheet

Finds and ranks fantasy football trades for your team. The working name was Fantasy Trade Finder, which is why the folder and package are still called `fantasy-trade-finder`. The full spec is in `CLAUDE.md`, and progress is tracked in `reports/STATUS.md`.

It's read-only: it never sends offers or changes anything on any platform.

## Setup (PowerShell)

```powershell
npm install
Copy-Item .env.example .env.local
npm run gen:secret
npm run check-env
```

Fill in `.env.local` with whatever you have. Blank means "not available". Never paste its values into chats or reports. `npm run check-env` shows only "set" or "blank".

## Run the app (PowerShell)

```powershell
npm run dev
```

Then open http://localhost:3000/connect and connect an ESPN or Sleeper league. The Import Report shows what the app understood; the League page (http://localhost:3000/league) shows projected points, needs, surplus, trade partners and every player's rest-of-season points. Its math runs in the browser. By default your own ESPN league imports the way a leaguemate's would (public link, pick your team). To have development use `ESPN_S2` and `ESPN_SWID` from `.env.local` instead, so the app finds your team itself, set `USE_ENV_COOKIES=1` in `.env.local` and restart `npm run dev`.

`npm run dev` listens on this computer only. To try it from a phone on the same Wi-Fi, run `npx next dev -H 0.0.0.0` instead and open the computer's address on port 3000; while that runs, anyone on the network can reach the development server (and, with `USE_ENV_COOKIES=1`, the `.env.local` cookie fallback for your league).

## Everyday commands

| Command | What it does |
|---|---|
| `npm test` | Unit tests (no network) |
| `npm run typecheck` | TypeScript checks |
| `npm run lint` | ESLint |
| `npm run check:leaks` | Scans everything git would commit for secrets and leaguemates' names or IDs. It also runs as the pre-commit hook in `.githooks/`, which `npm install` switches on |
| `npm run import:report` | Imports your leagues from `.env.local` through the real app code and writes `reports/import-report.md` (names replaced with placeholders). By default your ESPN league imports the way a leaguemate's would (public link, pick your team); add `-- --cookies` (or set `USE_ENV_COOKIES=1`) to use the `.env.local` cookies |
| `npm run oracle:report` | Scoring-oracle results per platform and rule type, from committed fixtures: `reports/oracle-results.md` |
| `npm run league:report` | Runs your ESPN league through the League page's engine and writes `reports/league-report.md`: projected points per week, needs and surplus, FantasyCalc match rates, depth values and every rostered player's rest-of-season points (names replaced with placeholders). Add `-- --team 3` to say which team is yours when importing without cookies |
| `npm run measure:stat-sd` | Measures the SDs behind expected-value scoring rules (yardage, D/ST points and yards allowed) on every completed week of public Sleeper projections and stats, and prints a config block for `src/engine/config.ts` |
| `npm run probe:all` | Live data-access probes for every platform, then rebuilds `reports/data-access.md` |
| `npm run probe:espn` (and `:sleeper`, `:shared`, `:fleaflicker`, `:mfl`, `:yahoo`, `:fantrax`) | One platform |
| `npm run check:sleeper-cors` | Whether browsers may read Sleeper's API directly |

Probes never read strangers' public leagues beyond the one pinned test league per platform. Checks that would (discovery, the code survey) report "untested: needs --allow-crawl" and only run with `npm run probe:all -- --allow-crawl`, after Parker agrees (CLAUDE.md §0.6).

Minimized test fixtures of strangers' leagues are rebuilt from the git-ignored local copies with `npm run minimize:espn` (and `:sleeper`, `:mfl`, `:fleaflicker`); the ESPN ID tables with `npm run gen:espn-constants`.

## Privacy

- Secrets live only in `.env.local`, which git ignores.
- Raw API captures go in `fixtures/raw/`, which git ignores.
- Committed fixtures in `fixtures/sanitized/` use placeholders such as "Team 3". Strangers' test leagues are committed only as minimized copies in `fixtures/sanitized/min/`; their full copies stay in `data-local/`, which git ignores.
- Local caches live in `.cache/`, which git ignores. The app's own cache (`.cache/app/`) deletes league data after about 10 minutes.
- `.next/` (Next.js build output, git-ignored) can hold copies of `.env.local` values, because Turbopack saves the environment in its cache. Never share, zip or sync the project folder with `.next/`, `.cache/` or `data-local/` in it, and delete `.next/cache` after you change your ESPN cookies.

## Credits

- ESPN ID tables are ported from [cwendt94/espn-api](https://github.com/cwendt94/espn-api) (MIT).
- Trade values come from [FantasyCalc](https://fantasycalc.com).
- Projections and stats come from [Sleeper](https://sleeper.com) (and ESPN for ESPN leagues).
- The player ID crosswalk comes from [DynastyProcess](https://github.com/dynastyprocess/data).
- The NFL schedule comes from [nflverse](https://github.com/nflverse/nfldata).

Not affiliated with ESPN, Yahoo, Sleeper, Fleaflicker, MFL or Fantrax.
