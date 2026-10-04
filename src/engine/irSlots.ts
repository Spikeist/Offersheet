/**
 * IR slots in a trade (CLAUDE.md §7 roster legality, §9; planner reply to Checkpoint 4, change 5; Phase 4b track E): where a
 * traded IR player goes, and the active-roster spots a trade's packages count. A light module (config and types only), so
 * a reader outside the engine (a report, the UI) can apply the engine's rule without the lineup solver (Phase 4c: the
 * cards quote FantasyCalc's raw values and no longer read it); returners.ts re-exports it. Pure and deterministic: no I/O,
 * no clock, no randomness; the one tunable is config.lineups.irEligibleDefault.
 *
 * 1. A traded IR player (irAfterTrade; evaluate.ts roster legality, rule 5): IR players are tradable. One given leaves the
 *    giver's IR (its IR slot opens; no active spot does). One received goes into an open IR slot of the receiver (irSlots
 *    minus the IR players it keeps) when his status is one the slot accepts (irEligibleStatuses: the platform's rule,
 *    LeagueSettings.irEligible, else config.lineups.irEligibleDefault), as a returner; otherwise he takes an active roster
 *    spot like any received player. Several received IR players: the most ROS points first into the open slots (ties: the
 *    smaller id). ⚠️ Only players received from the other team's IR are considered for an IR slot: one received from its
 *    active roster joins the active roster whatever his status.
 * 2. The open roster spots a trade's packages count (activeSpots; market.ts's header, §9's waiver credit; review of track
 *    E): the players a side gives from and receives onto its ACTIVE roster after item 1, since an IR slot isn't a roster
 *    spot (an IR player who leaves one opens no active spot, and one who takes one fills none), and (Phase 4c) those IR
 *    players themselves, the side's own IR movers (ActiveSpots.inactive): the neutral throw-in rule (planner reply to
 *    Checkpoint 4b, change 2: market.packageValues) removes no roster-spot credit with a player who moved without one. So
 *    every caller gets the packages the engine's evaluations read (evaluate.ts spotsOf is this function).
 *    tradeActiveSpots reads the same from the league itself (a reader outside the engine, such as a report).
 */
import { config } from "./config";
import type { ActiveSpots } from "./market";
import type { InjuryStatus, LeagueSettings, LeagueSnapshot } from "./model";

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The statuses an IR slot accepts (the file header, item 1): the platform's rule when it reports one, else config's default. */
export function irEligibleStatuses(settings: Pick<LeagueSettings, "irEligible">, cfg: { readonly irEligibleDefault: readonly InjuryStatus[] } = config.lineups): ReadonlySet<InjuryStatus> {
  return new Set(settings.irEligible ?? cfg.irEligibleDefault);
}

/** What irAfterTrade reads. */
export interface IrTradeInput {
  /** The side's IR players before the trade. */
  readonly ir: readonly string[];
  /** IR slots (LeagueSettings.irSlots). */
  readonly irSlots: number;
  /** The players the side gives and receives (active-roster and IR players alike). */
  readonly given: readonly string[];
  readonly received: readonly string[];
  /** Whether a received player comes from the other side's IR. */
  readonly fromIR: (id: string) => boolean;
  /** Whether his status is one the side's IR slot accepts (irEligibleStatuses). */
  readonly eligible: (id: string) => boolean;
  /** His rest-of-season points (PlayerModel.ros.total; 0 without a model): the most go into the open slots first. */
  readonly ros: (id: string) => number;
}

/** A side's IR after a trade (irAfterTrade). */
export interface IrAfterTrade {
  /** The IR players it gives (they leave its IR, opening no active spot). */
  readonly givenIR: readonly string[];
  /** The received IR players who go into its open IR slots. */
  readonly toIR: readonly string[];
  /** Its IR after the trade: the ones it keeps, then toIR. */
  readonly ir: readonly string[];
}

/** A side's IR after a trade (the file header, item 1). */
export function irAfterTrade(x: IrTradeInput): IrAfterTrade {
  const before = [...new Set(x.ir)];
  const leaving = new Set(x.given);
  const givenIR = before.filter((id) => leaving.has(id));
  const kept = before.filter((id) => !leaving.has(id));
  const slots = Number.isFinite(x.irSlots) ? Math.max(0, Math.floor(x.irSlots)) : 0;
  const open = Math.max(0, slots - kept.length);
  const toIR = [...new Set(x.received)]
    .filter((id) => x.fromIR(id) && x.eligible(id))
    .sort((a, b) => x.ros(b) - x.ros(a) || byId(a, b))
    .slice(0, open);
  return { givenIR, toIR, ir: [...kept, ...toIR] };
}

/**
 * The players a side gives from and receives onto its active roster in a trade (the file header, item 2): `given` minus
 * the IR players leaving its IR, `received` minus the ones going into its IR slots: what §9's open-spot credit counts
 * (market.packageValues). Those IR players themselves are the side's `inactive` set (Phase 4c: each moves without an
 * active roster spot, so the neutral throw-in rule takes no spot credit away with him); absent when no IR player of the
 * side moves.
 */
export function activeSpots(given: readonly string[], received: readonly string[], ir: Pick<IrAfterTrade, "givenIR" | "toIR">): ActiveSpots {
  const out = new Set(ir.givenIR);
  const inn = new Set(ir.toIR);
  const spots = { give: given.filter((id) => !out.has(id)).length, recv: received.filter((id) => !inn.has(id)).length };
  const inactive = [...given.filter((id) => out.has(id)), ...received.filter((id) => inn.has(id))];
  return inactive.length ? { ...spots, inactive: new Set(inactive) } : spots;
}

/**
 * Item 2 read from the league itself (a reader outside the engine): team `teamId`'s active-roster moves when it gives
 * `given` to team `otherId` and receives `received` from it (IR players placed by item 1: each team's IR as the snapshot
 * lists it, a player listed on its active roster too counting as active, as league.ts TeamWork.ir reads it; the slot's
 * statuses, irEligibleStatuses), with its own IR movers as `inactive` (activeSpots), and whether an IR player moves at all
 * (`irMoved`: one given from its IR or received from the other team's). Which received players take its open IR slots
 * can depend on their ROS points (item 1: the most first), while how many can't: so the counts are the engine's whatever
 * `ros` says, and so is the inactive set given the engine's ROS points (`ros`: PlayerModel.ros.total, as evaluate.ts reads
 * them; default 0 for everyone, ties by the smaller id, which can name another player only when more eligible IR players
 * are received than the side has open IR slots). With IR returners on, as the app builds.
 */
export function tradeActiveSpots(
  league: Pick<LeagueSnapshot, "teams" | "players" | "settings">,
  teamId: string,
  otherId: string,
  given: readonly string[],
  received: readonly string[],
  ros: (id: string) => number = () => 0,
): { spots: ActiveSpots; irMoved: boolean } {
  const irOf = (id: string): string[] => {
    const t = league.teams.find((x) => x.id === id);
    return t ? t.ir.filter((p) => !t.roster.includes(p)) : [];
  };
  const mine = irOf(teamId);
  const theirs = new Set(irOf(otherId));
  const eligible = irEligibleStatuses(league.settings);
  const after = irAfterTrade({
    ir: mine,
    irSlots: league.settings.irSlots,
    given,
    received,
    fromIR: (id) => theirs.has(id),
    eligible: (id) => eligible.has(league.players[id]?.injury ?? "ACTIVE"),
    ros,
  });
  return { spots: activeSpots(given, received, after), irMoved: after.givenIR.length > 0 || received.some((id) => theirs.has(id)) };
}
