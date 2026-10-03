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
 *    my roster's long-term value gain next; the change in my odds ("Raises your playoff odds by 4.2 and your title
 *    odds by 1.8 percentage points", one decimal as the card prints them; a change that rounds to 0.0 is left out, as
 *    are title odds when unknown); my risky weeks it covers ("Covers your risky week 13: +6.2 projected points that
 *    week": a week the League page flags risky, TradeDetail.riskyWeeks, whose starting points rise at least
 *    riskyWeekGain; ⚠️ the detail doesn't say whether byes or a tough matchup made it risky, so the words don't
 *    either); a playoff-week gain well above the regular season's; otherwise the long-term gain. A redraft trade with
 *    B > 0 that none of these explain gets its B from the market term: "Mostly a trade-value win: you get 30% more
 *    trade value than you give." It needs the market term itself (B − B_win) to be positive and at least B_win, so that
 *    it is most of B, and g_mkt(me) ≥ valueEven for the percent it quotes (the market's, as the card's values read).
 *    Since lead decision N10 the term reads my g with each player I give valued at max(v, W) (benefit.ts), so a gain at
 *    market can leave the term at or below 0 (I give a player worth less than the waiver credit): then the line would
 *    credit trade value for a B that comes from the odds alone, and it isn't said (end-of-Phase-4 review). Nothing at
 *    all → "Barely changes your starting lineup." A trade with B ≤ 0 (the Analyzer shows them) starts with "Doesn't
 *    help you overall, …".
 * 2. Why they might say yes or no (at most partnerReasons, the ones that moved the acceptance estimate most first:
 *    |the feature's term in logit units|, TradeDetail.terms; each needs at least termMin, except the value line and the
 *    star premium line, and the star premium line always has a place among them, below):
 *    - the lineup: a hole this fills (the filled hole they rank worst at), else their biggest slot gain, else their
 *      lineup's weekly change (ΔLineup_P), up or down. A hole is judged over the next holeWeeks weeks while the rank
 *      is rest-of-season (TradeDetail.partnerSlots), so the rank is quoted only in the bottom part of the league
 *      (rank > teams × holeRankFromBottom: "They're 9th of 10 at TE, and this gives them a starter"); otherwise it's a
 *      short-term hole (an injury or a bye: "Their TE spot is weak over the next 3 weeks, and this gives them a
 *      starter there"), and an unknown rank reads the same way;
 *    - trade value, from their side: "They give up 8% more trade value than they get, so expect pushback", "They get
 *      12% more …, which makes a yes more likely", or even within valueEven; a gap above valueMultipleAbove reads as
 *      a multiple ("They give up about 9.3 times as much trade value as they get"). The percents are exact readings
 *      of the package values: my PV_give is their PV_recv, so "they give up X% more than they get" is X = g_mkt(me) and
 *      "they get X% more than they give" is X = g_mkt(partner). Said also when the card's "Market check" flag is on
 *      (the lead's decision after the Trade Finder review: the flag carries the check, from my side, and the reasons
 *      don't repeat it; that they get more is a real reason they'd accept);
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
 *      model already favors). An unreadable perceived g gets the planner's ending.
 *      Like the value line it is a candidate whatever its weight, and its weight is what the premium moved the
 *      estimate: the value term at their perceived g (terms.value) minus the term at the raw market g (gPartner,
 *      clamped as the model clamps it). With a premium the value line weighs the raw term alone (⚠️ its words are the
 *      market's, so it no longer takes the premium's weight as well); without one, |terms.value| as before. It always
 *      has a place among the partnerReasons lines (N7: "whenever"): when that many lines moved the estimate more, it
 *      takes the place of the lowest-weight one of them other than the value line (⚠️ ours: the two read together; the
 *      value line's only when it is the one line kept), so a card still shows at most partnerReasons partner lines,
 *      in weight order. When the premium leaves them under valueEven in their eyes while the market says they get
 *      more, the value line drops "which makes a yes more likely" (⚠️ to them it's about even, and the premium line
 *      says they'll want a little extra): "They get 6% more trade value than they give." The pitch never mentions the
 *      premium (it would invite a counter);
 *    - activity ("Active trader: 3 trades this season"; "Quiet lately: no moves in 5 weeks"), their trade history
 *      on value, the season context (checked out, rebuilding with older players coming in, a contender), hot players
 *      coming or going, the deadline being near.
 *    On equal weights they keep this order: the lineup, trade value, the star premium, activity, history, context,
 *    hot players, the deadline.
 * 3. Caveats: injured players I'd get ("Depends on an injured player: …"), my biggest slot loss, my risky weeks it
 *    weakens, a playoff-week loss, lower odds, a long-term value loss, the veto risk (the league reviews trades and
 *    the chance it goes through is cut). The card shows the risk flags apart (§13); the market check is left to its
 *    flag, and nothing here says a trade is hidden (the search never shows hidden trades).
 * 4. Notes: long-term values missing in a dynasty or keeper league (benefit.benefitNotes' words: Checkpoint 2, "the
 *    card says so"). TradeDetail.notes aren't repeated: the search lists them once for every card, and the Analyzer
 *    shows them with its result.
 * An illegal trade's reasons are its illegal reason alone, and it has no pitch.
 *
 * The pitch leads with what the partner gains (the same lineup facts as group 2: the hole it fills, "over the next 3
 * weeks" when it's a short-term one by the rank rule above; their slot or lineup gain; then the trade value they
 * gain, "(FantasyCalc values)", only when it's modest, valueEven to pitchValueMax: a bigger gain tells a sharp manager
 * the offer is an overpay, and a loss is never mentioned), at most two such sentences, then names the trade from their side ("Would you trade
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
 * clamp(ΔLineup_P / nScale, nClamp)): exact inside the clamp, the clamp's value (±10 a week) at it, where a slot fact
 * leads anyway. A step that doesn't fit the trade (another partner, no assets on either side) is ignored. The reasons
 * stay the ranked trade's: they explain the card's numbers.
 *
 * Robust to missing data: a null B or odds, empty detail lists, NaN numbers, unknown players ("Unknown player (id)")
 * and slot keys the context doesn't list (the key itself), premium facts and steps that don't fit the trade all
 * produce shorter text, never "NaN" or a throw.
 */
import type { AcceptanceTerms } from "./acceptance";
import { benefitNotes } from "./benefit";
import { config } from "./config";
import type { SlotInstance } from "./leagueModel";
import { POSITIONS, type InjuryStatus, type LeagueSettings, type Pos } from "./model";
import type { SlotChange, TradeAsset, TradeDetail, TradeEvaluationCore, TradeProposal } from "./tradeModel";

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
  readonly valueMultipleAbove: number;
  readonly pitchValueMax: number;
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

/** A share as a whole percent: 0.084 → "8%". */
const pct = (x: number): string => `${Math.round(Math.abs(x) * 100)}%`;

/**
 * A value gap g (≥ 0: one side gets g more than the other) as words before "they give" / "they get": "28% more trade
 * value than", or above valueMultipleAbove a multiple of the smaller side, "about 9.3 times as much trade value as"
 * (1 + g, at most one decimal).
 */
function moreValue(g: number, cfg: ExplainConfig): string {
  return g > cfg.valueMultipleAbove + EPS ? `about ${fmtNum(1 + g)} times as much trade value as` : `${pct(g)} more trade value than`;
}

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
 * The odds line, in percentage points with one decimal as the card prints them: { up } for a gain (any part up),
 * { down } when every part shown fell; null when no part shows (unknown, or rounds to 0.0).
 */
function oddsLine(e: TradeEvaluationCore): { up: string } | { down: string } | null {
  const parts: { what: string; up: boolean; text: string }[] = [];
  const add = (what: string, x: number | null) => {
    if (!isFiniteNumber(x)) return;
    const text = fmtNum(Math.abs(x) * 100, 1);
    if (text !== "0") parts.push({ what, up: x > 0, text });
  };
  add("playoff", e.dPO);
  add("title", e.dCH);
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

/** Dynasty and keeper: my roster's long-term value change as a whole percent (B_future / bFutureScale = ΔDyn / MyDynTotal), null when unknown or too small. */
function longTermPercent(e: TradeEvaluationCore, ctx: ExplainContext, cfg: ExplainConfig): number | null {
  if (ctx.leagueType === "redraft" || !isFiniteNumber(e.bFuture) || !(config.benefit.bFutureScale > 0)) return null;
  const share = e.bFuture / config.benefit.bFutureScale;
  const whole = Math.round(share * 100);
  return Math.abs(share) >= cfg.longTermMin - EPS && whole !== 0 ? whole : null;
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

/** `premiumTurned`: counting a star premium, they no longer clearly come out ahead (under valueEven in their eyes), so the line doesn't say "they get more" makes a yes more likely (the file header). */
function valueLine(e: TradeEvaluationCore, cfg: ExplainConfig, premiumTurned = false): string | null {
  const g = e.gPartner;
  if (Number.isNaN(g)) return null;
  if (g >= cfg.valueEven - EPS) {
    if (premiumTurned) return Number.isFinite(g) ? `They get ${moreValue(g, cfg)} they give.` : "They get trade value without giving any up.";
    return Number.isFinite(g) ? `They get ${moreValue(g, cfg)} they give, which makes a yes more likely.` : "They get trade value without giving any up, which makes a yes more likely.";
  }
  if (g <= -cfg.valueEven + EPS) {
    // They give up X% more than they get: X = PV_give(P) / PV_recv(P) − 1 = g_mkt(me).
    return isFiniteNumber(e.gMine) ? `They give up ${moreValue(e.gMine, cfg)} they get, so expect pushback.` : "They'd give up trade value and get almost none back, so expect pushback.";
  }
  return "Even on trade value: each side gets about what it gives.";
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

function historyLine(e: TradeEvaluationCore): string | null {
  const avg = e.detail.history?.average;
  if (avg === null || avg === undefined || Number.isNaN(avg) || avg === 0) return null;
  if (avg > 0) return Number.isFinite(avg) ? `They tend to win their trades on value (${pct(avg)} on average this season), so they may want more.` : "They tend to win their trades on value, so they may want more.";
  return Number.isFinite(avg) ? `They've given up value in their trades this season (${pct(avg)} on average), so they may be open to this.` : null;
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

function vetoLine(e: TradeEvaluationCore): string | null {
  if (!e.detail.vetoRisk) return null;
  const factor = config.acceptance.veto.factor;
  const cut = factor === 0.5 ? "is halved" : `is cut to ${pct(factor)} of the estimate`;
  return `Your league reviews trades, and one this uneven risks a veto, so the chance it goes through ${cut}.`;
}

/** The reasons (§13), in the file header's order. */
function reasons(e: TradeEvaluationCore, ctx: ExplainContext, names: Names, cfg: ExplainConfig): string[] {
  const forMe: string[] = [];
  const caveats: string[] = [];
  const notes: string[] = [];

  const lineup = myLineupLines(e, names, cfg);
  const odds = oddsLine(e);
  const risky = riskyWeekLines(e, cfg);
  const longTerm = longTermPercent(e, ctx, cfg);
  const futureFirst = isFiniteNumber(e.lambda) && e.lambda >= cfg.futureFirstLambda - EPS;
  const longTermGain = longTerm !== null && longTerm > 0 ? `Raises your roster's long-term value by ${longTerm}%.` : null;

  if (isFiniteNumber(e.b) && e.b <= 0) forMe.push("Doesn't help you overall, so the Trade Finder leaves trades like this out.");
  if (lineup.main) forMe.push(lineup.main);
  if (longTermGain && futureFirst) forMe.push(longTermGain);
  if (odds && "up" in odds) forMe.push(odds.up);
  if (risky.covered) forMe.push(risky.covered);
  if (lineup.playoffs) forMe.push(lineup.playoffs);
  if (longTermGain && !futureFirst) forMe.push(longTermGain);
  // Nothing above explains a redraft B > 0: it comes from the market term (§10's term on g_mkt(me)) when that term,
  // B − B_win, is positive and most of B (N10 floors what I give at W there, so a gain at market isn't enough).
  const bWin = e.bWin;
  const marketTerm = isFiniteNumber(e.b) && isFiniteNumber(bWin) ? e.b - bWin : Number.NaN;
  const fromMarket = isFiniteNumber(bWin) && marketTerm > EPS && marketTerm >= bWin - EPS;
  if (forMe.length === 0 && ctx.leagueType === "redraft" && isFiniteNumber(e.b) && e.b > 0 && fromMarket && e.gMine >= cfg.valueEven - EPS) {
    forMe.push(Number.isFinite(e.gMine) ? `Mostly a trade-value win: you get ${moreValue(e.gMine, cfg)} you give.` : "Mostly a trade-value win: you get trade value without giving any up.");
  }
  if (forMe.length === 0 && !lineup.slotLoss && !lineup.playoffsLoss) forMe.push("Barely changes your starting lineup.");

  // Their side, by how much each moved the estimate.
  const terms = e.detail.terms;
  const t = (x: number | undefined): number => Math.abs(finiteOr0(x));
  const lineupFact = partnerLineup(e, cfg);
  const line = (text: string | null, weight: number, role?: PartnerLine["role"]): PartnerLine | null => (text ? { text, weight, ...(role ? { role } : {}) } : null);
  // With a star premium, the value term (at their perceived g) splits: the raw market reading's part weighs the value
  // line, the rest (what the premium moved) the premium line. Without one, the value line weighs the whole term.
  const premium = premiumPlayers(e);
  const rawValue = valueTermAt(e.gPartner);
  const perceived = terms?.value;
  const valueWeight = premium.length > 0 ? Math.abs(rawValue) : t(perceived);
  const premiumWeight = isFiniteNumber(perceived) ? Math.abs(perceived - rawValue) : 0;
  // Counting the premium, do they still clearly come out ahead? Their perceived g ≥ valueEven, read on the value term
  // (monotone in g, so the comparison holds term for term). An unreadable term: no (the planner's words).
  const stillAhead = premium.length > 0 && isFiniteNumber(perceived) && perceived >= valueTermAt(cfg.valueEven) - EPS;
  const premiumTurned = premium.length > 0 && isFiniteNumber(perceived) && !stillAhead;
  // In this order on equal weights.
  const candidates = [
    line(partnerLineupLine(lineupFact, names, cfg), Math.abs(finiteOr0(terms?.need) + (lineupFact?.kind === "hole" ? finiteOr0(terms?.hole) : 0))),
    line(valueLine(e, cfg, premiumTurned), valueWeight, "value"),
    line(premiumLine(premium, names, stillAhead), premiumWeight, "premium"),
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
    longTerm !== null && longTerm < 0 ? `Costs ${-longTerm}% of your roster's long-term value.` : null,
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
  /** g_mkt(P), raw market values. */
  gPartner: number;
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
 * nScale, nClamp)); NaN (says nothing) when it can't be read.
 */
function deltaLineupFromTerms(terms: Partial<AcceptanceTerms> | undefined): number {
  const need = terms?.need;
  const betaNeed: number = config.acceptance.beta.need;
  const scale: number = config.acceptance.nScale;
  return isFiniteNumber(need) && betaNeed !== 0 && isFiniteNumber(scale) ? (need / betaNeed) * scale : Number.NaN;
}

/**
 * The version of the trade the pitch names (the file header): the offer-first step when the trade has steps that fit
 * it (the same partner, assets on a side, every asset readable), with its own detail, g and ΔLineup_P; the ranked
 * trade itself when there are none, or when the offer first is the ranked trade (the same assets).
 */
function pitchSource(e: TradeEvaluationCore): PitchSource {
  const step = e.steps?.offerFirst;
  const p = step?.proposal;
  if (!step || !p || p.partnerId !== e.proposal.partnerId || !Array.isArray(p.give) || !Array.isArray(p.get)) return e;
  if (p.give.length + p.get.length === 0 || !p.give.every(isAsset) || !p.get.every(isAsset)) return e;
  if (assetsKey(p.give) === assetsKey(e.proposal.give) && assetsKey(p.get) === assetsKey(e.proposal.get)) return e;
  const detail = step.detail;
  return {
    proposal: p,
    detail: detail ?? { holesFilled: [], partnerSlots: [], teams: 0 },
    partnerDeltaLineup: deltaLineupFromTerms(detail?.terms),
    gPartner: step.gPartner,
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

/** The pitch for one version of the trade (pitchSource: the offer-first version when steps exist). */
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
  const g = src.gPartner;
  // Only a modest value gain is a selling point: a bigger one tells a sharp manager it's an overpay; a loss is never mentioned.
  if (isFiniteNumber(g) && g >= cfg.valueEven - EPS && g <= cfg.pitchValueMax + EPS) leads.push(`You'd ${leads.length ? "also " : ""}get about ${pct(g)} more trade value than you give (FantasyCalc values).`);

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
  return { reasons: reasons(evaluation, ctx, names, cfg), pitch: pitch(pitchSource(evaluation), names, cfg) };
}
