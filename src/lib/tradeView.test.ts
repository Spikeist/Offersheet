/**
 * The Trade Finder's and Trade Analyzer's view models (CLAUDE.md §10, §11, §13; Phase 4 wave 2 decision M13): every
 * card field in words, the sorts (through rank.ts), the empty states, the progress bar's words, the links between
 * the pages and what they carry back, the Analyzer's choices, and feedback state. A small made-up league; every
 * name is invented. Phase 4c (planner reply to Checkpoint 4b): FantasyCalc's own values on the card (change 3), my odds
 * and the weekly line next to Helps you (change 9), "<5%" (answer 5), the minimum chance's words (change 10), the pattern
 * note (change 6), the version inputs for the feedback (change 7), and the Analyzer's "Details".
 */
import { describe, expect, it } from "vitest";
import { displayAcceptance } from "@/engine/acceptance";
import { config } from "@/engine/config";
import { defaultTradeSettings } from "@/engine/settings";
import type { TradeAnalysis } from "@/engine/evaluate";
import type { MarketInputs } from "@/engine/inputs";
import type { LeagueSettings, PlayerInfo } from "@/engine/model";
import { HELPS_FLOOR_NOTE, HELPS_FLOOR_NOTE_PLAYOFFS, HELPS_FLOOR_NOTE_PRIZES, helpsBoth, helpsScaleNotes, type HelpsScale } from "@/engine/benefit";
import { TITLE_ONLY, titleDeltas, type Reward } from "@/engine/reward";
import { buildTradeContext, evaluateExact, explainContextOf, simulateTrade, tradeInternals, type SimState } from "@/engine/evaluate";
import { runTradeSearch } from "@/engine/search";
import type { HelpsCalibration } from "@/engine/leagueModel";
import { smallLeague } from "@/engine/trade.testing";
import { TEST_NOW } from "@/engine/testLeague";
import { explainTrade } from "@/engine/explain";
import { randomLeague } from "@/engine/testLeague";
import { FIXTURE_B3, planBFixture } from "@/engine/tradeTestFixtures";
import type { InjuryTag, OfferLadder, PartnerNumbers, TradeEvaluation } from "@/engine/tradeModel";
import { MODEL_SOURCES } from "@/server/modelInputs";
import { GLOOP_PREMIUM, SNOOT_PREMIUM, evaluation, searchResult, steppedFull, tradeSnapshot } from "@/components/trades/testFixtures";
import { applyFeedback, parseFeedbackShown } from "./feedbackStore";
import {
  ANALYZER_MAX_PER_SIDE,
  ANALYZER_SUGGESTED_LABEL,
  OFFERS_HEADING,
  OFFERS_INTRO_TEXT,
  OFFERS_NONE_TEXT,
  OFFER_STEP_LABEL,
  buildLadderView,
  cardVersions,
  moveLinesOf,
  offersAloneText,
  offersView,
  cardPress,
  HARDER_TO_GET_TAG,
  HELPS_BOTH_EMPTY_TITLE,
  HELPS_BOTH_SORT_NOTE,
  HELPS_BOTH_TAG,
  HELPS_THEM_TITLE,
  IR_SLOT_TEXT,
  PLAN_B_HEADING,
  MIN_CHANCE_OPTIONS,
  OWN_BEFORE_NOTE,
  PROJECTIONS_SOURCE,
  SORT_OPTIONS,
  SHOWN_PASS_LABEL,
  STAGE_LABEL,
  VALUES_CREDIT_TEXT,
  helpsBothFewText,
  helpsBothTagOf,
  isTradeSort,
  sortNote,
  theirLongTermFact,
  theirOddsViews,
  themView,
  acceptSrText,
  acceptText,
  analyzerChoices,
  noticeWarnings,
  analyzerHref,
  assetView,
  baselineLines,
  bestTimeText,
  buildAnalysisView,
  buildFinderView,
  buildTradeCard,
  cardFeedback,
  draftKey,
  draftProposal,
  detailsView,
  draftSummary,
  fantasyCalcLookup,
  fewText,
  finderHref,
  finderTimingLines,
  freshnessText,
  harderToGetWho,
  HELPS_SCALE_TEXT,
  GOAL_LABEL,
  helpsInfoText,
  helpsScaleText,
  helpsReasonOf,
  lineupEquivalentText,
  incomingInjuryNote,
  inTradingSeason,
  INJURED_REASON,
  injuryTagText,
  knownTagsOf,
  listNote,
  marketBlendOn,
  minChanceLabel,
  minChanceNote,
  namesPrizes,
  cardOddsWords,
  oddsViews,
  topChance,
  topOddsLabel,
  topPlacesOf,
  weighedOddsWords,
  percentText,
  perWeek,
  planBPitch,
  planBView,
  pointsChange,
  possessive,
  premiumReasons,
  progressView,
  releaseLine,
  releaseReason,
  readAnalyzerDraft,
  readAnalyzerFrom,
  readFinderPartner,
  reviewPeriodWords,
  rosNoteOf,
  seasonEndOf,
  secondsText,
  settingsSummary,
  teamNameOf,
  throughText,
  timeAgoText,
  titleOddsText,
  tradeWords,
  proposalFromKey,
  valueFactsOf,
  versionChoices,
  versionLine,
  weeklyLine,
  type FantasyCalcLookup,
} from "./tradeView";

const snapshot = tradeSnapshot();
/** FantasyCalc's list for the fictional league (MarketInputs, the model inputs' copy): only some players valued. */
const MARKET: MarketInputs = {
  format: { isDynasty: false, numQbs: 1, numTeams: 10, ppr: 1, substitutions: [] },
  fetchedAt: "2026-10-01T12:00:00.000Z",
  values: { "106": 5000, "204": 5400, "105": 1500, "203": 3200, "202": 9000, "107": 2600 },
  knownIds: [],
  topValue: 9000,
};
const FC = fantasyCalcLookup(MARKET);
const card = (o: Parameters<typeof evaluation>[0] = {}, baseline?: { pPlayoffs: number | null; pTitle: number | null }) => buildTradeCard(evaluation(o), { snapshot, baseline: baseline ?? null, fantasyCalc: FC });
const fact = (c: ReturnType<typeof card>, label: string) => c.facts.find((f) => f.label === label)?.value;
/** A "Helps you" scale (benefit.HelpsScale) for the wording tests: with long-term values (λ set) unless `lambda` is null. */
const helpsScaleFixture = (o: { lambda: number | null; gainReads?: number; futureReads?: number | null }): HelpsScale => ({
  b3: 4.65,
  raw: 4.65,
  floored: false,
  odds: 5,
  oddsNamed: "title",
  lambda: o.lambda,
  f10: o.lambda === null ? null : 4,
  gainReads: o.gainReads ?? 63,
  futureReads: o.lambda === null ? null : (o.futureReads ?? 0),
  reason: null,
});

/** Every word a card shows, for the no-jargon check. */
const allText = (c: ReturnType<typeof card>) =>
  [c.heading, ...c.give.map((a) => `${a.name} ${a.detail}`), ...c.get.map((a) => `${a.name} ${a.detail}`), c.numbers.acceptLabel, c.numbers.acceptNote ?? "", ...c.flags.map((f) => f.text), ...c.facts.map((f) => `${f.label} ${f.value}`), c.ros, c.rosNote ?? "", ...c.required].join(" ");

describe("small words", () => {
  it("prints odds as whole percents, '<1%' and '>99%' only when they merely round there, and acceptance to the nearest 5%", () => {
    expect([0, 0.004, 0.62, 0.996, 1].map(percentText)).toEqual(["0%", "<1%", "62%", ">99%", "100%"]);
    expect([0.4, 0.43, 0.612, 0.05, 0.074, 0.075].map(acceptText)).toEqual(["40%", "45%", "60%", "5%", "5%", "10%"]);
  });

  it("prints a chance under 5% as '<5%', never rounded up (planner reply to Checkpoint 4b, answer 5), the filter's number unchanged", () => {
    expect([0.02, 0.0249, 0.03, 0.049].map(acceptText)).toEqual(["<5%", "<5%", "<5%", "<5%"]);
    expect([0.02, 0.05].map(acceptSrText)).toEqual(["under 5%", "5%"]);
    // acceptance.displayAcceptance still reads 5% (the filter and the label use it): only the words change.
    expect(displayAcceptance(0.02)).toBe(0.05);
    const card = buildTradeCard(evaluation({ pAccept: 0.03, pComplete: 0.03 }), { snapshot });
    expect(card.numbers.accept).toEqual({ value: "<5%", srText: "under 5%" });
    expect(card.numbers.acceptLabel).toBe("Est. · Long shot");
  });

  it("prints title odds with one decimal (the planner's \"12.1% → 13.4%\"), '<0.1%' and '>99.9%' only when they merely round there", () => {
    expect([0.121, 0.12, 0, 0.0004, 0.9996, 1, Number.NaN].map(titleOddsText)).toEqual(["12.1%", "12.0%", "0.0%", "<0.1%", ">99.9%", "100.0%", "—"]);
  });

  it("says points a week and seconds singular when they print as 1 (review of Phase 4: 'That took 1 seconds', '−1 pts a week')", () => {
    expect([2.34, 1, -1, 0.96, -1.04, 0, -0.02, 1.06].map(perWeek)).toEqual([
      "+2.3 pts a week",
      "+1 pt a week",
      "−1 pt a week",
      "+1 pt a week",
      "−1 pt a week",
      "0 pts a week",
      "0 pts a week",
      "+1.1 pts a week",
    ]);
    expect([1000, 960, 1040, 4210, 1060, 0].map(secondsText)).toEqual(["1 second", "1 second", "1 second", "4.2 seconds", "1.1 seconds", "0 seconds"]);
    expect(card({ partnerDeltaLineup: -1.02 }).facts.find((f) => f.label === "Their lineup")?.value).toBe("−1 pt a week");
    expect(card({ dPPW: 1, dPPWPlayoffs: 1 }).facts[0]?.value).toBe("+1 pt a week in the regular season, +1 in the playoffs");
  });

  it("says a change in odds in percentage points (never bare 'points', which would read as fantasy points), singular for one", () => {
    expect([0.041, -0.003, 0.01, -0.01, 0, 0.00004].map(pointsChange)).toEqual([
      "+4.1 percentage points",
      "−0.3 percentage points",
      "+1 percentage point",
      "−1 percentage point",
      "no change",
      "no change",
    ]);
  });
});

describe("buildTradeCard (§13: what each card shows)", () => {
  const c = card();

  it("names the partner and both sides, each player with position, NFL team and injury in words", () => {
    expect(c.heading).toBe("Trade with Gravel Gophers");
    expect(c.give).toEqual([{ id: "106", name: "Wiggleton Spoons", detail: "WR · ATL", injury: null, status: null, tag: null }]);
    expect(c.get).toEqual([{ id: "204", name: "Cornelius Snoot", detail: "RB · HOU", injury: null, status: null, tag: null }]);
    const q = buildTradeCard(evaluation({ give: ["103"] }), { snapshot }).give[0];
    expect(q?.injury).toEqual({ short: "Q", long: "Questionable", tone: "warn" });
    expect(q?.status).toEqual({ text: "Questionable", tone: "warn" });
    expect(assetView({ kind: "player", id: "gone" }, snapshot).name).toBe("A player who's no longer in this league's data");
    expect(assetView({ kind: "pick", season: 2027, round: 1, originalTeamId: "3" }, snapshot)).toEqual({ id: "pick:2027:1:3", name: "2027 round 1 pick", detail: "Original owner: Quasar Quokkas", injury: null, tag: null });
  });

  it("shows the three numbers (§10): Helps you, the acceptance estimate with Est. and its label, and Overall", () => {
    // B 3, P_complete 0.4 (the fixture's defaults) on the fixture's B₃ 6: 100 × (1 − e^(−3/6)) = 39; 100 × (1 − e^(−1.2/6)) = 18.
    // Helps you's tooltip says what the scale means (planner reply to Checkpoint 4c, A2).
    expect(c.numbers).toEqual({
      helps: { value: "39", srText: null, title: "63 ≈ as good as adding 3 points a week to your lineup for the rest of the season." },
      accept: { value: "40%", srText: null },
      acceptLabel: "Est. · Decent",
      acceptNote: null,
      overall: { value: "18", srText: null },
    });
    expect(HELPS_SCALE_TEXT).toBe("63 ≈ as good as adding 3 points a week to your lineup for the rest of the season.");
  });

  it("scores on the evaluation's own B₃: the same B reads 63 where B₃ is B, 39 where B₃ is twice it (planner reply to Checkpoint 4c, A2)", () => {
    expect(buildTradeCard(evaluation({ b: 4, b3: 4, pComplete: 0.5 }), { snapshot }).numbers).toMatchObject({ helps: { value: "63" }, overall: { value: "39" } });
    expect(buildTradeCard(evaluation({ b: 4, b3: 8, pComplete: 0.5 }), { snapshot }).numbers).toMatchObject({ helps: { value: "39" }, overall: { value: "22" } });
  });

  it("shows the chance it goes through too when the league's review could veto it (§11)", () => {
    const vetoed = buildTradeCard(evaluation({ pAccept: 0.4, pComplete: 0.2, detail: { vetoRisk: true } }), { snapshot: tradeSnapshot({ tradeReview: "league_vote" }) });
    expect(vetoed.numbers.accept.value).toBe("40%");
    expect(vetoed.numbers.acceptNote).toBe("Counting a league veto vote, about 20% it goes through.");
    const commish = buildTradeCard(evaluation({ pAccept: 0.4, pComplete: 0.2, detail: { vetoRisk: true } }), { snapshot: tradeSnapshot({ tradeReview: "commissioner" }) });
    expect(commish.numbers.acceptNote).toBe("Counting the commissioner's review, about 20% it goes through.");
  });

  it("says 'under 5%' when the veto cuts the chance below what the card can print, never '5% … about 5%' (review of Phase 4b)", () => {
    const league = { snapshot: tradeSnapshot({ tradeReview: "league_vote" }) };
    // Bo Nix for A.J. Brown on Parker's league: both print as 5% (§11's display floor), the reason says the veto halves it.
    const floor = buildTradeCard(evaluation({ pAccept: 0.06, pComplete: 0.03, detail: { vetoRisk: true } }), league);
    expect(floor.numbers.accept.value).toBe("5%");
    expect(floor.numbers.acceptNote).toBe("Counting a league veto vote, under 5% it goes through.");
    // At 2% (the model's floor) both print "<5%": nothing more to say (Phase 4c: the card's own "<5%" says it).
    const both = buildTradeCard(evaluation({ pAccept: 0.02, pComplete: 0.01, detail: { vetoRisk: true } }), league);
    expect([both.numbers.accept.value, both.numbers.acceptNote]).toEqual(["<5%", null]);
    // A cut that prints the same above the floor says nothing more (the reason says the league reviews trades).
    expect(buildTradeCard(evaluation({ pAccept: 0.11, pComplete: 0.09, detail: { vetoRisk: true } }), league).numbers.acceptNote).toBeNull();
    // throughText itself: differently printed, below the floor, nothing more.
    expect([throughText(0.4, 0.2), throughText(0.06, 0.03), throughText(0.06, 0.06), throughText(0.11, 0.09), throughText(0.4, Number.NaN), throughText(0.04, 0.02)]).toEqual(["about 20%", "under 5%", null, null, null, null]);
  });

  it("scores a trade that doesn't help 0, flags it, and shows a dash (with words for screen readers) when B is unknown", () => {
    const worse = card({ b: -1 });
    expect([worse.numbers.helps.value, worse.numbers.overall.value]).toEqual(["0", "0"]);
    expect(worse.flags.map((f) => f.kind)).toEqual(["noHelp"]);
    const unknown = card({ b: null, dPO: null, dCH: null });
    expect(unknown.numbers.helps).toEqual({ value: "—", srText: "not scored: the season couldn't be simulated", title: HELPS_SCALE_TEXT });
    expect(unknown.flags.map((f) => f.text)).toEqual(["Not scored: your playoff odds couldn't be worked out, so this trade has no Helps you or Overall number."]);
    expect(unknown.odds).toEqual([
      { label: "Title odds", value: "unknown", srValue: "unknown" },
      { label: "Playoff odds", value: "unknown", srValue: "unknown" },
    ]);
  });

  it("says why a trade that doesn't help is left out by what pulled it down, never contradicting its own odds (review of Phase 4)", () => {
    const noHelp = (o: Parameters<typeof evaluation>[0]) => card(o).flags.find((f) => f.kind === "noHelp")?.text;
    // Redraft, my chances fall: they wouldn't rise.
    expect(noHelp({ b: -1, bWin: -1.2, gMine: 0.05 })).toBe("Doesn't help you: it wouldn't raise your chances this season, so trade ideas leave it out.");
    expect(noHelp({ b: 0, bWin: 0, gMine: 0 })).toBe("Doesn't help you: it wouldn't raise your chances this season, so trade ideas leave it out.");
    // Redraft, my chances rise but I'd give up more trade value (Parker's league: Team 4, B −0.11, B_win +1.08, odds +1.8 points).
    expect(noHelp({ b: -0.11, bWin: 1.08, gMine: -0.297, dPO: 0.0178, dCH: 0.007 })).toBe(
      "Doesn't help you overall: it raises your chances this season, but counting roster spots, you'd give up more trade value than that's worth at your “Protect my trade value” setting, so trade ideas leave it out.",
    );
    // …and numbers that break the rule (my chances rise, B ≤ 0, yet I don't give more value: the value floor on both sides,
    // planner reply to Checkpoint 4, change 4, rules that out, since the term and the card read the same g): only "overall".
    expect(noHelp({ b: -0.2, bWin: 0.4, gMine: 0.1 })).toBe("Doesn't help you overall, so trade ideas leave it out.");
    // Dynasty and keeper: this season against long-term value, by the Win now ↔ Future setting.
    expect(noHelp({ b: -0.5, bWin: 1.5, bFuture: -4, lambda: 0.5, dDyn: -900 })).toBe(
      "Doesn't help you overall: it raises your chances this season, but you'd lose more long-term value than that's worth at your Win now ↔ Future setting, so trade ideas leave it out.",
    );
    expect(noHelp({ b: -0.3, bWin: -2, bFuture: 1.5, lambda: 0.35, dDyn: 300 })).toBe(
      "Doesn't help you overall: it adds long-term value, but it costs more of your chances this season than that's worth at your Win now ↔ Future setting, so trade ideas leave it out.",
    );
    expect(noHelp({ b: -1, bWin: -1, bFuture: -1, lambda: 0.5, dDyn: -200 })).toBe("Doesn't help you: it wouldn't raise your chances this season or your long-term value, so trade ideas leave it out.");
    // A keeper league whose long-term values didn't load: B is B_win alone.
    expect(noHelp({ b: -0.4, bWin: -0.4, bFuture: null, lambda: 0.2, dynMissing: true })).toBe("Doesn't help you: it wouldn't raise your chances this season, so trade ideas leave it out.");
    // A trade that helps has no such flag.
    expect(noHelp({ b: 2, bWin: 3, gMine: -0.1 })).toBeUndefined();
  });

  it("raises the risk flags apart from the numbers, in words: an injured player, the market check, and a trade normally hidden", () => {
    expect(card({ flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: ["107"] } }).flags).toEqual([
      { kind: "injured", text: "Depends on an injured player: Humbert Fiddlesticks (injured reserve). His projection assumes he returns at full strength, blended with the trade market." },
    ]);
    expect(card({ get: ["107", "206"], flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: ["107", "206"] } }).flags[0]?.text).toBe(
      "Depends on injured players: Humbert Fiddlesticks (injured reserve) and Rupert Wimbleton (doubtful). Their projections assume they return at full strength, blended with the trade market.",
    );
    // The model's trigger (g_mkt(me) under −15%), no number (planner reply to Checkpoint 4b, change 3).
    expect(card({ gMine: -0.2 }).flags).toEqual([{ kind: "market", text: "Market check: counting roster spots, you'd give up more trade value than you get." }]);
    expect(card({ gMine: -0.4 }).flags).toEqual([{ kind: "hiddenByMarket", text: "Market check: counting roster spots, you'd give up much more trade value than you get, so trade ideas leave it out." }]);
    expect(card({ gMine: -0.2 }).flags[0]?.text).not.toMatch(/\d/);
    expect(card().flags).toEqual([]);
  });

  it("⚠️ names my free-agent moves after the trade that my baseline doesn't make (final review of Phase 4c, finding R1), after the forced ones", () => {
    const moves = (faMoves: NonNullable<TradeEvaluation["required"]["me"]["faMoves"]>, me: Partial<TradeEvaluation["required"]["me"]> = {}) =>
      card({ required: { me: { drops: [], adds: [], ...me, faMoves }, partner: { drops: [], adds: [] } } }).required;
    // Parker's card: a QB for Josh Allen's week-7 bye, Kyle Monangai cut to make room.
    expect(moves({ adds: ["901"], drops: ["105"], kept: [], starts: { "901": [7] } })).toEqual([
      "This trade's numbers count on one more free-agent move: you'd drop Glimmer Oddfellow (WR, SEA) and pick up Floopy Freeman (RB, CAR) to start in week 7.",
    ]);
    // Two weeks: both named; more, or two pickups: no week. After legality's own lines.
    expect(moves({ adds: ["901"], drops: ["105"], kept: [], starts: { "901": [7, 13] } })[0]).toContain("pick up Floopy Freeman (RB, CAR) to start in weeks 7 and 13.");
    expect(moves({ adds: ["901"], drops: ["105"], kept: [], starts: { "901": [7, 9, 13] } })[0]).toMatch(/pick up Floopy Freeman \(RB, CAR\)\.$/);
    expect(moves({ adds: ["901", "902"], drops: ["105", "104"], kept: [], starts: { "901": [7], "902": [9] } }, { drops: ["108"] })).toEqual([
      "You'd drop Tobias Thimble (TE, JAX) to stay within your roster limits.",
      "This trade's numbers count on more free-agent moves: you'd drop Glimmer Oddfellow (WR, SEA) and Noodle McSprocket (WR, MIN), and pick up Floopy Freeman (RB, CAR) and Waverly Waiver (RB, NE).",
    ]);
    // No pickup of its own, another drop than the baseline's (a player worth more than W: the engine names only those).
    expect(moves({ adds: [], drops: ["105"], kept: ["104"], starts: {} })).toEqual(["This trade's numbers count on one more free-agent move: you'd drop Glimmer Oddfellow (WR, SEA) rather than Noodle McSprocket (WR, MIN)."]);
    // ⚠️ And whom it makes room for when that's the League page's own pickup (verification of the final review, finding VF-1:
    // "you'd drop Kyle Monangai (RB, CHI)." alone gave no reason), with or without the drop it replaces.
    expect(moves({ adds: [], drops: ["105"], kept: [], starts: {}, room: ["901"] })).toEqual([
      "This trade's numbers count on one more free-agent move: you'd drop Glimmer Oddfellow (WR, SEA) to make room for Floopy Freeman (RB, CAR), the pickup the League page suggests.",
    ]);
    expect(moves({ adds: [], drops: ["105"], kept: ["104"], starts: {}, room: ["901"] })).toEqual([
      "This trade's numbers count on one more free-agent move: you'd drop Glimmer Oddfellow (WR, SEA) rather than Noodle McSprocket (WR, MIN) to make room for Floopy Freeman (RB, CAR), the pickup the League page suggests.",
    ]);
    expect(moves({ adds: [], drops: ["105", "104"], kept: [], starts: {}, room: ["901", "902"] })).toEqual([
      "This trade's numbers count on more free-agent moves: you'd drop Glimmer Oddfellow (WR, SEA) and Noodle McSprocket (WR, MIN) to make room for Floopy Freeman (RB, CAR) and Waverly Waiver (RB, NE), pickups the League page suggests.",
    ]);
    // A pickup of its own is the reason: no room words then.
    expect(moves({ adds: ["902"], drops: ["105"], kept: [], starts: {}, room: ["901"] })[0]).not.toContain("make room");
    // None: nothing said.
    expect(moves({ adds: [], drops: [], kept: [], starts: {} })).toEqual([]);
    // Now before later: the move comes before the drop an IR player's return brings (Parker's card: Pat Freiermuth picked up
    // for week 6, dropped in week 7 when Alec Pierce is back).
    expect(moves({ adds: ["901"], drops: ["105"], kept: [], starts: { "901": [6] } }, { displaced: [{ playerId: "901", week: 7, returner: "107" }] })).toEqual([
      "This trade's numbers count on one more free-agent move: you'd drop Glimmer Oddfellow (WR, SEA) and pick up Floopy Freeman (RB, CAR) to start in week 6.",
      "From week 7, when Humbert Fiddlesticks comes back from IR, you'd drop Floopy Freeman (RB, CAR).",
    ]);
  });

  it("Checkpoint 7e (item 2.2): lists every roster move my numbers assume, in order, each with its reason, a later week's with its week, and the moves made either way on one line", () => {
    const lines = (myMoves: NonNullable<TradeEvaluation["myMoves"]>, o: Parameters<typeof evaluation>[0] = {}) => buildTradeCard({ ...evaluation(o), myMoves }, { snapshot, fantasyCalc: FC }).required;
    expect(
      lines({
        moves: [
          { kind: "positionLimit", week: 6, drop: "105", pos: "WR", limit: 3 },
          { kind: "makeRoom", week: 6, drop: ["108"], for: ["203"] },
          { kind: "rosterMinimum", week: 6, add: "902", pos: "RB", min: 2 },
          { kind: "openSpot", week: 6, spot: { playerId: "901", pos: "RB" } },
          { kind: "toIR", week: 6, player: "206" },
          { kind: "waiver", week: 6, add: "901", drop: "105", starts: [7] },
          { kind: "pickupDrop", week: 6, add: "901", drop: "106", instead: "105" },
          { kind: "skip", week: 6, add: "902", keep: "108", why: "unneeded" },
          { kind: "release", week: 7, player: "106", returner: "107" },
        ],
        assumed: [
          { add: "901", drop: "108" },
          { add: "902", drop: null, eitherWay: true },
        ],
      }),
    ).toEqual([
      "Stay within your league's limit of 3 WRs: drop Glimmer Oddfellow (WR).",
      "Make room for Ignatius Fumblewick: drop Tobias Thimble (TE).",
      "Keep your league's minimum of 2 RBs: add Waverly Waiver (RB).",
      "Open roster spot: add Floopy Freeman, the best available RB.",
      "Rupert Wimbleton goes to your IR slot (no roster spot until he's back).",
      "This trade makes a waiver move worthwhile: add Floopy Freeman (RB) to start in week 7, drop Glimmer Oddfellow (WR).",
      "This trade makes Glimmer Oddfellow worth keeping: for the League page's pickup, Floopy Freeman, drop Wiggleton Spoons (WR) instead.",
      "This trade makes the League page's pickup unnecessary: skip Waverly Waiver (RB) and keep Tobias Thimble (TE).",
      "Week 7, when Humbert Fiddlesticks returns from IR: release Wiggleton Spoons (WR).",
      "Assumed with or without this trade: add Floopy Freeman, drop Tobias Thimble.",
      // Item 2.1's either-way moves on a line of their own (review of wave B): the League page doesn't list them.
      "Also assumed with or without this trade, though the League page doesn't list it: add Waverly Waiver.",
    ]);
    // The other wordings: the returner released himself; an open spot's fill released again at a return, in the spot's own
    // sentence (as before); the partner claiming the League page's pickup ahead of me; a drop to make room for a roster-minimum
    // add; the League page's pickup with another drop (none kept), or into an open spot; a waiver move into an open spot.
    expect(
      lines({
        moves: [
          { kind: "makeRoom", week: 6, drop: ["108"], for: [] },
          { kind: "openSpot", week: 6, spot: { playerId: "901", pos: "RB" } },
          { kind: "waiver", week: 6, add: "902", drop: null, starts: [6, 7, 8] },
          { kind: "pickupDrop", week: 6, add: "901", drop: "106", instead: null },
          { kind: "pickupDrop", week: 6, add: "902", drop: null, instead: null },
          { kind: "skip", week: 6, add: "902", keep: "108", why: "taken" },
          { kind: "release", week: 7, player: "901", returner: "107" },
          { kind: "release", week: 9, player: "107", returner: "107" },
        ],
        assumed: [],
      }),
    ).toEqual([
      "Make room on your roster: drop Tobias Thimble (TE).",
      "Open roster spot: add Floopy Freeman, the best available RB, until Humbert Fiddlesticks comes back from IR in week 7.",
      "This trade makes a waiver move worthwhile: add Waverly Waiver (RB).",
      "For the League page's pickup, Floopy Freeman, drop Wiggleton Spoons (WR).",
      "The League page's pickup, Waverly Waiver, takes an open roster spot.",
      "After this trade Gravel Gophers claims the League page's pickup, Waverly Waiver (RB), ahead of you: keep Tobias Thimble (TE).",
      "Week 9, when Humbert Fiddlesticks returns from IR: release him instead of dropping someone else.",
    ]);
    // Nothing to say: no line; and the partner's lines follow mine, as before.
    expect(lines({ moves: [], assumed: [] })).toEqual([]);
    expect(lines({ moves: [], assumed: [{ add: "901", drop: "108" }] }, { required: { me: { drops: ["105"], adds: [] }, partner: { drops: ["205"], adds: [] } } })).toEqual([
      "Assumed with or without this trade: add Floopy Freeman, drop Tobias Thimble.",
      "Gravel Gophers would drop Percival Plunk (WR, LAR) to stay within their roster limits.",
    ]);
    // ⚠️ An evaluation made before Checkpoint 7e (no myMoves): my side's lines as before, from `required.me`.
    expect(card({ required: { me: { drops: ["105"], adds: [] }, partner: { drops: [], adds: [] } } }).required).toEqual(["You'd drop Glimmer Oddfellow (WR, SEA) to stay within your roster limits."]);
  });

  it("review of wave B: a pickup of the before brought in by legality, a player the trade brings in dropped again, a spot taken, and what happens at an IR return where the before differs", () => {
    const lines = (myMoves: NonNullable<TradeEvaluation["myMoves"]>, snap = snapshot) => buildTradeCard({ ...evaluation(), myMoves }, { snapshot: snap, fantasyCalc: FC }).required;
    expect(
      lines({
        moves: [
          // B-3: my pickups drop a player the trade brings in, so the room isn't "for" him; inside a list, from this trade.
          { kind: "makeRoom", week: 6, drop: ["108", "203"], for: [], received: ["203"] },
          // B-1: the League page's pickup comes in through the open spot, and the trade keeps his drop.
          { kind: "openSpot", week: 6, spot: { playerId: "901", pos: "RB" }, pickup: { keep: "105" } },
          { kind: "rosterMinimum", week: 6, add: "902", pos: "RB", min: 2, pickup: { keep: null, eitherWay: true } },
          { kind: "waiver", week: 6, add: "901", drop: "204", starts: [7], received: true },
          // moves-waiver-takes-pickup-drop: a waiver pickup in place of the League page's own.
          { kind: "waiver", week: 6, add: "902", drop: null, insteadOf: "901" },
          { kind: "pickupDrop", week: 6, add: "901", drop: "204", instead: "105", received: true, eitherWay: true },
          // moves-skip-reason-spot-taken: the players received take the spot (named, or not).
          { kind: "skip", week: 6, add: "901", keep: null, why: "spot", by: ["204"] },
          { kind: "skip", week: 6, add: "902", keep: "108", why: "spot" },
          // moves-before-release-unnamed: the before's release at the same return, kept or gone, and a return with room.
          { kind: "release", week: 7, player: "107", returner: "107", instead: "108", kept: true },
          { kind: "release", week: 7, player: "106", returner: "107", instead: "107", kept: true },
          { kind: "release", week: 8, player: "107", returner: "107", instead: "108", kept: false },
          { kind: "keepAtReturn", week: 9, player: "108", returner: "107", returnerStays: true },
          { kind: "keepAtReturn", week: 9, player: "108", returner: "107", returnerStays: false },
          // The safety net (none on any test league).
          { kind: "drop", week: 6, player: "105" },
          { kind: "drop", week: 6, player: "204", received: true },
          { kind: "keep", week: 6, player: "108" },
          { kind: "add", week: 6, player: "901" },
        ],
        assumed: [
          { add: "901", drop: "105" },
          { add: null, drop: "108" },
        ],
      }),
    ).toEqual([
      "Make room on your roster: drop Tobias Thimble (TE) and Ignatius Fumblewick (RB, from this trade).",
      "Open roster spot: add Floopy Freeman, the best available RB. He's the League page's pickup, so you keep Glimmer Oddfellow (WR).",
      "Keep your league's minimum of 2 RBs: add Waverly Waiver (RB). He's a pickup worth making either way.",
      "This trade makes a waiver move worthwhile: add Floopy Freeman (RB) to start in week 7, drop Cornelius Snoot (RB), whom this trade brings in.",
      "This trade makes a waiver move worthwhile: add Waverly Waiver (RB) instead of the League page's pickup, Floopy Freeman (RB).",
      "This trade makes Glimmer Oddfellow worth keeping: for the pickup worth making either way, Floopy Freeman, drop Cornelius Snoot (RB) instead, whom this trade brings in.",
      "Cornelius Snoot takes the roster spot of the League page's pickup: skip Floopy Freeman (RB).",
      "This trade takes the roster spot of the League page's pickup: skip Waverly Waiver (RB) and keep Tobias Thimble (TE).",
      "Week 7, when Humbert Fiddlesticks returns from IR: release him and keep Tobias Thimble (TE).",
      // The returner kept is named (the final review of Checkpoint 7e, MOVES-1: "… and keep him." read as keeping Wiggleton Spoons).
      "Week 7, when Humbert Fiddlesticks returns from IR: release Wiggleton Spoons (WR) and keep Humbert Fiddlesticks.",
      "Week 8, when Humbert Fiddlesticks returns from IR: release him; without this trade, Tobias Thimble (TE) would go then.",
      "Week 9, when Humbert Fiddlesticks returns from IR: this trade leaves room, so keep Tobias Thimble (TE).",
      "Keep Tobias Thimble (TE): without this trade you'd release him in week 9, when Humbert Fiddlesticks returns from IR.",
      "Drop Glimmer Oddfellow (WR).",
      "Drop Cornelius Snoot (RB), whom this trade brings in.",
      "Keep Tobias Thimble (TE).",
      "Add Floopy Freeman (RB).",
      "Assumed with or without this trade: add Floopy Freeman, drop Glimmer Oddfellow; drop Tobias Thimble.",
    ]);
    // An open spot's fill released again at a return keeps it in the spot's sentence, unless the before releases someone else
    // then: that one's line says whom (and the spot's sentence doesn't).
    expect(
      lines({
        moves: [
          { kind: "openSpot", week: 6, spot: { playerId: "901", pos: "RB" } },
          { kind: "release", week: 7, player: "901", returner: "107", instead: "108", kept: true },
        ],
        assumed: [],
      }),
    ).toEqual(["Open roster spot: add Floopy Freeman, the best available RB.", "Week 7, when Humbert Fiddlesticks returns from IR: release Floopy Freeman (RB) and keep Tobias Thimble (TE)."]);
    // A name that ends with its own period ends the assumed line once (review of wave B, moves-assumed-double-period).
    const jr = { ...snapshot, players: { ...snapshot.players, "105": { ...(snapshot.players["105"] as PlayerInfo), name: "Marvin Harrison Jr." }, "901": { ...(snapshot.players["901"] as PlayerInfo), name: "Kyle Pitts Sr." } } };
    expect(lines({ moves: [], assumed: [{ add: "902", drop: "105" }] }, jr)).toEqual(["Assumed with or without this trade: add Waverly Waiver, drop Marvin Harrison Jr."]);
    expect(lines({ moves: [], assumed: [{ add: "901", drop: null }] }, jr)).toEqual(["Assumed with or without this trade: add Kyle Pitts Sr."]);
    // An either-way move alone: its own line, worded as one the League page doesn't list.
    expect(lines({ moves: [], assumed: [{ add: "902", drop: "105", eitherWay: true }] }, jr)).toEqual(["Assumed with or without this trade, though the League page doesn't list it: add Waverly Waiver, drop Marvin Harrison Jr."]);
  });

  describe("Checkpoint 7f (planner reply to Checkpoint 7e, answer 4: “keep the rule, but the card must say why”): a release the near-tie rule decided, with why", () => {
    const lines = (myMoves: NonNullable<TradeEvaluation["myMoves"]>, snap = snapshot) => buildTradeCard({ ...evaluation(), myMoves }, { snapshot: snap, fantasyCalc: FC }).required;
    const rename = (names: Record<string, string>) => ({ ...snapshot, players: { ...snapshot.players, ...Object.fromEntries(Object.entries(names).map(([id, name]) => [id, { ...(snapshot.players[id] as PlayerInfo), name }])) } });
    // Parker's week-7 return (NFL names are public): Alec Pierce on my IR, Marvin Harrison Jr. on my bench, Kyle Pitts Sr. my TE.
    const pierce = rename({ "107": "Alec Pierce", "105": "Marvin Harrison Jr.", "108": "Kyle Pitts Sr." });
    const harrison = { keptInstead: "105", lockable: true };
    const reason = "Marvin Harrison Jr. are nearly even for your lineup, and Harrison Jr. has more trade value.";

    it("the planner's sentence word for word when the returner himself goes, and the same rule for every other line", () => {
      expect(
        lines(
          {
            moves: [
              { kind: "release", week: 7, player: "107", returner: "107", nearTie: harrison },
              { kind: "release", week: 7, player: "108", returner: "107", nearTie: harrison },
              // The line ends naming another player: the reason names the player released by his surname.
              { kind: "release", week: 7, player: "107", returner: "107", instead: "108", kept: true, nearTie: harrison },
              { kind: "release", week: 7, player: "108", returner: "107", instead: "107", kept: true, nearTie: harrison },
              { kind: "release", week: 7, player: "107", returner: "107", instead: "108", kept: false, nearTie: harrison },
              // The player kept is the one the line already named (the "before"'s release, the returner): his surname both times.
              { kind: "release", week: 7, player: "107", returner: "107", instead: "105", kept: true, nearTie: harrison },
              { kind: "release", week: 7, player: "108", returner: "107", nearTie: { keptInstead: "107", lockable: true } },
            ],
            assumed: [],
          },
          pierce,
        ),
      ).toEqual([
        "Week 7, when Alec Pierce returns from IR: release him. He and Marvin Harrison Jr. are nearly even for your lineup, and Harrison Jr. has more trade value. Lock Pierce to keep him instead.",
        `Week 7, when Alec Pierce returns from IR: release Kyle Pitts Sr. (TE). He and ${reason} Lock Pitts Sr. to keep him instead.`,
        `Week 7, when Alec Pierce returns from IR: release him and keep Kyle Pitts Sr. (TE). Pierce and ${reason} Lock Pierce to keep him instead.`,
        `Week 7, when Alec Pierce returns from IR: release Kyle Pitts Sr. (TE) and keep Alec Pierce. Pitts Sr. and ${reason} Lock Pitts Sr. to keep him instead.`,
        `Week 7, when Alec Pierce returns from IR: release him; without this trade, Kyle Pitts Sr. (TE) would go then. Pierce and ${reason} Lock Pierce to keep him instead.`,
        "Week 7, when Alec Pierce returns from IR: release him and keep Marvin Harrison Jr. (WR). Pierce and Harrison Jr. are nearly even for your lineup, and Harrison Jr. has more trade value. Lock Pierce to keep him instead.",
        "Week 7, when Alec Pierce returns from IR: release Kyle Pitts Sr. (TE). He and Pierce are nearly even for your lineup, and Pierce has more trade value. Lock Pitts Sr. to keep him instead.",
      ]);
    });

    it("no lock for a player the trade brings in; a D/ST by its name, “it”; two players sharing a surname by their full names", () => {
      const moves = (m: NonNullable<TradeEvaluation["myMoves"]>["moves"], snap = pierce) => lines({ moves: m, assumed: [] }, snap);
      expect(moves([{ kind: "release", week: 7, player: "204", returner: "107", nearTie: { keptInstead: "105", lockable: false } }])).toEqual([
        `Week 7, when Alec Pierce returns from IR: release Cornelius Snoot (RB). He and ${reason}`,
      ]);
      expect(moves([{ kind: "release", week: 7, player: "MIN", returner: "107", nearTie: harrison }])).toEqual([
        `Week 7, when Alec Pierce returns from IR: release Vikings D/ST (D/ST). Vikings D/ST and ${reason} Lock Vikings D/ST to keep it instead.`,
      ]);
      const twins = rename({ "107": "Alec Pierce", "106": "Kevin Pitts Sr.", "108": "Kyle Pitts Sr." });
      expect(moves([{ kind: "release", week: 7, player: "108", returner: "107", instead: "107", kept: true, nearTie: { keptInstead: "106", lockable: true } }], twins)).toEqual([
        "Week 7, when Alec Pierce returns from IR: release Kyle Pitts Sr. (TE) and keep Alec Pierce. Kyle Pitts Sr. and Kevin Pitts Sr. are nearly even for your lineup, and Kevin Pitts Sr. has more trade value. Lock Kyle Pitts Sr. to keep him instead.",
      ]);
      // A player no longer in the league's data: the release as before, no reason (nobody to name).
      expect(moves([{ kind: "release", week: 7, player: "108", returner: "107", nearTie: { keptInstead: "gone", lockable: true } }])).toEqual(["Week 7, when Alec Pierce returns from IR: release Kyle Pitts Sr. (TE)."]);
      // An open spot's fill released again at a return keeps it in the spot's sentence, with no reason (a free agent added for
      // the spot until then needs none).
      expect(
        moves([
          { kind: "openSpot", week: 6, spot: { playerId: "901", pos: "RB" } },
          { kind: "release", week: 7, player: "901", returner: "107", nearTie: harrison },
        ]),
      ).toEqual(["Open roster spot: add Floopy Freeman, the best available RB, until Alec Pierce comes back from IR in week 7."]);
      // Without nearTie, the words of Checkpoint 7e (the tests above).
      expect(moves([{ kind: "release", week: 7, player: "107", returner: "107" }])).toEqual(["Week 7, when Alec Pierce returns from IR: release him instead of dropping someone else."]);
    });

    it("the lead's R3: each release made with or without the trade, after the assumed lines, by week, with why when the rule decided it", () => {
      expect(
        lines(
          {
            moves: [{ kind: "makeRoom", week: 6, drop: ["106"], for: ["203"] }],
            assumed: [
              { add: "901", drop: "108" },
              { add: "902", drop: null, eitherWay: true },
            ],
            assumedLater: [
              { week: 7, player: "107", returner: "107", nearTie: harrison },
              { week: 9, player: "108", returner: "107" },
              { week: 11, player: "107", returner: "107" },
            ],
          },
          pierce,
        ),
      ).toEqual([
        "Make room for Ignatius Fumblewick: drop Wiggleton Spoons (WR).",
        "Assumed with or without this trade: add Floopy Freeman, drop Kyle Pitts Sr.",
        "Also assumed with or without this trade, though the League page doesn't list it: add Waverly Waiver.",
        `Week 7, when Alec Pierce returns from IR: release him, with or without this trade. He and ${reason} Lock Pierce to keep him instead.`,
        "Week 9, when Alec Pierce returns from IR: release Kyle Pitts Sr. (TE), with or without this trade.",
        "Week 11, when Alec Pierce returns from IR: release him, with or without this trade.",
      ]);
      // Alone, the releases made either way are the whole list; a Plan B box words its own the same way.
      expect(lines({ moves: [], assumed: [], assumedLater: [{ week: 7, player: "108", returner: "107", nearTie: harrison }] }, pierce)).toEqual([
        `Week 7, when Alec Pierce returns from IR: release Kyle Pitts Sr. (TE), with or without this trade. He and ${reason} Lock Pitts Sr. to keep him instead.`,
      ]);
      const box = planBView({ ...planBFixture({ give: ["106"], get: ["205"] }), myMoves: { moves: [], assumed: [], assumedLater: [{ week: 7, player: "107", returner: "107", nearTie: harrison }] } }, pierce);
      expect(box?.moves).toEqual([`Week 7, when Alec Pierce returns from IR: release him, with or without this trade. He and ${reason} Lock Pierce to keep him instead.`]);
    });

    it("releaseLine and releaseReason, the League page's words (RosterCard.returns): the line, then why", () => {
      expect(releaseLine({ week: 7, player: "107", returner: "107" }, pierce)).toBe("Week 7, when Alec Pierce returns from IR: release him instead of dropping someone else.");
      expect(releaseLine({ week: 7, player: "107", returner: "107", nearTie: harrison }, pierce)).toBe(
        "Week 7, when Alec Pierce returns from IR: release him. He and Marvin Harrison Jr. are nearly even for your lineup, and Harrison Jr. has more trade value. Lock Pierce to keep him instead.",
      );
      expect(releaseLine({ week: Number.NaN, player: "108", returner: "107" }, pierce)).toBe("When Alec Pierce returns from IR: release Kyle Pitts Sr. (TE).");
      expect(releaseReason("108", harrison, pierce, { endsOnReleased: false })).toBe(`Pitts Sr. and ${reason} Lock Pitts Sr. to keep him instead.`);
      expect(releaseReason("108", { keptInstead: "105", lockable: false }, pierce, { endsOnReleased: true, named: ["105"] })).toBe("He and Harrison Jr. are nearly even for your lineup, and Harrison Jr. has more trade value.");
      expect(releaseReason("nobody", harrison, pierce, { endsOnReleased: true })).toBe("");
    });
  });

  it("Checkpoint 7e (item 2.1): a trade with either-way moves prints its odds from its own before, and its Plan B box lists its moves", () => {
    const before = { pPlayoffs: 0.64, pTitle: 0.112, prizes: { first: 0.112, second: 0.08, third: 0.09, weeklyHigh: 0, pointsLeader: 0 } };
    const baseline = { pPlayoffs: 0.6, pTitle: 0.1 };
    const own = buildTradeCard({ ...evaluation({ dPO: 0.05, dCH: 0.02 }), before }, { snapshot, baseline, fantasyCalc: FC });
    expect(own.odds.map((o) => `${o.label} ${o.value}`)).toEqual(["Title odds 11.2% → 13.2%", "Playoff odds 64% → 69%"]);
    // Without it, the search's baseline, as before.
    expect(card({ dPO: 0.05, dCH: 0.02 }, baseline).odds.map((o) => `${o.label} ${o.value}`)).toEqual(["Title odds 10.0% → 12.0%", "Playoff odds 60% → 65%"]);
    const box = planBView({ ...planBFixture({ give: ["106"], get: ["205"] }), dPO: 0.05, dCH: 0.02, before, myMoves: { moves: [{ kind: "makeRoom", week: 6, drop: ["108"], for: ["205"] }], assumed: [{ add: "901", drop: "105" }] } }, snapshot, { baseline });
    expect(box?.odds.map((o) => `${o.label} ${o.value}`)).toEqual(["Title odds 11.2% → 13.2%", "Playoff odds 64% → 69%"]);
    expect(box?.moves).toEqual(["Make room for Percival Plunk: drop Tobias Thimble (TE).", "Assumed with or without this trade: add Floopy Freeman, drop Glimmer Oddfellow."]);
    expect(planBView(planBFixture({ give: ["106"], get: ["205"] }), snapshot)?.moves).toEqual([]);
    // Review of wave B (findings B-4, either-way-before-unexplained): a card and a box whose odds start from their own "before"
    // say so under them, and the Finder's line says some ideas do; never the Analyzer's card (its line above says it).
    expect(own.oddsNote).toBe(OWN_BEFORE_NOTE);
    expect(box?.oddsNote).toBe(OWN_BEFORE_NOTE);
    expect(card({ dPO: 0.05, dCH: 0.02 }, baseline).oddsNote).toBeNull();
    expect(planBView({ ...planBFixture({ give: ["106"], get: ["205"] }), dPO: 0.05, dCH: 0.02 }, snapshot, { baseline })?.oddsNote).toBeNull();
    const finder = (trades: TradeEvaluation[]) => buildFinderView({ result: searchResult(trades), sort: "overall", snapshot, partnerId: null }).baselineNote;
    expect(finder([{ ...evaluation({ key: "a", dPO: 0.05, dCH: 0.02 }), before }])).toBe(
      "As on the League page, they count the free-agent pickups that would help each team, and every trade idea's odds start from them, except where an idea says otherwise.",
    );
    expect(finder([evaluation({ key: "a", dPO: 0.05, dCH: 0.02 })])).toBe("As on the League page, they count the free-agent pickups that would help each team, and every trade idea's odds start from them.");
    const analysis = buildAnalysisView({ evaluation: { ...evaluation({ dPO: 0.05, dCH: 0.02 }), before }, illegal: null, notes: [], baseline }, snapshot);
    expect(analysis.card?.oddsNote).toBeNull();
  });

  it("⚠️ names the roster spot when it's what trips the Market check: more players onto my active roster, and FantasyCalc's own values alone wouldn't (final review of Phase 4c, finding PAGES-6)", () => {
    const flag = (o: NonNullable<Parameters<typeof evaluation>[0]>) => card({ ...o, detail: { myTeamId: "1", ...o.detail } }).flags.find((f) => f.kind === "market" || f.kind === "hiddenByMarket")?.text;
    // 5,000 given for 5,400 + 3,200 by FantasyCalc (+72%): the model's −20% comes from the spot the 2-for-1 fills.
    expect(flag({ give: ["106"], get: ["204", "203"], gMine: -0.2 })).toBe("Market check: you'd get 2 players for 1, and counting the roster spot that costs you, you'd give up more trade value than you get.");
    expect(flag({ give: ["106"], get: ["204", "203"], gMine: -0.4 })).toBe("Market check: you'd get 2 players for 1, and counting the roster spot that costs you, you'd give up much more trade value than you get, so trade ideas leave it out.");
    // My IR player given opens no spot: 3 onto my active roster for 1 off it, two spots.
    expect(flag({ give: ["106", "107"], get: ["204", "203", "105"], gMine: -0.2 })).toBe("Market check: you'd get 3 players for 2, and counting the 2 roster spots that cost you, you'd give up more trade value than you get.");
    // The generic words otherwise: a 1-for-1; FantasyCalc's own values trip it too (9,000 for 6,900: −23%); a player received
    // into an open IR slot takes no active spot; a player FantasyCalc doesn't value.
    const generic = "Market check: counting roster spots, you'd give up more trade value than you get.";
    expect(flag({ give: ["106"], get: ["204"], gMine: -0.2 })).toBe(generic);
    expect(flag({ give: ["202"], get: ["204", "105"], gMine: -0.2 })).toBe(generic);
    expect(flag({ give: ["106"], get: ["204", "203"], gMine: -0.2, required: { me: { drops: [], adds: [], toIR: ["203"] }, partner: { drops: [], adds: [] } } })).toBe(generic);
    expect(flag({ give: ["106"], get: ["204", "201"], gMine: -0.2 })).toBe(generic);
  });

  it("says the numbers behind the score in words (§10 'always show'): lineup and their lineup, never a trade value (planner reply to Checkpoint 7a, 5.4)", () => {
    expect(c.facts).toEqual([
      { label: "Your lineup", value: "+2 pts a week in the regular season, +2 in the playoffs" },
      { label: "Their lineup", value: "0 pts a week" },
    ]);
    expect(fact(card({ partnerDeltaLineup: -1.26 }), "Their lineup")).toBe("−1.3 pts a week");
    // My odds sit next to the three numbers now (oddsViews), not among the facts.
    expect(c.facts.map((f) => f.label)).not.toContain("Playoff odds");
  });

  it("shows my title and playoff odds before and after, next to Helps you (planner reply to Checkpoint 4b, change 9)", () => {
    // The planner's example: "Title odds 12.1% → 13.4%" and "Playoff odds 65% → 69%".
    expect(card({ dCH: 0.013, dPO: 0.04 }, { pPlayoffs: 0.65, pTitle: 0.121 }).odds).toEqual([
      { label: "Title odds", value: "12.1% → 13.4%", srValue: "from 12.1% to 13.4%" },
      { label: "Playoff odds", value: "65% → 69%", srValue: "from 65% to 69%" },
    ]);
    // A change that doesn't move the printed odds still shows both ends; a loss reads downward.
    expect(card({ dCH: -0.002, dPO: 0.001 }, { pPlayoffs: 0.62, pTitle: 0.09 }).odds.map((o) => o.value)).toEqual(["9.0% → 8.8%", "62% → 62%"]);
    // Kept within 0–100%.
    expect(card({ dCH: 0.05, dPO: 0.2 }, { pPlayoffs: 0.9, pTitle: 0.97 }).odds.map((o) => o.value)).toEqual(["97.0% → 100.0%", "90% → 100%"]);
    // Without my odds before any trade: the change in percentage points.
    expect(c.odds.map((o) => o.value)).toEqual(["+1 percentage point", "+3 percentage points"]);
    expect(oddsViews({ dPO: 0.041, dCH: null }, null).map((o) => o.value)).toEqual(["unknown", "+4.1 percentage points"]);
  });

  it("says the weeks whose win chance moves at least weeklyLineMin, at most weeklyLineMax of them, the drops first, then the largest gains, in week order (change 9)", () => {
    const { weeklyLineMin, weeklyLineMax } = config.explain;
    expect([weeklyLineMin, weeklyLineMax]).toEqual([0.03, 4]);
    // The planner's example.
    const example = card({ detail: { winChance: [{ week: 9, before: 0.68, after: 0.64 }, { week: 10, before: 0.6, after: 0.61 }, { week: 13, before: 0.42, after: 0.55 }] } }).weekly;
    expect(example?.text).toBe("Win chance by week: Week 9: 68% → 64% · Week 13: 42% → 55%");
    expect(example?.weeks.map((w) => w.srText)).toEqual(["week 9 from 68% to 64%", "week 13 from 42% to 55%"]);
    // Exactly 3 points counts; just under doesn't; unknown chances are skipped.
    expect(weeklyLine([{ week: 5, before: 0.5, after: 0.53 }, { week: 6, before: 0.5, after: 0.5299 }, { week: 7, before: null, after: 0.9 }])?.text).toBe("Win chance by week: Week 5: 50% → 53%");
    // More than four: the four largest moves, shown in week order.
    const many = [5, 6, 7, 8, 9, 10].map((week, i) => ({ week, before: 0.5, after: 0.5 + 0.04 + i * 0.01 }));
    expect(weeklyLine(many)?.weeks.map((w) => w.week)).toEqual([7, 8, 9, 10]);
    expect(weeklyLine(many, { weeklyLineMin: 0.03, weeklyLineMax: 2 })?.weeks.map((w) => w.week)).toEqual([9, 10]);
    // ⚠️ The weeks it drops come first (final review of Phase 4c, finding R8), the largest drop first, then the largest
    // gains. Parker's card 6: week 14's 3.9-point drop was hidden behind gains of 4.3 and 4.4.
    const card6 = [
      { week: 6, before: 0.554, after: 0.597 },
      { week: 7, before: 0.468, after: 0.42 },
      { week: 8, before: 0.605, after: 0.649 },
      { week: 9, before: 0.484, after: 0.515 },
      { week: 11, before: 0.627, after: 0.74 },
      { week: 13, before: 0.425, after: 0.464 },
      { week: 14, before: 0.493, after: 0.454 },
    ];
    expect(weeklyLine(card6)?.text).toBe("Win chance by week: Week 7: 47% → 42% · Week 8: 61% → 65% · Week 11: 63% → 74% · Week 14: 49% → 45%");
    // More drops than places: the largest drops alone, in week order.
    const drops = [5, 6, 7, 8, 9].map((week, i) => ({ week, before: 0.6, after: 0.6 - 0.04 - i * 0.01 }));
    expect(weeklyLine([...drops, { week: 10, before: 0.4, after: 0.6 }])?.weeks.map((w) => w.week)).toEqual([6, 7, 8, 9]);
    // None moving, a points-only league's empty list, or no odds: no line.
    expect(weeklyLine([{ week: 5, before: 0.5, after: 0.51 }])).toBeNull();
    expect(weeklyLine([])).toBeNull();
    expect(weeklyLine(undefined)).toBeNull();
    expect(c.weekly).toBeNull();
  });

  it("shows no trade value, but credits FantasyCalc after a sentence whenever trade values are behind the numbers (planner reply to Checkpoint 7a, 5.4; §2.9)", () => {
    const credit = (o: Parameters<typeof evaluation>[0], fc: FantasyCalcLookup | undefined = FC) => buildTradeCard(evaluation(o), { snapshot, fantasyCalc: fc });
    // Whatever the trade (two for one, a player FantasyCalc doesn't value, a pick, nothing given), no value fact.
    for (const o of [{ give: ["105", "106"], get: ["204"] }, { give: ["106", "108"], get: ["204"] }, { give: [], get: ["204"] }, { give: ["106"], get: ["204"], value: { given: 6115, received: 5400 } }]) {
      const view = credit(o);
      expect(view.facts.map((f) => f.label)).toEqual(["Your lineup", "Their lineup"]);
      expect(view.valuesCredit).toBe(VALUES_CREDIT_TEXT);
    }
    expect(VALUES_CREDIT_TEXT).toBe("These numbers weigh each player's trade value.");
    // Our estimates fitted to an older FantasyCalc list (the curve fallback) are behind the numbers too; without the page's
    // lookup, values are taken to be loaded; with none loaded at all, no credit.
    expect(credit({}, fantasyCalcLookup({ ...MARKET, fallback: { kind: "curve", listDate: "2026-09-01T00:00:00.000Z" } })).valuesCredit).toBe(VALUES_CREDIT_TEXT);
    expect(credit({}, undefined).valuesCredit).toBe(VALUES_CREDIT_TEXT);
    expect(credit({}, fantasyCalcLookup(null)).valuesCredit).toBeNull();
  });

  it("reads FantasyCalc's own values from the model inputs: the perception list, a saved list with its date, never the curve fallback's estimates", () => {
    expect(FC.available).toBe(true);
    expect([FC.value("106"), FC.value("108"), FC.value("constructor"), FC.value("__proto__")]).toEqual([5000, null, null, null]);
    expect(FC.note).toBeNull();
    // A keeper league reads its redraft list (how managers see a trade), not the dynasty one.
    const keeper = fantasyCalcLookup({ ...MARKET, values: { "106": 9000 }, redraftValues: { "106": 4800 } });
    expect(keeper.value("106")).toBe(4800);
    // A saved list stands in: its values, and a note with its day.
    const saved = fantasyCalcLookup({ ...MARKET, fallback: { kind: "saved", listDate: "2026-09-27T15:00:00.000Z" } });
    expect([saved.available, saved.value("106"), saved.note]).toEqual([true, 5000, "Trade values from Sep 27: FantasyCalc didn't answer."]);
    // The curve fallback: no FantasyCalc value is quoted; nor without a market.
    const curve = fantasyCalcLookup({ ...MARKET, fallback: { kind: "curve", listDate: "2026-09-01T00:00:00.000Z" } });
    expect([curve.available, curve.value("106"), curve.note]).toEqual([false, null, null]);
    expect(fantasyCalcLookup(undefined).available).toBe(false);
  });

  it("adds long-term value in dynasty and keeper leagues in words only (FantasyCalc's dynasty values: planner reply to Checkpoint 7a, 5.4), or says it's unknown when values didn't load", () => {
    const scale = config.benefit.bFutureScale; // B_future = scale × ΔDyn / MyDynTotal
    expect(fact(card({ dDyn: 1234.4, bFuture: 0.06 * scale, lambda: 0.5 }), "Long-term value")).toBe("Up for your roster");
    expect(fact(card({ dDyn: -300, bFuture: -0.04 * scale, lambda: 0.5 }), "Long-term value")).toBe("Down for your roster");
    // Under config.explain.longTermMin (1%), or rounding to 0%: about the same, as the reasons leave it out.
    expect(fact(card({ dDyn: 40, bFuture: 0.004 * scale, lambda: 0.5 }), "Long-term value")).toBe("About the same for your roster");
    expect(fact(card({ dDyn: 0, bFuture: 0, lambda: 0.5 }), "Long-term value")).toBe("About the same for your roster");
    expect(fact(card({ dynMissing: true }), "Long-term value")).toBe("Unknown: long-term values didn't load");
    expect(fact(c, "Long-term value")).toBeUndefined();
    expect(fact(card({ dDyn: 1234.4, bFuture: 0.06 * scale, lambda: 0.5 }), "Long-term value")).not.toMatch(/\d/);
  });

  it("gives ROS points received and given (§13's 'You get 142 ROS pts, give 118')", () => {
    expect(card({ ros: { received: 142.4, given: 117.6 } }).ros).toBe("You get 142 ROS pts, give 118");
  });

  it("says when my starting lineup moves the other way from those ROS points (review of Phase 4b: a backup QB given away)", () => {
    // Doubs + Bo Nix for DK Metcalf on Parker's league: "You get 96 ROS pts, give 295", yet my lineup gains every week.
    const weekly = [
      { week: 12, before: 110, after: 110 }, // a week in progress: the same both times
      { week: 13, before: 100, after: 104.2 },
      { week: 14, before: 101, after: 106.5 },
      { week: 15, before: 98, after: 103.7 },
    ];
    const backup = card({ ros: { received: 96, given: 295 }, detail: { weekly } });
    expect(backup.ros).toBe("You get 96 ROS pts, give 295");
    expect(backup.rosNote).toBe("Your starting lineup still gains 15 ROS pts: ROS points count each player's projected points whether he starts or not.");
    // The other way: more ROS points in, fewer in my lineup.
    const down = weekly.map((w) => ({ ...w, after: w.week === 12 ? w.before : w.before - 4 }));
    expect(card({ ros: { received: 150, given: 100 }, detail: { weekly: down } }).rosNote).toBe(
      "Your starting lineup loses 12 ROS pts even so: ROS points count each player's projected points whether he starts or not.",
    );
    expect(rosNoteOf({ ros: { received: 10, given: 20 }, detail: { weekly: [{ week: 13, before: 100, after: 101 }] } })).toBe(
      "Your starting lineup still gains 1 ROS pt: ROS points count each player's projected points whether he starts or not.",
    );
    // Nothing when the two agree, when the lineup's change rounds to 0, or when the weeks aren't known.
    expect(card({ ros: { received: 150, given: 100 }, detail: { weekly } }).rosNote).toBeNull();
    expect(card({ ros: { received: 96, given: 295 }, detail: { weekly: [{ week: 13, before: 100, after: 100.3 }] } }).rosNote).toBeNull();
    expect(card({ ros: { received: 96, given: 295 } }).rosNote).toBeNull();
    expect(c.rosNote).toBeNull();
  });

  it("says the roster moves the trade forces, for either side (§7); adds that fill no open spot (a roster minimum's, or an evaluation from before Phase 7c) as before", () => {
    const forced = card({ required: { me: { drops: ["108"], adds: [] }, partner: { drops: [], adds: ["901", "902"] } } });
    expect(forced.required).toEqual([
      "You'd drop Tobias Thimble (TE, JAX) to stay within your roster limits.",
      "Gravel Gophers would pick up Floopy Freeman (RB, CAR) and Waverly Waiver (RB, NE) from free agents to fill their roster.",
    ]);
    expect(c.required).toEqual([]);
  });

  it("says each open roster spot and who fills it, the position given up, one sentence a spot, for either side (planner reply to Checkpoint 7b, section 5)", () => {
    const spots = card({
      required: {
        me: { drops: [], adds: ["901"], openSpots: [{ playerId: "901", pos: "RB" }] },
        partner: { drops: [], adds: ["902", "904"], openSpots: [{ playerId: "902", pos: "RB" }, { playerId: "904", pos: "K" }] },
      },
    });
    expect(spots.required).toEqual([
      "Open roster spot: add Floopy Freeman, the best available RB.",
      "Gravel Gophers' open roster spot: they'd add Waverly Waiver, the best available RB.",
      "Gravel Gophers' open roster spot: they'd add Kip Kickington, the best available kicker.",
    ]);
    // D/ST on ESPN (the platform's own word elsewhere); the fallback says where nobody was available; a roster minimum's add
    // keeps its own sentence, before the spots (rule 3 before rule 4).
    const mixed = card({
      required: {
        me: { drops: [], adds: ["902", "SEA", "901"], openSpots: [{ playerId: "SEA", pos: "DEF" }, { playerId: "901", pos: null, short: ["TE"] }] },
        partner: { drops: [], adds: ["904"], openSpots: [{ playerId: "904", pos: null, short: ["QB", "RB", "TE"] }] },
      },
    });
    expect(mixed.required).toEqual([
      "You'd pick up Waverly Waiver (RB, NE) from free agents to fill your roster.",
      "Open roster spot: add Seahawks D/ST, the best available D/ST.",
      "Open roster spot: add Floopy Freeman, the best available free agent (no TE is available).",
      "Gravel Gophers' open roster spot: they'd add Kip Kickington, the best available free agent (no QB, RB or TE is available).",
    ]);
    const sleeper = buildTradeCard(evaluation({ required: { me: { drops: [], adds: ["SEA", "901"], openSpots: [{ playerId: "SEA", pos: "DEF" }, { playerId: "901", pos: null, short: ["RB", "TE"] }] }, partner: { drops: [], adds: [] } } }), { snapshot: { ...snapshot, platform: "sleeper" }, baseline: null });
    expect(sleeper.required).toEqual(["Open roster spot: add Seahawks D/ST, the best available DEF.", "Open roster spot: add Floopy Freeman, the best available free agent (no RB or TE is available)."]);
    // No short position left to name (a position the team streams): no parentheses.
    expect(card({ required: { me: { drops: [], adds: ["901"], openSpots: [{ playerId: "901", pos: null }] }, partner: { drops: [], adds: [] } } }).required).toEqual(["Open roster spot: add Floopy Freeman, the best available free agent."]);
  });

  it("says an open spot's fill is dropped again at an IR return in the spot's own sentence, and when the partner's fill is my own League-page pickup (review of Phase 7c's fill, findings pickups-3 and pickups-4)", () => {
    const spots = card({
      required: {
        me: {
          drops: [],
          adds: ["901", "902"],
          openSpots: [
            { playerId: "901", pos: "RB" },
            { playerId: "902", pos: null, short: ["TE"] },
          ],
          // My fills, dropped again from my IR returners' weeks; another player too (his own line, as before).
          displaced: [
            { playerId: "901", week: 7, returner: "206" },
            { playerId: "902", week: Number.NaN, returner: "107" },
            { playerId: "108", week: 15, returner: "206" },
          ],
        },
        partner: { drops: [], adds: ["904"], openSpots: [{ playerId: "904", pos: "K", yours: true }], displaced: [{ playerId: "904", week: 9, returner: "205" }] },
      },
    });
    expect(spots.required).toEqual([
      "Open roster spot: add Floopy Freeman, the best available RB, until Rupert Wimbleton comes back from IR in week 7.",
      "Open roster spot: add Waverly Waiver, the best available free agent (no TE is available), until Humbert Fiddlesticks comes back from IR.",
      "From week 15, when Rupert Wimbleton comes back from IR, you'd drop Tobias Thimble (TE, JAX).",
      "Gravel Gophers' open roster spot: they'd add Kip Kickington, the best available kicker, the pickup the League page suggests for you, until Percival Plunk comes back from IR in week 9.",
    ]);
    // Without a return, the partner's fill that takes my pickup says so alone; a fill the returner doesn't displace reads as before.
    const yours = card({ required: { me: { drops: [], adds: ["901"], openSpots: [{ playerId: "901", pos: "RB" }], displaced: [{ playerId: "108", week: 15, returner: "206" }] }, partner: { drops: [], adds: ["902"], openSpots: [{ playerId: "902", pos: "RB", yours: true }] } } });
    expect(yours.required).toEqual([
      "Open roster spot: add Floopy Freeman, the best available RB.",
      "From week 15, when Rupert Wimbleton comes back from IR, you'd drop Tobias Thimble (TE, JAX).",
      "Gravel Gophers' open roster spot: they'd add Waverly Waiver, the best available RB, the pickup the League page suggests for you.",
    ]);
  });

  it("says where a received IR player goes and who is dropped when an IR player comes back, for either side (Phase 4b, RosterChange.toIR and .displaced)", () => {
    const forced = card({
      give: ["105"],
      get: ["206"],
      required: {
        me: { drops: [], adds: [], toIR: ["206"], displaced: [{ playerId: "108", week: 15, returner: "206" }] },
        partner: { drops: [], adds: [], toIR: ["107", "104"], displaced: [{ playerId: "205", week: 14, returner: "107" }] },
      },
    });
    expect(forced.required).toEqual([
      "Rupert Wimbleton goes to your IR slot (no roster spot until he's back).",
      "From week 15, when Rupert Wimbleton comes back from IR, you'd drop Tobias Thimble (TE, JAX).",
      "Humbert Fiddlesticks and Noodle McSprocket go to Gravel Gophers' IR slots (no roster spots until they're back).",
      "From week 14, when Humbert Fiddlesticks comes back from IR, Gravel Gophers would drop Percival Plunk (WR, LAR).",
    ]);
    // Next to the drops and adds, mine first; empty or absent fields say nothing.
    const both = card({ required: { me: { drops: ["108"], adds: [], toIR: [], displaced: [] }, partner: { drops: [], adds: ["901"], toIR: ["206"] } } });
    expect(both.required).toEqual([
      "You'd drop Tobias Thimble (TE, JAX) to stay within your roster limits.",
      "Gravel Gophers would pick up Floopy Freeman (RB, CAR) from free agents to fill their roster.",
      "Rupert Wimbleton goes to Gravel Gophers' IR slot (no roster spot until he's back).",
    ]);
  });

  it("says it's a choice when the player released at an IR return is the returner himself (review of track UIC, finding 7)", () => {
    // §7: on a full roster from his return he's a bench player like any other, and he can be the one released.
    const self = card({
      required: {
        me: { drops: [], adds: [], displaced: [{ playerId: "206", week: 7, returner: "206" }] },
        partner: { drops: [], adds: [], displaced: [{ playerId: "107", week: 9, returner: "107" }, { playerId: "205", week: Number.NaN, returner: "205" }] },
      },
    });
    expect(self.required).toEqual([
      "From week 7, when Rupert Wimbleton comes back from IR, you'd release him instead of dropping someone else.",
      "From week 9, when Humbert Fiddlesticks comes back from IR, Gravel Gophers would release him instead of dropping someone else.",
      "When Percival Plunk comes back from IR, Gravel Gophers would release him instead of dropping someone else.",
    ]);
    // Never his name twice in one sentence.
    for (const line of self.required) expect(line.match(/Rupert Wimbleton|Humbert Fiddlesticks|Percival Plunk/g)?.length).toBe(1);
  });

  it("leaves out explain.ts's caveat that repeats the injured flag, and only it (review of Phase 4b)", () => {
    // The engine's own words for a trade that depends on an injured player.
    const e = evaluation({ give: ["106"], get: ["107"], flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: ["107"] } });
    const words = explainTrade(e, { teamName: (id) => teamNameOf(snapshot, id), player: (id) => snapshot.players[id] ?? null, slots: [], leagueType: "redraft", tradeDeadline: null });
    const shown = buildTradeCard({ ...e, reasons: words.reasons, pitch: words.pitch }, { snapshot });
    expect(shown.reasons).toEqual(words.reasons.filter((r) => !INJURED_REASON.test(r)));
    expect(shown.reasons.join(" ")).not.toContain("assume");
    expect(shown.flags[0]?.text).toContain("Depends on an injured player: Humbert Fiddlesticks");
    expect(INJURED_REASON.test("Depends on injured players: A (out) and B (on injured reserve), and the numbers assume they return as expected.")).toBe(true);
    // Without the flag, every reason stays as written.
    const plain = evaluation({ reasons: ["Depends on an injured player: kept when no flag says it."] });
    expect(buildTradeCard(plain, { snapshot }).reasons).toEqual(plain.reasons);
  });

  it("carries the reasons and pitch as explain.ts wrote them, and links to the Analyzer with the trade", () => {
    expect(c.reasons).toEqual(["Your RB2 spot goes from 9.1 to 14.3 projected points per week."]);
    expect(c.pitch).toBe("Hey! Want Wiggleton Spoons for Cornelius Snoot?");
    expect(c.analyzerHref).toBe("/analyzer?partner=2&give=106&get=204");
  });

  it("uses no jargon", () => {
    const words = allText(card({ gMine: -0.2, dDyn: 50, required: { me: { drops: ["108"], adds: [] }, partner: { drops: [], adds: [] } }, flags: { marketCheck: true, hiddenByMarket: false, hiddenByBenefit: false, injured: ["107"] } }));
    for (const jargon of ["EV", "σ", "V*", "g_mkt", "NaN", "undefined"]) expect(words).not.toContain(jargon);
  });
});

describe("'Harder to get' on the players I'd get (planner addendum to Checkpoint 3, §2)", () => {
  it("tags a player I'd get whose premium earns it (TradeDetail.premium), in words with why on hover; never one I give, never one without", () => {
    const c = card({ get: ["202", "204"], detail: { premium: [GLOOP_PREMIUM, SNOOT_PREMIUM] } });
    expect(c.get.map((a) => [a.id, a.tag])).toEqual([
      ["202", { text: HARDER_TO_GET_TAG, title: "Harder to get: their most valuable player and one of the top 12 players by trade value, so expect them to want a little extra for him." }],
      ["204", null],
    ]);
    expect(c.give.every((a) => a.tag === null)).toBe(true);
    // A second most valuable one says so; a fact that isn't there (an evaluation before the addendum) tags nobody.
    expect(card({ get: ["201"], detail: { premium: [{ playerId: "201", e: 0.15, rank: 2, elite: true, harderToGet: true }] } }).get[0]?.tag?.title).toBe(
      "Harder to get: their second most valuable player and one of the top 12 players by trade value, so expect them to want a little extra for him.",
    );
    expect(card({ get: ["202"] }).get[0]?.tag).toBeNull();
    // A pick is never tagged.
    expect(buildTradeCard(evaluation({ proposal: { partnerId: "2", give: [{ kind: "player", id: "106" }], get: [{ kind: "pick", season: 2027, round: 1, originalTeamId: "2" }] } }), { snapshot }).get[0]?.tag).toBeNull();
  });

  it("words who carries the tag from config (the trade pages' and League page's explainers)", () => {
    const sp = config.acceptance.starPremium;
    expect(harderToGetWho("their")).toBe(`one of their two most valuable players and one of the top ${sp.eliteTop} players by trade value`);
    expect(premiumReasons({ rank: 3, elite: false }, "their")).toEqual([]); // a third most valuable player carries no premium
    expect(premiumReasons({ rank: 1, elite: false }, "his team's")).toEqual(["his team's most valuable player"]);
  });
});

describe("“How to offer it”: offers in order (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1)", () => {
  // The card gives Wiggleton Spoons (106) to Gravel Gophers for Cornelius Snoot (204), 30%. Its ladder: open with Spoons for
  // Mortimer Gloop and Snoot (better for me, 15%), then Spoons for Ignatius Fumblewick (20%), then the card, then the card
  // with my Tobias Thimble added (40%), whose numbers assume Gravel Gophers drops Percival Plunk.
  const base = evaluation({ b: 3, pAccept: 0.3, pComplete: 0.3 });
  const open = evaluation({ get: ["202", "204"], b: 4.2, pAccept: 0.15, pComplete: 0.15 });
  const then = evaluation({ get: ["203"], b: 3.6, pAccept: 0.2, pComplete: 0.2 });
  const last = evaluation({ give: ["106", "108"], b: 2.7, pAccept: 0.4, pComplete: 0.4, required: { me: { drops: [], adds: [] }, partner: { drops: ["205"], adds: [] } } });
  const OPEN_MESSAGE = "Hey! Would you trade Mortimer Gloop and Cornelius Snoot for Wiggleton Spoons?";
  const ladderOf = (steps: OfferLadder["steps"]): OfferLadder => ({ cardKey: base.key, steps, ms: 420 });
  const full = ladderOf([
    { kind: "open", evaluation: open, message: OPEN_MESSAGE },
    { kind: "then", evaluation: then, message: "Thanks for considering it! Would you trade Ignatius Fumblewick for Wiggleton Spoons instead? Let me know what you think!" },
    { kind: "suggested", evaluation: base, message: "Thanks for considering it! Would you trade Cornelius Snoot for Wiggleton Spoons instead? Let me know what you think!" },
    { kind: "last", evaluation: last, message: "Thanks for considering it! Would you trade Cornelius Snoot for Wiggleton Spoons and Tobias Thimble instead? Let me know what you think!" },
  ]);
  const cardOf = (e: TradeEvaluation = base, ctx: Partial<Parameters<typeof buildTradeCard>[1]> = {}) => buildTradeCard(e, { snapshot, goal: "title", ...ctx });
  const SCALE = { b3: FIXTURE_B3, helpsReason: null };
  const inputsOf = (x: TradeEvaluation) => ({ features: { ...x.features }, gPartner: x.gPartner, b: x.b, goal: "title", ...SCALE });

  it("puts “How to offer it” on every card that helps me; never on one that doesn't, one not scored, one the market guard hides, or a Plan B opened in the Analyzer", () => {
    expect(cardOf().offers).toEqual({ heading: OFFERS_HEADING, suggested: "The suggested trade" });
    expect(OFFERS_HEADING).toBe("How to offer it");
    expect(cardOf(base, { offers: "analyzer" }).offers).toEqual({ heading: "How to offer it", suggested: ANALYZER_SUGGESTED_LABEL });
    expect(cardOf(base, { offers: "none" }).offers).toBeNull();
    // Phase 4's rule for its steps, kept (⚠️ ours): a trade the Trade Finder couldn't show has no offers to work out.
    expect(cardOf(evaluation({ b: -1 })).offers).toBeNull();
    expect(cardOf(evaluation({ b: null })).offers).toBeNull();
    expect(cardOf(evaluation({ gMine: -0.5 })).offers).toBeNull();
    // An older evaluation's steps aren't read any more: the card offers the ladder instead, its one version its own.
    expect(cardOf(steppedFull()).offers).not.toBeNull();
    expect(cardOf(steppedFull()).versions.map((v) => v.version)).toEqual(["suggested"]);
    // The Analyzer's card: the trade built, unless it was opened from a card's Plan B (one offer).
    expect(buildAnalysisView({ evaluation: base, illegal: null, notes: [] }, snapshot).card?.offers?.suggested).toBe("The trade you built");
    expect(buildAnalysisView({ evaluation: base, illegal: null, notes: [] }, snapshot, undefined, { from: "planB" }).card?.offers).toBeNull();
    expect(offersView(base)).toEqual({ heading: "How to offer it", suggested: "The suggested trade" });
  });

  it("words each offer in order: its label and players, Helps you and the chance they accept as the card prints them, and its own message", () => {
    const view = buildLadderView(full, cardOf(), { snapshot, goal: "title" });
    expect(view.cardKey).toBe(base.key);
    expect(view.alone).toBe(false);
    expect(view.intro).toBe(OFFERS_INTRO_TEXT);
    expect(OFFERS_INTRO_TEXT).toBe("Offer them in order: if they say no, try the next.");
    expect(view.steps.map((s) => s.text)).toEqual([
      "Open with: Wiggleton Spoons for Mortimer Gloop and Cornelius Snoot · Helps you 50 · Chance they accept 15% (Est. · Possible)",
      "Then: Wiggleton Spoons for Ignatius Fumblewick · Helps you 45 · Chance they accept 20% (Est. · Possible)",
      "The suggested trade: Wiggleton Spoons for Cornelius Snoot · Helps you 39 · Chance they accept 30% (Est. · Possible)",
      "Last offer: Wiggleton Spoons and Tobias Thimble for Cornelius Snoot · Helps you 36 · Chance they accept 40% (Est. · Decent)",
    ]);
    expect(view.steps[0]).toEqual({
      kind: "open",
      label: "Open with",
      trade: "Wiggleton Spoons for Mortimer Gloop and Cornelius Snoot",
      numberParts: [{ text: "Helps you 50" }, { text: "Chance they accept 15%", label: "(Est. · Possible)" }],
      acceptNote: null,
      moves: [],
      message: OPEN_MESSAGE,
      key: open.key,
      text: "Open with: Wiggleton Spoons for Mortimer Gloop and Cornelius Snoot · Helps you 50 · Chance they accept 15% (Est. · Possible)",
    });
    expect(OFFER_STEP_LABEL).toEqual({ open: "Open with", then: "Then", suggested: "The suggested trade", last: "Last offer" });
    // The Analyzer's names the trade built.
    expect(buildLadderView(full, cardOf(base, { offers: "analyzer" }), { snapshot }).steps[2]?.label).toBe("The trade you built");
  });

  it("lists an offer's roster moves only when they aren't the card's, in the card's own words", () => {
    const view = buildLadderView(full, cardOf(), { snapshot });
    expect(view.steps.map((s) => s.moves)).toEqual([[], [], [], ["Gravel Gophers would drop Percival Plunk (WR, LAR) to stay within their roster limits."]]);
    // Moves the card assumes too aren't repeated: here every offer's are the card's.
    const moving = { required: { me: { drops: ["105"], adds: [] }, partner: { drops: [], adds: [] } } };
    const same = ladderOf([
      { kind: "open", evaluation: { ...open, ...moving }, message: OPEN_MESSAGE },
      { kind: "suggested", evaluation: { ...base, ...moving }, message: "" },
    ]);
    const c = cardOf({ ...base, ...moving });
    expect(c.required).toEqual(["You'd drop Glimmer Oddfellow (WR, SEA) to stay within your roster limits."]);
    expect(buildLadderView(same, c, { snapshot }).steps.map((s) => s.moves)).toEqual([[], []]);
    // moveLinesOf is the card's own list.
    expect(moveLinesOf({ ...base, ...moving }, snapshot, "Gravel Gophers")).toEqual(c.required);
  });

  it("tags a hurt player in an offer, and says when the league's review could cut the chance it goes through, as the card does", () => {
    const hurt = evaluation({ get: ["206"], b: 3.6, pAccept: 0.4, pComplete: 0.2, detail: { vetoRisk: true } });
    const view = buildLadderView(ladderOf([{ kind: "open", evaluation: hurt, message: "x" }, { kind: "suggested", evaluation: base, message: "y" }]), cardOf(), { snapshot: tradeSnapshot({ tradeReview: "league_vote" }) });
    expect(view.steps[0]?.trade).toBe("Wiggleton Spoons for Rupert Wimbleton (Doubtful)");
    expect(view.steps[0]?.acceptNote).toBe("Counting a league veto vote, about 20% it goes through.");
    expect(view.steps[0]?.text).toBe("Open with: Wiggleton Spoons for Rupert Wimbleton (Doubtful) · Helps you 45 · Chance they accept 40% (Est. · Decent) · Counting a league veto vote, about 20% it goes through.");
  });

  it("says to offer the trade as it is when the ladder holds the suggested trade alone (the lead's words)", () => {
    const view = buildLadderView(ladderOf([{ kind: "suggested", evaluation: base, message: "x" }]), cardOf(), { snapshot });
    expect(view.alone).toBe(true);
    expect(view.intro).toBe("Offer this trade as it is: no version of it with Gravel Gophers makes a better first offer.");
    expect(offersAloneText("Team 8")).toBe("Offer this trade as it is: no version of it with Team 8 makes a better first offer.");
    // An empty answer (the engine couldn't evaluate the trade) isn't "as it is" (the review of wave D, UI-D-8): it says so.
    const none = buildLadderView(ladderOf([]), cardOf(), { snapshot });
    expect([none.alone, none.none, none.steps, none.intro, none.versions]).toEqual([false, true, [], OFFERS_NONE_TEXT, []]);
    expect(OFFERS_NONE_TEXT).toBe("This trade can't be worked out with the league as it stands now.");
    expect(view.opensElsewhere).toBe(false);
  });

  it("gives each offer as a version the feedback can record, in order, the card's own trade among them, then Plan B (Checkpoint 7e: “Feedback records which step was sent”)", () => {
    const planB = planBFixture({ partnerId: "2", give: ["105"], get: ["203"] });
    const c = cardOf(evaluation({ b: 3, pAccept: 0.3, pComplete: 0.3, planB }));
    expect(c.versions.map((v) => [v.version, v.label])).toEqual([
      ["suggested", "The suggested trade"],
      ["planB", "If they won't move: Glimmer Oddfellow for Ignatius Fumblewick"],
    ]);
    const view = buildLadderView(full, c, { snapshot, goal: "title" });
    expect(view.versions).toEqual([
      { version: "open", key: open.key, pAccept: 0.15, pComplete: 0.15, inputs: inputsOf(open), label: "Open with: Wiggleton Spoons for Mortimer Gloop and Cornelius Snoot" },
      { version: "then", key: then.key, pAccept: 0.2, pComplete: 0.2, inputs: inputsOf(then), label: "Then: Wiggleton Spoons for Ignatius Fumblewick" },
      { ...c.versions[0], label: "The suggested trade" },
      { version: "last", key: last.key, pAccept: 0.4, pComplete: 0.4, inputs: inputsOf(last), label: "Last offer: Wiggleton Spoons and Tobias Thimble for Cornelius Snoot" },
    ]);
    // With Plan B's after them once the offers are in (cardVersions); the card's own two until then.
    expect(cardVersions(c, view).map((v) => v.version)).toEqual(["open", "then", "suggested", "last", "planB"]);
    expect(cardVersions(c, null)).toBe(c.versions);
    // An offer's own scale (its evaluation's B₃) goes with its inputs.
    const scaled = buildLadderView(ladderOf([{ kind: "open", evaluation: { ...open, b3: 4.4 }, message: "x" }, { kind: "suggested", evaluation: base, message: "y" }]), c, { snapshot, goal: "title" });
    expect(scaled.versions[0]?.inputs).toMatchObject({ b3: 4.4, goal: "title" });
  });

  it("names a recorded offer by its place and players when the card doesn't show it right now (⚠️ ours: never “an earlier one”)", () => {
    const c = cardOf();
    const view = buildLadderView(full, c, { snapshot });
    const fb = (version: "open" | "then" | "last" | "suggested" | "planB", versionKey: string, versionWords: string | null) => ({ outcome: "sent" as const, version, versionKey, versionWords });
    // Open: its label, with the offers shown.
    expect(versionLine(fb("open", open.key, null), cardVersions(c, view))).toBe("Open with: Wiggleton Spoons for Mortimer Gloop and Cornelius Snoot");
    expect(versionLine(fb("suggested", base.key, null), cardVersions(c, view))).toBe("The suggested trade");
    // Closed (a reload): by its place and the players its key names.
    expect(versionLine(fb("open", open.key, "Wiggleton Spoons for Mortimer Gloop and Cornelius Snoot"), c.versions)).toBe("Open with: Wiggleton Spoons for Mortimer Gloop and Cornelius Snoot");
    expect(versionLine(fb("last", last.key, "Wiggleton Spoons and Tobias Thimble for Cornelius Snoot"), c.versions)).toBe("Last offer: Wiggleton Spoons and Tobias Thimble for Cornelius Snoot");
    expect(versionLine(fb("then", then.key, null), c.versions)).toBe("an earlier one");
    // The card's own trade on a plain card goes without saying.
    expect(versionLine(fb("suggested", base.key, null), c.versions)).toBeNull();
  });

  it("names what it can't find plainly, and uses no jargon", () => {
    expect(tradeWords({ give: [], get: [{ kind: "player", id: "204" }] }, snapshot)).toBe("nothing for Cornelius Snoot");
    expect(tradeWords({ give: [{ kind: "player", id: "104" }, { kind: "player", id: "105" }], get: [{ kind: "player", id: "203" }] }, snapshot)).toBe("Noodle McSprocket and Glimmer Oddfellow for Ignatius Fumblewick");
    const gone = buildLadderView(ladderOf([{ kind: "open", evaluation: evaluation({ get: ["999"] }), message: "x" }, { kind: "suggested", evaluation: base, message: "y" }]), cardOf(), { snapshot });
    expect(gone.steps[0]?.trade).toBe("Wiggleton Spoons for A player who's no longer in this league's data");
    const words = JSON.stringify(buildLadderView(full, cardOf(), { snapshot }));
    for (const jargon of ["EV", "σ", "V*", "g_mkt", "throw-in", "NaN", "undefined", "ladder"]) expect(words).not.toContain(jargon);
  });
});

describe("baselineLines: my odds before any trade, and what they count (review of Phase 4; Phase 4c: the League page's)", () => {
  it("says them for the Finder's list and the Analyzer's trade: the League page's headline odds (planner reply to Checkpoint 4b, change 9), the title with one decimal", () => {
    expect(baselineLines({ pPlayoffs: 0.712, pTitle: 0.153 }, "finder")).toEqual({
      text: "Your odds before any trade: 71% to make the playoffs, 15.3% to win the title.",
      note: "As on the League page, they count the free-agent pickups that would help each team, and every trade idea's odds start from them.",
    });
    expect(baselineLines({ pPlayoffs: 0.712, pTitle: 0.153 }, "analyzer")).toEqual({
      text: "Your odds before this trade: 71% to make the playoffs, 15.3% to win the title.",
      note: "As on the League page, they count the free-agent pickups that would help each team, and the trade's odds start from them.",
    });
    // Never "they can differ from the League page's" any more: one baseline everywhere.
    expect(baselineLines({ pPlayoffs: 0.5, pTitle: 0.1 }, "finder")?.note).not.toContain("differ");
    // Title odds unknown: the playoffs alone; no odds at all: nothing.
    expect(baselineLines({ pPlayoffs: 0.5, pTitle: null }, "finder")?.text).toBe("Your odds before any trade: 50% to make the playoffs.");
    for (const none of [null, undefined, { pPlayoffs: null, pTitle: 0.1 }, { pPlayoffs: Number.NaN, pTitle: null }]) expect(baselineLines(none, "finder")).toBeNull();
  });
});

describe("buildFinderView (§13 ranking, M13 states)", () => {
  const a = evaluation({ key: "a", b: 2, pComplete: 0.6, give: ["105"] });
  const b = evaluation({ key: "b", b: 8, pComplete: 0.1, give: ["104"] });
  const c = evaluation({ key: "c", b: 4, pComplete: 0.5, partnerId: "3", get: ["303"] });
  const result = searchResult([a, b, c]);

  it("sorts by Overall (EG = B × P_complete) by default, and by Helps you or Chance they accept on request (rank.ts sortTrades)", () => {
    const keys = (sort: "overall" | "helps" | "accept") => buildFinderView({ result, sort, snapshot, partnerId: null }).cards.map((x) => x.key);
    expect(keys("overall")).toEqual(["c", "a", "b"]); // 2.0, 1.2, 0.8
    expect(keys("helps")).toEqual(["b", "c", "a"]);
    expect(keys("accept")).toEqual(["a", "c", "b"]);
  });

  it("says my odds before any trade and what they count, how many ideas and their order, what was found, what was looked at, and passes notes and warnings on", () => {
    const view = buildFinderView({ result: { ...result, notes: ["Kickers and D/STs are left out; turn them on in Settings."], warnings: ["Sleeper's week 17 projections didn't load."] }, sort: "helps", snapshot, partnerId: null });
    // Review of Phase 4: "Your odds now: 71%" sat next to the League page's 76% (rosters as they stand), so it says what it
    // is; since Phase 4c they are the League page's headline odds.
    expect(view.baseline).toBe("Your odds before any trade: 62% to make the playoffs, 9.0% to win the title.");
    expect(view.baselineNote).toBe("As on the League page, they count the free-agent pickups that would help each team, and every trade idea's odds start from them.");
    // What Helps you sums up, once for the list (the planner's words in a redraft league).
    expect(view.helpsInfo).toBe("Helps you (0–100) sums up how much your title and playoff odds rise, minus a cost for giving away trade value or plus a credit for gaining it. 63 ≈ as good as adding 3 points a week to your lineup for the rest of the season.");
    expect(view.countText).toBe("3 trade ideas, sorted by Helps you.");
    expect(view.statusText).toBe("Found 3 trade ideas.");
    // Not "the best 200" (review of track UIC, finding 6): exact evaluation adds the lean companions to the best by screening.
    expect(view.searched).toBe(`Looked at 1,234 trade ideas, checked 200 closely, and played out your season ${config.simulation.finalSims.toLocaleString("en-US")} times with each of the best 40. That took 4.2 seconds.`);
    expect(buildFinderView({ result: { ...result, counts: { screened: 15873, exact: 208, simScreen: 208, simFinal: 60 } }, sort: "overall", snapshot, partnerId: null }).searched).toMatch(
      /^Looked at 15,873 trade ideas, checked 208 closely, and played out your season [\d,]+ times with each of the best 60\. /,
    );
    // Checkpoint 7e (planner reply to Checkpoint 7d, item 1.1): every idea shown is played out on the shown block's seasons.
    expect(buildFinderView({ result: { ...result, counts: { screened: 15873, exact: 208, simScreen: 208, simFinal: 60, simShown: 14 } }, sort: "overall", snapshot, partnerId: null }).searched).toBe(
      "Looked at 15,873 trade ideas, checked 208 closely, and played out your season 5,000 times with each of the best 60 and 20,000 times with each idea shown. That took 4.2 seconds.",
    );
    expect(view.notes).toEqual(["Kickers and D/STs are left out; turn them on in Settings."]);
    expect(view.warnings).toEqual(["Sleeper's week 17 projections didn't load."]);
    expect(view.empty).toBeNull();
    // Baseline odds give each card's odds their "before".
    expect(view.cards[0]?.odds.map((o) => o.value)).toEqual(["9.0% → 10.0%", "62% → 65%"]);
  });

  it("counts what was left out on purpose (§10 guards)", () => {
    const view = buildFinderView({ result: { ...result, hidden: { byBenefit: 10, byMarket: 1 } }, sort: "overall", snapshot, partnerId: null });
    // In words: no trade value percent anywhere (planner reply to Checkpoint 7a, 5.4).
    expect(view.hidden).toBe("Left out on purpose: 10 trade ideas that wouldn't help you and 1 trade idea where, counting roster spots, you'd give up much more trade value than you get.");
    expect(view.hidden).not.toMatch(/\d+%/);
    // Phase 4c: the ideas below the minimum chance too.
    const withChance = buildFinderView({ result: { ...result, hidden: { byBenefit: 2, byMarket: 0, byChance: 3 } }, sort: "overall", snapshot, partnerId: null });
    expect(withChance.hidden).toBe("Left out on purpose: 2 trade ideas that wouldn't help you and 3 trade ideas below your minimum chance.");
    expect(buildFinderView({ result: { ...result, hidden: { byBenefit: 0, byMarket: 0, byChance: 1 } }, sort: "overall", snapshot, partnerId: null }).hidden).toBe("Left out on purpose: 1 trade idea below your minimum chance.");
  });

  /** The search's own note that is almost always there (search.ts: K, D/ST and IDP left out by default). */
  const KDST = "Kickers and D/STs are left out; turn them on in Settings.";
  const stoppedEarly = { screened: 0, exact: 0, simScreen: 0, simFinal: 0 };

  it("says why there's nothing: the notes when the search stopped before screening (no team, season over, deadline passed)", () => {
    const noted = buildFinderView({
      result: searchResult([], { notes: ["Your league's trade deadline has passed."], counts: stoppedEarly, baseline: { pPlayoffs: null, pTitle: null, expWins: null } }),
      sort: "overall",
      snapshot,
      partnerId: null,
    });
    expect(noted.empty).toEqual({ title: "No trade ideas right now", text: ["Your league's trade deadline has passed."] });
    expect(noted.notes).toEqual([]); // said once, in the empty state
    expect(noted.baseline).toBeNull();
    expect(noted.baselineNote).toBeNull();
    expect(noted.statusText).toBe("No trade ideas right now.");
  });

  it("with the usual K/D/ST note and a search that ran: what was left out on purpose, else nothing found, the note staying in the notes", () => {
    const hidden = buildFinderView({ result: searchResult([], { notes: [KDST], hidden: { byBenefit: 4, byMarket: 0 } }), sort: "overall", snapshot, partnerId: null });
    expect(hidden.empty).toEqual({ title: "No trade ideas that help you", text: ["Left out on purpose: 4 trade ideas that wouldn't help you."] });
    expect(hidden.hidden).toBeNull();
    expect(hidden.notes).toEqual([KDST]);
    expect(hidden.statusText).toBe("No trade ideas that help you.");
    const none = buildFinderView({ result: searchResult([], { notes: [KDST] }), sort: "overall", snapshot, partnerId: "4" });
    expect(none.empty?.title).toBe("No trade ideas found");
    expect(none.empty?.text[0]).toMatch(/^No trade with Tundra Tortoises helps your team .* Allowing more players per side in Settings, or fewer untouchables, can turn up more\.$/);
    expect(none.notes).toEqual([KDST]);
    expect(none.countText).toBe("");
    // A search stopped before screening with nothing to say still says nothing was found.
    expect(buildFinderView({ result: searchResult([], { counts: stoppedEarly }), sort: "overall", snapshot, partnerId: null }).empty?.title).toBe("No trade ideas found");
  });

  it("lists each distinct note of the evaluations themselves once, after the search's (the week in progress, keeper costs)", () => {
    const UNDER_WAY = "Week 4 is under way: its games are projected as if none had started.";
    const KEEPER = "Keeper costs aren't modeled.";
    const trades = [
      evaluation({ key: "x", detail: { notes: [UNDER_WAY, KEEPER] } }),
      evaluation({ key: "y", give: ["105"], detail: { notes: [UNDER_WAY] } }),
      evaluation({ key: "z", give: ["104"], detail: { notes: [KDST] } }),
    ];
    const view = buildFinderView({ result: searchResult(trades, { notes: [KDST] }), sort: "overall", snapshot, partnerId: null });
    expect(view.notes).toEqual([KDST, UNDER_WAY, KEEPER]);
  });

  it("words the engine's week-in-progress note for the whole list, once (review of Phase 4: 'this trade' under a list of 18)", () => {
    // evaluate.ts's own words for one trade (the Analyzer keeps them under its single card).
    const one = (week: number) => `Week ${week} is under way: these odds play it with today's rosters, before and after the trade.`;
    const list = "Week 4 is under way: every idea's odds play it with today's rosters, before and after the trade.";
    expect(listNote(one(4))).toBe(list);
    expect(listNote(one(12))).toBe("Week 12 is under way: every idea's odds play it with today's rosters, before and after the trade.");
    expect(listNote("Keeper costs aren't modeled.")).toBe("Keeper costs aren't modeled.");
    const trades = [evaluation({ key: "x", detail: { notes: [one(4)] } }), evaluation({ key: "y", give: ["105"], detail: { notes: [one(4), "Keeper costs aren't modeled."] } })];
    const view = buildFinderView({ result: searchResult(trades, { notes: [KDST] }), sort: "overall", snapshot, partnerId: null });
    expect(view.notes).toEqual([KDST, list, "Keeper costs aren't modeled."]);
    expect(view.notes.join(" ")).not.toContain("this trade");
    // The Analyzer says it for its one trade, as the engine words it.
    expect(buildAnalysisView({ evaluation: evaluation({ detail: { notes: [one(4)] } }), illegal: null, notes: [one(4)] }, snapshot).notes).toEqual([one(4)]);
  });
});

describe("progressView (M14's progress bar)", () => {
  it("names each stage in plain words, without jargon", () => {
    expect(Object.values(STAGE_LABEL)).toEqual([
      "Getting your league ready",
      "Screening trade ideas",
      "Checking the best ideas closely",
      "Playing out your season with each idea",
      `Playing out the best ideas ${config.simulation.finalSims.toLocaleString("en-US")} times`,
      "Ranking the trade ideas",
    ]);
  });

  it("moves through the stages, says how far a stage is, and never reads 100% before it's done", () => {
    expect(progressView(null)).toEqual({ label: "Getting your league ready", detail: null, percent: 0, valueText: "Getting your league ready" });
    const screening = progressView({ stage: "screening", done: 120, total: 480 });
    expect(screening).toEqual({ label: "Screening trade ideas", detail: "120 of 480", percent: 16, valueText: "Screening trade ideas: 120 of 480" });
    // Checkpoint 7e: setup 7%, screening 36% (the ranking stage plays out the ideas shown on 20,000 seasons: 16%, 13% since
    // Checkpoint 7f, each run continuing its ranking run; the review's SHOWN-5). Phase 4c: setup 5%, screening 45%.
    expect(progressView({ stage: "exact", done: 0, total: 200 }).percent).toBe(43);
    const percents = (["setup", "screening", "exact", "simScreen", "simFinal", "rank"] as const).map((stage) => progressView({ stage, done: 0, total: 10 }).percent);
    expect(percents).toEqual([...percents].sort((x, y) => x - y));
    expect(progressView({ stage: "rank", done: 1, total: 1 }).percent).toBe(99);
    expect(progressView({ stage: "exact", done: 1300, total: 1200 }).detail).toBe("1,200 of 1,200");
  });

  it("Checkpoint 7e: the ranking stage while it plays out the ideas shown (part \"shown\") says so, and holds the bar's last 13% (16% at Checkpoint 7e; the review's SHOWN-5)", () => {
    expect(SHOWN_PASS_LABEL).toBe(`Playing out the ideas you'll see ${Math.max(config.simulation.finalSims, config.simulation.shownSims).toLocaleString("en-US")} times`);
    expect(SHOWN_PASS_LABEL).toBe("Playing out the ideas you'll see 20,000 times");
    expect(progressView({ stage: "rank", done: 3, total: 12, part: "shown" })).toEqual({ label: SHOWN_PASS_LABEL, detail: "3 of 12", percent: 90, valueText: `${SHOWN_PASS_LABEL}: 3 of 12` });
    expect(progressView({ stage: "rank", done: 0, total: 12, part: "shown" }).percent).toBe(87);
    expect(progressView({ stage: "rank", done: 6, total: 12, part: "shown" }, "refilter")).toMatchObject({ label: SHOWN_PASS_LABEL, percent: 50 });
    // Without the part, the stage's own words.
    expect(progressView({ stage: "rank", done: 3, total: 12 }).label).toBe("Ranking the trade ideas");
  });
});

describe("links between the pages (a team id and player ids only)", () => {
  it("links the Finder to one partner, and reads it back only for another team of this league", () => {
    expect(finderHref("2")).toBe("/trades?partner=2");
    expect(finderHref(null)).toBe("/trades");
    expect(readFinderPartner("?partner=2", snapshot, "1")).toBe("2");
    for (const bad of ["?partner=1", "?partner=99", "", "?team=2", undefined]) expect(readFinderPartner(bad, snapshot, "1")).toBeNull();
  });

  it("reads the Analyzer's trade from its address: my active and IR players to give, theirs to get, each once, at most a side's limit", () => {
    // 107 is on my IR (tradable since Phase 4b), 204 isn't mine, 999 is no one's; 105 twice counts once; 206 is on team 2's IR.
    const draft = readAnalyzerDraft("?partner=2&give=105&give=107&give=204&give=105&give=999&get=203&get=101&get=206", snapshot, "1");
    expect(draft).toEqual({ partnerId: "2", give: ["105", "107"], get: ["203", "206"] });
    // A taxi-squad player (team 3's 306) isn't tradable.
    expect(readAnalyzerDraft("?partner=3&get=306&get=301", snapshot, "1")).toEqual({ partnerId: "3", give: [], get: ["301"] });
    expect(readAnalyzerDraft("?partner=1&give=105&get=203", snapshot, "1")).toEqual({ partnerId: null, give: ["105"], get: [] });
    const many = readAnalyzerDraft(`?partner=2&${["101", "102", "103", "104", "105", "106"].map((id) => `give=${id}`).join("&")}`, snapshot, "1");
    expect(many.give).toHaveLength(ANALYZER_MAX_PER_SIDE);
    expect(ANALYZER_MAX_PER_SIDE).toBe(config.search.analyzerMaxPerSide);
  });

  it("marks a trade opened from 'If they won't move: try …' in the Analyzer's address, and reads the mark back (review of Phase 4b)", () => {
    const e = evaluation({ give: ["104", "105"], get: ["203"] });
    const href = analyzerHref(e.proposal, { from: "planB" });
    expect(href).toBe("/analyzer?partner=2&give=104&give=105&get=203&from=planB");
    const query = href.slice(href.indexOf("?"));
    expect(readAnalyzerFrom(query)).toBe("planB");
    // The trade reads the same with the mark.
    expect(readAnalyzerDraft(query, snapshot, "1")).toEqual({ partnerId: "2", give: ["104", "105"], get: ["203"] });
    for (const other of ["?partner=2&get=203", "?from=planb", "?from=other", "", undefined]) expect(readAnalyzerFrom(other)).toBeNull();
    expect(analyzerHref(e.proposal, { from: null })).toBe("/analyzer?partner=2&give=104&give=105&get=203");
  });

  it("reads a trade's key back into its players, the engine's form and the fixtures' (CardFeedback.versionWords)", () => {
    const player = (id: string) => ({ kind: "player" as const, id });
    expect(proposalFromKey("8|give:8146|get:13279,8167")).toEqual({ partnerId: "8", give: [player("8146")], get: [player("13279"), player("8167")] });
    expect(proposalFromKey("2|106,108|202")).toEqual({ partnerId: "2", give: [player("106"), player("108")], get: [player("202")] });
    expect(proposalFromKey("2|give:|get:202")).toEqual({ partnerId: "2", give: [], get: [player("202")] });
    expect(proposalFromKey("4|give:pick:2027:1:4|get:401")).toEqual({ partnerId: "4", give: [{ kind: "pick", season: 2027, round: 1, originalTeamId: "4" }], get: [player("401")] });
    for (const bad of ["", "2|give:106", "|give:106|get:202", "2|give:|get:", "2|give:106,,108|get:202", "a|b|c|d", null, undefined]) expect(proposalFromKey(bad)).toBeNull();
    expect(tradeWords(proposalFromKey("2|give:106|get:202,999") as NonNullable<ReturnType<typeof proposalFromKey>>, snapshot)).toBe("Wiggleton Spoons for Mortimer Gloop and A player who's no longer in this league's data");
  });

  it("round-trips a trade through the Analyzer's address", () => {
    const e = evaluation({ give: ["104", "105"], get: ["203"] });
    const href = analyzerHref(e.proposal);
    expect(href).toBe("/analyzer?partner=2&give=104&give=105&get=203");
    expect(readAnalyzerDraft(href.slice(href.indexOf("?")), snapshot, "1")).toEqual({ partnerId: "2", give: ["104", "105"], get: ["203"] });
    // Picks aren't in the address (M11: the Analyzer offers players only).
    expect(analyzerHref({ partnerId: "2", give: [{ kind: "pick", season: 2027, round: 1, originalTeamId: "1" }], get: [{ kind: "player", id: "203" }] })).toBe("/analyzer?partner=2&get=203");
  });
});

describe("the Analyzer's draft and choices", () => {
  it("makes a proposal only with a partner and at least one player, and knows a draft whatever its order", () => {
    expect(draftProposal({ partnerId: null, give: ["105"], get: [] })).toBeNull();
    expect(draftProposal({ partnerId: "2", give: [], get: [] })).toBeNull();
    expect(draftProposal({ partnerId: "2", give: ["105"], get: [] })).toEqual({ partnerId: "2", give: [{ kind: "player", id: "105" }], get: [] });
    expect(draftKey({ partnerId: "2", give: ["105", "104"], get: ["203"] })).toBe(draftKey({ partnerId: "2", give: ["104", "105"], get: ["203"] }));
    expect(draftSummary({ partnerId: "2", give: ["104", "105"], get: [] }, snapshot)).toBe("You give Noodle McSprocket and Glimmer Oddfellow; you get nothing.");
    expect(draftSummary({ partnerId: "2", give: [], get: [] }, snapshot)).toBeNull();
    expect(draftSummary({ partnerId: "1", give: [], get: ["102"] }, snapshot)).toBe("You give nothing; you get Dorian Quibble Jr.");
  });

  it("offers the other teams, my active and IR players and the partner's, by position, checked as drafted, the rest disabled once a side is full", () => {
    const choices = analyzerChoices(snapshot, "1", { partnerId: "2", give: ["101", "102", "104", "105"], get: ["203"] });
    expect(choices.partners.map((p) => p.name)).toEqual(["Gravel Gophers", "Quasar Quokkas", "Tundra Tortoises"]);
    expect(choices.mine.map((p) => p.id)).toEqual(["101", "103", "102", "105", "107", "104", "106", "108", "MIN"]);
    expect(choices.mine.filter((p) => p.checked).map((p) => p.id)).toEqual(["101", "102", "105", "104"]);
    expect(choices.mine.filter((p) => p.disabled).map((p) => p.id)).toEqual(["103", "107", "106", "108", "MIN"]);
    expect(choices.mine.find((p) => p.id === "103")).toMatchObject({ name: "Bartleby Crumpet", detail: "RB · NYJ", injury: { short: "Q", long: "Questionable", tone: "warn" } });
    // An IR player says he's in an IR slot (Phase 4b: IR players are tradable).
    expect(choices.mine.find((p) => p.id === "107")).toMatchObject({ name: "Humbert Fiddlesticks", detail: `WR · CHI · ${IR_SLOT_TEXT}` });
    expect(choices.theirs.map((p) => p.id)).toEqual(["201", "204", "203", "202", "206", "205", "DET"]);
    expect(choices.theirs.find((p) => p.id === "206")?.detail).toBe(`RB · PIT · ${IR_SLOT_TEXT}`);
    expect(choices.theirs.some((p) => p.disabled)).toBe(false);
    expect(analyzerChoices(snapshot, "1", { partnerId: null, give: [], get: [] }).theirs).toEqual([]);
    // Taxi-squad players aren't offered (team 3's 306).
    expect(analyzerChoices(snapshot, "1", { partnerId: "3", give: [], get: [] }).theirs.map((p) => p.id)).not.toContain("306");
    expect(choices.limitText).toBe(`Up to ${ANALYZER_MAX_PER_SIDE} players a side, from the active rosters and IR (players on a taxi squad can't be traded here yet).`);
  });

  it("leaves out of the Analyzer's notes what the card's reasons already say, and says each note once", () => {
    const LONG = "Long-term values didn't load, so later seasons aren't counted.";
    const view = buildAnalysisView({ evaluation: evaluation({ reasons: ["Your RB2 spot goes from 9.1 to 14.3 projected points per week.", LONG] }), illegal: null, notes: [LONG, "Keeper costs aren't modeled.", "Keeper costs aren't modeled."] }, snapshot);
    expect(view.card?.reasons).toContain(LONG);
    expect(view.notes).toEqual(["Keeper costs aren't modeled."]);
  });

  it("shows an illegal trade's reason instead of a card, with the notes", () => {
    const illegal: TradeAnalysis = { evaluation: null, illegal: "Gravel Gophers can have at most 4 RBs.", notes: ["Pick your team on the Import Report to see trade ideas."] };
    expect(buildAnalysisView(illegal, snapshot)).toEqual({ baseline: null, baselineNote: null, helpsInfo: null, helpsScale: null, reward: null, card: null, illegal: "Gravel Gophers can have at most 4 RBs.", notes: ["Pick your team on the Import Report to see trade ideas."] });
    // My odds before any trade say nothing without a card.
    expect(buildAnalysisView({ ...illegal, baseline: { pPlayoffs: 0.62, pTitle: 0.09 } }, snapshot).baseline).toBeNull();
    const legal = buildAnalysisView({ evaluation: evaluation(), illegal: null, notes: [] }, snapshot);
    expect(legal.card?.heading).toBe("Trade with Gravel Gophers");
  });

  it("reads a trade as the Trade Finder does: my odds before this trade above the card, and its odds with their end percents (review of Phase 4)", () => {
    const e = evaluation({ key: "w", dPO: 0.091, dCH: 0.039 });
    const analyzed = buildAnalysisView({ evaluation: e, illegal: null, notes: [], baseline: { pPlayoffs: 0.63, pTitle: 0.12 } }, snapshot);
    expect(analyzed.baseline).toBe("Your odds before this trade: 63% to make the playoffs, 12.0% to win the title.");
    expect(analyzed.baselineNote).toBe("As on the League page, they count the free-agent pickups that would help each team, and the trade's odds start from them.");
    expect(analyzed.helpsInfo).toBe("Helps you (0–100) sums up how much your title and playoff odds rise, minus a cost for giving away trade value or plus a credit for gaining it. 63 ≈ as good as adding 3 points a week to your lineup for the rest of the season.");
    const odds = (c: NonNullable<typeof analyzed.card>) => c.odds.map((o) => o.value);
    expect(odds(analyzed.card as NonNullable<typeof analyzed.card>)).toEqual(["12.0% → 15.9%", "63% → 72%"]);
    // The same trade on the Trade Finder, with the same odds before any trade: the same words.
    const found = buildFinderView({ result: searchResult([e], { baseline: { pPlayoffs: 0.63, pTitle: 0.12, expWins: 8 } }), sort: "overall", snapshot, partnerId: null }).cards[0];
    expect(found?.facts).toEqual(analyzed.card?.facts);
    expect(found?.odds).toEqual(analyzed.card?.odds);
    // An evaluation sent without them (an older worker): the changes alone, no line.
    const plain = buildAnalysisView({ evaluation: e, illegal: null, notes: [] }, snapshot);
    expect(plain.baseline).toBeNull();
    expect(odds(plain.card as NonNullable<typeof plain.card>)).toEqual(["+3.9 percentage points", "+9.1 percentage points"]);
    // Checkpoint 7e (item 2.1): a trade with either-way moves starts from its own "before", the line too, saying so.
    const own = buildAnalysisView({ evaluation: { ...e, before: { pPlayoffs: 0.65, pTitle: 0.13, prizes: { first: 0.13, second: null, third: null, weeklyHigh: 0, pointsLeader: 0 } } }, illegal: null, notes: [], baseline: { pPlayoffs: 0.63, pTitle: 0.12 } }, snapshot);
    expect(own.baseline).toBe("Your odds before this trade: 65% to make the playoffs, 13.0% to win the title.");
    expect(own.baselineNote).toBe("They count the free-agent pickups that would help each team, as on the League page, and the moves the card assumes with or without this trade; the trade's odds start from them.");
    expect(odds(own.card as NonNullable<typeof own.card>)).toEqual(["13.0% → 16.9%", "65% → 74%"]);
  });
});

describe("settingsSummary and feedback state", () => {
  it("adds 'Protect my trade value' when it isn't the default, in redraft leagues only (planner addendum to Checkpoint 3, §3)", () => {
    const high = { ...defaultTradeSettings(), protectValue: "high" as const };
    expect(settingsSummary(high, "espn", "redraft")).toBe("Up to 2 players a side. Protect my trade value: High.");
    expect(settingsSummary({ ...high, protectValue: "low" }, "espn")).toBe("Up to 2 players a side. Protect my trade value: Low.");
    expect(settingsSummary({ ...high, protectValue: config.benefit.protectValueDefault }, "espn", "redraft")).toBe("Up to 2 players a side.");
    // Dynasty and keeper leagues don't use it.
    expect(settingsSummary(high, "espn", "dynasty")).toBe("Up to 2 players a side.");
    expect(settingsSummary(high, "sleeper", "keeper")).toBe("Up to 2 players a side.");
  });

  it("says what the settings let a trade idea be, in one line", () => {
    expect(settingsSummary(defaultTradeSettings(), "espn")).toBe("Up to 2 players a side.");
    expect(settingsSummary({ ...defaultTradeSettings(), maxPerSide: 1, untouchables: ["101"], mustInclude: ["202", "203"], targetPositions: ["RB"], avoidPositions: ["TE", "DEF"], includeKDefIdp: true }, "espn")).toBe(
      "Up to 1 player a side, 1 untouchable, 2 must-include players, only getting RB, never getting TE and D/ST and kickers, D/STs and IDP players included.",
    );
  });

  it("reads what this browser saved for a card", () => {
    const e = evaluation();
    let records = applyFeedback([], { leagueKey: "espn:0000abcd", evaluation: e, change: { outcome: "sent" }, at: "2026-10-01T12:00:00.000Z" });
    const none = { versionKey: null, versionWords: null };
    expect(cardFeedback(records, "espn:0000abcd", e.key)).toEqual({ outcome: "sent", report: null, version: null, ...none });
    records = applyFeedback(records, { leagueKey: "espn:0000abcd", evaluation: e, change: { report: { reason: "never-accept", note: " too lopsided " } }, at: "2026-10-01T12:01:00.000Z" });
    expect(cardFeedback(records, "espn:0000abcd", e.key)).toEqual({ outcome: "sent", report: { reason: "never-accept", note: "too lopsided" }, version: null, ...none });
    expect(cardFeedback(records, "espn:ffff0000", e.key)).toEqual({ outcome: null, report: null, version: null, ...none });
    expect(cardFeedback(undefined, "espn:0000abcd", e.key)).toEqual({ outcome: null, report: null, version: null, ...none });
    // The version sent (planner reply to Checkpoint 4, change 6).
    const sent = applyFeedback([], { leagueKey: "espn:0000abcd", evaluation: e, change: { outcome: "sent", sent: { version: "planB", key: "2|give:106|get:202", pAccept: 0.3, pComplete: 0.3 } }, at: "2026-10-01T12:00:00.000Z" });
    expect(cardFeedback(sent, "espn:0000abcd", e.key)).toEqual({ outcome: "sent", report: null, version: "planB", versionKey: "2|give:106|get:202", versionWords: null });
    // With the league, that version's trade in words (review of Phase 4b: the "Version:" line names it when the card doesn't show it).
    expect(cardFeedback(sent, "espn:0000abcd", e.key, snapshot)).toEqual({ outcome: "sent", report: null, version: "planB", versionKey: "2|give:106|get:202", versionWords: "Wiggleton Spoons for Mortimer Gloop" });
  });
});

describe("injury tags on the card (planner reply to Checkpoint 4, change 6)", () => {
  /** The fictional league with return weeks set (the fixture's players carry none). */
  const withReturns = (weeks: Record<string, number>) => {
    const snap = tradeSnapshot();
    const players = { ...snap.players };
    for (const [id, week] of Object.entries(weeks)) {
      const p = players[id];
      if (p) players[id] = { ...p, injuryReturnWeek: week };
    }
    return { ...snap, players };
  };

  it("words each status, the return week the tag carries, and 'for the season' after its end", () => {
    const text = (status: InjuryTag["status"], returnWeek?: number, end?: number, source?: string) => injuryTagText({ status, ...(returnWeek !== undefined ? { returnWeek } : {}) }, end, source);
    expect(["PROBABLE", "QUESTIONABLE", "DOUBTFUL", "OUT", "IR", "PUP", "SUSPENDED", "NA"].map((s) => text(s as InjuryTag["status"]))).toEqual([
      "Probable",
      "Questionable",
      "Doubtful",
      "Out",
      "On IR",
      "On the PUP list",
      "Suspended",
      "Not an active NFL player",
    ]);
    expect(text("OUT", 8, 18)).toBe("Out — expected back week 8");
    expect(text("IR", 8, 18)).toBe("On IR — expected back week 8");
    expect(text("PUP", 9, 18)).toBe("On the PUP list — expected back week 9");
    expect(text("SUSPENDED", 7, 18)).toBe("Suspended — back week 7");
    // ESPN's out-for-season marker (the NFL's last week + 1), and any week after the season's end.
    expect(text("IR", 19, 18)).toBe("Out for the season");
    expect(text("OUT", 19, 18)).toBe("Out for the season");
    expect(text("SUSPENDED", 19, 18)).toBe("Suspended for the season");
    // A Questionable, Doubtful or Probable tag carries a week only when his projection follows the platform's far date
    // (explain.injuryTags; review of track F: Josh Jacobs read just "Questionable"): said as the platform's.
    expect(text("QUESTIONABLE", 8, 18, "ESPN")).toBe("Questionable — ESPN expects him back week 8");
    expect(text("DOUBTFUL", 19, 18, "ESPN")).toBe("Doubtful — ESPN expects him out for the season");
    expect(text("PROBABLE", 9, 18)).toBe("Probable — expected back week 9");
    expect(text("NA", 9, 18)).toBe("Not an active NFL player");
    // Without a season end, the week is said.
    expect(text("IR", 19)).toBe("On IR — expected back week 19");
  });

  it("says the user's own week as his, whatever the status (Checkpoint 7e, item 3.5; review of wave C, RC-ENG-1)", () => {
    const mine = (status: InjuryTag["status"], returnWeek: number) => injuryTagText({ status, returnWeek, returnSource: "user" }, 18, "ESPN");
    expect(mine("IR", 9)).toBe("On IR — expected back week 9 (your week)");
    expect(mine("QUESTIONABLE", 7)).toBe("Questionable — expected back week 7 (your week)");
    expect(mine("OUT", 8)).toBe("Out — expected back week 8 (your week)");
    expect(mine("SUSPENDED", 10)).toBe("Suspended — back week 10 (your week)");
    expect(mine("IR", 19)).toBe("Out for the season (your week)");
    expect(mine("SUSPENDED", 30)).toBe("Suspended for the season (your week)");
    expect(mine("DOUBTFUL", 19)).toBe("Doubtful — out for the season (your week)");
    expect(mine("NA", 9)).toBe("Not an active NFL player");
  });

  it("ends the season at the NFL's last week when known, else the league's last week", () => {
    expect(seasonEndOf(snapshot.settings, 18)).toBe(18);
    expect(seasonEndOf(snapshot.settings)).toBe(17); // the fixture's playoffs end in week 17
    expect(seasonEndOf({ regularSeasonWeeks: [], playoffWeeks: [] })).toBeUndefined();
  });

  it("tags every injured player on either side, in words with a tone, from the evaluation's tags or else the snapshot", () => {
    // Mine: the Questionable RB (103); theirs: the Doubtful RB in team 2's IR slot (206), back in week 16.
    const snap = withReturns({ "206": 16 });
    const card = buildTradeCard(evaluation({ give: ["103", "106"], get: ["206", "204"] }), { snapshot: snap, lastNflWeek: 18 });
    expect(card.give.map((a) => a.status)).toEqual([{ text: "Questionable", tone: "warn" }, null]);
    expect(card.get.map((a) => a.status)).toEqual([{ text: "Doubtful", tone: "warn" }, null]);
    // The evaluation's own tags (the search's) win: here an IR tag with a return week.
    const tagged = evaluation({ give: ["106"], get: ["204"], flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: [], tagged: [{ playerId: "204", side: "get", status: "IR", returnWeek: 19 }] } });
    expect(buildTradeCard(tagged, { snapshot, lastNflWeek: 18 }).get[0]?.status).toEqual({ text: "Out for the season", tone: "danger" });
    // The IR WR (107) with a return week before the season's end.
    const ir = buildTradeCard(evaluation({ give: ["106"], get: ["107"] }), { snapshot: withReturns({ "107": 15 }), lastNflWeek: 18 });
    expect(ir.get[0]?.status).toEqual({ text: "On IR — expected back week 15", tone: "danger" });
    // A date this week or earlier (the fixture is in week 12) is stale: never "expected back week 11" (review of track F).
    expect(buildTradeCard(evaluation({ give: ["106"], get: ["107"] }), { snapshot: withReturns({ "107": 11 }), lastNflWeek: 18 }).get[0]?.status?.text).toBe("On IR");
    expect(buildTradeCard(evaluation({ give: ["106"], get: ["107"] }), { snapshot: withReturns({ "107": 12 }), lastNflWeek: 18 }).get[0]?.status?.text).toBe("On IR");
    // From the snapshot alone (an evaluation without tags, a core) a Doubtful player's far date isn't said: whether his
    // projection follows it is the League model's word, which the evaluations' own tags carry (the search's and the Analyzer's).
    expect(buildTradeCard(evaluation({ give: ["106"], get: ["206"] }), { snapshot: withReturns({ "206": 16 }), lastNflWeek: 18 }).get[0]?.status?.text).toBe("Doubtful");
    // The search's tag for him, when his projection follows the date: the platform's date (an ESPN league here).
    const followed = evaluation({ give: ["106"], get: ["206"], flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: [], tagged: [{ playerId: "206", side: "get", status: "DOUBTFUL", returnWeek: 16 }] } });
    expect(buildTradeCard(followed, { snapshot: withReturns({ "206": 16 }), lastNflWeek: 18 }).get[0]?.status).toEqual({ text: "Doubtful — ESPN expects him back week 16", tone: "warn" });
  });

  it("says once why a hurt player I'd get still has his numbers: his projection assumes a full return, blended with the market", () => {
    const one = buildTradeCard(evaluation({ give: ["106"], get: ["107"] }), { snapshot });
    expect(one.injuryNote).toBe("Humbert Fiddlesticks: his projection assumes he returns at full strength, blended with the trade market.");
    const two = buildTradeCard(evaluation({ give: ["106"], get: ["107", "206"] }), { snapshot });
    expect(two.injuryNote).toBe("Humbert Fiddlesticks and Rupert Wimbleton: their projections assume they return at full strength, blended with the trade market.");
    // Not for a player of mine, nor for a player who isn't an active NFL player (NA) or is suspended, nor a healthy card.
    expect(buildTradeCard(evaluation({ give: ["103"], get: ["204"] }), { snapshot }).injuryNote).toBeNull();
    expect(incomingInjuryNote([{ playerId: "903", side: "get", status: "NA" }, { playerId: "204", side: "get", status: "SUSPENDED" }], snapshot)).toBeNull();
    expect(card().injuryNote).toBeNull();
    // A player the injured flag names: the flag says it (review of Phase 4b), the note only the others.
    const flagged = buildTradeCard(evaluation({ give: ["106"], get: ["107", "206"], flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: ["107"] } }), { snapshot });
    expect(flagged.injuryNote).toBe("Rupert Wimbleton: his projection assumes he returns at full strength, blended with the trade market.");
    expect(buildTradeCard(evaluation({ give: ["106"], get: ["107"], flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: ["107"] } }), { snapshot }).injuryNote).toBeNull();
  });

  it("never says a hurt player's projection is blended with the trade market while the blend is off (review of track UIC, finding 3)", () => {
    const injured = { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: ["107"] };
    const off = buildTradeCard(evaluation({ give: ["106"], get: ["107", "206"], flags: injured }), { snapshot, blendOn: false });
    expect(off.flags[0]?.text).toBe("Depends on an injured player: Humbert Fiddlesticks (injured reserve). His projection assumes he returns at full strength.");
    expect(off.injuryNote).toBe("Rupert Wimbleton: his projection assumes he returns at full strength.");
    expect(incomingInjuryNote([{ playerId: "107", side: "get", status: "IR" }, { playerId: "206", side: "get", status: "DOUBTFUL" }], snapshot, [], false)).toBe(
      "Humbert Fiddlesticks and Rupert Wimbleton: their projections assume they return at full strength.",
    );
    // The Finder's and the Analyzer's cards get the page's word.
    const finder = buildFinderView({ result: searchResult([evaluation({ give: ["106"], get: ["206"] })]), sort: "overall", snapshot, partnerId: null, blendOn: false });
    expect(finder.cards[0]?.injuryNote).toBe("Rupert Wimbleton: his projection assumes he returns at full strength.");
    const analyzer = buildAnalysisView({ evaluation: evaluation({ give: ["106"], get: ["206"] }), illegal: null, notes: [] }, snapshot, undefined, { blendOn: false });
    expect(analyzer.card?.injuryNote).toBe("Rupert Wimbleton: his projection assumes he returns at full strength.");
    // On, or not said (the default): as before.
    expect(buildTradeCard(evaluation({ give: ["106"], get: ["206"] }), { snapshot, blendOn: true }).injuryNote).toBe("Rupert Wimbleton: his projection assumes he returns at full strength, blended with the trade market.");
  });

  it("reads whether the market blend is on as the engine does: this season's FantasyCalc list in the league's format (blend.ts blendValues)", () => {
    expect(marketBlendOn(MARKET, "redraft")).toBe(true);
    // FantasyCalc's curve fallback, and no FantasyCalc at all: off.
    expect(marketBlendOn({ ...MARKET, fallback: { kind: "curve", listDate: "2026-09-01T00:00:00.000Z" } }, "redraft")).toBe(false);
    expect(marketBlendOn(null, "redraft")).toBe(false);
    // A saved list standing in still blends.
    expect(marketBlendOn({ ...MARKET, fallback: { kind: "saved", listDate: "2026-09-27T15:00:00.000Z" } }, "redraft")).toBe(true);
    // Dynasty: the format's own redraft list (seasonValues); without it, off. Keeper: the redraft list, or the league's
    // own list when the server served the redraft list in its place (a format that isn't dynasty).
    const dynasty = { ...MARKET, format: { ...MARKET.format, isDynasty: true } };
    expect(marketBlendOn(dynasty, "dynasty")).toBe(false);
    expect(marketBlendOn({ ...dynasty, seasonValues: MARKET.values }, "dynasty")).toBe(true);
    expect(marketBlendOn(dynasty, "keeper")).toBe(false);
    expect(marketBlendOn({ ...dynasty, redraftValues: MARKET.values }, "keeper")).toBe(true);
    expect(marketBlendOn(MARKET, "keeper")).toBe(true);
  });

  it("gives the pages' How to read the league's facts (valueFactsOf): FantasyCalc's values, long-term values and the blend", () => {
    expect(valueFactsOf(MARKET, "redraft")).toEqual({ valuesOn: true, longTermOn: true, blendOn: true });
    expect(valueFactsOf({ ...MARKET, fallback: { kind: "curve", listDate: "2026-09-01T00:00:00.000Z" } }, "redraft")).toEqual({ valuesOn: false, longTermOn: true, blendOn: false });
    expect(valueFactsOf(null, "redraft")).toEqual({ valuesOn: false, longTermOn: true, blendOn: false });
    // Long-term values: a dynasty format's list (benefit.futureValuesLoaded); a keeper league served the redraft list in
    // place of its failed dynasty list has none, and neither does the curve fallback.
    const dynasty = { ...MARKET, format: { ...MARKET.format, isDynasty: true }, seasonValues: MARKET.values };
    expect(valueFactsOf(dynasty, "dynasty")).toEqual({ valuesOn: true, longTermOn: true, blendOn: true });
    expect(valueFactsOf(MARKET, "keeper").longTermOn).toBe(false);
    expect(valueFactsOf({ ...dynasty, fallback: { kind: "curve", listDate: "2026-09-01T00:00:00.000Z" } }, "dynasty")).toEqual({ valuesOn: false, longTermOn: false, blendOn: false });
    expect(valueFactsOf(null, "keeper").longTermOn).toBe(false);
  });
});

describe("Plan B on the card: \"If they won't move: try …\" (planner reply to Checkpoint 4, change 6; its heading since Checkpoint 7e)", () => {
  const planB = { proposal: { partnerId: "2", give: [{ kind: "player" as const, id: "106" }, { kind: "player" as const, id: "108" }], get: [{ kind: "player" as const, id: "202" }] }, key: "2|give:106,108|get:202", b: 3.5, tradeScore: 44, pAccept: 0.42, pComplete: 0.42, acceptLabel: "Decent", overall: 22, kind: "otherTarget" as const };

  it("words the other trade, its kind, its three numbers as the card prints its own, and links it to the Analyzer", () => {
    const view = planBView(planB, snapshot);
    expect(view).toEqual({
      heading: PLAN_B_HEADING,
      kindText: "A different set of their players",
      give: "Wiggleton Spoons and Tobias Thimble",
      get: "Mortimer Gloop",
      numbers: "Helps you 44 · Chance they accept 40% (Est. · Decent) · Overall 22",
      numberParts: [{ text: "Helps you 44" }, { text: "Chance they accept 40%", label: "(Est. · Decent)" }, { text: "Overall 22" }],
      acceptNote: null,
      // A Plan B made without odds (none before Phase 4c's polish) prints none.
      odds: [],
      weekly: null,
      // No odds of its own "before" (Checkpoint 7e: PlanB.before), nor roster moves without its evaluation's (PlanB.myMoves).
      oddsNote: null,
      moves: [],
      also: null,
      pitch: "Thanks for considering it! Would you trade Mortimer Gloop for Wiggleton Spoons and Tobias Thimble instead? Let me know what you think!",
      // Marked as a Plan B: the Analyzer shows it as one offer, without "How to offer it" (review of Phase 4b).
      analyzerHref: "/analyzer?partner=2&give=106&give=108&get=202&from=planB",
      key: planB.key,
      text: "Wiggleton Spoons and Tobias Thimble for Mortimer Gloop · Helps you 44 · Chance they accept 40% (Est. · Decent) · Overall 22",
    });
    // The planner's words (planner reply to Checkpoint 7d, item 4.1: "Plan B stays below the list: “If they won't move: try …”").
    expect(PLAN_B_HEADING).toBe("If they won't move: try …");
    expect(planBView({ ...planB, kind: "samePlayers" }, snapshot)?.kindText).toBe("The same players of theirs, a different package");
    // Review of track F: "Different players of theirs" read wrong for a Plan B that keeps one of the card's players.
    expect(planBView(planB, snapshot)?.kindText).not.toContain("Different players");
    // A version the veto rule cuts says the chance it goes through, like the card's own note.
    expect(planBView({ ...planB, pComplete: 0.21 }, tradeSnapshot({ tradeReview: "league_vote" }))?.acceptNote).toBe("Counting a league veto vote, about 20% it goes through.");
    // Below the display's floor: "under 5%" (review of Phase 4b).
    expect(planBView({ ...planB, pAccept: 0.06, pComplete: 0.03 }, tradeSnapshot({ tradeReview: "league_vote" }))?.acceptNote).toBe("Counting a league veto vote, under 5% it goes through.");
    expect(planBView(undefined, snapshot)).toBeNull();
  });

  it("Phase 4c (planner reply to Checkpoint 4b, change 9): prints its own odds as the card prints its own, from the card's before: title and playoff odds, then the weekly line", () => {
    const baseline = { pPlayoffs: 0.65, pTitle: 0.121 };
    const withOdds = { ...planB, dPO: 0.04, dCH: 0.013, winChance: [{ week: 9, before: 0.68, after: 0.64 }, { week: 10, before: 0.5, after: 0.51 }, { week: 13, before: 0.42, after: 0.55 }] };
    const view = planBView(withOdds, snapshot, { baseline });
    // The planner's own example lines, by the card's own functions (oddsViews, weeklyLine).
    expect(view?.odds.map((o) => `${o.label} ${o.value}`)).toEqual(["Title odds 12.1% → 13.4%", "Playoff odds 65% → 69%"]);
    expect(view?.odds).toEqual(oddsViews(withOdds, baseline));
    expect(view?.weekly).toEqual(weeklyLine(withOdds.winChance));
    expect(view?.weekly?.text).toBe("Win chance by week: Week 9: 68% → 64% · Week 13: 42% → 55%");
    expect(view?.text).toBe(
      "Wiggleton Spoons and Tobias Thimble for Mortimer Gloop · Helps you 44 · Chance they accept 40% (Est. · Decent) · Overall 22 · Title odds 12.1% → 13.4% · Playoff odds 65% → 69% · Win chance by week: Week 9: 68% → 64% · Week 13: 42% → 55%",
    );
    // Without the card's before, the changes in percentage points, as the card's; title odds unknown say so.
    expect(planBView(withOdds, snapshot)?.odds.map((o) => o.value)).toEqual(["+1.3 percentage points", "+4 percentage points"]);
    expect(planBView({ ...withOdds, dCH: null }, snapshot, { baseline })?.odds.map((o) => o.value)).toEqual(["unknown", "65% → 69%"]);
    // A points-only league's empty list, or no week moving enough: no weekly line.
    expect(planBView({ ...withOdds, winChance: [] }, snapshot, { baseline })?.weekly).toBeNull();
    expect(planBView({ ...withOdds, winChance: [{ week: 9, before: 0.68, after: 0.67 }] }, snapshot, { baseline })?.weekly).toBeNull();
    // On the card, from the card's own before (the search's baseline): the same lines as the box alone.
    const c = buildTradeCard(evaluation({ planB: withOdds }), { snapshot, baseline });
    expect(c.planB?.odds).toEqual(view?.odds);
    expect(c.planB?.weekly).toEqual(view?.weekly);
  });

  it("has its own message to send them: a follow-up naming the trade from their side, never what I gain (review of Phase 4b)", () => {
    expect(planBPitch({ give: [{ kind: "player", id: "106" }], get: [{ kind: "player", id: "202" }, { kind: "player", id: "204" }] }, snapshot)).toBe(
      "Thanks for considering it! Would you trade Mortimer Gloop and Cornelius Snoot for Wiggleton Spoons instead? Let me know what you think!",
    );
    expect(planBPitch({ give: [], get: [{ kind: "player", id: "202" }] }, snapshot)).toBe("Thanks for considering it! Would you send me Mortimer Gloop instead? Let me know what you think!");
    expect(planBPitch({ give: [{ kind: "player", id: "106" }], get: [] }, snapshot)).toBe("Thanks for considering it! Would you take Wiggleton Spoons instead, with nothing needed back? Let me know what you think!");
    // No team name, no jargon, nothing about what I gain.
    const text = planBView(planB, snapshot)?.pitch ?? "";
    for (const word of ["Gravel Gophers", "Helps you", "ROS", "NaN", "undefined"]) expect(text).not.toContain(word);
  });

  it("is on the card when the evaluation has one, and not otherwise", () => {
    expect(buildTradeCard(evaluation({ planB }), { snapshot }).planB?.key).toBe(planB.key);
    expect(card().planB).toBeNull();
  });

  it("tags its injured players after their names: the card's own tag for a player it shares with the card, else the snapshot's (review of track F)", () => {
    // My IR WR (107, back in week 15) and team 2's Doubtful RB (206, ESPN's week 16, which his projection follows: the
    // search's tag on the card says so).
    const snap = { ...snapshot, players: { ...snapshot.players, "107": { ...(snapshot.players["107"] as PlayerInfo), injuryReturnWeek: 15 }, "206": { ...(snapshot.players["206"] as PlayerInfo), injuryReturnWeek: 16 } } };
    const shared = { ...planB, proposal: { partnerId: "2", give: [{ kind: "player" as const, id: "107" }], get: [{ kind: "player" as const, id: "206" }] }, key: "2|give:107|get:206" };
    const e = evaluation({ give: ["106"], get: ["206"], planB: shared, flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: [], tagged: [{ playerId: "206", side: "get", status: "DOUBTFUL", returnWeek: 16 }] } });
    const box = buildTradeCard(e, { snapshot: snap, lastNflWeek: 18 }).planB;
    expect(box?.give).toBe("Humbert Fiddlesticks (On IR — expected back week 15)");
    expect(box?.get).toBe("Rupert Wimbleton (Doubtful — ESPN expects him back week 16)");
    expect(box?.text).toBe("Humbert Fiddlesticks (On IR — expected back week 15) for Rupert Wimbleton (Doubtful — ESPN expects him back week 16) · Helps you 44 · Chance they accept 40% (Est. · Decent) · Overall 22");
    // Without the card's tag, the snapshot's: no far date for the Doubtful player (whether it's followed isn't known).
    expect(planBView(shared, snap, { seasonEnd: 18 })?.get).toBe("Rupert Wimbleton (Doubtful)");
    // …unless the search tagged him on another idea (review of Phase 4b): that tag knows his far date, whichever side.
    const known = knownTagsOf([evaluation({ flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: [], tagged: [{ playerId: "206", side: "give", status: "DOUBTFUL", returnWeek: 16 }] } })]);
    expect(planBView(shared, snap, { seasonEnd: 18, knownTags: known })?.get).toBe("Rupert Wimbleton (Doubtful — ESPN expects him back week 16)");
    const list = buildFinderView({
      result: searchResult([
        evaluation({ key: "a", give: ["106"], get: ["204"], planB: shared }),
        evaluation({ key: "b", give: ["105"], get: ["206"], flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: [], tagged: [{ playerId: "206", side: "get", status: "DOUBTFUL", returnWeek: 16 }] } }),
      ]),
      sort: "overall",
      snapshot: snap,
      partnerId: null,
      lastNflWeek: 18,
    });
    expect(list.cards.find((x) => x.key === "a")?.planB?.get).toBe("Rupert Wimbleton (Doubtful — ESPN expects him back week 16)");
    expect(knownTagsOf([evaluation()]).size).toBe(0);
    // A healthy player has no tag.
    expect(planBView(planB, snap)?.get).toBe("Mortimer Gloop");
  });
});

describe("buildFinderView: a Plan B that is a card of its own says so (review of track F)", () => {
  // Card x's Plan B is card y, at whatever place y has in the sort shown.
  const y = evaluation({ key: "2|105|204", give: ["105"], get: ["204"], b: 2, pComplete: 0.6 }); // EG 1.2, Helps you 28
  const x = evaluation({ key: "2|106|204", give: ["106"], get: ["204"], b: 6, pComplete: 0.3, planB: { proposal: y.proposal, key: y.key, b: 2, tradeScore: 28, pAccept: 0.6, pComplete: 0.6, acceptLabel: "Likely", overall: 18, kind: "samePlayers" } }); // EG 1.8
  const z = evaluation({ key: "3|105|303", partnerId: "3", give: ["105"], get: ["303"], b: 1, pComplete: 0.9 }); // EG 0.9
  const view = (sort: "overall" | "helps" | "accept") => buildFinderView({ result: searchResult([x, y, z]), sort, snapshot, partnerId: null });

  it("names that card's place in the sort shown", () => {
    expect(view("overall").cards.map((c) => c.key)).toEqual([x.key, y.key, z.key]);
    expect(view("overall").cards[0]?.planB?.also).toBe("Also shown as trade idea 2.");
    // Sorted by the chance they accept, y is first and x second.
    expect(view("accept").cards.map((c) => c.key)).toEqual([z.key, y.key, x.key]);
    expect(view("accept").cards[2]?.planB?.also).toBe("Also shown as trade idea 2.");
    expect(view("helps").cards.find((c) => c.key === x.key)?.planB?.also).toBe(`Also shown as trade idea ${view("helps").cards.findIndex((c) => c.key === y.key) + 1}.`);
  });

  it("says nothing when the Plan B isn't in the list", () => {
    expect(buildFinderView({ result: searchResult([x, z]), sort: "overall", snapshot, partnerId: null }).cards[0]?.planB?.also).toBeNull();
  });
});

describe("feedback versions (which version was sent; planner reply to Checkpoint 4, change 6)", () => {
  /**
   * A version's model inputs as the card makes them (Phase 4c, planner reply to Checkpoint 4b, change 7), with the card's
   * B₃ (the fixtures' FIXTURE_B3) and its scale's reason (none: the fixtures' notes are empty) since Phase 7a.
   */
  const SCALE = { b3: FIXTURE_B3, helpsReason: null };
  const inputsOf = (x: { features?: TradeEvaluation["features"] | undefined; gPartner?: number | undefined; b: number | null }, goal: "title" | "prizes" | "playoffs" | null = null) => ({
    features: x.features ? { ...x.features } : null,
    gPartner: x.gPartner ?? null,
    b: x.b,
    goal,
    ...SCALE,
  });

  it("a plain card: its own trade alone, as the suggested trade (Checkpoint 7e; “full” before), with its model inputs", () => {
    const e = evaluation();
    expect(versionChoices(e, snapshot)).toEqual([{ version: "suggested", key: e.key, pAccept: 0.4, pComplete: 0.4, inputs: inputsOf(e), label: "The suggested trade" }]);
    // With the goal the numbers were weighted by; in the Analyzer, named as the trade built.
    expect(versionChoices(e, snapshot, "title")[0]?.inputs).toEqual(inputsOf(e, "title"));
    expect(buildTradeCard(e, { snapshot, offers: "analyzer" }).versions[0]?.label).toBe("The trade you built");
    expect(buildAnalysisView({ evaluation: e, illegal: null, notes: [] }, snapshot).card?.versions[0]?.label).toBe("The trade you built");
  });

  it("an older evaluation's steps (which the search no longer makes) aren't versions: the card's own trade is", () => {
    const e = steppedFull();
    expect(versionChoices(e, snapshot, "prizes")).toEqual([{ version: "suggested", key: e.key, pAccept: 0.55, pComplete: 0.55, inputs: inputsOf(e, "prizes"), label: "The suggested trade" }]);
  });

  it("with a Plan B: this trade, then “If they won't move” named by its players, each with its inputs", () => {
    const planB = { proposal: { partnerId: "2", give: [{ kind: "player" as const, id: "106" }], get: [{ kind: "player" as const, id: "203" }] }, key: "2|give:106|get:203", b: 2, tradeScore: 28, pAccept: 0.5, pComplete: 0.45, acceptLabel: "Decent", overall: 14, kind: "otherTarget" as const };
    const e = evaluation({ planB: { ...planB, features: { g: 0.1, n: 0.2, h: 0, c: 0, a: 1, hist: null, ctx: 0, hot: 0, urg: 0, z: 0.1 }, gPartner: 0.08 } });
    expect(versionChoices(e, snapshot, "title")).toEqual([
      { version: "suggested", key: e.key, pAccept: 0.4, pComplete: 0.4, inputs: inputsOf(e, "title"), label: "The suggested trade" },
      { version: "planB", key: "2|give:106|get:203", pAccept: 0.5, pComplete: 0.45, inputs: { features: { g: 0.1, n: 0.2, h: 0, c: 0, a: 1, hist: null, ctx: 0, hot: 0, urg: 0, z: 0.1 }, gPartner: 0.08, b: 2, goal: "title", ...SCALE }, label: "If they won't move: Wiggleton Spoons for Ignatius Fumblewick" },
    ]);
    expect(buildTradeCard(e, { snapshot }).versions).toHaveLength(2);
    // A Plan B without its features (an older engine): none.
    expect(versionChoices(evaluation({ planB }), snapshot)[1]?.inputs).toEqual({ features: null, gPartner: null, b: 2, goal: null, ...SCALE });
  });

  it("names the recorded version by its key: the card's label when it shows that version, else 'an earlier one' with its players (review of Phase 4b); an older card's kinds still read", () => {
    const planB = { proposal: { partnerId: "2", give: [{ kind: "player" as const, id: "106" }], get: [{ kind: "player" as const, id: "203" }] }, key: "2|give:106|get:203", b: 2, tradeScore: 28, pAccept: 0.5, pComplete: 0.45, acceptLabel: "Decent", overall: 14, kind: "otherTarget" as const };
    const versions = buildTradeCard(evaluation({ planB }), { snapshot }).versions;
    const fb = (version: "planB" | "suggested" | "full" | "offerFirst" | null, versionKey: string | null, versionWords: string | null = null, outcome: "sent" | null = "sent") => ({ outcome, version, versionKey, versionWords });
    expect(versionLine(fb("planB", planB.key), versions)).toBe("If they won't move: Wiggleton Spoons for Ignatius Fumblewick");
    // A refresh changed the Plan B since: the one sent is named, never the box shown now.
    expect(versionLine(fb("planB", "2|give:106|get:204", "Wiggleton Spoons for Cornelius Snoot"), versions)).toBe("an earlier one (Wiggleton Spoons for Cornelius Snoot)");
    expect(versionLine(fb("planB", "2|give:106|get:204"), versions)).toBe("an earlier one");
    // A record made before keys were saved: by its kind, on a card with two.
    expect(versionLine(fb("planB", null), versions)).toBe("If they won't move: Wiggleton Spoons for Ignatius Fumblewick");
    // An older card's "full" for the card's own trade: found by its key.
    expect(versionLine(fb("full", evaluation().key), versions)).toBe("The suggested trade");
    expect(versionLine(fb("offerFirst", "2|give:106|get:205", "Wiggleton Spoons for Percival Plunk"), versions)).toBe("an earlier one (Wiggleton Spoons for Percival Plunk)");
    // A card with one version (the Analyzer's): nothing when it's that one, the earlier one otherwise.
    const one = versionChoices(evaluation(), snapshot);
    expect(versionLine(fb("suggested", evaluation().key), one)).toBeNull();
    expect(versionLine(fb("full", null), one)).toBeNull();
    expect(versionLine(fb("planB", planB.key, "Wiggleton Spoons for Ignatius Fumblewick"), one)).toBe("an earlier one (Wiggleton Spoons for Ignatius Fumblewick)");
    // Nothing without an outcome or a version.
    expect(versionLine(fb("planB", planB.key, null, null), versions)).toBeNull();
    expect(versionLine(fb(null, null), versions)).toBeNull();
  });

  it("says a team's possessive plainly", () => {
    expect([possessive("Team 2"), possessive("Gravel Gophers"), possessive("The Bus")]).toEqual(["Team 2's", "Gravel Gophers'", "The Bus'"]);
  });
});

describe("Phase 4c: the card's words that the planner's reply to Checkpoint 4b changed", () => {
  it("⚠️ the card's odds line and its reasons' odds sentence say the same change (final review of Phase 4c, findings R9 and PAGES-2)", () => {
    // Parker's cards: 10.546% + 1.94 printed "10.5% → 12.5%" beside "title odds by 1.9"; 60% → 60% beside "playoff odds by 0.4".
    const cases: [number, number, number, number][] = [
      [0.602, 0.0508, 0.10546, 0.0194],
      [0.598, 0.0044, 0.10546, 0.0275],
      [0.5986, 0.0264, 0.1055, 0.0053],
      [0.41, -0.0251, 0.0449, -0.0026],
      [0.003, 0.0041, 0.0003, 0.0011],
    ];
    // "<0.1%" and "<1%" read as 0, ">99.9%" and ">99%" as 100 (the card's words at the extremes).
    const number = (s: string) => (s.startsWith("<") ? 0 : s.startsWith(">") ? 100 : Number(s.replace(/%/g, "")));
    for (const [po, dPO, ch, dCH] of cases) {
      const baseline = { pPlayoffs: po, pTitle: ch };
      const e = evaluation({ dPO, dCH });
      const words = explainTrade(e, { teamName: (id) => teamNameOf(snapshot, id), player: (id) => snapshot.players[id] ?? null, slots: [], leagueType: "redraft", tradeDeadline: null, baseline });
      const shown = buildTradeCard({ ...e, reasons: words.reasons, pitch: words.pitch }, { snapshot, baseline });
      const printed = (label: string) => {
        const [from = "", to = ""] = (shown.odds.find((o) => o.label === label)?.value ?? "").split(" → ");
        return Math.round((number(to) - number(from)) * 10) / 10;
      };
      const said = (what: "playoff" | "title") => {
        const line = shown.reasons.find((r) => r.includes(`${what} odds by`)) ?? "";
        const m = new RegExp(`(Raises|Lowers|raises|lowers) your (?:playoff odds by [\\d.]+ and your )?${what} odds by ([\\d.]+)`).exec(line) ?? new RegExp(`(Raises|Lowers|raises|lowers) your ${what} odds by ([\\d.]+)`).exec(line);
        if (!m) return 0;
        const [, verb = "", n = "0"] = m;
        return (verb.toLowerCase() === "raises" ? 1 : -1) * Number(n);
      };
      expect([said("playoff"), said("title")], `${po} ${dPO} ${ch} ${dCH}: ${shown.odds.map((o) => o.value).join(" · ")} | ${shown.reasons.join(" ")}`).toEqual([printed("Playoff odds"), printed("Title odds")]);
    }
  });

  it("reads the same FantasyCalc values as the engine's words (evaluate.ts explainContextOf), so the card's value line and its reasons agree", { timeout: 120_000 }, () => {
    const league = randomLeague({ teams: 8, seed: 20261004, freeAgentsPerPosition: 10 });
    const snap = { ...league.snapshot, myTeamId: "1" };
    const market = league.inputs.market;
    if (!market) throw new Error("the random league has FantasyCalc values");
    const fresh = Object.keys(market.values).length;
    expect(fresh).toBeGreaterThan(20);
    for (const m of [market, { ...market, fallback: { kind: "saved" as const, listDate: "2026-09-27T15:00:00.000Z" } }, { ...market, fallback: { kind: "curve" as const, listDate: "2026-09-01T00:00:00.000Z" } }, null]) {
      const ctx = buildTradeContext(snap, { ...league.inputs, market: m }, { now: new Date("2026-09-30T12:00:00.000Z"), settings: defaultTradeSettings() });
      const I = tradeInternals(ctx);
      const engine = explainContextOf(I).fantasyCalcValue;
      const page = fantasyCalcLookup(m);
      const ids = Object.keys(I.league.lp.players);
      expect(ids.length).toBeGreaterThan(50);
      let quoted = 0;
      for (const id of ids) {
        const v = page.value(id);
        expect(v, `${m?.fallback?.kind ?? (m ? "fresh" : "none")} ${id}`).toBe(engine?.(id) ?? null);
        if (v !== null) quoted++;
      }
      // Fresh and saved lists quote FantasyCalc; the curve fallback and no market quote nothing.
      expect(quoted > 0, m?.fallback?.kind ?? (m ? "fresh" : "none")).toBe(m !== null && m.fallback?.kind !== "curve");
    }
  });

  it("says what Helps you sums up, once per page: the planner's words in redraft, long-term value in dynasty and keeper leagues, no trade-value cost without FantasyCalc (⚠️ ours), then its scale (planner reply to Checkpoint 4c, A2: the tooltip's words, for a phone)", () => {
    expect(helpsInfoText("redraft")).toBe("Helps you (0–100) sums up how much your title and playoff odds rise, minus a cost for giving away trade value or plus a credit for gaining it. 63 ≈ as good as adding 3 points a week to your lineup for the rest of the season.");
    // Dynasty and keeper leagues with long-term values: the scale's mix (planner reply to Checkpoint 7a, §2 question 6), its
    // numbers once the search's or the evaluation's scale is known (below).
    expect(helpsInfoText("dynasty")).toBe(
      "Helps you (0–100) sums up how much your title and playoff odds rise, weighed against the change in your roster's long-term value. 63 ≈ as good as adding 3 points a week to your lineup this season together with 10% more long-term value for your roster, weighed by your Win now ↔ Future setting.",
    );
    expect(helpsInfoText("keeper")).toBe(helpsInfoText("dynasty"));
    expect(helpsInfoText("redraft", false)).toBe("Helps you (0–100) sums up how much your title and playoff odds rise. 63 ≈ as good as adding 3 points a week to your lineup for the rest of the season.");
    // The Finder says it once, above its cards; not on an empty list.
    const result = searchResult([evaluation()]);
    expect(buildFinderView({ result, sort: "overall", snapshot, partnerId: null, fantasyCalc: fantasyCalcLookup({ ...MARKET, fallback: { kind: "curve", listDate: "2026-09-01T00:00:00.000Z" } }) }).helpsInfo).toBe(
      "Helps you (0–100) sums up how much your title and playoff odds rise. 63 ≈ as good as adding 3 points a week to your lineup for the rest of the season.",
    );
    expect(buildFinderView({ result: searchResult([]), sort: "overall", snapshot, partnerId: null }).helpsInfo).toBeNull();
  });

  it("says Helps you sums up the odds alone in a dynasty or keeper league whose long-term values didn't load (review of track UIC, finding 2: B is B_win then)", () => {
    const plain = "Helps you (0–100) sums up how much your title and playoff odds rise. 63 ≈ as good as adding 3 points a week to your lineup for the rest of the season.";
    expect(helpsInfoText("keeper", true, false)).toBe(plain);
    expect(helpsInfoText("dynasty", false, false)).toBe(plain);
    // The long-term flag means nothing in a redraft league, nor FantasyCalc's in dynasty and keeper ones (no market term).
    expect(helpsInfoText("redraft", true, false)).toBe(helpsInfoText("redraft"));
    expect(helpsInfoText("dynasty", false, true)).toBe(helpsInfoText("dynasty"));
    // The engine's own word: TradeEvaluation.dynMissing on the trades shown (the Finder) or the trade built (the Analyzer).
    const keeper = { ...snapshot, settings: { ...snapshot.settings, leagueType: "keeper" as const } };
    const missing = evaluation({ dynMissing: true, lambda: 0.2 });
    expect(buildFinderView({ result: searchResult([missing]), sort: "overall", snapshot: keeper, partnerId: null }).helpsInfo).toBe(plain);
    expect(buildFinderView({ result: searchResult([evaluation({ lambda: 0.2 })]), sort: "overall", snapshot: keeper, partnerId: null }).helpsInfo).toBe(helpsInfoText("keeper"));
    expect(buildAnalysisView({ evaluation: missing, illegal: null, notes: [] }, keeper).helpsInfo).toBe(plain);
    expect(buildAnalysisView({ evaluation: evaluation({ lambda: 0.2 }), illegal: null, notes: [] }, keeper).helpsInfo).toBe(helpsInfoText("keeper"));
  });

  it("offers the minimum chance's options from config (Any, 10% … 50%) and names them", () => {
    expect(MIN_CHANCE_OPTIONS).toEqual([
      { value: 0, label: "Any" },
      { value: 0.1, label: "10%" },
      { value: 0.2, label: "20%" },
      { value: 0.3, label: "30%" },
      { value: 0.4, label: "40%" },
      { value: 0.5, label: "50%" },
    ]);
    expect(MIN_CHANCE_OPTIONS.map((o) => o.value)).toEqual([...config.ranking.minChanceOptions]);
    expect([minChanceLabel(0.3), minChanceLabel(0), minChanceLabel(0.25)]).toEqual(["30%", "Any", "25%"]);
  });

  it("says under the minimum that it reads the chance the trade goes through, naming the review the cards name (review of track UIC, finding 5)", () => {
    expect(minChanceNote("league_vote")).toBe("Judged on the chance the trade goes through, which a league veto vote can cut.");
    expect(minChanceNote("commissioner")).toBe("Judged on the chance the trade goes through, which the commissioner's review can cut.");
    expect(minChanceNote("none")).toBeNull();
    // The cards' veto line names the same review.
    const vetoed = evaluation({ pAccept: 0.4, pComplete: 0.2, detail: { vetoRisk: true } });
    expect(buildTradeCard(vetoed, { snapshot: tradeSnapshot({ tradeReview: "commissioner" }) }).numbers.acceptNote).toBe("Counting the commissioner's review, about 20% it goes through.");
    expect(buildTradeCard(vetoed, { snapshot: tradeSnapshot({ tradeReview: "league_vote" }) }).numbers.acceptNote).toBe("Counting a league veto vote, about 20% it goes through.");
  });

  it("says when the minimum leaves few ideas, and suggests a lower setting (change 10: filter.few)", () => {
    const filter = (minChance: number, few: boolean) => ({ minChance, qualifying: 9, few });
    const four = [0, 1, 2, 3].map((i) => evaluation({ key: `k${i}`, give: [`10${i + 1}`] }));
    expect(fewText({ trades: four, filter: filter(0.5, true) })).toBe("Only 4 trade ideas to show at “at least 50%”. Try a lower setting to see more.");
    expect(fewText({ trades: four.slice(0, 1), filter: filter(0.3, true) })).toBe("Only 1 trade idea to show at “at least 30%”. Try a lower setting to see more.");
    // Not when the search says no lower setting would add one, at Any, or before ranking (no filter).
    expect(fewText({ trades: four, filter: filter(0.5, false) })).toBeNull();
    expect(fewText({ trades: four, filter: filter(0, true) })).toBeNull();
    expect(fewText({ trades: four })).toBeNull();
    const view = buildFinderView({ result: searchResult(four, { filter: filter(0.5, true) }), sort: "overall", snapshot, partnerId: null });
    expect(view.few).toBe("Only 4 trade ideas to show at “at least 50%”. Try a lower setting to see more.");
  });

  it("says when no idea reaches the minimum chance, instead of 'No trade ideas that help you'", () => {
    const view = buildFinderView({
      result: searchResult([], { filter: { minChance: 0.5, qualifying: 0, few: true }, hidden: { byBenefit: 4, byMarket: 0, byChance: 6 } }),
      sort: "overall",
      snapshot,
      partnerId: null,
    });
    expect(view.empty).toEqual({
      title: "No trade ideas at this minimum chance",
      text: ["Every trade idea that would otherwise show is below “at least 50%”. Try a lower setting to see more.", "Left out on purpose: 4 trade ideas that wouldn't help you and 6 trade ideas below your minimum chance."],
    });
    expect(view.hidden).toBeNull();
    expect(view.statusText).toBe("No trade ideas at this minimum chance.");
    // At Any, with nothing under the minimum: as before.
    expect(buildFinderView({ result: searchResult([], { filter: { minChance: 0, qualifying: 0, few: false }, hidden: { byBenefit: 4, byMarket: 0, byChance: 0 } }), sort: "overall", snapshot, partnerId: null }).empty?.title).toBe(
      "No trade ideas that help you",
    );
  });

  it("puts the pattern note above the list, as the engine wrote it (change 6), only with cards", () => {
    const pattern = { playerId: "106", count: 7, of: 10, drivers: ["byeCover" as const], text: "Most of your best ideas trade Wiggleton Spoons: his bye is in week 13, your riskiest week." };
    expect(buildFinderView({ result: searchResult([evaluation()], { pattern }), sort: "overall", snapshot, partnerId: null }).pattern).toBe(pattern.text);
    expect(buildFinderView({ result: searchResult([evaluation()]), sort: "overall", snapshot, partnerId: null }).pattern).toBeNull();
    expect(buildFinderView({ result: searchResult([], { pattern }), sort: "overall", snapshot, partnerId: null }).pattern).toBeNull();
  });

  it("lists a saved FantasyCalc list's date with the notes, since the cards' numbers rest on it", () => {
    const saved = fantasyCalcLookup({ ...MARKET, fallback: { kind: "saved", listDate: "2026-09-27T15:00:00.000Z" } });
    const view = buildFinderView({ result: searchResult([evaluation()], { notes: ["Kickers and D/STs are left out; turn them on in Settings."] }), sort: "overall", snapshot, partnerId: null, fantasyCalc: saved });
    expect(view.notes).toEqual(["Kickers and D/STs are left out; turn them on in Settings.", "Trade values from Sep 27: FantasyCalc didn't answer."]);
    const analysis = buildAnalysisView({ evaluation: evaluation(), illegal: null, notes: [] }, snapshot, undefined, { fantasyCalc: saved });
    expect(analysis.notes).toEqual(["Trade values from Sep 27: FantasyCalc didn't answer."]);
  });

  it("names a goal that isn't the default in the settings line, as what the league rewards (change 8; planner reply to Checkpoint 7a, 5.2)", () => {
    expect(GOAL_LABEL).toEqual({ title: "Only the champion", prizes: "Several prizes", playoffs: "Making the playoffs" });
    expect(settingsSummary({ ...defaultTradeSettings(), goal: "prizes" }, "espn")).toBe("Up to 2 players a side. Your league rewards: Several prizes.");
    expect(settingsSummary({ ...defaultTradeSettings(), goal: "playoffs", protectValue: "high" }, "espn")).toBe("Up to 2 players a side. Your league rewards: Making the playoffs. Protect my trade value: High.");
    expect(settingsSummary({ ...defaultTradeSettings(), goal: config.benefit.goalDefault }, "espn")).toBe("Up to 2 players a side.");
  });

  it("shows a re-filter's progress as the ranking alone; a re-filter that had to search shows the search's stages", () => {
    expect(progressView(null, "refilter")).toEqual({ label: "Ranking the trade ideas", detail: null, percent: 0, valueText: "Ranking the trade ideas" });
    expect(progressView({ stage: "rank", done: 5, total: 10 }, "refilter").percent).toBe(50);
    expect(progressView({ stage: "rank", done: 10, total: 10 }, "refilter").percent).toBe(99);
    expect(progressView({ stage: "screening", done: 120, total: 480 }, "refilter")).toEqual(progressView({ stage: "screening", done: 120, total: 480 }));
    // A search's "rank" stage is its last 13% (Checkpoint 7f: its runs on the shown block continue their ranking runs; 16% at
    // Checkpoint 7e, when it played out the ideas shown on all 20,000 seasons; 4% before).
    expect(progressView({ stage: "rank", done: 5, total: 10 }).percent).toBe(93);
  });

  it("gives the Analyzer's card 'Details': what Helps you is worth in points a week, its trade-value part as a lineup equivalent, never a trade value figure (planner reply to Checkpoint 7a, §2 question 5 and 5.4)", () => {
    // (The engine fixture leaves marketWeekly out: set here as the engine sets it, κ × clamp(g_mkt(me)) at Medium.)
    const e = { ...evaluation({ gMine: -0.12, gPartner: 0.14, b: 2.6, bWin: 3.4, features: { g: 0.04, n: 0, h: 0, c: 0, a: 0, hist: null, ctx: 0, hot: 0, urg: 0, z: -0.3 } }), marketWeekly: -0.24 };
    const view = buildAnalysisView({ evaluation: e, illegal: null, notes: [] }, snapshot, undefined, { fantasyCalc: FC });
    expect(view.card?.details).toEqual({
      summary: "Details",
      intro:
        "How Helps you adds up for this trade. Trade value is what your “Protect my trade value” setting adds for trade value you'd gain, or takes away for trade value you'd give up, counted as projected points a week.",
      items: [
        // The planner's words: TradeEvaluation.marketWeekly, signed, one decimal.
        "Trade value: −0.2 pts/week equivalent.",
        // Planner reply to Checkpoint 4c, A2: "≈ +X pts/week", X = 3 × B / B₃ = 3 × 2.6 / 6.
        "Helps you 35 ≈ +1.3 pts/week: as good as adding that to your lineup every week for the rest of the season.",
      ],
    });
    // Signed, one decimal: a gain, nothing, a credit at the clamp.
    expect(detailsView({ ...e, marketWeekly: 0.25 }, "redraft").items[0]).toBe("Trade value: +0.3 pts/week equivalent.");
    expect(detailsView({ ...e, marketWeekly: 0 }, "redraft").items[0]).toBe("Trade value: 0 pts/week equivalent.");
    expect(detailsView({ ...e, marketWeekly: 1 }, "redraft").items[0]).toBe("Trade value: +1 pts/week equivalent.");
    // No market term (marketWeekly null or absent: FantasyCalc's curve fallback or no values, whose notes say so): no line,
    // and the intro doesn't name it.
    const noTerm = detailsView({ ...e, marketWeekly: null }, "redraft");
    expect(noTerm.items).toEqual(["Helps you 35 ≈ +1.3 pts/week: as good as adding that to your lineup every week for the rest of the season."]);
    expect(noTerm.intro).toBe("How Helps you adds up for this trade.");
    const { marketWeekly: absent, ...older } = e;
    expect(absent).toBe(-0.24);
    expect(detailsView(older, "redraft").items).toEqual(noTerm.items);
    // Dynasty and keeper leagues have no trade-value part; when their long-term values didn't load, B is the odds alone.
    expect(detailsView(e, "dynasty").items[0]).toBe("Helps you has no trade-value part here: in dynasty and keeper leagues it counts the change in your roster's long-term value instead.");
    expect(detailsView({ ...e, dynMissing: true }, "keeper").items[0]).toBe("Helps you has no trade-value part here, and long-term trade values aren't available, so it counts this season only.");
    // No trade value figure anywhere: no value percent, no FantasyCalc, no package words (the scale's own "10% more long-term
    // value" in a dynasty league defines the scale, not this trade).
    for (const d of [view.card?.details, detailsView(e, "dynasty")]) expect([d?.intro, ...(d?.items ?? [])].join(" ")).not.toMatch(/\d+% (more|less) trade value|FantasyCalc|their side|your side/i);
    expect(view.card?.details?.items.join(" ")).not.toMatch(/\d+%/);
    // The Trade Finder's cards have none.
    expect(buildTradeCard(e, { snapshot }).details).toBeNull();
  });

  it("ends 'Details' with what Helps you is worth in lineup points a week, on the evaluation's own B₃ (planner reply to Checkpoint 4c, A2)", () => {
    // B = B₃: Helps you 63 ≈ +3 pts/week, in every redraft league (here B₃ 4.2).
    expect(lineupEquivalentText({ b: 4.2, b3: 4.2 })).toBe("Helps you 63 ≈ +3 pts/week: as good as adding that to your lineup every week for the rest of the season.");
    // One point: singular; one decimal at most.
    expect(lineupEquivalentText({ b: 2, b3: 6 })).toBe("Helps you 28 ≈ +1 pt/week: as good as adding that to your lineup every week for the rest of the season.");
    expect(lineupEquivalentText({ b: 1.4, b3: 6 })).toBe("Helps you 21 ≈ +0.7 pts/week: as good as adding that to your lineup every week for the rest of the season.");
    // A trade that doesn't help reads its loss (Helps you prints 0), and nothing reads as nothing.
    expect(lineupEquivalentText({ b: -1.2, b3: 6 })).toBe("Helps you 0 ≈ −0.6 pts/week: as costly as losing that from your lineup every week for the rest of the season.");
    expect(lineupEquivalentText({ b: 0.001, b3: 6 })).toBe("Helps you 0 ≈ 0 pts/week: about the same as leaving your lineup as it is.");
    // Not simulated, or an evaluation without a scale: no line.
    expect(lineupEquivalentText({ b: null, b3: 6 })).toBeNull();
    expect(lineupEquivalentText({ b: 3, b3: null })).toBeNull();
    const e = evaluation({ b: 3, bWin: 3 });
    expect(detailsView({ ...e, b3: null }, "redraft").items.some((i) => i.includes("pts/week:"))).toBe(false);
    expect(detailsView({ ...e, b3: 6, marketWeekly: -0.5 }, "redraft").items).toEqual([
      "Trade value: −0.5 pts/week equivalent.",
      "Helps you 39 ≈ +1.5 pts/week: as good as adding that to your lineup every week for the rest of the season.",
    ]);
    // A dynasty league whose long-term values didn't load: B is the odds alone, plain points a week.
    expect(detailsView({ ...e, b3: 3, dynMissing: true }, "dynasty").items.at(-1)).toBe("Helps you 63 ≈ +3 pts/week: as good as adding that to your lineup every week for the rest of the season.");
  });

  it("follows the scale's mix in dynasty and keeper leagues with long-term values: the tooltip, the info line and Details (planner reply to Checkpoint 7a, §2 question 6)", () => {
    const mix = "63 ≈ as good as adding 3 points a week to your lineup this season together with 10% more long-term value for your roster, weighed by your Win now ↔ Future setting";
    // λ 0.35: +3 a week alone reads 50 and +10% long-term value alone 26 (the engine's HelpsScale fields).
    const scale = helpsScaleFixture({ lambda: 0.35, gainReads: 50, futureReads: 26 });
    expect(helpsScaleText(scale)).toBe(`${mix} (3 points a week alone reads 50, and 10% more long-term value alone reads 26).`);
    // Without the scale yet: the mix without its numbers; a redraft league or one without long-term values: the redraft words.
    expect(helpsScaleText(null, { leagueType: "dynasty", longTermOn: true })).toBe(`${mix}.`);
    expect(helpsScaleText(null, { leagueType: "keeper", longTermOn: false })).toBe(HELPS_SCALE_TEXT);
    expect(helpsScaleText(null, { leagueType: "redraft" })).toBe(HELPS_SCALE_TEXT);
    expect(helpsScaleText(helpsScaleFixture({ lambda: null }))).toBe(HELPS_SCALE_TEXT);
    // Win now ↔ Future at its ends: this season alone (λ 0), long-term value alone (λ 1).
    expect(helpsScaleText(helpsScaleFixture({ lambda: 0, gainReads: 63, futureReads: 0 }))).toBe(HELPS_SCALE_TEXT);
    expect(helpsScaleText(helpsScaleFixture({ lambda: 1, gainReads: 0, futureReads: 63 }))).toBe("63 ≈ as good as adding 10% more long-term value to your roster.");
    // The card's tooltip and the pages' info line read the search's or the evaluation's scale.
    const dynasty = { ...snapshot, settings: { ...snapshot.settings, leagueType: "dynasty" as const } };
    const e = evaluation({ b: 3, b3: 4.65, lambda: 0.35, bFuture: 1, dDyn: 300 });
    expect(buildTradeCard(e, { snapshot: dynasty, helpsScale: scale }).numbers.helps.title).toBe(helpsScaleText(scale));
    const finder = buildFinderView({ result: searchResult([e], { helpsScale: scale }), sort: "overall", snapshot: dynasty, partnerId: null });
    expect(finder.helpsInfo).toBe(`Helps you (0–100) sums up how much your title and playoff odds rise, weighed against the change in your roster's long-term value. ${helpsScaleText(scale)}`);
    expect(finder.helpsScale).toBe(scale);
    expect(finder.cards[0]?.numbers.helps.title).toBe(helpsScaleText(scale));
    const analysis = buildAnalysisView({ evaluation: e, illegal: null, notes: [], helpsScale: scale }, dynasty);
    expect(analysis.helpsInfo).toBe(finder.helpsInfo);
    // Details: X = 3 × B / B₃ on the mix (never a long-term value percent of the trade's own).
    expect(analysis.card?.details?.items.at(-1)).toBe(
      "Helps you 48 ≈ +1.9 on a scale where +3 is as good as adding 3 points a week to your lineup this season together with 10% more long-term value for your roster, weighed by your Win now ↔ Future setting.",
    );
    expect(lineupEquivalentText(e, helpsScaleFixture({ lambda: 1, gainReads: 0, futureReads: 63 }))).toBe("Helps you 48 ≈ +1.9 on a scale where +3 is as good as adding 10% more long-term value to your roster.");
    // A redraft league keeps its words whatever the scale.
    expect(lineupEquivalentText(e, null, { leagueType: "redraft" })).toBe("Helps you 48 ≈ +1.9 pts/week: as good as adding that to your lineup every week for the rest of the season.");
  });

  it("uses no jargon in the new lines (odds, weekly line, details, value line)", () => {
    const c4 = buildTradeCard(evaluation({ gMine: -0.2, detail: { winChance: [{ week: 9, before: 0.68, after: 0.64 }] } }), { snapshot, baseline: { pPlayoffs: 0.6, pTitle: 0.1 }, fantasyCalc: FC, details: true });
    const words = [...c4.odds.map((o) => `${o.label} ${o.value} ${o.srValue}`), c4.weekly?.text ?? "", ...(c4.details?.items ?? []), c4.details?.intro ?? "", ...c4.facts.map((f) => f.value), ...c4.flags.map((f) => f.text)].join(" ");
    for (const jargon of [" EV ", "σ", "V*", "g_mkt", "B_win", "κ", "kappa", "NaN", "undefined", "Infinity"]) expect(words).not.toContain(jargon);
  });
});

describe("the Helps you scale in the feedback's version inputs (Phase 7a, track FB; track SC's crossTrack)", () => {
  it("reads back every reason benefit.helpsScaleNotes writes, among other notes", () => {
    // Planner reply to Checkpoint 7a, §2 question 6: the floor's "odds" is the only reason the engine writes (Checkpoint 7a's
    // "lambda" went with its λ cap).
    const scales: Array<Pick<HelpsScale, "reason" | "oddsNamed">> = [
      { reason: "odds", oddsNamed: "title" },
      { reason: "odds", oddsNamed: "playoff" },
      { reason: null, oddsNamed: "title" },
      { reason: null, oddsNamed: "playoff" },
      // "Several prizes" (Checkpoint 7c): its floor note is an odds note too.
      { reason: "odds", oddsNamed: "prizes" },
      { reason: null, oddsNamed: "prizes" },
    ];
    for (const scale of scales) {
      const notes = ["Kickers and D/STs are left out; turn them on in Settings.", ...helpsScaleNotes(scale)];
      expect(helpsReasonOf(notes), JSON.stringify(scale)).toBe(scale.reason);
    }
    expect([HELPS_FLOOR_NOTE, HELPS_FLOOR_NOTE_PLAYOFFS, HELPS_FLOOR_NOTE_PRIZES].map((n) => helpsReasonOf([n]))).toEqual(["odds", "odds", "odds"]);
    expect(helpsReasonOf(undefined)).toBeNull();
    expect(helpsReasonOf([])).toBeNull();
  });

  it("every version of a card carries the card's B₃ and its scale's reason (its own trade and Plan B are scored on the card's B₃)", () => {
    const planB = { proposal: { partnerId: "2", give: [{ kind: "player" as const, id: "106" }], get: [{ kind: "player" as const, id: "203" }] }, key: "2|give:106|get:203", b: 2, tradeScore: 98, pAccept: 0.5, pComplete: 0.45, acceptLabel: "Decent", overall: 86, kind: "otherTarget" as const };
    const floored = evaluation({ b3: 0.5, planB, detail: { notes: [HELPS_FLOOR_NOTE] } });
    expect(versionChoices(floored, snapshot, "title").map((v) => [v.version, v.inputs?.b3, v.inputs?.helpsReason])).toEqual([
      ["suggested", 0.5, "odds"],
      ["planB", 0.5, "odds"],
    ]);
    // An older evaluation's steps aren't read: the card's own trade, on its scale.
    const stepped = steppedFull({ detail: { notes: helpsScaleNotes({ reason: "odds", oddsNamed: "playoff" }) } });
    expect(versionChoices(stepped, snapshot).map((v) => [v.version, v.inputs?.b3, v.inputs?.helpsReason])).toEqual([["suggested", FIXTURE_B3, "odds"]]);
    // An evaluation without B₃ (made before Phase 7a): unknown.
    expect(versionChoices({ ...evaluation(), b3: null }, snapshot)[0]?.inputs).toMatchObject({ b3: null, helpsReason: null });
  });

  it("Checkpoint 7e (item 4.1): an offer of “How to offer it” carries its own B₃ and reason, the card's own trade and its Plan B the card's", () => {
    // The card prints on its B₃ (3.7); an offer's own evaluation says its own (3.5, floored here: the floor's note).
    const base = evaluation({ b3: 3.7, detail: { notes: [] } });
    const opening = evaluation({ get: ["202"], b3: 3.5, b: 4, pAccept: 0.15, pComplete: 0.15, detail: { notes: [HELPS_FLOOR_NOTE] } });
    const c = buildTradeCard(base, { snapshot, goal: "title" });
    const view = buildLadderView({ cardKey: base.key, steps: [{ kind: "open", evaluation: opening, message: "x" }, { kind: "suggested", evaluation: base, message: "y" }] }, c, { snapshot, goal: "title" });
    expect(view.versions.map((v) => [v.version, v.inputs?.b, v.inputs?.b3, v.inputs?.helpsReason])).toEqual([
      ["open", 4, 3.5, "odds"],
      ["suggested", base.b, 3.7, null],
    ]);
  });

  it("on the engine's own search: every card that helps me offers “How to offer it”, and its versions are its own trade and Plan B's until it's opened (Checkpoint 7e, item 4.1)", { timeout: 60_000 }, () => {
    const { snapshot: league, inputs } = smallLeague(23);
    const ctx = buildTradeContext(league, inputs, { now: TEST_NOW, scenarios: 8 });
    const r = runTradeSearch(ctx, { settings: { ...defaultTradeSettings(), minChance: 0.1 } });
    expect(r.trades.length).toBeGreaterThan(0); // a fact of the synthetic data
    for (const e of r.trades) {
      const c = buildTradeCard(e, { snapshot: league, goal: "title" });
      expect(c.offers, e.key).toEqual({ heading: OFFERS_HEADING, suggested: OFFER_STEP_LABEL.suggested });
      expect(c.versions.map((v) => v.version), e.key).toEqual(e.planB ? ["suggested", "planB"] : ["suggested"]);
      expect(c.versions[0]?.inputs).toMatchObject({ b: e.b, b3: e.b3 });
    }
  });

  it("on the engine's own evaluation: a floored scale (my odds barely move) reads 'odds' with the floor's B₃", { timeout: 60_000 }, () => {
    const { snapshot: league, inputs } = smallLeague(11);
    const ctx = buildTradeContext(league, inputs, { now: TEST_NOW, scenarios: 0 });
    const I = tradeInternals(ctx);
    const sim = I.sim as SimState;
    // Every prize component the calibration run keeps (Checkpoint 7c): here 1st place's alone moves, barely.
    sim.calibration = { ...(sim.calibration as HelpsCalibration), dPO: 0.0004, dCH: 0.0002, dPrizes: titleDeltas(0.0002) };
    const me = I.me as NonNullable<typeof I.me>;
    const partner = I.byId.get("2") as NonNullable<ReturnType<typeof I.byId.get>>;
    const x = evaluateExact(I, { partnerId: "2", give: [{ kind: "player", id: me.roster[0] as string }], get: [{ kind: "player", id: partner.roster[0] as string }] }, 4);
    if ("illegal" in x) throw new Error(x.illegal);
    // The shown block (Checkpoint 7e): its calibration, SimState.calibration, is the one floored above, and the cards print from it.
    const e = simulateTrade(I, x, "shown", null);
    expect(helpsReasonOf(e.detail.notes)).toBe("odds");
    expect(versionChoices(e, league, "title")[0]?.inputs).toMatchObject({ b3: config.benefit.helpsFloor, helpsReason: "odds" });
  });
});

describe("when to look, and how fresh the data is (planner reply to Checkpoint 7a, 5.3)", () => {
  /** The fixture league: week 12 of weeks 1–17, trade deadline week 13, no trade review; Thursday of week 12. */
  const NOW = new Date("2026-11-26T22:00:00.000Z");
  const HOUR = 3600_000;
  const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * HOUR).toISOString();
  const BEST = "Best time to look: Tuesday or Wednesday, after Monday night's game. Trade values and projections have caught up with the weekend,";

  /** The review as a league's settings hold it: its kind, and its length when the platform reports one. */
  const review = (tradeReview: LeagueSettings["tradeReview"], tradeReviewHours?: number): Pick<LeagueSettings, "tradeReview" | "tradeReviewHours"> =>
    tradeReviewHours === undefined ? { tradeReview } : { tradeReview, tradeReviewHours };
  /** BEST up to its last clause, for a review longer than a day (a sentence of its own follows). */
  const LEAD = `${BEST.slice(0, -1)}.`;

  it("words the league's review period from LeagueSettings.tradeReviewHours alone: days when whole, else hours; none only at 0 hours", () => {
    expect(reviewPeriodWords(review("league_vote", 24))).toBe("1-day");
    expect(reviewPeriodWords(review("commissioner", 48))).toBe("2-day");
    expect(reviewPeriodWords(review("league_vote", 72))).toBe("3-day");
    expect(reviewPeriodWords(review("commissioner", 36))).toBe("36-hour");
    // No review: a period of 0 hours, the only definite one (ESPN's revisionHours 0; Sleeper with the veto vote off).
    expect(reviewPeriodWords(review("none", 0))).toBe("none");
    expect(reviewPeriodWords(review("league_vote", 0))).toBe("none");
    // Not reported, or not a number of hours: unknown. tradeReview "none" without a period is only assumed (review of
    // Phase 7b: a Sleeper league without veto_auto_poll, most with a 2-day trade_review_days; a veto code we don't know;
    // an ESPN league that reports neither veto votes nor a period), never a definite "none".
    expect(reviewPeriodWords(review("none"))).toBeNull();
    expect(reviewPeriodWords(review("league_vote"))).toBeNull();
    for (const tradeReviewHours of [Number.NaN, -24, Number.POSITIVE_INFINITY]) expect(reviewPeriodWords(review("commissioner", tradeReviewHours))).toBeNull();
  });

  it("says the best time to look, with the league's review period when it's known, and when a trade clears when the review lasts over a day", () => {
    expect(bestTimeText(review("league_vote", 24))).toBe(`${BEST} and a trade still has time to clear your league's 1-day review before Thursday.`);
    expect(bestTimeText(review("league_vote", 12))).toBe(`${BEST} and a trade still has time to clear your league's 12-hour review before Thursday.`);
    expect(bestTimeText(review("commissioner"))).toBe(`${BEST} and a trade still has time to clear your league's review before Thursday.`);
    expect(bestTimeText(review("none", 0))).toBe(`${BEST} and a trade still has time to go through before Thursday.`);
    // An assumed "none" reads the unknown period.
    expect(bestTimeText(review("none"))).toBe(`${BEST} and a trade still has time to clear your league's review before Thursday.`);
    // Over a day, a trade made Wednesday can't clear "before Thursday" (review of Phase 7b): when it clears instead.
    expect(bestTimeText(review("league_vote", 48))).toBe(`${LEAD} With your league's 2-day review, a trade made Tuesday clears on Thursday, and one made Wednesday on Friday.`);
    expect(bestTimeText(review("commissioner", 72))).toBe(`${LEAD} With your league's 3-day review, a trade made Tuesday clears on Friday, and one made Wednesday on Saturday.`);
    expect(bestTimeText(review("commissioner", 96))).toBe(`${LEAD} With your league's 4-day review, a trade made Tuesday clears on Saturday, and one made Wednesday on Sunday.`);
    expect(bestTimeText(review("league_vote", 36))).toBe(`${LEAD} With your league's 36-hour review, a trade made then can clear after Thursday night's game.`);
    expect(bestTimeText(review("league_vote", 120))).toBe(`${LEAD} With your league's 5-day review, a trade made then can clear after Thursday night's game.`);
    for (const hours of [24, 36, 48, 72, 96, 120]) expect(bestTimeText(review("league_vote", hours)).startsWith(LEAD.slice(0, -1))).toBe(true);
  });

  it("is in season for trading while a fantasy week is left and the trade deadline hasn't passed", () => {
    expect(snapshot.currentWeek).toBe(12);
    expect(snapshot.settings.tradeDeadline).toEqual({ week: 13 });
    expect(inTradingSeason(snapshot, NOW)).toBe(true);
    // The deadline week counts; the week after it doesn't (Sleeper: its league week, when it lags the NFL week).
    expect(inTradingSeason({ ...snapshot, currentWeek: 13 }, NOW)).toBe(true);
    expect(inTradingSeason({ ...snapshot, currentWeek: 14 }, NOW)).toBe(false);
    expect(inTradingSeason({ ...snapshot, currentWeek: 14, leagueWeek: 13 }, NOW)).toBe(true);
    // A deadline date decides when the league has one.
    const dated = (date: string) => ({ ...snapshot, settings: { ...snapshot.settings, tradeDeadline: { week: 13, date } } });
    expect(inTradingSeason(dated("2026-11-25T17:00:00.000Z"), NOW)).toBe(false);
    expect(inTradingSeason(dated("2026-12-02T17:00:00.000Z"), NOW)).toBe(true);
    // No deadline: through the last playoff week.
    const open = (currentWeek: number) => ({ ...snapshot, currentWeek, settings: { ...snapshot.settings, tradeDeadline: null } });
    expect(inTradingSeason(open(17), NOW)).toBe(true);
    expect(inTradingSeason(open(18), NOW)).toBe(false);
    // A league that lists no weeks: the inputs' last week, else not known (no line).
    const unlisted = { ...open(12), settings: { ...open(12).settings, regularSeasonWeeks: [], playoffWeeks: [] } };
    expect(inTradingSeason(unlisted, NOW, { lastWeek: 17 })).toBe(true);
    expect(inTradingSeason(unlisted, NOW, { lastWeek: 11 })).toBe(false);
    expect(inTradingSeason(unlisted, NOW)).toBe(false);
  });

  it("isn't in season before the league's first game: a preseason league, or one renewed for next season, reads week 1 (review of Phase 7b)", () => {
    const week1 = { ...snapshot, currentWeek: 1 };
    const nfl = { kickoffs: { 1: { KC: "2026-09-11T00:20:00.000Z", BAL: "2026-09-13T17:00:00.000Z", NYJ: "not a time" } } };
    // Before week 1's first kickoff (August, then a minute before it): not yet; from it on: in season.
    expect(inTradingSeason(week1, new Date("2026-08-20T17:00:00.000Z"), { nfl })).toBe(false);
    expect(inTradingSeason(week1, new Date("2026-09-11T00:19:00.000Z"), { nfl })).toBe(false);
    expect(inTradingSeason(week1, new Date("2026-09-11T00:20:00.000Z"), { nfl })).toBe(true);
    // Week 1 without a known kickoff (a league renewed for 2027, opened in February: no schedule yet): no line.
    expect(inTradingSeason(week1, new Date("2027-02-15T17:00:00.000Z"), { nfl: { kickoffs: {} } })).toBe(false);
    expect(inTradingSeason(week1, new Date("2027-02-15T17:00:00.000Z"))).toBe(false);
    // A later week has begun without a kickoff to read (the schedule lists them from the current week on).
    expect(inTradingSeason({ ...snapshot, currentWeek: 2 }, NOW, { nfl: { kickoffs: {} } })).toBe(true);
    // A league whose season starts in week 3: not in week 2; in week 3 once its first game has kicked off.
    const late = { ...snapshot, settings: { ...snapshot.settings, regularSeasonWeeks: snapshot.settings.regularSeasonWeeks.filter((w) => w >= 3) } };
    expect(inTradingSeason({ ...late, currentWeek: 2 }, NOW)).toBe(false);
    expect(inTradingSeason({ ...late, currentWeek: 3 }, new Date("2026-09-24T12:00:00.000Z"), { nfl: { kickoffs: { 3: { DAL: "2026-09-25T00:15:00.000Z" } } } })).toBe(false);
    expect(inTradingSeason({ ...late, currentWeek: 3 }, new Date("2026-09-25T01:00:00.000Z"), { nfl: { kickoffs: { 3: { DAL: "2026-09-25T00:15:00.000Z" } } } })).toBe(true);
    // A league that lists no weeks starts at NFL week 1.
    const unlisted = { ...week1, settings: { ...week1.settings, regularSeasonWeeks: [], playoffWeeks: [] } };
    expect(inTradingSeason(unlisted, new Date("2026-08-20T17:00:00.000Z"), { lastWeek: 17, nfl })).toBe(false);
    expect(inTradingSeason(unlisted, new Date("2026-09-12T17:00:00.000Z"), { lastWeek: 17, nfl })).toBe(true);
  });

  it("says how long ago, in friendly words", () => {
    const now = NOW.getTime();
    expect(timeAgoText(now, now)).toBe("just now");
    expect(timeAgoText(now - 59_000, now)).toBe("just now");
    // A clock a little ahead: never "in 2 minutes".
    expect(timeAgoText(now + 120_000, now)).toBe("just now");
    expect(timeAgoText(now - 60_000, now)).toBe("1 minute ago");
    expect(timeAgoText(now - 25 * 60_000, now)).toBe("25 minutes ago");
    expect(timeAgoText(now - HOUR, now)).toBe("1 hour ago");
    expect(timeAgoText(now - 5.5 * HOUR, now)).toBe("5 hours ago");
    expect(timeAgoText(now - 23.99 * HOUR, now)).toBe("23 hours ago");
    expect(timeAgoText(now - 24 * HOUR, now)).toBe("yesterday");
    expect(timeAgoText(now - 47 * HOUR, now)).toBe("yesterday");
    expect(timeAgoText(now - 48 * HOUR, now)).toBe("2 days ago");
    expect(timeAgoText(now - 9 * 24 * HOUR, now)).toBe("9 days ago");
  });

  it("says when the trade values and the projections were updated, leaving out what isn't known", () => {
    // The server's name for Sleeper's projections in ModelInputs.sources (a server module the pages can't import).
    expect(PROJECTIONS_SOURCE).toBe(MODEL_SOURCES.sleeperProjections);
    const market = { ...MARKET, fetchedAt: at(2) };
    const projections = { source: PROJECTIONS_SOURCE, fetchedAt: at(5) };
    const others = [{ source: MODEL_SOURCES.sleeperStats, fetchedAt: at(1) }, { source: MODEL_SOURCES.fantasyCalc, fetchedAt: at(30) }];
    expect(freshnessText({ market, sources: [...others, projections] }, NOW.getTime())).toBe("Trade values updated 2 hours ago · Projections updated 5 hours ago.");
    expect(freshnessText({ market: null, sources: [projections] }, NOW.getTime())).toBe("Projections updated 5 hours ago.");
    expect(freshnessText({ market, sources: others }, NOW.getTime())).toBe("Trade values updated 2 hours ago.");
    expect(freshnessText({ market: null, sources: others }, NOW.getTime())).toBeNull();
    expect(freshnessText({ market: { ...market, fetchedAt: "not a time" }, sources: [{ ...projections, fetchedAt: "" }] }, NOW.getTime())).toBeNull();
  });

  it("gives the Trade Finder both lines in season, and only the freshness line before the first game or once the deadline has passed", () => {
    const inputs = { market: { ...MARKET, fetchedAt: at(26) }, sources: [{ source: PROJECTIONS_SOURCE, fetchedAt: at(0.25) }], lastWeek: 17 };
    const reviewed = tradeSnapshot({ tradeReview: "league_vote" });
    const voted = { ...reviewed, settings: { ...reviewed.settings, tradeReviewHours: 24 } };
    expect(finderTimingLines({ snapshot: voted, inputs, now: NOW })).toEqual({
      bestTime: `${BEST} and a trade still has time to clear your league's 1-day review before Thursday.`,
      freshness: "Trade values updated yesterday · Projections updated 15 minutes ago.",
    });
    // The fixture league's "no review" is only assumed (no period): the unknown period's words; a 0-hour period's are its own.
    expect(finderTimingLines({ snapshot, inputs, now: NOW }).bestTime).toBe(`${BEST} and a trade still has time to clear your league's review before Thursday.`);
    expect(finderTimingLines({ snapshot: { ...snapshot, settings: { ...snapshot.settings, tradeReviewHours: 0 } }, inputs, now: NOW }).bestTime).toBe(`${BEST} and a trade still has time to go through before Thursday.`);
    expect(finderTimingLines({ snapshot: { ...voted, currentWeek: 14 }, inputs, now: NOW })).toEqual({
      bestTime: null,
      freshness: "Trade values updated yesterday · Projections updated 15 minutes ago.",
    });
    // Week 1 before its first kickoff (the inputs' schedule): the freshness line alone.
    const preseason = { ...inputs, nfl: { kickoffs: { 1: { KC: "2026-12-03T01:15:00.000Z" } } } };
    expect(finderTimingLines({ snapshot: { ...voted, currentWeek: 1 }, inputs: preseason, now: NOW })).toEqual({
      bestTime: null,
      freshness: "Trade values updated yesterday · Projections updated 15 minutes ago.",
    });
    // Both lines read the moment they're given (the page's clock): the same inputs a day later are a day older.
    expect(finderTimingLines({ snapshot: voted, inputs, now: new Date(NOW.getTime() + 24 * HOUR) }).freshness).toBe("Trade values updated 2 days ago · Projections updated yesterday.");
  });
});

describe("Checkpoint 7c: “Top 3 odds” and the words under “Several prizes” (planner reply to Checkpoint 7b, §6)", () => {
  /** Rewards as the engine makes them (reward.ts rewardOf): Parker's 2,000 / 1,600 / 900, 60 / 40 (no 3rd), the title alone. */
  const shares = (o: Partial<Reward["shares"]>): Reward["shares"] => ({ first: 0, second: 0, third: 0, weeklyHigh: 0, pointsLeader: 0, ...o });
  const PARKER: Reward = { goal: "prizes", shares: shares({ first: 4 / 9, second: 16 / 45, third: 1 / 5 }), periods: 14, empty: false };
  const TOP2: Reward = { goal: "prizes", shares: shares({ first: 0.6, second: 0.4 }), periods: 14, empty: false };
  const WEEKLY: Reward = { goal: "prizes", shares: shares({ first: 0.8, weeklyHigh: 0.2 }), periods: 14, empty: false };
  const TITLE: Reward = { goal: "title", shares: TITLE_ONLY, periods: 14, empty: false };
  const before = { pPlayoffs: 0.6, pTitle: 0.105, prizes: { first: 0.105, second: 0.09, third: 0.105, weeklyHigh: 0, pointsLeader: 0.1 } };
  const dPrizes = { first: 0.007, second: 0.006, third: 0.007, weeklyHigh: null, pointsLeader: 0.01 };
  /** An evaluation with my prize components' changes (the engine's TradeEvaluation.dPrizes; the fixture doesn't set them). */
  const traded = (o: Parameters<typeof evaluation>[0] = {}): TradeEvaluation => {
    const { dPrizes: d, ...rest } = o;
    return { ...evaluation({ dCH: 0.007, dPO: 0.03, ...rest }), dPrizes: d === undefined ? dPrizes : d };
  };

  it("adds “Top 3 odds” between the title and playoff odds when the league's split pays 3rd place, “Top 2 odds” when it pays 2nd only, and nothing otherwise", () => {
    // The lead's example: "Title odds 10.5% → 11.2% · Top 3 odds 30% → 32% · Playoff odds 60% → 63%".
    expect(buildTradeCard(traded(), { snapshot, baseline: before, reward: PARKER }).odds).toEqual([
      { label: "Title odds", value: "10.5% → 11.2%", srValue: "from 10.5% to 11.2%" },
      { label: "Top 3 odds", value: "30% → 32%", srValue: "from 30% to 32%" },
      { label: "Playoff odds", value: "60% → 63%", srValue: "from 60% to 63%" },
    ]);
    // 2nd paid, 3rd not: the top 2 (P(1st) + P(2nd)).
    expect(oddsViews(traded(), before, TOP2).map((o) => `${o.label} ${o.value}`)).toEqual(["Title odds 10.5% → 11.2%", "Top 2 odds 20% → 21%", "Playoff odds 60% → 63%"]);
    // "Only the champion", "Making the playoffs", a split paying neither 2nd nor 3rd, or no reward: the two lines as before.
    for (const reward of [TITLE, { ...TITLE, goal: "playoffs" as const }, WEEKLY, null, undefined]) expect(oddsViews(traded(), before, reward).map((o) => o.label)).toEqual(["Title odds", "Playoff odds"]);
    expect(topPlacesOf(PARKER)).toBe(3);
    expect(topPlacesOf(TOP2)).toBe(2);
    expect([TITLE, WEEKLY, null].map(topPlacesOf)).toEqual([null, null, null]);
    // A split that pays 3rd but not 2nd still reads the top 3 (P(1st) + P(2nd) + P(3rd)).
    expect(topPlacesOf({ goal: "prizes", shares: shares({ first: 0.9, third: 0.1 }) })).toBe(3);
    expect(topOddsLabel(3)).toBe("Top 3 odds");
  });

  it("never prints a partial sum: a part unknown leaves the line out; without my odds before, it prints its change alone; kept within 0–100%", () => {
    // A change unknown (3rd place's odds couldn't be known), or a part of the odds before.
    expect(oddsViews(traded({ dPrizes: { ...dPrizes, third: null } }), before, PARKER).map((o) => o.label)).toEqual(["Title odds", "Playoff odds"]);
    expect(oddsViews(traded(), { ...before, prizes: { ...before.prizes, third: null } }, PARKER).map((o) => o.label)).toEqual(["Title odds", "Playoff odds"]);
    // An evaluation without prize changes (made before them, or a fake): no line.
    expect(oddsViews({ dPO: 0.03, dCH: 0.007 }, before, PARKER).map((o) => o.label)).toEqual(["Title odds", "Playoff odds"]);
    // No odds before (the Analyzer without them), or before without prizes: the change in percentage points, as the others.
    expect(oddsViews(traded(), null, PARKER).map((o) => o.value)).toEqual(["+0.7 percentage points", "+2 percentage points", "+3 percentage points"]);
    expect(oddsViews(traded(), { pPlayoffs: 0.6, pTitle: 0.105 }, PARKER)[1]?.value).toBe("+2 percentage points");
    // Whole percents with the playoff odds' edges, never past 100%.
    const edge = { ...before, prizes: { ...before.prizes, first: 0.6, second: 0.3, third: 0.099 } };
    expect(oddsViews(traded({ dPrizes: { ...dPrizes, first: 0.01, second: 0.01, third: 0.01 } }), edge, PARKER)[1]?.value).toBe(">99% → 100%");
    expect(topChance({ first: 0.1, second: 0.2, third: null }, 2)).toBeCloseTo(0.3, 12);
    expect(topChance({ first: 0.1, second: 0.2, third: null }, 3)).toBeNull();
    expect(topChance(null, 3)).toBeNull();
  });

  it("shows the same line on a Plan B box, the Trade Finder's cards and the Analyzer's card, from the search's or the evaluation's own reward", () => {
    const planB = { ...planBFixture({ give: ["106"], get: ["202"], b: 4, pComplete: 0.45 }), dPO: 0.04, dCH: 0.013, dPrizes: { first: 0.013, second: 0.01, third: 0.007, weeklyHigh: null, pointsLeader: 0 } };
    const box = planBView(planB, snapshot, { baseline: before, reward: PARKER });
    expect(box?.odds.map((o) => `${o.label} ${o.value}`)).toEqual(["Title odds 10.5% → 11.8%", "Top 3 odds 30% → 33%", "Playoff odds 60% → 64%"]);
    expect(box?.text).toContain(" · Title odds 10.5% → 11.8% · Top 3 odds 30% → 33% · Playoff odds 60% → 64%");
    // The Finder hands every card (and its Plan B) the search's reward and baseline.
    const result = searchResult([traded({ planB })], { baseline: { ...before, expWins: 8 }, reward: PARKER });
    const finder = buildFinderView({ result, sort: "overall", snapshot, partnerId: null });
    expect(finder.cards[0]?.odds.map((o) => o.label)).toEqual(["Title odds", "Top 3 odds", "Playoff odds"]);
    expect(finder.cards[0]?.planB?.odds.map((o) => o.label)).toEqual(["Title odds", "Top 3 odds", "Playoff odds"]);
    // Under "Only the champion" (the search's own reward) the cards keep their two lines.
    expect(buildFinderView({ result: { ...result, reward: TITLE }, sort: "overall", snapshot, partnerId: null }).cards[0]?.odds.map((o) => o.label)).toEqual(["Title odds", "Playoff odds"]);
    // The Analyzer: its evaluation's reward, and the baseline the worker sends with it.
    const analysis = buildAnalysisView({ evaluation: traded(), illegal: null, notes: [], reward: PARKER, baseline: before }, snapshot);
    expect(analysis.card?.odds.map((o) => `${o.label} ${o.value}`)).toEqual(["Title odds 10.5% → 11.2%", "Top 3 odds 30% → 32%", "Playoff odds 60% → 63%"]);
    expect(analysis.baseline).toBe("Your odds before this trade: 60% to make the playoffs, 30% to finish in the top 3, 10.5% to win the title.");
  });

  it("says my top-N chance with my odds before any trade, between the playoffs and the title, only when every part is known (⚠️ ours)", () => {
    expect(baselineLines(before, "finder", PARKER)?.text).toBe("Your odds before any trade: 60% to make the playoffs, 30% to finish in the top 3, 10.5% to win the title.");
    expect(baselineLines(before, "finder", TOP2)?.text).toBe("Your odds before any trade: 60% to make the playoffs, 20% to finish in the top 2, 10.5% to win the title.");
    for (const reward of [TITLE, WEEKLY, undefined]) expect(baselineLines(before, "finder", reward)?.text).toBe("Your odds before any trade: 60% to make the playoffs, 10.5% to win the title.");
    expect(baselineLines({ ...before, prizes: { ...before.prizes, third: null } }, "finder", PARKER)?.text).not.toContain("top 3");
    expect(baselineLines({ pPlayoffs: 0.6, pTitle: 0.105 }, "analyzer", PARKER)?.text).toBe("Your odds before this trade: 60% to make the playoffs, 10.5% to win the title.");
  });

  it("names the league's prizes in what Helps you sums up under “Several prizes” paying more than 1st place (the lead's words), with today's endings", () => {
    const prizes = "Helps you (0–100) sums up how much your chances at your league's prizes and your playoff odds rise";
    expect(helpsInfoText("redraft", true, true, null, PARKER)).toBe(`${prizes}, minus a cost for giving away trade value or plus a credit for gaining it. ${HELPS_SCALE_TEXT}`);
    expect(helpsInfoText("redraft", false, true, null, WEEKLY)).toBe(`${prizes}. ${HELPS_SCALE_TEXT}`);
    expect(helpsInfoText("dynasty", true, true, null, TOP2)).toBe(`${prizes}, weighed against the change in your roster's long-term value. ${helpsScaleText(null, { leagueType: "dynasty" })}`);
    expect(helpsInfoText("keeper", true, false, null, PARKER)).toBe(`${prizes}. ${HELPS_SCALE_TEXT}`);
    // "Only the champion", "Making the playoffs", and "Several prizes" paying 1st place alone or with nothing entered (B
    // weighs the title then): the title's words.
    const title = helpsInfoText("redraft");
    for (const reward of [TITLE, { ...TITLE, goal: "playoffs" as const }, { ...PARKER, shares: TITLE_ONLY }, { ...PARKER, shares: TITLE_ONLY, empty: true }]) expect(helpsInfoText("redraft", true, true, null, reward)).toBe(title);
    // Without a reward, the scale's own word (How to read gets the scale alone from its page).
    expect(namesPrizes(null, { oddsNamed: "prizes" })).toBe(true);
    expect([namesPrizes(null, { oddsNamed: "title" }), namesPrizes(null, { oddsNamed: "playoff" }), namesPrizes(null, null), namesPrizes()]).toEqual([false, false, false, false]);
    // A reward wins over the scale.
    expect(namesPrizes(TITLE, { oddsNamed: "prizes" })).toBe(false);
    expect(weighedOddsWords(PARKER)).toBe("your chances at your league's prizes and your playoff odds");
    expect(weighedOddsWords(TITLE)).toBe("your title and playoff odds");
    // How to read's "Each card shows …" (review of the prizes UI, prizes-ui-6): the card's own lines after the prizes' words.
    expect([PARKER, TOP2, WEEKLY, TITLE].map((r) => cardOddsWords(r))).toEqual(["your title, top-3 and playoff odds", "your title, top-2 and playoff odds", "your title and playoff odds", "those odds"]);
    expect(cardOddsWords(null, { oddsNamed: "prizes" })).toBe("your title and playoff odds (and your top-3 odds when your league pays 3rd place, or your top-2 odds when it pays 2nd)");
    expect([cardOddsWords(null, { oddsNamed: "playoff" }), cardOddsWords()]).toEqual(["those odds", "those odds"]);
    // The Finder and the Analyzer read the search's or the evaluation's own reward.
    expect(buildFinderView({ result: searchResult([traded()], { reward: PARKER }), sort: "overall", snapshot, partnerId: null }).helpsInfo?.startsWith(prizes)).toBe(true);
    expect(buildAnalysisView({ evaluation: traded(), illegal: null, notes: [], reward: PARKER }, snapshot).helpsInfo?.startsWith(prizes)).toBe(true);
    // The views carry the reward for How to read (HowToRead's `reward`: review of the prizes UI, prizes-ui-7), null without one.
    expect(buildFinderView({ result: searchResult([traded()], { reward: PARKER }), sort: "overall", snapshot, partnerId: null }).reward).toBe(PARKER);
    expect(buildAnalysisView({ evaluation: traded(), illegal: null, notes: [], reward: PARKER }, snapshot).reward).toBe(PARKER);
    expect([buildFinderView({ result: searchResult([traded()]), sort: "overall", snapshot, partnerId: null }).reward, buildAnalysisView({ evaluation: traded(), illegal: null, notes: [] }, snapshot).reward]).toEqual([null, null]);
    expect(buildAnalysisView({ evaluation: traded(), illegal: null, notes: [], reward: TITLE }, snapshot).helpsInfo).toBe(title);
  });
});

describe("Checkpoint 7c: “Helps both” and “Helps them” (planner reply to Checkpoint 7b, §7)", () => {
  const shares = (o: Partial<Reward["shares"]>): Reward["shares"] => ({ first: 0, second: 0, third: 0, weeklyHigh: 0, pointsLeader: 0, ...o });
  const PARKER: Reward = { goal: "prizes", shares: shares({ first: 4 / 9, second: 16 / 45, third: 1 / 5 }), periods: 14, empty: false };
  /**
   * The partner's numbers (TradeEvaluation.them; the fixtures don't set them): Helps them `helps`, their title odds 6.0% → 6.9%
   * and playoff odds 41% → 45% (the planner's example), their top 3 33% → 36%.
   */
  const them = (helps: number | null, over: Partial<PartnerNumbers> = {}): PartnerNumbers => ({
    b: helps === null ? null : helps / 10,
    bWin: helps === null ? null : helps / 10,
    bFuture: null,
    lambda: null,
    b3: helps === null ? null : 4,
    helps,
    dPO: 0.04,
    dCH: 0.009,
    dPrizes: { first: 0.009, second: 0.011, third: 0.01, weeklyHigh: null, pointsLeader: 0 },
    before: { pPlayoffs: 0.41, pTitle: 0.06, prizes: { first: 0.06, second: 0.12, third: 0.15, weeklyHigh: 0, pointsLeader: 0.05 } },
    ...over,
  });
  const withThem = (e: TradeEvaluation, helps: number | null, over: Partial<PartnerNumbers> = {}): TradeEvaluation => ({ ...e, them: them(helps, over) });
  const MIN = config.benefit.helpsThemMin;

  it("offers “Helps both” as the fourth sort, with the planner's helper line under it alone", () => {
    expect(SORT_OPTIONS.map((o) => `${o.value}:${o.label}`)).toEqual(["overall:Overall", "helps:Helps you", "accept:Chance they accept", "helpsBoth:Helps both"]);
    expect(isTradeSort("helpsBoth")).toBe(true);
    expect(sortNote("helpsBoth")).toBe("Trades that help them too, sorted by how much they help you.");
    expect(HELPS_BOTH_SORT_NOTE).toBe("Trades that help them too, sorted by how much they help you.");
    expect((["overall", "helps", "accept"] as const).map(sortNote)).toEqual([null, null, null]);
  });

  it("shows the partner's line after mine: Helps them as printed with the planner's tooltip, then their odds in the format of mine", () => {
    const c = buildTradeCard(withThem(evaluation(), 24), { snapshot, baseline: { pPlayoffs: 0.65, pTitle: 0.121 } });
    expect(c.them).toEqual({
      label: "Helps them",
      helps: { value: "24", srText: null, title: HELPS_THEM_TITLE },
      odds: [
        { label: "Their title odds", value: "6.0% → 6.9%", srValue: "from 6.0% to 6.9%" },
        { label: "Their playoff odds", value: "41% → 45%", srValue: "from 41% to 45%" },
      ],
      text: "Helps them 24 · Their title odds 6.0% → 6.9% · Their playoff odds 41% → 45%",
    });
    expect(HELPS_THEM_TITLE).toBe("Helps them uses the same scale as Helps you, from their side. Both teams can gain when each fills the other's weak spot. Helps you already counts the cost of making them stronger.");
    // "Helps them 0" when the trade costs them (B_P ≤ 0).
    expect(buildTradeCard(withThem(evaluation(), 0), { snapshot }).them?.text).toBe("Helps them 0 · Their title odds 6.0% → 6.9% · Their playoff odds 41% → 45%");
    // Their title odds unknown (the league's title odds unknown): said as mine are.
    expect(buildTradeCard(withThem(evaluation(), 24, { dCH: null }), { snapshot }).them?.text).toBe("Helps them 24 · Their title odds unknown · Their playoff odds 41% → 45%");
    // No line without the partner's numbers, or without a Helps them (their scale unknown).
    expect(buildTradeCard(evaluation(), { snapshot }).them).toBeNull();
    expect(buildTradeCard(withThem(evaluation(), null), { snapshot }).them).toBeNull();
    expect(themView({ them: undefined })).toBeNull();
  });

  it("says which way their long-term value goes after “Their lineup” in a dynasty or keeper league, in words only, so a high Helps them next to falling odds explains itself (review of the “Helps both” UI, helps-both-ui-1)", () => {
    const scale = config.benefit.bFutureScale; // B_future,P = scale × ΔDyn_P ÷ their roster's long-term value
    const dynasty = { ...snapshot, settings: { ...snapshot.settings, leagueType: "dynasty" as const } };
    const theirs = (bFuture: number | null, helps: number | null = 15) => buildTradeCard(withThem(evaluation(), helps, { bFuture, lambda: bFuture === null ? null : 0.5 }), { snapshot: dynasty });
    const facts = (c: ReturnType<typeof theirs>) => c.facts.map((f) => `${f.label}: ${f.value}`);
    // The scratch run's card (smallLeague 12, dynasty): Helps them 15 while their title and playoff odds fall, their long-term value up.
    const up = theirs(0.06 * scale);
    expect(up.them?.text).toBe("Helps them 15 · Their title odds 6.0% → 6.9% · Their playoff odds 41% → 45%");
    expect(facts(up)).toEqual(["Your lineup: +2 pts a week in the regular season, +2 in the playoffs", "Their lineup: 0 pts a week", "Their long-term value: Up"]);
    // My fact's rule (config.explain.longTermMin, a whole percent other than 0): down, and about the same under the cut.
    expect(theirLongTermFact(withThem(evaluation(), 15, { bFuture: -0.04 * scale }))).toEqual({ label: "Their long-term value", value: "Down" });
    for (const share of [0.004, -0.004, 0]) expect(theirLongTermFact(withThem(evaluation(), 15, { bFuture: share * scale }))?.value, String(share)).toBe("About the same");
    // Beside mine, in the order of the lineups: mine, then theirs.
    const both = buildTradeCard({ ...withThem(evaluation({ dDyn: -300, bFuture: -0.04 * scale, lambda: 0.5 }), 15, { bFuture: 0.06 * scale }) }, { snapshot: dynasty });
    expect(both.facts.map((f) => f.label)).toEqual(["Your lineup", "Long-term value", "Their lineup", "Their long-term value"]);
    expect(fact(both, "Long-term value")).toBe("Down for your roster");
    // None in a redraft league or without long-term values (bFuture null), none without their line (no Helps them), none
    // without the partner's numbers; never a number.
    expect(fact(theirs(null), "Their long-term value")).toBeUndefined();
    expect(fact(theirs(0.06 * scale, null), "Their long-term value")).toBeUndefined();
    expect(fact(buildTradeCard(evaluation(), { snapshot: dynasty }), "Their long-term value")).toBeUndefined();
    expect(theirLongTermFact({ them: undefined })).toBeNull();
    expect(fact(up, "Their long-term value")).not.toMatch(/\d/);
  });

  it("adds their top-N line between their title and playoff odds when the league pays 2nd or 3rd place, as mine, never a partial sum", () => {
    const e = { ...withThem(evaluation({ dCH: 0.007, dPO: 0.03 }), 24), dPrizes: { first: 0.007, second: 0.006, third: 0.007, weeklyHigh: null, pointsLeader: 0 } };
    const c = buildTradeCard(e, { snapshot, baseline: { pPlayoffs: 0.6, pTitle: 0.105, prizes: { first: 0.105, second: 0.09, third: 0.105, weeklyHigh: 0, pointsLeader: 0 } }, reward: PARKER });
    expect(c.odds.map((o) => o.label)).toEqual(["Title odds", "Top 3 odds", "Playoff odds"]);
    expect(c.them?.text).toBe("Helps them 24 · Their title odds 6.0% → 6.9% · Their top 3 odds 33% → 36% · Their playoff odds 41% → 45%");
    expect(theirOddsViews(them(24), { goal: "prizes", shares: shares({ first: 0.6, second: 0.4 }) }).map((o) => `${o.label} ${o.value}`)).toEqual([
      "Their title odds 6.0% → 6.9%",
      "Their top 2 odds 18% → 20%",
      "Their playoff odds 41% → 45%",
    ]);
    // A part unknown: no line rather than a partial sum; "Only the champion": the two lines.
    expect(theirOddsViews(them(24, { dPrizes: { first: 0.009, second: 0.011, third: null, weeklyHigh: null, pointsLeader: 0 } }), PARKER).map((o) => o.label)).toEqual(["Their title odds", "Their playoff odds"]);
    expect(theirOddsViews(them(24), { goal: "title", shares: TITLE_ONLY }).map((o) => o.label)).toEqual(["Their title odds", "Their playoff odds"]);
    expect(theirOddsViews(them(24)).map((o) => o.label)).toEqual(["Their title odds", "Their playoff odds"]);
  });

  it("tags a card “Helps both” exactly when it helps me (as printed) and Helps them is at least helpsThemMin, in every sort and on the Analyzer's card", () => {
    expect(buildTradeCard(withThem(evaluation(), MIN), { snapshot }).helpsBothTag).toEqual({ text: "Helps both", title: `Helps both: this trade helps you, and it helps them too (Helps them ${MIN}).` });
    expect(HELPS_BOTH_TAG).toBe("Helps both");
    for (const e of [withThem(evaluation(), MIN - 1), withThem(evaluation(), 0), withThem(evaluation({ b: -0.5 }), 40), withThem(evaluation(), null), evaluation()]) expect(buildTradeCard(e, { snapshot }).helpsBothTag).toBeNull();
    // In every sort: the Overall list's card that helps both is tagged wherever it shows.
    const tagged = withThem(evaluation({ key: "t", b: 2 }), 30);
    const plain = withThem(evaluation({ key: "p", b: 6, give: ["105"] }), 0);
    const result = searchResult([tagged, plain], { helpsBoth: { trades: [tagged], qualifying: 1, byChance: 0, lowerWouldAdd: false, dropped: { partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 } } });
    for (const sort of ["overall", "helps", "accept", "helpsBoth"] as const) {
      const tags = Object.fromEntries(buildFinderView({ result, sort, snapshot, partnerId: null }).cards.map((c) => [c.key, c.helpsBothTag?.text ?? null]));
      expect(tags.t, sort).toBe("Helps both");
      if (sort !== "helpsBoth") expect(tags.p, sort).toBeNull();
    }
    // The Analyzer's card, and its partner's line.
    const analysis = buildAnalysisView({ evaluation: tagged, illegal: null, notes: [] }, snapshot);
    expect(analysis.card?.helpsBothTag?.text).toBe("Helps both");
    expect(analysis.card?.them?.text).toBe("Helps them 30 · Their title odds 6.0% → 6.9% · Their playoff odds 41% → 45%");
    // helpsBothTagOf reads the engine's rule (benefit.ts helpsBoth).
    expect(helpsBothTagOf({ tradeScore: MIN, them: them(MIN) })?.text).toBe("Helps both");
    // Checkpoint 7d (planner reply to Checkpoint 7c, answer 5): Helps you needs the same bar as Helps them.
    expect(helpsBothTagOf({ tradeScore: MIN - 1, them: them(MIN) })).toBeNull();
    expect(helpsBothTagOf({ tradeScore: 0, them: them(MIN) })).toBeNull();
  });

  it("“Helps both” shows the engine's own list as it is, never re-sorted or widened, with its count, status, few line and hidden line, and no pattern note", () => {
    // The engine's list: two trades in its order (its caps applied); a third trade that helps both, on the Overall list only, stays off.
    const x = withThem(evaluation({ key: "x", b: 6 }), 30);
    const y = withThem(evaluation({ key: "y", b: 3, give: ["105"] }), 12);
    const z = withThem(evaluation({ key: "z", b: 9, give: ["104"] }), 20);
    const list = { trades: [x, y], qualifying: 3, byChance: 2, lowerWouldAdd: true, dropped: { partnerCap: 0, core: 1, filler: 0, givenPlayer: 0 } };
    const pattern = { playerId: "106", count: 7, of: 10, drivers: ["byeCover" as const], text: "Most of your best ideas trade Wiggleton Spoons: his bye is in week 13, your riskiest week." };
    const result = searchResult([z, x], { helpsBoth: list, pattern, hidden: { byBenefit: 4, byMarket: 1, byChance: 7 }, filter: { minChance: 0.3, qualifying: 2, few: false } });
    const view = buildFinderView({ result, sort: "helpsBoth", snapshot, partnerId: null });
    expect(view.cards.map((c) => c.key)).toEqual(["x", "y"]);
    expect(view.countText).toBe("2 trade ideas that help both teams, sorted by Helps you.");
    expect(view.statusText).toBe("Found 2 trade ideas that help both teams.");
    expect(view.few).toBe("Only 2 trades help both teams right now. Try a lower minimum chance to see more.");
    expect(view.pattern).toBeNull();
    // The guards' counts, and the trades that help both under the minimum (not the Overall list's 7).
    expect(view.hidden).toBe(
      "Left out on purpose: 4 trade ideas that wouldn't help you, 1 trade idea where, counting roster spots, you'd give up much more trade value than you get and 2 trade ideas below your minimum chance.",
    );
    // The Overall sort is the Overall list as before, its pattern note and hidden line its own.
    const overall = buildFinderView({ result, sort: "overall", snapshot, partnerId: null });
    expect(overall.cards.map((c) => c.key)).toEqual(["z", "x"]);
    expect(overall.pattern).toBe(pattern.text);
    expect(overall.hidden).toContain("7 trade ideas below your minimum chance");
    // Five or more: no few line; without a lower setting that adds any: the planner's line alone.
    const five = [0, 1, 2, 3, 4].map((i) => withThem(evaluation({ key: `k${i}`, b: 5 - i, give: [`10${i + 1}`] }), 20));
    expect(buildFinderView({ result: searchResult(five, { helpsBoth: { ...list, trades: five, lowerWouldAdd: false } }), sort: "helpsBoth", snapshot, partnerId: null }).few).toBeNull();
    expect(buildFinderView({ result: searchResult([x], { helpsBoth: { ...list, trades: [x], lowerWouldAdd: false } }), sort: "helpsBoth", snapshot, partnerId: null }).few).toBe("Only 1 trade helps both teams right now.");
    expect([helpsBothFewText(4, false), helpsBothFewText(1, true), helpsBothFewText(0, true), helpsBothFewText(config.ranking.minChanceFew, true)]).toEqual([
      "Only 4 trades help both teams right now.",
      "Only 1 trade helps both teams right now. Try a lower minimum chance to see more.",
      null,
      null,
    ]);
  });

  it("falls back on the list's trades that help both when the result has no “Helps both” list (a fake), by Helps you", () => {
    const x = withThem(evaluation({ key: "x", b: 3 }), 30);
    const y = withThem(evaluation({ key: "y", b: 6, give: ["105"] }), 12);
    const n = withThem(evaluation({ key: "n", b: 9, give: ["104"] }), 4);
    const view = buildFinderView({ result: searchResult([x, n, y]), sort: "helpsBoth", snapshot, partnerId: null });
    expect(view.cards.map((c) => c.key)).toEqual(["y", "x"]);
    expect(view.few).toBe("Only 2 trades help both teams right now.");
  });

  it("says when no trade helps both teams: the lower minimum when it would show some, the Overall sort when it has ideas, what was left out", () => {
    const mine = withThem(evaluation({ key: "m" }), 0);
    const list = { trades: [], qualifying: 0, byChance: 1, lowerWouldAdd: true, dropped: { partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 } };
    const view = buildFinderView({ result: searchResult([mine], { helpsBoth: list, filter: { minChance: 0.3, qualifying: 1, few: false } }), sort: "helpsBoth", snapshot, partnerId: null });
    expect(view.empty).toEqual({
      title: "No trades help both teams right now",
      text: ["Try a lower minimum chance to see more.", "Sort by Overall to see the trade ideas that help you.", "Left out on purpose: 1 trade idea below your minimum chance."],
    });
    expect(view.statusText).toBe("No trades help both teams right now.");
    expect([view.hidden, view.few, view.countText, view.helpsInfo]).toEqual([null, null, "", null]);
    // Nothing helps me either: the title alone, with what was left out.
    const none = buildFinderView({ result: searchResult([], { helpsBoth: { ...list, byChance: 0, lowerWouldAdd: false }, hidden: { byBenefit: 3, byMarket: 0 } }), sort: "helpsBoth", snapshot, partnerId: null });
    expect(none.empty).toEqual({ title: "No trades help both teams right now", text: ["Left out on purpose: 3 trade ideas that wouldn't help you."] });
    // A search that stopped before screening: its notes say why, as in every sort.
    const stopped = buildFinderView({ result: searchResult([], { notes: ["Your league's trade deadline has passed."], counts: { screened: 0, exact: 0, simScreen: 0, simFinal: 0 } }), sort: "helpsBoth", snapshot, partnerId: null });
    expect(stopped.empty).toEqual({ title: "No trade ideas right now", text: ["Your league's trade deadline has passed."] });
  });

  it("reads the notes, a Plan B's tags and missing long-term values off both lists, so every sort says the same", () => {
    const UNDER_WAY = "Week 4 is under way: its games are projected as if none had started.";
    const KEEPER = "Keeper costs aren't modeled.";
    const tag: InjuryTag = { playerId: "203", side: "get", status: "OUT", returnWeek: 6 };
    // A card only the "Helps both" list shows carries a note and a tag the Overall list's cards don't.
    const onlyBoth = { ...withThem(evaluation({ key: "b", detail: { notes: [KEEPER] } }), 20), flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: [], tagged: [tag] } };
    const planB = { ...planBFixture({ partnerId: "2", give: ["105"], get: ["203"] }), key: "2|give:105|get:203" };
    const overall = withThem(evaluation({ key: "o", planB, detail: { notes: [UNDER_WAY] } }), 0);
    const result = searchResult([overall], { helpsBoth: { trades: [onlyBoth], qualifying: 1, byChance: 0, lowerWouldAdd: false, dropped: { partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 } } });
    for (const sort of ["overall", "helpsBoth"] as const) expect(buildFinderView({ result, sort, snapshot, partnerId: null }).notes, sort).toEqual([UNDER_WAY, KEEPER]);
    // The Overall card's Plan B names its player with the tag the other list's card carries (he's Out until week 6).
    expect(buildFinderView({ result, sort: "overall", snapshot, partnerId: null }).cards[0]?.planB?.get).toBe("Ignatius Fumblewick (Out — expected back week 6)");
    // A card of the other list whose long-term values are missing: Helps you counts this season only, in every sort.
    const keeper = { ...snapshot, settings: { ...snapshot.settings, leagueType: "keeper" as const } };
    const missing = searchResult([overall], { helpsBoth: { trades: [{ ...onlyBoth, dynMissing: true, lambda: 0.2 }], qualifying: 1, byChance: 0, lowerWouldAdd: false, dropped: { partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 } } });
    for (const sort of ["overall", "helpsBoth"] as const) expect(buildFinderView({ result: missing, sort, snapshot: keeper, partnerId: null }).helpsInfo, sort).toBe(helpsInfoText("keeper", true, false));
  });

  it("on the engine's own search (a synthetic league): the sort shows its list as ranked, every card tagged with the partner's line, Helps you never going up; on the Overall list exactly the cards that help both are tagged", { timeout: 120_000 }, () => {
    const league = smallLeague(8);
    const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
    const result = runTradeSearch(ctx, { settings: defaultTradeSettings() });
    const list = result.helpsBoth?.trades ?? [];
    // A fact of the synthetic data (seed 8): its list isn't empty, and its Overall list has trades that help only me.
    expect(list.length).toBeGreaterThan(0);
    const view = buildFinderView({ result, sort: "helpsBoth", snapshot: league.snapshot, partnerId: null });
    expect(view.cards.map((c) => c.key)).toEqual(list.map((t) => t.key));
    for (const c of view.cards) {
      expect(c.helpsBothTag?.text, c.key).toBe(HELPS_BOTH_TAG);
      expect(c.them?.text, c.key).toMatch(/^Helps them \d+ · Their title odds .+ · Their playoff odds .+ → .+$/);
      expect(Number(c.them?.helps.value), c.key).toBeGreaterThanOrEqual(MIN);
    }
    const helps = view.cards.map((c) => Number(c.numbers.helps.value));
    expect(helps).toEqual([...helps].sort((a, b) => b - a));
    const overall = buildFinderView({ result, sort: "overall", snapshot: league.snapshot, partnerId: null });
    expect(overall.cards.some((c) => !helpsBoth(c.evaluation))).toBe(true);
    for (const c of overall.cards) {
      expect(c.helpsBothTag !== null, c.key).toBe(helpsBoth(c.evaluation));
      // Checkpoint 7d (planner reply to Checkpoint 7c, answer 3): a Finder card shows the partner's line exactly when it's
      // tagged; every simulated card has the partner's numbers, which the Analyzer's card shows whatever they are.
      expect(c.them !== null, c.key).toBe(c.helpsBothTag !== null);
      expect(c.evaluation.them?.helps, c.key).toEqual(expect.any(Number));
      expect(buildAnalysisView({ evaluation: c.evaluation, illegal: null, notes: [] }, league.snapshot).card?.them, c.key).not.toBeNull();
    }
  });

  it("uses no jargon in the new words", () => {
    const c = buildTradeCard(withThem(evaluation(), 24), { snapshot, reward: PARKER });
    const theirLongTerm = theirLongTermFact(withThem(evaluation(), 24, { bFuture: 2.4, lambda: 0.5 }));
    const words = [c.them?.text ?? "", c.helpsBothTag?.title ?? "", HELPS_THEM_TITLE, HELPS_BOTH_SORT_NOTE, HELPS_BOTH_EMPTY_TITLE, helpsBothFewText(2, true) ?? "", `${theirLongTerm?.label}: ${theirLongTerm?.value}`].join(" ");
    for (const jargon of [" EV ", "σ", "V*", "g_mkt", "B_P", "B₃", "NaN", "undefined", "null", "λ"]) expect(words).not.toContain(jargon);
  });
});

describe("Checkpoint 7d: the partner's line on a Trade Finder card only when it helps both; the Analyzer's always (planner reply to Checkpoint 7c, answer 3)", () => {
  const them = (helps: number | null, over: Partial<PartnerNumbers> = {}): PartnerNumbers => ({
    b: helps === null ? null : helps / 10,
    bWin: helps === null ? null : helps / 10,
    bFuture: null,
    lambda: null,
    b3: helps === null ? null : 4,
    helps,
    dPO: 0.04,
    dCH: 0.009,
    dPrizes: titleDeltas(0.009),
    before: { pPlayoffs: 0.41, pTitle: 0.06, prizes: { first: 0.06, second: null, third: null, weeklyHigh: 0, pointsLeader: 0 } },
    ...over,
  });
  const withThem = (e: TradeEvaluation, helps: number | null, over: Partial<PartnerNumbers> = {}): TradeEvaluation => ({ ...e, them: them(helps, over) });
  const MIN = config.benefit.helpsThemMin;

  it("a Finder card that helps both shows its tag and the partner's line; one that doesn't, neither, in every sort", () => {
    const tagged = withThem(evaluation({ key: "t", b: 6 }), 30);
    const short = withThem(evaluation({ key: "s", b: 5, give: ["105"] }), MIN - 1);
    const costs = withThem(evaluation({ key: "c", b: 4, give: ["104"] }), 0);
    // Helps them 40 on a card that barely helps me (Helps you under the bar, planner reply to Checkpoint 7c, answer 5): no tag, no line.
    const barely = withThem(evaluation({ key: "b", b: 0.05, give: ["103"] }), 40);
    expect((barely.tradeScore ?? 0) < MIN).toBe(true);
    const result = searchResult([tagged, short, costs, barely], { helpsBoth: { trades: [tagged], qualifying: 1, byChance: 0, lowerWouldAdd: false, dropped: { partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 } } });
    for (const sort of SORT_OPTIONS.map((o) => o.value)) {
      const view = buildFinderView({ result, sort, snapshot, partnerId: null });
      for (const c of view.cards) {
        expect(c.them !== null, `${sort}: ${c.key}`).toBe(c.key === "t");
        expect(c.helpsBothTag !== null, `${sort}: ${c.key}`).toBe(c.key === "t");
      }
      expect(view.cards.find((c) => c.key === "t")?.them?.text, sort).toBe("Helps them 30 · Their title odds 6.0% → 6.9% · Their playoff odds 41% → 45%");
    }
  });

  it("the Analyzer's card shows the partner's line whatever it is, “Helps them 0” when the trade costs them", () => {
    for (const [e, text] of [
      [withThem(evaluation(), 0), "Helps them 0 · Their title odds 6.0% → 6.9% · Their playoff odds 41% → 45%"],
      [withThem(evaluation(), MIN - 1), `Helps them ${MIN - 1} · Their title odds 6.0% → 6.9% · Their playoff odds 41% → 45%`],
      [withThem(evaluation(), 30), "Helps them 30 · Their title odds 6.0% → 6.9% · Their playoff odds 41% → 45%"],
    ] as const) {
      expect(buildAnalysisView({ evaluation: e, illegal: null, notes: [] }, snapshot).card?.them?.text).toBe(text);
    }
    // Without the partner's numbers, or without a Helps them, still none.
    expect(buildAnalysisView({ evaluation: evaluation(), illegal: null, notes: [] }, snapshot).card?.them).toBeNull();
    expect(buildAnalysisView({ evaluation: withThem(evaluation(), null), illegal: null, notes: [] }, snapshot).card?.them).toBeNull();
    // buildTradeCard's own default is the Analyzer's (the line whenever it has numbers); the Finder's rule is asked for.
    expect(buildTradeCard(withThem(evaluation(), 0), { snapshot }).them).not.toBeNull();
    expect(buildTradeCard(withThem(evaluation(), 0), { snapshot, partnerLine: "helpsBoth" }).them).toBeNull();
    expect(buildTradeCard(withThem(evaluation(), 0), { snapshot, partnerLine: "always" }).them).not.toBeNull();
  });

  it("“Their long-term value” goes with the partner's line: on a dynasty Finder card that doesn't help both, neither shows", () => {
    const dynasty = { ...snapshot, settings: { ...snapshot.settings, leagueType: "dynasty" as const } };
    const scale = config.benefit.bFutureScale;
    const untagged = withThem(evaluation({ key: "u" }), 4, { bFuture: 0.06 * scale, lambda: 0.5 });
    const tagged = withThem(evaluation({ key: "t" }), 30, { bFuture: 0.06 * scale, lambda: 0.5 });
    const view = buildFinderView({ result: searchResult([untagged, tagged]), sort: "overall", snapshot: dynasty, partnerId: null });
    const byKey = (k: string) => view.cards.find((c) => c.key === k);
    expect(fact(byKey("u") as ReturnType<typeof card>, "Their long-term value")).toBeUndefined();
    expect(fact(byKey("t") as ReturnType<typeof card>, "Their long-term value")).toBe("Up");
    // The Analyzer's card shows both for the untagged trade.
    const analyzed = buildAnalysisView({ evaluation: untagged, illegal: null, notes: [] }, dynasty).card;
    expect(analyzed?.them?.text).toMatch(/^Helps them 4 · /);
    expect(fact(analyzed as ReturnType<typeof card>, "Their long-term value")).toBe("Up");
    // "Their lineup" stays on every card (Phase 4's fact).
    expect(fact(byKey("u") as ReturnType<typeof card>, "Their lineup")).toBeDefined();
  });

  it("never on a Plan B box or an offer of “How to offer it”, in either page", () => {
    const planB = planBFixture({ partnerId: "2", give: ["105"], get: ["203"] });
    const withBox = withThem(evaluation({ key: "p", planB }), 30);
    const view = buildFinderView({ result: searchResult([withBox]), sort: "overall", snapshot, partnerId: null });
    const box = view.cards[0]?.planB;
    expect(box).not.toBeNull();
    expect(JSON.stringify(box)).not.toContain("Helps them");
    // An offer of "How to offer it" (Checkpoint 7e) carries the partner's numbers in its evaluation, and says none of them.
    const analyzed = buildAnalysisView({ evaluation: { ...evaluation(), them: them(30) }, illegal: null, notes: [] }, snapshot).card;
    if (!analyzed) throw new Error("the Analyzer shows the card");
    const offered = buildLadderView(
      { cardKey: analyzed.key, steps: [{ kind: "open", evaluation: { ...evaluation({ get: ["202"], b: 4 }), them: them(30) }, message: "x" }, { kind: "suggested", evaluation: analyzed.evaluation, message: "y" }] },
      analyzed,
      { snapshot },
    );
    expect(offered.steps).toHaveLength(2);
    expect(JSON.stringify(offered)).not.toContain("Helps them");
  });
});

describe("Checkpoint 7d: what a card prints, for its feedback and the export (planner reply to Checkpoint 7c, answer 1)", () => {
  const withThem = (e: TradeEvaluation, helps: number): TradeEvaluation => ({
    ...e,
    them: { b: helps / 10, bWin: helps / 10, bFuture: null, lambda: null, b3: 4, helps, dPO: 0.04, dCH: 0.009, dPrizes: titleDeltas(0.009), before: { pPlayoffs: 0.41, pTitle: 0.06, prizes: { first: 0.06, second: 0.1, third: 0.12, weeklyHigh: 0, pointsLeader: 0 } } },
  });

  it("is the card's own words: its three numbers, the label, the chance it goes through, my odds and weekly lines, and the partner's line when it shows", () => {
    const e = withThem(evaluation({ pAccept: 0.4, pComplete: 0.2, dCH: 0.013, dPO: 0.04, detail: { vetoRisk: true, winChance: [{ week: 9, before: 0.68, after: 0.64 }] } }), 24);
    const c = buildTradeCard(e, { snapshot: tradeSnapshot({ tradeReview: "league_vote" }), baseline: { pPlayoffs: 0.65, pTitle: 0.121 } });
    expect(c.shown).toEqual({
      helps: c.numbers.helps.value,
      chance: "40%",
      label: e.acceptLabel,
      through: "about 20%",
      overall: c.numbers.overall.value,
      odds: ["Title odds 12.1% → 13.4%", "Playoff odds 65% → 69%"],
      weekly: "Win chance by week: Week 9: 68% → 64%",
      helpsThem: "24",
      theirOdds: ["Their title odds 6.0% → 6.9%", "Their playoff odds 41% → 45%"],
    });
    // On the Finder a card that doesn't help both shows no partner's line, so its feedback keeps none either.
    const finder = buildFinderView({ result: searchResult([withThem(evaluation({ key: "x" }), 4)]), sort: "overall", snapshot, partnerId: null });
    expect(finder.cards[0]?.shown).not.toHaveProperty("helpsThem");
    expect(finder.cards[0]?.shown).not.toHaveProperty("theirOdds");
    // The Analyzer's card for the same trade shows it, "4".
    expect(buildAnalysisView({ evaluation: withThem(evaluation({ key: "x" }), 4), illegal: null, notes: [] }, snapshot).card?.shown.helpsThem).toBe("4");
  });

  it("every card's printed words pass the record's check whole (feedbackStore.ts parseFeedbackShown): a veto, “<5%”, unscored, odds unknown or without a “before”, the top-3 line, the weekly line", () => {
    const PARKER: Reward = { goal: "prizes", shares: { first: 4 / 9, second: 16 / 45, third: 1 / 5, weeklyHigh: 0, pointsLeader: 0 }, periods: 14, empty: false };
    const cases: [string, ReturnType<typeof buildTradeCard>][] = [
      ["plain", buildTradeCard(evaluation(), { snapshot })],
      ["odds", buildTradeCard(evaluation({ dCH: 0.013, dPO: 0.04 }), { snapshot, baseline: { pPlayoffs: 0.65, pTitle: 0.121 } })],
      ["veto under 5%", buildTradeCard(evaluation({ pAccept: 0.08, pComplete: 0.04, detail: { vetoRisk: true } }), { snapshot: tradeSnapshot({ tradeReview: "league_vote" }) })],
      ["long shot", buildTradeCard(evaluation({ pAccept: 0.03, pComplete: 0.03 }), { snapshot })],
      ["not scored", buildTradeCard(evaluation({ b: null }), { snapshot })],
      ["doesn't help", buildTradeCard(evaluation({ b: -1 }), { snapshot })],
      ["odds unknown", buildTradeCard({ ...evaluation(), dCH: null, dPO: null }, { snapshot, baseline: { pPlayoffs: 0.65, pTitle: 0.121 } })],
      ["edges", buildTradeCard(evaluation({ dCH: 0.0003, dPO: 0.001 }), { snapshot, baseline: { pPlayoffs: 0.996, pTitle: 0.0001 } })],
      [
        "top 3",
        buildTradeCard(withThem({ ...evaluation({ dCH: 0.007, dPO: 0.03 }), dPrizes: { first: 0.007, second: 0.006, third: 0.007, weeklyHigh: null, pointsLeader: 0 } }, 24), {
          snapshot,
          baseline: { pPlayoffs: 0.6, pTitle: 0.105, prizes: { first: 0.105, second: 0.09, third: 0.105, weeklyHigh: 0, pointsLeader: 0 } },
          reward: PARKER,
        }),
      ],
      ["weekly", buildTradeCard(evaluation({ detail: { winChance: [3, 6, 9, 12, 13].map((week, i) => ({ week, before: 0.5, after: 0.5 + (i % 2 ? 0.05 : -0.06) })) } }), { snapshot })],
      ["Helps them 0", buildTradeCard(withThem(evaluation(), 0), { snapshot })],
    ];
    for (const [name, c] of cases) expect(parseFeedbackShown(c.shown), name).toEqual(c.shown);
    expect(cases.find(([n]) => n === "top 3")?.[1].shown.odds).toEqual(["Title odds 10.5% → 11.2%", "Top 3 odds 30% → 32%", "Playoff odds 60% → 63%"]);
    expect(cases.find(([n]) => n === "veto under 5%")?.[1].shown).toMatchObject({ chance: "10%", through: "under 5%" });
    expect(cases.find(([n]) => n === "long shot")?.[1].shown).toMatchObject({ chance: "<5%", label: "Long shot" });
    expect(cases.find(([n]) => n === "not scored")?.[1].shown).toMatchObject({ helps: "—", overall: "—" });
    expect(cases.find(([n]) => n === "odds unknown")?.[1].shown.odds).toEqual(["Title odds unknown", "Playoff odds unknown"]);
    expect(cases.find(([n]) => n === "plain")?.[1].shown.odds).toEqual(["Title odds +1 percentage point", "Playoff odds +3 percentage points"]);
  });

  it("goes with every press on the card (cardPress), which a new record keeps (its first press's)", () => {
    const c = buildTradeCard(evaluation(), { snapshot });
    const change = cardPress({ outcome: "sent" }, c);
    expect(change).toEqual({ outcome: "sent", shown: c.shown });
    const [record] = applyFeedback([], { leagueKey: "espn:1a2b3c4d", evaluation: c.evaluation, change, at: "2026-10-01T18:00:00.000Z" });
    expect(record?.shown).toEqual(c.shown);
    expect(cardPress({ report: { reason: "other" } }, c)).toEqual({ report: { reason: "other" }, shown: c.shown });
  });
});

describe("noticeWarnings: the Trade Finder's warnings box shows notices only (planner reply to Checkpoint 7a, §5.1)", () => {
  it("keeps plain-language notices once each, and leaves technical and player-level warnings to the Import Report and the League page", () => {
    const technical = "No projections for 12 free agents, so they aren't considered.";
    const player = "No projections for 2 rostered players: A. Player, B. Player.";
    const notice = "FantasyCalc's values couldn't be loaded.";
    expect(noticeWarnings([technical, notice, player, notice])).toEqual([notice]);
    expect(noticeWarnings([])).toEqual([]);
  });
});
