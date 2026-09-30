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

Then open http://localhost:3000/connect and connect an ESPN or Sleeper league. In development, your own ESPN league also picks up `ESPN_S2` and `ESPN_SWID` from `.env.local`, so the app can find your team.

`npm run dev` listens on this computer only. To try it from a phone on the same Wi-Fi, run `npx next dev -H 0.0.0.0` instead and open the computer's address on port 3000; while that runs, anyone on the network can reach the development server (and the `.env.local` cookie fallback for your league).

## Everyday commands

| Command | What it does |
|---|---|
| `npm test` | Unit tests (no network) |
| `npm run typecheck` | TypeScript checks |
| `npm run lint` | ESLint |
| `npm run check:leaks` | Scans everything git would commit for secrets and leaguemates' names or IDs. It also runs as the pre-commit hook in `.githooks/`, which `npm install` switches on |
| `npm run import:report` | Imports your leagues from `.env.local` through the real app code and writes `reports/import-report.md` (names replaced with placeholders). Add `-- --no-cookies` to import your ESPN league the way a leaguemate would (public link, pick your team) |
| `npm run oracle:report` | Scoring-oracle results per platform and rule type, from committed fixtures: `reports/oracle-results.md` |
| `npm run measure:stat-sd` | Re-measures the D/ST points- and yards-allowed SDs in `src/engine/config.ts` from cached public Sleeper data |
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
- The player ID crosswalk comes from [DynastyProcess](https://github.com/dynastyprocess/data).
- The NFL schedule comes from [nflverse](https://github.com/nflverse/nfldata).

Not affiliated with ESPN, Yahoo, Sleeper, Fleaflicker, MFL or Fantrax.
