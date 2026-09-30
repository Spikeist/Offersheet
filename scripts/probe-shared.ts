/**
 * Phase 0 probe for the shared, league-independent data sources (CLAUDE.md §2.2, §2.3, §2.9, §2.10):
 *
 *   NFL      current week (Sleeper /state/nfl vs the schedule), 2026 schedule and bye weeks
 *            (nflverse + ESPN), cross-checked
 *   FC       FantasyCalc values (11 formats, once per day each), GET /players, docs and terms
 *   IDMAP    DynastyProcess player ID crosswalk
 *   XWALK    ID joins between FantasyCalc, DynastyProcess, the Sleeper players DB and ESPN
 *   PROJ-S   Sleeper projections (undocumented)
 *   STATS-S  Sleeper actual stats (unverified endpoint)
 *   PROJ-E   ESPN league-independent projections (leaguedefaults/3)
 *
 *   npm run probe:shared
 *
 * All sources are public; no .env.local credential is used. The season and weeks come from Sleeper
 * /state/nfl, so a re-run later in the season checks that week's data. Output:
 * reports/probe-output/shared.{json,md}, fixtures/raw/shared/ (git-ignored) and trimmed copies in
 * fixtures/sanitized/shared/ (stale ones are pruned at the end of the run).
 */
import type { ProbeContext } from "./lib/probe";
import { runProbe } from "./lib/probe";
import { errMsg, freshness, newState, note, savedLabels, type SharedState } from "./lib/shared/context";
import { fetchSleeperState } from "./lib/shared/fetch";
import { expectedLabels } from "./lib/shared/labels";
import { pairTeamCodes, type TeamCodePairing } from "./lib/shared/nfl";
import { espnPosition } from "./lib/shared/projections";
import { pruneSanitized } from "./lib/shared/prune";
import { FC_FORMATS, fcQuery, runFantasyCalc } from "./lib/shared/section-fc";
import { runCrosswalk, runIdMap } from "./lib/shared/section-idmap";
import { runNfl } from "./lib/shared/section-nfl";
import { runEspnProjections, runSleeperProjections, runSleeperStats } from "./lib/shared/section-projections";
import { parseNflState } from "./lib/shared/weeks";

/** Run one section; a crash is recorded against its item instead of stopping the whole probe. */
async function section(p: ProbeContext, item: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n--- ${item}`);
  try {
    await fn();
  } catch (err) {
    p.cl.fail(item, `${item}.crash`, "Section crashed", errMsg(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
  }
}

/** Sleeper /state/nfl: season, week and season type (the week plan is fixed once the schedule is in). */
async function loadNflState(p: ProbeContext, state: SharedState): Promise<void> {
  try {
    const res = await p.timed("sleeper-state", () => fetchSleeperState());
    const parsed = res.ok && !res.isHtml ? parseNflState(res.json) : null;
    state.nflState = parsed;
    state.nflStateSource = parsed ? `HTTP ${res.status}, ${freshness(res, "10-min")}` : `HTTP ${res.status}${res.isHtml ? " (HTML)" : ""}: no season/week in the body`;
  } catch (err) {
    state.nflStateSource = `request failed: ${errMsg(err)}`;
  }
}

/** Sleeper id → nflverse team code, from ESPN's pool (proTeamId joined to nflverse through games). */
function referenceTeams(state: SharedState): Map<string, string> {
  const out = new Map<string, string>();
  for (const pl of state.espnPool ?? []) {
    const team = state.espnTeamToNflverse.get(pl.player?.proTeamId ?? -1);
    if (!team) continue;
    const sid = espnPosition(pl) === "D/ST" ? state.espnDefToSleeper.get(pl.player?.proTeamId ?? -1) : state.espnToSleeper.get(String(pl.id))?.sleeperId;
    if (sid) out.set(sid, team);
  }
  return out;
}

/** Team codes by source, paired with nflverse's (the set the NFL schedule uses) through shared players. */
function teamCodes(p: ProbeContext, state: SharedState): void {
  const ref = new Set(state.teamCodes.nflverse?.keys() ?? []);
  if (!ref.size) {
    p.cl.warn("XWALK", "XWALK.teamCodes", "NFL team codes by source", "nflverse codes unavailable; comparison skipped");
    return;
  }
  const teamOf = referenceTeams(state);
  const results: Record<string, TeamCodePairing> = {};
  for (const [source, codes] of Object.entries(state.teamCodes)) {
    if (source === "nflverse") continue;
    if (source === "ESPN") {
      // ESPN's own abbreviations are paired through the game join (NFL.teamMap), not through players.
      const pairs = Object.entries(state.espnCodeDiffs).map(([code, to]) => ({ code, to, support: 1, voters: 1 }));
      const paired = new Set(pairs.map((x) => x.code));
      results[source] = { same: [...codes.keys()].filter((c) => ref.has(c)).sort(), pairs, unpaired: [...codes.keys()].filter((c) => !ref.has(c) && !paired.has(c)).map((code) => ({ code, players: 0, voters: 0 })) };
      continue;
    }
    results[source] = pairTeamCodes(codes, ref, teamOf);
  }
  const unpaired = Object.entries(results).flatMap(([s, r]) => r.unpaired.map((u) => `${s} ${u.code} (${u.players} players, ${u.voters} in the reference)`));
  const describe = ([s, r]: [string, TeamCodePairing]) => `${s}: ${r.pairs.length ? r.pairs.map((x) => `${x.code}→${x.to}${s === "ESPN" ? "" : ` (${x.support}/${x.voters})`}`).join(", ") : "same codes"}`;
  (unpaired.length ? p.cl.warn : p.cl.ok).call(
    p.cl,
    "XWALK",
    "XWALK.teamCodes",
    "NFL team codes by source",
    `codes that differ from nflverse's ${ref.size}, paired through players both sources place on a team (reference: ESPN's pool, whose teams map to nflverse through the game join; "FA" and blanks are not teams; Sleeper DB limited to active players at fantasy positions): ${Object.entries(results).map(describe).join("; ")}${unpaired.length ? `. Unpaired: ${unpaired.join(", ")}` : ". Every code pairs"}`,
    note("nflverse codes", [...ref].sort()),
    note("reference players (Sleeper id → nflverse team)", teamOf.size),
    ...Object.entries(results).map(([s, r]) => note(s, { pairs: r.pairs, unpaired: r.unpaired, sameAsNflverse: r.same.length })),
  );
  if (Object.values(results).some((r) => r.pairs.length)) p.cl.question("Which NFL team-code set should be canonical in Phase 1: Sleeper's (it matches our canonical player IDs) or nflverse's (it matches the schedule)? The pairs in XWALK.teamCodes convert either way.");
}

void runProbe("shared", async (p) => {
  p.cl.meta.leagues = [{ label: "none (league-independent sources)", access: "public, no login, no cookies", source: "Sleeper state/projections/stats/players, FantasyCalc, DynastyProcess, nflverse, ESPN leaguedefaults/proTeams" }];
  const state = newState();
  const today = new Date().toISOString().slice(0, 10);
  await loadNflState(p, state);
  await section(p, "FC", () => runFantasyCalc(p, state));
  await section(p, "IDMAP", () => runIdMap(p, state));
  await section(p, "XWALK", () => runCrosswalk(p, state));
  await section(p, "NFL", () => runNfl(p, state, today));
  p.cl.meta.season = state.plan?.season ?? null;
  p.cl.meta.currentWeek = state.plan?.currentWeek ?? null;
  p.cl.meta.weekPlan = state.plan;
  await section(p, "PROJ-S", () => runSleeperProjections(p, state));
  await section(p, "STATS-S", () => runSleeperStats(p, state));
  await section(p, "PROJ-E", () => runEspnProjections(p, state));
  teamCodes(p, state);

  // ---- committed fixtures: drop the ones this plan no longer produces (dropped formats, past weeks)
  if (state.plan) {
    const expected = expectedLabels(state.plan, FC_FORMATS.map((f) => fcQuery(f.format)));
    const drift = [...savedLabels].filter((l) => !expected.has(l));
    if (drift.length) console.warn(`  ⚠️ fixture labels saved but not in labels.ts: ${drift.join("; ")}`);
    const pruned = await pruneSanitized("shared", new Set([...expected, ...savedLabels]));
    p.cl.meta.fixturesPruned = { removed: pruned.removedLabels, orphanFiles: pruned.orphanFiles.length, indexEntriesWithoutFile: pruned.missingFiles.length };
    if (pruned.removedLabels.length || pruned.orphanFiles.length || pruned.missingFiles.length) console.log(`    pruned sanitized fixtures: ${pruned.removedLabels.length} stale, ${pruned.orphanFiles.length} orphan files, ${pruned.missingFiles.length} index entries without a file`);
  }
});
