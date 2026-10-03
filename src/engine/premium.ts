/**
 * The star premium (planner addendum to Checkpoint 3, §1 and §2; lead decisions N1 and N2 of the Phase 4 addendum):
 * managers value their own best players a bit above market value. Pure and deterministic: plain inputs, no I/O and no
 * clock; every number comes from config.acceptance.starPremium. One function computes it for the League model
 * (TeamModel.premiums, from the model's own values and odds: league.ts) and for the trade context (from its baseline
 * odds, every team at V*: evaluate.ts), so the League page's tags and the search's acceptance agree.
 *
 * For each player j a team rosters (active, IR and taxi: all of them are "my players" to a manager):
 * - e_rank by j's rank by market value on that roster: perception values, the values the partner's g reads (§9: redraft
 *   values in redraft and keeper leagues, dynasty values in dynasty leagues; FantasyCalc values and the model's
 *   estimates and floors; a player without one counts 0), ties: more ROS points (§6 step 7, PlayerModel.ros.total),
 *   then the smaller id. #1 → rank[0] (0.10), #2 → rank[1] (0.05), the others 0. By market value, not lineup cost:
 *   managers think of "my best players" by name and value.
 * - e_elite = elite (0.10) when j is among the top eliteTop (12) by FantasyCalc value in the league's format: the
 *   perception list of MarketInputs (market.valuesForTerm: the redraft list in a keeper league), FantasyCalc values only
 *   (estimates and floors never), the whole list (free agents included, not only rostered players), ties at the cut by
 *   the smaller id. No market → nobody is elite.
 * - e = e_rank + e_elite. Dynasty leagues only: a rebuilding team (its baseline P(playoffs) below rebuild.below, 25%)
 *   halves e (rebuild.factor) for a player at rebuild.positions (RB, WR: PlayerInfo.pos) aged rebuild.age (27) or older.
 *   An unknown age or an unknown P(playoffs) changes nothing. No contender multiplier: contenders already weigh lineup
 *   gains more (§11, n × 1.3).
 * - "Harder to get" (§2): e ≥ harderToGetMin (0.15), a top-12 player who is also his team's #1 or #2.
 *
 * Where it's used (perceivedPackage; acceptance.ts, evaluate.ts): the partner's perceived package puts v′_j = v_j × (1 +
 * e_j) in place of v_j for each player the partner gives (the waiver credit W and pick values unchanged; with
 * config.market.studExponent γ, v′ is raised to γ as v would be), which gives the partner's perceived g, the g feature
 * of the acceptance model (quick and full). Everything else stays raw: my g_mkt and B, the partner's g_mkt on the card,
 * its trade history, the screening window (§12) and ⚠️ the veto rule (league members judge a trade by the market, not by
 * the owner's attachment to his player). These are starting assumptions: Phase 6 fits a scale factor for e from
 * Accepted and Rejected outcomes alongside the β refit (planner addendum §1).
 */
import { tradePackage, type LeagueType, type PackageSide, type PackageValue } from "./benefit";
import { config } from "./config";
import type { MarketInputs } from "./inputs";
import type { PlayerPremium } from "./leagueModel";
import { valuesForTerm, type MarketConfig, type ValueLookup } from "./market";
import type { LeagueSnapshot, Pos } from "./model";
import type { PremiumFact } from "./tradeModel";

/** The config.acceptance.starPremium keys this module reads, widened so calibration (Phase 6) and tests can pass other numbers. */
export interface StarPremiumConfig {
  /** e_rank by rank on the roster: index 0 = the most valuable player; past the end, 0. */
  readonly rank: readonly number[];
  readonly elite: number;
  readonly eliteTop: number;
  readonly rebuild: { readonly below: number; readonly age: number; readonly factor: number; readonly positions: readonly Pos[] };
  readonly harderToGetMin: number;
}

/** Float noise in the tag threshold (0.10 + 0.05 is 0.15000000000000002), not a tunable. */
const EPS = 1e-9;

const isFiniteNumber = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------------------------------------
// The elite list (e_elite)

/**
 * The ids of the top eliteTop players by FantasyCalc value on the perception list of `market` (market.valuesForTerm:
 * MarketInputs.redraftValues in a keeper league, else `values`): positive finite values only, ties at the cut by the
 * smaller id. Empty without a market.
 */
export function eliteIds(market: MarketInputs | null | undefined, cfg: StarPremiumConfig = config.acceptance.starPremium): Set<string> {
  const out = new Set<string>();
  const top = isFiniteNumber(cfg.eliteTop) ? Math.max(0, Math.floor(cfg.eliteTop)) : 0;
  if (!market || top === 0) return out;
  const list = Object.entries(valuesForTerm(market, "perception").values)
    .filter(([, v]) => isFiniteNumber(v) && v > 0)
    .sort((a, b) => b[1] - a[1] || byId(a[0], b[0]));
  for (const [id] of list.slice(0, top)) out.add(id);
  return out;
}

// ---------------------------------------------------------------------------------------------
// One team's premiums

/** One rostered player as the premium reads him. */
export interface PremiumPlayer {
  id: string;
  /** His perception value (the values the partner's g reads; 0 without one). */
  value: number;
  /** His ROS points (§6 step 7; the tie-break after value). */
  ros: number;
  /** His position (PlayerInfo.pos) and age, for the dynasty rebuilding rule; unknown → no change. */
  pos?: Pos;
  age?: number;
}

export interface TeamPremiumInput {
  /** The team's players: active, IR and taxi (each once; a repeated id counts once). */
  players: readonly PremiumPlayer[];
  /** The top eliteTop ids (eliteIds). */
  elite: ReadonlySet<string>;
  leagueType: LeagueType;
  /** The team's baseline P(playoffs) (the dynasty rebuilding rule); null = unknown. */
  pPlayoffs: number | null;
}

/** e_rank for a rank (1 = the most valuable player on the roster). */
export function rankPremium(rank: number, cfg: StarPremiumConfig = config.acceptance.starPremium): number {
  const e = Number.isInteger(rank) && rank >= 1 ? cfg.rank[rank - 1] : undefined;
  return isFiniteNumber(e) ? e : 0;
}

/** Whether the dynasty rebuilding rule halves this player's e (the file header). */
export function rebuildingDiscount(leagueType: LeagueType, pPlayoffs: number | null, player: Pick<PremiumPlayer, "pos" | "age">, cfg: StarPremiumConfig = config.acceptance.starPremium): boolean {
  const r = cfg.rebuild;
  return leagueType === "dynasty" && isFiniteNumber(pPlayoffs) && pPlayoffs < r.below && player.pos !== undefined && r.positions.includes(player.pos) && isFiniteNumber(player.age) && player.age >= r.age;
}

/** Whether e earns the "Harder to get" tag (e ≥ harderToGetMin). */
export function isHarderToGet(e: number, cfg: StarPremiumConfig = config.acceptance.starPremium): boolean {
  return isFiniteNumber(e) && e >= cfg.harderToGetMin - EPS;
}

/** Every player's premium on one team (the file header): rank by value on the roster (ties: more ROS points, then the smaller id), e and the tag. */
export function teamPremiums(x: TeamPremiumInput, cfg: StarPremiumConfig = config.acceptance.starPremium): Record<string, PlayerPremium> {
  const seen = new Set<string>();
  const players: PremiumPlayer[] = [];
  for (const p of x.players) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    players.push(p);
  }
  const num = (v: number) => (isFiniteNumber(v) ? v : 0);
  players.sort((a, b) => num(b.value) - num(a.value) || num(b.ros) - num(a.ros) || byId(a.id, b.id));
  const out: Record<string, PlayerPremium> = {};
  players.forEach((p, i) => {
    const rank = i + 1;
    const elite = x.elite.has(p.id);
    let e = rankPremium(rank, cfg) + (elite ? cfg.elite : 0);
    if (e !== 0 && rebuildingDiscount(x.leagueType, x.pPlayoffs, p, cfg)) e *= cfg.rebuild.factor;
    out[p.id] = { e, rank, elite, harderToGet: isHarderToGet(e, cfg) };
  });
  return out;
}

/** What leaguePremiums reads: the league, its market, each player's perception value and ROS points, each team's baseline P(playoffs). */
export interface LeaguePremiumInput {
  snapshot: Pick<LeagueSnapshot, "teams" | "players" | "settings">;
  market: MarketInputs | null | undefined;
  /** Perception value (0 without one): the League model's PlayerModel.value, the trade context's TradeInternals.values. */
  value: (id: string) => number;
  /** ROS points (PlayerModel.ros.total; 0 without a model). */
  ros: (id: string) => number;
  /** A team's baseline P(playoffs), null when unknown (no simulation). */
  pPlayoffs: (teamId: string) => number | null;
}

/** Every team's premiums (team id → player id → PlayerPremium): every rostered player, active, IR and taxi. */
export function leaguePremiums(x: LeaguePremiumInput, cfg: StarPremiumConfig = config.acceptance.starPremium): Map<string, Record<string, PlayerPremium>> {
  const elite = eliteIds(x.market, cfg);
  const out = new Map<string, Record<string, PlayerPremium>>();
  for (const team of x.snapshot.teams) {
    const players = [...team.roster, ...team.ir, ...team.taxi].map((id): PremiumPlayer => {
      const info = x.snapshot.players[id];
      return { id, value: x.value(id), ros: x.ros(id), ...(info ? { pos: info.pos } : {}), ...(info?.age !== undefined ? { age: info.age } : {}) };
    });
    out.set(team.id, teamPremiums({ players, elite, leagueType: x.snapshot.settings.leagueType, pPlayoffs: x.pPlayoffs(team.id) }, cfg));
  }
  return out;
}

/** The PremiumFact of each player (TradeDetail.premium: the players the partner gives); a player without a premium gets e 0, rank 0. */
export function premiumFacts(ids: readonly string[], premiums: Readonly<Record<string, PlayerPremium>> | undefined): PremiumFact[] {
  return ids.map((playerId) => {
    const p = premiums?.[playerId];
    return p ? { playerId, e: p.e, rank: p.rank, elite: p.elite, harderToGet: p.harderToGet } : { playerId, e: 0, rank: 0, elite: false, harderToGet: false };
  });
}

// ---------------------------------------------------------------------------------------------
// The partner's perceived package

/** A value-table entry as a number (market.ts's rule: a missing or non-finite entry is 0). */
function entryValue(entry: number | { readonly value: number } | undefined): number {
  const v = typeof entry === "number" ? entry : entry?.value;
  return v !== undefined && Number.isFinite(v) ? v : 0;
}

/**
 * The partner's perceived package (§1 of the addendum): benefit.tradePackage for the side that receives `recv` (my
 * give) and gives `give` (my get), with v′ = v × (1 + e) in place of v for each player in `give` (premium(id) = his e
 * for the partner, 0 when absent or not finite); what it receives, its picks and the waiver credit W unchanged. With
 * every e 0 it equals tradePackage exactly. Its g is the partner's perceived g (acceptance's g feature).
 */
export function perceivedPackage(recv: PackageSide, give: PackageSide, values: ValueLookup, W: number, premium: (id: string) => number, cfg: MarketConfig = config.market): PackageValue {
  const table: Record<string, number> = {};
  for (const id of recv.players) table[id] = entryValue(values[id]);
  for (const id of give.players) {
    const e = premium(id);
    table[id] = entryValue(values[id]) * (1 + (isFiniteNumber(e) ? e : 0));
  }
  return tradePackage(recv, give, table, W, cfg);
}
