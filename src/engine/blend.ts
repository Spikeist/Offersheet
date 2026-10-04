/**
 * Market-blended projections (CLAUDE.md §6 step 8; planner reply to Checkpoint 4, change 1; Phase 4b design, track A, and
 * its review). Pure and deterministic: no I/O, no clock, and every tunable number comes from config.marketBlend.
 *
 * Why: the trade search ranks thousands of trades by our own model's edge, so the top of its list fills with the
 * players our projections disagree with the trade market about most, and those are disproportionately the places our
 * projections are wrong (the optimizer's curse). So every QB, RB, WR and TE the market values has his projection pulled
 * part of the way toward what his market value implies:
 *
 * 1. Who: players whose own position (PlayerInfo.pos) is one of config.marketBlend.positions with a real FantasyCalc value
 *    in the blend's table (positive and finite; our estimates for players FantasyCalc doesn't value never count).
 *    Everyone else keeps his projection (w = 0, factor 1).
 * 2. The table (blendValues): this season's market in the league's own format. Redraft leagues: MarketInputs.values.
 *    Keeper leagues: the redraft list (MarketInputs.redraftValues; or `values` when the dynasty list failed and the
 *    redraft list stands in for it, format.isDynasty false). Dynasty leagues: MarketInputs.seasonValues, FantasyCalc's
 *    redraft list in the league's format ("dynasty leagues use redraftValue here too, since B_win is about this
 *    season"). A separate list counts only when it holds a real value (an empty one is missing, as
 *    market.valuesForTerm reads it). No table, no blend anywhere (league.ts warns when the market loaded without one).
 *    A saved list (Phase 4c, MarketInputs.fallback kind "saved": FantasyCalc didn't answer, the list is at most
 *    config.market.fantasyCalcStaleDays old) is read as today's. ⚠️ The curve fallback (kind "curve": the newest list
 *    is older than that; market.ts's header) has no table: its values only calibrate the model's own value curve, and
 *    blending our projections toward a curve of our own projections would only undo rank inversions with no market
 *    information in it (ours: the lead's "no FantasyCalc values used directly" there).
 * 3. Ours: his base rate b before the blend (§6 step 1: points per game when he plays, his matchups taken out), not his
 *    rest-of-season total (review of track A). ⚠️ A total mixes in how many games he plays, which his market value
 *    prices only roughly: on totals, a player out for weeks whose value holds up (a stash for the playoffs) got the
 *    whole season's gap squeezed into the few games he plays (the review's IR WR scoring 16 a game, valued 7,500 and
 *    back in week 16 went to 37 a game in the playoffs, f 2.33; Parker's league had f up to 1.58 on OUT and IR
 *    players), injured players' small totals pulled the curve down for the healthy players valued like them, and
 *    mid-season a player whose bye is done looked a game better than an equal one whose bye is ahead, so the blend
 *    undid half of every bye; and a build once a week was under way blended differently from one before its first
 *    kickoff (Phase 3's game-day identity broke). Per game, byes, availability (injuries, a game that
 *    kicked off) and the week shape stay entirely our model's, and the factors don't depend on the moment (a week
 *    under way changes nothing). ⚠️ The price: an injured player's base rate is compared with what healthy players
 *    valued like him score, while his value is also discounted for the games he misses, so part of that discount is
 *    counted twice (Parker's league, 2026-10-01: A.J. Brown, on IR until week 8, f 0.930); the planner asked for the
 *    market's injury discount in the projection, and this errs on that side.
 * 4. The curve R_pos, per position: the least-squares non-decreasing (isotonic, pool adjacent violators) fit of b on
 *    value (market.isotonicFit), over the position's healthy players with a real value (league.ts: no injury tag, a
 *    game left on his NFL team's schedule, b > 0; rostered and modeled free agents alike). Injured and tagged players
 *    are read off it but don't shape it: their b is a full-strength rate their discounted values don't match. A curve
 *    point's own market number comes from the curve fitted WITHOUT him (leave-one-out; review of track A): fitted with
 *    him, every player in the same order as the trend sat on the curve himself (f exactly 1 however far from the trend:
 *    Garrett Wilson, the planner's own example, got 1.000; 1.019 without him), so the blend corrected only rank
 *    inversions, never size gaps. ⚠️ Except at the two ends of the position's value range (no other curve point's value
 *    at or beyond his on one side): the curve without him would have to extrapolate there, and flat it cut the market's
 *    clear number one (Josh Allen, valued 2.7 times the next healthy QB, f 0.885 on 2026-10-01), so the end players
 *    read the curve with their own point in it, as before the review. Everyone else reads it flat beyond its ends, never
 *    extrapolated. ⚠️ A position with fewer than config.marketBlend.minPlayers curve points gets no blend.
 * 5. b′ = (1 − w)·b + w·R_pos(v), w = config.marketBlend.weight (clamped to [0, 1]); his factor f = b′ / b, and f = 1
 *    when b is 0 (ROS = 0 stays 0). Phase 4c (planner reply to Checkpoint 4b, change 4): f is then clamped to
 *    config.marketBlend.factorClamp [0.75, 1.35], since extreme factors are where data glitches (a fallback base rate, a
 *    role change the projections haven't caught yet) and market hype concentrate; b′ = f × b with the clamped f.
 *    BlendFactor keeps the factor before the clamp (fRaw) and the bound it hit (clamped), both only when it hit one;
 *    `market` stays the curve's number. A factor exactly on a bound isn't clamped. The checkpoint report's "10 most
 *    extreme factors, with a reason for each" reads blendRecords: each factor with his base rate's source (a fallback
 *    or not), games played, injury status and age when known, and which curve he read (ownPoint: an end of the value
 *    range reads the curve with his own point in it; a curve point inside it, the curve without him; a player off the
 *    curve, the whole curve).
 * 6. Applying it (applyBlend): b × f, every week's p × f (his byes, availability and week shape stay as they were), each
 *    week's σ recomputed from the scaled p (§6 step 5), and the ROS summary × f, so ROS′ = (1 − w)·ROS + w·(his ROS at
 *    the market's rate): the planner's formula per game played (with a clamped f, ROS′ = f × ROS instead, and
 *    PlayerModel.blend.clamped says which bound). league.ts builds the projection table from the scaled
 *    models, so everything after it (free agents, needs, trade chips, V*, both lineups of every trade, the season
 *    simulation, the estimate curve for unvalued players and the waiver credit W) reads blended points.
 */
import { config } from "./config";
import type { MarketInputs } from "./inputs";
import type { BaseRateSource, PlayerBlend, PlayerModel } from "./leagueModel";
import { curveValue, isotonicFit, type IsotonicCurve } from "./market";
import type { InjuryStatus, LeagueSettings, Pos } from "./model";
import { weeklySd, type ProjectionConfig } from "./projections";

/** The config.marketBlend keys this module reads, widened from config's `as const` literals so tests and calibration can vary them. */
export interface MarketBlendConfig {
  readonly weight: number;
  readonly positions: readonly Pos[];
  readonly minPlayers: number;
  /** f is clamped to [low, high] (rule 5; Phase 4c). */
  readonly factorClamp: readonly [number, number];
}

/** Canonical player id → this season's FantasyCalc value (the blend's table, rule 2). */
export type BlendTable = Readonly<Record<string, number>>;

/** A FantasyCalc value counts only when it is a positive, finite number (an estimate never reaches this table). */
function realValue(v: number | undefined): number | undefined {
  return v !== undefined && Number.isFinite(v) && v > 0 ? v : undefined;
}

/** A table holding at least one real value, else undefined: an empty table is a missing one (rule 2). */
function withValues(table: BlendTable | undefined): BlendTable | undefined {
  if (!table) return undefined;
  for (const v of Object.values(table)) if (realValue(v) !== undefined) return table;
  return undefined;
}

/**
 * The blend's value table for a league type (the file header, rule 2): this season's market in the league's format, or
 * null when there is none (FantasyCalc down; a dynasty league's redraft list, or a keeper league's, didn't load). A
 * separate list (a keeper league's redraft list, a dynasty league's season list) counts only when it holds a real value:
 * an empty one is a missing one, as market.valuesForTerm reads it (review of track A). The league's own list is used as
 * it is: when it loaded but holds nobody, the blend reaches nobody, and nothing failed to load.
 */
export function blendValues(market: MarketInputs | null | undefined, leagueType: LeagueSettings["leagueType"]): BlendTable | null {
  // The curve fallback's lists only calibrate the model's own value curve (rule 2): nothing to blend toward.
  if (!market || market.fallback?.kind === "curve") return null;
  if (leagueType === "redraft") return market.values;
  if (leagueType === "keeper") {
    const redraft = withValues(market.redraftValues);
    if (redraft) return redraft;
    // The dynasty list failed and the server served the redraft list as `values` (its format says so).
    return market.format.isDynasty ? null : market.values;
  }
  return withValues(market.seasonValues) ?? null;
}

/** One modeled player for the blend (league.ts passes every player with a model). */
export interface BlendInput {
  readonly id: string;
  readonly pos: Pos;
  /** His base rate b before the blend (rule 3): points per game when he plays. */
  readonly rate: number;
  /** He may be one of his position's curve points (rule 4: healthy, with a game left); a rate of 0 never is. */
  readonly fit: boolean;
}

/** A player the blend reaches (a real value at a blended position), per game (rule 3). */
export interface BlendFactor {
  /** His base rate b before the blend: points per game when he plays. */
  ours: number;
  /** R_pos(v): the points per game the position's curve gives his value (a curve point inside the value range: the curve fitted without him). */
  market: number;
  /** b′ = f × ours: his base rate after the blend, (1 − w)·ours + w·market unless f was clamped (0 when ours is 0: nothing to scale). */
  used: number;
  /** used ÷ ours: what his base rate and weekly points are multiplied by, after the clamp (1 when ours is 0). */
  f: number;
  /** v, his value in the blend's table. */
  value: number;
  /** He is one of the curve's points (healthy, with a game left); the others are read off the curve. */
  fit: boolean;
  /** Phase 4c (rule 5): the factor before config.marketBlend.factorClamp, ((1 − w)·ours + w·market) ÷ ours; only when it hit a bound. */
  fRaw?: number;
  /** The bound f was clamped to; absent when it wasn't. */
  clamped?: "low" | "high";
  /** A curve point at an end of his position's value range, who read the curve with his own point in it (rule 4); absent otherwise. */
  ownPoint?: true;
}

/** One configured position: how many players the blend reaches there, how many of them the curve is fitted on, and whether it was blended. */
export interface BlendPosition {
  pos: Pos;
  /** Modeled players there with a real value. */
  players: number;
  /** Of them, the curve's points (rule 4). */
  fit: number;
  /** At least config.marketBlend.minPlayers curve points: the position is blended. */
  blended: boolean;
}

/** A build's blend (league.ts computes it once per build and applies the same factors everywhere). */
export interface MarketBlend {
  /** w, clamped to [0, 1]; 0 when nothing is blended (no table, or a weight of 0). */
  weight: number;
  /** Every player the blend reaches, by id; ours 0 gives f 1. A player absent here keeps his projection. */
  factors: ReadonlyMap<string, BlendFactor>;
  /** Per configured position (config order, each once): empty when there is no table or no weight. */
  positions: BlendPosition[];
}

/** No blend: every factor 1. */
export function noBlend(): MarketBlend {
  return { weight: 0, factors: new Map(), positions: [] };
}

/** The curve at v, flat beyond both ends (rule 4: never extrapolated; market.curveValue is flat above its last point only). */
function curveAt(curve: IsotonicCurve, v: number): number {
  const first = curve.xs[0];
  return first === undefined ? 0 : curveValue(curve, Math.max(v, first));
}

/** config.marketBlend.factorClamp as [low, high] (rule 5): a bound that isn't a finite number doesn't clamp, nor does a pair out of order. */
function clampBounds(range: readonly [number, number] | undefined): [number, number] {
  const lo = range && Number.isFinite(range[0]) ? range[0] : 0;
  const hi = range && Number.isFinite(range[1]) ? range[1] : Number.POSITIVE_INFINITY;
  return lo <= hi ? [lo, hi] : [0, Number.POSITIVE_INFINITY];
}

/** A player on the way to his factor. */
interface Point {
  id: string;
  rate: number;
  v: number;
  fit: boolean;
}

/**
 * The blend's factors (the file header, rules 1, 4 and 5) for `players` (each id once; a repeat is ignored) against the
 * blend's table `values` (null: no blend), each clamped to cfg.factorClamp. Deterministic whatever the players' order:
 * each fit pools equal values first and sorts its points.
 */
export function marketBlend(players: readonly BlendInput[], values: BlendTable | null, cfg: MarketBlendConfig = config.marketBlend): MarketBlend {
  const weight = Number.isFinite(cfg.weight) ? Math.min(1, Math.max(0, cfg.weight)) : 0;
  if (!values || weight <= 0) return noBlend();
  const [lo, hi] = clampBounds(cfg.factorClamp);
  const positions = [...new Set(cfg.positions)];
  const wanted = new Set<Pos>(positions);
  const byPos = new Map<Pos, Point[]>();
  const seen = new Set<string>();
  for (const p of players) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    if (!wanted.has(p.pos)) continue;
    const v = realValue(values[p.id]);
    if (v === undefined) continue;
    let group = byPos.get(p.pos);
    if (!group) byPos.set(p.pos, (group = []));
    const rate = Number.isFinite(p.rate) ? Math.max(0, p.rate) : 0;
    group.push({ id: p.id, rate, v, fit: p.fit && rate > 0 });
  }
  const minPlayers = Number.isFinite(cfg.minPlayers) ? Math.max(1, Math.ceil(cfg.minPlayers)) : 1;
  const factors = new Map<string, BlendFactor>();
  const out: BlendPosition[] = [];
  for (const pos of positions) {
    const group = byPos.get(pos) ?? [];
    // Sorted as isotonicFit sorts, once: each fit without one of them then sorts input already in order (linear).
    const members = group.filter((g) => g.fit).sort((a, b) => a.v - b.v || a.rate - b.rate);
    const blended = members.length >= minPlayers;
    out.push({ pos, players: group.length, fit: members.length, blended });
    if (!blended) continue;
    const full = isotonicFit(members.map((g) => ({ x: g.v, y: g.rate })));
    for (const g of group) {
      // A curve point inside the value range reads the curve fitted on the others (leave-one-out); the end players and
      // everyone off the curve read the whole curve.
      const others = g.fit ? members.filter((m) => m !== g) : [];
      const inside = others.some((m) => m.v <= g.v) && others.some((m) => m.v >= g.v);
      const curve = inside ? isotonicFit(others.map((m) => ({ x: m.v, y: m.rate }))) : full;
      const market = Math.max(0, curveAt(curve, g.v));
      const blendedRate = g.rate > 0 ? (1 - weight) * g.rate + weight * market : 0;
      const fRaw = g.rate > 0 ? blendedRate / g.rate : 1;
      // Rule 5's clamp (Phase 4c): a factor past a bound is the bound; one on it isn't clamped.
      const clamped = g.rate > 0 ? (fRaw < lo ? "low" : fRaw > hi ? "high" : null) : null;
      const f = clamped === "low" ? lo : clamped === "high" ? hi : fRaw;
      const used = clamped ? f * g.rate : blendedRate;
      factors.set(g.id, { ours: g.rate, market, used, f, value: g.v, fit: g.fit, ...(clamped ? { fRaw, clamped } : {}), ...(g.fit && !inside ? { ownPoint: true as const } : {}) });
    }
  }
  return { weight, factors, positions: out };
}

/** His factor in a blend: 1 when the blend doesn't reach him or his base rate is 0. */
export function blendFactor(blend: MarketBlend, id: string): number {
  const factor = blend.factors.get(id);
  return factor && factor.ours > 0 && blend.weight > 0 ? factor.f : 1;
}

/**
 * A player's model with his blend applied (the file header, rule 6): b, every week's p and the ROS summary × f, each
 * week's σ from the scaled p (§6 step 5: c_pos × p + d_pos, 0 when p is 0). PlayerModel.blend, on the ros.total basis
 * the tables show, while he has points left: ours = ros.total before, used = ros.total after (= f × ours), market =
 * ours + (used − ours) ÷ w = his ROS at the market's rate (ours × R_pos(v) ÷ b), so used = (1 − w)·ours + w·market
 * exactly. With a clamped factor (rule 5): market = ours × R_pos(v) ÷ b still (the market's number), used = ours × the
 * bound, and `clamped` names it. The same model, untouched, when the blend doesn't reach him or his base rate is 0.
 */
export function applyBlend(pm: PlayerModel, pos: Pos, blend: MarketBlend, cfg: Pick<ProjectionConfig, "sigma"> = config.projections): PlayerModel {
  const factor = blend.factors.get(pm.id);
  if (!factor || !(factor.ours > 0) || !(blend.weight > 0)) return pm;
  const f = factor.f;
  const weekly = pm.weekly.map((w) => {
    const p = w.p * f;
    return { ...w, p, sd: weeklySd(p, pos, cfg) };
  });
  const ours = pm.ros.total;
  const used = ours * f;
  const market = factor.clamped ? (ours * factor.market) / factor.ours : ours + (used - ours) / blend.weight;
  const shown: PlayerBlend | null = ours > 0 ? { ours, market, used, weight: blend.weight, ...(factor.clamped ? { clamped: factor.clamped } : {}) } : null;
  return {
    ...pm,
    base: { ...pm.base, b: pm.base.b * f },
    weekly,
    ros: { ...pm.ros, total: used, regular: pm.ros.regular * f, playoffs: pm.ros.playoffs * f },
    ...(shown ? { blend: shown } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// The factors with what explains them (the Checkpoint 4c report: "the 10 most extreme factors before the clamp, with the
// reason for each")

/** Base-rate sources without a weekly projection (projections.ts): Sleeper's season line ÷ 17, his own points per game, or nothing. */
const FALLBACK_SOURCES: ReadonlySet<BaseRateSource> = new Set<BaseRateSource>(["season", "actual", "none"]);

/** One blended player's factor with the facts that explain it (blendRecords). Points are per game played. */
export interface BlendRecord {
  id: string;
  /** His position (PlayerInfo.pos), when known. */
  pos: Pos | null;
  /** The factor before the clamp (rule 5) and after it, and the bound it hit (null: none). */
  fRaw: number;
  f: number;
  clamped: "low" | "high" | null;
  /** His base rate before the blend, the curve's number for his value, and his base rate after it (BlendFactor's). */
  ours: number;
  market: number;
  used: number;
  /** His value in the blend's table. */
  value: number;
  /**
   * Which curve he read (rule 4): "withoutHim" (a curve point inside his position's value range: the curve fitted on the
   * others), "ownPoint" (a curve point at an end of it: the curve with his own point in it), "offCurve" (not a curve
   * point: an injury tag, no game left, or no rate; the whole curve).
   */
  curve: "withoutHim" | "ownPoint" | "offCurve";
  /**
   * His base rate's source (PlayerModel.base.source; null without a model) and whether it is a fallback: no weekly
   * projection from either source, so Sleeper's season line ÷ 17 ("season"), his own points per game ("actual") or none.
   */
  source: BaseRateSource | null;
  fallback: boolean;
  /** Games he played this season (PlayerModel.base.games; null without a model). */
  games: number | null;
  /** His injury status and age (PlayerInfo), null when unknown. */
  injury: InjuryStatus | null;
  age: number | null;
}

/** What blendRecords reads of a player beyond his factor (PlayerInfo's fields). */
export interface BlendRecordInfo {
  readonly pos?: Pos;
  readonly injury?: InjuryStatus;
  readonly age?: number;
}

/** How extreme a factor is: |ln f| (×1.5 and ×0.667 are equally far from 1); a factor that isn't positive counts as infinitely far. */
function extremeness(f: number): number {
  return f > 0 && Number.isFinite(f) ? Math.abs(Math.log(f)) : Number.POSITIVE_INFINITY;
}

/**
 * Every factor of `blend` with the facts that explain it (BlendRecord), the most extreme before the clamp first (|ln fRaw|;
 * ties: the smaller id). Pure: `players` is the build's models (PlayerModel.base: its source and games, unchanged by the
 * blend; league.ts LeaguePlayers.players or LeagueModel.players), `info` his PlayerInfo (snapshot.players). Players whose
 * base rate is 0 (f 1, nothing to scale) are left out.
 */
export function blendRecords(blend: MarketBlend, players: Readonly<Record<string, Pick<PlayerModel, "base"> | undefined>>, info: (id: string) => BlendRecordInfo | undefined): BlendRecord[] {
  const out: BlendRecord[] = [];
  for (const [id, factor] of blend.factors) {
    if (!(factor.ours > 0)) continue;
    const base = players[id]?.base;
    const who = info(id);
    out.push({
      id,
      pos: who?.pos ?? null,
      fRaw: factor.fRaw ?? factor.f,
      f: factor.f,
      clamped: factor.clamped ?? null,
      ours: factor.ours,
      market: factor.market,
      used: factor.used,
      value: factor.value,
      curve: !factor.fit ? "offCurve" : factor.ownPoint ? "ownPoint" : "withoutHim",
      source: base?.source ?? null,
      fallback: base ? FALLBACK_SOURCES.has(base.source) : false,
      games: base ? base.games : null,
      injury: who?.injury ?? null,
      age: who?.age !== undefined && Number.isFinite(who.age) ? who.age : null,
    });
  }
  return out.sort((a, b) => extremeness(b.fRaw) - extremeness(a.fRaw) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
