/**
 * The trade report's offline logic (scripts/trade-report.ts buildTradeReport and the pieces behind it) on a small
 * synthetic league (src/engine/trade.testing.ts smallLeague: 6 teams, made-up players, weeks 1–5 decided by PAST): no
 * network, no .env.local. The league is given real-looking team, owner and league names first, so the tests can show none
 * reaches the report, and the public NFL names the report follows (Garrett Wilson of mine, Chuba Hubbard and Mike Evans of
 * one partner), waiver ranks without settings.waiverOrderUsed (a dump from before the 4c adapter: the report puts it on
 * the weekly reset order first, league-report's asWeeklyResetData), and a questionable player of mine.
 */
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { displayAcceptance } from "@/engine/acceptance";
import { helpsBoth, overallScore, tradeScore } from "@/engine/benefit";
import { config } from "@/engine/config";
import { analyzeTrade, buildTradeContext, helpsScaleOf, partnerCalibrationOf, partnerScaleOf, proposalKey, tradeInternals } from "@/engine/evaluate";
import type { ModelInputs } from "@/engine/inputs";
import { buildLeagueModel } from "@/engine/league";
import { neutralThrowIns } from "@/engine/market";
import { ladderChoice, ladderJobOfSearch, offerLadderOfSearch } from "@/engine/offers";
import type { LeagueSnapshot, Pos } from "@/engine/model";
import { prizeOddsOf, prizePercents, prizePeriods, rewardWith } from "@/engine/reward";
import { runTradeSearch, searchStateOf, type SearchState } from "@/engine/search";
import { GOALS, defaultTradeSettings } from "@/engine/settings";
import { TEST_NOW } from "@/engine/testLeague";
import { smallLeague } from "@/engine/trade.testing";
import type { OfferStep, TradeEvaluation, TradeEvaluationCore, TradeSearchResult } from "@/engine/tradeModel";
import { tradeEvaluation } from "@/engine/tradeTestFixtures";
import { acceptText, injuryTagText, knownTagsOf, planBView, seasonEndOf, topChance, topPlacesOf } from "@/lib/tradeView";
import { GOAL_WORDS, asWeeklyResetData, benefitWin, placeholders, pre4cText, prizesWords, resetWaiverOrder, scaleCheck, thresholdsLine, type Pre4cOrder } from "./league-report";
import {
  ANCHORS,
  BLEND_EXTREMES,
  COMPARE_GOAL,
  FEW_GAMES,
  GAP_TRADE,
  GOAL_TOP,
  HELPS_BOTH_SHOWN,
  LADDER_CARDS,
  LANE_REST_STAGES,
  NEAR_POINTS,
  OFFER_WORDS,
  OPEN_SPOT_FINALISTS,
  PREMIUM_ANCHORS,
  TOP_DETAIL,
  UNTOUCHED_STAGES,
  alsoCardText,
  anchorRows,
  blendReason,
  buildTradeReport,
  cardCounts,
  cardsNotIn,
  chancePrinted,
  dataOrderOf,
  exactText,
  expectedGain,
  finalRunsText,
  fmt,
  goalCompare,
  helpsBothCost,
  helpsBothCounts,
  helpsBothParts,
  helpsBothSummary,
  helpsScaleSection,
  helpsThemScaleWords,
  kickoffJump,
  laneCost,
  laneCounts,
  laneParts,
  laneShown,
  ladderSummary,
  measuredRunsText,
  oddsByOrder,
  parseArgs,
  prizesSettingsOf,
  pctPlain,
  pickupWeeks,
  planBOddsText,
  playoffMove,
  premiumAnchorRows,
  pts,
  rankedFinals,
  reportCommand,
  scaleCheckOf,
  scaleText,
  signed,
  taggerOf,
  threeNumbers,
  titleMove,
  tradeValueText,
  weeklyLines,
  weeklyText,
  withoutHelpsThem,
  type HelpsBothCost,
  type HelpsBothCounts,
  type LaneCounts,
  type LadderSection,
  type Runtime,
  type RuntimeRun,
  type Tagger,
  type Tick,
} from "./trade-report";

/** Names the report must never print (stand-ins for leaguemates' team and owner names and the league's id). */
const PRIVATE = { league: "Secret League Name", leagueId: "987654321", team: (id: string) => `Zebra Squad ${id}`, owner: (id: string) => `Owner Realname ${id}` };

type PlayerInfo = LeagueSnapshot["players"][string];

/** Weeks 1–5 decided, strongest first: my team ("1") is 3-2, so it isn't out; every record differs (no ties in the standings). */
const PAST = ["2", "5", "1", "3", "6", "4"];
/** The waiver ranks the synthetic dump carries (ESPN's live order of its day, before the 4c adapter): my team claims last. */
const LIVE_RANKS: Readonly<Record<string, number>> = { "4": 1, "2": 2, "5": 3, "6": 4, "3": 5, "1": 6 };
const LIVE_ORDER = ["4", "2", "5", "6", "3", "1"];
/** The weekly reset order of those records: worst win percentage first (PAST reversed). */
const RESET_ORDER = [...PAST].reverse();

/** The synthetic league with the report's facts (the file header); `ids` names the players the tests follow. */
function league(): { raw: LeagueSnapshot; snapshot: LeagueSnapshot; inputs: ModelInputs; ids: Record<string, string> } {
  const { snapshot, inputs } = smallLeague(11, { pastWinnersOrder: PAST });
  let s: LeagueSnapshot = { ...snapshot, name: PRIVATE.league, leagueId: PRIVATE.leagueId, teams: snapshot.teams.map((t) => ({ ...t, name: PRIVATE.team(t.id), ownerName: PRIVATE.owner(t.id) })) };
  const values = inputs.market?.values ?? {};
  const ranked = (teamId: string, pos: Pos) => [...(s.teams.find((x) => x.id === teamId)?.roster ?? [])].filter((p) => s.players[p]?.pos === pos).sort((a, b) => (values[b] ?? 0) - (values[a] ?? 0) || (a < b ? -1 : 1));
  const edit = (id: string, over: Partial<PlayerInfo>) => {
    s = { ...s, players: { ...s.players, [id]: { ...(s.players[id] as PlayerInfo), ...over } } };
  };
  const ids: Record<string, string> = { wilson: ranked("1", "WR")[0] as string, hubbard: ranked("2", "RB")[0] as string, evans: ranked("2", "WR")[0] as string };
  edit(ids.wilson as string, { name: "Garrett Wilson", injury: "QUESTIONABLE" });
  edit(ids.hubbard as string, { name: "Chuba Hubbard" });
  edit(ids.evans as string, { name: "Mike Evans" });
  // Waiver ranks without settings.waiverOrderUsed (a dump from before the 4c adapter): ESPN's live order, my team ("1") last.
  s = { ...s, teams: s.teams.map((t) => ({ ...t, waiverRank: LIVE_RANKS[t.id] as number })) };
  return { raw: s, snapshot: placeholders(s), inputs, ids };
}

const { raw, snapshot, inputs, ids } = league();
const settings = defaultTradeSettings();
const clock = () => performance.now();

/** The league's prizes the suite's report is given (--prizes; Checkpoint 7c): Parker's $2,000 / $1,600 / $900, no weekly prize. */
const PRIZES = { first: 2000, second: 1600, third: 900, weeklyHigh: 0, pointsLeader: null };

// One report for the suite: 4 availability scenarios (the app's 32 would only slow the suite; every rule is the same), one
// timed run after one warm-up (so the determinism check compares two searches), the beams alone once; Checkpoint 7c, with
// --prizes.
const report = buildTradeReport(snapshot, inputs, {
  now: TEST_NOW,
  clock,
  mode: "offline",
  dataNote: "Synthetic test league.",
  scenarios: 4,
  runs: 1,
  warmups: 1,
  command: "npm run trade:report -- --offline data-local/synthetic --team 1 --prizes 2000,1600,900,0",
  prizes: PRIZES,
});
const doc = report.doc;
const trades = report.result.trades;
/** Section n of the report ("## n. …" up to the next "## " heading). */
const section = (n: number): string => {
  const m = new RegExp(`\\n## ${n}\\. `).exec(doc);
  if (!m) return "";
  const start = m.index + 1;
  const next = doc.indexOf("\n## ", start + 1);
  return doc.slice(start, next < 0 ? undefined : next);
};
const playerIds = (t: Pick<TradeEvaluation, "proposal">, side: "give" | "get"): string[] => (side === "give" ? t.proposal.give : t.proposal.get).flatMap((a) => (a.kind === "player" ? [a.id] : []));

describe("trade report: numbers in words", () => {
  it("formats numbers with a real minus sign, signs, percents and percentage points", () => {
    expect([fmt(1.234), fmt(-1.25, 2), fmt(-0.01, 1), fmt(null), fmt(Number.NaN)]).toEqual(["1.2", "−1.25", "0.0", "–", "–"]);
    expect([signed(2.5), signed(-0.4), signed(0), signed(0.04, 1)]).toEqual(["+2.5", "−0.4", "0.0", "0.0"]);
    expect([pctPlain(0.445), pctPlain(0.651, 0), pts(0.081), pts(-0.004), pts(null)]).toEqual(["44.5%", "65%", "+8.1 pts", "−0.4 pts", "–"]);
  });

  it("prints the chance they accept as the card does: under 5% reads <5%, never rounded up (planner answer 5); else the nearest 5%", () => {
    expect([chancePrinted(0.02), chancePrinted(0.049), chancePrinted(0.05), chancePrinted(0.074), chancePrinted(0.075), chancePrinted(0.563), chancePrinted(Number.NaN)]).toEqual(["<5%", "<5%", "5%", "5%", "10%", "55%", "–"]);
    // The card's own words (tradeView.acceptText), so the report can't drift from the card.
    for (let p = 0; p <= 1; p += 0.0025) expect(chancePrinted(p)).toBe(acceptText(p));
    const t = tradeEvaluation({ give: ["a"], get: ["b"] });
    const veto = { ...t, tradeScore: 35, pAccept: 0.42, pComplete: 0.21, acceptLabel: "Decent", overall: 9, detail: { ...t.detail, vetoRisk: true } };
    expect(threeNumbers(veto)).toBe("35 / 40% Decent (goes through 20%) / 9");
    expect(threeNumbers({ ...veto, detail: { ...veto.detail, vetoRisk: false } })).toBe("35 / 40% Decent / 9");
  });

  it("odds before → after: title with one decimal, playoffs in whole percents (the planner's examples)", () => {
    expect(titleMove(0.121, 0.013)).toBe("12.1% → 13.4%");
    expect(playoffMove(0.65, 0.04)).toBe("65% → 69%");
    expect([titleMove(null, 0.1), playoffMove(0.5, null)]).toEqual(["–", "–"]);
  });

  it("a Plan B box's odds lines in the report's words (Phase 4c's polish, change 9): its own odds and weekly line, nothing without them", () => {
    const odds = [
      { label: "Title odds", value: "12.1% → 13.4%", srValue: "from 12.1% to 13.4%" },
      { label: "Playoff odds", value: "65% → 69%", srValue: "from 65% to 69%" },
    ];
    const weekly = { label: "Win chance by week", weeks: [], text: "Win chance by week: Week 9: 68% → 64% · Week 13: 42% → 55%" };
    expect(planBOddsText({ odds, weekly })).toBe("; Title odds 12.1% → 13.4% · Playoff odds 65% → 69%; Win chance by week: Week 9: 68% → 64% · Week 13: 42% → 55%");
    expect(planBOddsText({ odds, weekly: null })).toBe("; Title odds 12.1% → 13.4% · Playoff odds 65% → 69%");
    expect(planBOddsText({ odds: [], weekly: null })).toBe("");
  });

  it("the weekly lines: the card's own weeks (tradeView.weeklyLine), moves of at least weeklyLineMin, drops first, then the largest gains, in week order", () => {
    const cfg = { weeklyLineMin: 0.03, weeklyLineMax: 2 };
    const wc = [
      { week: 5, before: 0.5, after: 0.52 }, // under the bar
      { week: 9, before: 0.68, after: 0.64 },
      { week: 11, before: 0.59, after: 0.63 },
      { week: 13, before: 0.42, after: 0.55 },
      { week: 14, before: null, after: 0.6 }, // unknown before
    ];
    expect(weeklyLines(wc, cfg)).toEqual([
      { week: 9, before: 0.68, after: 0.64 },
      { week: 13, before: 0.42, after: 0.55 },
    ]);
    expect(weeklyText(weeklyLines(wc, cfg))).toBe("Week 9: 68% → 64% · Week 13: 42% → 55%");
    expect(weeklyLines(undefined)).toBeNull();
    expect(weeklyText(null)).toBe("–");
    expect(weeklyText([])).toBe(`no week moves ${Math.round(100 * config.explain.weeklyLineMin)}+ points`);
    expect(weeklyLines(wc)?.length).toBeLessThanOrEqual(config.explain.weeklyLineMax);
    // Drops first: a 3.9-point drop beats a 4.3-point gain for the last place (card #6 of the Checkpoint 4c data).
    const six = [
      { week: 6, before: 0.554, after: 0.597 },
      { week: 7, before: 0.468, after: 0.42 },
      { week: 8, before: 0.604, after: 0.649 },
      { week: 11, before: 0.627, after: 0.745 },
      { week: 14, before: 0.493, after: 0.454 },
    ];
    expect(weeklyLines(six, { weeklyLineMin: 0.03, weeklyLineMax: 4 })?.map((l) => l.week)).toEqual([7, 8, 11, 14]);
    expect(weeklyText(weeklyLines(six, { weeklyLineMin: 0.03, weeklyLineMax: 4 }))).toBe("Week 7: 47% → 42% · Week 8: 60% → 65% · Week 11: 63% → 75% · Week 14: 49% → 45%");
  });

  it("counts the cards with Plan B and an injury-tagged player received, and the Plan B boxes receiving one (no card has steps since Checkpoint 7e)", () => {
    const tagged = (side: "give" | "get") => ({ marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: [], tagged: [{ playerId: "x", side, status: "OUT" as const }] });
    const plain = tradeEvaluation({ give: ["a"], get: ["b"] });
    const list = [tradeEvaluation({ give: ["a"], get: ["b"], flags: tagged("get") }), tradeEvaluation({ give: ["a"], get: ["c"], flags: tagged("give") }), tradeEvaluation({ give: ["d"], get: ["e"] })];
    // A tagger that knows one hurt player ("hurt"), on whichever side he is.
    const tagger: Tagger = (p) => [...p.give.map((a) => [a, "give"] as const), ...p.get.map((a) => [a, "get"] as const)].flatMap(([a, side]) => (a.kind === "player" && a.id === "hurt" ? [{ playerId: a.id, side, status: "OUT" as const }] : []));
    expect(cardCounts(list, tagger)).toEqual({ shown: 3, planB: 0, injuredGet: 1, planBInjuredGet: 0 });
    // Plan B boxes: one asking for the hurt player counts, one giving him away doesn't (review of track R, R-2).
    const planB = (give: string, get: string): NonNullable<TradeEvaluation["planB"]> => ({ proposal: { partnerId: "2", give: [{ kind: "player", id: give }], get: [{ kind: "player", id: get }] }, key: `${give}>${get}`, b: 1, tradeScore: 15, pAccept: 0.5, pComplete: 0.5, acceptLabel: "Decent", overall: 8, kind: "otherTarget" });
    const withB = [...list, { ...plain, planB: planB("a", "hurt") }, { ...plain, planB: planB("hurt", "e") }];
    expect(cardCounts(withB, tagger)).toEqual({ shown: 5, planB: 2, injuredGet: 1, planBInjuredGet: 1 });
    // The search's own cards: none has steps.
    for (const t of trades) expect(t.steps, t.key).toBeUndefined();
  });

  it("an expected gain is B × the chance it goes through (null when B is unknown)", () => {
    expect(expectedGain({ b: 0.83, pComplete: 0.43 })).toBeCloseTo(0.3569, 12);
    expect(expectedGain({ b: null, pComplete: 0.5 })).toBeNull();
  });
});

describe("trade report: the blend's reasons, from the record and his points so far alone", () => {
  const rec = { fRaw: 1.2, f: 1.2, clamped: null, ours: 5, market: 7, curve: "withoutHim" as const, source: "espn+sleeper" as const, fallback: false, games: 3, injury: "ACTIVE" as const, age: 27, actualPpg: 4 };

  it("with no data flag: says so with the facts that rule the flags out, the gap per game, and where his results so far fall (review of track R, R-3)", () => {
    expect(blendReason(rec)).toBe("No data flag (ESPN's and Sleeper's projections averaged, healthy, 3 games). Healthy players valued like him are projected 7.0 a game; we project 5.0. He has scored 4.0 a game so far (3 games), below both.");
    // A factor below 1 reads the same way round: the market's number, then ours.
    expect(blendReason({ ...rec, fRaw: 0.84, f: 0.84, ours: 7.69, market: 5.27, actualPpg: 3.63 })).toBe(
      "No data flag (ESPN's and Sleeper's projections averaged, healthy, 3 games). Healthy players valued like him are projected 5.3 a game; we project 7.7. He has scored 3.6 a game so far (3 games), below both.",
    );
    // Where his results fall: within NEAR_POINTS of a number reads "at" it; else above both, or between the two and nearer one.
    expect(NEAR_POINTS).toBe(0.5);
    expect(blendReason({ ...rec, actualPpg: 5.3 })).toContain("so far (3 games), at our projection.");
    expect(blendReason({ ...rec, actualPpg: 6.8 })).toContain("so far (3 games), at the market's number.");
    expect(blendReason({ ...rec, actualPpg: 9 })).toContain("so far (3 games), above both.");
    expect(blendReason({ ...rec, actualPpg: 5.7 })).toContain("so far (3 games), between the two, nearer ours.");
    expect(blendReason({ ...rec, actualPpg: 6.4 })).toContain("so far (3 games), between the two, nearer the market's.");
    expect(blendReason({ ...rec, market: 5.2, actualPpg: 5.1 })).toContain("so far (3 games), at both.");
  });

  it("names the flags the record shows (a fallback base rate, an injury that takes him off the curve, at most FEW_GAMES games), then the clamp; never a guess", () => {
    expect(blendReason({ ...rec, fRaw: 1.596, f: 1.35, clamped: "high", ours: 4.09, market: 8.96, curve: "offCurve", source: "sleeper", games: 0, injury: "IR", age: 22, actualPpg: null })).toBe(
      "On IR, so off the curve (he reads it but doesn't shape it); no game played yet; Sleeper's projection alone, age 22. Healthy players valued like him are projected 9.0 a game; we project 4.1 when he plays. The clamp cuts ×1.60 to ×1.35.",
    );
    expect(blendReason({ ...rec, fallback: true, source: "season", games: 1, actualPpg: 2 })).toBe(
      "A fallback base rate (no weekly projection, so Sleeper's season line ÷ 17); 1 game played; healthy. Healthy players valued like him are projected 7.0 a game; we project 5.0. He has scored 2.0 a game so far (1 game), below both.",
    );
    expect(FEW_GAMES).toBe(1);
    expect(blendReason({ ...rec, curve: "ownPoint" })).toContain("(ESPN's and Sleeper's projections averaged, healthy, 3 games, the curve read with his own point (an end of his position's value range))");
    expect(blendReason({ ...rec, curve: "offCurve" })).toMatch(/^Off the curve \(no game left\); ESPN's and Sleeper's projections averaged, healthy, 3 games\. /);
    // Unknown facts say nothing.
    expect(blendReason({ ...rec, games: null, age: null, injury: null, actualPpg: null })).toBe("No data flag (ESPN's and Sleeper's projections averaged). Healthy players valued like him are projected 7.0 a game; we project 5.0.");
    // The record holds no hype or role change, so the words never name one.
    for (const r of [rec, { ...rec, injury: "IR" as const, games: 0, age: 21 }, { ...rec, fallback: true, source: "actual" as const }]) expect(blendReason(r)).not.toMatch(/hype|rookie|role/i);
  });
});

describe("trade report: the acceptance anchors (the planner's two tables)", () => {
  it("computes the 9 §11 scenarios and the 6 star-premium scenarios through the real functions, every one within ±0.5 points", () => {
    const rows = [...anchorRows(), ...premiumAnchorRows()];
    expect(rows.map((r) => r.name)).toEqual([...ANCHORS, ...PREMIUM_ANCHORS].map((a) => a.name));
    for (const r of rows) {
      expect(r.pass).toBe(true);
      expect(Math.abs(r.computed - r.planner)).toBeLessThanOrEqual(0.5);
    }
    expect(report.anchors).toEqual(anchorRows());
    expect(section(8)).toContain(`- **The acceptance anchors** (the planner's two tables through acceptance(), premium.perceivedPackage and benefit.tradePackage): 15 of 15 within ±0.5 point ✅`);
  });
});

describe("trade report: what Helps both costs a search (section 10)", () => {
  /** A made-up run: its search's stages (TradeSearchResult.timings), its parts and (Checkpoint 7d) its lane parts. */
  const run = (search: Record<string, number>, parts: RuntimeRun["parts"] = null, lane: RuntimeRun["lane"] = null): RuntimeRun => ({ context: { total: 400 }, search, total: 400 + (search.total ?? 0), signature: "s", parts, lane });
  const runtime = (cold: RuntimeRun, runs: RuntimeRun[]): Runtime => ({ cold, runs, warmups: 1, context: {}, search: {}, total: 0, sameEveryRun: true });

  it("reads a search's calibration runs and its extras' final runs off its own yields; an extra in the first final run counts the median of the others", () => {
    const ticks: Tick[] = [
      { t: 10, stage: "exact", done: 1 },
      { t: 20, stage: "exact", done: 2 },
      { t: 32, stage: "simScreen", done: 0 }, // a partner's calibration run: 12 ms
      { t: 45, stage: "simScreen", done: 0 }, // another: 13 ms
      { t: 60, stage: "simScreen", done: 2 }, // the screening simulations
      { t: 90, stage: "simFinal", done: 1 }, // the first final run, with the choice of the finalists: 30 ms
      { t: 103, stage: "simFinal", done: 2 }, // 13 ms
      { t: 114, stage: "simFinal", done: 3 }, // 11 ms
      { t: 130, stage: "rank", done: 0 },
    ];
    const finals = [{ key: "a" }, { key: "b" }, { key: "c" }] as TradeEvaluationCore[];
    // "a" is the first final run: the median of the others (13 and 11), 12.
    expect(helpsBothParts(ticks, 0, { finals, helpsBothExtras: ["a", "c"] })).toEqual({ calibrations: { count: 2, ms: 25 }, extras: { count: 2, ms: 12 + 11 } });
    expect(helpsBothParts(ticks, 0, { finals, helpsBothExtras: ["b"] })).toEqual({ calibrations: { count: 2, ms: 25 }, extras: { count: 1, ms: 13 } });
    expect(helpsBothParts(ticks, 0, { finals, helpsBothExtras: [] })?.extras).toEqual({ count: 0, ms: 0 });
    // A search stopped before ranking has no state, so no parts.
    expect(helpsBothParts(ticks, 0, null)).toBeNull();
  });

  it("prices Helps both by its three parts, cold and warm (the second list from the ranking stage against the same search without it), the totals without it derived, and the runs without it as measured", () => {
    const parts = (cal: number, ex: number) => ({ calibrations: { count: 9, ms: cal }, extras: { count: 5, ms: ex } });
    // The stages Helps them doesn't touch (setup, screening, exact) sum to 4,102 / 4,072 / 4,147 with it, 3,962 / 4,022 / 3,922 without.
    const main = runtime(run({ setup: 2, screening: 2450, exact: 1700, rank: 1, steps: 230, total: 6000 }, parts(120, 66)), [
      run({ setup: 2, screening: 2400, exact: 1700, rank: 0.5, steps: 200, total: 5750 }, parts(115, 64)),
      run({ setup: 2, screening: 2380, exact: 1690, rank: 0.5, steps: 210, total: 5700 }, parts(113, 63)),
      run({ setup: 2, screening: 2440, exact: 1705, rank: 0.6, steps: 190, total: 5800 }, parts(117, 65)),
    ]);
    const without = runtime(run({ setup: 2, screening: 2300, exact: 1660, rank: 0.5, steps: 120, total: 5450 }), [
      run({ setup: 2, screening: 2300, exact: 1660, rank: 0.5, steps: 120, total: 5450 }),
      run({ setup: 2, screening: 2330, exact: 1690, rank: 0.4, steps: 115, total: 5500 }),
      run({ setup: 2, screening: 2280, exact: 1640, rank: 0.5, steps: 125, total: 5380 }),
    ]);
    const c = helpsBothCost(main, without);
    expect(c.calibrations).toEqual({ count: 9, cold: 120, warm: 115 });
    expect(c.extras).toEqual({ count: 5, cold: 66, warm: 64 });
    // The ranking stage (rank + steps): with 200.5 / 210.5 / 190.6 (median 200.5), without 120.5 / 115.4 / 125.5 (median 120.5).
    expect(c.secondList).toBeCloseTo(80, 9);
    // The extra: the three parts; cold, the cold run's own calibration and extra runs and the warm second list.
    expect(c.extra.warm).toBeCloseTo(115 + 64 + 80, 9);
    expect(c.extra.cold).toBeCloseTo(120 + 66 + 80, 9);
    expect(c.with).toEqual({ cold: 6000, warm: 5750 });
    // Without: with less the extra, cold and warm.
    expect(c.without.warm).toBeCloseTo(5750 - 259, 9);
    expect(c.without.cold).toBeCloseTo(6000 - 266, 9);
    // As measured: the median of the runs without, and the largest spread within either set, of the totals (with 5700–5800,
    // without 5380–5500) and of the stages Helps them doesn't touch (with 4072–4147, without 3922–4022).
    expect(UNTOUCHED_STAGES).toEqual(["setup", "screening", "exact"]);
    expect(c.measured).toEqual({ without: 5450, spread: 120, untouched: 100 });
    // Runs without parts (searches that stopped): no extra, nothing derived; one timed run a set: no spread (review HBR-1: it read 0).
    const bare = runtime(run({ total: 10 }), [run({ total: 10 })]);
    expect(helpsBothCost(bare, bare)).toMatchObject({ calibrations: { count: 0, cold: null, warm: null }, extras: { count: 0, cold: null, warm: null }, extra: { cold: null, warm: null }, without: { cold: null, warm: null }, measured: { without: 10, spread: null, untouched: null } });
    // Runs without the stage timings: the totals' spread only.
    const plain = (total: number) => run({ total });
    expect(helpsBothCost(runtime(plain(9), [plain(10), plain(14)]), runtime(plain(9), [plain(8), plain(9)])).measured).toEqual({ without: 8.5, spread: 4, untouched: null });
  });

  it("reads the helps-both lane's exact evaluations and screening simulations off a search's own yields (Checkpoint 7d): the lane last, a batch's time shared out where it begins inside one", () => {
    // 3 shortlisted trades, then the lane's two trades (L2 illegal) and one companion: 6 chosen, 5 legal.
    const state = { lane: { trades: ["L1", "L2"], companions: ["C1"], qualifying: 9, onShortlist: 4 }, exactByKey: new Map([["a", 0], ["b", 0], ["c", 0], ["L1", 0], ["C1", 0]]) } as unknown as Parameters<typeof laneParts>[2];
    const ticks: Tick[] = [
      { t: 5, stage: "screening", done: 4 },
      { t: 10, stage: "exact", done: 1 },
      { t: 20, stage: "exact", done: 2 },
      { t: 30, stage: "exact", done: 3 }, // the last before the lane's
      { t: 45, stage: "exact", done: 4 },
      { t: 52, stage: "exact", done: 5 },
      { t: 70, stage: "exact", done: 6 }, // the lane's three: 40 ms
      { t: 80, stage: "simScreen", done: 0 }, // a partner's calibration run
      { t: 90, stage: "simScreen", done: 0 },
      { t: 140, stage: "simScreen", done: 5 }, // 5 simulations in 50 ms, the last 2 the lane's: 20 ms
      { t: 150, stage: "simFinal", done: 1 },
    ];
    expect(laneParts(ticks, 0, state)).toEqual({ exact: { count: 3, ms: 40 }, simScreen: { count: 2, ms: 20 } });
    // 12 simulated in batches of 5, the lane's 4 from the 9th: 2 of the second batch's 5, then the whole last batch of 2.
    const twelve = { lane: { trades: ["L1", "L2", "L3", "L4"], companions: [], qualifying: 4, onShortlist: 0 }, exactByKey: new Map(["L1", "L2", "L3", "L4", ...Array.from({ length: 8 }, (_, i) => `s${i}`)].map((k) => [k, 0])) } as unknown as Parameters<typeof laneParts>[2];
    const sims: Tick[] = [
      ...Array.from({ length: 12 }, (_, i): Tick => ({ t: 10 * (i + 1), stage: "exact", done: i + 1 })),
      { t: 200, stage: "simScreen", done: 5 },
      { t: 300, stage: "simScreen", done: 10 },
      { t: 340, stage: "simScreen", done: 12 },
    ];
    expect(laneParts(sims, 0, twelve)).toEqual({ exact: { count: 4, ms: 40 }, simScreen: { count: 4, ms: (100 * 2) / 5 + 40 } });
    // No lane: nothing; no state: null.
    expect(laneParts(ticks, 0, { ...state, lane: { trades: [], companions: [], qualifying: 0, onShortlist: 0 } } as Parameters<typeof laneParts>[2])).toEqual({ exact: { count: 0, ms: 0 }, simScreen: { count: 0, ms: 0 } });
    expect(laneParts(ticks, 0, null)).toBeNull();
  });

  it("prices the helps-both lane by its three parts, cold and warm (the rest from the final simulation, ranking and steps against the same search without the lane), and the runs without it as measured (Checkpoint 7d)", () => {
    const lane = (exact: number, sims: number) => ({ exact: { count: 45, ms: exact }, simScreen: { count: 44, ms: sims } });
    const main = runtime(run({ simFinal: 900, rank: 1, steps: 150, total: 6500 }, null, lane(820, 210)), [
      run({ simFinal: 880, rank: 1, steps: 140, total: 6300 }, null, lane(800, 200)),
      run({ simFinal: 860, rank: 1, steps: 160, total: 6250 }, null, lane(780, 190)),
      run({ simFinal: 890, rank: 1, steps: 130, total: 6400 }, null, lane(790, 205)),
    ]);
    const without = runtime(run({ total: 5500 }), [run({ simFinal: 800, rank: 1, steps: 150, total: 5600 }), run({ simFinal: 790, rank: 1, steps: 140, total: 5450 }), run({ simFinal: 810, rank: 1, steps: 150, total: 5500 })]);
    expect(LANE_REST_STAGES).toEqual(["simFinal", "rank", "steps"]);
    const c = laneCost(main, without);
    expect(c.exact).toEqual({ count: 45, cold: 820, warm: 790 });
    expect(c.simScreen).toEqual({ count: 44, cold: 210, warm: 200 });
    // The rest: with 1,021 / 1,021 / 1,021 (median 1,021), without 951 / 931 / 961 (median 951).
    expect(c.rest).toBeCloseTo(70, 9);
    expect(c.extra.warm).toBeCloseTo(790 + 200 + 70, 9);
    expect(c.extra.cold).toBeCloseTo(820 + 210 + 70, 9);
    expect(c.with).toEqual({ cold: 6500, warm: 6300 });
    // As measured: the median of the runs without, and the largest spread within either set (with 6,250–6,400, without 5,450–5,600).
    expect(c.measured).toEqual({ without: 5500, spread: 150 });
    // Runs without lane parts (searches that stopped) or stage timings: nothing derived; one timed run a set: no spread.
    // The Overall cards with the lane that the search without it doesn't show, by key.
    const shown = (...keys: string[]) => ({ trades: keys.map((key) => ({ key })) }) as unknown as TradeSearchResult;
    expect(cardsNotIn(shown("a", "b", "c"), shown("b", "d"))).toBe(2);
    expect(cardsNotIn(shown("a"), shown("a"))).toBe(0);
    const bare = runtime(run({ total: 10 }), [run({ total: 10 })]);
    expect(laneCost(bare, bare)).toMatchObject({ exact: { count: 0, cold: null, warm: null }, simScreen: { count: 0, cold: null, warm: null }, rest: null, extra: { cold: null, warm: null }, measured: { without: 10, spread: null } });
  });

  it("says what else the helps-both lane changes on the Finder (review of the lane, LANE-1): the boxes of the cards both show (their offer-first steps too until Checkpoint 7e), the \"Helps both\" list's cards each way, and the exact and left-out counts", () => {
    type Card = { key: string; planB?: { key: string } };
    const result = (trades: Card[], list: string[], exact: number, hidden: TradeSearchResult["hidden"]) =>
      ({ trades, helpsBoth: { trades: list.map((key) => ({ key })) }, counts: { screened: 0, exact, simScreen: 0, simFinal: 0 }, hidden }) as unknown as TradeSearchResult;
    // "a": another box; "b": no box either way; "c" and "d": each run's own card; "e": the same box both ways; "f": a box with
    // the lane only; "g": a box without it only.
    const on = result(
      [{ key: "a", planB: { key: "x" } }, { key: "b" }, { key: "c" }, { key: "e", planB: { key: "z" } }, { key: "f", planB: { key: "w" } }, { key: "g" }],
      ["a", "h"],
      245,
      { byBenefit: 39, byMarket: 1, byChance: 2 },
    );
    const off = result(
      [{ key: "a", planB: { key: "y" } }, { key: "b" }, { key: "d" }, { key: "e", planB: { key: "z" } }, { key: "f" }, { key: "g", planB: { key: "v" } }],
      ["a", "i", "j"],
      201,
      { byBenefit: 29, byMarket: 0 },
    );
    expect(laneShown(on, off)).toEqual({
      shared: { cards: 5, box: 3 },
      list: { added: 1, dropped: 2, cards: 2 },
      // Made-up results carry no search state: no final runs to read.
      finalsLost: { count: 0, listed: 0 },
      exact: { without: 201, with: 245 },
      leftOut: { without: { benefit: 29, market: 0, chance: 0 }, with: { benefit: 39, market: 1, chance: 2 } },
    });
    // The same search both ways: nothing differs.
    expect(laneShown(off, off)).toMatchObject({ shared: { cards: 6, box: 0 }, list: { added: 0, dropped: 0, cards: 3 }, exact: { without: 201, with: 201 } });
  });

  /** smallLeague(seed) at 10% with the helps-both lane (`on`) and without it (`off`), each on a context of its own. */
  const laneSearches = (seed: number) => {
    const { snapshot, inputs } = smallLeague(seed);
    const at10 = { ...defaultTradeSettings(), minChance: 0.1 };
    const search = (lane: boolean) => runTradeSearch(buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 8 }), { settings: at10, ...(lane ? {} : { helpsBothLane: false }) });
    const on = search(true);
    const off = search(false);
    return { on, off, stOn: searchStateOf(on) as SearchState, stOff: searchStateOf(off) as SearchState };
  };

  it("keeps every \"Helps both\" extra of the search without the lane (review of the lane, LANE-2: smallLeague 13 at 10%, where the plain top 20 by B lost one and the list went 2 cards → 1; smallLeague 23 since Checkpoint 7e), and counts the extras' pool with the lane's wider room (the final review, ENG-7D-2)", { timeout: 60_000 }, () => {
    // smallLeague(23) (facts of the synthetic data; 13 until Checkpoint 7e, whose automatic playoff weight, measured on the
    // shown block's 20,000 seasons, moved its finalists: its candidates fell to 18, under the 20): more trades help both on the
    // screening run than the plain top 20 holds, the lane's among them.
    const { on, off, stOn, stOff } = laneSearches(23);
    const shown = laneShown(on, off);
    // On smallLeague(13), seven of the lane's long shots (each under 5% as printed) helped both on the screening run. As the
    // plain top 20 they took places among the extras, and one extra without the lane, a card of its list, lost its final run.
    // Since the lead's fix each lane trade widens the room by one (search.ts finalistsOf), so every extra without the lane keeps
    // its final run.
    expect(shown.finalsLost).toEqual({ count: 0, listed: 0 });
    expect(shown.list.dropped).toBe(0);
    expect(shown.list.cards).toBeGreaterThanOrEqual(2);
    const finalsOn = new Set(stOn.finals.map((f) => f.key));
    expect(stOff.helpsBothExtras.every((k) => finalsOn.has(k))).toBe(true);
    // The lane's own candidates got the wider room: more extras than without it.
    expect(stOn.helpsBothExtras.length - stOn.laneDisplaced.length).toBeGreaterThan(stOff.helpsBothExtras.length);
    // Section 10's extras row counts the pool as the search chose it (ENG-7D-2): here more candidates help both than the 20, so
    // "already finalists" read as the pool less every extra went negative (−1). The room: 20, one more for each from the lane.
    const c = helpsBothCounts(on) as HelpsBothCounts;
    const screen = [...stOn.exactByKey.keys()].map((k) => stOn.versions.get(k)?.screen as TradeEvaluationCore);
    const candidates = screen.filter((x) => helpsBoth(x) && !x.flags.hiddenByMarket);
    const fromLane = new Set([...stOn.lane.trades, ...stOn.lane.companions]);
    expect(candidates.length).toBeGreaterThan(config.search.helpsBothFinalists); // a fact of the synthetic data
    expect(c.exact.shown).toBe(candidates.length);
    expect(c.room).toBe(config.search.helpsBothFinalists + candidates.filter((x) => fromLane.has(x.key)).length);
    expect(c.pool).toBe(Math.min(c.exact.shown, c.room));
    expect(c.picked).toBeGreaterThanOrEqual(0);
    expect(c.picked + c.extras).toBe(c.pool);
    expect(c.extras + stOn.laneDisplaced.length).toBe(stOn.helpsBothExtras.length);
    const ranked = new Set(stOn.finals.filter((f) => !stOn.helpsBothExtras.includes(f.key)).map((f) => f.key));
    expect(c.finalists.total).toBe(ranked.size);
  });

  it("counts the finalists the helps-both lane displaced, kept for the \"Helps both\" list, and words them apart (the final review, ENG-7D-1: smallLeague 45 at 10%, smallLeague 42 since Checkpoint 7e, where a finalist the lane's trades push out helps both only on its final numbers)", { timeout: 60_000 }, () => {
    // smallLeague(42) (facts of the synthetic data; 45 until Checkpoint 7e: the search.helpsBoth.test.ts case moved with it).
    const { on, off, stOn, stOff } = laneSearches(42);
    // Every final run without the lane whose Helps them is known (the list's candidates) is made with it too.
    expect(laneShown(on, off).finalsLost).toEqual({ count: 0, listed: 0 });
    const finalsOn = new Set(stOn.finals.map((f) => f.key));
    expect(stOff.finals.filter((f) => !finalsOn.has(f.key)).every((f) => !Number.isFinite(f.them?.helps))).toBe(true);
    // The lane table's row: the displaced finalists kept, of them those that help both on the final run and those listed.
    const lc = laneCounts(on) as LaneCounts;
    const displaced = new Set(stOn.laneDisplaced);
    expect(lc.displaced.kept).toBe(displaced.size);
    expect(lc.displaced.kept).toBeGreaterThan(0); // a fact of the synthetic data
    expect(lc.displaced.both).toBe(stOn.finals.filter((f) => displaced.has(f.key) && helpsBoth(f)).length);
    expect(lc.displaced.both).toBeGreaterThan(0); // a fact of the synthetic data: the case ENG-7D-1 found
    expect(lc.displaced.listed).toBe((on.helpsBoth?.trades ?? []).filter((t) => displaced.has(t.key)).length);
    expect(laneCounts(off)?.displaced).toEqual({ kept: 0, both: 0, listed: 0 });
    // Section 4's words: the finalists, the pool's extras and the displaced finalists apart.
    const d = stOn.laneDisplaced.length;
    const x = stOn.helpsBothExtras.length - d;
    expect(x).toBeGreaterThan(0); // a fact of the synthetic data
    expect(finalRunsText(on)).toBe(`${on.counts.simFinal} final runs (${on.counts.simFinal - d - x} finalists, ${x} "Helps both" extra${x === 1 ? "" : "s"} and ${d} finalist${d === 1 ? "" : "s"} the helps-both lane displaced: section 10)`);
  });

  it("words the runs without Helps them against section 4's with their own sign, and the spread only from 2 timed runs a set (review of the report track, HBR-1)", () => {
    const tail = ", so the totals without are section 4's less the three parts.";
    // Faster without (Parker's at Checkpoint 7c: 5.71 s against 5.81 s): "under", never a "+" from section 4's.
    expect(measuredRunsText({ with: { cold: 5890, warm: 5806 }, measured: { without: 5715, spread: 246, untouched: 210 } })).toBe(
      `The runs without it measured 5.71 s (median), 91 ms under section 4's 5.81 s, but each set's search totals spread over up to 246 ms from run to run, setup, screening and exact evaluation alone (which Helps them doesn't touch) over up to 210 ms${tail}`,
    );
    // Slower without, and the same: their own words.
    expect(measuredRunsText({ with: { cold: 1100, warm: 1000 }, measured: { without: 1012, spread: 40, untouched: null } })).toBe(
      `The runs without it measured 1.01 s (median), 12 ms over section 4's 1.00 s, but each set's search totals spread over up to 40 ms from run to run${tail}`,
    );
    expect(measuredRunsText({ with: { cold: 1100, warm: 1000 }, measured: { without: 1000, spread: 40, untouched: 30 } })).toContain("measured 1.00 s (median), the same as section 4's 1.00 s, but");
    // One timed run a set: no spread from run to run, so none is printed (it read "up to 0.0 ms").
    expect(measuredRunsText({ with: { cold: 1100, warm: 1060 }, measured: { without: 937, spread: null, untouched: null } })).toBe(
      `The runs without it measured 937 ms (median), 123 ms under section 4's 1.06 s, from one timed run a set (no spread from run to run)${tail}`,
    );
    // Nothing measured: no sentence.
    expect(measuredRunsText({ with: { cold: 1100, warm: 1060 }, measured: { without: null, spread: null, untouched: null } })).toBe("");
  });

  it("words the final runs (counts.simFinal holds the extras since Checkpoint 7c), keeps the ranking's finalists apart, and words a partner's scale", () => {
    // A result no search returned has no state, so no extra is known: its final runs read as finalists (the search's own: section 4's test).
    const fake = { counts: { screened: 0, exact: 0, simScreen: 0, simFinal: 60 } } as TradeSearchResult;
    expect(finalRunsText(fake)).toBe("60 finalists");
    const finals = [{ key: "a" }, { key: "b" }, { key: "c" }] as TradeEvaluationCore[];
    expect(rankedFinals({ finals, helpsBothExtras: ["b"] }).map((f) => f.key)).toEqual(["a", "c"]);
    expect(rankedFinals({ finals, helpsBothExtras: [] })).toEqual(finals);
    expect(rankedFinals(null)).toEqual([]);
    expect(scaleText(null)).toBe("–");
    expect(scaleText({ b3: 4.374, b3P: 4.374, odds: 4.374, floored: false, lambda: null })).toBe("4.37");
    expect(scaleText({ b3: 0.5, b3P: 0.5, odds: 0.213, floored: true, lambda: null })).toBe("0.50 (floored: 0.21)");
    // With long-term values: B₃,P with its own floor first, then the mix B_ref,P (review HBR-2: "1.70 (floored: 0.30)" read as B₃,P floored from the run).
    expect(scaleText({ b3: 1.7, b3P: 0.5, odds: 0.3, floored: true, lambda: 0.35 })).toBe("B₃,P 0.50 (floored: 0.30) → B_ref,P 1.70 (λ_P 0.35)");
    expect(scaleText({ b3: 3.48, b3P: 3.2, odds: 3.2, floored: false, lambda: 0.35 })).toBe("B₃,P 3.20 → B_ref,P 3.48 (λ_P 0.35)");
  });

  it("words B_P and its scale by league type: the mix with long-term values outside redraft leagues (review of the report track, HBR-2)", () => {
    const redraft = helpsThemScaleWords("redraft");
    expect(redraft).toBe(`B_P, its B_win under the league's reward with no trade-value term, on its own scale B₃,P: the B of +${config.benefit.helpsGain} points a week for it on the same seasons, floored at ${config.benefit.helpsFloor}`);
    expect(redraft).not.toContain("B_ref,P");
    for (const type of ["dynasty", "keeper"] as const) {
      const words = helpsThemScaleWords(type);
      expect(words.startsWith(`${redraft}; with long-term values, `)).toBe(true);
      // F₁₀ = 40 × 10% = 4; λ_P the partner's own default (keeper 0.2), never the user's setting.
      expect(words).toContain("the scale is B_ref,P = (1 − λ_P) × B₃,P + λ_P × 4, both by λ_P, its default by its playoff odds (keeper 0.2), never the Win now ↔ Future setting");
    }
  });

  it("the console summary's Helps both part: the split's counts, and the extra under the setting it was measured under (review of the report track, HBR-3)", () => {
    const counts = (both: number, total: number, cards: number, fromExtras: number) =>
      ({ exact: { total, helpsYou: 0, theirB: 0, helpsThem: 0, both, shown: both }, list: { trades: Array.from({ length: cards }, () => ({})) }, fromExtras }) as unknown as HelpsBothCounts;
    const cost = (warm: number | null) => ({ extra: { cold: null, warm } }) as HelpsBothCost;
    // Parker's at Checkpoint 7c: under the split 5 of 201 helped both and the list showed 2, 1 of them an extra; the cost measured under "Only the champion".
    expect(helpsBothSummary({ counts: { title: null, other: counts(5, 201, 2, 1) }, cost: cost(202.4) }, "title")).toBe(
      "5 of 201 exact trades help both on the screening run, the list shows 2 (1 from the extras); Helps both costs +202 ms a search warm (Only the champion, section 4's runs)",
    );
    // The list is judged on the final run, so it can show more than the screening run counted.
    expect(helpsBothSummary({ counts: { title: null, other: counts(1, 40, 3, 0) }, cost: cost(null) }, "title")).toBe(
      "1 of 40 exact trades helps both on the screening run, the list shows 3 (0 from the extras); Helps both costs – a search warm (Only the champion, section 4's runs)",
    );
    expect(helpsBothSummary({ counts: { title: null, other: null }, cost: cost(10) }, "title")).toContain("no trade counted as helping both");
    // Checkpoint 7d: the helps-both lane under the split, the list without it, and its cost under the setting it was measured under.
    const lane = { counts: { title: null, other: { exact: 44, list: 2 } }, before: { title: null, other: counts(3, 201, 1, 0) }, cost: { extra: { cold: null, warm: 655.4 } } } as unknown as NonNullable<Parameters<typeof helpsBothSummary>[0]["lane"]>;
    expect(helpsBothSummary({ counts: { title: null, other: counts(8, 245, 3, 2) }, cost: cost(202.4), lane }, "title")).toBe(
      "8 of 245 exact trades help both on the screening run, the list shows 3 (2 from the extras); the helps-both lane adds 44 exact trades, 2 on the list (1 card without the lane); Helps both costs +202 ms a search warm, the lane +655 ms (Only the champion, section 4's runs)",
    );
  });

  it("section 11's words (Checkpoint 7e): each offer's place as the card says it, and the console's line on the split's ladders", () => {
    expect(OFFER_WORDS).toEqual({ open: "Open with", then: "Then", suggested: "The suggested trade", last: "Last offer" });
    const row = (n: number, ms: number[]) => ({ card: tradeEvaluation({ give: ["a"], get: ["b"] }), ladder: { cardKey: "k", steps: Array.from({ length: n }, () => ({})) }, candidates: 54, screened: 12, ms }) as unknown as LadderSection["other"]["rows"][number];
    const better = (n: number, same = true) => ({ card: tradeEvaluation({ give: ["a"], get: ["b"] }), screened: 40, likelier: 9, better: Array.from({ length: n }, () => ({})), same }) as unknown as LadderSection["other"]["better"][number];
    const section = (rows: LadderSection["other"]["rows"], b: LadderSection["other"]["better"]): LadderSection => ({ title: { rows: [], better: [] }, other: { rows, better: b } });
    expect(ladderSummary(section([row(2, [480, 504, 476]), row(1, [251]), row(3, [1200, 1250])], [better(0), better(1), better(0, false)]), "Several prizes")).toBe(
      "How to offer it (Several prizes): the top 3 cards hold 2 / 1 / 3 offers, built in 480 ms / 251 ms / 1.23 s (first opens, medians); 1 of the top 3 has a candidate printing a higher Helps you and a higher chance; the pre-screen picks every candidate's offers on 2 of 3",
    );
    expect(ladderSummary(section([], []), "Several prizes")).toBe("How to offer it: no cards under Several prizes");
  });

  it("the search without Helps them (withoutHelpsThem): every partner's calibration run is none, so no partner's scale is known", () => {
    const ctx = buildTradeContext(snapshot, inputs, { now: TEST_NOW, settings, scenarios: 0 });
    const I = tradeInternals(ctx);
    // Before: a partner's run is made when first asked for (on a context of its own, so the one below starts empty).
    expect(I.sim).not.toBeNull();
    expect(I.sim?.partners.size).toBe(0);
    expect(withoutHelpsThem(ctx)).toBe(ctx);
    expect(I.sim?.partners.size).toBe(I.teams.length);
    for (const t of I.teams) {
      expect(I.sim?.partners.get(t.id)).toBeNull();
      expect(partnerCalibrationOf(I, t.id)).toBeNull();
      expect(partnerScaleOf(I, t)).toBeNull();
    }
    // The same league's context as built: its partners' runs are there.
    const fresh = tradeInternals(buildTradeContext(snapshot, inputs, { now: TEST_NOW, settings, scenarios: 0 }));
    const partner = fresh.teams.find((t) => t.id !== fresh.me?.id) as (typeof fresh.teams)[number];
    expect(partnerCalibrationOf(fresh, partner.id)).not.toBeNull();
  });
});

describe("trade report: the whole offline report on a synthetic league", () => {
  const I = tradeInternals(report.ctx);

  it("runs the real search and renders every section in order, the header with the data, the settings and the baseline", () => {
    expect(trades.length).toBeGreaterThan(0);
    expect(report.result.myTeamId).toBe("1");
    expect([...doc.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(doc).toContain("# Trade search: Parker's ESPN league (Checkpoint 7e)");
    expect(doc).toContain("Generated by `npm run trade:report -- --offline data-local/synthetic --team 1 --prizes 2000,1600,900,0` on ");
    expect(doc).toContain("- Synthetic test league.");
    expect(doc).toContain(
      "**Settings** (the app's defaults): What does your league reward?: Only the champion (ΔPO 0.15 / ΔCH 0.85; section 2: Several prizes, the league's split, 1st 44%, 2nd 36%, 3rd 20%, from --prizes); Chance they accept: at least 10%; Protect my trade value: Medium (κ 2 points a week per 100% of trade value, priced on B₃: section 3);",
    );
    // …and the thresholds in ROS lineup points under the search's ω (review of the engine track, Phase 7b).
    expect(doc).toContain(thresholdsLine(I.model));
    // The baseline is the search's: every team after its pickups, the same numbers as the League model's headline odds.
    const mine = report.model.odds?.teams.find((t) => t.teamId === "1");
    // …and every prize component (Checkpoint 7c), the headline's too.
    expect(report.result.baseline).toEqual({ pPlayoffs: mine?.pPlayoffs, pTitle: mine?.pTitle, expWins: mine?.expWins, prizes: prizeOddsOf(mine as NonNullable<typeof mine>) });
    // The shown block's seasons (Checkpoint 7e: the League page's headline and every card's "before").
    expect(doc).toContain(`**Your baseline** (the trade search's: every team after its free-agent pickups in the waiver order above, seasons 1–20,000, the shown block; it equals the League page's headline, section 7): playoffs ${pctPlain(mine?.pPlayoffs)}, title ${pctPlain(mine?.pTitle)}`);
    expect(doc.split("\n").length).toBeLessThan(300);
  });

  it("puts a dump from before the 4c adapter on the weekly reset order first, so every section runs on the order the app uses (review of track R, R-4)", () => {
    expect(dataOrderOf(snapshot)).toBe("pre4c");
    const p = report.pre4c as Pre4cOrder;
    expect(p).toEqual({ live: LIVE_ORDER, used: RESET_ORDER, waiverOrderUsed: "weeklyReset" });
    expect(report.snapshot).toEqual(asWeeklyResetData(snapshot).snapshot);
    expect(report.snapshot.teams.map((t) => [t.id, t.waiverRank, t.liveWaiverRank])).toEqual(snapshot.teams.map((t) => [t.id, RESET_ORDER.indexOf(t.id) + 1, LIVE_RANKS[t.id]]));
    // The League model and the trade search's context (its baseline) both hand free agents out in it.
    expect(report.model.faAllocation?.order).toEqual(RESET_ORDER);
    expect(tradeInternals(report.ctx).model.faAllocation?.order).toEqual(RESET_ORDER);
    expect(tradeInternals(report.ctx).snapshot.settings.waiverOrderUsed).toBe("weeklyReset");
    // The header says what it did, with both orders and my place in each.
    expect(doc).toContain(`- Waiver order used: Weekly reset (reverse standings). ${pre4cText(p, "1", (id) => `Team ${id}${id === "1" ? " (you)" : ""}`)} Section 7 compares the two orders.`);
    expect(doc).toContain("(Team 4 > Team 2 > Team 5 > Team 6 > Team 3 > Team 1 (you); you claimed 6th)");
    expect(doc).toContain(`the weekly reset order from today's standings: ${RESET_ORDER.map((id) => `Team ${id}${id === "1" ? " (you)" : ""}`).join(" > ")}; you claim ${RESET_ORDER.indexOf("1") + 1}th,`);
    // Data from the 4c adapter comes through unchanged.
    const fresh: LeagueSnapshot = { ...snapshot, settings: { ...snapshot.settings, waiverOrderUsed: "weeklyReset" } };
    expect(asWeeklyResetData(fresh)).toEqual({ snapshot: fresh, pre4c: null });
  });

  it("section 1: one row per top card with the three numbers as printed, the odds before → after, the weekly lines and the tags; the counts and the pattern note", () => {
    const s = section(1);
    const top = trades.slice(0, TOP_DETAIL);
    const rows = s.split("\n").filter((l) => /^\| \d+ \| Team \d+/.test(l));
    expect(rows).toHaveLength(top.length);
    const b = report.result.baseline;
    const end = seasonEndOf(snapshot.settings, inputs.nfl.lastWeek);
    top.forEach((t, i) => {
      const row = rows[i] as string;
      expect(row.startsWith(`| ${i + 1} | Team ${t.proposal.partnerId}`)).toBe(true);
      expect(row).toContain(`| ${threeNumbers(t)} | ${titleMove(b.pTitle, t.dCH)} | ${playoffMove(b.pPlayoffs, t.dPO)} | ${weeklyText(weeklyLines(t.detail.winChance))} | ${tradeValueText(t)} |`);
      // The trade value column: B's market term in points a week on the card's scale (planner reply to Checkpoint 7a, §2 question 5).
      expect(t.marketWeekly as number).toBeCloseTo(config.benefit.protectValue.medium * Math.min(0.5, Math.max(-0.5, t.gMine)), 12);
      for (const g of t.flags.tagged ?? []) expect(row).toContain(`${snapshot.players[g.playerId]?.name} [${injuryTagText(g, end, "ESPN")}]`);
      // The odds after are the baseline plus the trade's change on the same block (the shown block: Checkpoint 7e).
      expect(t.detail.winChance).toBeDefined();
    });
    // Garrett Wilson is questionable here: wherever he's given, the tag says so.
    for (const t of trades.filter((x) => playerIds(x, "give").includes(ids.wilson as string))) expect(t.flags.tagged?.some((g) => g.playerId === ids.wilson && g.side === "give")).toBe(true);
    const tagsOf = taggerOf(tradeInternals(report.ctx));
    const c10 = cardCounts(top, tagsOf);
    const all = cardCounts(trades, tagsOf);
    expect(s).toContain(`**Counts** (top ${c10.shown} / all ${all.shown} cards): with Plan B ${c10.planB} / ${all.planB}; receiving an injury-tagged player ${c10.injuredGet} / ${all.injuredGet}; Plan B boxes receiving one ${c10.planBInjuredGet} / ${all.planBInjuredGet}.`);
    // The Plan B lines carry their players' tags (review of track R, R-2), in the box's words; no card has steps since
    // Checkpoint 7e (its "How to offer it" is section 11's).
    const known = knownTagsOf(trades);
    if (top.some((t) => t.planB)) expect(s).toContain("Plan B on those cards:");
    for (const [i, t] of top.entries()) {
      const line = s.split("\n").find((l) => l.startsWith(`- #${i + 1}: `));
      expect(t.steps).toBeUndefined();
      if (t.planB) {
        const box = planBView(t.planB, report.snapshot, { cardTags: t.flags.tagged, knownTags: known, seasonEnd: end, baseline: b });
        expect(line).toContain(`in the box's words: ${box?.give} → ${box?.get}; ${t.planB.tradeScore} / `);
        // Phase 4c's polish (change 9): the box's own odds, from the search's baseline and Plan B's final-block simulation.
        expect(box?.odds.map((o) => o.label)).toEqual(["Title odds", "Playoff odds"]);
        expect(line).toContain(`; Title odds ${box?.odds[0]?.value} · Playoff odds ${box?.odds[1]?.value}`);
        expect(line).toContain(planBOddsText(box as NonNullable<typeof box>));
        if (box?.weekly) expect(line).toContain(`; ${box.weekly.text}`);
      } else expect(line).toBeUndefined();
    }
    const p = report.result.pattern;
    expect(s).toContain(p ? `"${p.text}"` : "**The pattern note** doesn't show");
  });

  it("tags a step's or a Plan B's players by the search's own rule: exactly the cards' own tags (taggerOf)", () => {
    const tagsOf = taggerOf(tradeInternals(report.ctx));
    for (const t of trades) expect(tagsOf(t.proposal)).toEqual(t.flags.tagged ?? []);
    // Wilson, questionable, is tagged on my side of any trade that gives him.
    const w = { give: [{ kind: "player" as const, id: ids.wilson as string }], get: [] };
    expect(tagsOf(w)).toEqual([expect.objectContaining({ playerId: ids.wilson, side: "give", status: "QUESTIONABLE" })]);
  });

  it("section 2 (Checkpoint 7c): the app's search under Several prizes on the league's split, on the context it builds under it, against section 1's; both top 5s and top 10s, numbers from each list or the Analyzer on that setting's context", () => {
    const g = report.goals;
    // --prizes: "Several prizes" on the league's split, whole percents 44 / 36 / 20; without it, the prefilled split.
    const prizesSettings = prizesSettingsOf(settings, PRIZES);
    expect(prizesSettings).toEqual({ ...settings, goal: COMPARE_GOAL, prizes: PRIZES });
    expect(prizesSettingsOf(settings)).toEqual({ ...settings, goal: COMPARE_GOAL });
    expect(report.prizes).toEqual(PRIZES);
    expect([g.goal, g.settings]).toEqual([COMPARE_GOAL, prizesSettings]);
    const reward = g.reward as NonNullable<typeof g.reward>;
    expect(reward).toEqual(rewardWith(prizesSettings, prizePeriods(report.snapshot)));
    expect(prizePercents(reward.shares)).toEqual({ first: 44, second: 36, third: 20, weeklyHigh: 0, pointsLeader: 0 });
    // The search on the context the app builds under the split (its own ω, pickups and baseline): the same cards, bit for bit.
    const ctx = buildTradeContext(report.snapshot, inputs, { now: TEST_NOW, settings: prizesSettings, scenarios: 4 });
    expect(g.omega).toEqual({ title: tradeInternals(report.ctx).model.playoffWeight, other: tradeInternals(ctx).model.playoffWeight });
    const again = goalCompare(report.ctx, report.result, settings, { ctx, settings: prizesSettings });
    const cardsOf = (list: readonly TradeEvaluation[]) => list.map((t) => [t.key, t.b, t.tradeScore, t.pComplete, t.overall]);
    expect(cardsOf(again.result.trades)).toEqual(cardsOf(g.result.trades));
    expect(again.rows).toEqual(g.rows);
    expect(g.result).not.toBe(report.result);
    // Timed on the report's clock, the search reads its "Helps both" parts off its own progress (section 10); untimed, none.
    expect(again.parts).toBeNull();
    const gState = searchStateOf(g.result) as NonNullable<ReturnType<typeof searchStateOf>>;
    expect(g.parts?.extras.count).toBe(gState.helpsBothExtras.length);
    expect(g.parts?.calibrations.count).toBe(new Set([...gState.exactByKey.values()].map((x) => x.partner.id)).size);
    const topTitle = trades.slice(0, TOP_DETAIL).map((t) => t.key);
    const topOther = g.result.trades.slice(0, TOP_DETAIL).map((t) => t.key);
    expect(g.rows.map((r) => r.key)).toEqual([...new Set([...topTitle, ...topOther])]);
    expect(g.common).toBe(topTitle.filter((k) => topOther.includes(k)).length);
    expect(g.commonTop).toBe(topTitle.slice(0, GOAL_TOP).filter((k) => topOther.slice(0, GOAL_TOP).includes(k)).length);
    for (const row of g.rows) {
      for (const [side, list, c, s] of [
        [row.title, trades, report.ctx, settings],
        [row.other, g.result.trades, ctx, prizesSettings],
      ] as const) {
        const at = list.findIndex((t) => t.key === row.key);
        if (at >= 0) expect(side).toEqual({ rank: at + 1, b: list[at]?.b, helps: list[at]?.tradeScore, pComplete: list[at]?.pComplete, overall: list[at]?.overall });
        else {
          const t = trades.find((x) => x.key === row.key) ?? g.result.trades.find((x) => x.key === row.key);
          const e = analyzeTrade(c, (t as TradeEvaluation).proposal, { settings: s }).evaluation;
          expect(side).toEqual({ rank: null, b: e?.b ?? null, helps: e?.tradeScore ?? null, pComplete: e?.pComplete ?? null, overall: e?.overall ?? null });
        }
      }
    }
    // Every "Several prizes" card is weighed by the split, on its context's own B₃ (section 3's): B = B_win(ΔPO, ΔE[S]) + the
    // market term (B₃ / 3) × κ × clamp(g_mkt(me)) (planner reply to Checkpoint 7a, §2 question 5).
    const b3 = report.scale.b3.prizes?.b3 as number;
    expect(b3).toBe(helpsScaleOf(tradeInternals(ctx), settings.lambda)?.b3);
    for (const t of g.result.trades) {
      expect(t.b3).toBe(b3);
      if (t.b === null || t.dPO === null || !t.dPrizes) continue;
      const term = (b3 / config.benefit.helpsGain) * config.benefit.protectValue.medium * Math.min(0.5, Math.max(-0.5, t.gMine));
      expect(t.b).toBeCloseTo(benefitWin(t.dPO, t.dPrizes, reward) + term, 9);
    }
    const s = section(2);
    expect(s).toContain(`## 2. What does your league reward?: "Only the champion" against "Several prizes"`);
    expect(s).toContain(`the search the app runs under "Several prizes" on ${prizesWords(reward)} (from --prizes), against the default "Only the champion" (section 1).`);
    expect(s).toContain(`(Only the champion ${g.omega.title}×, Several prizes ${g.omega.other}×: planner reply to Checkpoint 7a, §6.1)`);
    expect(s).toContain(`${g.commonTop} of the top ${GOAL_TOP} and ${g.common} of the top ${TOP_DETAIL} are in both lists; "Several prizes" shows ${g.result.trades.length} cards ("Only the champion": ${trades.length}).`);
    const top = trades[0] as TradeEvaluation;
    expect(s).toContain(`**Top ${GOAL_TOP}, Only the champion:** #1 Team ${top.proposal.partnerId}: `);
    expect(s).toContain(`(Helps ${top.tradeScore} · ${chancePrinted(top.pComplete)} · Overall ${top.overall})`);
    expect(s).toContain(`**Top ${GOAL_TOP}, Several prizes:** `);
    expect(s).toContain("| Trade | Only the champion: # · B · Helps · goes through · Overall | Several prizes: # · B · Helps · goes through · Overall |");
    expect(s.split("\n").filter((l) => /^\| Team \d+: /.test(l))).toHaveLength(g.rows.length);
    // No amounts: the split is said in whole percents (the header's command line names the flag as typed).
    for (const amount of ["2,000", "1,600"]) expect(s).not.toContain(amount);
  });

  it("section 2 with a split that pays the weekly high score: its context simulates them, so nothing is priced from runs without them (the default goal's context refuses it)", () => {
    const weekly = prizesSettingsOf(settings, { first: 50, second: 30, third: null, weeklyHigh: 5, pointsLeader: 10 });
    expect(rewardWith(weekly, prizePeriods(report.snapshot)).shares.weeklyHigh).toBeGreaterThan(0);
    // The default goal's context didn't simulate the high scores: the engine refuses to price the split there.
    expect(() => runTradeSearch(report.ctx, { settings: weekly })).toThrow(/weekly high scores/);
    const ctx = buildTradeContext(report.snapshot, inputs, { now: TEST_NOW, settings: weekly, scenarios: 4 });
    expect(tradeInternals(ctx).sim?.highScores).toBe(true);
    expect(tradeInternals(report.ctx).sim?.highScores).toBe(false);
    const g = goalCompare(report.ctx, report.result, settings, { ctx, settings: weekly });
    expect(g.reward?.shares.weeklyHigh).toBeGreaterThan(0);
    for (const t of g.result.trades) expect(Number.isFinite(t.dPrizes?.weeklyHigh as number)).toBe(true);
    // Section 3 on that split: its B₃ from its own context, and the scale check's column on runs that simulated them.
    const sc = helpsScaleSection(report.snapshot, report.model, report.ctx, settings, (goal) => (goal === COMPARE_GOAL ? ctx : buildTradeContext(report.snapshot, inputs, { now: TEST_NOW, settings: { ...settings, goal }, scenarios: 4 })), weekly.prizes);
    expect(sc.b3.prizes?.b3).toBe(helpsScaleOf(tradeInternals(ctx), settings.lambda)?.b3);
    expect(sc.check?.rewards.prizes.shares.weeklyHigh).toBeGreaterThan(0);
    expect(sc.check?.rows?.every((r) => Number.isFinite(r.B.prizes) && Number.isFinite(r.dPrizes.weeklyHigh as number))).toBe(true);
  });

  it("section 3: B₃ under each goal (planner reply to Checkpoint 4c, A2): the calibration run, the search's scale and the scale check on it", () => {
    const sc = report.scale;
    // Each goal's B₃ off the context the app builds under that goal (its own ω; review of Phase 7b); "Several prizes" on the
    // league's split (Checkpoint 7c: --prizes), section 2's.
    const contextFor = (goal: (typeof GOALS)[number]) =>
      buildTradeContext(report.snapshot, inputs, { now: TEST_NOW, settings: goal === COMPARE_GOAL ? prizesSettingsOf(report.settings, PRIZES) : { ...report.settings, goal }, scenarios: 4 });
    expect(sc).toEqual(helpsScaleSection(snapshot, report.model, report.ctx, report.settings, contextFor, PRIZES));
    expect(tradeInternals(contextFor(COMPARE_GOAL)).model.playoffWeight).toBe(report.goals.omega.other);
    for (const g of GOALS) {
      const own = g === report.settings.goal ? tradeInternals(report.ctx) : tradeInternals(contextFor(g));
      expect(sc.b3[g]).toEqual(helpsScaleOf(own, report.settings.lambda));
      expect(sc.omega[g]).toBe(own.model.playoffWeight);
      expect(sc.calibrations[g]).toEqual(own.sim?.calibration ?? null);
    }
    const cal = sc.calibration as NonNullable<typeof sc.calibration>;
    expect(cal).toEqual(report.model.helpsCalibration);
    expect(cal.gain).toBe(config.benefit.helpsGain);
    // The trade context's run is the League model's, bit for bit; so is the scale check's +3 row.
    expect([sc.contextMatches, sc.checkMatches]).toEqual([true, true]);
    // B₃ is the search's: every card's Helps you and Overall read B on it.
    const b3 = sc.b3[report.settings.goal] as NonNullable<(typeof sc.b3)["title"]>;
    expect(report.result.trades.length).toBeGreaterThan(0);
    for (const t of report.result.trades) {
      expect(t.b3).toBe(b3.b3);
      expect(t.tradeScore).toBe(tradeScore(t.b, b3.b3));
      expect(t.overall).toBe(overallScore(t.b, t.pComplete, b3.b3));
    }
    const c = sc.check as NonNullable<typeof sc.check>;
    expect(c).toEqual(scaleCheckOf(snapshot, report.model, PRIZES));
    // The scale check's "Several prizes" column reads the league's split.
    expect(c.rewards.prizes).toEqual(report.goals.reward);
    expect(c.from).toBe(0); // no week under way in the synthetic league
    for (const row of c.rows ?? [])
      for (const g of GOALS) {
        expect(row.B[g]).toBeCloseTo(benefitWin(row.dPO, row.dPrizes, c.rewards[g]), 12);
        // On the default goal's baseline: its B₃ under each goal is that context's (a redraft league: no λ), the app's own
        // for the default goal.
        expect(c.b3[g].value).toBe(helpsScaleOf(tradeInternals(report.ctx), report.settings.lambda, c.rewards[g])?.b3);
        expect(row.score[g]).toBe(tradeScore(row.B[g], c.b3[g].value));
      }
    expect(c.b3[report.settings.goal].value).toBe(sc.b3[report.settings.goal]?.b3);
    // The baseline is the headline's: the model's own odds with pickups.
    const mine = report.model.odds?.teams.find((t) => t.teamId === "1");
    expect(c.base).toEqual({ pPlayoffs: mine?.pPlayoffs, pTitle: mine?.pTitle, expWins: mine?.expWins, prizes: prizeOddsOf(mine as NonNullable<typeof mine>) });
    expect(scaleCheck).toBeTypeOf("function");
    const s = section(3);
    expect(s).toContain("| Goal | Weights | ω | ΔPO₃ / ΔCH₃ | B₃ | Floored | +1 / +3 / +6 pts a week read | Giving 25% more value at Medium: B (pts a week) |");
    expect(s).toContain("off the trade context the app builds under that goal");
    for (const g of GOALS) {
      expect(s).toMatch(new RegExp(`\\| ${GOAL_WORDS[g]}[^|]* \\| ΔPO [^|]+ \\| ${String(sc.omega[g]).replace(".", "\\.")}× \\| [+−][\\d.]+ pts / [+−][\\d.]+ pts \\| \\d+\\.\\d{2} \\| (no|yes \\(raw [^)]+\\)) \\| \\+1 → \\d+, \\+3 → 63, \\+6 → \\d+ \\| −\\d+\\.\\d{2} \\(−0\\.4\\) \\|`));
      // The price is the market term on that goal's B₃: (B₃ / 3) × 2 × −0.2 (planner reply to Checkpoint 7a, §2 question 5).
      const b3g = sc.b3[g]?.b3 as number;
      expect(s).toContain(`| ${fmt(-(b3g / 3) * 0.4, 2)} (−0.4) |`);
    }
    expect(s).toContain("| Gain | ΔPO | ΔCH | Only the champion: B / Helps | Several prizes: B / Helps | Making the playoffs: B / Helps | Checkpoint 3's B (0.35 / 0.65) |");
    expect(s.split("\n").filter((l) => l.startsWith("| +"))).toHaveLength(3);
    expect(s).toContain("The trade context's own run (its shown block) is the same run, bit for bit.");
    expect(s).toContain("Its +3 row is the same run, bit for bit.");
    expect(s).not.toContain("bRef");
    // The dynasty scale in the intro (planner reply to Checkpoint 7a, §2 question 6: review SC-1's λ cap is gone), and the
    // searches' scale notes (none here: a redraft league whose odds move; review of track SC).
    expect(s).toContain("in a dynasty or keeper league with long-term values B_ref(λ) = (1 − λ) × that + λ × F₁₀, F₁₀ = 4, the B of +10% long-term value");
    expect(s).toContain("κ 1 / 2 / 4 points a week per 100% of trade value at Low / Medium / High");
    expect(s).not.toContain("at most 0.75");
    for (const g of GOALS) expect(sc.b3[g]?.reason).toBeNull();
    expect(s).toContain("No goal's B₃ is floored: no search shows a note on the scale.");
  });

  it("section 4: the named trade's funnel from the search's own state, and the screened counts per partner that reproduce the search", () => {
    const g = report.gap;
    expect(g.missing).toBeNull();
    const trade = g.trade as NonNullable<typeof g.trade>;
    expect(trade).toMatchObject({ partnerId: "2", give: [ids.wilson], get: [ids.hubbard, ids.evans] });
    expect(GAP_TRADE.get).toEqual(["Chuba Hubbard", "Mike Evans"]);
    // The re-screening reproduces the search: the counts add up, every exact trade is in the rebuilt shortlist, among its lean
    // companions or (Checkpoint 7d) in the rebuilt helps-both lane with its own, and that lane is the search's.
    expect(g.reproduces).toEqual({ counts: true, shortlist: true, lane: true });
    expect(g.perPartner.reduce((n, p) => n + p.exhaustive, 0)).toBe(report.result.counts.screened);
    // The beams alone, per partner, add up to the beams-alone search's own count.
    expect(g.perPartner.reduce((n, p) => n + p.beams, 0)).toBe(report.beams.result.counts.screened);
    expect(g.perPartner.reduce((n, p) => n + p.cards, 0)).toBe(trades.length);
    const state = searchStateOf(report.result) as NonNullable<ReturnType<typeof searchStateOf>>;
    expect(g.perPartner.reduce((n, p) => n + p.exact, 0)).toBe(state.exactByKey.size);
    // Final runs: the finalists and (Checkpoint 7c) the "Helps both" extras, counts.simFinal.
    expect(g.perPartner.reduce((n, p) => n + p.finalRuns, 0)).toBe(state.finals.length);
    expect(report.result.counts.simFinal).toBe(state.finals.length);
    // Each stage follows from the one before (a card is a finalist, which was evaluated exactly, shortlisted, kept, screened).
    expect(g.exact).toBe(state.exactByKey.has(trade.key));
    expect(g.finalist).toBe(state.finals.some((f) => f.key === trade.key) && !state.helpsBothExtras.includes(trade.key));
    expect(g.extra).toBe(state.helpsBothExtras.includes(trade.key));
    expect(g.finalist && g.extra).toBe(false);
    expect(g.card).toBe(trades.findIndex((t) => t.key === trade.key) + 1 || null);
    if (g.card) expect(g.finalist).toBe(true);
    if (g.finalist || g.extra) expect(g.exact).toBe(true);
    if (g.exact) expect(g.shortlisted || g.lane || state.companions.includes(trade.key)).toBe(true);
    expect(g.lane).toBe([...state.lane.trades, ...state.lane.companions].includes(trade.key));
    if (g.shortlisted) expect(g.kept).not.toBeNull();
    if (g.kept) expect(g.inWindow).toBe(true);
    if (g.beams) expect(g.screened).not.toBeNull();
    expect(g.evaluation?.key).toBe(trade.key);
    expect(g.onlyExhaustive.exact).toBeLessThanOrEqual(state.exactByKey.size);
    const s = section(4);
    // The final runs in words: the finalists and the extras apart (a fact of the synthetic data: it has extras).
    expect(state.helpsBothExtras.length).toBeGreaterThan(0);
    expect(s).toContain(`; ${exactText(report.result)}, ${finalRunsText(report.result)}, ${trades.length} cards (the beams alone: `);
    // The exact trades in words (Checkpoint 7d): the helps-both lane's legal ones among them (a fact of the synthetic data: it has some).
    const fromLane = [...state.lane.trades, ...state.lane.companions].filter((k) => state.exactByKey.has(k)).length;
    expect(fromLane).toBeGreaterThan(0);
    expect(exactText(report.result)).toBe(`${report.result.counts.exact} exact (${fromLane} from the helps-both lane: section 10)`);
    // The extras of the pool and (Checkpoint 7d, the final review, ENG-7D-1) the finalists the lane displaced, named apart.
    const displacedRuns = state.laneDisplaced.length;
    const poolExtras = state.helpsBothExtras.length - displacedRuns;
    const finalParts = [`${state.finals.length - state.helpsBothExtras.length} finalists`, ...(poolExtras ? [`${poolExtras} "Helps both" extra${poolExtras === 1 ? "" : "s"}`] : []), ...(displacedRuns ? [`${displacedRuns} finalist${displacedRuns === 1 ? "" : "s"} the helps-both lane displaced`] : [])];
    expect(finalRunsText(report.result)).toBe(`${state.finals.length} final runs (${finalParts.length > 2 ? `${finalParts.slice(0, -1).join(", ")} and ${finalParts.at(-1)}` : finalParts.join(" and ")}: section 10)`);
    expect(s).toContain(`of the ${state.finals.length} final runs, `);
    expect(s).toContain("| Partner | Screened | Beams alone | Exact | Final runs | Cards |");
    expect(s).toContain("**Garrett Wilson → Chuba Hubbard + Mike Evans** (Team 2): ");
    expect(s).toContain(`they add up to the search's ${report.result.counts.screened.toLocaleString("en-US")} ✅, every trade it evaluated exactly is in the rebuilt shortlist, among its lean companions or in the rebuilt helps-both lane with its own ✅, and that lane is the search's ✅.`);
    expect(s).toContain("| Stage | Cold | Warm (median of 1) | Beams alone (median of 1) |");
    expect(report.runtime.sameEveryRun).toBe(true);
  });

  it("section 5: the minimum-chance filter re-filtered from the one search at every option", () => {
    const rows = report.filter as NonNullable<typeof report.filter>;
    expect(rows.map((r) => r.minChance)).toEqual([...config.ranking.minChanceOptions]);
    // The search's own minimum reproduces its list; qualifying + hidden by the minimum is the same at every option.
    expect(rows.find((r) => r.minChance === settings.minChance)?.same).toBe(true);
    expect(rows.filter((r) => r.minChance !== settings.minChance).every((r) => r.same === null)).toBe(true);
    const guarded = rows.map((r) => r.qualifying + r.byChance);
    expect(new Set(guarded).size).toBe(1);
    for (let i = 1; i < rows.length; i++) expect((rows[i] as (typeof rows)[number]).qualifying).toBeLessThanOrEqual((rows[i - 1] as (typeof rows)[number]).qualifying);
    expect(rows[0]?.few).toBe(false); // never at Any
    expect(section(5).split("\n").filter((l) => /^\| (Any|at least)/.test(l))).toHaveLength(rows.length);
  });

  it("section 6: the most extreme blend factors before the clamp, each with its reason, and every factor the clamp cut", () => {
    const b = report.blend;
    expect(b.rows.length).toBeLessThanOrEqual(BLEND_EXTREMES);
    expect(b.rows.length).toBeGreaterThan(0);
    const far = (f: number) => Math.abs(Math.log(f));
    for (let i = 1; i < b.rows.length; i++) expect(far((b.rows[i - 1] as (typeof b.rows)[number]).fRaw)).toBeGreaterThanOrEqual(far((b.rows[i] as (typeof b.rows)[number]).fRaw) - 1e-12);
    for (const r of b.rows) {
      expect(r.reason).toBe(blendReason(r));
      expect(r.actualPpg).toBe(I.model.players[r.id]?.base.actualPpg ?? null);
      if (r.clamped) expect(r.f).toBe(r.clamped === "high" ? config.marketBlend.factorClamp[1] : config.marketBlend.factorClamp[0]);
    }
    expect(b.clamped.every((r) => r.clamped !== null)).toBe(true);
    expect(section(6).split("\n").filter((l) => /^\| \d+ \| /.test(l))).toHaveLength(b.rows.length);
  });

  it("section 7: odds by waiver order; a dump from before the 4c adapter runs on the reset order (the headline: the model every section used), the dump's own ranks are the live order; the search's baseline is LeagueModel.odds", () => {
    const o = report.odds;
    expect(o.data).toBe("pre4c");
    expect(o.baselineEqual).toBe(true);
    // The headline row is the model the report ran on, in the reset order the report built; it is today's standings reversed.
    expect(o.reset?.model).toBe(report.model);
    expect(o.reset?.order).toEqual(RESET_ORDER);
    expect(o.reset?.place).toBe(RESET_ORDER.indexOf("1") + 1);
    expect(resetWaiverOrder(report.model)).toEqual(RESET_ORDER);
    expect(o.resetMatchesStandings).toBe(true);
    // The live order: the dump's own ranks (now Team.liveWaiverRank), in a model of its own.
    expect(o.live?.model).not.toBe(report.model);
    expect(o.live?.order).toEqual(LIVE_ORDER);
    expect(o.live?.place).toBe(6);
    // As rosters stand: the headline model's second line.
    expect(o.stand).toEqual(report.model.oddsAsRostersStand?.teams.find((t) => t.teamId === "1"));
    for (const w of o.weekly) {
      expect(w.reset).toBe(report.model.odds?.weekly.find((x) => x.week === w.week)?.games.find((g) => g.teamId === "1")?.pWin ?? null);
      expect(w.live).toBe(o.live?.model.odds?.weekly.find((x) => x.week === w.week)?.games.find((g) => g.teamId === "1")?.pWin ?? null);
    }
    const s = section(7);
    expect(s).toContain("The trade search's baseline equals LeagueModel.odds exactly (every team, every week, the notes) ✅.");
    expect(s).toContain("The reset order this report built (the 4c adapter's rule: win percentage, then points for) is today's standings by the league's rules reversed (the simulator's ranks) ✅.");
    expect(s).toContain(`| **With pickups, weekly reset order (the headline)** | built by this report from today's standings (reverse standings: the 4c adapter's rule), since the dump comes from before the 4c adapter: ${RESET_ORDER.join(" > ")} |`);
    expect(s).toContain(`| With pickups, live order | the dump's own ranks (ESPN's order on the day of the import), now Team.liveWaiverRank, in place of waiverRank: ${LIVE_ORDER.join(" > ")} | 6th |`);
  });

  it("a dump from before the 4c adapter with no game played keeps its own order (the adapter's rule), and says so", () => {
    const early: LeagueSnapshot = { ...snapshot, teams: snapshot.teams.map((t) => ({ ...t, record: { w: 0, l: 0, t: 0 }, pointsFor: 0 })) };
    const { snapshot: s, pre4c } = asWeeklyResetData(early);
    expect(pre4c).toEqual({ live: LIVE_ORDER, used: LIVE_ORDER, waiverOrderUsed: "live" });
    expect(s.settings.waiverOrderUsed).toBe("live");
    expect(s.teams.map((t) => t.waiverRank)).toEqual(early.teams.map((t) => t.waiverRank));
    expect(s.warnings.map((w) => w.code)).toContain("ESPN_WAIVER_RESET_BEFORE_GAMES");
    const text = pre4cText(pre4c as Pre4cOrder, "1", (id) => `Team ${id}`);
    expect(text).toContain("so every number here runs on the dump's own order: no game had been played, so there were no standings to reset to.");
    expect(text).not.toContain("liveWaiverRank");
  });

  it("section 7 on 4c data: the weekly reset order is the data's own, the live one from Team.liveWaiverRank, and the reset order checked against today's standings", () => {
    const fresh: LeagueSnapshot = {
      ...snapshot,
      settings: { ...snapshot.settings, waiverOrderUsed: "weeklyReset" },
      teams: snapshot.teams.map((t) => ({ ...t, waiverRank: RESET_ORDER.indexOf(t.id) + 1, liveWaiverRank: LIVE_ORDER.indexOf(t.id) + 1 })),
    };
    expect(dataOrderOf(fresh)).toBe("weeklyReset");
    const opts = { now: TEST_NOW, settings, scenarios: 0 };
    const model = buildLeagueModel(fresh, inputs, opts);
    const ctx = report.ctx; // another context: the baseline check fails, as it should
    const o = oddsByOrder(fresh, inputs, model, ctx, opts);
    expect(o.data).toBe("weeklyReset");
    expect(o.reset?.model).toBe(model);
    expect(o.reset?.how).toBe("the data's own: the 4c adapter's weekly reset order (reverse standings)");
    expect(o.reset?.order).toEqual(RESET_ORDER);
    expect(o.resetMatchesStandings).toBe(true);
    expect(o.live?.order).toEqual(LIVE_ORDER);
    expect(o.live?.place).toBe(6);
    expect(o.baselineEqual).toBe(false);
    // Without the live ranks: not available, and said so.
    const noLive = { ...fresh, teams: fresh.teams.map((t) => ({ ...t, liveWaiverRank: undefined })) };
    const o2 = oddsByOrder(noLive, inputs, model, ctx, opts);
    expect(o2.live).toBeNull();
    expect(o2.liveMissing).toBe("the data has no live order (Team.liveWaiverRank)");
    // A dump still from before the 4c adapter (a caller that didn't put it on the 4c rule): its own order, no reset row.
    const o3 = oddsByOrder(snapshot, inputs, model, ctx, opts);
    expect(o3.data).toBe("pre4c");
    expect(o3.reset).toBeNull();
    expect(o3.resetMissing).toContain("wasn't put on its rule");
  });

  it("section 8: neutral throw-ins against their lean versions, unrounded (review of track R, R-1 and R-5)", () => {
    for (const n of report.neutral) {
      const t = n.trade;
      expect(n.removed.map((x) => x.id)).toEqual(neutralThrowIns(playerIds(t, "get"), playerIds(t, "give"), I.values, I.credit).removed);
      for (const x of n.removed) expect(x.value).toBeLessThanOrEqual(I.credit);
      // The lean version is the Analyzer's, and both expected gains are B × the chance it goes through.
      expect(n.eg.card).toBe(expectedGain(t));
      if (n.lean) {
        const lean = { partnerId: t.proposal.partnerId, give: t.proposal.give.filter((a) => a.kind !== "player" || !n.removed.some((x) => x.id === a.id)), get: t.proposal.get.filter((a) => a.kind !== "player" || !n.removed.some((x) => x.id === a.id)) };
        expect(n.lean).toEqual(analyzeTrade(report.ctx, lean, { settings }).evaluation);
        expect(n.eg.lean).toBe(expectedGain(n.lean));
      }
    }
    expect(report.neutral.map((n) => n.rank)).toEqual(trades.flatMap((t, i) => (neutralThrowIns(playerIds(t, "get"), playerIds(t, "give"), I.values, I.credit).removed.length ? [i + 1] : [])));
    // The rule as built: up to the difference in player counts, the lowest-valued players worth at most W; then matched pairs.
    const s = section(8);
    expect(s).toContain(`(planner change 2 as built, market.neutralThrowIns: on the side giving more players, up to the difference in player counts, its lowest-valued players worth at most W = ${Math.round(I.credit).toLocaleString("en-US")}, then matched pairs of such players, one from each side, cheapest first, count in neither side's value, only in c; the search evaluates the lean version of every shortlisted trade that has one (search.leanCompanions))`);
    if (report.neutral.length) {
      // One table row per card: the chances unrounded to one decimal with their change, B, the expected gains, the printed numbers.
      const rows = s.split("\n").filter((l) => /^\| #\d+ Team \d+: /.test(l));
      expect(rows).toHaveLength(report.neutral.length);
      report.neutral.forEach((n, i) => {
        const lean = n.lean;
        if (!lean) return;
        expect(rows[i]).toContain(`| ${pctPlain(n.trade.pAccept)} → ${pctPlain(lean.pAccept)} (${pts(lean.pAccept - n.trade.pAccept)})`);
        expect(rows[i]).toContain(`| ${fmt(n.trade.b, 2)} → ${fmt(lean.b, 2)} |`);
        expect(rows[i]).toContain(`| ${fmt(n.eg.card, 3)} → ${fmt(n.eg.lean, 3)} (${signed((n.eg.lean as number) - (n.eg.card as number), 3)}) |`);
        expect(rows[i]).toContain(`| ${threeNumbers(n.trade)} · ${threeNumbers(lean)} |`);
      });
      const likelier = report.neutral.filter((n) => n.lean && n.lean.pAccept > n.trade.pAccept + 1e-9).length;
      expect(s).toContain(`the lean version is likelier to be accepted on ${likelier} of ${report.neutral.filter((n) => n.lean).length}`);
    } else expect(s).toContain("no card carries one.");
  });

  it("section 8: the kickoff jump and the weeks every team's pickups move", () => {
    // The synthetic league has no kickoff times: no jump; with them, as rosters stand the odds don't move at the kickoff.
    expect(report.kickoff).toBeNull();
    const teams = [...new Set(Object.values(snapshot.players).flatMap((p) => (p.nflTeam ? [p.nflTeam] : [])))].sort();
    const kickoffs: Record<string, string> = Object.fromEntries(teams.map((t, i) => [t, i === 0 ? "2026-10-08T00:15:00.000Z" : "2026-10-11T17:00:00.000Z"]));
    const timed: ModelInputs = { ...inputs, nfl: { ...inputs.nfl, kickoffs: { [snapshot.currentWeek]: kickoffs } } };
    const k = kickoffJump(snapshot, timed, { settings, scenarios: 0 }) as NonNullable<ReturnType<typeof kickoffJump>>;
    expect(k.kickoff).toBe("2026-10-08T00:15:00.000Z");
    expect(k.stand).toEqual({ dPO: 0, dCH: 0 });
    expect(k.mine.before).not.toBeNull();
    // The weeks: at least weeklyLineMin apart, at most the asked number, in week order.
    const w = pickupWeeks(report.model, 5);
    for (const x of w) expect(Math.abs(x.withPickups - x.asStands)).toBeGreaterThanOrEqual(config.explain.weeklyLineMin - 1e-9);
    expect(w.map((x) => x.week)).toEqual([...w.map((x) => x.week)].sort((a, b) => a - b));
    expect(report.pickupWeeks).toEqual(pickupWeeks(report.model));
  });

  it("section 9: my open roster spots under Checkpoint 7b's rule and now, every exact trade grouped, the partners' spots, the keep set (planner reply to Checkpoint 7b, section 5)", () => {
    const o = report.openSpots;
    const state = searchStateOf(report.result);
    expect(o.exact).toBe(state?.exactByKey.size);
    // Facts of the synthetic data: the search's exact trades open my spot, and the cards hold some.
    expect(o.exactMine).toBeGreaterThan(0);
    expect(o.rows.length).toBeGreaterThan(0);
    // Every card that opens my spot is a row; each row's numbers now are the Analyzer's on the report's context, its card
    // number its place on the list, and under Checkpoint 7b's rule every spot reads "any position".
    for (const t of trades) if (t.required.me.openSpots?.length) expect(o.rows.some((x) => x.key === t.key)).toBe(true);
    for (const row of o.rows) {
      expect(row.now).toEqual(analyzeTrade(report.ctx, row.proposal, { settings }).evaluation);
      if (row.card.now !== null) expect(trades[row.card.now - 1]?.key).toBe(row.key);
      for (const s of row.before?.required.me.openSpots ?? []) expect(s.pos).toBeNull();
      for (const s of row.now?.required.me.openSpots ?? []) if (s.pos !== null) expect(snapshot.players[s.playerId]?.pos).toBe(s.pos);
    }
    expect(o.rows.filter((x) => x.card.now === null && x.card.before === null).length).toBeLessThanOrEqual(OPEN_SPOT_FINALISTS);
    // "This search's finalists" are the ranking's: never a "Helps both" extra, which only the second list ranks (Checkpoint 7c).
    const ranked = new Set(rankedFinals(state).map((f) => f.key));
    for (const row of o.rows) {
      expect(row.finalist).toBe(ranked.has(row.key));
      if (row.card.now === null && row.card.before === null) expect(state?.helpsBothExtras).not.toContain(row.key);
    }
    // The groups count every exact trade that opens my spot once.
    expect(o.groups.reduce((s, g) => s + g.trades, 0)).toBe(o.exactMine);
    // The partners' spots: every shown card with one. One that takes my own baseline pickup is flagged only when the partner
    // claims before me (the engine's OpenSpot.yours; review of Phase 7c's fill, finding pickups-5).
    expect(o.partner.map((p) => p.rank)).toEqual(trades.flatMap((t, i) => (t.required.partner.openSpots?.length ? [i + 1] : [])));
    for (const p of o.partner) {
      expect(p.takesMine).toBe(p.trade.required.partner.openSpots?.some((s) => s.yours === true) ?? false);
      if (p.takesMine) expect(I.byId.get(p.trade.proposal.partnerId)?.claimRank ?? Infinity).toBeLessThan(I.me?.claimRank ?? -1);
    }
    // The keep set holds every fill; the counts add up.
    expect(o.fills.kept).toBe(0);
    expect(o.fills.same + o.fills.fallback).toBe(o.fills.spots);
    expect(o.fills.spots).toBeGreaterThanOrEqual(o.fills.sides);
    // Rendered: one row per trade, per group and per partner card.
    const s = section(9);
    expect(s).toContain(`with its own search: ${o.beforeCards} cards there, ${trades.length} here.`);
    expect(s.split("\n").filter((l) => /^\| Team \d+: /.test(l))).toHaveLength(o.rows.length);
    expect(s.split("\n").filter((l) => /^\| #\d+ Team \d+: /.test(l))).toHaveLength(o.partner.length);
    expect(s).toContain(`Every side with an open spot in the search's ${o.exact} exact trades: ${o.fills.sides} sides, ${o.fills.spots} spots`);
    expect(s).toContain(`without the keep set they'd drop the fill on ${o.fills.unkept} of these sides.`);
  });

  it("section 10: the trades that help both at each stage under each setting, from each search's state (planner reply to Checkpoint 7b, §7)", () => {
    const h = report.helpsBoth;
    expect(h.counts.title).toEqual(helpsBothCounts(report.result));
    expect(h.counts.other).toEqual(helpsBothCounts(report.goals.result));
    for (const [r, c] of [
      [report.result, h.counts.title],
      [report.goals.result, h.counts.other],
    ] as const) {
      const st = searchStateOf(r) as NonNullable<ReturnType<typeof searchStateOf>>;
      const n = c as NonNullable<typeof c>;
      // The exact trades on their screening numbers, the run the extras are chosen on.
      const screen = [...st.exactByKey.keys()].map((k) => st.versions.get(k)?.screen as TradeEvaluationCore);
      expect(n.exact.total).toBe(st.exactByKey.size);
      // Helps you at least the minimum, as Helps them (planner reply to Checkpoint 7c, answer 5: above 0 before).
      expect(n.exact.helpsYou).toBe(screen.filter((x) => (x.tradeScore ?? 0) >= config.benefit.helpsThemMin).length);
      expect(n.exact.both).toBe(screen.filter((x) => helpsBoth(x)).length);
      expect(n.exact.shown).toBe(screen.filter((x) => helpsBoth(x) && !x.flags.hiddenByMarket).length);
      // The extras: the pool's trades the ranking hadn't picked, checked again on the final run; the pool, the first `room`
      // candidates, the room helpsBothFinalists and one more for each candidate from the helps-both lane (LANE-2; the final
      // review, ENG-7D-2: counted as the search chose it, "already finalists" counted, never a difference).
      const fromLane = new Set([...st.lane.trades, ...st.lane.companions]);
      const candidates = screen.filter((x) => helpsBoth(x) && !x.flags.hiddenByMarket);
      expect(n.room).toBe(config.search.helpsBothFinalists + candidates.filter((x) => fromLane.has(x.key)).length);
      expect(n.pool).toBe(Math.min(n.exact.shown, n.room));
      expect(n.picked).toBeGreaterThanOrEqual(0);
      expect(n.picked + n.extras).toBe(n.pool);
      // Every trade only the "Helps both" list ranks: the pool's extras, then the finalists the lane displaced (ENG-7D-1).
      expect(n.extras + st.laneDisplaced.length).toBe(st.helpsBothExtras.length);
      const poolExtras = st.helpsBothExtras.slice(0, n.extras);
      expect(n.stillBoth).toBe(st.finals.filter((f) => poolExtras.includes(f.key) && helpsBoth(f)).length);
      expect(n.finalists.total + st.helpsBothExtras.length).toBe(st.finals.length);
      expect(n.cards).toEqual({ total: r.trades.length, both: r.trades.filter((t) => helpsBoth(t)).length });
      // The list is the search's own; every card on it helps both on its final numbers.
      expect(n.list).toBe(r.helpsBoth);
      for (const t of n.list.trades) expect(helpsBoth(t)).toBe(true);
      expect(n.onOverall).toBe(n.list.trades.filter((t) => r.trades.some((x) => x.key === t.key)).length);
      expect(n.fromExtras).toBe(n.list.trades.filter((t) => st.helpsBothExtras.includes(t.key)).length);
    }
    // Facts of the synthetic data, so the checks aren't empty: trades help both under each setting, extras among them.
    expect(h.counts.title?.list.trades.length).toBeGreaterThan(0);
    expect(h.counts.other?.list.trades.length).toBeGreaterThan(0);
    expect(h.counts.other?.extras).toBeGreaterThan(0);
    const s = section(10);
    // The intro's words for B_P and its scale follow the league type (a redraft league here: no mix; review HBR-2).
    expect(s).toContain(`"Helps them" is the partner's Helps you from the same runs (${helpsThemScaleWords(report.snapshot.settings.leagueType)}), and a trade helps both`);
    expect(report.snapshot.settings.leagueType).toBe("redraft");
    expect(s).toContain("| Trades that help both | Only the champion | Several prizes (the split) |");
    expect(s.split("\n").filter((l) => /^\| (Exact trades, screening run|The extras: the first|Finalists the ranking|Overall cards \(|\*\*The "Helps both" list|… qualifying)/.test(l))).toHaveLength(6);
    const t = h.counts.title as HelpsBothCounts;
    expect(s).toContain(`| ${t.exact.helpsYou} · ${t.exact.theirB} · ${t.exact.helpsThem} · ${t.exact.both} (${t.exact.shown}) of ${t.exact.total} |`);
  });

  it("section 10: the split's list with the partner's odds before → after and each partner's scale", () => {
    const h = report.helpsBoth;
    const s = section(10);
    const list = report.goals.result.helpsBoth?.trades ?? [];
    // The split pays 2nd and 3rd place, so the partner's top-3 odds show as yours do (tradeView.topPlacesOf).
    expect(h.places).toBe(topPlacesOf(report.goals.reward));
    expect(h.places).toBe(3);
    const splitState = searchStateOf(report.goals.result) as NonNullable<ReturnType<typeof searchStateOf>>;
    const rows = s.split("\n").filter((l) => /^\| \d+ \| Team \d+ \| /.test(l));
    expect(rows).toHaveLength(Math.min(HELPS_BOTH_SHOWN, list.length));
    rows.forEach((row, i) => {
      const card = list[i] as TradeEvaluation;
      const th = card.them as NonNullable<TradeEvaluation["them"]>;
      expect(row.startsWith(`| ${i + 1} | Team ${card.proposal.partnerId} | `)).toBe(true);
      expect(row).toContain(`| ${card.tradeScore} | ${th.helps} | ${chancePrinted(card.pAccept)} ${card.acceptLabel}`);
      // Their odds from the same runs as mine: before (the block's baseline) and before + the change.
      expect(row).toContain(`| ${titleMove(th.before.pTitle, th.dCH)} | ${playoffMove(topChance(th.before.prizes, 3), topChance(th.dPrizes, 3))} | ${playoffMove(th.before.pPlayoffs, th.dPO)} |`);
      const at = report.goals.result.trades.findIndex((x) => x.key === card.key);
      expect(row.endsWith(at >= 0 ? `| card #${at + 1} |` : splitState.helpsBothExtras.includes(card.key) ? "| no: an extra |" : "| no: a finalist it leaves out |")).toBe(true);
    });
    // Each partner's scale under the split (evaluate.partnerScaleOf on section 2's context), each card's Helps them on it.
    const others = splitState.I.teams.filter((x) => x.id !== splitState.I.me?.id);
    expect(h.scales.map((x) => x.teamId)).toEqual(others.map((x) => x.id));
    // The list is labeled as the scale Helps them divides by, B_ref,P (B₃,P here: review HBR-2).
    expect(s).toContain(`Each partner's "Helps them" scale under it, B_ref,P (B₃,P unless it mixes in long-term value): `);
    for (const x of h.scales) {
      expect(x.scale).toEqual(partnerScaleOf(splitState.I, others.find((o) => o.id === x.teamId) as (typeof others)[number], report.goals.reward));
      expect(s).toContain(`Team ${x.teamId} ${scaleText(x.scale)}`);
      // A redraft league mixes nothing in: B_ref,P is B₃,P.
      expect(x.scale?.lambda ?? null).toBeNull();
      if (x.scale) expect(x.scale.b3).toBe(x.scale.b3P);
    }
    for (const card of list) expect(card.them?.b3).toBe(h.scales.find((x) => x.teamId === card.proposal.partnerId)?.scale?.b3);
  });

  it("section 10: the extra runtime, each run's parts read off its own progress, against the same search without Helps them run after each of section 4's", () => {
    const h = report.helpsBoth;
    const st = searchStateOf(report.result) as NonNullable<ReturnType<typeof searchStateOf>>;
    const partners = new Set([...st.exactByKey.values()].map((x) => x.partner.id)).size;
    // Every run of section 4, the cold one too: one calibration run per partner of the exact trades, the extras' final runs.
    for (const r of [report.runtime.cold, ...report.runtime.runs]) {
      expect(r.parts?.calibrations.count).toBe(partners);
      expect(r.parts?.calibrations.ms).toBeGreaterThan(0);
      expect(r.parts?.extras.count).toBe(st.helpsBothExtras.length);
    }
    // Without Helps them, one run after each timed one: no calibration run made, no extra, an empty second list, and the
    // Overall list the same, card by card (the engine's own test pins it).
    const w = h.without;
    expect(w.runtime.runs).toHaveLength(report.runtime.runs.length);
    expect(w).toMatchObject({ calibrated: 0, extras: 0, list: 0 });
    for (const r of w.runtime.runs) {
      expect(r.parts?.extras).toEqual({ count: 0, ms: 0 });
      // The yields still come, one a partner, each a memo hit.
      expect(r.parts?.calibrations.count).toBe(partners);
    }
    expect(w.runtime.sameEveryRun).toBe(true);
    expect(h.differs).toEqual([]);
    expect(h.cost).toEqual(helpsBothCost(report.runtime, w.runtime));
    expect(h.cost.with).toEqual({ cold: report.runtime.cold.search.total, warm: report.runtime.search.total });
    const s = section(10);
    expect(s).toContain(`without it the Overall list is the same ${trades.length} cards with the same numbers, boxes and words ✅`);
    expect(s).toContain(`| | Cold | Warm (median of ${report.runtime.runs.length}) |`);
    for (const label of [`| The partner calibration runs (${partners}, one per partner of the exact trades) |`, `| The extras' final runs (${st.helpsBothExtras.length}) |`, `| Helps them's share of the ranking stage: the shown pass's partner scales and the second list's cards on ${config.simulation.shownSims.toLocaleString("en-US")} seasons, its ranking, Plan B and words | – |`, "| **The extra: the three parts** |", `| Search total with "Helps them" (the app: section 4's) |`, "| Search total without (with, less the extra: ⚠️ derived) |"]) expect(s).toContain(label);
    // The runs without it as measured, against section 4's with their own sign (review HBR-1); the suite times one run a set,
    // so no spread from run to run is printed (it read "up to 0.0 ms") and no cause it doesn't compute.
    const m = h.cost.measured;
    expect(m.spread).toBeNull();
    expect(m.untouched).toBeNull();
    const diff = (m.without as number) - (h.cost.with.warm as number);
    expect(s).toContain(` ${measuredRunsText(h.cost)}`);
    expect(s).toContain(diff < 0 ? " under section 4's " : diff > 0 ? " over section 4's " : " the same as section 4's ");
    expect(s).toContain("from one timed run a set (no spread from run to run), so the totals without are section 4's less the three parts.");
    expect(s).not.toContain("from section 4's");
    expect(s).not.toContain("mostly in screening");
    // The split's one search (section 2's), its parts read the same way.
    const gs = searchStateOf(report.goals.result) as NonNullable<ReturnType<typeof searchStateOf>>;
    expect(report.goals.parts?.extras.count).toBe(gs.helpsBothExtras.length);
    expect(s).toContain(`Under "Several prizes", section 2's one search (warm, `);
    const gp = report.goals.parts as NonNullable<typeof report.goals.parts>;
    expect(s).toContain(`its ${gp.calibrations.count} calibration run${gp.calibrations.count === 1 ? "" : "s"} `);
    expect(s).toContain(`its ${gp.extras.count} ${gp.extras.count === 1 ? "extra's final run" : "extras' final runs"} `);
    // The console summary's part (review HBR-3): the split's counts, the extra as measured under section 1's setting.
    const o = h.counts.other as HelpsBothCounts;
    const summary = helpsBothSummary(h, report.settings.goal);
    expect(summary.startsWith(`${o.exact.both} of ${o.exact.total} exact trades help`)).toBe(true);
    // Checkpoint 7d: the lane under the split, then the cost of each.
    const lo = h.lane.counts.other as NonNullable<typeof h.lane.counts.other>;
    expect(summary).toContain(` both on the screening run, the list shows ${o.list.trades.length} (${o.fromExtras} from the extras); the helps-both lane adds ${lo.exact} exact trade`);
    expect(summary).toContain(`, ${lo.list} on the list (${h.lane.before.other?.list.trades.length} card`);
    expect(summary).toContain(" without the lane); Helps both costs ");
    expect(summary).toContain(" a search warm, the lane ");
    expect(summary.endsWith(" (Only the champion, section 4's runs)")).toBe(true);
  });

  it("section 10 (Checkpoint 7d): the helps-both lane under each setting from each search's state, the counts without it, the Overall cards it changes, and what it costs", () => {
    const l = report.helpsBoth.lane;
    expect(l.counts.title).toEqual(laneCounts(report.result));
    expect(l.counts.other).toEqual(laneCounts(report.goals.result));
    for (const [r, c, before, differs] of [
      [report.result, l.counts.title, l.before.title, l.differs.title],
      [report.goals.result, l.counts.other, l.before.other, l.differs.other],
    ] as const) {
      const st = searchStateOf(r) as NonNullable<ReturnType<typeof searchStateOf>>;
      const n = c as NonNullable<typeof c>;
      const fromLane = new Set([...st.lane.trades, ...st.lane.companions]);
      expect(n).toMatchObject({ qualifying: st.lane.qualifying, onShortlist: st.lane.onShortlist, trades: st.lane.trades.length, companions: st.lane.companions.length });
      expect(n.trades).toBeLessThanOrEqual(config.search.helpsBothLane);
      expect(n.exact).toBe([...fromLane].filter((k) => st.exactByKey.has(k)).length);
      expect(n.screenBoth).toBe([...fromLane].filter((k) => st.exactByKey.has(k) && helpsBoth(st.versions.get(k)?.screen as TradeEvaluationCore)).length);
      expect(n.finalists + n.extras).toBe(st.finals.filter((f) => fromLane.has(f.key)).length);
      expect(n.extras).toBe(st.helpsBothExtras.filter((k) => fromLane.has(k)).length);
      expect(n.finalBoth).toBe(st.finals.filter((f) => fromLane.has(f.key) && helpsBoth(f)).length);
      expect(n.list).toBe((r.helpsBoth?.trades ?? []).filter((t) => fromLane.has(t.key)).length);
      expect(n.overall).toBe(r.trades.filter((t) => fromLane.has(t.key)).length);
      // The finalists its trades displace, kept for the "Helps both" list (the final review, ENG-7D-1): never the lane's own.
      const displaced = new Set(st.laneDisplaced);
      expect(n.displaced.kept).toBe(displaced.size);
      for (const k of displaced) expect(fromLane.has(k)).toBe(false);
      expect(n.displaced.both).toBe(st.finals.filter((f) => displaced.has(f.key) && helpsBoth(f)).length);
      expect(n.displaced.listed).toBe((r.helpsBoth?.trades ?? []).filter((t) => displaced.has(t.key)).length);
      // The same search without the lane evaluates exactly the shortlist and its companions: the lane's legal trades fewer.
      expect(before?.exact.total).toBe(r.counts.exact - n.exact);
      expect(differs).toBeLessThanOrEqual(r.trades.length);
      // A fact of the synthetic data: the lane holds trades under each setting.
      expect(n.trades).toBeGreaterThan(0);
    }
    // Its cost: every run of section 4, the cold one too, reads the lane's parts off its own progress.
    const st = searchStateOf(report.result) as NonNullable<ReturnType<typeof searchStateOf>>;
    for (const r of [report.runtime.cold, ...report.runtime.runs]) {
      expect(r.lane?.exact.count).toBe(st.lane.trades.length + st.lane.companions.length);
      expect(r.lane?.exact.ms).toBeGreaterThan(0);
      expect(r.lane?.simScreen.count).toBe(l.counts.title?.exact);
    }
    expect(l.cost.with).toEqual({ cold: report.runtime.cold.search.total, warm: report.runtime.search.total });
    expect(l.cost.measured.without).not.toBeNull();
    // The split's one search, its parts read the same way, against one without the lane.
    expect(l.split?.parts).toEqual(report.goals.lane);
    expect(l.split?.without).toBeGreaterThan(0);
    const s = section(10);
    expect(s).toContain("**The helps-both lane** (Checkpoint 7d; planner reply to Checkpoint 7c, answer 2): up to 40 screened trades");
    expect(s).toContain("| The helps-both lane | Only the champion | Several prizes (the split) |");
    const t = l.counts.title as NonNullable<typeof l.counts.title>;
    const o = l.counts.other as NonNullable<typeof l.counts.other>;
    expect(s).toContain(`| ${t.qualifying} · ${t.onShortlist} · ${t.trades} · ${t.companions} · ${t.exact} | ${o.qualifying} · ${o.onShortlist} · ${o.trades} · ${o.companions} · ${o.exact} |`);
    expect(s).toContain(`| ${t.screenBoth} · ${t.finalists} · ${t.extras} · ${t.finalBoth} · ${t.list} · ${t.overall} | ${o.screenBoth} · ${o.finalists} · ${o.extras} · ${o.finalBoth} · ${o.list} · ${o.overall} |`);
    expect(s).toContain(`| The lane's displaced finalists (the ranking picks them without it, not with it), kept for the "Helps both" list (Helps them known) · help both on the final run · on that list | ${t.displaced.kept} · ${t.displaced.both} · ${t.displaced.listed} | ${o.displaced.kept} · ${o.displaced.both} · ${o.displaced.listed} |`);
    const after = report.helpsBoth.counts.title as HelpsBothCounts;
    const before = l.before.title as HelpsBothCounts;
    expect(s).toContain(`| Without the lane → with it: exact trades that help both on the screening run (not hidden) | ${before.exact.both} (${before.exact.shown}) of ${before.exact.total} → ${after.exact.both} (${after.exact.shown}) of ${after.exact.total} |`);
    expect(s).toContain(`| **… the "Helps both" list's cards** | **${before.list.trades.length}** → **${after.list.trades.length}** |`);
    expect(s).toContain(`| Overall cards the search without the lane doesn't show | ${l.differs.title} of ${trades.length} | ${l.differs.other} of ${report.goals.result.trades.length} |`);
    // What else it changes on the Finder (review of the lane, LANE-1 and LANE-2): the split's pair again here (the search without
    // the lane on a context of its own, deterministic), and under section 1's setting what section 4's runs give.
    const prizesSettings = prizesSettingsOf(defaultTradeSettings(), PRIZES);
    const splitOff = runTradeSearch(buildTradeContext(report.snapshot, inputs, { now: TEST_NOW, settings: prizesSettings, scenarios: 4 }), { settings: prizesSettings, helpsBothLane: false });
    expect(l.shown.other).toEqual(laneShown(report.goals.result, splitOff));
    const sh = l.shown.title;
    expect(sh.exact).toEqual({ without: before.exact.total, with: report.result.counts.exact });
    expect(sh.leftOut.with).toEqual({ benefit: report.result.hidden.byBenefit, market: report.result.hidden.byMarket, chance: report.result.hidden.byChance ?? 0 });
    expect(sh.shared.cards + l.differs.title).toBe(trades.length);
    expect(sh.list.cards).toBe(after.list.trades.length);
    expect(sh.list.cards - sh.list.added + sh.list.dropped).toBe(before.list.trades.length);
    // Every final run without the lane whose Helps them is known is made with it too (LANE-2 and ENG-7D-1): a guard.
    expect(sh.finalsLost).toEqual({ count: 0, listed: 0 });
    expect(l.shown.other.finalsLost).toEqual({ count: 0, listed: 0 });
    const pair = (f: (x: typeof sh) => string) => `| ${f(sh)} | ${f(l.shown.other)} |`;
    const left = (x: typeof sh.leftOut.with) => `${x.benefit} · ${x.market} · ${x.chance}`;
    expect(s).toContain(`| Overall cards both show with a different Plan B box ${pair((x) => `${x.shared.box} of ${x.shared.cards}`)}`);
    expect(s).toContain(`| "Helps both" cards the search without the lane doesn't show · its cards this list doesn't show ${pair((x) => `${x.list.added} · ${x.list.dropped} of ${x.list.cards}`)}`);
    expect(s).toContain(`| Final runs without the lane, Helps them known (the "Helps both" list's candidates), that the search with it doesn't make · of them on its list ${pair((x) => `${x.finalsLost.count} · ${x.finalsLost.listed}`)}`);
    expect(s).toContain(`| The Finder's "checked N closely", without → with ${pair((x) => `${x.exact.without} → ${x.exact.with}`)}`);
    expect(s).toContain(`| The Finder's "Left out on purpose": ideas that wouldn't help you · that give up much more trade value · under the minimum chance, without → with ${pair((x) => `${left(x.leftOut.without)} → ${left(x.leftOut.with)}`)}`);
    expect(s).toContain(`**What the lane costs** (⚠️ ours: under "Only the champion", section 4's runs, each timed one followed by the same search without the lane on its own context`);
    for (const label of [`| The lane's exact evaluations (${l.cost.exact.count}: its trades and their lean companions) |`, `| Their screening simulations (${l.cost.simScreen.count}, the legal ones) |`, "| The rest: final simulation, ranking, the shown pass and Plan B, with the lane less without | – |", "| **The lane's extra: the three parts** |", "| Search total with the lane (the app: section 4's) |", "| Search total without the lane (measured) | – |"]) expect(s).toContain(label);
    expect(s).toMatch(/Under "Several prizes", section 2's one search \(warm, [^)]+\): the lane's exact evaluations [^;]+ and screening simulations [^;]+; the search without the lane, on a context of its own, /);
  });

  it("section 11 (Checkpoint 7e): each setting's top cards' offers in order as the worker builds them, their first opens, and the candidates that print better than their card", () => {
    const l = report.ladders;
    // Section 1's setting: built after each of section 4's timed runs on its own search; the last is the report's own, so its
    // ladders are offers.ts's on it (the same store: nothing built again).
    expect(l.title.rows.map((r) => r.card.key)).toEqual(trades.slice(0, LADDER_CARDS).map((t) => t.key));
    const st = searchStateOf(report.result) as SearchState;
    for (const row of l.title.rows) {
      expect(row.ladder).toEqual(offerLadderOfSearch(report.result, row.card.key));
      expect(row.ms).toHaveLength(report.runtime.runs.length);
      for (const x of row.ms) expect(x).toBeGreaterThan(0);
      // The card's Plan B barred (the lead's call, wave D: another card of its list can be an offer), the candidates
      // pre-screened (the review of wave D, D-ENG-1).
      const choice = ladderChoice(ladderJobOfSearch(st, row.card));
      expect(row.screened).toBe(choice?.screened.length);
      expect(row.candidates).toBe(choice?.candidates);
      expect(row.candidates).toBeGreaterThanOrEqual(row.screened);
      if (row.card.planB) for (const x of row.ladder.steps) expect(x.evaluation.key).not.toBe(row.card.planB.key);
      expect(row.ladder.steps.filter((x) => x.kind === "suggested").map((x) => x.evaluation.key)).toEqual([row.card.key]);
      expect(row.ladder.steps.length).toBeLessThanOrEqual(config.offers.maxSteps);
    }
    // The split's: runs of its own (one here), the same cards as section 2's search (deterministic).
    expect(l.other.rows.map((r) => r.card.key)).toEqual(report.goals.result.trades.slice(0, LADDER_CARDS).map((t) => t.key));
    for (const row of l.other.rows) expect(row.ms).toHaveLength(1);
    // A fact of the synthetic data: some top card has offers besides itself.
    expect([...l.title.rows, ...l.other.rows].some((r) => r.ladder.steps.length > 1)).toBe(true);
    // The candidates that print better than their card, on the first TOP_DETAIL cards: each prints a higher Helps you and a
    // higher chance than the card (so no Open or Then offer is one: their chance stays 5 points under the card's).
    for (const [set, r] of [
      [l.title, report.result],
      [l.other, report.goals.result],
    ] as const) {
      expect(set.better.map((b) => b.card.key)).toEqual(r.trades.slice(0, TOP_DETAIL).map((t) => t.key));
      for (const b of set.better) {
        expect(b.likelier).toBeLessThanOrEqual(b.screened);
        expect(b.better.length).toBeLessThanOrEqual(b.likelier);
        for (const v of b.better) {
          expect(v.tradeScore as number).toBeGreaterThan(b.card.tradeScore as number);
          expect(displayAcceptance(v.pComplete)).toBeGreaterThan(displayAcceptance(b.card.pComplete));
        }
      }
      for (const row of set.rows) {
        const better = new Set(set.better.find((b) => b.card.key === row.card.key)?.better.map((v) => proposalKey(v.proposal)));
        for (const x of row.ladder.steps) if (x.kind === "open" || x.kind === "then") expect(better.has(x.evaluation.key)).toBe(false);
      }
    }
    // Rendered: each card with its offers in order in the card's words, its Plan B below, then the better candidates.
    const s = section(11);
    expect(s).toContain("## 11. How to offer it: offers in order");
    expect(s).toContain("**Only the champion**:");
    expect(s).toContain("**Several prizes (the league's split, 1st 44%, 2nd 36%, 3rd 20%)**:");
    for (const [i, row] of l.title.rows.entries()) {
      const c = row.card;
      const n = row.ladder.steps.length;
      expect(s).toContain(`${i + 1}. Team ${c.proposal.partnerId}: `);
      expect(s).toContain(`(${threeNumbers(c)}`);
      expect(s).toContain(`${n} offer${n === 1 ? "" : "s"} from ${row.candidates} candidates, ${row.screened} legal ${row.screened === 1 ? "one" : "ones"} played out after the pre-screen, built in `);
      row.ladder.steps.forEach((x, k) => expect(s).toContain(`   ${k + 1}. ${OFFER_WORDS[x.kind]}: `));
      for (const x of row.ladder.steps) expect(s).toContain(`Helps you ${x.evaluation.tradeScore ?? "–"} · ${chancePrinted(x.evaluation.pAccept)} ${x.evaluation.acceptLabel}`);
      // An offer that is another card is marked by its place on the list (the lead's call, wave D); the card itself isn't.
      for (const x of row.ladder.steps) {
        const at = trades.findIndex((t) => t.key === x.evaluation.key);
        if (x.kind === "suggested") expect(alsoCardText(report.result, x)).toBeNull();
        else if (at >= 0) {
          expect(alsoCardText(report.result, x)).toBe(`also trade idea ${at + 1}`);
          expect(s).toContain(`(also trade idea ${at + 1}): Helps you ${x.evaluation.tradeScore ?? "–"}`);
        }
      }
    }
    const offered = l.title.rows.flatMap((row) => row.ladder.steps.filter((x) => x.kind !== "suggested"));
    const marked = offered.filter((x) => alsoCardText(report.result, x) !== null).length;
    expect(s).toContain(`Of these ${offered.length} offer${offered.length === 1 ? "" : "s"} besides the cards themselves, ${marked} ${marked === 1 ? "is" : "are"} another card of the list.`);
    // alsoCardText on made-up keys: the Overall list's place, else the "Helps both" list's; none for the suggested trade.
    const fake = { trades: [{ key: "p" }, { key: "q" }], helpsBoth: { trades: [{ key: "q" }, { key: "z" }] } } as unknown as Pick<TradeSearchResult, "trades" | "helpsBoth">;
    const step = (kind: OfferStep["kind"], key: string) => ({ kind, evaluation: { key } }) as unknown as OfferStep;
    expect([alsoCardText(fake, step("open", "q")), alsoCardText(fake, step("last", "z")), alsoCardText(fake, step("then", "x")), alsoCardText(fake, step("suggested", "p"))]).toEqual(["also trade idea 2", "also “Helps both” idea 2", null, null]);
    expect(s.match(/⚠️ Candidates that print a higher Helps you and a higher chance than their card/g)).toHaveLength(2);
    expect(s.match(/The pre-screen picks the offers every candidate gives on \d+ of these \d+ cards\./g)).toHaveLength(2);
    // Its own runs are timed with the report's stages.
    expect(report.timing.ladders).toBeGreaterThan(0);
    expect(doc).toContain(`section 11's runs under "Several prizes" and its candidates played out `);
  });

  it("prints placeholders only: no team, owner or league name or league id from the league", () => {
    for (const t of raw.teams) {
      expect(doc).not.toContain(t.name);
      expect(doc).not.toContain(t.ownerName);
    }
    expect(doc).not.toContain(PRIVATE.league);
    expect(doc).not.toContain(PRIVATE.leagueId);
    expect(doc).not.toContain("Owner ");
    const teamIds = new Set(snapshot.teams.map((t) => t.id));
    for (const m of doc.matchAll(/Team (\d+)/g)) expect(teamIds.has(m[1] as string)).toBe(true);
    expect(doc).toContain("(you are Team 1)");
    expect(doc).not.toMatch(/Team [2-6] \(you/);
  });

  it("is deterministic: the same search again on the same context gives the same cards", () => {
    const again = runTradeSearch(report.ctx, { settings });
    expect(again.trades.map((t) => [t.key, t.b, t.pComplete])).toEqual(trades.map((t) => [t.key, t.b, t.pComplete]));
  });
});

describe("trade report: the command line (offline by default: planner reply to Checkpoint 4c, A5)", () => {
  const root = path.join(tmpdir(), "repo");
  const newest = path.join(root, "data-local", "parker-league-4c");
  const dumps = () => [
    { dir: path.join(root, "data-local", "parker-league-final"), now: new Date("2026-10-04T00:51:45.970Z") },
    { dir: newest, now: new Date("2026-10-04T09:24:34.901Z") },
  ];
  const args = (argv: string[], env: Record<string, string> = {}) => {
    const a = parseArgs(argv, root, { env, dumps });
    if ("error" in a) throw new Error(a.error);
    return a;
  };

  it("reads the newest dump by default, never the network; --live fetches; the header reprints the command with the dump named", () => {
    expect(args([])).toEqual({ dump: newest, newest: true, team: undefined, cookies: null });
    expect(reportCommand(args([]), root)).toBe("npm run trade:report -- --dump data-local/parker-league-4c");
    expect(reportCommand(args(["--team", "3"]), root)).toBe("npm run trade:report -- --dump data-local/parker-league-4c --team 3");
    expect(args(["--live", "--team", "3", "--cookies"])).toEqual({ dump: null, newest: false, team: "3", cookies: "on" });
    expect(reportCommand(args(["--live", "--team", "3", "--cookies"]), root)).toBe("npm run trade:report -- --live --team 3 --cookies");
    // The "--" left out (or dropped by the shell): --live arrives as npm's own setting.
    expect(args(["--team", "3"], { npm_config_live: "true" }).dump).toBeNull();
    // --cookies means nothing without --live, so the header leaves it out.
    expect(reportCommand(args(["--cookies"]), root)).toBe("npm run trade:report -- --dump data-local/parker-league-4c");
    expect(parseArgs(["--live", "--dump", "data-local/x"], root, { env: {}, dumps })).toEqual({ error: expect.stringContaining("don't go together") });
    expect(parseArgs([], root, { env: {}, dumps: () => [] })).toEqual({ error: expect.stringContaining("No saved dump") });
    // A folder outside the project: its name only (no folders of the machine in the report).
    expect(reportCommand({ dump: path.join(tmpdir(), "elsewhere", "dump"), newest: false, team: undefined, cookies: null }, root)).toBe("npm run trade:report -- --dump dump");
  });
});
