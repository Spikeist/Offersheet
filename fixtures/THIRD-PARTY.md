# Third-party data in the fixtures

The tests run on captured API responses, never on the network (CLAUDE.md, Section 16). This page lists where the
committed data comes from and under what terms. Everything under `fixtures/sanitized/` was sanitized first:
leaguemates' names, team names, ids, avatars and logos are placeholders (CLAUDE.md, Section 0.6). Strangers' public
leagues appear only in minimized form, under `fixtures/sanitized/min/`, with shifted timestamps.

| Data | Where | Source and terms |
|---|---|---|
| Player ID map, a subset: the rows for active Sleeper QB/RB/WR/TE/K, captured 2026-09-30 | `fixtures/sanitized/shared/a6e4ae65ba18e78eb86949805dc3940d396f90ac274b1e53491134e91380bd9a.csv` | [DynastyProcess](https://github.com/dynastyprocess/data) `files/db_playerids.csv`, licensed under the GNU General Public License v3.0. This modified subset is distributed under the same license; its text is in [`licenses/GPL-3.0.txt`](licenses/GPL-3.0.txt). |
| ESPN's ID tables (lineup slots, positions, pro teams, stat ids), parsed | `fixtures/sanitized/espn/5a4cc6ff7fb07efe7de104b6994370f3d7dc648b400548717efd828e146adcb9.json`, and ported to `src/adapters/espn/constants.ts` | [cwendt94/espn-api](https://github.com/cwendt94/espn-api) at commit 663d726, `espn_api/football/constant.py`, MIT license. Its notice is in [`licenses/espn-api-MIT.txt`](licenses/espn-api-MIT.txt). |
| The 2026 NFL schedule, reduced to the fields the tests read | `fixtures/sanitized/shared/` (label `nflverse/games 2026 REG`) | [nflverse/nfldata](https://github.com/nflverse/nfldata) `data/games.csv`. |
| ESPN, Sleeper, MyFantasyLeague, Fleaflicker, Fantrax and Yahoo API responses, sanitized | `fixtures/sanitized/` | Captured from each platform's public API for tests. The data belongs to its owners: ESPN, Sleeper, MyFantasyLeague, Fleaflicker, Fantrax and Yahoo. Sleeper's projections come from Sleeper's own projections endpoint. |

**FantasyCalc's trade values are not in the public repository.** Offer Sheet uses them under FantasyCalc's conditions
for free use, and those don't allow republishing them. The private working repository keeps a few captured lists for
its tests. The public copy leaves those files out of every commit, and the tests that read them skip there, with a
reason.
