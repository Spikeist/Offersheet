/**
 * How to read a trade card, in words (§10, §11, §13), on both trade pages: the Trade Finder's ideas and the Trade
 * Analyzer's evaluated trade (review of the planner addendum to Checkpoint 3: the Analyzer showed "Harder to get" and
 * "How to offer it" with nothing on the page saying what they mean, and a card whose message proposed a smaller trade
 * than the one built, without saying why).
 * - Helps you, per league type: in a redraft league it also counts trade value, by the "Protect my trade value"
 *   setting (planner addendum, §3); in dynasty and keeper leagues, long-term value by the Win now ↔ Future setting.
 * - Chance they accept, Overall, "Harder to get" (§2) and "How to offer it" (§4), then ROS points and trade values.
 * The Analyzer's version says what differs there: nothing is ranked or left out (a trade the Finder leaves out shows
 * there with its warning), and the trade built can itself give a player to spare along with someone else (lead
 * decision N4, case 1): the first offer leaves him out, the message proposes that offer, and the card's numbers stay
 * those of the trade built (TradeSteps.ranked "full").
 * Planner reply to Checkpoint 4: "If they say no, try:" (change 6; the Finder's cards only: the Analyzer gives none;
 * since the review of track F, a trade likelier to go through than the card, by the steps' own bar), the injury tags
 * (a week shows when the projection counts on it) and what a tagged player's projection assumes (change 6).
 * Review of Phase 4b: "Chance they accept" names what moves it, the trade's effect on their starting lineup included
 * (change 2 doubled its weight in redraft and keeper leagues), and its cap (config.acceptance.pAcceptClamp: "never above
 * 85%"); "If they say no, try" has its own message, and opens in the Analyzer as one offer (no smaller first offer, the
 * Analyzer's "How to offer it" says so).
 * Planner reply to Checkpoint 4b (Phase 4c): Helps you weighs the title and playoff odds by the league's goal (change 8;
 * since the planner's reply to Checkpoint 7a, 5.2, the setting "What does your league reward?", "What matters most"
 * before), and the card shows those odds before and after, with the weeks whose win chance moves (change 9: weeklyLineWords,
 * from config.explain; "If they say no, try" shows its own odds too); an estimate under 5% shows "<5%" (answer 5); the
 * Finder's "Chance they accept: at least" and its default (change 10: config.ranking.minChanceDefault), judged on the
 * chance the trade goes through; trade values come from FantasyCalc and are never shown (planner reply to Checkpoint 7a,
 * 5.4: the card said they were FantasyCalc's own until Phase 7b), while the chance they accept, Helps you and the Market
 * check count roster spots, a throw-in worth no more than W, the best free agent no team is expected to pick up, adding
 * nothing (change 2), and the Analyzer's "Details" shows what Helps you is worth in points a week; my side counts the
 * free-agent moves a card says the trade counts on too (final review of Phase 4c, finding R1: evaluate.ts
 * freeAgentMovesOf), and the weekly line lists the weeks it drops first (finding R8).
 * Review of track UIC (findings 2 and 3): what it says about values follows the league's data (src/lib/tradeView.ts
 * ValueFacts, the engine's own tests, from the model inputs the page holds): Helps you counts trade value in a redraft
 * league only while FantasyCalc's values are available (`valuesOn`: B has no market term in the curve fallback, and none
 * moves without values), and long-term value in a dynasty or keeper league only when it loaded (`longTermOn`: else B is
 * the odds alone, "counts this season only" as the cards' note says); a hurt player's projection is "blended with the
 * trade market" only while the blend is on (`blendOn`). Each defaults to on, so the page reads as before while the league's
 * data loads.
 * Planner reply to Checkpoint 4c (Phase 7a, A2): Helps you's scale, the same whatever the league rewards ("What does your
 * league reward?", the setting the goal became: planner reply to Checkpoint 7a, 5.2; review of Phase 7b: the page said
 * "Under every goal", the setting's old word): 63 is about as good as
 * adding 3 points a week to your lineup for the rest of the season; in a dynasty or keeper league with long-term values,
 * together with 10% more long-term value, weighed by Win now ↔ Future (planner reply to Checkpoint 7a, §2 question 6: "the
 * tooltip follows the mix"); "a note on the page says so" only when the floor note shows (helpsScaleWords, from config and
 * the search's or the evaluation's scale).
 * Checkpoint 7c (planner reply to Checkpoint 7b, §6): under "Several prizes" paying more than 1st place, Helps you "weighs your
 * chances at your league's prizes and your playoff odds by your “What does your league reward?” setting" (⚠️ ours: the
 * setting named, never "goal", which the tests forbid here; tradeView.ts weighedOddsWords, the info line's own words), read
 * off the reward when the page passes it, else off the scale it already passes (HelpsScale.oddsNamed "prizes"; ⚠️ the
 * title's words while a paid prize's odds are unknown then, where the scale names the playoff odds). The odds each card
 * shows are named then, not "those odds" (review of the prizes UI, prizes-ui-6: a weekly high score or the points title has
 * no odds line): "your title, top-3 and playoff odds" by the reward, else the top-N line's rule (tradeView.ts cardOddsWords).
 * Checkpoint 7c (planner reply to Checkpoint 7b, §7: "How to read explains Helps them and the sort in plain words"): after
 * Overall, "Helps them" in the planner's tooltip's words (a phone can't hover), where the card shows it, what it counts by
 * league type (review of the "Helps both" UI, helps-both-ui-1: no trade value in a redraft league; their roster's long-term
 * value in a dynasty or keeper league, weighed by their own playoff odds, never by the user's Win now ↔ Future setting), when
 * a card is tagged "Helps both" (config.benefit.helpsThemMin) and what the "Helps both" sort shows (helpsThemWords), on both
 * pages. Checkpoint 7d (planner reply to Checkpoint 7c, answers 3 and 5): a trade idea shows Helps them only when it helps
 * both teams, the Analyzer's card always ("then it reads 0" when the trade costs them), and the tag needs the bar on both
 * scores; the sentence on what it counts names Helps them, which the sentence before it no longer ends on (review of
 * Checkpoint 7d, cards-export-4).
 * Checkpoint 7e (planner reply to Checkpoint 7d, items 4.1 and 2.2): "How to offer it" is the ladder of offers on every
 * card that helps me, worked out when it's opened (offersWords: up to config.offers.maxSteps offers in order, "Open with",
 * "Then", the suggested trade or the trade built, "Last offer", by their rules from config, and what each shows; the
 * Analyzer's names the trade built, and a trade opened from Plan B is one offer), replacing Phase 4's two steps; Plan B
 * reads "If they won't move: try …", below an idea; and the "Roster moves these numbers assume" box is explained on both
 * pages (rosterMovesWords: its lines, the line of moves made either way, and whose odds start from them), which wave B left
 * unexplained. The review of wave D: the Analyzer names where its minimum chance is set (the Trade Finder: UI-D-9), the
 * Finder says no offer is the idea's Plan B (D-ENG-2; since the lead's call for wave D, that an offer which is another idea
 * on the list says so with its place, where it said no offer was one), Plan B is a different set of their players (D-ENG-5,
 * UI-D-5: the planner's "a different target"), and "Now or after this week" (item 4.2) is explained on both pages
 * (nowOrLaterWords: UI-D-9).
 * Checkpoint 7f (planner reply to Checkpoint 7e, decision 3, merged cards; search.ts, "Merged cards"): the Finder says that
 * when an idea's offers include another idea below it on Overall, only the higher one shows and the other is among its
 * offers, and that an offer which is another idea is one above it on Overall whose own offers don't include this one (the
 * lead's call, policy (a); the review of the merge, MERGE-1 and MERGE-2: the first words stated the rule for every pair and
 * said the higher idea "can't offer this one back", which is false when this one is its lean version), still labeled with
 * its place; the Plan B sentence stays. The Analyzer's words don't change (it shows one card).
 * A native <details>, closed at first; its summary is a 44 px target.
 */
import type { HelpsScale } from "@/engine/benefit";
import { config } from "@/engine/config";
import type { LeagueSettings } from "@/engine/model";
import type { Reward } from "@/engine/reward";
import { fmtNum } from "@/lib/format";
import { GOAL_LABEL, HARDER_TO_GET_TAG, HELPS_BOTH_TAG, HELPS_THEM_LABEL, OFFERS_HEADING, PLAN_B_HEADING, ROSTER_MOVES_HEADING, cardOddsWords, harderToGetWho, minChanceLabel, planBAlsoText, weighedOddsWords } from "@/lib/tradeView";

export type HowToReadPage = "finder" | "analyzer";

/** Plan B's least Helps you, as a share of the card's (config.search.planB.minHelpsShare): "half as much", "60% as much". */
export function planBShareWords(share: number = config.search.planB.minHelpsShare): string {
  return share === 0.5 ? "half as much" : `${Math.round(share * 100)}% as much`;
}

/** A share in words, "80%" (a whole percent). */
const percentWords = (share: number): string => `${Math.round(share * 100)}%`;

/** "4 offers", "1 offer" (config.offers.maxSteps). */
const offersCountWords = (n: number): string => `${n} ${n === 1 ? "offer" : "offers"}`;

/**
 * "How to offer it" in words, after the paragraph's bold heading (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1):
 * up to config.offers.maxSteps offers to the same team, in order, by the ladder's rules (offers-engine: an opening offer
 * printing at least config.offers.openMinChance, or the minimum chance when that's higher; each later one at least
 * config.search.steps.minAcceptGain likelier; the last adding a player I can spare while B stays at least
 * config.search.steps.minBShare of the suggested trade's), what each shows, and when it says to offer the trade as it is.
 * The Analyzer names the trade built, where its minimum chance is set (the Trade Finder's control: the Analyzer has none), and
 * how a trade opened from Plan B is shown; the Finder, that since Checkpoint 7f an idea another idea above it on Overall
 * offers is among that idea's offers only (search.ts, "Merged cards"), that an offer which is another idea of the list (one
 * above it on Overall whose own offers don't include this one) says so with its place ("Also shown as trade idea 2.":
 * TradeCard.tsx) and that none is its Plan B (offers.ts). Checkpoint 7g (planner reply to Checkpoint 7f, answer 3; the lead's
 * D19): the Last offer is the trade plus a player I can spare or the trade asking for fewer of their players, whichever has the
 * higher Overall (the throw-in keeping config.search.steps.minBShare of B, the smaller ask config.offers.lastMinOverallShare
 * of the Overall: offers.ts, "4. Last offer"), on both pages; and the Finder says a version of the same trade at least as good
 * on both Helps you and the chance shows alone (search.ts, "Merged cards, Checkpoint 7g").
 */
export function offersWords(page: HowToReadPage): string {
  const analyzer = page === "analyzer";
  const own = analyzer ? "the trade you built" : "the idea itself";
  const gain = planBGainWords(config.search.steps.minAcceptGain);
  const steps =
    `“Open with” the version that helps you most while it still has at least a ${percentWords(config.offers.openMinChance)} chance they accept (or ${analyzer ? "the minimum chance you set on the Trade Finder" : "your minimum chance"}, ` +
    `when that's higher); “Then”, versions that help you a little less, each at least ${gain} likelier than the one before; ` +
    `“${analyzer ? "The trade you built" : "The suggested trade"}”${analyzer ? "" : `, ${own}`}; and “Last offer”, ${analyzer ? "the trade you built" : "the suggested trade"} plus a player you can spare ` +
    `(losing him costs your lineup little) or asking for fewer of their players, whichever has the higher Overall, when it's at least ${gain} likelier; ` +
    `with a player added it still does at least ${percentWords(config.search.steps.minBShare)} as much for you, and asking for fewer it keeps at least ${percentWords(config.offers.lastMinOverallShare)} of ${analyzer ? "the Overall of the trade you built" : "the idea's Overall"}.`;
  const each = `Each offer shows Helps you, the chance they accept, the roster moves its numbers assume when they aren't ${analyzer ? "this card's" : "the idea's"}, and its own message to send them.`;
  const lead = analyzer
    ? `works out, when you open it, up to ${offersCountWords(config.offers.maxSteps)} of this trade to the same team, in order:`
    : `works out, when you open it on an idea that helps you, up to ${offersCountWords(config.offers.maxSteps)} to the same team, in order:`;
  const tail = analyzer
    ? `When no other version makes a better first offer, it says to offer the trade as it is. A trade opened from a trade idea's “${PLAN_B_HEADING}” is shown as one offer instead: they've just turned down a trade with the same team.`
    : `When an idea's offers include another idea below it on Overall, the list shows only the higher one, and the other is among its offers. When two ideas are versions of the same trade and one is at least as good on both Helps you and the chance, only that one shows. An offer can still be an idea above it on Overall whose own offers don't include this one; it then says so, with that idea's place (“${planBAlsoText(2)}”). The idea's own “${PLAN_B_HEADING}” trade is never one of its offers. When no other version makes a better first offer, it says to offer the trade as it is.`;
  return `${lead} ${steps} ${each} ${tail}`;
}

/**
 * "Now or after this week" in words (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.2; the review of wave D, UI-D-9:
 * How to read didn't explain the line): when a card shows it (the two printed Helps you more than config.explain.
 * nowOrLaterMin apart, at least config.explain.nowOrLaterWeeks weeks before the deadline) and the planner's tooltip.
 */
export function nowOrLaterWords(): string {
  const min: number = config.explain.nowOrLaterMin;
  const weeks: number = config.explain.nowOrLaterWeeks;
  return (
    `shows on a card when making the same trade after this week's games would change Helps you by more than ${min} (“Helps you 37 now · 41 if done after this week's games.”), ` +
    `while at least ${weeks} ${weeks === 1 ? "week remains" : "weeks remain"} before your trade deadline. It assumes the same deal is still there next week: injuries, big games or another trade can change that, and their answer may change too.`
  );
}

/**
 * The roster moves box in words (Checkpoint 7e: planner reply to Checkpoint 7d, item 2.2, "Each card lists every roster move
 * its numbers assume, in order, each with its reason and its week"; wave B's box, which How to read hadn't explained): what
 * its lines are, the line of moves made either way, and (item 2.1) whose odds then start from them. Checkpoint 7f (planner
 * reply to Checkpoint 7e, answer 4: "keep the rule, but the card must say why"): when the near-tie rule decides a release at
 * an IR return the trade changes, the line says why (tradeView.ts releaseReason), and a release made with or without the trade
 * is named at the end with the moves made either way (RosterMoves.assumedLater), its reason on the League page's roster card.
 * The review of Checkpoint 7f (PIERCE-2): the rule's words as it decides (the player the lineup would miss least goes unless
 * another, nearly as cheap to lose from then on, has less trade value; values tie at the best free agent's, where the lineup
 * decides), where "the one with less trade value goes" wasn't always so, and the reason shows only when trade value decided.
 */
export function rosterMovesWords(page: HowToReadPage): string {
  const either =
    page === "analyzer"
      ? "when one isn't on the League page's list, your odds before this trade count it too."
      : "when one isn't on the League page's list, the idea's odds start from your odds with it, and the card says so.";
  return (
    "lists, in order, each move to your roster that the card's numbers count on, with its reason and its week: a player you'd drop to stay within your " +
    "league's limits or to make room, a free agent for a roster spot the trade opens, a waiver move the trade makes worthwhile, and who you'd release when a " +
    "player comes back from IR (when the player your lineup would miss least has more trade value than another player nearly as cheap to lose from then on, " +
    "that other player goes instead, and the line says why). " +
    `Moves you'd make with or without the trade, like the pickups the League page suggests, are named at the end and aren't counted for the trade; ${either} ` +
    "A release you'd make with or without the trade is named with those moves, and your roster card on the League page says why. " +
    "The other team's moves follow yours."
  );
}

/**
 * How much likelier a Plan B is to go through than its card (planB.ts: config.search.steps.minAcceptGain, the steps' own
 * bar): "5 percentage points" (never bare "points", which would read as fantasy points).
 */
export function planBGainWords(gain: number = config.search.steps.minAcceptGain): string {
  const n = Math.round(gain * 100);
  return `${n} percentage ${n === 1 ? "point" : "points"}`;
}

/** The most an estimate shows (config.acceptance.pAcceptClamp's top, rounded as estimates are shown): "85%". */
export function acceptCapWords(cap: number = config.acceptance.pAcceptClamp[1]): string {
  return `${Math.round(cap * 100)}%`;
}

/**
 * The card's weekly line, in words from config.explain: "by 3 percentage points or more (up to 4 weeks, the drops first,
 * then the biggest gains)" (tradeView.weeklyLine's order since the final review of Phase 4c, finding R8).
 */
export function weeklyLineWords(min: number = config.explain.weeklyLineMin, max: number = config.explain.weeklyLineMax): string {
  const n = Math.round(min * 100);
  return `by ${n} percentage ${n === 1 ? "point" : "points"} or more (up to ${max} ${max === 1 ? "week" : "weeks"}, the drops first, then the biggest gains)`;
}

/** What helpsScaleWords reads (each optional: the redraft wording, without the floor's note, when absent). */
export interface HelpsScaleWordsOptions {
  /** The search's or the evaluation's scale (TradeSearchResult.helpsScale, TradeAnalysis.helpsScale); null or absent: not known yet. */
  scale?: HelpsScale | null | undefined;
  leagueType?: LeagueSettings["leagueType"] | undefined;
  /** Dynasty and keeper leagues: long-term values loaded (ValueFacts.longTermOn), so the scale is the mix. */
  longTermOn?: boolean | undefined;
  /** Points a week that read 63 (config.benefit.helpsGain). */
  gain?: number | undefined;
}

/**
 * The "Helps you" scale in words (planner reply to Checkpoint 4c, A2; benefit.ts's header, the three numbers): "Under every
 * goal, 63 is about as good as adding 3 points a week to your lineup for the rest of the season (28 for 1 point a week, 86
 * for 6)." A gain of g points a week reads round(100 × (1 − e^(−g / helpsGain))) when B grows in proportion to the gain (B =
 * B₃ at helpsGain, config.benefit.helpsGain). Then "When that doesn't hold for your team right now, a note on the page says
 * so." only when that note shows (the floor: HelpsScale.reason "odds", benefit.helpsScaleNotes). In a dynasty or keeper
 * league with long-term values the scale follows the mix (planner reply to Checkpoint 7a, §2 question 6): "In a dynasty
 * league, 63 is about as good as adding 3 points a week to your lineup this season together with 10% more long-term value for
 * your roster, weighed by your Win now ↔ Future setting: 3 points a week alone reads 50, and 10% more long-term value alone
 * reads 26." (what each alone reads when the scale is known: HelpsScale.gainReads and futureReads); at Win now ↔ Future's
 * ends, this season alone or long-term value alone.
 */
export function helpsScaleWords(opts: HelpsScaleWordsOptions = {}): string {
  const gain = opts.gain ?? config.benefit.helpsGain;
  const at = (g: number) => Math.round(100 * (1 - Math.exp(-g / gain)));
  const scale = opts.scale ?? null;
  const later = opts.leagueType === "keeper" || opts.leagueType === "dynasty" ? opts.leagueType : null;
  const note = scale?.reason === "odds" ? " When that doesn't hold for your team right now, a note on the page says so." : "";
  const share = `${Math.round(config.benefit.helpsFutureShare * 100)}% more long-term value`;
  // The mix (B_ref(λ)) with long-term values: the scale says so when it's known (λ set), else the league type does.
  const mix = scale ? scale.lambda !== null && scale.f10 !== null : later !== null && opts.longTermOn !== false;
  if (mix) {
    const where = `In a ${later ?? "dynasty or keeper"} league`;
    const lambda = scale?.lambda ?? Number.NaN;
    if (lambda >= 1) return `${where} with your Win now ↔ Future setting at Future, ${at(gain)} is about as good as adding ${share} to your roster.${note}`;
    // Win now ↔ Future at Win now (λ 0) counts this season only: the season's words below.
    if (!(lambda <= 0)) {
      const alone = scale && scale.futureReads !== null ? `: ${fmtNum(gain, 1)} points a week alone reads ${scale.gainReads}, and ${share} alone reads ${scale.futureReads}` : "";
      return `${where}, ${at(gain)} is about as good as adding ${fmtNum(gain, 1)} points a week to your lineup this season together with ${share} for your roster, weighed by your Win now ↔ Future setting${alone}.${note}`;
    }
  }
  const low = gain / 3;
  const high = gain * 2;
  return `Whatever your league rewards, ${at(gain)} is about as good as adding ${fmtNum(gain, 1)} points a week to your lineup for the rest of the season (${at(low)} for ${fmtNum(low, 1)} ${fmtNum(low, 1) === "1" ? "point" : "points"} a week, ${at(high)} for ${fmtNum(high, 1)}).${note}`;
}

/** What helpsThemWords reads besides the page (each optional: a redraft league's words and the bar from config when absent). */
export interface HelpsThemWordsOptions {
  leagueType?: LeagueSettings["leagueType"] | undefined;
  /** Dynasty and keeper leagues: long-term values loaded (ValueFacts.longTermOn), so Helps them counts their roster's long-term value too. */
  longTermOn?: boolean | undefined;
  /** The least Helps you and Helps them of a card tagged "Helps both" (config.benefit.helpsThemMin). */
  min?: number | undefined;
}

/**
 * What Helps them counts besides their odds, by league type and what loaded, as one sentence (review of the "Helps both" UI,
 * helps-both-ui-1: the paragraph said only "the same scale as Helps you, from their side", so a dynasty card whose Helps them
 * read 15 while all their odds fell read like a bug). B_P (benefit.ts partnerBenefit): in a redraft league no trade-value term
 * (the chance they accept weighs the trade value they see); in a dynasty or keeper league with long-term values their
 * roster's long-term value change (B_future,P) weighed by λ_P, config.benefit.lambda by their own playoff odds (more the
 * less likely they are to make the playoffs) or lambda.keeper, never the user's Win now ↔ Future setting; without long-term
 * values this season only, as Helps you. The card names which way their long-term value goes (tradeView.ts theirLongTermFact).
 * Each sentence names Helps them (review of Checkpoint 7d, cards-export-4): since 7d the sentence before it ends on "both Helps
 * you and Helps them" (the Trade Finder's) or on the Trade Finder (the Analyzer's), so a bare "It" read as the trade idea or as
 * Helps you, which does count trade value in a redraft league.
 */
export function helpsThemValueWords(leagueType: LeagueSettings["leagueType"] = "redraft", longTermOn = true): string {
  if (leagueType === "redraft") return `${HELPS_THEM_LABEL} doesn't count trade value: the chance they accept does.`;
  if (!longTermOn) return `Like Helps you, ${HELPS_THEM_LABEL} counts this season only while long-term trade values aren't available.`;
  const weighed = leagueType === "keeper" ? `weighed at a fixed ${Math.round(config.benefit.lambda.keeper * 100)}%` : "weighed more the less likely they are to make the playoffs";
  return `In a ${leagueType} league ${HELPS_THEM_LABEL} also counts the change in their roster's long-term value, ${weighed}, not by your Win now ↔ Future setting.`;
}

/**
 * "Helps them" and "Helps both" in words, after the paragraph's bold "Helps them" (Checkpoint 7c; planner reply to Checkpoint
 * 7b, §7: "How to read explains Helps them and the sort in plain words"): the planner's tooltip (src/lib/tradeView.ts
 * HELPS_THEM_TITLE, said here for a phone, which can't hover), where the card shows it, what it counts by league type
 * (helpsThemValueWords), when a card is tagged "Helps both" and what the "Helps both" sort shows (the Trade Finder's; the
 * Analyzer names it). Checkpoint 7d: a trade idea shows it only when it helps both teams, the Analyzer's card always, "Helps
 * them 0" too (planner reply to Checkpoint 7c, answer 3), and "Helps both" needs at least config.benefit.helpsThemMin on both
 * scores (answer 5).
 */
export function helpsThemWords(page: HowToReadPage, opts: HelpsThemWordsOptions = {}): string {
  const min = opts.min ?? config.benefit.helpsThemMin;
  const both = `at least ${min} on both Helps you and ${HELPS_THEM_LABEL}`;
  const where =
    page === "analyzer"
      ? "The card shows it with their odds before and after the trade, even when the trade costs them (then it reads 0); the Trade Finder shows it only on trade ideas that help both teams."
      : `A trade idea shows it, with their odds before and after the trade, only when it helps both teams: when it scores ${both}.`;
  const tagged =
    page === "analyzer"
      ? `A trade that scores ${both} is tagged “${HELPS_BOTH_TAG}”, and the Trade Finder's “${HELPS_BOTH_TAG}” sort shows such trades, sorted by how much they help you.`
      : `Such an idea is tagged “${HELPS_BOTH_TAG}”, and the “${HELPS_BOTH_TAG}” sort shows only those, sorted by how much they help you.`;
  return (
    "(0–100) uses the same scale as Helps you, from their side. Both teams can gain when each fills the other's weak spot. Helps you already counts the cost of making them stronger. " +
    `${where} ${helpsThemValueWords(opts.leagueType, opts.longTermOn !== false)} ${tagged}`
  );
}

export const HOW_TO_READ_TITLE: Record<HowToReadPage, string> = {
  finder: "How to read a trade idea",
  analyzer: "How to read the evaluation",
};

/** What Helps you counts besides the odds, by league type and what loaded (the header), as the paragraph's last sentences. */
function helpsValueWords(later: "keeper" | "dynasty" | null, valuesOn: boolean, longTermOn: boolean): string {
  if (later && longTermOn) {
    return ` In a ${later} league it also counts the change in your roster's long-term value, weighed by your Win now ↔ Future setting in Settings.${later === "keeper" ? " What it costs to keep a player next season isn't counted yet." : ""}`;
  }
  if (later) return ` In a ${later} league it would also count the change in your roster's long-term value, but long-term trade values aren't available right now, so it counts this season only.`;
  if (valuesOn) {
    return " It also counts trade value, so you keep some for later deals: giving up more than you get lowers it, getting more raises it. How much depends on your “Protect my trade value” setting in Settings.";
  }
  return " While FantasyCalc's trade values aren't available, it leaves trade value out.";
}

export function HowToRead({
  leagueType = "redraft",
  page = "finder",
  valuesOn = true,
  longTermOn = true,
  blendOn = true,
  helpsScale = null,
  reward = null,
}: {
  leagueType?: LeagueSettings["leagueType"] | undefined;
  page?: HowToReadPage | undefined;
  /** FantasyCalc's values loaded (ValueFacts.valuesOn): Helps you counts trade value in a redraft league. */
  valuesOn?: boolean | undefined;
  /** Dynasty and keeper leagues: long-term values loaded (ValueFacts.longTermOn), so Helps you counts them. */
  longTermOn?: boolean | undefined;
  /** The market blend reaches anyone (ValueFacts.blendOn): a hurt player's projection is blended with the trade market. */
  blendOn?: boolean | undefined;
  /** The search's or the evaluation's "Helps you" scale (helpsScaleWords); null or absent before there is one. */
  helpsScale?: HelpsScale | null | undefined;
  /**
   * The search's or the evaluation's reward (TradeSearchResult.reward, TradeAnalysis.reward; Checkpoint 7c): under "Several
   * prizes" the paragraph names the prizes (weighedOddsWords). Null or absent: read off `helpsScale` (the file header).
   */
  reward?: Pick<Reward, "goal" | "shares"> | null | undefined;
}) {
  const later = leagueType === "redraft" ? null : leagueType === "keeper" ? "keeper" : "dynasty";
  const analyzer = page === "analyzer";
  const step = `${Math.round(config.acceptance.displayStep * 100)}%`;
  // Whether Helps you counts a value besides the odds (trade value in redraft, long-term value in dynasty and keeper).
  const helpsCountsValue = later ? longTermOn : valuesOn;
  return (
    <details className="rounded-2xl border border-line bg-surface shadow-sm">
      <summary className="flex min-h-11 items-center px-4 font-extrabold sm:px-5">{HOW_TO_READ_TITLE[page]}</summary>
      <div className="space-y-2 border-t border-line px-4 py-3 text-sm leading-relaxed sm:px-5">
        <p>
          <span className="font-bold">Helps you</span> (0–100) is how much the trade raises your chances this season: Offer Sheet plays out the rest of your season
          thousands of times with and without it, and weighs {weighedOddsWords(reward, helpsScale)} by your &ldquo;What does your league reward?&rdquo; setting in Settings
          (&ldquo;{GOAL_LABEL[config.benefit.goalDefault]}&rdquo; unless you change it). Each card shows {cardOddsWords(reward, helpsScale)} before and after the
          trade, and the weeks whose chance to win your game moves {weeklyLineWords()}.{helpsValueWords(later, valuesOn, longTermOn)} {helpsScaleWords({ scale: helpsScale, leagueType, longTermOn })}
        </p>
        <p>
          <span className="font-bold">Chance they accept</span> is an estimate (Est.), rounded to 5% (&ldquo;&lt;{step}&rdquo; when it&apos;s lower) and never above{" "}
          {acceptCapWords()}: it looks at the trade from the other manager&apos;s side (trade value, what it adds to or costs their starting lineup, the holes it
          fills, how active a trader they are). It&apos;s a guess, not a promise.
          {analyzer
            ? null
            : ` “Chance they accept: at least” hides ideas below the chance you pick (${minChanceLabel(config.ranking.minChanceDefault)} unless you change it), judged on the chance the trade goes through after a possible veto.`}
        </p>
        <p>
          <span className="font-bold">Overall</span> combines the two: how much it helps, discounted by the chance it happens.{" "}
          {analyzer ? "The Trade Finder ranks its trade ideas by it." : "Ideas are sorted by it unless you choose otherwise."}
        </p>
        <p>
          <span className="font-bold">{HELPS_THEM_LABEL}</span> {helpsThemWords(page, { leagueType, longTermOn })}
        </p>
        <p>
          <span className="font-bold">{HARDER_TO_GET_TAG}</span> marks a player you&apos;d get who is {harderToGetWho("their")}: managers want a little extra for
          players like that, and the chance they accept counts it.
        </p>
        <p>
          <span className="font-bold">{OFFERS_HEADING}</span> {offersWords(page)}
        </p>
        {analyzer ? null : (
          <p>
            <span className="font-bold">{PLAN_B_HEADING}</span> shows below an idea when the same team has a trade they&apos;re likelier to accept: at least{" "}
            {planBGainWords()} likelier to go through, while still helping you at least {planBShareWords()}. It&apos;s the best such trade for a different set of their
            players (other versions of the idea&apos;s own trade are in {OFFERS_HEADING}), with its own three numbers and odds, its own message to send them, and a link to
            open it in the Trade Analyzer, where it&apos;s shown as one offer.
          </p>
        )}
        <p>
          <span className="font-bold">{ROSTER_MOVES_HEADING}</span> {rosterMovesWords(page)}
        </p>
        <p>
          <span className="font-bold">Now or after this week</span> {nowOrLaterWords()}
        </p>
        <p>
          <span className="font-bold">Injury tags</span> show under any player in the trade who isn&apos;t healthy, on either side: for example &ldquo;Questionable&rdquo; or
          &ldquo;Out — expected back week 8&rdquo;. The week shows when his projection counts on it, so a questionable player whose league site doesn&apos;t expect him
          back for weeks shows that week too. A player you&apos;d get who is hurt is projected to return at full strength
          {blendOn ? ", blended with the trade market, which prices his injury in" : ""}.
        </p>
        <p>
          ROS points are each player&apos;s projected points for the rest of the season. Trade values come from FantasyCalc: Offer Sheet uses them in its own
          numbers but doesn&apos;t show them. The chance they accept{helpsCountsValue ? ", Helps you" : ""} and the Market check count roster spots too: every
          player counts at least what the best free agent no team is expected to pick up is worth, an extra player in an uneven trade adds nothing when he&apos;s
          worth no more than that (the team getting him would cut someone like him), and the side getting fewer players is credited the roster spot it opens (an IR
          slot isn&apos;t one). Your side also counts the free-agent moves a card says the trade counts on: a player you&apos;d cut for them counts as if you traded
          him.{" "}
          {analyzer
            ? "“Details” shows what Helps you is worth in points a week. The Trade Finder leaves out trades that wouldn't help you, or where, counting roster spots, you'd give up much more trade value than you get; here they still show, with a warning."
            : "Trades that wouldn't help you, or where, counting roster spots, you'd give up much more trade value than you get, are left out."}
        </p>
      </div>
    </details>
  );
}
