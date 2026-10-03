/**
 * Trade Finder and Trade Analyzer view models (CLAUDE.md §10 "three numbers", §11 labels and "Est.", §13 "Each trade
 * card shows", §14 items 4–5; Phase 4 wave 2 decision M13). PURE functions from the engine's results and the
 * snapshot to plain-English words and numbers, so the pages only lay things out and every word is unit-tested.
 *
 * A trade card (buildTradeCard) says, in this order:
 * - who it's with, what I give and what I get (each player with position, NFL team and an injury tag in words);
 * - the three numbers: "Helps you" (the Trade Score, 0–100), "Chance they accept" (the estimate rounded to 5%,
 *   labeled "Est." and with its label: Long shot, Possible, Decent, Likely) and "Overall" (0–100). A trade that
 *   doesn't help me (B ≤ 0, only the Analyzer shows one) scores 0; one whose odds couldn't be simulated shows "—".
 *   When the league's review could veto it (the veto rule, §11), the chance it goes through is shown too;
 * - the risk flags, apart from the numbers (§10 guards): "Depends on an injured player", "Market check" (and, in the
 *   Analyzer, that a trade is normally hidden: it doesn't help me, saying what pulled it down (noHelpText), or the market
 *   check's hiding line);
 * - the numbers behind the score in words (§10 "always show"): my lineup's change per week (regular season and
 *   playoffs), my playoff and title odds in percentage points ("Playoff odds +4.1 percentage points (62% to 66%)":
 *   never "points", which would read as fantasy points next to the lineup's; the end percents only when my odds before
 *   any trade are known and the whole percent moves), long-term value in dynasty and
 *   keeper leagues, trade value given and received (the page puts "Values: FantasyCalc" beside it, §2.9), the
 *   partner's weekly lineup change, and "You get 142 ROS pts, give 118" (§13);
 * - the roster moves the trade forces (§7 roster legality: drops and adds for either side);
 * - the reasons and the pitch message (src/engine/explain.ts wrote them; shown as they are).
 *
 * Planner addendum to Checkpoint 3 (lead decisions N2, N8):
 * - "Harder to get" next to each player I'd get whose premium for his manager earns the tag (TradeDetail.premium:
 *   one of their two most valuable players who is also a top-12 one), in words with why on hover;
 * - "How to offer it" when the trade has steps (TradeEvaluation.steps, §4): "Offer first: Wiggleton Spoons for
 *   Cornelius Snoot · Est. 35%" and "If they say no, add Tobias Thimble · Est. 55%", each with its own estimate (the
 *   chance they accept, like the card's; with the chance it goes through when the league's review could veto that
 *   version). The card's numbers stay the ranked trade's (its give and get: the full trade, or the first offer).
 *   The pitch (explain.ts) proposes the first offer.
 * The evaluation's own notes (TradeDetail.notes: the week in progress on game days, keeper costs not modeled, …)
 * aren't repeated per card: the Finder lists every distinct one once with the search's notes (the week in progress
 * worded for the whole list: listNote), and the Analyzer shows its notes with its result, leaving out any its card's
 * reasons already say (explain.ts words some of them).
 *
 * My odds before any trade (baselineLines; review of Phase 4): the Finder says them above its ideas ("Your odds before
 * any trade: 71% to make the playoffs, 15% to win the title.") and the Analyzer above its card ("before this trade";
 * the worker sends them with the evaluation), each with what they count: every team after the free-agent pickups
 * that would help it, the baseline every trade's numbers are measured from (§7), so they can differ from the League
 * page's odds, which take rosters as they stand (lead decision L3). The cards' end percents start from the same odds.
 *
 * The Finder's empty state says why there's nothing: the search's notes when it stopped before screening anything
 * (no team, season over, deadline passed, no odds, must-include players that can't work: TradeSearchResult.counts.
 * screened 0), else what the guards left out ("No trade ideas that help you"), else that nothing was found. Notes
 * that didn't stop the search (the K/D/ST note almost always) stay in the notes list.
 *
 * Numbers print like the League page's (src/lib/format.ts): one decimal for points per week, whole percents and whole
 * values, a real minus sign. No jargon ("EV", "σ", "V*", "g_mkt" never appear).
 *
 * Also here: the Finder's list (buildFinderView: the cards in the chosen sort through rank.ts sortTrades, the hidden
 * counts, notes and warnings, the empty states), the search's progress in words (progressView), the Analyzer's
 * choices (analyzerChoices) and the links between the pages (finderHref, analyzerHref and what they carry back:
 * a team id and player ids only, never league ids or names; ⚠️ a URL query, as M13 says, so the server that serves the
 * page sees those ids like any address: the privacy page says so).
 */
import { displayAcceptance } from "@/engine/acceptance";
import { config } from "@/engine/config";
import type { TradeAnalysis } from "@/engine/evaluate";
import { POSITIONS, type InjuryStatus, type LeagueSnapshot, type PlayerInfo, type Pos } from "@/engine/model";
import { sortTrades } from "@/engine/rank";
import type { TradeSettings } from "@/engine/settings";
import type { PremiumFact, TradeAsset, TradeEvaluation, TradeProposal, TradeSearchProgress, TradeSearchResult, TradeSearchStage, TradeSort, TradeStep } from "@/engine/tradeModel";
import { feedbackFor, type FeedbackOutcome, type FeedbackReason, type FeedbackRecord } from "./feedbackStore";
import { fmtNum, fmtSigned, fmtWhole, plural } from "./format";
import { INJURY_LABEL, posLabel } from "./labels";

type SnapshotPart = Pick<LeagueSnapshot, "platform" | "teams" | "players" | "settings">;

export const FINDER_PATH = "/trades";
export const ANALYZER_PATH = "/analyzer";

/** The sort options (§13), Overall first (the default). */
export const SORT_OPTIONS: readonly { value: TradeSort; label: string }[] = [
  { value: "overall", label: "Overall" },
  { value: "helps", label: "Helps you" },
  { value: "accept", label: "Chance they accept" },
];

export function isTradeSort(x: unknown): x is TradeSort {
  return SORT_OPTIONS.some((o) => o.value === x);
}

// ---------------------------------------------------------------------------------------------
// Small words

const MINUS = "−";

/** A probability as a whole percent; "<1%" and ">99%" when it only rounds to 0 or 100. */
export function percentText(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p > 0 && p < 0.005) return "<1%";
  if (p < 1 && p > 0.995) return ">99%";
  return `${Math.round(p * 100)}%`;
}

/** An acceptance estimate as shown (§11: the nearest 5%). */
export function acceptText(p: number): string {
  return `${Math.round(displayAcceptance(p) * 100)}%`;
}

/**
 * A change in a probability, in percentage points: "+4.1 percentage points", "+1 percentage point", "no change"
 * (one decimal, as the reasons print it). Never just "points": next to the lineup's points it would read as fantasy
 * points.
 */
export function pointsChange(d: number): string {
  const text = fmtSigned(d * 100, 1);
  return text === "0" ? "no change" : `${text} ${text === "+1" || text === `${MINUS}1` ? "percentage point" : "percentage points"}`;
}

/** A whole number with its sign and thousands separators: "+1,200", "−300", "0". */
function signedWhole(n: number): string {
  const text = fmtWhole(n);
  return Math.round(n) > 0 ? `+${text}` : text;
}

/** Points per week, signed, one decimal: "+2.3 pts a week", "−1 pt a week" (singular when it prints as 1: review of Phase 4). */
export function perWeek(d: number): string {
  const text = fmtSigned(d, 1);
  return `${text} ${text === "+1" || text === `${MINUS}1` ? "pt" : "pts"} a week`;
}

/** "1 second", "4.2 seconds" (one decimal; singular when it prints as 1: review of Phase 4). */
export function secondsText(ms: number): string {
  const text = fmtNum(ms / 1000, 1);
  return `${text} ${text === "1" ? "second" : "seconds"}`;
}

/** "a", "a and b", "a, b and c". */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export type InjuryTone = "muted" | "warn" | "danger";

const INJURY_TONE: Record<InjuryStatus, InjuryTone> = {
  ACTIVE: "muted",
  PROBABLE: "muted",
  QUESTIONABLE: "warn",
  DOUBTFUL: "warn",
  OUT: "danger",
  IR: "danger",
  PUP: "danger",
  SUSPENDED: "danger",
  NA: "muted",
};

/** A team's name, or a stand-in when the snapshot doesn't have it. */
export function teamNameOf(snapshot: Pick<LeagueSnapshot, "teams">, teamId: string): string {
  return snapshot.teams.find((t) => t.id === teamId)?.name ?? "The other team";
}

// ---------------------------------------------------------------------------------------------
// Players and assets

export interface AssetView {
  /** The player's id ("pick:2027:1:4" for a draft pick). */
  id: string;
  name: string;
  /** "RB · DAL" (a pick: whose it was). */
  detail: string;
  /** An injury tag ("Q", "IR") with its words, or null when healthy. */
  injury: { short: string; long: string; tone: InjuryTone } | null;
  /** "Harder to get" (a player I'd get whom his manager values above market: the file header), with why on hover; null otherwise. */
  tag: { text: string; title: string } | null;
}

function playerDetail(info: PlayerInfo, platform: LeagueSnapshot["platform"]): string {
  return `${posLabel(info.pos, platform)} · ${info.nflTeam ?? "no NFL team"}`;
}

function injuryOf(info: PlayerInfo | undefined): AssetView["injury"] {
  if (!info) return null;
  const label = INJURY_LABEL[info.injury];
  return label ? { ...label, tone: INJURY_TONE[info.injury] } : null;
}

export function assetView(asset: TradeAsset, snapshot: SnapshotPart): AssetView {
  if (asset.kind === "pick") {
    return { id: `pick:${asset.season}:${asset.round}:${asset.originalTeamId}`, name: `${asset.season} round ${asset.round} pick`, detail: `Original owner: ${teamNameOf(snapshot, asset.originalTeamId)}`, injury: null, tag: null };
  }
  const info = snapshot.players[asset.id];
  if (!info) return { id: asset.id, name: "A player who's no longer in this league's data", detail: "", injury: null, tag: null };
  return { id: asset.id, name: info.name, detail: playerDetail(info, snapshot.platform), injury: injuryOf(info), tag: null };
}

// ---------------------------------------------------------------------------------------------
// "Harder to get" (planner addendum to Checkpoint 3, §2): shared with the League page (src/lib/leagueView.ts)

/** The tag's words (lead decision N2: text, never color alone). */
export const HARDER_TO_GET_TAG = "Harder to get";

/** "most valuable", "second most valuable", "third most valuable", "4th most valuable". */
function valueRankWords(rank: number): string {
  if (rank === 1) return "most valuable";
  if (rank === 2) return "second most valuable";
  if (rank === 3) return "third most valuable";
  const tens = rank % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][rank % 10] ?? "th");
  return `${rank}${suffix} most valuable`;
}

/**
 * What makes a manager want a little extra for one of his players (the League model's PlayerPremium, a trade's
 * PremiumFact): his rank by trade value on the roster, when that rank carries a premium (config.acceptance.starPremium.
 * rank), and being among the top eliteTop players by FantasyCalc value. `whose` names the roster ("his team's" on the
 * League page, "their" on a trade card): ["his team's most valuable player", "one of the top 12 players by trade value"].
 */
export function premiumReasons(p: Pick<PremiumFact, "rank" | "elite">, whose: string): string[] {
  const sp = config.acceptance.starPremium;
  const out: string[] = [];
  if (Number.isInteger(p.rank) && p.rank >= 1 && (sp.rank[p.rank - 1] ?? 0) > 0) out.push(`${whose} ${valueRankWords(p.rank)} player`);
  if (p.elite) out.push(`one of the top ${sp.eliteTop} players by trade value`);
  return out;
}

const NUMBER_WORD: Readonly<Record<number, string>> = { 2: "two", 3: "three", 4: "four", 5: "five" };

/**
 * Who carries "Harder to get", from config.acceptance.starPremium (the roster ranks whose premium, with the
 * top-eliteTop one, reaches harderToGetMin): "one of their two most valuable players and one of the top 12 players by
 * trade value" (`whose` "their"; the League page says "his team's").
 */
export function harderToGetWho(whose: string): string {
  const sp = config.acceptance.starPremium;
  const ranks = sp.rank.filter((r) => r > 0 && r + sp.elite >= sp.harderToGetMin - 1e-9).length;
  const which = ranks <= 1 ? `${whose} most valuable player` : `one of ${whose} ${NUMBER_WORD[ranks] ?? ranks} most valuable players`;
  return `${which} and one of the top ${sp.eliteTop} players by trade value`;
}

/** A player I'd get whom his manager would want a little extra for (PremiumFact.harderToGet): the card's tag, or null. */
function harderToGetOf(fact: PremiumFact | undefined): AssetView["tag"] {
  if (!fact?.harderToGet) return null;
  const why = premiumReasons(fact, "their");
  return { text: HARDER_TO_GET_TAG, title: `${HARDER_TO_GET_TAG}: ${why.length ? `${listText(why)}, so expect` : "expect"} them to want a little extra for him.` };
}

/** "Bo Nix (QB, DEN)" for sentences. */
function playerPhrase(id: string, snapshot: SnapshotPart): string {
  const info = snapshot.players[id];
  if (!info) return "a player who's no longer in this league's data";
  return `${info.name} (${posLabel(info.pos, snapshot.platform)}, ${info.nflTeam ?? "no NFL team"})`;
}

// ---------------------------------------------------------------------------------------------
// The card

export interface NumberView {
  /** What's printed ("57", "45%", "—"). */
  value: string;
  /** The same for screen readers when the print alone is unclear ("not scored"); null when the print says it. */
  srText: string | null;
}

export interface FlagView {
  kind: "injured" | "market" | "hiddenByMarket" | "noHelp" | "noOdds";
  text: string;
}

export interface FactView {
  label: string;
  value: string;
  /** "values": the trade values (the page adds the "Values: FantasyCalc" link beside them). */
  kind?: "values";
}

/** One step of "How to offer it" (TradeEvaluation.steps; the file header). */
export interface StepView {
  /** "Offer first:" or "If they say no, add" (bold on the card). */
  lead: string;
  /** The first offer in words ("Wiggleton Spoons for Cornelius Snoot"), or the player to add ("Tobias Thimble"). */
  what: string;
  /** "Est. 35%": the chance they accept, rounded like the card's (kept on one line). */
  est: string;
  /** "about 20% it goes through" when the league's review could veto this version and that rounds differently; else null. */
  through: string | null;
  /** The estimate for screen readers: "an estimated 35% chance they accept" (", about 20% that it goes through"). */
  acceptSr: string;
  /** The whole line: "Offer first: Wiggleton Spoons for Cornelius Snoot · Est. 35%". */
  text: string;
}

export interface StepsView {
  /** "How to offer it". */
  heading: string;
  /** Offer first, then what to add if they say no. */
  items: [StepView, StepView];
}

export interface TradeCardView {
  key: string;
  partnerId: string;
  /** "Trade with Gravel Gophers". */
  heading: string;
  partnerName: string;
  give: AssetView[];
  get: AssetView[];
  numbers: {
    helps: NumberView;
    accept: NumberView;
    /** "Est. · Decent": the estimate's label (§11). */
    acceptLabel: string;
    /** When a veto could stop it: "Counting a possible veto, about 20% it goes through." */
    acceptNote: string | null;
    overall: NumberView;
  };
  /** "How to offer it" (offer first, then what to add if they say no), or null when the trade has no steps. */
  steps: StepsView | null;
  flags: FlagView[];
  facts: FactView[];
  /** "You get 142 ROS pts, give 118" (§13). */
  ros: string;
  /** The roster moves the trade forces (§7), in sentences; empty when none. */
  required: string[];
  reasons: string[];
  pitch: string;
  /** The Trade Analyzer, prefilled with this trade. */
  analyzerHref: string;
  /** The evaluation behind the card (the feedback buttons save its numbers). */
  evaluation: TradeEvaluation;
}

export interface CardContext {
  snapshot: SnapshotPart;
  /**
   * My odds before any trade, every team after its helpful free-agent pickups: the search's baseline, or the one the
   * worker sends with an Analyzer evaluation (null fields when unknown; absent: the card shows the changes alone).
   */
  baseline?: { pPlayoffs: number | null; pTitle: number | null } | null;
}

/** A 0–100 score as printed: its number; 0 for a trade that doesn't help me (B ≤ 0); "—" when B is unknown. */
function scoreView(score: number | null, b: number | null): NumberView {
  if (score !== null && Number.isFinite(score)) return { value: String(score), srText: null };
  if (b !== null && Number.isFinite(b) && b <= 0) return { value: "0", srText: null };
  return { value: "—", srText: "not scored: the season couldn't be simulated" };
}

/** "+4.1 percentage points (62% to 66%)": the end percents only when my odds before any trade are known and the whole percent moves. */
function oddsFact(d: number | null, before: number | null | undefined): string {
  if (d === null || !Number.isFinite(d)) return "Unknown";
  const change = pointsChange(d);
  if (before === null || before === undefined || !Number.isFinite(before)) return change;
  const after = Math.min(1, Math.max(0, before + d));
  return percentText(after) !== percentText(before) ? `${change} (${percentText(before)} to ${percentText(after)})` : change;
}

/**
 * Why a trade that doesn't help me (B ≤ 0: trade ideas leave it out, only the Analyzer shows it) doesn't, by what pulled
 * B down (§10). Review of Phase 4: "it wouldn't raise your chances this season" also showed on trades that do raise them,
 * whose B the trade-value term ("Protect my trade value", planner addendum to Checkpoint 3 §3) or long-term value pulled
 * to 0 or below, next to the card's own "Playoff odds +1.8 percentage points".
 * - Dynasty and keeper leagues with long-term values (λ and B_future known, §10): this season against long-term value,
 *   weighed by the Win now ↔ Future setting.
 * - Redraft: my chances go up (B_win > 0) while I'd give up more trade value than I get (g_mkt(me) < 0, as the card's
 *   values show) → that trade value, weighed by "Protect my trade value". ⚠️ When my chances go up and the card's values
 *   don't show me giving more (the market term reads players I give worth less than the best free agent at that free
 *   agent's value: lead decision N10), only "overall", which stays true.
 * - Otherwise: it wouldn't raise my chances this season.
 */
function noHelpText(e: Pick<TradeEvaluation, "bWin" | "bFuture" | "lambda" | "gMine">): string {
  const up = (x: number | null) => x !== null && Number.isFinite(x) && x > 0;
  const leave = "so trade ideas leave it out.";
  if (e.lambda !== null && e.bFuture !== null && Number.isFinite(e.bFuture)) {
    if (up(e.bWin) && !up(e.bFuture)) return `Doesn't help you overall: it raises your chances this season, but you'd lose more long-term value than that's worth at your Win now ↔ Future setting, ${leave}`;
    if (!up(e.bWin) && up(e.bFuture)) return `Doesn't help you overall: it adds long-term value, but it costs more of your chances this season than that's worth at your Win now ↔ Future setting, ${leave}`;
    return `Doesn't help you: it wouldn't raise your chances this season or your long-term value, ${leave}`;
  }
  if (up(e.bWin)) {
    return Number.isFinite(e.gMine) && e.gMine < 0
      ? `Doesn't help you overall: it raises your chances this season, but you'd give up more trade value than that's worth at your “Protect my trade value” setting, ${leave}`
      : `Doesn't help you overall, ${leave}`;
  }
  return `Doesn't help you: it wouldn't raise your chances this season, ${leave}`;
}

const REVIEW_WORDS: Record<LeagueSnapshot["settings"]["tradeReview"], string> = {
  none: "a veto",
  commissioner: "the commissioner's review",
  league_vote: "a league veto vote",
};

/** A trade in words for a step: "Wiggleton Spoons and Glimmer Oddfellow for Cornelius Snoot" ("nothing" for an empty side). */
export function tradeWords(p: Pick<TradeProposal, "give" | "get">, snapshot: SnapshotPart): string {
  const side = (assets: readonly TradeAsset[]) => (assets.length ? listText(assets.map((a) => assetView(a, snapshot).name)) : "nothing");
  return `${side(p.give)} for ${side(p.get)}`;
}

/**
 * A step's estimate, the way the card shows its own: the chance they accept, and the chance it goes through when the
 * league's review could veto that version, only when it prints differently ("Est. 5%, about 5% it goes through" said
 * nothing more; the card's own note already says a veto vote could stop the ranked trade).
 */
function stepAccept(s: Pick<TradeStep, "pAccept" | "pComplete">): { est: string; through: string | null; sr: string } {
  const est = acceptText(s.pAccept);
  if (Math.abs(displayAcceptance(s.pComplete) - displayAcceptance(s.pAccept)) <= 1e-9) return { est: `Est. ${est}`, through: null, sr: `an estimated ${est} chance they accept` };
  const through = acceptText(s.pComplete);
  return { est: `Est. ${est}`, through: `about ${through} it goes through`, sr: `an estimated ${est} chance they accept, about ${through} that it goes through` };
}

/** "How to offer it" (TradeEvaluation.steps; the file header), or null without steps. */
export function stepsView(steps: TradeEvaluation["steps"], snapshot: SnapshotPart): StepsView | null {
  if (!steps) return null;
  const item = (lead: string, what: string, step: TradeStep): StepView => {
    const accept = stepAccept(step);
    return { lead, what, est: accept.est, through: accept.through, acceptSr: accept.sr, text: `${lead} ${what} · ${accept.est}${accept.through ? `, ${accept.through}` : ""}` };
  };
  return {
    heading: "How to offer it",
    items: [
      item("Offer first:", tradeWords(steps.offerFirst.proposal, snapshot), steps.offerFirst),
      item("If they say no, add", assetView({ kind: "player", id: steps.ifNo.add }, snapshot).name, steps.ifNo.full),
    ],
  };
}

export function buildTradeCard(e: TradeEvaluation, ctx: CardContext): TradeCardView {
  const { snapshot } = ctx;
  const partnerName = teamNameOf(snapshot, e.proposal.partnerId);
  const showsVeto = e.detail.vetoRisk || Math.abs(displayAcceptance(e.pComplete) - displayAcceptance(e.pAccept)) > 1e-9;

  const flags: FlagView[] = [];
  if (e.flags.injured.length) {
    const who = e.flags.injured.map((id) => {
      const info = snapshot.players[id];
      const status = info ? INJURY_LABEL[info.injury]?.long.toLowerCase() : undefined;
      return `${info?.name ?? "a player"}${status ? ` (${status})` : ""}`;
    });
    flags.push({ kind: "injured", text: `Depends on ${e.flags.injured.length === 1 ? "an injured player" : "injured players"}: ${listText(who)}` });
  }
  if (e.flags.hiddenByBenefit) flags.push({ kind: "noHelp", text: noHelpText(e) });
  if (e.flags.marketCheck && Number.isFinite(e.gMine)) {
    const less = `you'd get ${Math.round(-e.gMine * 100)}% less trade value than you give`;
    flags.push(
      e.flags.hiddenByMarket
        ? { kind: "hiddenByMarket", text: `Market check: ${less}, so trade ideas leave it out.` }
        : { kind: "market", text: `Market check: ${less}.` },
    );
  }
  if (e.b === null && !e.flags.hiddenByBenefit) flags.push({ kind: "noOdds", text: "Not scored: your playoff odds couldn't be worked out, so this trade has no Helps you or Overall number." });

  const facts: FactView[] = [
    { label: "Your lineup", value: `${perWeek(e.dPPW)} in the regular season, ${fmtSigned(e.dPPWPlayoffs, 1)} in the playoffs` },
    { label: "Playoff odds", value: oddsFact(e.dPO, ctx.baseline?.pPlayoffs) },
    { label: "Title odds", value: oddsFact(e.dCH, ctx.baseline?.pTitle) },
  ];
  if (e.dDyn !== null && Number.isFinite(e.dDyn)) facts.push({ label: "Long-term value", value: `${signedWhole(e.dDyn)} for your roster` });
  else if (e.dynMissing) facts.push({ label: "Long-term value", value: "Unknown: long-term values didn't load" });
  const counts = e.proposal.give.length !== e.proposal.get.length;
  facts.push({
    label: "Trade value",
    value: `You give ${fmtWhole(e.value.given)}, you get ${fmtWhole(e.value.received)}${counts ? " (the side getting fewer players is credited for its open roster spot)" : ""}`,
    kind: "values",
  });
  facts.push({ label: "Their lineup", value: perWeek(e.partnerDeltaLineup) });

  const required: string[] = [];
  const name = (id: string) => playerPhrase(id, snapshot);
  const r = e.required;
  if (r.me.drops.length) required.push(`You'd drop ${listText(r.me.drops.map(name))} to stay within your roster limits.`);
  if (r.me.adds.length) required.push(`You'd pick up ${listText(r.me.adds.map(name))} from free agents to fill your roster.`);
  if (r.partner.drops.length) required.push(`${partnerName} would drop ${listText(r.partner.drops.map(name))} to stay within their roster limits.`);
  if (r.partner.adds.length) required.push(`${partnerName} would pick up ${listText(r.partner.adds.map(name))} from free agents to fill their roster.`);

  return {
    key: e.key,
    partnerId: e.proposal.partnerId,
    heading: `Trade with ${partnerName}`,
    partnerName,
    give: e.proposal.give.map((a) => assetView(a, snapshot)),
    // Players I'd get carry "Harder to get" when their manager values them above market (TradeDetail.premium).
    get: e.proposal.get.map((a) => {
      const view = assetView(a, snapshot);
      return a.kind === "player" ? { ...view, tag: harderToGetOf(e.detail.premium?.find((f) => f.playerId === a.id)) } : view;
    }),
    numbers: {
      helps: scoreView(e.tradeScore, e.b),
      accept: { value: acceptText(e.pAccept), srText: null },
      acceptLabel: `Est. · ${e.acceptLabel}`,
      acceptNote: showsVeto ? `Counting ${REVIEW_WORDS[snapshot.settings.tradeReview]}, about ${acceptText(e.pComplete)} it goes through.` : null,
      overall: scoreView(e.overall, e.b),
    },
    steps: stepsView(e.steps, snapshot),
    flags,
    facts,
    ros: `You get ${fmtWhole(e.ros.received)} ROS pts, give ${fmtWhole(e.ros.given)}`,
    required,
    reasons: [...e.reasons],
    pitch: e.pitch,
    analyzerHref: analyzerHref(e.proposal),
    evaluation: e,
  };
}

// ---------------------------------------------------------------------------------------------
// My odds before any trade (both pages)

/**
 * My odds before any trade in words (the Finder's line above its ideas, the Analyzer's above its card) and what they
 * count: every team after the free-agent pickups that would help it (§7's baseline, the one every trade's numbers are
 * measured from), where the League page's odds take rosters as they stand (lead decision L3). Review of Phase 4: the
 * Finder said "Your odds now: 71%" while the League page said 76%, so a card's "(71% to 77%)" read as a 1-point gain.
 * Null when the season wasn't simulated.
 */
export function baselineLines(baseline: CardContext["baseline"], page: "finder" | "analyzer"): { text: string; note: string } | null {
  if (!baseline || baseline.pPlayoffs === null || !Number.isFinite(baseline.pPlayoffs)) return null;
  const title = baseline.pTitle !== null && Number.isFinite(baseline.pTitle) ? `, ${percentText(baseline.pTitle)} to win the title` : "";
  return {
    text: `Your odds ${page === "finder" ? "before any trade" : "before this trade"}: ${percentText(baseline.pPlayoffs)} to make the playoffs${title}.`,
    note: `Like ${page === "finder" ? "every trade idea's numbers" : "the trade's numbers"}, they count the free-agent pickups that would help each team, so they can differ from the League page's odds, which take rosters as they stand.`,
  };
}

// ---------------------------------------------------------------------------------------------
// The Trade Finder

export interface FinderView {
  /** "Your odds before any trade: 62% to make the playoffs, 9% to win the title." (null when not simulated; baselineLines). */
  baseline: string | null;
  /** What those odds count, and why they can differ from the League page's (null with no baseline). */
  baselineNote: string | null;
  cards: TradeCardView[];
  /** "25 trade ideas, sorted by Overall." ("" when none). */
  countText: string;
  /** The status line once the search is done: "Found 25 trade ideas." or the empty state's title. */
  statusText: string;
  /** "Left out: 10 that wouldn't help you, and 2 …" (null when none). */
  hidden: string | null;
  /** "Looked at 1,234 trade ideas, checked the best 200 closely, … That took 4.2 seconds." */
  searched: string | null;
  notes: string[];
  warnings: string[];
  /** Why there's nothing to show, when there isn't (its text includes the notes that explain it). */
  empty: { title: string; text: string[] } | null;
}

function hiddenText(hidden: TradeSearchResult["hidden"]): string | null {
  const parts: string[] = [];
  if (hidden.byBenefit > 0) parts.push(`${plural(hidden.byBenefit, "trade idea")} that wouldn't help you`);
  if (hidden.byMarket > 0) parts.push(`${plural(hidden.byMarket, "trade idea")} where you'd get over ${Math.round(-config.benefit.marketHideBelow * 100)}% less trade value than you give`);
  return parts.length ? `Left out on purpose: ${listText(parts)}.` : null;
}

function searchedText(result: TradeSearchResult): string | null {
  const c = result.counts;
  if (!c.screened) return null;
  const total = result.timings.total;
  const time = typeof total === "number" && Number.isFinite(total) ? ` That took ${secondsText(total)}.` : "";
  const sims = c.simFinal ? `, and played out your season ${fmtWhole(config.simulation.finalSims)} times with each of the best ${fmtWhole(c.simFinal)}` : "";
  return `Looked at ${fmtWhole(c.screened)} ${c.screened === 1 ? "trade idea" : "trade ideas"}, checked the best ${fmtWhole(c.exact)} closely${sims}.${time}`;
}

/**
 * An evaluation's note as the Finder lists it, once for all its ideas. The engine words the week in progress for one
 * trade (evaluate.ts: "Week 4 is under way, so this trade can't change it: its odds count week 4 as it stands.", right
 * under the Analyzer's card), which read oddly under a list of 18 (review of Phase 4: "this trade" named none of them).
 * ⚠️ Matched on the engine's words: any other note passes through as it is.
 */
export function listNote(note: string): string {
  const m = /^Week (\d+) is under way, so this trade can't change it\b/.exec(note);
  return m ? `Week ${m[1]} is under way, so no trade can change it: every idea's odds count week ${m[1]} as it stands.` : note;
}

export function buildFinderView(args: { result: TradeSearchResult; sort: TradeSort; snapshot: SnapshotPart; partnerId: string | null }): FinderView {
  const { result, snapshot } = args;
  const baseline = result.baseline;
  const cards = sortTrades(result.trades, args.sort).map((e) => buildTradeCard(e, { snapshot, baseline }));
  const sortLabel = SORT_OPTIONS.find((o) => o.value === args.sort)?.label ?? "Overall";
  const odds = baselineLines(baseline, "finder");
  const hidden = hiddenText(result.hidden);
  let empty: FinderView["empty"] = null;
  // The search's notes, then each distinct note of the evaluations themselves (TradeDetail.notes), once, worded for the list.
  let notes = [...result.notes];
  for (const e of result.trades) {
    for (const n of e.detail.notes) {
      const note = listNote(n);
      if (!notes.includes(note)) notes.push(note);
    }
  }
  if (!cards.length) {
    // Notes explain the emptiness only when the search stopped before screening anything (see the header).
    if (result.counts.screened === 0 && notes.length) {
      empty = { title: "No trade ideas right now", text: notes };
      notes = [];
    } else if (hidden) {
      empty = { title: "No trade ideas that help you", text: [hidden] };
    } else {
      const who = args.partnerId ? `with ${teamNameOf(snapshot, args.partnerId)}` : "with any team";
      empty = {
        title: "No trade ideas found",
        text: [`No trade ${who} helps your team and has a fair chance of being accepted. Allowing more players per side in Settings, or fewer untouchables, can turn up more.`],
      };
    }
  }
  return {
    baseline: odds?.text ?? null,
    baselineNote: odds?.note ?? null,
    cards,
    countText: cards.length ? `${plural(cards.length, "trade idea")}, sorted by ${sortLabel}.` : "",
    statusText: cards.length ? `Found ${plural(cards.length, "trade idea")}.` : `${empty?.title ?? "No trade ideas right now"}.`,
    // Said once: in the empty state when that's where it is.
    hidden: hidden !== null && empty?.text.includes(hidden) ? null : hidden,
    searched: searchedText(result),
    notes,
    warnings: [...result.warnings],
    empty,
  };
}

/**
 * What the search's settings let a trade idea be, in one line ("Up to 2 players a side and 1 untouchable."), and, in a
 * redraft league whose "Protect my trade value" isn't the default, that setting too (it changes how ideas are scored).
 */
export function settingsSummary(settings: TradeSettings, platform: LeagueSnapshot["platform"], leagueType: LeagueSnapshot["settings"]["leagueType"] = "redraft"): string {
  const pos = (ps: readonly Pos[]) => listText(ps.map((p) => posLabel(p, platform)));
  const parts = [`up to ${plural(settings.maxPerSide, "player")} a side`];
  if (settings.untouchables.length) parts.push(plural(settings.untouchables.length, "untouchable"));
  if (settings.mustInclude.length) parts.push(plural(settings.mustInclude.length, "must-include player"));
  if (settings.targetPositions.length) parts.push(`only getting ${pos(settings.targetPositions)}`);
  if (settings.avoidPositions.length) parts.push(`never getting ${pos(settings.avoidPositions)}`);
  if (settings.includeKDefIdp) parts.push(`kickers, ${platform === "espn" ? "D/STs" : "team defenses"} and IDP players included`);
  const text = listText(parts);
  // The level as the Settings page names it ("High", "Low").
  const level = `${settings.protectValue.charAt(0).toUpperCase()}${settings.protectValue.slice(1)}`;
  const protect = leagueType === "redraft" && settings.protectValue !== config.benefit.protectValueDefault ? ` Protect my trade value: ${level}.` : "";
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.${protect}`;
}

// ---------------------------------------------------------------------------------------------
// Progress (M14's progress bar)

const STAGE_ORDER: readonly TradeSearchStage[] = ["setup", "screening", "exact", "simScreen", "simFinal", "rank"];
/** Each stage's share of the bar: a rough guide to where the time goes, not a measurement. */
const STAGE_WEIGHT: Record<TradeSearchStage, number> = { setup: 0.1, screening: 0.3, exact: 0.25, simScreen: 0.2, simFinal: 0.13, rank: 0.02 };

/** Each stage in plain words. */
export const STAGE_LABEL: Record<TradeSearchStage, string> = {
  setup: "Getting your league ready",
  screening: "Screening trade ideas",
  exact: "Checking the best ideas closely",
  simScreen: "Playing out your season with each idea",
  simFinal: `Playing out the best ideas ${fmtWhole(config.simulation.finalSims)} times`,
  rank: "Ranking the trade ideas",
};

export interface ProgressView {
  label: string;
  /** "120 of 480" (null when a stage has one step). */
  detail: string | null;
  /** 0–99 while it runs. */
  percent: number;
  /** For the progress bar's aria-valuetext. */
  valueText: string;
}

export function progressView(p: TradeSearchProgress | null): ProgressView {
  const stage = p?.stage ?? "setup";
  const index = Math.max(0, STAGE_ORDER.indexOf(stage));
  const before = STAGE_ORDER.slice(0, index).reduce((s, st) => s + STAGE_WEIGHT[st], 0);
  const share = p && p.total > 0 ? Math.min(1, Math.max(0, p.done / p.total)) : 0;
  const percent = Math.min(99, Math.max(0, Math.floor((before + STAGE_WEIGHT[stage] * share) * 100)));
  const detail = p && p.total > 1 ? `${fmtWhole(Math.min(p.done, p.total))} of ${fmtWhole(p.total)}` : null;
  const label = STAGE_LABEL[stage];
  return { label, detail, percent, valueText: detail ? `${label}: ${detail}` : label };
}

// ---------------------------------------------------------------------------------------------
// Links between the pages (a team id and player ids only)

/** The Trade Finder, for one partner or every team. */
export function finderHref(partnerId: string | null): string {
  return partnerId ? `${FINDER_PATH}?${new URLSearchParams({ partner: partnerId }).toString()}` : FINDER_PATH;
}

/** The Trade Analyzer, prefilled with a trade (players only: picks wait for Phase 5, M11). */
export function analyzerHref(p: Pick<TradeProposal, "partnerId" | "give" | "get">): string {
  const q = new URLSearchParams();
  q.set("partner", p.partnerId);
  for (const a of p.give) if (a.kind === "player") q.append("give", a.id);
  for (const a of p.get) if (a.kind === "player") q.append("get", a.id);
  return `${ANALYZER_PATH}?${q.toString()}`;
}

/** Another team in this league (never mine), or null. */
export function partnerOrNull(snapshot: Pick<LeagueSnapshot, "teams">, myTeamId: string | null, id: string | null | undefined): string | null {
  return id && id !== myTeamId && snapshot.teams.some((t) => t.id === id) ? id : null;
}

/** The Finder's partner from its address (`?partner=`): another team in this league, else null (every team). */
export function readFinderPartner(search: string | null | undefined, snapshot: Pick<LeagueSnapshot, "teams">, myTeamId: string | null): string | null {
  return partnerOrNull(snapshot, myTeamId, new URLSearchParams(search ?? "").get("partner"));
}

/** The Analyzer's trade being built: the partner, and the players I give and get (canonical ids). */
export interface AnalyzerDraft {
  partnerId: string | null;
  give: string[];
  get: string[];
}

export const EMPTY_DRAFT: AnalyzerDraft = { partnerId: null, give: [], get: [] };

/** At most this many players a side in the Analyzer (config.search.analyzerMaxPerSide). */
export const ANALYZER_MAX_PER_SIDE: number = Math.max(1, Math.floor(config.search.analyzerMaxPerSide));

function activeRoster(snapshot: Pick<LeagueSnapshot, "teams">, teamId: string | null): string[] {
  return teamId ? (snapshot.teams.find((t) => t.id === teamId)?.roster ?? []) : [];
}

function keepIds(ids: readonly string[], allowed: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) if (allowed.includes(id) && !out.includes(id) && out.length < ANALYZER_MAX_PER_SIDE) out.push(id);
  return out;
}

/**
 * The Analyzer's trade from its address (`?partner=&give=&get=`): only another team of this league, my active-roster
 * players to give and the partner's to get (M2: IR and taxi players aren't tradable yet), each once, at most
 * ANALYZER_MAX_PER_SIDE a side. Anything else is ignored.
 */
export function readAnalyzerDraft(search: string | null | undefined, snapshot: Pick<LeagueSnapshot, "teams">, myTeamId: string | null): AnalyzerDraft {
  const q = new URLSearchParams(search ?? "");
  const partnerId = partnerOrNull(snapshot, myTeamId, q.get("partner"));
  return { partnerId, give: keepIds(q.getAll("give"), activeRoster(snapshot, myTeamId)), get: keepIds(q.getAll("get"), activeRoster(snapshot, partnerId)) };
}

/** The trade being built in a sentence ("You give Bo Nix; you get Travis Kelce."), null before any player is picked. */
export function draftSummary(draft: AnalyzerDraft, snapshot: Pick<LeagueSnapshot, "players">): string | null {
  if (!draft.give.length && !draft.get.length) return null;
  const names = (ids: readonly string[]) => listText(ids.map((id) => snapshot.players[id]?.name ?? "a player"));
  const text = `You give ${draft.give.length ? names(draft.give) : "nothing"}; you get ${draft.get.length ? names(draft.get) : "nothing"}`;
  // A name can end the sentence with its own period ("Jr.").
  return text.endsWith(".") ? text : `${text}.`;
}

/** The draft as a proposal, once it names a partner and at least one player. */
export function draftProposal(draft: AnalyzerDraft): TradeProposal | null {
  if (!draft.partnerId || draft.give.length + draft.get.length === 0) return null;
  return { partnerId: draft.partnerId, give: draft.give.map((id) => ({ kind: "player", id })), get: draft.get.map((id) => ({ kind: "player", id })) };
}

/** A draft's identity, whatever the order its players were picked in (to tell whether a result is for it). */
export function draftKey(draft: AnalyzerDraft): string {
  return `${draft.partnerId ?? "-"}|${[...draft.give].sort().join(",")}|${[...draft.get].sort().join(",")}`;
}

export interface PlayerChoice {
  id: string;
  name: string;
  detail: string;
  injury: AssetView["injury"];
  checked: boolean;
  /** Unchecked while the side is full. */
  disabled: boolean;
}

export interface AnalyzerChoices {
  partners: { id: string; name: string }[];
  mine: PlayerChoice[];
  theirs: PlayerChoice[];
  /** "Up to 4 players a side." */
  limitText: string;
}

const POS_RANK = new Map<Pos, number>(POSITIONS.map((p, i) => [p, i]));

function choices(snapshot: SnapshotPart, ids: readonly string[], picked: readonly string[]): PlayerChoice[] {
  const full = picked.length >= ANALYZER_MAX_PER_SIDE;
  const rank = (id: string) => POS_RANK.get(snapshot.players[id]?.pos as Pos) ?? POSITIONS.length;
  return [...ids]
    .sort((a, b) => rank(a) - rank(b) || (snapshot.players[a]?.name ?? a).localeCompare(snapshot.players[b]?.name ?? b) || (a < b ? -1 : a > b ? 1 : 0))
    .map((id) => {
      const view = assetView({ kind: "player", id }, snapshot);
      const checked = picked.includes(id);
      return { id, name: view.name, detail: view.detail, injury: view.injury, checked, disabled: full && !checked };
    });
}

/** What the Analyzer offers: the other teams, my active roster and the partner's, each player checked as in the draft. */
export function analyzerChoices(snapshot: SnapshotPart, myTeamId: string | null, draft: AnalyzerDraft): AnalyzerChoices {
  return {
    partners: snapshot.teams.filter((t) => t.id !== myTeamId).map((t) => ({ id: t.id, name: t.name })),
    mine: choices(snapshot, activeRoster(snapshot, myTeamId), draft.give),
    theirs: choices(snapshot, activeRoster(snapshot, draft.partnerId), draft.get),
    limitText: `Up to ${ANALYZER_MAX_PER_SIDE} players a side, from the active rosters (players on IR or a taxi squad can't be traded here yet).`,
  };
}

/** The Analyzer's result in words: my odds before the trade, the card, or why the trade can't be made, and the notes. */
export interface AnalysisView {
  /** "Your odds before this trade: 62% to make the playoffs, 9% to win the title." and what they count (baselineLines), with a card only; null otherwise. */
  baseline: string | null;
  baselineNote: string | null;
  card: TradeCardView | null;
  illegal: string | null;
  notes: string[];
}

/**
 * The Analyzer's result in words. `analysis.baseline` (my odds before any trade, which the worker sends with the
 * evaluation: src/workers/engine.worker.ts) gives the card's odds their end points and the line above it, so a trade
 * reads the same as on the Trade Finder (review of Phase 4: the Finder's "+9.1 percentage points (63% to 72%)" read
 * "+9.1 percentage points" here). Without it, the card shows the changes alone.
 */
export function buildAnalysisView(analysis: TradeAnalysis & { baseline?: CardContext["baseline"] }, snapshot: SnapshotPart): AnalysisView {
  const baseline = analysis.baseline ?? null;
  const card = analysis.evaluation && !analysis.illegal ? buildTradeCard(analysis.evaluation, { snapshot, baseline }) : null;
  const odds = card ? baselineLines(baseline, "analyzer") : null;
  // A note the card's reasons already say isn't said twice.
  const said = new Set(card?.reasons ?? []);
  return { baseline: odds?.text ?? null, baselineNote: odds?.note ?? null, card, illegal: analysis.illegal, notes: [...new Set(analysis.notes)].filter((n) => !said.has(n)) };
}

// ---------------------------------------------------------------------------------------------
// Feedback (§11; src/lib/feedbackStore.ts)

export interface CardFeedback {
  outcome: FeedbackOutcome | null;
  report: { reason: FeedbackReason; note: string | null } | null;
}

/** What this browser has saved for a trade idea (both null when nothing). */
export function cardFeedback(records: readonly FeedbackRecord[] | undefined, leagueKey: string, tradeKey: string): CardFeedback {
  const record = records ? feedbackFor(records, leagueKey, tradeKey) : undefined;
  return {
    outcome: record?.outcome?.kind ?? null,
    report: record?.report ? { reason: record.report.reason, note: record.report.note ?? null } : null,
  };
}
