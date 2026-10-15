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
 *   is empty, or when no week moves). Checkpoint 7c (planner reply to Checkpoint 7b, §6: "when 2nd or 3rd place pays, cards
 *   and the League page add “Top 3 odds” (or “Top 2 odds”)"): under "Several prizes" paying 3rd place (else 2nd) a line
 *   between the two, "Title odds 10.5% → 11.2% · Top 3 odds 30% → 32% · Playoff odds 60% → 63%" (topOddsView: my P(1st) +
 *   P(2nd) (+ P(3rd)) before any trade, TradeSearchResult.baseline.prizes, and after it, + the trade's changes in them,
 *   TradeEvaluation.dPrizes, in whole percents like the playoff odds; left out when a part isn't known, never a partial
 *   sum), on cards, Plan B boxes and the Analyzer's card alike (CardContext.reward: the search's or the evaluation's own);
 *   my odds before any trade say the same chance ("30% to finish in the top 3"; baselineLines), and the info line names
 *   the prizes ("how much your chances at your league's prizes and your playoff odds rise"; weighedOddsWords).
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
 *   longTermFact), the partner's weekly lineup change (and, since Checkpoint 7c, which way their long-term value goes:
 *   theirLongTermFact, below), and "You get 142 ROS pts, give 118" (§13), with a
 *   line when my starting lineup moves the other way (review of Phase 4b: "You get 96 ROS pts, give 295" read like a
 *   lopsided loss on a trade that gives a backup QB who never starts): "Your starting lineup still gains 25 ROS pts: …"
 *   (rosNoteOf, from TradeDetail.weekly). No trade value number: planner reply to Checkpoint 7a, 5.4 (FantasyCalc's
 *   condition 4, reports/fantasycalc-permission.md: Offer Sheet doesn't display FantasyCalc's values at all). Until Phase 7b
 *   the card printed "Trade value: You give 6,500, you get 5,400", FantasyCalc's own plain sums. Under the facts, the
 *   "Values: FantasyCalc" link (§2.9) after a sentence saying the numbers weigh trade value (TradeCardView.valuesCredit:
 *   whenever trade values, FantasyCalc's or our estimates from them, are behind the card's numbers);
 * - the roster moves the numbers assume (§7 roster legality: drops and adds for either side; Phase 4b's IR players: a
 *   received IR player who goes into an open IR slot, RosterChange.toIR, and a player dropped from the week an IR player
 *   comes back, RosterChange.displaced; Phase 7c's open roster spots, one sentence each, RosterChange.openSpots: "Open
 *   roster spot: add Tyler Allgeier, the best available RB.", planner reply to Checkpoint 7b, section 5, with the IR return
 *   that drops a fill again and a partner's fill that takes my own League-page pickup said in the spot's sentence:
 *   openSpotText). Since Checkpoint 7e (planner reply to Checkpoint 7d, item 2.2: "Each card lists every roster move its
 *   numbers assume, in order, each with its reason and its week") mine are every one, in order, each with its reason ("Make
 *   room for Christian Watson: drop Kyle Pitts Sr. (TE)."; a later week's with its week: "Week 7, when Alec Pierce returns
 *   from IR: release …", since Checkpoint 7f with why when the near-tie rule decided it: releaseReason), and the moves made
 *   either way on one line ("Assumed with or without this trade: add Jake Ferguson, drop Romeo Doubs."; since Checkpoint 7f
 *   with the releases at an IR return made either way, names only: "…, release Alec Pierce in week 7, when he returns from
 *   IR."), from TradeEvaluation.myMoves (myMovesLines); the partner's as
 *   before. With either-way moves (item 2.1) my odds start from the trade's own "before" (TradeEvaluation.before), on the
 *   card, a Plan B box and in the Analyzer's line above its card;
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
 * - Plan B, "If they won't move: try …" since Checkpoint 7e (the planner's words, planner reply to Checkpoint 7d, item 4.1:
 *   PLAN_B_HEADING; "If they say no, try:" before; TradeEvaluation.planB, the Trade Finder's cards, since Checkpoint 7e on
 *   every card; since the review of track F a trade likelier to go through than the card): the other trade in words, each tagged player with his tag (the
 *   card's own for a player it shares with the card, else the search's tag for him on another idea, which knows his
 *   far date, else the snapshot's: ⚠️ PlanB carries no tags of its own), whether it's the same players of theirs or "A
 *   different set of their players", its three numbers (with the chance it goes through when a veto could cut it), its
 *   title and playoff odds before and after and its "Win chance by week" line (Phase 4c, change 9: as the card's, from
 *   its own final-block simulation), "Also shown as trade idea 6." when the list shows it as a card of its own (its
 *   place in the sort shown), its own message to send them (planBPitch: a follow-up naming the trade from their side)
 *   and its own "Open in Analyzer" link, which says it comes from Plan B (`from=planB`), so the Analyzer shows that trade
 *   as one offer, without "How to offer it" (review of Phase 4b: its first offer could be smaller than the trade they had
 *   just turned down, and its message proposed that smaller offer; CardContext.offers "none").
 * - Feedback versions (TradeCardView.versions): the versions the card shows, for "Which version did you send?" (its own
 *   trade, "suggested", and Plan B's; since Checkpoint 7e, once "How to offer it" has loaded, its offers in order in their
 *   place, cardVersions; an older evaluation's steps aren't read). The "Version:" line
 *   under the outcome buttons (versionLine) names the recorded version only when its key is one the card shows; a
 *   recorded version the card no longer shows (its Plan B changed since, or the Analyzer's card for the same trade) reads
 *   "an earlier one" with its players, read from its key (CardFeedback.versionWords), and an offer of "How to offer it" its
 *   place and players ("Open with: …"). Phase 4c (planner
 *   reply to Checkpoint 4b, change 7 and answer 9): each version carries its model inputs (VersionChoice.inputs:
 *   feedbackStore.VersionInputs), saved with the outcome: its acceptance features, raw g_mkt(P), B and the goal B was
 *   weighted by (CardContext.goal: the settings the numbers were computed with); the card's own numbers for the version
 *   that is the card's trade (its final simulation), an offer's own or Plan B's for theirs.
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
 * - "How to offer it": until Checkpoint 7e the two steps of §4 (TradeEvaluation.steps: "Offer first: … · Est. 35%" and "If
 *   they say no, add … · Est. 55%"). Since Checkpoint 7e (planner reply to Checkpoint 7d, item 4.1: "one ordered list of up
 *   to 4 offers to the same team") a closed disclosure on every card that helps me (offersView: not on a trade that doesn't
 *   help me or that the market guard hides, nor on a Plan B opened in the Analyzer), whose offers the engine worker works out
 *   when it's opened (OfferLadder, src/engine/offers.ts) and buildLadderView words: each offer with its label ("Open with",
 *   "Then", "The suggested trade", "The trade you built" in the Analyzer, "Last offer"), its players with their injury tags,
 *   Helps you and the chance they accept as the card prints them, the chance it goes through when the league's review could
 *   veto it, its roster moves when they aren't the card's (moveLinesOf) and its own message; "Offer them in order: if they
 *   say no, try the next." above them, or "Offer this trade as it is: no version of it with Team 8 makes a better first
 *   offer." when the ladder holds the suggested trade alone (⚠️ the lead's words, ours). The card's numbers and message are its
 *   own trade's. An offer can be another card of the list (the lead's call, wave D; since Checkpoint 7f only one the search
 *   didn't merge into the card, one above it on Overall: search.ts, "Merged cards"): on the Trade Finder it then says so under
 *   its players, Plan B's words, "Also shown as trade idea 2." with that card's place in the sort shown (planBAlsoText; the
 *   page gives the places at render time, TradeCard.tsx `places`, so they follow a re-sort); a trade merged into the card is
 *   no card, so it reads like any offer. Never the card's Plan B's trade (by the rules: offers.ts, "The candidates").
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
 * "Helps both" and "Helps them" (Checkpoint 7c; planner reply to Checkpoint 7b, §7; the lead's words for the rest):
 * - The fourth sort, "Helps both" (SORT_OPTIONS, last), shows the engine's own list (TradeSearchResult.helpsBoth: the trades
 *   that help both teams, by Helps you, with the minimum chance and §13's caps as the engine applied them), so picking it
 *   never searches again; a result without that list (a fake) shows its trades that help both (rank.ts helpsBothTrades). Under
 *   it: the planner's helper line under the sort (HELPS_BOTH_SORT_NOTE, sortNote), "4 trade ideas that help both teams, sorted
 *   by Helps you.", with fewer than 5 "Only 2 trades help both teams right now." (singular "Only 1 trade helps both teams
 *   right now."), then "Try a lower minimum chance to see more." when a lower minimum would show more
 *   (HelpsBothList.lowerWouldAdd; helpsBothFewText); with none, "No trades help both teams right now" with that suggestion,
 *   ⚠️ ours: a pointer to the Overall sort when it has ideas, and what was left out (the guards' counts, the trades that help
 *   both under the minimum: HelpsBothList.byChance); no pattern note (it describes the Overall list's best ideas).
 * - Every card that helps both teams as printed (benefit.ts helpsBoth: Helps you and Helps them each at least
 *   config.benefit.helpsThemMin, Helps you since Checkpoint 7d, planner reply to Checkpoint 7c, answer 5) carries the tag
 *   "Helps both" with its heading, in every sort and on the Analyzer's card (helpsBothTagOf), in words.
 * - After my odds and my weekly line, the partner's line, in the format of mine (themView): "Helps them 24 · Their title odds
 *   6.0% → 6.9% · Their playoff odds 41% → 45%", their top-N line between them when the league pays 2nd or 3rd place (as mine),
 *   "Helps them 0" when the trade costs them, the planner's tooltip on "Helps them" (HELPS_THEM_TITLE); before = their odds on
 *   the block the trade was simulated on (TradeEvaluation.them.before: on a card, the League page's headline odds for that
 *   team), after = before + their changes from the very runs mine came from. No weekly line for them, no line on a Plan B box
 *   or a step (they carry no partner's numbers), none without a Helps them. No FantasyCalc number anywhere in it. Checkpoint
 *   7d (planner reply to Checkpoint 7c, answer 3: "show “Helps them” and their odds only on cards that help both. The
 *   Analyzer always shows them, including when the trade hurts the other team."): a Trade Finder card shows it only with its
 *   tag (CardContext.partnerLine "helpsBoth", in every sort), the Analyzer's card whenever it has the partner's numbers.
 * - In a dynasty or keeper league with long-term values, after "Their lineup", which way their roster's long-term value goes,
 *   in words ("Their long-term value: Up"; theirLongTermFact; review of the "Helps both" UI, helps-both-ui-1): Helps them counts
 *   it, weighed by their own playoff odds, so a card whose Helps them is high while their odds fall says why. How to read
 *   says what Helps them counts in each league type (HowToRead.tsx helpsThemValueWords). ⚠️ Ours (Checkpoint 7d): only on a
 *   card that shows the partner's line, which it explains.
 *
 * What a card prints, for its feedback (Checkpoint 7d; planner reply to Checkpoint 7c, answer 1: the export holds "only what
 * the user saw and entered"): TradeCardView.shown (shownOf), its three numbers, odds lines, weekly line and partner's line as
 * printed; every press on the card carries it (cardPress, TradeCard.tsx), the record it makes keeps it, and the export
 * (feedbackStore.ts feedbackExport) holds it in place of the model's numbers.
 *
 * Numbers print like the League page's (src/lib/format.ts): one decimal for points per week, whole percents, a real minus
 * sign. No trade value is ever printed (the card's facts above). No jargon ("EV", "σ", "V*", "g_mkt" never appear).
 *
 * Also here: the Finder's list (buildFinderView: the cards in the chosen sort through rank.ts sortTrades, or the "Helps both" list, the hidden
 * counts, notes and warnings, the empty states), the search's progress in words (progressView; a re-filter's shows the
 * ranking alone), the Analyzer's choices (analyzerChoices) and the links between the pages (finderHref, analyzerHref and
 * what they carry back: a team id and player ids only, never league ids or names; ⚠️ a URL query, as M13 says, so the
 * server that serves the page sees those ids like any address: the privacy page says so).
 */
import { displayAcceptance, tradeDeadlinePassed } from "@/engine/acceptance";
import { HELPS_AT_GAIN, HELPS_FLOOR_NOTE, HELPS_FLOOR_NOTE_PLAYOFFS, HELPS_FLOOR_NOTE_PRIZES, futureValuesLoaded, helpsBoth, lineupEquivalent, tradeScore, type HelpsScale } from "@/engine/benefit";
import { blendValues } from "@/engine/blend";
import { config } from "@/engine/config";
import type { TradeAnalysis } from "@/engine/evaluate";
import { fantasyCalcComparison, injuryTags, myFantasyCalcGain } from "@/engine/explain";
import type { MarketInputs, ModelInputs, NflScheduleInputs } from "@/engine/inputs";
import { fantasyCalcFallbackText, valuesForTerm } from "@/engine/market";
import { POSITIONS, type InjuryStatus, type LeagueSettings, type LeagueSnapshot, type PlayerInfo, type Pos } from "@/engine/model";
import { helpsBothTrades, sortTrades } from "@/engine/rank";
import { isTitleOnly, type PrizeDeltas, type PrizeOdds, type Reward } from "@/engine/reward";
import type { Goal, TradeSettings } from "@/engine/settings";
import type {
  AcceptanceFeatures,
  AssumedRelease,
  InjuryTag,
  LaterNumbers,
  NearTieRelease,
  OfferLadder,
  OfferStepKind,
  OpenSpot,
  PartnerNumbers,
  PickupOf,
  PlanB,
  PremiumFact,
  RosterChange,
  RosterMoves,
  TradeAsset,
  TradeDetail,
  TradeEvaluation,
  TradeProposal,
  TradeSearchProgress,
  TradeSearchResult,
  TradeSearchStage,
  TradeSort,
} from "@/engine/tradeModel";
import {
  feedbackFor,
  proposalFromKey,
  type FeedbackChange,
  type FeedbackOutcome,
  type FeedbackReason,
  type FeedbackRecord,
  type FeedbackSent,
  type FeedbackShown,
  type FeedbackVersion,
  type HelpsReason,
  type VersionInputs,
} from "./feedbackStore";
import { fmtNum, fmtSigned, fmtWhole, plural } from "./format";
import { surname } from "./names";
import { modelWarningRule } from "./notices";
import { acceptSrText, acceptText, printedScore, throughText, underStep } from "./printed";
import { INJURY_LABEL, PLATFORM_LABEL, posLabel } from "./labels";

/** What the views read of the snapshot; currentWeek (the injury tags' week now) is optional so partial fixtures fit. */
export type SnapshotPart = Pick<LeagueSnapshot, "platform" | "teams" | "players" | "settings"> & Partial<Pick<LeagueSnapshot, "currentWeek">>;

export const FINDER_PATH = "/trades";
export const ANALYZER_PATH = "/analyzer";

/**
 * The sort options (§13), Overall first (the default); since Checkpoint 7c (planner reply to Checkpoint 7b, §7) "Helps both"
 * last, the trades that help both teams by Helps you (the engine's own list, TradeSearchResult.helpsBoth: buildFinderView).
 */
export const SORT_OPTIONS: readonly { value: TradeSort; label: string }[] = [
  { value: "overall", label: "Overall" },
  { value: "helps", label: "Helps you" },
  { value: "accept", label: "Chance they accept" },
  { value: "helpsBoth", label: "Helps both" },
];

export function isTradeSort(x: unknown): x is TradeSort {
  return SORT_OPTIONS.some((o) => o.value === x);
}

// ---------------------------------------------------------------------------------------------
// "Helps both" and "Helps them" (Checkpoint 7c; planner reply to Checkpoint 7b, §7)

/** The card's tag (lead decision: in words, with the card heading, in every sort and on the Analyzer's card). */
export const HELPS_BOTH_TAG = "Helps both";

/** The partner's score's name on its line ("Helps them 24 · Their title odds …"). */
export const HELPS_THEM_LABEL = "Helps them";

/** The tooltip on "Helps them", the planner's words. */
export const HELPS_THEM_TITLE =
  "Helps them uses the same scale as Helps you, from their side. Both teams can gain when each fills the other's weak spot. Helps you already counts the cost of making them stronger.";

/** The helper line under the Trade Finder's sort while it's "Helps both", the planner's words. */
export const HELPS_BOTH_SORT_NOTE = "Trades that help them too, sorted by how much they help you.";

/** What the "Helps both" list says when it's empty (the lead's words; its status line adds the period). */
export const HELPS_BOTH_EMPTY_TITLE = "No trades help both teams right now";

/** The helper line under the sort for the sort chosen (FinderControls): HELPS_BOTH_SORT_NOTE under "Helps both"; null otherwise. */
export function sortNote(sort: TradeSort): string | null {
  return sort === "helpsBoth" ? HELPS_BOTH_SORT_NOTE : null;
}

/** "Try a lower minimum chance to see more." (the hidden line's "your minimum chance" is the same control's). */
const LOWER_MINIMUM_TEXT = "Try a lower minimum chance to see more.";

/** The "Helps both" list's ideas counted in words, for its count and status lines: "4 trade ideas that help both teams", "1 trade idea that helps both teams". */
function bothWords(n: number): string {
  return `${plural(n, "trade idea")} that ${n === 1 ? "helps" : "help"} both teams`;
}

/**
 * The "Helps both" list's few line (planner reply to Checkpoint 7b, §7: "Fewer than 5: say “Only N trades help both teams right
 * now.” If a lower chance filter would add more, suggest it."): with 1 to config.ranking.minChanceFew − 1 trades, "Only 4 trades
 * help both teams right now." ("Only 1 trade helps both teams right now."), then the suggestion when a lower minimum chance
 * would show more (HelpsBothList.lowerWouldAdd: never at Any); null with none (the empty card says so) or enough.
 */
export function helpsBothFewText(n: number, lowerWouldAdd: boolean): string | null {
  if (!(n > 0) || n >= config.ranking.minChanceFew) return null;
  return `Only ${plural(n, "trade")} ${n === 1 ? "helps" : "help"} both teams right now.${lowerWouldAdd ? ` ${LOWER_MINIMUM_TEXT}` : ""}`;
}

/** The card's tag (TradeCardView.helpsBothTag), with why on hover: "Helps both: this trade helps you, and it helps them too (Helps them 24)." */
export interface HelpsBothTagView {
  text: string;
  title: string;
}

/**
 * The card's "Helps both" tag (planner reply to Checkpoint 7b, §7: "cards that help both get a small “Helps both” tag in every
 * sort"): on an evaluation that helps both teams as printed (benefit.ts helpsBoth: Helps you and Helps them each at least
 * config.benefit.helpsThemMin; planner reply to Checkpoint 7c, answer 5); null otherwise, and without the partner's numbers.
 * On a Trade Finder card the partner's line goes with it (CardContext.partnerLine; answer 3).
 */
export function helpsBothTagOf(e: Pick<TradeEvaluation, "tradeScore" | "them">): HelpsBothTagView | null {
  if (!helpsBoth(e) || !e.them || e.them.helps === null) return null;
  return { text: HELPS_BOTH_TAG, title: `${HELPS_BOTH_TAG}: this trade helps you, and it helps them too (${HELPS_THEM_LABEL} ${e.them.helps}).` };
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

// The chance they accept as printed ("<5%" under 5%), for screen readers, and the chance it goes through (the file header):
// src/lib/printed.ts since Checkpoint 7d, which the feedback export shares; re-exported here for the pages and scripts.
export { acceptSrText, acceptText, throughText };

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
 * week. The user's own week (returnSource "user"; Checkpoint 7e, planner reply to Checkpoint 7d, item 3.5; review of wave
 * C, RC-ENG-1), whatever the status, as the roster card marks it: "On IR — expected back week 9 (your week)",
 * "Questionable — expected back week 7 (your week)", "Out for the season (your week)".
 */
export function injuryTagText(tag: Pick<InjuryTag, "status" | "returnWeek" | "returnSource">, seasonEnd?: number, source?: string): string {
  const base = TAG_WORDS[tag.status] ?? "Injured";
  const r = tag.returnWeek;
  if (tag.status === "NA" || r === undefined || !Number.isFinite(r)) return base;
  const afterSeason = seasonEnd !== undefined && Number.isFinite(seasonEnd) && r > seasonEnd;
  if (tag.returnSource === "user") {
    if (afterSeason) return `${GAME_TIME.has(tag.status) ? `${base} — out` : tag.status === "SUSPENDED" ? "Suspended" : "Out"} for the season (your week)`;
    return `${base} — ${tag.status === "SUSPENDED" ? "back" : "expected back"} week ${r} (your week)`;
  }
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

/**
 * "How to offer it" on a card, before its offers load (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1: the file
 * header, "How to offer it"): the disclosure's summary, and what the card's own trade is called among the offers.
 */
export interface OffersView {
  /** "How to offer it" (OFFERS_HEADING). */
  heading: string;
  /** The suggested trade's label among the offers: "The suggested trade" on the Trade Finder, "The trade you built" in the Analyzer. */
  suggested: string;
}

/** One offer of "How to offer it" (OfferStep; the file header), in words. */
export interface OfferStepView {
  kind: OfferStepKind;
  /** "Open with", "Then", "The suggested trade" ("The trade you built" in the Analyzer) or "Last offer" (OFFER_STEP_LABEL). */
  label: string;
  /** The offer in words, each injury-tagged player with his tag after his name: "Puka Nacua for Drake London and Chris Olave". */
  trade: string;
  /** "Helps you 52", then "Chance they accept 20%" with its label apart, "(Est. · Possible)", each kept on one line by the card (Plan B's). */
  numberParts: { text: string; label?: string }[];
  /** "Counting a league veto vote, about 10% it goes through." when the veto rule cuts it and that prints differently; else null. */
  acceptNote: string | null;
  /** The roster moves its numbers assume, in sentences (the card's own rules), when they differ from the card's; else empty. */
  moves: string[];
  /** Its own message to send them: the first offer's pitch, a later one's follow-up naming it (OfferStep.message). */
  message: string;
  /** Its trade key. */
  key: string;
  /** The whole offer in one line (tests, hover): "Open with: Puka Nacua for Drake London and Chris Olave · Helps you 52 · …". */
  text: string;
}

/** "How to offer it" once its offers load (buildLadderView; the file header). */
export interface LadderView {
  /** The card it's for (OfferLadder.cardKey). */
  cardKey: string;
  /** The offers in order; the suggested trade alone when nothing makes a better first offer. */
  steps: OfferStepView[];
  /**
   * The line above the list, which the panel's status line says: OFFERS_INTRO_TEXT; with the suggested trade alone, "Offer
   * this trade as it is: no version of it with Team 8 makes a better first offer." (offersAloneText; the lead's words).
   */
  intro: string;
  /** The suggested trade alone (no list shows: `intro` says why). */
  alone: boolean;
  /**
   * No offer at all: the engine couldn't evaluate the trade as the league stands now (offers.ts offerLadderOfProposal's empty
   * ladder: an illegal trade, a player gone since; the review of wave D, UI-D-8): `intro` says so (OFFERS_NONE_TEXT), no list.
   */
  none: boolean;
  /**
   * The first offer isn't the card's own trade ("Open with"): the card's own message proposes the trade as it is, so it says
   * that "How to offer it" opens with another offer (OWN_MESSAGE_NOTE; the review of wave D, UI-D-6).
   */
  opensElsewhere: boolean;
  /** Each offer as a version the user may have sent (the feedback's "Which version did you send?"), in order. */
  versions: VersionChoice[];
}

/** "If they won't move: try …" (TradeEvaluation.planB; the file header). */
export interface PlanBView {
  /** "If they won't move: try …" (PLAN_B_HEADING). */
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
  /** OWN_BEFORE_NOTE when its odds start from its own "before" (PlanB.before; Checkpoint 7e, item 2.1), else null. */
  oddsNote: string | null;
  /**
   * Checkpoint 7e (planner reply to Checkpoint 7d, item 2.2: "a Plan B box when it has moves"): my roster moves its numbers
   * assume, in sentences (myMovesLines on PlanB.myMoves); empty when it has none, or carries none.
   */
  moves: string[];
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
  /**
   * "The suggested trade" ("The trade you built" in the Analyzer), an offer of "How to offer it" with its players ("Open with:
   * Puka Nacua for Drake London and Chris Olave"), or "If they won't move: Garrett Wilson for Nico Collins" (Checkpoint 7e).
   */
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
  /**
   * OWN_BEFORE_NOTE under the odds when they start from the trade's own "before" (TradeEvaluation.before: Checkpoint 7e, item
   * 2.1's either-way moves; review of wave B, findings B-4 and either-way-before-unexplained), else null; never on the
   * Analyzer's card (buildAnalysisView: its line above the card gives that "before").
   */
  oddsNote: string | null;
  /**
   * Checkpoint 7e (planner reply to Checkpoint 7d, item 4.2): "Helps you 37 now · 41 if done after this week's games." under
   * the three numbers (nowOrLaterView), with the planner's tooltip; null when the trade has no later numbers (CardContext.
   * later, else TradeEvaluation.later: a Trade Finder card's arrive after the search) or its two printed Helps you differ by
   * config.explain.nowOrLaterMin or less. The tooltip's words are among the card's facts too, for a phone (NOW_OR_LATER_LABEL).
   */
  nowOrLater: NowOrLaterView | null;
  /**
   * Checkpoint 7c (planner reply to Checkpoint 7b, §7): the partner's line after mine, "Helps them 24 · Their title odds 6.0% →
   * 6.9% · Their playoff odds 41% → 45%" (themView); null without the partner's numbers. No weekly line for them. Since
   * Checkpoint 7d (planner reply to Checkpoint 7c, answer 3) a Trade Finder card shows it only when it helps both teams
   * (CardContext.partnerLine "helpsBoth"); the Analyzer's card whenever the partner's numbers exist.
   */
  them: ThemView | null;
  /** The "Helps both" tag with the card's heading (helpsBothTagOf), in every sort and on the Analyzer's card; null when it doesn't help both. */
  helpsBothTag: HelpsBothTagView | null;
  /** The Trade Analyzer's "Details" (what Helps you is worth in points a week: detailsView); null on the Trade Finder's cards. */
  details: DetailsView | null;
  /**
   * "How to offer it" (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1: offers in order, worked out when it's opened:
   * buildLadderView), or null: a trade that doesn't help me, one the market guard hides or one not scored (offersView), and
   * the Analyzer's card for a trade opened from a card's "If they won't move: try …" (shown as one offer).
   */
  offers: OffersView | null;
  /** "If they won't move: try …" (Plan B), or null when the trade has none (nothing qualified, or it's the Analyzer's). */
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
  /**
   * The roster moves the numbers assume, mine first (since Checkpoint 7e every one in order with its reason, and the moves
   * made either way on one line: myMovesLines), then the partner's (§7; Phase 4b's IR slots and returns too, and Phase 7c's
   * open roster spots), in sentences; empty when none.
   */
  required: string[];
  reasons: string[];
  pitch: string;
  /** The Trade Analyzer, prefilled with this trade. */
  analyzerHref: string;
  /**
   * What the card prints, as its feedback record keeps it (Checkpoint 7d; planner reply to Checkpoint 7c, answer 1:
   * feedbackStore.ts FeedbackShown, shownOf): its three numbers, odds lines, weekly line and, when the card shows it, the
   * partner's line, each the card's own text. Every press on the card carries it (cardPress); the export holds it.
   */
  shown: FeedbackShown;
  /** The evaluation behind the card (the feedback buttons save its numbers). */
  evaluation: TradeEvaluation;
}

export interface CardContext {
  snapshot: SnapshotPart;
  /**
   * My odds before any trade, every team after its helpful free-agent pickups: the search's baseline, or the one the
   * worker sends with an Analyzer evaluation (null fields when unknown; absent: the card shows the changes alone).
   * Checkpoint 7c: `prizes`, my prize components on the same seasons (TradeSearchResult.baseline.prizes), the "before" of
   * the top-N odds line (topOddsView); absent or null: that line shows its change alone.
   */
  baseline?: { pPlayoffs: number | null; pTitle: number | null; prizes?: PrizeOdds | null } | null;
  /**
   * The reward the numbers were weighed by (TradeSearchResult.reward, the Analyzer's TradeAnalysis.reward; Checkpoint 7c,
   * planner reply to Checkpoint 7b, §6): the odds lines add "Top 3 odds" (or "Top 2 odds") when it pays 2nd or 3rd place
   * (topPlacesOf). Absent: no such line.
   */
  reward?: Pick<Reward, "goal" | "shares"> | null | undefined;
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
  /**
   * Which cards show the partner's line (TradeCardView.them; planner reply to Checkpoint 7c, answer 3: "show “Helps them”
   * and their odds only on cards that help both. The Analyzer always shows them, including when the trade hurts the other
   * team."): "helpsBoth", the Trade Finder's cards, only a card that helps both teams (benefit.ts helpsBoth, the tag's
   * rule); "always" (the default), the Trade Analyzer's card, whenever the partner's numbers exist ("Helps them 0" when the
   * trade costs them).
   */
  partnerLine?: "always" | "helpsBoth" | undefined;
  /**
   * The Trade Finder's "now or after this week" numbers by card key (Checkpoint 7e, item 4.2: the engine worker posts them once
   * the search has answered, engineClient.ts laterLinesOf; a card without its own yet shows no line). Absent or null: the
   * evaluation's own (TradeEvaluation.later, the Trade Analyzer's).
   */
  later?: ReadonlyMap<string, LaterNumbers | null> | null | undefined;
  /**
   * "How to offer it" (Checkpoint 7e, item 4.1; offersView): "finder" (the default), the Trade Finder's card, its own trade
   * "The suggested trade"; "analyzer", the Trade Analyzer's, its own trade "The trade you built"; "none", the Analyzer's card
   * for a trade opened from a card's "If they won't move: try …", shown as one offer (review of Phase 4b: they've just turned
   * down a trade with the same team).
   */
  offers?: "finder" | "analyzer" | "none" | undefined;
}

/** A 0–100 score as printed (printed.ts printedScore): its number; 0 for a trade that doesn't help me (B ≤ 0); "—" when B is unknown. */
function scoreView(score: number | null, b: number | null): NumberView {
  const value = printedScore(score, b);
  return { value, srText: value === "—" ? "not scored: the season couldn't be simulated" : null };
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

/**
 * My title odds (one decimal) and playoff odds (whole percents), before and after the trade (the file header); between them,
 * under "Several prizes" paying 2nd or 3rd place (`reward`: topPlacesOf), "Top 3 odds" (or "Top 2 odds": topOddsView).
 */
export function oddsViews(
  e: Pick<TradeEvaluation, "dPO" | "dCH"> & { dPrizes?: Partial<PrizeDeltas> | null | undefined },
  baseline: CardContext["baseline"],
  reward?: CardContext["reward"],
): OddsView[] {
  const places = topPlacesOf(reward);
  const top = places ? topOddsView(topOddsLabel(places), places, e.dPrizes, baseline?.prizes) : null;
  return [oddsView("Title odds", e.dCH, baseline?.pTitle, titleOddsText), ...(top ? [top] : []), oddsView("Playoff odds", e.dPO, baseline?.pPlayoffs, percentText)];
}

/**
 * Which top-N odds line the odds show (planner reply to Checkpoint 7b, §6: "when 2nd or 3rd place pays, cards and the League
 * page add “Top 3 odds” (or “Top 2 odds”)"; the lead's reading for Checkpoint 7c): only under "Several prizes" (Reward.goal
 * "prizes"), 3 when the league's split pays 3rd place, else 2 when it pays 2nd; null otherwise, and without a reward (no
 * such line). "Only the champion" and "Making the playoffs" pay 1st place everything (reward.ts TITLE_ONLY).
 */
export function topPlacesOf(reward: Pick<Reward, "goal" | "shares"> | null | undefined): 2 | 3 | null {
  if (!reward || reward.goal !== "prizes") return null;
  if (reward.shares.third > 0) return 3;
  return reward.shares.second > 0 ? 2 : null;
}

/** The top-N odds line's label: "Top 3 odds", "Top 2 odds". */
export function topOddsLabel(places: 2 | 3): string {
  return `Top ${places} odds`;
}

/**
 * The chance of a top-N finish from a team's prize components (reward.ts PrizeOdds, or their changes, PrizeDeltas): P(1st) +
 * P(2nd), + P(3rd) for the top 3; null when one of them isn't known, never a partial sum.
 */
export function topChance(p: Readonly<Partial<Record<"first" | "second" | "third", number | null>>> | null | undefined, places: 2 | 3): number | null {
  if (!p) return null;
  let sum = 0;
  for (const k of places === 3 ? (["first", "second", "third"] as const) : (["first", "second"] as const)) {
    const x = p[k];
    if (typeof x !== "number" || !Number.isFinite(x)) return null;
    sum += x;
  }
  return sum;
}

/**
 * The top-N odds line (topPlacesOf; the lead's for Checkpoint 7c), printed as the playoff odds are (whole percents, "<1%" and
 * ">99%" at the edges): before = my chance of a top-N finish before any trade (topChance of CardContext.baseline.prizes),
 * after = before + the trade's change in it (topChance of TradeEvaluation.dPrizes), kept within 0–100%; the change alone in
 * percentage points when the odds before aren't there (as the other lines do without a baseline). None (null) when the
 * change isn't known, or the odds before are there but one of their parts isn't: never a partial sum. `label` names it
 * (topOddsLabel; the partner's own line can reuse it).
 */
export function topOddsView(label: string, places: 2 | 3, d: Readonly<Partial<PrizeDeltas>> | null | undefined, before: PrizeOdds | null | undefined): OddsView | null {
  const change = topChance(d, places);
  if (change === null) return null;
  if (before === null || before === undefined) return oddsView(label, change, null, percentText);
  const from = topChance(before, places);
  return from === null ? null : oddsView(label, change, from, percentText);
}

/**
 * The partner's line on a card (TradeCardView.them; Checkpoint 7c, planner reply to Checkpoint 7b, §7: "The odds section adds
 * their lines next to yours: “Helps them 24 · Their title odds 6.0% → 6.9%,” plus their other odds lines in the same format
 * as yours").
 */
export interface ThemView {
  /** "Helps them". */
  label: string;
  /** Helps them as printed ("24"; "0" when the trade costs them), the planner's tooltip on it (HELPS_THEM_TITLE). */
  helps: NumberView;
  /** Their title odds, their top-N odds when the league pays 2nd or 3rd place, their playoff odds, before and after (theirOddsViews). */
  odds: OddsView[];
  /** The whole line: "Helps them 24 · Their title odds 6.0% → 6.9% · Their playoff odds 41% → 45%". */
  text: string;
}

/**
 * The partner's odds before and after the trade, in the format of mine (oddsViews: one decimal for the title, whole percents
 * for the rest, the change alone in percentage points without a "before", "unknown" without the change), each named for them
 * ("Their title odds", "Their top 3 odds", "Their playoff odds"): before = their odds on the block the trade was simulated on
 * (PartnerNumbers.before), after = before + their changes from the same runs as mine. The top-N line follows mine (topPlacesOf
 * on the card's reward; left out when a part isn't known).
 */
export function theirOddsViews(them: Pick<PartnerNumbers, "dPO" | "dCH" | "dPrizes" | "before">, reward?: CardContext["reward"]): OddsView[] {
  const places = topPlacesOf(reward);
  const top = places ? topOddsView(`Their ${topOddsLabel(places).toLowerCase()}`, places, them.dPrizes, them.before.prizes) : null;
  return [
    oddsView("Their title odds", them.dCH, them.before.pTitle, titleOddsText),
    ...(top ? [top] : []),
    oddsView("Their playoff odds", them.dPO, them.before.pPlayoffs, percentText),
  ];
}

/**
 * The partner's line (ThemView; the lead: "“Helps them 24 · Their title odds 6.0% → 6.9% · Their playoff odds 41% → 45%” …
 * “Helps them 0” when B_P ≤ 0; no line without numbers"): Helps them as printed (PartnerNumbers.helps) with the planner's
 * tooltip, then their odds (theirOddsViews). Null without the partner's numbers (an evaluation not simulated, made before
 * them, a step's or a Plan B's) or without a Helps them (their scale unknown). No weekly line for them.
 */
export function themView(e: Pick<TradeEvaluation, "them">, reward?: CardContext["reward"]): ThemView | null {
  const them = e.them;
  if (!them || typeof them.helps !== "number" || !Number.isFinite(them.helps)) return null;
  const helps: NumberView = { value: String(them.helps), srText: null, title: HELPS_THEM_TITLE };
  const odds = theirOddsViews(them, reward);
  return { label: HELPS_THEM_LABEL, helps, odds, text: [`${HELPS_THEM_LABEL} ${helps.value}`, ...odds.map((o) => `${o.label} ${o.value}`)].join(" · ") };
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
 * The tooltip on "Helps you 37 now · 41 if done after this week's games." (Checkpoint 7e; planner reply to Checkpoint 7d, item
 * 4.2: the planner's words), said on hover and, since a phone can't hover, among the card's facts (NOW_OR_LATER_LABEL).
 */
export const NOW_OR_LATER_TITLE = "Assumes the same deal is still there next week. Injuries, big games or another trade can change that, and their answer may change too.";

/** The card's fact that carries the line's tooltip (⚠️ ours: the tooltip's words where a phone shows them). */
export const NOW_OR_LATER_LABEL = "After this week's games";

/** "Helps you 37 now · 41 if done after this week's games." (nowOrLaterView). */
export interface NowOrLaterView {
  /** "Helps you 37 now". */
  now: string;
  /** "41 if done after this week's games." */
  later: string;
  /** The whole line. */
  text: string;
  /** The tooltip: NOW_OR_LATER_TITLE. */
  title: string;
}

/**
 * "Now or after this week" on a card (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.2: "Show it as 'Helps you 37 now ·
 * 41 if done after this week's games.' … only when the two numbers differ by more than the noise found in 1.1"): the card's
 * Helps you as printed (printedScore: 0 when B ≤ 0) and the same trade's if done after this week's games (LaterNumbers, on the
 * card's own scale), when both are known and differ by more than config.explain.nowOrLaterMin; null otherwise, and without
 * later numbers (a week under way, no week after this one, the trade deadline within config.explain.nowOrLaterWeeks weeks, or
 * a Trade Finder card's not arrived yet). The ranking stays on the first.
 */
export function nowOrLaterView(e: Pick<TradeEvaluation, "tradeScore" | "b">, later: LaterNumbers | null | undefined, min: number = config.explain.nowOrLaterMin): NowOrLaterView | null {
  if (!later) return null;
  const now = printedScore(e.tradeScore, e.b);
  const then = printedScore(later.tradeScore, later.b);
  if (now === "—" || then === "—" || !(Math.abs(Number(now) - Number(then)) > min)) return null;
  const nowText = `Helps you ${now} now`;
  const laterText = `${then} if done after this week's games.`;
  return { now: nowText, later: laterText, text: `${nowText} · ${laterText}`, title: NOW_OR_LATER_TITLE };
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

// ---------------------------------------------------------------------------------------------
// "How to offer it": offers in order (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1; the file header)

/** The disclosure's summary, on every card that has one (TradeCardView.offers). */
export const OFFERS_HEADING = "How to offer it";

/** What the opened disclosure says while the engine works the offers out (TradeCard.tsx: its status line). */
export const OFFERS_LOADING_TEXT = "Working out the offers…";

/** What it says when the engine couldn't, above a Try again button. */
export const OFFERS_FAILED_TEXT = "The offers couldn't be worked out this time.";

/**
 * What it says when the engine answers with no offer at all (the review of wave D, UI-D-8: an empty ladder read as "Offer this
 * trade as it is", though nothing could be worked out): the trade can't be evaluated with the league as it stands now.
 */
export const OFFERS_NONE_TEXT = "This trade can't be worked out with the league as it stands now.";

/**
 * Over the card's own "Message to send them" once "How to offer it" opens with another offer (LadderView.opensElsewhere; the
 * review of wave D, UI-D-6: the card's own message proposed the trade as it is, while the offers said to open with another).
 */
export const OWN_MESSAGE_NOTE = "This message proposes the trade as it is. “How to offer it” opens with another offer: send its message first.";

/** The line over a card's own "Message to send them" (OWN_MESSAGE_NOTE) once its offers open with another trade; else null (none loaded, or they open with the card's own). */
export function ownMessageNote(ladder: Pick<LadderView, "opensElsewhere"> | null | undefined): string | null {
  return ladder?.opensElsewhere ? OWN_MESSAGE_NOTE : null;
}

/** The line above the offers, which the disclosure's status line says once they're in (⚠️ ours). */
export const OFFERS_INTRO_TEXT = "Offer them in order: if they say no, try the next.";

/** Each offer's label on the card (the lead's words for Checkpoint 7e). */
export const OFFER_STEP_LABEL: Readonly<Record<OfferStepKind, string>> = { open: "Open with", then: "Then", suggested: "The suggested trade", last: "Last offer" };

/** The suggested trade's label in the Trade Analyzer (⚠️ ours: there it's the trade the user built, not one Offer Sheet suggests). */
export const ANALYZER_SUGGESTED_LABEL = "The trade you built";

/**
 * What the disclosure says when the ladder holds the suggested trade alone (the lead's words, ⚠️ ours): "Offer this trade as it
 * is: no version of it with Team 8 makes a better first offer."
 */
export function offersAloneText(partnerName: string): string {
  return `Offer this trade as it is: no version of it with ${partnerName} makes a better first offer.`;
}

/**
 * "How to offer it" on a card (TradeCardView.offers), or null (⚠️ ours, Phase 4's rule for its steps kept: "the Analyzer gives
 * steps only to a trade the Trade Finder could show"): a trade that doesn't help me (B ≤ 0) or wasn't scored, one the market
 * guard hides, and the Analyzer's card for a trade opened from "If they won't move: try …" (`page` "none": one offer).
 */
export function offersView(e: Pick<TradeEvaluation, "b" | "flags">, page: CardContext["offers"] = "finder"): OffersView | null {
  if (page === "none") return null;
  if (e.b === null || !Number.isFinite(e.b) || e.b <= 0 || e.flags.hiddenByBenefit || e.flags.hiddenByMarket) return null;
  return { heading: OFFERS_HEADING, suggested: page === "analyzer" ? ANALYZER_SUGGESTED_LABEL : OFFER_STEP_LABEL.suggested };
}

/** What buildLadderView reads besides the ladder and its card. */
export interface LadderContext {
  snapshot: SnapshotPart;
  /** The NFL regular season's last week (ModelInputs.nfl.lastWeek), for "Out for the season" in the injury tags (seasonEndOf). */
  lastNflWeek?: number | undefined;
  /** What the league rewards as the offers' numbers were weighed (each version's model inputs, as the card's: CardContext.goal). */
  goal?: Goal | null | undefined;
}

/** A version's "Helps you" scale for its feedback inputs: its own B₃ when it has one, and why that scale departs from 63 (helpsReasonOf). */
function scaleOf(e: { b3?: number | null | undefined; detail?: Pick<TradeDetail, "notes"> | undefined }): ScaleInputs {
  return { b3: typeof e.b3 === "number" && Number.isFinite(e.b3) && e.b3 > 0 ? e.b3 : null, helpsReason: helpsReasonOf(e.detail?.notes) };
}

/**
 * "How to offer it" in words (the file header), from the engine's ladder (OfferLadder, built in the engine worker when the
 * card's disclosure is opened) and the card it's for: each offer with its label ("Open with", "Then", the card's own
 * OffersView.suggested, "Last offer"), its players with their injury tags in words (its own evaluation's: tagsOf), Helps you
 * and the chance they accept with its label as the card prints its own (printed.ts), the chance it goes through when the
 * league's review could veto it and that prints differently (the card's own note), the roster moves its numbers assume (the
 * card's words: moveLinesOf) only when they differ from the card's, and its own message (OfferStep.message); and each as a
 * version the feedback can record (its place, key, estimate and model inputs on its own scale; the suggested trade is the
 * card's own version). With the suggested trade alone, no list: offersAloneText says to offer it as it is.
 */
export function buildLadderView(ladder: OfferLadder, card: Pick<TradeCardView, "key" | "partnerName" | "required" | "offers" | "versions">, ctx: LadderContext): LadderView {
  const { snapshot } = ctx;
  const suggested = card.offers?.suggested ?? OFFER_STEP_LABEL.suggested;
  const end = seasonEndOf(snapshot.settings, ctx.lastNflWeek);
  const source = dateSourceOf(snapshot);
  const own = card.versions.find((v) => v.key === card.key);
  const sameAsCard = (lines: readonly string[]) => lines.length === card.required.length && lines.every((l, i) => l === card.required[i]);
  const steps = (ladder.steps ?? []).filter((s) => s && s.evaluation && typeof s.evaluation.key === "string");
  const built = steps.map((s) => {
    const e = s.evaluation;
    const label = s.kind === "suggested" ? suggested : (OFFER_STEP_LABEL[s.kind] ?? OFFER_STEP_LABEL.then);
    const tags = tagsOf(e, snapshot);
    const named = (a: TradeAsset, side: InjuryTag["side"]) => {
      const name = assetView(a, snapshot).name;
      const t = a.kind === "player" ? tags.find((x) => x.playerId === a.id && x.side === side) : undefined;
      return t ? `${name} (${injuryTagText(t, end, source)})` : name;
    };
    const listed = (assets: readonly TradeAsset[], side: InjuryTag["side"]) => (assets.length ? listText(assets.map((a) => named(a, side))) : "nothing");
    const trade = `${listed(e.proposal.give, "give")} for ${listed(e.proposal.get, "get")}`;
    const numberParts = [{ text: `Helps you ${printedScore(e.tradeScore, e.b)}` }, { text: `Chance they accept ${acceptText(e.pAccept)}`, label: `(Est. · ${e.acceptLabel})` }];
    // The chance it goes through, as the card says its own (buildTradeCard).
    const showsVeto = e.detail.vetoRisk || Math.abs(displayAcceptance(e.pComplete) - displayAcceptance(e.pAccept)) > 1e-9;
    const through = showsVeto ? throughText(e.pAccept, e.pComplete) : null;
    const acceptNote = through ? `Counting ${REVIEW_WORDS[snapshot.settings.tradeReview]}, ${through} it goes through.` : null;
    // The roster moves its numbers assume, only where they aren't the card's (the suggested trade is the card).
    const lines = s.kind === "suggested" ? [] : moveLinesOf(e, snapshot, card.partnerName);
    const numbers = numberParts.map((p) => (p.label ? `${p.text} ${p.label}` : p.text)).join(" · ");
    const view: OfferStepView = {
      kind: s.kind,
      label,
      trade,
      numberParts,
      acceptNote,
      moves: sameAsCard(lines) ? [] : lines,
      message: s.message,
      key: e.key,
      text: `${label}: ${trade} · ${numbers}${acceptNote ? ` · ${acceptNote}` : ""}`,
    };
    const version: VersionChoice =
      s.kind === "suggested" && own && own.key === e.key
        ? { ...own, label: suggested }
        : { version: s.kind, key: e.key, pAccept: e.pAccept, pComplete: e.pComplete, inputs: versionInputs(e, ctx.goal ?? null, scaleOf(e)), label: s.kind === "suggested" ? suggested : `${label}: ${tradeWords(e.proposal, snapshot)}` };
    return { view, version };
  });
  // No offer at all (the review of wave D, UI-D-8): the engine couldn't evaluate the trade, which isn't "as it is".
  const none = built.length === 0;
  const alone = built.length === 1 && built[0]?.view.kind === "suggested";
  return {
    cardKey: ladder.cardKey,
    steps: built.map((b) => b.view),
    intro: none ? OFFERS_NONE_TEXT : alone ? offersAloneText(card.partnerName) : OFFERS_INTRO_TEXT,
    alone,
    none,
    opensElsewhere: !none && built[0]?.view.kind !== "suggested",
    versions: built.map((b) => b.version),
  };
}

/**
 * The versions a card shows (the feedback's "Which version did you send?"; the file header): its own trade and Plan B's
 * (TradeCardView.versions) until "How to offer it" has loaded; then its offers in order (`ladder`: the suggested trade among
 * them), and Plan B's after them (planner reply to Checkpoint 7d, item 4.1: "Feedback records which step was sent").
 */
export function cardVersions(card: Pick<TradeCardView, "versions">, ladder: Pick<LadderView, "versions"> | null | undefined): VersionChoice[] {
  if (!ladder || !ladder.versions.length) return card.versions;
  const offered = new Set(ladder.versions.map((v) => v.key));
  return [...ladder.versions, ...card.versions.filter((v) => !offered.has(v.key))];
}

/** Plan B's heading on the card (the planner's words, planner reply to Checkpoint 7d, item 4.1; "If they say no, try:" until Checkpoint 7e). */
export const PLAN_B_HEADING = "If they won't move: try …";

/** Plan B's name as a version the user may have sent ("If they won't move: Garrett Wilson for Nico Collins"). */
export const PLAN_B_VERSION_LABEL = "If they won't move";

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
  /** The card's reward (CardContext.reward): the box's odds add the card's top-N line (Checkpoint 7c). */
  reward?: CardContext["reward"];
  /**
   * My team (the card's TradeDetail.myTeamId): the surnames in a release's reason among the box's roster moves are told apart
   * from my roster's (myRosterIds; review of Checkpoint 7f, PIERCE-3). Absent: the players the box's trade brings me alone.
   */
  myTeamId?: string | null | undefined;
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
 * Plan B, "If they won't move: try …" (TradeEvaluation.planB; the file header), or null without one: the trade in words (each
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
  // Its odds as the card prints its own (change 9; Checkpoint 7c's top-N line too), from the card's "before" (its own when it
  // has either-way moves: Checkpoint 7e, item 2.1, PlanB.before): none when the Plan B carries none.
  const odds = planB.dPO !== undefined || planB.dCH !== undefined ? oddsViews({ dPO: planB.dPO ?? null, dCH: planB.dCH ?? null, dPrizes: planB.dPrizes }, planB.before ?? ctx.baseline, ctx.reward) : [];
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
    oddsNote: planB.before && odds.length ? OWN_BEFORE_NOTE : null,
    moves: planB.myMoves ? myMovesLines(planB.myMoves, snapshot, teamNameOf(snapshot, planB.proposal.partnerId), { roster: myRosterIds(snapshot, ctx.myTeamId, planB.proposal) }) : [],
    also: null,
    pitch: planBPitch(planB.proposal, snapshot),
    analyzerHref: analyzerHref(planB.proposal, { from: "planB" }),
    key: planB.key,
    text: `${give} for ${get} · ${numbers}${acceptNote ? ` · ${acceptNote}` : ""}${oddsText}`,
  };
}

/** "Also shown as trade idea 6." (PlanBView.also; since wave D of Checkpoint 7e also under an offer of "How to offer it" that is another card shown: TradeCard.tsx). */
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
 * the Analyzer's): "odds" for the floor note (title, playoff or, since Checkpoint 7c, prize odds barely move), else null.
 * (Checkpoint 7a's "lambda", the
 * Win now ↔ Future note, went with its λ cap: planner reply to Checkpoint 7a, §2 question 6.) The engine keeps HelpsScale out
 * of TradeEvaluation, so the words are its record here; tradeView.test.ts checks this reads back every reason
 * helpsScaleNotes writes.
 */
export function helpsReasonOf(notes: readonly string[] | undefined): HelpsReason | null {
  if (!notes) return null;
  if (notes.some((n) => n === HELPS_FLOOR_NOTE || n === HELPS_FLOOR_NOTE_PLAYOFFS || n === HELPS_FLOOR_NOTE_PRIZES)) return "odds";
  return null;
}

/**
 * A version's model inputs for the feedback (the file header; FeedbackSent.inputs): its acceptance features, raw
 * g_mkt(P), B, the goal B was weighted by, and (Phase 7a) the B₃ its B is scored on and the scale's reason: the card's for
 * the card's own trade and its Plan B (both on the shown block since Checkpoint 7e), an offer's own for an offer of "How to
 * offer it" (its own evaluation's TradeEvaluation.b3, scaleOf; Checkpoint 7e, item 4.1; before it, a step's own TradeStep.b3:
 * the review's SHOWN-4). feedbackStore.ts keeps only finite numbers.
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
 * The versions of a trade idea its card shows before "How to offer it" loads (TradeCardView.versions; the feedback's "Which
 * version did you send?"), each with its key, estimate and model inputs (the file header: the card's own for the card's
 * trade and its Plan B, both on the card's scale, versionInputs; `goal`: what the league rewards as the numbers were
 * computed, null when unknown): the card's own trade ("suggested", `suggested` its label: OffersView.suggested), and
 * Plan B's when it has one ("If they won't move: Garrett Wilson for Nico Collins"). Since Checkpoint 7e (planner reply to
 * Checkpoint 7d, item 4.1) the offers of "How to offer it" join them once loaded (cardVersions), and an older evaluation's
 * steps (TradeEvaluation.steps, which the search no longer makes) aren't read.
 */
export function versionChoices(
  e: Pick<TradeEvaluation, "key" | "pAccept" | "pComplete" | "planB" | "features" | "gPartner" | "b"> & Partial<Pick<TradeEvaluation, "b3" | "detail">>,
  snapshot: SnapshotPart,
  goal: Goal | null = null,
  suggested: string = OFFER_STEP_LABEL.suggested,
): VersionChoice[] {
  const scale = scaleOf(e);
  const self: VersionChoice = { version: "suggested", key: e.key, pAccept: e.pAccept, pComplete: e.pComplete, inputs: versionInputs(e, goal, scale), label: suggested };
  const p = e.planB;
  return p
    ? [self, { version: "planB", key: p.key, pAccept: p.pAccept, pComplete: p.pComplete, inputs: versionInputs(p, goal, scale), label: `${PLAN_B_VERSION_LABEL}: ${tradeWords(p.proposal, snapshot)}` }]
    : [self];
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
 * Which way a long-term value change goes, from its share of the roster's long-term value (B_future / bFutureScale = ΔDyn ÷
 * the roster's long-term value): "Up" or "Down" when it's at least config.explain.longTermMin and rounds to a whole percent
 * other than 0 (explain.ts's long-term reasons' cut), else "About the same". Words only: the share itself is never shown.
 */
function longTermWay(share: number): "Up" | "Down" | "About the same" {
  const min = config.explain.longTermMin;
  if (Math.round(share * 100) === 0) return "About the same";
  return share >= min - 1e-9 ? "Up" : share <= -min + 1e-9 ? "Down" : "About the same";
}

/**
 * The card's "Long-term value" fact in dynasty and keeper leagues, in words only (the file header: the model's ΔDyn rests on
 * FantasyCalc's dynasty values): which way my roster's long-term value moves (longTermWay), "Up for your roster", "Down for
 * your roster" or "About the same for your roster"; when long-term values didn't load, that they didn't; null in a redraft
 * league or when the evaluation has no ΔDyn.
 */
function longTermFact(e: Pick<TradeEvaluation, "dDyn" | "bFuture" | "dynMissing">): FactView | null {
  if (e.dDyn !== null && Number.isFinite(e.dDyn)) {
    const scale = config.benefit.bFutureScale;
    const share = e.bFuture !== null && Number.isFinite(e.bFuture) && scale > 0 ? e.bFuture / scale : e.dDyn > 0 ? 1 : e.dDyn < 0 ? -1 : 0;
    return { label: "Long-term value", value: `${longTermWay(share)} for your roster` };
  }
  if (e.dynMissing) return { label: "Long-term value", value: "Unknown: long-term values didn't load" };
  return null;
}

/**
 * The partner's "Their long-term value" fact, after "Their lineup" (Checkpoint 7c; review of the "Helps both" UI,
 * helps-both-ui-1): in a dynasty or keeper league with long-term values, Helps them counts their roster's long-term value too
 * (PartnerNumbers.bFuture, B_future,P = bFutureScale × ΔDyn_P ÷ their roster's long-term value, weighed by λ_P from their own
 * playoff odds), so a card whose Helps them is high while all their odds fall says why, in words only: "Up", "Down" or
 * "About the same" (longTermWay, my fact's rule). Only beside their line (themView: a Helps them to read it with); null in a
 * redraft league and without long-term values (bFuture null: my own fact says they didn't load).
 */
export function theirLongTermFact(e: Pick<TradeEvaluation, "them">): FactView | null {
  const them = e.them;
  const scale = config.benefit.bFutureScale;
  if (!themView(e) || !them || them.bFuture === null || !Number.isFinite(them.bFuture) || !(scale > 0)) return null;
  return { label: "Their long-term value", value: longTermWay(them.bFuture / scale) };
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

/** "2 QBs", "1 kicker", "3 D/STs" (a position counted in words, the platform's labels). */
function countWords(pos: Pos, n: number, platform: SnapshotPart["platform"]): string {
  const word = positionWord(pos, platform);
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

/** The line that names my moves made with or without the trade (MY_MOVES_ASSUMED + the moves; Checkpoint 7e, item 2.2). */
export const MY_MOVES_ASSUMED = "Assumed with or without this trade:";

/**
 * The heading over a card's roster moves, a Plan B box's and an offer's of "How to offer it" (Checkpoint 7e; planner reply to
 * Checkpoint 7d, item 2.2: "Each card lists every roster move its numbers assume"; TradeCard.tsx, HowToRead.tsx).
 */
export const ROSTER_MOVES_HEADING = "Roster moves these numbers assume";

/**
 * Under a card's odds (and a Plan B box's) when its numbers start from its own "before" (TradeEvaluation.before, PlanB.before:
 * Checkpoint 7e, item 2.1's either-way moves; review of wave B, findings B-4 and either-way-before-unexplained): its "before"
 * isn't the page's "Your odds before any trade". Not on the Analyzer's card, whose line above it gives that "before".
 */
export const OWN_BEFORE_NOTE = "This idea's odds start from your odds with the moves it assumes with or without this trade.";

/** A player the league's data no longer has, in a roster move's words (myMovesLines, releaseLine). */
const GONE_PLAYER = "a player who's no longer in this league's data";

/** "Week 7, when Alec Pierce returns from IR" ("When …" without a week): a release's or a kept player's line starts so. */
function returnsWhen(week: number, returner: string, snapshot: SnapshotPart): string {
  const name = snapshot.players[returner]?.name ?? GONE_PLAYER;
  return Number.isFinite(week) ? `Week ${week}, when ${name} returns from IR` : `When ${name} returns from IR`;
}

/**
 * Why the near-tie rule released a player at an IR player's return, in words (Checkpoint 7f; planner reply to Checkpoint 7e,
 * answer 4: "keep the rule, but the card must say why. For example: “Week 7, when Alec Pierce returns from IR: release him. He
 * and Marvin Harrison Jr. are nearly even for your lineup, and Harrison Jr. has more trade value. Lock Pierce to keep him
 * instead.”"; NearTieRelease, returners.Displacement.keptInstead): the sentences after the release's line (releaseLine,
 * myMovesLines): "He and Marvin Harrison Jr. are nearly even for your lineup, and Harrison Jr. has more trade value.", then,
 * when the player released is mine as imported (NearTieRelease.lockable: the League page's lock is there), "Lock Pierce to
 * keep him instead." ⚠️ Ours, the planner's sentence made a rule for every line:
 * - "He" when the line before ends naming the player released (`endsOnReleased`: "release him.", "release Kyle Pitts Sr.
 *   (TE)."), else his surname ("… and keep Kyle Pitts Sr. (TE). Pierce and Marvin Harrison Jr. are …");
 * - the player kept by his full name the first time, by surname after, and by surname both times when the line already named
 *   him (`named`: the returner, the trade's "before"'s release: "He and Pierce are nearly even …");
 * - surnames as names.ts says them ("Pierce", "Harrison Jr.", "St. Brown"); either player by his full name, both times,
 *   whenever his surname is another's the line names (the other of the two, the returner, the "before"'s release: `named`) or
 *   another's on my roster (`roster`: myRosterIds), so a bare surname never names two people (review of Checkpoint 7f,
 *   PIERCE-3: "… and keep Roman Wilson. Wilson and Marvin Harrison Jr. are …" read as either Wilson);
 * - a D/ST by its name, never "He", and "it" ("Lock Giants D/ST to keep it instead.");
 * - the lock where it is: "Lock Pierce to keep him instead." on the League page (`page` "league": its roster card holds the
 *   lock), "Lock Pierce on the League page to keep him instead." on a trade page (`page` "trade": the cards, Plan B boxes,
 *   offers and the Analyzer's card, which have no lock; review of Checkpoint 7f, INTEGRATION-5).
 * The rule decided it, so it holds by construction: what losing either costs the lineup from the return on is within the
 * rule's tolerance, and the player kept is worth more then (returners.ts, the file header). Which one is worth more, in words:
 * no FantasyCalc value. Empty when either player isn't in the league's data.
 */
export function releaseReason(
  released: string,
  nearTie: NearTieRelease,
  snapshot: SnapshotPart,
  opts: { endsOnReleased: boolean; page: ReleasePage; named?: readonly (string | undefined)[]; roster?: readonly string[] | undefined },
): string {
  const p = snapshot.players[released];
  const k = typeof nearTie.keptInstead === "string" ? snapshot.players[nearTie.keptInstead] : undefined;
  if (!p || !k) return "";
  // Everyone whose surname could be mistaken for one of the two: the pair, the players the line names, my roster.
  const near = [released, nearTie.keptInstead, ...(opts.named ?? []), ...(opts.roster ?? [])];
  const shared = (id: string, info: PlayerInfo) =>
    near.some((o) => {
      const x = typeof o === "string" && o !== id ? snapshot.players[o] : undefined;
      return !!x && surname(x.name, x.pos) === surname(info.name, info.pos);
    });
  const pShort = shared(released, p) ? p.name : surname(p.name, p.pos);
  const kShort = shared(nearTie.keptInstead, k) ? k.name : surname(k.name, k.pos);
  const team = p.pos === "DEF";
  const subject = opts.endsOnReleased ? (team ? p.name : "He") : pShort;
  const kFirst = opts.named?.includes(nearTie.keptInstead) ? kShort : k.name;
  const lock = nearTie.lockable === true ? ` Lock ${pShort}${opts.page === "trade" ? " on the League page" : ""} to keep ${team ? "it" : "him"} instead.` : "";
  return `${subject} and ${kFirst} are nearly even for your lineup, and ${kShort} has more trade value.${lock}`;
}

/**
 * Where a release's words show (releaseReason, releaseLine): "league", the League page's roster card, where my lock is; "trade",
 * a trade page (a card, a Plan B box, an offer of "How to offer it", the Analyzer's card), which names where the lock is.
 */
export type ReleasePage = "league" | "trade";

/**
 * The players a release's reason compares surnames with (releaseReason's `roster`; review of Checkpoint 7f, PIERCE-3): my roster
 * as imported, active and IR, and the players a trade brings me (`proposal`, ⚠️ ours: they're on my roster when the release
 * comes); the latter alone without my team in the league's data.
 */
export function myRosterIds(snapshot: Pick<SnapshotPart, "teams">, myTeamId: string | null | undefined, proposal?: Pick<TradeProposal, "get"> | null): string[] {
  const team = typeof myTeamId === "string" ? snapshot.teams.find((t) => t.id === myTeamId) : undefined;
  const got = (proposal?.get ?? []).flatMap((a) => (a.kind === "player" ? [a.id] : []));
  return [...new Set([...(team?.roster ?? []), ...(team?.ir ?? []), ...got])];
}

/**
 * A release at an IR player's return, in its own line's words (Checkpoint 7e's line, myMovesLines' release a trade changes;
 * since Checkpoint 7f the League page's "Returns from IR", leagueView.ts RosterCard.returns): "Week 7, when Alec Pierce returns
 * from IR: release him instead of dropping someone else." (the returner himself), "…: release Kyle Pitts Sr. (TE)."; and when
 * the near-tie rule decided it, its reason after it (releaseReason, on `page`, with `roster`), the returner himself then just
 * "release him." (the planner's words: "Week 7, when Alec Pierce returns from IR: release him. He and Marvin Harrison Jr. are
 * nearly even for your lineup, and Harrison Jr. has more trade value. Lock Pierce to keep him instead."). A release made with
 * or without a trade isn't worded here: it joins the card's assumed line (assumedReleaseText).
 */
export function releaseLine(r: { week: number; player: string; returner: string; nearTie?: NearTieRelease | undefined }, snapshot: SnapshotPart, opts: { page: ReleasePage; roster?: readonly string[] | undefined }): string {
  const info = snapshot.players[r.player];
  const reason = r.nearTie ? releaseReason(r.player, r.nearTie, snapshot, { endsOnReleased: true, named: [r.returner], page: opts.page, roster: opts.roster }) : "";
  const whom = r.player === r.returner ? (reason ? "him" : "him instead of dropping someone else") : info ? `${info.name} (${posLabel(info.pos, snapshot.platform)})` : GONE_PLAYER;
  return `${returnsWhen(r.week, r.returner, snapshot)}: release ${whom}.${reason ? ` ${reason}` : ""}`;
}

/**
 * A release at an IR return made with or without the trade (RosterMoves.assumedLater), as the card's "Assumed with or without
 * this trade" line names it (myMovesLines; review of Checkpoint 7f, INTEGRATION-4: its own line, with why, repeated the same
 * 214 characters on most of a list): names only, no reason (the League page's "Returns from IR" says why): "release Alec
 * Pierce in week 7, when he returns from IR", "release Kyle Pitts Sr. in week 7, when Alec Pierce returns from IR" ("…
 * when he returns from IR" without a week).
 */
function assumedReleaseText(r: AssumedRelease, snapshot: SnapshotPart): string {
  const name = snapshot.players[r.player]?.name ?? GONE_PLAYER;
  const returner = r.player === r.returner ? "he" : (snapshot.players[r.returner]?.name ?? GONE_PLAYER);
  return `release ${name}${Number.isFinite(r.week) ? ` in week ${r.week},` : ""} when ${returner} returns from IR`;
}

/**
 * My roster moves on a card, in sentences (Checkpoint 7e; planner reply to Checkpoint 7d, item 2.2: "Each card lists every
 * roster move its numbers assume, in order, each with its reason and its week … Moves Parker would make either way, like his
 * Malik Washington pickup, aren't listed as part of the trade. One line can say they're assumed either way."), from
 * TradeEvaluation.myMoves (evaluate.ts myRosterMoves, which names every way my roster after the trade differs from the trade's
 * "before"), in its order, each with its reason; a later week's move with its week:
 * - "Stay within your league's limit of 2 QBs: drop Jordan Love (QB)." (legality's rule 1);
 * - "Make room for Christian Watson: drop Kyle Pitts Sr. (TE)." (rule 2; the planner's words; "Make room on your roster" when
 *   no received player can be named, a player this trade brings in "(WR, from this trade)");
 * - "Keep your league's minimum of 2 RBs: add Kenny Gainwell (RB)." (rule 3);
 * - "Open roster spot: add Tyler Allgeier, the best available RB." (rule 4, today's words: openSpotText, with the return that
 *   releases him again said in the same sentence, as before); either one, when he's a pickup the "before" makes too (review of
 *   wave B, finding B-1): "… He's the League page's pickup, so you keep Romeo Doubs (WR)." ("He's a pickup worth making either
 *   way" for item 2.1's either-way move; without ", so you keep …" when nobody stays);
 * - "Jordan Mason goes to your IR slot (no roster spot until he's back)." (rule 5, today's words);
 * - "This trade makes a waiver move worthwhile: add Darren Waller (TE), drop Kyle Pitts Sr. (TE)." (a free-agent move that
 *   stays with the trade, item 2.1; the planner's words, a lone pickup's start weeks when one or two: "add Malik Willis (QB)
 *   to start in week 7"; "…, drop Stefon Diggs (WR), whom this trade brings in." (finding B-3); "… add Dalton Schultz (TE)
 *   instead of the League page's pickup, Jake Ferguson (TE).");
 * - "This trade makes Romeo Doubs worth keeping: for the League page's pickup, Jake Ferguson, drop Rico Dowdle (RB) instead."
 *   (the League page's pickup with another drop; without a drop kept, "For the League page's pickup, Jake Ferguson, drop …";
 *   "the pickup worth making either way" for item 2.1's either-way move);
 * - "This trade makes the League page's pickup unnecessary: skip Jake Ferguson (TE) and keep Romeo Doubs (WR)."; "Tetairoa
 *   McMillan takes the roster spot of the League page's pickup: skip Jake Ferguson (TE)." (the players this trade brings in
 *   take his spot: finding moves-skip-reason-spot-taken; "This trade takes …" when they can't be named); "After this trade
 *   Team 8 claims the League page's pickup, Jake Ferguson (TE), ahead of you: keep Romeo Doubs (WR)." (the partner picks him
 *   up first);
 * - "Week 7, when Alec Pierce returns from IR: release Wan'Dale Robinson (WR)." (the planner's words; "release him instead of
 *   dropping someone else" when it's the returner himself); where the trade's "before" would release another player then
 *   (finding moves-before-release-unnamed): "…: release him and keep Kyle Pitts Sr. (TE)." when the roster after the trade
 *   still holds that player, "…: release him; without this trade, Kyle Pitts Sr. (TE) would go then." when he's gone by then;
 *   "Week 7, when Alec Pierce returns from IR: this trade leaves room, so keep Kyle Pitts Sr. (TE)." when it releases nobody
 *   ("Keep Kyle Pitts Sr. (TE): without this trade you'd release him in week 7, when Alec Pierce returns from IR." when the
 *   returner goes in the trade); since Checkpoint 7f (planner reply to Checkpoint 7e, answer 4: "keep the rule, but the card
 *   must say why"), a release the trade changes that the near-tie rule decided, with its reason after it (releaseReason,
 *   releaseLine: "Week 7, when Alec Pierce returns from IR: release Kyle Pitts Sr. (TE). He and Marvin Harrison Jr. are nearly
 *   even for your lineup, and Harrison Jr. has more trade value. Lock Pitts Sr. on the League page to keep him instead.";
 *   "… and keep Kyle Pitts Sr. (TE). Pierce and Marvin Harrison Jr. are …"; the lock is on the League page: review of
 *   Checkpoint 7f, INTEGRATION-5);
 * - "Drop …", "Keep …", "Add …" (a difference the moves above don't explain: a safety net, none on any test league);
 * - last, "Assumed with or without this trade: add Jake Ferguson, drop Romeo Doubs." (MY_MOVES_ASSUMED: the League page's
 *   pickups and the players dropped in both versions, "drop Romeo Doubs"; names only, the sentence's own period kept after a
 *   name that ends with one: "… drop Marvin Harrison Jr.", review of wave B, finding moves-assumed-double-period), since
 *   Checkpoint 7f with each release at an IR return made with or without the trade after them, by week, names only, without
 *   its reason (RosterMoves.assumedLater, assumedReleaseText; the League page's "Returns from IR" says why; review of
 *   Checkpoint 7f, INTEGRATION-4: a line of its own with the reason repeated the same sentence on most of a list): "Assumed with
 *   or without this trade: add Jake Ferguson, drop Romeo Doubs, release Alec Pierce in week 7, when he returns from IR." (the
 *   lead's words; "Assumed with or without this trade: release Alec Pierce in week 7, when he returns from IR." alone; ⚠️ ours:
 *   with two pickup groups or two releases every part after a semicolon, as two pickup groups already are, so a release never
 *   reads as part of the pickup before it); ⚠️ the trade's "before" can release another player there than the League page's
 *   when it makes either-way moves, and the line still names its own. Then item 2.1's either-way moves on a line of their own,
 *   since the League page doesn't list them: "Also assumed with or without this trade, though the League page doesn't list it:
 *   add Darren Waller, drop Kyle Pitts Sr." ("Assumed …" alone).
 * `partnerName` names the partner in a "taken" skip; `opts.roster`, my roster for the surnames in a release's reason
 * (myRosterIds: releaseReason).
 */
export function myMovesLines(moves: RosterMoves, snapshot: SnapshotPart, partnerName: string, opts: { roster?: readonly string[] | undefined } = {}): string[] {
  const plain = (id: string) => snapshot.players[id]?.name ?? "a player who's no longer in this league's data";
  const who = (id: string) => {
    const info = snapshot.players[id];
    return info ? `${info.name} (${posLabel(info.pos, snapshot.platform)})` : "a player who's no longer in this league's data";
  };
  // A player this trade brings in, inside a list of drops: "Stefon Diggs (WR, from this trade)".
  const whoIn = (id: string) => {
    const info = snapshot.players[id];
    return info ? `${info.name} (${posLabel(info.pos, snapshot.platform)}, from this trade)` : who(id);
  };
  const cap = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
  const whose = (eitherWay?: boolean) => (eitherWay ? "the pickup worth making either way" : "the League page's pickup");
  const brings = (received?: boolean) => (received ? ", whom this trade brings in" : "");
  const pickupNote = (pk: PickupOf | undefined) =>
    pk ? ` He's ${pk.eitherWay ? "a pickup worth making either way" : "the League page's pickup"}${typeof pk.keep === "string" ? `, so you keep ${who(pk.keep)}` : ""}.` : "";
  const list = (moves.moves ?? []).filter((m) => m && typeof m.kind === "string");
  // An open spot's fill released again at a return: said in the spot's own sentence (openSpotText), not on a line of its own,
  // unless the trade's "before" would release someone else then (the line says whom, finding moves-before-release-unnamed).
  const fills = new Set(list.flatMap((m) => (m.kind === "openSpot" ? [m.spot.playerId] : [])));
  const until = new Map<string, { returner: string; week: number }>();
  for (const m of list) if (m.kind === "release" && m.instead === undefined && fills.has(m.player) && m.player !== m.returner && !until.has(m.player)) until.set(m.player, { returner: m.returner, week: m.week });
  const out: string[] = [];
  const toIR: string[] = [];
  const flushIR = () => {
    if (!toIR.length) return;
    const one = toIR.length === 1;
    out.push(cap(`${listText(toIR.map(plain))} ${one ? "goes" : "go"} to your IR ${one ? "slot" : "slots"} (no roster ${one ? "spot" : "spots"} until ${one ? "he's" : "they're"} back).`));
    toIR.length = 0;
  };
  for (const m of list) {
    if (m.kind === "toIR") {
      toIR.push(m.player);
      continue;
    }
    flushIR();
    switch (m.kind) {
      case "positionLimit":
        out.push(`Stay within your league's limit of ${countWords(m.pos, m.limit, snapshot.platform)}: drop ${who(m.drop)}.`);
        break;
      case "makeRoom": {
        const brought = new Set(m.received ?? []);
        out.push(`${m.for.length ? `Make room for ${listText(m.for.map(plain))}` : "Make room on your roster"}: drop ${listText(m.drop.map((id) => (brought.has(id) ? whoIn(id) : who(id))))}.`);
        break;
      }
      case "rosterMinimum":
        out.push(`${m.pos !== null && m.min !== null ? `Keep your league's minimum of ${countWords(m.pos, m.min, snapshot.platform)}: add ${who(m.add)}.` : `Fill your roster: add ${who(m.add)}.`}${pickupNote(m.pickup)}`);
        break;
      case "openSpot":
        out.push(`${openSpotText(m.spot, "Open roster spot: add", snapshot, until.get(m.spot.playerId))}${pickupNote(m.pickup)}`);
        break;
      case "waiver": {
        const weeks = (m.starts ?? []).filter((w) => Number.isFinite(w));
        const when = weeks.length >= 1 && weeks.length <= 2 ? ` to start in ${weeks.length === 1 ? "week" : "weeks"} ${listText(weeks.map(String))}` : "";
        const instead = typeof m.insteadOf === "string" ? ` instead of ${whose(m.insteadOfEitherWay)}, ${who(m.insteadOf)}` : "";
        out.push(`This trade makes a waiver move worthwhile: add ${who(m.add)}${when}${instead}${m.drop !== null ? `, drop ${who(m.drop)}${brings(m.received)}` : ""}.`);
        break;
      }
      case "pickupDrop": {
        const what =
          m.drop !== null
            ? `for ${whose(m.eitherWay)}, ${plain(m.add)}, drop ${who(m.drop)}${m.instead !== null ? " instead" : ""}${brings(m.received)}`
            : `${whose(m.eitherWay)}, ${plain(m.add)}, takes an open roster spot`;
        out.push(m.instead !== null ? `This trade makes ${plain(m.instead)} worth keeping: ${what}.` : `${cap(what)}.`);
        break;
      }
      case "skip": {
        const keep = m.keep !== null ? ` and keep ${who(m.keep)}` : "";
        const by = (m.by ?? []).filter((id) => typeof id === "string");
        if (m.why === "taken") out.push(`After this trade ${partnerName} claims ${whose(m.eitherWay)}, ${who(m.add)}, ahead of you${m.keep !== null ? `: keep ${who(m.keep)}` : ""}.`);
        else if (m.why === "spot") out.push(`${by.length ? `${listText(by.map(plain))} ${by.length === 1 ? "takes" : "take"}` : "This trade takes"} the roster spot of ${whose(m.eitherWay)}: skip ${who(m.add)}${keep}.`);
        else out.push(`This trade makes ${whose(m.eitherWay)} unnecessary: skip ${who(m.add)}${keep}.`);
        break;
      }
      case "release": {
        if (m.instead === undefined && until.get(m.player)?.returner === m.returner) break; // said with his open spot
        if (typeof m.instead === "string" && m.instead !== m.player) {
          const when = returnsWhen(m.week, m.returner, snapshot);
          const go = m.player === m.returner ? "release him" : `release ${who(m.player)}`;
          // The returner kept is named, never "him" (the final review of Checkpoint 7e, MOVES-1: "release Josh Jacobs (RB) and
          // keep him" read as keeping the player just released).
          const line = m.kept ? `${when}: ${go} and keep ${m.instead === m.returner ? plain(m.returner) : who(m.instead)}.` : `${when}: ${go}; without this trade, ${who(m.instead)} would go then.`;
          // Checkpoint 7f: why the near-tie rule decided it; the line ends naming another player, so the reason names him.
          const reason = m.nearTie ? releaseReason(m.player, m.nearTie, snapshot, { endsOnReleased: false, named: [m.returner, m.instead], page: "trade", roster: opts.roster }) : "";
          out.push(reason ? `${line} ${reason}` : line);
        } else out.push(releaseLine(m, snapshot, { page: "trade", roster: opts.roster }));
        break;
      }
      case "keepAtReturn": {
        const self = m.player === m.returner;
        if (m.returnerStays) {
          out.push(`${returnsWhen(m.week, m.returner, snapshot)}: this trade leaves room, so keep ${self ? "him" : who(m.player)}.`);
        } else out.push(`Keep ${who(m.player)}: without this trade you'd release him${Number.isFinite(m.week) ? ` in week ${m.week}` : ""}, when ${plain(m.returner)} returns from IR.`);
        break;
      }
      case "drop":
        out.push(`Drop ${who(m.player)}${brings(m.received)}.`);
        break;
      case "keep":
        out.push(`Keep ${who(m.player)}.`);
        break;
      case "add":
        out.push(`Add ${who(m.player)}.`);
        break;
    }
  }
  flushIR();
  const partsOf = (eitherWay: boolean) =>
    (moves.assumed ?? []).flatMap((a) => {
      if (!a || (a.eitherWay === true) !== eitherWay) return [];
      const words = [typeof a.add === "string" ? `add ${plain(a.add)}` : null, typeof a.drop === "string" ? `drop ${plain(a.drop)}` : null].filter((w): w is string => w !== null);
      return words.length ? [words.join(", ")] : [];
    });
  // A name can end the sentence with its own period ("Jr."), as draftSummary's (review of wave B, moves-assumed-double-period).
  const sentence = (text: string) => (text.endsWith(".") ? text : `${text}.`);
  const own = partsOf(false);
  // Checkpoint 7f (the lead's R3; review of Checkpoint 7f, INTEGRATION-4): each release at an IR return made with or without
  // the trade joins this line, by week, names only (the League page's "Returns from IR" says why). One pickup group (or none)
  // and one release make one list, the lead's words; with more, every part after a semicolon, as pickup groups already are.
  const week = (w: number) => (Number.isFinite(w) ? w : Number.MAX_SAFE_INTEGER);
  const later = (moves.assumedLater ?? [])
    .filter((r) => r && typeof r.player === "string" && typeof r.returner === "string")
    .sort((a, b) => week(a.week) - week(b.week))
    .map((r) => assumedReleaseText(r, snapshot));
  const parts = [...own, ...later];
  if (parts.length) out.push(sentence(`${MY_MOVES_ASSUMED} ${parts.join(later.length === 1 && own.length <= 1 ? ", " : "; ")}`));
  // Item 2.1's either-way moves on a line of their own: the League page doesn't list them (review of wave B, finding
  // either-way-before-unexplained).
  const either = partsOf(true);
  if (either.length) out.push(sentence(`${parts.length ? "Also assumed" : "Assumed"} with or without this trade, though the League page doesn't list ${either.length === 1 ? "it" : "them"}: ${either.join("; ")}`));
  return out;
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

/**
 * The roster moves a trade's numbers assume, in sentences (TradeCardView.required; an offer of "How to offer it" reads its
 * own the same way, buildLadderView), mine first: since Checkpoint 7e every one, in order, with its reason, and those made
 * either way on one line (item 2.2: myMovesLines, from TradeEvaluation.myMoves); an evaluation made before it words
 * `required.me` as before (§7; Phase 4b's IR slots and returns, Phase 7c's open roster spots: requiredLines). The partner's
 * as before. My roster for the surnames in a release's reason: my team's as imported and the players this trade brings me
 * (myRosterIds; the latter alone without `detail`).
 */
export function moveLinesOf(
  e: Pick<TradeEvaluation, "required" | "myMoves"> & Partial<Pick<TradeEvaluation, "proposal">> & { detail?: Pick<TradeDetail, "myTeamId"> | undefined },
  snapshot: SnapshotPart,
  partnerName: string,
): string[] {
  return [
    ...(e.myMoves
      ? myMovesLines(e.myMoves, snapshot, partnerName, { roster: myRosterIds(snapshot, e.detail?.myTeamId, e.proposal) })
      : requiredLines(e.required.me, { drop: "You'd drop", dropLater: "you'd drop", release: "you'd release", pickUp: "You'd pick up", their: "your", ir: "your", would: "you'd", openSpot: "Open roster spot: add" }, snapshot)),
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

  // The partner's line (Checkpoint 7c), on a Trade Finder card only when the trade helps both teams (planner reply to
  // Checkpoint 7c, answer 3: CardContext.partnerLine), on the Analyzer's whenever the partner's numbers exist.
  const helpsBothTag = helpsBothTagOf(e);
  const them = ctx.partnerLine === "helpsBoth" && !helpsBothTag ? null : themView(e, ctx.reward);

  // My odds before and after sit next to the three numbers (oddsViews), not among these. No trade value number (the file
  // header): long-term value in words, and the "Values: FantasyCalc" credit after them (valuesCredit).
  const facts: FactView[] = [{ label: "Your lineup", value: `${perWeek(e.dPPW)} in the regular season, ${fmtSigned(e.dPPWPlayoffs, 1)} in the playoffs` }];
  const longTerm = longTermFact(e);
  if (longTerm) facts.push(longTerm);
  facts.push({ label: "Their lineup", value: perWeek(e.partnerDeltaLineup) });
  // What Helps them counts besides their odds in a dynasty or keeper league (Checkpoint 7c; theirLongTermFact), beside the
  // partner's line only (⚠️ ours, Checkpoint 7d: it says why a Helps them reads as it does, so a Finder card without the line
  // shows neither).
  const theirLongTerm = them ? theirLongTermFact(e) : null;
  if (theirLongTerm) facts.push(theirLongTerm);
  // "Now or after this week" (Checkpoint 7e, item 4.2): the Trade Finder's numbers as they arrive (CardContext.later), else the
  // evaluation's own (the Analyzer's); the tooltip's words among the facts too, which a phone shows (⚠️ ours).
  const nowOrLater = nowOrLaterView(e, ctx.later?.get(e.key) ?? e.later);
  if (nowOrLater) facts.push({ label: NOW_OR_LATER_LABEL, value: nowOrLater.title });
  // The scale's wording without the search's or the Analyzer's scale: the league type, and whether long-term values loaded.
  const scaleFallback: ScaleFallback = { leagueType: snapshot.settings.leagueType, longTermOn: !e.dynMissing };

  // The roster moves the numbers assume, mine first (moveLinesOf).
  const required = moveLinesOf(e, snapshot, partnerName);

  // Injury tags in words on both sides (the evaluation's; else, a core without them, tags from the snapshot: tagsOf).
  const tags = tagsOf(e, snapshot);
  const end = seasonEndOf(snapshot.settings, ctx.lastNflWeek);
  const source = dateSourceOf(snapshot);
  const statusOf = (a: TradeAsset, side: InjuryTag["side"]): AssetView["status"] => {
    const t = a.kind === "player" ? tags.find((x) => x.playerId === a.id && x.side === side) : undefined;
    return t ? { text: injuryTagText(t, end, source), tone: INJURY_TONE[t.status] } : null;
  };

  const numbers: TradeCardView["numbers"] = {
    // The scale in a tooltip (planner reply to Checkpoint 4c, A2: "63 ≈ as good as adding 3 points a week …"; the mix with
    // long-term values: planner reply to Checkpoint 7a, §2 question 6).
    helps: { ...scoreView(e.tradeScore, e.b), title: helpsScaleText(ctx.helpsScale, scaleFallback) },
    accept: { value: acceptText(e.pAccept), srText: underStep(e.pAccept) ? acceptSrText(e.pAccept) : null },
    acceptLabel: `Est. · ${e.acceptLabel}`,
    acceptNote: through ? `Counting ${REVIEW_WORDS[snapshot.settings.tradeReview]}, ${through} it goes through.` : null,
    overall: scoreView(e.overall, e.b),
  };
  // My odds from the trade's own "before" when it has either-way moves (Checkpoint 7e, item 2.1: TradeEvaluation.before), else
  // the search's baseline.
  const odds = oddsViews(e, e.before ?? ctx.baseline, ctx.reward);
  const weekly = weeklyLine(e.detail.winChance);
  // "How to offer it" (Checkpoint 7e, item 4.1): its offers are worked out when it's opened (buildLadderView).
  const offers = offersView(e, ctx.offers);

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
    numbers,
    odds,
    weekly,
    oddsNote: e.before && odds.length ? OWN_BEFORE_NOTE : null,
    nowOrLater,
    // The partner's line and the "Helps both" tag (Checkpoint 7c, planner reply to Checkpoint 7b, §7), from the same runs as mine.
    them,
    helpsBothTag,
    details: ctx.details ? detailsView(e, snapshot.settings.leagueType, ctx.helpsScale) : null,
    offers,
    planB: planBView(e.planB, snapshot, { cardTags: tags, knownTags: ctx.knownTags, seasonEnd: end, baseline: ctx.baseline, reward: ctx.reward, myTeamId: e.detail.myTeamId }),
    injuryNote: incomingInjuryNote(tags, snapshot, flagged, blendOn),
    versions: versionChoices(e, snapshot, ctx.goal ?? null, offers?.suggested ?? (ctx.offers === "finder" || ctx.offers === undefined ? OFFER_STEP_LABEL.suggested : ANALYZER_SUGGESTED_LABEL)),
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
    // What the card prints, for its feedback record and the export (Checkpoint 7d): its own words, never a model number.
    shown: shownOf({ numbers, through, label: e.acceptLabel, odds, weekly, them }),
    evaluation: e,
  };
}

/**
 * What a card prints, as its feedback record keeps it (TradeCardView.shown; Checkpoint 7d, planner reply to Checkpoint 7c,
 * answer 1: "the numbers on its card: Helps you, Helps them, the chance they accept, Overall and the odds lines"): Helps you,
 * the chance they accept with its label (the word alone: "Est." goes with every one), the chance it goes through when the
 * card says it (throughText), Overall, my odds lines ("Title odds 12.1% → 13.4%"), my weekly line, and Helps them with their
 * odds when the card shows the partner's line, each as the card prints it. feedbackStore.ts parseFeedbackShown keeps exactly
 * these forms (tradeView.test.ts checks every card's passes whole).
 */
export function shownOf(card: {
  numbers: Pick<TradeCardView["numbers"], "helps" | "accept" | "overall">;
  through: string | null;
  label: string;
  odds: readonly OddsView[];
  weekly: WeeklyLineView | null;
  them: ThemView | null;
}): FeedbackShown {
  const line = (o: OddsView) => `${o.label} ${o.value}`;
  return {
    helps: card.numbers.helps.value,
    chance: card.numbers.accept.value,
    label: card.label,
    ...(card.through ? { through: card.through } : {}),
    overall: card.numbers.overall.value,
    odds: card.odds.map(line),
    ...(card.weekly ? { weekly: card.weekly.text } : {}),
    ...(card.them ? { helpsThem: card.them.helps.value, theirOdds: card.them.odds.map(line) } : {}),
  };
}

/**
 * A press on a card's feedback buttons as it's saved (Checkpoint 7d): the press with what the card prints (its `shown`), so
 * the record it makes keeps it (feedbackStore.ts applyFeedback; the export holds it). TradeCard.tsx sends every press through
 * it.
 */
export function cardPress(change: FeedbackChange, card: Pick<TradeCardView, "shown">): FeedbackChange {
  return { ...change, shown: card.shown };
}

// ---------------------------------------------------------------------------------------------
// My odds before any trade (both pages)

/**
 * My odds before any trade in words (the Finder's line above its ideas, the Analyzer's above its card) and what they
 * count (the file header): the League page's headline odds, every team after the free-agent pickups that would help it
 * (planner reply to Checkpoint 4b, change 9: one baseline everywhere), the title with one decimal like the cards' odds.
 * Review of Phase 4: the Finder said "Your odds now: 71%" while the League page said 76%, so a card's "(71% to 77%)" read
 * as a 1-point gain; since Phase 4c the two are the same odds. Null when the season wasn't simulated. ⚠️ Ours (Checkpoint
 * 7c): under "Several prizes" paying 2nd or 3rd place (`reward`: topPlacesOf), my chance of a top-N finish too, between
 * them, the "before" of every card's top-N line ("…: 62% to make the playoffs, 30% to finish in the top 3, 9.0% to win the
 * title."), when all its parts are known.
 */
export function baselineLines(baseline: CardContext["baseline"], page: "finder" | "analyzer", reward?: CardContext["reward"], assumed = false): { text: string; note: string } | null {
  if (!baseline || baseline.pPlayoffs === null || !Number.isFinite(baseline.pPlayoffs)) return null;
  const title = baseline.pTitle !== null && Number.isFinite(baseline.pTitle) ? `, ${titleOddsText(baseline.pTitle)} to win the title` : "";
  const places = topPlacesOf(reward);
  const topP = places ? topChance(baseline.prizes, places) : null;
  const top = places && topP !== null ? `, ${percentText(Math.min(1, Math.max(0, topP)))} to finish in the top ${places}` : "";
  return {
    text: `Your odds ${page === "finder" ? "before any trade" : "before this trade"}: ${percentText(baseline.pPlayoffs)} to make the playoffs${top}${title}.`,
    // Checkpoint 7e (planner reply to Checkpoint 7d, item 2.1): an Analyzer trade with either-way moves starts from its own
    // "before" (TradeEvaluation.before: the League page's pickups and those moves), which the line then gives (`assumed`); on
    // the Finder, `assumed` says some idea shown starts from its own, which its card says (OWN_BEFORE_NOTE; review of wave B,
    // findings B-4 and either-way-before-unexplained).
    note:
      assumed && page === "analyzer"
        ? "They count the free-agent pickups that would help each team, as on the League page, and the moves the card assumes with or without this trade; the trade's odds start from them."
        : `As on the League page, they count the free-agent pickups that would help each team, and ${page === "finder" ? "every trade idea's" : "the trade's"} odds start from them${assumed ? ", except where an idea says otherwise" : ""}.`,
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
 * long-term values, planner reply to Checkpoint 7a, §2 question 6). Under "Several prizes" (Checkpoint 7c, the lead's words:
 * weighedOddsWords, by `reward`, else the scale) it sums up "how much your chances at your league's prizes and your playoff
 * odds rise", with the same endings.
 */
export function helpsInfoText(leagueType: LeagueSnapshot["settings"]["leagueType"], valuesOn = true, longTermOn = true, scale?: HelpsScale | null, reward?: CardContext["reward"]): string {
  const lead = `Helps you (0–100) sums up how much ${weighedOddsWords(reward, scale)} rise`;
  let what: string;
  if (leagueType !== "redraft") what = longTermOn ? `${lead}, weighed against the change in your roster's long-term value.` : `${lead}.`;
  else what = valuesOn ? `${lead}, minus a cost for giving away trade value or plus a credit for gaining it.` : `${lead}.`;
  // The scale (planner reply to Checkpoint 4c, A2), said in words too: the card's tooltip can't be hovered on a phone.
  return `${what} ${helpsScaleText(scale, { leagueType, longTermOn })}`;
}

/**
 * Whether the pages name the league's prizes rather than the title in what Helps you weighs (Checkpoint 7c; planner reply to
 * Checkpoint 7b, §6): under "Several prizes" paying more than 1st place (`reward`: goal "prizes" and not reward.ts
 * TITLE_ONLY's split, so a split of 1st place alone, or none entered, reads as the title, which is what B weighs then).
 * Without a reward, the scale's own word for it (HelpsScale.oddsNamed "prizes": ⚠️ "playoff" when a paid prize's odds are
 * unknown, so the title's words then; how to read gets the scale alone from its page).
 */
export function namesPrizes(reward?: CardContext["reward"], scale?: Pick<HelpsScale, "oddsNamed"> | null): boolean {
  if (reward) return reward.goal === "prizes" && !isTitleOnly(reward.shares);
  return scale?.oddsNamed === "prizes";
}

/** What Helps you weighs, in words (namesPrizes): "your chances at your league's prizes and your playoff odds", else "your title and playoff odds". */
export function weighedOddsWords(reward?: CardContext["reward"], scale?: Pick<HelpsScale, "oddsNamed"> | null): string {
  return namesPrizes(reward, scale) ? "your chances at your league's prizes and your playoff odds" : "your title and playoff odds";
}

/**
 * The odds each card shows, in words, for How to read's "Each card shows … before and after the trade" (review of the
 * prizes UI, prizes-ui-6): after the title and playoff odds (weighedOddsWords) "those odds", but after the league's prizes
 * the card's own lines (oddsViews), since a weekly high score or the points title has none: by the reward, "your title,
 * top-3 and playoff odds" (topPlacesOf: 2nd or 3rd place paid), else "your title and playoff odds"; without one (the page
 * passed the scale alone), the title and playoff odds with the top-N line's rule.
 */
export function cardOddsWords(reward?: CardContext["reward"], scale?: Pick<HelpsScale, "oddsNamed"> | null): string {
  if (!namesPrizes(reward, scale)) return "those odds";
  if (!reward) return "your title and playoff odds (and your top-3 odds when your league pays 3rd place, or your top-2 odds when it pays 2nd)";
  const places = topPlacesOf(reward);
  return places ? `your title, top-${places} and playoff odds` : "your title and playoff odds";
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
  /**
   * The reward the search weighed B by (TradeSearchResult.reward; Checkpoint 7c), for "How to read" (HowToRead's `reward`:
   * the odds it names under "Several prizes", review of the prizes UI, prizes-ui-7); null when the result has none.
   */
  reward: Pick<Reward, "goal" | "shares"> | null;
  /** The pattern note above the list (TradeSearchResult.pattern's text), or null; never under "Helps both" (the Overall list's note). */
  pattern: string | null;
  /**
   * "Only 4 trade ideas to show at “at least 50%”. Try a lower setting to see more." when the minimum leaves few (fewText), or
   * null; under "Helps both", "Only 2 trades help both teams right now." with fewer than 5 (helpsBothFewText).
   */
  few: string | null;
  cards: TradeCardView[];
  /**
   * Checkpoint 7e (item 4.2): the cards' "now or after this week" numbers, "pending" while some are still to come (the Trade
   * Finder's list says so in a data attribute, which `npm run check:browser` waits on), "done" once every card has its own;
   * absent when none are expected (buildFinderView's `later`).
   */
  nowOrLater?: "pending" | "done";
  /** "25 trade ideas, sorted by Overall." ("4 trade ideas that help both teams, sorted by Helps you." under "Helps both"; "" when none). */
  countText: string;
  /** The status line once the search is done: "Found 25 trade ideas." ("Found 4 trade ideas that help both teams.") or the empty state's title. */
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
 * with each of the best 60 and 20,000 times with each idea shown. That took 7.1 seconds." ⚠️ Not "the best 208" (review of
 * track UIC, finding 6): exact evaluation takes the best config.search.exactEvaluationMax by screening and, on top of them,
 * the lean companions (search.ts: the same trades without a neutral throw-in), which missed that cut. Checkpoint 7e
 * (planner reply to Checkpoint 7d, item 1.1): the best are ranked on config.simulation.finalSims seasons, and every idea the
 * lists show (its card or Plan B box) is played out on config.simulation.shownSims (search.ts, "The shown pass":
 * TradeSearchResult.counts.simShown), said when there are more of those and the search showed some.
 */
function searchedText(result: TradeSearchResult): string | null {
  const c = result.counts;
  if (!c.screened) return null;
  const total = result.timings.total;
  const time = typeof total === "number" && Number.isFinite(total) ? ` That took ${secondsText(total)}.` : "";
  const shown = c.simShown && config.simulation.shownSims > config.simulation.finalSims ? ` and ${fmtWhole(config.simulation.shownSims)} times with each idea shown` : "";
  const sims = c.simFinal ? `, and played out your season ${fmtWhole(config.simulation.finalSims)} times with each of the best ${fmtWhole(c.simFinal)}${shown}` : "";
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
  /**
   * The cards' "now or after this week" numbers as they've arrived (Checkpoint 7e, item 4.2: engineClient.ts laterLinesOf), by
   * card key (CardContext.later), and whether every card has its own (FinderView.nowOrLater). Absent or null: none expected
   * (a result without cards, or one the worker posts none for), so no card shows the line.
   */
  later?: { readonly lines: ReadonlyMap<string, LaterNumbers | null>; readonly done: boolean } | null | undefined;
}): FinderView {
  const { result, snapshot } = args;
  const baseline = result.baseline;
  // "Helps both" (Checkpoint 7c; planner reply to Checkpoint 7b, §7): the engine's own list (TradeSearchResult.helpsBoth, ranked
  // from the same finalists with its guards, minimum chance and caps: a re-sort, never a new search), else, for a result
  // without one (a fake), the list's trades that help both (rank.ts helpsBothTrades). The other sorts reorder the Overall list.
  const both = args.sort === "helpsBoth";
  const bothList = result.helpsBoth ?? null;
  const listed = both ? (bothList ? bothList.trades : helpsBothTrades(result.trades)) : sortTrades(result.trades, args.sort);
  // Every evaluation the search made a card of, on either list (a card on both is one evaluation): a Plan B's tags, the notes
  // and whether long-term values are missing read them all, so they're the same in every sort.
  const every = [...new Map([...result.trades, ...(bothList?.trades ?? [])].map((e) => [e.key, e])).values()];
  const knownTags = knownTagsOf(every);
  // The search's one "Helps you" scale (its cards' tooltips and the info line; the mix with long-term values), and the
  // reward its B was weighed by (Checkpoint 7c: the cards' top-N odds line, the words naming the prizes).
  const helpsScale = result.helpsScale ?? null;
  const reward = result.reward ?? null;
  // The partner's line only on the cards that help both teams (planner reply to Checkpoint 7c, answer 3), in every sort.
  const sorted = listed.map((e) =>
    buildTradeCard(e, { snapshot, baseline, reward, lastNflWeek: args.lastNflWeek, knownTags, fantasyCalc: args.fantasyCalc, goal: args.goal, blendOn: args.blendOn, helpsScale, partnerLine: "helpsBoth", later: args.later?.lines }),
  );
  // A Plan B that is also a card of its own says so, with that card's place in this sort (review of track F: the same
  // trade showed twice without a word).
  const place = new Map(sorted.map((c, i) => [c.key, i + 1]));
  const cards = sorted.map((c) => {
    const at = c.planB ? place.get(c.planB.key) : undefined;
    return c.planB && at !== undefined ? { ...c, planB: { ...c.planB, also: planBAlsoText(at) } } : c;
  });
  const sortLabel = SORT_OPTIONS.find((o) => o.value === args.sort)?.label ?? "Overall";
  // Qualified when an idea shown starts from its own "before" (Checkpoint 7e, item 2.1: its card says so, OWN_BEFORE_NOTE).
  const odds = baselineLines(baseline, "finder", reward, cards.some((c) => c.oddsNote !== null || c.planB?.oddsNote));
  // What was left out on purpose: the §10 guards' counts, and under "Helps both" the trades that help both teams but are under
  // the minimum chance (HelpsBothList.byChance) in place of the Overall list's.
  const hidden = hiddenText(both ? { ...result.hidden, byChance: bothList?.byChance ?? 0 } : result.hidden);
  // A lower minimum chance would show more trades that help both (the engine's word; never at Any, nor for a fake's list).
  const lowerWouldAdd = both && bothList?.lowerWouldAdd === true;
  let empty: FinderView["empty"] = null;
  // The search's notes, then each distinct note of the evaluations themselves (TradeDetail.notes), once, worded for the
  // list, then a saved FantasyCalc list standing in (the cards' numbers rest on its values).
  let notes = [...result.notes];
  for (const e of every) {
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
    } else if (both) {
      // No trade helps both teams (the lead's words): a lower minimum chance when it would show some, the Overall list when it
      // has ideas that help me, and what was left out.
      empty = {
        title: HELPS_BOTH_EMPTY_TITLE,
        text: [...(lowerWouldAdd ? [LOWER_MINIMUM_TEXT] : []), ...(result.trades.length ? ["Sort by Overall to see the trade ideas that help you."] : []), ...(hidden ? [hidden] : [])],
      };
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
    helpsInfo: cards.length ? helpsInfoText(snapshot.settings.leagueType, args.fantasyCalc?.available ?? true, !every.some((e) => e.dynMissing), helpsScale, reward) : null,
    helpsScale,
    reward,
    // The pattern note is the Overall list's (search.ts: it names the player its best ideas give), so not under "Helps both".
    pattern: !both && cards.length && result.pattern?.text ? result.pattern.text : null,
    few: !cards.length ? null : both ? helpsBothFewText(cards.length, lowerWouldAdd) : fewText(result),
    cards,
    ...(args.later && cards.length ? { nowOrLater: args.later.done ? ("done" as const) : ("pending" as const) } : {}),
    countText: !cards.length ? "" : both ? `${bothWords(cards.length)}, sorted by ${SORT_OPTIONS.find((o) => o.value === "helps")?.label ?? "Helps you"}.` : `${plural(cards.length, "trade idea")}, sorted by ${sortLabel}.`,
    statusText: !cards.length ? `${empty?.title ?? "No trade ideas right now"}.` : both ? `Found ${bothWords(cards.length)}.` : `Found ${plural(cards.length, "trade idea")}.`,
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
 * "What matters most" before) as the Settings page names its options: "Only the champion" (the default, "title"), "Several
 * prizes" ("prizes"; Checkpoint 7c, planner reply to Checkpoint 7b, §6, in place of "Top finishers too"), "Making the
 * playoffs" ("playoffs").
 */
export const GOAL_LABEL: Readonly<Record<Goal, string>> = { title: "Only the champion", prizes: "Several prizes", playoffs: "Making the playoffs" };

/**
 * What the search's settings let a trade idea be, in one line ("Up to 2 players a side and 1 untouchable."), and the
 * settings that change how ideas are scored when they aren't the default: what the league rewards ("Your league rewards:
 * Several prizes."; Phase 4c's goal; the split isn't repeated) and, in a redraft league, "Protect my trade value".
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
 * exact 1.2 s, simulations 0.5 s and 0.7 s, steps and words 0.2 s). Checkpoint 7e (the shown pass, planner reply to
 * Checkpoint 7d, item 1.1; the review's SHOWN-5): the "rank" stage plays out every idea shown on 20,000 seasons, about a
 * sixth of the whole on Parker's league (week 6, his prizes; Node: context 0.55 s, screening 2.1 s, exact 1.5 s,
 * simulations 0.7 s and 0.95 s, the ranking with the shown pass 1.2 s: 8%, 30%, 21%, 9%, 14% and 17%; his 12-team league
 * 12%, 26%, 19%, 12%, 16% and 16%), where its 4% had left the bar at 96–99% for over a second. Checkpoint 7f (planner reply
 * to Checkpoint 7e, answer 2): each idea's run on the shown block continues its ranking run, so the "rank" stage is about an
 * eighth (Node, Oct 14 dumps: context 0.50 s, screening 2.19 s, exact 1.54 s, simulations 0.68 s and 0.98 s, the ranking
 * with the shown pass 0.93 s on his first league: 7%, 32%, 23%, 10%, 14% and 14%; his 12-team league 11%, 27%, 19%, 12%, 17%
 * and 13%), and the two simulation stages take what it gave up.
 */
const STAGE_WEIGHT: Record<TradeSearchStage, number> = { setup: 0.07, screening: 0.36, exact: 0.2, simScreen: 0.1, simFinal: 0.14, rank: 0.13 };

/** Each stage in plain words. */
export const STAGE_LABEL: Record<TradeSearchStage, string> = {
  setup: "Getting your league ready",
  screening: "Screening trade ideas",
  exact: "Checking the best ideas closely",
  simScreen: "Playing out your season with each idea",
  simFinal: `Playing out the best ideas ${fmtWhole(config.simulation.finalSims)} times`,
  rank: "Ranking the trade ideas",
};

/**
 * The "rank" stage while it plays out the ideas the lists show on the shown block (Checkpoint 7e; TradeSearchProgress.part
 * "shown": search.ts, "The shown pass"): the seasons config.simulation.shownSims, never fewer than the ranking block's.
 */
export const SHOWN_PASS_LABEL = `Playing out the ideas you'll see ${fmtWhole(Math.max(config.simulation.finalSims, config.simulation.shownSims))} times`;

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
 * re-filter that had to search afresh (any other stage), the stages by STAGE_WEIGHT. The "rank" stage reads
 * SHOWN_PASS_LABEL while it plays out the ideas shown (TradeSearchProgress.part "shown", Checkpoint 7e), else its own label.
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
  const label = stage === "rank" && p?.part === "shown" ? SHOWN_PASS_LABEL : STAGE_LABEL[stage];
  return { label, detail, percent, valueText: detail ? `${label}: ${detail}` : label };
}

// ---------------------------------------------------------------------------------------------
// Links between the pages (a team id and player ids only)

/** The Trade Finder, for one partner or every team. */
export function finderHref(partnerId: string | null): string {
  return partnerId ? `${FINDER_PATH}?${new URLSearchParams({ partner: partnerId }).toString()}` : FINDER_PATH;
}

/**
 * Where an Analyzer trade came from, when that changes how it's shown: "planB", a card's Plan B, "If they won't move: try …" (the
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

/**
 * The Analyzer's note for a trade opened from "If they won't move: try …" (buildAnalysisView): shown as one offer, without
 * "How to offer it" (Checkpoint 7e: its first offer would ask for more than the trade they had just turned down).
 */
export const FROM_PLAN_B_NOTE = `You opened this from “${PLAN_B_HEADING}” on a trade idea, so it's shown as one offer, without offers to try before it: they've just turned down a trade with the same team.`;

// A trade's key read back into a proposal, for naming a recorded version the card no longer shows (CardFeedback.versionWords):
// feedbackStore.ts proposalFromKey since Checkpoint 7d (the export reads a version's players from its key too); re-exported
// here, where feedbackShare.ts and the tests read it.
export { proposalFromKey };

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
  /** The reward the evaluation weighed B by (TradeAnalysis.reward; Checkpoint 7c), for "How to read" as FinderView.reward; null when it has none. */
  reward: Pick<Reward, "goal" | "shares"> | null;
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
 * the evaluation's own scale (TradeAnalysis.helpsScale). `from` "planB" (a trade opened from a card's Plan B, "If they
 * won't move: try …", shown without "How to offer it": CardContext.offers "none") says so first among the notes, with a card; a
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
  // The evaluation's "Helps you" scale (the tooltip, the info line and Details follow the mix with long-term values), and
  // the reward it was scored under (Checkpoint 7c: the card's top-N odds line, the words naming the prizes).
  const helpsScale = analysis.helpsScale ?? null;
  const reward = analysis.reward ?? null;
  // The card's own odds note isn't needed here: the line above it gives the trade's own "before" (Checkpoint 7e, item 2.1).
  const built =
    analysis.evaluation && !analysis.illegal
      ? buildTradeCard(analysis.evaluation, { snapshot, baseline, reward, lastNflWeek, fantasyCalc: opts.fantasyCalc, goal: opts.goal, blendOn: opts.blendOn, details: true, helpsScale, partnerLine: "always", offers: opts.from === "planB" ? "none" : "analyzer" })
      : null;
  const card = built ? { ...built, oddsNote: null } : null;
  // The trade's own "before" when it has either-way moves (Checkpoint 7e, item 2.1), the one its card's odds start from.
  const own = card ? (analysis.evaluation?.before ?? null) : null;
  const odds = card ? baselineLines(own ?? baseline, "analyzer", reward, own !== null) : null;
  // A note the card's reasons already say isn't said twice.
  const said = new Set(card?.reasons ?? []);
  const notes = [...new Set(analysis.notes)].filter((n) => !said.has(n));
  const fcNote = card ? opts.fantasyCalc?.note : null;
  if (fcNote && !notes.includes(fcNote)) notes.push(fcNote);
  return {
    baseline: odds?.text ?? null,
    baselineNote: odds?.note ?? null,
    // Long-term values counted unless the engine says they're missing (TradeEvaluation.dynMissing).
    helpsInfo: card ? helpsInfoText(snapshot.settings.leagueType, opts.fantasyCalc?.available ?? true, !card.evaluation.dynMissing, helpsScale, reward) : null,
    helpsScale,
    reward,
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
 * the box shown now; the Analyzer's card for the same trade said nothing). Checkpoint 7e (planner reply to Checkpoint 7d,
 * item 4.1): an offer of "How to offer it" the card doesn't show right now (its offers aren't open since the page loaded,
 * or were worked out again) reads by its place and its players, which say what was sent: "Open with: Puka Nacua for Drake
 * London and Chris Olave" (⚠️ ours: never "an earlier one", which would read as if the card had changed).
 */
export function versionLine(feedback: Pick<CardFeedback, "outcome" | "version" | "versionKey" | "versionWords">, versions: readonly VersionChoice[]): string | null {
  if (!feedback.outcome || feedback.version === null) return null;
  const key = feedback.versionKey;
  const shown = key !== null ? versions.find((v) => v.key === key) : versions.length > 1 ? versions.find((v) => v.version === feedback.version) : undefined;
  if (shown) return versions.length > 1 ? shown.label : null;
  if (key === null) return null;
  const v = feedback.version;
  const place = v === "open" || v === "then" || v === "last" ? OFFER_STEP_LABEL[v] : null;
  if (place && feedback.versionWords) return `${place}: ${feedback.versionWords}`;
  return feedback.versionWords ? `an earlier one (${feedback.versionWords})` : "an earlier one";
}
