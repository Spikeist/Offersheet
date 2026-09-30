/**
 * ESPN's league-scored weekly projections for the projection model (CLAUDE.md §6 step 1, "ESPN
 * leagues"; Phase 2). PURE: it reads the responses fetch.ts already collected for the import, so the
 * model needs no extra ESPN request.
 *
 * What the league endpoint gives (Parker's league; projections.test.ts checks it on the sanitized
 * fixtures):
 * - mRoster (the main league request, no scoringPeriodId): every rostered player's projection for the
 *   previous and the current scoring period (weeks 3 and 4 at week 4).
 * - The free-agent kona_player_info lists (requested for the current period): that period only.
 * - A weekly projection line has statSourceId 1 (projected) and statSplitTypeId 1 (one scoring
 *   period); its scoringPeriodId is the NFL week. Its appliedTotal is the projection in THIS league's
 *   scoring: Σ stat × the league's scoring items, pointsOverrides included, on every line.
 * - A line with no stats (appliedTotal 0) means ESPN doesn't project him that week: in Parker's league
 *   every player listed out, doubtful, on IR or day-to-day has one, and so do some questionable ones.
 *   That is null here, "not projected", like a Sleeper stub (ModelInputs PlayerInputs.espn); a
 *   projected line worth exactly 0 is null too.
 *
 * Lenient: every player and line is checked on its own, so a malformed line, player or response is
 * skipped and never throws. ESPN ids become canonical ids through the snapshot (PlayerInfo.ids.espn);
 * players the snapshot doesn't carry (free agents outside the top 50 per position, head coaches) are
 * skipped.
 */
import { z } from "zod";
import type { LeagueSnapshot } from "@/engine/model";
import type { EspnRawBundle } from "./normalize";

/** Canonical player id → NFL week → ESPN's projection in league points (null = not projected that week). */
export type EspnProjections = Record<string, Record<number, number | null>>;

/** statSourceId 1 = projected; statSplitTypeId 1 = one scoring period (schema.ts StatEntrySchema). */
const PROJECTED = 1;
const ONE_PERIOD = 1;

/** Any player object in an ESPN body, trimmed to his id and stat lines (each line is checked on its own). */
const PlayerLinesSchema = z.object({ id: z.number(), stats: z.array(z.unknown()).nullish() });

/** A weekly projection line, once its source, split and season have matched. */
const ProjectionLineSchema = z.object({
  scoringPeriodId: z.number().int().positive(),
  stats: z.record(z.string(), z.unknown()).nullish(),
  appliedTotal: z.number().nullish(),
});

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const fieldOf = (x: unknown, key: string): unknown => (isRecord(x) ? x[key] : undefined);
const listOf = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

/** Rostered players in the league body (mRoster): teams[].roster.entries[].playerPoolEntry.player. */
function rosteredPlayers(league: unknown): unknown[] {
  return listOf(fieldOf(league, "teams")).flatMap((team) => listOf(fieldOf(fieldOf(team, "roster"), "entries")).map((entry) => fieldOf(fieldOf(entry, "playerPoolEntry"), "player")));
}

/** Players in the free-agent lists (kona_player_info): players[].player of each response. */
function poolPlayers(responses: unknown): unknown[] {
  return listOf(responses).flatMap((response) => listOf(fieldOf(response, "players")).map((row) => fieldOf(row, "player")));
}

/**
 * One stat line → [NFL week, league points or null], or undefined when it isn't one of this season's
 * weekly projections or can't be read (a projected line without a league-scored total included).
 */
function projectionOf(line: unknown, season: number): [week: number, points: number | null] | undefined {
  if (!isRecord(line) || line.statSourceId !== PROJECTED || line.statSplitTypeId !== ONE_PERIOD || line.seasonId !== season) return undefined;
  const parsed = ProjectionLineSchema.safeParse(line);
  if (!parsed.success) return undefined;
  const { scoringPeriodId: week, stats, appliedTotal } = parsed.data;
  const projected = Object.values(stats ?? {}).some((v) => typeof v === "number");
  if (!projected) return [week, null];
  if (typeof appliedTotal !== "number") return undefined;
  return [week, appliedTotal === 0 ? null : appliedTotal];
}

/**
 * ESPN's league-scored projection (appliedTotal) by canonical id and NFL week, for the snapshot's
 * players: rostered players get the previous and the current week, free agents the current week.
 * Players without a single weekly projection line are left out. Rosters are read first, then the
 * free-agent lists, and the first line for a player's week wins.
 */
export function espnProjectionsFrom(raw: EspnRawBundle, snapshot: LeagueSnapshot): EspnProjections {
  const canonical = new Map<string, string>();
  for (const [id, info] of Object.entries(snapshot.players)) {
    const espnId = info.ids.espn;
    if (espnId !== undefined && !canonical.has(espnId)) canonical.set(espnId, id);
  }
  const out: EspnProjections = {};
  for (const player of [...rosteredPlayers(raw.league), ...poolPlayers(raw.freeAgents)]) {
    const parsed = PlayerLinesSchema.safeParse(player);
    if (!parsed.success) continue;
    const id = canonical.get(String(parsed.data.id));
    if (id === undefined) continue;
    for (const line of parsed.data.stats ?? []) {
      const projection = projectionOf(line, snapshot.season);
      if (!projection) continue;
      const [week, points] = projection;
      const weeks = (out[id] ??= {});
      if (!(week in weeks)) weeks[week] = points;
    }
  }
  return out;
}
