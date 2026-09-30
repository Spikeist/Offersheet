/**
 * NFL — the NFL schedule and bye weeks from nflverse games.csv and ESPN proTeamSchedules_wl
 * (CLAUDE.md §2.2, §2.9), cross-checked team by team, plus the current week (Sleeper /state/nfl
 * vs the schedule) that every week-dependent check uses. Schedules are cached for 7 days (§2.10).
 */
import type { ProbeContext } from "../probe";
import { addTeamCodes, errMsg, ev, freshness, note, saveFixture, saveRawSafe, type SharedState } from "./context";
import { fetchEspnProTeams, fetchNflGamesCsv, SLEEPER_STATE_URL } from "./fetch";
import { parseCsv } from "./idmap";
import { fixtureLabels } from "./labels";
import { byesFromGames, compareByes, deriveTeamMap, espnGames, espnNflTeams, gamesPerWeek, regularSeasonGames, type NflGame } from "./nfl";
import { sortNumericKeys } from "./util";
import { planWeeks, scheduleWeek, seasonFromDate } from "./weeks";

export async function runNfl(p: ProbeContext, state: SharedState, today: string): Promise<void> {
  const { cl } = p;
  const season = state.nflState?.season ?? seasonFromDate(today);

  // ---- nflverse
  let games: NflGame[] = [];
  let nflRes;
  try {
    nflRes = await p.timed("nfl", () => fetchNflGamesCsv());
    if (!nflRes.ok || nflRes.isHtml) throw new Error(`HTTP ${nflRes.status}`);
    const rows = parseCsv(nflRes.text);
    await saveRawSafe(p, "nflverse:games.csv", nflRes.text, nflRes, ".csv");
    games = regularSeasonGames(rows, season);
    const allTypes = [...new Set(rows.filter((r) => Number(r.season) === season).map((r) => r.game_type))];
    const perWeek = gamesPerWeek(games);
    const weeks = Object.keys(perWeek).map(Number).sort((a, b) => a - b);
    const teams = new Set(games.flatMap((g) => [g.home, g.away]));
    // A full season: every team plays one game in all but one week (17 games, 18 weeks for 32 teams).
    const expected = teams.size && weeks.length ? (teams.size * (weeks.length - 1)) / 2 : 0;
    (games.length > 0 && games.length === expected ? cl.ok : cl.warn).call(
      cl,
      "NFL",
      "NFL.games",
      `nflverse ${season} regular season`,
      `${games.length} REG games over weeks ${weeks[0]}–${weeks[weeks.length - 1]} for ${teams.size} teams (a full season with one bye each has ${expected}); ${season} game types present: ${allTypes.join(", ")}; ${games.filter((g) => g.espnId).length} games carry an ESPN event id`,
      ev(p, nflRes, `games.csv rows where season=${season} and game_type=REG`, sortNumericKeys(perWeek), freshness(nflRes, "7-day")),
      note("columns used", ["game_id", "season", "game_type", "week", "gameday", "gametime", "away_team", "home_team", "espn"]),
    );
    await saveFixture(
      p,
      fixtureLabels.nflGames(season),
      // camelCase keys: a bare "espn" key reads like a generic word to the commit-time leak check
      games.map((g) => ({ gameId: g.gameId, week: g.week, gameday: g.gameday, gametime: g.gametime, awayTeam: g.away, homeTeam: g.home, espnEventId: g.espnId })),
      nflRes,
    );
  } catch (err) {
    cl.fail("NFL", "NFL.games", `nflverse ${season} regular season`, `failed: ${errMsg(err)}`);
  }
  state.nflGames = games;
  const lastRegularWeek = games.length ? Math.max(...games.map((g) => g.week)) : null;
  const nflByes = byesFromGames(games, lastRegularWeek ?? 18);
  state.nflByes = nflByes;
  addTeamCodes(state, "nflverse", [...nflByes.keys()].map((code) => ({ code })));
  if (games.length) {
    const odd = [...nflByes].filter(([, w]) => w.length !== 1);
    const byWeek: Record<string, string[]> = {};
    for (const [team, w] of nflByes) for (const x of w) (byWeek[String(x)] ??= []).push(team);
    (!odd.length ? cl.ok : cl.warn).call(
      cl,
      "NFL",
      "NFL.byesNflverse",
      "Byes derived from nflverse",
      `${nflByes.size} teams; ${odd.length ? `${odd.length} teams without exactly one bye: ${odd.map(([t, w]) => `${t}=${w.join("/") || "none"}`).join(", ")}` : `each team has exactly one week (1–${lastRegularWeek}) without a game`}`,
      ev(p, nflRes, `weeks 1–${lastRegularWeek} with no game, per team`, sortNumericKeys(byWeek)),
    );
  }

  // ---- current week: Sleeper /state/nfl vs the schedule, then the week plan
  finalizePlan(p, state, today, games, lastRegularWeek);

  // ---- ESPN proTeamSchedules_wl
  let espnRes;
  try {
    espnRes = await p.timed("nfl", () => fetchEspnProTeams(season));
    if (!espnRes.ok || espnRes.isHtml || espnRes.json === undefined) throw new Error(`HTTP ${espnRes.status}${espnRes.isHtml ? " (HTML)" : ""}`);
    await saveRawSafe(p, "espn:proTeamSchedules_wl", espnRes.json, espnRes);
    await saveFixture(p, fixtureLabels.espnProTeams(season), espnRes.json, espnRes);
  } catch (err) {
    cl.fail("NFL", "NFL.espnByes", "ESPN proTeams byeWeek", `failed: ${errMsg(err)}`);
    return;
  }
  const maxWeek = lastRegularWeek ?? 18;
  const teams = espnNflTeams(espnRes.json);
  const rawTeams = ((espnRes.json as { settings?: { proTeams?: Array<{ id?: number; abbrev?: string }> } })?.settings?.proTeams ?? []).filter((t) => !teams.some((x) => x.id === t.id));
  state.espnTeams = teams;
  addTeamCodes(state, "ESPN", teams.map((t) => ({ code: t.abbrev })));
  const withBye = teams.filter((t) => typeof t.byeWeek === "number" && t.byeWeek >= 1 && t.byeWeek <= maxWeek);
  (teams.length === nflByes.size && withBye.length === teams.length && teams.length > 0 ? cl.ok : cl.warn).call(
    cl,
    "NFL",
    "NFL.espnByes",
    "ESPN proTeams byeWeek",
    `${teams.length} NFL teams (nflverse has ${nflByes.size}; dropped: ${rawTeams.map((t) => `"${t.abbrev ?? "?"}" id ${t.id}`).join(", ") || "none"}); ${withBye.length} have a byeWeek in 1–${maxWeek}`,
    ev(p, espnRes, "settings.proTeams[].byeWeek", Object.fromEntries(teams.map((t) => [t.abbrev, t.byeWeek])), freshness(espnRes, "7-day")),
    ev(p, espnRes, "settings.proTeams[].proGamesByScoringPeriod.{week}[] keys", [...new Set(teams.flatMap((t) => Object.values(t.proGamesByScoringPeriod ?? {}).flatMap((g) => (g ?? []).flatMap((x) => Object.keys(x)))))].sort()),
  );

  // ---- team map derived from ESPN event ids, then the bye cross-check
  const eg = espnGames(teams);
  const map = deriveTeamMap(teams, eg, games);
  state.espnTeamToNflverse = map.byEspnId;
  state.espnCodeDiffs = map.differing;
  const mapOk = map.conflicts.length === 0 && map.byEspnId.size === teams.length && map.mismatches.length === 0 && map.unjoinedEspnGames === 0;
  (mapOk ? cl.ok : cl.warn).call(
    cl,
    "NFL",
    "NFL.teamMap",
    "ESPN ↔ nflverse games and team codes",
    `${eg.length} ESPN games, ${map.joinedGames} joined to nflverse on the ESPN event id (${map.unjoinedEspnGames} not joined); ${map.byEspnId.size}/${teams.length} ESPN teams map to exactly one nflverse code${map.conflicts.length ? `, ${map.conflicts.length} conflicts` : ""}; ${map.mismatches.length} week/home/away mismatches. Codes that differ: ${JSON.stringify(map.differing)}`,
    ev(p, espnRes, "proGamesByScoringPeriod[].id = games.csv espn", { joined: map.joinedGames, mismatches: map.mismatches.slice(0, 5) }),
  );
  const byes = compareByes(teams, map.byEspnId, nflByes, maxWeek);
  const mismatched = byes.filter((b) => !b.match);
  (mismatched.length === 0 && byes.length === nflByes.size ? cl.ok : cl.fail).call(
    cl,
    "NFL",
    "NFL.byesMatch",
    "Bye weeks: ESPN vs nflverse",
    mismatched.length ? `${mismatched.length} teams disagree` : `all ${byes.length} teams agree (ESPN byeWeek = the one week missing from ESPN's own schedule = the nflverse-derived bye)`,
    ...(mismatched.length ? mismatched.slice(0, 8).map((b) => note(b.team, { espnBye: b.espnBye, espnSchedule: b.espnScheduleBye, nflverse: b.nflverseBye })) : [note("per team", Object.fromEntries(byes.map((b) => [b.team, b.espnBye])))]),
  );
  await saveFixture(p, fixtureLabels.nflByes(season), { season, source: "nflverse games.csv + ESPN proTeamSchedules_wl", espnToNflverse: Object.fromEntries([...map.byEspnId].map(([id, code]) => [String(id), code])), byes: Object.fromEntries(byes.map((b) => [b.team, b.espnBye])) });
  if (Object.keys(map.differing).length) cl.decision(`ESPN → nflverse team codes are derived by joining games on ESPN's event id, never hand-mapped (differences found: ${Object.entries(map.differing).map(([a, b]) => `${a}→${b}`).join(", ")}).`);
}

/** Cross-check Sleeper's current week with the schedule and fix the week plan for later sections. */
function finalizePlan(p: ProbeContext, state: SharedState, today: string, games: NflGame[], lastRegularWeek: number | null): void {
  const { cl } = p;
  const s = state.nflState;
  const sched = games.length ? scheduleWeek(games, today) : null;
  const last = lastRegularWeek ?? 18;
  const lastNote = lastRegularWeek === null ? "; last regular-season week assumed 18 (schedule unavailable)" : "";
  if (s) {
    const inSeason = s.seasonType === "regular";
    const agrees = sched !== null && inSeason && sched === s.week;
    state.plan = planWeeks(s, last, `Sleeper /state/nfl (${state.nflStateSource})`);
    (agrees ? cl.ok : cl.warn).call(
      cl,
      "NFL",
      "NFL.currentWeek",
      "Current week (Sleeper vs schedule)",
      `Sleeper: season ${s.season}, week ${s.week}, season_type "${s.seasonType}"${s.displayWeek !== undefined ? `, display_week ${s.displayWeek}` : ""}; nflverse: the first week with a game on or after ${today} is ${sched ?? "none"}${agrees ? " — they agree" : inSeason ? " — they differ" : " — not the regular season"}. Plan: current week ${state.plan.currentWeek}, completed ${state.plan.completedWeeks.length ? `1–${state.plan.completedWeeks.at(-1)}` : "none"}, sampled future weeks ${state.plan.futureWeeks.join(", ") || "none"}${lastNote}`,
      note("season, week, season_type, display_week", s, state.nflStateSource, SLEEPER_STATE_URL),
    );
    return;
  }
  if (sched !== null) {
    const season = seasonFromDate(today);
    state.plan = planWeeks({ season, week: sched, seasonType: "regular" }, last, "fallback: nflverse schedule (Sleeper /state/nfl unavailable)");
    cl.warn("NFL", "NFL.currentWeek", "Current week (Sleeper vs schedule)", `Sleeper /state/nfl unavailable (${state.nflStateSource}); using the schedule: week ${sched} of ${season} (first week with a game on or after ${today})${lastNote}`, note(undefined, undefined, state.nflStateSource, SLEEPER_STATE_URL));
    return;
  }
  cl.fail("NFL", "NFL.currentWeek", "Current week (Sleeper vs schedule)", `no current week: Sleeper /state/nfl unavailable (${state.nflStateSource}) and no schedule; week-dependent checks are skipped`, note(undefined, undefined, undefined, SLEEPER_STATE_URL));
}
