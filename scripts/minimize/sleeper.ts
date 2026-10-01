/**
 * Build the committed, MINIMIZED Sleeper fixtures (CLAUDE.md §0.6; planner reply to Checkpoint 0,
 * answer 2) from local copies only — no request is made:
 *
 *   fixtures/sanitized/min/sleeper/test-league/     the public test league (a stranger's league):
 *     only the fields the adapter tests read, a subset of each roster (with IR and taxi examples),
 *     matchup pairs for every regular-season week (+ one playoff-placeholder week), players_points
 *     for the subset in the oracle weeks, the transactions and traded picks the tests assert,
 *     synthetic transaction/draft IDs, SYNTHETIC transaction times (the real order kept, each at its
 *     league week's start plus whole hours) and SYNTHETIC team scores for the weeks Sleeper has
 *     scored (settings.last_scored_leg), with every team's record and points for/against rebuilt from
 *     them (so W+L+T still counts the scored weeks and the results agree with the standings), so
 *     nothing in the fixture can be matched against the live league's activity feed, scores or
 *     standings (review PRIV-3; Phase 3 matchup results).
 *   fixtures/sanitized/min/sleeper/oracle-leagues/  the Phase 0 cross-league oracle leagues: ONLY
 *     scoring_settings (non-zero), roster_positions and per player-week {sleeperId, pos, week, stats,
 *     players_points} for a subset — no league, team, user or roster IDs, no names.
 *
 * Sources (all git-ignored): data-local/fixtures-sanitized/sleeper/ (labels "public-test-league/…"),
 * fixtures/raw/sleeper/cross-oracle.json (which crawl leagues the Phase 0 oracle used) and the probe
 * caches in .cache/ (league data read offline whatever its age; public /stats and players DB).
 * Console output is aggregate only.
 *
 *   npx tsx scripts/minimize/sleeper.ts
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hasProjection, sleeperPos } from "@/adapters/sleeper/normalize";
import { mapSleeperScoring } from "@/adapters/sleeper/scoringMap";
import { config } from "@/engine/config";
import type { Pos, StatLine } from "@/engine/model";
import { ruleTypesIn, runOracle, type OracleCase, type RuleType } from "@/engine/oracle";
import { scoringStatKeys } from "@/engine/scoring";
import { readCache } from "../lib/cache";
import { ROOT } from "../lib/env";
import { readLocalFixture, saveMinimizedFixture } from "../lib/minimize";
import { parseJsonKeepingBigInts } from "../lib/sleeper/json";
import { cachedStatsWeek, type StatsRow } from "./sleeper-flags";

/* eslint-disable @typescript-eslint/no-explicit-any -- trimming loosely typed API captures */

const PLATFORM = "sleeper";
const SEASON = 2026;
const ORACLE_WEEKS = [2, 3];
const PROJECTION_WEEK = 4;
const PLAYOFF_PLACEHOLDER_WEEK = 15;
const TX_LEGS = [0, 1, 2, 3, 4, 5];
const API = "https://api.sleeper.app/v1";
const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * 24 * HOUR_MS;
/** Synthetic start of league week 1 (a Wednesday noon UTC); league week L starts L − 1 weeks later. */
const SYNTHETIC_WEEK1_START = Date.UTC(SEASON, 8, 9, 12);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const tolerance = config.scoring.oracleTolerance;

/** Settings keys the normalizer or the fetch half reads (everything else is dropped). */
const SETTINGS_KEYS = [
  "type",
  "num_teams",
  "start_week",
  "playoff_week_start",
  "playoff_teams",
  "playoff_round_type",
  "playoff_seed_type",
  "league_average_match",
  "trade_deadline",
  "veto_auto_poll",
  "disable_trades",
  "pick_trading",
  "reserve_slots",
  "taxi_slots",
  "waiver_type",
  "waiver_budget",
  "draft_rounds",
  "best_ball",
  "divisions",
  "leg",
  "last_scored_leg",
];

/**
 * Synthetic transaction times: the real order is kept (normalizer tests sort by it), but each time
 * is its league week's start plus whole hours, so no real time or gap survives (review PRIV-3).
 */
export function synthesizeCreated<T extends { leg: number; created: number }>(rows: readonly T[]): Map<T, number> {
  const out = new Map<T, number>();
  let prev = Number.NEGATIVE_INFINITY;
  for (const row of [...rows].sort((a, b) => a.created - b.created)) {
    const t = Math.max(SYNTHETIC_WEEK1_START + (Math.max(row.leg, 1) - 1) * WEEK_MS + HOUR_MS, prev + HOUR_MS);
    out.set(row, t);
    prev = t;
  }
  return out;
}

/**
 * A synthetic team score for one scored week, 70.00–159.99 (deterministic from the roster number and
 * the week, not from the team's real score).
 */
export function syntheticScore(rosterId: number, week: number): number {
  const h = parseInt(sha(`sleeper-min|score|${rosterId}|${week}`).slice(0, 8), 16);
  return (7000 + (h % 90) * 100 + (Math.floor(h / 90) % 100)) / 100; // whole cents: prints as e.g. 115.37
}

export interface SyntheticStanding {
  wins: number;
  losses: number;
  ties: number;
  /** Points for and against, in hundredths (Sleeper's fpts + fpts_decimal / 100). */
  forCents: number;
  againstCents: number;
}

/**
 * Every roster's record and points for/against, rebuilt from the scored weeks' matchup rows (pairs by
 * matchup_id; the higher score wins, equal scores tie), so the fixture's standings agree with its
 * results. Rosters without a scored game get a 0–0 record.
 */
export function standingsFrom(weeks: ReadonlyArray<ReadonlyArray<{ roster_id: number; matchup_id?: number | null; points?: number }>>): Map<number, SyntheticStanding> {
  const out = new Map<number, SyntheticStanding>();
  const row = (id: number) => {
    let s = out.get(id);
    if (!s) out.set(id, (s = { wins: 0, losses: 0, ties: 0, forCents: 0, againstCents: 0 }));
    return s;
  };
  for (const rows of weeks) {
    const pairs = new Map<number, Array<{ roster_id: number; points?: number }>>();
    for (const r of rows) if (typeof r.matchup_id === "number") pairs.set(r.matchup_id, [...(pairs.get(r.matchup_id) ?? []), r]);
    for (const pair of pairs.values()) {
      const [a, b] = pair;
      if (pair.length !== 2 || !a || !b || typeof a.points !== "number" || typeof b.points !== "number") continue;
      for (const [me, opp] of [
        [a, b],
        [b, a],
      ] as const) {
        const s = row(me.roster_id);
        const mine = Math.round((me.points as number) * 100);
        const theirs = Math.round((opp.points as number) * 100);
        s.forCents += mine;
        s.againstCents += theirs;
        if (mine > theirs) s.wins++;
        else if (mine < theirs) s.losses++;
        else s.ties++;
      }
    }
  }
  return out;
}

const local = <T = any>(label: string): T => readLocalFixture<T>(PLATFORM, `public-test-league/${label}`);
const nonZero = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "number" && v !== 0));
const numericStats = (o: Record<string, unknown> | null | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => typeof v === "number")) as StatLine;

interface PlayerRow {
  player_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string | null;
  fantasy_positions?: string[] | null;
  team?: string | null;
  injury_status?: string | null;
  status?: string | null;
  age?: number | null;
  active?: boolean;
  years_exp?: number | null;
}

function posOf(p: PlayerRow | undefined): Pos | null {
  return p ? sleeperPos(p.position, p.fantasy_positions ?? []) : null;
}

/** Keys worth keeping in a stat line: what the league scores, what its rules read, and gp. */
function statKeysFor(scoringSettings: Record<string, unknown>): Set<string> {
  const keys = new Set(Object.keys(nonZero(scoringSettings)));
  for (const k of scoringStatKeys(mapSleeperScoring(scoringSettings).scoring)) keys.add(k);
  keys.add("gp");
  return keys;
}

const pick = (stats: StatLine, keys: Set<string>): StatLine => Object.fromEntries(Object.entries(stats).filter(([k, v]) => keys.has(k) && v !== 0));

// =============================================================================================
// Test league

/** Writes the test league's fixtures; returns the labels written. */
async function minimizeTestLeague(): Promise<Set<string>> {
  const manifest = readLocalFixture<any>(PLATFORM, "manifest").leagues["public-test-league"];
  const league = local("league/{leagueId}");
  const users: any[] = local("league/{leagueId}/users");
  const rosters: any[] = local("league/{leagueId}/rosters");
  const playersDb: Record<string, PlayerRow> = local("players/nfl (subset)");
  const player = (id: string) => playersDb[id];

  // Roster subset: one IR and one taxi player where the team has them, and a small starting core
  // (QB, RB, 2 WR, TE, plus K on odd and DEF on even rosters).
  const week3 = local<any[]>("league/{leagueId}/matchups/3");
  const startedWeek3 = new Set(week3.flatMap((m) => m.starters ?? []));
  const keepByRoster = new Map<number, { players: string[]; reserve: string[]; taxi: string[] }>();
  for (const r of rosters) {
    const want: Array<[Pos, number]> = [["QB", 1], ["RB", 1], ["WR", 2], ["TE", 1], [r.roster_id % 2 ? "K" : "DEF", 1]];
    const reserve: string[] = (r.reserve ?? []).slice(0, 1);
    const taxi: string[] = (r.taxi ?? []).slice(0, 1);
    const benched = new Set([...(r.reserve ?? []), ...(r.taxi ?? [])]);
    const active = (r.players as string[]).filter((p) => !benched.has(p)).sort((a, b) => Number(startedWeek3.has(b)) - Number(startedWeek3.has(a)) || a.localeCompare(b));
    const chosen: string[] = [];
    for (const [pos, n] of want) chosen.push(...active.filter((p) => posOf(player(p)) === pos && !chosen.includes(p)).slice(0, n));
    keepByRoster.set(r.roster_id, { players: [...chosen, ...reserve, ...taxi], reserve, taxi });
  }
  const kept = new Set([...keepByRoster.values()].flatMap((k) => k.players));
  const rosteredFull = new Set(rosters.flatMap((r) => r.players as string[]));

  const minLeague = {
    league_id: league.league_id,
    name: league.name,
    season: league.season,
    sport: league.sport,
    status: league.status,
    total_rosters: league.total_rosters,
    settings: Object.fromEntries(SETTINGS_KEYS.filter((k) => league.settings[k] !== undefined).map((k) => [k, league.settings[k]])),
    scoring_settings: nonZero(league.scoring_settings),
    roster_positions: league.roster_positions,
  };
  const minUsers = users.map((u) => ({ user_id: u.user_id, display_name: u.display_name, ...(u.metadata?.team_name ? { metadata: { team_name: u.metadata.team_name } } : {}) }));

  // Matchups: pairs for every regular-season week + one placeholder playoff week; oracle weeks keep
  // players and players_points for a subset (current subset first, topped up with that week's starters).
  const playoffStart = Number(league.settings.playoff_week_start);
  const oracleIds = new Set<string>();
  const minMatchups = new Map<number, any[]>();
  for (let w = Number(league.settings.start_week ?? 1); w < playoffStart; w++) minMatchups.set(w, local<any[]>(`league/{leagueId}/matchups/${w}`).map((m) => ({ roster_id: m.roster_id, matchup_id: m.matchup_id })));
  minMatchups.set(PLAYOFF_PLACEHOLDER_WEEK, local<any[]>(`league/{leagueId}/matchups/${PLAYOFF_PLACEHOLDER_WEEK}`).map((m) => ({ roster_id: m.roster_id, matchup_id: m.matchup_id })));
  for (const w of ORACLE_WEEKS) {
    minMatchups.set(
      w,
      local<any[]>(`league/{leagueId}/matchups/${w}`).map((m) => {
        const players: string[] = m.players ?? [];
        const starters: string[] = (m.starters ?? []).filter((p: string) => p !== "0" && !kept.has(p));
        const kOrDef = starters.filter((p) => ["K", "DEF"].includes(posOf(player(p)) ?? ""));
        const keep = [...new Set([...players.filter((p) => kept.has(p)).slice(0, 5), ...kOrDef, ...starters])].slice(0, 7);
        keep.forEach((p) => oracleIds.add(p));
        return { roster_id: m.roster_id, matchup_id: m.matchup_id, players: keep, players_points: Object.fromEntries(keep.map((p) => [p, m.players_points?.[p] ?? 0])) };
      }),
    );
  }
  // The weeks Sleeper has scored get SYNTHETIC team scores (the normalizer's results read them), and
  // the standings are rebuilt from those, so no real score, result, record or season total survives.
  const lastScored = Number(league.settings.last_scored_leg ?? 0);
  const scoredWeeks = [...minMatchups.keys()].filter((w) => w < playoffStart && w <= lastScored).sort((a, b) => a - b);
  for (const w of scoredWeeks) minMatchups.set(w, (minMatchups.get(w) ?? []).map((m) => ({ ...m, points: syntheticScore(m.roster_id, w) })));
  const standings = standingsFrom(scoredWeeks.map((w) => minMatchups.get(w) ?? []));

  const minRosters = rosters.map((r) => {
    const k = keepByRoster.get(r.roster_id) as { players: string[]; reserve: string[]; taxi: string[] };
    const division = r.settings?.division;
    const s = standings.get(r.roster_id) ?? { wins: 0, losses: 0, ties: 0, forCents: 0, againstCents: 0 };
    return {
      roster_id: r.roster_id,
      owner_id: r.owner_id,
      co_owners: r.co_owners ?? null,
      players: k.players,
      reserve: k.reserve.length ? k.reserve : null,
      taxi: k.taxi.length ? k.taxi : null,
      settings: {
        wins: s.wins,
        losses: s.losses,
        ties: s.ties,
        ...(division !== undefined ? { division } : {}),
        fpts: Math.floor(s.forCents / 100),
        fpts_decimal: s.forCents % 100,
        fpts_against: Math.floor(s.againstCents / 100),
        fpts_against_decimal: s.againstCents % 100,
      },
    };
  });

  // Full-league oracle on the local copy (aggregate only, for the report).
  const scoring = mapSleeperScoring(league.scoring_settings).scoring;
  const cases: OracleCase[] = [];
  const statsByWeek = new Map<number, Map<string, StatLine>>();
  for (const w of ORACLE_WEEKS) {
    const rows: any[] = local(`stats/nfl/${SEASON}/${w} (subset)`);
    statsByWeek.set(w, new Map(rows.map((r) => [String(r.player_id), numericStats(r.stats)])));
    for (const m of local<any[]>(`league/{leagueId}/matchups/${w}`))
      for (const pid of m.players ?? []) {
        const pts = m.players_points?.[pid];
        const pos = posOf(player(pid));
        if (typeof pts === "number" && pos) cases.push({ source: "sleeper/test-league", week: w, playerId: pid, pos, stats: statsByWeek.get(w)?.get(pid) ?? {}, scoring, expected: pts });
      }
  }
  const full = runOracle(cases);
  console.log(`test league oracle (full local copy, weeks ${ORACLE_WEEKS.join(", ")}): ${full.within}/${full.total} within ±${tolerance} (${(full.rate * 100).toFixed(1)}%); rule types ${JSON.stringify(full.ruleTypesExercised)}`);

  const keys = statKeysFor(league.scoring_settings);
  const minStats = ORACLE_WEEKS.map((w) => ({
    week: w,
    rows: [...oracleIds]
      .filter((p) => statsByWeek.get(w)?.has(p))
      .sort()
      .map((p) => ({ player_id: p, stats: pick(statsByWeek.get(w)?.get(p) ?? {}, keys) })),
  }));

  // Transactions: one of each kind the tests assert, synthetic IDs and times.
  const allTx: any[] = TX_LEGS.flatMap((leg) => {
    try {
      return local<any[]>(`league/{leagueId}/transactions/${leg}`);
    } catch {
      return [];
    }
  });
  // n of a kind, spread over the weeks (latest week first, round-robin), so leg → week is exercised.
  const byKind = (pred: (t: any) => boolean, n: number) => {
    const legs = new Map<number, any[]>();
    for (const t of allTx.filter(pred).sort((a, b) => a.created - b.created)) legs.set(t.leg, [...(legs.get(t.leg) ?? []), t]);
    const queues = [...legs].sort((a, b) => b[0] - a[0]).map(([, list]) => list);
    const out: any[] = [];
    while (out.length < n && queues.some((q) => q.length)) for (const q of queues) if (q.length && out.length < n) out.push(q.shift());
    return out;
  };
  // A trade with picks (moves + picks), a completed and a failed waiver claim, an add and a drop-only move.
  const chosenTx = [
    ...byKind((t) => t.type === "trade" && t.status === "complete" && (t.draft_picks ?? []).length > 0, 1),
    ...byKind((t) => t.type === "waiver" && t.status === "complete", 1),
    ...byKind((t) => t.type === "waiver" && t.status === "failed", 1),
    ...byKind((t) => t.type === "free_agent" && t.status === "complete" && Object.keys(t.adds ?? {}).length > 0, 2),
    ...byKind((t) => t.type === "free_agent" && t.status === "complete" && !Object.keys(t.adds ?? {}).length, 1),
  ];
  const txIds = new Map(chosenTx.map((t, i) => [t.transaction_id, `9000000000000000${String(i + 1).padStart(3, "0")}`]));
  const createdAt = synthesizeCreated(chosenTx as Array<{ leg: number; created: number }>);
  const minTx = new Map<number, any[]>();
  for (const t of chosenTx) {
    const row = {
      transaction_id: txIds.get(t.transaction_id),
      type: t.type,
      status: t.status,
      leg: t.leg,
      created: createdAt.get(t),
      roster_ids: t.roster_ids,
      adds: t.adds ?? null,
      drops: t.drops ?? null,
      draft_picks: (t.draft_picks ?? []).map((p: any) => ({ season: p.season, round: p.round, roster_id: p.roster_id, previous_owner_id: p.previous_owner_id, owner_id: p.owner_id })),
    };
    minTx.set(t.leg, [...(minTx.get(t.leg) ?? []), row]);
  }
  const txPlayers = new Set(chosenTx.flatMap((t) => [...Object.keys(t.adds ?? {}), ...Object.keys(t.drops ?? {})]));

  // Traded picks: one row of this season's (finished) draft that changed hands, plus three future ones.
  const traded: any[] = local("league/{leagueId}/traded_picks");
  const minTraded = [...traded.filter((p) => Number(p.season) === SEASON && p.roster_id !== p.owner_id).slice(0, 1), ...traded.filter((p) => Number(p.season) > SEASON).slice(0, 3)].map((p) => ({ season: p.season, round: p.round, roster_id: p.roster_id, previous_owner_id: p.previous_owner_id, owner_id: p.owner_id }));
  const drafts: any[] = local("league/{leagueId}/drafts");
  const minDrafts = drafts.map((d, i) => ({ draft_id: `8000000000000000${String(i + 1).padStart(3, "0")}`, season: d.season, status: d.status, type: d.type, settings: { rounds: d.settings?.rounds } }));

  // Projections (week 4): true free agents (not on any roster of the full league) + stub rows + a
  // few rostered players (the normalizer must skip them).
  const projRows: any[] = local(`projections/nfl/${SEASON}/${PROJECTION_WEEK} (subset)`);
  const real = (r: any) => hasProjection(r.stats);
  const faRows: any[] = [];
  for (const pos of ["QB", "RB", "WR", "TE", "K", "DEF"]) faRows.push(...projRows.filter((r) => !rosteredFull.has(r.player_id) && real(r) && posOf(player(r.player_id) ?? { player_id: r.player_id, position: r.player?.position }) === pos).slice(0, 6));
  const stubRows = projRows.filter((r) => !rosteredFull.has(r.player_id) && !real(r)).slice(0, 3);
  const rosteredRows = projRows.filter((r) => kept.has(r.player_id) && real(r)).slice(0, 4);
  const minProj = [...faRows, ...stubRows, ...rosteredRows].map((r, i) => ({
    player_id: r.player_id,
    week: r.week,
    stats: numericStats(r.stats),
    // Keep the embedded player object on two rows only: they exercise the resolver fallback.
    ...(i < 2 && r.player ? { player: { position: r.player.position, fantasy_positions: r.player.fantasy_positions, team: r.player.team, first_name: r.player.first_name, last_name: r.player.last_name, injury_status: r.player.injury_status } } : {}),
  }));
  const fallbackOnly = new Set(minProj.filter((r) => "player" in r).map((r) => r.player_id));

  // Resolver data: public facts for every referenced player (not the fallback-only ones).
  const referenced = new Set([...kept, ...oracleIds, ...txPlayers, ...minProj.map((r) => r.player_id)]);
  const minPlayers = [...referenced]
    .filter((id) => player(id) && !fallbackOnly.has(id))
    .sort()
    .map((id) => {
      const p = player(id) as PlayerRow;
      return {
        id,
        name: p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(" "),
        position: p.position ?? null,
        fantasyPositions: p.fantasy_positions ?? [],
        team: p.team ?? null,
        injuryStatus: p.injury_status || null,
        status: p.status ?? null,
        age: p.age ?? null,
        active: p.active ?? true,
        yearsExp: p.years_exp ?? null,
      };
    });

  const written = new Set<string>();
  const save = (label: string, body: unknown, note?: string) => {
    written.add(label);
    return saveMinimizedFixture(PLATFORM, "test-league", label, body, note ? { note } : {});
  };
  await save("league", minLeague, "non-zero scoring_settings and the settings keys the adapter reads");
  await save("users", minUsers);
  await save("rosters", minRosters, "a subset of each roster: one IR and one taxi player where present, and a small starting core; records and points for/against rebuilt from the synthetic scores");
  for (const [w, rows] of [...minMatchups].sort((a, b) => a[0] - b[0])) {
    const scored = scoredWeeks.includes(w) ? " + synthetic team scores" : "";
    await save(`matchups/${w}`, rows, ORACLE_WEEKS.includes(w) ? `pairs + players_points for a subset${scored}` : w >= playoffStart ? "playoff week: regular-season placeholder pairs (ignored)" : `pairs${scored || " only"}`);
  }
  for (const [leg, rows] of [...minTx].sort((a, b) => a[0] - b[0])) await save(`transactions/${leg}`, rows, "the transactions the tests assert; synthetic IDs; synthetic times (real order kept)");
  await save("traded_picks", minTraded, "one traded pick of this season and three future ones");
  await save("drafts", minDrafts, "synthetic draft IDs");
  await save(`projections/${PROJECTION_WEEK}`, minProj, "public projections: free agents, ADP stubs and a few rostered players");
  for (const s of minStats) await save(`stats/${s.week}`, s.rows, "public stats of the oracle subset, scored keys only");
  await save("players", minPlayers, "public Sleeper player facts (SleeperPlayerLite) for every referenced player");
  await save("meta", { season: SEASON, currentWeek: manifest.currentWeek, lastScoredWeek: manifest.lastScoredWeek, oracleWeeks: ORACLE_WEEKS, projectionWeek: PROJECTION_WEEK, me: { userId: manifest.me.userId, rosterId: manifest.me.rosterId, via: manifest.me.via }, txLegs: [...minTx.keys()].sort((a, b) => a - b) });
  console.log(`test league: ${minRosters.length} rosters, ${kept.size} players kept (IR ${minRosters.reduce((a, r) => a + (r.reserve?.length ?? 0), 0)}, taxi ${minRosters.reduce((a, r) => a + (r.taxi?.length ?? 0), 0)}), ${oracleIds.size} oracle players, ${chosenTx.length} transactions, ${minTraded.length} traded picks, ${minProj.length} projection rows, ${minPlayers.length} player facts, synthetic scores for ${scoredWeeks.length ? `weeks ${scoredWeeks.join(", ")}` : "no week"}`);
  return written;
}

// =============================================================================================
// Cross-league oracle leagues (Phase 0 K.oracleCrossLeague)

async function cachedLeagueJson(url: string): Promise<any> {
  const hit = await readCache<{ status: number; text: string }>("league-sleeper", `sleeper:public:${url}`, Number.POSITIVE_INFINITY);
  return hit?.value.status === 200 ? parseJsonKeepingBigInts(hit.value.text) : undefined;
}

async function cachedPlayersDb(): Promise<Record<string, PlayerRow> | undefined> {
  const hit = await readCache<{ status: number; text: string }>("sleeper-players", "sleeper:https://api.sleeper.app/v1/players/nfl", Number.POSITIVE_INFINITY);
  return hit?.value.status === 200 ? (JSON.parse(hit.value.text) as Record<string, PlayerRow>) : undefined;
}

/**
 * Rule types a Sleeper league can exercise besides per-unit keys (engine/oracle.ts ruleTypesIn):
 * bonus tiers and brackets (threshold, range) and the rush+rec composite. Sleeper maps no byPosition
 * rates (position bonuses are per-unit keys) and no bounded, stepped or per-game rules.
 */
const SPECIAL: readonly RuleType[] = ["threshold", "range", "composite"];
const SUBSET_CAP = 160;
const PER_TYPE = 30;

/** A game at or above the top tier of a bonus family (a 200-yard or 400-yard passing game). */
function reachesUpperTier(c: OracleCase): boolean {
  const s = c.stats;
  const g = (k: string) => s[k] ?? 0;
  return g("pass_yd") >= 400 || g("rec_yd") >= 200 || g("rush_yd") >= 200 || g("rush_yd") + g("rec_yd") >= 200;
}

async function minimizeOracleLeagues(): Promise<void> {
  const file = path.join(ROOT, "fixtures", "raw", "sleeper", "cross-oracle.json");
  if (!existsSync(file)) {
    console.log("cross-league oracle: no fixtures/raw/sleeper/cross-oracle.json; skipped");
    return;
  }
  const leagueIds: string[] = (JSON.parse(readFileSync(file, "utf8")) as { leagueIds?: string[] }).leagueIds ?? [];
  const db = await cachedPlayersDb();
  if (!db) {
    console.log("cross-league oracle: no cached players DB; skipped");
    return;
  }
  const stats = new Map<number, Map<string, StatLine>>();
  for (const w of ORACLE_WEEKS) {
    const rows: StatsRow[] | null = await cachedStatsWeek(SEASON, w);
    if (rows) stats.set(w, new Map(rows.map((r) => [String(r.player_id), numericStats(r.stats)])));
  }
  for (const [index, id] of leagueIds.entries()) {
    // The label follows the league's place in cross-oracle.json, so a league missing from the cache
    // never shifts another league's data under its label.
    const n = index + 1;
    const league = await cachedLeagueJson(`${API}/league/${id}`);
    if (!league) {
      console.log(`oracle league ${n}: not cached; its committed fixture is left as it is (no new requests to strangers' leagues)`);
      continue;
    }
    const scoring = mapSleeperScoring(league.scoring_settings).scoring;
    const keys = statKeysFor(league.scoring_settings);
    const cases: Array<OracleCase & { stats: StatLine }> = [];
    for (const w of ORACLE_WEEKS) {
      const rows = await cachedLeagueJson(`${API}/league/${id}/matchups/${w}`);
      if (!Array.isArray(rows)) continue;
      for (const m of rows)
        for (const pid of m.players ?? []) {
          const pts = m.players_points?.[pid];
          const pos = posOf(db[pid] ? { ...db[pid], player_id: pid } : undefined);
          if (typeof pts !== "number" || !pos) continue;
          cases.push({ source: `sleeper/oracle-league-${n}`, week: w, playerId: pid, pos, stats: stats.get(w)?.get(pid) ?? {}, scoring, expected: pts });
        }
    }
    const full = runOracle(cases);
    console.log(`oracle league ${n}: ${full.within}/${full.total} within ±${tolerance} (${(full.rate * 100).toFixed(1)}%); rule types ${JSON.stringify(full.ruleTypesExercised)}; mismatches ${full.mismatches.length}`);
    // Subset: games that reach a higher bonus tier (they show tiers are exclusive), up to PER_TYPE
    // cases of each special rule type, then a deterministic sample of plain per-unit cases.
    const order = (a: OracleCase, b: OracleCase) => sha(`${a.playerId}|${a.week}`).localeCompare(sha(`${b.playerId}|${b.week}`));
    const chosen = new Set<OracleCase>(cases.filter(reachesUpperTier));
    for (const t of SPECIAL) cases.filter((c) => ruleTypesIn(c).has(t)).sort(order).slice(0, PER_TYPE).forEach((c) => chosen.add(c));
    const special = cases.filter((c) => [...ruleTypesIn(c)].some((t) => SPECIAL.includes(t)));
    const rest = cases.filter((c) => !chosen.has(c) && !special.includes(c)).sort(order);
    const subset = [...chosen, ...rest.slice(0, Math.max(40, SUBSET_CAP - chosen.size))];
    await saveMinimizedFixture(
      PLATFORM,
      "oracle-leagues",
      `oracle-league-${n}`,
      {
        scoring_settings: nonZero(league.scoring_settings),
        roster_positions: league.roster_positions,
        cases: subset
          .sort((a, b) => a.week - b.week || a.playerId.localeCompare(b.playerId))
          .map((c) => ({ sleeperId: c.playerId, pos: c.pos, week: c.week, stats: pick(c.stats, keys), players_points: c.expected })),
      },
      { note: "Phase 0 cross-league oracle league: scoring, slots and a subset of player-weeks only" },
    );
    const upper = cases.filter(reachesUpperTier);
    const upperMissed = upper.filter((c) => full.mismatches.some((m) => m.case === c)).length;
    const kept = runOracle(subset).ruleTypesExercised;
    console.log(`  kept ${subset.length} of ${cases.length} player-weeks (${special.length} tested by ${SPECIAL.join("/")} rules; ${upper.length} upper-tier game(s), ${upper.length - upperMissed} matched); kept subset's rule types ${JSON.stringify(kept)}`);
  }
}

/** Remove a group's committed files (and index entries) this run didn't write, e.g. a transaction leg no longer chosen. */
function pruneGroup(group: string, written: ReadonlySet<string>): void {
  const dir = path.join(ROOT, "fixtures", "sanitized", "min", PLATFORM, group);
  const indexPath = path.join(dir, "index.json");
  if (!existsSync(indexPath)) return;
  const index = JSON.parse(readFileSync(indexPath, "utf8")) as Record<string, { label: string; note?: string }>;
  const stale = Object.entries(index).filter(([, e]) => !written.has(e.label));
  for (const [file] of stale) {
    rmSync(path.join(dir, file), { force: true });
    delete index[file];
  }
  if (stale.length) writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
  console.log(`${group}: ${stale.length} stale fixture file(s) removed`);
}

async function main(): Promise<void> {
  pruneGroup("test-league", await minimizeTestLeague());
  await minimizeOracleLeagues();
}

const isMain = process.argv[1] && /minimize[\\/]sleeper\.ts$/.test(process.argv[1]);
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  });
}
