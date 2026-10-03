/**
 * The Trade Finder's and Trade Analyzer's view models (CLAUDE.md §10, §11, §13; Phase 4 wave 2 decision M13): every
 * card field in words, the sorts (through rank.ts), the empty states, the progress bar's words, the links between
 * the pages and what they carry back, the Analyzer's choices, and feedback state. A small made-up league; every
 * name is invented.
 */
import { describe, expect, it } from "vitest";
import { config } from "@/engine/config";
import { defaultTradeSettings } from "@/engine/settings";
import type { TradeAnalysis } from "@/engine/evaluate";
import { GLOOP_PREMIUM, SNOOT_PREMIUM, evaluation, searchResult, step, steppedFull, steppedOffer, tradeSnapshot } from "@/components/trades/testFixtures";
import { applyFeedback } from "./feedbackStore";
import {
  ANALYZER_MAX_PER_SIDE,
  HARDER_TO_GET_TAG,
  STAGE_LABEL,
  acceptText,
  analyzerChoices,
  analyzerHref,
  assetView,
  baselineLines,
  buildAnalysisView,
  buildFinderView,
  buildTradeCard,
  cardFeedback,
  draftKey,
  draftProposal,
  draftSummary,
  finderHref,
  harderToGetWho,
  listNote,
  percentText,
  perWeek,
  pointsChange,
  premiumReasons,
  progressView,
  readAnalyzerDraft,
  readFinderPartner,
  secondsText,
  settingsSummary,
  tradeWords,
} from "./tradeView";

const snapshot = tradeSnapshot();
const card = (o: Parameters<typeof evaluation>[0] = {}, baseline?: { pPlayoffs: number | null; pTitle: number | null }) => buildTradeCard(evaluation(o), { snapshot, baseline: baseline ?? null });
const fact = (c: ReturnType<typeof card>, label: string) => c.facts.find((f) => f.label === label)?.value;

/** Every word a card shows, for the no-jargon check. */
const allText = (c: ReturnType<typeof card>) =>
  [c.heading, ...c.give.map((a) => `${a.name} ${a.detail}`), ...c.get.map((a) => `${a.name} ${a.detail}`), c.numbers.acceptLabel, c.numbers.acceptNote ?? "", ...c.flags.map((f) => f.text), ...c.facts.map((f) => `${f.label} ${f.value}`), c.ros, ...c.required].join(" ");

describe("small words", () => {
  it("prints odds as whole percents, '<1%' and '>99%' only when they merely round there, and acceptance to the nearest 5%", () => {
    expect([0, 0.004, 0.62, 0.996, 1].map(percentText)).toEqual(["0%", "<1%", "62%", ">99%", "100%"]);
    expect([0.02, 0.4, 0.43, 0.612].map(acceptText)).toEqual(["5%", "40%", "45%", "60%"]);
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
    expect(c.give).toEqual([{ id: "106", name: "Wiggleton Spoons", detail: "WR · ATL", injury: null, tag: null }]);
    expect(c.get).toEqual([{ id: "204", name: "Cornelius Snoot", detail: "RB · HOU", injury: null, tag: null }]);
    const q = buildTradeCard(evaluation({ give: ["103"] }), { snapshot }).give[0];
    expect(q?.injury).toEqual({ short: "Q", long: "Questionable", tone: "warn" });
    expect(assetView({ kind: "player", id: "gone" }, snapshot).name).toBe("A player who's no longer in this league's data");
    expect(assetView({ kind: "pick", season: 2027, round: 1, originalTeamId: "3" }, snapshot)).toEqual({ id: "pick:2027:1:3", name: "2027 round 1 pick", detail: "Original owner: Quasar Quokkas", injury: null, tag: null });
  });

  it("shows the three numbers (§10): Helps you, the acceptance estimate with Est. and its label, and Overall", () => {
    // B 3, P_complete 0.4 (the fixture's defaults): 100 × (1 − e^(−3/6)) = 39; 100 × (1 − e^(−1.2/6)) = 18.
    expect(c.numbers).toEqual({ helps: { value: "39", srText: null }, accept: { value: "40%", srText: null }, acceptLabel: "Est. · Decent", acceptNote: null, overall: { value: "18", srText: null } });
  });

  it("shows the chance it goes through too when the league's review could veto it (§11)", () => {
    const vetoed = buildTradeCard(evaluation({ pAccept: 0.4, pComplete: 0.2, detail: { vetoRisk: true } }), { snapshot: tradeSnapshot({ tradeReview: "league_vote" }) });
    expect(vetoed.numbers.accept.value).toBe("40%");
    expect(vetoed.numbers.acceptNote).toBe("Counting a league veto vote, about 20% it goes through.");
    const commish = buildTradeCard(evaluation({ pAccept: 0.4, pComplete: 0.2, detail: { vetoRisk: true } }), { snapshot: tradeSnapshot({ tradeReview: "commissioner" }) });
    expect(commish.numbers.acceptNote).toBe("Counting the commissioner's review, about 20% it goes through.");
  });

  it("scores a trade that doesn't help 0, flags it, and shows a dash (with words for screen readers) when B is unknown", () => {
    const worse = card({ b: -1 });
    expect([worse.numbers.helps.value, worse.numbers.overall.value]).toEqual(["0", "0"]);
    expect(worse.flags.map((f) => f.kind)).toEqual(["noHelp"]);
    const unknown = card({ b: null, dPO: null, dCH: null });
    expect(unknown.numbers.helps).toEqual({ value: "—", srText: "not scored: the season couldn't be simulated" });
    expect(unknown.flags.map((f) => f.text)).toEqual(["Not scored: your playoff odds couldn't be worked out, so this trade has no Helps you or Overall number."]);
    expect([fact(unknown, "Playoff odds"), fact(unknown, "Title odds")]).toEqual(["Unknown", "Unknown"]);
  });

  it("says why a trade that doesn't help is left out by what pulled it down, never contradicting its own odds (review of Phase 4)", () => {
    const noHelp = (o: Parameters<typeof evaluation>[0]) => card(o).flags.find((f) => f.kind === "noHelp")?.text;
    // Redraft, my chances fall: they wouldn't rise.
    expect(noHelp({ b: -1, bWin: -1.2, gMine: 0.05 })).toBe("Doesn't help you: it wouldn't raise your chances this season, so trade ideas leave it out.");
    expect(noHelp({ b: 0, bWin: 0, gMine: 0 })).toBe("Doesn't help you: it wouldn't raise your chances this season, so trade ideas leave it out.");
    // Redraft, my chances rise but I'd give up more trade value (Parker's league: Team 4, B −0.11, B_win +1.08, odds +1.8 points).
    expect(noHelp({ b: -0.11, bWin: 1.08, gMine: -0.297, dPO: 0.0178, dCH: 0.007 })).toBe(
      "Doesn't help you overall: it raises your chances this season, but you'd give up more trade value than that's worth at your “Protect my trade value” setting, so trade ideas leave it out.",
    );
    // …and when the card's values don't show me giving more (the market term's waiver-credit floor, N10): only "overall".
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
    expect(card({ flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: ["107"] } }).flags).toEqual([{ kind: "injured", text: "Depends on an injured player: Humbert Fiddlesticks (injured reserve)" }]);
    expect(card({ gMine: -0.2 }).flags).toEqual([{ kind: "market", text: "Market check: you'd get 20% less trade value than you give." }]);
    expect(card({ gMine: -0.4 }).flags).toEqual([{ kind: "hiddenByMarket", text: "Market check: you'd get 40% less trade value than you give, so trade ideas leave it out." }]);
    expect(card().flags).toEqual([]);
  });

  it("says the numbers behind the score in words (§10 'always show'): lineup, odds in points (to what, with the baseline), values, their lineup", () => {
    expect(c.facts).toEqual([
      { label: "Your lineup", value: "+2 pts a week in the regular season, +2 in the playoffs" },
      { label: "Playoff odds", value: "+3 percentage points" },
      { label: "Title odds", value: "+1 percentage point" },
      { label: "Trade value", value: "You give 5,000, you get 5,000", kind: "values" },
      { label: "Their lineup", value: "0 pts a week" },
    ]);
    const withBaseline = card({ dPO: 0.041, dCH: 0.002, partnerDeltaLineup: -1.26 }, { pPlayoffs: 0.62, pTitle: 0.09 });
    expect(fact(withBaseline, "Playoff odds")).toBe("+4.1 percentage points (62% to 66%)");
    // The whole percent doesn't move: no end percents.
    expect(fact(withBaseline, "Title odds")).toBe("+0.2 percentage points");
    expect(fact(withBaseline, "Their lineup")).toBe("−1.3 pts a week");
    // An uneven trade says the side getting fewer players is credited for its roster spot (§9's waiver credit).
    expect(fact(card({ give: ["105", "106"] }), "Trade value")).toBe("You give 5,000, you get 5,000 (the side getting fewer players is credited for its open roster spot)");
  });

  it("adds long-term value in dynasty and keeper leagues, or says it's unknown when values didn't load", () => {
    expect(fact(card({ dDyn: 1234.4 }), "Long-term value")).toBe("+1,234 for your roster");
    expect(fact(card({ dDyn: -300 }), "Long-term value")).toBe("−300 for your roster");
    expect(fact(card({ dynMissing: true }), "Long-term value")).toBe("Unknown: long-term values didn't load");
    expect(fact(c, "Long-term value")).toBeUndefined();
  });

  it("gives ROS points received and given (§13's 'You get 142 ROS pts, give 118')", () => {
    expect(card({ ros: { received: 142.4, given: 117.6 } }).ros).toBe("You get 142 ROS pts, give 118");
  });

  it("says the roster moves the trade forces, for either side (§7)", () => {
    const forced = card({ required: { me: { drops: ["108"], adds: [] }, partner: { drops: [], adds: ["901", "902"] } } });
    expect(forced.required).toEqual([
      "You'd drop Tobias Thimble (TE, JAX) to stay within your roster limits.",
      "Gravel Gophers would pick up Floopy Freeman (RB, CAR) and Waverly Waiver (RB, NE) from free agents to fill their roster.",
    ]);
    expect(c.required).toEqual([]);
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

describe("'How to offer it' (planner addendum to Checkpoint 3, §4: offer first, then what to add if they say no)", () => {
  it("offers the trade without my throw-in first when the ranked trade includes him, then adds him back", () => {
    const c = buildTradeCard(steppedFull(), { snapshot });
    expect(c.give.map((a) => a.name)).toEqual(["Wiggleton Spoons", "Tobias Thimble"]);
    expect(c.steps).toEqual({
      heading: "How to offer it",
      items: [
        { lead: "Offer first:", what: "Wiggleton Spoons for Cornelius Snoot", est: "Est. 35%", through: null, acceptSr: "an estimated 35% chance they accept", text: "Offer first: Wiggleton Spoons for Cornelius Snoot · Est. 35%" },
        { lead: "If they say no, add", what: "Tobias Thimble", est: "Est. 55%", through: null, acceptSr: "an estimated 55% chance they accept", text: "If they say no, add Tobias Thimble · Est. 55%" },
      ],
    });
    // The card's numbers stay the ranked (full) trade's.
    expect(c.numbers.accept.value).toBe("55%");
  });

  it("offers the ranked trade first when it has no throw-in, then the one that raises the chance they accept", () => {
    const c = buildTradeCard(steppedOffer(), { snapshot });
    expect(c.steps?.items.map((s) => s.text)).toEqual(["Offer first: Wiggleton Spoons for Cornelius Snoot · Est. 35%", "If they say no, add Tobias Thimble · Est. 55%"]);
    expect(c.numbers.accept.value).toBe("35%");
  });

  it("adds the chance it goes through when the league's review could veto a version, as the card does for its own", () => {
    const e = steppedOffer();
    const vetoed = { ...e, steps: e.steps && { ...e.steps, offerFirst: step({ give: ["106"], get: ["204"], pAccept: 0.4, pComplete: 0.2, vetoRisk: true }) } };
    const first = buildTradeCard(vetoed, { snapshot: tradeSnapshot({ tradeReview: "league_vote" }) }).steps?.items[0];
    expect(first).toMatchObject({ est: "Est. 40%", through: "about 20% it goes through", acceptSr: "an estimated 40% chance they accept, about 20% that it goes through" });
    expect(first?.text).toBe("Offer first: Wiggleton Spoons for Cornelius Snoot · Est. 40%, about 20% it goes through");
    // Vetoed, but both print the same: nothing more to say (the card's own note says a veto vote could stop the trade).
    const same = { ...e, steps: e.steps && { ...e.steps, offerFirst: step({ give: ["106"], get: ["204"], pAccept: 0.05, pComplete: 0.025, vetoRisk: true }) } };
    expect(buildTradeCard(same, { snapshot: tradeSnapshot({ tradeReview: "league_vote" }) }).steps?.items[0]).toMatchObject({ est: "Est. 5%", through: null, text: "Offer first: Wiggleton Spoons for Cornelius Snoot · Est. 5%" });
  });

  it("has no steps when the engine sets none, and names what it can't find plainly", () => {
    expect(card().steps).toBeNull();
    const e = steppedOffer();
    const gone = { ...e, steps: e.steps && { ...e.steps, ifNo: { ...e.steps.ifNo, add: "999" } } };
    expect(buildTradeCard(gone, { snapshot }).steps?.items[1]?.what).toBe("A player who's no longer in this league's data");
    expect(tradeWords({ give: [], get: [{ kind: "player", id: "204" }] }, snapshot)).toBe("nothing for Cornelius Snoot");
    expect(tradeWords({ give: [{ kind: "player", id: "104" }, { kind: "player", id: "105" }], get: [{ kind: "player", id: "203" }] }, snapshot)).toBe("Noodle McSprocket and Glimmer Oddfellow for Ignatius Fumblewick");
  });

  it("uses no jargon in the steps", () => {
    const words = JSON.stringify(buildTradeCard(steppedFull(), { snapshot }).steps);
    for (const jargon of ["EV", "σ", "V*", "g_mkt", "throw-in", "NaN", "undefined"]) expect(words).not.toContain(jargon);
  });
});

describe("baselineLines: my odds before any trade, and what they count (review of Phase 4)", () => {
  it("says them for the Finder's list and the Analyzer's trade, with why they can differ from the League page's", () => {
    expect(baselineLines({ pPlayoffs: 0.712, pTitle: 0.153 }, "finder")).toEqual({
      text: "Your odds before any trade: 71% to make the playoffs, 15% to win the title.",
      note: "Like every trade idea's numbers, they count the free-agent pickups that would help each team, so they can differ from the League page's odds, which take rosters as they stand.",
    });
    expect(baselineLines({ pPlayoffs: 0.712, pTitle: 0.153 }, "analyzer")?.text).toBe("Your odds before this trade: 71% to make the playoffs, 15% to win the title.");
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
    // Review of Phase 4: "Your odds now: 71%" sat next to the League page's 76% (rosters as they stand), so it says what it is.
    expect(view.baseline).toBe("Your odds before any trade: 62% to make the playoffs, 9% to win the title.");
    expect(view.baselineNote).toBe(
      "Like every trade idea's numbers, they count the free-agent pickups that would help each team, so they can differ from the League page's odds, which take rosters as they stand.",
    );
    expect(view.countText).toBe("3 trade ideas, sorted by Helps you.");
    expect(view.statusText).toBe("Found 3 trade ideas.");
    expect(view.searched).toBe(`Looked at 1,234 trade ideas, checked the best 200 closely, and played out your season ${config.simulation.finalSims.toLocaleString("en-US")} times with each of the best 40. That took 4.2 seconds.`);
    expect(view.notes).toEqual(["Kickers and D/STs are left out; turn them on in Settings."]);
    expect(view.warnings).toEqual(["Sleeper's week 17 projections didn't load."]);
    expect(view.empty).toBeNull();
    // Baseline odds give each card's odds their end point.
    expect(view.cards[0]?.facts.find((f) => f.label === "Playoff odds")?.value).toBe("+3 percentage points (62% to 65%)");
  });

  it("counts what was left out on purpose (§10 guards)", () => {
    const view = buildFinderView({ result: { ...result, hidden: { byBenefit: 10, byMarket: 1 } }, sort: "overall", snapshot, partnerId: null });
    expect(view.hidden).toBe(`Left out on purpose: 10 trade ideas that wouldn't help you and 1 trade idea where you'd get over ${Math.round(-config.benefit.marketHideBelow * 100)}% less trade value than you give.`);
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
    const one = (week: number) => `Week ${week} is under way, so this trade can't change it: its odds count week ${week} as it stands.`;
    const list = "Week 4 is under way, so no trade can change it: every idea's odds count week 4 as it stands.";
    expect(listNote(one(4))).toBe(list);
    expect(listNote(one(12))).toBe("Week 12 is under way, so no trade can change it: every idea's odds count week 12 as it stands.");
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
    expect(screening).toEqual({ label: "Screening trade ideas", detail: "120 of 480", percent: 17, valueText: "Screening trade ideas: 120 of 480" });
    const percents = (["setup", "screening", "exact", "simScreen", "simFinal", "rank"] as const).map((stage) => progressView({ stage, done: 0, total: 10 }).percent);
    expect(percents).toEqual([...percents].sort((x, y) => x - y));
    expect(progressView({ stage: "rank", done: 1, total: 1 }).percent).toBe(99);
    expect(progressView({ stage: "exact", done: 1300, total: 1200 }).detail).toBe("1,200 of 1,200");
  });
});

describe("links between the pages (a team id and player ids only)", () => {
  it("links the Finder to one partner, and reads it back only for another team of this league", () => {
    expect(finderHref("2")).toBe("/trades?partner=2");
    expect(finderHref(null)).toBe("/trades");
    expect(readFinderPartner("?partner=2", snapshot, "1")).toBe("2");
    for (const bad of ["?partner=1", "?partner=99", "", "?team=2", undefined]) expect(readFinderPartner(bad, snapshot, "1")).toBeNull();
  });

  it("reads the Analyzer's trade from its address: my active players to give, theirs to get, each once, at most a side's limit", () => {
    // 107 is on my IR (not tradable here), 204 isn't mine, 999 is no one's; 105 twice counts once.
    const draft = readAnalyzerDraft("?partner=2&give=105&give=107&give=204&give=105&give=999&get=203&get=101", snapshot, "1");
    expect(draft).toEqual({ partnerId: "2", give: ["105"], get: ["203"] });
    expect(readAnalyzerDraft("?partner=1&give=105&get=203", snapshot, "1")).toEqual({ partnerId: null, give: ["105"], get: [] });
    const many = readAnalyzerDraft(`?partner=2&${["101", "102", "103", "104", "105", "106"].map((id) => `give=${id}`).join("&")}`, snapshot, "1");
    expect(many.give).toHaveLength(ANALYZER_MAX_PER_SIDE);
    expect(ANALYZER_MAX_PER_SIDE).toBe(config.search.analyzerMaxPerSide);
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

  it("offers the other teams, my active roster and the partner's, by position, checked as drafted, the rest disabled once a side is full", () => {
    const choices = analyzerChoices(snapshot, "1", { partnerId: "2", give: ["101", "102", "104", "105"], get: ["203"] });
    expect(choices.partners.map((p) => p.name)).toEqual(["Gravel Gophers", "Quasar Quokkas", "Tundra Tortoises"]);
    expect(choices.mine.map((p) => p.id)).toEqual(["101", "103", "102", "105", "104", "106", "108", "MIN"]);
    expect(choices.mine.filter((p) => p.checked).map((p) => p.id)).toEqual(["101", "102", "105", "104"]);
    expect(choices.mine.filter((p) => p.disabled).map((p) => p.id)).toEqual(["103", "106", "108", "MIN"]);
    expect(choices.mine.find((p) => p.id === "103")).toMatchObject({ name: "Bartleby Crumpet", detail: "RB · NYJ", injury: { short: "Q", long: "Questionable", tone: "warn" } });
    expect(choices.theirs.map((p) => p.id)).toEqual(["201", "204", "203", "202", "205", "DET"]);
    expect(choices.theirs.some((p) => p.disabled)).toBe(false);
    expect(analyzerChoices(snapshot, "1", { partnerId: null, give: [], get: [] }).theirs).toEqual([]);
    expect(choices.limitText).toBe(`Up to ${ANALYZER_MAX_PER_SIDE} players a side, from the active rosters (players on IR or a taxi squad can't be traded here yet).`);
  });

  it("leaves out of the Analyzer's notes what the card's reasons already say, and says each note once", () => {
    const LONG = "Long-term values didn't load, so later seasons aren't counted.";
    const view = buildAnalysisView({ evaluation: evaluation({ reasons: ["Your RB2 spot goes from 9.1 to 14.3 projected points per week.", LONG] }), illegal: null, notes: [LONG, "Keeper costs aren't modeled.", "Keeper costs aren't modeled."] }, snapshot);
    expect(view.card?.reasons).toContain(LONG);
    expect(view.notes).toEqual(["Keeper costs aren't modeled."]);
  });

  it("shows an illegal trade's reason instead of a card, with the notes", () => {
    const illegal: TradeAnalysis = { evaluation: null, illegal: "Gravel Gophers can have at most 4 RBs.", notes: ["Pick your team on the Import Report to see trade ideas."] };
    expect(buildAnalysisView(illegal, snapshot)).toEqual({ baseline: null, baselineNote: null, card: null, illegal: "Gravel Gophers can have at most 4 RBs.", notes: ["Pick your team on the Import Report to see trade ideas."] });
    // My odds before any trade say nothing without a card.
    expect(buildAnalysisView({ ...illegal, baseline: { pPlayoffs: 0.62, pTitle: 0.09 } }, snapshot).baseline).toBeNull();
    const legal = buildAnalysisView({ evaluation: evaluation(), illegal: null, notes: [] }, snapshot);
    expect(legal.card?.heading).toBe("Trade with Gravel Gophers");
  });

  it("reads a trade as the Trade Finder does: my odds before this trade above the card, and its odds with their end percents (review of Phase 4)", () => {
    const e = evaluation({ key: "w", dPO: 0.091, dCH: 0.039 });
    const analyzed = buildAnalysisView({ evaluation: e, illegal: null, notes: [], baseline: { pPlayoffs: 0.63, pTitle: 0.12 } }, snapshot);
    expect(analyzed.baseline).toBe("Your odds before this trade: 63% to make the playoffs, 12% to win the title.");
    expect(analyzed.baselineNote).toBe("Like the trade's numbers, they count the free-agent pickups that would help each team, so they can differ from the League page's odds, which take rosters as they stand.");
    const odds = (c: NonNullable<typeof analyzed.card>) => c.facts.filter((f) => f.label.endsWith("odds")).map((f) => f.value);
    expect(odds(analyzed.card as NonNullable<typeof analyzed.card>)).toEqual(["+9.1 percentage points (63% to 72%)", "+3.9 percentage points (12% to 16%)"]);
    // The same trade on the Trade Finder, with the same odds before any trade: the same words.
    const found = buildFinderView({ result: searchResult([e], { baseline: { pPlayoffs: 0.63, pTitle: 0.12, expWins: 8 } }), sort: "overall", snapshot, partnerId: null }).cards[0];
    expect(found?.facts).toEqual(analyzed.card?.facts);
    // An evaluation sent without them (an older worker): the changes alone, no line.
    const plain = buildAnalysisView({ evaluation: e, illegal: null, notes: [] }, snapshot);
    expect(plain.baseline).toBeNull();
    expect(odds(plain.card as NonNullable<typeof plain.card>)).toEqual(["+9.1 percentage points", "+3.9 percentage points"]);
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
    expect(cardFeedback(records, "espn:0000abcd", e.key)).toEqual({ outcome: "sent", report: null });
    records = applyFeedback(records, { leagueKey: "espn:0000abcd", evaluation: e, change: { report: { reason: "never-accept", note: " too lopsided " } }, at: "2026-10-01T12:01:00.000Z" });
    expect(cardFeedback(records, "espn:0000abcd", e.key)).toEqual({ outcome: "sent", report: { reason: "never-accept", note: "too lopsided" } });
    expect(cardFeedback(records, "espn:ffff0000", e.key)).toEqual({ outcome: null, report: null });
    expect(cardFeedback(undefined, "espn:0000abcd", e.key)).toEqual({ outcome: null, report: null });
  });
});
