/**
 * Plain-English reasons and the copy-ready pitch message (CLAUDE.md §13; lead decisions L11 and M10 of the Phase 4
 * designs): templates only, no AI. Pure and deterministic: no I/O, no clock. Every name comes from the
 * ExplainContext (the app passes the league's names, the report placeholders such as "Team 3"); the evaluation
 * carries ids and numbers only. When a fact is worth a sentence comes from config.explain; the model's own thresholds
 * the words quote (activity windows, the hot multiple, context cut-offs, the veto factor) from config.acceptance.
 *
 * Words: no jargon ("EV", "σ", "V*", "g_mkt" never appear). Numbers as the League page prints them (src/lib/
 * format.ts, copied here because the engine doesn't import src/lib): points per week with at most one decimal and no
 * trailing zero ("9.1", "14"; "1 projected point"), a real minus sign, whole percents. Slot names are the League
 * model's slot-instance labels ("RB2", "FLEX", "D/ST"; a slot with one spot without its number: "TE").
 *
 * Reasons, most important first, in four groups (⚠️ the grouping and the order within each group are ours):
 * 1. Why it helps me: my biggest slot gain ("Your RB2 spot goes from 9.1 to 14.3 projected points per week"; else my
 *    whole lineup's weekly gain, else my playoff-week gain; the whole-lineup line says "In the regular season …" when
 *    a playoff-week line is shown too); in dynasty and keeper leagues leaning to the future (λ ≥ futureFirstLambda)
 *    my roster's long-term value gain next ("Raises your roster's long-term value.": the model's ΔDyn over my roster's
 *    long-term value, said when it is at least longTermMin either way; in words only since the planner's reply to
 *    Checkpoint 7a, 5.4: those values are FantasyCalc's dynasty values); the change in my odds ("Raises your playoff odds by 4 and your title
 *    odds by 1.8 percentage points": as the card's odds line prints them, its printed after minus its printed before, the
 *    playoffs in whole points and the title in tenths, when ExplainContext.baseline gives the card's "before"; else the
 *    change with one decimal; a change that prints as 0 is left out, as are title odds when unknown); my risky weeks it covers ("Covers your risky week 13: +6.2 projected points that
 *    week": a week the League page flags risky, TradeDetail.riskyWeeks, whose starting points rise at least
 *    riskyWeekGain; ⚠️ the detail doesn't say whether byes or a tough matchup made it risky, so the words don't
 *    either); a playoff-week gain well above the regular season's; otherwise the long-term gain. A redraft trade with
 *    B > 0 that none of these explain gets its B from the market term: "Mostly a trade-value win: you get more trade
 *    value than you give." It needs the market term itself (B − B_win) to be positive and at least B_win, so that it is
 *    most of B (end-of-Phase-4 review: a B that comes from odds changes too small to print isn't credited to trade
 *    value), and g_mkt(me) ≥ valueEven (the model's package, which the term reads). Nothing at all → "Barely changes
 *    your starting lineup." A trade with B ≤ 0 (the Analyzer shows them) starts with "Doesn't help you overall, …".
 * 2. Why they might say yes or no (at most partnerReasons, the ones that moved the acceptance estimate most first:
 *    |the feature's term in logit units|, TradeDetail.terms; each needs at least termMin, except the value line and the
 *    star premium line, and the star premium line always has a place among them, below):
 *    - the lineup: a hole this fills (the filled hole they rank worst at), else their biggest slot gain, else their
 *      lineup's weekly change (ΔLineup_P), up or down. A hole is judged over the next holeWeeks weeks while the rank
 *      is rest-of-season (TradeDetail.partnerSlots), so the rank is quoted only in the bottom part of the league
 *      (rank > teams × holeRankFromBottom: "They're 9th of 10 at TE, and this gives them a starter"); otherwise it's a
 *      short-term hole (an injury or a bye: "Their TE spot is weak over the next 3 weeks, and this gives them a
 *      starter there"), and an unknown rank reads the same way;
 *    - trade value, from their side, in words only (the "No value numbers" paragraph below), as the model reads it: its
 *      package g_mkt(P) (every player at max(v, W), the roster-spot credit and the neutral throw-ins, market.ts: what the
 *      value term of the chance they accept reads): "They come out ahead on trade value, which makes a yes more likely."
 *      when g_mkt(P) ≥ valueEven ("They come out ahead on trade value." alone when a star premium leaves them under
 *      valueEven in their own eyes: below), "They give up more trade value than they get, so expect pushback." when
 *      g_mkt(P) ≤ −valueEven, else "The two sides are about even on trade value." ⚠️ Nothing is said about trade value
 *      when there's none behind the trade: the context has no FantasyCalc lookup, or none of the trade's players has a
 *      FantasyCalc value and the model's g_mkt(P) is exactly 0 (no values loaded at all, when every g is 0: the search's
 *      own note says the chance they accept treats every trade as even then; or a kicker for a D/ST at the same flat
 *      minimum). Said also when the card's "Market check" flag is on (the lead's decision after the Trade Finder review:
 *      the flag carries the check, from my side, and the reasons don't repeat it; that they get more is a real reason
 *      they'd accept);
 *    - the star premium (planner addendum to Checkpoint 3, §1; lead decision N7), whenever a player they'd give has
 *      e > 0 (TradeDetail.premium; facts for players not in the trade, or with an unreadable e, are ignored): the
 *      planner's "Their best player (or a top-12 player): expect them to want a little extra.", with his name and
 *      which part applies by config.acceptance.starPremium — the rank part ("their best player", "their second-best
 *      player": his rank by market value on their roster) and the elite part ("a top-12 player by trade value"), or
 *      both: "Justin Jefferson is their best player and a top-12 player by trade value, so expect them to want a
 *      little extra." Several players: "They'd give up A (their best player) and B (a top-12 player by trade
 *      value), so …", larger e first, then the better rank, then the trade's order. ⚠️ An e > 0 that neither part
 *      explains (inconsistent data) reads "one of their most valuable players". The planner's ending is said when,
 *      counting the premium, they no longer clearly come out ahead on trade value: their perceived g (the g the model
 *      used, read from terms.value; AcceptanceFeatures.g carries the premium) under valueEven, the value line's own
 *      "even" band. ⚠️ When they still do (perceived g ≥ valueEven), asking for more would be an overpay the model
 *      doesn't need, so the line says the premium is counted and they still come out ahead: "Zay Flowers is their
 *      second-best player, but even if they rate him a bit above his trade value, they'd still come out ahead."
 *      (addendum review: "a little extra" there contradicted the value line and suggested sweetening an offer the
 *      model already favors); with an unreadable perceived g, the planner's ending.
 *      Like the value line it is a candidate whatever its weight, and its weight is what the premium moved the
 *      estimate: the value term at their perceived g (terms.value) minus the term at the market g without the premium
 *      (gPartner, every player at max(v, W), clamped as the model clamps it). With a premium the value line weighs that
 *      market term alone (⚠️ its words are the
 *      market's, so it no longer takes the premium's weight as well); without one, |terms.value| as before. It always
 *      has a place among the partnerReasons lines (N7: "whenever"): when that many lines moved the estimate more, it
 *      takes the place of the lowest-weight one of them other than the value line (⚠️ ours: the two read together; the
 *      value line's only when it is the one line kept), so a card still shows at most partnerReasons partner lines,
 *      in weight order. When the premium leaves them under valueEven in their eyes while the market says they get
 *      more, the value line drops "which makes a yes more likely" (⚠️ to them it's about even, and the premium line
 *      says they'll want a little extra): "They come out ahead on trade value." The pitch never mentions the premium
 *      (it would invite a counter);
 *    - activity ("Active trader: 3 trades this season"; "Quiet lately: no moves in 5 weeks"), their trade history
 *      on value (⚠️ Phase 4c: without its percent, "They tend to win their trades on value this season, so they may want
 *      more.": the average is the model's package g on past trades, floored at W, a figure the card no longer prints),
 *      the season context (checked out, rebuilding with older players coming in, a contender), hot players coming or
 *      going, the deadline being near.
 *    On equal weights they keep this order: the lineup, trade value, the star premium, activity, history, context,
 *    hot players, the deadline.
 * 3. Caveats: injured players I'd get ("Depends on an injured player: …"), my biggest slot loss, my risky weeks it
 *    weakens, a playoff-week loss, lower odds, a long-term value loss ("Lowers your roster's long-term value."), the veto
 *    risk ("Your league reviews trades, and counting roster spots, this one is uneven enough to risk a veto, so the
 *    chance it goes through is halved.": ⚠️ the veto rule reads the model's package g_mkt(P), so the line says whose
 *    count it is, as the Market check flag does: review of track UIC). The card shows the risk flags apart (§13); the
 *    market check is left to its flag, and nothing here says a trade is hidden (the search never shows hidden trades).
 * 4. Notes: long-term values missing in a dynasty or keeper league (benefit.benefitNotes' words: Checkpoint 2, "the
 *    card says so"). TradeDetail.notes aren't repeated: the search lists them once for every card, and the Analyzer
 *    shows them with its result.
 * An illegal trade's reasons are its illegal reason alone, and it has no pitch.
 *
 * No value numbers (planner reply to Checkpoint 7a, 5.4; reports/fantasycalc-permission.md, condition 4: Offer Sheet
 * doesn't display FantasyCalc's values at all): no trade-value number, percent or multiple, and no comparison by
 * FantasyCalc's values, in the reasons or the pitch. Where a reason needs trade value it says it in plain words, as the
 * model reads it (the value line above, "Mostly a trade-value win", the long-term lines): those words explain our own
 * numbers (the chance they accept, Helps you), whose figures stay internal. Phases 4c to 7a quoted FantasyCalc's own plain
 * sums here ("By FantasyCalc's trade values, they get 18% more than they give"; planner reply to Checkpoint 4b, change
 * 3). ExplainContext.fantasyCalcValue now only says whether a trade has any FantasyCalc value behind it.
 *
 * The pitch leads with what the partner gains (the same lineup facts as group 2: the hole it fills, "over the next 3
 * weeks" when it's a short-term one by the rank rule above; their slot or lineup gain), at most two such sentences, then
 * names the trade from their side. It never mentions trade value (the paragraph above: until Phase 7b it quoted the
 * trade value they'd gain on FantasyCalc's own values, between 5% and 25%). ("Would you trade
 * Bijan Robinson for Travis Kelce and Bo Nix?") and closes. A slot fact names the player who'd play there when exactly
 * one player sent can play the slot (his position among the slot's: the instance's `eligible` list when the context
 * gives one, else read from the slot's name: a position, "D/ST", "RB/WR/TE"-style lists and the flex names; ⚠️
 * SlotInstance carries no eligible list, so an unknown slot name names nobody); else "This would …". For a filled
 * hole, a lone player sent is named unless his position rules him out (⚠️ holeFeature guarantees a received starter
 * who can play the slot, not which one). It never says what the user gains, and it
 * greets without a name ("Hey!": team names can be long or crude, and the message goes to the manager).
 *
 * "Offer first / if they say no" (TradeEvaluation.steps; planner addendum to Checkpoint 3, §4; lead decision N7): the
 * pitch is the opening offer, so it names the offer-first version — its proposal, and its own detail and g for the
 * partner-side facts above — and never the throw-in held back for "if they say no" (nor that there is one). When the
 * offer first is the ranked trade itself (same assets), the ranked trade's own facts are used. ⚠️ A TradeStep carries
 * no ΔLineup_P, so the offer-first version's is read back from its need term (§11: terms.need = β_need × n, n =
 * clamp(ΔLineup_P / nScale, nClamp), β_need by the league's type: acceptance.betaNeed, 1.2 in redraft and keeper
 * leagues and 0.6 in dynasty ones since the planner's reply to Checkpoint 4, change 2): exact inside the clamp, the
 * clamp's value (±10 a week) at it, where a slot fact leads anyway. A step that doesn't fit the trade (another partner,
 * no assets on either side) is ignored. The reasons stay the ranked trade's: they explain the card's numbers.
 *
 * Injury tags (injuryTags; planner reply to Checkpoint 4, change 6): every injury-tagged player on either side, mine
 * first, then the ones I'd get, for TradeEvaluation.flags.tagged (evaluate.ts withWords fills it for every finished
 * evaluation, the Trade Finder's and the Analyzer's; the cards word it: src/lib/tradeView.ts), with his return week when
 * the platform gave one and his projection counts on it
 * (review of track F): OUT from next week on, IR, PUP and SUSPENDED after this week, and a Probable, Questionable or
 * Doubtful player's far ESPN date only when his projection follows it (§6 step 3's conflict: tagContextOf reads it from
 * the League model; a caller without it keeps no such date). Since Checkpoint 7e (planner reply to Checkpoint 7d, item 3.5;
 * review of wave C, RC-ENG-1) one of my players with a return week of the user's has that week in his tag, whatever his
 * status, marked as the user's: his numbers follow it (tagContextOf reads the weeks the engine follows from the settings).
 *
 * Robust to missing data: a null B or odds, empty detail lists, NaN numbers, unknown players ("Unknown player (id)")
 * and slot keys the context doesn't list (the key itself), premium facts and steps that don't fit the trade all
 * produce shorter text, never "NaN" or a throw.
 */
import { betaNeed, type AcceptanceTerms } from "./acceptance";
import { farReturnWeek } from "./availability";
import { benefitNotes } from "./benefit";
import { config } from "./config";
import type { PlayerModel, SlotInstance } from "./leagueModel";
import { POSITIONS, type InjuryStatus, type LeagueSettings, type PlayerInfo, type Pos } from "./model";
import { userReturnWeeks, type ReturnWeekSettings, type ReturnWeekSnapshot } from "./returnWeeks";
import type { InjuryTag, SlotChange, TradeAsset, TradeDetail, TradeEvaluationCore, TradeProposal } from "./tradeModel";

/** What the words need besides the evaluation: names (the app's real ones, or the report's placeholders) and the league's facts. */
export interface ExplainContext {
  /** A team's name as the reader should see it ("Team 3" in reports). */
  teamName: (teamId: string) => string;
  /**
   * A player's name, position and NFL team (null when unknown). `injury` (optional; PlayerInfo has it, so passing
   * snapshot.players[id] works) names an injured player's status in the caveat.
   */
  player: (playerId: string) => { name: string; pos: Pos; nflTeam: string | null; injury?: InjuryStatus } | null;
  /**
   * The league's slot instances (LeagueModel.slots), for slot labels. An instance may carry the positions its slot
   * takes (`eligible`, SlotDef.eligible); without it they are read from the slot's name.
   */
  slots: readonly (SlotInstance & { eligible?: readonly Pos[] })[];
  leagueType: LeagueSettings["leagueType"];
  tradeDeadline: LeagueSettings["tradeDeadline"];
  /**
   * A player's FantasyCalc value in the league's format (the perception list), null when FantasyCalc has none (an
   * estimate or a flat minimum). Never quoted (the file header, "No value numbers"): it only says whether the trade has any
   * FantasyCalc value behind it (the value line, group 2); without it, nothing is said about trade value.
   */
  fantasyCalcValue?: (playerId: string) => number | null;
  /**
   * My odds before any trade on the final block of seasons, the "before" the card's odds line prints (the search's baseline,
   * TradeSearchResult.baseline; the Analyzer's): the odds line then quotes the change the card shows, after printed minus
   * before printed (oddsLine; final review of Phase 4c, findings R9 and PAGES-2). Absent or null fields: the change itself.
   * Checkpoint 7e (item 2.1): a trade with either-way moves starts from its own (TradeEvaluation.before), which it reads first.
   */
  baseline?: { pPlayoffs: number | null; pTitle: number | null } | null;
}

/** The config.explain keys this module reads, widened so tests can pass other numbers. */
export interface ExplainConfig {
  readonly slotChangeMin: number;
  readonly lineupChangeMin: number;
  readonly playoffGainMin: number;
  readonly riskyWeekGain: number;
  readonly valueEven: number;
  readonly termMin: number;
  readonly partnerReasons: number;
  readonly longTermMin: number;
  readonly futureFirstLambda: number;
  readonly holeRankFromBottom: number;
}

/** Float noise in threshold comparisons (not a tunable). */
const EPS = 1e-9;

const isFiniteNumber = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
const finiteOr0 = (x: number | null | undefined): number => (isFiniteNumber(x) ? x : 0);

// ---------------------------------------------------------------------------------------------
// Number and list words (src/lib/format.ts's rules)

const MINUS = "−";

/** At most `maxDecimals` decimals, no trailing decimal zeros, a real minus sign ("9.1", "14", "−2.5"). */
function fmtNum(n: number, maxDecimals = 1): string {
  if (!Number.isFinite(n)) return "0";
  const factor = 10 ** maxDecimals;
  const rounded = Math.round(Math.abs(n) * factor) / factor;
  const text = rounded
    .toFixed(maxDecimals)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
  return n < 0 && rounded !== 0 ? `${MINUS}${text}` : text;
}

/** Signed: "+6.2", "−3", "0". */
function fmtSigned(n: number, maxDecimals = 1): string {
  const text = fmtNum(n, maxDecimals);
  return n > 0 && text !== "0" ? `+${text}` : text;
}

/** A share as a whole percent: 0.084 → "8%" (config thresholds only: never a trade value, the file header). */
const pct = (x: number): string => `${Math.round(Math.abs(x) * 100)}%`;

/** "A", "A and B", "A, B and C" (the League page's lists). */
function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const ORDINAL_SUFFIX = ["th", "st", "nd", "rd"];
/** 1 → "1st", 3 → "3rd", 11 → "11th". */
function ordinal(n: number): string {
  const v = n % 100;
  return `${n}${v >= 11 && v <= 13 ? "th" : (ORDINAL_SUFFIX[n % 10] ?? "th")}`;
}

/** "9.1 projected points", "1 projected point", "+6.2 projected points" (`signed` for changes). */
function projected(n: number, signed = false): string {
  const text = signed ? fmtSigned(n) : fmtNum(n);
  return `${text} projected ${text === "1" || text === "+1" || text === `${MINUS}1` ? "point" : "points"}`;
}

/** "1 trade" / "3 trades". */
const plural = (n: number, singular: string): string => `${n} ${n === 1 ? singular : `${singular}s`}`;

/** "3 weeks" / "week" (as in "over the next 3 weeks" / "over the next week"). */
const nextWeeks = (n: number): string => (n === 1 ? "week" : `${n} weeks`);

const POS_SET: ReadonlySet<string> = new Set(POSITIONS);

/** Positions a lineup slot takes, by the platform's slot names (Sleeper, ESPN, MFL, Fleaflicker) that aren't a position or a "/" list. */
const SLOT_NAME_POSITIONS: Readonly<Record<string, readonly Pos[]>> = {
  "D/ST": ["DEF"],
  DST: ["DEF"],
  FLEX: ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  OP: ["QB", "RB", "WR", "TE"],
  REC_FLEX: ["WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  IDP_FLEX: ["DL", "LB", "DB"],
  DP: ["DL", "LB", "DB"],
  TQB: ["QB"],
  DT: ["DL"],
  DE: ["DL"],
  CB: ["DB"],
  S: ["DB"],
};

/** The positions a slot name takes: a position ("TE"), a known flex name, or a "/" list of positions ("RB/WR/TE"); null when unknown. */
function slotNamePositions(name: string): Pos[] | null {
  if (POS_SET.has(name)) return [name as Pos];
  const known = SLOT_NAME_POSITIONS[name];
  if (known) return [...known];
  const parts = name.split("/");
  return parts.length > 1 && parts.every((p) => POS_SET.has(p)) ? (parts as Pos[]) : null;
}

// ---------------------------------------------------------------------------------------------
// Names

/** The words for a status in the injured caveat. */
const INJURY_WORDS: Readonly<Record<InjuryStatus, string>> = {
  ACTIVE: "injured",
  PROBABLE: "probable",
  QUESTIONABLE: "questionable",
  DOUBTFUL: "doubtful",
  OUT: "out",
  IR: "on injured reserve",
  PUP: "on the PUP list (physically unable to perform)",
  SUSPENDED: "suspended",
  NA: "not an active NFL player",
};

class Names {
  private readonly labels: Map<string, SlotInstance & { eligible?: readonly Pos[] }>;

  constructor(
    private readonly ctx: ExplainContext,
    private readonly partnerId: string,
    private readonly myTeamId: string,
  ) {
    this.labels = new Map(ctx.slots.map((s) => [s.key, s]));
  }

  slot(key: string): string {
    return this.labels.get(key)?.label ?? key;
  }

  /** The positions slot instance `key` takes: its `eligible` list when the context gives one, else read from its slot name; null when unknown. */
  slotPositions(key: string): Pos[] | null {
    const inst = this.labels.get(key);
    if (!inst) return null;
    if (Array.isArray(inst.eligible) && inst.eligible.length > 0) return [...inst.eligible];
    return slotNamePositions(inst.slot);
  }

  playerInfo(id: string): ReturnType<ExplainContext["player"]> {
    try {
      return this.ctx.player(id);
    } catch {
      return null;
    }
  }

  player(id: string): string {
    const name = this.playerInfo(id)?.name?.trim();
    return name ? name : `Unknown player (${id})`;
  }

  team(id: string): string {
    let name: string | undefined;
    try {
      name = this.ctx.teamName(id)?.trim();
    } catch {
      name = undefined;
    }
    return name ? name : `Team ${id}`;
  }

  /** An asset in the pitch, from the partner's side: a player's name; a pick as "your / my / Team 3's 2027 1st-round pick". */
  asset(a: TradeAsset): string {
    if (a.kind === "player") return this.player(a.id);
    const owner = a.originalTeamId === this.partnerId ? "your" : a.originalTeamId === this.myTeamId ? "my" : `${this.team(a.originalTeamId)}'s`;
    return `${owner} ${a.season} ${ordinal(a.round)}-round pick`;
  }
}

// ---------------------------------------------------------------------------------------------
// Slot facts

const changeOf = (s: SlotChange): number => s.after - s.before;
const knownSlot = (s: SlotChange): boolean => isFiniteNumber(s.before) && isFiniteNumber(s.after);

/** The slot with the biggest gain (first in the list on ties), or null. */
function biggestGain<T extends SlotChange>(slots: readonly T[]): T | null {
  let best: T | null = null;
  for (const s of slots) if (knownSlot(s) && (best === null || changeOf(s) > changeOf(best))) best = s;
  return best;
}

/** The slot with the biggest loss (first in the list on ties), or null. */
function biggestLoss<T extends SlotChange>(slots: readonly T[]): T | null {
  let worst: T | null = null;
  for (const s of slots) if (knownSlot(s) && (worst === null || changeOf(s) < changeOf(worst))) worst = s;
  return worst;
}

/** "from 9.1 to 14.3 projected points per week" (or "a week" in the pitch). */
const fromTo = (s: SlotChange, per: "per week" | "a week" = "per week"): string => `from ${fmtNum(s.before)} to ${projected(s.after)} ${per}`;

/** The partner's lineup fact both the reasons and the pitch lead with. */
type PartnerLineup =
  | { kind: "hole"; key: string; rank: number | null; teams: number }
  | { kind: "slot"; slot: SlotChange }
  | { kind: "gain"; points: number }
  | { kind: "loss"; points: number }
  | null;

/** One version of the trade's partner-side lineup facts: the ranked trade's (the reasons), or the offer-first version's (the pitch). */
interface PartnerFacts {
  detail: Pick<TradeDetail, "holesFilled" | "partnerSlots" | "teams">;
  /** ΔLineup_P (NaN when unknown: says nothing). */
  partnerDeltaLineup: number;
}

function partnerLineup(e: PartnerFacts, cfg: ExplainConfig): PartnerLineup {
  const d = e.detail;
  const filled = (d.holesFilled ?? []).filter((k) => typeof k === "string");
  if (filled.length > 0) {
    // The filled hole they rank worst at (an unknown rank last), then the bigger gain, then the hole's order.
    let pick: { key: string; rank: number | null; gain: number } | null = null;
    for (const key of filled) {
      const s = (d.partnerSlots ?? []).find((x) => x.key === key);
      const rank = s && isFiniteNumber(s.rank) ? s.rank : null;
      const gain = s && knownSlot(s) ? changeOf(s) : 0;
      const better = pick === null || (rank ?? -1) > (pick.rank ?? -1) || ((rank ?? -1) === (pick.rank ?? -1) && gain > pick.gain + EPS);
      if (better) pick = { key, rank, gain };
    }
    if (pick) return { kind: "hole", key: pick.key, rank: pick.rank, teams: finiteOr0(d.teams) };
  }
  const delta = finiteOr0(e.partnerDeltaLineup);
  if (delta >= cfg.lineupChangeMin - EPS) {
    const best = biggestGain(d.partnerSlots ?? []);
    if (best && changeOf(best) >= cfg.slotChangeMin - EPS) return { kind: "slot", slot: best };
    return { kind: "gain", points: delta };
  }
  if (delta <= -cfg.lineupChangeMin + EPS) return { kind: "loss", points: -delta };
  return null;
}

// ---------------------------------------------------------------------------------------------
// Reasons

interface PartnerLine {
  text: string;
  /** |term| in logit units: how much it moved the estimate. */
  weight: number;
  /** The value line and the star premium line: candidates whatever their weight; the premium line always has a place (the file header). */
  role?: "value" | "premium";
}

function myLineupLines(e: TradeEvaluationCore, names: Names, cfg: ExplainConfig): { main: string | null; playoffs: string | null; playoffsLoss: string | null; slotLoss: string | null } {
  const slots = e.detail.mySlots ?? [];
  const dPPW = finiteOr0(e.dPPW);
  const dPlayoffs = finiteOr0(e.dPPWPlayoffs);
  const gain = biggestGain(slots);
  const loss = biggestLoss(slots);
  // The whole-lineup lines (my ΔPPW: the regular season) say so when a playoff-week line is shown too.
  let main: string | null = null;
  let mainIsLineup = false;
  if (gain && changeOf(gain) >= cfg.slotChangeMin - EPS) main = `Your ${names.slot(gain.key)} spot goes ${fromTo(gain)}.`;
  else if (dPPW >= cfg.lineupChangeMin - EPS) mainIsLineup = true;
  // The playoff weeks get a line of their own when they gain well above the regular season (or lead when nothing else does).
  const playoffsText = `In the playoffs your starting lineup gains ${projected(dPlayoffs)} per week.`;
  let playoffs: string | null = null;
  if (main === null && !mainIsLineup && dPlayoffs >= cfg.playoffGainMin - EPS) main = playoffsText;
  else if (dPlayoffs >= cfg.playoffGainMin - EPS && dPlayoffs - Math.max(0, dPPW) >= cfg.playoffGainMin - EPS) playoffs = playoffsText;
  const playoffsLoss = dPlayoffs <= -cfg.playoffGainMin + EPS && dPlayoffs - Math.min(0, dPPW) <= -cfg.playoffGainMin + EPS ? `In the playoffs your starting lineup loses ${projected(-dPlayoffs)} per week.` : null;
  const lineupWords = playoffs !== null || playoffsLoss !== null ? "In the regular season your starting lineup" : "Your starting lineup";
  if (mainIsLineup) main = `${lineupWords} gains ${projected(dPPW)} per week.`;
  let slotLoss: string | null = null;
  if (loss && changeOf(loss) <= -cfg.slotChangeMin + EPS) slotLoss = `Your ${names.slot(loss.key)} spot drops ${fromTo(loss)}.`;
  else if (dPPW <= -cfg.lineupChangeMin + EPS) slotLoss = `${lineupWords} loses ${projected(-dPPW)} per week.`;
  return { main, playoffs, playoffsLoss, slotLoss };
}

/**
 * My odds as the card's odds line prints them, as a number of percentage points (src/lib/tradeView.ts oddsViews: the title
 * with one decimal, toFixed as titleOddsText, the playoffs whole, Math.round as percentText; the value kept within 0–100%).
 */
const printedOdds = (p: number, decimals: 0 | 1): number => {
  const x = Math.min(1, Math.max(0, p)) * 100;
  return decimals === 1 ? Number(x.toFixed(1)) : Math.round(x);
};

/**
 * The odds line, in percentage points as the card prints them: { up } for a gain (any part up), { down } when every part
 * shown fell; null when no part shows (unknown, or rounds to 0). ⚠️ With my odds before the trade (ExplainContext.baseline,
 * for an evaluation on the final block: the card's own "before"), each part is the card's own change, its printed after
 * minus its printed before (the title in tenths, the playoffs in whole points), so the two never disagree (final review of
 * Phase 4c, findings R9 and PAGES-2: "Title odds 10.5% → 12.5%" sat beside "your title odds by 1.9 percentage points",
 * 10.546% → 12.484%, and "Playoff odds 60% → 60%" beside "Raises your playoff odds by 0.4"); without it, the change itself
 * with one decimal, as the card prints it then ("+1.9 percentage points").
 */
function oddsLine(e: TradeEvaluationCore, baseline?: ExplainContext["baseline"]): { up: string } | { down: string } | null {
  const parts: { what: string; up: boolean; text: string }[] = [];
  const add = (what: string, x: number | null, before: number | null | undefined, decimals: 0 | 1) => {
    if (!isFiniteNumber(x)) return;
    let change = x * 100;
    if (e.stage === "final" && isFiniteNumber(before)) change = Math.round((printedOdds(before + x, decimals) - printedOdds(before, decimals)) * 10) / 10;
    const text = fmtNum(Math.abs(change), 1);
    if (text !== "0") parts.push({ what, up: change > 0, text });
  };
  add("playoff", e.dPO, baseline?.pPlayoffs, 0);
  add("title", e.dCH, baseline?.pTitle, 1);
  const unit = (text: string) => (text === "1" ? "percentage point" : "percentage points");
  const [a, b] = parts;
  if (!a) return null;
  if (!b) return a.up ? { up: `Raises your ${a.what} odds by ${a.text} ${unit(a.text)}.` } : { down: `Lowers your ${a.what} odds by ${a.text} ${unit(a.text)}.` };
  if (a.up && b.up) return { up: `Raises your playoff odds by ${a.text} and your title odds by ${b.text} ${unit(b.text)}.` };
  if (!a.up && !b.up) return { down: `Lowers your playoff odds by ${a.text} and your title odds by ${b.text} ${unit(b.text)}.` };
  const up = a.up ? a : b;
  const down = a.up ? b : a;
  return { up: `Raises your ${up.what} odds by ${up.text} ${unit(up.text)} but lowers your ${down.what} odds by ${down.text}.` };
}

/** My risky weeks the trade covers (gain ≥ riskyWeekGain) and weakens (loss ≥ it). */
function riskyWeekLines(e: TradeEvaluationCore, cfg: ExplainConfig): { covered: string | null; hurt: string | null } {
  const risky = new Set((e.detail.riskyWeeks ?? []).filter(isFiniteNumber));
  const weeks = (e.detail.weekly ?? []).filter((w) => risky.has(w.week) && isFiniteNumber(w.before) && isFiniteNumber(w.after)).sort((x, y) => x.week - y.week);
  const covered = weeks.filter((w) => w.after - w.before >= cfg.riskyWeekGain - EPS);
  const hurt = weeks.filter((w) => w.after - w.before <= -cfg.riskyWeekGain + EPS);
  const line = (verb: string, list: typeof weeks): string | null => {
    if (list.length === 0) return null;
    const [only] = list;
    if (list.length === 1 && only) return `${verb} your risky week ${only.week}: ${projected(only.after - only.before, true)} that week.`;
    const changes = listText(list.map((w) => fmtSigned(w.after - w.before)));
    return `${verb} your risky weeks ${listText(list.map((w) => String(w.week)))}: ${changes} projected points those weeks.`;
  };
  return { covered: line("Covers", covered), hurt: line("Weakens", hurt) };
}

/**
 * Dynasty and keeper: which way my roster's long-term value moves (B_future / bFutureScale = ΔDyn / MyDynTotal), 1 up or −1
 * down, when the change is at least longTermMin and rounds to a whole percent other than 0 (the number itself is never
 * said: the file header, "No value numbers"); null when unknown or too small.
 */
function longTermDirection(e: TradeEvaluationCore, ctx: ExplainContext, cfg: ExplainConfig): 1 | -1 | null {
  if (ctx.leagueType === "redraft" || !isFiniteNumber(e.bFuture) || !(config.benefit.bFutureScale > 0)) return null;
  const share = e.bFuture / config.benefit.bFutureScale;
  if (!(Math.abs(share) >= cfg.longTermMin - EPS) || Math.round(share * 100) === 0) return null;
  return share > 0 ? 1 : -1;
}

/** The partner's rank at a filled hole, when it's quoted: in the bottom part of the league (rank > teams × holeRankFromBottom); else null (a short-term hole). */
function quotedRank(fact: Extract<PartnerLineup, { kind: "hole" }>, cfg: ExplainConfig): number | null {
  const { rank, teams } = fact;
  return rank !== null && rank >= 1 && teams > 0 && rank > teams * cfg.holeRankFromBottom + EPS ? rank : null;
}

/** "the next 3 weeks": the window holes are judged over (config.acceptance.holeWeeks). */
const holeWindow = (): string => `the next ${nextWeeks(Math.max(1, Math.floor(config.acceptance.holeWeeks)))}`;

function partnerLineupLine(fact: PartnerLineup, names: Names, cfg: ExplainConfig): string | null {
  if (!fact) return null;
  switch (fact.kind) {
    case "hole": {
      const label = names.slot(fact.key);
      const rank = quotedRank(fact, cfg);
      if (rank !== null) return `They're ${ordinal(rank)} of ${fact.teams} at ${label}, and this gives them a starter.`;
      return `Their ${label} spot is weak over ${holeWindow()}, and this gives them a starter there.`;
    }
    case "slot":
      return `Their ${names.slot(fact.slot.key)} spot goes ${fromTo(fact.slot)}.`;
    case "gain":
      return `It adds ${projected(fact.points)} per week to their starting lineup.`;
    case "loss":
      return `It costs their starting lineup ${projected(fact.points)} per week, a harder sell.`;
  }
}

// ---------------------------------------------------------------------------------------------
// Trade value (the file header, group 2 and "No value numbers")

/**
 * A version of the trade by FantasyCalc's own values, from the partner's side: `theyGet` is the plain sum of the
 * FantasyCalc values of what I give, `theyGive` of what I get (no floor at W, no roster-spot credit, no star premium, no
 * neutral throw-ins). "missing": the assets FantasyCalc has no value for (a pick, a player it doesn't value, a value that
 * isn't a positive finite number, a lookup that throws), in the trade's order, mine first; "none": the context has no
 * values at all. Never shown (the file header, "No value numbers"): the value line reads whether any asset has a value
 * (hasFantasyCalcValue), and src/lib/tradeView.ts's Market check whether the roster spot is what trips it.
 */
export type FantasyCalcComparison =
  | { kind: "none" }
  | { kind: "missing"; assets: TradeAsset[] }
  | { kind: "known"; theyGet: number; theyGive: number };

export function fantasyCalcComparison(proposal: { readonly give: readonly TradeAsset[]; readonly get: readonly TradeAsset[] }, ctx: Pick<ExplainContext, "fantasyCalcValue">): FantasyCalcComparison {
  const valueOf = ctx.fantasyCalcValue;
  if (!valueOf) return { kind: "none" };
  const missing: TradeAsset[] = [];
  const sum = (assets: readonly TradeAsset[] | undefined): number => {
    let total = 0;
    for (const a of assets ?? []) {
      let v: number | null = null;
      if (a?.kind === "player") {
        try {
          v = valueOf(a.id);
        } catch {
          v = null;
        }
      }
      if (isFiniteNumber(v) && v > 0) total += v;
      else missing.push(a);
    }
    return total;
  };
  const theyGet = sum(proposal.give);
  const theyGive = sum(proposal.get);
  return missing.length > 0 ? { kind: "missing", assets: missing } : { kind: "known", theyGet, theyGive };
}

type KnownComparison = Extract<FantasyCalcComparison, { kind: "known" }>;

/** What the partner gains by FantasyCalc's values: they get / they give − 1 (+Infinity when they'd give nothing of value; 0 when neither side has any). */
export function partnerFantasyCalcGain(c: KnownComparison): number {
  if (c.theyGive > 0) return c.theyGet / c.theyGive - 1;
  return c.theyGet > 0 ? Number.POSITIVE_INFINITY : 0;
}

/** What I gain by FantasyCalc's values: what I get / what I give − 1 (the same sums the other way round). */
export function myFantasyCalcGain(c: KnownComparison): number {
  return partnerFantasyCalcGain({ kind: "known", theyGet: c.theyGive, theyGive: c.theyGet });
}

/** Whether any asset of the trade has a FantasyCalc value (fantasyCalcComparison: all of them, or some but not all). */
function hasFantasyCalcValue(fc: FantasyCalcComparison, assets: number): boolean {
  return fc.kind === "known" || (fc.kind === "missing" && fc.assets.length < assets);
}

/** The value line's words (the file header, group 2): in words only, never a number. */
export const VALUE_AHEAD = "They come out ahead on trade value";
export const VALUE_BEHIND = "They give up more trade value than they get, so expect pushback.";
export const VALUE_EVEN = "The two sides are about even on trade value.";

/**
 * The value line (the file header, group 2): the model's g_mkt(P) (`g`) in words, "which makes a yes more likely" after
 * "They come out ahead on trade value" unless a star premium leaves them under valueEven in their own eyes
 * (`premiumTurned`). Null when `g` isn't a number.
 */
function valueLine(g: number, cfg: ExplainConfig, premiumTurned: boolean): string | null {
  if (Number.isNaN(g)) return null;
  if (g >= cfg.valueEven - EPS) return `${VALUE_AHEAD}${premiumTurned ? "" : ", which makes a yes more likely"}.`;
  if (g <= -cfg.valueEven + EPS) return VALUE_BEHIND;
  return VALUE_EVEN;
}

/** §11's value term β_gain·g⁺ + β_loss·g⁻ at a g_mkt(P), clamped to gClamp as the model clamps it (NaN counts 0). */
function valueTermAt(g: number): number {
  const { beta, gClamp } = config.acceptance;
  const x = Math.min(gClamp[1], Math.max(gClamp[0], Number.isNaN(g) ? 0 : g));
  return beta.gain * Math.max(x, 0) + beta.loss * Math.min(x, 0);
}

/** A player's rank by market value on his team, in words: "best", "second-best", …, "fifth-best", then "6th-best". */
const RANK_WORDS: readonly string[] = ["best", "second-best", "third-best", "fourth-best", "fifth-best"];
const bestWord = (rank: number): string => RANK_WORDS[rank - 1] ?? `${ordinal(rank)}-best`;

/** A player the partner would give whose star premium applies (e > 0), with the words for the parts that apply. */
interface PremiumPlayer {
  id: string;
  e: number;
  rank: number | null;
  /** "their best player", "a top-12 player by trade value", both joined by "and", or the fallback (the file header). */
  what: string;
  /** His place among the players I'd get (the trade's order). */
  order: number;
}

/**
 * The players the partner would give with a star premium (the file header): TradeDetail.premium's facts with e > 0
 * for players I'd get, once each (the first readable fact), larger e first, then the better rank, then the trade's order.
 */
function premiumPlayers(e: TradeEvaluationCore): PremiumPlayer[] {
  const facts = e.detail.premium;
  if (!Array.isArray(facts) || facts.length === 0) return [];
  const order = new Map<string, number>();
  for (const a of e.proposal.get) if (a.kind === "player" && !order.has(a.id)) order.set(a.id, order.size);
  const sp = config.acceptance.starPremium;
  const found = new Map<string, PremiumPlayer>();
  for (const f of facts) {
    if (!f || typeof f.playerId !== "string" || found.has(f.playerId)) continue;
    const at = order.get(f.playerId);
    if (at === undefined || !isFiniteNumber(f.e) || f.e <= EPS) continue;
    const rank = Number.isInteger(f.rank) && f.rank >= 1 ? f.rank : null;
    const parts: string[] = [];
    if (rank !== null && (sp.rank[rank - 1] ?? 0) > 0) parts.push(`their ${bestWord(rank)} player`);
    if (f.elite === true && sp.elite > 0) parts.push(`a top-${sp.eliteTop} player by trade value`);
    found.set(f.playerId, { id: f.playerId, e: f.e, rank, what: parts.length > 0 ? parts.join(" and ") : "one of their most valuable players", order: at });
  }
  const last = Number.MAX_SAFE_INTEGER;
  return [...found.values()].sort((a, b) => (Math.abs(b.e - a.e) > EPS ? b.e - a.e : 0) || (a.rank ?? last) - (b.rank ?? last) || a.order - b.order);
}

/**
 * The star premium line (the file header), or null when no player they'd give has one. `stillAhead`: counting the
 * premium, they still come out ahead (their perceived g at least valueEven), so the line doesn't say they'll want more.
 */
function premiumLine(players: readonly PremiumPlayer[], names: Names, stillAhead: boolean): string | null {
  const [only] = players;
  if (!only) return null;
  const one = players.length === 1;
  const tail = stillAhead ? `but even if they rate ${one ? "him" : "them"} a bit above ${one ? "his" : "their"} trade value, they'd still come out ahead.` : "so expect them to want a little extra.";
  if (one) return `${names.player(only.id)} is ${only.what}, ${tail}`;
  return `They'd give up ${listText(players.map((p) => `${names.player(p.id)} (${p.what})`))}, ${tail}`;
}

function activityLine(e: TradeEvaluationCore): string | null {
  const act = e.detail.activity;
  if (!act) return null;
  const rules = config.acceptance.activity;
  switch (act.rule) {
    case "active":
      if (finiteOr0(act.trades) >= rules.tradesForActive) return `Active trader: ${plural(act.trades, "trade")} this season.`;
      return `Active trader: ${finiteOr0(act.recentTrades) <= 1 ? "a trade" : `${act.recentTrades} trades`} in the last ${rules.recentTradeWeeks} weeks.`;
    case "inactive":
      return finiteOr0(act.transactions) === 0 ? "Quiet: no moves this season." : `Quiet lately: no moves in ${rules.inactiveWeeks} weeks.`;
    case "quiet":
      return `Quiet lately: no moves in ${rules.quietWeeks} weeks.`;
    default:
      return null;
  }
}

/**
 * Their trade history on value (the file header): ⚠️ without its percent since Phase 4c (the average is the model's
 * package g on their past trades, every player floored at W: a figure the card doesn't print).
 */
function historyLine(e: TradeEvaluationCore): string | null {
  const avg = e.detail.history?.average;
  if (avg === null || avg === undefined || Number.isNaN(avg) || avg === 0) return null;
  if (avg > 0) return "They tend to win their trades on value this season, so they may want more.";
  return Number.isFinite(avg) ? "They've given up value in their trades this season, so they may be open to this." : null;
}

function contextLine(e: TradeEvaluationCore, ctx: ExplainContext): string | null {
  const c = e.detail.context;
  if (!c) return null;
  const rules = config.acceptance.context;
  if (c.checkedOut) return `They're all but out of the playoff race (under ${pct(rules.checkedOutBelow)} to make it), so they may have checked out.`;
  if (finiteOr0(c.agingPlayers) > 0 && ctx.leagueType === "dynasty") {
    const n = c.agingPlayers;
    return `They're rebuilding, and ${n === 1 ? "one of the players they'd get is" : `${n} of the players they'd get are`} ${rules.oldPlayerAge} or older.`;
  }
  if (c.contender) {
    const n = finiteOr0(e.features?.n);
    if (n > 0) return `They're contending (over ${pct(rules.contenderAbove)} to make the playoffs), so lineup help counts extra.`;
    if (n < 0) return `They're contending (over ${pct(rules.contenderAbove)} to make the playoffs), so losing lineup points counts extra.`;
  }
  return null;
}

function hotLine(e: TradeEvaluationCore, names: Names): string | null {
  const term = finiteOr0(e.detail.terms?.hot);
  const hot = config.acceptance.hot;
  const ids = term > 0 ? (e.detail.hotReceived ?? []) : term < 0 ? (e.detail.hotGiven ?? []) : [];
  if (ids.length === 0) return null;
  const one = ids.length === 1;
  const who = listText(ids.map((id) => names.player(id)));
  const form = `${one ? "has" : "have"} scored at least ${fmtNum(hot.multiple, 2)} times ${one ? "his" : "their"} projection in each of the last ${hot.weeks} weeks`;
  return term > 0 ? `They'd get ${who}, who ${form}.` : `They'd give up ${who}, who ${form}, so they may want to keep ${one ? "him" : "them"}.`;
}

function urgencyLine(e: TradeEvaluationCore, ctx: ExplainContext): string | null {
  if (!(finiteOr0(e.detail.urgency) > 0)) return null;
  const deadline = ctx.tradeDeadline;
  if (deadline?.date !== undefined && Number.isFinite(Date.parse(deadline.date))) return `The trade deadline is within ${config.acceptance.urgency.days} days, so managers are more ready to deal.`;
  if (deadline && isFiniteNumber(deadline.week)) return `The trade deadline is close (week ${deadline.week}), so managers are more ready to deal.`;
  return "The trade deadline is close, so managers are more ready to deal.";
}

function injuredLine(e: TradeEvaluationCore, names: Names): string | null {
  const ids = [...new Set(e.flags.injured ?? [])];
  if (ids.length === 0) return null;
  const status = (id: string): string | null => {
    const s = names.playerInfo(id)?.injury;
    return s !== undefined && s in INJURY_WORDS ? INJURY_WORDS[s] : null;
  };
  if (ids.length === 1) {
    const id = ids[0] as string;
    return `Depends on an injured player: ${names.player(id)} is ${status(id) ?? "injured"}, and the numbers assume he returns as expected.`;
  }
  const list = listText(ids.map((id) => {
    const s = status(id);
    return s ? `${names.player(id)} (${s})` : names.player(id);
  }));
  return `Depends on injured players: ${list}, and the numbers assume they return as expected.`;
}

/**
 * The veto caveat (the file header, group 3). ⚠️ "Counting roster spots" (review of track UIC, finding 1): the veto rule
 * reads the model's package g_mkt(P) (every player at max(v, W), the roster-spot credit, the neutral throw-ins), which can
 * be far from even where FantasyCalc's plain sums read even (two players of mine worth less than W for one of theirs worth
 * their sum), so the caveat says whose count it is, as the Market check flag does.
 */
function vetoLine(e: TradeEvaluationCore): string | null {
  if (!e.detail.vetoRisk) return null;
  const factor = config.acceptance.veto.factor;
  const cut = factor === 0.5 ? "is halved" : `is cut to ${pct(factor)} of the estimate`;
  return `Your league reviews trades, and counting roster spots, this one is uneven enough to risk a veto, so the chance it goes through ${cut}.`;
}

/** The reasons (§13), in the file header's order. */
function reasons(e: TradeEvaluationCore, ctx: ExplainContext, names: Names, cfg: ExplainConfig): string[] {
  const forMe: string[] = [];
  const caveats: string[] = [];
  const notes: string[] = [];

  const lineup = myLineupLines(e, names, cfg);
  // From the trade's own "before" when it has either-way moves (Checkpoint 7e, item 2.1: TradeEvaluation.before), the "before"
  // its card's odds line prints; else the search's baseline.
  const odds = oddsLine(e, e.before ?? ctx.baseline);
  const risky = riskyWeekLines(e, cfg);
  // The model's ΔDyn over my roster's long-term value, in words only (the file header, "No value numbers").
  const longTerm = longTermDirection(e, ctx, cfg);
  const futureFirst = isFiniteNumber(e.lambda) && e.lambda >= cfg.futureFirstLambda - EPS;
  const longTermGain = longTerm === 1 ? "Raises your roster's long-term value." : null;

  if (isFiniteNumber(e.b) && e.b <= 0) forMe.push("Doesn't help you overall, so the Trade Finder leaves trades like this out.");
  if (lineup.main) forMe.push(lineup.main);
  if (longTermGain && futureFirst) forMe.push(longTermGain);
  if (odds && "up" in odds) forMe.push(odds.up);
  if (risky.covered) forMe.push(risky.covered);
  if (lineup.playoffs) forMe.push(lineup.playoffs);
  if (longTermGain && !futureFirst) forMe.push(longTermGain);
  // Nothing above explains a redraft B > 0: it comes from the market term (§10's term on g_mkt(me), the model's package)
  // when that term, B − B_win, is positive and most of B. In words only (the file header, "No value numbers").
  const bWin = e.bWin;
  const marketTerm = isFiniteNumber(e.b) && isFiniteNumber(bWin) ? e.b - bWin : Number.NaN;
  const fromMarket = isFiniteNumber(bWin) && marketTerm > EPS && marketTerm >= bWin - EPS;
  if (forMe.length === 0 && ctx.leagueType === "redraft" && isFiniteNumber(e.b) && e.b > 0 && fromMarket && e.gMine >= cfg.valueEven - EPS) {
    forMe.push("Mostly a trade-value win: you get more trade value than you give.");
  }
  if (forMe.length === 0 && !lineup.slotLoss && !lineup.playoffsLoss) forMe.push("Barely changes your starting lineup.");

  // Their side, by how much each moved the estimate.
  const terms = e.detail.terms;
  const t = (x: number | undefined): number => Math.abs(finiteOr0(x));
  const lineupFact = partnerLineup(e, cfg);
  const line = (text: string | null, weight: number, role?: PartnerLine["role"]): PartnerLine | null => (text ? { text, weight, ...(role ? { role } : {}) } : null);
  // With a star premium, the value term (at their perceived g) splits: the market reading's part (no premium) weighs the
  // value line, the rest (what the premium moved) the premium line. Without one, the value line weighs the whole term.
  const premium = premiumPlayers(e);
  const rawValue = valueTermAt(e.gPartner);
  const perceived = terms?.value;
  const valueWeight = premium.length > 0 ? Math.abs(rawValue) : t(perceived);
  const premiumWeight = isFiniteNumber(perceived) ? Math.abs(perceived - rawValue) : 0;
  // Counting the premium, do they still clearly come out ahead? Their perceived g ≥ valueEven, read on the value term
  // (monotone in g, so the comparison holds term for term). An unreadable term: no (the planner's words).
  const aheadInTheirEyes = premium.length > 0 && isFiniteNumber(perceived) && perceived >= valueTermAt(cfg.valueEven) - EPS;
  const premiumTurned = premium.length > 0 && isFiniteNumber(perceived) && !aheadInTheirEyes;
  // The value line, from the model's g_mkt(P) (the file header, group 2): nothing when no trade value is behind the trade
  // (no lookup; or no FantasyCalc value for any of its players and a g of exactly 0, as when no values loaded at all).
  const g = e.gPartner;
  const assets = e.proposal.give.length + e.proposal.get.length;
  const valued = ctx.fantasyCalcValue !== undefined && (hasFantasyCalcValue(fantasyCalcComparison(e.proposal, ctx), assets) || g !== 0);
  // In this order on equal weights.
  const candidates = [
    line(partnerLineupLine(lineupFact, names, cfg), Math.abs(finiteOr0(terms?.need) + (lineupFact?.kind === "hole" ? finiteOr0(terms?.hole) : 0))),
    line(valued ? valueLine(g, cfg, premiumTurned) : null, valueWeight, "value"),
    line(premiumLine(premium, names, aheadInTheirEyes), premiumWeight, "premium"),
    line(activityLine(e), t(terms?.activity)),
    line(historyLine(e), t(terms?.history)),
    line(contextLine(e, ctx), t(terms?.context)),
    line(hotLine(e, names), t(terms?.hot)),
    line(urgencyLine(e, ctx), Math.max(t(terms?.urgency), t(e.detail.urgency))),
  ];
  const ranked = candidates
    .map((c, order) => (c ? { ...c, order } : null))
    .filter((c): c is PartnerLine & { order: number } => c !== null && (c.role !== undefined || c.weight >= cfg.termMin - EPS))
    .sort((a, b) => b.weight - a.weight || a.order - b.order);
  const cap = Math.max(0, Math.floor(cfg.partnerReasons));
  const kept = ranked.slice(0, cap);
  // The star premium line always has a place (N7): left out by weight, it takes the place of the lowest-weight line
  // kept other than the value line (the value line's when that's the only one kept: there is one value line, so one
  // step back past it is enough), then the lines go back in weight order (it weighs no more than any of them: last).
  const leftOutPremium = ranked.find((c, i) => i >= cap && c.role === "premium");
  if (cap > 0 && leftOutPremium) {
    let out = kept.length - 1;
    if (out > 0 && kept[out]?.role === "value") out--;
    kept.splice(out, 1, leftOutPremium);
    kept.sort((a, b) => b.weight - a.weight || a.order - b.order);
  }
  const partner = kept.map((c) => c.text);

  for (const line of [
    injuredLine(e, names),
    lineup.slotLoss,
    risky.hurt,
    lineup.playoffsLoss,
    odds && "down" in odds ? odds.down : null,
    longTerm === -1 ? "Lowers your roster's long-term value." : null,
    vetoLine(e),
  ]) {
    if (line) caveats.push(line);
  }

  if (e.dynMissing && ctx.leagueType !== "redraft") notes.push(...benefitNotes({ titleMissing: false, dynMissing: true }));

  return [...forMe, ...partner, ...caveats, ...notes];
}

// ---------------------------------------------------------------------------------------------
// The pitch

/** What the pitch reads: one version of the trade (the file header: the offer-first version when steps exist). */
interface PitchSource extends PartnerFacts {
  proposal: TradeProposal;
}

/** A side's assets as a key that ignores their order. */
const assetsKey = (assets: readonly TradeAsset[]): string =>
  assets
    .map((a) => (a.kind === "player" ? `player:${a.id}` : `pick:${a.season}:${a.round}:${a.originalTeamId}`))
    .sort()
    .join("|");

/** An asset the pitch can name: a player with an id, or a pick with its season, round and original team. */
const isAsset = (a: unknown): a is TradeAsset => {
  if (typeof a !== "object" || a === null) return false;
  const x = a as { kind?: unknown; id?: unknown; season?: unknown; round?: unknown; originalTeamId?: unknown };
  if (x.kind === "player") return typeof x.id === "string";
  return x.kind === "pick" && Number.isInteger(x.season) && Number.isInteger(x.round) && typeof x.originalTeamId === "string";
};

/**
 * ΔLineup_P read back from a version's need term (the file header: terms.need = β_need × n, n = clamp(ΔLineup_P /
 * nScale, nClamp), β_need by the league's type: acceptance.betaNeed); NaN (says nothing) when it can't be read.
 */
export function deltaLineupFromTerms(terms: Partial<AcceptanceTerms> | undefined, leagueType: LeagueSettings["leagueType"]): number {
  const need = terms?.need;
  const beta = betaNeed(leagueType);
  const scale: number = config.acceptance.nScale;
  return isFiniteNumber(need) && isFiniteNumber(beta) && beta !== 0 && isFiniteNumber(scale) ? (need / beta) * scale : Number.NaN;
}

/**
 * The version of the trade the pitch names (the file header): the offer-first step when the trade has steps that fit
 * it (the same partner, assets on a side, every asset readable), with its own detail and ΔLineup_P (read back with the
 * league type's β_need); the ranked trade itself when there are none, or when the offer first is the ranked trade
 * (the same assets).
 */
function pitchSource(e: TradeEvaluationCore, leagueType: LeagueSettings["leagueType"]): PitchSource {
  const step = e.steps?.offerFirst;
  const p = step?.proposal;
  if (!step || !p || p.partnerId !== e.proposal.partnerId || !Array.isArray(p.give) || !Array.isArray(p.get)) return e;
  if (p.give.length + p.get.length === 0 || !p.give.every(isAsset) || !p.get.every(isAsset)) return e;
  if (assetsKey(p.give) === assetsKey(e.proposal.give) && assetsKey(p.get) === assetsKey(e.proposal.get)) return e;
  const detail = step.detail;
  return {
    proposal: p,
    detail: detail ?? { holesFilled: [], partnerSlots: [], teams: 0 },
    partnerDeltaLineup: deltaLineupFromTerms(detail?.terms, leagueType),
  };
}

/**
 * The one player the trade sends who'd play slot instance `key` (the file header): exactly one player sent who can
 * play it (his position among the slot's positions). For a filled hole (`hole`), a lone player sent is named unless
 * the slot's positions and his are both known and rule him out.
 */
function starterFor(proposal: TradeProposal, names: Names, key: string, hole: boolean): string | null {
  const players = proposal.give.filter((a): a is Extract<TradeAsset, { kind: "player" }> => a.kind === "player");
  const positions = names.slotPositions(key);
  const fits = (id: string): boolean | null => {
    const pos = names.playerInfo(id)?.pos;
    return positions === null || pos === undefined ? null : positions.includes(pos);
  };
  if (players.length === 1) {
    const id = (players[0] as { id: string }).id;
    const fit = fits(id);
    return fit === true || (hole && fit === null) ? names.player(id) : null;
  }
  const able = players.filter((p) => fits(p.id) === true);
  return able.length === 1 ? names.player((able[0] as { id: string }).id) : null;
}

/**
 * The pitch for one version of the trade (pitchSource: the offer-first version when steps exist): never a word about trade
 * value (the file header, "No value numbers").
 */
function pitch(src: PitchSource, names: Names, cfg: ExplainConfig): string {
  const leads: string[] = [];
  const fact = partnerLineup(src, cfg);
  if (fact?.kind === "hole") {
    const who = starterFor(src.proposal, names, fact.key, true);
    const where = `${names.slot(fact.key)}${quotedRank(fact, cfg) === null ? ` over ${holeWindow()}` : ""}`;
    leads.push(who ? `Looks like you could use help at ${where}, and ${who} would start for you there.` : `Looks like you could use help at ${where}, and this would give you a starter there.`);
  } else if (fact?.kind === "slot") {
    const who = starterFor(src.proposal, names, fact.slot.key, false);
    leads.push(`${who ?? "This"} would upgrade your ${names.slot(fact.slot.key)} spot ${fromTo(fact.slot, "a week")}.`);
  } else if (fact?.kind === "gain") {
    leads.push(`This adds about ${projected(fact.points)} a week to your starting lineup.`);
  }

  const give = src.proposal.give.map((a) => names.asset(a));
  const get = src.proposal.get.map((a) => names.asset(a));
  let ask: string;
  if (give.length > 0 && get.length > 0) ask = `Would you trade ${listText(get)} for ${listText(give)}?`;
  else if (get.length > 0) ask = `Would you send me ${listText(get)}?`;
  else if (give.length > 0) ask = `Would you take ${listText(give)}, with nothing needed back?`;
  else ask = "";
  return ["Hey!", ...leads.slice(0, 2), ask, "Let me know what you think!"].filter((s) => s.length > 0).join(" ");
}

// ---------------------------------------------------------------------------------------------

/** The reasons (most important first) and the pitch for one evaluated trade (the file header). `cfg` defaults to config.explain. */
export function explainTrade(evaluation: TradeEvaluationCore, ctx: ExplainContext, cfg: ExplainConfig = config.explain): { reasons: string[]; pitch: string } {
  if (evaluation.illegal !== null && evaluation.illegal !== undefined) return { reasons: [evaluation.illegal], pitch: "" };
  const names = new Names(ctx, evaluation.proposal.partnerId, evaluation.detail?.myTeamId ?? "");
  return { reasons: reasons(evaluation, ctx, names, cfg), pitch: pitch(pitchSource(evaluation, ctx.leagueType), names, cfg) };
}

// ---------------------------------------------------------------------------------------------
// Injury tags (planner reply to Checkpoint 4, change 6)

/** What injuryTags reads of a player: his status and, when the platform gave one, his return week. */
export type TagSource = Readonly<Record<string, Pick<PlayerInfo, "injury" | "injuryReturnWeek"> | undefined>>;

/** What injuryTags knows besides the players (each optional; the file header and injuryTags). */
export interface TagContext {
  /** The NFL week now (snapshot.currentWeek): a return week the model ignores this early is left out. */
  currentWeek?: number | undefined;
  /**
   * Whether a Probable, Questionable or Doubtful player's projection follows his far ESPN return date (§6 step 3's
   * conflict, PlayerModel.availabilityNote.used "returnDate"); without it, no such player's date is kept.
   */
  followsReturnDate?: ((playerId: string) => boolean) | undefined;
  /**
   * The user's own return week for one of my injured players (Checkpoint 7e; planner reply to Checkpoint 7d, item 3.5:
   * "the new week works like a return week from the platform"; returnWeeks.ts userReturnWeeks, the weeks the engine follows),
   * which his tag says in place of the platform's whatever his status (review of wave C, RC-ENG-1: the card's numbers
   * followed it while its tag kept the platform's week, or lost it). Undefined: none.
   */
  userReturnWeek?: ((playerId: string) => number | undefined) | undefined;
}

/**
 * The tag context of a league (injuryTags; evaluate.ts withWords reads it for the trade search's and the Analyzer's
 * evaluations alike): the week now, and, from the League model, which conflicted Probable, Questionable or Doubtful players'
 * projections follow their ESPN return date (PlayerModel.availabilityNote.used "returnDate"; review of track F: Josh
 * Jacobs, out until ESPN's week 8 in his numbers, read just "Questionable"), and with `settings` the user's own return weeks
 * the engine follows (Checkpoint 7e: returnWeeks.ts userReturnWeeks). Structural, so TradeInternals fits.
 */
export function tagContextOf(x: {
  snapshot: ReturnWeekSnapshot;
  model: { players: Readonly<Record<string, Pick<PlayerModel, "availabilityNote"> | undefined>> };
  settings?: ReturnWeekSettings | undefined;
}): TagContext {
  const user = userReturnWeeks(x.snapshot, x.settings);
  return { currentWeek: x.snapshot.currentWeek, followsReturnDate: (id) => x.model.players[id]?.availabilityNote?.used === "returnDate", userReturnWeek: (id) => user.get(id) };
}

/**
 * Whether a tag keeps the player's return week R (injuryTags): the week his projection counts on, by §6 step 3's own
 * rules (availability.returnWeekDistribution). OUT: R from next week on (an earlier date gets the OUT table); IR, PUP and
 * SUSPENDED: R after this week (he misses this week; an earlier date is stale); PROBABLE, QUESTIONABLE and DOUBTFUL: only
 * when his projection follows the date (far enough out, availability.farReturnWeek's rule, config.projections.
 * returnConflictWeeks, and not stale: `follows`); NA: never (he never plays). Without a current week, OUT, IR, PUP and
 * SUSPENDED keep any R.
 */
function keepsReturnWeek(status: Exclude<InjuryStatus, "ACTIVE">, R: number, currentWeek: number | undefined, follows: boolean): boolean {
  const now = isFiniteNumber(currentWeek) ? currentWeek : null;
  switch (status) {
    case "OUT":
      return now === null || R >= now + 1;
    case "IR":
    case "PUP":
    case "SUSPENDED":
      return now === null || R > now;
    case "PROBABLE":
    case "QUESTIONABLE":
    case "DOUBTFUL":
      return follows && (now === null || farReturnWeek(R, now));
    case "NA":
      return false;
  }
  return false;
}

/**
 * Every injury-tagged player in a trade (TradeEvaluation.flags.tagged; the file header): each player whose status isn't
 * ACTIVE (PROBABLE, QUESTIONABLE, DOUBTFUL, OUT, IR, PUP, SUSPENDED, NA), mine first ("give"), then the ones I'd get
 * ("get"), each side in the trade's order, a player once. returnWeek = his PlayerInfo.injuryReturnWeek when it is a
 * whole number and his projection counts on it (keepsReturnWeek: `ctx` gives the current week and which conflicted
 * Probable, Questionable or Doubtful players follow their date; review of track F: Josh Jacobs, Questionable with ESPN's
 * week 8, read just "Questionable" while his numbers had him out until then, and an OUT date already past would have
 * read "expected back week 3" in week 4). A week after the NFL's last week is kept (not back this season, §4: the card
 * words it). The user's own week for one of my players (TagContext.userReturnWeek; Checkpoint 7e) is his returnWeek
 * whatever his status, marked returnSource "user". Picks, players the snapshot doesn't know and statuses it doesn't name
 * carry no tag. Pure: `players` is snapshot.players or any table like it.
 */
export function injuryTags(proposal: Pick<TradeProposal, "give" | "get">, players: TagSource, ctx: TagContext = {}): InjuryTag[] {
  const out: InjuryTag[] = [];
  const seen = new Set<string>();
  const side = (assets: readonly TradeAsset[] | undefined, which: InjuryTag["side"]) => {
    for (const a of assets ?? []) {
      if (a.kind !== "player" || seen.has(a.id)) continue;
      const info = players[a.id];
      const status = info?.injury;
      if (status === undefined || status === "ACTIVE" || !(status in INJURY_WORDS)) continue;
      seen.add(a.id);
      // The user's own week for one of mine (Checkpoint 7e: TagContext.userReturnWeek), followed whatever his status.
      const user = ctx.userReturnWeek?.(a.id);
      if (typeof user === "number" && Number.isInteger(user)) {
        out.push({ playerId: a.id, side: which, status, returnWeek: user, returnSource: "user" });
        continue;
      }
      const week = info?.injuryReturnWeek;
      const keep = typeof week === "number" && Number.isInteger(week) && keepsReturnWeek(status, week, ctx.currentWeek, ctx.followsReturnDate?.(a.id) === true);
      out.push({ playerId: a.id, side: which, status, ...(keep ? { returnWeek: week } : {}) });
    }
  };
  side(proposal.give, "give");
  side(proposal.get, "get");
  return out;
}
