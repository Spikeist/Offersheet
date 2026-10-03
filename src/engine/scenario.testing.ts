/**
 * Reference implementations for the speed-up tests (Phase 4 addendum, lead decision N6: "any speed shortcut matches the
 * exact path on random cases"): teamValue.ts's scenario lineups, floors and removal costs exactly as they were written
 * before the speed work (Checkpoint 4), so the tests can check the fast versions against them bit for bit. Test-only:
 * nothing in the app imports it.
 */
import { lineupOrder, lineupTotal, type PreparedSlots } from "./lineup";
import { instancePointsInto, type InstanceIndex } from "./needs";
import type { ScenarioCells, ScenarioValues, SolvedWeeks, TableRow, TeamEval } from "./teamValue";

/** Bitmask of the slot groups a lineup leaves with a free spot (its seats; −1 = bench). */
function openGroups(slots: PreparedSlots, seat: Int32Array, n: number): number {
  const fill = new Int32Array(slots.groups.length);
  for (let k = 0; k < n; k++) {
    const g = seat[k] as number;
    if (g >= 0) fill[g] = (fill[g] as number) + 1;
  }
  let free = 0;
  for (let g = 0; g < fill.length; g++) if ((fill[g] as number) < (slots.capacity[g] as number)) free |= 1 << g;
  return free;
}

function flagStride(row: TableRow): number {
  return row.cond.length;
}

/** scenarioValues before the speed work (one Map memo per week, a closure per flag, an allocation per pattern). */
export function referenceScenarioValues(team: TeamEval, weekCount: number, S: number, index: InstanceIndex | null = null, keep = false, spread = false): ScenarioValues {
  const { prep, rows } = team;
  const n = rows.length;
  const W = weekCount;
  const mean = new Float64Array(W);
  const sd = new Float64Array(W);
  const within = spread ? new Float64Array(W) : null;
  const instances = index ? Array.from({ length: W }, () => new Float64Array(index.size)) : null;
  let solves = 0;
  const scenarios = Number.isFinite(S) ? Math.max(0, Math.floor(S)) : 0;
  const kept = keep
    ? {
        pattern: Array.from({ length: W }, () => new Int32Array(scenarios)),
        lv: [] as Float64Array[],
        avail: [] as Uint8Array[][],
        seat: [] as Int32Array[][],
        open: [] as Int32Array[],
      }
    : null;
  // A week nobody can score (or no scenarios, or no players): one pattern, LV 0, nobody seated.
  const allOpen = prep.slots.groups.length > 0 ? (2 ** prep.slots.groups.length - 1) | 0 : 0;
  const emptyWeek = () => {
    if (!kept) return;
    kept.lv.push(Float64Array.of(0));
    kept.avail.push([new Uint8Array(n)]);
    kept.seat.push([new Int32Array(n).fill(-1)]);
    kept.open.push(Int32Array.of(allOpen));
  };
  const result = (): ScenarioValues => ({
    mean,
    sd,
    within,
    instances,
    solves,
    cells: kept ? { team, weekCount: W, scenarios, pattern: kept.pattern, lv: kept.lv, avail: kept.avail, seat: kept.seat, open: kept.open, floors: new Map() } : null,
  });
  if (scenarios === 0 || n === 0) {
    for (let w = 0; w < W; w++) emptyWeek();
    return result();
  }

  const cond = new Float64Array(n);
  const avail = new Uint8Array(n);
  // Seats cost a canonical ordering per solve (lineup.ts), so they're read only when something needs the starters.
  const seat = index || kept || within ? new Int32Array(n) : null;
  const orderBuf = new Int32Array(n);
  const flags = rows.map((r) => r.flags);
  const stride = Int32Array.from(rows, (r) => flagStride(r));
  /** Whether player k plays in scenario s, week w (flagStride: the row's own week count, never W). */
  const plays = (k: number, s: number, w: number): boolean => {
    const f = flags[k];
    return f !== null && f !== undefined && f[s * (stride[k] as number) + w] === 1;
  };
  for (let w = 0; w < W; w++) {
    for (let k = 0; k < n; k++) cond[k] = (rows[k] as TableRow).cond[w] as number;
    const order = lineupOrder(prep, cond, orderBuf);
    const m = order.length;
    if (m === 0) {
      emptyWeek(); // nobody can score this week: LV 0 in every scenario
      continue;
    }
    avail.fill(0); // only this week's order is set below: nobody else plays (and can't score anyway)
    const memo = new Map<number | string, number>();
    const lvs: number[] = [];
    const vars: number[] = [];
    const counts: number[] = [];
    const rowsInst: Float64Array[] = [];
    const weekPattern = kept ? (kept.pattern[w] as Int32Array) : null;
    const weekAvail: Uint8Array[] = [];
    const weekSeat: Int32Array[] = [];
    const weekOpen: number[] = [];
    for (let s = 0; s < scenarios; s++) {
      let key: number | string;
      if (m <= 30) {
        let bits = 0;
        for (let i = 0; i < m; i++) if (plays(order[i] as number, s, w)) bits |= 1 << i;
        key = bits;
      } else {
        let text = "";
        for (let i = 0; i < m; i++) text += plays(order[i] as number, s, w) ? "1" : "0";
        key = text;
      }
      let slot = memo.get(key);
      if (slot === undefined) {
        for (let i = 0; i < m; i++) {
          const k = order[i] as number;
          avail[k] = plays(k, s, w) ? 1 : 0;
        }
        slot = lvs.length;
        memo.set(key, slot);
        lvs.push(lineupTotal(prep, cond, avail, seat, order));
        if (within && seat) {
          // The starters who play (seated and available): Σ condSd² is this pattern's within-lineup variance.
          let v = 0;
          for (let k = 0; k < n; k++) {
            if ((seat[k] as number) < 0 || avail[k] !== 1) continue;
            const sdk = (rows[k] as TableRow).condSd[w] as number;
            v += sdk * sdk;
          }
          vars.push(v);
        }
        counts.push(0);
        if (index && seat) rowsInst.push(instancePointsInto(index, seat, cond, avail, n, new Float64Array(index.size)));
        if (kept && seat) {
          // Who plays: the players who can score this week and play in this pattern (the rest score 0 anyway).
          const who = new Uint8Array(n);
          for (let i = 0; i < m; i++) {
            const k = order[i] as number;
            who[k] = avail[k] as number;
          }
          weekAvail.push(who);
          weekSeat.push(Int32Array.from(seat));
          weekOpen.push(openGroups(prep.slots, seat, n));
        }
        solves++;
      }
      counts[slot] = (counts[slot] as number) + 1;
      if (weekPattern) weekPattern[s] = slot;
    }
    if (kept) {
      kept.lv.push(Float64Array.from(lvs));
      kept.avail.push(weekAvail);
      kept.seat.push(weekSeat);
      kept.open.push(Int32Array.from(weekOpen));
    }
    let mu = 0;
    for (let j = 0; j < lvs.length; j++) mu += (counts[j] as number) * (lvs[j] as number);
    mu = lvs.length === 1 ? (lvs[0] as number) : mu / scenarios;
    let ss = 0;
    if (lvs.length > 1) for (let j = 0; j < lvs.length; j++) ss += (counts[j] as number) * ((lvs[j] as number) - mu) ** 2;
    mean[w] = mu;
    sd[w] = Math.sqrt(ss / scenarios);
    if (within) {
      let vw = 0;
      for (let j = 0; j < vars.length; j++) vw += (counts[j] as number) * (vars[j] as number);
      within[w] = vars.length === 1 ? (vars[0] as number) : vw / scenarios;
    }
    if (instances && index) {
      const acc = instances[w] as Float64Array;
      for (let j = 0; j < rowsInst.length; j++) {
        const v = rowsInst[j] as Float64Array;
        const c = (counts[j] as number) / scenarios;
        for (let i = 0; i < index.size; i++) acc[i] = (acc[i] as number) + c * (v[i] as number);
      }
    }
  }
  return result();
}


/** The slot groups a player who fits `mask` can reach in a lineup: his own, then every group a starter seated in a reached group also fits (the walk the group graphs replaced). */
export function referenceReach(mask: number, seat: Int32Array, masks: Int32Array, n: number): number {
  let reach = mask;
  for (let changed = true; changed; ) {
    changed = false;
    for (let k = 0; k < n; k++) {
      const g = seat[k] as number;
      if (g < 0 || ((reach >>> g) & 1) === 0) continue;
      const next = reach | (masks[k] as number);
      if (next !== reach) {
        reach = next;
        changed = true;
      }
    }
  }
  return reach;
}

/** The lowest starter a newcomer with `mask` could displace in one lineup (0 when he can reach a free spot or nobody), by the walk. */
export function referenceFloor(mask: number, seat: Int32Array, masks: Int32Array, n: number, pts: ArrayLike<number>, open: number): number {
  const reach = referenceReach(mask, seat, masks, n);
  if ((reach & open) !== 0) return 0;
  let lo = Number.POSITIVE_INFINITY;
  for (let k = 0; k < n; k++) {
    const g = seat[k] as number;
    if (g >= 0 && ((reach >>> g) & 1) === 1 && (pts[k] as number) < lo) lo = pts[k] as number;
  }
  return Number.isFinite(lo) ? lo : 0;
}

/** EV floors per week (teamValue's addFloors) by the walk. */
export function referenceEvFloors(base: SolvedWeeks, mask: number): Float64Array {
  const { size: n, masks } = base.team.prep;
  return Float64Array.from(base.lv, (_, w) => referenceFloor(mask, base.seat[w] as Int32Array, masks, n, base.pts[w] as Float64Array, base.open[w] as number));
}

/** Kept cells' floors per week and pattern (teamValue's scenarioCellFloors) by the walk. */
export function referenceCellFloors(cells: ScenarioCells, mask: number): Float64Array[] {
  const { team, weekCount: W } = cells;
  const { size: n, masks } = team.prep;
  const out: Float64Array[] = [];
  for (let w = 0; w < W; w++) {
    const pts = Float64Array.from(team.rows, (r) => r.cond[w] as number);
    const seats = cells.seat[w] as readonly Int32Array[];
    out.push(Float64Array.from(seats, (seat, p) => referenceFloor(mask, seat, masks, n, pts, (cells.open[w] as Int32Array)[p] as number)));
  }
  return out;
}

/** What losing each starter costs one lineup (teamValue's addRemovalCosts) by the walk: his points minus the best bench player who reaches his group. */
export function referenceRemovalCosts(points: ArrayLike<number>, seat: Int32Array, masks: Int32Array, n: number): Float64Array {
  const out = new Float64Array(n);
  const bench: { pts: number; reach: number }[] = [];
  for (let e = 0; e < n; e++) {
    if ((seat[e] as number) >= 0) continue;
    const pts = points[e] as number;
    if (!(pts > 0) || masks[e] === 0) continue;
    bench.push({ pts, reach: referenceReach(masks[e] as number, seat, masks, n) });
  }
  for (let k = 0; k < n; k++) {
    const g = seat[k] as number;
    if (g < 0) continue;
    let best = 0;
    for (const b of bench) if (b.pts > best && ((b.reach >>> g) & 1) === 1) best = b.pts;
    out[k] = (points[k] as number) - best;
  }
  return out;
}
