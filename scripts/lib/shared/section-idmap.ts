/**
 * IDMAP — DynastyProcess player ID crosswalk (CLAUDE.md §2.9) and
 * XWALK — joins between FantasyCalc, DynastyProcess and the Sleeper players DB.
 */
import type { ProbeContext } from "../probe";
import { getSleeperPlayers, SLEEPER_PLAYERS_URL, type SleeperPlayer } from "../sleeper-players";
import { addTeamCodes, errMsg, ev, freshness, note, saveFixture, saveRawSafe, type EspnMapSource, type FcPlayerRecord, type SharedState } from "./context";
import { isPickId } from "./fc";
import { fetchIdMapCommits, fetchIdMapCsv } from "./fetch";
import { agreement, buildEspnMap, classifyEspnDisagreements, columnStats, DP_REQUIRED_COLUMNS, duplicateSamples, groupBy, idColumns, indexBy, parseCsv, type CsvRow, type EspnMapCandidate } from "./idmap";
import { fixtureLabels } from "./labels";
import { countBy, isBlankId, pct, sortCounts, toCsv } from "./util";

const SKILL = new Set(["QB", "RB", "WR", "TE"]);
const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
/** Columns kept in the committed subset besides the IDs (names, position, team, birthdate, db_season). */
const SUBSET_EXTRA = ["name", "merge_name", "position", "team", "birthdate", "db_season"];
/**
 * ID columns left out of the committed subset: cfbref_id is a name slug ("first-last-N") that no
 * §2 platform uses, and it trips the commit-time name check on public player names.
 */
const SUBSET_SKIP = new Set(["cfbref_id"]);
/** DynastyProcess columns that bridge to a §2 platform or source (coverage gaps here matter). */
const PLATFORM_COLUMNS = ["sleeper_id", "espn_id", "yahoo_id", "fleaflicker_id", "mfl_id", "gsis_id", "sportradar_id"];
/** §2.3: "/players/nfl — about 5 MB". */
const SPEC_PLAYERS_DB_BYTES = 5_000_000;

/** Active Sleeper QB/RB/WR/TE on an NFL team, and the top 250 of them by Sleeper's search_rank. */
export function relevantSleeper(db: Record<string, SleeperPlayer>): { all: SleeperPlayer[]; top: SleeperPlayer[] } {
  const all = Object.values(db).filter((x) => SKILL.has(String(x.position)) && x.active === true && !isBlankId(x.team));
  // A null search_rank means "unranked": sort it last (Number(null) would be 0 and sort it first).
  const rank = (x: SleeperPlayer) => (typeof x.search_rank === "number" && Number.isFinite(x.search_rank) ? x.search_rank : Infinity);
  const top = [...all].sort((a, b) => rank(a) - rank(b)).slice(0, 250);
  return { all, top };
}

async function loadSleeperDb(p: ProbeContext, state: SharedState): Promise<Record<string, SleeperPlayer> | null> {
  if (state.sleeperDb) return state.sleeperDb;
  try {
    const r = await p.timed("sleeper-players", () => getSleeperPlayers());
    state.sleeperDb = r.data;
    state.sleeperDbBytes = Buffer.byteLength(r.res.text, "utf8");
    const players = Object.values(r.data);
    const active = players.filter((x) => x.active === true);
    addTeamCodes(state, "Sleeper players DB", active.filter((x) => FANTASY_POSITIONS.has(String(x.position))).map((x) => ({ code: x.team, sleeperId: x.player_id })));
    const size = `${(state.sleeperDbBytes / 1e6).toFixed(2)} MB (${state.sleeperDbBytes.toLocaleString("en-US")} bytes)`;
    const off = state.sleeperDbBytes > SPEC_PLAYERS_DB_BYTES * 1.5 || state.sleeperDbBytes < SPEC_PLAYERS_DB_BYTES * 0.5;
    // Verified data, so ✅; the size difference from §2.3 is reported as an open issue.
    p.cl.ok(
      "XWALK",
      "XWALK.sleeperDb",
      "Sleeper players DB",
      `HTTP ${r.res.status}: ${players.length} players (${active.length} active), ${size}${off ? `, not the ~5 MB §2.3 states (see open issues)` : ""}; cached 24 h (§2.10)`,
      ev(p, r.res, "{player_id: player}", { players: players.length, active: active.length, bytes: state.sleeperDbBytes }, freshness(r.res, "24 h")),
    );
    if (off)
      p.cl.issue(
        `Sleeper players DB size (§2.3 says "about 5 MB"): ${SLEEPER_PLAYERS_URL} returned ${size} for ${players.length} players (HTTP ${r.res.status}) — options: keep the once-a-day server-side cache and send the browser only the players a league needs, or cache a trimmed copy (active players at fantasy positions).`,
      );
    return r.data;
  } catch (err) {
    p.cl.fail("XWALK", "XWALK.sleeperDb", "Sleeper players DB", `failed: ${errMsg(err)}`, note(undefined, undefined, undefined, SLEEPER_PLAYERS_URL));
    return null;
  }
}

export async function runIdMap(p: ProbeContext, state: SharedState): Promise<void> {
  const { cl } = p;
  let rows: CsvRow[];
  let columns: string[];
  try {
    const res = await p.timed("idmap", () => fetchIdMapCsv());
    if (!res.ok || res.isHtml) throw new Error(`HTTP ${res.status}${res.isHtml ? " (HTML)" : ""}`);
    rows = parseCsv(res.text);
    columns = Object.keys(rows[0] ?? {});
    state.dpRows = rows;
    await saveRawSafe(p, "dynastyprocess:db_playerids.csv", res.text, res, ".csv");

    let freshnessText = "unknown";
    let commitRes;
    try {
      commitRes = await fetchIdMapCommits();
      const c = (commitRes.json as Array<{ commit?: { committer?: { date?: string }; message?: string } }> | undefined)?.[0]?.commit;
      if (c?.committer?.date) freshnessText = `${c.committer.date} ("${c.message ?? ""}")`;
    } catch (err) {
      freshnessText = `GitHub API failed: ${errMsg(err)}`;
    }
    cl.ok(
      "IDMAP",
      "IDMAP.fetch",
      "Download and freshness",
      `HTTP ${res.status}, ${Math.round(res.text.length / 1024)} KB, ${rows.length} rows × ${columns.length} columns; last commit to the file ${freshnessText}. raw.githubusercontent.com sent ${res.headers.etag ? "an ETag" : "no ETag"} and ${res.headers["last-modified"] ? "a Last-Modified header" : "no Last-Modified header"}, so freshness comes from the GitHub commits API`,
      ev(p, res, "(csv)", { rows: rows.length, etag: res.headers.etag ? "present" : "absent", lastModifiedHeader: res.headers["last-modified"] ?? null }, freshness(res, "24 h")),
      ev(p, commitRes, "[0].commit.committer.date", freshnessText),
    );
  } catch (err) {
    cl.fail("IDMAP", "IDMAP.fetch", "Download", `failed: ${errMsg(err)}`);
    return;
  }

  // ---- columns
  const missingCols = DP_REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  (missingCols.length ? cl.fail : cl.ok).call(cl, "IDMAP", "IDMAP.columns", "Columns", missingCols.length ? `missing: ${missingCols.join(", ")}` : `all ${DP_REQUIRED_COLUMNS.length} columns §2.9 relies on are present (${columns.length} in total)`, note("header", columns));

  // ---- coverage per id column: all rows, and rows for current fantasy players
  const db = await loadSleeperDb(p, state);
  const activeIds = new Set(db ? relevantSleeper(db).all.map((x) => x.player_id) : []);
  const current = rows.filter((r) => activeIds.has(String(r.sleeper_id)));
  const ids = idColumns(columns);
  const cov = Object.fromEntries(ids.map((c) => [c, `${columnStats(rows, c).nonEmpty} / ${columnStats(current, c).nonEmpty}`]));
  const currentCov = ids.map((c) => ({ c, n: columnStats(current, c).nonEmpty })).sort((a, b) => a.n - b.n);
  const gaps = currentCov.filter((x) => x.n < current.length * 0.9);
  const platformGaps = gaps.filter((x) => PLATFORM_COLUMNS.includes(x.c));
  const seasons = countBy(rows, (r) => r.db_season);
  (!current.length ? cl.warn : platformGaps.length ? cl.warn : cl.ok).call(
    cl,
    "IDMAP",
    "IDMAP.coverage",
    "Non-empty IDs per column",
    current.length
      ? `${current.length} rows belong to active Sleeper QB/RB/WR/TE on a team (found through sleeper_id, so that column is complete by construction). Below 90% of them: ${gaps.map((x) => `${x.c} ${x.n}/${current.length}`).join(", ") || "none"}${platformGaps.length ? ` — ${platformGaps.map((x) => x.c).join(", ")} bridge(s) to §2 platforms` : ""}. "NA" counts as empty. ${Object.keys(seasons).length === 1 ? `db_season is ${Object.keys(seasons)[0]} on every row, so it can't tell current players from retired ones` : `db_season values: ${JSON.stringify(sortCounts(seasons))}`}`
      : "Sleeper players DB unavailable, so current players can't be picked out; see the evidence for all-row counts",
    note("<column>_id non-empty: all rows / rows for active Sleeper QB/RB/WR/TE on a team", cov),
    note("db_season", sortCounts(seasons)),
  );
  const ffGap = gaps.find((x) => x.c === "fleaflicker_id");
  if (ffGap) state.dpFleaflickerGap = { have: ffGap.n, of: current.length };

  // ---- duplicates
  const dupCols = ["sleeper_id", "espn_id", "yahoo_id", "fleaflicker_id", "mfl_id", "gsis_id", "fantasypros_id", "sportradar_id"].filter((c) => columns.includes(c));
  const dupStats = dupCols.map((c) => ({ all: columnStats(rows, c), current: columnStats(current, c) }));
  const withDups = dupStats.filter((s) => s.all.duplicateValues > 0);
  const currentDups = dupStats.filter((s) => s.current.duplicateValues > 0);
  (withDups.length ? cl.warn : cl.ok).call(
    cl,
    "IDMAP",
    "IDMAP.duplicates",
    "Duplicate IDs",
    withDups.length
      ? `duplicate values in ${withDups.map((s) => `${s.all.column} (${s.all.duplicateValues} values on ${s.all.duplicateRows} rows)`).join(", ")}; among rows for active Sleeper players: ${currentDups.length ? currentDups.map((s) => `${s.current.column} ${s.current.duplicateValues}`).join(", ") : "none"}`
      : "no ID value appears on two rows",
    ...withDups.slice(0, 4).map((s) => note(`${s.all.column} duplicates`, duplicateSamples(rows, s.all.column, 3))),
  );
  if (withDups.length) cl.decision("DynastyProcess duplicates: when an ID maps to several rows, prefer the row whose sleeper_id is an active Sleeper player, and log the ambiguity as an import warning (applied in the ESPN → Sleeper map below).");

  // ---- positions
  const pos = sortCounts(countBy(rows, (r) => r.position));
  const kickerCodes = Object.keys(pos).filter((k) => ["K", "PK"].includes(k));
  const defCodes = Object.keys(pos).filter((k) => ["DEF", "DST", "D/ST"].includes(k));
  (kickerCodes.length ? cl.ok : cl.warn).call(
    cl,
    "IDMAP",
    "IDMAP.positions",
    "Positions",
    `${Object.keys(pos).length} position codes; kickers are ${kickerCodes.map((k) => `"${k}" (${pos[k]} rows)`).join(", ") || "not found"}; team-defense rows: ${defCodes.length ? defCodes.map((k) => `"${k}" ${pos[k]}`).join(", ") : "none (DEF ids must come from elsewhere)"}`,
    note("position", pos),
  );
  addTeamCodes(state, "DynastyProcess", current.map((r) => ({ code: r.team, sleeperId: r.sleeper_id })));

  // ---- committed subset: rows for current Sleeper QB/RB/WR/TE/K
  const activeAny = new Set(db ? Object.values(db).filter((x) => x.active === true && ["QB", "RB", "WR", "TE", "K"].includes(String(x.position))).map((x) => x.player_id) : []);
  const subsetRows = rows.filter((r) => activeAny.has(String(r.sleeper_id)));
  await saveFixture(p, fixtureLabels.dpSubset, toCsv(subsetRows, [...ids.filter((c) => !SUBSET_SKIP.has(c)), ...SUBSET_EXTRA.filter((c) => columns.includes(c))]), undefined, ".csv");
}

export async function runCrosswalk(p: ProbeContext, state: SharedState): Promise<void> {
  const { cl } = p;
  const db = await loadSleeperDb(p, state);
  if (!db) return;
  const dp = state.dpRows ?? [];
  const dpBySleeper = indexBy(dp, "sleeper_id");
  // FantasyCalc's ids come from its value rows only: /players isn't asked (FantasyCalc's conditions of 2026-10-05 allow only
  // /values/current; section-fc.ts).
  const fcRows = state.fc.flatMap((r) => r.data ?? []);
  const fcById = new Map<number, FcPlayerRecord>();
  for (const e of fcRows) if (e.player.position !== "PICK") fcById.set(e.player.id, e.player as unknown as FcPlayerRecord);
  const fcSkill = [...fcById.values()].filter((x) => SKILL.has(x.position));

  // ---- FantasyCalc IDs per platform
  const idCount = (list: FcPlayerRecord[], f: keyof FcPlayerRecord) => list.filter((x) => !isBlankId(x[f]) && !isPickId(x[f])).length;
  const fields = ["sleeperId", "espnId", "mflId", "fleaflickerId"] as const;
  cl.ok(
    "XWALK",
    "XWALK.fcIds",
    "FantasyCalc IDs per platform",
    `the ${fcSkill.length} FantasyCalc QB/RB/WR/TE on the value rows of the ${state.fc.filter((r) => r.data).length} formats: ${fields.map((f) => `${f} ${idCount(fcSkill, f)}`).join(", ")}. "UNK" (FantasyCalc's placeholder mflId) counts as empty`,
    note("player.{sleeperId,espnId,mflId,fleaflickerId}", Object.fromEntries(fields.map((f) => [f, idCount(fcSkill, f)]))),
  );

  // ---- DynastyProcess ↔ Sleeper DB
  const dpWithSleeper = dp.filter((r) => !isBlankId(r.sleeper_id));
  const dpInDb = dpWithSleeper.filter((r) => db[String(r.sleeper_id)]).length;
  const rel = relevantSleeper(db);
  const unranked = rel.all.filter((x) => typeof x.search_rank !== "number").length;
  const relInDp = rel.all.filter((x) => dpBySleeper.has(x.player_id)).length;
  const topInDp = rel.top.filter((x) => dpBySleeper.has(x.player_id)).length;
  const topMissingDp = rel.top.filter((x) => !dpBySleeper.has(x.player_id)).slice(0, 8).map((x) => `${x.full_name ?? x.player_id} (${x.position}, ${x.team})`);
  (topInDp / Math.max(1, rel.top.length) >= 0.98 ? cl.ok : cl.warn).call(
    cl,
    "XWALK",
    "XWALK.dpSleeper",
    "DynastyProcess ↔ Sleeper IDs",
    `${dpWithSleeper.length} DynastyProcess rows have a sleeper_id; ${dpInDb} of them exist in the Sleeper players DB. Active QB/RB/WR/TE on an NFL team in Sleeper: ${relInDp}/${rel.all.length} (${pct(relInDp, rel.all.length)}) have a DynastyProcess row; top 250 by Sleeper search_rank (${unranked} with a null rank sorted last): ${topInDp}/${rel.top.length} (${pct(topInDp, rel.top.length)})`,
    note("players DB key = sleeper_id", { dpRowsWithSleeperId: dpWithSleeper.length, foundInSleeperDb: dpInDb }, undefined, SLEEPER_PLAYERS_URL),
    note("top-250 Sleeper players missing from DynastyProcess", topMissingDp, "search_rank is Sleeper's popularity order, a rough stand-in for rostered players"),
  );

  // ---- FantasyCalc vs DynastyProcess (joined on sleeper_id)
  type Joined = { fc: FcPlayerRecord; dp: CsvRow | undefined; sl: SleeperPlayer | undefined };
  const joined: Joined[] = fcSkill.filter((x) => !isBlankId(x.sleeperId)).map((x) => ({ fc: x, dp: dpBySleeper.get(String(x.sleeperId)), sl: db[String(x.sleeperId)] }));
  const withDp = joined.filter((j) => j.dp);
  const name = (j: Joined) => j.fc.name;
  const key = (j: Joined) => String(j.fc.sleeperId);
  const agrees = {
    espn: agreement(withDp, (j) => j.fc.espnId, (j) => j.dp?.espn_id, key, name),
    mfl: agreement(withDp, (j) => j.fc.mflId, (j) => j.dp?.mfl_id, key, name),
    fleaflicker: agreement(withDp, (j) => j.fc.fleaflickerId, (j) => j.dp?.fleaflicker_id, key, name),
  };
  const worst = Math.min(...Object.values(agrees).map((a) => (a.compared ? a.agree / a.compared : 1)));
  (worst >= 0.98 ? cl.ok : cl.warn).call(
    cl,
    "XWALK",
    "XWALK.fcVsDp",
    "FantasyCalc vs DynastyProcess IDs",
    `${withDp.length}/${joined.length} FantasyCalc QB/RB/WR/TE with a sleeperId have a DynastyProcess row. Where both give an ID: ${Object.entries(agrees)
      .map(([k, a]) => `${k} ${a.agree}/${a.compared} agree`)
      .join(", ")}`,
    ...Object.entries(agrees).map(([k, a]) => note(`${k}: FantasyCalc vs DynastyProcess`, { agree: a.agree, disagree: a.disagree, onlyFantasyCalc: a.onlyLeft, onlyDynastyProcess: a.onlyRight, neither: a.neither, samples: a.samples.map((s) => `${s.name}: ${s.left} vs ${s.right}`) })),
  );

  // ---- Sleeper DB vs the others (espn_id, yahoo_id), disagreements refereed by DynastyProcess
  const relJoined = rel.all.map((x) => ({ sl: x, dp: dpBySleeper.get(x.player_id) })).filter((j) => j.dp);
  const slName = (j: { sl: SleeperPlayer }) => String(j.sl.full_name ?? j.sl.player_id);
  const slKey = (j: { sl: SleeperPlayer }) => j.sl.player_id;
  const slEspn = agreement(relJoined, (j) => j.sl.espn_id, (j) => j.dp?.espn_id, slKey, slName);
  const slYahoo = agreement(relJoined, (j) => j.sl.yahoo_id, (j) => j.dp?.yahoo_id, slKey, slName);
  const fcEspnVsSleeper = agreement(joined.filter((j) => j.sl), (j) => j.fc.espnId, (j) => j.sl?.espn_id, (j) => String(j.fc.sleeperId), name, Number.POSITIVE_INFINITY);
  const classified = classifyEspnDisagreements(
    fcEspnVsSleeper.samples.map((s) => ({ sleeperId: s.key, name: s.name ?? s.key, fcEspnId: s.left.trim(), sleeperEspnId: s.right.trim() })),
    groupBy(dp, "espn_id"),
    (sid) => {
      const x = db[sid];
      if (!x) return undefined;
      return { espnId: isBlankId(x.espn_id) ? undefined : String(x.espn_id).trim(), birthDate: typeof x.birth_date === "string" ? x.birth_date : undefined };
    },
  );
  const byClass = sortCounts(countBy(classified, (d) => d.cls));
  const byWrong = sortCounts(countBy(classified, (d) => d.wrong));
  const sleeperWrong = classified.filter((d) => d.wrong === "Sleeper DB");
  const sleeperWrongActive = sleeperWrong.filter((d) => db[d.sleeperId]?.active === true).length;
  const slEspnCount = rel.all.filter((x) => !isBlankId(x.espn_id)).length;
  const slYahooCount = rel.all.filter((x) => !isBlankId(x.yahoo_id)).length;
  (Math.min(slEspn.agree / Math.max(1, slEspn.compared), slYahoo.agree / Math.max(1, slYahoo.compared)) >= 0.98 ? cl.ok : cl.warn).call(
    cl,
    "XWALK",
    "XWALK.sleeperVsOthers",
    "Sleeper DB IDs vs the others",
    `Sleeper's own espn_id is set on only ${slEspnCount}/${rel.all.length} active QB/RB/WR/TE (yahoo_id on ${slYahooCount}). Where Sleeper and DynastyProcess both have one: espn_id ${slEspn.agree}/${slEspn.compared} agree, yahoo_id ${slYahoo.agree}/${slYahoo.compared} agree. FantasyCalc espnId vs Sleeper espn_id (all FantasyCalc players): ${fcEspnVsSleeper.agree}/${fcEspnVsSleeper.compared} agree; the ${classified.length} disagreements, refereed by DynastyProcess's owner of each id and its birthdate vs the Sleeper player's: ${Object.entries(byClass)
      .map(([k, n]) => `${k} ${n}`)
      .join("; ")} — wrong source: ${Object.entries(byWrong)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ")}${sleeperWrong.length ? `. The Sleeper DB is wrong in ${sleeperWrong.length} (${sleeperWrongActive} active players), so its espn_id can be wrong even for current players: DynastyProcess goes first in the ESPN map` : ""}`,
    note("espn_id Sleeper vs DynastyProcess", { disagree: slEspn.disagree, onlySleeper: slEspn.onlyLeft, onlyDynastyProcess: slEspn.onlyRight, samples: slEspn.samples.map((s) => `${s.name}: ${s.left} vs ${s.right}`) }),
    note("yahoo_id Sleeper vs DynastyProcess", { disagree: slYahoo.disagree, onlySleeper: slYahoo.onlyLeft, onlyDynastyProcess: slYahoo.onlyRight }),
    note(
      "espnId FantasyCalc vs Sleeper, classified",
      classified.map((d) => `${d.name}: FC ${d.fcEspnId} vs Sleeper ${d.sleeperEspnId} → ${d.cls}${d.detail ? ` (${d.detail})` : ""}`),
    ),
  );

  // ---- ESPN → Sleeper map for later sections (DynastyProcess first, then FantasyCalc, then Sleeper DB)
  const candidates: EspnMapCandidate[] = [];
  const add = (espnId: unknown, sleeperId: unknown, source: EspnMapSource) => {
    if (isBlankId(espnId) || isBlankId(sleeperId) || isPickId(sleeperId)) return;
    candidates.push({ espnId: String(espnId).trim(), sleeperId: String(sleeperId).trim(), source });
  };
  for (const r of dp) add(r.espn_id, r.sleeper_id, "DynastyProcess");
  for (const x of fcById.values()) add(x.espnId, x.sleeperId, "FantasyCalc");
  for (const x of Object.values(db)) add(x.espn_id, x.player_id, "Sleeper DB");
  const built = buildEspnMap(candidates, (sid) => db[sid]?.active === true);
  for (const [k, v] of built.map) state.espnToSleeper.set(k, { sleeperId: v.sleeperId, source: v.source as EspnMapSource });
  state.espnMapConflicts = built.conflicts;
  const within = built.conflicts.filter((c) => c.within);
  const between = built.conflicts.filter((c) => !c.within);
  const byActive = built.conflicts.filter((c) => c.resolvedBy === "active player").length;
  cl.ok(
    "XWALK",
    "XWALK.espnMap",
    "ESPN → Sleeper ID map",
    `${state.espnToSleeper.size} ESPN ids mapped (${JSON.stringify(sortCounts(countBy(state.espnToSleeper.values(), (v) => v.source)))} by chosen source). ${built.conflicts.length} ESPN ids get different Sleeper ids: ${within.length} from duplicates inside one source (${JSON.stringify(sortCounts(countBy(within, (c) => c.pair)))}) and ${between.length} between sources (${JSON.stringify(sortCounts(countBy(between, (c) => c.pair)))}); ${byActive} resolved by preferring the active Sleeper player, ${built.conflicts.length - byActive} by source order (DynastyProcess, FantasyCalc, Sleeper DB)`,
    note(
      "conflicts (first 5)",
      built.conflicts.slice(0, 5).map((c) => `espn ${c.espnId}: ${c.options.map((o) => `${o.sleeperId} (${o.sources.join("+")})`).join(" vs ")} → ${c.chosen} by ${c.resolvedBy}`),
    ),
  );

  // ---- Yahoo coverage (FantasyCalc has no Yahoo id)
  const yahooFc = withDp.filter((j) => !isBlankId(j.dp?.yahoo_id)).length;
  const hasYahoo = (x: SleeperPlayer) => !isBlankId(x.yahoo_id) || !isBlankId(dpBySleeper.get(x.player_id)?.yahoo_id);
  const yahooTopDp = rel.top.filter((x) => !isBlankId(dpBySleeper.get(x.player_id)?.yahoo_id)).length;
  const yahooTopSleeper = rel.top.filter((x) => !isBlankId(x.yahoo_id)).length;
  const yahooTopEither = rel.top.filter(hasYahoo).length;
  const yahooAllEither = rel.all.filter(hasYahoo).length;
  const missingYahoo = rel.top.filter((x) => !hasYahoo(x));
  const byExp = sortCounts(countBy(missingYahoo, (x) => x.years_exp as number | undefined));
  const young = missingYahoo.filter((x) => typeof x.years_exp === "number" && x.years_exp <= 1).length;
  (yahooTopEither / Math.max(1, rel.top.length) >= 0.98 ? cl.ok : cl.warn).call(
    cl,
    "XWALK",
    "XWALK.yahoo",
    "Yahoo ID coverage",
    `FantasyCalc QB/RB/WR/TE → DynastyProcess yahoo_id: ${yahooFc}/${withDp.length} (${pct(yahooFc, withDp.length)}). Top-250 Sleeper players: DynastyProcess yahoo_id ${yahooTopDp}/${rel.top.length}, Sleeper's own yahoo_id ${yahooTopSleeper}/${rel.top.length}, either ${yahooTopEither}/${rel.top.length} (${pct(yahooTopEither, rel.top.length)}); all ${rel.all.length} active on a team: ${yahooAllEither} (${pct(yahooAllEither, rel.all.length)}). ${young}/${missingYahoo.length} of the top-250 gaps have years_exp 0 or 1 (${JSON.stringify(byExp)})`,
    note("top-250 players with no Yahoo id (sample)", missingYahoo.slice(0, 8).map((x) => `${x.full_name ?? x.player_id} (${x.position}, ${x.team}, exp ${String(x.years_exp)})`)),
  );
  if (yahooTopEither / Math.max(1, rel.top.length) < 0.98)
    cl.issue(
      `Yahoo IDs (§2.9 names DynastyProcess as the Yahoo bridge): only ${yahooTopEither}/${rel.top.length} of the top-250 Sleeper QB/RB/WR/TE have a Yahoo id in DynastyProcess or Sleeper (all active on a team: ${yahooAllEither}/${rel.all.length}), and ${young} of the ${missingYahoo.length} top-250 gaps are in their first or second season — evidence: db_playerids.csv yahoo_id, ${SLEEPER_PLAYERS_URL} yahoo_id — options: for Phase 5, match Yahoo players by name + position + NFL team when the id is missing (manual confirm screen as fallback), or re-check DynastyProcess before Phase 5.`,
    );

  // ---- How much of the Sleeper player pool FantasyCalc covers (proxy for item M before league data)
  const fcBySleeper = new Map<string, FcPlayerRecord>();
  for (const x of fcById.values()) if (!isBlankId(x.sleeperId) && !isPickId(x.sleeperId)) fcBySleeper.set(String(x.sleeperId), x);
  const redraftIds = new Set((state.fc.find((r) => r.name === "redraft")?.data ?? []).map((e) => String(e.player.sleeperId)));
  const dynastyIds = new Set((state.fc.find((r) => r.name === "dynasty")?.data ?? []).map((e) => String(e.player.sleeperId)));
  const share = (list: SleeperPlayer[], idSet: Set<string> | Map<string, unknown>) => list.filter((x) => idSet.has(x.player_id)).length;
  const topMissingFc = rel.top.filter((x) => !fcBySleeper.has(x.player_id)).slice(0, 10).map((x) => `${x.full_name ?? x.player_id} (${x.position}, ${x.team})`);
  const topInFc = share(rel.top, fcBySleeper);
  (topInFc / Math.max(1, rel.top.length) >= 0.98 ? cl.ok : cl.warn).call(
    cl,
    "XWALK",
    "XWALK.fcCoverage",
    "FantasyCalc coverage of the Sleeper pool",
    `top 250 Sleeper QB/RB/WR/TE by search_rank found by sleeperId: any of FantasyCalc's value lists ${topInFc}/${rel.top.length} (${pct(topInFc, rel.top.length)}), redraft values only ${share(rel.top, redraftIds)} (${pct(share(rel.top, redraftIds), rel.top.length)}), dynasty values ${share(rel.top, dynastyIds)}. All ${rel.all.length} active on a team: ${share(rel.all, fcBySleeper)} (${pct(share(rel.all, fcBySleeper), rel.all.length)})`,
    note("top-250 missing from FantasyCalc", topMissingFc),
  );

  // ---- Fleaflicker bridge: DynastyProcess vs FantasyCalc
  const gap = state.dpFleaflickerGap;
  if (gap) {
    const currentIds = rel.all.filter((x) => dpBySleeper.has(x.player_id)).map((x) => x.player_id);
    const fcFf = currentIds.filter((sid) => !isBlankId(fcBySleeper.get(sid)?.fleaflickerId)).length;
    cl.issue(
      `Fleaflicker IDs: DynastyProcess fleaflicker_id is set for only ${gap.have} of ${gap.of} current QB/RB/WR/TE (IDMAP.coverage); FantasyCalc's value rows give a fleaflickerId for ${fcFf} of them (joined on sleeperId) — evidence: db_playerids.csv fleaflicker_id, /values/current [].player.fleaflickerId — options: for Phase 5, take Fleaflicker ids from the value rows a league's format loads, then match the rest by name + position + NFL team (manual confirm screen as fallback).`,
    );
  }
}
