# Fantasy Trade Finder (working name)

Finds and ranks fantasy football trades for your team. The full spec is in `CLAUDE.md`, and progress is tracked in `reports/STATUS.md`.

It's read-only: it never sends offers or changes anything on any platform.

## Setup (PowerShell)

```powershell
npm install
Copy-Item .env.example .env.local
npm run gen:secret
npm run check-env
```

Fill in `.env.local` with whatever you have. Blank means "not available". Never paste its values into chats or reports. `npm run check-env` shows only "set" or "blank".

## Everyday commands

| Command | What it does |
|---|---|
| `npm test` | Unit tests (no network) |
| `npm run typecheck` | TypeScript checks |
| `npm run lint` | ESLint |
| `npm run probe:all` | Live data-access probes for every platform, then rebuilds `reports/data-access.md` |
| `npm run probe:espn` (and `:sleeper`, `:shared`, `:fleaflicker`, `:mfl`, `:yahoo`, `:fantrax`) | One platform |
| `npm run check:leaks` | Scans everything git would commit for secrets and leaguemates' names or IDs |

## Privacy

- Secrets live only in `.env.local`, which git ignores.
- Raw API captures go in `fixtures/raw/`, which git ignores.
- Committed fixtures in `fixtures/sanitized/` use placeholders such as "Team 3".
- Local caches live in `.cache/`, which git ignores.

## Credits

- ESPN ID tables are ported from [cwendt94/espn-api](https://github.com/cwendt94/espn-api) (MIT).
- Trade values come from [FantasyCalc](https://fantasycalc.com).
- The player ID crosswalk comes from [DynastyProcess](https://github.com/dynastyprocess/data).
- The NFL schedule comes from [nflverse](https://github.com/nflverse/nfldata).

Not affiliated with ESPN, Yahoo, Sleeper, Fleaflicker, MFL or Fantrax.
