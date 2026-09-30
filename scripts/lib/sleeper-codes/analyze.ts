/**
 * Pure helpers for the Sleeper settings-code crawl (CLAUDE.md §2.3: check the meaning of every
 * numeric settings code against real leagues instead of assuming it).
 *
 * No I/O and no clock: the probe passes in trimmed API objects and gets back aggregate numbers
 * only (never names or IDs), so everything here is unit-tested offline.
 */

export type Tally = Record<string, number>;

const ABSENT = "absent";

function keyOf(v: unknown): string {
  return v === undefined || v === null ? ABSENT : String(v);
}

/** Numeric keys in numeric order, then other keys ("absent", labels) alphabetically. */
export function compareKeys(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  const aNum = a !== ABSENT && a.trim() !== "" && Number.isFinite(na);
  const bNum = b !== ABSENT && b.trim() !== "" && Number.isFinite(nb);
  if (aNum && bNum) return na - nb;
  if (aNum !== bNum) return aNum ? -1 : 1;
  return a.localeCompare(b);
}

/** Count values; undefined/null count as "absent". Keys come out in numeric order where possible. */
export function tally(values: Iterable<unknown>): Tally {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(keyOf(v), (counts.get(keyOf(v)) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => compareKeys(a, b)));
}

/** rows grouped by `row(r)`, each group tallied by `col(r)`. */
export function crossTab<T>(rows: readonly T[], row: (r: T) => unknown, col: (r: T) => unknown): Record<string, Tally> {
  const groups = new Map<string, unknown[]>();
  for (const r of rows) {
    const k = keyOf(row(r));
    const list = groups.get(k) ?? [];
    list.push(col(r));
    groups.set(k, list);
  }
  return Object.fromEntries([...groups].sort(([a], [b]) => compareKeys(a, b)).map(([k, vs]) => [k, tally(vs)]));
}

export function median(xs: readonly number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** "12/40 (30%)" */
export function frac(n: number, d: number): string {
  return d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : "0/0";
}

export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

// ---------------------------------------------------------------------------------------------
// Playoff brackets (GET /league/{id}/winners_bracket and /losers_bracket)

export interface BracketFrom {
  w?: number | null;
  l?: number | null;
}

export interface BracketMatch {
  r: number;
  m: number;
  /** Roster ID, or (before it's decided, per the docs) a {w|l: matchId} reference. */
  t1?: number | BracketFrom | null;
  t2?: number | BracketFrom | null;
  w?: number | null;
  l?: number | null;
  t1_from?: BracketFrom | null;
  t2_from?: BracketFrom | null;
  /** Placement game: 1 = final, 3 = third place, 5 = fifth place, … */
  p?: number | null;
}

export function teamOf(t: BracketMatch["t1"]): number | undefined {
  return typeof t === "number" ? t : undefined;
}

/** Matches on the main path: every match without a placement, plus the final (p = 1). */
export function isMainPath(m: BracketMatch): boolean {
  return m.p === undefined || m.p === null || m.p === 1;
}

export interface BracketSummary {
  matches: number;
  rounds: number;
  /** Distinct roster IDs anywhere in the bracket. */
  teams: number[];
  /** Teams whose first match is after round 1. */
  byes: number[];
  /** Round-1 pairings on the main path ("a-b", sorted). */
  round1Pairs: string[];
  /** Distinct placement values (p). */
  placements: number[];
  /** Every match has a winner and a loser. */
  complete: boolean;
  /** How later matches are fed: counts of t1_from/t2_from links naming a winner (w) or loser (l). */
  fromLinks: { w: number; l: number };
}

export function summarizeBracket(bracket: readonly BracketMatch[]): BracketSummary {
  const firstRound = new Map<number, number>();
  const fromLinks = { w: 0, l: 0 };
  for (const m of bracket) {
    for (const t of [teamOf(m.t1), teamOf(m.t2)]) {
      if (t === undefined) continue;
      firstRound.set(t, Math.min(firstRound.get(t) ?? Infinity, m.r));
    }
    for (const f of [m.t1_from, m.t2_from]) {
      if (!f) continue;
      if (typeof f.w === "number") fromLinks.w++;
      if (typeof f.l === "number") fromLinks.l++;
    }
  }
  const minRound = bracket.length ? Math.min(...bracket.map((m) => m.r)) : 1;
  return {
    matches: bracket.length,
    rounds: bracket.length ? Math.max(...bracket.map((m) => m.r)) : 0,
    teams: [...firstRound.keys()].sort((a, b) => a - b),
    byes: [...firstRound].filter(([, r]) => r > minRound).map(([t]) => t).sort((a, b) => a - b),
    round1Pairs: bracket
      .filter((m) => m.r === minRound && isMainPath(m))
      .flatMap((m) => {
        const a = teamOf(m.t1);
        const b = teamOf(m.t2);
        return a !== undefined && b !== undefined ? [pairKey(a, b)] : [];
      })
      .sort(),
    placements: [...new Set(bracket.map((m) => m.p).filter((p): p is number => typeof p === "number"))].sort((a, b) => a - b),
    complete: bracket.length > 0 && bracket.every((m) => typeof m.w === "number" && typeof m.l === "number"),
    fromLinks,
  };
}

// ---------------------------------------------------------------------------------------------
// Matchups (GET /league/{id}/matchups/{week})

export interface MatchupLite {
  roster_id: number;
  matchup_id?: number | null;
  points?: number | null;
  custom_points?: number | null;
}

/** week → roster → { matchup id, points }. */
export type WeekScores = Map<number, Map<number, { matchupId: number | null; points: number }>>;

export function toWeekScores(byWeek: ReadonlyMap<number, readonly MatchupLite[]>): WeekScores {
  const out: WeekScores = new Map();
  for (const [week, list] of byWeek) {
    const m = new Map<number, { matchupId: number | null; points: number }>();
    for (const x of list) {
      const points = typeof x.custom_points === "number" ? x.custom_points : (x.points ?? 0);
      m.set(x.roster_id, { matchupId: typeof x.matchup_id === "number" ? x.matchup_id : null, points });
    }
    out.set(week, m);
  }
  return out;
}

/** Pairings played in one week: rosters sharing a non-null matchup_id. */
export function weekPairs(scores: ReadonlyMap<number, { matchupId: number | null }>): Set<string> {
  const byMatch = new Map<number, number[]>();
  for (const [roster, s] of scores) {
    if (s.matchupId === null) continue;
    const list = byMatch.get(s.matchupId) ?? [];
    list.push(roster);
    byMatch.set(s.matchupId, list);
  }
  const out = new Set<string>();
  for (const ids of byMatch.values()) if (ids.length === 2 && ids[0] !== undefined && ids[1] !== undefined) out.add(pairKey(ids[0], ids[1]));
  return out;
}

/** Weeks in which rosters a and b faced each other. */
export function weeksPlayed(scores: WeekScores, a: number, b: number): number[] {
  const out: number[] = [];
  for (const [week, m] of scores) {
    const sa = m.get(a);
    const sb = m.get(b);
    if (sa && sb && sa.matchupId !== null && sa.matchupId === sb.matchupId) out.push(week);
  }
  return out.sort((x, y) => x - y);
}

export interface RoundWeeks {
  round: number;
  /** Weeks in which every main-path pairing of the round was a matchup. */
  weeks: number[];
}

export function roundWeeks(bracket: readonly BracketMatch[], scores: WeekScores): RoundWeeks[] {
  const rounds = [...new Set(bracket.map((m) => m.r))].sort((a, b) => a - b);
  return rounds.map((round) => {
    const pairs = bracket
      .filter((m) => m.r === round && isMainPath(m))
      .flatMap((m) => {
        const a = teamOf(m.t1);
        const b = teamOf(m.t2);
        return a !== undefined && b !== undefined ? [[a, b] as const] : [];
      });
    if (!pairs.length) return { round, weeks: [] };
    const sets = pairs.map(([a, b]) => new Set(weeksPlayed(scores, a, b)));
    const weeks = [...(sets[0] ?? [])].filter((w) => sets.every((s) => s.has(w))).sort((x, y) => x - y);
    return { round, weeks };
  });
}

export type RoundPattern = "1-week rounds" | "2-week final" | "2-week rounds" | "single round" | "unclear";

/** Classify how many weeks each playoff round lasted. */
export function classifyRoundPattern(rw: readonly RoundWeeks[]): RoundPattern {
  if (!rw.length || rw.some((x) => x.weeks.length === 0)) return "unclear";
  const consecutive = rw.every((x) => x.weeks.every((w, i) => i === 0 || w === (x.weeks[i - 1] ?? 0) + 1));
  const ordered = rw.every((x, i) => i === 0 || (x.weeks[0] ?? 0) > (rw[i - 1]?.weeks.at(-1) ?? 0));
  if (!consecutive || !ordered) return "unclear";
  const n = rw.map((x) => x.weeks.length);
  if (n.length === 1) return "single round";
  const last = n[n.length - 1];
  const early = n.slice(0, -1);
  if (n.every((x) => x === 1)) return "1-week rounds";
  if (last === 2 && early.every((x) => x === 1)) return "2-week final";
  if (n.every((x) => x === 2)) return "2-week rounds";
  return "unclear";
}

export interface Advancement {
  /** Matches whose recorded winner (w) scored more points over the weeks the pair met. */
  higherScorer: number;
  /** Matches whose recorded winner scored fewer points (e.g. a "toilet bowl": losers advance). */
  lowerScorer: number;
  unknown: number;
}

/** Does the bracket's `w` mean "scored more" or "scored less"? Compared with the matchup points. */
export function advancement(bracket: readonly BracketMatch[], scores: WeekScores): Advancement {
  const out: Advancement = { higherScorer: 0, lowerScorer: 0, unknown: 0 };
  for (const m of bracket) {
    const a = teamOf(m.t1);
    const b = teamOf(m.t2);
    if (a === undefined || b === undefined || typeof m.w !== "number") {
      out.unknown++;
      continue;
    }
    const weeks = weeksPlayed(scores, a, b);
    if (!weeks.length) {
      out.unknown++;
      continue;
    }
    const sum = (t: number) => weeks.reduce((s, w) => s + (scores.get(w)?.get(t)?.points ?? 0), 0);
    const [pa, pb] = [sum(a), sum(b)];
    if (Math.abs(pa - pb) < 1e-9) out.unknown++;
    else if ((pa > pb ? a : b) === m.w) out.higherScorer++;
    else out.lowerScorer++;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rosters / standings (GET /league/{id}/rosters)

export interface RosterLite {
  roster_id: number;
  settings?: {
    wins?: number;
    losses?: number;
    ties?: number;
    fpts?: number;
    fpts_decimal?: number;
    ppts?: number;
    ppts_decimal?: number;
    division?: number;
    waiver_position?: number;
    waiver_budget_used?: number;
  } | null;
  reserve?: string[] | null;
  taxi?: string[] | null;
  players?: string[] | null;
  metadata?: { record?: string } | null;
}

export interface Standing {
  rosterId: number;
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  /** Potential points (best possible lineup), when Sleeper reports it. */
  ppts?: number;
  division?: number;
  waiverPosition?: number;
  /** FAAB spent so far. */
  waiverBudgetUsed?: number;
  reserve: number;
  taxi: number;
  players: number;
  /** Length of metadata.record (one letter per decided game), when present. */
  recordLength?: number;
}

function withDecimal(whole: number | undefined, decimal: number | undefined): number | undefined {
  if (typeof whole !== "number") return undefined;
  return whole + (typeof decimal === "number" ? decimal / 100 : 0);
}

export function standingsFromRosters(rosters: readonly RosterLite[]): Standing[] {
  return rosters.map((r) => {
    const s = r.settings ?? {};
    return {
      rosterId: r.roster_id,
      wins: s.wins ?? 0,
      losses: s.losses ?? 0,
      ties: s.ties ?? 0,
      fpts: withDecimal(s.fpts, s.fpts_decimal) ?? 0,
      ppts: withDecimal(s.ppts, s.ppts_decimal),
      division: typeof s.division === "number" ? s.division : undefined,
      waiverPosition: typeof s.waiver_position === "number" ? s.waiver_position : undefined,
      waiverBudgetUsed: typeof s.waiver_budget_used === "number" ? s.waiver_budget_used : undefined,
      reserve: r.reserve?.length ?? 0,
      taxi: r.taxi?.length ?? 0,
      players: r.players?.length ?? 0,
      recordLength: typeof r.metadata?.record === "string" ? r.metadata.record.length : undefined,
    };
  });
}

/** One roster's player IDs (public NFL player IDs): players[] plus the reserve (IR) and taxi lists. */
export interface RosterGroups {
  players: string[];
  reserve: string[];
  taxi: string[];
}

export function rosterGroupsOf(rosters: readonly RosterLite[]): RosterGroups[] {
  const ids = (xs: readonly unknown[] | null | undefined) => (xs ?? []).filter((p): p is string => typeof p === "string");
  return rosters.map((r) => ({ players: ids(r.players), reserve: ids(r.reserve), taxi: ids(r.taxi) }));
}

export interface LimitCheck {
  /** Position from the key (position_limit_qb → QB). */
  pos: string;
  limit: number;
  /** Most players at the position on one roster, counting players[] ∪ reserve ∪ taxi. */
  maxAll: number;
  /** Most on one active roster (players[] minus reserve and taxi). */
  maxActive: number;
  /** Some active roster holds exactly `limit`. */
  atLimitActive: boolean;
  /** Some active roster holds more than `limit` (contradicts "a cap on the active roster"). */
  exceededActive: boolean;
  /** Rosters over the limit only when their reserve / taxi players are counted. */
  overOnlyViaReserve: number;
  overOnlyViaTaxi: number;
}

/**
 * Compare Sleeper's settings.position_limit_{pos} with rosters, counting the active roster
 * (players[] minus reserve and taxi) and everything (players[] ∪ reserve ∪ taxi) separately.
 */
export function positionLimitChecks(settings: Record<string, number>, rosters: readonly RosterGroups[], positionOf: (playerId: string) => string | undefined): LimitCheck[] {
  const out: LimitCheck[] = [];
  for (const [key, limit] of Object.entries(settings)) {
    if (!key.startsWith("position_limit_")) continue;
    const pos = key.slice("position_limit_".length).toUpperCase();
    const at = (ids: Iterable<string>) => [...ids].filter((id) => positionOf(id) === pos).length;
    const c: LimitCheck = { pos, limit, maxAll: 0, maxActive: 0, atLimitActive: false, exceededActive: false, overOnlyViaReserve: 0, overOnlyViaTaxi: 0 };
    for (const r of rosters) {
      const reserve = new Set(r.reserve);
      const taxi = new Set(r.taxi);
      const all = at(new Set([...r.players, ...r.reserve, ...r.taxi]));
      const active = at(r.players.filter((id) => !reserve.has(id) && !taxi.has(id)));
      c.maxAll = Math.max(c.maxAll, all);
      c.maxActive = Math.max(c.maxActive, active);
      if (active === limit) c.atLimitActive = true;
      if (active > limit) c.exceededActive = true;
      else if (all > limit) {
        if (at(reserve) > 0) c.overOnlyViaReserve++;
        if (at(taxi) > 0) c.overOnlyViaTaxi++;
      }
    }
    out.push(c);
  }
  return out;
}

/** Share of reserve/taxi player IDs that also appear in players[] (Sleeper lists them in both). */
export function groupsInPlayers(rosters: readonly RosterGroups[]): { reserve: number; reserveInPlayers: number; taxi: number; taxiInPlayers: number } {
  const out = { reserve: 0, reserveInPlayers: 0, taxi: 0, taxiInPlayers: 0 };
  for (const r of rosters) {
    const players = new Set(r.players);
    out.reserve += r.reserve.length;
    out.reserveInPlayers += r.reserve.filter((id) => players.has(id)).length;
    out.taxi += r.taxi.length;
    out.taxiInPlayers += r.taxi.filter((id) => players.has(id)).length;
  }
  return out;
}

export function winPct(s: Standing): number {
  const g = s.wins + s.losses + s.ties;
  return g ? (s.wins + s.ties / 2) / g : 0;
}

/** Seed order by record (win %), then points for. */
export function recordOrder(st: readonly Standing[]): number[] {
  return [...st].sort((a, b) => winPct(b) - winPct(a) || b.fpts - a.fpts || a.rosterId - b.rosterId).map((s) => s.rosterId);
}

/** Seed order by points for only. */
export function pointsOrder(st: readonly Standing[]): number[] {
  return [...st].sort((a, b) => b.fpts - a.fpts || a.rosterId - b.rosterId).map((s) => s.rosterId);
}

/** Division winners first (by record), then everyone else by record. undefined without divisions. */
export function divisionWinnersFirst(st: readonly Standing[]): number[] | undefined {
  const divisions = new Set(st.map((s) => s.division).filter((d): d is number => typeof d === "number" && d > 0));
  if (divisions.size < 2) return undefined;
  const order = recordOrder(st);
  const divOf = new Map(st.map((s) => [s.rosterId, s.division]));
  const winners: number[] = [];
  for (const id of order) {
    const d = divOf.get(id);
    if (d !== undefined && divisions.has(d) && !winners.some((w) => divOf.get(w) === d)) winners.push(id);
  }
  return [...winners, ...order.filter((id) => !winners.includes(id))];
}

export interface PredictedBracket {
  teams: number[];
  byes: number[];
  round1Pairs: string[];
}

/** Standard single-elimination seeding: top seeds get byes; then best vs worst of the rest. */
export function predictBracket(seeds: readonly number[], nPlayoff: number): PredictedBracket | undefined {
  if (nPlayoff < 2 || seeds.length < nPlayoff) return undefined;
  const size = 2 ** Math.ceil(Math.log2(nPlayoff));
  const byeCount = size - nPlayoff;
  const teams = seeds.slice(0, nPlayoff);
  const playing = teams.slice(byeCount);
  const round1Pairs: string[] = [];
  for (let i = 0; i < playing.length / 2; i++) {
    const a = playing[i];
    const b = playing[playing.length - 1 - i];
    if (a !== undefined && b !== undefined) round1Pairs.push(pairKey(a, b));
  }
  return { teams, byes: teams.slice(0, byeCount), round1Pairs: round1Pairs.sort() };
}

/** Does this seed order explain the bracket's teams, byes and round-1 pairings? */
export function seedingFits(summary: BracketSummary, seeds: readonly number[], nPlayoff: number): boolean {
  const p = predictBracket(seeds, nPlayoff);
  if (!p) return false;
  return sameSet(p.teams, summary.teams) && sameSet(p.byes, summary.byes) && sameSet(p.round1Pairs, summary.round1Pairs);
}

export interface TopSeedRound2 {
  /** Seed of the top seed's round-2 opponent. */
  opponentSeed: number;
  /** The lowest-ranked seed still alive after round 1 (who a re-seeded bracket would pair with seed 1). */
  lowestRemainingSeed: number;
  /**
   * Who a fixed bracket pairs with seed 1: the winner of the round-1 game between seeds size/2 and
   * size/2 + 1 (4v5 in a 6- or 7-team bracket). Undefined when that game isn't in the bracket.
   */
  fixedOpponentSeed?: number;
  /** Which round-1 game the opponent came from, as seeds ("4v5"), or "bye". */
  fromGame: string;
}

/** Round 2 for the top seed (needs a bye for seed 1): fixed bracket vs re-seeding evidence. */
export function topSeedRound2(bracket: readonly BracketMatch[], seeds: readonly number[], nPlayoff: number): TopSeedRound2 | undefined {
  const p = predictBracket(seeds, nPlayoff);
  const top = seeds[0];
  if (!p || top === undefined || !p.byes.includes(top)) return undefined;
  const seedOf = (id: number) => seeds.indexOf(id) + 1;
  const minRound = Math.min(...bracket.map((m) => m.r));
  const r1 = bracket.filter((m) => m.r === minRound && isMainPath(m));
  const winners = r1.map((m) => m.w).filter((w): w is number => typeof w === "number");
  if (!r1.length || winners.length !== r1.length) return undefined;
  const r2 = bracket.find((m) => m.r === minRound + 1 && isMainPath(m) && (teamOf(m.t1) === top || teamOf(m.t2) === top));
  if (!r2) return undefined;
  const opp = teamOf(r2.t1) === top ? teamOf(r2.t2) : teamOf(r2.t1);
  if (opp === undefined) return undefined;
  const remaining = [...p.byes, ...winners].map(seedOf);
  const gameSeeds = (m: BracketMatch) => [teamOf(m.t1), teamOf(m.t2)].filter((t): t is number => t !== undefined).map(seedOf).sort((a, b) => a - b);
  const from = r1.find((m) => m.w === opp);
  const fromSeeds = from ? gameSeeds(from) : [];
  const half = 2 ** Math.ceil(Math.log2(nPlayoff)) / 2;
  const feed = r1.find((m) => {
    const s = gameSeeds(m);
    return s.length === 2 && s[0] === half && s[1] === half + 1;
  });
  return {
    opponentSeed: seedOf(opp),
    lowestRemainingSeed: Math.max(...remaining),
    fixedOpponentSeed: feed && typeof feed.w === "number" ? seedOf(feed.w) : undefined,
    fromGame: fromSeeds.length === 2 ? `${fromSeeds[0]}v${fromSeeds[1]}` : "bye",
  };
}

/**
 * Which seeding rule a top seed's round-2 game supports: "same" when a fixed bracket and a
 * re-seeded one predict the same opponent (uninformative), else "fixed", "reseed" or "neither".
 */
export function seedRuleEvidence(t: TopSeedRound2): "fixed" | "reseed" | "same" | "neither" | "unknown" {
  if (t.fixedOpponentSeed === undefined) return "unknown";
  if (t.fixedOpponentSeed === t.lowestRemainingSeed) return "same";
  if (t.opponentSeed === t.fixedOpponentSeed) return "fixed";
  if (t.opponentSeed === t.lowestRemainingSeed) return "reseed";
  return "neither";
}

/** Byes a standard single-elimination bracket gives: next power of two minus the number of teams. */
export function standardByes(nPlayoff: number): number {
  return nPlayoff < 2 ? 0 : 2 ** Math.ceil(Math.log2(nPlayoff)) - nPlayoff;
}

// ---------------------------------------------------------------------------------------------
// Other roster checks

export interface GamesCheck {
  teams: number;
  /** Teams whose W+L+T equals the number of regular-season weeks. */
  once: number;
  /** Teams whose W+L+T equals twice that (a second game per week, e.g. vs the league median). */
  twice: number;
  other: number;
}

export function gamesCheck(st: readonly Standing[], regularWeeks: number): GamesCheck {
  const out: GamesCheck = { teams: st.length, once: 0, twice: 0, other: 0 };
  for (const s of st) {
    const g = s.wins + s.losses + s.ties;
    if (g === regularWeeks) out.once++;
    else if (g === 2 * regularWeeks) out.twice++;
    else out.other++;
  }
  return out;
}

/** Teams whose actual points equal their potential (optimal-lineup) points, within a cent. */
export function optimalLineupShare(st: readonly Standing[]): { teams: number; withPotential: number; optimal: number } {
  const withP = st.filter((s) => typeof s.ppts === "number" && s.ppts > 0);
  return { teams: st.length, withPotential: withP.length, optimal: withP.filter((s) => Math.abs((s.ppts ?? 0) - s.fpts) < 0.011).length };
}

function ranks(xs: readonly number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]?.[0] === idx[i]?.[0]) j++;
    for (let k = i; k <= j; k++) out[idx[k]?.[1] ?? 0] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation; undefined when either side is constant or too short. */
export function spearman(xs: readonly number[], ys: readonly number[]): number | undefined {
  if (xs.length !== ys.length || xs.length < 3) return undefined;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    const a = (rx[i] ?? 0) - mx;
    const b = (ry[i] ?? 0) - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : undefined;
}

/** Correlation between standings rank (1 = best record) and waiver position (1 = first claim). */
export function waiverVsStandings(st: readonly Standing[]): number | undefined {
  const withPos = st.filter((s) => typeof s.waiverPosition === "number");
  if (withPos.length < 4) return undefined;
  const order = recordOrder(withPos);
  return spearman(
    withPos.map((s) => order.indexOf(s.rosterId) + 1),
    withPos.map((s) => s.waiverPosition ?? 0),
  );
}

// ---------------------------------------------------------------------------------------------
// League names: keyword flags only (names themselves are never stored or printed)

export const NAME_KEYWORDS = {
  dynasty: /dynasty/i,
  keeper: /keeper/i,
  redraft: /re-?draft/i,
  bestBall: /best\s*-?ball/i,
  guillotine: /guillotine|chopped|\bchop\b/i,
  devy: /\bdevy\b/i,
} as const;
export type NameKeyword = keyof typeof NAME_KEYWORDS;

export function nameKeywords(name: unknown): NameKeyword[] {
  if (typeof name !== "string") return [];
  return (Object.keys(NAME_KEYWORDS) as NameKeyword[]).filter((k) => NAME_KEYWORDS[k].test(name));
}

/** Only short, code-like strings (e.g. draft metadata.scoring_type "dynasty_ppr") may be reported. */
export function codeLike(v: unknown): string | undefined {
  return typeof v === "string" && /^[a-z0-9_]{1,24}$/.test(v) ? v : undefined;
}
