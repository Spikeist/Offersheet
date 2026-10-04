/**
 * The Trade Finder's pattern note (CLAUDE.md §13; planner reply to Checkpoint 4b, change 6 and answer 4: the given-player
 * cap of 3 stays, and when most of the best ideas would trade the same player of mine a line above the list says so and
 * why). Pure and deterministic: no I/O, no clock, no randomness; its thresholds come from config.explain (patternMinCount,
 * patternTop, patternDriverShare, patternDriversMax, weeklyLineMin, slotChangeMin, patternDepthCoverMin).
 *
 * Which list (⚠️ ours, the lead's design): the search's final ranking WITHOUT the given-player cap (search.ts: the same
 * finalists, the other diversity rules and the minimum chance as the list shows them, rank.ts), its first patternTop
 * trades: the "uncapped top 10". The cap is what hides the pattern from the list itself, so the note reads the list the
 * cap would have shown. When at least patternMinCount of them give the same player P of mine (a 2-for-1 counts for both
 * of my players), the note names him; two players at the same count: the one in the better-ranked trade, then the
 * smaller id. Fewer: no note. ⚠️ Never one of my must-include players (PatternInputs.forced; review of track SR,
 * finding 1): every trade gives him because the user asked, so "Most of your best ideas trade <him>" would tell the user
 * nothing (and the given-player cap skips him, rank.ts, so the list itself shows how often he's given); the note counts
 * my other players only.
 *
 * Drivers (never invented: each is read off the model's own numbers for each trade that gives P; one is named when it
 * holds in at least patternDriverShare (half) of P's trades in that list; at most patternDriversMax (3), in this order):
 * - byeCover: P's NFL bye week b (ModelInputs.nfl.byeWeek of his NFL team) is a week the trade can still change (from
 *   the first counted week on) and the trade raises my win chance that week by at least weeklyLineMin
 *   (TradeDetail.winChance, before → after). The words add "your riskiest week" when b has my lowest baseline win chance
 *   among the counted weeks (winChance's `before`; "one of your riskiest weeks" when another week ties it).
 * - incomingByes: every player I'd get has a known bye that is either done (before the first counted week: a bye that
 *   passed, or the week in progress, which no trade can change) or in a counted week my baseline win chance is at least
 *   50% ("weeks you're favored to win": a week with a game; a bye in a week without one, the playoffs say, doesn't count).
 *   The words stay true for the trades where it holds: "have byes in weeks you're favored to win" only when every such
 *   bye is ahead, "have had their byes" when every one is done, "have byes that are done or in weeks you're favored to
 *   win" when some of each.
 * - slotGain: my largest slot-instance gain (TradeDetail.mySlots, after − before; ⚠️ ours: only a gain of at least
 *   config.explain.slotChangeMin points a week, the reasons' own bar for a slot sentence) is the same slot instance; the
 *   one most of P's trades share is named (its label; ties: the slot order of mySlots).
 * - injuryCover: TradeDetail.depthCover (my ΔPPW in scenario lineups minus in expected-value lineups) is at least
 *   patternDepthCoverMin points a week (⚠️ ours: the part of the gain that covers injuries and byes).
 * A trade without the numbers a driver reads (no winChance: no odds; no depthCover: no scenarios) never holds it.
 * ⚠️ The drivers find a week's win chance by its exact NFL week, and TradeDetail.winChance lists a matchup that spans
 * several NFL weeks (an ESPN multi-week matchup period) only at its first week still to play (evaluate.ts, "The
 * simulation"), so a bye in a later week of such a matchup never counts: not as a bye the trade covers (byeCover), nor as
 * a week you're favored to win (incomingByes: that trade doesn't hold it), and that week is never the riskiest one. In a
 * points-only league winChance is empty (its games don't change the standings), so byeCover never holds there, and
 * incomingByes only when every bye of the players I'd get is done.
 *
 * The text: "Most of your best ideas trade <P>: <driver clauses>." (⚠️ "Half of your best ideas" when exactly half of the
 * list gives him, and "5 of your 12 best ideas" under half, which config.explain's defaults never reach, so the words stay
 * true), the clauses joined with ", and" (two) or "; … ; and" (three, since the bye clause has a comma of its own); no
 * driver: that first sentence alone ("Most of your best ideas trade <P>."). Then, when the list itself (PatternInputs.shown)
 * shows fewer of the trades that give him than that count (the given-player cap: at most config.ranking.
 * perGivenPlayerInTop20 in its top 20), how many it shows: "The list shows 3 ideas that trade him, to make room for other
 * ideas." (final review of Phase 4c, finding R7: on Parker's league, Oct 4 09:24Z, "Most of your best ideas trade Garrett
 * Wilson" sat above a list where 3 of 14 cards did, and nothing said why). Player names only, never a team's.
 */
import { config } from "./config";
import type { Pos } from "./model";
import type { PatternNote, TradeAsset, TradeEvaluationCore } from "./tradeModel";

export type PatternDriver = PatternNote["drivers"][number];

/** The order drivers are named in (the file header), at most PatternConfig.driversMax of them. */
const DRIVER_ORDER: readonly PatternDriver[] = ["byeCover", "incomingByes", "slotGain", "injuryCover"];

/** "Weeks you're favored to win": a baseline win chance at least this (a definition, not a tunable). */
const FAVORED = 0.5;

/** Float noise in comparisons (not a tunable). */
const EPS = 1e-9;

/** The config.explain numbers the note reads, widened so tests can pass others. */
export interface PatternConfig {
  /** A note needs at least this many of the first `patternTop` trades to give the same player of mine. */
  readonly patternMinCount: number;
  readonly patternTop: number;
  /** A driver is named when it holds in at least this share of his trades in that list (patternDriverShare: half). */
  readonly driverShare: number;
  /** At most this many drivers are named (patternDriversMax). */
  readonly driversMax: number;
  /** byeCover: the trade raises my win chance in his bye week by at least this (a fraction: 0.03 = 3 points). */
  readonly weeklyLineMin: number;
  /** slotGain: a slot instance's gain counts from this many projected points a week. */
  readonly slotChangeMin: number;
  /** injuryCover: TradeDetail.depthCover at least this many points a week. */
  readonly depthCoverMin: number;
}

/** The note's numbers from config (§15). */
export function patternConfig(): PatternConfig {
  const e = config.explain;
  return {
    patternMinCount: e.patternMinCount,
    patternTop: e.patternTop,
    driverShare: e.patternDriverShare,
    driversMax: e.patternDriversMax,
    weeklyLineMin: e.weeklyLineMin,
    slotChangeMin: e.slotChangeMin,
    depthCoverMin: e.patternDepthCoverMin,
  };
}

/** What the note reads (search.ts fills it from the trade context). */
export interface PatternInputs {
  /** The ranking without the given-player cap (the file header), Overall order. */
  readonly ranked: readonly Pick<TradeEvaluationCore, "proposal" | "detail">[];
  /** A player's name and position (the words), null when unknown. */
  readonly player: (id: string) => { name: string; pos: Pos } | null;
  /** A player's NFL bye week this season, null when unknown (no NFL team, or no schedule). */
  readonly byeWeek: (id: string) => number | null;
  /** The first NFL week a trade can change (the week after one in progress, else the current week): a bye before it is done. */
  readonly firstWeek: number;
  /** A slot instance's words by its key (TradeDetail.mySlots keys: "RB2" → "RB2", "TE1" → "TE"). */
  readonly slotLabel: (key: string) => string;
  /** My must-include players (every trade gives them): never named (the file header). Absent: none. */
  readonly forced?: readonly string[];
  /**
   * The list itself (search.ts: the final ranking, the given-player cap applied), when known: the note then says how many of
   * his trades it shows when that's fewer than its count (the file header, "The text"). Absent: not said.
   */
  readonly shown?: readonly Pick<TradeEvaluationCore, "proposal">[];
}

const playerIds = (xs: readonly TradeAsset[]): string[] => [...new Set(xs.flatMap((a) => (a.kind === "player" ? [a.id] : [])))];

type Trade = PatternInputs["ranked"][number];
type WinChance = NonNullable<Trade["detail"]["winChance"]>[number];

const isNumber = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

/** A trade's win-chance entry for NFL week `week` (a game's first week), if it has one. */
function chanceAt(t: Trade, week: number): WinChance | undefined {
  return t.detail.winChance?.find((c) => c.week === week);
}

/** byeCover for one trade: his bye week b can still change and the trade raises my win chance there by at least weeklyLineMin. */
function coversBye(t: Trade, bye: number | null, x: PatternInputs, cfg: PatternConfig): boolean {
  if (bye === null || bye < x.firstWeek) return false;
  const c = chanceAt(t, bye);
  return !!c && isNumber(c.before) && isNumber(c.after) && c.after - c.before >= cfg.weeklyLineMin - EPS;
}

/** incomingByes for one trade: null when it doesn't hold, else whether some received bye is done and some is ahead. */
function incomingByes(t: Trade, x: PatternInputs): { done: boolean; ahead: boolean } | null {
  const got = playerIds(t.proposal.get);
  if (!got.length) return null;
  let done = false;
  let ahead = false;
  for (const id of got) {
    const bye = x.byeWeek(id);
    if (bye === null) return null;
    if (bye < x.firstWeek) {
      done = true;
      continue;
    }
    const c = chanceAt(t, bye);
    if (!c || !isNumber(c.before) || c.before < FAVORED - EPS) return null;
    ahead = true;
  }
  return { done, ahead };
}

/** slotGain for one trade: the key of my largest slot-instance gain when it reaches slotChangeMin, else null (ties: mySlots order). */
function bestSlot(t: Trade, cfg: PatternConfig): string | null {
  let best: { key: string; gain: number } | null = null;
  for (const s of t.detail.mySlots) {
    const gain = s.after - s.before;
    if (!isNumber(gain)) continue;
    if (!best || gain > best.gain + EPS) best = { key: s.key, gain };
  }
  return best && best.gain >= cfg.slotChangeMin - EPS ? best.key : null;
}

/** Whether week `week` is my lowest baseline win chance among the counted weeks: "only" (alone), "tied", or null. */
function riskiest(t: Trade, week: number, firstWeek: number): "only" | "tied" | null {
  const counted = (t.detail.winChance ?? []).filter((c) => c.week >= firstWeek && isNumber(c.before));
  const mine = counted.find((c) => c.week === week);
  if (!mine || !isNumber(mine.before)) return null;
  const low = Math.min(...counted.map((c) => c.before as number));
  if (mine.before > low + EPS) return null;
  return counted.some((c) => c.week !== week && (c.before as number) <= low + EPS) ? "tied" : "only";
}

/**
 * The player of mine most of the list gives (the file header), with his count; null below patternMinCount. `forced`
 * (my must-include players) are never counted.
 */
function mostGiven(top: readonly Trade[], minCount: number, forced: ReadonlySet<string>): { id: string; count: number } | null {
  const count = new Map<string, number>();
  const firstAt = new Map<string, number>();
  top.forEach((t, i) => {
    for (const id of playerIds(t.proposal.give)) {
      if (forced.has(id)) continue;
      count.set(id, (count.get(id) ?? 0) + 1);
      if (!firstAt.has(id)) firstAt.set(id, i);
    }
  });
  let best: { id: string; count: number } | null = null;
  for (const [id, n] of count) {
    if (!best || n > best.count || (n === best.count && ((firstAt.get(id) as number) < (firstAt.get(best.id) as number) || (firstAt.get(id) === firstAt.get(best.id) && id < best.id)))) best = { id, count: n };
  }
  return best && best.count >= Math.max(1, minCount) ? best : null;
}

/** Clauses joined: "A", "A, and B", "A; B; and C" (the file header). */
function joinClauses(xs: readonly string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  if (xs.length === 2) return `${xs[0]}, and ${xs[1]}`;
  return `${xs.slice(0, -1).join("; ")}; and ${xs.at(-1)}`;
}

/**
 * The pattern note (the file header), or null when fewer than patternMinCount of the first patternTop trades give the same
 * player of mine.
 */
export function patternNote(x: PatternInputs, cfg: PatternConfig = patternConfig()): PatternNote | null {
  const top = x.ranked.slice(0, Math.max(0, Math.floor(cfg.patternTop)));
  const found = mostGiven(top, cfg.patternMinCount, new Set(x.forced ?? []));
  if (!found) return null;
  const { id, count } = found;
  const of = top.length;
  const theirs = top.filter((t) => playerIds(t.proposal.give).includes(id));
  // A driver holding in n of his trades is named from driverShare of them on (float noise counts as at it).
  const enough = (n: number) => n > 0 && n >= cfg.driverShare * theirs.length - EPS;
  const info = x.player(id);
  const name = info?.name ?? "this player";
  const his = info?.pos === "DEF" ? "its" : "his";

  const bye = x.byeWeek(id);
  const covering = theirs.filter((t) => coversBye(t, bye, x, cfg));
  const incoming = theirs.flatMap((t) => incomingByes(t, x) ?? []);
  const slots = new Map<string, number>();
  for (const t of theirs) {
    const key = bestSlot(t, cfg);
    if (key !== null) slots.set(key, (slots.get(key) ?? 0) + 1);
  }
  // The slot most of them share (ties: mySlots order, as the first trade lists the instances).
  const order = (theirs[0]?.detail.mySlots ?? []).map((s) => s.key);
  const topSlot = [...slots].sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))[0] ?? null;
  const covered = theirs.filter((t) => isNumber(t.detail.depthCover) && (t.detail.depthCover as number) >= cfg.depthCoverMin - EPS);

  const holds: Record<PatternDriver, boolean> = {
    byeCover: enough(covering.length),
    incomingByes: enough(incoming.length),
    slotGain: topSlot !== null && enough(topSlot[1]),
    injuryCover: enough(covered.length),
  };
  const drivers = DRIVER_ORDER.filter((d) => holds[d]).slice(0, Math.max(0, Math.floor(cfg.driversMax)));

  const clauses = drivers.map((d): string => {
    switch (d) {
      case "byeCover": {
        const r = riskiest(covering[0] as Trade, bye as number, x.firstWeek);
        return `${his} bye is in week ${bye}${r === "only" ? ", your riskiest week" : r === "tied" ? ", one of your riskiest weeks" : ""}`;
      }
      case "incomingByes": {
        const anyDone = incoming.some((c) => c.done);
        const anyAhead = incoming.some((c) => c.ahead);
        if (anyDone && !anyAhead) return "the players you'd get have had their byes";
        if (anyDone) return "the players you'd get have byes that are done or in weeks you're favored to win";
        return "the players you'd get have byes in weeks you're favored to win";
      }
      case "slotGain":
        return `the biggest gain is usually at your ${x.slotLabel((topSlot as [string, number])[0])} spot`;
      case "injuryCover":
        return "part of the gain is depth that covers injuries and byes";
    }
  });
  const lead = 2 * count > of ? `Most of your best ideas trade ${name}` : 2 * count === of ? `Half of your best ideas trade ${name}` : `${count} of your ${of} best ideas trade ${name}`;
  const first = clauses.length ? `${lead}: ${joinClauses(clauses)}.` : `${lead}.`;
  // How many of them the list shows, when the given-player cap shows fewer (the file header, "The text").
  const shown = x.shown ? x.shown.filter((t) => playerIds(t.proposal.give).includes(id)).length : null;
  const him = info?.pos === "DEF" ? "it" : "him";
  const cap = shown === null || shown >= count ? "" : shown === 0 ? " The list shows none of them, to make room for other ideas." : ` The list shows ${shown === 1 ? "1 idea that trades" : `${shown} ideas that trade`} ${him}, to make room for other ideas.`;
  return { playerId: id, count, of, drivers, text: `${first}${cap}` };
}
