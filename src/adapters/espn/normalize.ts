/**
 * ESPN responses → LeagueSnapshot (CLAUDE.md §2.2, §4). PURE: no I/O, no clock (ctx.now is passed
 * in), so adapter tests run it on sanitized fixtures with no network.
 *
 * Settings rules (Phase 0 evidence in reports/probe-output/espn.md; planner reply to Checkpoint 0):
 * - Lineup: settings.rosterSettings.lineupSlotCounts; slot ids and labels from espn-api (./constants).
 * - Weeks: settings.scheduleSettings.matchupPeriods (matchup period → NFL weeks); periods after
 *   matchupPeriodCount are the playoffs. Playoff byes are DERIVED (next power of two − playoff teams).
 *   playoffMatchupPeriodLength is only cross-checked against matchupPeriods (warning on a mismatch).
 * - Trade review (planner answer 12, "trust what the API reports"): a 0-hour review period → none
 *   (trades process at once, whatever the veto votes); vetoVotesRequired > 0 → league_vote.
 *   INFERRED: a review period (revisionHours > 0) with no veto votes → commissioner.
 * - League type: keeperCount and keeperCountFuture both 0 → redraft (verified). INFERRED: the larger
 *   of the two ≥ the active roster → dynasty, else keeper (no ESPN keeper/dynasty league was
 *   available to verify; ESPN has no flag; keeperCountFuture read as next season's keepers).
 * - Position limits: rosterSettings.positionLimits read as max players per defaultPositionId
 *   (−1 = no limit): INFERRED, not documented.
 * - Median game: scoringEnhancementType WIN_BONUS_TOP_HALF (espn-api's reading).
 * - Seeding: playoffReseed when ESPN reports it; otherwise unknown (fixed bracket assumed, warned).
 * - Transactions: EXECUTED rows only (proposals, declines, cancelled or failed claims and lineup
 *   moves are not roster changes), deduped by id across the per-period requests. A trade answered by
 *   both TRADE_ACCEPT and TRADE_UPHOLD counts once (same proposal, own id or trade legs). An accepted
 *   trade still in review (no status, as seen live, or PENDING) isn't counted; the Import Report says
 *   so, and compares with ESPN's own per-team trade counters (teams[].transactionCounter).
 * - Injury return weeks: kona_playercard injuryDetails.expectedReturnDate → NFL week (weeks.ts).
 * - SWIDs: the fetch step replaced them with pseudonyms (fetch.ts); owners and members are matched
 *   in that form, and ctx.swid is the cookie holder's pseudonym. None reaches the snapshot.
 */
import type { PlayerIdResolver } from "@/data/types";
import { config } from "@/engine/config";
import type { ImportWarning, LeagueSettings, LeagueSnapshot, Matchup, PlayerInfo, Pos, SlotDef, Team, Transaction, UnknownSetting } from "@/engine/model";
import { ESPN_PRO_TEAMS } from "./constants";
import { POSITION_ID, SLOT, eligiblePositions, mapInjury, positionIdsFor, positionOf, slotInfo } from "./positions";
import { buildEspnScoring, type ScoringContext } from "./scoringMap";
import {
  LeagueSchema,
  PlayerCardSchema,
  PlayerListResponseSchema,
  PoolPlayerSchema,
  ProTeamSchedulesSchema,
  TransactionSchema,
  TransactionsResponseSchema,
  parseEspn,
  type EspnLeague,
  type EspnPlayer,
  type EspnPoolPlayer,
  type EspnProTeam,
  type EspnTransaction,
} from "./schema";
import { weekOfCalendarDate, weekOfInstant, weekWindows, type WeekWindow } from "./weeks";

/** CLAUDE.md §4: freeAgents = the top 50 per position by projection (config.import). */
export const FREE_AGENTS_PER_POSITION = config.import.freeAgentsPerPosition;

/** What fetch.ts collected (raw JSON; normalize validates it with zod). */
export interface EspnRawBundle {
  /** view=mSettings&view=mTeam&view=mRoster&view=mMatchup&view=mStatus */
  league: unknown;
  /** One view=mTransactions2&scoringPeriodId=N response per scoring period (rows deduped by id). */
  transactions?: unknown[];
  /** view=kona_player_info free-agent responses (one per position). */
  freeAgents?: unknown[];
  /** view=kona_playercard responses for injured rostered players (expected return dates). */
  playerCards?: unknown[];
  /** GET /seasons/{season}?view=proTeamSchedules_wl (the NFL schedule: trade-deadline and return weeks). */
  proTeamSchedules?: unknown;
}

export interface EspnNormalizeContext {
  leagueId: string;
  resolver: PlayerIdResolver;
  now: Date;
  /**
   * The cookie holder's SWID in the same form as the SWIDs in the bodies (only with credentials),
   * used to find "my team". fetch.ts passes its one-way pseudonym, as the bodies carry pseudonyms.
   */
  swid?: string;
  /** The team the user picked (public leagues without cookies). */
  myTeamId?: string;
  /** Warnings from the fetch step (a secondary view that failed, …). */
  warnings?: ImportWarning[];
}

export interface EspnNormalized {
  snapshot: LeagueSnapshot;
  /** Short notes for the Import Report: settings we derived or inferred rather than read. */
  notes: string[];
}

const iso = (ms: number) => new Date(ms).toISOString();
/** ESPN points carry float noise (307.09999999999997); they have at most two decimals. */
const round2 = (x: number) => Math.round(x * 100) / 100;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "{guid}" in any case, with or without braces → "{GUID}" for comparison (also a fetch.ts pseudonym). */
export function normalizeSwid(swid: string): string {
  const inner = swid.trim().replace(/^\{/, "").replace(/\}$/, "");
  return `{${inner.toUpperCase()}}`;
}

function safeParse<T>(fn: () => T, warnings: ImportWarning[], code: string, message: string, platformPath: string): T | undefined {
  try {
    return fn();
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    warnings.push({ code, message: `${message} (${why})`, platformPath });
    return undefined;
  }
}

/** Rows of several secondary responses, each row validated on its own; bad envelopes and rows become one warning each. */
function rowsOf<T>(responses: unknown[] | undefined, rowsIn: (r: unknown) => unknown[], rowSchema: { safeParse(x: unknown): { success: true; data: T } | { success: false } }, warnings: ImportWarning[], w: { code: string; what: string; path: string }): T[] {
  const out: T[] = [];
  let badRows = 0;
  (responses ?? []).forEach((r, i) => {
    const rows = safeParse(() => rowsIn(r), warnings, w.code, `Some ${w.what} data couldn't be read`, `${w.path}[${i}]`) ?? [];
    for (const row of rows) {
      const p = rowSchema.safeParse(row);
      if (p.success) out.push(p.data);
      else badRows++;
    }
  });
  if (badRows) warnings.push({ code: w.code, message: `${badRows} ${w.what} row(s) came in a shape we don't recognize and were skipped.`, platformPath: `${w.path}[]` });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Players

interface PlayerMapper {
  info(p: EspnPlayer): PlayerInfo | null;
  /** Canonical id for an ESPN player id seen only in a transaction. */
  idForEspnId(espnId: number): string;
  skipped: {
    hc: number;
    unknown: Map<number, number>;
    unknownInjury: Map<string, number>;
    collisions: number;
    tqb: number;
    byName: Array<{ espnId: number; label: string }>;
    /** ESPN ids the ID sources map to different Sleeper players (resolver.conflict). */
    conflicts: Array<{ espnId: number; label: string }>;
  };
}

/** ESPN team defenses have id −(16000 + proTeamId) (Phase 0 E.playerIds; asserted in normalize.test.ts). */
const DST_ID_BASE = 16000;

function playerMapper(resolver: PlayerIdResolver, returnWeekOf: (espnId: number) => number | undefined): PlayerMapper {
  const byEspnId = new Map<number, PlayerInfo | null>();
  const owner = new Map<string, number>();
  const skipped: PlayerMapper["skipped"] = { hc: 0, unknown: new Map(), unknownInjury: new Map(), collisions: 0, tqb: 0, byName: [], conflicts: [] };

  const teamCode = (proTeamId: number): string | null => {
    const abbr = ESPN_PRO_TEAMS[proTeamId];
    if (!abbr || abbr === "None") return null;
    return resolver.defenseId(abbr) ?? abbr;
  };
  const claim = (id: string, espnId: number): boolean => {
    const o = owner.get(id);
    if (o !== undefined && o !== espnId) return false;
    owner.set(id, espnId);
    return true;
  };
  const canonical = (espnId: number, pos: Pos | null, proTeamId: number, name?: string): { id: string; sleeper?: string } => {
    let sleeper: string | undefined;
    const abbr = ESPN_PRO_TEAMS[proTeamId];
    const team = abbr && abbr !== "None" ? abbr : null;
    if (pos === "DEF") sleeper = team ? resolver.defenseId(team) : undefined;
    else {
      sleeper = resolver.canonical("espn", String(espnId));
      if (sleeper && resolver.conflict?.("espn", String(espnId))) skipped.conflicts.push({ espnId, label: `${name ?? `ESPN player ${espnId}`}${pos ? ` (${pos})` : ""}` });
      // Last resort for a player no ID source maps (a rookie kicker in Phase 1): the only active
      // player with this exact name, position and NFL team. Every such match is reported.
      if (!sleeper && name && pos && espnId > 0 && resolver.matchByName) {
        sleeper = resolver.matchByName({ name, position: pos, team });
        if (sleeper) skipped.byName.push({ espnId, label: `${name} (${pos}${team ? `, ${team}` : ""})` });
      }
    }
    if (sleeper && claim(sleeper, espnId)) return { id: sleeper, sleeper };
    if (sleeper) skipped.collisions++;
    const fallback = `espn:${espnId}`;
    claim(fallback, espnId);
    return { id: fallback };
  };

  return {
    skipped,
    info(p) {
      if (byEspnId.has(p.id)) return byEspnId.get(p.id) ?? null;
      const { name, pos } = positionOf(p.defaultPositionId);
      if (!pos) {
        if (p.defaultPositionId === POSITION_ID.HC) skipped.hc++;
        else skipped.unknown.set(p.defaultPositionId, (skipped.unknown.get(p.defaultPositionId) ?? 0) + 1);
        byEspnId.set(p.id, null);
        return null;
      }
      if (name === "TQB") skipped.tqb++;
      const { id, sleeper } = canonical(p.id, pos, p.proTeamId, p.fullName);
      const injury = mapInjury(p.injuryStatus);
      if (!injury.known) skipped.unknownInjury.set(String(p.injuryStatus), (skipped.unknownInjury.get(String(p.injuryStatus)) ?? 0) + 1);
      const age = sleeper && pos !== "DEF" ? resolver.sleeperPlayer(sleeper)?.age : undefined;
      const returnWeek = injury.injury !== "ACTIVE" ? returnWeekOf(p.id) : undefined;
      const info: PlayerInfo = {
        id,
        name: p.fullName,
        pos,
        eligible: eligiblePositions(pos, p.eligibleSlots),
        nflTeam: teamCode(p.proTeamId),
        injury: injury.injury,
        ...(returnWeek !== undefined ? { injuryReturnWeek: returnWeek } : {}),
        ...(typeof age === "number" ? { age } : {}),
        ids: { espn: String(p.id), ...(sleeper ? { sleeper } : {}) },
      };
      byEspnId.set(p.id, info);
      return info;
    },
    idForEspnId(espnId) {
      const known = byEspnId.get(espnId);
      if (known) return known.id;
      if (espnId < 0) {
        const proTeamId = -espnId - DST_ID_BASE;
        return canonical(espnId, "DEF", proTeamId).id;
      }
      return canonical(espnId, null, 0).id;
    },
  };
}

/**
 * ESPN's expected return per injured player (kona_playercard): the NFL week of injuryDetails.
 * expectedReturnDate, or the week after the season when ESPN says he's out for the season.
 */
function returnWeeksOf(cards: ReadonlyArray<{ player: { id: number; injuryDetails?: { expectedReturnDate?: number[] | null; outForSeason?: boolean | null } | null } }>, windows: readonly WeekWindow[]): Map<number, number> {
  const out = new Map<number, number>();
  const last = windows[windows.length - 1];
  if (!last) return out;
  for (const c of cards) {
    const d = c.player.injuryDetails;
    if (!d) continue;
    const week = d.outForSeason ? last.week + 1 : d.expectedReturnDate ? weekOfCalendarDate(d.expectedReturnDate, windows) : undefined;
    if (week !== undefined) out.set(c.player.id, week);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Settings

interface SlotSummary {
  lineup: SlotDef[];
  benchSlots: number;
  irSlots: number;
  maxRosterSize: number;
  scoringCtx: ScoringContext;
  /** Positions the lineup can start (free agents are fetched for these). */
  positions: Pos[];
}

/** FLEX (slot 23) is listed right after TE, as ESPN shows it. */
const slotOrder = (id: number) => (id === 23 ? 6.5 : id);

export function summarizeSlots(counts: Readonly<Record<string, number>>, warnings: ImportWarning[]): SlotSummary {
  const count = (id: number) => counts[String(id)] ?? 0;
  const lineup: SlotDef[] = [];
  let modeledStarters = 0;
  const idpSpecific: string[] = [];
  let idp = false;
  const ids = Object.keys(counts)
    .map(Number)
    .filter((id) => (counts[String(id)] ?? 0) > 0)
    .sort((a, b) => slotOrder(a) - slotOrder(b));
  for (const id of ids) {
    const n = count(id);
    const s = slotInfo(id);
    if (!s.starting) continue;
    const path = `settings.rosterSettings.lineupSlotCounts["${id}"]`;
    if (!s.eligible) {
      if (id === SLOT.HC) warnings.push({ code: "ESPN_HC_UNMAPPED", message: `The league starts ${n} head coach${n > 1 ? "es" : ""} (HC); head coaches aren't supported, so that slot is left out of lineups.`, platformPath: path });
      else warnings.push({ code: "ESPN_SLOT_UNKNOWN", message: `The league has ${n} lineup slot${n > 1 ? "s" : ""} of a kind we don't know (${s.label ?? `id ${id}`}); left out of lineups.`, platformPath: path });
      continue;
    }
    if (s.eligible.some((p) => p === "DL" || p === "LB" || p === "DB")) idp = true;
    if (s.label && ["DT", "DE", "CB", "S"].includes(s.label)) idpSpecific.push(s.label);
    lineup.push({ slot: s.name, count: n, eligible: s.eligible });
    modeledStarters += n;
  }
  if (idp)
    warnings.push({
      code: "ESPN_IDP_UNVERIFIED",
      message: `This league starts individual defensive players. ESPN IDP support is unverified (no ESPN IDP league was available to test)${idpSpecific.length ? `, and ESPN's ${[...new Set(idpSpecific)].join("/")} slots are modeled as DL (DT, DE) or DB (CB, S)` : ""}.`,
      platformPath: "settings.rosterSettings.lineupSlotCounts",
    });
  const tqb = count(SLOT.TQB) > 0;
  const qbKind = count(SLOT.QB) > 0 || count(SLOT.OP) > 0;
  const benchSlots = count(SLOT.BENCH);
  return {
    lineup,
    benchSlots,
    irSlots: count(SLOT.IR),
    maxRosterSize: modeledStarters + benchSlots,
    scoringCtx: { qbSource: tqb && !qbKind ? "TQB" : "QB", bothQbKinds: tqb && qbKind, startsHeadCoach: count(SLOT.HC) > 0 },
    positions: [...new Set(lineup.flatMap((s) => s.eligible))],
  };
}

/** positionLimits keyed by defaultPositionId (−1 = no limit) → per Pos (INFERRED reading). */
function positionLimitsOf(limits: Readonly<Record<string, number>> | null | undefined, qbSource: "QB" | "TQB"): Partial<Record<Pos, number>> | undefined {
  if (!limits) return undefined;
  const out: Partial<Record<Pos, number>> = {};
  for (const pos of ["QB", "RB", "WR", "TE", "K", "P", "DEF", "DL", "LB", "DB"] as const) {
    let ids = positionIdsFor(pos);
    if (pos === "QB") ids = [qbSource === "TQB" ? POSITION_ID.TQB : POSITION_ID.QB];
    const values = ids.map((id) => limits[String(id)]).filter((v): v is number => v !== undefined);
    if (!values.length || values.some((v) => v < 0)) continue;
    out[pos] = values.reduce((a, b) => a + b, 0);
  }
  return Object.keys(out).length ? out : undefined;
}

function tradeReviewOf(ts: EspnLeague["settings"]["tradeSettings"], notes: string[], unknown: UnknownSetting[]): LeagueSettings["tradeReview"] {
  const votes = ts.vetoVotesRequired ?? undefined;
  const hours = ts.revisionHours ?? undefined;
  if (votes === undefined && hours === undefined) {
    unknown.push("tradeReview");
    notes.push("ESPN didn't report how trades are reviewed; we assume no review.");
    return "none";
  }
  if (hours === 0) {
    // A 0-hour review period: accepted trades go through at once, so veto votes can't act.
    if (votes && votes > 0) notes.push(`Trade review: ESPN lists ${plural(votes, "veto vote")} but a 0-hour review period, so trades process at once; read as no review.`);
    return "none";
  }
  if (votes && votes > 0) {
    notes.push(`Trade review: ESPN reports a ${hours !== undefined ? `${hours}-hour review` : "review (length not reported)"} in which ${plural(votes, "vote")} veto a trade (read as a league vote).`);
    return "league_vote";
  }
  if (hours && hours > 0) {
    notes.push(`Trade review: ESPN reports a ${hours}-hour review period and no veto votes; we assume the commissioner reviews trades (inferred).`);
    return "commissioner";
  }
  return "none";
}

function settingsOf(L: EspnLeague, slots: SlotSummary, proTeams: EspnProTeam[] | undefined, warnings: ImportWarning[], notes: string[]): LeagueSettings {
  const s = L.settings;
  const sch = s.scheduleSettings;
  const unknown: UnknownSetting[] = [];
  const periods = Object.entries(sch.matchupPeriods)
    .map(([mp, weeks]) => ({ mp: Number(mp), weeks: [...weeks].sort((a, b) => a - b) }))
    .filter((x) => Number.isFinite(x.mp))
    .sort((a, b) => a.mp - b.mp);
  const regular = periods.filter((x) => x.mp <= sch.matchupPeriodCount);
  const playoff = periods.filter((x) => x.mp > sch.matchupPeriodCount);
  const multiWeek = regular.filter((x) => x.weeks.length > 1);
  if (multiWeek.length)
    warnings.push({ code: "ESPN_MULTIWEEK_MATCHUPS", message: `Some regular-season matchups span several NFL weeks (${multiWeek.map((x) => `period ${x.mp}: weeks ${x.weeks.join("+")}`).join("; ")}); each is listed once, in its first week.`, platformPath: "settings.scheduleSettings.matchupPeriods" });
  if (!playoff.length) warnings.push({ code: "ESPN_NO_PLAYOFF_WEEKS", message: "ESPN lists no playoff matchup periods for this league.", platformPath: "settings.scheduleSettings.matchupPeriods" });

  // Round lengths: matchupPeriods is what ESPN schedules; the length settings are only cross-checked.
  const roundWeeks = playoff.map((x) => x.weeks.length);
  const byRound = Object.entries(sch.playoffMatchupPeriodLengthByRound ?? {}).filter(([k]) => Number.isInteger(Number(k)) && Number(k) >= 1 && Number(k) <= roundWeeks.length);
  const lengthMismatch = sch.variablePlayoffMatchupPeriodLength && byRound.length ? byRound.some(([k, v]) => roundWeeks[Number(k) - 1] !== v) : typeof sch.playoffMatchupPeriodLength === "number" && sch.playoffMatchupPeriodLength > 0 && roundWeeks.some((n) => n !== sch.playoffMatchupPeriodLength);
  if (lengthMismatch)
    warnings.push({
      code: "ESPN_PLAYOFF_ROUND_LENGTH",
      message: `ESPN's settings give playoff rounds of ${sch.variablePlayoffMatchupPeriodLength && byRound.length ? byRound.map(([k, v]) => `${v} (round ${k})`).join(", ") : sch.playoffMatchupPeriodLength} week(s), but its schedule has playoff rounds of ${roundWeeks.join(", ")} week(s); we follow the schedule.`,
      platformPath: "settings.scheduleSettings.playoffMatchupPeriodLength",
    });

  const teams = sch.playoffTeamCount;
  const rounds = playoff.length;
  const bracket = teams > 1 ? 2 ** Math.ceil(Math.log2(teams)) : teams;
  const byes = Math.max(0, bracket - teams);
  if (teams > 1 && rounds && Math.ceil(Math.log2(teams)) !== rounds)
    warnings.push({ code: "ESPN_PLAYOFF_BRACKET_UNCLEAR", message: `${teams} playoff teams don't fit ${rounds} playoff round(s) as a standard bracket; byes may be wrong.`, platformPath: "settings.scheduleSettings.playoffTeamCount" });
  if (byes) notes.push(`Playoff byes are derived from the bracket, not read from ESPN: ${teams} teams → ${byes} bye${byes > 1 ? "s" : ""} for the top seed${byes > 1 ? "s" : ""}.`);

  const deadline = s.tradeSettings.deadlineDate;
  let tradeDeadline: LeagueSettings["tradeDeadline"] = null;
  if (deadline && deadline > 0) {
    const week = proTeams ? weekOfInstant(deadline, weekWindows(proTeams)) : null;
    tradeDeadline = { date: iso(deadline), ...(week !== null ? { week } : {}) };
  } else notes.push("ESPN reports no trade deadline for this league.");

  const tradeReview = tradeReviewOf(s.tradeSettings, notes, unknown);

  // League type from the keeper counts: this season's and (read as) next season's.
  const keepNow = s.draftSettings?.keeperCount ?? 0;
  const keepFuture = s.draftSettings?.keeperCountFuture ?? 0;
  const keepers = Math.max(keepNow, keepFuture);
  let leagueType: LeagueSettings["leagueType"] = "redraft";
  if (keepers > 0) {
    leagueType = keepers >= slots.maxRosterSize ? "dynasty" : "keeper";
    const field = keepFuture > keepNow ? `next season's keeper count (keeperCountFuture ${keepFuture})` : `keeper count (keeperCount ${keepNow})`;
    notes.push(`League type "${leagueType}" is inferred from ESPN's ${field} against ${slots.maxRosterSize} active roster spots; ESPN has no dynasty flag.`);
  }
  if (typeof s.draftSettings?.keeperCount === "number" && typeof s.draftSettings?.keeperCountFuture === "number" && keepNow !== keepFuture)
    warnings.push({ code: "ESPN_KEEPER_COUNTS_DIFFER", message: `ESPN lists ${plural(keepNow, "keeper")} this season and ${keepFuture} under keeperCountFuture (read as next season's keepers; unverified). The league type uses the larger number, ${keepers}.`, platformPath: "settings.draftSettings.keeperCountFuture" });

  const scoringType = s.scoringSettings.scoringType ?? undefined;
  const pointsOnly = scoringType === "TOTAL_POINTS";
  if (scoringType && scoringType !== "H2H_POINTS" && scoringType !== "TOTAL_POINTS")
    warnings.push({ code: "ESPN_SCORING_TYPE", message: `ESPN scoring type ${scoringType} isn't a head-to-head points league; results may be off.`, platformPath: "settings.scoringSettings.scoringType" });
  if (pointsOnly) notes.push("ESPN scoring type TOTAL_POINTS is read as a points-only league (inferred).");
  const home = s.scoringSettings.homeTeamBonus ?? 0;
  const playoffHome = s.scoringSettings.playoffHomeTeamBonus ?? 0;
  if (home || playoffHome)
    warnings.push({
      code: "ESPN_HOME_TEAM_BONUS",
      message: `ESPN gives the home team bonus points (${[home ? `${home} in the regular season` : "", playoffHome ? `${playoffHome} in the playoffs` : ""].filter(Boolean).join(", ")}); the season simulation doesn't add them, so close matchups may be off.`,
      platformPath: home ? "settings.scoringSettings.homeTeamBonus" : "settings.scoringSettings.playoffHomeTeamBonus",
    });

  // Seeding ties: our simulator breaks them by points for, which is ESPN's TOTAL_POINTS_SCORED (Parker's league).
  if (sch.playoffSeedingRule && sch.playoffSeedingRule !== "TOTAL_POINTS_SCORED")
    warnings.push({ code: "ESPN_SEEDING_RULE", message: `ESPN breaks playoff-seeding ties by ${sch.playoffSeedingRule}; we break them by points scored.`, platformPath: "settings.scheduleSettings.playoffSeedingRule" });
  const reseed = sch.playoffReseed ?? undefined;
  if (reseed === undefined) {
    unknown.push("playoffSeeding");
    warnings.push({ code: "ESPN_SEEDING_UNKNOWN", message: "ESPN didn't say whether the playoffs re-seed after each round; we assume a fixed bracket.", platformPath: "settings.scheduleSettings.playoffReseed" });
  }

  const divs = sch.divisions ?? [];
  const divisions = divs.length > 1 ? divs.map((d) => ({ id: String(d.id), teamIds: L.teams.filter((t) => t.divisionId === d.id).map((t) => String(t.id)) })) : undefined;
  if (divisions) warnings.push({ code: "ESPN_SEEDING_DIVISIONS_UNKNOWN", message: "ESPN doesn't report whether division winners are seeded first in the playoffs; we assume they aren't.", platformPath: "settings.scheduleSettings.playoffSeedingRule" });

  const positionLimits = positionLimitsOf(s.rosterSettings.positionLimits, slots.scoringCtx.qbSource);
  if (positionLimits) notes.push("Position limits are read from ESPN's positionLimits as the most players allowed per position (our reading; ESPN doesn't document it).");

  const acq = s.acquisitionSettings;
  const settings: LeagueSettings = {
    numTeams: s.size,
    leagueType,
    lineup: slots.lineup,
    benchSlots: slots.benchSlots,
    irSlots: slots.irSlots,
    taxiSlots: 0,
    maxRosterSize: slots.maxRosterSize,
    ...(positionLimits ? { positionLimits } : {}),
    scoring: { perStat: {}, rules: [], unmapped: [] },
    regularSeasonWeeks: [...new Set(regular.flatMap((x) => x.weeks))].sort((a, b) => a - b),
    playoffWeeks: playoff.flatMap((x) => x.weeks),
    playoffTeams: teams,
    playoffByes: byes,
    ...(playoff.some((x) => x.weeks.length > 1) ? { playoffRoundWeeks: roundWeeks } : {}),
    medianGame: s.scoringSettings.scoringEnhancementType === "WIN_BONUS_TOP_HALF",
    pointsOnly,
    ...(divisions ? { divisions } : {}),
    ...(reseed !== undefined ? { playoffSeeding: { reseed, divisionWinnersFirst: false } } : {}),
    tradeDeadline,
    tradeReview,
    ...(acq?.isUsingAcquisitionBudget && typeof acq.acquisitionBudget === "number" ? { faabBudget: acq.acquisitionBudget } : {}),
    ...(unknown.length ? { unknownSettings: unknown } : {}),
  };
  return settings;
}

// ---------------------------------------------------------------------------------------------
// Transactions

/** Keys that identify one trade across its rows: the proposal it answers, its own id, its trade legs, else team + period. */
function tradeKeys(t: EspnTransaction, legs: string): string[] {
  const keys = [`tx:${t.id}`];
  if (t.relatedTransactionId) keys.push(`tx:${t.relatedTransactionId}`);
  if (legs) keys.push(`legs:${legs}`);
  if (!t.relatedTransactionId && !legs) keys.push(`team:${t.teamId}@${t.scoringPeriodId}`);
  return keys;
}

interface TransactionContext {
  players: PlayerMapper;
  now: Date;
  warnings: ImportWarning[];
  notes: string[];
  /** ESPN's own count of each team's trades this season (teams[].transactionCounter.trades). */
  tradeCounters: ReadonlyMap<string, number>;
  teamName: (id: string) => string;
}

function transactionsOf(rows: EspnTransaction[], x: TransactionContext): Transaction[] {
  const seen = new Set<string>();
  const counted = new Set<string>();
  const inReview: string[][] = [];
  const out: Transaction[] = [];
  let trades = 0;
  let tradesWithoutPlayers = 0;
  for (const t of rows) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    const items = t.items ?? [];
    if (t.status !== "EXECUTED") {
      // Accepted, but still in the league's review period: ESPN lists it without a status (seen
      // live 2026-09-29) or, presumably, PENDING. Not a roster change yet.
      if (t.type === "TRADE_ACCEPT" && (t.status === undefined || t.status === null || t.status === "PENDING")) inReview.push(tradeKeys(t, ""));
      continue;
    }
    let type: Transaction["type"];
    if (t.type === "WAIVER") type = "waiver";
    else if (t.type === "FREEAGENT") type = items.some((i) => i.type === "ADD") ? "add" : "drop";
    else if (t.type === "TRADE_ACCEPT" || t.type === "TRADE_UPHOLD") type = "trade";
    else continue; // proposals, declines, vetoes, errors, lineup moves
    const moves = items
      .filter((i) => i.type === "ADD" || i.type === "DROP" || i.type === "TRADE")
      .map((i) => ({ playerId: x.players.idForEspnId(i.playerId), from: i.fromTeamId && i.fromTeamId > 0 ? String(i.fromTeamId) : null, to: i.toTeamId && i.toTeamId > 0 ? String(i.toTeamId) : null, trade: i.type === "TRADE" }));
    if (type === "trade") {
      // A trade can come back as TRADE_ACCEPT and later TRADE_UPHOLD: count it once.
      const legs = moves
        .filter((m) => m.trade)
        .map((m) => `${m.playerId}:${m.from}>${m.to}`)
        .sort()
        .join("|");
      const keys = tradeKeys(t, legs);
      const duplicate = keys.some((k) => counted.has(k));
      for (const k of keys) counted.add(k);
      if (duplicate) continue;
      trades++;
      if (!legs) tradesWithoutPlayers++;
    }
    const teams = new Set<string>([String(t.teamId)]);
    for (const m of moves) for (const id of [m.from, m.to]) if (id) teams.add(id);
    for (const k of Object.keys(t.teamActions ?? {})) teams.add(k);
    const when = t.processDate ?? t.proposedDate;
    out.push({ id: t.id, type, week: t.scoringPeriodId, timestamp: iso(when ?? x.now.getTime()), teams: [...teams], moves: moves.map(({ playerId, from, to }) => ({ playerId, from, to })) });
  }
  if (trades)
    x.warnings.push({ code: "ESPN_TRADES_UNVERIFIED", message: `${trades} completed trade(s) found. ESPN's completed-trade rows haven't been checked against a live trade yet, so trade history may be incomplete.`, platformPath: "transactions[type=TRADE_ACCEPT|TRADE_UPHOLD]" });
  if (tradesWithoutPlayers)
    x.warnings.push({ code: "ESPN_TRADE_WITHOUT_PLAYERS", message: `${tradesWithoutPlayers} completed trade(s) came back without the players traded (ESPN often hides other teams' trade details), so a trade partner may be missing too.`, platformPath: "transactions[].items" });

  const pending = inReview.filter((keys) => !keys.some((k) => counted.has(k))).length;
  if (pending) x.notes.push(`${pending === 1 ? "1 accepted trade is" : `${pending} accepted trades are`} still in the league's review period, so ${pending === 1 ? "it isn't" : "they aren't"} counted yet.`);

  // ESPN's own per-team trade counters vs the completed trades listed.
  const listed = new Map<string, number>();
  for (const t of out) if (t.type === "trade") for (const id of t.teams) listed.set(id, (listed.get(id) ?? 0) + 1);
  const short = [...x.tradeCounters].filter(([id, n]) => n > (listed.get(id) ?? 0)).sort(([a], [b]) => Number(a) - Number(b));
  if (short.length)
    x.notes.push(
      `ESPN's own trade counters show more trades than the transaction list for ${short.map(([id, n]) => `${x.teamName(id)} (${n} vs ${listed.get(id) ?? 0})`).join(", ")}${pending ? ": a trade still in review counts there" : ": ESPN may hide some trade details"}.`,
    );
  return out.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------------------------
// Free agents

/**
 * A free agent's rank value: ESPN's rest-of-season projection in league scoring. In season, ESPN's
 * projected season line (statSourceId 1, statSplitTypeId 0) already covers only the games left: its
 * games-played stat (210) counts the remaining games, and appliedTotal / GP matches the weekly
 * projection (review ESPN-1). So nothing is subtracted. A player without that line falls back to this
 * week's projection × the weeks left. Ranking over the rest of the season keeps a player who is on
 * bye or hurt this week (weekly line 0) in the pool.
 */
function restOfSeasonProjection(p: EspnPlayer, season: number, week: number, weeksLeft: number): number | undefined {
  const lines = p.stats ?? [];
  const rest = lines.find((x) => x.seasonId === season && x.statSourceId === 1 && x.statSplitTypeId === 0)?.appliedTotal;
  if (typeof rest === "number") return rest;
  const weekly = lines.find((x) => x.seasonId === season && x.statSourceId === 1 && x.statSplitTypeId === 1 && x.scoringPeriodId === week)?.appliedTotal;
  return typeof weekly === "number" ? weekly * Math.max(1, weeksLeft) : undefined;
}

function freeAgentsOf(pool: EspnPoolPlayer[], rostered: ReadonlySet<number>, allowed: readonly Pos[], players: PlayerMapper, season: number, week: number, weeksLeft: number): string[] {
  const byPos = new Map<Pos, Array<{ id: string; proj: number; espnId: number }>>();
  const seen = new Set<number>();
  for (const x of pool) {
    const p = x.player;
    if (seen.has(p.id) || rostered.has(p.id) || (x.onTeamId ?? 0) > 0) continue;
    seen.add(p.id);
    const proj = restOfSeasonProjection(p, season, week, weeksLeft);
    if (proj === undefined && p.proTeamId === 0) continue; // no NFL team and no projection
    const info = players.info(p);
    if (!info || !allowed.includes(info.pos)) continue;
    const list = byPos.get(info.pos) ?? [];
    list.push({ id: info.id, proj: proj ?? Number.NEGATIVE_INFINITY, espnId: p.id });
    byPos.set(info.pos, list);
  }
  const out: string[] = [];
  for (const pos of allowed) {
    const list = (byPos.get(pos) ?? []).sort((a, b) => b.proj - a.proj || a.espnId - b.espnId);
    out.push(...list.slice(0, FREE_AGENTS_PER_POSITION).map((x) => x.id));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Snapshot

export function normalizeEspnLeague(raw: EspnRawBundle, ctx: EspnNormalizeContext): EspnNormalized {
  const warnings: ImportWarning[] = [...(ctx.warnings ?? [])];
  const notes: string[] = [];
  const L = parseEspn(LeagueSchema, raw.league, "the league");
  // Secondary views: validated row by row, so one row in an unexpected shape can't hide the rest.
  const txRows = rowsOf(raw.transactions, (r) => parseEspn(TransactionsResponseSchema, r, "transactions").transactions ?? [], TransactionSchema, warnings, { code: "ESPN_TRANSACTIONS_UNREADABLE", what: "transaction", path: "mTransactions2" });
  const pool = rowsOf(raw.freeAgents, (r) => parseEspn(PlayerListResponseSchema, r, "free agents").players, PoolPlayerSchema, warnings, { code: "ESPN_FREE_AGENTS_UNREADABLE", what: "free-agent", path: "kona_player_info" });
  const cards = rowsOf(raw.playerCards, (r) => parseEspn(PlayerListResponseSchema, r, "player cards").players, PlayerCardSchema, warnings, { code: "ESPN_PLAYER_CARDS_UNREADABLE", what: "player-card", path: "kona_playercard" });
  const proTeams = raw.proTeamSchedules === undefined ? undefined : safeParse(() => parseEspn(ProTeamSchedulesSchema, raw.proTeamSchedules, "the NFL schedule").settings.proTeams, warnings, "ESPN_SCHEDULE_UNREADABLE", "The NFL schedule couldn't be read, so the trade deadline and injury return dates have no week", "proTeamSchedules_wl");

  const slots = summarizeSlots(L.settings.rosterSettings.lineupSlotCounts, warnings);
  const settings = settingsOf(L, slots, proTeams, warnings, notes);
  const built = buildEspnScoring(L.settings.scoringSettings.scoringItems, slots.scoringCtx);
  settings.scoring = built.scoring;
  warnings.push(...built.warnings);

  // Teams and rosters.
  const returnWeeks = returnWeeksOf(cards, proTeams ? weekWindows(proTeams) : []);
  const players = playerMapper(ctx.resolver, (espnId) => returnWeeks.get(espnId));
  const playerInfos: Record<string, PlayerInfo> = {};
  const rostered = new Set<number>();
  const members = new Map((L.members ?? []).map((m) => [normalizeSwid(m.id), m]));
  const hcByTeam: string[] = [];
  const teams: Team[] = L.teams.map((t) => {
    const roster: string[] = [];
    const ir: string[] = [];
    let hc = 0;
    for (const e of t.roster?.entries ?? []) {
      rostered.add(e.playerPoolEntry.player.id);
      const info = players.info(e.playerPoolEntry.player);
      if (!info) {
        if (e.playerPoolEntry.player.defaultPositionId === POSITION_ID.HC) hc++;
        continue;
      }
      playerInfos[info.id] = info;
      (e.lineupSlotId === SLOT.IR ? ir : roster).push(info.id);
    }
    const name = t.name?.trim() || [t.location, t.nickname].filter(Boolean).join(" ").trim() || t.abbrev || `Team ${t.id}`;
    if (hc) hcByTeam.push(name);
    const ownerSwid = t.primaryOwner ?? t.owners?.[0];
    const m = ownerSwid ? members.get(normalizeSwid(ownerSwid)) : undefined;
    const ownerName = m?.displayName?.trim() || [m?.firstName, m?.lastName].filter(Boolean).join(" ").trim() || "Unknown owner";
    const rec = t.record?.overall;
    return {
      id: String(t.id),
      name,
      ownerName,
      roster,
      ir,
      taxi: [],
      record: { w: rec?.wins ?? 0, l: rec?.losses ?? 0, t: rec?.ties ?? 0 },
      pointsFor: round2(rec?.pointsFor ?? 0),
      pointsAgainst: round2(rec?.pointsAgainst ?? 0),
      ...(settings.divisions && t.divisionId !== undefined && t.divisionId !== null ? { divisionId: String(t.divisionId) } : {}),
    };
  });

  // Injury return weeks (only when the player cards were fetched).
  const week = L.status.latestScoringPeriod;
  if (raw.playerCards !== undefined) {
    const injured = teams.flatMap((t) => [...t.roster, ...t.ir]).map((id) => playerInfos[id] as PlayerInfo).filter((p) => p.injury !== "ACTIVE");
    const dated = injured.filter((p) => p.injuryReturnWeek !== undefined);
    if (injured.length) notes.push(`Expected return weeks come from ESPN's player cards for ${dated.length} of ${plural(injured.length, "injured rostered player")}.`);
    const longer = dated.filter((p) => (p.injury === "QUESTIONABLE" || p.injury === "DOUBTFUL") && (p.injuryReturnWeek as number) >= week + 2);
    if (longer.length)
      notes.push(`ESPN expects ${plural(longer.length, "player")} listed as questionable, doubtful or day-to-day to be out longer than that status suggests: ${longer.slice(0, 5).map((p) => `${p.name} (back week ${p.injuryReturnWeek})`).join(", ")}${longer.length > 5 ? ", …" : ""}.`);
  }

  // My team.
  let myTeamId: string | null = null;
  if (ctx.swid) {
    const mine = normalizeSwid(ctx.swid);
    const hit = L.teams.find((t) => [...(t.owners ?? []), ...(t.primaryOwner ? [t.primaryOwner] : [])].some((o) => normalizeSwid(o) === mine));
    if (hit) myTeamId = String(hit.id);
    else warnings.push({ code: "ESPN_MY_TEAM_NOT_FOUND", message: "The ESPN account in your cookies doesn't own a team in this league; pick your team.", platformPath: "teams[].owners" });
  }
  if (!myTeamId && ctx.myTeamId !== undefined) {
    if (teams.some((t) => t.id === ctx.myTeamId)) myTeamId = ctx.myTeamId;
    else warnings.push({ code: "ESPN_MY_TEAM_UNKNOWN", message: "The team you picked (or the one in your link) isn't in this league; pick your team.", platformPath: "teams[].id" });
  }

  // Free agents.
  const season = L.seasonId;
  const finalWeek = L.status.finalScoringPeriod ?? Math.max(week, ...settings.playoffWeeks, ...settings.regularSeasonWeeks);
  const freeAgents = freeAgentsOf(pool, rostered, slots.positions, players, season, week, finalWeek - week + 1);
  for (const x of pool) {
    const info = players.info(x.player);
    if (info && freeAgents.includes(info.id)) playerInfos[info.id] ??= info;
  }

  // Schedule.
  const periodWeeks = new Map(Object.entries(L.settings.scheduleSettings.matchupPeriods).map(([mp, w]) => [Number(mp), [...w].sort((a, b) => a - b)]));
  const schedule: Matchup[] = [];
  let consolation = 0;
  for (const m of L.schedule ?? []) {
    const first = periodWeeks.get(m.matchupPeriodId)?.[0];
    if (first === undefined || !m.home) continue;
    if (m.playoffTierType && m.playoffTierType !== "WINNERS_BRACKET" && m.playoffTierType !== "NONE") {
      consolation++;
      continue;
    }
    schedule.push({ week: first, teamA: String(m.home.teamId), teamB: m.away ? String(m.away.teamId) : null, isPlayoff: m.matchupPeriodId > L.settings.scheduleSettings.matchupPeriodCount });
  }
  if (consolation) notes.push(`${consolation} consolation-bracket game(s) are left out of the schedule.`);

  const teamNames = new Map(teams.map((t) => [t.id, t.name]));
  const tradeCounters = new Map<string, number>();
  for (const t of L.teams) if (typeof t.transactionCounter?.trades === "number") tradeCounters.set(String(t.id), t.transactionCounter.trades);
  const transactions = transactionsOf(txRows, { players, now: ctx.now, warnings, notes, tradeCounters, teamName: (id) => teamNames.get(id) ?? `Team ${id}` });

  // Position and ID warnings.
  const sk = players.skipped;
  if (sk.tqb || slots.lineup.some((s) => s.slot === "TQB"))
    warnings.push({ code: "ESPN_TQB_AS_QB", message: `ESPN's team-QB position (TQB) is treated as a QB${sk.tqb ? ` (${sk.tqb} TQB unit${sk.tqb > 1 ? "s" : ""})` : ""}: it's scored with QB stats and can fill QB spots in our lineups.`, platformPath: "player.defaultPositionId = 15; settings.rosterSettings.lineupSlotCounts[\"1\"]" });
  if (sk.hc) warnings.push({ code: "ESPN_HC_UNMAPPED", message: `${sk.hc} head coach${sk.hc > 1 ? "es" : ""} (HC) left out${hcByTeam.length ? ` (on ${hcByTeam.join(", ")})` : ""}: head coaches aren't supported.`, platformPath: "player.defaultPositionId = 14" });
  for (const [id, n] of sk.unknown) warnings.push({ code: "ESPN_POSITION_UNKNOWN", message: `${n} player(s) have an ESPN position we don't know (defaultPositionId ${id}) and were left out.`, platformPath: "player.defaultPositionId" });
  for (const [status, n] of sk.unknownInjury) warnings.push({ code: "ESPN_INJURY_UNKNOWN", message: `${n} player(s) have an ESPN injury status we don't map (${status}); they're treated as healthy.`, platformPath: "player.injuryStatus" });
  const list = (xs: ReadonlyArray<{ label: string }>) => `${xs.slice(0, 10).map((x) => x.label).join("; ")}${xs.length > 10 ? "; …" : ""}`;
  if (sk.byName.length) {
    const onRosters = sk.byName.filter((x) => rostered.has(x.espnId));
    const freeAgentsByName = sk.byName.filter((x) => !rostered.has(x.espnId));
    const where = [onRosters.length ? `On rosters: ${list(onRosters)}.` : "", freeAgentsByName.length ? `Free agents: ${list(freeAgentsByName)}.` : ""].filter(Boolean).join(" ");
    warnings.push({ code: "ESPN_PLAYER_MATCHED_BY_NAME", message: `${sk.byName.length} player(s) aren't in any player ID source, so each was matched to the only active player with the same name, position and NFL team. ${where}`, platformPath: "player.id" });
  }
  const inLeague = new Set([...rostered, ...Object.values(playerInfos).map((p) => Number(p.ids.espn))]);
  const conflicts = sk.conflicts.filter((c) => inLeague.has(c.espnId));
  if (conflicts.length) warnings.push({ code: "ESPN_ID_CONFLICT", message: `The player ID sources disagree about who ${plural(conflicts.length, "ESPN player id")} in this league belong${conflicts.length === 1 ? "s" : ""} to; each was matched by the crosswalk's tie-break, so check: ${list(conflicts)}.`, platformPath: "player.id" });
  if (sk.collisions) warnings.push({ code: "ESPN_ID_COLLISION", message: `${sk.collisions} player(s) matched a Sleeper id already used by another player; they keep their ESPN id.`, platformPath: "player.id" });
  if (L.teams.every((t) => !(t.roster?.entries ?? []).length))
    warnings.push({ code: "ESPN_EMPTY_ROSTERS", message: "Every roster is empty (the league may not have drafted yet).", platformPath: "teams[].roster.entries" });

  const snapshot: LeagueSnapshot = {
    platform: "espn",
    leagueId: ctx.leagueId,
    season,
    name: L.settings.name?.trim() || "ESPN league",
    fetchedAt: ctx.now.toISOString(),
    currentWeek: week,
    settings,
    teams,
    myTeamId,
    players: playerInfos,
    schedule,
    transactions,
    freeAgents,
    warnings,
  };
  return { snapshot, notes };
}
