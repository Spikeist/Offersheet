/**
 * Minimized fixtures of the ESPN public test league (a stranger's league; CLAUDE.md §0.6, planner
 * reply to Checkpoint 0 answer 2). Reads the full sanitized copies in git-ignored
 * data-local/fixtures-sanitized/espn/ (and, for week 2, the Phase 0 probe's own HTTP cache, OFFLINE)
 * and commits only what the ESPN adapter tests read:
 *
 *   fixtures/sanitized/min/espn/public-league/
 *     "league: settings, scoring, roster subset"  settings (scoring, lineup slots, position limits,
 *        schedule shape, trade/draft/FAAB fields), status, and a SUBSET of each roster: its TQB
 *        units, its D/ST, and the TEs whose rushing stats tell the pointsOverrides key readings apart
 *        (Phase 0 K.overrideKeys). No members, owners, records, schedule or activity.
 *     "player pool: week N actual lines" (N = 2, 3)  the week-N actual line (appliedTotal, the stats
 *        the league's scoring reads, and ESPN's own "every N yards/catches" counts for the stepped
 *        oracle) of the top-250 player pool, for the scoring oracle. No roster membership
 *        (onTeamId/status dropped).
 *   Timestamps are shifted by a secret whole-week offset (scripts/lib/minimize.ts).
 *
 * Week 3 comes from the probe's sanitized local copy. Week 2 was fetched by the same Phase 0 probe
 * run (probe-espn.ts: "public kona_player_info pool sp2") and is read from its cache with
 * `offline: true`, so this script never makes a request: a stranger's league isn't fetched again
 * without asking Parker (CLAUDE.md §0.6). Weeks 2–3 match the weeks of Parker's ESPN oracle.
 *
 *   npx tsx scripts/minimize/espn-public-league.ts
 */
import { buildEspnScoring, ESPN_READINGS, keyFor, type EspnReading } from "@/adapters/espn/scoringMap";
import { summarizeSlots } from "@/adapters/espn/normalize";
import { POSITION_ID } from "@/adapters/espn/positions";
import { POSITIONS, type Pos } from "@/engine/model";
import { scoringStatKeys } from "@/engine/scoring";
import { sha256 } from "../lib/cache";
import { leagueCall } from "../lib/espn/client";
import { playerPoolFilter } from "../lib/espn/filters";
import { request } from "../lib/http";
import { installConsoleScrubber } from "../lib/redact";
import { readLocalFixture, saveMinimizedFixture, shiftTimestamps, timestampShiftMs } from "../lib/minimize";

const LEAGUE_LABEL = "public-league/{publicLeagueId}/view=mSettings+mTeam+mRoster+mStatus";
const POOL_LABEL = (week: number) => `public-league/{publicLeagueId}/view=kona_player_info&scoringPeriodId=${week} (player pool, top 250 by % owned)`;
export const MIN_GROUP = "public-league";
export const MIN_LEAGUE = "league: settings, scoring, roster subset";
export const MIN_POOL = (week: number) => `player pool: week ${week} actual lines`;
/** CLAUDE.md §2.2's pinned public test league (the same ID as scripts/probe-espn.ts), needed for the probe's cache key. */
const PUBLIC_LEAGUE_ID = "899513";
const SEASON = 2026;
/** The probe's pool size for the public league (probe-espn.ts PUBLIC_POOL). */
const PUBLIC_POOL = 250;
/** Weeks with committed pool lines; the roster subset carries week 3's line (the league view's latest completed week). */
const POOL_WEEKS = [2, 3];
const ROSTER_WEEK = 3;
const TE_ID = 4;

type Json = Record<string, unknown>;
interface StatLine {
  seasonId: number;
  scoringPeriodId: number;
  statSourceId: number;
  statSplitTypeId: number;
  appliedTotal?: number;
  stats?: Record<string, number>;
}
interface Player {
  id: number;
  fullName: string;
  defaultPositionId: number;
  eligibleSlots: number[];
  proTeamId: number;
  injuryStatus?: string;
  stats?: StatLine[];
}
interface Pool {
  players: Array<{ id: number; player: Player }>;
}

/** ESPN stat ids that feed a canonical key (every reading that toCanonicalStats uses as a source). */
function sourceIdsOf(keys: ReadonlySet<string>): Set<number> {
  const out = new Set<number>();
  for (const [id, r] of Object.entries(ESPN_READINGS) as Array<[string, EspnReading]>) {
    const reads = (ref: Parameters<typeof keyFor>[0]) => POSITIONS.some((p: Pos) => keys.has(keyFor(ref, p)));
    if ((r.kind === "stat" || r.kind === "part") && reads(r.stat)) out.add(Number(id));
    if (r.kind === "composite" && r.source && r.keys.some((k) => keys.has(k))) out.add(Number(id));
    if (r.kind === "perGame") out.add(Number(id));
  }
  return out;
}

/** ESPN's derived "every N" counts on a plain stat (every 5 passing yards …): evidence for the stepped oracle. */
function everyNIds(): Set<number> {
  return new Set(
    (Object.entries(ESPN_READINGS) as Array<[string, EspnReading]>)
      .filter(([, r]) => r.kind === "every" && typeof r.stat === "string")
      .map(([id]) => Number(id)),
  );
}

/** The week-2 pool, from the Phase 0 probe's HTTP cache (same URL, filter, key and namespace as probe-espn.ts); never fetched. */
async function cachedPool(week: number): Promise<Pool> {
  const call = leagueCall({ label: `public kona_player_info pool sp${week}`, season: SEASON, leagueId: PUBLIC_LEAGUE_ID, params: [["view", "kona_player_info"], ["scoringPeriodId", week]], filter: playerPoolFilter(PUBLIC_POOL, 0) });
  const key = `${call.url}#${sha256(JSON.stringify(call.filter)).slice(0, 16)}`;
  const res = await request(call.url, { offline: true, cache: { key: `espn:public:${key}`, ttlMs: Number.POSITIVE_INFINITY, namespace: "league-espn" }, label: `ESPN ${call.label} (probe cache)` });
  const body = res.json as Pool | undefined;
  if (!res.ok || !Array.isArray(body?.players)) throw new Error(`the probe's cached week-${week} pool isn't usable (HTTP ${res.status})`);
  return body;
}

async function main(): Promise<void> {
  installConsoleScrubber();
  const league = readLocalFixture<Json & { settings: Json; status: Json; teams: Json[]; seasonId: number; id: number; scoringPeriodId?: number }>("espn", LEAGUE_LABEL);
  const pools = new Map<number, Pool>();
  for (const week of POOL_WEEKS) pools.set(week, week === ROSTER_WEEK ? readLocalFixture<Pool>("espn", POOL_LABEL(week)) : await cachedPool(week));
  const s = league.settings as {
    size: number;
    isPublic?: boolean;
    scoringSettings: { scoringItems: Array<{ statId: number; points: number; pointsOverrides?: Record<string, number> | null; isReverseItem?: boolean }>; scoringType?: string; scoringEnhancementType?: string; homeTeamBonus?: number; playoffHomeTeamBonus?: number };
    rosterSettings: { lineupSlotCounts: Record<string, number>; positionLimits?: Record<string, number>; isBenchUnlimited?: boolean };
    scheduleSettings: Json & { divisions?: Array<{ id: number; size?: number }> };
    tradeSettings: Json;
    draftSettings?: Json;
    acquisitionSettings?: Json;
  };
  const items = s.scoringSettings.scoringItems.map((i) => ({ statId: i.statId, points: i.points, ...(i.pointsOverrides ? { pointsOverrides: i.pointsOverrides } : {}), ...(i.isReverseItem !== undefined ? { isReverseItem: i.isReverseItem } : {}) }));

  // The stats a test reads: every stat the league scores, every source of a scored canonical key, and
  // ESPN's every-N counts (the stepped oracle compares the engine's floor with them).
  const slots = summarizeSlots(s.rosterSettings.lineupSlotCounts, []);
  const { scoring } = buildEspnScoring(items, slots.scoringCtx);
  const keep = new Set<number>([...items.map((i) => i.statId), ...sourceIdsOf(scoringStatKeys(scoring)), ...everyNIds()]);
  const trimLine = (l: StatLine): StatLine => ({
    seasonId: l.seasonId,
    scoringPeriodId: l.scoringPeriodId,
    statSourceId: l.statSourceId,
    statSplitTypeId: l.statSplitTypeId,
    ...(l.appliedTotal !== undefined ? { appliedTotal: l.appliedTotal } : {}),
    stats: Object.fromEntries(Object.entries(l.stats ?? {}).filter(([k]) => keep.has(Number(k)))),
  });
  const actual = (p: Player, week: number) => (p.stats ?? []).find((l) => l.seasonId === SEASON && l.statSourceId === 0 && l.statSplitTypeId === 1 && l.scoringPeriodId === week);
  const rushes = (p: Player) => {
    const a = actual(p, ROSTER_WEEK)?.stats ?? {};
    return (a["24"] ?? 0) !== 0 || (a["25"] ?? 0) !== 0 || (a["26"] ?? 0) !== 0;
  };
  const minPlayer = (p: Player) => {
    const a = actual(p, ROSTER_WEEK);
    return { id: p.id, fullName: p.fullName, defaultPositionId: p.defaultPositionId, eligibleSlots: p.eligibleSlots, proTeamId: p.proTeamId, ...(p.injuryStatus ? { injuryStatus: p.injuryStatus } : {}), stats: a ? [trimLine(a)] : [] };
  };

  // A subset of each roster: TQB units, the D/ST, and discriminating TEs (rushing stats).
  let kept = 0;
  const teams = league.teams.map((t) => {
    const entries = ((t.roster as { entries?: Array<{ playerId: number; lineupSlotId: number; playerPoolEntry: { id: number; player: Player } }> } | undefined)?.entries ?? []).filter((e) => {
      const p = e.playerPoolEntry.player;
      return p.defaultPositionId === POSITION_ID.TQB || p.defaultPositionId === POSITION_ID.DST || (p.defaultPositionId === TE_ID && rushes(p));
    });
    kept += entries.length;
    return { id: t.id as number, name: `Team ${String(t.id)}`, divisionId: t.divisionId as number, roster: { entries: entries.map((e) => ({ playerId: e.playerId, lineupSlotId: e.lineupSlotId, playerPoolEntry: { id: e.playerPoolEntry.id, player: minPlayer(e.playerPoolEntry.player) } })) } };
  });

  const pick = (o: Json | undefined, keys: string[]) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o?.[k]]));
  const minLeague = {
    id: league.id,
    seasonId: league.seasonId,
    settings: {
      name: "Public test league",
      size: s.size,
      isPublic: s.isPublic,
      scoringSettings: { scoringItems: items, ...pick(s.scoringSettings as Json, ["scoringType", "scoringEnhancementType", "homeTeamBonus", "playoffHomeTeamBonus"]) },
      rosterSettings: pick(s.rosterSettings as Json, ["lineupSlotCounts", "positionLimits", "isBenchUnlimited"]),
      scheduleSettings: {
        ...pick(s.scheduleSettings, ["matchupPeriodCount", "matchupPeriods", "playoffTeamCount", "playoffMatchupPeriodLength", "playoffMatchupPeriodLengthByRound", "variablePlayoffMatchupPeriodLength", "playoffReseed", "playoffSeedingRule"]),
        divisions: (s.scheduleSettings.divisions ?? []).map((d) => ({ id: d.id, size: d.size })),
      },
      tradeSettings: pick(s.tradeSettings, ["deadlineDate", "vetoVotesRequired", "revisionHours"]),
      draftSettings: pick(s.draftSettings, ["keeperCount", "keeperCountFuture"]),
      acquisitionSettings: pick(s.acquisitionSettings, ["isUsingAcquisitionBudget", "acquisitionBudget"]),
    },
    status: pick(league.status, ["currentMatchupPeriod", "latestScoringPeriod", "firstScoringPeriod", "finalScoringPeriod", "isActive"]),
    teams,
  };

  const minPool = (week: number) => ({
    week,
    players: (pools.get(week) as Pool).players
      .map((x) => x.player)
      .filter((p) => actual(p, week))
      .map((p) => ({ id: p.id, player: { id: p.id, defaultPositionId: p.defaultPositionId, stats: [trimLine(actual(p, week) as StatLine)] } })),
  });

  const shift = timestampShiftMs("espn");
  const a = await saveMinimizedFixture("espn", MIN_GROUP, MIN_LEAGUE, shiftTimestamps(minLeague, shift), { note: `settings + scoring + ${kept} roster entries (TQB, D/ST, rushing TEs); timestamps shifted` });
  console.log(`saved ${a} (${kept} roster entries)`);
  for (const week of POOL_WEEKS) {
    const body = minPool(week);
    const file = await saveMinimizedFixture("espn", MIN_GROUP, MIN_POOL(week), body, { note: `${body.players.length} week-${week} actual lines, stats trimmed to ${keep.size} scored/source/every-N stat ids; no roster membership${week === ROSTER_WEEK ? "" : "; read offline from the Phase 0 probe's cache"}` });
    console.log(`saved ${file} (${body.players.length} week-${week} lines)`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
