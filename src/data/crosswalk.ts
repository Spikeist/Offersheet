/**
 * The player ID crosswalk (CLAUDE.md §2.9; Phase 1 "every player has a canonical ID from the
 * start"). Pure: resolverFromData() builds a PlayerIdResolver from already-fetched source data, so
 * tests and scripts can run it on fixtures with no network.
 *
 * Canonical id = the Sleeper player id. Each platform id is looked up in the sources below, in
 * priority order, following the Phase 0 findings (reports/probe-output/shared.md, XWALK):
 *
 *   espn        DynastyProcess, FantasyCalc, Sleeper DB   Sleeper's espn_id is sparse (201/818 active
 *                                                          skill players) and wrong for some active
 *                                                          players, so it comes last
 *   mfl         DynastyProcess, FantasyCalc
 *   fleaflicker DynastyProcess, FantasyCalc                both sparse (Phase 0: 6 and 408 of 735);
 *                                                          Fleaflicker leagues should use sportradar
 *   yahoo       DynastyProcess, Sleeper DB                 FantasyCalc has no Yahoo id
 *   sportradar  Sleeper DB, DynastyProcess                 Fleaflicker/Fantrax/MFL vendor ids
 *   gsis        DynastyProcess, Sleeper DB
 *   fantrax     none                                       no source carries Fantrax ids; the
 *                                                          Fantrax adapter joins on sportradar
 *
 * When sources give one platform id different Sleeper ids, the priority order above decides. (Phase 1
 * review: FantasyCalc gives some retired players' old ESPN ids to active namesakes, e.g. a retired CB's
 * id to an active RB, so preferring the active player picked the wrong man in 8 of 10 ESPN cases.)
 * Two narrow exceptions pick an active Sleeper player over the top source's inactive one:
 * - the top source lists the id twice (its own tie);
 * - a lower source's player is the same person: same name and position, and the same NFL team or
 *   GSIS id. Sleeper then has two records for him and the top source links the stale one (2026-09-29:
 *   an active QB and an active CB; same-position namesakes such as a retired and a rookie RB share
 *   neither team nor GSIS id, so they stay apart).
 * Every conflict is kept in conflicts() and exposed through PlayerIdResolver.conflict(), for adapters
 * to warn about the players in their league.
 *
 * Players missing from Sleeper's active lists (retired, unsigned) get DynastyProcess's name and
 * position through sleeperPlayer(): `active: false` only when every Sleeper player list loaded fully,
 * else `active: null` (unknown), so a failed or partial list never labels active players retired.
 */
import type { IdSource, PlayerIdResolver, SleeperPlayerLite } from "@/data/types";
import type { ImportWarning } from "@/engine/model";
import type { DynastyRow } from "./dynastyProcess";
import type { FantasyCalcPlayerIds } from "./fantasyCalcPlayers";
import { normalizeId, type IdKind } from "./ids";
import { SLEEPER_PLAYER_POSITIONS, toLite, type SleeperPlayerRecord } from "./sleeperPlayers";
import { buildTeamCodeIndex, cleanTeamCode, SLEEPER_TEAM_CODES, type DerivedTeamAlias, type TeamCodeObservation, type TeamName } from "./teamCodes";

export type CrosswalkSourceKey = "sleeper" | "dynastyProcess" | "fantasyCalc";

export const CROSSWALK_SOURCES: readonly { key: CrosswalkSourceKey; name: string }[] = [
  { key: "sleeper", name: "Sleeper players" },
  { key: "dynastyProcess", name: "DynastyProcess player IDs" },
  { key: "fantasyCalc", name: "FantasyCalc players" },
];

type MappedSource = Exclude<IdSource, "fantrax">;

/** Source priority per platform id (see the file comment). */
export const ID_SOURCE_PRIORITY: Readonly<Record<IdSource, readonly CrosswalkSourceKey[]>> = {
  espn: ["dynastyProcess", "fantasyCalc", "sleeper"],
  mfl: ["dynastyProcess", "fantasyCalc"],
  fleaflicker: ["dynastyProcess", "fantasyCalc"],
  yahoo: ["dynastyProcess", "sleeper"],
  sportradar: ["sleeper", "dynastyProcess"],
  gsis: ["dynastyProcess", "sleeper"],
  fantrax: [],
};

const KIND: Record<MappedSource, IdKind> = { espn: "espn", mfl: "mfl", fleaflicker: "fleaflicker", yahoo: "yahoo", sportradar: "sportradar", gsis: "gsis" };
const MAPPED: readonly MappedSource[] = ["espn", "mfl", "fleaflicker", "yahoo", "sportradar", "gsis"];

export interface CrosswalkData {
  /** Records from the Sleeper players DB; null when the source was unavailable. */
  sleeperPlayers: readonly SleeperPlayerRecord[] | null;
  /**
   * Sleeper lists (fantasy positions: "QB", "DL"…) that loaded fully and fresh (SleeperPlayersLoad.complete).
   * A player missing from Sleeper's lists counts as not active only when every player list (all but
   * DEF) is here; otherwise his status is unknown. Default: none (never claim "retired" unasked).
   */
  sleeperCompletePositions?: readonly string[];
  dynastyRows: readonly DynastyRow[] | null;
  fantasyCalcPlayers: readonly FantasyCalcPlayerIds[] | null;
  /** When the data was fetched (ISO): one time for all sources, or per source. Unknown → null. */
  fetchedAt?: string | null | Partial<Record<CrosswalkSourceKey, string | null>>;
  /** Why a source is missing or only partly loaded (plain text for the Import Report). */
  notes?: Partial<Record<CrosswalkSourceKey, string>>;
  /** Which sources were served from the server cache. */
  fromCache?: Partial<Record<CrosswalkSourceKey, boolean>>;
}

export interface CrosswalkSourceStatus {
  key: CrosswalkSourceKey;
  name: string;
  available: boolean;
  rows: number;
  /** ISO time the data was fetched from its source (for a cached copy, the original fetch); null when unknown or unavailable. */
  fetchedAt: string | null;
  fromCache: boolean;
  note?: string;
}

export interface CrosswalkConflict {
  source: IdSource;
  platformId: string;
  /** Distinct Sleeper ids offered, in priority order, with the sources offering each. */
  options: { sleeperId: string; from: CrosswalkSourceKey[]; active: boolean }[];
  chosen: string;
  /**
   * "source order": the highest-priority source's id. "active player": that source listed the id
   * twice, its first option wasn't an active Sleeper player and a later one was. "same player": the
   * top source's Sleeper id isn't an active player and a lower source's is an active record of the
   * same person (same name and position, and the same NFL team or GSIS id).
   */
  resolvedBy: "active player" | "same player" | "source order";
  /** One source offered two Sleeper ids (a duplicate inside that source). */
  withinSource: boolean;
}

/** PlayerIdResolver plus the details the Import Report and the probes want. */
export interface PlayerIdCrosswalk extends PlayerIdResolver {
  status(): CrosswalkSourceStatus[];
  conflicts(): readonly CrosswalkConflict[];
  /** The conflict behind one platform id, when there was one (adapters turn it into an ImportWarning). */
  conflict(source: IdSource, platformId: string): CrosswalkConflict | undefined;
  /** ImportWarnings for sources that were unavailable or only partly loaded. */
  warnings(): ImportWarning[];
  /** How many platform ids of this kind map to a Sleeper id. */
  mappedCount(source: IdSource): number;
  /** Team-code aliases derived from the data (e.g. JAC → JAX). */
  teamAliases(): readonly DerivedTeamAlias[];
  /**
   * Fallback for a player no source maps (Phase 0: a few rookie kickers): the Sleeper id of the ONLY
   * active Sleeper player with this name, position and NFL team, else undefined. Never a first
   * choice; adapters should add an ImportWarning for players matched this way.
   */
  matchByName(query: { name: string; position: string; team: string | null }): string | undefined;
}

/** Name comparison key: letters only, accents and suffixes (Jr, Sr, II–V) dropped. */
export function playerNameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z]/g, "");
}

/** Who a source row says the player is (to recognize one person behind two Sleeper ids). */
interface PersonFacts {
  name: string;
  /** Sleeper fantasy position (QB, RB, …, DL, LB, DB), or null when unknown. */
  position: string | null;
  /** NFL team code in the source's own convention, null for free agents. */
  team: string | null;
  gsis: string | null;
}

/** The source row behind a candidate (Sleeper records need none: they are their own evidence). */
type SourceRow = { from: "dynastyProcess"; row: DynastyRow } | { from: "fantasyCalc"; row: FantasyCalcPlayerIds };

interface Candidate {
  platformId: string;
  sleeperId: string;
  from: CrosswalkSourceKey;
  source?: SourceRow;
}

/** Who a source row says the player is (only computed for the rare conflicts that need it). */
function factsOf(source: SourceRow | undefined): PersonFacts | undefined {
  if (!source) return undefined;
  if (source.from === "dynastyProcess") {
    const r = source.row;
    return { name: r.name, position: (r.position ? DP_POSITION[r.position]?.[1] : undefined) ?? null, team: r.team, gsis: r.gsisId };
  }
  // FantasyCalc's positions (QB, RB, WR, TE) are Sleeper fantasy positions; it carries no GSIS id.
  const p = source.row;
  return { name: p.name, position: p.position || null, team: p.team, gsis: null };
}

/** Where each source keeps each kind of platform id. */
const DP_FIELD: Record<MappedSource, "espnId" | "mflId" | "fleaflickerId" | "yahooId" | "sportradarId" | "gsisId"> = {
  espn: "espnId",
  mfl: "mflId",
  fleaflicker: "fleaflickerId",
  yahoo: "yahooId",
  sportradar: "sportradarId",
  gsis: "gsisId",
};
const FC_FIELD: Partial<Record<MappedSource, "espnId" | "mflId" | "fleaflickerId">> = { espn: "espnId", mfl: "mflId", fleaflicker: "fleaflickerId" };
const SLEEPER_FIELD: Partial<Record<MappedSource, "espnId" | "yahooId" | "sportradarId" | "gsisId">> = { espn: "espnId", yahoo: "yahooId", sportradar: "sportradarId", gsis: "gsisId" };

interface Pair {
  raw: unknown;
  sleeperId: string | null;
  source?: SourceRow;
}

/** The (platform id, Sleeper id) pairs one source offers for one id kind, with the row behind each. */
function pairsFrom(data: CrosswalkData, key: CrosswalkSourceKey, source: MappedSource): Pair[] {
  if (key === "dynastyProcess") {
    const field = DP_FIELD[source];
    return (data.dynastyRows ?? []).map((row) => ({ raw: row[field], sleeperId: row.sleeperId, source: { from: key, row } }));
  }
  if (key === "fantasyCalc") {
    const field = FC_FIELD[source];
    return field ? (data.fantasyCalcPlayers ?? []).map((row) => ({ raw: row[field], sleeperId: row.sleeperId, source: { from: key, row } })) : [];
  }
  const field = SLEEPER_FIELD[source];
  // Team-defense rows (ids like "DAL") carry no platform ids; normalizeId drops them.
  return field ? (data.sleeperPlayers ?? []).map((p) => ({ raw: p[field], sleeperId: normalizeId("sleeper", p.id) })) : [];
}

/**
 * Candidates arrive in priority order (source by source), so each id's options do too.
 * `samePerson(facts, sleeperId)`: the active Sleeper record `sleeperId` is the person a source row describes.
 */
function resolveSource(
  source: MappedSource,
  candidates: Candidate[],
  isActive: (sleeperId: string) => boolean,
  samePerson: (facts: PersonFacts | undefined, sleeperId: string) => boolean,
): { map: Map<string, string>; conflicts: CrosswalkConflict[] } {
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const list = groups.get(c.platformId);
    if (list) list.push(c);
    else groups.set(c.platformId, [c]);
  }
  const map = new Map<string, string>();
  const conflicts: CrosswalkConflict[] = [];
  for (const [platformId, list] of groups) {
    const options: CrosswalkConflict["options"] = [];
    for (const c of list) {
      const o = options.find((x) => x.sleeperId === c.sleeperId);
      if (o) {
        if (!o.from.includes(c.from)) o.from.push(c.from);
      } else options.push({ sleeperId: c.sleeperId, from: [c.from], active: isActive(c.sleeperId) });
    }
    const first = options[0];
    if (!first) continue;
    if (options.length === 1) {
      map.set(platformId, first.sleeperId);
      continue;
    }
    // Across sources the priority order decides; the active player only breaks a tie inside the top
    // source, or stands in for the top source's stale record of the same person.
    const top = list[0]?.from;
    const topOptions = options.filter((o) => top !== undefined && o.from.includes(top));
    let pick = (topOptions.length > 1 ? topOptions.find((o) => o.active) : undefined) ?? first;
    let resolvedBy: CrosswalkConflict["resolvedBy"] = pick === first ? "source order" : "active player";
    if (!pick.active) {
      const facts = factsOf(list.find((c) => c.sleeperId === pick.sleeperId && c.from === top)?.source);
      const same = options.find((o) => o.active && samePerson(facts, o.sleeperId));
      if (same) {
        pick = same;
        resolvedBy = "same player";
      }
    }
    const perSource = new Map<CrosswalkSourceKey, Set<string>>();
    for (const c of list) perSource.set(c.from, (perSource.get(c.from) ?? new Set<string>()).add(c.sleeperId));
    conflicts.push({ source, platformId, options, chosen: pick.sleeperId, resolvedBy, withinSource: [...perSource.values()].some((s) => s.size > 1) });
    map.set(platformId, pick.sleeperId);
  }
  return { map, conflicts };
}

function isTeamDefense(p: SleeperPlayerRecord): boolean {
  return p.position === "DEF" || /^[A-Z]{2,3}$/.test(p.id);
}

/**
 * Sleeper's player lists: every fantasy position but DEF. A player missing from all of them is "not
 * active" only when every one loaded fully. The list for his DynastyProcess position alone proves
 * nothing: on 2026-09-29, 88 of 4,624 active players were listed by DynastyProcess under a position
 * whose Sleeper list doesn't hold them (DL/LB, LB/DB, WR/TE, …).
 */
const SLEEPER_PLAYER_LISTS: readonly string[] = SLEEPER_PLAYER_POSITIONS.filter((p) => p !== "DEF");

/** DynastyProcess position → [Sleeper's primary position, Sleeper fantasy position]; unknown codes (XX, OT, ?) map to nothing. */
const DP_POSITION: Readonly<Record<string, readonly [string, string]>> = {
  QB: ["QB", "QB"],
  RB: ["RB", "RB"],
  WR: ["WR", "WR"],
  TE: ["TE", "TE"],
  PK: ["K", "K"],
  PN: ["P", "P"],
  DE: ["DE", "DL"],
  DT: ["DT", "DL"],
  DL: ["DL", "DL"],
  LB: ["LB", "LB"],
  CB: ["CB", "DB"],
  S: ["S", "DB"],
  DB: ["DB", "DB"],
};

/** What the Import Report loses when a source is unavailable. */
const UNAVAILABLE_EFFECT: Record<CrosswalkSourceKey, string> = {
  sleeper: "some player details (such as age) may be missing, and retired players can't be told apart from active ones",
  dynastyProcess: "some players may keep platform ids instead of Sleeper ids",
  fantasyCalc: "some players may keep platform ids instead of Sleeper ids",
};

/** Build the resolver from fetched source data (pure; no I/O, no clock). */
export function resolverFromData(data: CrosswalkData): PlayerIdCrosswalk {
  const sleeperById = new Map<string, SleeperPlayerRecord>();
  for (const p of data.sleeperPlayers ?? []) if (!sleeperById.has(p.id)) sleeperById.set(p.id, p);
  const isActive = (id: string) => sleeperById.get(id)?.active === true;
  const completeLists = new Set(data.sleeperCompletePositions ?? []);
  /** Absence from Sleeper's lists means "not active" only when every player list loaded fully. */
  const sleeperListsComplete = data.sleeperPlayers !== null && SLEEPER_PLAYER_LISTS.every((p) => completeLists.has(p));

  // ---- team codes (Sleeper DEF id = team code)
  const sleeperCodes = new Set<string>();
  const teamOfPlayer = new Map<string, string>();
  const teamNames: TeamName[] = [];
  for (const p of sleeperById.values()) {
    if (isTeamDefense(p)) {
      sleeperCodes.add(p.id);
      teamNames.push({ code: p.id, location: p.firstName, nickname: p.lastName });
    }
    if (p.team) {
      sleeperCodes.add(p.team);
      teamOfPlayer.set(p.id, p.team);
    }
  }
  // Without the Sleeper DB, FantasyCalc's teams (same convention) stand in.
  const haveSleeper = sleeperById.size > 0;
  for (const p of data.fantasyCalcPlayers ?? []) {
    if (!p.team || !p.sleeperId) continue;
    if (!haveSleeper) sleeperCodes.add(p.team);
    if (!teamOfPlayer.has(p.sleeperId)) teamOfPlayer.set(p.sleeperId, p.team);
  }
  // Neither loaded: Sleeper's 32 current codes, so ESPN's and nflverse's codes still resolve (DATA-6).
  if (!sleeperCodes.size) for (const code of SLEEPER_TEAM_CODES) sleeperCodes.add(code);
  const observations: TeamCodeObservation[] = [];
  for (const r of data.dynastyRows ?? []) if (r.sleeperId && r.team) observations.push({ source: "DynastyProcess", code: r.team, sleeperId: r.sleeperId });
  for (const p of data.fantasyCalcPlayers ?? []) if (p.sleeperId && p.team) observations.push({ source: "FantasyCalc", code: p.team, sleeperId: p.sleeperId });
  const teams = buildTeamCodeIndex({ sleeperCodes, teamNames, observations, teamOfPlayer });

  // ---- platform id → Sleeper id, per id kind
  /** The active Sleeper record `sleeperId` is the person a source row describes: same name and position, and the same NFL team or GSIS id. */
  const samePerson = (facts: PersonFacts | undefined, sleeperId: string): boolean => {
    const rec = sleeperById.get(sleeperId);
    if (!facts || !rec || rec.active !== true || !facts.position || !facts.name) return false;
    if (playerNameKey(facts.name) !== playerNameKey(rec.name)) return false;
    if (rec.position !== facts.position && !rec.fantasyPositions.includes(facts.position)) return false;
    const team = facts.team ? teams.toSleeper(facts.team) : undefined;
    return (team !== undefined && team === rec.team) || (facts.gsis !== null && facts.gsis === rec.gsisId);
  };
  const maps = new Map<MappedSource, Map<string, string>>();
  const conflictList: CrosswalkConflict[] = [];
  const conflictIndex = new Map<string, CrosswalkConflict>();
  for (const source of MAPPED) {
    const candidates: Candidate[] = [];
    for (const key of ID_SOURCE_PRIORITY[source]) {
      for (const pair of pairsFrom(data, key, source)) {
        const platformId = normalizeId(KIND[source], pair.raw);
        if (platformId && pair.sleeperId) candidates.push({ platformId, sleeperId: pair.sleeperId, from: key, source: pair.source });
      }
    }
    const { map, conflicts } = resolveSource(source, candidates, isActive, samePerson);
    maps.set(source, map);
    for (const c of conflicts) {
      conflictList.push(c);
      conflictIndex.set(`${source}\u0000${c.platformId}`, c);
    }
  }

  /** Built on the first matchByName() call. */
  let byName: Map<string, SleeperPlayerRecord[]> | undefined;
  /** Sleeper id → DynastyProcess row, for players missing from Sleeper's active lists (built on first use). */
  let dpBySleeper: Map<string, DynastyRow> | undefined;
  const fromDynastyProcess = (id: string): SleeperPlayerLite | undefined => {
    if (!dpBySleeper) {
      dpBySleeper = new Map();
      for (const r of data.dynastyRows ?? []) if (r.sleeperId && !dpBySleeper.has(r.sleeperId)) dpBySleeper.set(r.sleeperId, r);
    }
    const r = dpBySleeper.get(id);
    const pos = r?.position ? DP_POSITION[r.position] : undefined;
    if (!r || !r.name || !pos) return undefined;
    // Not in Sleeper's lists. With every list complete he isn't an active player, and his last team in
    // DynastyProcess is stale; otherwise a list that failed may hold him, so his status is unknown.
    const team = sleeperListsComplete || !r.team ? null : (teams.toSleeper(r.team) ?? null);
    return { id, name: r.name, position: pos[0], fantasyPositions: [pos[1]], team, injuryStatus: null, status: null, age: null, active: sleeperListsComplete ? false : null, yearsExp: null };
  };

  // ---- source status
  const rows: Record<CrosswalkSourceKey, number | null> = {
    sleeper: data.sleeperPlayers ? data.sleeperPlayers.length : null,
    dynastyProcess: data.dynastyRows ? data.dynastyRows.length : null,
    fantasyCalc: data.fantasyCalcPlayers ? data.fantasyCalcPlayers.length : null,
  };
  const fetchedAtFor = (key: CrosswalkSourceKey): string | null => {
    const f = data.fetchedAt;
    if (f === undefined || f === null) return null;
    return typeof f === "string" ? f : (f[key] ?? null);
  };
  const statusList: CrosswalkSourceStatus[] = CROSSWALK_SOURCES.map(({ key, name }) => {
    const n = rows[key];
    const note = data.notes?.[key];
    return {
      key,
      name,
      available: n !== null,
      rows: n ?? 0,
      fetchedAt: n === null ? null : fetchedAtFor(key),
      fromCache: n !== null && (data.fromCache?.[key] ?? false),
      ...(note ? { note } : {}),
    };
  });

  return {
    canonical(source: IdSource, platformId: string): string | undefined {
      if (source === "fantrax") return undefined;
      const id = normalizeId(KIND[source], platformId);
      return id ? maps.get(source)?.get(id) : undefined;
    },
    sleeperPlayer(sleeperId: string): SleeperPlayerLite | undefined {
      const id = String(sleeperId).trim();
      const p = sleeperById.get(id);
      // Sleeper's lists hold active players only; a player missing from them who is still on a roster
      // (dynasty leagues) gets DynastyProcess's name and position (active false or null, see above).
      return p ? toLite(p) : fromDynastyProcess(id);
    },
    defenseId(teamCode: string): string | undefined {
      return teams.toSleeper(teamCode);
    },
    sources() {
      return statusList.map((s) => ({ name: s.name, fetchedAt: s.fetchedAt }));
    },
    status() {
      return statusList.map((s) => ({ ...s }));
    },
    conflicts() {
      return conflictList;
    },
    conflict(source: IdSource, platformId: string) {
      if (source === "fantrax") return undefined;
      const id = normalizeId(KIND[source], platformId);
      return id ? conflictIndex.get(`${source}\u0000${id}`) : undefined;
    },
    warnings(): ImportWarning[] {
      return statusList.flatMap((s): ImportWarning[] => {
        if (!s.available) return [{ code: "ID_SOURCE_UNAVAILABLE", message: `${s.name} could not be loaded${s.note ? ` (${s.note})` : ""}, so ${UNAVAILABLE_EFFECT[s.key]}.` }];
        if (s.note) return [{ code: "ID_SOURCE_PARTIAL", message: `${s.name}: ${s.note}` }];
        return [];
      });
    },
    mappedCount(source: IdSource): number {
      return source === "fantrax" ? 0 : (maps.get(source)?.size ?? 0);
    },
    teamAliases() {
      return teams.derived;
    },
    matchByName(query: { name: string; position: string; team: string | null }): string | undefined {
      byName ??= indexByName(sleeperById.values());
      const key = playerNameKey(query.name);
      const pos = query.position.trim().toUpperCase();
      // null, "", "FA" … mean a free agent (Sleeper team null); an unknown code matches nobody.
      const code = cleanTeamCode(query.team);
      const team = code === null ? null : teams.toSleeper(code);
      if (!key || team === undefined) return undefined;
      const found = (byName.get(key) ?? []).filter((p) => p.active && p.team === team && (p.position === pos || p.fantasyPositions.includes(pos)));
      return found.length === 1 ? found[0]?.id : undefined;
    },
  };
}

function indexByName(players: Iterable<SleeperPlayerRecord>): Map<string, SleeperPlayerRecord[]> {
  const out = new Map<string, SleeperPlayerRecord[]>();
  for (const p of players) {
    if (isTeamDefense(p)) continue;
    const key = playerNameKey(p.name);
    if (!key) continue;
    const list = out.get(key);
    if (list) list.push(p);
    else out.set(key, [p]);
  }
  return out;
}
