/**
 * Trade Finder and Trade Analyzer view models (CLAUDE.md §10 "three numbers", §11 labels and "Est.", §13 "Each trade
 * card shows", §14 items 4–5; Phase 4 wave 2 decision M13). PURE functions from the engine's results and the
 * snapshot to plain-English words and numbers, so the pages only lay things out and every word is unit-tested.
 *
 * A trade card (buildTradeCard) says, in this order:
 * - who it's with, what I give and what I get (each player with position, NFL team and an injury tag in words);
 * - the three numbers: "Helps you" (the Trade Score, 0–100, on the evaluation's scale B₃ since Phase 7a, planner reply to
 *   Checkpoint 4c, A2: its tooltip says "63 ≈ as good as adding 3 points a week to your lineup for the rest of the season.",
 *   HELPS_SCALE_TEXT, which helpsInfoText repeats in words; in a dynasty or keeper league with long-term values the scale is
 *   B_ref(λ) and the tooltip follows the mix, helpsScaleText: planner reply to Checkpoint 7a, §2 question 6), "Chance they accept" (the estimate rounded to 5%,
 *   labeled "Est." and with its label: Long shot, Possible, Decent, Likely; ⚠️ a model value under 5% prints "<5%", never
 *   rounded up: planner reply to Checkpoint 4b, answer 5; acceptance.displayAcceptance's number is unchanged, the filter
 *   and the label read it) and "Overall" (0–100). A trade that doesn't help me (B ≤ 0, only the Analyzer shows one)
 *   scores 0; one whose odds couldn't be simulated shows "—". When the league's review could veto it (the veto rule,
 *   §11), the chance it goes through is shown too;
 * - next to them, my real odds (planner reply to Checkpoint 4b, change 9: "Helps you" alone means nothing): "Title odds
 *   12.1% → 13.4%" and "Playoff odds 65% → 69%" (oddsViews: one decimal for the title, whole percents for the playoffs,
 *   as the planner wrote them; before = my odds before any trade, the search's baseline, which is the League page's
 *   headline (every team after its likely pickups); after = before + ΔCH or ΔPO, from the very runs B came from; without
 *   the before, the change in percentage points, never bare "points"), and "Win chance by week: Week 9: 68% → 64% ·
 *   Week 13: 42% → 55%" (weeklyLine: TradeDetail.winChance's weeks moving at least config.explain.weeklyLineMin, at most
 *   weeklyLineMax of them in week order, the drops first, then the largest gains; none in a points-only league, whose list
 *   is empty, or when no week moves).
 *   ⚠️ Never for an offer-first step (its numbers come from the 1,000-season screening block, not the card's runs); a Plan
 *   B box prints its own, by the same rules (PlanB.dPO, dCH and winChance: Plan B's own simulation on the final block, the
 *   card's runs' block, so from the same "before"; Phase 4c's polish of change 9: the box showed its three numbers alone);
 * - the risk flags, apart from the numbers (§10 guards): "Depends on an injured player" (with what his projection
 *   assumes: see the injury tags below), "Market check" (and, in the Analyzer, that a trade is normally hidden: it doesn't
 *   help me, saying what pulled it down (noHelpText), or the market check's hiding line). ⚠️ The market check keeps the
 *   model's trigger (g_mkt(me) below config.benefit.marketCheckBelow, the model's package: every player at max(v, W), the
 *   roster-spot credit, the neutral throw-ins) but no number: "Market check: counting roster spots, you'd give up more
 *   trade value than you get." (planner reply to Checkpoint 4b, change 3: the model's figures stay internal), and when the
 *   roster spot the trade costs me is what trips it, it says so: "Market check: you'd get 2 players for 1, and counting the
 *   roster spot that costs you, …" (marketCheckText; final review of Phase 4c, finding PAGES-6);
 * - the numbers behind the score in words (§10 "always show"): my lineup's change per week (regular season and
 *   playoffs), long-term value in dynasty and keeper leagues in words only (the model's ΔDyn: "Up for your roster",
 *   longTermFact), the partner's weekly lineup change, and "You get 142 ROS pts, give 118" (§13), with a
 *   line when my starting lineup moves the other way (review of Phase 4b: "You get 96 ROS pts, give 295" read like a
 *   lopsided loss on a trade that gives a backup QB who never starts): "Your starting lineup still gains 25 ROS pts: …"
 *   (rosNoteOf, from TradeDetail.weekly). No trade value number: planner reply to Checkpoint 7a, 5.4 (FantasyCalc's
 *   condition 4, reports/fantasycalc-permission.md: Offer Sheet doesn't display FantasyCalc's values at all). Until Phase 7b
 *   the card printed "Trade value: You give 6,500, you get 5,400", FantasyCalc's own plain sums. Under the facts, the
 *   "Values: FantasyCalc" link (§2.9) after a sentence saying the numbers weigh trade value (TradeCardView.valuesCredit:
 *   whenever trade values, FantasyCalc's or our estimates from them, are behind the card's numbers);
 * - the roster moves the trade forces (§7 roster legality: drops and adds for either side; Phase 4b's IR players: a
 *   received IR player who goes into an open IR slot, RosterChange.toIR, and a player dropped from the week an IR player
 *   comes back, RosterChange.displaced; Phase 7c's open roster spots, one sentence each, RosterChange.openSpots: "Open
 *   roster spot: add Tyler Allgeier, the best available RB.", planner reply to Checkpoint 7b, section 5, with the IR return
 *   that drops a fill again and a partner's fill that takes my own League-page pickup said in the spot's sentence:
 *   openSpotText);
 * - the reasons and the pitch message (src/engine/explain.ts wrote them; shown as they are, except explain.ts's
 *   "Depends on an injured player" caveat, which the card's flag already says: INJURED_REASON).
 *
 * Planner reply to Checkpoint 4, change 6:
 * - Injury tags in words on every injury-tagged player on either side (TradeEvaluation.flags.tagged; when an evaluation
 *   lacks them, the Analyzer's, tags from the snapshot with the week now: explain.injuryTags): "Questionable", "Out —
 *   expected back week 8", "On IR — expected back week 8", "Out for the season", "Suspended", "Not an active NFL player"
 *   (injuryTagText). A return week is said whenever the tag carries one, and explain.injuryTags keeps it only when his
 *   projection counts on it (review of track F): OUT from next week on, IR, PUP and SUSPENDED after this week (an older
 *   date is stale), and a Probable, Questionable or Doubtful player's far ESPN date only when his projection follows it
 *   (§6 step 3's conflict), said as the platform's: "Questionable — ESPN expects him back week 8" (Josh Jacobs on
 *   Parker's league, out until then in his numbers, read just "Questionable"). The search's evaluations and the
 *   Analyzer's both carry tags that know which conflicted players follow their date (evaluate.ts withWords sets
 *   flags.tagged with explain.tagContextOf, the League model's word); only an evaluation without them (a core) reads the
 *   snapshot, where such a player reads just "Questionable". When a player I'd get is tagged with an injury status
 *   (Probable, Questionable, Doubtful, Out, IR or PUP; not Suspended or NA), the card says once why his numbers can still
 *   look good: "Josh Jacobs: his projection assumes he returns at full strength, blended with the trade market." ⚠️ The
 *   tag doesn't say whether the market blend reached him (a player without a real FantasyCalc value, or a K or D/ST when
 *   they're included, isn't blended), so the sentence is said for every such player; but never "blended with the trade
 *   market" while the blend is off for the whole league (CardContext.blendOn, marketBlendOn: FantasyCalc's curve
 *   fallback, no FantasyCalc, a dynasty or keeper league without this season's list; review of track UIC, finding 3:
 *   "His projection assumes he returns at full strength."). Review of Phase 4b: a player I'd
 *   get who is Out, on IR or on the PUP list was said four times (his tag, that sentence, the "Depends on an injured
 *   player" flag and explain.ts's caveat repeating the flag), so for him the sentence joins the flag ("Depends on an
 *   injured player: Jadarian Price (injured reserve). His projection assumes he returns at full strength, blended with
 *   the trade market.") and the caveat isn't repeated among the reasons: his tag and the flag say it. The sentence under
 *   the two lists stays for the other tagged players I'd get (Probable, Questionable, Doubtful), whom no flag names.
 * - "If they say no, try:" (TradeEvaluation.planB, the Trade Finder's cards without steps; since the review of track
 *   F a trade likelier to go through than the card): the other trade in words, each tagged player with his tag (the
 *   card's own for a player it shares with the card, else the search's tag for him on another idea, which knows his
 *   far date, else the snapshot's: ⚠️ PlanB carries no tags of its own), whether it's the same players of theirs or "A
 *   different set of their players", its three numbers (with the chance it goes through when a veto could cut it), its
 *   title and playoff odds before and after and its "Win chance by week" line (Phase 4c, change 9: as the card's, from
 *   its own final-block simulation), "Also shown as trade idea 6." when the list shows it as a card of its own (its
 *   place in the sort shown), its own message to send them (planBPitch: a follow-up naming the trade from their side)
 *   and its own "Open in Analyzer" link, which says it comes from "If they say no, try:" (`from=planB`), so the
 *   Analyzer shows that trade as one offer, without "How to offer it" (review of Phase 4b: its first offer could be
 *   smaller than the trade they had just turned down, and its message proposed that smaller offer).
 * - Feedback versions (TradeCardView.versions): the versions the card shows, for "Which version did you send?" (the
 *   first offer and the full one with steps; this trade and Plan B's; this trade alone otherwise). The "Version:" line
 *   under the outcome buttons (versionLine) names the recorded version only when its key is one the card shows; a
 *   recorded version the card no longer shows (its Plan B or throw-in changed since, or the Analyzer's card for the same
 *   trade) reads "an earlier one" with its players, read from its key (CardFeedback.versionWords). Phase 4c (planner
 *   reply to Checkpoint 4b, change 7 and answer 9): each version carries its model inputs (VersionChoice.inputs:
 *   feedbackStore.VersionInputs), saved with the outcome: its acceptance features, raw g_mkt(P), B and the goal B was
 *   weighted by (CardContext.goal: the settings the numbers were computed with); the card's own numbers for the version
 *   that is the card's trade (its final simulation), the step's or Plan B's for theirs.
 *
 * The chance a version goes through when the league's review could veto it (throughText) is said when it prints
 * differently from the chance they accept ("about 20%", or "under 5%" when it prints "<5%": review of Phase 4b, "5% …
 * about 5% it goes through" next to a reason saying the veto halves the chance); nothing more when both print the same.
 *
 * The Trade Analyzer's card also has "Details" (DetailsView): since the planner's reply to Checkpoint 7a (§2 question 5 and
 * 5.4) what Helps you is worth in projected points a week, no trade value figure: in a redraft league B's market term as
 * its lineup equivalent ("Trade value: −0.4 pts/week equivalent.", TradeEvaluation.marketWeekly, left out when B has no
 * market term), what dynasty and keeper leagues count instead, and what Helps you is worth in lineup points (planner
 * reply to Checkpoint 4c, A2: "≈ +X pts/week", X = 3 × B / B₃: lineupEquivalentText, on the scale's mix in a dynasty or
 * keeper league with long-term values), every score there on the evaluation's own B₃ (TradeEvaluation.b3). Phases 4c to
 * 7a listed the model's own trade-value figures there (both sides' g_mkt, the partner's perceived g). ⚠️ The points a week
 * stay a points figure only while no page prints the rate between trade value and points (review of Phase 7b, a planner
 * question): Settings' "Protect my trade value" help says what the setting does without one (settingsView.ts
 * PROTECT_VALUE_HELP), since "25% more trade value costs about 0.4 points a week" beside this line read back as the
 * trade's value comparison (κ × g_mkt(me) ÷ κ).
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
 * any trade: 59% to make the playoffs, 9.9% to win the title.", the title with one decimal like the cards' odds) and the
 * Analyzer above its card ("before this trade"; the worker sends them with the evaluation), each with what they count.
 * Since Phase 4c (planner reply to Checkpoint 4b, change 9: "one baseline everywhere") they are the League page's
 * headline odds, every team after the free-agent pickups that would help it (LeagueModel.odds; the trade context's
 * baseline equals them exactly), and every card's odds start from them. Under them, once per page, what "Helps you"
 * sums up (helpsInfoText: the planner's "Helps you (0–100) sums up how much your title and playoff odds rise, minus a
 * cost for giving away trade value.", ⚠️ with "or plus a credit for gaining it" since the final review of Phase 4c, finding
 * R4: B's market term works both ways, and on Parker's league a trade that gains value scored 23 from 14 on its odds
 * alone; ⚠️ ours: in dynasty and keeper leagues, weighed against long-term value instead,
 * and the odds alone when there's nothing to weigh them against: a redraft league while FantasyCalc's values aren't
 * available, when B has no market term, or a dynasty or keeper league whose long-term values didn't load,
 * TradeEvaluation.dynMissing; review of track UIC, finding 2). The pages' "How to read" says the same (valueFactsOf).
 *
 * The Finder (buildFinderView): the pattern note above the list when the search found one (planner reply to Checkpoint
 * 4b, change 6; TradeSearchResult.pattern, its text as the engine wrote it); "Chance they accept: at least" (change 10,
 * minChanceOptions: Any, 10% … 50%, config.ranking.minChanceOptions) is the page's control, with a note naming the
 * league's review when it has one (minChanceNote: the minimum reads the chance the trade goes through), and when the
 * search says the minimum leaves few ideas (TradeSearchResult.filter.few: fewer than config.ranking.minChanceFew shown,
 * and a lower setting would show more) a line says so and suggests a lower setting (fewText); what the minimum left out
 * joins the hidden line ("3 trade ideas below your minimum chance"). Its empty state says why there's nothing: the search's notes
 * when it stopped before screening anything (no team, season over, deadline passed, no odds, must-include players that
 * can't work: TradeSearchResult.counts.screened 0), else that no idea reaches the minimum chance, else what the guards
 * left out ("No trade ideas that help you"), else that nothing was found. Notes that didn't stop the search (the K/D/ST
 * note almost always) stay in the notes list; a saved FantasyCalc list standing in ("Trade values from Sep 27: FantasyCalc
 * didn't answer.", FantasyCalcLookup.note) joins them, since the cards' numbers rest on its values.
 * Planner reply to Checkpoint 7a, 5.3 (finderTimingLines): in season (once a game of the league's first week has kicked
 * off, and while a week is left before the deadline), when to look ("Best time to look: Tuesday or Wednesday, after Monday
 * night's game. …", bestTimeText, with the league's review period: reviewPeriodWords) and how fresh the data is ("Trade
 * values updated 2 hours ago · Projections updated 5 hours ago.", freshnessText), both read at the current time.
 *
 * Numbers print like the League page's (src/lib/format.ts): one decimal for points per week, whole percents, a real minus
 * sign. No trade value is ever printed (the card's facts above). No jargon ("EV", "σ", "V*", "g_mkt" never appear).
 *
 * Also here: the Finder's list (buildFinderView: the cards in the chosen sort through rank.ts sortTrades, the hidden
 * counts, notes and warnings, the empty states), the search's progress in words (progressView; a re-filter's shows the
 * ranking alone), the Analyzer's choices (analyzerChoices) and the links between the pages (finderHref, analyzerHref and
 * what they carry back: a team id and player ids only, never league ids or names; ⚠️ a URL query, as M13 says, so the
 * server that serves the page sees those ids like any address: the privacy page says so).
 */
import { displayAcceptance, tradeDeadlinePassed } from "@/engine/acceptance";
import { HELPS_AT_GAIN, HELPS_FLOOR_NOTE, HELPS_FLOOR_NOTE_PLAYOFFS, futureValuesLoaded, lineupEquivalent, tradeScore, type HelpsScale } from "@/engine/benefit";
import { blendValues } from "@/engine/blend";
import { config } from "@/engine/config";
import type { TradeAnalysis } from "@/engine/evaluate";
import { fantasyCalcComparison, injuryTags, myFantasyCalcGain } from "@/engine/explain";
import type { MarketInputs, ModelInputs, NflScheduleInputs } from "@/engine/inputs";
import { fantasyCalcFallbackText, valuesForTerm } from "@/engine/market";
import { POSITIONS, type InjuryStatus, type LeagueSettings, type LeagueSnapshot, type PlayerInfo, type Pos } from "@/engine/model";
import { sortTrades } from "@/engine/rank";
import type { Goal, TradeSettings } from "@/engine/settings";
import type {
  AcceptanceFeatures,
  InjuryTag,
  OpenSpot,
  PlanB,
  PremiumFact,
  RosterChange,
  TradeAsset,
  TradeDetail,
  TradeEvaluation,
  TradeProposal,
  TradeSearchProgress,
  TradeSearchResult,
  TradeSearchStage,
  TradeSort,
  TradeStep,
} from "@/engine/tradeModel";
import { feedbackFor, type FeedbackOutcome, type FeedbackReason, type FeedbackRecord, type FeedbackSent, type FeedbackVersion, type HelpsReason, type VersionInputs } from "./feedbackStore";
import { fmtNum, fmtSigned, fmtWhole, plural } from "./format";
import { modelWarningRule } from "./notices";
import { INJURY_LABEL, PLATFORM_LABEL, posLabel } from "./labels";

/** What the views read of the snapshot; currentWeek (the injury tags' week now) is optional so partial fixtures fit. */
export type SnapshotPart = Pick<LeagueSnapshot, "platform" | "teams" | "players" | "settings"> & Partial<Pick<LeagueSnapshot, "currentWeek">>;

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
  if (p < 1 && p >= 0.995) return ">99%";
  return `${Math.round(p * 100)}%`;
}

/** Under the display's step (config.acceptance.displayStep, 5%): an estimate the card prints as "<5%" (planner reply to Checkpoint 4b, answer 5). */
function underStep(p: number): boolean {
  return Number.isFinite(p) && p < config.acceptance.displayStep - 1e-9;
}

/**
 * An acceptance estimate as shown (§11: the nearest 5%), "<5%" for a model value under 5%: never rounded up to the step
 * (planner reply to Checkpoint 4b, answer 5). acceptance.displayAcceptance's number, which the minimum-chance filter and
 * the label read, is unchanged: only the words are.
 */
export function acceptText(p: number): string {
  if (underStep(p)) return `<${Math.round(config.acceptance.displayStep * 100)}%`;
  return `${Math.round(displayAcceptance(p) * 100)}%`;
}

/** The same for screen readers: "under 5%" for "<5%", else the printed percent. */
export function acceptSrText(p: number): string {
  return underStep(p) ? `under ${Math.round(config.acceptance.displayStep * 100)}%` : acceptText(p);
}

/**
 * The chance a version goes through when the league's review could veto it, next to the chance they accept (the file
 * header): "about 20%" when it prints differently, "under 5%" when it prints "<5%" and the chance they accept doesn't;
 * null when both print the same (the reason that the league reviews trades says the rest).
 */
export function throughText(pAccept: number, pComplete: number): string | null {
  if (!Number.isFinite(pComplete) || acceptText(pComplete) === acceptText(pAccept)) return null;
  return underStep(pComplete) ? acceptSrText(pComplete) : `about ${acceptText(pComplete)}`;
}

/** A title chance with one decimal, as the planner writes it ("12.1%"); "<0.1%" and ">99.9%" when it only rounds there. */
export function titleOddsText(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p > 0 && p < 0.0005) return "<0.1%";
  if (p < 1 && p >= 0.9995) return ">99.9%";
  return `${(Math.min(1, Math.max(0, p)) * 100).toFixed(1)}%`;
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

/** A name's possessive: "Team 2's", "Gravel Gophers'" (a name ending in s takes the apostrophe alone). */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

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
  /**
   * On a trade card: his injury tag in words (planner reply to Checkpoint 4, change 6; injuryTagText: "Out — expected back
   * week 8"), with its tone; null when he isn't tagged; absent outside a card.
   */
  status?: { text: string; tone: InjuryTone } | null;
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

// ---------------------------------------------------------------------------------------------
// Injury tags (planner reply to Checkpoint 4, change 6; the file header)

/** A tag's status in words. */
const TAG_WORDS: Readonly<Record<InjuryTag["status"], string>> = {
  PROBABLE: "Probable",
  QUESTIONABLE: "Questionable",
  DOUBTFUL: "Doubtful",
  OUT: "Out",
  IR: "On IR",
  PUP: "On the PUP list",
  SUSPENDED: "Suspended",
  NA: "Not an active NFL player",
};

/** Game-time statuses (he may play this week): a return week on such a tag is the platform's far date his projection follows. */
const GAME_TIME: ReadonlySet<InjuryTag["status"]> = new Set<InjuryTag["status"]>(["PROBABLE", "QUESTIONABLE", "DOUBTFUL"]);

/** Statuses of a player I'd get that the card's once-per-card sentence covers: an injury (not a suspension, not NA). */
const INJURED_NOTE: ReadonlySet<InjuryTag["status"]> = new Set<InjuryTag["status"]>(["PROBABLE", "QUESTIONABLE", "DOUBTFUL", "OUT", "IR", "PUP"]);

/**
 * An injury tag in words (the file header): his status, and his return week when the tag carries one (explain.injuryTags
 * keeps it only when his projection counts on it): "Out — expected back week 8" ("Suspended — back week 8": a
 * suspension's end is known), or "Out for the season" ("Suspended for the season") when it comes after `seasonEnd`
 * (seasonEndOf); without a season end, the week is said. A Probable, Questionable or Doubtful tag with a week is the
 * platform's far return date his projection follows (§6 step 3's conflict), said as the platform's (`source`, "ESPN"):
 * "Questionable — ESPN expects him back week 8", "Questionable — ESPN expects him out for the season". NA never says a
 * week.
 */
export function injuryTagText(tag: Pick<InjuryTag, "status" | "returnWeek">, seasonEnd?: number, source?: string): string {
  const base = TAG_WORDS[tag.status] ?? "Injured";
  const r = tag.returnWeek;
  if (tag.status === "NA" || r === undefined || !Number.isFinite(r)) return base;
  const afterSeason = seasonEnd !== undefined && Number.isFinite(seasonEnd) && r > seasonEnd;
  if (GAME_TIME.has(tag.status)) {
    const who = source ? `${source} expects him` : "expected";
    return `${base} — ${who} ${afterSeason ? "out for the season" : `back week ${r}`}`;
  }
  if (afterSeason) return tag.status === "SUSPENDED" ? "Suspended for the season" : "Out for the season";
  return `${base} — ${tag.status === "SUSPENDED" ? "back" : "expected back"} week ${r}`;
}

/** Whose return dates a league's tags quote (injuryTagText's `source`): the platform's name; none for a manual league. */
function dateSourceOf(snapshot: Pick<LeagueSnapshot, "platform">): string | undefined {
  return snapshot.platform === "manual" ? undefined : PLATFORM_LABEL[snapshot.platform];
}

/**
 * A trade's injury tags (the file header): the evaluation's own (the search's and the Analyzer's, which know which
 * conflicted players follow their date), else explain.injuryTags from the snapshot with the week now (an evaluation
 * without them: no such date).
 */
function tagsOf(e: Pick<TradeEvaluation, "proposal" | "flags">, snapshot: SnapshotPart): InjuryTag[] {
  return e.flags.tagged ?? injuryTags(e.proposal, snapshot.players, { currentWeek: snapshot.currentWeek });
}

/**
 * The last week a return can come in time to count, for "Out for the season": the NFL regular season's last week when
 * the schedule gave it (ModelInputs.nfl.lastWeek: a return week after it is ESPN's out-for-season marker, §4), else ⚠️ the
 * league's last fantasy week (a return after it plays no game for this league); undefined when neither is known.
 */
export function seasonEndOf(settings: Pick<LeagueSnapshot["settings"], "regularSeasonWeeks" | "playoffWeeks">, lastNflWeek?: number): number | undefined {
  if (lastNflWeek !== undefined && Number.isFinite(lastNflWeek)) return lastNflWeek;
  const weeks = [...settings.regularSeasonWeeks, ...settings.playoffWeeks].filter((w) => Number.isFinite(w));
  return weeks.length ? Math.max(...weeks) : undefined;
}

/**
 * What a hurt player's projection assumes (the file header), for one player or several: "blended with the trade market"
 * only while the blend is on (`blendOn`: CardContext.blendOn, marketBlendOn; review of track UIC, finding 3: the cards said
 * so in FantasyCalc's curve fallback, without FantasyCalc, and in a dynasty league without this season's list, next to
 * the page's warning that the blend was off).
 */
function assumesFullReturn(several: boolean, blendOn = true): string {
  const blend = blendOn ? ", blended with the trade market" : "";
  return several ? `their projections assume they return at full strength${blend}.` : `his projection assumes he returns at full strength${blend}.`;
}

/**
 * The card's once-per-card sentence for the players I'd get who carry an injury tag (the file header): "Josh Jacobs: his
 * projection assumes he returns at full strength, blended with the trade market." (their projections, for several;
 * without the blend's words while the blend is off: `blendOn`, assumesFullReturn); null when none does. `flagged` (the
 * "Depends on an injured player" flag's players, TradeEvaluation.flags.injured) are left out: the flag says it for them
 * (review of Phase 4b).
 */
export function incomingInjuryNote(tags: readonly InjuryTag[], snapshot: Pick<LeagueSnapshot, "players">, flagged: readonly string[] = [], blendOn = true): string | null {
  const names = tags
    .filter((t) => t.side === "get" && INJURED_NOTE.has(t.status) && !flagged.includes(t.playerId))
    .map((t) => snapshot.players[t.playerId]?.name ?? "A player who's no longer in this league's data");
  if (!names.length) return null;
  return `${listText(names)}: ${assumesFullReturn(names.length > 1, blendOn)}`;
}

/**
 * explain.ts's caveat for a trade that depends on an injured player ("Depends on an injured player: … and the numbers
 * assume he returns as expected."): the card's flag says it, with what his projection assumes, so the card's reasons
 * leave it out (the file header). ⚠️ Matched on the engine's words: should they change, the caveat just shows again.
 */
export const INJURED_REASON = /^Depends on (an injured player|injured players): /;

/** "Bo Nix (QB, DEN)" for sentences. */
function playerPhrase(id: string, snapshot: SnapshotPart): string {
  const info = snapshot.players[id];
  if (!info) return "a player who's no longer in this league's data";
  return `${info.name} (${posLabel(info.pos, snapshot.platform)}, ${info.nflTeam ?? "no NFL team"})`;
}

/** A position in a sentence: "RB", "kicker", "punter", "D/ST" on ESPN (posLabel, the platform's own word elsewhere). */
function positionWord(pos: Pos, platform: SnapshotPart["platform"]): string {
  return pos === "K" ? "kicker" : pos === "P" ? "punter" : posLabel(pos, platform);
}

/**
 * One roster spot a trade opened, in a sentence (RosterChange.openSpots; Phase 7c, planner reply to Checkpoint 7b, section
 * 5), after `lead` ("Open roster spot: add", or "Team 4's open roster spot: they'd add"): "Open roster spot: add Tyler
 * Allgeier, the best available RB." (the planner's words: his name alone, the position following); with no free agent at
 * a position the trade left short, the best at any position: "…, the best available free agent (no TE is available)."
 * (OpenSpot.short, "no RB or TE is"), or without the parentheses when no such position was left (a position the side
 * streams, say). On the partner's side, a fill that takes one of my own baseline pickups says so (OpenSpot.yours; review of
 * Phase 7c's fill, finding pickups-4: nothing else on the card told me a rival gets him): "…, the best available WR, the
 * pickup the League page suggests for you." And when the side drops him again from the week an IR player of its comes
 * back (RosterChange.displaced: the spot is the returner's then), the return is part of the sentence, not a drop of its own
 * (review of Phase 7c's fill, finding pickups-3: "they'd add Tyler Allgeier" and two lines on "would drop Tyler
 * Allgeier" read like a mistake): "…, the best available RB, until Jonah Coleman comes back from IR in week 7." ⚠️ The
 * fill is chosen on his value over every remaining week, though he plays only until then (the displacement counts in
 * final evaluations only: evaluate.ts's header, "IR players").
 */
function openSpotText(spot: OpenSpot, lead: string, snapshot: SnapshotPart, until?: { returner: string; week: number }): string {
  const plain = (id: string) => snapshot.players[id]?.name ?? "a player who's no longer in this league's data";
  const short = [...new Set(spot.short ?? [])].map((p) => positionWord(p, snapshot.platform));
  const none = short.length ? ` (no ${short.length === 1 ? short[0] : `${short.slice(0, -1).join(", ")} or ${short.at(-1)}`} is available)` : "";
  const best = spot.pos !== null ? `the best available ${positionWord(spot.pos, snapshot.platform)}` : `the best available free agent${none}`;
  const yours = spot.yours === true ? ", the pickup the League page suggests for you" : "";
  const back = until ? `, until ${plain(until.returner)} comes back from IR${Number.isFinite(until.week) ? ` in week ${until.week}` : ""}` : "";
  return `${lead} ${plain(spot.playerId)}, ${best}${yours}${back}.`;
}

// ---------------------------------------------------------------------------------------------
// The card

export interface NumberView {
  /** What's printed ("57", "45%", "—"). */
  value: string;
  /** The same for screen readers when the print alone is unclear ("not scored"); null when the print says it. */
  srText: string | null;
  /** A tooltip saying what the number means: Helps you's scale (HELPS_SCALE_TEXT; planner reply to Checkpoint 4c, A2). Absent: none. */
  title?: string;
}

export interface FlagView {
  kind: "injured" | "market" | "hiddenByMarket" | "noHelp" | "noOdds";
  text: string;
}

export interface FactView {
  label: string;
  value: string;
}

/** One step of "How to offer it" (TradeEvaluation.steps; the file header). */
export interface StepView {
  /** "Offer first:" or "If they say no, add" (bold on the card). */
  lead: string;
  /** The first offer in words ("Wiggleton Spoons for Cornelius Snoot"), or the player to add ("Tobias Thimble"). */
  what: string;
  /** "Est. 35%": the chance they accept, rounded like the card's (kept on one line; "Est. <5%" under 5%). */
  est: string;
  /**
   * "about 20% it goes through" when the league's review could veto this version and that prints differently ("under 5%
   * it goes through" when it prints "<5%": throughText); else null.
   */
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

/** "If they say no, try:" (TradeEvaluation.planB; the file header). */
export interface PlanBView {
  /** "If they say no, try:". */
  heading: string;
  /** "The same players of theirs, a different package" or "A different set of their players". */
  kindText: string;
  /**
   * My players in words ("Wiggleton Spoons and Tobias Thimble"; "nothing"), and theirs, each injury-tagged one with his tag
   * in words after his name ("Dallas Goedert (Out — expected back week 5)").
   */
  give: string;
  get: string;
  /** "Helps you 45 · Chance they accept 40% (Est. · Decent) · Overall 20". */
  numbers: string;
  /**
   * The same three numbers one by one, each kept on one line by the card (review of Phase 4b: a 375 px break inside "(Est.
   * · Likely)"), the estimate's label apart so a 320 px phone can still wrap before it: [{ text: "Helps you 45" }, { text:
   * "Chance they accept 40%", label: "(Est. · Decent)" }, { text: "Overall 20" }].
   */
  numberParts: { text: string; label?: string }[];
  /**
   * "Counting a league veto vote, about 20% it goes through." when the veto rule cuts it and that prints differently
   * ("under 5%" below the display's floor: throughText); else null.
   */
  acceptNote: string | null;
  /**
   * Phase 4c (planner reply to Checkpoint 4b, change 9, "real odds on every card"): its title and playoff odds before and
   * after, as the card prints its own (oddsViews: before = the card's, the search's baseline; after = before + Plan B's own
   * ΔCH or ΔPO, from its final-block simulation); empty when the Plan B carries none (PlanB.dPO and dCH absent).
   */
  odds: OddsView[];
  /** Its weeks whose win chance moves (weeklyLine on PlanB.winChance, the card's rule), or null. */
  weekly: WeeklyLineView | null;
  /** "Also shown as trade idea 6." when the Finder's list shows the same trade as a card of its own (its place in the sort shown); else null. */
  also: string | null;
  /** Its own message to send them (planBPitch): a follow-up naming this trade from their side. */
  pitch: string;
  /** The Trade Analyzer, prefilled with it and marked as a Plan B (`from=planB`: shown there as one offer, without "How to offer it"). */
  analyzerHref: string;
  /** Its trade key. */
  key: string;
  /** The whole Plan B in one line (tests, hover): "Wiggleton Spoons for Mortimer Gloop · Helps you 45 · …". */
  text: string;
}

/**
 * One version of a trade idea the user may have sent (the feedback's "Which version did you send?"), with its words and
 * (Phase 4c, FeedbackSent.inputs) its model inputs.
 */
export interface VersionChoice extends FeedbackSent {
  /** "The first offer", "With Tobias Thimble added", "This trade" or "The “If they say no” trade". */
  label: string;
}

/** One of my odds next to "Helps you" (the file header; planner reply to Checkpoint 4b, change 9). */
export interface OddsView {
  /** "Title odds" or "Playoff odds". */
  label: string;
  /** "12.1% → 13.4%"; "+1.3 percentage points" without my odds before any trade; "unknown". */
  value: string;
  /** The same for screen readers: "from 12.1% to 13.4%". */
  srValue: string;
}

/** "Win chance by week: Week 9: 68% → 64% · Week 13: 42% → 55%" (the file header). */
export interface WeeklyLineView {
  label: string;
  /** The weeks shown, in week order: "Week 9: 68% → 64%", and for screen readers "week 9 from 68% to 64%". */
  weeks: { week: number; text: string; srText: string }[];
  /** The whole line. */
  text: string;
}

/** The Trade Analyzer's "Details" (the file header): what Helps you is worth in projected points a week. */
export interface DetailsView {
  /** "Details". */
  summary: string;
  /** What they are, in a sentence. */
  intro: string;
  items: string[];
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
  /** My title odds, then my playoff odds, before and after the trade (oddsViews), next to "Helps you". */
  odds: OddsView[];
  /** The weeks whose win chance the trade moves (weeklyLine), or null. */
  weekly: WeeklyLineView | null;
  /** The Trade Analyzer's "Details" (what Helps you is worth in points a week: detailsView); null on the Trade Finder's cards. */
  details: DetailsView | null;
  /** "How to offer it" (offer first, then what to add if they say no), or null when the trade has no steps. */
  steps: StepsView | null;
  /** "If they say no, try:" (Plan B), or null when the trade has none (it has steps, nothing qualified, or it's the Analyzer's). */
  planB: PlanBView | null;
  /**
   * Once per card, for injury-tagged players I'd get whom the "Depends on an injured player" flag doesn't name (the flag
   * says it for them): "Josh Jacobs: his projection assumes he returns at full strength, …"; else null.
   */
  injuryNote: string | null;
  /** The versions of the trade this card shows, in the card's order (the feedback asks which one was sent when there are two). */
  versions: VersionChoice[];
  flags: FlagView[];
  facts: FactView[];
  /**
   * The sentence before the card's "Values: FantasyCalc" link (VALUES_CREDIT_TEXT: the card's numbers weigh trade value,
   * §2.9's attribution next to data derived from FantasyCalc's values), or null when no trade values are behind them (none
   * loaded: CardContext.fantasyCalc neither available nor estimated).
   */
  valuesCredit: string | null;
  /** "You get 142 ROS pts, give 118" (§13). */
  ros: string;
  /**
   * When my starting lineup moves the other way from those ROS points (rosNoteOf): "Your starting lineup still gains 25 ROS
   * pts: …"; else null.
   */
  rosNote: string | null;
  /** The roster moves the trade forces (§7; Phase 4b's IR slots and returns too, and Phase 7c's open roster spots), in sentences; empty when none. */
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
  /** The NFL regular season's last week (ModelInputs.nfl.lastWeek), for "Out for the season" (seasonEndOf); absent: the league's last week. */
  lastNflWeek?: number | undefined;
  /**
   * Injury tags the search made for players on its other ideas (knownTagsOf), by player: a Plan B's player reads his tag
   * from there when the card doesn't have him (it knows his far ESPN date; PlanB carries no tags of its own).
   */
  knownTags?: ReadonlyMap<string, InjuryTag> | undefined;
  /**
   * FantasyCalc's values (fantasyCalcLookup, from the model inputs the page holds): never shown, they tell whether trade
   * values are behind the card's numbers (TradeCardView.valuesCredit), whether the roster spot is what trips the Market
   * check (marketCheckText), and what Details says without them. Absent: values are taken to be behind the numbers.
   */
  fantasyCalc?: FantasyCalcLookup | undefined;
  /**
   * The "Helps you" scale the numbers were scored on (TradeSearchResult.helpsScale, the Analyzer's TradeAnalysis.helpsScale):
   * its tooltip and the Details' lineup equivalent follow the mix in a dynasty or keeper league with long-term values
   * (helpsScaleText, lineupEquivalentText; planner reply to Checkpoint 7a, §2 question 6). Absent or null: read off the
   * league type and the evaluation (TradeEvaluation.dynMissing).
   */
  helpsScale?: HelpsScale | null | undefined;
  /**
   * Whether the market blend reaches anyone in this league (marketBlendOn, from the model inputs the page holds): a hurt
   * player's projection is "blended with the trade market" only then (assumesFullReturn; review of track UIC, finding 3).
   * Absent: on.
   */
  blendOn?: boolean | undefined;
  /**
   * "What matters most" as the numbers were computed (TradeSettings.goal of the search or the evaluation): saved with each
   * version's model inputs (VersionChoice.inputs). Absent: saved as unknown (null).
   */
  goal?: Goal | null | undefined;
  /** The Trade Analyzer's card: with "Details" (what Helps you is worth in points a week). */
  details?: boolean | undefined;
}

/** A 0–100 score as printed: its number; 0 for a trade that doesn't help me (B ≤ 0); "—" when B is unknown. */
function scoreView(score: number | null, b: number | null): NumberView {
  if (score !== null && Number.isFinite(score)) return { value: String(score), srText: null };
  if (b !== null && Number.isFinite(b) && b <= 0) return { value: "0", srText: null };
  return { value: "—", srText: "not scored: the season couldn't be simulated" };
}

/**
 * One of my odds next to "Helps you" (the file header): "12.1% → 13.4%" from my odds before any trade and the change the
 * trade makes (after = before + change, kept within 0–100%), each printed by `text`; the change alone in percentage points
 * when the odds before aren't known; "unknown" without the change.
 */
function oddsView(label: string, d: number | null, before: number | null | undefined, text: (p: number) => string): OddsView {
  if (d === null || !Number.isFinite(d)) return { label, value: "unknown", srValue: "unknown" };
  if (before === null || before === undefined || !Number.isFinite(before)) return { label, value: pointsChange(d), srValue: pointsChange(d) };
  const from = text(before);
  const to = text(Math.min(1, Math.max(0, before + d)));
  return { label, value: `${from} → ${to}`, srValue: `from ${from} to ${to}` };
}

/** My title odds (one decimal) and playoff odds (whole percents), before and after the trade (the file header). */
export function oddsViews(e: Pick<TradeEvaluation, "dPO" | "dCH">, baseline: CardContext["baseline"]): OddsView[] {
  return [oddsView("Title odds", e.dCH, baseline?.pTitle, titleOddsText), oddsView("Playoff odds", e.dPO, baseline?.pPlayoffs, percentText)];
}

/**
 * "Win chance by week" (the file header): from TradeDetail.winChance, the weeks whose chance to win moves at least
 * config.explain.weeklyLineMin, at most weeklyLineMax of them, shown in week order: ⚠️ the weeks it drops first, the
 * largest drop first, then the largest gains (ties: the earlier week; final review of Phase 4c, finding R8: the line is
 * there to show whether a trade just moves a bye problem to another week, and "the largest moves" hid a 3.9-point drop
 * behind two gains); null when none moves, the list is empty (a points-only league) or absent (no odds).
 */
export function weeklyLine(winChance: TradeDetail["winChance"], cfg: { readonly weeklyLineMin: number; readonly weeklyLineMax: number } = config.explain): WeeklyLineView | null {
  const moves: { week: number; before: number; after: number }[] = [];
  for (const w of winChance ?? []) {
    if (!w || !Number.isFinite(w.week) || w.before === null || w.after === null || !Number.isFinite(w.before) || !Number.isFinite(w.after)) continue;
    if (Math.abs(w.after - w.before) >= cfg.weeklyLineMin - 1e-9) moves.push({ week: w.week, before: w.before, after: w.after });
  }
  const change = (m: { before: number; after: number }) => m.after - m.before;
  const drops = moves.filter((m) => change(m) < 0).sort((a, b) => change(a) - change(b) || a.week - b.week);
  const gains = moves.filter((m) => change(m) >= 0).sort((a, b) => change(b) - change(a) || a.week - b.week);
  const top = [...drops, ...gains].slice(0, Math.max(0, Math.floor(cfg.weeklyLineMax))).sort((a, b) => a.week - b.week);
  if (!top.length) return null;
  const label = "Win chance by week";
  const weeks = top.map((w) => {
    const from = percentText(w.before);
    const to = percentText(w.after);
    return { week: w.week, text: `Week ${w.week}: ${from} → ${to}`, srText: `week ${w.week} from ${from} to ${to}` };
  });
  return { label, weeks, text: `${label}: ${weeks.map((w) => w.text).join(" · ")}` };
}

/**
 * Why a trade that doesn't help me (B ≤ 0: trade ideas leave it out, only the Analyzer shows it) doesn't, by what pulled
 * B down (§10). Review of Phase 4: "it wouldn't raise your chances this season" also showed on trades that do raise them,
 * whose B the trade-value term ("Protect my trade value", planner addendum to Checkpoint 3 §3) or long-term value pulled
 * to 0 or below, next to the card's own playoff odds rising.
 * - Dynasty and keeper leagues with long-term values (λ and B_future known, §10): this season against long-term value,
 *   weighed by the Win now ↔ Future setting.
 * - Redraft: my chances go up (B_win > 0) while I'd give up more trade value than I get by the model's count (g_mkt(me) <
 *   0: every player at max(v, W), the roster-spot credit, the neutral throw-ins; ⚠️ "counting roster spots", since the
 *   card's own values are FantasyCalc's, which can read differently) → that trade value, weighed by "Protect my trade
 *   value". The market term reads that same g_mkt(me), so a B ≤ 0 with B_win > 0 always has g_mkt(me) < 0; only numbers
 *   that break that rule fall back to "overall", which stays true.
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
      ? `Doesn't help you overall: it raises your chances this season, but counting roster spots, you'd give up more trade value than that's worth at your “Protect my trade value” setting, ${leave}`
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

/** "an estimated 35% chance they accept"; "an estimated chance under 5% that they accept" for "<5%". */
function acceptSrPhrase(p: number): string {
  return underStep(p) ? `an estimated chance ${acceptSrText(p)} that they accept` : `an estimated ${acceptText(p)} chance they accept`;
}

/**
 * A step's estimate, the way the card shows its own: the chance they accept ("<5%" under 5%), and the chance it goes
 * through when the league's review could veto that version, only when it prints differently ("Est. 5%, about 5% it goes
 * through" said nothing more; the card's own note already says a veto vote could stop the ranked trade; throughText).
 */
function stepAccept(s: Pick<TradeStep, "pAccept" | "pComplete">): { est: string; through: string | null; sr: string } {
  const est = acceptText(s.pAccept);
  const through = throughText(s.pAccept, s.pComplete);
  if (!through) return { est: `Est. ${est}`, through: null, sr: acceptSrPhrase(s.pAccept) };
  return { est: `Est. ${est}`, through: `${through} it goes through`, sr: `${acceptSrPhrase(s.pAccept)}, ${through} that it goes through` };
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

/** Plan B's heading on the card (the planner's words). */
export const PLAN_B_HEADING = "If they say no, try:";

/**
 * Which kind of Plan B it is (review of track F: "Different players of theirs" read wrong for a Plan B that keeps one of
 * the card's players, such as Luther Burden III alone for Burden and Kalif Raymond).
 */
const PLAN_B_KIND: Readonly<Record<PlanB["kind"], string>> = {
  samePlayers: "The same players of theirs, a different package",
  otherTarget: "A different set of their players",
};

/**
 * What planBView reads besides the Plan B: the card's own injury tags, the search's tags for its other ideas
 * (CardContext.knownTags), the season's end (seasonEndOf), and my odds before any trade (CardContext.baseline: the box's
 * odds start from the card's "before"; absent, they show the change in percentage points, as the card's do).
 */
export interface PlanBContext {
  cardTags?: readonly InjuryTag[] | undefined;
  knownTags?: ReadonlyMap<string, InjuryTag> | undefined;
  seasonEnd?: number | undefined;
  baseline?: CardContext["baseline"];
}

/**
 * The Plan B's own message to send them (PlanBView.pitch; review of Phase 4b: the box had none, and the Analyzer's
 * proposed a smaller first offer): templates only, like explain.ts's pitch, which it follows — no team name, the trade
 * named from their side, never what I gain — as a follow-up to the trade they turned down ("Thanks for considering it!
 * Would you trade Carnell Tate for Kyle Monangai and Bo Nix instead? Let me know what you think!"). ⚠️ PlanB carries no
 * partner-side facts (the hole it fills, their lineup's gain), so it doesn't lead with them; the Trade Analyzer's message
 * for the same trade (its "Open in Analyzer") does.
 */
export function planBPitch(p: Pick<TradeProposal, "give" | "get">, snapshot: SnapshotPart): string {
  const names = (assets: readonly TradeAsset[]) => listText(assets.map((a) => assetView(a, snapshot).name));
  let ask = "";
  if (p.give.length && p.get.length) ask = `Would you trade ${names(p.get)} for ${names(p.give)} instead?`;
  else if (p.get.length) ask = `Would you send me ${names(p.get)} instead?`;
  else if (p.give.length) ask = `Would you take ${names(p.give)} instead, with nothing needed back?`;
  return ["Thanks for considering it!", ask, "Let me know what you think!"].filter((s) => s.length > 0).join(" ");
}

/**
 * "If they say no, try:" (TradeEvaluation.planB; the file header), or null without one: the trade in words (each
 * injury-tagged player with his tag: the card's own tag for a player the card has on the same side, so a player reads the
 * same in both places, else the search's tag for him on another idea (`knownTags`: it knows his far ESPN date), else
 * explain.injuryTags from the snapshot with the week now; ⚠️ PlanB carries no tags of its own, so a conflicted Probable,
 * Questionable or Doubtful player only Plan B has gets no far date), which kind it is, its three numbers as the card prints
 * its own (Helps you, the chance they accept rounded to 5% with "Est." and its label, Overall), the chance it goes
 * through when a veto could cut it (throughText), its odds and weekly line as the card prints its own (Phase 4c, change 9:
 * oddsViews from the card's "before", `ctx.baseline`, and weeklyLine; none when the Plan B carries no odds), its own
 * message (planBPitch) and its Analyzer link (marked `from=planB`). `also` is the Finder list's to fill (buildFinderView).
 */
export function planBView(planB: TradeEvaluation["planB"], snapshot: SnapshotPart, ctx: PlanBContext = {}): PlanBView | null {
  if (!planB) return null;
  const own = injuryTags(planB.proposal, snapshot.players, { currentWeek: snapshot.currentWeek });
  const source = dateSourceOf(snapshot);
  const named = (a: TradeAsset, which: InjuryTag["side"]): string => {
    const name = assetView(a, snapshot).name;
    if (a.kind !== "player") return name;
    const known = ctx.knownTags?.get(a.id);
    const t = ctx.cardTags?.find((x) => x.playerId === a.id && x.side === which) ?? (known ? { ...known, side: which } : undefined) ?? own.find((x) => x.playerId === a.id && x.side === which);
    return t ? `${name} (${injuryTagText(t, ctx.seasonEnd, source)})` : name;
  };
  const side = (assets: readonly TradeAsset[], which: InjuryTag["side"]) => (assets.length ? listText(assets.map((a) => named(a, which))) : "nothing");
  const numberParts = [{ text: `Helps you ${planB.tradeScore}` }, { text: `Chance they accept ${acceptText(planB.pAccept)}`, label: `(Est. · ${planB.acceptLabel})` }, { text: `Overall ${planB.overall}` }];
  const numbers = numberParts.map((p) => (p.label ? `${p.text} ${p.label}` : p.text)).join(" · ");
  const through = throughText(planB.pAccept, planB.pComplete);
  const acceptNote = through ? `Counting ${REVIEW_WORDS[snapshot.settings.tradeReview]}, ${through} it goes through.` : null;
  const give = side(planB.proposal.give, "give");
  const get = side(planB.proposal.get, "get");
  // Its odds as the card prints its own (change 9), from the card's "before": none when the Plan B carries none.
  const odds = planB.dPO !== undefined || planB.dCH !== undefined ? oddsViews({ dPO: planB.dPO ?? null, dCH: planB.dCH ?? null }, ctx.baseline) : [];
  const weekly = weeklyLine(planB.winChance);
  const oddsText = [...odds.map((o) => `${o.label} ${o.value}`), ...(weekly ? [weekly.text] : [])].map((t) => ` · ${t}`).join("");
  return {
    heading: PLAN_B_HEADING,
    kindText: PLAN_B_KIND[planB.kind],
    give,
    get,
    numbers,
    numberParts,
    acceptNote,
    odds,
    weekly,
    also: null,
    pitch: planBPitch(planB.proposal, snapshot),
    analyzerHref: analyzerHref(planB.proposal, { from: "planB" }),
    key: planB.key,
    text: `${give} for ${get} · ${numbers}${acceptNote ? ` · ${acceptNote}` : ""}${oddsText}`,
  };
}

/** "Also shown as trade idea 6." (PlanBView.also). */
export function planBAlsoText(place: number): string {
  return `Also shown as trade idea ${place}.`;
}

/** The "Helps you" scale a card's versions share (TradeEvaluation.b3 and why it departs from 63; helpsReasonOf). */
interface ScaleInputs {
  b3: number | null;
  helpsReason: HelpsReason | null;
}

/**
 * Why a card's "Helps you" scale departs from "+3 points a week reads 63" (benefit.ts HelpsScale.reason; Phase 7a, the
 * feedback's version inputs: track SC's crossTrack for FB), read off the evaluation's notes, which carry
 * benefit.helpsScaleNotes for its scale (evaluate.ts simulateTrade, on every simulated evaluation: the Finder's cards and
 * the Analyzer's): "odds" for the floor note (title or playoff odds barely move), else null. (Checkpoint 7a's "lambda", the
 * Win now ↔ Future note, went with its λ cap: planner reply to Checkpoint 7a, §2 question 6.) The engine keeps HelpsScale out
 * of TradeEvaluation, so the words are its record here; tradeView.test.ts checks this reads back every reason
 * helpsScaleNotes writes.
 */
export function helpsReasonOf(notes: readonly string[] | undefined): HelpsReason | null {
  if (!notes) return null;
  if (notes.some((n) => n === HELPS_FLOOR_NOTE || n === HELPS_FLOOR_NOTE_PLAYOFFS)) return "odds";
  return null;
}

/**
 * A version's model inputs for the feedback (the file header; FeedbackSent.inputs): its acceptance features, raw
 * g_mkt(P), B, the goal B was weighted by, and (Phase 7a) the card's B₃ and the scale's reason, which every version of a
 * card shares (its steps and its Plan B are scored on the card's B₃). feedbackStore.ts keeps only finite numbers.
 */
function versionInputs(x: { features?: AcceptanceFeatures | undefined; gPartner?: number | undefined; b: number | null }, goal: Goal | null, scale: ScaleInputs): VersionInputs {
  return {
    features: x.features ? { ...x.features } : null,
    gPartner: typeof x.gPartner === "number" && Number.isFinite(x.gPartner) ? x.gPartner : null,
    b: x.b !== null && Number.isFinite(x.b) ? x.b : null,
    goal,
    b3: scale.b3,
    helpsReason: scale.helpsReason,
  };
}

/**
 * The versions of a trade idea its card shows (TradeCardView.versions; the feedback's "Which version did you send?"),
 * each with its key, estimate and model inputs (the file header: the card's own when the version is the card's trade,
 * else the step's or Plan B's; `goal`: "What matters most" as the numbers were computed, null when unknown; the card's B₃
 * and its scale's reason, helpsReasonOf, for every version): with steps, the first offer and the full version (the
 * throw-in added); with a Plan B, this trade and Plan B's; else this trade alone ("full").
 */
export function versionChoices(
  e: Pick<TradeEvaluation, "key" | "pAccept" | "pComplete" | "steps" | "planB" | "features" | "gPartner" | "b"> & Partial<Pick<TradeEvaluation, "b3" | "detail">>,
  snapshot: SnapshotPart,
  goal: Goal | null = null,
): VersionChoice[] {
  const scale: ScaleInputs = { b3: typeof e.b3 === "number" && Number.isFinite(e.b3) && e.b3 > 0 ? e.b3 : null, helpsReason: helpsReasonOf(e.detail?.notes) };
  const own = versionInputs(e, goal, scale);
  const of = (step: TradeStep): VersionInputs => (step.key === e.key ? own : versionInputs(step, goal, scale));
  const s = e.steps;
  if (s) {
    return [
      { version: "offerFirst", key: s.offerFirst.key, pAccept: s.offerFirst.pAccept, pComplete: s.offerFirst.pComplete, inputs: of(s.offerFirst), label: "The first offer" },
      { version: "full", key: s.ifNo.full.key, pAccept: s.ifNo.full.pAccept, pComplete: s.ifNo.full.pComplete, inputs: of(s.ifNo.full), label: `With ${assetView({ kind: "player", id: s.ifNo.add }, snapshot).name} added` },
    ];
  }
  const self: VersionChoice = { version: "full", key: e.key, pAccept: e.pAccept, pComplete: e.pComplete, inputs: own, label: "This trade" };
  const p = e.planB;
  return p ? [self, { version: "planB", key: p.key, pAccept: p.pAccept, pComplete: p.pComplete, inputs: versionInputs(p, goal, scale), label: "The “If they say no” trade" }] : [self];
}

// ---------------------------------------------------------------------------------------------
// FantasyCalc's values on the page: never shown (planner reply to Checkpoint 7a, 5.4)

/**
 * FantasyCalc's values as the page holds them (the file header), from the model inputs (ModelInputs.market): a player's
 * value in the league's perception list (market.valuesForTerm "perception": a keeper league's redraft list, else the
 * format's own), when it is a positive finite number, else null. `available` false (every value null) while the trade
 * values are our own estimates (MarketInputs.fallback "curve") or none loaded. ⚠️ The engine's rule for the reasons
 * (evaluate.ts explainContextOf: a player whose PlayerModel.value comes from FantasyCalc, market.marketValues). Never
 * printed: it says whether trade values are behind the card's numbers (TradeCardView.valuesCredit), whether the roster spot
 * is what trips the Market check (marketCheckText), and what the pages say without them.
 */
export interface FantasyCalcLookup {
  available: boolean;
  value: (playerId: string) => number | null;
  /** "Trade values from Sep 27: FantasyCalc didn't answer." while a saved list stands in (MarketInputs.fallback "saved"); else null. */
  note: string | null;
  /** True while the trade values are our own estimates (MarketInputs.fallback "curve"; the Analyzer's "Details" says so). */
  estimated?: boolean | undefined;
}

const NO_FANTASYCALC: FantasyCalcLookup = { available: false, value: () => null, note: null };

export function fantasyCalcLookup(market: MarketInputs | null | undefined): FantasyCalcLookup {
  if (!market) return NO_FANTASYCALC;
  if (market.fallback?.kind === "curve") return { ...NO_FANTASYCALC, estimated: true };
  const { values } = valuesForTerm(market, "perception");
  return {
    available: true,
    value: (id) => {
      const v = Object.prototype.hasOwnProperty.call(values, id) ? values[id] : undefined;
      return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
    },
    note: market.fallback?.kind === "saved" ? fantasyCalcFallbackText(market.fallback) : null,
  };
}

/**
 * Whether the market blend (§6 step 8) reaches anyone in this league, from the model inputs the page holds: blend.ts
 * blendValues, the engine's own test (this season's FantasyCalc list; none in FantasyCalc's curve fallback, without
 * FantasyCalc, or in a dynasty or keeper league whose list for this season didn't load), with a blend weight above 0 (blend.ts
 * marketBlend). ⚠️ League-wide: a player without a real FantasyCalc value, or at a position the blend doesn't reach, isn't
 * blended even while it's on (the file header). Review of track UIC, finding 3.
 */
export function marketBlendOn(market: MarketInputs | null | undefined, leagueType: LeagueSnapshot["settings"]["leagueType"]): boolean {
  return config.marketBlend.weight > 0 && blendValues(market, leagueType) !== null;
}

/**
 * What the pages' "How to read" says about trade values, long-term values and the market blend (HowToRead.tsx; review of
 * track UIC, findings 2 and 3), from the model inputs the page holds, by the engine's own tests.
 */
export interface ValueFacts {
  /** FantasyCalc's values loaded (fantasyCalcLookup: not in the curve fallback, nor without FantasyCalc), so Helps you counts trade value in a redraft league. */
  valuesOn: boolean;
  /** Dynasty and keeper leagues: long-term values loaded (benefit.futureValuesLoaded), so Helps you counts them; true in a redraft league. */
  longTermOn: boolean;
  /** The market blend reaches anyone (marketBlendOn). */
  blendOn: boolean;
}

export function valueFactsOf(market: MarketInputs | null | undefined, leagueType: LeagueSnapshot["settings"]["leagueType"]): ValueFacts {
  return {
    valuesOn: fantasyCalcLookup(market).available,
    longTermOn: leagueType === "redraft" || futureValuesLoaded(leagueType, market ?? null),
    blendOn: marketBlendOn(market, leagueType),
  };
}

/**
 * The sentence before the card's "Values: FantasyCalc" link (TradeCardView.valuesCredit; §2.9: a link next to anything worked
 * out from FantasyCalc's values; planner reply to Checkpoint 7a, 5.4: the values themselves are never shown).
 */
export const VALUES_CREDIT_TEXT = "These numbers weigh each player's trade value.";

/**
 * Whether trade values are behind a card's numbers (TradeCardView.valuesCredit): FantasyCalc's (fantasyCalcLookup
 * available) or our estimates fitted to an older list of theirs (the curve fallback: `estimated`); none when no values
 * loaded at all (every trade reads even then). Without the page's lookup (absent), yes.
 */
function valuesBehind(fc: FantasyCalcLookup | undefined): boolean {
  return !fc || fc.available || fc.estimated === true;
}

/**
 * The card's "Long-term value" fact in dynasty and keeper leagues, in words only (the file header: the model's ΔDyn rests on
 * FantasyCalc's dynasty values): which way my roster's long-term value moves, B_future / bFutureScale = ΔDyn / MyDynTotal
 * against config.explain.longTermMin (explain.ts's long-term reasons' cut), "Up for your roster", "Down for your roster" or
 * "About the same for your roster"; when long-term values didn't load, that they didn't; null in a redraft league or when
 * the evaluation has no ΔDyn.
 */
function longTermFact(e: Pick<TradeEvaluation, "dDyn" | "bFuture" | "dynMissing">): FactView | null {
  if (e.dDyn !== null && Number.isFinite(e.dDyn)) {
    const scale = config.benefit.bFutureScale;
    const share = e.bFuture !== null && Number.isFinite(e.bFuture) && scale > 0 ? e.bFuture / scale : e.dDyn > 0 ? 1 : e.dDyn < 0 ? -1 : 0;
    const min = config.explain.longTermMin;
    const value = share >= min - 1e-9 && Math.round(share * 100) !== 0 ? "Up for your roster" : share <= -min + 1e-9 && Math.round(share * 100) !== 0 ? "Down for your roster" : "About the same for your roster";
    return { label: "Long-term value", value };
  }
  if (e.dynMissing) return { label: "Long-term value", value: "Unknown: long-term values didn't load" };
  return null;
}

// ---------------------------------------------------------------------------------------------
// The Trade Analyzer's "Details": what Helps you is worth in points a week (the file header)

/** A B as the Trade Score prints it on the evaluation's scale B₃ ("35"; 0 when B ≤ 0; "—" when B or B₃ is unknown). */
function scoreText(b: number | null, b3: number | null): string {
  if (b === null || !Number.isFinite(b)) return "—";
  if (b <= 0) return "0";
  const score = tradeScore(b, b3);
  return score === null ? "—" : String(score);
}

/**
 * The "Helps you" tooltip in a redraft league (planner reply to Checkpoint 4c, A2): what the scale means, from config (B =
 * B₃ reads benefit.HELPS_AT_GAIN, 63, and B₃ is the B of +config.benefit.helpsGain, 3, points a week): "63 ≈ as good as
 * adding 3 points a week to your lineup for the rest of the season." The info line under my odds says it too
 * (helpsInfoText: a touch screen can't hover). In a dynasty or keeper league with long-term values: helpsScaleText.
 */
export const HELPS_SCALE_TEXT = `${HELPS_AT_GAIN} ≈ as good as adding ${config.benefit.helpsGain} points a week to your lineup for the rest of the season.`;

/** What helpsScaleText and lineupEquivalentText read when the scale itself isn't known (no search or evaluation yet). */
export interface ScaleFallback {
  leagueType: LeagueSnapshot["settings"]["leagueType"];
  /** Long-term values loaded (ValueFacts.longTermOn; not TradeEvaluation.dynMissing): the scale is the mix in a dynasty or keeper league. */
  longTermOn?: boolean | undefined;
}

/**
 * Which wording a "Helps you" scale takes (planner reply to Checkpoint 7a, §2 question 6: "the tooltip follows the mix"):
 * "season" (+3 points a week for the rest of the season: redraft leagues, and dynasty and keeper leagues without long-term
 * values, or with Win now ↔ Future at 0), "future" (Win now ↔ Future at 1: 10% more long-term value alone), else "mix"
 * (B_ref(λ) = (1 − λ) × B_win₃ + λ × F₁₀: +3 points a week this season together with 10% more long-term value, with what each
 * alone reads when the scale is known: HelpsScale.gainReads and futureReads). Without a scale, the league type and whether
 * long-term values loaded decide, with no numbers.
 */
type ScaleWords = { kind: "season" } | { kind: "future" } | { kind: "mix"; gainReads: number | null; futureReads: number | null };

function scaleWordsOf(scale: HelpsScale | null | undefined, fallback: ScaleFallback | undefined): ScaleWords {
  if (scale) {
    const lambda = scale.lambda;
    if (lambda === null || scale.f10 === null || !Number.isFinite(lambda) || lambda <= 0) return { kind: "season" };
    if (lambda >= 1) return { kind: "future" };
    return { kind: "mix", gainReads: Number.isFinite(scale.gainReads) ? scale.gainReads : null, futureReads: scale.futureReads !== null && Number.isFinite(scale.futureReads) ? scale.futureReads : null };
  }
  if (!fallback || fallback.leagueType === "redraft" || fallback.longTermOn === false) return { kind: "season" };
  return { kind: "mix", gainReads: null, futureReads: null };
}

/** "10% more long-term value" (config.benefit.helpsFutureShare: F₁₀'s share). */
const futureShareWords = (): string => `${Math.round(config.benefit.helpsFutureShare * 100)}% more long-term value`;

/** "3 points a week" (config.benefit.helpsGain). */
const gainWords = (): string => `${fmtNum(config.benefit.helpsGain, 1)} points a week`;

/** The mix in words: "adding 3 points a week to your lineup this season together with 10% more long-term value for your roster, weighed by your Win now ↔ Future setting". */
const mixWords = (): string => `adding ${gainWords()} to your lineup this season together with ${futureShareWords()} for your roster, weighed by your Win now ↔ Future setting`;

/**
 * The "Helps you" tooltip and the scale part of the pages' info line (helpsInfoText), by the scale's wording (scaleWordsOf):
 * HELPS_SCALE_TEXT in a redraft league; in a dynasty or keeper league with long-term values the mix (planner reply to
 * Checkpoint 7a, §2 question 6), "63 ≈ as good as adding 3 points a week to your lineup this season together with 10% more
 * long-term value for your roster, weighed by your Win now ↔ Future setting (3 points a week alone reads 50, and 10% more
 * long-term value alone reads 26).", or at Win now ↔ Future's end "63 ≈ as good as adding 10% more long-term value to your
 * roster.".
 */
export function helpsScaleText(scale?: HelpsScale | null, fallback?: ScaleFallback): string {
  const words = scaleWordsOf(scale, fallback);
  if (words.kind === "season") return HELPS_SCALE_TEXT;
  if (words.kind === "future") return `${HELPS_AT_GAIN} ≈ as good as adding ${futureShareWords()} to your roster.`;
  const alone = words.gainReads !== null && words.futureReads !== null ? ` (${gainWords()} alone reads ${words.gainReads}, and ${futureShareWords()} alone reads ${words.futureReads})` : "";
  return `${HELPS_AT_GAIN} ≈ as good as ${mixWords()}${alone}.`;
}

/**
 * The Analyzer's Details line (planner reply to Checkpoint 4c, A2: "≈ +X pts/week", X = 3 × B / B₃, one decimal;
 * benefit.lineupEquivalent): "Helps you 45 ≈ +1.8 pts/week: as good as adding that to your lineup every week for the rest of
 * the season." A trade that doesn't help reads its loss ("Helps you 0 ≈ −0.6 pts/week: as costly as …"). In a dynasty or
 * keeper league with long-term values, X is on the scale's mix (benefit.lineupEquivalent; planner reply to Checkpoint 7a, §2
 * question 6), so it says what +3 is there instead: "Helps you 45 ≈ +1.8 on a scale where +3 is as good as adding 3 points a
 * week to your lineup this season together with 10% more long-term value for your roster, weighed by your Win now ↔ Future
 * setting." (⚠️ ours: never "+X% long-term value", which would read as the trade's own change in long-term value). Null
 * without B or B₃ (not simulated, or an evaluation from before Phase 7a).
 */
export function lineupEquivalentText(e: Pick<TradeEvaluation, "b" | "b3">, scale?: HelpsScale | null, fallback?: ScaleFallback): string | null {
  const x = lineupEquivalent(e.b, e.b3 ?? null);
  if (x === null) return null;
  const text = fmtSigned(x, 1);
  const score = scoreText(e.b, e.b3 ?? null);
  const words = scaleWordsOf(scale, fallback);
  if (words.kind === "mix") return `Helps you ${score} ≈ ${text} on a scale where +${fmtNum(config.benefit.helpsGain, 1)} is as good as ${mixWords()}.`;
  if (words.kind === "future") return `Helps you ${score} ≈ ${text} on a scale where +${fmtNum(config.benefit.helpsGain, 1)} is as good as adding ${futureShareWords()} to your roster.`;
  const unit = text === "+1" || text === `${MINUS}1` ? "pt" : "pts";
  const what =
    text === "0"
      ? "about the same as leaving your lineup as it is"
      : x > 0
        ? "as good as adding that to your lineup every week for the rest of the season"
        : "as costly as losing that from your lineup every week for the rest of the season";
  return `Helps you ${score} ≈ ${text} ${unit}/week: ${what}.`;
}

/**
 * "Details" (the file header): what Helps you is worth in projected points a week, without any trade value figure (planner
 * reply to Checkpoint 7a, 5.4). In a redraft league, B's market term as its lineup equivalent, "Trade value: −0.4 pts/week
 * equivalent." (TradeEvaluation.marketWeekly, signed, one decimal: §2 question 5), left out when B has no market term
 * (marketWeekly null or absent: FantasyCalc's curve fallback or no values, whose notes say so with the result); in dynasty
 * and keeper leagues that Helps you counts long-term value instead (or this season only, when long-term values didn't load:
 * TradeEvaluation.dynMissing). Last, what Helps you is worth (lineupEquivalentText, on `scale`).
 */
export function detailsView(
  e: Pick<TradeEvaluation, "b" | "dynMissing" | "b3"> & { marketWeekly?: number | null | undefined },
  leagueType: LeagueSnapshot["settings"]["leagueType"],
  scale?: HelpsScale | null,
): DetailsView {
  const items: string[] = [];
  const weekly = e.marketWeekly;
  const term = leagueType === "redraft" && typeof weekly === "number" && Number.isFinite(weekly);
  if (term) items.push(`Trade value: ${fmtSigned(weekly, 1)} pts/week equivalent.`);
  else if (leagueType !== "redraft") {
    items.push(
      e.dynMissing
        ? "Helps you has no trade-value part here, and long-term trade values aren't available, so it counts this season only."
        : "Helps you has no trade-value part here: in dynasty and keeper leagues it counts the change in your roster's long-term value instead.",
    );
  }
  // What Helps you is worth (planner reply to Checkpoint 4c, A2: "≈ +X pts/week"; on the mix with long-term values).
  const equivalent = lineupEquivalentText(e, scale, { leagueType, longTermOn: !e.dynMissing });
  if (equivalent) items.push(equivalent);
  const intro = term
    ? "How Helps you adds up for this trade. Trade value is what your “Protect my trade value” setting adds for trade value you'd gain, or takes away for trade value you'd give up, counted as projected points a week."
    : "How Helps you adds up for this trade.";
  return { summary: "Details", intro, items };
}

/**
 * The change in my starting lineup over the rest of the season, in ROS points (Σ after − before over TradeDetail.weekly:
 * my V* lineups' starting points per remaining week; a week in progress is the same both times), when it moves the other
 * way from the players' ROS points the card prints ("You get 96 ROS pts, give 295" on a helpful trade that gives a backup
 * QB who never starts: review of Phase 4b): "Your starting lineup still gains 25 ROS pts: …"; null otherwise (the two
 * agree, either rounds to nothing, or the weeks are unknown).
 */
export function rosNoteOf(e: Pick<TradeEvaluation, "ros"> & { detail: Pick<TradeDetail, "weekly"> }): string | null {
  let lineup = 0;
  for (const w of e.detail.weekly ?? []) if (Number.isFinite(w.before) && Number.isFinite(w.after)) lineup += w.after - w.before;
  const change = Math.round(lineup);
  const given = Math.round(e.ros.given);
  const received = Math.round(e.ros.received);
  if (!Number.isFinite(given) || !Number.isFinite(received)) return null;
  const why = "ROS points count each player's projected points whether he starts or not.";
  const pts = (n: number) => `${fmtWhole(n)} ROS ${n === 1 ? "pt" : "pts"}`;
  if (given > received && change > 0) return `Your starting lineup still gains ${pts(change)}: ${why}`;
  if (received > given && change < 0) return `Your starting lineup loses ${pts(-change)} even so: ${why}`;
  return null;
}

/**
 * The roster moves a trade forces on one side (§7 legality; Phase 4b's IR players), in sentences, the side's own words
 * (`who`): drops as before; a free agent added for a position under its roster minimum (rule 3) as before ("You'd pick
 * up … from free agents to fill your roster."); each roster spot the trade opened, one sentence a spot (RosterChange.
 * openSpots; Phase 7c, planner reply to Checkpoint 7b, section 5: "Open roster spot: add X, the best available RB."), the
 * partner's in its own words ("Team 4's open roster spot: they'd add …"), and when no free agent could come in at a
 * position the trade left short, the best at any position, saying where none was ("…, the best available free agent (no
 * TE is available)."; openSpotText); a received IR player who goes into an open IR slot ("Jordan Mason goes to your IR
 * slot (no roster spot until he's back)."); my free-agent moves after the trade that my baseline doesn't make (faMovesLine;
 * final review of Phase 4c, finding R1); and a player dropped from the week an IR player comes back ("From week 7,
 * when Alec Pierce comes back from IR, you'd drop Marvin Harrison Jr. (WR, ARI)."). When the one released is the returner
 * himself (RosterChange.displaced's `returner`; §7: on a full roster from his return he's a bench player like any other,
 * returners.ts), it says it's a choice: "From week 7, when Alec Pierce comes back from IR, you'd release him instead of
 * dropping someone else." (review of track UIC, finding 7: "you'd drop Alec Pierce" right after "when Alec Pierce comes
 * back" read like a mistake; ⚠️ ours: no why, since the player kept instead can be one the rules keep whatever he's worth,
 * such as a streamed position's only kicker). An open spot's fill dropped again at a return says so in the spot's own
 * sentence ("…, the best available RB, until Jonah Coleman comes back from IR in week 7."; openSpotText), not in a line of
 * its own. The IR fields may be absent (RosterChange: none), and so may `openSpots` (an evaluation from before Phase 7c:
 * every add reads as rule 3's sentence, as it did then).
 */
function requiredLines(change: RosterChange, who: { drop: string; dropLater: string; release: string; pickUp: string; their: string; ir: string; would: string; openSpot: string }, snapshot: SnapshotPart): string[] {
  const phrase = (id: string) => playerPhrase(id, snapshot);
  const plain = (id: string) => snapshot.players[id]?.name ?? "a player who's no longer in this league's data";
  const out: string[] = [];
  if (change.drops.length) out.push(`${who.drop} ${listText(change.drops.map(phrase))} to stay within ${who.their} roster limits.`);
  const spots = (change.openSpots ?? []).filter((s) => s && typeof s.playerId === "string");
  const filled = new Set(spots.map((s) => s.playerId));
  const minimums = change.adds.filter((id) => !filled.has(id));
  if (minimums.length) out.push(`${who.pickUp} ${listText(minimums.map(phrase))} from free agents to fill ${who.their} roster.`);
  // A fill dropped again from the week an IR player comes back (the spot is the returner's then): one sentence, the spot's.
  const displaced = (change.displaced ?? []).filter((d) => d && typeof d.playerId === "string");
  const until = new Map<string, { returner: string; week: number }>();
  const said = new Set<(typeof displaced)[number]>();
  for (const d of displaced) {
    if (!filled.has(d.playerId) || d.playerId === d.returner || until.has(d.playerId)) continue;
    until.set(d.playerId, { returner: d.returner, week: d.week });
    said.add(d);
  }
  for (const s of spots) out.push(openSpotText(s, who.openSpot, snapshot, until.get(s.playerId)));
  const toIR = [...new Set(change.toIR ?? [])];
  if (toIR.length) {
    const one = toIR.length === 1;
    const names = listText(toIR.map(plain));
    out.push(`${names.charAt(0).toUpperCase()}${names.slice(1)} ${one ? "goes" : "go"} to ${who.ir} IR ${one ? "slot" : "slots"} (no roster ${one ? "spot" : "spots"} until ${one ? "he's" : "they're"} back).`);
  }
  // The free-agent moves after the trade (now), before the drops an IR player's return brings (later in the season).
  const moves = faMovesLine(change.faMoves, who.would, snapshot);
  if (moves) out.push(moves);
  for (const d of displaced) {
    if (said.has(d)) continue; // said with his open spot
    const when = Number.isFinite(d.week) ? `From week ${d.week}, when ${plain(d.returner)} comes back from IR, ` : `When ${plain(d.returner)} comes back from IR, `;
    out.push(d.playerId === d.returner ? `${when}${who.release} him instead of dropping someone else.` : `${when}${who.dropLater} ${phrase(d.playerId)}.`);
  }
  return out;
}

/**
 * The free-agent moves after the trade that the side's baseline doesn't make (RosterChange.faMoves; final review of Phase
 * 4c, finding R1), in one sentence: "This trade's numbers count on one more free-agent move: you'd drop Kyle Monangai (RB,
 * CHI) and pick up Malik Willis (QB, MIA) to start in week 7." A lone pickup who starts in one or two of the counted weeks
 * says which ("to start in weeks 7 and 13"); without a pickup of its own, a drop made in place of one the baseline makes
 * says so ("you'd drop Kyle Monangai (RB, CHI) rather than Romeo Doubs (WR, NE)": the League page's pickups stand, with
 * another drop), and a drop says whom it makes room for when that's one of the League page's pickups (RosterChange.faMoves
 * `room`; verification of the final review, finding VF-1: "you'd drop Kyle Monangai (RB, CHI)." alone gave no reason): "…
 * to make room for Malik Washington (WR, CHI), the pickup the League page suggests". Null without such moves.
 */
function faMovesLine(fa: RosterChange["faMoves"], would: string, snapshot: SnapshotPart): string | null {
  if (!fa || (!fa.adds.length && !fa.drops.length)) return null;
  const phrase = (id: string) => playerPhrase(id, snapshot);
  const parts: string[] = [];
  const room = !fa.adds.length ? [...new Set(fa.room ?? [])] : [];
  const roomText = room.length ? ` to make room for ${listText(room.map(phrase))}, ${room.length === 1 ? "the pickup" : "pickups"} the League page suggests` : "";
  if (fa.drops.length) parts.push(`drop ${listText(fa.drops.map(phrase))}${!fa.adds.length && fa.kept?.length ? ` rather than ${listText(fa.kept.map(phrase))}` : ""}${roomText}`);
  if (fa.adds.length) {
    const [only] = fa.adds;
    const weeks = fa.adds.length === 1 && only !== undefined ? (fa.starts?.[only] ?? []).filter((w) => Number.isFinite(w)) : [];
    const when = weeks.length >= 1 && weeks.length <= 2 ? ` to start in ${weeks.length === 1 ? "week" : "weeks"} ${listText(weeks.map(String))}` : "";
    parts.push(`pick up ${listText(fa.adds.map(phrase))}${when}`);
  }
  const one = Math.max(fa.adds.length, fa.drops.length) === 1;
  return `This trade's numbers count on ${one ? "one more free-agent move" : "more free-agent moves"}: ${would} ${parts.join(one ? " and " : ", and ")}.`;
}

/**
 * The Market check's words (the file header; the model's trigger, no number): "Market check: counting roster spots, you'd
 * give up more trade value than you get." (", much more …, so trade ideas leave it out." when the market guard hides it,
 * the Analyzer's). ⚠️ When the roster spot the trade costs me is what trips it (final review of Phase 4c, finding PAGES-6:
 * on Parker's live #1 card the flag sat beside FantasyCalc's own values reading about even, 4,667 given for 4,475, the
 * model's −15.3% coming from the credit W for the spot his 2-for-1 fills, and only "counting roster spots" hinted why):
 * I'd get more players onto my active roster than I give from it, and by FantasyCalc's plain sums alone (every player
 * valued; read here, never shown: planner reply to Checkpoint 7a, 5.4) the check wouldn't fire (my FantasyCalc gain at
 * least config.benefit.marketCheckBelow, or marketHideBelow for the hiding line), it says so: "Market check: you'd get 2
 * players for 1, and counting the roster spot that costs you, you'd give up more trade value than you get."
 */
export function marketCheckText(e: Pick<TradeEvaluation, "proposal" | "flags" | "required"> & { detail: Pick<TradeDetail, "myTeamId"> }, snapshot: SnapshotPart, fc: FantasyCalcLookup | undefined): string {
  const hidden = e.flags.hiddenByMarket;
  const much = hidden ? "much more" : "more";
  const tail = hidden ? ", so trade ideas leave it out." : ".";
  const give = e.proposal.give.flatMap((a) => (a.kind === "player" ? [a.id] : []));
  const get = e.proposal.get.flatMap((a) => (a.kind === "player" ? [a.id] : []));
  // Active roster spots: a player I give from my IR opens none, one I receive into an open IR slot fills none.
  const myIR = new Set(snapshot.teams.find((t) => t.id === e.detail.myTeamId)?.ir ?? []);
  const spots = get.length - (e.required.me.toIR?.length ?? 0) - give.filter((id) => !myIR.has(id)).length;
  if (spots > 0 && fc?.available && give.length === e.proposal.give.length && get.length === e.proposal.get.length) {
    const read = fantasyCalcComparison(e.proposal, { fantasyCalcValue: fc.value });
    const bar = hidden ? config.benefit.marketHideBelow : config.benefit.marketCheckBelow;
    if (read.kind === "known" && read.theyGet > 0 && myFantasyCalcGain(read) >= bar - 1e-9) {
      const what = spots === 1 ? "the roster spot that costs you" : `the ${spots} roster spots that cost you`;
      return `Market check: you'd get ${get.length} players for ${give.length}, and counting ${what}, you'd give up ${much} trade value than you get${tail}`;
    }
  }
  return `Market check: counting roster spots, you'd give up ${much} trade value than you get${tail}`;
}

export function buildTradeCard(e: TradeEvaluation, ctx: CardContext): TradeCardView {
  const { snapshot } = ctx;
  const partnerName = teamNameOf(snapshot, e.proposal.partnerId);
  const showsVeto = e.detail.vetoRisk || Math.abs(displayAcceptance(e.pComplete) - displayAcceptance(e.pAccept)) > 1e-9;
  const through = showsVeto ? throughText(e.pAccept, e.pComplete) : null;
  const flagged = [...new Set(e.flags.injured)];
  // Whether a hurt player's projection is blended with the trade market (CardContext.blendOn).
  const blendOn = ctx.blendOn ?? true;

  const flags: FlagView[] = [];
  if (flagged.length) {
    const who = flagged.map((id) => {
      const info = snapshot.players[id];
      const status = info ? INJURY_LABEL[info.injury]?.long.toLowerCase() : undefined;
      return `${info?.name ?? "a player"}${status ? ` (${status})` : ""}`;
    });
    // What his projection assumes joins the flag (the file header: said once, not again under the lists or in the reasons).
    const assumes = assumesFullReturn(flagged.length > 1, blendOn);
    flags.push({ kind: "injured", text: `Depends on ${flagged.length === 1 ? "an injured player" : "injured players"}: ${listText(who)}. ${assumes.charAt(0).toUpperCase()}${assumes.slice(1)}` });
  }
  if (e.flags.hiddenByBenefit) flags.push({ kind: "noHelp", text: noHelpText(e) });
  // The model's trigger, no number (the file header: planner reply to Checkpoint 4b, change 3), naming the roster spot when
  // it's what trips the check (marketCheckText).
  if (e.flags.marketCheck) flags.push({ kind: e.flags.hiddenByMarket ? "hiddenByMarket" : "market", text: marketCheckText(e, snapshot, ctx.fantasyCalc) });
  if (e.b === null && !e.flags.hiddenByBenefit) flags.push({ kind: "noOdds", text: "Not scored: your playoff odds couldn't be worked out, so this trade has no Helps you or Overall number." });

  // My odds before and after sit next to the three numbers (oddsViews), not among these. No trade value number (the file
  // header): long-term value in words, and the "Values: FantasyCalc" credit after them (valuesCredit).
  const facts: FactView[] = [{ label: "Your lineup", value: `${perWeek(e.dPPW)} in the regular season, ${fmtSigned(e.dPPWPlayoffs, 1)} in the playoffs` }];
  const longTerm = longTermFact(e);
  if (longTerm) facts.push(longTerm);
  facts.push({ label: "Their lineup", value: perWeek(e.partnerDeltaLineup) });
  // The scale's wording without the search's or the Analyzer's scale: the league type, and whether long-term values loaded.
  const scaleFallback: ScaleFallback = { leagueType: snapshot.settings.leagueType, longTermOn: !e.dynMissing };

  // The roster moves the trade forces, mine first (§7; Phase 4b's IR slots and returns, Phase 7c's open roster spots: requiredLines).
  const required = [
    ...requiredLines(e.required.me, { drop: "You'd drop", dropLater: "you'd drop", release: "you'd release", pickUp: "You'd pick up", their: "your", ir: "your", would: "you'd", openSpot: "Open roster spot: add" }, snapshot),
    ...requiredLines(
      e.required.partner,
      {
        drop: `${partnerName} would drop`,
        dropLater: `${partnerName} would drop`,
        release: `${partnerName} would release`,
        pickUp: `${partnerName} would pick up`,
        their: "their",
        ir: possessive(partnerName),
        would: `${partnerName} would`,
        openSpot: `${possessive(partnerName)} open roster spot: they'd add`,
      },
      snapshot,
    ),
  ];

  // Injury tags in words on both sides (the evaluation's; else, a core without them, tags from the snapshot: tagsOf).
  const tags = tagsOf(e, snapshot);
  const end = seasonEndOf(snapshot.settings, ctx.lastNflWeek);
  const source = dateSourceOf(snapshot);
  const statusOf = (a: TradeAsset, side: InjuryTag["side"]): AssetView["status"] => {
    const t = a.kind === "player" ? tags.find((x) => x.playerId === a.id && x.side === side) : undefined;
    return t ? { text: injuryTagText(t, end, source), tone: INJURY_TONE[t.status] } : null;
  };

  return {
    key: e.key,
    partnerId: e.proposal.partnerId,
    heading: `Trade with ${partnerName}`,
    partnerName,
    give: e.proposal.give.map((a) => ({ ...assetView(a, snapshot), status: statusOf(a, "give") })),
    // Players I'd get carry "Harder to get" when their manager values them above market (TradeDetail.premium).
    get: e.proposal.get.map((a) => {
      const view = { ...assetView(a, snapshot), status: statusOf(a, "get") };
      return a.kind === "player" ? { ...view, tag: harderToGetOf(e.detail.premium?.find((f) => f.playerId === a.id)) } : view;
    }),
    numbers: {
      // The scale in a tooltip (planner reply to Checkpoint 4c, A2: "63 ≈ as good as adding 3 points a week …"; the mix with
      // long-term values: planner reply to Checkpoint 7a, §2 question 6).
      helps: { ...scoreView(e.tradeScore, e.b), title: helpsScaleText(ctx.helpsScale, scaleFallback) },
      accept: { value: acceptText(e.pAccept), srText: underStep(e.pAccept) ? acceptSrText(e.pAccept) : null },
      acceptLabel: `Est. · ${e.acceptLabel}`,
      acceptNote: through ? `Counting ${REVIEW_WORDS[snapshot.settings.tradeReview]}, ${through} it goes through.` : null,
      overall: scoreView(e.overall, e.b),
    },
    odds: oddsViews(e, ctx.baseline),
    weekly: weeklyLine(e.detail.winChance),
    details: ctx.details ? detailsView(e, snapshot.settings.leagueType, ctx.helpsScale) : null,
    steps: stepsView(e.steps, snapshot),
    planB: planBView(e.planB, snapshot, { cardTags: tags, knownTags: ctx.knownTags, seasonEnd: end, baseline: ctx.baseline }),
    injuryNote: incomingInjuryNote(tags, snapshot, flagged, blendOn),
    versions: versionChoices(e, snapshot, ctx.goal ?? null),
    flags,
    facts,
    valuesCredit: valuesBehind(ctx.fantasyCalc) ? VALUES_CREDIT_TEXT : null,
    ros: `You get ${fmtWhole(e.ros.received)} ROS pts, give ${fmtWhole(e.ros.given)}`,
    rosNote: rosNoteOf(e),
    required,
    // The injured caveat is the flag's to say (INJURED_REASON); every other reason as explain.ts wrote it.
    reasons: flagged.length ? e.reasons.filter((r) => !INJURED_REASON.test(r)) : [...e.reasons],
    pitch: e.pitch,
    analyzerHref: analyzerHref(e.proposal),
    evaluation: e,
  };
}

// ---------------------------------------------------------------------------------------------
// My odds before any trade (both pages)

/**
 * My odds before any trade in words (the Finder's line above its ideas, the Analyzer's above its card) and what they
 * count (the file header): the League page's headline odds, every team after the free-agent pickups that would help it
 * (planner reply to Checkpoint 4b, change 9: one baseline everywhere), the title with one decimal like the cards' odds.
 * Review of Phase 4: the Finder said "Your odds now: 71%" while the League page said 76%, so a card's "(71% to 77%)" read
 * as a 1-point gain; since Phase 4c the two are the same odds. Null when the season wasn't simulated.
 */
export function baselineLines(baseline: CardContext["baseline"], page: "finder" | "analyzer"): { text: string; note: string } | null {
  if (!baseline || baseline.pPlayoffs === null || !Number.isFinite(baseline.pPlayoffs)) return null;
  const title = baseline.pTitle !== null && Number.isFinite(baseline.pTitle) ? `, ${titleOddsText(baseline.pTitle)} to win the title` : "";
  return {
    text: `Your odds ${page === "finder" ? "before any trade" : "before this trade"}: ${percentText(baseline.pPlayoffs)} to make the playoffs${title}.`,
    note: `As on the League page, they count the free-agent pickups that would help each team, and ${page === "finder" ? "every trade idea's" : "the trade's"} odds start from them.`,
  };
}

/**
 * What "Helps you" sums up, said once per page (the file header; planner reply to Checkpoint 4b, change 9): the planner's
 * sentence in redraft leagues, with the credit for gaining trade value (final review of Phase 4c, finding R4: the market
 * term is κ × g_mkt(me), either sign); ⚠️ ours: in dynasty and keeper leagues weighed against long-term value (B_future, by Win
 * now ↔ Future) instead of a trade-value cost, and the odds alone when there's nothing to weigh them against: a redraft
 * league while FantasyCalc's values aren't available (`valuesOn` false: B has no market term then), a dynasty or keeper
 * league whose long-term values didn't load (`longTermOn` false: TradeEvaluation.dynMissing, B = B_win; review of track
 * UIC, finding 2). Then the scale (planner reply to Checkpoint 4c, A2; helpsScaleText, the card's tooltip, ⚠️ ours here
 * too: a phone can't hover), on `scale` (the search's or the Analyzer's: the mix in a dynasty or keeper league with
 * long-term values, planner reply to Checkpoint 7a, §2 question 6).
 */
export function helpsInfoText(leagueType: LeagueSnapshot["settings"]["leagueType"], valuesOn = true, longTermOn = true, scale?: HelpsScale | null): string {
  const lead = "Helps you (0–100) sums up how much your title and playoff odds rise";
  let what: string;
  if (leagueType !== "redraft") what = longTermOn ? `${lead}, weighed against the change in your roster's long-term value.` : `${lead}.`;
  else what = valuesOn ? `${lead}, minus a cost for giving away trade value or plus a credit for gaining it.` : `${lead}.`;
  // The scale (planner reply to Checkpoint 4c, A2), said in words too: the card's tooltip can't be hovered on a phone.
  return `${what} ${helpsScaleText(scale, { leagueType, longTermOn })}`;
}

// ---------------------------------------------------------------------------------------------
// The Trade Finder

/** "Chance they accept: at least" (planner reply to Checkpoint 4b, change 10): config.ranking.minChanceOptions, "Any" for 0. */
export const MIN_CHANCE_OPTIONS: readonly { value: number; label: string }[] = config.ranking.minChanceOptions.map((v) => ({ value: v, label: v > 0 ? `${Math.round(v * 100)}%` : "Any" }));

/**
 * The note under "Chance they accept: at least" in a league that reviews trades (the minimum reads the chance the trade
 * goes through, which the veto rule can cut), naming the review as the cards' "Counting …, about 20% it goes through."
 * does (REVIEW_WORDS: "a league veto vote", "the commissioner's review"; review of track UIC, finding 5: an ESPN league
 * with a review period and no veto votes reads as commissioner review); null when the league doesn't review trades.
 */
export function minChanceNote(tradeReview: LeagueSnapshot["settings"]["tradeReview"]): string | null {
  if (tradeReview === "none") return null;
  return `Judged on the chance the trade goes through, which ${REVIEW_WORDS[tradeReview]} can cut.`;
}

/** The option for a minimum chance ("30%", "Any"); the nearest option's label for a number that isn't one. */
export function minChanceLabel(minChance: number): string {
  const exact = MIN_CHANCE_OPTIONS.find((o) => Math.abs(o.value - minChance) < 1e-9);
  return exact?.label ?? (minChance > 0 ? `${Math.round(minChance * 100)}%` : "Any");
}

export interface FinderView {
  /** "Your odds before any trade: 59% to make the playoffs, 9.9% to win the title." (null when not simulated; baselineLines). */
  baseline: string | null;
  /** What those odds count: the League page's (null with no baseline). */
  baselineNote: string | null;
  /** What "Helps you" sums up, once for the list (helpsInfoText); null without cards. */
  helpsInfo: string | null;
  /** The search's "Helps you" scale (TradeSearchResult.helpsScale), for "How to read" (HowToRead.helpsScaleWords); null when unknown. */
  helpsScale: HelpsScale | null;
  /** The pattern note above the list (TradeSearchResult.pattern's text), or null. */
  pattern: string | null;
  /** "Only 4 trade ideas to show at “at least 50%”. Try a lower setting to see more." when the minimum leaves few (fewText), or null. */
  few: string | null;
  cards: TradeCardView[];
  /** "25 trade ideas, sorted by Overall." ("" when none). */
  countText: string;
  /** The status line once the search is done: "Found 25 trade ideas." or the empty state's title. */
  statusText: string;
  /** "Left out: 10 that wouldn't help you, and 2 …" (null when none). */
  hidden: string | null;
  /** "Looked at 1,234 trade ideas, checked 200 closely, … That took 4.2 seconds." (searchedText) */
  searched: string | null;
  notes: string[];
  warnings: string[];
  /** Why there's nothing to show, when there isn't (its text includes the notes that explain it). */
  empty: { title: string; text: string[] } | null;
}

/**
 * What was left out on purpose (§10 guards, and Phase 4c's minimum chance): "… 10 trade ideas that wouldn't help you, 1
 * trade idea where, counting roster spots, you'd give up much more trade value than you get, and 3 trade ideas below your
 * minimum chance." (⚠️ the market guard's words count roster spots, as the card's Market check does: the threshold is the
 * model's own count; in words since the planner's reply to Checkpoint 7a, 5.4: no trade value percent anywhere, it said
 * "over 35% less trade value than you give").
 */
function hiddenText(hidden: TradeSearchResult["hidden"]): string | null {
  const parts: string[] = [];
  if (hidden.byBenefit > 0) parts.push(`${plural(hidden.byBenefit, "trade idea")} that wouldn't help you`);
  if (hidden.byMarket > 0) parts.push(`${plural(hidden.byMarket, "trade idea")} where, counting roster spots, you'd give up much more trade value than you get`);
  const byChance = hidden.byChance ?? 0;
  if (byChance > 0) parts.push(`${plural(byChance, "trade idea")} below your minimum chance`);
  return parts.length ? `Left out on purpose: ${listText(parts)}.` : null;
}

/**
 * When the minimum chance leaves few ideas (TradeSearchResult.filter.few: fewer than config.ranking.minChanceFew shown,
 * and a lower setting would show more), the line that says so and suggests a lower setting (planner reply to Checkpoint
 * 4b, change 10): "Only 4 trade ideas to show at “at least 50%”. Try a lower setting to see more." ⚠️ "to show": counted
 * on the list shown (some ideas that reach the minimum can still give way to the list's variety rules); null otherwise.
 */
export function fewText(result: Pick<TradeSearchResult, "filter" | "trades">): string | null {
  const f = result.filter;
  if (!f?.few || !(f.minChance > 0)) return null;
  const n = result.trades.length;
  return `Only ${plural(n, "trade idea")} to show at “at least ${minChanceLabel(f.minChance)}”. Try a lower setting to see more.`;
}

// ---------------------------------------------------------------------------------------------
// When to look, and how fresh the data is (planner reply to Checkpoint 7a, 5.3)

/**
 * The league's trade review period in words, for bestTimeText's "your league's <review period> review", from
 * LeagueSettings.tradeReviewHours alone (Phase 7b: ESPN's revisionHours, Sleeper's veto vote): 24 → "1-day", 48 → "2-day",
 * another whole number of days "N-day", else "N-hour"; "none" for 0 hours, the only definite "no review" the adapters
 * report (ESPN's revisionHours 0; Sleeper with the veto vote off); null when the period isn't known (not reported, or not a
 * number ≥ 0). ⚠️ tradeReview "none" alone never reads as no review (review of Phase 7b): the adapters also give it when
 * they only assume it, and leave the hours out then (a Sleeper league without veto_auto_poll, 75 of the 250 crawled 2026
 * leagues, 73 of them with trade_review_days 2; a Sleeper veto code we don't know; an ESPN league that reports neither veto
 * votes nor a review period). An import saved before Phase 7b has no hours either: "your league's review".
 */
export function reviewPeriodWords(settings: Pick<LeagueSettings, "tradeReviewHours">): string | null {
  const hours = settings.tradeReviewHours;
  if (hours === undefined || !Number.isFinite(hours) || hours < 0) return null;
  if (hours === 0) return "none";
  return hours % 24 === 0 ? `${hours / 24}-day` : `${fmtNum(hours, 1)}-hour`;
}

/** The planner's line, up to its last clause (bestTimeText). */
const BEST_TIME_LEAD = "Best time to look: Tuesday or Wednesday, after Monday night's game. Trade values and projections have caught up with the weekend";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/**
 * The Trade Finder's line on when to look (planner reply to Checkpoint 7a, 5.3): "Best time to look: Tuesday or Wednesday,
 * after Monday night's game. Trade values and projections have caught up with the weekend, and a trade still has time to
 * clear your league's 1-day review before Thursday." (reviewPeriodWords: "your league's review" when the period isn't
 * known; "…, and a trade still has time to go through before Thursday." when the league doesn't review trades).
 * ⚠️ Ours (review of Phase 7b; a planner question): a review longer than a day can't clear "before Thursday" when the trade
 * is made on Wednesday (a 2-day review clears it on Friday), so the line says when it clears instead: "… caught up with the
 * weekend. With your league's 2-day review, a trade made Tuesday clears on Thursday, and one made Wednesday on Friday." (a
 * whole number of days up to 4), else "…, a trade made then can clear after Thursday night's game."
 */
export function bestTimeText(settings: Pick<LeagueSettings, "tradeReviewHours">): string {
  const period = reviewPeriodWords(settings);
  if (period === "none") return `${BEST_TIME_LEAD}, and a trade still has time to go through before Thursday.`;
  const hours = settings.tradeReviewHours;
  if (period === null || hours === undefined || hours <= 24) return `${BEST_TIME_LEAD}, and a trade still has time to clear your league's ${period ? `${period} ` : ""}review before Thursday.`;
  const days = hours / 24;
  if (Number.isInteger(days) && days <= 4)
    return `${BEST_TIME_LEAD}. With your league's ${period} review, a trade made Tuesday clears on ${WEEKDAYS[(2 + days) % 7]}, and one made Wednesday on ${WEEKDAYS[(3 + days) % 7]}.`;
  return `${BEST_TIME_LEAD}. With your league's ${period} review, a trade made then can clear after Thursday night's game.`;
}

/**
 * Whether the league's season has started (inTradingSeason): its first week (the earliest regular-season or playoff week it
 * lists, else NFL week 1) is before the current NFL week, or is the current week and its earliest known kickoff
 * (NflScheduleInputs.kickoffs, as league.ts firstKickoff reads them) has passed. ⚠️ The schedule holds kickoffs from the
 * current week on only, so an earlier first week needs none; the current week without a known kickoff hasn't started
 * (review of Phase 7b: a preseason league, or one renewed for next season, reads week 1 months before its first game).
 */
function seasonStarted(currentWeek: number, firstWeek: number, nfl: Pick<NflScheduleInputs, "kickoffs"> | undefined, now: Date): boolean {
  if (currentWeek !== firstWeek) return currentWeek > firstWeek;
  let first = Number.POSITIVE_INFINITY;
  for (const iso of Object.values(nfl?.kickoffs?.[firstWeek] ?? {})) {
    const t = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
    if (Number.isFinite(t) && t < first) first = t;
  }
  return Number.isFinite(first) && first <= now.getTime();
}

/**
 * Whether the league is in season for trading (bestTimeText shows only then): its season has started (seasonStarted: a
 * game of its first week has kicked off), a fantasy week is left (the current NFL week at or before the league's last
 * regular-season or playoff week; `schedule.lastWeek`, ModelInputs.lastWeek, when the league lists none) and the trade
 * deadline hasn't passed (acceptance.tradeDeadlinePassed, the engine's own reading, with the league week when the platform
 * has one). False when no week is known.
 */
export function inTradingSeason(
  snapshot: Pick<LeagueSnapshot, "settings" | "currentWeek"> & Partial<Pick<LeagueSnapshot, "leagueWeek">>,
  now: Date,
  schedule: { lastWeek?: number | undefined; nfl?: Pick<NflScheduleInputs, "kickoffs"> | undefined } = {},
): boolean {
  const weeks = [...snapshot.settings.regularSeasonWeeks, ...snapshot.settings.playoffWeeks].filter((w) => Number.isFinite(w));
  const lastWeek = schedule.lastWeek;
  const last = weeks.length ? Math.max(...weeks) : lastWeek !== undefined && Number.isFinite(lastWeek) ? lastWeek : null;
  if (last === null || !Number.isFinite(snapshot.currentWeek) || snapshot.currentWeek > last) return false;
  if (!seasonStarted(snapshot.currentWeek, weeks.length ? Math.min(...weeks) : 1, schedule.nfl, now)) return false;
  return !tradeDeadlinePassed(snapshot.settings.tradeDeadline, now, snapshot.leagueWeek ?? snapshot.currentWeek);
}

/** "just now", "1 minute ago", "25 minutes ago", "1 hour ago", "5 hours ago", "yesterday", "3 days ago" (a time to the past, in friendly words). */
export function timeAgoText(thenMs: number, nowMs: number): string {
  const minutes = Math.floor(Math.max(0, nowMs - thenMs) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${plural(minutes, "minute")} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  if (hours < 48) return "yesterday";
  return `${plural(Math.floor(hours / 24), "day")} ago`;
}

/**
 * Sleeper's projections in ModelInputs.sources: src/server/modelInputs.ts MODEL_SOURCES.sleeperProjections (a server module
 * the pages can't import; tradeView.test.ts checks the two agree).
 */
export const PROJECTIONS_SOURCE = "Sleeper projections";

/**
 * The Trade Finder's freshness line (planner reply to Checkpoint 7a, 5.3): "Trade values updated 2 hours ago · Projections
 * updated 5 hours ago." from the model inputs' source times (timeAgoText to `nowMs`): FantasyCalc's list as served
 * (MarketInputs.fetchedAt; a saved list's own time when one stands in), and Sleeper's projections (their source stamp:
 * ⚠️ the oldest projection week the inputs read, src/server/modelInputs.ts stamp, so it never claims fresher than the oldest
 * week). Either part is left out when unknown; null when both are.
 */
export function freshnessText(inputs: Pick<ModelInputs, "market" | "sources">, nowMs: number): string | null {
  const parts: string[] = [];
  const values = inputs.market ? Date.parse(inputs.market.fetchedAt) : Number.NaN;
  if (Number.isFinite(values)) parts.push(`Trade values updated ${timeAgoText(values, nowMs)}`);
  const stamp = inputs.sources.find((s) => s.source === PROJECTIONS_SOURCE);
  const projections = stamp ? Date.parse(stamp.fetchedAt) : Number.NaN;
  if (Number.isFinite(projections)) parts.push(`Projections updated ${timeAgoText(projections, nowMs)}`);
  return parts.length ? `${parts.join(" · ")}.` : null;
}

/** The Trade Finder's two lines under its intro (finderTimingLines). */
export interface FinderTimingView {
  /** bestTimeText while the league is in season for trading (inTradingSeason), else null. */
  bestTime: string | null;
  /** freshnessText, or null. */
  freshness: string | null;
}

/**
 * When to look and how fresh the data is, for the Trade Finder (the file header), at `now`: the current time (the page's
 * clock), never the time of the ideas shown, which can be a remembered search's, hours old (review of Phase 7b).
 */
export function finderTimingLines(args: {
  snapshot: Pick<LeagueSnapshot, "settings" | "currentWeek"> & Partial<Pick<LeagueSnapshot, "leagueWeek">>;
  inputs: Pick<ModelInputs, "market" | "sources" | "lastWeek"> & { nfl?: Pick<NflScheduleInputs, "kickoffs"> | undefined };
  now: Date;
}): FinderTimingView {
  const { snapshot, inputs, now } = args;
  return {
    bestTime: inTradingSeason(snapshot, now, { lastWeek: inputs.lastWeek, nfl: inputs.nfl }) ? bestTimeText(snapshot.settings) : null,
    freshness: freshnessText(inputs, now.getTime()),
  };
}

/**
 * What the search looked at: "Looked at 15,873 trade ideas, checked 208 closely, and played out your season 5,000 times
 * with each of the best 60. That took 5.1 seconds." ⚠️ Not "the best 208" (review of track UIC, finding 6): exact
 * evaluation takes the best config.search.exactEvaluationMax by screening and, on top of them, the lean companions
 * (search.ts: the same trades without a neutral throw-in), which missed that cut.
 */
function searchedText(result: TradeSearchResult): string | null {
  const c = result.counts;
  if (!c.screened) return null;
  const total = result.timings.total;
  const time = typeof total === "number" && Number.isFinite(total) ? ` That took ${secondsText(total)}.` : "";
  const sims = c.simFinal ? `, and played out your season ${fmtWhole(config.simulation.finalSims)} times with each of the best ${fmtWhole(c.simFinal)}` : "";
  return `Looked at ${fmtWhole(c.screened)} ${c.screened === 1 ? "trade idea" : "trade ideas"}, checked ${fmtWhole(c.exact)} closely${sims}.${time}`;
}

/**
 * An evaluation's note as the Finder lists it, once for all its ideas. The engine words the week in progress for one
 * trade (evaluate.ts: "Week 4 is under way: these odds play it with today's rosters, before and after the trade.", right
 * under the Analyzer's card), which read oddly under a list of 18 (review of Phase 4: "this trade" named none of them).
 * Phase 4c: worded as what the model does (it plays the week under way with today's rosters), not as a platform rule (a
 * trade accepted on Thursday night can still change who plays on Sunday once a review period ends).
 * ⚠️ Matched on the engine's words: any other note passes through as it is.
 */
export function listNote(note: string): string {
  const m = /^Week (\d+) is under way: these odds play it with today's rosters\b/.exec(note);
  return m ? `Week ${m[1]} is under way: every idea's odds play it with today's rosters, before and after the trade.` : note;
}

/**
 * The injury tags the search made for the players on its ideas (TradeEvaluation.flags.tagged), by player: the first one
 * for each (a player's tag doesn't depend on the idea or the side), for a Plan B's players (CardContext.knownTags).
 */
export function knownTagsOf(trades: readonly Pick<TradeEvaluation, "flags">[]): Map<string, InjuryTag> {
  const out = new Map<string, InjuryTag>();
  for (const e of trades) for (const t of e.flags.tagged ?? []) if (!out.has(t.playerId)) out.set(t.playerId, t);
  return out;
}

export function buildFinderView(args: {
  result: TradeSearchResult;
  sort: TradeSort;
  snapshot: SnapshotPart;
  partnerId: string | null;
  lastNflWeek?: number | undefined;
  /** FantasyCalc's values as the page holds them (fantasyCalcLookup: CardContext.fantasyCalc, never shown); absent: taken to be loaded. */
  fantasyCalc?: FantasyCalcLookup | undefined;
  /** What the league rewards (TradeSettings.goal) as the search weighted B (the feedback's version inputs). */
  goal?: Goal | null | undefined;
  /** Whether the market blend reaches anyone (marketBlendOn: CardContext.blendOn); absent: on. */
  blendOn?: boolean | undefined;
}): FinderView {
  const { result, snapshot } = args;
  const baseline = result.baseline;
  const knownTags = knownTagsOf(result.trades);
  // The search's one "Helps you" scale (its cards' tooltips and the info line; the mix with long-term values).
  const helpsScale = result.helpsScale ?? null;
  const sorted = sortTrades(result.trades, args.sort).map((e) =>
    buildTradeCard(e, { snapshot, baseline, lastNflWeek: args.lastNflWeek, knownTags, fantasyCalc: args.fantasyCalc, goal: args.goal, blendOn: args.blendOn, helpsScale }),
  );
  // A Plan B that is also a card of its own says so, with that card's place in this sort (review of track F: the same
  // trade showed twice without a word).
  const place = new Map(sorted.map((c, i) => [c.key, i + 1]));
  const cards = sorted.map((c) => {
    const at = c.planB ? place.get(c.planB.key) : undefined;
    return c.planB && at !== undefined ? { ...c, planB: { ...c.planB, also: planBAlsoText(at) } } : c;
  });
  const sortLabel = SORT_OPTIONS.find((o) => o.value === args.sort)?.label ?? "Overall";
  const odds = baselineLines(baseline, "finder");
  const hidden = hiddenText(result.hidden);
  let empty: FinderView["empty"] = null;
  // The search's notes, then each distinct note of the evaluations themselves (TradeDetail.notes), once, worded for the
  // list, then a saved FantasyCalc list standing in (the cards' numbers rest on its values).
  let notes = [...result.notes];
  for (const e of result.trades) {
    for (const n of e.detail.notes) {
      const note = listNote(n);
      if (!notes.includes(note)) notes.push(note);
    }
  }
  // A saved FantasyCalc list standing in: the cards' numbers rest on its values.
  const fcNote = args.fantasyCalc?.note;
  if (fcNote && cards.length && !notes.includes(fcNote)) notes.push(fcNote);
  const minChance = result.filter?.minChance ?? 0;
  if (!cards.length) {
    // Notes explain the emptiness only when the search stopped before screening anything (see the header).
    if (result.counts.screened === 0 && notes.length) {
      empty = { title: "No trade ideas right now", text: notes };
      notes = [];
    } else if (minChance > 0 && (result.filter?.few || (result.hidden.byChance ?? 0) > 0)) {
      // Every idea the guards keep falls below the minimum chance (rank.ts applies it after them; a lower setting shows them).
      empty = {
        title: "No trade ideas at this minimum chance",
        text: [`Every trade idea that would otherwise show is below “at least ${minChanceLabel(minChance)}”. Try a lower setting to see more.`, ...(hidden ? [hidden] : [])],
      };
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
    // Long-term values counted unless the engine says they're missing (TradeEvaluation.dynMissing: B is B_win alone then).
    helpsInfo: cards.length ? helpsInfoText(snapshot.settings.leagueType, args.fantasyCalc?.available ?? true, !result.trades.some((e) => e.dynMissing), helpsScale) : null,
    helpsScale,
    pattern: cards.length && result.pattern?.text ? result.pattern.text : null,
    few: cards.length ? fewText(result) : null,
    cards,
    countText: cards.length ? `${plural(cards.length, "trade idea")}, sorted by ${sortLabel}.` : "",
    statusText: cards.length ? `Found ${plural(cards.length, "trade idea")}.` : `${empty?.title ?? "No trade ideas right now"}.`,
    // Said once: in the empty state when that's where it is.
    hidden: hidden !== null && empty?.text.includes(hidden) ? null : hidden,
    searched: searchedText(result),
    notes,
    warnings: noticeWarnings(result.warnings),
    empty,
  };
}

/**
 * The search's warnings as the Trade Finder shows them (planner reply to Checkpoint 7a, §5.1): notices only, in plain words
 * (src/lib/notices.ts modelWarningRule), each once. A player-level warning is the League page's to judge (it knows who is
 * a likely starter), and a technical one belongs in the Import Report's technical details, never on this page.
 */
export function noticeWarnings(warnings: readonly string[]): string[] {
  const out: string[] = [];
  for (const w of warnings) {
    const r = modelWarningRule(w);
    if (r.rule === "notice" && !out.includes(r.text)) out.push(r.text);
  }
  return out;
}

/**
 * "What does your league reward?" (TradeSettings.goal; planner reply to Checkpoint 7a, 5.2: framed by what the league rewards,
 * "What matters most" before) as the Settings page names its options: "Only the champion" (the default, "title"), "Top
 * finishers too" ("balanced"), "Making the playoffs" ("playoffs").
 */
export const GOAL_LABEL: Readonly<Record<Goal, string>> = { title: "Only the champion", balanced: "Top finishers too", playoffs: "Making the playoffs" };

/**
 * What the search's settings let a trade idea be, in one line ("Up to 2 players a side and 1 untouchable."), and the
 * settings that change how ideas are scored when they aren't the default: what the league rewards ("Your league rewards:
 * Top finishers too."; Phase 4c's goal) and, in a redraft league, "Protect my trade value".
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
  const goal = settings.goal !== config.benefit.goalDefault && GOAL_LABEL[settings.goal] ? ` Your league rewards: ${GOAL_LABEL[settings.goal]}.` : "";
  // The level as the Settings page names it ("High", "Low").
  const level = `${settings.protectValue.charAt(0).toUpperCase()}${settings.protectValue.slice(1)}`;
  const protect = leagueType === "redraft" && settings.protectValue !== config.benefit.protectValueDefault ? ` Protect my trade value: ${level}.` : "";
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.${goal}${protect}`;
}

// ---------------------------------------------------------------------------------------------
// Progress (M14's progress bar)

const STAGE_ORDER: readonly TradeSearchStage[] = ["setup", "screening", "exact", "simScreen", "simFinal", "rank"];
/**
 * Each stage's share of the bar: a rough guide to where the time goes, not a measurement. Phase 4c (the exhaustive
 * candidates): screening about 45% of a search on Parker's league (the 4c measurements: context 0.3 s, screening 2.2 s,
 * exact 1.2 s, simulations 0.5 s and 0.7 s, steps and words 0.2 s).
 */
const STAGE_WEIGHT: Record<TradeSearchStage, number> = { setup: 0.05, screening: 0.45, exact: 0.24, simScreen: 0.1, simFinal: 0.12, rank: 0.04 };

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

/**
 * The progress bar in words. `mode` "refilter" (Phase 4c: the minimum chance changed, and the worker ranks the same ideas
 * again: search.ts refilterSearch) shows the ranking and words alone, the whole bar for the "rank" stage; a search, and a
 * re-filter that had to search afresh (any other stage), the stages by STAGE_WEIGHT.
 */
export function progressView(p: TradeSearchProgress | null, mode: "search" | "refilter" = "search"): ProgressView {
  const stage = p?.stage ?? (mode === "refilter" ? "rank" : "setup");
  const share = p && p.total > 0 ? Math.min(1, Math.max(0, p.done / p.total)) : 0;
  let fraction: number;
  if (mode === "refilter" && stage === "rank") {
    fraction = share;
  } else {
    const index = Math.max(0, STAGE_ORDER.indexOf(stage));
    const before = STAGE_ORDER.slice(0, index).reduce((s, st) => s + STAGE_WEIGHT[st], 0);
    fraction = before + STAGE_WEIGHT[stage] * share;
  }
  const percent = Math.min(99, Math.max(0, Math.floor(fraction * 100)));
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

/**
 * Where an Analyzer trade came from, when that changes how it's shown: "planB", a card's "If they say no, try:" (the
 * Analyzer shows it as one offer, without "How to offer it": review of Phase 4b, whose first offer could be smaller than
 * the trade they had just turned down).
 */
export type AnalyzerFrom = "planB";

/** The Trade Analyzer, prefilled with a trade (players only: picks wait for Phase 5, M11), and where it came from (`from=planB`). */
export function analyzerHref(p: Pick<TradeProposal, "partnerId" | "give" | "get">, opts: { from?: AnalyzerFrom | null | undefined } = {}): string {
  const q = new URLSearchParams();
  q.set("partner", p.partnerId);
  for (const a of p.give) if (a.kind === "player") q.append("give", a.id);
  for (const a of p.get) if (a.kind === "player") q.append("get", a.id);
  if (opts.from) q.set("from", opts.from);
  return `${ANALYZER_PATH}?${q.toString()}`;
}

/** Where the Analyzer's address says its trade came from (`?from=planB`), else null. */
export function readAnalyzerFrom(search: string | null | undefined): AnalyzerFrom | null {
  return new URLSearchParams(search ?? "").get("from") === "planB" ? "planB" : null;
}

/** The Analyzer's note for a trade opened from "If they say no, try:" (buildAnalysisView). */
export const FROM_PLAN_B_NOTE =
  "You opened this from “If they say no, try:” on a trade idea, so it's shown as one offer, without a smaller first offer to try before it: they've just turned down a trade with the same team.";

/**
 * A trade's key read back into a proposal (TradeEvaluation.key, evaluate.ts proposalKey: "<partner>|give:<ids>|get:<ids>",
 * each side's assets sorted, a pick as "pick:<season>:<round>:<original team>"; the test fixtures' "<partner>|<ids>|<ids>"
 * too), for naming a recorded version the card no longer shows (CardFeedback.versionWords); null when it isn't one.
 */
export function proposalFromKey(key: string | null | undefined): TradeProposal | null {
  if (typeof key !== "string") return null;
  const parts = key.split("|");
  if (parts.length !== 3) return null;
  const [partnerId = "", give = "", get = ""] = parts;
  if (!partnerId) return null;
  const side = (text: string, prefix: string): TradeAsset[] | null => {
    const list = text.startsWith(prefix) ? text.slice(prefix.length) : text;
    if (!list) return [];
    const out: TradeAsset[] = [];
    for (const id of list.split(",")) {
      if (!id) return null;
      const pick = /^pick:(\d+):(\d+):(.+)$/.exec(id);
      out.push(pick ? { kind: "pick", season: Number(pick[1]), round: Number(pick[2]), originalTeamId: pick[3] ?? "" } : { kind: "player", id });
    }
    return out;
  };
  const g = side(give, "give:");
  const r = side(get, "get:");
  return g && r && g.length + r.length > 0 ? { partnerId, give: g, get: r } : null;
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

/**
 * The players a team can trade here: its active roster, then its IR (Phase 4b: IR players are tradable, planner reply to
 * Checkpoint 4, change 5; the engine places a received one, evaluate.ts rule 5), each once. Taxi players aren't tradable.
 */
function tradableRoster(snapshot: Pick<LeagueSnapshot, "teams">, teamId: string | null): string[] {
  const team = teamId ? snapshot.teams.find((t) => t.id === teamId) : undefined;
  return team ? [...new Set([...team.roster, ...team.ir])] : [];
}

/** A team's IR players (an Analyzer choice says so). */
function irOf(snapshot: Pick<LeagueSnapshot, "teams">, teamId: string | null): ReadonlySet<string> {
  return new Set(teamId ? (snapshot.teams.find((t) => t.id === teamId)?.ir ?? []) : []);
}

function keepIds(ids: readonly string[], allowed: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) if (allowed.includes(id) && !out.includes(id) && out.length < ANALYZER_MAX_PER_SIDE) out.push(id);
  return out;
}

/**
 * The Analyzer's trade from its address (`?partner=&give=&get=`): only another team of this league, my players to give and
 * the partner's to get from the active rosters and IR (Phase 4b; taxi players aren't tradable), each once, at most
 * ANALYZER_MAX_PER_SIDE a side. Anything else is ignored.
 */
export function readAnalyzerDraft(search: string | null | undefined, snapshot: Pick<LeagueSnapshot, "teams">, myTeamId: string | null): AnalyzerDraft {
  const q = new URLSearchParams(search ?? "");
  const partnerId = partnerOrNull(snapshot, myTeamId, q.get("partner"));
  return { partnerId, give: keepIds(q.getAll("give"), tradableRoster(snapshot, myTeamId)), get: keepIds(q.getAll("get"), tradableRoster(snapshot, partnerId)) };
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

/** Words after an IR player's position and team in an Analyzer choice. */
export const IR_SLOT_TEXT = "IR slot";

function choices(snapshot: SnapshotPart, ids: readonly string[], picked: readonly string[], ir: ReadonlySet<string> = new Set()): PlayerChoice[] {
  const full = picked.length >= ANALYZER_MAX_PER_SIDE;
  const rank = (id: string) => POS_RANK.get(snapshot.players[id]?.pos as Pos) ?? POSITIONS.length;
  return [...ids]
    .sort((a, b) => rank(a) - rank(b) || (snapshot.players[a]?.name ?? a).localeCompare(snapshot.players[b]?.name ?? b) || (a < b ? -1 : a > b ? 1 : 0))
    .map((id) => {
      const view = assetView({ kind: "player", id }, snapshot);
      const checked = picked.includes(id);
      const detail = ir.has(id) ? [view.detail, IR_SLOT_TEXT].filter(Boolean).join(" · ") : view.detail;
      return { id, name: view.name, detail, injury: view.injury, checked, disabled: full && !checked };
    });
}

/**
 * What the Analyzer offers: the other teams, my players and the partner's (active rosters and IR, an IR player's detail
 * saying "IR slot"), each player checked as in the draft.
 */
export function analyzerChoices(snapshot: SnapshotPart, myTeamId: string | null, draft: AnalyzerDraft): AnalyzerChoices {
  return {
    partners: snapshot.teams.filter((t) => t.id !== myTeamId).map((t) => ({ id: t.id, name: t.name })),
    mine: choices(snapshot, tradableRoster(snapshot, myTeamId), draft.give, irOf(snapshot, myTeamId)),
    theirs: choices(snapshot, tradableRoster(snapshot, draft.partnerId), draft.get, irOf(snapshot, draft.partnerId)),
    limitText: `Up to ${ANALYZER_MAX_PER_SIDE} players a side, from the active rosters and IR (players on a taxi squad can't be traded here yet).`,
  };
}

/** The Analyzer's result in words: my odds before the trade, the card, or why the trade can't be made, and the notes. */
export interface AnalysisView {
  /** "Your odds before this trade: 62% to make the playoffs, 9.9% to win the title." and what they count (baselineLines), with a card only; null otherwise. */
  baseline: string | null;
  baselineNote: string | null;
  /** What "Helps you" sums up (helpsInfoText), with a card only; null otherwise. */
  helpsInfo: string | null;
  /** The evaluation's "Helps you" scale (TradeAnalysis.helpsScale), for "How to read" (HowToRead.helpsScaleWords); null when unknown. */
  helpsScale: HelpsScale | null;
  card: TradeCardView | null;
  illegal: string | null;
  notes: string[];
}

/**
 * The Analyzer's result in words. `analysis.baseline` (my odds before any trade, which the worker sends with the
 * evaluation: src/workers/engine.worker.ts) gives the card's odds their "before" and the line above it, so a trade reads
 * the same as on the Trade Finder (review of Phase 4: the Finder's "+9.1 percentage points (63% to 72%)" read "+9.1
 * percentage points" here). Without it, the card shows the changes alone. The card has "Details" (what Helps you is
 * worth in points a week: detailsView), and the Finder's odds and weekly lines; its tooltip, the info line and Details on
 * the evaluation's own scale (TradeAnalysis.helpsScale). `from` "planB" (a trade opened from a card's "If they say no,
 * try:", evaluated without "How to offer it": the worker's `steps: false`) says so first among the notes, with a card; a
 * saved FantasyCalc list standing in says so last (the card's numbers rest on its values). `fantasyCalc`: FantasyCalc's
 * values as the page holds them (fantasyCalcLookup: CardContext.fantasyCalc, never shown); `goal`: what the league rewards
 * as the evaluation weighted B (the feedback's inputs); `blendOn`: whether the market blend reaches anyone (marketBlendOn:
 * CardContext.blendOn).
 */
export function buildAnalysisView(
  analysis: TradeAnalysis & { baseline?: CardContext["baseline"] },
  snapshot: SnapshotPart,
  lastNflWeek?: number,
  opts: { from?: AnalyzerFrom | null | undefined; fantasyCalc?: FantasyCalcLookup | undefined; goal?: Goal | null | undefined; blendOn?: boolean | undefined } = {},
): AnalysisView {
  const baseline = analysis.baseline ?? null;
  // The evaluation's "Helps you" scale (the tooltip, the info line and Details follow the mix with long-term values).
  const helpsScale = analysis.helpsScale ?? null;
  const card =
    analysis.evaluation && !analysis.illegal
      ? buildTradeCard(analysis.evaluation, { snapshot, baseline, lastNflWeek, fantasyCalc: opts.fantasyCalc, goal: opts.goal, blendOn: opts.blendOn, details: true, helpsScale })
      : null;
  const odds = card ? baselineLines(baseline, "analyzer") : null;
  // A note the card's reasons already say isn't said twice.
  const said = new Set(card?.reasons ?? []);
  const notes = [...new Set(analysis.notes)].filter((n) => !said.has(n));
  const fcNote = card ? opts.fantasyCalc?.note : null;
  if (fcNote && !notes.includes(fcNote)) notes.push(fcNote);
  return {
    baseline: odds?.text ?? null,
    baselineNote: odds?.note ?? null,
    // Long-term values counted unless the engine says they're missing (TradeEvaluation.dynMissing).
    helpsInfo: card ? helpsInfoText(snapshot.settings.leagueType, opts.fantasyCalc?.available ?? true, !card.evaluation.dynMissing, helpsScale) : null,
    helpsScale,
    card,
    illegal: analysis.illegal,
    notes: card && opts.from === "planB" ? [FROM_PLAN_B_NOTE, ...notes] : notes,
  };
}

// ---------------------------------------------------------------------------------------------
// Feedback (§11; src/lib/feedbackStore.ts)

export interface CardFeedback {
  outcome: FeedbackOutcome | null;
  report: { reason: FeedbackReason; note: string | null } | null;
  /** Which version was sent (FeedbackRecord.version), null when unknown or nothing is saved. */
  version: FeedbackVersion | null;
  /** That version's trade key (FeedbackRecord.versionKey), null when unknown (a record made before keys were saved, or none). */
  versionKey: string | null;
  /** That version's trade in words ("Kyle Monangai and Bo Nix for Carnell Tate", read from its key), null when unknown. */
  versionWords: string | null;
}

/**
 * What this browser has saved for a trade idea (all null when nothing). With the league's `snapshot`, the recorded
 * version's trade in words (versionWords, from its key: proposalFromKey).
 */
export function cardFeedback(records: readonly FeedbackRecord[] | undefined, leagueKey: string, tradeKey: string, snapshot?: SnapshotPart): CardFeedback {
  const record = records ? feedbackFor(records, leagueKey, tradeKey) : undefined;
  const version = record?.version ?? null;
  const versionKey = version !== null ? (record?.versionKey ?? null) : null;
  const proposal = versionKey !== null && snapshot ? proposalFromKey(versionKey) : null;
  return {
    outcome: record?.outcome?.kind ?? null,
    report: record?.report ? { reason: record.report.reason, note: record.report.note ?? null } : null,
    version,
    versionKey,
    versionWords: proposal && snapshot ? tradeWords(proposal, snapshot) : null,
  };
}

/**
 * The "Version:" line under a card's outcome buttons (the file header), or null: the recorded version's label when its key
 * is one the card shows (on a card with two; a plain card's one version goes without saying; a record without a key,
 * made before keys were saved, by its kind alone), else "an earlier one" with its trade in words when a version with a
 * key is recorded that the card doesn't show (review of Phase 4b: after a refresh changed a card's Plan B, the line named
 * the box shown now; the Analyzer's card for the same trade said nothing).
 */
export function versionLine(feedback: Pick<CardFeedback, "outcome" | "version" | "versionKey" | "versionWords">, versions: readonly VersionChoice[]): string | null {
  if (!feedback.outcome || feedback.version === null) return null;
  const key = feedback.versionKey;
  const shown = key !== null ? versions.find((v) => v.key === key) : versions.length > 1 ? versions.find((v) => v.version === feedback.version) : undefined;
  if (shown) return versions.length > 1 ? shown.label : null;
  if (key === null) return null;
  return feedback.versionWords ? `an earlier one (${feedback.versionWords})` : "an earlier one";
}
