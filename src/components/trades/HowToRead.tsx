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
 * Checkpoint 7g (planner reply to Checkpoint 7f, answer 3; the lead's D19): the Last offer is the trade plus a player I can
 * spare or the trade asking for fewer of their players, whichever has the higher Overall, on both pages, and the Finder says
 * that of two ideas that are versions of the same trade, one at least as good on both Helps you and the chance shows alone.
 * The final review of Checkpoint 7g: the Finder says the ladder's preference for an idea of the list below this one (the
 * lead's ruling W1, PREFER_LISTED_WORDS), and Plan B's paragraph holds with Plan B's narrow rule and the smaller asks (W2,
 * planBWords).
 * Checkpoint 7h (planner reply to Checkpoint 7g, §1: cards closed by default, "everything else" behind one "Details" control,
 * "How to offer it" a separate control, "Assumed with or without this trade" once above the list, a Plan B several ideas share
 * on the highest only): a paragraph on what a closed card shows and what each control holds (detailsWords: the Trade Finder's
 * ideas start closed, the Analyzer's card with Details open), the odds "in Details", Plan B at the end of "How to offer it"
 * and shown once when several ideas share it (planBWords), the line of moves made with or without a trade said once above the
 * list (rosterMovesWords), and the "Now or after this week" line in Details (nowOrLaterWords).
 * Checkpoint 7h (planner reply to Checkpoint 7g, section 3; the integration's track "thorough"): the Trade Finder's paragraph on
 * the Thorough search (thoroughWords: what it adds, about how long, that its ideas stay for the visit, that the switch isn't
 * saved), its numbers from config.
 * A native <details>, closed at first; its summary is a 44 px target.
 */
import type { HelpsScale } from "@/engine/benefit";
import { config } from "@/engine/config";
import type { LeagueSettings } from "@/engine/model";
import type { Reward } from "@/engine/reward";
import { fmtNum } from "@/lib/format";
import {
  BASELINE_ASSUMED,
  DETAILS_HEADING,
  GOAL_LABEL,
  HARDER_TO_GET_TAG,
  HELPS_BOTH_TAG,
  HELPS_THEM_LABEL,
  OFFERS_HEADING,
  PLAN_B_HEADING,
  ROSTER_MOVES_HEADING,
  cardOddsWords,
  harderToGetWho,
  minChanceLabel,
  planBAlsoText,
  weighedOddsWords,
} from "@/lib/tradeView";

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
 * The Trade Finder's sentence on the ladder's preference (Checkpoint 7g, planner reply to Checkpoint 7f, answer 3(b): "When more
 * than one version meets a step's rules, prefer the one that's on the list, so it merges."; search.ts preferredOf, offers.ts
 * choiceSteps and lastOfferSteps). The final review of Checkpoint 7g (the lead's ruling W1: "keep the rule as the planner worded
 * it, and say it"; merge-b-howtoread-rules-false, merge-ui-howtoread-preference, merge-a-howtoread-higher-overall-vs-
 * preference): with a preference the Open and a Then can be an idea of the list that helps less than the version their rules
 * pick, and the Last offer one with the lower Overall, which the words before didn't say (at the review, on main 3b27e78:
 * "“Open with” the version that helps you most" read false on the 12-team smallLeague 1 at Any, the "Helps both" idea 2 opening
 * at 68 / 50% where idea 1, 73 / 70%, fits; "whichever has the higher Overall" on the 12-team smallLeague 8 at Any, idea 17's
 * Last offer printing Overall 16 where the throw-in's 18 fits).
 * ⚠️ "can", not "is" (ours): the preference only reads ideas below this one on Overall that hold no merged trade, weren't taken
 * by an idea above it that round and pass the cross-list guard, it's fixed when the idea's offers are first worked out, and the
 * ladder that prefers them is kept only when it holds more of them (the design's §4.1, D7–D12), so an idea that fits isn't
 * always offered there (smallLeague 4 and 42: offered as a Then where it fits the Open). "more", not "a little more" (ours):
 * nothing bounds how much more the version passed over helps (5 points of Helps you and 20 of the chance on that 12-team
 * league). "Below this one on Overall" as the merge reads it, on the "Helps both" list too, which goes by Helps you. The
 * Analyzer's card has no list, so no preference, and its words don't change. Since Checkpoint 7h (planner reply to Checkpoint 7g,
 * answer 4: "Prefer an idea from the list only when its Helps you is within 3 points of the best version that meets the step's
 * rules."; offers.ts narrowedPick) only when it helps you nearly as much, within config.offers.preferWithinHelps points of Helps
 * you of the version the rules alone would pick.
 */
export const PREFER_LISTED_WORDS = `When another idea below this one on Overall fits one of these offers, it can be offered there when its Helps you is within ${config.offers.preferWithinHelps} of the version the rules alone would pick, even if that version helps you more or, for the “Last offer”, has a higher Overall, so it shows among this idea's offers rather than as an idea of its own.`;

/**
 * Promoted Last offers in words, the Trade Finder's (Checkpoint 7h; planner reply to Checkpoint 7g, answer 3: "When an offer list
 * finds a version with a higher Overall than the idea it sits under: that version becomes the idea; the original becomes its
 * "Open with" step, the bigger ask."; the lead's ruling: the Last offer only, the one sentence; search.ts, "Promoted Last
 * offers"). The Analyzer's card promotes nothing (the user built that trade), so its words don't change.
 */
export const PROMOTED_WORDS = "When an idea's “Last offer” would do better on Overall than the idea itself, that version shows as the idea instead, with the original as its “Open with”.";

/**
 * What a card shows closed and what its two controls hold, after the paragraph's bold "Details" (Checkpoint 7h; planner reply
 * to Checkpoint 7g, §1: "A closed card shows only: what Parker gives and what he gets; the three numbers; its tags ("Helps
 * both," "Harder to get"); one reason. Everything else goes behind one "Details" control … "How to offer it" stays a separate
 * control."; TradeCard.tsx): on the Trade Finder each idea starts closed; the Analyzer's card opens with Details open.
 */
export function detailsWords(page: HowToReadPage): string {
  const rest =
    "your odds before and after the trade, the weeks whose chance to win moves, “Now or after this week”, its risks in full, the ROS points, the roster moves its numbers assume, more reasons" +
    (page === "analyzer" ? ", what Helps you is worth in points a week" : ", “Open in Analyzer”") +
    " and the buttons to say what happened with it";
  return page === "analyzer"
    ? `on the card shows ${rest}; it's open here, and the card's top shows what you give and get, the three numbers, its tags and its main reason. “${OFFERS_HEADING}” holds the offers in order, the first one's message open.`
    : `opens the rest of an idea: ${rest}. Each idea starts closed, showing what you give and get, the three numbers, its tags (like “${HELPS_BOTH_TAG}”, “${HARDER_TO_GET_TAG}” or “Market check”) and its main reason. “${OFFERS_HEADING}” holds the offers in order, the first one's message open, then “${PLAN_B_HEADING}”.`;
}

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
 * on both Helps you and the chance shows alone (search.ts, "Merged cards, Checkpoint 7g"). The final review of Checkpoint 7g
 * (the lead's ruling W1): the Finder says, after its merge sentence, that an idea below this one on Overall can take one of
 * these offers over a version the rules alone would pick (PREFER_LISTED_WORDS: answer 3(b)'s preference). Checkpoint 7h
 * (planner reply to Checkpoint 7g, answers 2–4): the smaller ask's share 75% (read from config), the preference narrowed
 * (PREFER_LISTED_WORDS), and the Finder's sentence on promoted Last offers (PROMOTED_WORDS).
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
    : `When an idea's offers include another idea below it on Overall, the list shows only the higher one, and the other is among its offers. ${PROMOTED_WORDS} ${PREFER_LISTED_WORDS} When two ideas are versions of the same trade and one is at least as good on both Helps you and the chance, only that one shows. An offer can still be an idea above it on Overall whose own offers don't include this one; it then says so, with that idea's place (“${planBAlsoText(2)}”). The idea's own “${PLAN_B_HEADING}” trade is never one of its offers. When no other version makes a better first offer, it says to offer the trade as it is.`;
  return `${lead} ${steps} ${each} ${tail}`;
}

/** The Thorough search's switch, as the Trade Finder names it (TradeFinderPage.tsx THOROUGH_LABEL). */
export const THOROUGH_HEADING = "Thorough search";

/**
 * The Thorough search in words, after its bold heading (Checkpoint 7h; planner reply to Checkpoint 7g, section 3; search.ts,
 * "Whole rosters"; the Trade Finder's switch, TradeFinderPage.tsx): what it adds over the normal search (every trade of up to 2
 * players a side across whole rosters, trades with config.search.thorough.maxPerSide players on a side from the top
 * config.search.thorough.threePool of each roster, config.search.thorough.finalists ideas played out where the normal search
 * plays out config.search.finalists), about how long (config.search.thorough.estimate.workRatio times a normal search, the
 * switch's own estimate), that its ideas stay for the visit (the page's search memory: TradeFinderPage.tsx searchKeyFor's
 * "|thorough") and that the switch isn't saved: this tab keeps it as it was left, a new tab or a reload is the usual search
 * (finderMemory.ts rememberThorough; the review of Checkpoint 7h's page). The Trade Finder's only: the Analyzer has no search.
 */
export function thoroughWords(): string {
  const t = config.search.thorough;
  const three: number = t.maxPerSide;
  const pool: number = t.threePool;
  const ratio: number = t.estimate.workRatio;
  return (
    `checks more trades than the usual search: every trade of up to 2 players a side with every team, from whole rosters, plus trades with ${three} players on a side ` +
    `from your ${pool} and their ${pool} best players, and it plays out the best ${fmtNum(t.finalists, 0)} ideas where the usual search plays out ${fmtNum(config.search.finalists, 0)}. ` +
    `It takes about ${ratio} times as long (the switch says about how many seconds before it starts), with the same progress bar and Stop. ` +
    `Its ideas stay for this visit, like the usual search's, and turning it off shows the usual search's ideas again at once. The switch isn't saved: this tab keeps it as you left it (coming back from the Analyzer too), and a new tab or a reload starts with the usual search.`
  );
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
    `shows in a card's Details when making the same trade after this week's games would change Helps you by more than ${min} (“Helps you 37 now · 41 if done after this week's games.”), ` +
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
  // Checkpoint 7h: on the Trade Finder the moves made either way are said once, above the list (BASELINE_ASSUMED).
  const where =
    page === "analyzer"
      ? "are named at the end and aren't counted for the trade"
      : `are named once, above the list (“${BASELINE_ASSUMED}”), and on an idea only when its own differ; they aren't counted for the trade`;
  return (
    `(in ${page === "analyzer" ? "the card's" : "an idea's"} Details) lists, in order, each move to your roster that the card's numbers count on, with its reason and its week: a player you'd drop to stay within your ` +
    "league's limits or to make room, a free agent for a roster spot the trade opens, a waiver move the trade makes worthwhile, and who you'd release when a " +
    "player comes back from IR (when the player your lineup would miss least has more trade value than another player nearly as cheap to lose from then on, " +
    "that other player goes instead, and the line says why). " +
    `Moves you'd make with or without the trade, like the pickups the League page suggests, ${where}; ${either} ` +
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

/**
 * Plan B's paragraph in words, after its bold heading (the Trade Finder's only: the Analyzer gives no Plan B; planB.ts, search.ts
 * boxOf): when a box shows (at least config.search.steps.minAcceptGain likelier to go through than the idea, Helps you at least
 * config.search.planB.minHelpsShare of the idea's), which trade it is, and what it shows. The final review of Checkpoint 7g
 * (the lead's ruling W2; merge-ui-howtoread-planb): the words hold with Plan B's narrow rule (search.ts boxOf's lastCouldTake,
 * the lead's D5: never the idea's own trade asking for fewer of their players that its Last offer could take by that offer's
 * rules on both printed numbers, whatever its Last offer turns out to be; the box goes to the next candidate, and an idea can
 * show none) and with the smaller asks (a box can ask for fewer of their players). Until then the paragraph said the box was
 * "the best such trade for a different set of their players (other versions of the idea's own trade are in How to offer
 * it)": the (c) sentence's "versions of the same trade" (offersWords) contradicted it for a box asking for fewer (Parker's
 * league 1, Oct 15, his prizes, idea 2's box at the review), and a skipped smaller ask its Last offer didn't take is in How
 * to offer it neither (smallLeague 32 at 10%, idea 8: no box, its Last offer the throw-in).
 */
export function planBWords(): string {
  return (
    `shows at the end of an idea's “${OFFERS_HEADING}”, after the offers, when the same team has a trade they're likelier to accept: at least ${planBGainWords()} likelier to go through, while still helping you at least ${planBShareWords()}. ` +
    `It's the best such trade for a different set of their players, which can be fewer of them, but never the idea's own trade asking for fewer of their players when that could be its “Last offer”, so an idea can show none. ` +
    "When several ideas would show the same one, only the highest of them in the list shows it. " +
    "It has its own three numbers and odds, its own message to send them, and a link to open it in the Trade Analyzer, where it's shown as one offer."
  );
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
          (&ldquo;{GOAL_LABEL[config.benefit.goalDefault]}&rdquo; unless you change it). Each card&apos;s Details show {cardOddsWords(reward, helpsScale)} before and after
          the trade, and the weeks whose chance to win your game moves {weeklyLineWords()}.{helpsValueWords(later, valuesOn, longTermOn)} {helpsScaleWords({ scale: helpsScale, leagueType, longTermOn })}
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
        {analyzer ? null : (
          <p>
            <span className="font-bold">{THOROUGH_HEADING}</span> {thoroughWords()}
          </p>
        )}
        <p>
          <span className="font-bold">{DETAILS_HEADING}</span> {detailsWords(page)}
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
            <span className="font-bold">{PLAN_B_HEADING}</span> {planBWords()}
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
