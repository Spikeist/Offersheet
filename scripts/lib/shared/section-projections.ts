/**
 * PROJ-S — Sleeper projections (undocumented, CLAUDE.md §2.3), STATS-S — Sleeper actual stats
 * (unverified endpoint), PROJ-E — ESPN league-independent projections (leaguedefaults/3,
 * view=kona_player_info, §2.2). All cached 6 h (§2.10). Weeks come from the week plan (Sleeper
 * /state/nfl), so a re-run next week checks next week's data.
 */
import type { Evidence } from "../checklist";
import type { HttpResult } from "../http";
import type { ProbeContext } from "../probe";
import { addTeamCodes, errMsg, ev, freshness, note, saveFixture, saveRawSafe, type SharedState } from "./context";
import { espnLeagueDefaultsUrl, espnPoolFilter, fetchEspnLeagueDefaults, fetchSleeperProjections, fetchSleeperStats, sleeperProjectionsUrl, sleeperStatsUrl } from "./fetch";
import { fixtureLabels } from "./labels";
import { teamsOnBye } from "./nfl";
import {
  asRows,
  byeRows,
  classifyEmptyEspn,
  compareRowSets,
  disagreement,
  espnPlayers,
  espnPosition,
  espnSeasonTotals,
  findEntry,
  fitEspnScoring,
  fitSleeperPts,
  flatnessByGroup,
  hasProjection,
  injuryTable,
  isEmptyEntry,
  NON_SCORING_KEY,
  rowPosition,
  scorableStats,
  sleeperStdScore,
  summarizeEspnPool,
  summarizeSleeper,
  topByPts,
  weekShapeSpread,
  type EspnPoolPlayer,
  type EspnStatEntry,
  type PositionGroup,
  type PtsFit,
  type SleeperStatRow,
} from "./projections";
import { countBy, pct, round, signed, sortCounts } from "./util";
import type { WeekPlan } from "./weeks";

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];
const OFFENSE = new Set(["QB", "RB", "WR", "TE"]);
/** CLAUDE.md §15 weekShapeClamp (the engine's config.ts doesn't exist yet in Phase 0). */
const WEEK_SHAPE_CLAMP: [number, number] = [0.8, 1.2];
/** cwendt94/espn-api commit the X-Fantasy-Filter was copied from (master on 2026-09-29). */
const ESPN_API_SOURCE = "cwendt94/espn-api@663d726 espn_api/requests/espn_requests.py get_player_pool_ids()";

/** Trimmed Sleeper rows for fixtures: top offense by pts_ppr plus a few K/DEF/IDP. */
function trimSleeper(rows: SleeperStatRow[], topOffense = 150): SleeperStatRow[] {
  const off = topByPts(rows, topOffense, (r) => OFFENSE.has(rowPosition(r)));
  const other = ["K", "DEF", "DL", "LB", "DB"].flatMap((pos) => topByPts(rows, 6, (r) => rowPosition(r) === pos));
  return [...off, ...other];
}

/** One row per player_id (position calls overlap for dual-eligible players). */
function dedupe(rows: SleeperStatRow[]): SleeperStatRow[] {
  const seen = new Map<string, SleeperStatRow>();
  for (const r of rows) if (!seen.has(r.player_id)) seen.set(r.player_id, r);
  return [...seen.values()];
}

async function getRows(p: ProbeContext, label: string, fetch: () => Promise<HttpResult>): Promise<{ rows: SleeperStatRow[] | null; res?: HttpResult; error?: string }> {
  try {
    const res = await p.timed("sleeper-projections", fetch);
    const rows = res.ok && !res.isHtml ? asRows(res.json) : null;
    await saveRawSafe(p, label, res.json ?? res.text, res);
    return { rows, res, error: rows ? undefined : `HTTP ${res.status}${res.isHtml ? " (HTML)" : ""}${res.ok && !rows ? " (not an array)" : ""}` };
  } catch (err) {
    return { rows: null, error: errMsg(err) };
  }
}

function fitEvidence(fits: PtsFit[]): Record<string, string> {
  return Object.fromEntries(fits.map((f) => [f.field, `${f.within005}/${f.compared} within 0.05, ${f.within01}/${f.compared} within 0.1${f.misfitKeys.length ? `; leftovers carry ${f.misfitKeys.join(", ")}` : ""}`]));
}

function requirePlan(p: ProbeContext, state: SharedState, item: string): WeekPlan | null {
  if (!state.plan) p.cl.fail(item, `${item}.plan`, "Week plan", "no current week (see NFL.currentWeek); skipped");
  return state.plan;
}

const groupText = (g: Partial<Record<PositionGroup, { both: number; identical: number }>>) =>
  (["QB/RB/WR/TE", "K", "DEF", "IDP"] as const)
    .filter((k) => g[k])
    .map((k) => `${k} ${g[k]?.identical}/${g[k]?.both}`)
    .join(", ");

export async function runSleeperProjections(p: ProbeContext, state: SharedState): Promise<void> {
  const { cl } = p;
  const plan = requirePlan(p, state, "PROJ-S");
  if (!plan) return;
  const { season, currentWeek: cw, futureWeeks } = plan;

  // ---- current week, one call per position
  const perPos: Record<string, SleeperStatRow[]> = {};
  const perPosEv: Evidence[] = [];
  let firstRes: HttpResult | undefined;
  for (const pos of POSITIONS) {
    const r = await getRows(p, `sleeper:projections:${season}:${cw}:${pos}`, () => fetchSleeperProjections(season, cw, [pos]));
    firstRes ??= r.res;
    if (r.rows) perPos[pos] = r.rows;
    perPosEv.push(
      r.rows
        ? ev(p, r.res, `[] (position=${pos})`, { rows: r.rows.length, projected: r.rows.filter((x) => hasProjection(x)).length, withPtsPpr: r.rows.filter((x) => typeof x.stats?.pts_ppr === "number").length }, freshness(r.res, "6 h"))
        : note(undefined, undefined, `${pos}: ${r.error}`, sleeperProjectionsUrl(season, cw, [pos])),
    );
  }
  const raw = Object.values(perPos).flat();
  const week = dedupe(raw);
  state.sleeperProj.set(cw, week);
  const callsPerPlayer = countBy(raw, (r) => r.player_id);
  const inTwoCalls = week.filter((r) => (callsPerPlayer[r.player_id] ?? 0) > 1);
  const inTwoCallsMultiFp = inTwoCalls.filter((r) => (r.player?.fantasy_positions ?? []).length > 1).length;
  const gotPos = Object.keys(perPos);
  const dbPositions = sortCounts(countBy(perPos.DB ?? [], (r) => `${r.player?.position}|${(r.player?.fantasy_positions ?? []).join("/")}`));
  const s = summarizeSleeper(week);
  const noPtsByPos = sortCounts(countBy(week.filter((r) => hasProjection(r) && typeof r.stats?.pts_ppr !== "number"), rowPosition));
  const db = state.sleeperDb ?? {};
  const weekIds = new Set(week.map((r) => r.player_id));
  const relevant = Object.values(db).filter((x) => x.active === true && ["QB", "RB", "WR", "TE", "K"].includes(String(x.position)) && x.team);
  const relevantWithRow = relevant.filter((x) => weekIds.has(x.player_id)).length;
  const lmMatches = s.statsWithoutLastModified === 0 && s.lastModifiedWithoutStats === 0;
  (gotPos.length === POSITIONS.length ? cl.ok : gotPos.length ? cl.warn : cl.fail).call(
    cl,
    "PROJ-S",
    "PROJ-S.currentWeek",
    `Week ${cw} projections by position`,
    `${gotPos.length}/${POSITIONS.length} positions returned arrays: ${POSITIONS.map((x) => `${x} ${perPos[x]?.length ?? "✗"}`).join(", ")}. ${raw.length} rows but ${week.length} distinct players: ${inTwoCalls.length} players come back from more than one call, ${inTwoCallsMultiFp} of them with several fantasy_positions (the filter matches fantasy_positions${inTwoCallsMultiFp === inTwoCalls.length ? "" : "; inferred"}) — dedupe by player_id. Rows cover ${relevantWithRow}/${relevant.length} active QB/RB/WR/TE/K on a team (players DB). ${s.withProjection} players carry a projection (scorable stats${lmMatches ? "; exactly the rows with last_modified" : `; last_modified differs on ${s.statsWithoutLastModified + s.lastModifiedWithoutStats} rows`}); pts_ppr is missing on ${s.projectedWithoutPts} of them (${Object.entries(noPtsByPos)
      .slice(0, 8)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ")}), so pts_* is not a projection flag: count projections by stat keys (IDP stats score nothing in Sleeper's default formats; inferred)`,
    ...perPosEv,
    note("position=DB rows by player.position|fantasy_positions", Object.fromEntries(Object.entries(dbPositions).slice(0, 6))),
  );
  if (!week.length) return;
  addTeamCodes(state, "Sleeper projections", week.filter((r) => ["QB", "RB", "WR", "TE", "K", "DEF"].includes(rowPosition(r))).map((r) => ({ code: r.team, sleeperId: r.player_id })));

  // ---- fields
  const offSummary = summarizeSleeper(week.filter((r) => OFFENSE.has(rowPosition(r))));
  const statKeys = Object.keys(s.statKeys).sort();
  cl.ok(
    "PROJ-S",
    "PROJ-S.fields",
    "Row fields and stat keys",
    `row keys: ${Object.keys(s.topLevelKeys).sort().join(", ")}; category "${Object.keys(s.categories).join("/")}", company "${Object.keys(s.companies).join("/")}". ${statKeys.length} distinct stats keys; projected rows ${s.withProjection}/${s.rows} (QB/RB/WR/TE: ${offSummary.withProjection}/${offSummary.rows}); pts_ppr on ${s.withPtsPpr}, pts_half_ppr ${s.withPtsHalfPpr}, pts_std ${s.withPtsStd}; an embedded player object on ${s.withPlayerObject}/${s.rows}`,
    ev(p, firstRes, "[] top-level keys (rows having each)", s.topLevelKeys),
    ev(p, firstRes, "[].stats keys", statKeys),
    ev(p, firstRes, "[].player keys", Object.keys(s.playerKeys).sort()),
    note("[].stats keys that aren't scorable stats (ranks, ADP, default-format points, participation)", statKeys.filter((k) => NON_SCORING_KEY.test(k)), "the scoring engine must only read keys that have a scoring rule"),
  );

  // ---- pts_* vs the standard formula on the same stats
  const projFits = fitSleeperPts(week.filter((r) => OFFENSE.has(rowPosition(r))));
  const pprFit = projFits[0];
  (pprFit && pprFit.within01 / Math.max(1, pprFit.compared) >= 0.97 ? cl.ok : cl.warn).call(
    cl,
    "PROJ-S",
    "PROJ-S.pts",
    "pts_* = standard scoring of the projected stats",
    pprFit ? `pts_ppr is reproduced by standard rules (INT −1, fumble lost −2, 1 per reception) within 0.1 on ${pprFit.within01}/${pprFit.compared} QB/RB/WR/TE (${pct(pprFit.within01, pprFit.compared)}), within 0.05 on ${pprFit.within005}. So pts_* are Sleeper's default scoring, not a league's; league points must come from stats × league rules (§5)` : "no rows with pts",
    note("fit per field", fitEvidence(projFits)),
  );

  // ---- multi-position form
  const multi = await getRows(p, `sleeper:projections:${season}:${cw}:multi:QB,RB`, () => fetchSleeperProjections(season, cw, ["QB", "RB"], true));
  let multiWorks = false;
  if (multi.rows) {
    const separate = [...(perPos.QB ?? []), ...(perPos.RB ?? [])];
    const c = compareRowSets(multi.rows, separate);
    multiWorks = c.onlyA === 0 && c.onlyB === 0 && c.unexplained === 0;
    (multiWorks ? cl.ok : cl.warn).call(
      cl,
      "PROJ-S",
      "PROJ-S.multi",
      "Multi-position query (position[]=QB&position[]=RB)",
      multiWorks
        ? `works: ${multi.rows.length} rows = the same ${c.both} players as the two single-position calls; ${c.sameStats} identical, ${c.updatedBetweenCalls} re-projected between the calls (different last_modified). So one call can fetch several positions; future weeks below use one ${POSITIONS.length}-position call each`
        : `differs from single calls: ${JSON.stringify(c)}; keep one call per position`,
      ev(p, multi.res, "[]", { rows: multi.rows.length, positions: countBy(multi.rows, rowPosition), comparison: c }),
    );
  } else cl.warn("PROJ-S", "PROJ-S.multi", "Multi-position query", `failed (${multi.error}); fall back to one call per position`, note(undefined, undefined, undefined, sleeperProjectionsUrl(season, cw, ["QB", "RB"], { multi: true })));

  // ---- future weeks (all positions in one call when the multi form works)
  const futureEv: Evidence[] = [];
  for (const w of futureWeeks) {
    let rows: SleeperStatRow[] = [];
    let res: HttpResult | undefined;
    let error: string | undefined;
    if (multiWorks) {
      const r = await getRows(p, `sleeper:projections:${season}:${w}:multi:${POSITIONS.join(",")}`, () => fetchSleeperProjections(season, w, POSITIONS, true));
      rows = r.rows ?? [];
      res = r.res;
      error = r.error;
    } else {
      for (const pos of POSITIONS) {
        const r = await getRows(p, `sleeper:projections:${season}:${w}:${pos}`, () => fetchSleeperProjections(season, w, [pos]));
        rows.push(...(r.rows ?? []));
        res ??= r.res;
        error ??= r.error;
      }
    }
    rows = dedupe(rows);
    state.sleeperProj.set(w, rows);
    futureEv.push(
      rows.length
        ? ev(p, res, `week ${w} []`, { players: rows.length, projected: rows.filter((x) => hasProjection(x)).length, withPtsPpr: rows.filter((x) => typeof x.stats?.pts_ppr === "number").length, defRows: rows.filter((x) => rowPosition(x) === "DEF").length })
        : note(undefined, undefined, `week ${w}: ${error ?? "no rows"}`, sleeperProjectionsUrl(season, w, POSITIONS, { multi: multiWorks })),
    );
  }
  const futureOk = futureWeeks.filter((w) => (state.sleeperProj.get(w)?.length ?? 0) > 0);
  (!futureWeeks.length ? cl.na : futureOk.length === futureWeeks.length ? cl.ok : futureOk.length ? cl.warn : cl.fail).call(
    cl,
    "PROJ-S",
    "PROJ-S.future",
    "Future-week projections",
    futureWeeks.length ? `weeks with rows: ${futureOk.join(", ") || "none"} of ${futureWeeks.join(", ")} (fetched ${multiWorks ? "with one multi-position call per week" : "one call per position"})` : "no regular-season weeks left after the current one",
    ...futureEv,
  );

  // ---- last_modified per week vs §2.3 ("far-future weeks were last modified in the preseason")
  const lm: Record<string, { players: number; withLastModified: number; days: string | null }> = {};
  for (const [w, rows] of [...state.sleeperProj].sort(([a], [b]) => a - b)) {
    const sw = summarizeSleeper(rows);
    const days = Object.keys(sw.lastModifiedByDay);
    lm[`week ${w}`] = { players: sw.rows, withLastModified: sw.lastModifiedPresent, days: days.length ? days.join(", ") : null };
  }
  const firstGameDay = state.nflGames.map((g) => g.gameday).filter(Boolean).sort()[0];
  const futureDays = futureOk.map((w) => ({ w, days: Object.keys(summarizeSleeper(state.sleeperProj.get(w) ?? []).lastModifiedByDay) }));
  const inSeasonFuture = firstGameDay ? futureDays.filter((x) => x.days.length && x.days.every((d) => d >= firstGameDay)) : [];
  const preseasonFuture = firstGameDay ? futureDays.filter((x) => x.days.length && x.days.every((d) => d < firstGameDay)) : [];
  const lmDeviation = inSeasonFuture.length > 0;
  (!futureOk.length || !firstGameDay ? cl.warn : lmDeviation ? cl.warn : cl.ok).call(
    cl,
    "PROJ-S",
    "PROJ-S.lastModified",
    "last_modified per week (§2.3)",
    `last_modified sits on ${lmMatches ? "exactly the projected rows" : "most projected rows"}, one UTC day per week: ${Object.entries(lm)
      .map(([k, v]) => `${k}: ${v.days ?? "none"}`)
      .join("; ")}. ${firstGameDay ? `Of the future weeks, ${inSeasonFuture.length}/${futureOk.length} are stamped in-season (on or after the first game, ${firstGameDay}) and ${preseasonFuture.length} in the preseason${lmDeviation ? " — §2.3 says far-future weeks were last modified in the preseason (August), which no longer holds" : ", as §2.3 says"}` : "no schedule to date the stamps"}. It's one batch stamp per week, so it dates Sleeper's last export of the week, not a re-projection of each number (inferred)`,
    note("[].last_modified (UTC day) per week", lm),
  );

  // ---- week shape: how much future weeks vary (§6 m) by position group
  const sampled = [cw, ...futureOk];
  const pairs = sampled.slice(1).map((b, i) => [sampled[i] as number, b] as const);
  const flat = pairs.map(([a, b]) => ({ pair: `${a}→${b}`, groups: flatnessByGroup(state.sleeperProj.get(a) ?? [], state.sleeperProj.get(b) ?? []) }));
  const futurePairs = flat.slice(1); // current→next differs anyway (the current week is projected in detail)
  const share = (g: PositionGroup, list: typeof flat) => list.map((x) => x.groups[g]).filter((v): v is { both: number; identical: number } => !!v && v.both > 0);
  const isFlat = (g: PositionGroup) => share(g, futurePairs).length > 0 && share(g, futurePairs).every((v) => v.identical / v.both >= 0.9);
  const varies = (g: PositionGroup) => share(g, flat).length > 0 && share(g, flat).every((v) => v.identical / v.both <= 0.2);
  const spread = weekShapeSpread(
    futureOk.map((w) => state.sleeperProj.get(w) ?? []),
    (r) => OFFENSE.has(rowPosition(r)),
    WEEK_SHAPE_CLAMP,
  );
  const flatGroups = (["K", "DEF", "IDP"] as const).filter(isFlat);
  const offVaries = varies("QB/RB/WR/TE");
  const star = topByPts(state.sleeperProj.get(futureOk[0] ?? -1) ?? [], 1, (r) => OFFENSE.has(rowPosition(r)))[0];
  const starLine = star
    ? `${String(star.player?.first_name ?? "")} ${String(star.player?.last_name ?? star.player_id)}: ${sampled.map((w) => {
        const r = state.sleeperProj.get(w)?.find((x) => x.player_id === star.player_id);
        return `w${w} ${r?.stats?.pts_ppr ?? "–"} vs ${r?.opponent ?? "–"}`;
      }).join(", ")}`
    : null;
  (futureOk.length < 2 ? cl.warn : offVaries ? cl.ok : cl.warn).call(
    cl,
    "PROJ-S",
    "PROJ-S.weekShape",
    "Week-to-week shape of future projections (§6 m)",
    futureOk.length < 2
      ? "fewer than two future weeks to compare"
      : `identical projected stat lines between consecutive sampled weeks — ${flat.map((x) => `${x.pair}: ${groupText(x.groups)}`).join("; ")}. QB/RB/WR/TE ${offVaries ? "vary week to week" : "are often flat"}: of ${spread.players} projected (pts_ppr > 0) in all of weeks ${futureOk.join(", ")}, ${spread.identicalAll} have the same pts_ppr every week (max/min median ${spread.medianMaxOverMin}, p90 ${spread.p90MaxOverMin}), and §6's m (clamp ${WEEK_SHAPE_CLAMP.join("–")}) would differ from 1 for ${spread.mNotOne}. ${flatGroups.length ? `${flatGroups.join(" and ")} future weeks are one flat per-player rate (m = 1)` : "no group is flat across future weeks"}${offVaries ? "; the variation follows the opponent (inferred; example below)" : ""}`,
    note("identical stat lines per group and week pair", Object.fromEntries(flat.map((x) => [x.pair, x.groups]))),
    note("QB/RB/WR/TE projected in every sampled future week (pts_ppr)", spread),
    ...(starLine ? [note("example: pts_ppr and opponent by week", starLine)] : []),
  );
  if (lmDeviation)
    cl.issue(
      `§2.3 says far-future Sleeper projections were last modified in the preseason (August) and are only good for their shape: live rows for weeks ${inSeasonFuture.map((x) => x.w).join(", ")} carry last_modified ${[...new Set(inSeasonFuture.flatMap((x) => x.days))].join("/")}${offVaries ? `, and QB/RB/WR/TE values change week to week (max/min median ${spread.medianMaxOverMin} over ${spread.players} players)` : ""}${flatGroups.length ? `, while ${flatGroups.join("/")} stay flat` : ""} — evidence: GET ${sleeperProjectionsUrl(season, futureOk[0] ?? cw + 1, POSITIONS, { multi: true })} HTTP 200, [].last_modified and [].stats — options: (a) keep §6 as written (base rate from the current week, shape from future weeks); (b) since future weeks are refreshed in-season, lean on them more (e.g. blend Sleeper's own week-w value into p(i,w)); (c) keep treating last_modified as a batch stamp and check content, as this probe does.`,
    );

  // ---- bye weeks
  const byeEv: Evidence[] = [];
  const byeProblems: string[] = [];
  const teamsTotal = state.nflByes?.size ?? 0;
  const byeWeeks = futureOk.filter((w) => state.nflByes && teamsOnBye(state.nflByes, w).length).slice(0, 2);
  for (const w of byeWeeks) {
    const byeTeams = state.nflByes ? teamsOnBye(state.nflByes, w) : [];
    const rows = state.sleeperProj.get(w) ?? [];
    const b = byeRows(rows, byeTeams);
    const defTotal = rows.filter((r) => rowPosition(r) === "DEF").length;
    const sample = b.sample ? { player_id: b.sample.player_id, team: b.sample.team, opponent: b.sample.opponent ?? null, game_id: b.sample.game_id ?? null, stats: b.sample.stats } : null;
    if (!b.rows) byeProblems.push(`week ${w}: no rows for bye teams`);
    if (b.withProjection) byeProblems.push(`week ${w}: ${b.withProjection} bye rows carry a projection`);
    if (b.nullOpponent !== b.rows || b.nullGameId !== b.rows) byeProblems.push(`week ${w}: opponent/game_id set on some bye rows`);
    if (b.defRows) byeProblems.push(`week ${w}: ${b.defRows} DEF rows for bye teams`);
    if (teamsTotal && defTotal !== teamsTotal - byeTeams.length) byeProblems.push(`week ${w}: ${defTotal} DEF rows, expected ${teamsTotal - byeTeams.length}`);
    byeEv.push(note(`week ${w}, teams on bye [${byeTeams.join(", ")}]`, { playerRows: b.rows, noScorableStats: b.onlyNonScoringStats, withProjection: b.withProjection, withPtsPpr: b.withPts, nullOpponent: b.nullOpponent, nullGameId: b.nullGameId, defRowsForByeTeams: b.defRows, defRowsThatWeek: defTotal, expectedDefRows: teamsTotal - byeTeams.length, sample }));
  }
  (!byeWeeks.length ? cl.warn : byeProblems.length ? cl.warn : cl.ok).call(
    cl,
    "PROJ-S",
    "PROJ-S.bye",
    "How bye-week players appear",
    !byeWeeks.length
      ? "no sampled future week with teams on bye (or no schedule)"
      : byeProblems.length
        ? `unexpected: ${byeProblems.join("; ")}`
        : `in weeks ${byeWeeks.join(" and ")}, players on bye keep a row (opponent and game_id null, no scorable stats, no pts_*) and team defenses on bye have no row (DEF rows = ${teamsTotal} − teams on bye). Treat a missing projection as 0 for that week`,
    ...byeEv,
  );

  // ---- injured players: how Sleeper's projections treat them (relevance-controlled)
  const nextW = futureOk[0];
  const laterW = futureOk.slice(1, 3);
  const players = Object.values(db)
    .filter((x) => OFFENSE.has(String(x.position)) && x.active === true && x.team)
    .map((x) => ({ id: x.player_id, status: x.injury_status ? String(x.injury_status) : "healthy" }));
  if (!players.length || nextW === undefined || !laterW.length) {
    cl.warn("PROJ-S", "PROJ-S.injuries", "Injured players in Sleeper projections", `no data: ${!players.length ? "Sleeper players DB unavailable" : "not enough future weeks"}`);
  } else {
    const byId = (w: number) => new Map((state.sleeperProj.get(w) ?? []).map((r) => [r.player_id, r]));
    const table = injuryTable(players, byId(cw), byId(nextW), laterW.map(byId));
    const shareNow = (k: string) => {
      const b = table[k];
      return b && b.projectedLater ? b.projectedLaterAndNow / b.projectedLater : null;
    };
    const order = Object.entries(table).sort(([, a], [, b]) => b.players - a.players);
    const rel = order.filter(([, b]) => b.projectedLater >= 3);
    // Bands on the share projected now (among players projected later): < 10% unprojected, ≥ 80% projected.
    const zeroed = rel.filter(([k]) => (shareNow(k) ?? 1) < 0.1).map(([k]) => k);
    const partly = rel.filter(([k]) => (shareNow(k) ?? 1) >= 0.1 && (shareNow(k) ?? 1) < 0.8).map(([k]) => `${k} (${pct(table[k]?.projectedLaterAndNow ?? 0, table[k]?.projectedLater ?? 0, 0)})`);
    const projected = rel.filter(([k]) => (shareNow(k) ?? 0) >= 0.8).map(([k]) => k);
    const ratio = (k: string) => (table[k]?.medianNextOverLater ?? "–").toString();
    cl.warn(
      "PROJ-S",
      "PROJ-S.injuries",
      "Injured players in Sleeper projections",
      `active QB/RB/WR/TE on a team, by Sleeper injury_status; every one keeps a row, only the projection is missing. Among those Sleeper projects in week ${laterW.join(" or ")} (the relevance control), projected in week ${cw}: ${rel.map(([k, b]) => `${k} ${b.projectedLaterAndNow}/${b.projectedLater}`).join(", ")}. So the current week is left unprojected for ${zeroed.join(", ") || "no status"}${partly.length ? `, partly for ${partly.join(", ")}` : ""}${projected.length ? `, and projected for ${projected.join(", ")}` : ""}. Week ${nextW} vs later weeks (median ratio of pts_ppr): ${rel.map(([k]) => `${k} ${ratio(k)}`).join(", ")} — next-week values are ${rel.every(([k]) => (table[k]?.medianNextOverLater ?? 1) >= 0.9) ? "near normal" : "reduced for some statuses"} once a player is projected again. Small groups; interpretation inferred`,
      note("injury_status → players, projected now/next, projected later (and of those, now), median next÷later", table, "joined on player_id; injury_status from https://api.sleeper.app/v1/players/nfl"),
    );
    cl.issue(
      `Projections vs injuries (§6): Sleeper leaves the current week unprojected for ${zeroed.join("/") || "no status"}${partly.length ? ` and part of ${partly.map((x) => x.split(" ")[0]).join("/")}` : ""}, then projects the player again in a later week (PROJ-S.injuries). §6 step 1 already takes b(i) from the next projected week, and next-week values are ${rel.every(([k]) => (table[k]?.medianNextOverLater ?? 1) >= 0.9) ? "near normal" : "partly reduced"} (median week-${nextW}÷later: ${rel.map(([k]) => `${k} ${ratio(k)}`).join(", ")}), so the overlap is the timing: §6's fixed availability ramp (OUT 0/0.5/0.85; IR 0 for 4 weeks) ignores Sleeper's own return week — options: (a) use the first future week Sleeper projects as injuryReturnWeek when the platform gives none, (b) keep §6's fixed ramp, (c) set m = 1 in weeks where a(i,w) < 1.`,
    );
  }

  // ---- K / DEF / IDP
  const kdi = ["K", "DEF", "DL", "LB", "DB"].map((pos) => {
    const rows = perPos[pos] ?? [];
    const keys = Object.keys(summarizeSleeper(rows).statKeys).sort();
    const projectedRows = rows.filter((r) => hasProjection(r));
    const idpKeyShare = projectedRows.length ? projectedRows.filter((r) => scorableStats(r).every(([k]) => k.startsWith("idp_"))).length : 0;
    return { pos, rows: rows.length, projected: projectedRows.length, pts: rows.filter((r) => typeof r.stats?.pts_ppr === "number").length, keys: keys.slice(0, 30), idpOnly: idpKeyShare };
  });
  const defRows = perPos.DEF ?? [];
  const defIdIsTeam = defRows.filter((r) => r.player_id === r.team).length;
  const idp = kdi.filter((x) => ["DL", "LB", "DB"].includes(x.pos));
  cl.ok(
    "PROJ-S",
    "PROJ-S.kdefidp",
    "K, DEF and IDP projections",
    `${kdi.map((x) => `${x.pos}: ${x.rows} rows, ${x.projected} projected, pts_ppr on ${x.pts}`).join("; ")}. IDP: pts_* is missing on ${idp.reduce((a, x) => a + x.projected - x.pts, 0)} projected rows, so count projections by stat keys; ${idp.reduce((a, x) => a + x.idpOnly, 0)}/${idp.reduce((a, x) => a + x.projected, 0)} projected IDP rows use only idp_* scorable keys. DEF player_id equals the team code on ${defIdIsTeam}/${defRows.length} rows (e.g. ${defRows
      .slice(0, 4)
      .map((r) => r.player_id)
      .join(", ")})`,
    ...kdi.map((x) => note(`[].stats keys (${x.pos})`, x.keys)),
  );

  // ---- season projections
  const seasonRows = await getRows(p, `sleeper:projections:${season}:season:QB`, () => fetchSleeperProjections(season, null, ["QB"]));
  if (seasonRows.rows) {
    const ss = summarizeSleeper(seasonRows.rows);
    const top = topByPts(seasonRows.rows, 3).map((r) => `${String(r.player?.first_name ?? "")} ${String(r.player?.last_name ?? r.player_id)}: ${r.stats?.pts_ppr}`);
    const noWeek = Object.keys(ss.weeks).every((k) => k === "(none)" || k === "null");
    (noWeek ? cl.ok : cl.warn).call(cl, "PROJ-S", "PROJ-S.season", "Season projections", `HTTP ${seasonRows.res?.status}: ${ss.rows} QB rows, week field ${noWeek ? "empty on every row" : `present (${JSON.stringify(ss.weeks)})`}; projected ${ss.withProjection}, pts_ppr on ${ss.withPtsPpr}; ${Object.keys(ss.statKeys).length} stats keys`, ev(p, seasonRows.res, "[].stats.pts_ppr (top 3)", top));
    await saveFixture(p, fixtureLabels.sleeperProjSeason(season), topByPts(seasonRows.rows, 40), seasonRows.res);
  } else cl.fail("PROJ-S", "PROJ-S.season", "Season projections", `failed: ${seasonRows.error}`, note(undefined, undefined, undefined, sleeperProjectionsUrl(season, null, ["QB"])));

  // ---- fixtures
  for (const [w, rows] of state.sleeperProj) if (rows.length) await saveFixture(p, fixtureLabels.sleeperProjWeek(season, w), trimSleeper(rows));
}

export async function runSleeperStats(p: ProbeContext, state: SharedState): Promise<void> {
  const { cl } = p;
  const plan = requirePlan(p, state, "STATS-S");
  if (!plan) return;
  const { season, statsWeeks, currentWeek: cw } = plan;
  if (!statsWeeks.length) {
    cl.na("STATS-S", "STATS-S.weeks", "Actual stats", `no completed regular-season week yet (current week ${cw}); untested`);
    return;
  }
  const byWeek = new Map<number, SleeperStatRow[]>();
  const weekEv: Evidence[] = [];
  let lastRes: HttpResult | undefined;
  const snaps = (r: SleeperStatRow) => ["off_snp", "def_snp", "st_snp"].some((k) => (r.stats?.[k] ?? 0) > 0);
  const shape: Record<string, { rows: number; gmsActive: number; withSnaps: number; played: number; noScorable: number }> = {};
  for (const w of statsWeeks) {
    const r = await getRows(p, `sleeper:stats:${season}:${w}`, () => fetchSleeperStats(season, w));
    lastRes = r.res ?? lastRes;
    if (r.rows) {
      byWeek.set(w, r.rows);
      shape[`week ${w}`] = {
        rows: r.rows.length,
        gmsActive: r.rows.filter((x) => (x.stats?.gms_active ?? 0) > 0).length,
        withSnaps: r.rows.filter(snaps).length,
        played: r.rows.filter((x) => (x.stats?.gp ?? 0) > 0).length,
        noScorable: r.rows.filter((x) => scorableStats(x).length === 0).length,
      };
    }
    weekEv.push(
      r.rows
        ? ev(p, r.res, `week ${w} []`, { rows: r.rows.length, positions: Object.fromEntries(Object.entries(sortCounts(countBy(r.rows, rowPosition))).slice(0, 12)) }, freshness(r.res, "6 h"))
        : note(undefined, undefined, `week ${w}: ${r.error}`, sleeperStatsUrl(season, w)),
    );
  }
  const shapes = Object.values(shape);
  const mostlyActive = shapes.length > 0 && shapes.every((x) => x.gmsActive >= 0.95 * x.rows);
  (byWeek.size === statsWeeks.length ? cl.ok : byWeek.size ? cl.warn : cl.fail).call(
    cl,
    "STATS-S",
    "STATS-S.weeks",
    `Actual stats, weeks ${statsWeeks.join(", ")}`,
    `${byWeek.size}/${statsWeeks.length} weeks returned arrays (undocumented endpoint; works without a position filter). Rows are not only players who played: ${Object.entries(shape)
      .map(([k, v]) => `${k} ${v.rows} rows, ${v.gmsActive} with gms_active, ${v.withSnaps} with snaps, ${v.played} with gp > 0, ${v.noScorable} with no scorable stat`)
      .join("; ")}${mostlyActive ? " — so the rows are essentially the players active on game day, with or without snaps (inferred from gms_active)" : ""}`,
    ...weekEv,
    note("rows per week: total / gms_active / any snaps / gp > 0 / no scorable stat", shape),
  );
  if (!byWeek.size) {
    cl.issue(`Sleeper stats endpoint failed for weeks ${statsWeeks.join(", ")} — options: nflverse weekly player stats for the scoring oracle (§5).`);
    return;
  }
  const all = [...byWeek.values()].flat();
  const off = all.filter((r) => OFFENSE.has(rowPosition(r)));
  const so = summarizeSleeper(off);
  const sa = summarizeSleeper(all);
  const statKeys = Object.keys(so.statKeys).sort();
  const projKeys = new Set(Object.keys(summarizeSleeper((state.sleeperProj.get(cw) ?? []).filter((r) => OFFENSE.has(rowPosition(r)))).statKeys));
  const onlyInProj = [...projKeys].filter((k) => !so.statKeys[k] && !NON_SCORING_KEY.test(k)).sort();
  const played = off.filter((r) => (r.stats?.gp ?? 0) > 0);
  const bonusKeys = statKeys.filter((k) => /^bonus_/.test(k));
  const fdKeys = statKeys.filter((k) => /_fd$|^bonus_fd_/.test(k));
  const projSummary = summarizeSleeper(state.sleeperProj.get(cw) ?? []);
  const statsTop = Object.keys(sa.topLevelKeys).sort();
  const projTop = Object.keys(projSummary.topLevelKeys).sort();
  const onlyStatsTop = statsTop.filter((k) => !projTop.includes(k));
  const onlyProjTop = projTop.filter((k) => !statsTop.includes(k));
  cl.ok(
    "STATS-S",
    "STATS-S.fields",
    "Stat keys",
    `category "${Object.keys(sa.categories).join("/")}", company "${Object.keys(sa.companies).join("/")}" (week-${cw} projections: "${Object.keys(projSummary.categories).join("/")}", "${Object.keys(projSummary.companies).join("/")}"); row keys ${onlyStatsTop.length || onlyProjTop.length ? `differ from projections (only here: ${onlyStatsTop.join(", ") || "–"}; only in projections: ${onlyProjTop.join(", ") || "–"})` : "are the same as the projections'"}. QB/RB/WR/TE rows in weeks ${statsWeeks.join(", ")}: ${so.rows} (gp > 0: ${played.length}); ${statKeys.length} distinct stat keys, incl. ${bonusKeys.length} bonus_* and ${fdKeys.length} first-down keys`,
    ev(p, lastRes, `[].stats keys (QB/RB/WR/TE, weeks ${statsWeeks.join(", ")})`, statKeys),
    note(`keys in week-${cw} projections that never occur in these actual stats (QB/RB/WR/TE)`, onlyInProj),
  );

  // ---- pts_* vs the standard formula; zero points are omitted
  const fits = fitSleeperPts(off);
  const f = fits[0];
  const noPts = played.filter((r) => typeof r.stats?.pts_ppr !== "number");
  const noPtsZero = noPts.filter((r) => Math.abs(sleeperStdScore(r.stats ?? {}, 1)) < 1e-9).length;
  const zeroPts = off.filter((r) => r.stats?.pts_ppr === 0).length;
  const negOnly = noPts.filter((r) => typeof r.stats?.pts_std === "number");
  (f && f.within005 / Math.max(1, f.compared) >= 0.99 ? cl.ok : cl.warn).call(
    cl,
    "STATS-S",
    "STATS-S.pts",
    "pts_* on actual stats",
    f
      ? `pts_ppr = standard rules (INT −1) on the same stats within 0.05 for ${f.within005}/${f.compared} QB/RB/WR/TE rows (${pct(f.within005, f.compared)}); leftover keys: ${f.misfitKeys.slice(0, 4).join(", ") || "none"}. pts_* keys are omitted when the value is 0: ${noPts.length} of ${played.length} players who played have no pts_ppr and the standard formula gives 0 for ${noPtsZero} of them; ${zeroPts} rows have pts_ppr = 0; ${negOnly.length} of the rows without pts_ppr still have pts_std/pts_half_ppr (non-zero in those formats). Treat a missing pts_* or stat key as 0`
      : "no rows with pts",
    note("fit per field", fitEvidence(fits)),
    note("row with pts_std but no pts_ppr (sample stats)", negOnly[0]?.stats ?? null),
  );

  // ---- position filters (on the latest stats week)
  const lw = statsWeeks[statsWeeks.length - 1] as number;
  const pf = await getRows(p, `sleeper:stats:${season}:${lw}:QB`, () => fetchSleeperStats(season, lw, ["QB"]));
  const pm = await getRows(p, `sleeper:stats:${season}:${lw}:multi:QB,RB`, () => fetchSleeperStats(season, lw, ["QB", "RB"], true));
  const pos = (rows: SleeperStatRow[] | null) => (rows ? countBy(rows, rowPosition) : null);
  const qbOnly = !!pf.rows && Object.keys(pos(pf.rows) ?? {}).every((k) => k === "QB");
  const multiHas = !!pm.rows && ["QB", "RB"].every((k) => (pos(pm.rows) ?? {})[k]);
  const extras = (pm.rows ?? []).filter((r) => !["QB", "RB"].includes(rowPosition(r)));
  const extrasFp = extras.filter((r) => (r.player?.fantasy_positions ?? []).some((f) => f === "QB" || f === "RB")).length;
  (qbOnly && multiHas ? cl.ok : cl.warn).call(
    cl,
    "STATS-S",
    "STATS-S.position",
    "Position filters",
    `week ${lw}: position=QB → ${pf.rows ? `${pf.rows.length} rows${qbOnly ? " (QB only)" : ` ${JSON.stringify(pos(pf.rows))}`}` : pf.error}; position[]=QB&position[]=RB → ${pm.rows ? `${pm.rows.length} rows ${JSON.stringify(pos(pm.rows))}` : pm.error}${extras.length ? ` — the ${extras.length} other-position rows list QB or RB in fantasy_positions on ${extrasFp}, so the filter matches fantasy_positions` : ""}; unfiltered → ${byWeek.get(lw)?.length ?? "?"} rows`,
    ev(p, pf.res, "[] (position=QB)", pos(pf.rows)),
    ev(p, pm.res, "[] (position[]=QB&position[]=RB)", pos(pm.rows)),
  );
  const dupes = [...byWeek].map(([w, rows]) => ({ week: w, duplicates: rows.length - new Set(rows.map((r) => r.player_id)).size }));
  (dupes.every((d) => d.duplicates === 0) ? cl.ok : cl.warn).call(cl, "STATS-S", "STATS-S.unique", "One row per player per week", dupes.map((d) => `week ${d.week}: ${d.duplicates} duplicate player_ids`).join("; "), note("[].player_id", dupes));

  for (const [w, rows] of byWeek) await saveFixture(p, fixtureLabels.sleeperStatsWeek(season, w), trimSleeper(rows));
}

/** Trim an ESPN pool player for fixtures: core fields and the stat entries tests need. */
function trimEspn(pl: EspnPoolPlayer, plan: WeekPlan): EspnPoolPlayer {
  const x = pl.player ?? {};
  const projectedWeeks = [plan.currentWeek, ...plan.futureWeeks.slice(0, 3)];
  const keep = (s: EspnStatEntry) =>
    s.seasonId === plan.season &&
    ((s.statSplitTypeId === 0 && s.scoringPeriodId === 0) ||
      (s.statSourceId === 1 && s.statSplitTypeId === 1 && projectedWeeks.includes(s.scoringPeriodId ?? -1)) ||
      (s.statSourceId === 0 && s.statSplitTypeId === 1 && plan.completedWeeks.includes(s.scoringPeriodId ?? -1)));
  return {
    id: pl.id,
    status: pl.status,
    onTeamId: pl.onTeamId,
    player: {
      id: x.id,
      fullName: x.fullName,
      defaultPositionId: x.defaultPositionId,
      eligibleSlots: x.eligibleSlots,
      proTeamId: x.proTeamId,
      injuryStatus: x.injuryStatus,
      injured: x.injured,
      active: x.active,
      ownership: x.ownership ? { percentOwned: x.ownership.percentOwned } : undefined,
      stats: (x.stats ?? []).filter(keep),
    },
  };
}

export async function runEspnProjections(p: ProbeContext, state: SharedState): Promise<void> {
  const { cl } = p;
  const plan = requirePlan(p, state, "PROJ-E");
  if (!plan) return;
  const { season, currentWeek: cw, lastRegularWeek: last } = plan;
  const filter = espnPoolFilter(500);

  // ---- default page size (no filter) vs the copied filter
  let defaultCount: number | null = null;
  let defaultRes: HttpResult | undefined;
  try {
    defaultRes = await p.timed("espn-projections", () => fetchEspnLeagueDefaults(season, cw, null));
    defaultCount = espnPlayers(defaultRes.json)?.length ?? null;
    await saveRawSafe(p, `espn:leaguedefaults:${cw}:nofilter`, defaultRes.json ?? defaultRes.text, defaultRes);
  } catch (err) {
    cl.warn("PROJ-E", "PROJ-E.default", "Without a filter", `failed: ${errMsg(err)}`);
  }
  let res: HttpResult;
  let players: EspnPoolPlayer[];
  try {
    res = await p.timed("espn-projections", () => fetchEspnLeagueDefaults(season, cw, filter));
    if (!res.ok || res.isHtml) throw new Error(`HTTP ${res.status}${res.isHtml ? " (HTML login page)" : ""}`);
    const list = espnPlayers(res.json);
    if (!list) throw new Error("players[] missing");
    players = list;
    state.espnPool = players;
    await saveRawSafe(p, `espn:leaguedefaults:${cw}:pool500`, res.json, res);
  } catch (err) {
    cl.fail("PROJ-E", "PROJ-E.filter", "Player pool with X-Fantasy-Filter", `failed: ${errMsg(err)}`, note(undefined, undefined, undefined, espnLeagueDefaultsUrl(season, cw)));
    return;
  }
  const sum = summarizeEspnPool(players, season);
  cl.ok(
    "PROJ-E",
    "PROJ-E.filter",
    "Player pool with X-Fantasy-Filter",
    `no filter → ${defaultCount ?? "?"} players; with the copied filter (limit 500) → ${players.length} players, ${Math.round(res.text.length / 1048576)} MB (~${Math.round(res.text.length / 1024 / Math.max(1, players.length))} KB per player). No cookies needed; player status in league defaults: ${JSON.stringify(sum.statuses)}`,
    ev(p, defaultRes, "players[] (no X-Fantasy-Filter)", defaultCount),
    ev(p, res, "players[] (with filter)", { players: players.length, positions: sortCounts(sum.byPosition) }, freshness(res, "6 h")),
    note("X-Fantasy-Filter", JSON.parse(filter), `copied from ${ESPN_API_SOURCE}`),
  );

  // ---- current-week projections and the other weeks inside the same response
  const wk = players.map((pl) => ({ pl, e: findEntry(pl, 1, 1, season, cw) }));
  const withEntry = wk.filter((x) => x.e);
  const nonEmpty = withEntry.filter((x) => !isEmptyEntry(x.e));
  const sampleW = nonEmpty.slice(0, 3).map((x) => `${x.pl.player?.fullName} (${espnPosition(x.pl)}): appliedTotal ${round(x.e?.appliedTotal ?? NaN, 2)}, ${Object.keys(x.e?.stats ?? {}).length} stat ids`);
  (nonEmpty.length >= players.length * 0.7 ? cl.ok : cl.warn).call(
    cl,
    "PROJ-E",
    "PROJ-E.currentWeek",
    `Week ${cw} projections (statSourceId 1)`,
    `${withEntry.length}/${players.length} players have a {statSourceId 1, statSplitTypeId 1, seasonId ${season}, scoringPeriodId ${cw}} entry; ${nonEmpty.length} of them carry stats (statId → value) and appliedTotal, ${withEntry.length - nonEmpty.length} are empty (not projected; see PROJ-E.empty). appliedTotal is on ${sum.withAppliedTotal}/${sum.entries} stat entries`,
    ev(p, res, `players[].player.stats[] where statSourceId=1, statSplitTypeId=1, scoringPeriodId=${cw}`, sampleW),
    ev(p, res, 'players[].player.stats[] kinds "statSourceId/statSplitTypeId/seasonId"', sum.entryKinds, `avg ${sum.avgEntriesPerPlayer} entries per player`),
  );
  const range = (o: Record<string, number>) => {
    const reg = Object.entries(o).filter(([w]) => Number(w) >= 1 && Number(w) <= last);
    const counts = reg.map(([, n]) => n);
    return { weeks: reg.length, min: counts.length ? Math.min(...counts) : 0, max: counts.length ? Math.max(...counts) : 0, extra: Object.entries(o).filter(([w]) => Number(w) < 1 || Number(w) > last) };
  };
  const cur = range(sum.projectedWeeks);
  const prev = range(sum.projectedWeeksPrev);
  const actualPeriods = Object.keys(sum.actualWeeks).map(Number);
  const actualOk = plan.completedWeeks.every((w) => actualPeriods.includes(w));
  (cur.weeks === last && actualOk ? cl.ok : cl.warn).call(
    cl,
    "PROJ-E",
    "PROJ-E.allWeeks",
    "All weekly projections in one response",
    `one scoringPeriodId=${cw} response holds projected single-week ${season} entries for ${cur.weeks}/${last} scoring periods 1–${last} (${cur.min}–${cur.max} players each), ${season - 1} projections for ${prev.weeks} periods (${prev.min}–${prev.max} players), and actual single-week ${season} entries for periods ${actualPeriods.join(", ") || "none"} (completed weeks: ${plan.completedWeeks.join(", ") || "none"}). A few players also have periods ${cur.extra.map(([w, n]) => `${w} (${n})`).join(", ") || "none"} outside 1–${last}: meaning unverified, ignore them`,
    ev(p, res, `players[].player.stats[] statSourceId=1, statSplitTypeId=1, seasonId=${season}: players per scoringPeriodId`, sum.projectedWeeks),
    ev(p, res, `players[].player.stats[] statSourceId=0, statSplitTypeId=1, seasonId=${season}: players per scoringPeriodId`, sum.actualWeeks),
  );

  // ---- statSplitTypeId 0 / 2 totals vs weekly sums (§2.2 says 0 = season)
  const tot = espnSeasonTotals(players, season, cw, last);
  const p0 = tot.projected0;
  const a0 = tot.actual0;
  const p2 = tot.projected2;
  const rosIsSplit0 = p0.compared > 0 && (p0.matches.restOfSeason ?? 0) / p0.compared >= 0.95;
  const split2Unexplained = p2.compared > 0 && Object.values(p2.matches).every((n) => n / p2.compared < 0.5);
  cl.warn(
    "PROJ-E",
    "PROJ-E.seasonTotals",
    "statSplitTypeId 0 / 2 totals",
    `projected split 0 (1/0/${season}) = the sum of weekly projections for weeks ${cw}–${last} (rest of season) on ${p0.matches.restOfSeason}/${p0.compared} non-D/ST players, vs the full season 1–${last} on ${p0.matches.fullSeason} (D/ST left out: ${p0.excluded}, of which ${p0.excludedMatches ?? 0} match either sum — points-allowed tiers make their weekly totals non-additive, inferred)${rosIsSplit0 ? " — so it is a rest-of-season total, not a season total" : ""}. Actual split 0 (0/0/${season}) = the sum of actual weeks 1–${cw - 1} on ${a0.matches.completedWeeks}/${a0.compared} (season to date). statSplitTypeId 2: ${p2.compared} projected entries (scoringPeriodId ${Object.keys(p2.periods).join("/") || "–"}) match rest of season on ${p2.matches.restOfSeason}, weeks ${cw + 1}–${last} on ${p2.matches.afterCurrentWeek}, actual + rest of season on ${p2.matches.actualPlusRestOfSeason}, projected split 0 on ${p2.matches.projectedSplit0}${split2Unexplained ? " — meaning unknown; ignore split 2" : ""} (all within 0.05)`,
    note("projected split 0 vs weekly sums", p0),
    note("actual split 0 vs weekly sums", a0),
    note("projected split 2 vs candidate sums", p2),
  );
  if (rosIsSplit0)
    cl.issue(
      `§2.2 says statSplitTypeId 0 = season: for current-season projected entries (statSourceId 1) it is the rest-of-season total (weeks ${cw}–${last}; ${p0.matches.restOfSeason}/${p0.compared} players), while actual entries (statSourceId 0) are season-to-date; statSplitTypeId 2 (${p2.compared} entries) matches no weekly sum — evidence: GET ${espnLeagueDefaultsUrl(season, cw)} HTTP ${res.status}, players[].player.stats[] (statSourceId/statSplitTypeId/seasonId) — options: (a) read projected split 0 as rest-of-season and compute any full-season total from weekly entries, (b) ignore split 0/2 and always sum weekly entries.`,
    );

  // ---- scoringPeriodId of the next sampled weeks (small pages: the full pool is ~16 MB)
  const small = espnPoolFilter(50);
  const periodEv: Evidence[] = [];
  const probeWeeks = plan.futureWeeks.slice(0, 3);
  let periodsOk = 0;
  let sameTotal = 0;
  let comparedTotal = 0;
  let allPeriodsEach = true;
  const byId = new Map(players.map((pl) => [pl.id, pl]));
  for (const w of probeWeeks) {
    try {
      const r = await p.timed("espn-projections", () => fetchEspnLeagueDefaults(season, w, small));
      const list = espnPlayers(r.json) ?? [];
      await saveRawSafe(p, `espn:leaguedefaults:${w}:pool50`, r.json ?? r.text, r);
      let has = 0;
      let same = 0;
      let compared = 0;
      for (const pl of list) {
        const e = findEntry(pl, 1, 1, season, w);
        if (!e) continue;
        has++;
        const other = byId.get(pl.id);
        const o = other ? findEntry(other, 1, 1, season, w) : undefined;
        if (o) {
          compared++;
          if (o.appliedTotal === e.appliedTotal) same++;
        }
      }
      const periods = new Set(list.flatMap((pl) => (pl.player?.stats ?? []).filter((s) => s.statSourceId === 1 && s.statSplitTypeId === 1 && s.seasonId === season).map((s) => s.scoringPeriodId ?? -1)));
      const regular = [...periods].filter((x) => x >= 1 && x <= last).length;
      if (regular < last) allPeriodsEach = false;
      if (has) periodsOk++;
      sameTotal += same;
      comparedTotal += compared;
      periodEv.push(ev(p, r, `scoringPeriodId=${w}: players[].player.stats[] (1,1,${season},${w})`, { players: list.length, withWeekEntry: has, sameAsCurrentWeekResponse: `${same}/${compared}`, projectedPeriodsInResponse: `${regular}/${last}` }));
    } catch (err) {
      allPeriodsEach = false;
      periodEv.push(note(undefined, undefined, `scoringPeriodId=${w}: ${errMsg(err)}`, espnLeagueDefaultsUrl(season, w)));
    }
  }
  const periodVerdict = periodsOk === probeWeeks.length && comparedTotal > 0 && sameTotal === comparedTotal && allPeriodsEach;
  (!probeWeeks.length ? cl.na : periodVerdict ? cl.ok : cl.warn).call(
    cl,
    "PROJ-E",
    "PROJ-E.future",
    `scoringPeriodId ${probeWeeks.join(" / ") || "–"}`,
    probeWeeks.length
      ? `${periodsOk}/${probeWeeks.length} requests returned that week's projection entries (limit 50 each); ${sameTotal}/${comparedTotal} equal the same week's entry in the week-${cw} response; every response ${allPeriodsEach ? `carries all ${last} regular-season periods` : "does NOT carry every period"}${periodVerdict ? ", so scoringPeriodId doesn't restrict which weeks come back" : ""}`
      : "no future weeks left",
    ...periodEv,
  );
  if (periodVerdict)
    cl.issue(
      `§2.2 says to add scoringPeriodId={week} for a specific week's projections: on leaguedefaults/3 view=kona_player_info it selects nothing — responses for scoringPeriodId ${[cw, ...probeWeeks].join("/")} all carry projected entries for every period 1–${last} (identical values, ${sameTotal}/${comparedTotal}) — evidence: GET ${espnLeagueDefaultsUrl(season, probeWeeks[0] ?? cw)} HTTP 200, players[].player.stats[].scoringPeriodId — options: (a) one pool call per 6 h and pick weeks client-side (decision below), (b) check the league endpoint's behaviour in the ESPN probe before relying on it there.`,
    );

  // ---- appliedTotal: which scoring does leaguedefaults/3 use?
  const offense = players.filter((pl) => OFFENSE.has(espnPosition(pl)));
  const entries = offense.flatMap((pl) => (pl.player?.stats ?? []).filter((s) => s.seasonId === season && s.statSplitTypeId === 1));
  const fits = fitEspnScoring(entries);
  const best = [...fits].sort((a, b) => b.within005 - a.within005)[0];
  const int1 = fits.find((x) => x.perReception === (best?.perReception ?? 1) && x.intPts === -1);
  const verified = best !== undefined && best.compared > 0 && best.within005 / best.compared >= 0.99;
  (verified ? cl.ok : cl.warn).call(
    cl,
    "PROJ-E",
    "PROJ-E.applied",
    "appliedTotal scoring (leaguedefaults/3)",
    best
      ? `ESPN default rules — ${best.perReception} per reception, INT ${signed(best.intPts)}, fumble lost −2, 0.04/pass yd, 4/pass TD, 0.1/rush-rec yd, 6/TD — reproduce appliedTotal within 0.05 on ${best.within005}/${best.compared} QB/RB/WR/TE single-week entries, projected and actual (${pct(best.within005, best.compared)})${int1 && best.intPts !== -1 ? `; with INT −1 (Sleeper's default) only ${int1.withIntWithin005}/${int1.withIntCompared} of the entries with an interception fit, vs ${best.withIntWithin005}/${best.withIntCompared}` : ""}${verified ? "" : " — inferred, not exact"}. So this appliedTotal is ESPN's default PPR, neither a league's scoring nor Sleeper's defaults`
      : "no entries to test",
    note("fit by rule variant", fits.map((x) => ({ ppr: x.perReception, int: x.intPts, within005: `${x.within005}/${x.compared}`, within05: `${x.within05}/${x.compared}`, entriesWithInt: `${x.withIntWithin005}/${x.withIntCompared}` })), "stat ids from espn-api PLAYER_STATS_MAP: 3,4,19,20,24,25,26,42,43,44,53,63,72,101,102"),
  );
  if (verified && best)
    cl.issue(
      `§6 averages ESPN's league-scored appliedTotal with Sleeper for ESPN leagues: the league-independent pool (leaguedefaults/3) scores appliedTotal with ESPN's default PPR (INT ${signed(best.intPts)}), not a league's rules (${best.within005}/${best.compared} entries) — evidence: GET ${espnLeagueDefaultsUrl(season, cw)} HTTP ${res.status}, players[].player.stats[].appliedTotal — options: (a) take appliedTotal from the league's own kona_player_info (league endpoint), (b) rescore ESPN's raw projected stats with the league's rules.`,
    );

  // ---- empty projected entries and bye weeks
  const byeOf = new Map(state.espnTeams.map((t) => [t.id, t.byeWeek]));
  const empty = classifyEmptyEspn(players, season, cw, last, (id) => (id === undefined ? undefined : byeOf.get(id)));
  const dstBye = empty.byeWeekByPosition["D/ST"];
  const playerByeProjected = Object.entries(empty.byeWeekByPosition)
    .filter(([pos]) => pos !== "D/ST")
    .reduce((a, [, b]) => a + b.nonZero, 0);
  cl.warn(
    "PROJ-E",
    "PROJ-E.empty",
    "Empty projected entries and bye weeks",
    `${empty.total} projected single-week ${season} entries are empty (no stats, appliedTotal 0): ${Object.entries(empty.byClass)
      .sort(([, a], [, b]) => b - a)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ")}${Object.keys(empty.injuredByStatus).length ? ` (injured: ${JSON.stringify(empty.injuredByStatus)})` : ""}. So an empty entry means "not projected" (score 0), not "bye". In their own bye week (ESPN byeWeek): ${Object.entries(empty.byeWeekByPosition)
      .map(([pos, b]) => `${pos} ${b.nonZero}/${b.withEntry} projected`)
      .join(", ")}${dstBye && dstBye.nonZero ? ` — ESPN projects D/ST units in their bye week` : ""}${playerByeProjected ? `; ${playerByeProjected} other players too` : ""}. Bye weeks must come from the NFL schedule (§6 a = 0), never from ESPN's projection`,
    note("empty entries by class", empty.byClass, "bye = the player's team byeWeek from proTeamSchedules_wl; injured = injuryStatus not ACTIVE; past = before the current week"),
    note("own bye week by ESPN position: players / with an entry / non-zero", empty.byeWeekByPosition),
    note("ACTIVE players with unprojected future weeks (sample)", empty.activeNotProjectedSample),
  );
  cl.decision("Bye weeks come from the NFL schedule (nflverse / ESPN byeWeek), never from projections: an empty ESPN entry means 'not projected' (PROJ-E.empty), and ESPN projects D/ST units in their own bye week.");

  // ---- XWALK: ESPN pool → Sleeper ids (DynastyProcess, FantasyCalc, Sleeper DB) and D/ST → Sleeper DEF
  const db = state.sleeperDb ?? {};
  const sleeperDefByNickname = new Map(Object.values(db).filter((x) => x.position === "DEF").map((x) => [String(x.last_name ?? "").toLowerCase(), x.player_id]));
  const defMap = new Map<number, string>();
  for (const t of state.espnTeams) {
    const sid = sleeperDefByNickname.get(String(t.name ?? "").toLowerCase());
    if (sid) defMap.set(t.id, sid);
  }
  state.espnDefToSleeper = defMap;
  const dst = players.filter((pl) => espnPosition(pl) === "D/ST");
  const dstPattern = dst.filter((pl) => pl.id === -(16000 + (pl.player?.proTeamId ?? NaN))).length;
  const defDiffers = state.espnTeams.filter((t) => defMap.get(t.id) && defMap.get(t.id) !== t.abbrev.toUpperCase()).map((t) => `${t.abbrev}→${defMap.get(t.id)}`);
  const byPos: Record<string, { players: number; mapped: number; bySource: Record<string, number> }> = {};
  const unmapped: string[] = [];
  for (const pl of players) {
    const pos = espnPosition(pl);
    const b = (byPos[pos] ??= { players: 0, mapped: 0, bySource: {} });
    b.players++;
    if (pos === "D/ST") {
      if (defMap.has(pl.player?.proTeamId ?? -1)) {
        b.mapped++;
        b.bySource["team nickname"] = (b.bySource["team nickname"] ?? 0) + 1;
      }
      continue;
    }
    const m = state.espnToSleeper.get(String(pl.id));
    if (m) {
      b.mapped++;
      b.bySource[m.source] = (b.bySource[m.source] ?? 0) + 1;
    } else if (unmapped.length < 10) unmapped.push(`${pl.player?.fullName} (${pos})`);
  }
  const total = Object.values(byPos).reduce((a, b) => a + b.players, 0);
  const mapped = Object.values(byPos).reduce((a, b) => a + b.mapped, 0);
  const conflictIds = new Set(state.espnMapConflicts.map((c) => c.espnId));
  const poolConflicts = players.filter((pl) => conflictIds.has(String(pl.id))).length;
  (mapped / Math.max(1, total) >= 0.98 ? cl.ok : cl.warn).call(
    cl,
    "XWALK",
    "XWALK.espnPool",
    "ESPN player pool → Sleeper ids",
    `${mapped}/${total} (${pct(mapped, total)}) of ESPN's ${total} most-owned players get a Sleeper id: players through the ESPN→Sleeper map (${poolConflicts} of them have a conflicting ESPN id), D/ST units through the team nickname (ESPN D/ST id = −(16000 + proTeamId) on ${dstPattern}/${dst.length}; Sleeper DEF id = team code${defDiffers.length ? `, differing for ${defDiffers.join(", ")}` : ""})`,
    note("by ESPN position", byPos),
    note("unmapped (first 10)", unmapped),
  );

  // ---- ESPN vs Sleeper for the current week, both scored with ESPN's default rules (§6 logs >40% gaps)
  const sleeperW = new Map((state.sleeperProj.get(cw) ?? []).map((r) => [r.player_id, r]));
  const intPts = best?.intPts ?? -2;
  const perRec = best?.perReception ?? 1;
  const pairsW: Array<{ name: string; pos: string; a: number; b: number }> = [];
  let noSleeperRow = 0;
  for (const { pl, e } of wk) {
    if (!e || !OFFENSE.has(espnPosition(pl))) continue;
    const sid = state.espnToSleeper.get(String(pl.id))?.sleeperId;
    const sr = sid ? sleeperW.get(sid) : undefined;
    if (!sr) {
      noSleeperRow++;
      continue;
    }
    const a = e.appliedTotal ?? 0;
    const b = sleeperStdScore(sr.stats ?? {}, perRec, intPts);
    if (a >= 5 || b >= 5) pairsW.push({ name: String(pl.player?.fullName ?? pl.id), pos: espnPosition(pl), a, b });
  }
  const d = disagreement(pairsW);
  const byPosRatio = Object.fromEntries(["QB", "RB", "WR", "TE"].map((pos) => [pos, disagreement(pairsW.filter((x) => x.pos === pos)).medianRatio]));
  cl.ok(
    "PROJ-E",
    "PROJ-E.vsSleeper",
    `ESPN vs Sleeper, week ${cw} (same rules)`,
    `ESPN appliedTotal vs Sleeper's projected stats scored with the same ESPN default rules (${perRec}/rec, INT ${signed(intPts)}, fumble lost −2; return TDs ignored): ${d.compared + d.oneZero} QB/RB/WR/TE projected ≥ 5 points by either source (${noSleeperRow} ESPN players had no Sleeper week-${cw} row); median ESPN/Sleeper ${d.medianRatio} (${Object.entries(byPosRatio)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}); one source at 0: ${d.oneZero}; both > 0 and apart by more than 40% of the larger value: ${d.overOfLarger} (of the smaller: ${d.overOfSmaller}). §6 would log these`,
    note("largest gaps, both > 0 (ESPN appliedTotal vs Sleeper stats × ESPN rules)", d.samples),
  );

  // ---- fixture: top 100 by percent owned, trimmed
  await saveFixture(p, fixtureLabels.espnPool(cw), { players: players.slice(0, 100).map((pl) => trimEspn(pl, plan)) }, res);
  cl.decision(`ESPN projections: one leaguedefaults/3 kona_player_info call per 6 h carries every weekly projection; trim each player's stats[] to the current season before caching (the full ${players.length}-player pool is ~${Math.round(res.text.length / 1048576)} MB).`);
  if (defDiffers.length) cl.decision(`ESPN D/ST → Sleeper DEF ids are joined on the team nickname (ESPN proTeams name vs Sleeper DEF last_name), not on abbreviations, which differ (${defDiffers.join(", ")}).`);
  if (defaultCount !== null && defaultCount < players.length) cl.decision(`ESPN kona_player_info returns only ${defaultCount} players without an X-Fantasy-Filter, so every pool request sends the espn-api pool filter with an explicit limit.`);
}
