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
import { overallScore, tradeScore } from "@/engine/benefit";
import { config } from "@/engine/config";
import { analyzeTrade, buildTradeContext, helpsScaleOf, rewardFor, tradeInternals } from "@/engine/evaluate";
import type { ModelInputs } from "@/engine/inputs";
import { buildLeagueModel, playoffWeightFrom } from "@/engine/league";
import { neutralThrowIns } from "@/engine/market";
import type { LeagueSnapshot, Pos } from "@/engine/model";
import { prizeOddsOf, prizePeriods, type PrizeDeltas } from "@/engine/reward";
import { runTradeSearch, searchStateOf } from "@/engine/search";
import { GOALS, defaultTradeSettings } from "@/engine/settings";
import { TEST_NOW } from "@/engine/testLeague";
import { smallLeague } from "@/engine/trade.testing";
import type { TradeEvaluation } from "@/engine/tradeModel";
import { tradeEvaluation } from "@/engine/tradeTestFixtures";
import { acceptText, injuryTagText, knownTagsOf, planBView, seasonEndOf } from "@/lib/tradeView";
import { GOAL_WORDS, asWeeklyResetData, benefitWin, goalRewards, placeholders, pre4cText, resetWaiverOrder, scaleCheck, thresholdsLine, type Pre4cOrder } from "./league-report";
import {
  ANCHORS,
  BLEND_EXTREMES,
  FEW_GAMES,
  GAP_TRADE,
  NEAR_POINTS,
  OPEN_SPOT_FINALISTS,
  PREMIUM_ANCHORS,
  TOP_DETAIL,
  anchorRows,
  blendReason,
  buildTradeReport,
  cardCounts,
  chancePrinted,
  dataOrderOf,
  expectedGain,
  fmt,
  helpsScaleSection,
  kickoffJump,
  oddsByOrder,
  omegaUnder,
  parseArgs,
  pctPlain,
  pickupWeeks,
  planBOddsText,
  playoffMove,
  premiumAnchorRows,
  pts,
  reportCommand,
  scaleCheckOf,
  signed,
  taggerOf,
  threeNumbers,
  titleMove,
  tradeValueText,
  weeklyLines,
  weeklyText,
  type Tagger,
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

// One report for the suite: 4 availability scenarios (the app's 32 would only slow the suite; every rule is the same), one
// timed run after one warm-up (so the determinism check compares two searches), the beams alone once.
const report = buildTradeReport(snapshot, inputs, { now: TEST_NOW, clock, mode: "offline", dataNote: "Synthetic test league.", scenarios: 4, runs: 1, warmups: 1, command: "npm run trade:report -- --offline data-local/synthetic --team 1" });
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

  it("counts the cards with Plan B, offer-first steps and an injury-tagged player received, and the Plan B boxes receiving one", () => {
    const tagged = (side: "give" | "get") => ({ marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: [], tagged: [{ playerId: "x", side, status: "OUT" as const }] });
    const step = tradeEvaluation({ give: ["a"], get: ["b"] });
    const list = [tradeEvaluation({ give: ["a"], get: ["b"], flags: tagged("get") }), tradeEvaluation({ give: ["a"], get: ["c"], flags: tagged("give") }), tradeEvaluation({ give: ["d"], get: ["e"] })];
    // A tagger that knows one hurt player ("hurt"), on whichever side he is.
    const tagger: Tagger = (p) => [...p.give.map((a) => [a, "give"] as const), ...p.get.map((a) => [a, "get"] as const)].flatMap(([a, side]) => (a.kind === "player" && a.id === "hurt" ? [{ playerId: a.id, side, status: "OUT" as const }] : []));
    expect(cardCounts(list, tagger)).toEqual({ shown: 3, planB: 0, steps: 0, injuredGet: 1, planBInjuredGet: 0 });
    expect(cardCounts([...list, { ...step, steps: trades.find((t) => t.steps)?.steps ?? { offerFirst: {} as never, ifNo: {} as never, ranked: "full" } }], tagger).steps).toBe(1);
    // Plan B boxes: one asking for the hurt player counts, one giving him away doesn't (review of track R, R-2).
    const planB = (give: string, get: string): NonNullable<TradeEvaluation["planB"]> => ({ proposal: { partnerId: "2", give: [{ kind: "player", id: give }], get: [{ kind: "player", id: get }] }, key: `${give}>${get}`, b: 1, tradeScore: 15, pAccept: 0.5, pComplete: 0.5, acceptLabel: "Decent", overall: 8, kind: "otherTarget" });
    const withB = [...list, { ...step, planB: planB("a", "hurt") }, { ...step, planB: planB("hurt", "e") }];
    expect(cardCounts(withB, tagger)).toEqual({ shown: 5, planB: 2, steps: 0, injuredGet: 1, planBInjuredGet: 1 });
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

describe("trade report: the whole offline report on a synthetic league", () => {
  const I = tradeInternals(report.ctx);

  it("runs the real search and renders every section in order, the header with the data, the settings and the baseline", () => {
    expect(trades.length).toBeGreaterThan(0);
    expect(report.result.myTeamId).toBe("1");
    expect([...doc.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(doc).toContain("# Trade search: Parker's ESPN league (Checkpoint 7b)");
    expect(doc).toContain("Generated by `npm run trade:report -- --offline data-local/synthetic --team 1` on ");
    expect(doc).toContain("- Synthetic test league.");
    expect(doc).toContain("**Settings** (the app's defaults): What matters most: Win the title (ΔPO 0.15 / ΔCH 0.85); Chance they accept: at least 10%; Protect my trade value: Medium (κ 2 points a week per 100% of trade value, priced on B₃: section 3);");
    // …and the thresholds in ROS lineup points under the search's ω (review of the engine track, Phase 7b).
    expect(doc).toContain(thresholdsLine(I.model));
    // The baseline is the search's: every team after its pickups, the same numbers as the League model's headline odds.
    const mine = report.model.odds?.teams.find((t) => t.teamId === "1");
    // …and every prize component (Checkpoint 7c), the headline's too.
    expect(report.result.baseline).toEqual({ pPlayoffs: mine?.pPlayoffs, pTitle: mine?.pTitle, expWins: mine?.expWins, prizes: prizeOddsOf(mine as NonNullable<typeof mine>) });
    expect(doc).toContain(`**Your baseline** (the trade search's: every team after its free-agent pickups in the waiver order above, seasons 1–5,000; it equals the League page's headline, section 7): playoffs ${pctPlain(mine?.pPlayoffs)}, title ${pctPlain(mine?.pTitle)}`);
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
      // The odds after are the baseline plus the trade's change on the same final block.
      expect(t.detail.winChance).toBeDefined();
    });
    // Garrett Wilson is questionable here: wherever he's given, the tag says so.
    for (const t of trades.filter((x) => playerIds(x, "give").includes(ids.wilson as string))) expect(t.flags.tagged?.some((g) => g.playerId === ids.wilson && g.side === "give")).toBe(true);
    const tagsOf = taggerOf(tradeInternals(report.ctx));
    const c10 = cardCounts(top, tagsOf);
    const all = cardCounts(trades, tagsOf);
    expect(s).toContain(`**Counts** (top ${c10.shown} / all ${all.shown} cards): with Plan B ${c10.planB} / ${all.planB}; with offer-first steps ${c10.steps} / ${all.steps}; receiving an injury-tagged player ${c10.injuredGet} / ${all.injuredGet}; Plan B boxes receiving one ${c10.planBInjuredGet} / ${all.planBInjuredGet}.`);
    // The next steps carry their players' tags (review of track R, R-2): a step's by the search's own rule, a Plan B in its box's words.
    const known = knownTagsOf(trades);
    for (const [i, t] of top.entries()) {
      const line = s.split("\n").find((l) => l.startsWith(`- #${i + 1}: `));
      if (t.steps) {
        expect(line).toMatch(/^- #\d+: offer first /);
        for (const g of tagsOf(t.steps.offerFirst.proposal)) expect(line).toContain(`${snapshot.players[g.playerId]?.name} [${injuryTagText(g, end)}]`);
      } else if (t.planB) {
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

  it("section 2: the same search under Several prizes (the prefilled split for now); both top 10s side by side, numbers from each list or the Analyzer under that goal", () => {
    const g = report.goals;
    expect(g.goal).toBe("prizes");
    expect(g.result).not.toBe(report.result);
    const topTitle = trades.slice(0, TOP_DETAIL).map((t) => t.key);
    const topOther = g.result.trades.slice(0, TOP_DETAIL).map((t) => t.key);
    expect(g.rows.map((r) => r.key)).toEqual([...new Set([...topTitle, ...topOther])]);
    expect(g.common).toBe(topTitle.filter((k) => topOther.includes(k)).length);
    for (const row of g.rows) {
      for (const [side, list, goal] of [
        [row.title, trades, "title"],
        [row.other, g.result.trades, "prizes"],
      ] as const) {
        const at = list.findIndex((t) => t.key === row.key);
        if (at >= 0) expect(side).toEqual({ rank: at + 1, b: list[at]?.b, helps: list[at]?.tradeScore, overall: list[at]?.overall });
        else {
          const t = trades.find((x) => x.key === row.key) ?? g.result.trades.find((x) => x.key === row.key);
          const e = analyzeTrade(report.ctx, (t as TradeEvaluation).proposal, { settings: { ...settings, goal } }).evaluation;
          expect(side).toEqual({ rank: null, b: e?.b ?? null, helps: e?.tradeScore ?? null, overall: e?.overall ?? null });
        }
      }
      // B moves with the goal by exactly B_win's weights and prizes and its market term's scale (planner reply to Checkpoint 7a,
      // §2 question 5: (B₃ / 3) × κ × clamp(g_mkt(me)), on each goal's B₃); the chance they accept doesn't depend on it.
      const t = trades.find((x) => x.key === row.key);
      if (t && t.dPO !== null && t.dCH !== null && row.other.b !== null && row.title.b !== null) {
        const rewards = goalRewards(prizePeriods(snapshot));
        const term = (b3: number | null | undefined) => ((b3 as number) / config.benefit.helpsGain) * config.benefit.protectValue.medium * Math.min(0.5, Math.max(-0.5, t.gMine));
        const dWin = benefitWin(t.dPO, t.dPrizes as PrizeDeltas, rewards.prizes) - benefitWin(t.dPO, t.dPrizes as PrizeDeltas, rewards.title);
        // Section 2 holds the default goal's context, so its Several prizes cards read that context's B₃ under that reward.
        const I = tradeInternals(report.ctx);
        const onContext = (goal: "title" | "prizes") => helpsScaleOf(I, report.settings.lambda, rewardFor(I, { ...report.settings, goal }))?.b3;
        expect(row.other.b - row.title.b).toBeCloseTo(dWin + term(onContext("prizes")) - term(onContext("title")), 9);
      }
    }
    expect(section(2)).toContain(`${g.common} of the top ${TOP_DETAIL} are in both lists`);
    // The playoff weeks' weight (planner reply to Checkpoint 7a, §6.1): the comparison holds the context's ω, and names the
    // one the app's own context under Several prizes would use (from the same runs: they keep every prize component).
    const model = tradeInternals(report.ctx).model;
    const auto = model.playoffWeightAuto;
    const runs = auto?.runs;
    expect(omegaUnder(model, "title")).toBe(model.playoffWeight);
    expect(omegaUnder(model, "prizes")).toBe(runs && auto ? playoffWeightFrom(runs, goalRewards(auto.reward.periods, auto.reward).prizes, auto.sims).omega : model.playoffWeight);
    // …which is the ω of a context built under that goal.
    const prizesContext = buildTradeContext(report.snapshot, inputs, { now: TEST_NOW, settings: { ...report.settings, goal: "prizes" }, scenarios: 4 });
    expect(omegaUnder(model, "prizes")).toBe(tradeInternals(prizesContext).model.playoffWeight);
    expect(omegaUnder({ playoffWeight: 1.25 }, "playoffs")).toBe(1.25);
    expect(section(2)).toContain(`this comparison holds it at Win the title's ${model.playoffWeight}×`);
    expect(section(2)).toContain(`the app under Several prizes rebuilds its context with ${omegaUnder(model, "prizes")}×`);
  });

  it("section 3: B₃ under each goal (planner reply to Checkpoint 4c, A2): the calibration run, the search's scale and the scale check on it", () => {
    const sc = report.scale;
    // Each goal's B₃ off the context the app builds under that goal (its own ω; review of Phase 7b).
    const contextFor = (goal: (typeof GOALS)[number]) => buildTradeContext(report.snapshot, inputs, { now: TEST_NOW, settings: { ...report.settings, goal }, scenarios: 4 });
    expect(sc).toEqual(helpsScaleSection(snapshot, report.model, report.ctx, report.settings, contextFor));
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
    expect(c).toEqual(scaleCheckOf(snapshot, report.model));
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
    expect(s).toContain("| Gain | ΔPO | ΔCH | Win the title: B / Helps | Several prizes: B / Helps | Make the playoffs: B / Helps | Checkpoint 3's B (0.35 / 0.65) |");
    expect(s.split("\n").filter((l) => l.startsWith("| +"))).toHaveLength(3);
    expect(s).toContain("The trade context's own run (its final block) is the same run, bit for bit.");
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
    // The re-screening reproduces the search: the counts add up, and every exact trade is in the rebuilt shortlist or among
    // its lean companions.
    expect(g.reproduces).toEqual({ counts: true, shortlist: true });
    expect(g.perPartner.reduce((n, p) => n + p.exhaustive, 0)).toBe(report.result.counts.screened);
    // The beams alone, per partner, add up to the beams-alone search's own count.
    expect(g.perPartner.reduce((n, p) => n + p.beams, 0)).toBe(report.beams.result.counts.screened);
    expect(g.perPartner.reduce((n, p) => n + p.cards, 0)).toBe(trades.length);
    const state = searchStateOf(report.result) as NonNullable<ReturnType<typeof searchStateOf>>;
    expect(g.perPartner.reduce((n, p) => n + p.exact, 0)).toBe(state.exactByKey.size);
    expect(g.perPartner.reduce((n, p) => n + p.finalists, 0)).toBe(state.finals.length);
    // Each stage follows from the one before (a card is a finalist, which was evaluated exactly, shortlisted, kept, screened).
    expect(g.exact).toBe(state.exactByKey.has(trade.key));
    expect(g.finalist).toBe(state.finals.some((f) => f.key === trade.key));
    expect(g.card).toBe(trades.findIndex((t) => t.key === trade.key) + 1 || null);
    if (g.card) expect(g.finalist).toBe(true);
    if (g.finalist) expect(g.exact).toBe(true);
    if (g.exact) expect(g.shortlisted).toBe(true);
    if (g.shortlisted) expect(g.kept).not.toBeNull();
    if (g.kept) expect(g.inWindow).toBe(true);
    if (g.beams) expect(g.screened).not.toBeNull();
    expect(g.evaluation?.key).toBe(trade.key);
    expect(g.onlyExhaustive.exact).toBeLessThanOrEqual(state.exactByKey.size);
    const s = section(4);
    expect(s).toContain("**Garrett Wilson → Chuba Hubbard + Mike Evans** (Team 2): ");
    expect(s).toContain(`they add up to the search's ${report.result.counts.screened.toLocaleString("en-US")} ✅, and every trade it evaluated exactly is in the rebuilt shortlist or among its lean companions ✅.`);
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
