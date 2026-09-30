/**
 * Exact lineup solver (CLAUDE.md §7 "Weekly lineup value"): LV(T, w) is the highest total of p_{i,w}
 * over all legal assignments of a team's active roster (not IR or taxi: the caller passes team.roster)
 * to the league's starting slots, honoring per-position starter min–max (settings.starterLimits,
 * MFL). Pure and deterministic: no I/O, no clock, no randomness.
 *
 * Why a greedy is exact here
 * - A player scores the same in any slot he fills, so the weights sit on the players, not on
 *   (player, slot) pairs. The sets of players who can start together (who can be matched to distinct
 *   slot instances they're eligible for) are the independent sets of a transversal matroid. On a
 *   matroid, taking players best first and keeping each one whenever the kept set stays independent
 *   gives a maximum-weight independent set (Rado–Edmonds). "Stays independent" is one augmenting-path
 *   search: he takes a free slot he fits, or a chain of starters shifts over (an RB/WR moves from RB to
 *   WR so a pure RB can start). Players with 0 or fewer points are never kept: an empty slot scores 0.
 * - Starter maximums by primary position: when every player at a limited position fits the same slots
 *   (MFL: one position per player), the family "matchable and within the maximums" is a gammoid
 *   (player → a position node with capacity max → slot instances), still a matroid, so the same greedy
 *   plus a count check stays exact.
 * - Starter minimums: players of one position are then interchangeable, so some optimal lineup holds
 *   the top-min players (points desc, id asc) of each position. They are seated first ("forced", even
 *   at 0 or fewer points: MFL makes you start a TE even when yours is on bye), then the greedy goes on.
 *   That is the matroid greedy for weights BIG + points on the forced players, so it maximizes the
 *   minimum seats filled first and points second: exact whenever the minimums can be met, and a
 *   well-defined best effort when they can't (a roster without a TE, or minimums the slots can't hold).
 * - Mixed eligibility at a limited position (say an RB/WR and a pure RB under an RB maximum; no
 *   platform produces this today) breaks the matroid: the greedy can lose there (RB max 1, slots WR and
 *   TE: an RB/WR 10, an RB/TE 9 and a WR 8 → the greedy keeps 10, the best lineup is 9 + 8). Such a
 *   roster is solved by an exact min-cost flow instead: source → position node (its first `min` units
 *   cost −BIG each, the rest up to `max` cost 0) → player (−points) → slot group → sink, by successive
 *   shortest paths. Same objective, tens of times slower, so prepareRoster() picks it only when needed
 *   (PreparedRoster.usesFlow).
 * - Speed: a player who fits a slot with room is seated in O(1) (bitmasks of the slot groups that are
 *   full). A failed search leaves a set of full groups whose starters fit nowhere else; no later search
 *   can get through them, so they are skipped for the rest of the solve ("dead" groups).
 *
 * One solver: §7 allows a fast greedy for screening when slot eligibility is nested. This exact solver
 * is fast enough for both (over a million lineups a second for a 16-player roster and 9 slots in Node;
 * Checkpoint 2 reports the timings), so there is no second, approximate one.
 *
 * Two ways in
 * - solveLineup(players, prepareSlots(settings.lineup, settings.starterLimits)): the total and the
 *   starters with their slots.
 * - Hot loops: prepareRoster() once per roster, then lineupTotal() per week or scenario. It is
 *   index-based and allocation-free, takes an optional availability row (0 = he scores 0 that week) and
 *   an optional presorted order: a scenario loop calls lineupOrder(roster, conditionalPoints) once per
 *   week and passes each scenario's availability row. Memoization is the caller's job.
 *
 * Ties: points desc, then id asc, so the lineup doesn't depend on the order players are passed in (the
 * min-cost flow fallback may settle an exact tie by roster order; its total is the same). The seat
 * output is canonical: of two starters who could swap slots,
 * the better one sits in the more restrictive slot (RB slots hold the top RBs, FLEX the best leftover),
 * so slot-by-slot strength (§7 "Needs and surplus") reads the way platforms show lineups.
 */
import { POSITIONS, type LeagueSettings, type Pos, type SlotDef } from "./model";

/** Slot groups are the bits of a 32-bit mask (bit 31 stays unused, so masks are never negative). */
export const MAX_SLOT_GROUPS = 31;

const NPOS = POSITIONS.length;
/** Position index of a player whose position isn't a model position: never limited, fits nothing by position. */
const NO_POS = NPOS;
const POS_INDEX: ReadonlyMap<string, number> = new Map(POSITIONS.map((p, i) => [p, i]));
/** Relaxation and stopping tolerance of the min-cost flow, in points. */
const FLOW_EPS = 1e-9;

export type StarterLimits = NonNullable<LeagueSettings["starterLimits"]>;

// ---------------------------------------------------------------------------------------------
// Slots

export interface SlotGroup {
  /** SlotDef.slot. SlotDefs with the same name and the same eligible positions are merged. */
  readonly slot: string;
  readonly count: number;
  readonly eligible: readonly Pos[];
  /** Index of its (first) SlotDef in the league's lineup: the display order. */
  readonly lineupIndex: number;
}

export interface StarterLimitTable {
  /** Indexed like POSITIONS (plus one entry for unknown positions); 0 ≤ min ≤ max ≤ starters. Unlimited: min 0, max = starters. */
  readonly min: Int32Array;
  readonly max: Int32Array;
  /** Bit p set = POSITIONS[p] has a limit that can bind (min > 0 or max < starters). */
  readonly limited: number;
}

export interface PreparedSlots {
  /** Slot groups, most restrictive first (fewest eligible positions, then lineup order). Bit g of a mask = groups[g]. */
  readonly groups: readonly SlotGroup[];
  /** groups[g].count. */
  readonly capacity: Int32Array;
  /** Total starting spots. */
  readonly starters: number;
  /** Bitmask of the groups each position can fill, indexed like POSITIONS (plus 0 for unknown positions). */
  readonly posMask: Int32Array;
  /** Starter limits by primary position, or null when the league has none that can bind. */
  readonly limits: StarterLimitTable | null;
}

const POS_SET: ReadonlySet<string> = new Set(POSITIONS);

/**
 * Prepares a league's starting slots once (settings.lineup and settings.starterLimits). Slots with no
 * spots or no known position are dropped; a starter limit is read as "at least ceil(min), at most
 * floor(max)" with min clamped into [0, max] (a missing max = no maximum).
 */
export function prepareSlots(lineup: readonly SlotDef[], starterLimits?: StarterLimits | null): PreparedSlots {
  const merged: { slot: string; count: number; eligible: Pos[]; lineupIndex: number }[] = [];
  const byKey = new Map<string, (typeof merged)[number]>();
  lineup.forEach((def, lineupIndex) => {
    const count = Number.isFinite(def.count) ? Math.max(0, Math.floor(def.count)) : 0;
    const eligible = [...new Set(def.eligible.filter((p) => POS_SET.has(p)))];
    if (count === 0 || eligible.length === 0) return;
    const key = `${def.slot}\u0000${[...eligible].sort().join(",")}`;
    const hit = byKey.get(key);
    if (hit) {
      hit.count += count;
      return;
    }
    const group = { slot: def.slot, count, eligible, lineupIndex };
    byKey.set(key, group);
    merged.push(group);
  });
  if (merged.length > MAX_SLOT_GROUPS) throw new Error(`A lineup with more than ${MAX_SLOT_GROUPS} kinds of starting slots isn't supported (got ${merged.length}).`);
  const groups = merged.sort((a, b) => a.eligible.length - b.eligible.length || a.lineupIndex - b.lineupIndex);

  const capacity = Int32Array.from(groups, (g) => g.count);
  const starters = groups.reduce((sum, g) => sum + g.count, 0);
  const posMask = new Int32Array(NPOS + 1);
  groups.forEach((g, bit) => {
    for (const p of g.eligible) {
      const i = POS_INDEX.get(p) as number;
      posMask[i] = (posMask[i] as number) | (1 << bit);
    }
  });

  let limits: StarterLimitTable | null = null;
  if (starterLimits) {
    const min = new Int32Array(NPOS + 1);
    const max = new Int32Array(NPOS + 1).fill(starters);
    let limited = 0;
    POSITIONS.forEach((p, i) => {
      const l = starterLimits[p];
      if (!l) return;
      const hi = Number.isFinite(l.max) ? Math.min(starters, Math.max(0, Math.floor(l.max))) : starters;
      const lo = Number.isFinite(l.min) ? Math.min(hi, Math.max(0, Math.ceil(l.min))) : 0;
      min[i] = lo;
      max[i] = hi;
      if (lo > 0 || hi < starters) limited |= 1 << i;
    });
    if (limited !== 0) limits = { min, max, limited };
  }
  return { groups, capacity, starters, posMask, limits };
}

/** prepareSlots(settings.lineup, settings.starterLimits). */
export function prepareLeagueSlots(settings: Pick<LeagueSettings, "lineup" | "starterLimits">): PreparedSlots {
  return prepareSlots(settings.lineup, settings.starterLimits);
}

// ---------------------------------------------------------------------------------------------
// Rosters

export interface LineupCandidate {
  id: string;
  /** Primary position: the one starter limits count. */
  pos: Pos;
  /** Positions he may fill (PlayerInfo.eligible); his own position always counts. */
  eligible: readonly Pos[];
}

/** Buffers every solve of one roster reuses (internal). */
export interface LineupScratch {
  eff: Float64Array;
  order: Int32Array;
  cand: Int32Array;
  seat: Int32Array;
  seated: Int32Array;
  tried: Uint8Array;
  fill: Int32Array;
  posCount: Int32Array;
  /** Per position index: the roster indices there (positions with a starter minimum only). */
  byPos: (Int32Array | null)[];
  seatedCount: number;
  full: number;
  visited: number;
  dead: number;
}

export interface PreparedRoster {
  readonly slots: PreparedSlots;
  /** Player ids in the caller's order: points, availability and seat arrays all use these indices. */
  readonly ids: readonly string[];
  readonly size: number;
  /** Bitmask of the slot groups each player can fill (0 = none). */
  readonly masks: Int32Array;
  /** Primary position index (POSITIONS order; POSITIONS.length for a position the model doesn't know). */
  readonly pos: Uint8Array;
  /** Rank of his id in ascending (code-unit) order: the tie-break, equal points → the smaller id starts. */
  readonly idRank: Int32Array;
  /** Starter limits meet mixed slot eligibility at a limited position: solved by min-cost flow (exact, slower). */
  readonly usesFlow: boolean;
  /** Internal buffers reused by every solve: a prepared roster is not re-entrant. */
  readonly scratch: LineupScratch;
}

const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Prepares a roster (the active roster: team.roster, not IR or taxi) for repeated solving against one league's slots. */
export function prepareRoster(players: readonly LineupCandidate[], slots: PreparedSlots): PreparedRoster {
  const n = players.length;
  const ids = players.map((p) => p.id);
  const masks = new Int32Array(n);
  const pos = new Uint8Array(n);
  players.forEach((pl, k) => {
    const pi = POS_INDEX.get(pl.pos) ?? NO_POS;
    let mask = slots.posMask[pi] as number;
    for (const e of pl.eligible) {
      const ei = POS_INDEX.get(e);
      if (ei !== undefined) mask |= slots.posMask[ei] as number;
    }
    pos[k] = pi;
    masks[k] = mask;
  });
  const idRank = new Int32Array(n);
  ids
    .map((_, k) => k)
    .sort((a, b) => byCodeUnits(ids[a] as string, ids[b] as string) || a - b)
    .forEach((k, rank) => {
      idRank[k] = rank;
    });

  const lim = slots.limits;
  const byPos: (Int32Array | null)[] = new Array<Int32Array | null>(NPOS + 1).fill(null);
  let usesFlow = false;
  if (lim) {
    for (let p = 0; p < NPOS; p++) {
      if (((lim.limited >> p) & 1) === 0) continue;
      const at: number[] = [];
      for (let k = 0; k < n; k++) if (pos[k] === p) at.push(k);
      if (at.some((k) => masks[k] !== masks[at[0] as number])) usesFlow = true;
      if ((lim.min[p] as number) > 0) byPos[p] = Int32Array.from(at);
    }
  }
  const G = slots.groups.length;
  const scratch: LineupScratch = {
    eff: new Float64Array(n),
    order: new Int32Array(n),
    cand: new Int32Array(n),
    seat: new Int32Array(n).fill(-1),
    seated: new Int32Array(n),
    tried: new Uint8Array(n),
    fill: new Int32Array(G),
    posCount: new Int32Array(NPOS + 1),
    byPos,
    seatedCount: 0,
    full: 0,
    visited: 0,
    dead: 0,
  };
  return { slots, ids, size: n, masks, pos, idRank, usesFlow, scratch };
}

// ---------------------------------------------------------------------------------------------
// Solving

function checkLength(arr: { length: number }, n: number, name: string): void {
  if (arr.length < n) throw new RangeError(`${name} has ${arr.length} entries for a roster of ${n}`);
}

/**
 * Writes the players with points > 0 who fit some slot into `out`, best first (ties: smaller id
 * first), and returns how many. NaN counts as 0.
 */
function sortByPoints(pts: Float64Array, r: PreparedRoster, out: Int32Array): number {
  const { masks, idRank, size } = r;
  let m = 0;
  for (let k = 0; k < size; k++) {
    const v = pts[k] as number;
    if (!(v > 0) || masks[k] === 0) continue;
    const rk = idRank[k] as number;
    let j = m++;
    while (j > 0) {
      const o = out[j - 1] as number;
      const w = pts[o] as number;
      if (w > v || (w === v && (idRank[o] as number) < rk)) break;
      out[j] = o;
      j--;
    }
    out[j] = k;
  }
  return m;
}

/**
 * The start order for `points`: roster indices of the players with points > 0 who fit some slot, best
 * first (ties: smaller id first). A scenario loop computes it once per week from the players'
 * conditional points and passes it to lineupTotal() with each scenario's availability row: taking
 * unavailable players out keeps the rest in order, so one sort serves every scenario.
 */
export function lineupOrder(r: PreparedRoster, points: Float64Array, out?: Int32Array): Int32Array {
  checkLength(points, r.size, "points");
  const buf = out && out.length >= r.size ? out : new Int32Array(r.size);
  return buf.subarray(0, sortByPoints(points, r, buf));
}

/** Lowest set bit's index (mask ≠ 0). */
function lowBit(mask: number): number {
  return 31 - Math.clz32(mask & -mask);
}

/** Moves starter o out of his group into another group he fits, directly or by shifting others. */
function moveElsewhere(r: PreparedRoster, o: number): boolean {
  const s = r.scratch;
  const m = (r.masks[o] as number) & ~s.visited;
  if (m === 0) return false;
  const free = m & ~s.full;
  const h = free !== 0 ? lowBit(free) : freeUp(r, m);
  if (h < 0) return false;
  const g0 = s.seat[o] as number;
  s.fill[g0] = (s.fill[g0] as number) - 1;
  s.full &= ~(1 << g0);
  s.seat[o] = h;
  addToGroup(r, h);
  return true;
}

/** One more starter in group g (its "full" bit is set when it reaches capacity). */
function addToGroup(r: PreparedRoster, g: number): void {
  const s = r.scratch;
  const f = (s.fill[g] as number) + 1;
  s.fill[g] = f;
  if (f === r.slots.capacity[g]) s.full |= 1 << g;
}

/**
 * Frees a spot in one of the groups in `mask` (all full) by moving one of its starters elsewhere;
 * returns that group, or −1. Groups are visited once per search (Kuhn's augmenting path).
 */
function freeUp(r: PreparedRoster, mask: number): number {
  const s = r.scratch;
  let m = mask & ~s.visited;
  s.visited |= m;
  while (m !== 0) {
    const g = lowBit(m);
    m &= m - 1;
    for (let i = 0; i < s.seatedCount; i++) {
      const o = s.seated[i] as number;
      if (s.seat[o] === g && moveElsewhere(r, o)) return g;
    }
  }
  return -1;
}

/** Seats player x if the starters so far plus x can all start (an augmenting path exists). */
function seatPlayer(r: PreparedRoster, x: number): boolean {
  const s = r.scratch;
  const mask = r.masks[x] as number;
  const free = mask & ~s.full;
  let g: number;
  if (free !== 0) {
    g = lowBit(free);
  } else {
    if ((mask & ~s.dead) === 0) return false;
    s.visited = s.dead;
    g = freeUp(r, mask);
    if (g < 0) {
      s.dead = s.visited; // full groups whose starters fit nowhere else: no later search gets through
      return false;
    }
  }
  s.seat[x] = g;
  addToGroup(r, g);
  s.seated[s.seatedCount++] = x;
  return true;
}

/** Whether a beats b in the start order: more effective points, then the smaller id. */
function ahead(eff: Float64Array, rank: Int32Array, a: number, b: number): boolean {
  const ea = eff[a] as number;
  const eb = eff[b] as number;
  return ea > eb || (ea === eb && (rank[a] as number) < (rank[b] as number));
}

/** The matroid greedy (see the header): forced minimum players first, then everyone with points > 0, best first. */
function solveGreedy(r: PreparedRoster, order: Int32Array | null): void {
  const s = r.scratch;
  const { eff, fill, posCount, tried, cand } = s;
  const pos = r.pos;
  const total = r.slots.starters;
  // Only seated players' scratch seats are ever read (the seated list), so seats need no reset.
  for (let g = 0; g < fill.length; g++) fill[g] = 0;
  s.seatedCount = 0;
  s.full = 0;
  s.dead = 0;
  const lim = r.slots.limits;
  if (lim) {
    posCount.fill(0);
    tried.fill(0);
    // The top-min players of each position with a minimum, by (points desc, id asc), whatever their points.
    let m = 0;
    for (let p = 0; p < NPOS; p++) {
      const at = s.byPos[p];
      if (!at) continue;
      const need = Math.min(lim.min[p] as number, at.length);
      for (let t = 0; t < need; t++) {
        let best = -1;
        for (let i = 0; i < at.length; i++) {
          const k = at[i] as number;
          if (tried[k] === 0 && (best < 0 || ahead(eff, r.idRank, k, best))) best = k;
        }
        tried[best] = 1;
        cand[m++] = best;
      }
    }
    for (let i = 1; i < m; i++) {
      const k = cand[i] as number;
      let j = i;
      while (j > 0 && ahead(eff, r.idRank, k, cand[j - 1] as number)) {
        cand[j] = cand[j - 1] as number;
        j--;
      }
      cand[j] = k;
    }
    for (let i = 0; i < m && s.seatedCount < total; i++) {
      const x = cand[i] as number;
      if (r.masks[x] === 0 || !seatPlayer(r, x)) continue;
      const p = pos[x] as number;
      posCount[p] = (posCount[p] as number) + 1;
    }
  }
  const list = order ?? s.order;
  const len = order ? order.length : sortByPoints(eff, r, s.order);
  for (let i = 0; i < len && s.seatedCount < total; i++) {
    const x = list[i] as number;
    if (!((eff[x] as number) > 0)) continue; // unavailable this week (or not worth a slot)
    if (lim) {
      if (tried[x] === 1) continue;
      const p = pos[x] as number;
      const count = posCount[p] as number;
      if (count >= (lim.max[p] as number)) continue;
      if (seatPlayer(r, x)) posCount[p] = count + 1;
    } else {
      seatPlayer(r, x);
    }
  }
}

/**
 * Exact min-cost flow for starter limits with mixed eligibility at a limited position (see the
 * header): maximizes BIG × (minimum seats filled) + points by successive shortest paths
 * (Bellman–Ford with a queue; the residual graph never has a negative cycle).
 */
function solveByFlow(r: PreparedRoster): void {
  const s = r.scratch;
  const lim = r.slots.limits as StarterLimitTable;
  const { eff } = s;
  const { masks, pos, size: n } = r;
  const G = r.slots.groups.length;
  const SRC = 0;
  const SINK = 1;
  const capBase = 2;
  const playerBase = capBase + NPOS;
  const groupBase = playerBase + n;
  const V = groupBase + G;
  const head = new Int32Array(V).fill(-1);
  const to: number[] = [];
  const rest: number[] = [];
  const cost: number[] = [];
  const next: number[] = [];
  const addEdge = (u: number, v: number, capacity: number, c: number): void => {
    to.push(v, u);
    rest.push(capacity, 0);
    cost.push(c, -c);
    next.push(head[u] as number, head[v] as number);
    head[u] = to.length - 2;
    head[v] = to.length - 1;
  };
  let big = 1;
  for (let k = 0; k < n; k++) big += 2 * Math.abs(eff[k] as number);
  const present = new Uint8Array(NPOS + 1);
  for (let k = 0; k < n; k++) if (masks[k] !== 0) present[pos[k] as number] = 1;
  for (let p = 0; p < NPOS; p++) {
    if (((lim.limited >> p) & 1) === 0 || present[p] === 0) continue;
    const lo = lim.min[p] as number;
    const hi = lim.max[p] as number;
    if (lo > 0) addEdge(SRC, capBase + p, lo, -big);
    if (hi > lo) addEdge(SRC, capBase + p, hi - lo, 0);
  }
  for (let k = 0; k < n; k++) {
    const mask = masks[k] as number;
    if (mask === 0) continue;
    const p = pos[k] as number;
    if (p < NPOS && ((lim.limited >> p) & 1) === 1) addEdge(capBase + p, playerBase + k, 1, -(eff[k] as number));
    else if ((eff[k] as number) > 0) addEdge(SRC, playerBase + k, 1, -(eff[k] as number));
    else continue;
    for (let m = mask; m !== 0; m &= m - 1) addEdge(playerBase + k, groupBase + lowBit(m), 1, 0);
  }
  for (let g = 0; g < G; g++) addEdge(groupBase + g, SINK, r.slots.capacity[g] as number, 0);

  const dist = new Float64Array(V);
  const prev = new Int32Array(V);
  const inQueue = new Uint8Array(V);
  const queue = new Int32Array(V);
  const maxPops = V * to.length + V; // Bellman–Ford bound; never reached without a negative cycle
  for (;;) {
    dist.fill(Number.POSITIVE_INFINITY);
    dist[SRC] = 0;
    let qHead = 0;
    let qSize = 1;
    queue[0] = SRC;
    inQueue[SRC] = 1;
    let pops = 0;
    while (qSize > 0) {
      const u = queue[qHead] as number;
      qHead = (qHead + 1) % V;
      qSize--;
      inQueue[u] = 0;
      if (++pops > maxPops) throw new Error("lineup flow did not converge");
      const du = dist[u] as number;
      for (let e = head[u] as number; e >= 0; e = next[e] as number) {
        if ((rest[e] as number) <= 0) continue;
        const v = to[e] as number;
        const d = du + (cost[e] as number);
        if (d < (dist[v] as number) - FLOW_EPS) {
          dist[v] = d;
          prev[v] = e;
          if (inQueue[v] === 0) {
            queue[(qHead + qSize) % V] = v;
            qSize++;
            inQueue[v] = 1;
          }
        }
      }
    }
    if (!((dist[SINK] as number) < -FLOW_EPS)) break;
    for (let v = SINK; v !== SRC; ) {
      const e = prev[v] as number;
      rest[e] = (rest[e] as number) - 1;
      rest[e ^ 1] = (rest[e ^ 1] as number) + 1;
      v = to[e ^ 1] as number;
    }
  }

  // Like the greedy, the flow never starts a player worth 0 or less beyond a minimum: every step leaves
  // a min-cost flow of its size, and the final flow without such a player would cost no more than it
  // does, so less than the flow one step earlier (the last path's cost was negative).
  const { seat } = s;
  s.seatedCount = 0;
  for (let k = 0; k < n; k++) {
    for (let e = head[playerBase + k] as number; e >= 0; e = next[e] as number) {
      const v = to[e] as number;
      if ((e & 1) === 0 && v >= groupBase && rest[e] === 0) {
        seat[k] = v - groupBase;
        s.seated[s.seatedCount++] = k;
        break;
      }
    }
  }
}

/**
 * Canonical seats: while two starters could swap slots and the better one (points desc, id asc) sits
 * in the less restrictive group (higher bit), swap them. Same starters, same total.
 */
function canonicalize(r: PreparedRoster): void {
  const s = r.scratch;
  const { seat, seated, eff } = s;
  const { masks, idRank } = r;
  const cnt = s.seatedCount;
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < cnt; i++) {
      const a = seated[i] as number;
      const maskA = masks[a] as number;
      for (let j = 0; j < cnt; j++) {
        const b = seated[j] as number;
        const ga = seat[a] as number;
        const gb = seat[b] as number;
        // b sits in a less restrictive group, each fits the other's group, and b is the better player.
        if (ga >= gb || ((masks[b] as number) & (1 << ga)) === 0 || (maskA & (1 << gb)) === 0 || !ahead(eff, idRank, b, a)) continue;
        seat[a] = gb;
        seat[b] = ga;
        changed = true;
      }
    }
  }
}

/**
 * LV for one week (or one scenario-week): the best starting lineup's total.
 *
 * - points[k]: player k's projected points (roster order). NaN counts as 0.
 * - available (optional): available[k] = 0 → he scores 0 this week (bye, injured); he can still fill a
 *   starter minimum, as a benched-out MFL TE must.
 * - seat (optional, out): seat[k] = his slot group (index into roster.slots.groups) or −1 if he
 *   doesn't start; canonical (see the header).
 * - order (optional): lineupOrder(roster, points) for these same points; saves the sort.
 *
 * Players with 0 or fewer (effective) points never start unless a starter minimum forces them in.
 */
export function lineupTotal(r: PreparedRoster, points: Float64Array, available?: Uint8Array | null, seat?: Int32Array | null, order?: Int32Array | null): number {
  const n = r.size;
  checkLength(points, n, "points");
  if (available) checkLength(available, n, "available");
  if (seat) checkLength(seat, n, "seat");
  const s = r.scratch;
  const eff = s.eff;
  for (let k = 0; k < n; k++) {
    const v = points[k] as number;
    eff[k] = v !== v || (available && available[k] === 0) ? 0 : v;
  }
  if (r.usesFlow) solveByFlow(r);
  else solveGreedy(r, order ?? null);
  let total = 0;
  for (let i = 0; i < s.seatedCount; i++) total += eff[s.seated[i] as number] as number;
  if (seat) {
    canonicalize(r);
    seat.fill(-1, 0, n);
    for (let i = 0; i < s.seatedCount; i++) {
      const k = s.seated[i] as number;
      seat[k] = s.seat[k] as number;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------------------------
// Friendly API

export interface LineupPlayer extends LineupCandidate {
  points: number;
}

export interface LineupStarter {
  id: string;
  /** SlotDef.slot of the slot he fills. */
  slot: string;
  /** His points this week (0 when unavailable). */
  points: number;
}

export interface Lineup {
  total: number;
  /** In lineup (SlotDef) order; within a slot, best first. Empty slots are simply absent. */
  starters: LineupStarter[];
}

/** The starters from lineupTotal()'s seat output, in lineup order (within a slot: points desc, id asc). */
export function lineupStarters(r: PreparedRoster, points: Float64Array, seat: Int32Array, available?: Uint8Array | null): LineupStarter[] {
  checkLength(points, r.size, "points");
  checkLength(seat, r.size, "seat");
  const groups = r.slots.groups;
  const effOf = (k: number): number => {
    const v = points[k] as number;
    return v !== v || (available && available[k] === 0) ? 0 : v;
  };
  const rows: { k: number; g: number; order: number; points: number }[] = [];
  for (let k = 0; k < r.size; k++) {
    const g = seat[k] as number;
    const group = groups[g];
    if (g >= 0 && group) rows.push({ k, g, order: group.lineupIndex, points: effOf(k) });
  }
  rows.sort((a, b) => a.order - b.order || a.g - b.g || b.points - a.points || (r.idRank[a.k] as number) - (r.idRank[b.k] as number));
  return rows.map(({ k, g, points: pts }) => ({ id: r.ids[k] as string, slot: (groups[g] as SlotGroup).slot, points: pts }));
}

/** The best lineup for one week: its total and the starters with their slots (§7 LV). */
export function solveLineup(players: readonly LineupPlayer[], slots: PreparedSlots): Lineup {
  const roster = prepareRoster(players, slots);
  const points = Float64Array.from(players, (p) => p.points);
  const seat = new Int32Array(players.length);
  const total = lineupTotal(roster, points, null, seat);
  return { total, starters: lineupStarters(roster, points, seat) };
}
