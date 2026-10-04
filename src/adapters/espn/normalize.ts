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
 *   With 2+ divisions, the division winners take the top seeds, then everyone else by the standings
 *   (✅ DIVISION_SEEDING_SOURCE: ESPN's help center, and espn-api's standings code agrees), whatever
 *   ESPN says about re-seeding; a note says so.
 * - Seeding tiebreaker (§8; planner, Checkpoint 2): scheduleSettings.playoffSeedingRule, the first
 *   tiebreaker after win percentage. TOTAL_POINTS_SCORED → points for (✅ both test leagues);
 *   H2H_RECORD → head-to-head and INTRA_DIVISION_RECORD → division record (⚠️ ESPN's own value names,
 *   settings.typeNames.recordSeedingRuleTypes, read as espn-api's standings code reads them at commit
 *   663d726, League.standings_weekly; no league using them seen live, so a note says so). Missing or
 *   UNKNOWN (ESPN's own placeholder, the first of those values: no rule reported) → unknown, warned as
 *   not reported; TOTAL_POINTS_AGAINST / RAW_STAT (not modeled) → unknown, warned as not modeled.
 *   Either way points for is assumed.
 * - Schedule: one matchup per matchup period, in its first NFL week; a period spanning several NFL
 *   weeks (regular season or playoffs) carries them all in `weeks`. A matchup is `decided` once ESPN
 *   has decided it (any winner but UNDECIDED; ESPN's records then count it) and has a `result` when
 *   the verdict is HOME / AWAY / TIE with the scores: ESPN's own verdict, so a tie its matchup tie rule
 *   breaks still has a winner. A decided matchup we can't read stays decided without a result, warned
 *   by what that changes: a regular-season game leaves the head-to-head (and division-record)
 *   tiebreakers, a playoff game makes bye and title odds unknown; a bye changes nothing, so it isn't.
 *   Consolation-bracket games are left out.
 * - Transactions: EXECUTED rows only (proposals, declines, cancelled or failed claims and lineup
 *   moves are not roster changes), deduped by id across the per-period requests. Trades follow
 *   ./trades.ts (Phase 4): rows answering one trade (TRADE_ACCEPT, TRADE_UPHOLD; own id, proposal or
 *   trade legs) count once; a trade is completed by an EXECUTED accept or by the rosters, never by a
 *   member's vote (an EXECUTED TRADE_UPHOLD); an accepted trade still in review (no status, as seen
 *   live, or PENDING) isn't counted, and the Import Report says so; completed trades ESPN lists without
 *   their players (other teams' trades, and presumably the user's own on a public-link import) are
 *   rebuilt from the roster entries acquired by trade (`refilled`, with an Import Report note), as are
 *   trades only the rosters and ESPN's own per-team trade counters (teams[].transactionCounter) show.
 *   The counters are also compared with the trades listed.
 * - Move positions (Transaction moves' `pos`, Phase 4: streaming detection counts adds by position):
 *   ESPN's items carry none, so the player's defaultPositionId where a roster or a free-agent list
 *   shows him, an ESPN team-defense id, else the single-position lineup slot he left or went to.
 * - Injury return weeks: kona_playercard injuryDetails.expectedReturnDate → NFL week (weeks.ts).
 * - IR slots (Phase 4b, engine evaluate.ts rule 5: a traded IR player goes into an open IR slot when it takes his status):
 *   LeagueSettings.irEligible = IR and OUT (ESPN_IR_ELIGIBLE): not in ESPN's API, but ✅ documented by ESPN's help center
 *   (Out or IR may be placed in the IR slot, suspended players may not; INJURY_RESERVE and OUT are the statuses ESPN
 *   reports for them, positions.ts mapInjury), and seen live: 2 of the 7 players in Parker's league's IR slots on Oct 3 were
 *   OUT. The same article says a player whose status improves to Questionable or Doubtful may stay in the slot (the
 *   captures hold Doubtful, Questionable and even healthy players in IR slots); he can't be placed there, so a received
 *   one joins the active roster.
 * - Waiver order and FAAB (free agents go to one team each, in this order; engine league.ts step 5): ./waivers.ts (Phase
 *   4c; planner reply to Checkpoint 4b, answer 2). A league whose order resets weekly (acquisitionSettings.waiverOrderReset,
 *   as both test leagues' does) gets the reset order in Team.waiverRank: numTeams + 1 − teams[].playoffSeed (✅ ESPN's own
 *   waiverRank at the reset on Sep 30 for 20 of 20 teams, both leagues seeded by points for; ⚠️ under another seeding
 *   rule, and with divisions, where it's the reverse of the overall standings), and ESPN's live teams[].waiverRank in
 *   Team.liveWaiverRank, so the allocation doesn't depend on the day of the import (in Parker's league a team whose claim
 *   goes through moves to the back until the next reset: on Oct 4, after three runs, Parker's team was 10th of 10, 4th at
 *   the reset); ⚠️ a commissioner-edited order keeps the reset order, warned (the next reset replaces an edit). In a FAAB
 *   league (isUsingAcquisitionBudget) the rank only breaks ties between equal budgets: the reset order there too when the
 *   order resets weekly, else ESPN's live rank (so only a tie is independent of the day of the import: the budgets are
 *   read as they stand). Rolling waivers, an unreported reset rule (warned) and the weeks before any
 *   game (warned) keep ESPN's live rank; FREEAGENCY (⚠️ read as no waivers, warned) has no order.
 *   LeagueSettings.waiverOrderUsed says which. In a FAAB league
 *   with a budget (settings.faabBudget), Team.faabRemaining = acquisitionBudget − teams[].transactionCounter.
 *   acquisitionBudgetSpent (⚠️ the public test league's spent amounts, 0–33 of 200, never above the budget, weren't
 *   cross-checked against winning bids: its transactions weren't captured). A rank that isn't a whole number ≥ 1, or a
 *   remaining budget below 0 or unreadable, is left out.
 * - SWIDs: the fetch step replaced them with pseudonyms (fetch.ts); owners and members are matched
 *   in that form, and ctx.swid is the cookie holder's pseudonym. None reaches the snapshot.
 * - Player ids (§2.9 "Player ID crosswalk rules", Checkpoint 1 answers 1 and 2): for the players in
 *   the snapshot (rostered and kept free agents), each crosswalk override ("same player") becomes
 *   one Import Report note, every name match is named in ESPN_PLAYER_MATCHED_BY_NAME, and the other
 *   ID conflicts are named in ESPN_ID_CONFLICT. A player is listed only when he keeps the Sleeper id
 *   (not after a collision, ESPN_ID_COLLISION).
 */
import type { CrosswalkConflict, CrosswalkSourceKey, PlayerIdResolver } from "@/data/types";
import { returnDateConflict } from "@/engine/availability";
import { config } from "@/engine/config";
import type { ImportWarning, InjuryStatus, LeagueSettings, LeagueSnapshot, Matchup, MatchupResult, PlayerInfo, Pos, SeedingTiebreaker, SlotDef, Team, Transaction, UnknownSetting } from "@/engine/model";
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
  type EspnMatchup,
  type EspnPlayer,
  type EspnPoolPlayer,
  type EspnProTeam,
  type EspnTransaction,
  type EspnTransactionItem,
} from "./schema";
import { TRADE_ROW_TYPES, tradeHistory, type RebuiltTrade, type TradeAcquisition, type TradeMove, type TradeRow } from "./trades";
import { espnWaiverOrder, faabRemainingOf } from "./waivers";
import { weekOfCalendarDate, weekOfInstant, weekWindows, type WeekWindow } from "./weeks";

export { faabRemainingOf, waiverRankOf } from "./waivers";

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

/** A player the Import Report names: "Name (POS, TEAM)" and his ESPN id. */
interface NamedPlayer {
  espnId: number;
  label: string;
}

interface PlayerMapper {
  info(p: EspnPlayer): PlayerInfo | null;
  /** Canonical id for an ESPN player id seen only in a transaction. */
  idForEspnId(espnId: number): string;
  /** byName, conflicts and overrides hold a player only when he keeps the Sleeper id (claim() succeeded); collisions hold the ones who don't. */
  skipped: {
    hc: number;
    unknown: Map<number, number>;
    unknownInjury: Map<string, number>;
    /** Matched a Sleeper id another ESPN player already holds, so they keep their ESPN id. */
    collisions: NamedPlayer[];
    tqb: number;
    /** Matched by name, position and NFL team (resolver.matchByName): no ID source maps them. */
    byName: NamedPlayer[];
    /** ESPN ids the ID sources map to different Sleeper players, resolved by source order or a tie inside one source (resolver.conflict). */
    conflicts: Array<NamedPlayer & { conflict: CrosswalkConflict }>;
    /** "Same player" overrides: a lower-priority source's Sleeper id replaced the top source's (one note each). */
    overrides: Array<NamedPlayer & { conflict: CrosswalkConflict }>;
  };
}

/** ESPN team defenses have id −(16000 + proTeamId) (Phase 0 E.playerIds; asserted in normalize.test.ts). */
const DST_ID_BASE = 16000;

/** The ID sources as the Import Report names them. */
const ID_SOURCE_LABELS: Readonly<Record<CrosswalkSourceKey, string>> = { dynastyProcess: "DynastyProcess", fantasyCalc: "FantasyCalc", sleeper: "Sleeper's player database" };

/** "a", "a and b", "a, b and c". */
function joinAnd(xs: readonly string[]): string {
  return xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? "");
}

/**
 * The Import Report note for one "same player" override (CLAUDE.md §2.9: log every override): which
 * sources disagreed, which Sleeper id we use and why.
 */
export function idOverrideNote(p: { espnId: number; label: string }, c: CrosswalkConflict): string {
  const links = c.options.map((o, i) => `${joinAnd(o.from.map((f) => ID_SOURCE_LABELS[f]))} link${o.from.length === 1 ? "s" : ""} ${i === 0 ? "Sleeper id " : ""}${o.sleeperId}`);
  const top = c.options[0];
  const topSource = top?.from[0];
  const matched = c.sameBy?.length ? joinAnd(["name", "position", ...c.sameBy.map((b) => (b === "team" ? "NFL team" : "NFL player ID (GSIS)"))]) : "name and position, plus NFL team or NFL player ID (GSIS),";
  const why = top && topSource && top.sleeperId !== c.chosen ? `${top.sleeperId} isn't one of Sleeper's active fantasy players, and ${c.chosen} is an active player whose ${matched} match ${ID_SOURCE_LABELS[topSource]}'s record` : "the crosswalk's same-player rule";
  return `Player IDs: the ID sources disagree on ${p.label}, ESPN id ${p.espnId}: ${links.join("; ")}. We use ${c.chosen}: ${why}.`;
}

function playerMapper(resolver: PlayerIdResolver, returnWeekOf: (espnId: number) => number | undefined): PlayerMapper {
  const byEspnId = new Map<number, PlayerInfo | null>();
  const owner = new Map<string, number>();
  const skipped: PlayerMapper["skipped"] = { hc: 0, unknown: new Map(), unknownInjury: new Map(), collisions: [], tqb: 0, byName: [], conflicts: [], overrides: [] };

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
    let byName = false;
    let conflict: CrosswalkConflict | undefined;
    const abbr = ESPN_PRO_TEAMS[proTeamId];
    const team = abbr && abbr !== "None" ? abbr : null;
    if (pos === "DEF") sleeper = team ? resolver.defenseId(team) : undefined;
    else {
      sleeper = resolver.canonical("espn", String(espnId));
      if (sleeper) conflict = resolver.conflict?.("espn", String(espnId));
      // Last resort for a player no ID source maps (a rookie kicker in Phase 1): the only active player
      // with this exact name, position and NFL team (the resolver never matches a player without a team).
      else if (name && pos && espnId > 0 && resolver.matchByName) {
        sleeper = resolver.matchByName({ name, position: pos, team });
        byName = sleeper !== undefined;
      }
    }
    const label = `${name ?? `ESPN player ${espnId}`}${pos ? ` (${pos}${team ? `, ${team}` : ""})` : ""}`;
    if (sleeper && claim(sleeper, espnId)) {
      // Recorded only now: after a collision the player keeps his ESPN id, so he isn't matched or overridden.
      if (byName) skipped.byName.push({ espnId, label });
      if (conflict) (conflict.resolvedBy === "same player" ? skipped.overrides : skipped.conflicts).push({ espnId, label, conflict });
      return { id: sleeper, sleeper };
    }
    if (sleeper) skipped.collisions.push({ espnId, label });
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

/**
 * ESPN's seeding tiebreaker (scheduleSettings.playoffSeedingRule) → ours (§8). The value names are
 * ESPN's own (settings.typeNames.recordSeedingRuleTypes); espn-api's standings code (commit 663d726,
 * League.standings_weekly) reads the three it models the same way.
 */
export const ESPN_SEEDING_TIEBREAKERS: Readonly<Record<string, SeedingTiebreaker>> = {
  TOTAL_POINTS_SCORED: "pointsFor",
  H2H_RECORD: "headToHead",
  INTRA_DIVISION_RECORD: "divisionRecord",
};

/** Rules seen in a live league (✅): both test leagues use TOTAL_POINTS_SCORED. The others are read from their names (⚠️). */
const SEEDING_RULES_SEEN_LIVE: ReadonlySet<string> = new Set(["TOTAL_POINTS_SCORED"]);

const TIEBREAKER_WORDS: Readonly<Record<SeedingTiebreaker, string>> = { pointsFor: "total points for", headToHead: "head-to-head record", divisionRecord: "record within the division" };

/** ESPN's placeholder value (the first of recordSeedingRuleTypes): it reports no rule, like a missing one. */
const SEEDING_RULE_NOT_REPORTED = "UNKNOWN";

/**
 * Where the division rule comes from (review ADAPT-3; ✅ documented): ESPN's help center, "H2H Points
 * League Playoff Seeding: How Tiebreakers Work" (support.espn.com/hc/en-us/articles/360058038711, updated
 * 2026-08-11): "Division winners always occupy the top seeds", then the other teams by winning
 * percentage, with the step "skipped in leagues with no divisions". ESPN's older rules page
 * (espn.com/fantasy/football/ffl/story?page=fflrulesplayoffs) says the same, and espn-api's standings
 * (commit 663d726, League.standings_weekly) seed each division's winner first. ESPN's API has no
 * setting for it, so it is a platform rule, not the league's choice.
 */
export const DIVISION_SEEDING_SOURCE = "ESPN's help center says division winners always occupy the top seeds";

/**
 * The statuses ESPN's IR slot takes (LeagueSettings.irEligible; the file header, "IR slots"): ESPN's help center, "Players on
 * Injured Reserve (IR)" (support.espn.com/hc/en-us/articles/115003849911, updated 2026-08-18): "In ESPN Fantasy Football,
 * players with either the Out (O) or Injured/Reserve (IR) status may be placed into the IR slot", and "Suspended players
 * (SSPD) are NOT eligible for IR on FFL".
 */
export const ESPN_IR_ELIGIBLE: readonly InjuryStatus[] = ["IR", "OUT"];

/**
 * The league's seeding tiebreaker, or undefined (plus "seedingTiebreaker" in unknownSettings and a
 * warning) when ESPN doesn't report one (missing, or its UNKNOWN placeholder) or reports one we don't
 * model: the simulator then breaks ties by points for. A rule read only from its name gets a note, so
 * the Import Report doesn't show a guess as a fact (§0.12).
 */
function seedingTiebreakerOf(value: string | undefined, warnings: ImportWarning[], notes: string[], unknown: UnknownSetting[]): SeedingTiebreaker | undefined {
  const rule = value && value !== SEEDING_RULE_NOT_REPORTED ? value : undefined;
  // Own keys only: a value such as "constructor" must not find Object.prototype's.
  const mapped = rule && Object.hasOwn(ESPN_SEEDING_TIEBREAKERS, rule) ? ESPN_SEEDING_TIEBREAKERS[rule] : undefined;
  if (rule && mapped) {
    if (!SEEDING_RULES_SEEN_LIVE.has(rule)) notes.push(`Ties in the standings: ESPN's seeding tiebreaker ${rule} is read as ${TIEBREAKER_WORDS[mapped]}. That's ESPN's own name for it, but no league with this setting has been checked yet.`);
    return mapped;
  }
  unknown.push("seedingTiebreaker");
  warnings.push({
    code: "ESPN_SEEDING_TIEBREAKER_UNKNOWN",
    message: rule
      ? `ESPN breaks ties in the standings by ${rule}, which Offer Sheet doesn't model yet; the season simulation breaks them by points for instead.`
      : "ESPN didn't say how ties in the standings are broken; the season simulation breaks them by points for.",
    platformPath: "settings.scheduleSettings.playoffSeedingRule",
  });
  return undefined;
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
    warnings.push({ code: "ESPN_MULTIWEEK_MATCHUPS", message: `Some regular-season matchups span several NFL weeks (${multiWeek.map((x) => `period ${x.mp}: weeks ${x.weeks.join("+")}`).join("; ")}); each is listed once, with all its weeks.`, platformPath: "settings.scheduleSettings.matchupPeriods" });
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

  const reseed = sch.playoffReseed ?? undefined;
  if (reseed === undefined) {
    unknown.push("playoffSeeding");
    warnings.push({ code: "ESPN_SEEDING_UNKNOWN", message: "ESPN didn't say whether the playoffs re-seed after each round; we assume a fixed bracket.", platformPath: "settings.scheduleSettings.playoffReseed" });
  }
  const seedingTiebreaker = seedingTiebreakerOf(sch.playoffSeedingRule ?? undefined, warnings, notes, unknown);

  const divs = sch.divisions ?? [];
  const divisions = divs.length > 1 ? divs.map((d) => ({ id: String(d.id), teamIds: L.teams.filter((t) => t.divisionId === d.id).map((t) => String(t.id)) })) : undefined;
  // Division winners take the top seeds (review ADAPT-3): ESPN's rule for every league with divisions, not
  // a league setting, so it holds whatever ESPN says about re-seeding (DIVISION_SEEDING_SOURCE).
  if (divisions) notes.push(`Playoff seeding: the ${divisions.length} division winners take the top seeds, then the other teams by the standings (${DIVISION_SEEDING_SOURCE}).`);

  const positionLimits = positionLimitsOf(s.rosterSettings.positionLimits, slots.scoringCtx.qbSource);
  if (positionLimits) notes.push("Position limits are read from ESPN's positionLimits as the most players allowed per position (our reading; ESPN doesn't document it).");

  const acq = s.acquisitionSettings;
  const settings: LeagueSettings = {
    numTeams: s.size,
    leagueType,
    lineup: slots.lineup,
    benchSlots: slots.benchSlots,
    irSlots: slots.irSlots,
    // Not in ESPN's API; its help center documents it (ESPN_IR_ELIGIBLE, the file header).
    irEligible: [...ESPN_IR_ELIGIBLE],
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
    // Without ESPN's re-seeding flag, the seeding is left out (unknown), unless the division rule applies:
    // then a fixed bracket stands in for re-seeding (ESPN_SEEDING_UNKNOWN says it's assumed).
    ...(reseed !== undefined || divisions ? { playoffSeeding: { reseed: reseed ?? false, divisionWinnersFirst: !!divisions } } : {}),
    ...(seedingTiebreaker ? { seedingTiebreaker } : {}),
    tradeDeadline,
    tradeReview,
    ...(acq?.isUsingAcquisitionBudget && typeof acq.acquisitionBudget === "number" ? { faabBudget: acq.acquisitionBudget } : {}),
    ...(unknown.length ? { unknownSettings: unknown } : {}),
  };
  return settings;
}

// ---------------------------------------------------------------------------------------------
// Schedule results

/** Decided matchups we couldn't turn into a result: winner values we don't know, and winners without a score. */
interface UnreadableResults {
  winners: Map<string, number>;
  noScore: number;
}

const noUnreadable = (): UnreadableResults => ({ winners: new Map(), noScore: 0 });

/** How many matchups a tally holds, and what they were ("2 with winner "FORFEIT"; 1 with a winner but no score"). */
function unreadableSummary(u: UnreadableResults): { count: number; parts: string } {
  const parts = [...u.winners].map(([w, n]) => `${n} with winner "${w}"`);
  if (u.noScore) parts.push(`${u.noScore} with a winner but no score`);
  return { count: [...u.winners.values()].reduce((a, b) => a + b, 0) + u.noScore, parts: parts.join("; ") };
}

/**
 * The warnings on decided matchups we couldn't read (review ADAPT-2), each worded by what the missing
 * result changes in the season odds (src/engine/season.ts): a regular-season game still counts in ESPN's
 * records, but the head-to-head tiebreaker (and, with divisions, the division-record one) leaves it
 * out; a playoff game's missing winner means the bracket can't be replayed, so bye and title odds are
 * unknown. Byes aren't tallied: nothing reads a bye's result (no opponent, no winner).
 */
function unreadableResultWarnings(regular: UnreadableResults, playoff: UnreadableResults, hasDivisions: boolean): ImportWarning[] {
  const out: ImportWarning[] = [];
  const r = unreadableSummary(regular);
  if (r.count) {
    const [they, them] = r.count === 1 ? ["it has", "it"] : ["they have", "them"];
    const tiebreakers = hasDivisions ? "head-to-head and division-record tiebreakers" : "head-to-head tiebreakers";
    out.push({
      code: "ESPN_MATCHUP_RESULT_UNREADABLE",
      message: `${plural(r.count, "decided matchup")} came back in a shape we can't read (${r.parts}), so ${they} no result: ESPN's standings still count ${them} as played, but ${tiebreakers} leave ${them} out.`,
      platformPath: "schedule[].winner",
    });
  }
  const p = unreadableSummary(playoff);
  if (p.count) {
    const [they, winners] = p.count === 1 ? ["it has", "its winner"] : ["they have", "their winners"];
    out.push({
      code: "ESPN_MATCHUP_RESULT_UNREADABLE",
      message: `${plural(p.count, "decided playoff game")} came back in a shape we can't read (${p.parts}), so ${they} no result: without ${winners} the playoff bracket can't be replayed, so bye and title odds show as unknown.`,
      platformPath: "schedule[].winner",
    });
  }
  return out;
}

/**
 * ESPN's verdict once it has decided the matchup (§4 Matchup.decided): any winner but UNDECIDED, else
 * undefined. HOME, AWAY and TIE are ESPN's own values (typeNames.winnerTypes, with UNDECIDED); a value
 * ESPN adds later counts as decided too (⚠️ inferred: UNDECIDED is its only "not yet"), because ESPN's
 * records then count the game and the season simulation mustn't play it again.
 */
function verdictOf(m: EspnMatchup): string | undefined {
  return m.winner && m.winner !== "UNDECIDED" ? m.winner : undefined;
}

/**
 * A decided matchup's final result (§4 Matchup.result): verdict HOME, AWAY or TIE, with each side's
 * totalPoints over the whole period (to cents: ESPN's points carry float noise). Not decided → no
 * result; decided but unreadable (another verdict, or a missing score) → no result, counted in
 * `unreadable` (the caller's tally for the warnings). A bye (no away team) is never won: its winnerId
 * is null whatever ESPN says, and pointsB is null.
 */
function matchupResult(m: EspnMatchup, teamA: string, teamB: string | null, unreadable: UnreadableResults): MatchupResult | undefined {
  const winner = verdictOf(m);
  if (winner === undefined) return undefined;
  if (winner !== "HOME" && winner !== "AWAY" && winner !== "TIE") {
    unreadable.winners.set(winner, (unreadable.winners.get(winner) ?? 0) + 1);
    return undefined;
  }
  const a = m.home?.totalPoints;
  const b = m.away?.totalPoints;
  if (typeof a !== "number" || (teamB !== null && typeof b !== "number")) {
    unreadable.noScore++;
    return undefined;
  }
  const winnerId = teamB === null || winner === "TIE" ? null : winner === "HOME" ? teamA : teamB;
  return { pointsA: round2(a), pointsB: teamB === null ? null : round2(b as number), winnerId };
}

// ---------------------------------------------------------------------------------------------
// Transactions

interface TransactionContext {
  players: PlayerMapper;
  now: Date;
  warnings: ImportWarning[];
  notes: string[];
  /** ESPN's own count of each team's trades this season (teams[].transactionCounter.trades). */
  tradeCounters: ReadonlyMap<string, number>;
  teamName: (id: string) => string;
  /** Rostered players whose last acquisition was a trade (the trade refill, ./trades.ts). */
  acquisitions: TradeAcquisition[];
  /** settings.tradeSettings.revisionHours. */
  revisionHours?: number;
  /** status.activatedDate. */
  activatedAt?: number;
  /** The NFL week of an instant (with the NFL schedule). */
  weekOf?: (ms: number) => number | null;
  /** A moved player's position (C2): his defaultPositionId where a roster or free-agent list shows him, else hints. */
  positionOf: (item: EspnTransactionItem) => Pos | undefined;
}

const isWaitingAccept = (t: EspnTransaction) => t.type === "TRADE_ACCEPT" && (t.status === undefined || t.status === null || t.status === "PENDING");

/** The position a single-position starting slot holds (QB, TQB, K, D/ST …); none for the bench, IR, FLEX-type slots or "none" (−1). */
function slotPosition(slotId: number | null | undefined): Pos | undefined {
  if (typeof slotId !== "number" || slotId < 0) return undefined;
  const s = slotInfo(slotId);
  return s.starting && s.eligible?.length === 1 ? s.eligible[0] : undefined;
}

/**
 * A moved player's position (Transaction moves' `pos`, Phase 4: streaming detection counts adds by
 * position). ESPN's transaction items carry none (926 of 926 in Parker's league, 2026-10-01), so: his
 * defaultPositionId where a roster or a free-agent list shows him (fetch.ts asks for up to 500 free
 * agents per startable position, so a player dropped since is normally there); an ESPN team-defense id,
 * −(16000 + proTeamId); else the single-position lineup slot he left or went to (a kicker added straight
 * into the K slot). Unknown otherwise.
 */
function movePositions(L: EspnLeague, pool: readonly EspnPoolPlayer[]): (item: EspnTransactionItem) => Pos | undefined {
  const known = new Map<number, Pos>();
  const note = (p: { id: number; defaultPositionId: number }) => {
    const pos = positionOf(p.defaultPositionId).pos;
    if (pos && !known.has(p.id)) known.set(p.id, pos);
  };
  for (const t of L.teams) for (const e of t.roster?.entries ?? []) note(e.playerPoolEntry.player);
  for (const x of pool) note(x.player);
  return (item) => {
    const hit = known.get(item.playerId);
    if (hit) return hit;
    const defense = item.playerId < 0 ? ESPN_PRO_TEAMS[-item.playerId - DST_ID_BASE] : undefined;
    if (defense && defense !== "None") return "DEF";
    return slotPosition(item.fromLineupSlotId) ?? slotPosition(item.toLineupSlotId);
  };
}

/** "Team 6 and Team 10 (week 4)", one-sided: "…, only Team 6's side: the players Team 10 received have left its roster". */
function rebuiltText(r: RebuiltTrade, teamName: (id: string) => string): string {
  const [a, b] = r.tx.teams;
  const side = r.oneSided ? `, only ${teamName(r.oneSided.receivedBy)}'s side: the players ${teamName(r.oneSided.otherSide)} received have left its roster` : "";
  return `${teamName(a ?? "")} and ${teamName(b ?? "")} (week ${r.tx.week}${side})`;
}

function transactionsOf(rows: EspnTransaction[], x: TransactionContext): Transaction[] {
  const seen = new Set<string>();
  const out: Transaction[] = [];
  const tradeRows: TradeRow[] = [];
  const movesOf = (t: EspnTransaction): TradeMove[] =>
    (t.items ?? [])
      .filter((i) => i.type === "ADD" || i.type === "DROP" || i.type === "TRADE")
      .map((i) => {
        const pos = x.positionOf(i);
        return { playerId: x.players.idForEspnId(i.playerId), from: i.fromTeamId && i.fromTeamId > 0 ? String(i.fromTeamId) : null, to: i.toTeamId && i.toTeamId > 0 ? String(i.toTeamId) : null, ...(pos ? { pos } : {}), trade: i.type === "TRADE" };
      });
  for (const t of rows) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    if (TRADE_ROW_TYPES.has(t.type)) {
      // Executed, or accepted and still waiting (no status, as seen live 2026-09-29 and 2026-10-01, or PENDING): ./trades.ts decides.
      if (t.status === "EXECUTED" || isWaitingAccept(t)) tradeRows.push({ row: t, moves: movesOf(t) });
      continue;
    }
    if (t.status !== "EXECUTED") continue;
    const items = t.items ?? [];
    let type: Transaction["type"];
    if (t.type === "WAIVER") type = "waiver";
    else if (t.type === "FREEAGENT") type = items.some((i) => i.type === "ADD") ? "add" : "drop";
    else continue; // proposals, declines, vetoes, errors, lineup moves
    const moves = movesOf(t);
    const teams = new Set<string>([String(t.teamId)]);
    for (const m of moves) for (const id of [m.from, m.to]) if (id) teams.add(id);
    for (const k of Object.keys(t.teamActions ?? {})) teams.add(k);
    const when = t.processDate ?? t.proposedDate;
    out.push({ id: t.id, type, week: t.scoringPeriodId, timestamp: iso(when ?? x.now.getTime()), teams: [...teams], moves: moves.map(({ playerId, from, to, pos }) => ({ playerId, from, to, ...(pos ? { pos } : {}) })) });
  }

  const history = tradeHistory(tradeRows, x.acquisitions, {
    now: x.now.getTime(),
    tradeCounters: x.tradeCounters,
    ...(x.revisionHours !== undefined ? { revisionHours: x.revisionHours } : {}),
    ...(x.activatedAt !== undefined ? { activatedAt: x.activatedAt } : {}),
    ...(x.weekOf ? { weekOf: x.weekOf } : {}),
  });
  out.push(...history.trades);
  if (history.unconfirmed)
    x.warnings.push({ code: "ESPN_TRADES_UNVERIFIED", message: `${history.unconfirmed} completed trade(s) found that the rosters can't confirm (the players traded aren't on the rosters they went to), so trade history may be incomplete.`, platformPath: "transactions[type=TRADE_ACCEPT|TRADE_UPHOLD]" });
  if (history.withoutPlayers)
    x.warnings.push({
      code: "ESPN_TRADE_WITHOUT_PLAYERS",
      message: `${history.withoutPlayers} completed trade(s) came back without the players traded (ESPN often hides trade details), and the rosters don't show them either (the players may have been dropped since), so a trade partner may be missing too.`,
      platformPath: "transactions[].items",
    });
  if (history.partnerUnknown.length) {
    // The rosters do show these trades (not "the rosters don't show them"): only the team that sent the players is unknown.
    const [first, ...rest] = history.partnerUnknown;
    const found = history.partnerUnknown.map((p) => `${x.teamName(p.receivedBy)} in week ${p.tx.week}`);
    x.warnings.push({
      code: "ESPN_TRADE_PARTNER_UNKNOWN",
      message:
        first && !rest.length
          ? `1 completed trade came back without the players traded (ESPN often hides trade details). The rosters show that ${x.teamName(first.receivedBy)} received players by trade in week ${first.tx.week}, but not which team it traded with, so the trade is listed without its partner.`
          : `${history.partnerUnknown.length} completed trades came back without the players traded (ESPN often hides trade details). The rosters show which teams received players by trade (${found.join("; ")}), but not which team each traded with, so those trades are listed without their partners.`,
      platformPath: "teams[].roster.entries[].acquisitionType",
    });
  }
  const fromRows = history.rebuilt.filter((r) => r.source === "rows");
  if (fromRows.length)
    x.notes.push(
      `Trades rebuilt from the rosters: ESPN lists ${plural(fromRows.length, "trade")} without the players traded, so the players come from the rosters (each one's roster entry says he was acquired by trade the moment the trade went through): ${fromRows.map((r) => rebuiltText(r, x.teamName)).join("; ")}.`,
    );
  const fromRosters = history.rebuilt.filter((r) => r.source === "rosters");
  if (fromRosters.length) {
    const one = fromRosters.length === 1;
    x.notes.push(`Trades only the rosters show: ${plural(fromRosters.length, "trade")} ${one ? "isn't" : "aren't"} in ESPN's transaction list, but the rosters (players acquired by trade at one instant) and ESPN's own trade counters show ${one ? "it" : "them"}: ${fromRosters.map((r) => rebuiltText(r, x.teamName)).join("; ")}.`);
  }
  const pending = history.pending;
  if (pending) x.notes.push(`${pending === 1 ? "1 accepted trade is" : `${pending} accepted trades are`} still in the league's review period, so ${pending === 1 ? "it isn't" : "they aren't"} counted yet.`);
  if (history.unresolved) {
    const one = history.unresolved === 1;
    x.notes.push(`${plural(history.unresolved, "accepted trade")} ${one ? "is" : "are"} past ${one ? "its" : "their"} review period but ${one ? "doesn't" : "don't"} show on the rosters (vetoed, or the players dropped since), so ${one ? "it isn't" : "they aren't"} counted.`);
  }

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
// Teams' records (the standings and the waiver order read the same numbers)

/** A team's W-L-T, points for and points against as the snapshot carries them (ESPN's points to cents). */
function standingOf(t: EspnLeague["teams"][number]): { record: Team["record"]; pointsFor: number; pointsAgainst: number } {
  const rec = t.record?.overall;
  return { record: { w: rec?.wins ?? 0, l: rec?.losses ?? 0, t: rec?.ties ?? 0 }, pointsFor: round2(rec?.pointsFor ?? 0), pointsAgainst: round2(rec?.pointsAgainst ?? 0) };
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

  // The waiver order (./waivers.ts): the weekly reset order where the league resets weekly, else ESPN's live rank.
  const acq = L.settings.acquisitionSettings;
  const waivers = espnWaiverOrder(
    L.teams.map((t) => ({ id: String(t.id), waiverRank: t.waiverRank, playoffSeed: t.playoffSeed, ...standingOf(t) })),
    { faab: acq?.isUsingAcquisitionBudget === true, acquisitionType: acq?.acquisitionType, waiverOrderReset: acq?.waiverOrderReset, orderEdited: L.status.isWaiverOrderEdited, divisions: (settings.divisions?.length ?? 0) >= 2 },
  );
  if (waivers.used) settings.waiverOrderUsed = waivers.used;
  notes.push(...waivers.notes);
  warnings.push(...waivers.warnings);

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
    const { waiverRank, liveWaiverRank } = waivers.ranks.get(String(t.id)) ?? {};
    const faabRemaining = faabRemainingOf(settings.faabBudget, t.transactionCounter?.acquisitionBudgetSpent);
    return {
      id: String(t.id),
      name,
      ownerName,
      roster,
      ir,
      taxi: [],
      ...standingOf(t),
      ...(settings.divisions && t.divisionId !== undefined && t.divisionId !== null ? { divisionId: String(t.divisionId) } : {}),
      ...(waiverRank !== undefined ? { waiverRank } : {}),
      ...(liveWaiverRank !== undefined ? { liveWaiverRank } : {}),
      ...(faabRemaining !== undefined ? { faabRemaining } : {}),
    };
  });

  // Injury return weeks (only when the player cards were fetched).
  const week = L.status.latestScoringPeriod;
  if (raw.playerCards !== undefined) {
    const injured = teams.flatMap((t) => [...t.roster, ...t.ir]).map((id) => playerInfos[id] as PlayerInfo).filter((p) => p.injury !== "ACTIVE");
    const dated = injured.filter((p) => p.injuryReturnWeek !== undefined);
    if (injured.length) notes.push(`Expected return weeks come from ESPN's player cards for ${dated.length} of ${plural(injured.length, "injured rostered player")}.`);
    // The engine's own test (§6 step 3: a probable, questionable or doubtful tag with a return week 2+ weeks out), so this list and the League page agree.
    const longer = dated.filter((p) => returnDateConflict(p, week) !== null);
    if (longer.length)
      notes.push(`ESPN expects ${plural(longer.length, "player")} listed as probable, questionable, doubtful or day-to-day to be out longer than that status suggests: ${longer.slice(0, 5).map((p) => `${p.name} (back week ${p.injuryReturnWeek})`).join(", ")}${longer.length > 5 ? ", …" : ""}.`);
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

  // Schedule: each matchup in its first NFL week, with all its weeks when the period spans several,
  // marked decided once ESPN has decided it, with ESPN's result when we can read it.
  const periodWeeks = new Map(Object.entries(L.settings.scheduleSettings.matchupPeriods).map(([mp, w]) => [Number(mp), [...w].sort((a, b) => a - b)]));
  const schedule: Matchup[] = [];
  let consolation = 0;
  // Unreadable results, tallied by what they change (unreadableResultWarnings); byes change nothing.
  const unreadable = { regular: noUnreadable(), playoff: noUnreadable(), bye: noUnreadable() };
  for (const m of L.schedule ?? []) {
    const weeks = periodWeeks.get(m.matchupPeriodId);
    const first = weeks?.[0];
    if (!weeks || first === undefined || !m.home) continue;
    if (m.playoffTierType && m.playoffTierType !== "WINNERS_BRACKET" && m.playoffTierType !== "NONE") {
      consolation++;
      continue;
    }
    const teamA = String(m.home.teamId);
    const teamB = m.away ? String(m.away.teamId) : null;
    const isPlayoff = m.matchupPeriodId > L.settings.scheduleSettings.matchupPeriodCount;
    const result = matchupResult(m, teamA, teamB, teamB === null ? unreadable.bye : isPlayoff ? unreadable.playoff : unreadable.regular);
    schedule.push({
      week: first,
      teamA,
      teamB,
      isPlayoff,
      ...(weeks.length > 1 ? { weeks: [...weeks] } : {}),
      ...(verdictOf(m) !== undefined ? { decided: true } : {}),
      ...(result ? { result } : {}),
    });
  }
  if (consolation) notes.push(`${consolation} consolation-bracket game(s) are left out of the schedule.`);
  warnings.push(...unreadableResultWarnings(unreadable.regular, unreadable.playoff, (settings.divisions?.length ?? 0) >= 2));

  const teamNames = new Map(teams.map((t) => [t.id, t.name]));
  const tradeCounters = new Map<string, number>();
  for (const t of L.teams) if (typeof t.transactionCounter?.trades === "number") tradeCounters.set(String(t.id), t.transactionCounter.trades);
  // The trade refill's evidence: every rostered player whose last acquisition was a trade.
  const acquisitions: TradeAcquisition[] = [];
  for (const t of L.teams)
    for (const e of t.roster?.entries ?? []) {
      if (e.acquisitionType !== "TRADE" || typeof e.acquisitionDate !== "number" || !Number.isFinite(e.acquisitionDate)) continue;
      const info = players.info(e.playerPoolEntry.player);
      if (info) acquisitions.push({ playerId: info.id, teamId: String(t.id), at: e.acquisitionDate, pos: info.pos });
    }
  const windows = proTeams ? weekWindows(proTeams) : [];
  const revisionHours = L.settings.tradeSettings.revisionHours ?? undefined;
  const activatedAt = L.status.activatedDate ?? undefined;
  const transactions = transactionsOf(txRows, {
    players,
    now: ctx.now,
    warnings,
    notes,
    tradeCounters,
    teamName: (id) => teamNames.get(id) ?? `Team ${id}`,
    acquisitions,
    ...(revisionHours !== undefined ? { revisionHours } : {}),
    ...(activatedAt !== undefined ? { activatedAt } : {}),
    ...(windows.length ? { weekOf: (ms: number) => weekOfInstant(ms, windows) } : {}),
    positionOf: movePositions(L, pool),
  });

  // Position and ID warnings.
  const sk = players.skipped;
  if (sk.tqb || slots.lineup.some((s) => s.slot === "TQB"))
    warnings.push({ code: "ESPN_TQB_AS_QB", message: `ESPN's team-QB position (TQB) is treated as a QB${sk.tqb ? ` (${sk.tqb} TQB unit${sk.tqb > 1 ? "s" : ""})` : ""}: it's scored with QB stats and can fill QB spots in our lineups.`, platformPath: "player.defaultPositionId = 15; settings.rosterSettings.lineupSlotCounts[\"1\"]" });
  if (sk.hc) warnings.push({ code: "ESPN_HC_UNMAPPED", message: `${sk.hc} head coach${sk.hc > 1 ? "es" : ""} (HC) left out${hcByTeam.length ? ` (on ${hcByTeam.join(", ")})` : ""}: head coaches aren't supported.`, platformPath: "player.defaultPositionId = 14" });
  for (const [id, n] of sk.unknown) warnings.push({ code: "ESPN_POSITION_UNKNOWN", message: `${n} player(s) have an ESPN position we don't know (defaultPositionId ${id}) and were left out.`, platformPath: "player.defaultPositionId" });
  for (const [status, n] of sk.unknownInjury) warnings.push({ code: "ESPN_INJURY_UNKNOWN", message: `${n} player(s) have an ESPN injury status we don't map (${status}); they're treated as healthy.`, platformPath: "player.injuryStatus" });
  // Player-id flags cover the players in the snapshot only (rostered and kept free agents, not the
  // rest of ESPN's free-agent pool), and name every one of them (§2.9 crosswalk rules).
  const inSnapshot = new Set(Object.values(playerInfos).map((p) => Number(p.ids.espn)));
  const snapshotOnly = <T extends NamedPlayer>(xs: readonly T[]): T[] => {
    const seen = new Set<number>();
    const out: T[] = [];
    for (const x of xs)
      if (inSnapshot.has(x.espnId) && !seen.has(x.espnId)) {
        seen.add(x.espnId);
        out.push(x);
      }
    return out;
  };
  const names = (xs: readonly NamedPlayer[]) => xs.map((x) => x.label).join("; ");
  const byName = snapshotOnly(sk.byName);
  if (byName.length) {
    const onRosters = byName.filter((x) => rostered.has(x.espnId));
    const freeAgentsByName = byName.filter((x) => !rostered.has(x.espnId));
    const where = [onRosters.length ? `On rosters: ${names(onRosters)}.` : "", freeAgentsByName.length ? `Free agents: ${names(freeAgentsByName)}.` : ""].filter(Boolean).join(" ");
    const one = byName.length === 1;
    warnings.push({ code: "ESPN_PLAYER_MATCHED_BY_NAME", message: `${plural(byName.length, "player")} ${one ? "isn't" : "aren't"} in any player ID source, so we matched ${one ? "him" : "each"} to the only active player with the same name, position and NFL team. ${where}`, platformPath: "player.id" });
  }
  const conflicts = snapshotOnly(sk.conflicts);
  if (conflicts.length) warnings.push({ code: "ESPN_ID_CONFLICT", message: `The player ID sources disagree about who ${plural(conflicts.length, "ESPN player id")} in this league belong${conflicts.length === 1 ? "s" : ""} to; each was matched by the crosswalk's tie-break, so check: ${names(conflicts)}.`, platformPath: "player.id" });
  for (const o of snapshotOnly(sk.overrides)) notes.push(idOverrideNote(o, o.conflict));
  const collisions = snapshotOnly(sk.collisions);
  if (collisions.length) warnings.push({ code: "ESPN_ID_COLLISION", message: `${plural(collisions.length, "player")} matched a Sleeper id already used by another player, so ${collisions.length === 1 ? "he keeps his" : "they keep their"} ESPN id: ${names(collisions)}.`, platformPath: "player.id" });
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
