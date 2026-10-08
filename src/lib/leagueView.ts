/**
 * League page view model (CLAUDE.md §14 item 3): the standings with each team's playoff, bye and title
 * odds and my remaining schedule (§8), the team table with need and trade-chip chips, the positional
 * strength heatmap, best trade partners (§7), roster tables with each team's free-agent pickups and
 * each player's rest-of-season points and week-by-week breakdown (§6 step 7), the best free agents,
 * values (§9) and "how these numbers work". A PURE function from the snapshot, the computed
 * LeagueModel and its model inputs, so the page only lays things out and every word and number is
 * unit-tested. The time zone and "now" are passed in (no clock reads here).
 *
 * Standings and odds (§8; §17 Checkpoint 3: "next to the current standings"): their own table, in
 * today's standings order by the league's rules (TeamOdds.rank), apart from the team table, which is
 * ranked by projected points per week and carries the chips: one table with both orders and every
 * column wouldn't fit a phone. Playoff and bye odds print as whole percents; "0%" and "100%" only when certain, "<1%"
 * and ">99%" when they merely round there (oddsCell), "—" when unknown; title odds with one decimal (titleCell, below:
 * "<0.1%" and ">99.9%" when they merely round to 0 or 100). The Playoffs column needs 2+
 * playoff teams and the Bye column byes with known odds (oddsShown); the caption and the explainer name
 * only the odds shown. A points-only league is ranked by points for, so they show on phones there (and
 * the record doesn't). When my team is certainly out in a redraft league, the page says "Your season's
 * over — no trade helps this year." (§8), and the Trade partners card offers no partners (it says why); since Checkpoint 7c
 * only when no prize the league pays can still move (seasonOver: under "Several prizes" a weekly high score or the points
 * title can still be won after the title race is lost; planner reply to Checkpoint 7b, §6, the lead's reading).
 *
 * One baseline everywhere (Phase 4c; planner reply to Checkpoint 4b, change 9): the odds are LeagueModel.odds, every
 * team after the free-agent pickups that would help it (V*(T), one free agent per team: TeamModel.scoreWithPickups),
 * the trade search's own baseline, so the League page and every trade idea's "before" agree. My odds lead the card
 * ("Your odds: 59% playoffs · 9.9% title", printed as the trade ideas print my odds before them: StandingsView.mine),
 * with the same as rosters stand (LeagueModel.oddsAsRostersStand: no team's pickups) as a smaller second line, and a
 * line says what the odds count (StandingsView.basis). Checkpoint 7c (planner reply to Checkpoint 7b, §6): under "Several
 * prizes" paying 3rd place (else 2nd) both lines add my chance of a top-3 (top-2) finish, "Your odds: 60% playoffs · 30% top
 * 3 · 10.5% title" (myOddsOf), and "Playoff odds" in "How these numbers work" says how 2nd and 3rd place are decided
 * (placesWords). While a week is under way they count pickups only from the next
 * week: the engine plays the week under way with today's rosters (league.ts "Game days": each team's scoreWithPickups keeps
 * its score as it stands that week). That's the model's rule, not the platforms': a free agent whose game hasn't started
 * can still be picked up and started (review of track UIP), so the odds' notes, the schedule's note and the explainer say
 * what the model does, never why a pickup couldn't play (pickupsUnderWayNote). A model built before Phase 4c has none of
 * this: its odds are as rosters stand, so there's no second line and no basis line.
 *
 * My remaining schedule (§8 "show each remaining week's risk"): each remaining regular-season week the
 * simulation plays (SeasonOdds.weekly): the opponent, both teams' projected points (the means the odds draw
 * around: TeamModel.scoreWithPickups, else TeamModel.score in a model built before Phase 4c; for a week in
 * progress, the whole week as if none of its games had started, with today's rosters), my win chance (and the median
 * game's), and my likely starters on bye. Likely starters are the trade cards' own (evaluate.ts riskyWeeksOf, whose
 * "Covers your risky week N" must name the weeks this page flags; review of track UIP): each week team numbers count, my
 * best lineup (the engine's exact solver) from each player's projected points that week, on my active roster after my
 * free-agent pickups (rosterAfterPickups: TeamModel.faMoves applied in order, the optimizer's own roster V*(T), the one
 * the odds and points beside them count) with my IR returners and a streaming row for each position I stream (the
 * streaming replacement that week, so a rostered kicker or D/ST the streamer outscores isn't one); a likely starter is
 * in it in at least half of the counted weeks he plays (teamValue.evStarter's rule), and a returner's bye counts only from
 * his expected return week (availability.expectedReturnWeek). ⚠️ A likely starter at a position I stream is never counted
 * (nor listed) on bye (Phase 4c lead decision on the review of track UIP's design question, the same rule as
 * riskyWeeksOf): his slot's streaming row starts that week's streaming replacement when he's off, so his bye is no crunch
 * (Parker's kicker had been the 4th of week 13's four); the note says so. scheduleByeRule holds this bye rule, and the
 * league report's remaining schedule reads it there too (scripts/league-report.ts; review POL-1: it had kept its own copy,
 * which still counted the kicker, from the roster as it stood). A player the engine releases from a returner's week to
 * make room (league.ts step 5b; TeamModel.displacedWithPickups) is off the page's roster from that week too (review of the
 * engine track, Phase 7b: he used to stay, since the model didn't say who, and with the automatic playoff weight a player
 * his release lets start counted on the cards' side only; ⚠️ a model built before Phase 7b still doesn't say). A week is
 * flagged risky in words when my win chance is under RISKY_WIN_CHANCE (as printed) or RISKY_BYES or more likely starters
 * are off in a week that counts (both from config.leaguePage): a fantasy bye week without a median game can't change the standings (its Win cell says "no
 * game"). A multi-week matchup whose first weeks are already played says its numbers cover only the weeks still to play
 * (the simulation doesn't read the points scored).
 *
 * Team points shown here are plain projected lineup points (Σ LV over the weeks team numbers count).
 * The engine's ROS(T) weights playoff weeks by the League model's playoff weight for trade math (LeagueModel.playoffWeight:
 * set automatically from my odds under my goal since the planner's reply to Checkpoint 7a, §6.1, else the fallback
 * config.lineups.playoffWeight); "Lineup cost" (MV_lose, §7) and trade chips' gaps keep that weighting, so the page calls
 * them "lineup pts", never "ROS pts", says how playoff weeks count ("(playoffs count 2.0×)": one decimal, as the Settings
 * page prints it, playoffWeightLabel; ⚠️ not said when it prints "1.0"), and the explainer spells it out with where the
 * weight comes from (LeagueModel.playoffWeightAuto.basis), never that playoff weeks matter more: ω can be below 1 (a point
 * in a playoff week can move my odds less than one in a regular-season week). The free-agent pickups' gains don't (planner
 * reply to Checkpoint 7b, Q6: "show one number, the unweighted one, in both places"): below.
 *
 * Free-agent pickups (§7 V*; planner reply to Checkpoint 3, model change 2; Phase 4 lead decision L3): each roster
 * lists the moves the free-agent optimizer makes for its team (TeamModel.faMoves, in order; never a kicker or a
 * D/ST), each with what it adds in the lineups the optimizer picks moves by: with injuries and byes simulated when it
 * judges in scenario lineups (scenarios ran and no starter limits bind: optimizer.ts "Judging moves in scenario lineups"),
 * else on projected (expected-value) lineups. Since the planner's reply to Checkpoint 7b, Q6, that gain counts each week
 * once (FaMove.gainScenPlain, else gainEvPlain), lineup points with no "(playoffs count N×)": for a team's first pickup,
 * the number Waiver upgrades shows for the same pickup and drop from the roster as it stands (waivers.ts), where until
 * then the page showed the optimizer's own gain, playoff weeks weighted by ω ("+4.1" here, "+3.3" there for Parker's
 * pickup). ⚠️ A later pickup's gain is counted after the pickups above it (the optimizer's order), where Waiver upgrades
 * prices each pickup alone, so the two can differ (review of Q6): its title says "after the pickups above it" and the
 * explainer says why (pickupsExplainText). The optimizer still
 * picks and keeps moves by the weighted gain, at least LeagueModel.lineupThresholds.faMinGain (config.freeAgentOptimizer.
 * faMinGain × Σω ÷ Σω₀; ⚠️ but for a pickup that drops a less valuable player in a near-tie, which can add up to
 * config.lineups.dropNearTieWeekly a week less: optimizer.ts's header), so a gain shown can be under that bar, and the
 * explainer names the bar's weighting (pickupsExplainText). The list reads in the optimizer's order. The title gives the
 * other lineups' number too when there is one (review of Phase 4: the page showed the expected-value gains, "+1 lineup
 * pts" under a stated minimum of 3, and in an order the optimizer didn't pick them in, since a depth pickup adds little to
 * expected-value lineups). The roster's summary line, shown while it's collapsed, gives their count and total. Lineup
 * costs, trade chips and partners are all measured from the team after these pickups, and the explainer says so, in the
 * same lineups.
 *
 * Trade chips (§7; planner reply to Checkpoint 2, answer 2) replaced Phase 2's surplus chips: a chip
 * reads "C. McCaffrey: worth +33 to Team 2 · costs you 6.1 pts/wk" (his gap: what Team 2 would gain minus
 * what his team would lose, in lineup points; then what his own team loses per week: planner reply to
 * Checkpoint 3, answer 3), "costs his team" on another team's row (not "them", which would read as the team
 * just named: review of track A1), with a visible "starter" tag when he starts for his own team after its
 * free-agent pickups, and its title gives every part in words (and says when those pickups would drop him
 * anyway). Partner cards list each side's chips by what they'd add
 * per week, the first chipsShown and a count of the rest. A player whose ESPN return date conflicts with
 * his tag (§6 step 3, PlayerModel.availabilityNote) says which signal his numbers follow.
 *
 * "Harder to get" (planner addendum to Checkpoint 3, §2; lead decision N2): managers value their own best players a
 * bit above market (the star premium, TeamModel.premiums), so another team's player whose premium for his owner is at
 * least config.acceptance.starPremium.harderToGetMin (a top-12 player who is also his team's #1 or #2 by trade value)
 * carries a visible "Harder to get" tag, in words, never color alone: in his roster table, on his trade chip, and on
 * the partner cards. ⚠️ Never on my own players, where it would read as advice about them. A partner card leads with
 * "Best of their trade chips: <the best untagged trade chip of theirs who'd start for me>, +3.1/wk" (planner reply to
 * Checkpoint 4, change 6: it read "Best target", which sounded like the Trade Finder's pick) when he adds at least
 * config.needs.bestTargetMin points a week (lead decision N12, ⚠️ ours: a review found "+0.1/wk" leading next to
 * "+7.2/wk") and, when the single best one is tagged, "Bigger upgrade, harder to get: <him>, +7.5/wk" second, or alone
 * as "Best of their trade chips, harder to get" when no untagged one adds that much (⚠️ "bigger" would compare with
 * nothing); the rest follow as "They could also give" ("They could give" when nobody leads). ⚠️ What a player adds is
 * judged as the card prints it (one decimal), like the risky week: "+1/wk" meets a floor of 1, "+0/wk" leads nothing,
 * and "bigger" is bigger on the card. A model built before the addendum has no premiums: nobody is tagged, so a card's
 * lead is simply its best chip when he clears the floor, and the explainer leaves "Harder to get" out. Each card ends
 * with "See trade ideas with <team> →" (change 6), the one-partner Trade Finder (/trades?partner=<team id>): the
 * trades it ranks can differ from the chips a card leads with.
 *
 * One free agent, one team (§7; planner reply to Checkpoint 4, change 3; LeagueModel.faAllocation): the free agents
 * the rosters' pickups take go to one team each, in the league's waiver order, in FAAB order, or, when neither was
 * available, the team that gains the most first; the lines above the rosters say so, where my team picks, and which
 * order was used (LeagueView.pickupsNote; Phase 4c, planner reply to Checkpoint 4b, change 5: "Waiver order used:
 * Weekly reset (reverse standings)", the Import Report's own row, importReport.ts waiverOrderText, so the two pages
 * can't word it differently), and the "Free-agent pickups" explainer says it too. ⚠️ "Wasn't available", not "isn't
 * reported" (review of track F): an import saved before the adapters read ESPN's waiver order has none, though the league
 * reports it. A model built before Phase 4b has no allocation: no line, and the explainer keeps saying each team is
 * measured alone. Phase 7a (planner reply to Checkpoint 4c, A4): a team the engine treats as inactive (no transactions in
 * config.allocation.inactiveWeeks weeks, never mine: acceptance.inactiveTeams on the same snapshot, the Import Report's
 * "Inactive teams" row too) makes no pickups, and its roster says so (RosterCard.inactive); the explainer states the rule
 * (and, when the league's transactions can't tell, that no team is assumed inactive: acceptance.inactiveRuleBlock); where
 * my team picks counts only the teams expected to make pickups (review of track AL, finding AL-3); and "Streaming" names
 * an inactive team that made a streamer's adds as assumed to have stopped (finding AL-2).
 *
 * Streaming (§7 streaming positions; planner reply to Checkpoint 3, model change 1): "Streaming picks this
 * week" lists the best free-agent kickers and D/STs for the current week with their opponents
 * (LeagueModel.streaming.picks), says which positions I stream (my setting) and which other teams stream
 * (their adds), and how a streamed slot counts (where a flex of the lineup takes a streamed QB or TE, that
 * the replacement can start there too: the engine counts him as one more player that week); each roster says
 * what its team streams. Lineup points are labeled with the model's playoff weight (LeagueModel.playoffWeight, set
 * automatically: above).
 *
 * The market blend (§6 step 8; planner reply to Checkpoint 4, change 1): a player whose projection the engine pulled
 * toward the trade market (PlayerModel.blend) says which way, in words, at the top of his breakdown (how the lean works
 * under it, visible so phones see it too) and of his ROS hover text (blendText): "His projection leans up toward the trade
 * market's view." Phase 4c (planner reply to Checkpoint 4b, change 4): the market moves a projection at most
 * config.marketBlend.factorClamp's bounds (35% up, 25% down), so a capped player's line says so ("…, by the most it can:
 * 35%."; PlayerBlend.clamped), and so does the explainer, whose "Projected points" says which positions were blended, how
 * far, per game, and in a dynasty league that the blend reads this season's values, not the dynasty values Offer Sheet uses
 * for long-term worth (review of track A). Planner reply to Checkpoint 7a, 5.4 (review of Phase 7b): no number of the
 * market's. Until Phase 7b the line read "Our projection 210 · Trade market 170 · Used 190" ("Trade market": his ROS at the
 * points per game his trade value implies, which rises with his FantasyCalc value, so it gave away FantasyCalc's order and
 * a price for each player), a capped player's title what the uncapped blend "would be", and a player at either end of his
 * position's value range "Trade market: no comparison (top value at his position)". With his ROS (= Used) in the table and
 * the weight in the explainer, even "Our projection" alone gives the market's number back (2 × Used − ours), so the line
 * says the direction only; a move the printed ROS doesn't show, the end-of-range players' none among them (their market
 * number is their own: blendIsOwnPoint), reads "The trade market barely moves his projection."
 *
 * FantasyCalc's fallbacks (Phase 4c; planner reply to Checkpoint 4b, change 12; MarketInputs.fallback). A saved list
 * standing in (kind "saved": FantasyCalc didn't answer, the list is at most config.market.fantasyCalcStaleDays old) is
 * dated next to the header's values credit ("Trade values from Sep 27: FantasyCalc didn't answer.", market.ts
 * fantasyCalcFallbackText, the model inputs' own note, so the notes don't repeat it). The model's own value curve (kind
 * "curve": every value is our estimate, off a curve fitted to an older list) is a banner at the top of the page
 * (LeagueView.valuesBanner: the same words, in place of the inputs' FANTASYCALC_VALUES_ESTIMATED warning), the
 * header's values line says every value is our estimate, and the values' hover and the explainer stop saying an estimate
 * is for a player FantasyCalc doesn't value.
 *
 * Game days (LeagueModel.inProgressWeek; CLAUDE.md §7, Phase 2 review decisions): once a game of the
 * current week has kicked off, the team numbers (Proj/wk, team ROS points, strength, needs, lineup
 * costs, the free-agent pickups, trade chips, partners) skip that week, as the engine's do. The header, the
 * team table and the heatmap say which weeks they count, and a player's row for a game already under way
 * shows "—" and "Game already started" (not a 0% chance to play).
 *
 * Title odds print with one decimal everywhere on the page (titleCell: the headline and the table's Title column alike,
 * as every trade idea prints my odds before it; review of track UIP: the headline read "9.9%" over my row's "10%"); the
 * playoff and bye odds in whole percents (oddsCell), as the cards print playoff odds.
 */
import { inactiveRuleBlock, inactiveTeams } from "@/engine/acceptance";
import { expectedReturnWeek } from "@/engine/availability";
import { config } from "@/engine/config";
import type { FantasyCalcFormat, MarketInputs, ModelInputs } from "@/engine/inputs";
import type {
  AvailabilityNote,
  FaMove,
  LeagueModel,
  LineupValues,
  PlayerModel,
  PlayerPremium,
  SeasonOdds,
  SlotStrength,
  TeamModel,
  TeamOdds,
  TradePartner,
  WeekOdds,
} from "@/engine/leagueModel";
import { prepareLeagueSlots, solveLineup, type LineupPlayer } from "@/engine/lineup";
import { fantasyCalcFallbackText, fantasyCalcFormat, fantasyCalcFormatLabel, noteDay } from "@/engine/market";
import { POSITIONS, type InjuryStatus, type LeagueSettings, type LeagueSnapshot, type Platform, type PlayerInfo, type Pos, type Team } from "@/engine/model";
import { TITLE_ONLY, prizeStillMovable, type Reward } from "@/engine/reward";
import { DIVISION_RULE_ASSUMED, weekList, weekUnderWayNote } from "@/engine/season";
import { fmtNum, fmtSigned, fmtWhole, formatShortDateTime, plural, recordText } from "./format";
import { allocationBasis, inactiveWindowText, waiverOrderText } from "./importReport";
import { INJURY_LABEL, PLATFORM_LABEL, posLabel } from "./labels";
import type { MyTeamSource } from "./myTeam";
import { buildDataNotices } from "./notices";
import { HARDER_TO_GET_TAG, finderHref, harderToGetWho, premiumReasons, titleOddsText, topChance, topPlacesOf } from "./tradeView";

/** The "Harder to get" tag's words and reasons are shared with the trade cards (src/lib/tradeView.ts). */
export { HARDER_TO_GET_TAG, premiumReasons };

/** Free agents listed per startable position (a display choice, not a model number). */
export const FREE_AGENTS_SHOWN = 5;

/** My remaining schedule flags a week as risky below this win chance, as printed (config.leaguePage.riskyWinChance). */
export const RISKY_WIN_CHANCE: number = config.leaguePage.riskyWinChance;
/** …or when this many of my likely starters are on bye that week (config.leaguePage.riskyByes). */
export const RISKY_BYES: number = config.leaguePage.riskyByes;

/**
 * CLAUDE.md §8, word for word: my team is certainly out of the title race in a redraft league, and (Checkpoint 7c) no prize
 * the league pays can still move (seasonOver).
 */
export const SEASON_OVER_TEXT = "Your season's over — no trade helps this year.";
/** The Trade partners card then: no trade helps, so it offers no partners either. */
export const SEASON_OVER_PARTNERS_TEXT = "Your season's over, so no trade partner can help this year.";

/**
 * Whether my season's over for the page's messages (SEASON_OVER_TEXT, the partner cards it hides; src/lib/waiversView.ts's
 * WAIVERS_SEASON_OVER): my team certainly out of the title race in the headline's odds (TeamOdds.eliminated, LeagueModel.odds)
 * and no prize the League model's reward pays still within a trade's reach (reward.ts prizeStillMovable, the trade search's
 * own stop: planner reply to Checkpoint 7b, §6 and the lead's for Checkpoint 7c: a weekly high score or the points title can
 * still be won after the title race is lost; final review of Checkpoint 7c, ui-UI-7C-1: and so can 3rd place after a lost
 * semifinal, in the 3rd-place game). A model built before Checkpoint 7c has no reward: 1st place paying everything, so out of
 * the title race is out of it all, as before. Redraft leagues only (§8: dynasty and keeper teams still trade for later
 * seasons). False without odds or without my team in them.
 * `weekUnderWay` (Waiver upgrades; review of the prizes UI, prizes-ui-5): a pickup, unlike a trade, can still change a
 * regular-season week under way through its games still to play (the "This week" list), so that week counts as a prize
 * period and a regular-season week left (SeasonOdds.regularLeft leaves it out: every trade holds it as rosters stand). ⚠️ The
 * 3rd-place game's week under way counts for neither (SeasonOdds.playoffLeft leaves it out too): no trade can change it, and
 * a "This week" list exists only while a week is left after it (src/engine/waivers.ts), which then keeps the season going.
 */
export function seasonOver(
  model: Pick<LeagueModel, "odds"> & { reward?: Pick<Reward, "shares"> | undefined },
  myTeamId: string | null,
  leagueType: LeagueSettings["leagueType"],
  opts: { weekUnderWay?: boolean } = {},
): boolean {
  const odds = model.odds ?? null;
  const mine = myTeamId && odds ? odds.teams.find((t) => t.teamId === myTeamId) : undefined;
  if (!odds || !mine || leagueType !== "redraft") return false;
  // Only whether any is left matters (prizeStillMovable), so the week under way's period counts once at least (a later week
  // of a multi-week period already counts it). Odds made before Checkpoint 7c have no counts: left as they are (unknown).
  const left = opts.weekUnderWay && odds.regularLeft ? { periods: Math.max(1, odds.regularLeft.periods), weeks: odds.regularLeft.weeks + 1 } : odds.regularLeft;
  return !prizeStillMovable(model.reward ?? { shares: TITLE_ONLY }, { playoffTeams: odds.playoffTeams, regularLeft: left, playoffLeft: odds.playoffLeft }, mine);
}

/**
 * A week in progress in my remaining schedule: its points and chances are the simulator's, which plays the
 * whole week from projections as if none of its games had started (season.ts weekUnderWayNote says it in
 * full, with the rosters and injury news being today's).
 */
export const UNDER_WAY_TEXT = "Under way: projected as if no game had started (live scores aren't read)";

/** The standings card's headline (the file header, "One baseline everywhere"): my odds, every team after its pickups (LeagueModel.odds). */
export const YOUR_ODDS_LABEL = "Your odds";
/** …and its smaller second line: the same with every team as it stands (LeagueModel.oddsAsRostersStand). */
export const AS_ROSTERS_STAND_LABEL = "As rosters stand";
/** What the odds count (StandingsView.basis): the same baseline as every trade idea's "before". */
export const ODDS_BASIS_TEXT = "These odds count the free-agent pickups that would help each team (listed on its roster): trade ideas start from the same odds.";

/**
 * The odds' note while a week is under way (league.ts "Game days"; review of track EV): the odds count free-agent pickups
 * only from the next week, and play the week under way with today's rosters. That's what the model does, not a platform
 * rule (a free agent whose game hasn't started can still be picked up and started), so it's said that way (review of
 * track UIP: it read "one made now can't play in week 4"). `next`: the first week the team numbers count (none when the
 * week under way is the last one).
 */
export function pickupsUnderWayNote(week: number, next: number | undefined): string {
  if (next === undefined) return `Week ${week} is under way and it's the last week, so these odds play it with today's rosters, without free-agent pickups.`;
  return `While week ${week} is under way, these odds count free-agent pickups from week ${next} on: week ${week} is played with today's rosters.`;
}

/** The label of the line above the rosters that names the order free agents went out in: the Import Report's row (importReport.ts waiverOrderText). */
export const WAIVER_ORDER_LABEL = "Waiver order used";

/** FantasyCalc's curve fallback (the file header): the banner's title (its words are market.ts fantasyCalcFallbackText's)… */
export const VALUES_ESTIMATED_TITLE = "FantasyCalc is unavailable";
/** …and what the header's values line adds (no value is shown, planner reply to Checkpoint 7a, 5.4: it says what they are). */
export const VALUES_ESTIMATED_LINE = "Trade values are our own estimates for now.";
/** The model inputs' warning for the curve fallback (src/server/modelInputs.ts): the page shows it as the banner instead. */
const VALUES_ESTIMATED_CODE = "FANTASYCALC_VALUES_ESTIMATED";
/**
 * What the "Trade values" explainer says about showing them (planner reply to Checkpoint 7a, 5.4: Offer Sheet doesn't
 * display FantasyCalc's values at all; the privacy policy's words: "uses in its own numbers but never shows").
 */
export const VALUES_HIDDEN_TEXT = "Offer Sheet uses them in its own numbers (the chance a manager accepts a trade, Helps you, and how far projections lean toward the trade market) but never shows them.";
/** The same in FantasyCalc's curve fallback, where only the chance they accept reads trade value (no Helps you part, no blend). */
export const VALUES_HIDDEN_ESTIMATED_TEXT = "Offer Sheet uses them in the chance a manager accepts a trade but never shows them.";

export type StrengthWindow = "ros" | "next";
export type HeatStep = "strong" | "above" | "average" | "below" | "weak";
export type InjuryTone = "muted" | "warn" | "danger";

export const HEAT_STEPS: readonly HeatStep[] = ["strong", "above", "average", "below", "weak"];
export const HEAT_STEP_LABEL: Record<HeatStep, string> = {
  strong: "Strong",
  above: "Above average",
  average: "Average",
  below: "Below average",
  weak: "Weak",
};

/** A short visible tag: "starter" (a trade chip who starts for his own team) or "Harder to get" (HARDER_TO_GET_TAG). */
export interface ChipTag {
  text: string;
  kind: "starter" | "harder";
}

export interface Chip {
  key: string;
  text: string;
  /** Hover and screen-reader detail. */
  title: string;
  kind: "need-ros" | "need-next" | "chip";
  /** Short visible tags inside the chip, in this order: "starter", then "Harder to get" (another team's player). The title says each in words. */
  tags: ChipTag[];
}

/** "Harder to get" on another team's player (the file header): the visible words, and why in a sentence (hover). */
export interface HarderToGet {
  text: string;
  title: string;
}

export interface TeamRow {
  id: string;
  rank: number;
  name: string;
  isMine: boolean;
  record: string;
  pointsFor: string;
  /** Projected starting-lineup points per week (the rank key); null when no weeks remain. */
  perWeek: number | null;
  perWeekText: string;
  /** Projected starting-lineup points over the weeks team numbers count. */
  rosPoints: number;
  rosText: string;
  needs: Chip[];
  /** The team's best trade chips (§7), at most chipsShown, biggest gap first. */
  chips: Chip[];
}

export interface HeatCell {
  key: string;
  value: number;
  text: string;
  z: number;
  step: HeatStep;
  title: string;
}

export interface HeatRow {
  teamId: string;
  name: string;
  isMine: boolean;
  cells: Record<StrengthWindow, HeatCell[]>;
}

export interface Heatmap {
  columns: { key: string; label: string }[];
  rows: HeatRow[];
  windowLabel: Record<StrengthWindow, string>;
  caption: Record<StrengthWindow, string>;
}

export interface PartnerPlayer {
  id: string;
  text: string;
  title: string;
  /** "Harder to get" on one of their players (never on mine), or null. */
  tag: HarderToGet | null;
}

/** One side of a partner card: the trade chips shown (the first chipsShown, most helpful first), and the rest as a count. */
export interface PartnerSide {
  /** "They could give:", "They could also give:" (after the card's targets) or "You could give:". */
  label: string;
  players: PartnerPlayer[];
  /** "and 2 more": `title` lists the hidden players (hover), `srText` says them for screen readers; null when all are shown. */
  more: { text: string; title: string; srText: string } | null;
}

/**
 * A partner card's lead line (planner addendum to Checkpoint 3, §2; lead decision N12; planner reply to Checkpoint 4,
 * change 6): "Best of their trade chips: C. Snoot, +2.1/wk" (the best of their trade chips who'd start for me without the
 * "Harder to get" tag, when he adds at least config.needs.bestTargetMin a week), or "Bigger upgrade, harder to get: M.
 * Gloop, +2.5/wk" (the single best one, when he's tagged; "Best of their trade chips, harder to get" when no untagged one
 * adds that much).
 */
export interface PartnerTarget {
  id: string;
  /** "Best of their trade chips", "Bigger upgrade, harder to get" or "Best of their trade chips, harder to get". */
  label: string;
  /** "C. Snoot, +2.1/wk"; its two parts, which the card keeps unbroken (a hyphenated name never splits across lines). */
  text: string;
  name: string;
  perWeek: string;
  /** Hover: his full name, what he'd add to my lineup a week, and why he's harder to get when he is. */
  title: string;
  harderToGet: boolean;
}

export interface PartnerCard {
  teamId: string;
  name: string;
  /** false: their trade chips would start for me, but none of mine would start for them (a trade would likely cost me a starter). */
  mutual: boolean;
  /** "Fit 2.4" for a mutual fit; "Would start for you" for a one-sided one (what was measured, whether or not I have needs). */
  fitText: string;
  /**
   * Who to aim for first (PartnerTarget), best first; empty when none of their chips would start for me, or when the
   * single best one isn't tagged and adds less than config.needs.bestTargetMin a week (they're all listed after).
   */
  targets: PartnerTarget[];
  /** Their other trade chips (the targets left out), most helpful first. */
  theyCanGive: PartnerSide;
  youCanGive: PartnerSide;
  /** "See trade ideas with Gravel Gophers" (the card adds an arrow): the one-partner Trade Finder (/trades?partner=<team id>). */
  ideas: { text: string; href: string };
}

export interface WeekRow {
  week: number;
  /** p_{i,w} (§6 step 4); 0 on his bye and once his game has started. */
  points: number;
  pointsText: string;
  availabilityText: string;
  /** Bye, a game already under way, a current injury… */
  note: string | null;
  playoff: boolean;
  /** His game this week has already kicked off: it no longer counts, and the row shows "—" like a bye. */
  started: boolean;
}

export interface PlayerRow {
  id: string;
  name: string;
  pos: string;
  nflTeam: string;
  injury: { short: string; long: string; tone: InjuryTone } | null;
  /**
   * Conflicting ESPN signals (§6 step 3; PlayerModel.availabilityNote): a short line for his row ("ESPN
   * says back wk 8; using Sleeper", "Out until ~wk 8 (ESPN)") and the full sentence for his breakdown
   * and hover. null for everyone whose tag and return date agree.
   */
  availabilityNote: { short: string; long: string } | null;
  /** "Harder to get" (the file header): another team's player his manager would want a little extra for; null on my team and for free agents. */
  tag: HarderToGet | null;
  group: "active" | "ir" | "taxi" | "fa";
  /** Rest-of-season points (§6 step 7); null when the model has no projection for him. */
  ros: number | null;
  rosText: string;
  /** "98 / 32": regular season / playoffs (just the total when the league has no playoff weeks left). */
  splitText: string;
  gamesText: string;
  byeText: string;
  /** MV_lose (§7): lineup points his team loses without him (LeagueView.lineupCostTitle); null off the active roster. */
  lineupCost: string | null;
  /**
   * The market blend (§6 step 8; PlayerModel.blend), for a player it reached (blendText): which way it moved his
   * projection, in words ("His projection leans up toward the trade market's view."), and how the lean works, both shown in
   * his breakdown; never a number of the market's (planner reply to Checkpoint 7a, 5.4). Null for everyone else.
   */
  blend: { text: string; title: string } | null;
  weeks: WeekRow[];
  /** The week-by-week breakdown as plain text (hover), after the conflict note and the market blend's line when he has them. */
  weeksText: string;
}

/** How a team's free-agent pickups are introduced on its roster (CLAUDE.md §14 item 3, Phase 4). */
export const FREE_AGENT_PICKUPS_LABEL = "Free-agent pickups that would help";

/** One free-agent pickup of a team (TeamModel.faMoves), for its roster. */
export interface FreeAgentPickup {
  /** "add Floopy Freeman (RB, CAR), drop Tobias Thimble", or "add Floopy Freeman (RB, CAR) into an open spot". */
  move: string;
  /**
   * "+4.6 lineup pts": what it adds to the starting lineup over the rest of the season in the lineups the optimizer picks
   * moves by (with injuries and byes simulated, or on projected lineups: the file header), each week counted once (planner
   * reply to Checkpoint 7b, Q6: Waiver upgrades' number for the same pickup), not weighted like lineup cost.
   */
  gain: string;
  /**
   * Hover: the move and its gain in words, saying which lineups, with the other lineups' gain too when computed, and, while
   * lineup cost beside it weights the playoff weeks, that this one counts each week once.
   */
  title: string;
}

/** A team's free-agent pickups (§7 V*): the optimizer's moves, in the order it makes them. */
export interface FreeAgentPickups {
  items: FreeAgentPickup[];
  /** The roster's summary line (shown while it's collapsed): "2, +7.1 lineup pts" (how many, and what they add together). */
  summary: string;
  /** Everything in one line: "Free-agent pickups that would help: add …: +4.6 lineup pts; add …: +2.5 lineup pts". */
  text: string;
}

export interface RosterCard {
  teamId: string;
  name: string;
  isMine: boolean;
  summary: string;
  /** "Streams K and D/ST (your setting)" or "Streams K (3 adds this season)" (LeagueModel.streaming), or null when it streams nothing. */
  streams: string | null;
  /** The free-agent pickups that would help the team (§7 V*), or null when none does. */
  pickups: FreeAgentPickups | null;
  /**
   * Phase 7a (planner reply to Checkpoint 4c, A4; the file header): "Inactive: no transactions in the last 5 weeks, so no
   * free-agent pickups are assumed." for a team the engine treats as inactive; null for every other team.
   */
  inactive: string | null;
  players: PlayerRow[];
}

/** One "Streaming picks this week" row (LeagueModel.streaming.picks). */
export interface StreamingPickRow {
  id: string;
  name: string;
  /** His NFL team ("SEA"), "FA" without one. */
  nflTeam: string;
  /** "vs ARI" at home, "@ DAL" away, "—" when unknown; `opponentLong` says it in words for screen readers and hover. */
  opponent: string;
  opponentLong: string;
  /** This week's projected points ("8.2"). */
  projection: string;
}

/** One position's picks: K or D/ST. */
export interface StreamingGroup {
  pos: "K" | "DEF";
  /** "K", "D/ST" (ESPN) or "DEF" (posLabel). */
  label: string;
  /** The table's caption: "Best free-agent kickers for week 4, by this week's projection". */
  caption: string;
  picks: StreamingPickRow[];
}

/**
 * Streaming positions on the League page (CLAUDE.md §7, §14 item 3; planner reply to Checkpoint 3, model
 * change 1): this week's best free agents at K and D/ST, who streams which positions, and how a streamed
 * slot counts.
 */
export interface StreamingView {
  week: number;
  /** One group per position the lineup starts (K, then D/ST), each possibly empty. */
  groups: StreamingGroup[];
  /** What I stream ("You stream K and D/ST."; the page links to Settings after it), or null without a team. */
  mine: string | null;
  /**
   * Which other teams stream, from their adds this season (or that none does), and the inactive teams whose adds would
   * make them streamers, assumed to have stopped (Phase 7a, A4).
   */
  others: string;
  /** How a streamed slot counts, with each streamed position's average replacement. */
  note: string;
  /** Why no picks are listed (no free agent at those positions plays this week), or null. */
  empty: string | null;
}

/** Where the user changes "Positions I stream weekly" (the Settings page). */
export const SETTINGS_HREF = "/settings";

export interface FreeAgentGroup {
  pos: string;
  players: PlayerRow[];
}

export interface ExplainItem {
  title: string;
  text: string;
}

/** A probability as printed (oddsCell): `srText` says a symbolic one in words ("less than 1%"); null when `text` reads fine as it is. */
export interface OddsCell {
  text: string;
  srText: string | null;
}

/** One team in the standings table (§8 odds next to the current standings). */
export interface StandingsRow {
  teamId: string;
  /** Today's standings position by the league's own rules (TeamOdds.rank). */
  rank: number;
  name: string;
  isMine: boolean;
  /** Today's record: "7–4". */
  record: string;
  pointsFor: string;
  /** null when the Playoffs column is hidden (StandingsView.showPlayoffs false). */
  playoffs: OddsCell | null;
  /** null when the Bye column is hidden (StandingsView.showBye false). */
  bye: OddsCell | null;
  /** With one decimal, as the headline and every trade idea print title odds (titleCell). */
  title: OddsCell;
  /** The expected final regular-season record, one decimal ("8.6–5.4", "8.5–4.5–1.0" with ties); null in a points-only league. */
  finalRecord: string | null;
  /** Certainly out of the title race (TeamOdds.eliminated). */
  eliminated: boolean;
}

/** One of my odds in the standings card's headline lines: "59% playoffs", "title unknown". */
export interface OddsPart {
  text: string;
  /** A symbolic one in words for screen readers ("less than 1% playoffs"); null when `text` reads fine as it is. */
  srText: string | null;
}

/**
 * My odds above the standings table (the file header, "One baseline everywhere"; planner reply to Checkpoint 4b, change
 * 9): the headline (LeagueModel.odds: every team after its free-agent pickups, what trade ideas start from) and, smaller,
 * the same as rosters stand (LeagueModel.oddsAsRostersStand). Playoff odds only where the table shows them (2+ playoff
 * teams), then (Checkpoint 7c, under "Several prizes" paying 2nd or 3rd place) a top-N finish, then title odds, printed as
 * trade ideas print my odds before them (oddsPart: playoffs and a top-N finish in whole percents, the title with one
 * decimal).
 */
export interface MyOdds {
  headline: OddsPart[];
  /** Null when the model has no odds as rosters stand (one built before Phase 4c: its odds are as rosters stand). */
  asRostersStand: OddsPart[] | null;
  /** Each line in words: "Your odds: 59% playoffs · 9.9% title", "As rosters stand: 65% playoffs · 12.1% title". */
  text: string;
  asRostersStandText: string | null;
}

export interface StandingsView {
  /** My odds, the card's headline; null without a team (or when my team isn't in the odds). */
  mine: MyOdds | null;
  /** What the odds count (ODDS_BASIS_TEXT, and that "As rosters stand" counts none when that line shows); null in a model built before Phase 4c. */
  basis: string | null;
  /** Today's standings order (rank 1 first); empty when there are no odds (`empty` says so). */
  rows: StandingsRow[];
  /** 2+ teams make the playoffs (oddsShown): with none or one, the title goes to the top of the final standings, and the Title column says it all. */
  showPlayoffs: boolean;
  /** The league has first-round byes and their odds are known. */
  showBye: boolean;
  /**
   * Points-only league: points for decide the standings, so the table shows them on phones too (the record,
   * which counts for nothing there, only on wider screens), and there's no projected final record.
   */
  pointsOnly: boolean;
  caption: string;
  /** SeasonOdds.notes the page doesn't already show as a warning, and, while a week is under way, when the odds count pickups from (pickupsUnderWayNote). */
  notes: string[];
  empty: string | null;
}

/** One remaining regular-season game of mine (§8 "show each remaining week's risk"). */
export interface ScheduleRow {
  /** The week it's listed under (a multi-week game: its first week the simulation plays). */
  week: number;
  /** "13", or "13–14" for a multi-week matchup. */
  weekText: string;
  /** The same for screen readers: "Week 13", "Weeks 13–14". */
  weekLabel: string;
  opponentId: string | null;
  /** The opponent's name, or "Bye week" when there's none. */
  opponent: string;
  /**
   * Projected points over the game's remaining weeks, the means the odds draw around (TeamModel.scoreWithPickups; score
   * in a model built before Phase 4c), so they match the win chance beside them: mine, and theirs (null on a bye).
   */
  mine: string;
  theirs: string | null;
  /** My chance to win the game; on a bye week "—", said as "no game" (not "unknown"). */
  win: OddsCell;
  /** Median-game leagues: my chance to beat the league median that week; null otherwise. */
  median: OddsCell | null;
  /** My likely starters on bye (likelyStarters: after my free-agent pickups; short names, by position), and the same with full names for hover; null when none are. */
  byes: { text: string; title: string; count: number } | null;
  /** In words, never color alone: the badge's label, the short reasons shown beside it, and the full sentence (hover, screen readers). */
  risk: { label: string; reasons: string; text: string } | null;
  /**
   * A game already under way, in words: a multi-week matchup whose first weeks are played (the simulation
   * doesn't read the points they scored, so the row's points, win chance and byes cover only its weeks
   * still to play), and the week in progress (projected as if none of its games had started: live scores
   * aren't read). Null otherwise.
   */
  underWay: string | null;
}

export interface ScheduleView {
  rows: ScheduleRow[];
  showMedian: boolean;
  caption: string;
  /** Under the table: who counts as a likely starter, and when a week is flagged. */
  note: string;
  /** Why there are no rows: no team picked, a points-only league, no games left. */
  empty: string | null;
}

export interface LeagueView {
  header: {
    name: string;
    platformLabel: string;
    season: number;
    /** "Week 4 · as of Wed, Sep 30, 9:08 PM" (the date always, and the year when it isn't this year). */
    weekLine: string;
    /** "Week 12 is under way, so team numbers start with week 13." while the current week is in progress; else null. */
    inProgress: string | null;
    /** Where the base rates came from (model.projection.sources): "Sleeper", "ESPN and Sleeper, averaged", "ESPN"… */
    projections: string;
    /** The FantasyCalc format label, or null when values are unavailable. */
    valuesFormat: string | null;
    /**
     * FantasyCalc's fallback, next to the values credit (the file header): a saved list's date ("Trade values from Sep 27:
     * FantasyCalc didn't answer."), or VALUES_ESTIMATED_LINE when every value is our estimate; null when FantasyCalc answered.
     */
    valuesNote: string | null;
    /** "10 weeks left: 7 regular season, 3 playoffs". */
    weeksLeft: string;
  };
  /**
   * FantasyCalc's curve fallback (the file header): every value is our own estimate. A banner at the top of the page, in
   * place of the model inputs' FANTASYCALC_VALUES_ESTIMATED warning (market.ts fantasyCalcFallbackText's words); null
   * otherwise.
   */
  valuesBanner: { title: string; text: string } | null;
  myTeam: {
    id: string | null;
    name: string | null;
    source: MyTeamSource;
    /** Shown with a link to the Import Report's picker when the team is missing or only guessed. */
    hint: string | null;
  };
  /** SEASON_OVER_TEXT when my team is certainly out of the title race in a redraft league (§8); else null. */
  eliminated: string | null;
  /** Standings with playoff, bye and title odds (§8); null once no week is left (the page says the season is over). */
  standings: StandingsView | null;
  /** My remaining regular-season games and each week's risk (§8); null without odds or once the regular season is over. */
  schedule: ScheduleView | null;
  teams: TeamRow[];
  /** Under the team table: what the ranking counts ("Ranked by projected points per week from week 13 on (week 12 is under way)."). */
  teamsNote: string;
  /** The chip key's words for a trade chip ("trade chip: worth at least 10 more lineup pts to another team than to his own"). */
  chipLegend: string;
  heatmap: Heatmap;
  /** My best trade partners; `empty` says why there are none (no team picked, my redraft season over, no fit). */
  partners: { cards: PartnerCard[]; empty: string | null };
  /**
   * One free agent, one team (LeagueModel.faAllocation; the file header): "Free-agent pickups: each free agent goes to one
   * team only. Your team picks 4th of 10." (with inactive teams in the order, "… 1st of the 3 teams expected to make
   * pickups.") and the order used, the Import Report's row ("Weekly reset (reverse
   * standings)", shown after WAIVER_ORDER_LABEL; null when the Import Report's reading of the snapshot doesn't match the
   * allocation's basis: `text` names the basis then); null without an allocation (an older model) or once no week is left.
   */
  pickupsNote: { text: string; waiverOrder: string | null } | null;
  /** "Streaming picks this week" and who streams what (§7); null once no week is left, or when the lineup starts no K or D/ST and nobody streams. */
  streaming: StreamingView | null;
  rosters: RosterCard[];
  freeAgents: FreeAgentGroup[];
  /** The Lineup cost column's definition (hover), with the playoff weighting when it applies. */
  lineupCostTitle: string;
  explain: ExplainItem[];
  sources: { label: string; value: string }[];
  /**
   * The yellow banner's lines (Phase 7b, planner reply to Checkpoint 7a, §5.1): only the plain-language notices
   * (src/lib/notices.ts buildDataNotices, judged with this League model: players on my roster or likely starters on any),
   * never a code, a path or ID-matching talk; FantasyCalc's curve fallback has its own banner (valuesBanner) instead.
   */
  notices: string[];
  /** The model inputs' notes the page doesn't already show (the values' format and its substitutions are shown once, elsewhere). */
  notes: string[];
  /** The season has no weeks left to project. */
  over: boolean;
  /** Playoff weeks remain, so ROS points are split "regular / playoffs". */
  playoffsLeft: boolean;
}

export interface LeagueViewInput {
  snapshot: LeagueSnapshot;
  model: LeagueModel;
  inputs: ModelInputs;
  /** How "my team" (model.myTeamId) was chosen. */
  myTeamSource: MyTeamSource;
  /** IANA time zone for times (the viewer's own). */
  timeZone: string;
  /** The moment the model was computed for (ISO): a game that kicked off before it is marked. */
  now: string;
}

// ---------------------------------------------------------------------------------------------
// Small helpers

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

const capitalize = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** "a", "a and b", "a, b and c" (or "a, b or c" with `conjunction` "or"). */
function listText(items: readonly string[], conjunction: "and" | "or" = "and"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
}

/** "weeks 13–17", "week 17", or "" for no weeks (a sorted run). */
function weekSpan(weeks: readonly number[]): string {
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  if (first === undefined || last === undefined) return "";
  return first === last ? `week ${first}` : `weeks ${first}–${last}`;
}

const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
/** Words that belong to the last name ("St. Brown", "Van Noy", "De La Cruz"). */
const PARTICLE = /^(st\.?|van|von|vander|der|den|de|da|di|du|del|della|la|le)$/i;

/**
 * "Justin Jefferson" → "J. Jefferson": first initial and last name, suffixes and middle names
 * dropped ("Travis Etienne Jr." → "T. Etienne"), name particles kept ("Amon-Ra St. Brown" →
 * "A. St. Brown"). Team defenses stay as they are.
 */
export function shortName(name: string, pos?: Pos): string {
  const trimmed = name.trim();
  if (pos === "DEF") return trimmed;
  const parts = trimmed.split(/\s+/);
  while (parts.length > 2 && SUFFIX.test(parts[parts.length - 1] ?? "")) parts.pop();
  if (parts.length < 2) return trimmed;
  let start = parts.length - 1;
  while (start > 1 && PARTICLE.test(parts[start - 1] ?? "")) start--;
  return `${(parts[0] ?? "").charAt(0)}. ${parts.slice(start).join(" ")}`;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

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

/**
 * Heatmap step from a strength z-score. The steps are |needZThreshold| wide, so a "below" or "weak"
 * cell is exactly a need (§7: z ≤ needZThreshold).
 */
export function heatStep(z: number, needZThreshold: number = config.lineups.needZThreshold): HeatStep {
  const step = Math.abs(needZThreshold);
  if (z <= -2 * step) return "weak";
  if (z <= -step) return "below";
  if (z >= 2 * step) return "strong";
  if (z >= step) return "above";
  return "average";
}

/** The lineup values the page shows: availability scenarios when computed (§7), else expected-value lineups. */
function lineupOf(team: TeamModel): LineupValues {
  return team.scen ?? team.ev;
}

/**
 * The first index into model.weeks that team numbers count: 1 while the current week is in progress
 * (LeagueModel.inProgressWeek, when it is the first week), else 0. The engine's teamWeeks().from.
 */
function teamFrom(model: LeagueModel): number {
  return model.inProgressWeek !== null && model.weeks.length > 0 && model.weeks[0] === model.inProgressWeek ? 1 : 0;
}

/**
 * Points per week: PPW over the remaining regular season (the engine's, which skips a week in
 * progress); once no regular week is left to count, the average over the playoff weeks left.
 */
function perWeekOf(team: TeamModel, model: LeagueModel, from: number): number | null {
  const lv = lineupOf(team);
  const regular = new Set(model.regularWeeks);
  if (model.weeks.slice(from).some((w) => regular.has(w))) return lv.ppw;
  const rest = lv.lv.slice(from);
  return rest.length ? sum(rest) / rest.length : null;
}

// ---------------------------------------------------------------------------------------------
// Harder to get (planner addendum to Checkpoint 3, §2; the file header)

/** Another team's player's premium for his owner (TeamModel.premiums); never one of mine (the file header). */
function premiumOf(team: TeamModel | undefined, playerId: string, myTeamId: string | null): PlayerPremium | undefined {
  return team && team.id !== myTeamId ? team.premiums?.[playerId] : undefined;
}

/** The League page's "Harder to get" for a player whose premium earns the tag (PlayerPremium.harderToGet), or null. */
function harderToGetTag(premium: PlayerPremium | undefined): HarderToGet | null {
  if (!premium?.harderToGet) return null;
  const why = premiumReasons(premium, "his team's");
  return { text: HARDER_TO_GET_TAG, title: `${HARDER_TO_GET_TAG}: ${why.length ? `${listText(why)}, so his` : "his"} manager will likely want a little extra for him.` };
}

// ---------------------------------------------------------------------------------------------
// Players

interface PlayerContext {
  snapshot: LeagueSnapshot;
  model: LeagueModel;
  inputs: ModelInputs;
  now: number;
  playoffWeeks: ReadonlySet<number>;
  hasPlayoffs: boolean;
  /** My team (other teams' players can carry "Harder to get"; mine never do). */
  myTeamId: string | null;
}

function kickedOff(ctx: PlayerContext, info: PlayerInfo | undefined): boolean {
  const team = info?.nflTeam;
  if (!team) return false;
  const kickoff = ctx.inputs.nfl.kickoffs[ctx.snapshot.currentWeek]?.[team];
  if (!kickoff) return false;
  const t = Date.parse(kickoff);
  return Number.isFinite(t) && t <= ctx.now;
}

const STATUS_WORD: Record<AvailabilityNote["status"], string> = {
  PROBABLE: "probable",
  QUESTIONABLE: "questionable",
  DOUBTFUL: "doubtful",
};

/**
 * Conflicting ESPN signals (§6 step 3): what a player's numbers follow, in a short line and a sentence.
 * A return week after the NFL's last week (inputs.nfl.lastWeek) is ESPN's "out for the season". In his
 * bye week (`byeNow`) Sleeper projects nobody, so the tiebreaker can't be read and the date is followed:
 * the sentence says so. So does it when Sleeper's projections for this week didn't load at all
 * (AvailabilityNote.sleeperUnavailable: the tiebreaker is missing, which isn't Sleeper not projecting him).
 */
export function availabilityNoteText(note: AvailabilityNote, lastNflWeek: number | undefined, byeNow = false): { short: string; long: string } {
  const status = STATUS_WORD[note.status];
  const outForSeason = lastNflWeek !== undefined && Number.isFinite(lastNflWeek) && note.returnWeek > lastNflWeek;
  const date = outForSeason ? "out for the season" : `return week ${note.returnWeek}`;
  if (note.used === "sleeper") {
    return {
      short: outForSeason ? "ESPN says out for the season; using Sleeper" : `ESPN says back wk ${note.returnWeek}; using Sleeper`,
      long: `ESPN: ${status}, ${date} — using Sleeper's projection (${status} this week, then healthy)`,
    };
  }
  const share = pct(config.projections.staleReturnShare);
  const why =
    note.sleeperNow === null
      ? byeNow
        ? "it's his bye week, so Sleeper doesn't project him"
        : note.sleeperUnavailable
          ? "Sleeper's projections for this week didn't load, so there's nothing to break the tie"
          : "Sleeper doesn't project him this week"
      : note.healthyRate === null
        ? "there's no healthy projection to compare Sleeper's with"
        : `Sleeper projects him for only ${fmtNum(note.sleeperNow, 1)} points this week, under ${share} of his healthy ${fmtNum(note.healthyRate, 1)}`;
  return {
    short: outForSeason ? "Out for the season (ESPN)" : `Out until ~wk ${note.returnWeek} (ESPN)`,
    long: `ESPN: ${status}, ${date} — following the return date (${why})`,
  };
}

/**
 * Why a week looks the way it does: his bye, a game already under way, his current injury status, or
 * ESPN's return date he follows (a week he's sure to miss).
 */
function weekNote(info: PlayerInfo | undefined, index: number, w: { a: number; bye: boolean }, started: boolean, followsDate: string | null): string | null {
  if (w.bye) return "Bye";
  if (started) return "Game already started";
  if (followsDate && w.a === 0) return followsDate;
  const label = INJURY_LABEL[info?.injury ?? "ACTIVE"];
  if (label && (index === 0 || w.a === 0)) return label.long;
  if (info && !info.nflTeam) return "No NFL team";
  if (w.a === 0) return "Out";
  return null;
}

function weekRows(ctx: PlayerContext, info: PlayerInfo | undefined, pm: PlayerModel | undefined, followsDate: string | null): WeekRow[] {
  if (!pm) return [];
  return ctx.model.weeks.map((week, i) => {
    const w = pm.weekly[i] ?? { p: 0, a: 0, m: 1, bye: false, sd: 0 };
    // A game under way (or over) this week: the engine counts it 0 (§6 step 3). It isn't a 0% chance
    // he plays, so the row reads like a bye: "—" and the note.
    const started = !w.bye && i === 0 && week === ctx.snapshot.currentWeek && w.a === 0 && kickedOff(ctx, info);
    const blank = w.bye || started;
    return {
      week,
      points: blank ? 0 : w.p,
      pointsText: blank ? "—" : fmtNum(w.p, 1),
      availabilityText: blank ? "—" : pct(w.a),
      note: weekNote(info, i, w, started, followsDate),
      playoff: ctx.playoffWeeks.has(week),
      started,
    };
  });
}

function weeksText(rows: readonly WeekRow[], ...notes: (string | null)[]): string {
  const weeks = rows.map((r) => {
    const detail = r.note === "Bye" ? "bye" : r.started ? "game already started" : `${r.pointsText} pts, ${r.availabilityText}${r.note ? ` · ${r.note}` : ""}`;
    return `Wk ${r.week}${r.playoff ? " (playoffs)" : ""}: ${detail}`;
  });
  return [...notes.filter((n): n is string => n !== null), ...weeks].join("\n");
}

/**
 * Whether the blend's market number is his own projection (blend.ts rule 4: a healthy player at one end of his
 * position's value range, with no other curve point valued at or beyond his on one side, reads the curve with his own
 * point in it, so it says nothing the market knows: his factor is exactly 1). ⚠️ Read from the numbers (PlayerBlend
 * carries no flag): market equal to ours to floating-point precision, which a player read off the curve fitted without
 * him all but never is.
 */
export function blendIsOwnPoint(b: Pick<NonNullable<PlayerModel["blend"]>, "ours" | "market">): boolean {
  return Number.isFinite(b.ours) && Number.isFinite(b.market) && Math.abs(b.market - b.ours) <= 1e-9 * Math.max(1, Math.abs(b.ours));
}

/**
 * The market blend's line (§6 step 8; PlayerRow.blend; the file header): which way it moved his rest-of-season points, in
 * words, never a number of the market's (planner reply to Checkpoint 7a, 5.4; review of Phase 7b). `text`: "His projection
 * leans up toward the trade market's view." (or down); a capped player (PlayerBlend.clamped; Phase 4c, planner reply to
 * Checkpoint 4b, change 4) "…, by the most it can: 35%." (the percents from `clamp`, config.marketBlend.factorClamp, never
 * a fixed number); "The trade market barely moves his projection." when his ROS prints the same (whole points) before and
 * after, a player at either end of his position's value range among them (blendIsOwnPoint: the market has nothing to
 * compare him with, so his factor is exactly 1). `title`: how the lean works, per game, how far and at most how far; a
 * dynasty league's blend reads this season's values (FantasyCalc's redraft list) and says so. ⚠️ The pre-blend number stays
 * out too: with his ROS (= used) in the table and the weight here, it would give the market's number back.
 */
export function blendText(
  b: NonNullable<PlayerModel["blend"]>,
  leagueType: LeagueSnapshot["settings"]["leagueType"] = "redraft",
  clamp: readonly [number, number] = config.marketBlend.factorClamp,
): { text: string; title: string } {
  const value = leagueType === "dynasty" ? "trade value this season (FantasyCalc's redraft values)" : "trade value";
  const cap = blendCapWords(clamp);
  const title = `Per game, his projection moves ${blendHowFar(b.weight)} toward what our model gives healthy players with about the same ${value}, at most ${cap.up} up or ${cap.down} down. Byes and injuries stay as projected, and every number on this page uses the result.`;
  let text: string;
  if (b.clamped) text = `His projection leans ${b.clamped === "high" ? "up" : "down"} toward the trade market's view, by the most it can: ${b.clamped === "high" ? cap.up : cap.down}.`;
  else if (blendIsOwnPoint(b) || fmtWhole(b.used) === fmtWhole(b.ours)) text = "The trade market barely moves his projection.";
  else text = `His projection leans ${b.used > b.ours ? "up" : "down"} toward the trade market's view.`;
  return { text, title };
}

/** How far the blend pulls a projection per game, in words: weight 0.5 → "halfway", else "40% of the way". */
function blendHowFar(weight: number): string {
  return weight === 0.5 ? "halfway" : `${pct(weight)} of the way`;
}

/** How far the market blend may move a projection, in whole percents (config.marketBlend.factorClamp [0.75, 1.35] → up "35%", down "25%"). */
function blendCapWords(clamp: readonly [number, number] = config.marketBlend.factorClamp): { up: string; down: string } {
  return { up: pct(clamp[1] - 1), down: pct(1 - clamp[0]) };
}

function byeText(pm: PlayerModel | undefined): string {
  const bye = pm?.ros.bye;
  if (!bye || bye.status === "unknown") return "bye unknown";
  if (bye.status === "done") return "bye done";
  return `bye wk ${bye.week}`;
}

function playerRow(ctx: PlayerContext, id: string, group: PlayerRow["group"], team: TeamModel | undefined): PlayerRow {
  const info = ctx.snapshot.players[id];
  const pm = ctx.model.players[id];
  const injury = info ? INJURY_LABEL[info.injury] : null;
  // His bye this week: the model's first week is the current NFL week.
  const byeNow = ctx.model.weeks[0] === ctx.snapshot.currentWeek && pm?.weekly[0]?.bye === true;
  const note = pm?.availabilityNote ? availabilityNoteText(pm.availabilityNote, ctx.inputs.nfl.lastWeek, byeNow) : null;
  const weeks = weekRows(ctx, info, pm, note && pm?.availabilityNote?.used === "returnDate" ? note.short : null);
  const tv = team?.players[id];
  const cost = tv ? (tv.mvLoseScen ?? tv.mvLoseEv) : null;
  const ros = pm ? pm.ros.total : null;
  const blend = pm?.blend ? blendText(pm.blend, ctx.snapshot.settings.leagueType) : null;
  return {
    id,
    name: info?.name ?? `Unknown player (${id})`,
    pos: info ? posLabel(info.pos, ctx.snapshot.platform) : "—",
    nflTeam: info?.nflTeam ?? "FA",
    injury: injury && info ? { ...injury, tone: INJURY_TONE[info.injury] } : null,
    availabilityNote: note,
    tag: harderToGetTag(premiumOf(team, id, ctx.myTeamId)),
    group,
    ros,
    rosText: ros === null ? "—" : fmtWhole(ros),
    splitText: pm ? (ctx.hasPlayoffs ? `${fmtWhole(pm.ros.regular)} / ${fmtWhole(pm.ros.playoffs)}` : fmtWhole(pm.ros.regular)) : "—",
    gamesText: pm ? plural(pm.ros.gamesLeft, "game") : "—",
    byeText: byeText(pm),
    lineupCost: cost === null ? null : fmtNum(cost, 1),
    blend,
    weeks,
    weeksText: weeksText(weeks, note?.long ?? null, blend?.text ?? null),
  };
}

const POS_ORDER = new Map(POSITIONS.map((p, i) => [p, i]));

/** Roster order: by position (QB, RB, WR, TE, K, DEF, IDP), then ROS points, then name. */
function byPositionThenRos(snapshot: LeagueSnapshot, rows: PlayerRow[]): PlayerRow[] {
  const posIndex = (id: string) => {
    const pos = snapshot.players[id]?.pos;
    return pos ? (POS_ORDER.get(pos) ?? 99) : 99;
  };
  return rows.sort((a, b) => posIndex(a.id) - posIndex(b.id) || (b.ros ?? -1) - (a.ros ?? -1) || a.name.localeCompare(b.name));
}

/** A team defense's name that already says it's one ("Vikings D/ST", "MIN D/ST"). */
const DEFENSE_NAME = /(^|\s)(D\/ST|DST|DEF|Defense)(\s|$)/i;

/** How a free agent added is named: his position and NFL team; a team defense by its name, saying it's a defense ("Vikings D/ST", Sleeper's "Minnesota Vikings (DEF)"). */
function addedName(snapshot: LeagueSnapshot, id: string): string {
  const add = snapshot.players[id];
  if (!add) return `Unknown player (${id})`;
  const pos = posLabel(add.pos, snapshot.platform);
  if (add.pos === "DEF") return DEFENSE_NAME.test(add.name) ? add.name : `${add.name} (${pos})`;
  return `${add.name} (${pos}${add.nflTeam ? `, ${add.nflTeam}` : ""})`;
}

/** "+4.6 lineup pts", "+1 lineup pt": a signed gain in lineup points, one decimal (singular when it prints as 1). */
function lineupPts(x: number): string {
  const text = fmtSigned(x, 1);
  return `${text} lineup ${text === "+1" || text === "−1" ? "pt" : "pts"}`;
}

/**
 * Whether the free-agent optimizer picked V*'s moves in scenario lineups (optimizer.ts "Judging moves in scenario
 * lineups"): when scenarios ran (LeagueModel.scenarios) and no starter limit can bind (lineup.ts prepareLeagueSlots;
 * under them it judges in expected-value lineups).
 */
function pickupsJudgedInScenarios(snapshot: LeagueSnapshot, model: LeagueModel): boolean {
  if (!(model.scenarios > 0)) return false;
  try {
    return prepareLeagueSlots(snapshot.settings).limits === null;
  } catch {
    return false;
  }
}

/**
 * A team's free-agent pickups (TeamModel.faMoves; the file header): each move in words ("add …, drop …" or "add …
 * into an open spot") and its gain in lineup points, each week counted once (planner reply to Checkpoint 7b, Q6: the
 * unweighted number, Waiver upgrades' for the same pickup and drop when it's the first), in the lineups the optimizer
 * picks moves by: with injuries and byes simulated when `scenarioJudged` (FaMove.gainScenPlain), else on projected lineups
 * (gainEvPlain); its title names those lineups, adds the other gain when there is one, and, while `playoffWeighted`
 * (lineup cost and trade chips beside it count playoff weeks by ω), says this one counts each week once. ⚠️ Each gain is
 * counted after the pickups above it (the optimizer's order), where Waiver upgrades prices each pickup alone from the
 * roster as it stands, so a later pickup's title says "after the pickups above it" (review of Q6: a second pickup can read
 * much less here than there). The summary adds up the gains shown. Null when the team makes none. A move without a
 * finite gain is left out (a move without a scenario gain, when the optimizer judged in scenario lineups, shows its
 * projected one, saying so).
 */
function freeAgentPickups(snapshot: LeagueSnapshot, team: TeamModel | undefined, scenarioJudged: boolean, playoffWeighted: boolean): FreeAgentPickups | null {
  const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);
  const moves = (team?.faMoves ?? []).flatMap((m) => {
    const scen = scenarioJudged && finite(m.gainScenPlain);
    const gain = scen ? m.gainScenPlain : m.gainEvPlain;
    return finite(gain) ? [{ m, gain, scen }] : [];
  });
  if (!moves.length) return null;
  const items = moves.map(({ m, gain, scen }, i) => {
    const addText = addedName(snapshot, m.add);
    const move = m.drop === null ? `add ${addText} into an open spot` : `add ${addText}, drop ${snapshot.players[m.drop]?.name ?? `Unknown player (${m.drop})`}`;
    const basis = scen ? "with injuries and byes simulated" : "on projected lineups";
    const other = scen ? (finite(m.gainEvPlain) ? ` (${fmtSigned(m.gainEvPlain, 1)} on projected lineups)` : "") : finite(m.gainScenPlain) ? ` (${fmtSigned(m.gainScenPlain, 1)} with injuries and byes simulated)` : "";
    // A later pickup's gain is counted after the ones listed above it (the optimizer's order: together they add what all of
    // them add, the summary's total), where Waiver upgrades prices each pickup alone from the roster as it stands, so only
    // the first can read the same there, with the same drop (review of Q6).
    const after = i > 0 ? ", after the pickups above it" : "";
    return {
      move,
      gain: lineupPts(gain),
      title: `${capitalize(move)}: ${lineupPts(gain)} ${basis}${other}${playoffWeighted ? ", each week counted once" : ""}${after}.`,
    };
  });
  const total = moves.reduce((sum, x) => sum + x.gain, 0);
  return {
    items,
    summary: `${items.length}, ${lineupPts(total)}`,
    text: `${FREE_AGENT_PICKUPS_LABEL}: ${items.map((i) => `${i.move}: ${i.gain}`).join("; ")}`,
  };
}

// ---------------------------------------------------------------------------------------------
// Streaming positions (§7; planner reply to Checkpoint 3, model change 1)

/** Positions the league's lineup starts (a slot with a spot lists them). */
function startable(settings: LeagueSettings): Set<Pos> {
  return new Set(settings.lineup.filter((s) => s.count > 0).flatMap((s) => s.eligible));
}

/**
 * Positions a flex spot of this lineup also takes (a slot with a spot and two or more positions): a streamer at
 * one of them is one more player that week and can start in that flex too (the engine's step 5a).
 */
function flexTaken(settings: LeagueSettings): Set<Pos> {
  return new Set(settings.lineup.filter((s) => s.count > 0 && new Set(s.eligible).size >= 2).flatMap((s) => s.eligible));
}

/** " A streamed QB or TE can also start in a flex spot, …" for `positions` a flex of this lineup takes; "" when none. */
function streamFlexText(positions: readonly Pos[], settings: LeagueSettings, platform: Platform): string {
  const flex = flexTaken(settings);
  const labels = POSITIONS.filter((p) => positions.includes(p) && flex.has(p)).map((p) => posLabel(p, platform));
  return labels.length ? ` A streamed ${listText(labels, "or")} can also start in a flex spot, when that helps the lineup more: the replacement is one more player that week.` : "";
}

/** "K and D/ST": positions as the platform's users know them, in a list. */
function positionsText(positions: readonly Pos[], platform: Platform): string {
  return listText(positions.map((p) => posLabel(p, platform)));
}

const ORDINAL_SUFFIX = ["th", "st", "nd", "rd"];
/** 1 → "1st", 3 → "3rd", 11 → "11th". */
function ordinal(n: number): string {
  const v = n % 100;
  return `${n}${v >= 11 && v <= 13 ? "th" : (ORDINAL_SUFFIX[n % 10] ?? "th")}`;
}

/**
 * A team's streamed positions for its roster header (LeagueModel.streaming.byTeam): "Streams K and D/ST
 * (your setting)" for mine; "Streams D/ST (3 adds this season)" or "Streams K and D/ST (adds this season:
 * K 3, D/ST 4)" for a team detected streaming; null when it streams nothing.
 */
function streamsText(model: LeagueModel, teamId: string, platform: Platform): string | null {
  const s = model.streaming?.byTeam[teamId];
  if (!s || !s.positions.length) return null;
  const list = positionsText(s.positions, platform);
  if (s.source === "setting") return `Streams ${list} (your setting)`;
  const [only] = s.positions;
  if (s.positions.length === 1 && only !== undefined) return `Streams ${list} (${plural(s.adds[only] ?? 0, "add")} this season)`;
  return `Streams ${list} (adds this season: ${s.positions.map((p) => `${posLabel(p, platform)} ${s.adds[p] ?? 0}`).join(", ")})`;
}

/** "kickers" / "D/STs": a streamed position's players in words. */
function positionPlural(pos: Pos, platform: Platform): string {
  if (pos === "K") return "kickers";
  if (pos === "DEF") return platform === "espn" ? "D/STs" : "team defenses";
  if (pos === "QB") return "quarterbacks";
  if (pos === "TE") return "tight ends";
  return `${posLabel(pos, platform)}s`;
}

/**
 * "Streaming picks this week" and who streams what (LeagueModel.streaming; see StreamingView): a group per
 * position the lineup starts among K and D/ST with this week's best free agents (the engine's order: by this
 * week's projection), each with his opponent ("vs ARI" at home, "@ DAL" away); my streamed positions (my
 * setting) and the teams detected streaming, with their adds; how a streamed slot counts, with each streamed
 * position's average replacement over the weeks team numbers count. Null once no week is left, or when the
 * lineup starts neither K nor D/ST and no team streams (nor made a streamer's adds). Phase 7a (planner reply to Checkpoint 4c,
 * A4; review of track AL, finding AL-2): a team in `inactive` (the engine's rule, buildLeagueView) streams nothing whatever
 * its adds (league.ts streamedPositions), so one that made the adds is named apart ("Team 2 (K, 2 adds this season) has
 * made no transactions in the last 5 weeks, so it's assumed to have stopped streaming."), never counted among the teams
 * without them.
 */
function streamingView(snapshot: LeagueSnapshot, model: LeagueModel, myTeamId: string | null, teamName: (id: string) => string, from: number, inactive: ReadonlySet<string>): StreamingView | null {
  const streaming = model.streaming;
  if (!streaming || !model.weeks.length) return null;
  const platform = snapshot.platform;
  const week = snapshot.currentWeek;
  const starts = startable(snapshot.settings);
  const pickPositions = (["K", "DEF"] as const).filter((p) => starts.has(p));
  const byTeam = streaming.byTeam;
  const streamers = snapshot.teams.filter((t) => (byTeam[t.id]?.positions.length ?? 0) > 0);
  const detectAdds = config.streaming.detectAdds;
  const streamable = POSITIONS.filter((p) => config.streaming.streamable.includes(p) && starts.has(p));
  // Inactive teams that made the adds (A4): the positions they'd stream if they were active, by their adds.
  const dormant = snapshot.teams
    .filter((t) => t.id !== myTeamId && inactive.has(t.id) && byTeam[t.id]?.source === "detected" && !byTeam[t.id]?.positions.length)
    .map((t) => ({ id: t.id, adds: byTeam[t.id]?.adds ?? {}, positions: streamable.filter((p) => (byTeam[t.id]?.adds[p] ?? 0) >= detectAdds) }))
    .filter((d) => d.positions.length > 0);
  if (!pickPositions.length && !streamers.length && !dormant.length) return null;

  const groups: StreamingGroup[] = pickPositions.map((pos) => ({
    pos,
    label: posLabel(pos, platform),
    caption: `Best free-agent ${positionPlural(pos, platform)} for week ${week}, by this week's projection`,
    picks: streaming.picks
      .filter((p) => p.pos === pos)
      .map((p) => {
        const info = snapshot.players[p.playerId];
        const opp = p.opponent;
        return {
          id: p.playerId,
          name: info?.name ?? `Unknown player (${p.playerId})`,
          nflTeam: info?.nflTeam ?? "FA",
          opponent: opp ? `${opp.home ? "vs" : "@"} ${opp.team}` : "—",
          opponentLong: opp ? (opp.home ? `at home against ${opp.team}` : `away at ${opp.team}`) : "opponent unknown",
          projection: fmtNum(p.projection, 1),
        };
      }),
  }));

  const mineStreams = myTeamId ? byTeam[myTeamId] : undefined;
  const mine = myTeamId ? (mineStreams && mineStreams.positions.length ? `You stream ${positionsText(mineStreams.positions, platform)}.` : "You don't stream any position.") : null;
  const otherTeams = streamers.filter((t) => t.id !== myTeamId);
  const streamableText = listText(
    streamable.map((p) => posLabel(p, platform)),
    "or",
  );
  const stopped = dormant.length
    ? ` ${listText(dormant.map((d) => `${teamName(d.id)} (${d.positions.map((p) => `${posLabel(p, platform)}, ${plural(d.adds[p] ?? 0, "add")}`).join("; ")} this season)`))} ${dormant.length === 1 ? "has" : "have"} made no transactions ${inactiveWindowText(snapshot)}, so ${dormant.length === 1 ? "it's" : "they're"} assumed to have stopped streaming.`
    : "";
  const others = otherTeams.length
    ? `${myTeamId ? "Other teams that stream" : "Teams that stream"} (${detectAdds} or more adds at the position this season): ${otherTeams
        .map((t) => {
          const s = byTeam[t.id] as NonNullable<(typeof byTeam)[string]>;
          return `${teamName(t.id)} (${s.positions.map((p) => `${posLabel(p, platform)}, ${plural(s.adds[p] ?? 0, "add")}`).join("; ")})`;
        })
        .join(", ")}.${stopped}`
    : dormant.length
      ? `No ${myTeamId ? "other " : ""}team is assumed to stream, so ${myTeamId ? "the others count" : "every team counts"} only their own players.${stopped}`
      : `No ${myTeamId ? "other " : ""}team has made ${detectAdds} or more adds at ${streamableText || "a streaming position"} this season, so ${myTeamId ? "the others count" : "every team counts"} only their own players.`;

  // Each streamed position's replacement, averaged over the weeks team numbers count (a position without a
  // free agent who scores has nothing to average: streaming adds nothing there).
  const streamed = POSITIONS.filter((p) => streamers.some((t) => byTeam[t.id]?.positions.includes(p)));
  const averages = streamed.flatMap((p) => {
    const rep = (streaming.replacement[p] ?? []).slice(from);
    return rep.some((x) => x > 0) ? [`${fmtNum(sum(rep) / rep.length, 1)} points a week at ${posLabel(p, platform)}`] : [];
  });
  const rank = ordinal(config.streaming.streamRank);
  const gameDay = model.inProgressWeek !== null && from > 0 ? " Free agents whose game this week has already started aren't picks." : "";
  const note = `A streamed slot counts, each week, the better of the team's own player and the streaming replacement: the ${rank}-best free agent at that position that week (other teams stream too).${averages.length ? ` Over the weeks left, the replacement averages ${listText(averages)}.` : ""} A team that starts two at a position still gets one streamer.${streamFlexText(streamed, snapshot.settings, platform)}${gameDay}`;

  const anyPicks = groups.some((g) => g.picks.length > 0);
  const empty = groups.length && !anyPicks ? `No free-agent ${listText(groups.map((g) => positionPlural(g.pos, platform)), "or")} are projected to play this week.` : null;
  return { week, groups, mine, others, note, empty };
}

// ---------------------------------------------------------------------------------------------
// Teams

function slotLabels(model: LeagueModel): Map<string, string> {
  return new Map(model.slots.map((s) => [s.key, s.label]));
}

interface SlotMedians {
  ros: Map<string, number>;
  next: Map<string, number>;
}

function slotMedians(model: LeagueModel): SlotMedians {
  const ros = new Map<string, number>();
  const next = new Map<string, number>();
  for (const s of model.slots) {
    const values = model.teams.map((t) => t.strength[s.key]).filter((x): x is SlotStrength => !!x);
    ros.set(s.key, median(values.map((v) => v.ros)));
    next.set(s.key, median(values.map((v) => v.next)));
  }
  return { ros, next };
}

function needChips(team: TeamModel, labels: Map<string, string>, medians: SlotMedians, nextWeeks: number): Chip[] {
  return [...team.needs]
    .sort((a, b) => a.z - b.z)
    .slice(0, config.needs.needsShown)
    .map((n) => {
      const label = labels.get(n.slot) ?? n.slot;
      const s = team.strength[n.slot];
      const windowWords = n.window === "ros" ? "rest of season" : `next ${plural(nextWeeks, "week")}`;
      const value = s ? (n.window === "ros" ? s.ros : s.next) : null;
      const med = (n.window === "ros" ? medians.ros : medians.next).get(n.slot);
      const detail = value !== null && med !== undefined ? `: ${fmtNum(value, 1)} pts/wk vs the league median ${fmtNum(med, 1)}` : "";
      return {
        key: `${n.window}-${n.slot}`,
        text: n.window === "ros" ? label : `${label} · next ${nextWeeks} ${nextWeeks === 1 ? "wk" : "wks"}`,
        title: `Need at ${label} (${windowWords})${detail}`,
        kind: n.window === "ros" ? ("need-ros" as const) : ("need-next" as const),
        tags: [],
      };
    });
}

/** The visible tag on a trade chip who starts for his own team (Checkpoint 3 answer 3). */
export const STARTER_TAG = "starter";

/**
 * A team's trade chips (§7; TeamModel.chips, biggest gap first; planner reply to Checkpoint 3, answer 3):
 * the first chipsShown, each "C. McCaffrey: worth +33 to Team 2 · costs you 6.1 pts/wk" (the gap, whole
 * lineup points, "to you" when my team gains most; then what his own team loses per week, "you" on my team
 * and "his team" on another: "them" right after a team's name read as that team), tagged "starter" when he
 * starts for his team after its free-agent pickups (TradeChip.starter: the roster his cost is measured from, so a
 * player the pickups drop is never tagged next to a cost of 0; review of track A2). The title gives
 * every part to a tenth: the gap, what that team would gain with him and what his team would lose without
 * him, in lineup points (`weighting`: the playoff weighting while playoff weeks count) and per week, that his
 * team's pickups would drop him anyway when they do (TeamModel.faMoves: why losing him costs nothing), and
 * whether he starts. Another team's chip whose premium earns it is tagged "Harder to get" too (after "starter"), its
 * title ending with why.
 */
function tradeChipTags(snapshot: LeagueSnapshot, team: TeamModel, teamName: (id: string) => string, myTeamId: string | null, weighting: string | null): Chip[] {
  const own = team.id === myTeamId;
  return team.chips.slice(0, Math.max(0, config.needs.chipsShown)).map((c) => {
    const info = snapshot.players[c.playerId];
    const name = info?.name ?? c.playerId;
    const mine = c.bestTeamId === myTeamId;
    const to = mine ? "you" : teamName(c.bestTeamId);
    const toLong = mine ? `${teamName(c.bestTeamId)} (your team)` : teamName(c.bestTeamId);
    const pos = info ? ` (${posLabel(info.pos, snapshot.platform)})` : "";
    const perWeek = fmtNum(c.costPerWeek, 1);
    const starts = c.starter ? ` He starts for ${own ? "you" : "his team"}.` : "";
    const droppedAnyway = team.faMoves.some((m) => m.drop === c.playerId) ? ` ${own ? "Your" : "His team's"} free-agent pickups would drop him anyway.` : "";
    const harder = harderToGetTag(premiumOf(team, c.playerId, myTeamId));
    const tags: ChipTag[] = [...(c.starter ? [{ text: STARTER_TAG, kind: "starter" as const }] : []), ...(harder ? [{ text: harder.text, kind: "harder" as const }] : [])];
    return {
      key: c.playerId,
      text: `${shortName(name, info?.pos)}: worth ${fmtSigned(c.gap, 0)} to ${to} · costs ${own ? "you" : "his team"} ${perWeek} pts/wk`,
      title: `${name}${pos}: worth ${fmtNum(c.gap, 1)} more lineup pts${weighting ? ` ${weighting}` : ""} to ${toLong} than to his own team. ${toLong} would gain ${fmtNum(c.maxOther, 1)} with him (after its free-agent pickups); ${own ? "your team" : "his team"} would lose ${fmtNum(c.cost, 1)} without him, ${perWeek} a week.${droppedAnyway}${starts}${harder ? ` ${harder.title}` : ""}`,
      kind: "chip" as const,
      tags,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Best trade partners (§7; planner addendum to Checkpoint 3, §2; Phase 4 addendum lead decision N12)

/** A partner card's lead lines (PartnerTarget): "Best of their trade chips" since the planner's reply to Checkpoint 4, change 6 (it read "Best target"). */
export const BEST_TARGET_LABEL = "Best of their trade chips";
export const BIGGER_UPGRADE_LABEL = "Bigger upgrade, harder to get";
/** ⚠️ Ours: when no untagged one leads, there's nobody for him to be "bigger" than. */
export const BEST_TARGET_HARDER_LABEL = "Best of their trade chips, harder to get";

/** The lead line adds at least this many points a week to my lineup, as the card prints it (config.needs.bestTargetMin; N12). */
export const BEST_TARGET_MIN: number = config.needs.bestTargetMin;

/** A partner card's link to the one-partner Trade Finder (planner reply to Checkpoint 4, change 6); the card adds an arrow. */
export const partnerIdeasText = (teamName: string): string => `See trade ideas with ${teamName}`;

/** A partner card prints points per week with this many decimals ("+2.1/wk"), and judges its lead lines on that number. */
const PER_WEEK_DECIMALS = 1;

/** "+2.1/wk": what a player adds to the other team's lineup a week, as a partner card prints it. */
const perWeekText = (ppw: number): string => `${fmtSigned(ppw, PER_WEEK_DECIMALS)}/wk`;

/** The same number as printed (fmtNum's rounding), so the card's rules agree with what it shows: "+1/wk" meets a floor of 1. */
function perWeekShown(ppw: number): number {
  const factor = 10 ** PER_WEEK_DECIMALS;
  const rounded = Math.round(Math.abs(ppw) * factor) / factor;
  return ppw < 0 ? -rounded : rounded;
}

/** The floor in words, printed like the card's numbers: "1 point" (BEST_TARGET_MIN). */
function bestTargetMinWords(): string {
  const text = fmtNum(BEST_TARGET_MIN, PER_WEEK_DECIMALS);
  return `${text} ${text === "1" ? "point" : "points"}`;
}

/**
 * Under the partner cards (TradePartners): what the lead line, "Best of their trade chips", means (the file header; N12's
 * floor in config's number) and why a marked player is harder to get.
 */
export const BEST_TARGET_NOTE = `“${BEST_TARGET_LABEL}” is the one of their trade chips who'd help you most without the “${HARDER_TO_GET_TAG}” mark, as long as he adds at least ${bestTargetMinWords()} a week; when none does, a marked one who'd help you more leads instead, if he adds at least that much too. A marked player is one of their best, so expect their manager to want a little extra for him.`;

interface PartnerCardContext {
  snapshot: LeagueSnapshot;
  /** The partner's team model (its premiums tag its players). */
  teamModel: TeamModel | undefined;
  name: string;
  myTeamId: string;
}

/**
 * One partner card (the file header; lead decisions N2 and N12). Targets come from their trade chips who'd start for me
 * (more than 0 a week as printed), ranked by what each adds as printed; on a tie the untagged one counts as the better,
 * then the engine's order, so "Bigger upgrade, harder to get" is always strictly bigger on the card. "Best of their trade
 * chips" = the best untagged one when he adds at least BEST_TARGET_MIN a week; the single best one follows when he's
 * tagged ("Bigger upgrade, harder to get"), or leads alone as "Best of their trade chips, harder to get" when no untagged
 * one clears the floor. ⚠️ N12's floor holds for every lead line (the lead's call after the final review): a tagged single
 * best under it leads nothing, and neither does an untagged single best under it (a tagged one who adds less is no lead).
 * The rest of their chips follow as "They could also give" ("They could give" without targets), in the engine's order,
 * the first chipsShown named and the others counted; mine as "You could give". Their tagged players carry "Harder to get"
 * there too (hover and screen-reader words included); mine never do. Then "See trade ideas with <team>" (change 6).
 */
function partnerCard(p: TradePartner, c: PartnerCardContext): PartnerCard {
  const { snapshot } = c;
  const tagOf = (id: string) => harderToGetTag(premiumOf(c.teamModel, id, c.myTeamId));
  const nameOf = (id: string) => snapshot.players[id]?.name ?? id;
  const short = (id: string) => shortName(nameOf(id), snapshot.players[id]?.pos);

  const ranked = p.theyCanGive
    .filter((x) => Number.isFinite(x.ppw) && perWeekShown(x.ppw) > 0)
    .map((x, i) => ({ x, i, shown: perWeekShown(x.ppw), tag: tagOf(x.playerId) }))
    .sort((a, b) => b.shown - a.shown || Number(a.tag !== null) - Number(b.tag !== null) || a.i - b.i);
  const best = ranked[0];
  const bestUntagged = ranked.find((r) => r.tag === null && r.shown >= BEST_TARGET_MIN);
  const target = (r: (typeof ranked)[number], label: string): PartnerTarget => ({
    id: r.x.playerId,
    label,
    text: `${short(r.x.playerId)}, ${perWeekText(r.x.ppw)}`,
    name: short(r.x.playerId),
    perWeek: perWeekText(r.x.ppw),
    title: `${nameOf(r.x.playerId)}: ${fmtSigned(r.x.ppw, PER_WEEK_DECIMALS)} points per week to your lineup.${r.tag ? ` ${r.tag.title}` : ""}`,
    harderToGet: r.tag !== null,
  });
  const targets: PartnerTarget[] = [];
  if (bestUntagged) targets.push(target(bestUntagged, BEST_TARGET_LABEL));
  // The single best one when he's tagged: then he adds strictly more than every untagged one as printed. The floor holds
  // for him too (the lead's call on N12): a "+0.5/wk" star leads nothing either (when an untagged one clears the floor, he
  // adds more than that one, so he clears it as well).
  if (best && best.tag && best.shown >= BEST_TARGET_MIN) targets.push(target(best, bestUntagged ? BIGGER_UPGRADE_LABEL : BEST_TARGET_HARDER_LABEL));
  const named = new Set(targets.map((t) => t.id));

  const side = (label: string, players: readonly { playerId: string; ppw: number }[], theirs: boolean): PartnerSide => {
    const all = players.map((x) => {
      const tag = theirs ? tagOf(x.playerId) : null;
      const per = perWeekText(x.ppw);
      return {
        player: { id: x.playerId, text: `${short(x.playerId)} (${per})`, title: `${nameOf(x.playerId)}: ${fmtSigned(x.ppw, PER_WEEK_DECIMALS)} points per week to the other lineup${tag ? `. ${tag.title}` : ""}`, tag },
        sr: `${short(x.playerId)} (${per}${tag ? ", harder to get" : ""})`,
      };
    });
    const shown = Math.max(1, config.needs.chipsShown);
    const hidden = all.slice(shown);
    const text = `and ${hidden.length} more`;
    return {
      label,
      players: all.slice(0, shown).map((a) => a.player),
      more: hidden.length ? { text, title: hidden.map((a) => a.player.title).join("\n"), srText: `${text}: ${hidden.map((a) => a.sr).join(", ")}` } : null,
    };
  };
  return {
    teamId: p.teamId,
    name: c.name,
    mutual: p.mutual,
    fitText: p.mutual ? `Fit ${fmtNum(p.score, 1)}` : "Would start for you",
    targets,
    theyCanGive: side(targets.length ? "They could also give:" : "They could give:", p.theyCanGive.filter((x) => !named.has(x.playerId)), true),
    youCanGive: side("You could give:", p.youCanGive, false),
    ideas: { text: partnerIdeasText(c.name), href: finderHref(p.teamId) },
  };
}

function heatCell(key: string, label: string, teamName: string, s: SlotStrength | undefined, window: StrengthWindow, med: number, windowWords: string): HeatCell {
  const value = s ? (window === "ros" ? s.ros : s.next) : 0;
  const z = s ? (window === "ros" ? s.zRos : s.zNext) : 0;
  const step = heatStep(z);
  return {
    key,
    value,
    text: fmtNum(value, 1),
    z,
    step,
    title: `${teamName} · ${label}: ${fmtNum(value, 1)} pts/wk, ${HEAT_STEP_LABEL[step].toLowerCase()} (league median ${fmtNum(med, 1)}, ${windowWords})`,
  };
}

// ---------------------------------------------------------------------------------------------
// Standings, playoff odds and my remaining schedule (§8)

/**
 * A probability as the page prints it (§8 odds): a whole percent, with "0%" and "100%" only when it's
 * certain (exactly 0 or 1) and "<1%" and ">99%" when it merely rounds there: 0.3% of 5,000 seasons is
 * 15 of them, not none. Unknown (null; NaN too, which the engine never sends) prints "—". Screen
 * readers get the symbolic forms in words.
 */
export function oddsCell(p: number | null): OddsCell {
  if (p === null || !Number.isFinite(p)) return { text: "—", srText: "unknown" };
  if (p <= 0) return { text: "0%", srText: null };
  if (p >= 1) return { text: "100%", srText: null };
  if (p < 0.005) return { text: "<1%", srText: "less than 1%" };
  if (p >= 0.995) return { text: ">99%", srText: "more than 99%" };
  return { text: `${Math.round(p * 100)}%`, srText: null };
}

/**
 * A title chance as the page prints it, the headline and the table's Title column alike (review of track UIP: the
 * headline read "9.9% title" over my row's "10%"): one decimal, as every trade idea prints my title odds before it
 * (tradeView.ts titleOddsText: "9.9%"; title odds are often small, where the decimal counts), "<0.1%" and ">99.9%" when
 * it merely rounds to 0 or 100 (read out in words), "—" when unknown (null; NaN too).
 */
export function titleCell(p: number | null): OddsCell {
  if (p === null || !Number.isFinite(p)) return { text: "—", srText: "unknown" };
  const text = titleOddsText(p);
  if (text.startsWith("<")) return { text, srText: `less than ${text.slice(1)}` };
  if (text.startsWith(">")) return { text, srText: `more than ${text.slice(1)}` };
  return { text, srText: null };
}

/** A fantasy bye week's Win cell: there's no game to win, which isn't an unknown chance. */
const NO_GAME: OddsCell = { text: "—", srText: "no game" };

/**
 * Which odds the standings show, and the explainer names: playoff odds only when 2+ teams make the
 * playoffs (with none or one, the title goes to the top of the final standings: a Playoffs column would
 * read 0% for everyone or repeat the Title column); bye odds only when the league has byes and their
 * odds are known.
 */
function oddsShown(odds: SeasonOdds): { playoffs: boolean; bye: boolean } {
  return { playoffs: odds.playoffTeams >= 2, bye: odds.byes > 0 && odds.teams.some((t) => t.pBye !== null) };
}

/** The expected final record with one decimal, so it never passes for a real one ("8.6–5.4"); ties only when they print above 0. */
function finalRecordText(o: TeamOdds): string {
  const one = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "—");
  const ties = Number.isFinite(o.expTies) && Number(o.expTies.toFixed(1)) > 0;
  return `${one(o.expWins)}–${one(o.expLosses)}${ties ? `–${one(o.expTies)}` : ""}`;
}

interface OddsContext {
  snapshot: LeagueSnapshot;
  model: LeagueModel;
  odds: SeasonOdds | null;
  teamById: ReadonlyMap<string, Team>;
  teamName: (id: string) => string;
  myTeamId: string | null;
  /** Everything the banner already says (LeagueView.notices): notes repeating it aren't listed twice. */
  warnings: readonly string[];
  /** The NFL regular season's last week (inputs.nfl.lastWeek, as the engine reads it), for an IR returner's expected return week. */
  lastNflWeek: number | undefined;
}

/**
 * A headline part, printed as every trade idea prints my odds before it (tradeView.ts oddsViews: the planner's "Title odds
 * 12.1% → 13.4%" and "Playoff odds 65% → 69%"), so the two can be read against each other, and as the table prints them:
 * playoff odds in whole percents (oddsCell: "59% playoffs"), title odds with one decimal (titleCell: "9.9% title"); a
 * symbolic one ("<1%", "<0.1%") in words for screen readers, and unknown in words ("title unknown"). Checkpoint 7c: a top-N
 * finish in whole percents like the cards' "Top 3 odds" ("30% top 3").
 */
function oddsPart(p: number | null, label: "playoffs" | "title" | "top 2" | "top 3"): OddsPart {
  const cell = label === "title" ? titleCell(p) : oddsCell(p);
  if (cell.srText === "unknown" || p === null) return { text: `${label} unknown`, srText: null };
  return { text: `${cell.text} ${label}`, srText: cell.srText ? `${cell.srText} ${label}` : null };
}

/**
 * My odds, the standings card's headline (MyOdds; the file header, "One baseline everywhere"): the headline from `odds`
 * (LeagueModel.odds) and the second line from LeagueModel.oddsAsRostersStand when the model has it, each with playoff odds
 * when the table shows them, then title odds. Null without a team or when my team isn't in the odds. Checkpoint 7c (planner
 * reply to Checkpoint 7b, §6: "cards and the League page add “Top 3 odds” (or “Top 2 odds”)"; the lead's words): under
 * "Several prizes" paying 3rd place (else 2nd) my chance of a top-3 (top-2) finish between them, "Your odds: 60% playoffs ·
 * 30% top 3 · 10.5% title" (tradeView.ts topPlacesOf on LeagueModel.reward; topChance of P(title), P(2nd) and P(3rd): left
 * out when one isn't known, never a partial sum), both lines alike.
 */
function myOddsOf(c: OddsContext, odds: SeasonOdds, showPlayoffs: boolean): MyOdds | null {
  const me = c.myTeamId;
  const head = me ? odds.teams.find((t) => t.teamId === me) : undefined;
  if (!me || !head) return null;
  const places = topPlacesOf(c.model.reward);
  const top = (o: TeamOdds): OddsPart[] => {
    const p = places ? topChance({ first: o.pTitle, second: o.pSecond ?? null, third: o.pThird ?? null }, places) : null;
    return places && p !== null ? [oddsPart(Math.min(1, Math.max(0, p)), places === 3 ? "top 3" : "top 2")] : [];
  };
  const parts = (o: TeamOdds): OddsPart[] => [...(showPlayoffs ? [oddsPart(o.pPlayoffs, "playoffs")] : []), ...top(o), oddsPart(o.pTitle, "title")];
  const line = (label: string, ps: readonly OddsPart[]) => `${label}: ${ps.map((p) => p.text).join(" · ")}`;
  const stand = c.model.oddsAsRostersStand?.teams.find((t) => t.teamId === me);
  const headline = parts(head);
  const asRostersStand = stand ? parts(stand) : null;
  return { headline, asRostersStand, text: line(YOUR_ODDS_LABEL, headline), asRostersStandText: asRostersStand ? line(AS_ROSTERS_STAND_LABEL, asRostersStand) : null };
}

/**
 * The model's odds count every team's free-agent pickups (a Phase 4c model: it has the odds as rosters stand too, null
 * only when the headline is). A model built before Phase 4c has none: its odds are as rosters stand.
 */
function oddsCountPickups(model: LeagueModel): boolean {
  return model.oddsAsRostersStand !== undefined;
}

/**
 * The standings table (§8; §17 Checkpoint 3): every team in today's standings order by the league's
 * rules (TeamOdds.rank), with its record and points for, and its playoff, bye and title odds and
 * projected final record. The Playoffs column shows only when 2+ teams make the playoffs and the Bye
 * column only when the league has byes and their odds are known (oddsShown; unknown playoffs make bye
 * and title odds null: the title column then prints "—" and a note says why). Null once no week is
 * left (the page says the season is over); no odds otherwise → `empty`. Phase 4c (the file header, "One baseline
 * everywhere"): my odds lead it (myOddsOf), a line says what the odds count (ODDS_BASIS_TEXT), and while a week is
 * under way its notes say the odds count pickups from the next week (pickupsUnderWayNote, after the engine's own note
 * about that week).
 */
function standingsView(c: OddsContext): StandingsView | null {
  if (!c.model.weeks.length) return null;
  const pointsOnly = c.snapshot.settings.pointsOnly;
  const odds = c.odds;
  if (!odds) return { mine: null, basis: null, rows: [], showPlayoffs: false, showBye: false, pointsOnly, caption: "", notes: [], empty: "Playoff odds aren't available for this league right now." };
  const { playoffs: showPlayoffs, bye: showBye } = oddsShown(odds);
  const mine = myOddsOf(c, odds, showPlayoffs);
  const pickups = oddsCountPickups(c.model);
  const basis = pickups ? `${ODDS_BASIS_TEXT}${mine?.asRostersStand ? ` “${AS_ROSTERS_STAND_LABEL}” counts no pickups.` : ""}` : null;
  const rows: StandingsRow[] = odds.teams
    .filter((o) => c.teamById.has(o.teamId))
    .sort((a, b) => a.rank - b.rank)
    .map((o) => {
      const team = c.teamById.get(o.teamId) as Team;
      return {
        teamId: o.teamId,
        rank: o.rank,
        name: team.name,
        isMine: o.teamId === c.myTeamId,
        record: recordText(team.record),
        pointsFor: fmtNum(team.pointsFor, 1),
        playoffs: showPlayoffs ? oddsCell(o.pPlayoffs) : null,
        bye: showBye ? oddsCell(o.pBye) : null,
        title: titleCell(o.pTitle),
        finalRecord: pointsOnly ? null : finalRecordText(o),
        eliminated: o.eliminated,
      };
    });
  const chances = listText([...(showPlayoffs ? ["make the playoffs"] : []), ...(showBye ? ["get a first-round bye"] : []), "win the title"]);
  const said = new Set(c.warnings);
  const notes = odds.notes.filter((n) => !said.has(n));
  // While a week is under way the odds count pickups from the next week on (the file header): said right after the
  // engine's own note about that week, or last.
  const from = teamFrom(c.model);
  const live = from > 0 ? c.model.inProgressWeek : null;
  if (pickups && live !== null) {
    const at = notes.indexOf(weekUnderWayNote(live));
    notes.splice(at >= 0 ? at + 1 : notes.length, 0, pickupsUnderWayNote(live, c.model.weeks[from]));
  }
  return {
    mine,
    basis,
    rows,
    showPlayoffs,
    showBye,
    pointsOnly,
    caption: `Standings today by your league's rules, with each team's chance to ${chances}${pointsOnly ? "" : ", and its projected final record"}, from ${fmtWhole(odds.sims)} simulated seasons${pickups ? ", counting each team's free-agent pickups that would help" : ""}`,
    notes: [...new Set(notes)],
    empty: null,
  };
}

/**
 * A team's active roster after its free-agent pickups (TeamModel.faMoves, in the order the optimizer makes them): each
 * add takes its drop's place, or joins at the end for an open spot (optimizer.ts applyStep), so it is V*(T)'s roster, the
 * one the odds and the schedule's points price (leagueView.engine.test.ts checks it against the engine's own). Each id once.
 */
export function rosterAfterPickups(roster: readonly string[], moves: readonly Pick<FaMove, "add" | "drop">[]): string[] {
  let out = [...new Set(roster)];
  for (const m of moves) out = m.drop === null ? [...out, m.add] : out.map((id) => (id === m.drop ? m.add : id));
  return out;
}

/** A streaming row's id in likelyStarters' lineups: the engine's own prefix (isStreamId), which no player id carries. */
const STREAM_ROW = "stream:";

/**
 * The indexes into model.weeks that team numbers count, as the engine weights them (league.ts teamWeeks, teamValue.ts
 * weekWeights): from teamFrom on, a regular-season week, or a playoff week while playoff weeks carry a weight.
 */
function countedWeekIndexes(model: LeagueModel): number[] {
  const regular = new Set(model.regularWeeks);
  const playoffs = new Set((model.playoffWeight ?? config.lineups.playoffWeight) > 0 ? model.playoffWeeks : []);
  const out: number[] = [];
  for (let i = teamFrom(model); i < model.weeks.length; i++) {
    const w = model.weeks[i] as number;
    if (regular.has(w) || playoffs.has(w)) out.push(i);
  }
  return out;
}

/**
 * The players likelyStarters picks a team's likely starters from: its active roster (`afterPickups`: after its free-agent
 * pickups, rosterAfterPickups; else as it stands) and its IR returners (the IR players TeamModel.players lists; as the
 * engine reads them, league.ts TeamWork.ir, never one the snapshot also lists on the active roster: a data error, he's an
 * active player), each one the snapshot and the model know; and `gone`, the players the engine releases from a returner's
 * week to make room (league.ts step 5b: TeamModel.displacedWithPickups after the pickups, else TeamModel.displaced), each
 * with the NFL week he's off from (none in a model built before Phase 7b). Empty without the team.
 */
function starterPool(snapshot: LeagueSnapshot, model: LeagueModel, teamId: string, afterPickups: boolean): { roster: string[]; returners: string[]; gone: Map<string, number> } {
  const team = snapshot.teams.find((t) => t.id === teamId);
  if (!team) return { roster: [], returners: [], gone: new Map() };
  const tm = model.teams.find((t) => t.id === teamId);
  const modeled = (id: string) => snapshot.players[id] !== undefined && model.players[id] !== undefined;
  const roster = rosterAfterPickups(team.roster, afterPickups ? (tm?.faMoves ?? []) : []).filter(modeled);
  const returners = [...new Set(team.ir)].filter((id) => tm?.players[id] !== undefined && !team.roster.includes(id) && !roster.includes(id) && modeled(id));
  const gone = new Map<string, number>();
  for (const d of (afterPickups ? tm?.displacedWithPickups : tm?.displaced) ?? []) if (!gone.has(d.id)) gone.set(d.id, d.week);
  return { roster, returners, gone };
}

/**
 * My likely starters (the rule the schedule's bye list and its risky weeks use, which then leave out the positions I
 * stream: scheduleByeRule; see the header), the trade cards' own (evaluate.ts riskyWeeksOf, teamValue.ts evStarter; review
 * of track UIP: the page used to pick one lineup by ROS points per game left, which flagged weeks no card mentioned and
 * listed a D/ST its team streams). Each week team numbers count (countedWeekIndexes), my best lineup by the engine's
 * exact solver over the league's slots, from each player's projected points that week (PlayerModel.weekly: his bye, his
 * injuries and his matchup), among my active roster (`afterPickups`, Phase 4c, the schedule's: the roster after my
 * free-agent pickups, rosterAfterPickups, as the odds and points beside it count them; else as it stands), my IR
 * returners (the IR players TeamModel.players lists: no points until they're back) and one row per position I stream at
 * that week's streaming replacement (LeagueModel.streaming: a rostered kicker or D/ST starts only in the weeks he
 * projects higher). A likely starter is in it in at least half of the counted weeks he plays (points above 0); nobody
 * who never plays. By position, then more ROS points, then id. A player the engine releases from a returner's week to make
 * room (league.ts step 5b; TeamModel.displaced, displacedWithPickups) scores nothing from that week on, as in the engine's
 * lineups (review of the engine track, Phase 7b: he used to stay, so a player his release lets start could count on the
 * cards' side only; ⚠️ a model built before Phase 7b doesn't say who, and he stays).
 */
export function likelyStarters(snapshot: LeagueSnapshot, model: LeagueModel, teamId: string, opts: { afterPickups?: boolean } = {}): string[] {
  if (!snapshot.teams.some((t) => t.id === teamId)) return [];
  const { roster, returners, gone } = starterPool(snapshot, model, teamId, opts.afterPickups === true);
  const ids = [...roster, ...returners];
  const streamed = model.streaming?.byTeam[teamId]?.positions ?? [];
  const slots = prepareLeagueSlots(snapshot.settings);
  const finite = (x: number | undefined) => (x !== undefined && Number.isFinite(x) ? x : 0);
  // The week index each released player is off the roster from (the engine masks his row from there: returners.ts).
  const goneAt = new Map<string, number>();
  for (const [id, week] of gone) {
    const i = model.weeks.indexOf(week);
    if (i >= 0) goneAt.set(id, i);
  }
  const row = (id: string, w: number): LineupPlayer => {
    const info = snapshot.players[id] as PlayerInfo;
    const off = w >= (goneAt.get(id) ?? Number.POSITIVE_INFINITY);
    return { id, pos: info.pos, eligible: info.eligible, points: off ? 0 : finite(model.players[id]?.weekly[w]?.p) };
  };
  const plays = new Map<string, number>();
  const seated = new Map<string, number>();
  for (const w of countedWeekIndexes(model)) {
    // The engine's row order (league.ts StreamSpec): the active roster, the streaming rows, then the returners.
    const players: LineupPlayer[] = [
      ...roster.map((id) => row(id, w)),
      ...streamed.map((pos): LineupPlayer => ({ id: `${STREAM_ROW}${pos}`, pos, eligible: [pos], points: finite(model.streaming?.replacement[pos]?.[w]) })),
      ...returners.map((id) => row(id, w)),
    ];
    const lineup = new Set(solveLineup(players, slots).starters.map((s) => s.id));
    for (const p of players) {
      if (!(p.points > 0)) continue;
      plays.set(p.id, (plays.get(p.id) ?? 0) + 1);
      if (lineup.has(p.id)) seated.set(p.id, (seated.get(p.id) ?? 0) + 1);
    }
  }
  const posIndex = (id: string) => POS_ORDER.get(snapshot.players[id]?.pos as Pos) ?? 99;
  const ros = (id: string) => finite(model.players[id]?.ros.total);
  return ids
    .filter((id) => {
      const n = plays.get(id) ?? 0;
      return n > 0 && 2 * (seated.get(id) ?? 0) >= n;
    })
    .sort((a, b) => posIndex(a) - posIndex(b) || ros(b) - ros(a) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * An IR returner's expected return week, as the engine reads it (league.ts step 5b: availability.expectedReturnWeek on
 * what his availability reads, his tag alone when Sleeper found his ESPN return date stale): his byes before it aren't my
 * crunch (evaluate.ts riskyWeeksOf), since he's on IR then anyway. Null when he isn't back within the weeks left.
 */
function returnWeekOf(snapshot: LeagueSnapshot, model: LeagueModel, id: string, lastNflWeek: number | undefined): number | null {
  const info = snapshot.players[id];
  if (!info) return null;
  const avail = model.players[id]?.availabilityNote?.used === "sleeper" ? { injury: info.injury } : info;
  return expectedReturnWeek(avail, { weeks: model.weeks, currentWeek: snapshot.currentWeek, hasTeam: Boolean(info.nflTeam), ...(lastNflWeek !== undefined ? { lastNflWeek } : {}) });
}

/** The NFL regular season's last week as the engine reads it (league.ts nflLastWeek: inputs.nfl.lastWeek, a whole week ≥ 1), else undefined. */
export function lastNflWeekOf(inputs: Pick<ModelInputs, "nfl">): number | undefined {
  const last = inputs.nfl?.lastWeek;
  return typeof last === "number" && Number.isInteger(last) && last >= 1 ? last : undefined;
}

/** The schedule's bye rule for one team (scheduleByeRule). */
export interface ScheduleByeRule {
  /** The odds, and so the schedule's points and chances, count every team's free-agent pickups (oddsCountPickups). */
  readonly pickups: boolean;
  /**
   * The players whose byes the schedule could name: my active roster (after my free-agent pickups when `pickups`,
   * rosterAfterPickups; else as it stands), then my IR returners, likelyStarters' own pool.
   */
  readonly players: readonly string[];
  /**
   * My likely starters whose byes count (likelyStarters on that pool), in its order (by position, then more ROS points,
   * then id): ⚠️ never one at a position I stream (the file header).
   */
  readonly starters: readonly string[];
  /**
   * Whether `id` is off in any of `weeks` (NFL weeks; one the model doesn't have counts for nobody): his NFL team's bye that
   * week, a returner's only from his expected return week, and a player the engine releases to make room for a returner only
   * before he's released (TeamModel.displaced, displacedWithPickups).
   */
  onBye(id: string, weeks: readonly number[]): boolean;
}

/**
 * The schedule's bye rule (the file header; §8 "show each remaining week's risk"): scheduleView's, and the league
 * report's (scripts/league-report.ts remainingSchedule reads it here, so the report can't drift from the page: review
 * POL-1 found it still counting a streamed kicker on bye, from the roster as it stood). Whether the odds count the
 * pickups; my likely starters (likelyStarters, after my free-agent pickups when the odds count them), leaving out ⚠️ any
 * at a position I stream (Phase 4c lead decision on the review of track UIP's design question: his slot's streaming row
 * starts that week's streaming replacement when he's off, so his bye is no crunch; evaluate.ts riskyWeeksOf, the cards'
 * rule; by position, so in a league that starts two at a position I stream the second isn't counted either); and whether
 * a player is off in a game's weeks: his NFL team's bye in one of them (PlayerModel.weekly), an IR returner's only from
 * his expected return week (returnWeekOf, with `lastNflWeek`, lastNflWeekOf: before it he's on IR anyway, evaluate.ts
 * riskyWeeksOf's rule; a returner as the engine reads him, so a player the snapshot lists on the active roster and IR
 * alike counts as active, as he did not before), and a player the engine releases from a returner's week to make room only
 * before that week (TeamModel.displaced, displacedWithPickups: after it he isn't my starter; riskyWeeksOf's rule too).
 * Without the team: no players.
 */
export function scheduleByeRule(snapshot: LeagueSnapshot, model: LeagueModel, teamId: string, lastNflWeek: number | undefined): ScheduleByeRule {
  const pickups = oddsCountPickups(model);
  const pool = starterPool(snapshot, model, teamId, pickups);
  const streamed = new Set<Pos>(streamCoveredPositions(model, teamId));
  const starters = likelyStarters(snapshot, model, teamId, { afterPickups: pickups }).filter((id) => !streamed.has(snapshot.players[id]?.pos as Pos));
  // The returners (IR players the model lists with the team and not also on its active roster, as the engine reads them:
  // evaluate.ts riskyWeeksOf's returnersOf) and their expected return weeks (null: not back within the weeks left).
  const back = new Map(pool.returners.map((id) => [id, returnWeekOf(snapshot, model, id, lastNflWeek)]));
  const weekIndex = new Map(model.weeks.map((w, i) => [w, i]));
  const withMe = (id: string, week: number): boolean => {
    const b = back.get(id);
    const g = pool.gone.get(id);
    return (b === undefined || (b !== null && week >= b)) && (g === undefined || week < g);
  };
  return {
    pickups,
    players: [...pool.roster, ...pool.returners],
    starters,
    onBye: (id, weeks) =>
      weeks.some((week) => {
        const i = weekIndex.get(week);
        return i !== undefined && withMe(id, week) && model.players[id]?.weekly[i]?.bye === true;
      }),
  };
}

/**
 * Who counts as a likely starter, in words (likelyStarters), for the schedule's note and the explainer: "players in your
 * best lineup, after your free-agent pickups, in at least half the weeks they play".
 */
function likelyStartersWords(pickups: boolean): string {
  return `players in your best lineup${pickups ? ", after your free-agent pickups," : ""} in at least half the weeks they play`;
}

/**
 * The positions the team streams (LeagueModel.streaming.byTeam) whose streaming replacement covers a likely starter's bye
 * (config.leaguePage.streamCoversBye: K and D/ST; Phase 4c lead decisions, evaluate.ts riskyWeeksOf): a streamed QB's or
 * TE's replacement is much weaker, so their byes still count.
 */
function streamCoveredPositions(model: LeagueModel, teamId: string): Pos[] {
  return (model.streaming?.byTeam[teamId]?.positions ?? []).filter((p) => config.leaguePage.streamCoversBye.includes(p));
}

/**
 * The positions my team streams whose byes the streaming replacement covers (streamCoveredPositions), in words, for the bye
 * count's exception: "kickers and D/STs"; null when there are none (or no team is picked).
 */
function streamedByeWords(model: LeagueModel, teamId: string | null, platform: Platform): string | null {
  const positions = teamId ? streamCoveredPositions(model, teamId) : [];
  return positions.length ? listText(positions.map((p) => positionPlural(p, platform))) : null;
}

/**
 * When a remaining week is flagged risky, completing "A week is flagged risky when …": a win chance under
 * RISKY_WIN_CHANCE (head-to-head leagues only) or RISKY_BYES or more likely starters on bye.
 */
function riskRule(h2h: boolean, chance: string, starters: string): string {
  const byes = `${RISKY_BYES} or more of ${starters} are on bye`;
  return h2h ? `${chance} is under ${pct(RISKY_WIN_CHANCE)}, or when ${byes}` : byes;
}

/**
 * The NFL weeks of my regular-season game that the simulation lists under `week` (Matchup.weeks for an
 * ESPN multi-week matchup, else just that week), from the snapshot's schedule; [week] when not found.
 */
function matchupWeeks(snapshot: LeagueSnapshot, me: string, opponentId: string | null, week: number): number[] {
  for (const m of snapshot.schedule) {
    if (m.isPlayoff) continue;
    const pair = (m.teamA === me && m.teamB === opponentId) || (opponentId !== null && m.teamA === opponentId && m.teamB === me);
    if (!pair) continue;
    const weeks = m.weeks?.length ? [...m.weeks].sort((a, b) => a - b) : [m.week];
    if (weeks.includes(week)) return weeks;
  }
  return [week];
}

/**
 * My remaining schedule (§8 "show each remaining week's risk"; see the header): one row per game of
 * mine in SeasonOdds.weekly, with both teams' projected points summed over the game's remaining weeks
 * (the means the simulation draws around: TeamModel.scoreWithPickups, the headline odds', else TeamModel.score in a
 * model built before Phase 4c), my win chance (and median-game chance), my likely starters on bye (scheduleByeRule:
 * likelyStarters after my free-agent pickups, as the odds count them, ⚠️ none at a position I stream; a starter's bye is
 * his NFL team's bye week among the game's weeks left, a returner's only from his expected return week, as evaluate.ts
 * riskyWeeksOf counts them), and a risk flag in words.
 * The note under it says what the points and chances count, while a week is under way too (pickups from the next week
 * on: the week under way is played with today's rosters), and who counts as a likely starter. Null without odds or once
 * no regular-season week is left to play; no team picked, or none of my games left → `empty`.
 */
function scheduleView(c: OddsContext): ScheduleView | null {
  const odds = c.odds;
  if (!odds || !odds.weekly.length) return null;
  const none = (empty: string): ScheduleView => ({ rows: [], showMedian: false, caption: "", note: "", empty });
  const me = c.myTeamId;
  if (!me) return none("Pick your team to see your remaining games and each week's risk.");
  const settings = c.snapshot.settings;
  const weekIndex = new Map(c.model.weeks.map((w, i) => [w, i]));
  const teamModels = new Map(c.model.teams.map((t) => [t.id, t]));
  // The bye rule (scheduleByeRule, the league report's too): likely starters after my pickups when the odds count them,
  // ⚠️ none at a position I stream (his slot's streaming row starts that week's replacement when he's off: Phase 4c lead
  // decision; evaluate.ts riskyWeeksOf, the cards' rule), a returner's bye only from his expected return week.
  const byeRule = scheduleByeRule(c.snapshot, c.model, me, c.lastNflWeek);
  const pickups = byeRule.pickups;
  // Σ score means over the weeks the model has, the ones the odds beside them draw around; null when it has none of
  // them (or no scores).
  const projected = (teamId: string, weeks: readonly number[]): number | null => {
    const t = teamModels.get(teamId);
    const mean = (t?.scoreWithPickups ?? t?.score)?.mean;
    let total = 0;
    let any = false;
    for (const w of weeks) {
      const i = weekIndex.get(w);
      const x = i === undefined ? undefined : mean?.[i];
      if (x === undefined || !Number.isFinite(x)) continue;
      total += x;
      any = true;
    }
    return any ? total : null;
  };
  const limit = pct(RISKY_WIN_CHANCE);
  // A points-only league's games don't count in the standings (only points do), so a low win chance isn't a risk there.
  const h2h = !settings.pointsOnly;
  const mine = (wk: WeekOdds) => wk.games.find((g) => g.teamId === me);
  const showMedian = settings.medianGame && !settings.pointsOnly && odds.weekly.some((wk) => (mine(wk)?.pMedianWin ?? null) !== null);
  const rows: ScheduleRow[] = [];
  // A fantasy bye week without a game is listed, never flagged: the note then says why.
  let noGameWeek = false;
  for (const wk of odds.weekly) {
    const game = mine(wk);
    if (!game) continue;
    const weeks = matchupWeeks(c.snapshot, me, game.opponentId, wk.week);
    const remaining = weeks.filter((w) => weekIndex.has(w));
    const counted = remaining.length ? remaining : [wk.week];
    const off = byeRule.starters.filter((id) => byeRule.onBye(id, counted));
    const names = off.map((id) => {
      const info = c.snapshot.players[id];
      return { short: info ? shortName(info.name, info.pos) : id, full: info?.name ?? id };
    });
    // Risky as printed: a win chance shown as "40%" isn't "under 40%".
    const winPct = game.pWin === null || !Number.isFinite(game.pWin) ? null : Math.round(game.pWin * 100);
    const low = h2h && winPct !== null && winPct < Math.round(RISKY_WIN_CHANCE * 100);
    // A bye crunch is a risk only in a week that counts for me: a game, a median game, or any week of a
    // points-only league (its points add up). A fantasy bye week without a median game can't move the
    // standings (the simulator plays nothing for a bye), so its byes are listed, not flagged.
    const counts = game.opponentId !== null || game.pMedianWin !== null || settings.pointsOnly;
    if (!counts) noGameWeek = true;
    const many = counts && off.length >= RISKY_BYES;
    const reasons = [...(many ? [`${off.length} starters on bye`] : []), ...(low ? [`under ${limit} to win`] : [])];
    const sentence = many && low ? `${off.length} of your likely starters are on bye, and your chance to win is under ${limit}` : many ? `${off.length} of your likely starters are on bye` : `your chance to win is under ${limit}`;
    const first = weeks[0] ?? wk.week;
    const last = weeks[weeks.length - 1] ?? wk.week;
    const mineProj = projected(me, counted);
    const theirProj = game.opponentId === null ? null : projected(game.opponentId, counted);
    // A multi-week matchup already under way: the simulation plays only its weeks still to play (the
    // points already scored aren't read, season.ts), so the row's numbers cover those weeks alone.
    const played = weeks.filter((w) => !weekIndex.has(w) && w < (c.model.weeks[0] ?? Number.POSITIVE_INFINITY));
    const underWay = [
      ...(played.length ? [`${capitalize(weekList(played))} already played: ${played.length === 1 ? "its" : "their"} points aren't counted, so these numbers cover ${weekList(counted)} only`] : []),
      ...(c.model.inProgressWeek !== null && counted.includes(c.model.inProgressWeek) ? [UNDER_WAY_TEXT] : []),
    ];
    rows.push({
      week: wk.week,
      weekText: first === last ? `${first}` : `${first}–${last}`,
      weekLabel: first === last ? `Week ${first}` : `Weeks ${first}–${last}`,
      opponentId: game.opponentId,
      opponent: game.opponentId === null ? "Bye week" : c.teamName(game.opponentId),
      mine: mineProj === null ? "—" : fmtNum(mineProj, 1),
      theirs: game.opponentId === null ? null : theirProj === null ? "—" : fmtNum(theirProj, 1),
      win: game.opponentId === null ? NO_GAME : oddsCell(game.pWin),
      median: showMedian ? oddsCell(game.pMedianWin) : null,
      byes: names.length ? { text: names.map((n) => n.short).join(", "), title: names.map((n) => n.full).join(", "), count: names.length } : null,
      risk: reasons.length ? { label: "Risky week", reasons: reasons.join(" · "), text: `Risky week: ${sentence}.` } : null,
      underWay: underWay.length ? underWay.join(". ") : null,
    });
  }
  if (!rows.length) return none(h2h ? "Your team has no regular-season games left to play." : "Your league ranks teams by total points, so there's no weekly schedule to show.");
  // While a week is under way the odds count pickups from the next week on (the file header), and so do these numbers.
  const from = teamFrom(c.model);
  const live = from > 0 ? c.model.inProgressWeek : null;
  const next = c.model.weeks[from];
  const pickupsText = !pickups
    ? ""
    : live === null
      ? "Projected points and chances count each team's free-agent pickups that would help, as the odds above do. "
      : next === undefined
        ? `Projected points and chances play week ${live} with today's rosters, without free-agent pickups, as the odds above do. `
        : `Projected points and chances count each team's free-agent pickups that would help from week ${next} on, as the odds above do: week ${live} is played with today's rosters. `;
  // The positions I stream aren't counted on bye (scheduleByeRule).
  const streamedWords = streamedByeWords(c.model, me, c.snapshot.platform);
  const streams = streamedWords ? ` ${capitalize(streamedWords)} don't count: you stream them, so the streaming replacement covers their byes.` : "";
  return {
    rows,
    showMedian,
    caption: `Your remaining regular-season games: the opponent, projected points for you and them, and your chance to win${showMedian ? " and to beat the league median" : ""} each week`,
    note: `${h2h ? "" : "Your league ranks teams by total points, so these games don't change the standings: only your points count. "}${pickupsText}"On bye" names your likely starters who are off that week: ${likelyStartersWords(pickups)}.${streams} A week is flagged risky when ${riskRule(h2h, "your chance to win it", "those starters")}.${noGameWeek ? " A bye week without a game can't change the standings, so it isn't flagged." : ""}${showMedian ? " Median: your chance of a top-half score that week, which counts as a second game." : ""}`,
    empty: null,
  };
}

// ---------------------------------------------------------------------------------------------
// Trade values and notes

interface ValuesShown {
  /** The FantasyCalc format the page names for its values (a keeper league's redraft list), or null without values. */
  label: string | null;
  /** Where that format differs from the league, for the explainer. */
  substitutions: string[];
  /** Everything the page says about the values' format (the server's notes repeating it are dropped). */
  said: string[];
}

/**
 * The values' FantasyCalc format (§2.9, §9). A keeper league's market format is its dynasty list (the
 * future term); the page names its redraft list's format (perception), whose values it never shows (planner
 * reply to Checkpoint 7a, 5.4). Both formats share their size, PPR and TE substitutions and differ in one
 * line saying which list is used, which the explainer's keeper sentence covers, so only the shared ones are listed.
 */
function valuesShown(settings: LeagueSettings, market: FantasyCalcFormat | null): ValuesShown {
  if (!market) return { label: null, substitutions: [], said: [] };
  const keeper = settings.leagueType === "keeper";
  const shown = keeper ? fantasyCalcFormat(settings, "redraft") : market;
  const label = fantasyCalcFormatLabel(shown);
  const substitutions = keeper ? shown.substitutions.filter((s) => market.substitutions.includes(s)) : shown.substitutions;
  return { label, substitutions, said: [label, ...shown.substitutions, ...market.substitutions] };
}

/**
 * The inputs' notes minus what the page already says, filtered like the Import Report's model notes:
 * the server's "Trade values: FantasyCalc <format>." note and its one-per-substitution notes repeat
 * the header's format and the "Trade values" explanation, so a note containing any of that is dropped.
 */
function pageNotes(notes: readonly string[], said: readonly string[]): string[] {
  const shown = said.filter(Boolean);
  return [...new Set(notes.filter((n) => !shown.some((s) => n.includes(s))))];
}

/**
 * How the players FantasyCalc doesn't value got theirs (§9, src/engine/market.ts marketValues): a
 * curve estimate from projected points, or, at a position where FantasyCalc values too few players
 * for a curve (it has no kickers, defenses or IDP), a flat minimum whatever he projects. Says only
 * what this league's players actually got, in words: no value is shown (planner reply to Checkpoint 7a, 5.4; until
 * Phase 7b the page showed the values, estimates marked ~, and named the flat minimum). In FantasyCalc's curve fallback
 * (`curve`: every value is our estimate, and the "Trade values" explainer says so first) only the flat minimum is left to
 * explain: never "Players FantasyCalc doesn't value get our estimate", which would say the others are FantasyCalc's.
 */
function unvaluedText(snapshot: LeagueSnapshot, model: LeagueModel, curve = false): string {
  let estimates = false;
  const floorPositions = new Set<Pos>();
  for (const [id, pm] of Object.entries(model.players)) {
    if (pm.value?.source === "estimate") estimates = true;
    if (pm.value?.source !== "floor") continue;
    const pos = snapshot.players[id]?.pos;
    if (pos) floorPositions.add(pos);
  }
  const estimate = "Players FantasyCalc doesn't value (it skips deep bench players) get our estimate from their projected points";
  let floor = "";
  if (floorPositions.size) {
    const positions = listText(POSITIONS.filter((p) => floorPositions.has(p)).map((p) => posLabel(p, snapshot.platform)));
    floor = curve
      ? `At ${positions}, FantasyCalc's list values too few players to fit a curve, so each gets a flat minimum value, whatever he projects`
      : `At ${positions}, FantasyCalc values too few players to estimate from, so those without a FantasyCalc value get a flat minimum value, whatever they project`;
  }
  if (curve) return floor ? ` ${floor}.` : "";
  if (estimates && floor) return ` ${estimate}. ${floor}.`;
  if (estimates) return ` ${estimate}.`;
  if (floor) return ` ${floor}.`;
  return "";
}

// ---------------------------------------------------------------------------------------------
// Projection source

interface ProjectionSource {
  /** The header's "Projected points: …". */
  label: string;
  /** Completes "A player's points per game start from …". */
  from: string;
  /** Sleeper's weekly projections loaded for someone (the matchup adjustment comes from them). */
  sleeperWeekly: boolean;
}

/**
 * Where the base rates actually came from (§6 step 1; model.projection.sources counts players by
 * source), rather than assuming Sleeper: ESPN's own projections carry an ESPN league when Sleeper's
 * didn't load, and Sleeper's season projections or points so far are last resorts.
 */
function projectionSource(snapshot: LeagueSnapshot, model: LeagueModel): ProjectionSource {
  const s = model.projection.sources;
  const agreement = model.projection.agreement;
  const sleeper = s.sleeper + s["espn+sleeper"];
  const espnAlone = s.espn;
  const scored = "scored with your league's rules";
  const espnFor = espnAlone ? `ESPN's own for ${plural(espnAlone, "player")} Sleeper doesn't project` : "";
  if (model.projection.espnAveraged && s["espn+sleeper"] > 0) {
    return {
      label: "ESPN and Sleeper, averaged",
      from: `Sleeper's projection, ${scored}, averaged with ESPN's own projection (they agree within ${pct(agreement?.meanRelDiff ?? 0)} on average this week)${espnFor ? `; ${espnFor}` : ""}`,
      sleeperWeekly: true,
    };
  }
  if (sleeper > 0 && sleeper >= espnAlone) {
    let from = `Sleeper's projection, ${scored}${espnFor ? ` (${espnFor})` : ""}`;
    if (snapshot.platform === "espn" && agreement) {
      from += `. ESPN's own projections differ from Sleeper's by ${pct(agreement.meanRelDiff)} on average this week, more than the ${pct(config.projections.espnSleeperAgreement)} we allow, so we don't average them in`;
    }
    return { label: "Sleeper", from, sleeperWeekly: true };
  }
  if (espnAlone > 0) {
    return { label: "ESPN", from: `ESPN's own projection, in your league's scoring (Sleeper's projections ${sleeper ? `cover only ${plural(sleeper, "player")}` : "didn't load"})`, sleeperWeekly: sleeper > 0 };
  }
  if (s.season > 0) return { label: "Sleeper's season projections", from: `Sleeper's season projection per game, ${scored} (its weekly projections didn't load)`, sleeperWeekly: false };
  if (s.actual > 0) return { label: "points scored so far", from: "his points per game so far (no projections loaded)", sleeperWeekly: false };
  return { label: "none loaded", from: "his projection, but none loaded", sleeperWeekly: false };
}

// ---------------------------------------------------------------------------------------------
// Explainer

function injuryTableText(): string {
  const inj = config.projections.injury;
  const out = inj.OUT.map((a, i) => `${pct(a)} ${i === 0 ? "this week" : i === 1 ? "next week" : `in ${i} weeks`}`).join(", ");
  return `Out: ${out}; Doubtful ${pct(inj.DOUBTFUL[0] ?? 0)}, Questionable ${pct(inj.QUESTIONABLE[0] ?? 0)} and Probable ${pct(inj.PROBABLE[0] ?? 0)} this week; IR: out until his expected return, or ${inj.irUnknown.outWeeks} weeks when none is known`;
}

function missShareText(): string {
  const m = config.projections.injuryRisk.missShare;
  return (["RB", "TE", "WR", "QB", "K"] as const).map((p) => `${p} ${pct(m[p])}`).join(", ");
}

interface ExplainContext {
  snapshot: LeagueSnapshot;
  model: LeagueModel;
  values: ValuesShown;
  keeper: boolean;
  source: ProjectionSource;
  /** The first model week team numbers count (teamFrom). */
  from: number;
  /** Playoff weeks are among the weeks team numbers count, so lineup points weight them. */
  playoffWeighted: boolean;
  /** ω for playoff weeks as the page prints it (playoffWeightLabel of LeagueModel.playoffWeight: "2.0"). */
  playoffWeight: string;
  /** How ω was set (LeagueModel.playoffWeightAuto.basis): "auto" from my odds, "fallback" the default; absent in an older model. */
  playoffWeightBasis: "auto" | "fallback" | null;
  /** The season simulation, when it ran (§8). */
  odds: SeasonOdds | null;
  /** My remaining schedule is shown (a team is picked and games are left), so its risk rule is explained too. */
  schedule: boolean;
  /** FantasyCalc's fallback (MarketInputs.fallback; the file header), or null when FantasyCalc answered. */
  fallback: MarketInputs["fallback"] | null;
  /** The standings card shows my odds as rosters stand under the headline (StandingsView.mine), so the explainer points to them. */
  asRostersStandShown: boolean;
}

const TIEBREAKER_WORDS: Record<SeasonOdds["tiebreaker"]["rule"], string> = {
  pointsFor: "points for",
  headToHead: "head-to-head record",
  divisionRecord: "division record",
};

/**
 * Whether the league's division rule (division winners seeded first, or not) is an assumption, as the
 * simulation reads it (season.ts buildSimSetup's divisionRuleAssumed, which SeasonOdds doesn't carry): the
 * league has 2+ divisions and either reports no playoff seeding at all or its adapter warned that the
 * platform doesn't say (DIVISION_RULE_ASSUMED: Sleeper's help center covers only some division and playoff
 * layouts, so the rest are inferred readings; ESPN's documents its rule, so only a snapshot an older ESPN
 * adapter normalized carries such a warning).
 */
function divisionRuleAssumed(snapshot: LeagueSnapshot): boolean {
  const s = snapshot.settings;
  if ((s.divisions?.length ?? 0) < 2) return false;
  if (s.playoffSeeding === undefined) return true;
  return snapshot.warnings.some((w) => DIVISION_RULE_ASSUMED.some((d) => d.code === w.code && (d.platformPath === undefined || d.platformPath === w.platformPath)));
}

/**
 * "Playoff odds" in "How these numbers work" (§8): seasons simulated, weekly scores drawn around the
 * projected lineups with their spread (Phase 4c: each team's lineup after the free-agent pickups that would help it,
 * the starting point trade ideas use, with the odds as rosters stand under mine), today's records, the league's seeding
 * rule (and what's assumed), the playoff spots, byes and bracket (or where the title goes without a bracket: 0 or 1
 * playoff team, worded like the engine's note), the odds the standings show (oddsShown), common random numbers, and
 * the schedule's risk rule.
 */
function oddsExplainText(c: ExplainContext, odds: SeasonOdds): string {
  const s = c.snapshot.settings;
  const scen = c.model.scenarios;
  const pickups = oddsCountPickups(c.model);
  const asStands = c.asRostersStandShown ? " Your odds as rosters stand, with no team's pickups, are the smaller line under yours." : "";
  const draws = `Each week, every team's score is drawn around its projected starting lineup${scen ? ` (its average over the ${scen} simulated runs of injuries and byes)` : ""}, with a spread that covers its starters' week-to-week swings${scen ? " and how much injuries and byes could change the lineup" : ""}.${pickups ? ` Every team's lineup counts the free-agent pickups that would help it (listed on its roster); trade ideas start from these same odds.${asStands}` : ""}`;
  const assumedRule = odds.tiebreaker.assumed ? " (assumed: the platform doesn't say which tiebreaker your league uses)" : "";
  // Worded like the tiebreaker and the bracket: an inferred rule reads as one (the standings notes say so too).
  const divisionsFirst =
    s.playoffSeeding?.divisionWinnersFirst && (s.divisions?.length ?? 0) >= 2 ? `, with division winners seeded first${divisionRuleAssumed(c.snapshot) ? " (assumed: the platform doesn't say)" : ""}` : "";
  const ranking = s.pointsOnly
    ? "Each simulated season ranks teams by total points."
    : `Each simulated game adds to today's records${s.medianGame ? ", as does a weekly game against the league median (a win for a top-half score)" : ""}. Each simulated season is then ranked by your league's rules: win percentage, then ${TIEBREAKER_WORDS[odds.tiebreaker.rule]}${assumedRule}${divisionsFirst}.`;
  const n = odds.playoffTeams;
  const byes = odds.byes > 0 ? `, and the top ${odds.byes === 1 ? "seed gets" : `${odds.byes} seeds get`} a first-round bye` : "";
  const assumedBracket = odds.reseed.assumed ? " (assumed: the platform doesn't say)" : "";
  const bracket = odds.reseed.value ? ` After each round the teams left are re-seeded, best seed against worst${assumedBracket}.` : ` The bracket is fixed: no re-seeding after each round${assumedBracket}.`;
  const playoffs =
    n > 2
      ? `The top ${n} make the playoffs${byes}.${bracket}`
      : n === 2
        ? "The top 2 make the playoffs and meet for the title."
        : n === 1
          ? "One team makes the playoffs, so the title goes to the top of the final standings."
          : "There are no playoffs, so the title goes to the top of the final standings.";
  const shown = oddsShown(odds);
  // Checkpoint 7c: my odds show a top-N finish under "Several prizes" paying 2nd or 3rd place (myOddsOf), so how those
  // places are decided is said too (placesWords).
  const places = topPlacesOf(c.model.reward);
  const chances = listText([...(shown.playoffs ? ["a playoff spot"] : []), ...(shown.bye ? ["a bye"] : []), ...(places ? [`a top-${places} finish`] : []), "the title"], "or");
  const starters = `your likely starters (${likelyStartersWords(pickups)})`;
  // The positions I stream aren't counted on bye (scheduleView; evaluate.ts riskyWeeksOf).
  const streamedWords = streamedByeWords(c.model, c.model.myTeamId ?? null, c.snapshot.platform);
  const streamed = streamedWords ? `, not counting ${streamedWords}, whose byes the streaming replacement covers since you stream them` : "";
  const risk = c.schedule ? ` Your remaining schedule flags a week as risky when ${riskRule(!s.pointsOnly, "your chance to win it", starters)}${streamed}.` : "";
  return `We play out the rest of the season ${fmtWhole(odds.sims)} times. ${draws} ${ranking} ${playoffs}${placesWords(odds, places)} A team's chance of ${chances} is the share of those seasons where it happened. Each time the odds are worked out, every team and week gets the same random draws (common random numbers), so when trade ideas compare the odds before and after a trade, the difference comes from the trade, not from the luck of the draw.${risk}`;
}

/**
 * How 2nd and 3rd place are decided, for "Playoff odds" in "How these numbers work" when my odds show a top-N finish (the
 * file header; Checkpoint 7c, planner reply to Checkpoint 7b, §6: "2nd place: the losing finalist", "3rd place: simulate the
 * 3rd-place game when the league has one"), by the simulator's rules (sim.ts "Places"; SeasonOdds.thirdPlace): 2nd the
 * final's loser; 3rd the winner of the semifinal losers' game (said assumed when the league doesn't say: the Import Report's
 * "3rd-place game" row), or the better seed of the two when the league has none (⚠️ ours, said so); with 3 playoff teams the
 * one semifinal's loser, with 2 the best team that misses the playoffs, and with none or one both places by the final
 * standings. "" when no top-N finish shows (`places` null).
 */
function placesWords(odds: SeasonOdds, places: 2 | 3 | null): string {
  if (!places) return "";
  const n = odds.playoffTeams;
  if (n <= 1) return places === 3 ? " 2nd and 3rd place go to the next teams in the final standings." : " 2nd place goes to the next team in the final standings.";
  const second = "2nd place goes to the final's loser";
  if (places === 2) return ` ${second}.`;
  let third: string;
  if (n === 2) third = "3rd to the best team that misses the playoffs";
  else if (n === 3) third = "3rd to the loser of the only semifinal (the top seed has a bye)";
  // The league plays no 3rd-place game (its data says so); who takes 3rd then is our assumption (review of the prizes UI,
  // prizes-ui-2: the words read as if the missing game were assumed).
  else if (odds.thirdPlace?.rule === "bySeed") third = "3rd to the better seed of the two semifinal losers (our assumption, since your league plays no 3rd-place game)";
  else third = `3rd to the winner of a game between the two semifinal losers${(odds.thirdPlace?.assumed ?? true) ? " (assumed: your league doesn't say whether it plays one)" : ""}`;
  return ` ${second}, and ${third}.`;
}

/**
 * The market blend in "Projected points" (§6 step 8; PlayerModel.blend): the positions of the players it reached, how far
 * it pulls (the weight) and toward what, per game (byes and injuries stay the model's), how far at most (Phase 4c:
 * config.marketBlend.factorClamp), and which values it reads in a dynasty league (this season's, not the dynasty values
 * Offer Sheet uses for long-term worth, which no page shows: planner reply to Checkpoint 7a, 5.4), and that a player's
 * breakdown says which way his leans (blendText: in words, never a number); "" when it reached nobody (no values, or none
 * at a blended position), but in FantasyCalc's curve fallback (`curve`), where it says the projections aren't pulled toward
 * the market while the values are our own.
 */
function blendExplainText(snapshot: LeagueSnapshot, model: LeagueModel, curve = false): string {
  let weight = 0;
  const positions = new Set<Pos>();
  for (const [id, pm] of Object.entries(model.players)) {
    if (!pm.blend) continue;
    weight = pm.blend.weight;
    const pos = snapshot.players[id]?.pos;
    if (pos) positions.add(pos);
  }
  if (!positions.size) return curve ? " While FantasyCalc is unavailable, projections aren't pulled toward the trade market: the values are our own estimates." : "";
  const who = listText(POSITIONS.filter((x) => positions.has(x)).map((x) => `${posLabel(x, snapshot.platform)}s`));
  const value =
    snapshot.settings.leagueType === "dynasty" ? "a FantasyCalc trade value this season (its redraft values, not the dynasty values Offer Sheet uses for long-term worth)" : "a FantasyCalc trade value";
  const cap = blendCapWords();
  return ` Then, for ${who} with ${value}, points per game are pulled ${blendHowFar(weight)} toward what our model gives healthy players with about the same trade value, at most ${cap.up} up or ${cap.down} down, so a projection the trade market disagrees with counts for less; byes and injuries stay as projected (a player's breakdown says which way his leans).`;
}

/**
 * "Trade values" in "How these numbers work" (§9; the file header, "FantasyCalc's fallbacks"): FantasyCalc's values in
 * the league's format, from a saved list's day when one stands in, or every value our own estimate in the curve
 * fallback (no long-term value in dynasty and keeper leagues then: benefit.futureValuesLoaded); that Offer Sheet uses
 * them in its own numbers and never shows them (planner reply to Checkpoint 7a, 5.4: VALUES_HIDDEN_TEXT, the privacy
 * policy's words); a keeper league's two lists; the format's substitutions; and how players FantasyCalc doesn't value got
 * theirs (unvaluedText).
 */
function valuesExplainText(c: ExplainContext): string {
  const { snapshot, model, values, fallback } = c;
  if (!values.label) return "FantasyCalc's values couldn't be loaded, so trade values are missing for now. Refresh to try again.";
  const day = fallback ? (noteDay(fallback.listDate) ?? "an earlier day") : "";
  const substitutions = values.substitutions.length ? ` Where your league doesn't match one of FantasyCalc's formats exactly: ${values.substitutions.join("; ")}.` : "";
  if (fallback?.kind === "curve") {
    const longTerm = snapshot.settings.leagueType === "redraft" ? "" : " Long-term value is left out of trade ideas until FantasyCalc is back: our estimates say nothing about later seasons.";
    return `Every trade value is our own estimate for now (the note at the top of the page says why), in your league's format (${values.label}): each player's comes from his projected points for the rest of the season, on a curve fitted to FantasyCalc's list from ${day}. ${VALUES_HIDDEN_ESTIMATED_TEXT}${longTerm}${substitutions}${unvaluedText(snapshot, model, true)}`;
  }
  const saved = fallback?.kind === "saved" ? `, from its list of ${day}: FantasyCalc didn't answer this time, so the newest list we saved stands in` : "";
  const keeper = c.keeper
    ? model.market.format?.isDynasty === false
      ? " In a keeper league these are its redraft values, how managers see a trade this season; its dynasty values, for long-term worth, didn't load this time."
      : " In a keeper league these are its redraft values, how managers see a trade this season; its dynasty values, for long-term worth, come into play with trade suggestions."
    : "";
  return `Trade values come from FantasyCalc in your league's format (${values.label})${saved}. ${VALUES_HIDDEN_TEXT}${keeper}${substitutions}${unvaluedText(snapshot, model)}`;
}

/**
 * A playoff-week weight as the page prints it, one decimal (planner reply to Checkpoint 7a, §6.1): "2.0", "1.3" (the
 * fallback 1.25), "0.5". The Settings page prints it the same (src/components/settings/settingsView.ts playoffWeightText;
 * src/components/settings/settingsView.test.ts checks the two agree).
 */
export function playoffWeightLabel(omega: number): string {
  return Number.isFinite(omega) ? omega.toFixed(1) : "1.0";
}

/**
 * Where the playoff weight comes from, in the explainer's brackets (the file header): set from my odds (it can be below 1:
 * a playoff week's points can matter less than a regular-season week's), or the default when it couldn't be measured;
 * null (no brackets) for a model that doesn't say (built before Phase 7b, without LeagueModel.playoffWeightAuto).
 */
function playoffWeightWhy(basis: "auto" | "fallback" | null): string | null {
  if (basis === "fallback") return "the default weight: it couldn't be set from your odds this time";
  if (basis === "auto") return "set automatically from how much a point in a playoff week moves your odds next to one in a regular-season week";
  return null;
}

/**
 * A trade chip's least gap as the model judged it, one decimal: LeagueModel.lineupThresholds (config.needs.chipMinGap × Σω ÷ Σω₀
 * under the automatic playoff weight, league.ts step 5c; review of the engine track, Phase 7b), else config's.
 */
function chipMinGapText(model: Pick<LeagueModel, "lineupThresholds">): string {
  return fmtNum(model.lineupThresholds?.chipMinGap ?? config.needs.chipMinGap, 1);
}

function buildExplain(c: ExplainContext): ExplainItem[] {
  const { snapshot, model } = c;
  const p = config.projections;
  const weeks = model.weeks;
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  const seasonOver = weeks.length === 0;
  const matchup = seasonOver
    ? ""
    : c.source.sleeperWeekly
      ? ` Each week is then adjusted for the matchup (between ${p.weekShapeClamp[0]}× and ${p.weekShapeClamp[1]}× his usual).`
      : " There's no week-to-week matchup adjustment: it comes from Sleeper's weekly projections, which didn't load.";
  const why = playoffWeightWhy(c.playoffWeightBasis);
  const lineupPoints = `starting-lineup points over the rest of the season${c.playoffWeighted ? `, with playoff weeks counted ${c.playoffWeight}×${why ? ` (${why})` : ""}, so they don't add up exactly with ROS points` : ""}`;
  // The pickups' gains count each week once (planner reply to Checkpoint 7b, Q6), so while lineup cost weights the playoff
  // weeks the two are said apart; otherwise they're the same points.
  const lineupUnits = c.playoffWeighted
    ? `Lineup cost is in lineup points: ${lineupPoints}. The gains of each team's free-agent pickups (listed on its roster) are starting-lineup points with each week counted once, like Waiver upgrades.`
    : `Lineup cost and the gains of each team's free-agent pickups (listed on its roster) are in lineup points: ${lineupPoints}.`;
  const items: ExplainItem[] = [
    {
      title: "Projected points",
      text: seasonOver
        ? "The season is over, so nothing is projected: projections aren't requested once no fantasy weeks are left."
        : `A player's points per game start from ${c.source.from}. Recent form counts too: up to ${pct(p.actualWeight)} once he has played ${p.actualFullGames} games.${matchup}${blendExplainText(snapshot, model, c.fallback?.kind === "curve")}`,
    },
    {
      title: "Availability",
      text: `Each week's points are multiplied by the chance he plays: 0 on his bye; for a current injury, ${injuryTableText()}; and the chance of a new injury, which grows the further ahead you look, toward each position's long-run share of games missed (${missShareText()}).`,
    },
    {
      title: "Depth counts",
      text: model.scenarios
        ? `Team numbers use each team's best lineup in ${model.scenarios} simulated runs of injuries and byes, so a bench player who fills in when a starter is hurt or on bye gets credit. A lineup built from average availability would miss that.`
        : "Team numbers use each team's best lineup from each week's average projections.",
    },
    ...(seasonOver
      ? []
      : [
          { title: "Streaming", text: streamingExplainText(snapshot, !!model.faAllocation) },
          { title: "Free-agent pickups", text: pickupsExplainText(snapshot, model, c.fallback?.kind === "curve", c.playoffWeighted ? c.playoffWeight : null) },
        ]),
    {
      title: "Rest-of-season (ROS) points",
      text:
        first !== undefined && last !== undefined
          ? `ROS points count only the games left, from week ${first} through week ${last}${model.playoffWeeks.length ? " (the last playoff week), split into regular season and playoffs" : ""}. A player whose bye is done has one more game left than one whose bye is still coming. ${lineupUnits} Lineup cost is how many his team would lose without him, after its free-agent pickups (it would pick up a free agent in his place when that helps); it's never negative.`
          : "The season is over, so there are no games left to project.",
    },
  ];
  const inProgress = c.from > 0 ? model.inProgressWeek : null;
  if (inProgress !== null) {
    const next = weeks[c.from];
    items.push({
      title: `Week ${inProgress} is under way`,
      text: `Once a week's first game kicks off, the team numbers (points per week, team ROS points, positional strength, needs, lineup cost, free-agent pickups, trade chips and partners) ${next === undefined ? "have no full week left to count" : `count from the next week, week ${next}`}: lineups are locking and week ${inProgress}'s points are being scored, so it no longer says how good a team is. A player's own ROS points still count his week ${inProgress} game if it hasn't kicked off; one that has shows "Game already started".${c.odds ? ` The playoff odds still play all of week ${inProgress}'s games from projections, as if none had started: live scores aren't read yet, and the rosters and injury news are today's${oddsCountPickups(model) ? ", without free-agent pickups" : ""}.${oddsCountPickups(model) && next !== undefined ? ` Each team's free-agent pickups count from week ${next} on.` : ""}` : ""}`,
    });
  }
  if (c.odds) items.push({ title: "Playoff odds", text: oddsExplainText(c, c.odds) });
  items.push(
    {
      title: "Trade values",
      text: valuesExplainText(c),
    },
    {
      title: "Needs, trade chips and partners",
      text: `A need is a lineup slot where a team's starter is at least ${Math.abs(config.lineups.needZThreshold)} standard deviations below the league median, for the rest of the season or just the next ${config.lineups.strengthWeeks} weeks. A trade chip is a player worth at least ${chipMinGapText(model)} more lineup points to another team than to his own: what he'd add to that team's lineup, measured after its free-agent pickups (so a pickup it could make anyway doesn't count, while one his arrival makes possible does), minus what his own team would lose without him.${excludedText(snapshot)} Trade partners are teams whose trade chips would start for you while yours would start for them; teams with a trade chip who would start for you, when none of yours would start for them, come after them.`,
    },
  );
  // A model built before the planner's addendum has no premiums, so nobody is marked.
  if (model.teams.some((t) => t.premiums)) items.push({ title: HARDER_TO_GET_TAG, text: harderExplainText(c.fallback?.kind === "curve") });
  return items;
}

/**
 * "Harder to get" in "How these numbers work" (the file header), from config.acceptance.starPremium (tradeView.ts
 * harderToGetWho: his team's two most valuable players by default, among the top 12), that the chance they accept counts
 * it, how partner cards lead (with N12's floor, config.needs.bestTargetMin), and that mine are never marked. Whose top 12:
 * FantasyCalc's list in the league's format, or, in FantasyCalc's curve fallback (`curve`), our own estimates (premium.ts
 * eliteIds ranks the model's values then; review of track UIP).
 */
function harderExplainText(curve = false): string {
  const list = curve ? "our own estimates while FantasyCalc is unavailable" : "FantasyCalc's, in your league's format";
  return `Managers value their own best players a bit above their trade value. Another team's player marked ${HARDER_TO_GET_TAG} is ${harderToGetWho("his team's")} (${list}), so expect his manager to want a little extra for him: trade ideas count that in the chance they accept. Partner cards lead with the best of their trade chips: the unmarked one who'd add the most to your lineup, if he adds at least ${bestTargetMinWords()} a week. A marked player who'd add more than any unmarked one is named next, or alone when no unmarked one adds that much (he too has to add at least ${bestTargetMinWords()} a week to lead). Your own players are never marked.`;
}

/**
 * "Streaming" in "How these numbers work" (§7 streaming positions): what streaming is, how a streamed slot
 * counts (the replacement's rank from config.streaming), where it counts, the setting and its default, how
 * another team is detected (Phase 7a, A4: never an inactive one, where the model allocates free agents: `allocated`),
 * and one streamer per position.
 */
function streamingExplainText(snapshot: LeagueSnapshot, allocated: boolean): string {
  const platform = snapshot.platform;
  const s = config.streaming;
  // Inactive teams (planner reply to Checkpoint 4c, A4; league.ts streamedPositions): no streaming either, where the model
  // allocates free agents (the pickups explainer states the rule).
  const n = config.allocation.inactiveWeeks;
  const unlessInactive = allocated && n > 0 ? `, unless it has made no transactions in the last ${plural(n, "week")}` : "";
  const defaults = positionsText(POSITIONS.filter((p) => s.defaultPositions.includes(p)), platform);
  const options = positionsText(POSITIONS.filter((p) => s.streamable.includes(p) && !s.defaultPositions.includes(p)), platform);
  return `Many managers stream ${positionPlural("K", platform)} and ${positionPlural("DEF", platform)}: each week they pick up whichever free agent is projected highest. A streamed slot counts, each week, the better of the team's own player and the ${ordinal(s.streamRank)}-best free agent at that position that week (other teams stream too), in every team number: points per week, positional strength and needs, lineup cost, trade chips, partners and the playoff odds. You choose the positions you stream in Settings (${defaults} unless you change it${options ? `; ${options} can be added` : ""}). Another team counts as streaming a position once it has made ${s.detectAdds} or more adds there this season${unlessInactive}; the others count only their own players. A team that starts two at a position still gets one streamer.${streamFlexText(s.streamable, snapshot.settings, platform)}`;
}

/**
 * "Free-agent pickups" in "How these numbers work" (§7 V*): how the optimizer picks (one move at a time, the most lineup
 * points in the lineups it judges moves in: with injuries and byes simulated, so depth counts, when it judges in scenario
 * lineups, else projected lineups (pickupsJudgedInScenarios; review of Phase 4), at least the model's faMinGain (one
 * decimal: LeagueModel.lineupThresholds, config's × Σω ÷ Σω₀ under the automatic playoff weight), at most faMaxMoves),
 * ⚠️ whom a pickup drops in a near-tie (config.lineups.dropNearTieWeekly; optimizer.ts's header; verification of the final
 * review of Phase 4c, finding VF-1: only where the engine applies it, without the dynasty guard's long-term values),
 * what it never touches, the dynasty guard in dynasty and keeper leagues (only when their dynasty values loaded, as the
 * engine applies it: benefit.futureValuesLoaded, a dynasty format with values; otherwise the text says the check is
 * off: review of track A2), that every team number trades are judged by starts from those rosters, the inactive teams'
 * rule where free agents are allocated (Phase 7a, A4; and, when the league's transactions can't tell, acceptance.
 * inactiveRuleBlock "missing" or "partnerUnknown", that no team is treated so this time: review of track AL, finding AL-1),
 * and the known approximation. While the playoff weeks are weighted (`weighted`: ω as the page prints it, "2.0"; null when
 * it prints "1.0" or no playoff week counts), the bar names its weighting and that the gains listed count each week once
 * (planner reply to Checkpoint 7b, Q6), so a "+3.3" under "at least 3.5" reads right; ⚠️ "one can be under" only when ω
 * is above 1 (ours: below 1 a listed gain is under the bar only if the pickup costs in the playoff weeks). ⚠️ And,
 * whatever the weighting, that each gain is counted after the pickups above it, where Waiver upgrades counts each pickup
 * alone (review of Q6: "one number in both places" holds for a team's first pickup only), when a team can make more than
 * one.
 */
function pickupsExplainText(snapshot: LeagueSnapshot, model: LeagueModel, curve = false, weighted: string | null = null): string {
  const o = config.freeAgentOptimizer;
  const platform = snapshot.platform;
  // FantasyCalc's curve fallback (`curve`; the file header): the dynasty list is only a curve's calibration then, so the
  // engine has no long-term values and no guard (benefit.futureValuesLoaded).
  const guardOn = model.market.format?.isDynasty === true && model.market.topValue > 0 && !curve;
  const dynasty =
    snapshot.settings.leagueType === "redraft"
      ? ""
      : guardOn
        ? " In a dynasty or keeper league, a player worth clearly more in dynasty value than the free agent is never dropped for him."
        : curve
          ? " In a dynasty or keeper league, a player worth clearly more in dynasty value than the free agent is normally never dropped for him, but while the values are our own estimates (FantasyCalc is unavailable) that check is off."
          : " In a dynasty or keeper league, a player worth clearly more in dynasty value than the free agent is normally never dropped for him, but this league's dynasty values didn't load this time, so that check is off.";
  const most = pickupsJudgedInScenarios(snapshot, model)
    ? "the most lineup points with injuries and byes simulated (so a backup who'd start when a starter is hurt or on bye counts)"
    : "the most projected lineup points";
  // One free agent, one team (§7; planner reply to Checkpoint 4, change 3): a model built before Phase 4b measured each team alone.
  // Inactive teams (planner reply to Checkpoint 4c, A4): the engine's rule, in words, where it applies (an allocation).
  const n = config.allocation.inactiveWeeks;
  const block = inactiveRuleBlock(snapshot, n);
  const unsure = block === "missing" || block === "partnerUnknown" ? " Right now no team is treated that way: some of this league's transactions didn't load or came back incomplete, so every team is assumed to make its pickups." : "";
  const inactiveRule = n > 0 ? ` A team with no transactions in the last ${plural(n, "week")} (in the first weeks of the season: none this season) is assumed to make no pickups and to stream nothing; your team always counts as active.${unsure}` : "";
  const shared = model.faAllocation
    ? ` Each free agent goes to one team only, ${allocationHow(model.faAllocation.basis)}: each team picks from the free agents the teams before it left, and in a trade the two teams pick again from the ones every other team left.${inactiveRule}`
    : " Each team is measured on its own, so two teams may count on the same free agent.";
  // ⚠️ Near-ties in whom a pickup drops (optimizer.ts's header; verification of the final review of Phase 4c, finding VF-1),
  // where the engine applies them: without long-term values (the dynasty guard off), as roster legality does.
  const tie = config.lineups.dropNearTieWeekly;
  const nearTie = !guardOn && Number.isFinite(tie) && tie > 0 ? ` When the player it would drop has trade value and dropping a less valuable one instead costs at most ${fmtNum(tie)} points a week, the less valuable one goes (any player worth less than the best free agent no team is expected to pick up counts as worth that much), so a pickup can add a little less.` : "";
  // The bar is in the optimizer's points, playoff weeks counted by ω; the gains listed count each week once (planner reply
  // to Checkpoint 7b, Q6).
  const bar = fmtNum(model.lineupThresholds?.faMinGain ?? o.faMinGain, 1);
  const barText = weighted ? `${bar} lineup points with playoff weeks counted ${weighted}×` : bar;
  const omega = model.playoffWeight ?? config.lineups.playoffWeight;
  const listed = weighted ? `; the gains listed count each week once, like Waiver upgrades${omega > 1 ? `, so one can be under ${bar}` : ""}` : "";
  // Each gain is counted after the pickups above it (the optimizer's order), where Waiver upgrades prices each pickup alone
  // from my roster as it stands, so after the first the two can differ (review of Q6).
  const order = o.faMaxMoves > 1 ? " Each pickup's gain is counted after the pickups above it, so a later pickup of yours can show a different gain in Waiver upgrades, which counts each pickup alone, from your roster as it stands." : "";
  return `Each team is measured after the free-agent pickups that would help it, made one at a time: each time the add (dropping a player, or into an open roster spot) that adds ${most}, as long as it adds at least ${barText}, up to ${plural(o.faMaxMoves, "pickup")}${listed}.${order}${nearTie} ${capitalize(positionPlural("K", platform))} and ${positionPlural("DEF", platform)} are never picked up (they're streamed or kept), nor is a position the team streams, and a player its starting lineup needs is never dropped.${dynasty} Lineup cost, trade chips and partners all start from those rosters, so a trade never gets credit for a pickup a team could make anyway.${shared}`;
}

/** How free agents are shared out (LeagueModel.faAllocation.basis), in words: the waiver order, FAAB, or the biggest gain first. */
function allocationHow(basis: NonNullable<LeagueModel["faAllocation"]>["basis"]): string {
  if (basis === "waiver") return "in your league's waiver order";
  if (basis === "faab") return "in FAAB order (the most budget left first)";
  return "the team that gains the most from its best pickup first (your league's waiver order wasn't available)";
}

/**
 * The lines above the rosters (LeagueView.pickupsNote; the file header): how free agents are shared out, where my team
 * picks ("Your team picks 4th of 10."), and the order used, word for word the Import Report's "Waiver order used" row
 * (importReport.ts waiverOrderText; Phase 4c, planner reply to Checkpoint 4b, change 5) when its reading of the snapshot
 * (allocationBasis, the engine's rule restated) is the allocation's basis; else the basis in words, as before. Null
 * without an allocation (a model built before Phase 4b) or without teams. Phase 7a (planner reply to Checkpoint 4c, A4;
 * review of track AL, finding AL-3): the teams in `inactive` keep their place in the order but claim nobody, so with any
 * of them in it my place counts only the others ("Your team picks 1st of the 3 teams expected to make pickups.").
 */
function pickupsNoteOf(snapshot: LeagueSnapshot, model: LeagueModel, myTeamId: string | null, inactive: ReadonlySet<string>): LeagueView["pickupsNote"] {
  const a = model.faAllocation;
  if (!a || !a.order.length) return null;
  const claiming = a.order.filter((id) => !inactive.has(id));
  const place = myTeamId ? claiming.indexOf(myTeamId) : -1;
  const mine =
    place < 0
      ? ""
      : claiming.length === a.order.length
        ? ` Your team picks ${ordinal(place + 1)} of ${a.order.length}.`
        : claiming.length === 1
          ? " Your team is the only one expected to make pickups."
          : ` Your team picks ${ordinal(place + 1)} of the ${claiming.length} teams expected to make pickups.`;
  const waiverOrder = allocationBasis(snapshot) === a.basis ? waiverOrderText(snapshot) : null;
  return {
    text: waiverOrder ? `Free-agent pickups: each free agent goes to one team only.${mine}` : `Free-agent pickups: each free agent goes to one team only, ${allocationHow(a.basis)}.${mine}`,
    waiverOrder,
  };
}

const EXCLUDED_WORDS: Partial<Record<Pos, string>> = { K: "kickers", P: "punters", DEF: "team defenses", DL: "defensive players", LB: "defensive players", DB: "defensive players" };

/** " Kickers and team defenses aren't trade chips …" for the positions trade search leaves out (§9) that this league starts; "" when none. */
function excludedText(snapshot: LeagueSnapshot): string {
  const started = new Set(snapshot.settings.lineup.filter((s) => s.count > 0).flatMap((s) => s.eligible));
  const words = [...new Set(config.market.tradeSearchExcluded.filter((p) => started.has(p)).map((p) => EXCLUDED_WORDS[p] ?? posLabel(p, snapshot.platform)))];
  if (!words.length) return "";
  const text = listText(words);
  return ` ${text.charAt(0).toUpperCase()}${text.slice(1)} aren't trade chips: trade suggestions leave them out.`;
}

// ---------------------------------------------------------------------------------------------

export function buildLeagueView(input: LeagueViewInput): LeagueView {
  const { snapshot, model, inputs, timeZone } = input;
  const platformLabel = PLATFORM_LABEL[snapshot.platform];
  const teamById = new Map<string, Team>(snapshot.teams.map((t) => [t.id, t]));
  const teamName = (id: string) => teamById.get(id)?.name ?? `Team ${id}`;
  const myTeamId = model.myTeamId && teamById.has(model.myTeamId) ? model.myTeamId : null;
  // Team numbers count from `from` (the week after one in progress); countedWeeks are those weeks.
  const from = teamFrom(model);
  const countedWeeks = model.weeks.slice(from);
  const inProgressWeek = from > 0 ? model.inProgressWeek : null;
  // The "next" strength window: config.lineups.strengthWeeks, or fewer near the end of the season.
  const nextWeeks = Math.max(1, Math.min(config.lineups.strengthWeeks, countedWeeks.length));
  // Values shown are §9's perception values: redraft ones in a keeper league (the market's own format is its dynasty list there).
  const keeper = snapshot.settings.leagueType === "keeper";
  const values = valuesShown(snapshot.settings, model.market.format);
  const source = projectionSource(snapshot, model);
  // FantasyCalc's fallback (the file header): a saved list stands in ("saved"), or every value is our own estimate
  // ("curve", whose banner replaces the inputs' warning; the warning alone, from inputs without the field, counts too).
  const fallback = inputs.market?.fallback ?? null;
  const estimatedWarning = inputs.warnings.find((w) => w.code === VALUES_ESTIMATED_CODE);
  const valuesEstimated = fallback?.kind === "curve" || estimatedWarning !== undefined;
  const savedNote = fallback?.kind === "saved" ? fantasyCalcFallbackText(fallback) : null;
  // Lineup points weight playoff weeks (the model's weight, set automatically: LeagueModel.playoffWeight) when any is among
  // the counted weeks. The model's playoff weight, one decimal as the Settings page prints it (the file header).
  const playoffWeight = playoffWeightLabel(model.playoffWeight ?? config.lineups.playoffWeight);
  const playoffWeighted = playoffWeight !== "1.0" && countedWeeks.some((w) => model.playoffWeeks.includes(w));
  const weighting = playoffWeighted ? `(playoffs count ${playoffWeight}×)` : null;
  const nowMs = Date.parse(input.now);
  const ctx: PlayerContext = {
    snapshot,
    model,
    inputs,
    now: Number.isFinite(nowMs) ? nowMs : 0,
    playoffWeeks: new Set(model.playoffWeeks),
    hasPlayoffs: model.playoffWeeks.length > 0,
    myTeamId,
  };
  const stamp = (iso: string) => formatShortDateTime(iso, timeZone, input.now);

  // Team table: ranked by projected points per week.
  const labels = slotLabels(model);
  const medians = slotMedians(model);
  const teamModels = model.teams.filter((t) => teamById.has(t.id));
  const rows: TeamRow[] = teamModels.map((t) => {
    const team = teamById.get(t.id) as Team;
    const perWeek = perWeekOf(t, model, from);
    const rosPoints = sum(lineupOf(t).lv.slice(from));
    return {
      id: t.id,
      rank: 0,
      name: team.name,
      isMine: t.id === myTeamId,
      record: recordText(team.record),
      pointsFor: fmtNum(team.pointsFor, 1),
      perWeek,
      perWeekText: perWeek === null ? "—" : fmtNum(perWeek, 1),
      rosPoints,
      rosText: fmtWhole(rosPoints),
      needs: needChips(t, labels, medians, nextWeeks),
      chips: tradeChipTags(snapshot, t, teamName, myTeamId, weighting),
    };
  });
  rows.sort((a, b) => (b.perWeek ?? -Infinity) - (a.perWeek ?? -Infinity) || b.rosPoints - a.rosPoints || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  rows.forEach((r, i) => (r.rank = i + 1));
  const order = rows.map((r) => r.id);
  const teamModelById = new Map(teamModels.map((t) => [t.id, t]));
  const firstCounted = countedWeeks[0];
  const teamsNote =
    inProgressWeek !== null && firstCounted !== undefined
      ? `Ranked by projected points per week from week ${firstCounted} on (week ${inProgressWeek} is under way).`
      : "Ranked by projected points per week.";

  // Heatmap: same team order as the table.
  const windowLabel: Record<StrengthWindow, string> = { ros: "Rest of season", next: `Next ${plural(nextWeeks, "week")}` };
  const span = (weeks: readonly number[]) => (weeks.length ? ` (${weekSpan(weeks)})` : "");
  const heatmap: Heatmap = {
    columns: model.slots.map((s) => ({ key: s.key, label: s.label })),
    rows: order.map((id) => {
      const t = teamModelById.get(id) as TeamModel;
      const name = teamName(id);
      const cells = (window: StrengthWindow) =>
        model.slots.map((s) => heatCell(s.key, s.label, name, t.strength[s.key], window, (window === "ros" ? medians.ros : medians.next).get(s.key) ?? 0, windowLabel[window].toLowerCase()));
      return { teamId: id, name, isMine: id === myTeamId, cells: { ros: cells("ros"), next: cells("next") } };
    }),
    windowLabel,
    caption: {
      ros: `Points per week from each team's starter in each lineup slot, rest of season${span(countedWeeks)}. Colors compare each team with the league median.`,
      next: `Points per week from each team's starter in each lineup slot, next ${plural(nextWeeks, "week")}${span(countedWeeks.slice(0, nextWeeks))}. Colors compare each team with the league median.`,
    },
  };

  // My team certainly out in a redraft league (§8), with no prize the league pays still within a trade's reach (Checkpoint
  // 7c: seasonOver). `?? null`: a model built before Phase 3 has no odds.
  const odds = model.odds ?? null;
  const eliminated = seasonOver(model, myTeamId, snapshot.settings.leagueType) ? SEASON_OVER_TEXT : null;

  // Best trade partners (my team only): who to aim for first, then each side's trade chips, most helpful first (the
  // engine's order). None once my redraft season is over: the page says no trade helps this year (§8), so it offers none.
  const cards: PartnerCard[] =
    myTeamId && !eliminated
      ? model.partners
          .filter((p) => teamById.has(p.teamId))
          .slice(0, config.needs.partnersShown)
          .map((p) => partnerCard(p, { snapshot, teamModel: teamModelById.get(p.teamId), name: teamName(p.teamId), myTeamId }))
      : [];
  const partnersEmpty = !myTeamId
    ? "Pick your team to see which teams fit you best as trade partners."
    : eliminated
      ? SEASON_OVER_PARTNERS_TEXT
      : cards.length
        ? null
        : "No clear fits right now: no team has a trade chip who would start for you.";

  // Rosters: mine first, then the table's order. Pickups show the gains the optimizer picked them by, each week counted
  // once (planner reply to Checkpoint 7b, Q6). An inactive team
  // (A4: the engine's own rule on the same snapshot, acceptance.inactiveTeams; only where the model allocates free agents
  // and weeks are left) says it makes none.
  const scenarioJudged = pickupsJudgedInScenarios(snapshot, model);
  const inactive = new Set(model.faAllocation && model.weeks.length ? inactiveTeams(snapshot, myTeamId, config.allocation.inactiveWeeks) : []);
  const inactiveText = `Inactive: no transactions ${inactiveWindowText(snapshot)}, so no free-agent pickups are assumed.`;
  const rosterOrder = myTeamId ? [myTeamId, ...order.filter((id) => id !== myTeamId)] : order;
  const rosters: RosterCard[] = rosterOrder.map((id) => {
    const team = teamById.get(id) as Team;
    const t = teamModelById.get(id);
    const active = byPositionThenRos(snapshot, team.roster.map((pid) => playerRow(ctx, pid, "active", t)));
    const ir = byPositionThenRos(snapshot, team.ir.map((pid) => playerRow(ctx, pid, "ir", t)));
    const taxi = byPositionThenRos(snapshot, team.taxi.map((pid) => playerRow(ctx, pid, "taxi", t)));
    const row = rows.find((r) => r.id === id);
    const summary = row ? `${row.perWeekText} pts/wk · ${row.rosText} ROS pts` : "";
    return {
      teamId: id,
      name: team.name,
      isMine: id === myTeamId,
      summary,
      streams: model.weeks.length ? streamsText(model, id, snapshot.platform) : null,
      pickups: freeAgentPickups(snapshot, t, scenarioJudged, playoffWeighted),
      inactive: inactive.has(id) ? inactiveText : null,
      players: [...active, ...ir, ...taxi],
    };
  });
  const streaming = streamingView(snapshot, model, myTeamId, teamName, from, inactive);

  // Free agents: the best few by ROS points at each startable position.
  const startable = POSITIONS.filter((pos) => snapshot.settings.lineup.some((s) => s.count > 0 && s.eligible.includes(pos)));
  const faRows = snapshot.freeAgents.filter((id) => model.players[id] && snapshot.players[id]).map((id) => playerRow(ctx, id, "fa", undefined));
  const freeAgents: FreeAgentGroup[] = startable
    .map((pos) => ({
      pos: posLabel(pos, snapshot.platform),
      players: faRows
        .filter((r) => snapshot.players[r.id]?.pos === pos)
        .sort((a, b) => (b.ros ?? 0) - (a.ros ?? 0) || a.name.localeCompare(b.name))
        .slice(0, FREE_AGENTS_SHOWN),
    }))
    .filter((g) => g.players.length > 0);

  // Sources, warnings, notes.
  const sources = [
    { label: `League data from ${platformLabel}`, value: stamp(snapshot.fetchedAt) },
    ...inputs.sources.map((s) => ({ label: s.source, value: `${stamp(s.fetchedAt)}${s.stale ? " (a saved copy: the live fetch failed)" : ""}` })),
  ];
  // The yellow banner: the notices alone (src/lib/notices.ts; Phase 7b, planner reply to Checkpoint 7a, §5.1), judged with
  // this League model: a player's data problem matters on my roster, or for a likely starter on any roster (likelyStarters
  // after its pickups, so a free agent a team would pick up and start counts for that team; a player without projections,
  // whom that rule can't pick, by his team's need at his position, the positions it streams, or FantasyCalc's value). The
  // curve fallback's notice is the values banner (valuesBanner), not one more line.
  const notices = buildDataNotices({
    snapshot,
    myTeamId,
    inputs,
    model: {
      warnings: model.warnings,
      players: model.players,
      likelyStarters: () => new Map(snapshot.teams.flatMap((t) => likelyStarters(snapshot, model, t.id, { afterPickups: true }).map((id) => [id, t.id] as const))),
      streams: (teamId) => model.streaming?.byTeam[teamId]?.positions ?? [],
    },
  })
    .notices.filter((n) => !n.key.startsWith(VALUES_ESTIMATED_CODE))
    .map((n) => n.text);
  const valuesBanner =
    fallback?.kind === "curve"
      ? { title: VALUES_ESTIMATED_TITLE, text: fantasyCalcFallbackText(fallback) }
      : estimatedWarning
        ? { title: VALUES_ESTIMATED_TITLE, text: estimatedWarning.message }
        : null;

  // Standings, odds and my remaining schedule (§8). The NFL's last week as the engine reads it (league.ts nflLastWeek).
  const lastNflWeek = lastNflWeekOf(inputs);
  const oddsContext: OddsContext = { snapshot, model, odds, teamById, teamName, myTeamId, warnings: notices, lastNflWeek };
  const standings = standingsView(oddsContext);
  const schedule = scheduleView(oddsContext);

  const weeks = model.weeks;
  const weeksLeft = weeks.length
    ? `${plural(weeks.length, "week")} left: ${model.regularWeeks.length} regular season${model.playoffWeeks.length || snapshot.settings.playoffWeeks.length ? `, ${model.playoffWeeks.length} playoffs` : ""}`
    : "No weeks left";
  const inProgressLine =
    inProgressWeek === null
      ? null
      : firstCounted === undefined
        ? `Week ${inProgressWeek} is under way and it's the last week, so team numbers have no weeks left to count.`
        : `Week ${inProgressWeek} is under way, so team numbers start with week ${firstCounted}.`;

  const myName = myTeamId ? teamName(myTeamId) : null;
  const hint =
    input.myTeamSource === "none" || !myTeamId
      ? "Pick your team on the Import Report to see your needs and trade partners."
      : input.myTeamSource === "link"
        ? `We guessed ${myName} from your link. Confirm it on the Import Report.`
        : null;

  return {
    header: {
      name: snapshot.name,
      platformLabel,
      season: snapshot.season,
      weekLine: `Week ${snapshot.currentWeek} · as of ${stamp(snapshot.fetchedAt)}`,
      inProgress: inProgressLine,
      projections: source.label,
      valuesFormat: values.label,
      valuesNote: savedNote ?? (valuesEstimated ? VALUES_ESTIMATED_LINE : null),
      weeksLeft,
    },
    valuesBanner,
    myTeam: { id: myTeamId, name: myName, source: myTeamId ? input.myTeamSource : "none", hint },
    eliminated,
    standings,
    schedule,
    teams: rows,
    teamsNote,
    chipLegend: `trade chip: worth at least ${chipMinGapText(model)} more lineup pts to another team than to his own`,
    heatmap,
    partners: { cards, empty: partnersEmpty },
    pickupsNote: weeks.length ? pickupsNoteOf(snapshot, model, myTeamId, inactive) : null,
    streaming,
    rosters,
    freeAgents,
    lineupCostTitle: `Rest-of-season lineup points his team would lose without him${playoffWeighted ? `, with playoff weeks counted ${playoffWeight}×` : ""}`,
    explain: buildExplain({
      snapshot,
      model,
      values,
      keeper,
      source,
      from,
      playoffWeighted,
      playoffWeight,
      playoffWeightBasis: model.playoffWeightAuto?.basis ?? null,
      odds,
      schedule: (schedule?.rows.length ?? 0) > 0,
      fallback,
      asRostersStandShown: (standings?.mine?.asRostersStand ?? null) !== null,
    }),
    sources,
    notices,
    // A saved list's date shows next to the values credit (header.valuesNote), so the inputs' note isn't repeated.
    notes: pageNotes(inputs.notes, [...values.said, ...(savedNote ? [savedNote] : [])]),
    over: weeks.length === 0,
    playoffsLeft: ctx.hasPlayoffs,
  };
}
