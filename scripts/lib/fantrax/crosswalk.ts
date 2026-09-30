/**
 * Fantrax player IDs → canonical (Sleeper) IDs. Pure functions, unit-tested without network.
 *
 * Neither FantasyCalc nor DynastyProcess has a Fantrax column, but getPlayerIds carries three
 * vendor IDs that the Sleeper players DB and DynastyProcess also have:
 *   sportRadarId → Sleeper sportradar_id / DynastyProcess sportradar_id
 *   rotowireId   → Sleeper rotowire_id   / DynastyProcess rotowire_id
 *   statsIncId   → DynastyProcess stats_id (Sleeper's stats_id is a different STATS id)
 *
 * A vendor ID can sit on several rows (Sleeper keeps "Duplicate Player" / "Player Invalid" rows and
 * a few true duplicates), so every index keeps all ids per key and the crosswalk picks the most
 * plausible one: a real row, active, whose position and NFL team agree with Fantrax.
 */
import { NO_ADP, TEAM_PLAYER_FORMAT_POSITIONS, nflTeamOf, recordKind, type FantraxAdp, type FantraxPlayer, type RecordKind } from "./api";

export const SKILL = new Set(["QB", "RB", "WR", "TE"]);

/** DynastyProcess writes missing values as "NA". */
export function dpValue(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t && t !== "NA" ? t : undefined;
}

export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// ---------------------------------------------------------------------------------------------
// getPlayerIds summary

export interface PlayerIdsSummary {
  total: number;
  byKind: Record<RecordKind, number>;
  keyMismatches: number;
  /** Team-unit code (after '#') → the position Fantrax gives it, e.g. "1090" → "DST". */
  unitCodes: Record<string, string>;
  /** Team units that use player-format ids (TK, TQB): counts per position, and how many carry a vendor id. */
  teamPlayerFormat: { positions: Record<string, number>; withVendorIds: number; example?: string };
  /** Position counts over every record (players and team units). */
  positions: Record<string, number>;
  /** Among real players. */
  noNflTeam: number;
  /** "Last, First" names among real players. */
  lastCommaFirst: number;
  /** Real players whose position is Fantrax's "Default" (no fantasy position assigned). */
  defaultPosition: number;
  /** Player-format records named "Team …" that aren't TK/TQB: a new team-level position to classify. */
  suspectTeamRecords: number;
  /** Vendor-ID fill rates among real players, and among QB/RB/WR/TE on an NFL team. */
  fill: { all: Fill; skillOnTeam: Fill };
}
export interface Fill {
  n: number;
  sportRadarId: number;
  rotowireId: number;
  statsIncId: number;
  none: number;
}

function emptyFill(): Fill {
  return { n: 0, sportRadarId: 0, rotowireId: 0, statsIncId: 0, none: 0 };
}

function hasVendorId(p: FantraxPlayer): boolean {
  return Boolean(p.sportRadarId) || p.rotowireId !== undefined || p.statsIncId !== undefined;
}

function addFill(f: Fill, p: FantraxPlayer): void {
  f.n++;
  if (p.sportRadarId) f.sportRadarId++;
  if (p.rotowireId !== undefined) f.rotowireId++;
  if (p.statsIncId !== undefined) f.statsIncId++;
  if (!hasVendorId(p)) f.none++;
}

export function summarizePlayerIds(ids: Record<string, FantraxPlayer>): PlayerIdsSummary {
  const s: PlayerIdsSummary = {
    total: 0,
    byKind: { player: 0, teamUnit: 0, teamPlayerFormat: 0, other: 0 },
    keyMismatches: 0,
    unitCodes: {},
    teamPlayerFormat: { positions: {}, withVendorIds: 0 },
    positions: {},
    noNflTeam: 0,
    lastCommaFirst: 0,
    defaultPosition: 0,
    suspectTeamRecords: 0,
    fill: { all: emptyFill(), skillOnTeam: emptyFill() },
  };
  for (const [key, p] of Object.entries(ids)) {
    s.total++;
    const kind = recordKind(key, p);
    s.byKind[kind]++;
    if (p.fantraxId !== key) s.keyMismatches++;
    s.positions[p.position] = (s.positions[p.position] ?? 0) + 1;
    if (kind === "teamUnit") {
      const code = key.split("#")[1] ?? "";
      s.unitCodes[code] = p.position;
      continue;
    }
    if (kind === "teamPlayerFormat") {
      s.teamPlayerFormat.positions[p.position] = (s.teamPlayerFormat.positions[p.position] ?? 0) + 1;
      if (hasVendorId(p)) s.teamPlayerFormat.withVendorIds++;
      s.teamPlayerFormat.example ??= p.name;
      continue;
    }
    if (kind !== "player") continue;
    if (/^Team\b/.test(p.name) && !hasVendorId(p)) s.suspectTeamRecords++;
    if (p.position === "Default") s.defaultPosition++;
    addFill(s.fill.all, p);
    if (!nflTeamOf(p)) s.noNflTeam++;
    else if (SKILL.has(p.position)) addFill(s.fill.skillOnTeam, p);
    if (/^[^,]+, [^,]+$/.test(p.name)) s.lastCommaFirst++;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------
// getAdp summary

export interface AdpSummary {
  total: number;
  /** Entries with a position (players and TK/TQB team units). */
  withPos: number;
  /** Real players (a position that isn't TK/TQB, no tmId). */
  players: number;
  /** TK/TQB team units (player-format ids). */
  teamPlayerFormat: number;
  withAdpPpr: number;
  withAdp: number;
  realAdpPpr: number;
  realAdp: number;
  teamDefenses: number;
  order: "ADP_PPR ascending" | "ADP ascending" | "name ascending" | "no single order";
  /** Entries (players and TK/TQB) whose id is a key of getPlayerIds; team defenses match "<id>#<DST code>". */
  joined: number;
  teamJoined: number;
  unmatchedIds: string[];
  /** Joined players whose names differ from getPlayerIds (exactly / after normalizing punctuation). */
  nameDiffs: number;
  nameDiffsNormalized: number;
  nameDiffExamples: Array<{ adp: string; ids: string }>;
}

function isSorted(values: number[] | string[]): boolean {
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1] as number | string;
    const b = values[i] as number | string;
    if (typeof a === "number" && typeof b === "number" ? a > b : String(a).localeCompare(String(b)) > 0) return false;
  }
  return true;
}

export function summarizeAdp(adp: FantraxAdp[], ids: Record<string, FantraxPlayer>, dstCode: string | undefined): AdpSummary {
  const s: AdpSummary = {
    total: adp.length,
    withPos: 0,
    players: 0,
    teamPlayerFormat: 0,
    withAdpPpr: 0,
    withAdp: 0,
    realAdpPpr: 0,
    realAdp: 0,
    teamDefenses: 0,
    order: "no single order",
    joined: 0,
    teamJoined: 0,
    unmatchedIds: [],
    nameDiffs: 0,
    nameDiffsNormalized: 0,
    nameDiffExamples: [],
  };
  for (const e of adp) {
    if (e.pos) s.withPos++;
    if (e.ADP_PPR !== undefined) s.withAdpPpr++;
    if (e.ADP !== undefined) s.withAdp++;
    if (e.ADP_PPR !== undefined && e.ADP_PPR < NO_ADP) s.realAdpPpr++;
    if (e.ADP !== undefined && e.ADP < NO_ADP) s.realAdp++;
    if (e.tmId) {
      s.teamDefenses++;
      if (dstCode && ids[`${e.id}#${dstCode}`]) s.teamJoined++;
      else s.unmatchedIds.push(e.id);
      continue;
    }
    const p = ids[e.id];
    const teamUnit = (e.pos !== undefined && TEAM_PLAYER_FORMAT_POSITIONS.has(e.pos)) || (p !== undefined && recordKind(e.id, p) === "teamPlayerFormat");
    if (teamUnit) s.teamPlayerFormat++;
    else s.players++;
    if (!p) {
      s.unmatchedIds.push(e.id);
      continue;
    }
    s.joined++;
    if (p.name !== e.name) {
      s.nameDiffs++;
      if (normalizeName(p.name) !== normalizeName(e.name)) s.nameDiffsNormalized++;
      if (s.nameDiffExamples.length < 3) s.nameDiffExamples.push({ adp: e.name, ids: p.name });
    }
  }
  if (isSorted(adp.map((e) => e.ADP_PPR ?? NO_ADP))) s.order = "ADP_PPR ascending";
  else if (isSorted(adp.map((e) => e.ADP ?? NO_ADP))) s.order = "ADP ascending";
  else if (isSorted(adp.map((e) => e.name))) s.order = "name ascending";
  return s;
}

// ---------------------------------------------------------------------------------------------
// ID crosswalk

export interface SleeperLike {
  player_id?: unknown;
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  sportradar_id?: unknown;
  rotowire_id?: unknown;
  position?: unknown;
  fantasy_positions?: unknown;
  team?: unknown;
  status?: unknown;
  injury_status?: unknown;
  active?: unknown;
}

export interface SleeperInfo {
  positions: string[];
  team?: string;
  status?: string;
  injury?: string;
  active: boolean;
  /** Sleeper's "Duplicate Player" / "Player Invalid" / "<name> DUPLICATE" rows. */
  placeholder: boolean;
}

export interface SleeperIndex {
  /** Lower-cased sportradar_id → every Sleeper id carrying it (usually one). */
  bySportradar: Map<string, string[]>;
  byRotowire: Map<string, string[]>;
  /** Sleeper id → positions, NFL team and status, to rank candidates and sanity-check matches. */
  info: Map<string, SleeperInfo>;
}

const idStr = (v: unknown): string | undefined => (typeof v === "string" || typeof v === "number" ? String(v).trim() || undefined : undefined);

/** Sleeper's placeholder rows keep a real player's vendor ids. */
export const SLEEPER_PLACEHOLDER_NAME = /\bduplicate\b|^player invalid$/i;

function pushUnique(m: Map<string, string[]>, key: string, id?: string): void {
  const list = m.get(key) ?? [];
  if (id !== undefined && !list.includes(id)) list.push(id);
  m.set(key, list);
}

export function buildSleeperIndex(players: Record<string, SleeperLike>): SleeperIndex {
  const idx = emptySleeperIndex();
  for (const [key, p] of Object.entries(players)) {
    const id = idStr(p.player_id) ?? key;
    const sr = idStr(p.sportradar_id);
    const rw = idStr(p.rotowire_id);
    if (sr) pushUnique(idx.bySportradar, sr.toLowerCase(), id);
    if (rw) pushUnique(idx.byRotowire, rw, id);
    const positions = [idStr(p.position), ...(Array.isArray(p.fantasy_positions) ? p.fantasy_positions.map(idStr) : [])].filter((x): x is string => Boolean(x));
    const name = idStr(p.full_name) ?? [idStr(p.first_name), idStr(p.last_name)].filter(Boolean).join(" ");
    idx.info.set(id, {
      positions: [...new Set(positions)],
      team: idStr(p.team),
      status: idStr(p.status),
      injury: idStr(p.injury_status),
      active: p.active === true,
      placeholder: SLEEPER_PLACEHOLDER_NAME.test(name),
    });
  }
  return idx;
}

export function emptySleeperIndex(): SleeperIndex {
  return { bySportradar: new Map(), byRotowire: new Map(), info: new Map() };
}

export interface DpIndex {
  columns: string[];
  /** Vendor id → sleeper_id of every DynastyProcess row with it; an empty list = rows without a sleeper_id. */
  bySportradar: Map<string, string[]>;
  byRotowire: Map<string, string[]>;
  byStats: Map<string, string[]>;
}

/** DynastyProcess rows (db_playerids.csv) indexed by the vendor IDs Fantrax also has. */
export function buildDpIndex(rows: Array<Record<string, string>>): DpIndex {
  const idx: DpIndex = { columns: Object.keys(rows[0] ?? {}), bySportradar: new Map(), byRotowire: new Map(), byStats: new Map() };
  for (const r of rows) {
    const sleeper = dpValue(r.sleeper_id);
    const sr = dpValue(r.sportradar_id);
    const rw = dpValue(r.rotowire_id);
    const st = dpValue(r.stats_id);
    if (sr) pushUnique(idx.bySportradar, sr.toLowerCase(), sleeper);
    if (rw) pushUnique(idx.byRotowire, rw, sleeper);
    if (st) pushUnique(idx.byStats, st, sleeper);
  }
  return idx;
}

export type MatchVia = "sleeper.sportradar_id" | "sleeper.rotowire_id" | "dp.sportradar_id" | "dp.rotowire_id" | "dp.stats_id";
export const MATCH_ORDER: readonly MatchVia[] = ["sleeper.sportradar_id", "sleeper.rotowire_id", "dp.sportradar_id", "dp.rotowire_id", "dp.stats_id"];

export interface CrosswalkResult {
  sleeperId?: string;
  via?: MatchVia;
  /** Every Sleeper id any method found, in MATCH_ORDER (one vendor id can map to several rows). */
  candidates: Array<{ via: MatchVia; sleeperId: string }>;
  /** More than one distinct Sleeper id among the candidates (methods disagree, or a vendor id is duplicated). */
  conflict: boolean;
  /** Some method's vendor id maps to more than one Sleeper id. */
  duplicateKey: boolean;
  /** The kept id tied with another candidate of its method on every preference: needs a human look. */
  ambiguous: boolean;
  /** Found in DynastyProcess at all (even without a sleeper_id). */
  inDp: boolean;
}

/** Agreement of a Sleeper row with the Fantrax record. Unknown ids (DynastyProcess-only) agree on nothing. */
function agreesWith(p: FantraxPlayer, info: SleeperIndex["info"], sleeperId: string): { pos: boolean; team: boolean; known: boolean; placeholder: boolean; active: boolean } {
  const i = info.get(sleeperId);
  if (!i) return { pos: false, team: false, known: false, placeholder: false, active: false };
  return { pos: i.positions.includes(p.position), team: (i.team ?? null) === nflTeamOf(p), known: true, placeholder: i.placeholder, active: i.active };
}

/** A real (non-placeholder) Sleeper row whose position and NFL team both match Fantrax. */
export function plausibleMatch(p: FantraxPlayer, info: SleeperIndex["info"], sleeperId: string): boolean {
  const a = agreesWith(p, info, sleeperId);
  return a.known && !a.placeholder && a.pos && a.team;
}

/** Preference among one method's candidates: real row, then active, then position, then NFL team. */
function preference(p: FantraxPlayer, info: SleeperIndex["info"], sleeperId: string): number {
  const a = agreesWith(p, info, sleeperId);
  if (!a.known) return 0;
  return (a.placeholder ? 0 : 8) + (a.active ? 4 : 0) + (a.pos ? 2 : 0) + (a.team ? 1 : 0);
}

/**
 * Try the methods in MATCH_ORDER; the first method with any hit decides. When its vendor id maps to
 * several Sleeper rows, keep the most plausible (see preference), then the one other methods also
 * found, then the lowest id (deterministic). Disagreements and duplicates are flagged, never hidden.
 */
export function crosswalkPlayer(p: FantraxPlayer, sleeper: SleeperIndex, dp?: DpIndex): CrosswalkResult {
  const sr = p.sportRadarId?.trim().toLowerCase();
  const rw = p.rotowireId !== undefined ? String(p.rotowireId) : undefined;
  const st = p.statsIncId !== undefined ? String(p.statsIncId) : undefined;
  const hits: Array<[MatchVia, string[]]> = [
    ["sleeper.sportradar_id", (sr && sleeper.bySportradar.get(sr)) || []],
    ["sleeper.rotowire_id", (rw && sleeper.byRotowire.get(rw)) || []],
    ["dp.sportradar_id", (sr && dp?.bySportradar.get(sr)) || []],
    ["dp.rotowire_id", (rw && dp?.byRotowire.get(rw)) || []],
    ["dp.stats_id", (st && dp?.byStats.get(st)) || []],
  ];
  const inDp = Boolean(dp && ((sr && dp.bySportradar.has(sr)) || (rw && dp.byRotowire.has(rw)) || (st && dp.byStats.has(st))));
  const candidates = hits.flatMap(([via, list]) => list.map((sleeperId) => ({ via, sleeperId })));
  const duplicateKey = hits.some(([, list]) => list.length > 1);
  const support = (id: string) => new Set(candidates.filter((c) => c.sleeperId === id).map((c) => c.via)).size;
  const first = hits.find(([, list]) => list.length > 0);
  let sleeperId: string | undefined;
  let ambiguous = false;
  if (first) {
    const ranked = [...first[1]].sort(
      (a, b) => preference(p, sleeper.info, b) - preference(p, sleeper.info, a) || support(b) - support(a) || a.localeCompare(b, "en", { numeric: true }),
    );
    sleeperId = ranked[0];
    const second = ranked[1];
    ambiguous = second !== undefined && sleeperId !== undefined && preference(p, sleeper.info, second) === preference(p, sleeper.info, sleeperId) && support(second) === support(sleeperId);
  }
  return { sleeperId, via: first?.[0], candidates, conflict: new Set(candidates.map((c) => c.sleeperId)).size > 1, duplicateKey, ambiguous, inDp };
}

export interface ConflictDetail {
  name: string;
  pos: string;
  team: string | null;
  /** The kept id and whether it is a plausible match (real row, position and team agree). */
  kept: { via: MatchVia; agrees: boolean };
  others: Array<{ via: MatchVia; agrees: boolean; placeholder: boolean }>;
}

export interface CrosswalkSummary {
  n: number;
  matched: number;
  rate: number;
  byVia: Partial<Record<MatchVia, number>>;
  /** Matched using only the Sleeper players DB (no DynastyProcess). */
  sleeperDirect: number;
  inDp: number;
  dpWithSleeper: number;
  /** Among matches found in the Sleeper DB: Sleeper position (or fantasy position) / NFL team equal Fantrax's. */
  checked: number;
  positionAgrees: number;
  teamAgrees: number;
  /** Checked matches that differ only in position, only in NFL team, or in both. */
  positionOnlyDiffs: number;
  teamOnlyDiffs: number;
  bothDiffs: number;
  /** A few matches whose Sleeper position or team differs (for review). */
  disagreements: Array<{ name: string; pos: string; team: string | null; sleeperPositions: string[]; sleeperTeam: string | null }>;
  /** Players with more than one distinct candidate id (disagreeing methods or a duplicated vendor id). */
  conflicts: number;
  /** Conflicts where the kept id is plausible and every other candidate isn't (placeholder, wrong position or team). */
  conflictsKeptRight: number;
  conflictDetails: ConflictDetail[];
  /** Players whose vendor id maps to several rows in one source, and how many of those stayed a tie. */
  duplicateKeys: number;
  ambiguous: number;
  misses: Array<{ name: string; pos: string; team: string | null; ids: string }>;
  /** Sleeper ids of matched players, in input order. */
  sleeperIds: string[];
}

export function crosswalkMany(players: FantraxPlayer[], sleeper: SleeperIndex, dp?: DpIndex): CrosswalkSummary {
  const s: CrosswalkSummary = {
    n: players.length,
    matched: 0,
    rate: 0,
    byVia: {},
    sleeperDirect: 0,
    inDp: 0,
    dpWithSleeper: 0,
    checked: 0,
    positionAgrees: 0,
    teamAgrees: 0,
    positionOnlyDiffs: 0,
    teamOnlyDiffs: 0,
    bothDiffs: 0,
    disagreements: [],
    conflicts: 0,
    conflictsKeptRight: 0,
    conflictDetails: [],
    duplicateKeys: 0,
    ambiguous: 0,
    misses: [],
    sleeperIds: [],
  };
  const noSleeper = emptySleeperIndex();
  for (const p of players) {
    const r = crosswalkPlayer(p, sleeper, dp);
    if (r.inDp) s.inDp++;
    if (crosswalkPlayer(p, noSleeper, dp).sleeperId) s.dpWithSleeper++;
    if (r.duplicateKey) s.duplicateKeys++;
    if (r.ambiguous) s.ambiguous++;
    if (!r.sleeperId || !r.via) {
      const which = [p.sportRadarId && "sportRadarId", p.rotowireId !== undefined && "rotowireId", p.statsIncId !== undefined && "statsIncId"].filter(Boolean).join("+") || "no vendor ids";
      s.misses.push({ name: p.name, pos: p.position, team: nflTeamOf(p), ids: which });
      continue;
    }
    s.matched++;
    s.byVia[r.via] = (s.byVia[r.via] ?? 0) + 1;
    if (r.via.startsWith("sleeper.")) s.sleeperDirect++;
    s.sleeperIds.push(r.sleeperId);
    const a = agreesWith(p, sleeper.info, r.sleeperId);
    if (a.known) {
      s.checked++;
      if (a.pos) s.positionAgrees++;
      if (a.team) s.teamAgrees++;
      if (!a.pos && a.team) s.positionOnlyDiffs++;
      else if (a.pos && !a.team) s.teamOnlyDiffs++;
      else if (!a.pos && !a.team) s.bothDiffs++;
      const i = sleeper.info.get(r.sleeperId);
      if ((!a.pos || !a.team) && i && s.disagreements.length < 10) s.disagreements.push({ name: p.name, pos: p.position, team: nflTeamOf(p), sleeperPositions: i.positions, sleeperTeam: i.team ?? null });
    }
    if (r.conflict) {
      s.conflicts++;
      const keptId = r.sleeperId;
      const others = r.candidates
        .filter((c) => c.sleeperId !== keptId)
        .map((c) => ({ via: c.via, agrees: plausibleMatch(p, sleeper.info, c.sleeperId), placeholder: sleeper.info.get(c.sleeperId)?.placeholder ?? false }));
      const kept = { via: r.via, agrees: plausibleMatch(p, sleeper.info, keptId) };
      if (kept.agrees && others.every((o) => !o.agrees)) s.conflictsKeptRight++;
      s.conflictDetails.push({ name: p.name, pos: p.position, team: nflTeamOf(p), kept, others });
    }
  }
  s.rate = s.n ? s.matched / s.n : 0;
  return s;
}

/** Top-ADP QB/RB/WR/TE (real PPR ADP), resolved to getPlayerIds records. */
export function topSkillFromAdp(adp: FantraxAdp[], ids: Record<string, FantraxPlayer>): FantraxPlayer[] {
  return adp
    .filter((e) => !e.tmId && e.pos && SKILL.has(e.pos) && e.ADP_PPR !== undefined && e.ADP_PPR < NO_ADP)
    .sort((a, b) => (a.ADP_PPR ?? NO_ADP) - (b.ADP_PPR ?? NO_ADP))
    .map((e) => ids[e.id])
    .filter((p): p is FantraxPlayer => Boolean(p));
}

/** Real players (not team units) at the given positions with an NFL team: a stand-in for "could be rostered" when there's no league. */
export function onTeamPlayers(ids: Record<string, FantraxPlayer>, positions: ReadonlySet<string>): FantraxPlayer[] {
  return Object.entries(ids)
    .filter(([key, p]) => recordKind(key, p) === "player" && positions.has(p.position) && nflTeamOf(p) !== null)
    .map(([, p]) => p);
}

/** Every real player record (team units excluded). */
export function realPlayers(ids: Record<string, FantraxPlayer>): FantraxPlayer[] {
  return Object.entries(ids)
    .filter(([key, p]) => recordKind(key, p) === "player")
    .map(([, p]) => p);
}

export function pct(n: number, d: number): string {
  return d ? `${((100 * n) / d).toFixed(1)}%` : "n/a";
}
