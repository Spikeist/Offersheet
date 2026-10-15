import { describe, expect, it } from "vitest";
import { betaNeed } from "./acceptance";
import { farReturnWeek } from "./availability";
import { benefit, benefitNotes, tradePackage } from "./benefit";
import { config } from "./config";
import { deltaLineupFromTerms, explainTrade, fantasyCalcComparison, injuryTags, myFantasyCalcGain, partnerFantasyCalcGain, type ExplainConfig, type ExplainContext } from "./explain";
import type { PlayerInfo, Pos } from "./model";
import type { PremiumFact, TradeAsset, TradeDetail, TradeEvaluation, TradeProposal, TradeStep, TradeSteps } from "./tradeModel";
import { FIXTURE_PLAYERS, acceptanceTerms, activitySummary, contextTerm, explainContext, premiumFact, tradeEvaluation, withSteps, type EvaluationFixture } from "./tradeTestFixtures";

/** A fixture with nothing to say on my side or theirs, unless the test adds it. */
const QUIET: EvaluationFixture = { dPO: 0, dCH: 0, dPPW: 0, dPPWPlayoffs: 0 };

/**
 * FantasyCalc's own values (ExplainContext.fantasyCalcValue): by default every fixture player at 5,000; players the fixtures
 * don't know have none. Since the planner's reply to Checkpoint 7a (5.4) they're never quoted: they only say the trade has
 * trade value behind it, and the value line words the model's g_mkt(P) (the fixture's gPartner).
 */
const FC_EVEN: Partial<ExplainContext> = { fantasyCalcValue: (id) => (Object.hasOwn(FIXTURE_PLAYERS, id) ? 5000 : null) };

function explain(over: EvaluationFixture = {}, ctxOver: Partial<ExplainContext> = {}, cfg?: ExplainConfig) {
  return explainTrade(tradeEvaluation({ ...QUIET, ...over }), explainContext({ ...FC_EVEN, ...ctxOver }), cfg);
}

const reasonsOf = (over: EvaluationFixture = {}, ctxOver: Partial<ExplainContext> = {}, cfg?: ExplainConfig) => explain(over, ctxOver, cfg).reasons;
/** A context whose FantasyCalc values come from a table (players not in it have none). */
const fc = (table: Record<string, number>): Partial<ExplainContext> => ({ fantasyCalcValue: (id) => table[id] ?? null });
/**
 * FantasyCalc values that give the partner a raw gain of `gain` when I give `give` and get `get`: each of their players
 * (my `get`) at 4,000, mine shared so that what they get is (1 + gain) × what they give. ⚠️ Since the planner's reply to
 * Checkpoint 7a (5.4) the words never read these sums: tests pass them to show they don't move the value line.
 */
function fcGain(give: readonly string[], get: readonly string[], gain: number): Partial<ExplainContext> {
  const table: Record<string, number> = {};
  for (const id of get) table[id] = 4000;
  for (const id of give) table[id] = ((1 + gain) * 4000 * get.length) / give.length;
  return fc(table);
}

/** The value line's three readings (the model's g_mkt(P), in words only: planner reply to Checkpoint 7a, 5.4). */
const EVEN = "The two sides are about even on trade value.";
const AHEAD_YES = "They come out ahead on trade value, which makes a yes more likely.";
const AHEAD_ONLY = "They come out ahead on trade value.";
const BEHIND = "They give up more trade value than they get, so expect pushback.";
const MOSTLY = "Mostly a trade-value win: you get more trade value than you give.";
const BARE = "Barely changes your starting lineup.";
/** The veto caveat: the model's count (review of track UIC, finding 1). */
const VETO = "Your league reviews trades, and counting roster spots, this one is uneven enough to risk a veto, so the chance it goes through is halved.";

describe("explain config (§15)", () => {
  it("has the explain block with its thresholds", () => {
    expect(config.explain).toEqual({
      slotChangeMin: 1,
      lineupChangeMin: 0.5,
      playoffGainMin: 1,
      riskyWeekGain: 3,
      valueEven: 0.05,
      termMin: 0.1,
      partnerReasons: 3,
      longTermMin: 0.01,
      futureFirstLambda: 0.5,
      holeRankFromBottom: 0.5,
      // Phase 4c (planner reply to Checkpoint 4b, changes 6 and 9): the card's "Win chance by week" line and the Trade
      // Finder's pattern note (src/engine/pattern.ts).
      weeklyLineMin: 0.03,
      weeklyLineMax: 4,
      patternMinCount: 5,
      patternTop: 10,
      patternDriverShare: 0.5,
      patternDriversMax: 3,
      patternDepthCoverMin: 0.5,
    });
  });
});

describe("§13's example reasons", () => {
  it("words them as the spec does, trade value in words only (planner reply to Checkpoint 7a, 5.4)", () => {
    const r = reasonsOf(
      {
        give: ["kelce"],
        get: ["bijan"],
        gMine: 0.08,
        detail: {
          mySlots: [{ key: "RB2", before: 9.1, after: 14.3 }],
          partnerSlots: [{ key: "TE1", before: 4.1, after: 11.9, rank: 9 }],
          holes: ["TE1"],
          holesFilled: ["TE1"],
          terms: acceptanceTerms({ value: -0.66, need: 0.3, hole: 0.4, activity: 0.35 }),
          activity: activitySummary({ a: 1, rule: "active", trades: 3 }),
        },
      },
      fc({ kelce: 5000, bijan: 5400 }),
    );
    expect(r).toEqual([
      "Your RB2 spot goes from 9.1 to 14.3 projected points per week.",
      "They're 9th of 10 at TE, and this gives them a starter.",
      BEHIND,
      "Active trader: 3 trades this season.",
    ]);
  });
});

describe("my side", () => {
  it("leads with my biggest slot gain, labeled as the League page labels slots", () => {
    const slots = (key: string) => reasonsOf({ detail: { mySlots: [{ key: "RB1", before: 15, after: 15.5 }, { key, before: 6.04, after: 10 }] } })[0];
    expect(slots("TE1")).toBe("Your TE spot goes from 6 to 10 projected points per week.");
    expect(slots("RB/WR/TE1")).toBe("Your FLEX spot goes from 6 to 10 projected points per week.");
    expect(slots("D/ST1")).toBe("Your D/ST spot goes from 6 to 10 projected points per week.");
    expect(slots("QB1")).toBe("Your QB spot goes from 6 to 10 projected points per week.");
    expect(slots("WR2")).toBe("Your WR2 spot goes from 6 to 10 projected points per week.");
    // A key the context doesn't list reads as the key.
    expect(slots("SUPER_FLEX1")).toBe("Your SUPER_FLEX1 spot goes from 6 to 10 projected points per week.");
  });

  it("needs a slot change of at least slotChangeMin; else the whole lineup's gain; else 'Barely changes'", () => {
    const min = config.explain.slotChangeMin;
    expect(reasonsOf({ detail: { mySlots: [{ key: "RB2", before: 9, after: 9 + min }] } })[0]).toBe(`Your RB2 spot goes from 9 to ${9 + min} projected points per week.`);
    expect(reasonsOf({ dPPW: 0.6, detail: { mySlots: [{ key: "RB2", before: 9, after: 9 + min - 0.05 }] } })[0]).toBe("Your starting lineup gains 0.6 projected points per week.");
    expect(reasonsOf({ dPPW: 0.4, detail: { mySlots: [{ key: "RB2", before: 9, after: 9.4 }] } })).toEqual(["Barely changes your starting lineup.", EVEN]);
  });

  it("says my odds change in percentage points with one decimal, as the card prints them; a change that rounds to 0.0 is left out", () => {
    const first = (dPO: number | null, dCH: number | null) => reasonsOf({ dPO, dCH, dPPW: 2 })[1];
    expect(first(0.042, 0.018)).toBe("Raises your playoff odds by 4.2 and your title odds by 1.8 percentage points.");
    expect(first(0.031, 0.004)).toBe("Raises your playoff odds by 3.1 and your title odds by 0.4 percentage points.");
    expect(first(0.031, 0.0004)).toBe("Raises your playoff odds by 3.1 percentage points."); // 0.04 rounds to 0.0
    expect(first(0.0004, 0.01)).toBe("Raises your title odds by 1 percentage point.");
    expect(first(0.03, -0.005)).toBe("Raises your playoff odds by 3 percentage points but lowers your title odds by 0.5.");
    expect(first(-0.02, 0.05)).toBe("Raises your title odds by 5 percentage points but lowers your playoff odds by 2.");
    expect(first(0.05, null)).toBe("Raises your playoff odds by 5 percentage points."); // title odds unknown
    expect(reasonsOf({ dPO: 0.0004, dCH: -0.0004, dPPW: 2 })).toEqual(["Your starting lineup gains 2 projected points per week.", EVEN]);
    expect(reasonsOf({ dPO: null, dCH: null, dPPW: 2 })).toEqual(["Your starting lineup gains 2 projected points per week.", EVEN]);
  });

  it("⚠️ with my odds before the trade, quotes the change the card's odds line prints: its printed after minus its printed before (final review of Phase 4c, findings R9 and PAGES-2)", () => {
    // The odds line wherever it sits (a gain among my side's reasons, a loss among the caveats); the value line when none.
    const at = (dPO: number | null, dCH: number | null, baseline: ExplainContext["baseline"], stage: TradeEvaluation["stage"] = "final") => {
      const r = reasonsOf({ dPO, dCH, dPPW: 2, stage }, { baseline });
      return r.find((x) => / odds by /.test(x)) ?? r[1];
    };
    const fmt1 = (x: number) => String(Math.round(x * 10) / 10);
    // Parker's card: title 10.546% → 12.484% prints "10.5% → 12.5%", so 2 (not 1.9); playoffs 60.2% → 65.3% print "60% → 65%", so 5.
    expect(at(0.0508, 0.01938, { pPlayoffs: 0.602, pTitle: 0.10546 })).toBe("Raises your playoff odds by 5 and your title odds by 2 percentage points.");
    // "Playoff odds 60% → 60%": no playoff part, whatever the unrounded change (0.4); the title's 10.5% → 10.7% is 0.2.
    expect(at(0.004, 0.0012, { pPlayoffs: 0.598, pTitle: 0.10546 })).toBe("Raises your title odds by 0.2 percentage points.");
    // Down: 60% → 58%, 10.5% → 10.1%.
    expect(at(-0.018, -0.0042, { pPlayoffs: 0.598, pTitle: 0.10546 })).toBe("Lowers your playoff odds by 2 and your title odds by 0.4 percentage points.");
    // The same with the card's own functions: every change the reason says is the card's printed after minus before.
    for (const [before, d] of [
      [0.10546, 0.0194],
      [0.0995, 0.0102],
      [0.3333, -0.0277],
      [0.0004, 0.0009],
    ] as const) {
      const shown = (p: number) => Number((Math.min(1, Math.max(0, p)) * 100).toFixed(1));
      const want = Math.round((shown(before + d) - shown(before)) * 10) / 10;
      const text = at(null, d, { pPlayoffs: null, pTitle: before });
      expect(text, `${before} + ${d}`).toBe(want === 0 ? EVEN : `${want > 0 ? "Raises" : "Lowers"} your title odds by ${fmt1(Math.abs(want))} ${Math.abs(want) === 1 ? "percentage point" : "percentage points"}.`);
    }
    // Without a before (or on another block of seasons than the card's: a screening-block version), the change itself.
    expect(at(0.0508, 0.01938, null)).toBe("Raises your playoff odds by 5.1 and your title odds by 1.9 percentage points.");
    expect(at(0.0508, 0.01938, { pPlayoffs: 0.602, pTitle: null })).toBe("Raises your playoff odds by 5 and your title odds by 1.9 percentage points.");
    expect(at(0.0508, 0.01938, { pPlayoffs: 0.602, pTitle: 0.10546 }, "exact")).toBe("Raises your playoff odds by 5.1 and your title odds by 1.9 percentage points.");
    // Checkpoint 7e (planner reply to Checkpoint 7d, item 2.1): a trade with either-way moves starts from its own "before"
    // (TradeEvaluation.before), the one its card's odds line prints: 61.45% → 66.53% prints 61% → 67%, so 6 (5 from the
    // search's baseline, 60.2%); the title 11.04% → 12.98%, 11.0% → 13.0%, so 2.
    const own = { pPlayoffs: 0.6145, pTitle: 0.1104, prizes: { first: 0.1104, second: null, third: null, weeklyHigh: 0, pointsLeader: 0 } };
    const r = explainTrade(tradeEvaluation({ ...QUIET, dPO: 0.0508, dCH: 0.01938, dPPW: 2, stage: "final" }), explainContext({ ...FC_EVEN, baseline: { pPlayoffs: 0.602, pTitle: 0.10546 } })).reasons;
    const withOwn = explainTrade({ ...tradeEvaluation({ ...QUIET, dPO: 0.0508, dCH: 0.01938, dPPW: 2, stage: "final" }), before: own }, explainContext({ ...FC_EVEN, baseline: { pPlayoffs: 0.602, pTitle: 0.10546 } })).reasons;
    expect(r.find((x) => / odds by /.test(x))).toBe("Raises your playoff odds by 5 and your title odds by 2 percentage points.");
    expect(withOwn.find((x) => / odds by /.test(x))).toBe("Raises your playoff odds by 6 and your title odds by 2 percentage points.");
  });

  it("says 'point' for exactly one", () => {
    expect(reasonsOf({ dPPW: 1.04 })[0]).toBe("Your starting lineup gains 1 projected point per week.");
    expect(reasonsOf({ detail: { mySlots: [{ key: "K1", before: -0.2, after: 1 }] } })[0]).toBe("Your K spot goes from −0.2 to 1 projected point per week.");
    const hurt = reasonsOf({ dPPW: 2, detail: { weekly: [{ week: 13, before: 100, after: 99 }], riskyWeeks: [13] } }, {}, { ...config.explain, riskyWeekGain: 1 });
    expect(hurt).toContain("Weakens your risky week 13: −1 projected point that week.");
  });

  it("lists lower odds with the caveats", () => {
    const r = reasonsOf({ b: 0.4, dPO: -0.02, dCH: -0.01, dPPW: 1 });
    expect(r).toEqual(["Your starting lineup gains 1 projected point per week.", EVEN, "Lowers your playoff odds by 2 and your title odds by 1 percentage point."]);
  });

  it("covers my risky weeks when the trade adds at least riskyWeekGain there", () => {
    const g = config.explain.riskyWeekGain;
    const weekly = [
      { week: 9, before: 101, after: 101 + g },
      { week: 12, before: 110, after: 110.5 },
      { week: 13, before: 92.3, after: 98.5 },
      { week: 14, before: 100, after: 120 }, // not a risky week
    ];
    expect(reasonsOf({ dPPW: 2, detail: { weekly, riskyWeeks: [13] } })).toContain("Covers your risky week 13: +6.2 projected points that week.");
    expect(reasonsOf({ dPPW: 2, detail: { weekly, riskyWeeks: [13, 9, 12] } })).toContain(`Covers your risky weeks 9 and 13: +${g} and +6.2 projected points those weeks.`);
    expect(reasonsOf({ dPPW: 2, detail: { weekly, riskyWeeks: [12] } }).join(" ")).not.toContain("risky");
    // Weakening one is a caveat, with a real minus sign.
    const hurt = reasonsOf({ dPPW: 2, detail: { weekly: [{ week: 13, before: 100, after: 97 }], riskyWeeks: [13] } });
    expect(hurt[hurt.length - 1]).toBe("Weakens your risky week 13: −3 projected points that week.");
  });

  it("names the playoff weeks when they gain well above the regular season, and leads with them when nothing else does", () => {
    expect(reasonsOf({ dPPW: 1.2, dPPWPlayoffs: 3.4 })).toEqual([
      "In the regular season your starting lineup gains 1.2 projected points per week.",
      "In the playoffs your starting lineup gains 3.4 projected points per week.",
      EVEN,
    ]);
    expect(reasonsOf({ dPPW: 2, dPPWPlayoffs: 2.9 })).toEqual(["Your starting lineup gains 2 projected points per week.", EVEN]);
    expect(reasonsOf({ dPPW: 0.1, dPPWPlayoffs: 1.5 })[0]).toBe("In the playoffs your starting lineup gains 1.5 projected points per week.");
    expect(reasonsOf({ dPPW: 0.2, dPPWPlayoffs: -2 })).toEqual([EVEN, "In the playoffs your starting lineup loses 2 projected points per week."]);
    // With a playoff line, the whole-lineup lines name the regular season, gain or loss.
    expect(reasonsOf({ dPPW: -0.8, dPPWPlayoffs: -3 })).toEqual([EVEN, "In the regular season your starting lineup loses 0.8 projected points per week.", "In the playoffs your starting lineup loses 3 projected points per week."]);
    expect(reasonsOf({ dPPW: 0.9, dPPWPlayoffs: -1.5 })).toEqual(["In the regular season your starting lineup gains 0.9 projected points per week.", EVEN, "In the playoffs your starting lineup loses 1.5 projected points per week."]);
  });

  it("words the value line as the model reads trade value, its g_mkt(P), whatever FantasyCalc's plain sums say, and never with a number (planner reply to Checkpoint 7a, 5.4)", () => {
    const valueLine = (r: readonly string[]) => r.find((x) => x === EVEN || x.startsWith("They come out ahead on trade value") || x === BEHIND) ?? null;
    // The model credits them a roster spot (+17%) while FantasyCalc's plain sums read even: the model's reading.
    expect(valueLine(reasonsOf({ gPartner: 0.17, gMine: 1 / 1.17 - 1, detail: { terms: acceptanceTerms({ value: 1.02 }) } }))).toBe(AHEAD_YES);
    // FantasyCalc's sums say they get 12% more, the model (floor, spots) that they lose: the model's reading.
    expect(valueLine(reasonsOf({ gPartner: -0.3, gMine: 1 / 0.7 - 1, detail: { terms: acceptanceTerms({ value: -2.7 }) } }, fcGain(["nix"], ["kelce"], 0.12)))).toBe(BEHIND);
    // Both say so.
    expect(valueLine(reasonsOf({ gPartner: 0.12, gMine: 1 / 1.12 - 1, detail: { terms: acceptanceTerms({ value: 0.72 }) } }, fcGain(["nix"], ["kelce"], 0.12)))).toBe(AHEAD_YES);
    expect(valueLine(reasonsOf({ gPartner: -0.08, gMine: 1 / 0.92 - 1, detail: { terms: acceptanceTerms({ value: -0.72 }) } }, fcGain(["nix"], ["kelce"], -0.1)))).toBe(BEHIND);
    // The sums say they give up 11% more; the model reads about even.
    expect(valueLine(reasonsOf({ gPartner: 0.01, gMine: -0.01 / 1.01 }, fcGain(["nix"], ["kelce"], -0.1)))).toBe(EVEN);
    // No digit in any of the three.
    for (const text of [EVEN, AHEAD_YES, AHEAD_ONLY, BEHIND, MOSTLY]) expect(text).not.toMatch(/\d/);
    // A slot line keeps its words (its numbers are regular-season averages already).
    expect(reasonsOf({ dPPW: 1, dPPWPlayoffs: 3, detail: { mySlots: [{ key: "RB2", before: 9, after: 12 }] } })[0]).toBe("Your RB2 spot goes from 9 to 12 projected points per week.");
  });

  it("lists my biggest slot loss (or the lineup's loss) with the caveats", () => {
    const r = reasonsOf({ dPPW: 1.5, detail: { mySlots: [{ key: "RB2", before: 9.1, after: 14.3 }, { key: "TE1", before: 12.2, after: 8.0 }, { key: "WR2", before: 10, after: 9 }] } });
    expect(r).toEqual(["Your RB2 spot goes from 9.1 to 14.3 projected points per week.", EVEN, "Your TE spot drops from 12.2 to 8 projected points per week."]);
    expect(reasonsOf({ dPPW: -0.8 })).toEqual([EVEN, "Your starting lineup loses 0.8 projected points per week."]);
  });

  it("says a redraft B that only the trade value explains is mostly a trade-value win, in words only, as the model reads it (planner reply to Checkpoint 7a, 5.4)", () => {
    const even = config.explain.valueEven;
    // I give Bo Nix for Travis Kelce: FantasyCalc's plain sums say I get 30% more (their gain is −1/1.3 + 1).
    const fc30 = fcGain(["nix"], ["kelce"], 1 / 1.3 - 1);
    // B is all market term here (B_win 0: no odds change).
    expect(reasonsOf({ b: 0.3, bWin: 0, gMine: 0.3 }, fc30)[0]).toBe(MOSTLY);
    expect(reasonsOf({ b: 0.3, bWin: 0, gMine: 0.3 }, fc30)).not.toContain(BARE);
    // FantasyCalc's sums read even (the model's g comes from its roster-spot count): the same words, the model's reading.
    expect(reasonsOf({ b: 0.3, bWin: 0, gMine: 0.3 })[0]).toBe(MOSTLY);
    // I give nothing of value.
    expect(reasonsOf({ give: [], get: ["kelce"], b: 0.3, bWin: 0, gMine: Number.POSITIVE_INFINITY, gPartner: -1 })[0]).toBe(MOSTLY);
    expect(reasonsOf({ b: 0.05, bWin: 0, gMine: even }, fcGain(["nix"], ["kelce"], 1 / (1 + even) - 1))[0]).toBe(MOSTLY);
    // Not when something else explains it, the model's value gain is small, B ≤ 0 or unknown, or the league isn't redraft.
    expect(reasonsOf({ b: 0.3, bWin: 0, gMine: 0.3, dPPW: 1 }, fc30)[0]).toBe("Your starting lineup gains 1 projected point per week.");
    expect(reasonsOf({ b: 0.3, bWin: 0, gMine: 0.3, dPO: 0.01 }, fc30)[0]).toBe("Raises your playoff odds by 1 percentage point.");
    expect(reasonsOf({ b: 0.3, bWin: 0, gMine: even - 0.01 }, fc30)[0]).toBe(BARE);
    expect(reasonsOf({ b: -0.1, bWin: -0.4, gMine: 0.3 }, fc30).join(" ")).not.toContain("Mostly");
    expect(reasonsOf({ b: null, bWin: null, gMine: 0.3 }, fc30).join(" ")).not.toContain("Mostly");
    expect(reasonsOf({ b: 0.3, bWin: 0, gMine: 0.3 }, { ...fc30, leagueType: "dynasty" }).join(" ")).not.toContain("Mostly");
  });

  it("only when the market term itself (B − B_win) is positive and most of B, every player at max(v, W) (the value floor on both sides)", () => {
    const fc30 = fcGain(["nix"], ["kelce"], 1 / 1.3 - 1);
    const WIN = MOSTLY;
    // B − B_win is the term: positive and at least B_win → the line (B_win may be below 0: the term carries all of B).
    expect(reasonsOf({ b: 0.06, bWin: 0.02, gMine: 0.3 }, fc30)[0]).toBe(WIN);
    expect(reasonsOf({ b: 0.06, bWin: 0.03, gMine: 0.3 }, fc30)[0]).toBe(WIN);
    expect(reasonsOf({ b: 0.1, bWin: -0.2, gMine: 0.3 }, fc30)[0]).toBe(WIN);
    // Positive but less than B_win (B comes mostly from odds changes too small to print), at or below 0, or no B_win: not said.
    expect(reasonsOf({ b: 0.06, bWin: 0.04, gMine: 0.3 })[0]).toBe(BARE);
    expect(reasonsOf({ b: 0.04, bWin: 0.04, gMine: 0.3 })[0]).toBe(BARE);
    expect(reasonsOf({ b: 0.3, bWin: 0.3, gMine: 0.3 })[0]).toBe(BARE);
    expect(reasonsOf({ b: 0.3, bWin: null, gMine: 0.3 })[0]).toBe(BARE);
    // The reviews' N10 cases, through the real B: since the value floor on both sides (planner reply to Checkpoint 4,
    // change 4) every player counts at max(v, W), so these read even or a hair under at market (they read +5% and +5.6%
    // before it); B > 0 comes from odds changes that round to 0.0 percentage points.
    const W = 628;
    const cases = [
      // A 1-for-1: I give a player worth 595 for one worth 625 (both below W, so both count W): even.
      { values: { nix: 595, kelce: 625 }, give: ["nix"], get: ["kelce"], dPO: 0.0003, dCH: 0.0004 },
      // I give a 5,000 player and a 300 one (counted W) for a 4,970 player and the open spot's W: −0.5%.
      { values: { nix: 5000, kyren: 300, kelce: 4970 }, give: ["nix", "kyren"], get: ["kelce"], dPO: 0.0002, dCH: 0.0004 },
    ];
    for (const c of cases) {
      const raw = tradePackage({ players: c.get }, { players: c.give }, c.values, W);
      const b = benefit({ leagueType: "redraft", dPO: c.dPO, dCH: c.dCH, gMine: raw.g, dynasty: null, myPPlayoffs: 0.7, kappa: config.benefit.protectValue.medium, b3: 5 });
      expect(raw.g).toBeLessThan(config.explain.valueEven);
      expect(b.market).toBeLessThanOrEqual(0);
      expect(b.b as number).toBeGreaterThan(0);
      const r = reasonsOf({ give: c.give, get: c.get, b: b.b, bWin: b.bWin, gMine: raw.g, dPO: c.dPO, dCH: c.dCH, value: { given: raw.give, received: raw.recv } });
      expect(r.join(" "), c.give.join("+")).not.toContain("Mostly");
      expect(r[0]).toBe(BARE);
    }
  });

  it("starts with 'Doesn't help you' when B ≤ 0 (the Analyzer shows such trades)", () => {
    expect(reasonsOf({ b: -0.4, dPPW: -1 })[0]).toBe("Doesn't help you overall, so the Trade Finder leaves trades like this out.");
    expect(reasonsOf({ b: 0 })[0]).toBe("Doesn't help you overall, so the Trade Finder leaves trades like this out.");
    expect(reasonsOf({ b: null }).join(" ")).not.toContain("Doesn't help");
  });

  it("dynasty and keeper leagues: my roster's long-term value, in words only (FantasyCalc's dynasty values: planner reply to Checkpoint 7a, 5.4), placed by how much the trade leans to the future", () => {
    const scale = config.benefit.bFutureScale; // B_future = scale × ΔDyn / MyDynTotal
    const dyn = { leagueType: "dynasty" as const };
    const future = reasonsOf({ dPPW: 2, dPO: 0.02, dCH: 0, bFuture: 0.06 * scale, lambda: 0.75 }, dyn);
    expect(future.slice(0, 3)).toEqual(["Your starting lineup gains 2 projected points per week.", "Raises your roster's long-term value.", "Raises your playoff odds by 2 percentage points."]);
    const now = reasonsOf({ dPPW: 2, dPO: 0.02, dCH: 0, bFuture: 0.06 * scale, lambda: 0.35 }, dyn);
    expect(now.slice(0, 3)).toEqual(["Your starting lineup gains 2 projected points per week.", "Raises your playoff odds by 2 percentage points.", "Raises your roster's long-term value."]);
    const loss = reasonsOf({ dPPW: 2, bFuture: -0.04 * scale, lambda: 0.5 }, { ...dyn, ...fc({ nix: 5000, kelce: 5000 }) });
    expect(loss).toContain("Lowers your roster's long-term value.");
    expect(loss).toContain(EVEN);
    expect([...future, ...loss].join(" ")).not.toMatch(/\d+%/);
    // Under longTermMin (1%), or rounding to 0%: not said.
    expect(reasonsOf({ dPPW: 2, bFuture: 0.004 * scale, lambda: 0.5 }, dyn).join(" ")).not.toContain("long-term");
    // Redraft leagues never say it.
    expect(reasonsOf({ dPPW: 2, bFuture: 0.06 * scale, lambda: 0.5 }).join(" ")).not.toContain("long-term");
  });

  it("says once, last, when long-term values are missing (Checkpoint 2: the card says so)", () => {
    const r = reasonsOf({ dPPW: 2, dynMissing: true, lambda: 0.2 }, { leagueType: "keeper" });
    expect(r[r.length - 1]).toBe(benefitNotes({ titleMissing: false, dynMissing: true })[0]);
    expect(reasonsOf({ dPPW: 2, dynMissing: true }).join(" ")).not.toContain("Long-term"); // redraft: not applicable
  });
});

describe("their side", () => {
  it("a filled hole names their rank there (the hole they rank worst at); without a rank, the hole itself", () => {
    const terms = acceptanceTerms({ need: 0.2, hole: 0.4 });
    const two = reasonsOf({
      detail: {
        terms,
        holesFilled: ["RB2", "TE1"],
        partnerSlots: [
          { key: "RB2", before: 5, after: 9, rank: 8 },
          { key: "TE1", before: 4, after: 6, rank: 10 },
        ],
      },
    });
    expect(two).toContain("They're 10th of 10 at TE, and this gives them a starter.");
    expect(reasonsOf({ detail: { terms, holesFilled: ["WR2"] } })).toContain("Their WR2 spot is weak over the next 3 weeks, and this gives them a starter there.");
    expect(reasonsOf({ detail: { terms, holesFilled: ["TE1"], partnerSlots: [{ key: "TE1", before: 4, after: 6, rank: 9 }], teams: 0 } })).toContain("Their TE spot is weak over the next 3 weeks, and this gives them a starter there.");
  });

  it("quotes the rank at a filled hole only in the bottom part of the league; a better rank is a short-term hole", () => {
    expect(config.acceptance.holeWeeks).toBe(3);
    const hole = (rank: number, cfg?: ExplainConfig) =>
      reasonsOf({ detail: { terms: acceptanceTerms({ need: 0.2, hole: 0.4 }), holesFilled: ["TE1"], partnerSlots: [{ key: "TE1", before: 4, after: 9, rank }] } }, {}, cfg).find((r) => r.includes("starter"));
    const shortTerm = "Their TE spot is weak over the next 3 weeks, and this gives them a starter there.";
    expect(hole(2)).toBe(shortTerm); // an injured star: a short-term hole
    expect(hole(5)).toBe(shortTerm); // 5 of 10 isn't below the middle (rank > 10 × 0.5)
    expect(hole(6)).toBe("They're 6th of 10 at TE, and this gives them a starter.");
    expect(hole(4, { ...config.explain, holeRankFromBottom: 0.3 })).toBe("They're 4th of 10 at TE, and this gives them a starter.");
    // The pitch follows the same rule.
    const pitchAt = (rank: number) => explain({ give: ["kelce"], get: ["bijan"], detail: { holesFilled: ["TE1"], partnerSlots: [{ key: "TE1", before: 4, after: 9, rank }] } }).pitch;
    expect(pitchAt(2)).toContain("Looks like you could use help at TE over the next 3 weeks, and Travis Kelce would start for you there.");
    expect(pitchAt(8)).toContain("Looks like you could use help at TE, and Travis Kelce would start for you there.");
  });

  it("without a hole: their biggest slot gain, else their lineup's weekly change, up or down", () => {
    const terms = acceptanceTerms({ need: 0.3 });
    expect(reasonsOf({ partnerDeltaLineup: 2.4, detail: { terms, partnerSlots: [{ key: "WR2", before: 7, after: 12.4, rank: 6 }] } })).toContain("Their WR2 spot goes from 7 to 12.4 projected points per week.");
    expect(reasonsOf({ partnerDeltaLineup: 2.4, detail: { terms } })).toContain("It adds 2.4 projected points per week to their starting lineup.");
    expect(reasonsOf({ partnerDeltaLineup: -1.5, detail: { terms: acceptanceTerms({ need: -0.18 }) } })).toContain("It costs their starting lineup 1.5 projected points per week, a harder sell.");
    // A lineup change that barely moved the estimate (under termMin) isn't said.
    expect(reasonsOf({ partnerDeltaLineup: 0.7, detail: { terms: acceptanceTerms({ need: 0.08 }) } }).join(" ")).not.toContain("their starting lineup");
  });

  it("words trade value from their side as the model reads it: they come out ahead, about even, or they give up more (expect pushback)", () => {
    const side = (gain: number, over: EvaluationFixture = {}) => reasonsOf({ gPartner: gain, gMine: 1 / (1 + gain) - 1, ...over }, fcGain(["nix"], ["kelce"], gain));
    expect(side(0.11, { detail: { terms: acceptanceTerms({ value: 0.67 }) } })).toContain(AHEAD_YES);
    expect(side(0.03)).toContain(EVEN);
    expect(side(1 / 1.15 - 1, { detail: { terms: acceptanceTerms({ value: -1.17 }) } })).toContain(BEHIND);
    // A one-sided trade from me (they'd get nothing), and one they'd get for nothing.
    expect(reasonsOf({ give: [], get: ["kelce"], gMine: Number.POSITIVE_INFINITY, gPartner: -1 })).toContain(BEHIND);
    expect(reasonsOf({ give: ["nix"], get: [], gMine: -1, gPartner: Number.POSITIVE_INFINITY })).toContain(AHEAD_YES);
    // A g the model couldn't read: nothing about trade value.
    expect(reasonsOf({ gPartner: Number.NaN, gMine: Number.NaN })).toEqual([BARE]);
  });

  it("⚠️ says nothing about trade value when none is behind the trade (no lookup; or no FantasyCalc value for any of its players and a g of 0, as with no values at all)", () => {
    const valueLine = (r: readonly string[]) => r.find((x) => x === EVEN || x.startsWith("They come out ahead") || x === BEHIND) ?? null;
    const ctx = fc({ nix: 5000, kelce: 5000 });
    // A player FantasyCalc doesn't value (an estimate in the model) beside ones it does: the model's reading, never naming FantasyCalc.
    expect(valueLine(reasonsOf({ give: ["nix", "kyren"], get: ["kelce"] }, ctx))).toBe(EVEN);
    expect(valueLine(reasonsOf({ give: ["nix", "kyren"], get: ["kelce"], gPartner: 0.2, gMine: 1 / 1.2 - 1 }, ctx))).toBe(AHEAD_YES);
    // Picks beside a valued player, the same.
    const pick = {
      partnerId: "7",
      give: [{ kind: "player" as const, id: "nix" }, { kind: "pick" as const, season: 2027, round: 2, originalTeamId: "3" }],
      get: [{ kind: "pick" as const, season: 2028, round: 1, originalTeamId: "7" }],
    };
    expect(valueLine(reasonsOf({ proposal: pick }, ctx))).toBe(EVEN);
    // None of its players valued by FantasyCalc: our estimates still read (FantasyCalc's curve fallback) when they move g …
    expect(valueLine(reasonsOf({ give: ["kyren"], get: ["laporta"], gPartner: -0.2, gMine: 0.25 }, ctx))).toBe(BEHIND);
    // … and with a g of exactly 0 (no values loaded: every g is 0; or a kicker for a D/ST at the same flat minimum), nothing.
    expect(valueLine(reasonsOf({ give: ["kyren"], get: ["laporta"] }, ctx))).toBeNull();
    expect(valueLine(reasonsOf({ give: ["kyren"], get: ["laporta"] }, fc({})))).toBeNull();
    expect(reasonsOf({ give: ["kyren"], get: ["laporta"] }, fc({})).join(" ")).not.toMatch(/FantasyCalc|trade value/);
    // Without FantasyCalc's values at all (no lookup), nothing is said about trade value.
    expect(explainTrade(tradeEvaluation({ ...QUIET }), explainContext()).reasons).toEqual([BARE]);
    // The pitch never says anything about value.
    expect(explain({ give: ["nix", "kyren"], get: ["kelce"] }, ctx).pitch).not.toContain("trade value");
  });

  it("words any gap the same, however large: never a percent or a multiple (planner reply to Checkpoint 7a, 5.4)", () => {
    // They give up `over` more than they get: their gain is 1 / (1 + over) − 1.
    const pushback = (over: number) => reasonsOf({ gMine: over, detail: { terms: acceptanceTerms({ value: -4.5 }) } }, fcGain(["nix"], ["kelce"], 1 / (1 + over) - 1));
    for (const over of [8, 8.25, 1.5, 1]) expect(pushback(over)).toContain(BEHIND);
    const theyGet = (gain: number) => reasonsOf({ gPartner: gain, gMine: 1 / (1 + gain) - 1, detail: { terms: acceptanceTerms({ value: 3 }) } }, fcGain(["nix"], ["kelce"], gain));
    for (const gain of [2, 0.44]) expect(theyGet(gain)).toContain(AHEAD_YES);
    expect(reasonsOf({ b: 0.3, bWin: 0, gMine: 3 }, fcGain(["nix"], ["kelce"], 1 / 4 - 1))[0]).toBe(MOSTLY);
    expect([...pushback(8), ...theyGet(2)].join(" ")).not.toMatch(/\d+%|times as much/);
  });

  it("reads trade value within valueEven either way as even, on the model's g_mkt(P)", () => {
    const even = config.explain.valueEven;
    const value = (gain: number) => reasonsOf({ gPartner: gain, gMine: 1 / (1 + gain) - 1, detail: { terms: acceptanceTerms({ value: 0.3 }) } }, fcGain(["nix"], ["kelce"], gain));
    expect(value(even)).toContain(AHEAD_YES);
    expect(value(even - 0.001)).toContain(EVEN);
    expect(value(-even + 0.001)).toContain(EVEN);
    expect(value(-even)).toContain(BEHIND);
  });

  it("compares FantasyCalc's plain sums, both ways (fantasyCalcComparison)", () => {
    const table: Record<string, number> = { a: 3000, b: 2500, c: 5000 };
    const lookup = (id: string) => table[id] ?? null;
    const c = fantasyCalcComparison({ give: [{ kind: "player", id: "a" }, { kind: "player", id: "b" }], get: [{ kind: "player", id: "c" }] }, { fantasyCalcValue: lookup });
    expect(c).toEqual({ kind: "known", theyGet: 5500, theyGive: 5000 });
    if (c.kind !== "known") throw new Error("known");
    expect(partnerFantasyCalcGain(c)).toBeCloseTo(0.1, 12);
    expect(myFantasyCalcGain(c)).toBeCloseTo(5000 / 5500 - 1, 12);
    expect(partnerFantasyCalcGain({ kind: "known", theyGet: 100, theyGive: 0 })).toBe(Number.POSITIVE_INFINITY);
    expect(partnerFantasyCalcGain({ kind: "known", theyGet: 0, theyGive: 0 })).toBe(0);
    expect(fantasyCalcComparison({ give: [], get: [] }, {})).toEqual({ kind: "none" });
    // A value that isn't a positive finite number, or a lookup that throws, is missing.
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(fantasyCalcComparison({ give: [{ kind: "player", id: "x" }], get: [] }, { fantasyCalcValue: () => bad }).kind).toBe("missing");
    expect(fantasyCalcComparison({ give: [{ kind: "player", id: "x" }], get: [] }, { fantasyCalcValue: () => { throw new Error("boom"); } })).toEqual({ kind: "missing", assets: [{ kind: "player", id: "x" }] });
  });

  it("activity: active, quiet, inactive; nothing for a normal partner", () => {
    const act = (a: Partial<ReturnType<typeof activitySummary>>, term: number) => reasonsOf({ detail: { activity: activitySummary(a), terms: acceptanceTerms({ activity: term }) } });
    const w = config.acceptance.activity;
    expect(act({ a: 1, rule: "active", trades: 3, recentTrades: 1 }, 0.35)).toContain("Active trader: 3 trades this season.");
    expect(act({ a: 1, rule: "active", trades: 1, recentTrades: 1 }, 0.35)).toContain(`Active trader: a trade in the last ${w.recentTradeWeeks} weeks.`);
    expect(act({ a: -2, rule: "inactive", transactions: 4 }, -0.7)).toContain(`Quiet lately: no moves in ${w.inactiveWeeks} weeks.`);
    expect(act({ a: -2, rule: "inactive", transactions: 0, lastWeek: null }, -0.7)).toContain("Quiet: no moves this season.");
    expect(act({ a: -1, rule: "quiet" }, -0.35)).toContain(`Quiet lately: no moves in ${w.quietWeeks} weeks.`);
    expect(act({ a: 0, rule: "normal" }, 0)).toEqual([BARE, EVEN]);
  });

  it("their trade history on value, without a percent (⚠️ Phase 4c: the average is the model's floored g, which the card doesn't print)", () => {
    const hist = (average: number | null, term: number) => reasonsOf({ detail: { history: { trades: 2, average }, terms: acceptanceTerms({ history: term }) } });
    expect(hist(0.12, -0.36)).toContain("They tend to win their trades on value this season, so they may want more.");
    expect(hist(Number.POSITIVE_INFINITY, -0.45)).toContain("They tend to win their trades on value this season, so they may want more.");
    expect(hist(-0.08, 0.24)).toContain("They've given up value in their trades this season, so they may be open to this.");
    expect(hist(0.12, -0.36).join(" ")).not.toMatch(/on average|\d+%/);
    expect(hist(null, 0)).toEqual([BARE, EVEN]);
    expect(hist(0.02, -0.06)).toEqual([BARE, EVEN]); // under termMin
  });

  it("season context: checked out, rebuilding with older players coming in, a contender", () => {
    const c = config.acceptance.context;
    const ctxLine = (context: Partial<ReturnType<typeof contextTerm>>, term: number, n = 0, leagueType: ExplainContext["leagueType"] = "redraft") =>
      reasonsOf({ features: { g: 0, n, h: 0, c: 0, a: 0, hist: null, ctx: term, hot: 0, urg: 0, z: 0 }, detail: { context: contextTerm(context), terms: acceptanceTerms({ context: term }) } }, { leagueType });
    expect(ctxLine({ checkedOut: true, ctx: c.checkedOut }, c.checkedOut)).toContain("They're all but out of the playoff race (under 5% to make it), so they may have checked out.");
    expect(ctxLine({ agingPlayers: 2, ctx: -0.5 }, -0.5, 0, "dynasty")).toContain(`They're rebuilding, and 2 of the players they'd get are ${c.oldPlayerAge} or older.`);
    expect(ctxLine({ agingPlayers: 1, ctx: -0.25 }, -0.25, 0, "dynasty")).toContain(`They're rebuilding, and one of the players they'd get is ${c.oldPlayerAge} or older.`);
    expect(ctxLine({ contender: true }, 0.18, 1)).toContain("They're contending (over 60% to make the playoffs), so lineup help counts extra.");
    expect(ctxLine({ contender: true }, -0.18, -1)).toContain("They're contending (over 60% to make the playoffs), so losing lineup points counts extra.");
    expect(ctxLine({ contender: true }, 0.05, 0.3)).toEqual([BARE, EVEN]); // under termMin
  });

  it("hot players coming or going", () => {
    const h = config.acceptance.hot;
    expect(reasonsOf({ detail: { hotReceived: ["kelce"], terms: acceptanceTerms({ hot: h.bonus }) } })).toContain(`They'd get Travis Kelce, who has scored at least ${h.multiple} times his projection in each of the last ${h.weeks} weeks.`);
    expect(reasonsOf({ detail: { hotGiven: ["bijan", "nacua"], terms: acceptanceTerms({ hot: -h.bonus }) } })).toContain(
      `They'd give up Bijan Robinson and Puka Nacua, who have scored at least ${h.multiple} times their projection in each of the last ${h.weeks} weeks, so they may want to keep them.`,
    );
    // Both ways cancel in the model (hot 0): nothing to say.
    expect(reasonsOf({ detail: { hotReceived: ["kelce"], hotGiven: ["bijan"], terms: acceptanceTerms({ hot: 0 }) } })).toEqual([BARE, EVEN]);
  });

  it("the deadline being near", () => {
    const u = config.acceptance.urgency;
    const urg = { detail: { urgency: u.bonus, terms: acceptanceTerms({ urgency: u.bonus }) } };
    expect(reasonsOf(urg)).toContain(`The trade deadline is within ${u.days} days, so managers are more ready to deal.`);
    expect(reasonsOf(urg, { tradeDeadline: { week: 13 } })).toContain("The trade deadline is close (week 13), so managers are more ready to deal.");
    expect(reasonsOf(urg, { tradeDeadline: null })).toContain("The trade deadline is close, so managers are more ready to deal.");
    expect(reasonsOf({ detail: { urgency: 0 } }).join(" ")).not.toContain("deadline");
  });

  it("keeps at most partnerReasons lines, the ones that moved the estimate most first (ties: lineup, value, star premium, activity, history, context, hot, deadline)", () => {
    const detail = {
      activity: activitySummary({ a: 1, rule: "active" as const, trades: 4 }),
      history: { trades: 4, average: 0.1 },
      hotReceived: ["kelce"],
      urgency: 0.2,
      terms: acceptanceTerms({ value: 0.2, activity: 0.35, history: -0.3, hot: 0.15, urgency: 0.2 }),
    };
    const r = reasonsOf({ gMine: -0.035, detail }); // even value (term 0.2)
    expect(r).toEqual([
      "Barely changes your starting lineup.",
      "Active trader: 4 trades this season.",
      "They tend to win their trades on value this season, so they may want more.",
      EVEN, // value 0.2 ties the deadline's 0.2: the value line comes first
    ]);
    const one = reasonsOf({ gMine: -0.035, detail }, {}, { ...config.explain, partnerReasons: 1 });
    expect(one).toEqual(["Barely changes your starting lineup.", "Active trader: 4 trades this season."]);
  });
});

describe("caveats and notes", () => {
  it("names injured players I'd get, with their status when the context knows it", () => {
    expect(reasonsOf({ dPPW: 2, flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: ["cmc"] } })).toContain(
      "Depends on an injured player: Christian McCaffrey is on injured reserve, and the numbers assume he returns as expected.",
    );
    expect(reasonsOf({ dPPW: 2, flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: ["kelce"] } })).toContain(
      "Depends on an injured player: Travis Kelce is injured, and the numbers assume he returns as expected.",
    );
    expect(reasonsOf({ dPPW: 2, flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: ["cmc", "jacobs", "ghost"] } })).toContain(
      "Depends on injured players: Christian McCaffrey (on injured reserve), Josh Jacobs (out) and Unknown player (ghost), and the numbers assume they return as expected.",
    );
  });

  it("leaves the market check to the card's flag and keeps their side's value line", () => {
    const gain = (gMine: number) => 1 / (1 + gMine) - 1;
    const check = reasonsOf({ dPPW: 2, gMine: -0.15 - 0.03, detail: { terms: acceptanceTerms({ value: 0.75 }) } }, fcGain(["nix"], ["kelce"], gain(-0.18)));
    expect(check).toContain(AHEAD_YES);
    expect(check.join(" ")).not.toMatch(/Market check|you give up|left out|hidden|hides/i);
    const hidden = reasonsOf({ dPPW: 2, gMine: -0.4, detail: { terms: acceptanceTerms({ value: 3 }) } }, fcGain(["nix"], ["kelce"], gain(-0.4)));
    expect(hidden).toContain(AHEAD_YES);
    expect(hidden.join(" ")).not.toMatch(/Market check|left out|hidden|hides/i);
    // I get nothing back.
    expect(reasonsOf({ give: ["nix"], get: [], dPPW: 2, gMine: -1, gPartner: Number.POSITIVE_INFINITY })).toContain(AHEAD_YES);
  });

  it("the veto risk, counting roster spots: the model's count, which can be far from FantasyCalc's plain sums (review of track UIC, finding 1)", () => {
    expect(config.acceptance.veto.factor).toBe(0.5);
    expect(reasonsOf({ dPPW: 2, gMine: 0.5, detail: { vetoRisk: true } })).toContain(VETO);
    // Two players of mine, each worth less than the best free agent, for one of theirs worth their sum: FantasyCalc's sums
    // read the trade as even, while the model's package (one of them a neutral throw-in, the other counted at the best free
    // agent's worth) has them give up 45%, past the veto line. The caveat says whose count it is, as the value line reads it.
    const cheap = reasonsOf({ give: ["nix", "kyren"], get: ["kelce"], dPPW: 2, gMine: 0.82, gPartner: -0.45, detail: { vetoRisk: true } }, fc({ nix: 600, kyren: 500, kelce: 1100 }));
    expect(cheap).toContain(BEHIND);
    expect(cheap).toContain(VETO);
    expect(cheap.join(" ")).not.toContain("one this uneven");
    // No veto risk, no caveat.
    expect(reasonsOf({ dPPW: 2, gMine: 0.5 }).join(" ")).not.toContain("veto");
  });

  it("orders the groups: why it helps me, their side, caveats, notes", () => {
    const r = reasonsOf(
      {
        dPPW: 2.5,
        dPO: 0.05,
        dCH: 0.02,
        gMine: 0.12,
        dynMissing: true,
        lambda: 0.2,
        flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: ["cmc"] },
        detail: {
          mySlots: [{ key: "RB1", before: 12, after: 17.5 }, { key: "WR2", before: 11, after: 9.5 }],
          vetoRisk: true,
          activity: activitySummary({ a: -1, rule: "quiet" }),
          terms: acceptanceTerms({ value: -1.0, activity: -0.35 }),
        },
      },
      { ...fcGain(["nix"], ["kelce"], 1 / 1.12 - 1), leagueType: "keeper" },
    );
    expect(r).toEqual([
      "Your RB1 spot goes from 12 to 17.5 projected points per week.",
      "Raises your playoff odds by 5 and your title odds by 2 percentage points.",
      BEHIND,
      `Quiet lately: no moves in ${config.acceptance.activity.quietWeeks} weeks.`,
      "Depends on an injured player: Christian McCaffrey is on injured reserve, and the numbers assume he returns as expected.",
      "Your WR2 spot drops from 11 to 9.5 projected points per week.",
      VETO,
      "Long-term trade values aren't available, so “Helps you” counts this season only.",
    ]);
  });
});

describe("the pitch", () => {
  it("leads with the hole it fills, naming the player who'd start there, then names the trade from their side", () => {
    const { pitch } = explain({
      give: ["kelce", "nix"],
      get: ["bijan"],
      detail: { holesFilled: ["TE1"], partnerSlots: [{ key: "TE1", before: 4, after: 11, rank: 9 }], terms: acceptanceTerms({ hole: 0.4 }) },
    });
    expect(pitch).toBe("Hey! Looks like you could use help at TE, and Travis Kelce would start for you there. Would you trade Bijan Robinson for Travis Kelce and Bo Nix? Let me know what you think!");
  });

  it("says 'this' when it can't tell who'd start there", () => {
    const { pitch } = explain({ give: ["kelce", "laporta"], get: ["bijan"], detail: { holesFilled: ["TE1"] } });
    expect(pitch).toContain("Looks like you could use help at TE over the next 3 weeks, and this would give you a starter there.");
    const flex = explain({ give: ["nacua", "kyren"], get: ["bijan"], detail: { holesFilled: ["RB/WR/TE1"] } }).pitch;
    expect(flex).toContain("Looks like you could use help at FLEX over the next 3 weeks, and this would give you a starter there.");
    const one = explain({ give: ["nacua"], get: ["bijan"], detail: { holesFilled: ["RB/WR/TE1"] } }).pitch;
    expect(one).toContain("Looks like you could use help at FLEX over the next 3 weeks, and Puka Nacua would start for you there.");
    // Of two players sent, the one whose position the slot takes; a lone player the slot rules out isn't named.
    expect(explain({ give: ["kelce", "nix"], get: ["bijan"], detail: { holesFilled: ["TE1"] } }).pitch).toContain("and Travis Kelce would start for you there.");
    expect(explain({ give: ["nix"], get: ["bijan"], detail: { holesFilled: ["TE1"] } }).pitch).toContain("and this would give you a starter there.");
  });

  it("names the player in a slot fact only when he can play that slot", () => {
    const slotPitch = (give: string[], key: string, ctxOver: Partial<ExplainContext> = {}) =>
      explain({ give, get: ["bijan"], partnerDeltaLineup: 2, detail: { partnerSlots: [{ key, before: 7, after: 12, rank: 7 }] } }, ctxOver).pitch;
    expect(slotPitch(["nacua"], "RB2")).toContain("Hey! This would upgrade your RB2 spot from 7 to 12 projected points a week.");
    expect(slotPitch(["kyren"], "RB2")).toContain("Hey! Kyren Williams would upgrade your RB2 spot");
    expect(slotPitch(["nacua"], "RB/WR/TE1")).toContain("Hey! Puka Nacua would upgrade your FLEX spot"); // a flex takes WRs
    expect(slotPitch(["steelers"], "D/ST1")).toContain("Hey! Steelers D/ST would upgrade your D/ST spot"); // the D/ST alias
    expect(slotPitch(["nacua", "kelce"], "TE1")).toContain("Hey! Travis Kelce would upgrade your TE spot");
    expect(slotPitch(["nacua", "wilson"], "WR2")).toContain("Hey! This would upgrade your WR2 spot"); // two WRs: can't tell
    expect(slotPitch(["nacua"], "SUPER_FLEX1")).toContain("Hey! This would upgrade your SUPER_FLEX1 spot"); // a slot the context doesn't list
    // Sleeper's flex names, and an eligible list on the instance.
    const sleeperSlots = { slots: [{ key: "SUPER_FLEX1", label: "SF", slot: "SUPER_FLEX", rank: 1 }, { key: "X1", label: "X", slot: "ODD_SLOT", rank: 1, eligible: ["WR" as const] }] };
    expect(slotPitch(["nix"], "SUPER_FLEX1", sleeperSlots)).toContain("Hey! Bo Nix would upgrade your SF spot");
    expect(slotPitch(["nacua"], "X1", sleeperSlots)).toContain("Hey! Puka Nacua would upgrade your X spot");
    expect(slotPitch(["kyren"], "X1", sleeperSlots)).toContain("Hey! This would upgrade your X spot");
  });

  it("else their slot or lineup gain, and never the trade value they gain (planner reply to Checkpoint 7a, 5.4)", () => {
    // FantasyCalc's own values (the context's): Puka Nacua 5,000, Kyren Williams 4,500 → they'd get 11% more: not said.
    const slot = explain({ give: ["nacua"], get: ["kyren"], gMine: -0.1, partnerDeltaLineup: 2.2, detail: { partnerSlots: [{ key: "WR2", before: 7, after: 12.4, rank: 7 }] } }, fc({ nacua: 5000, kyren: 4500 })).pitch;
    expect(slot).toBe("Hey! Puka Nacua would upgrade your WR2 spot from 7 to 12.4 projected points a week. Would you trade Kyren Williams for Puka Nacua? Let me know what you think!");
    const lineup = explain({ give: ["nacua", "kyren"], get: ["bijan"], partnerDeltaLineup: 1.3 }).pitch;
    expect(lineup).toBe("Hey! This adds about 1.3 projected points a week to your starting lineup. Would you trade Bijan Robinson for Puka Nacua and Kyren Williams? Let me know what you think!");
    const value = explain({ give: ["nacua"], get: ["kyren"], gMine: -0.2, partnerDeltaLineup: -2 }, fc({ nacua: 5000, kyren: 4000 })).pitch;
    expect(value).toBe("Hey! Would you trade Kyren Williams for Puka Nacua? Let me know what you think!");
    const plain = explain({ give: ["nacua"], get: ["kyren"], gMine: 0.1, partnerDeltaLineup: -2 }, fc({ nacua: 4500, kyren: 5000 })).pitch;
    expect(plain).toBe("Hey! Would you trade Kyren Williams for Puka Nacua? Let me know what you think!");
  });

  it("never mentions trade value, whatever the gain, FantasyCalc's sums or the model's package (planner reply to Checkpoint 7a, 5.4)", () => {
    const ask = "Would you trade Kyren Williams for Puka Nacua? Let me know what you think!";
    const valuePitch = (gain: number, over: EvaluationFixture = {}) => explain({ give: ["nacua"], get: ["kyren"], ...over }, fc({ nacua: 4000 * (1 + gain), kyren: 4000 })).pitch;
    for (const gain of [0.2, 0.25, 0.05, 0.049, 0.44, -0.2]) expect(valuePitch(gain), String(gain)).toBe(`Hey! ${ask}`);
    // A lineup fit leads alone, whatever the value.
    for (const gain of [0.1, 0.44]) {
      expect(valuePitch(gain, { partnerDeltaLineup: 2, detail: { partnerSlots: [{ key: "WR2", before: 7, after: 12, rank: 7 }] } })).toBe(
        `Hey! Puka Nacua would upgrade your WR2 spot from 7 to 12 projected points a week. ${ask}`,
      );
    }
    // The model's package g either way, with or without FantasyCalc's values, a pick, two for one, a lookup that throws.
    expect(explain({ give: ["nacua"], get: ["kyren"], gPartner: 0.17, gMine: 1 / 1.17 - 1 }, fc({ nacua: 4581, kyren: 4452 })).pitch).toBe(`Hey! ${ask}`);
    expect(explain({ give: ["nacua"], get: ["kyren"], gPartner: -0.1, gMine: 1 / 0.9 - 1 }, fc({ nacua: 5600, kyren: 5000 })).pitch).toBe(`Hey! ${ask}`);
    expect(explainTrade(tradeEvaluation({ ...QUIET, give: ["nacua"], get: ["kyren"], gPartner: 0.1, gMine: 1 / 1.1 - 1 }), explainContext()).pitch).toBe(`Hey! ${ask}`);
    const pick = { partnerId: "7", give: [{ kind: "player" as const, id: "nacua" }, { kind: "pick" as const, season: 2027, round: 2, originalTeamId: "3" }], get: [{ kind: "player" as const, id: "kyren" }] };
    expect(explain({ proposal: pick }, fc({ nacua: 5000, kyren: 4800 })).pitch).not.toMatch(/trade value|FantasyCalc|\d+%/);
    expect(explain({ give: ["nacua", "nix"], get: ["kyren"] }, fc({ nacua: 3000, nix: 2500, kyren: 5000 })).pitch).not.toMatch(/trade value|FantasyCalc|\d+%/);
    expect(explain({ give: ["nacua"], get: ["kyren"] }, { fantasyCalcValue: () => { throw new Error("boom"); } }).pitch).toBe(`Hey! ${ask}`);
  });

  it("names picks and one-sided trades", () => {
    const picks = explain({
      proposal: {
        partnerId: "7",
        give: [{ kind: "pick", season: 2027, round: 1, originalTeamId: "3" }, { kind: "pick", season: 2027, round: 2, originalTeamId: "9" }],
        get: [{ kind: "pick", season: 2028, round: 3, originalTeamId: "7" }],
      },
    }).pitch;
    expect(picks).toContain("Would you trade your 2028 3rd-round pick for my 2027 1st-round pick and Team 9's 2027 2nd-round pick?");
    expect(explain({ give: [], get: ["bijan"] }).pitch).toContain("Would you send me Bijan Robinson?");
    expect(explain({ give: ["nix"], get: [] }).pitch).toContain("Would you take Bo Nix, with nothing needed back?");
  });

  it("never claims what I gain", () => {
    const fixtures: EvaluationFixture[] = [
      { dPPW: 4, dPO: 0.08, dCH: 0.04, detail: { mySlots: [{ key: "RB2", before: 9, after: 15 }], riskyWeeks: [13], weekly: [{ week: 13, before: 90, after: 99 }] } },
      { dPPW: 2, gMine: -0.1, partnerDeltaLineup: 3, detail: { holesFilled: ["TE1"] } },
      { dPPW: 2, gMine: 0.2, partnerDeltaLineup: -1 },
      { dPPW: 2, bFuture: 3, lambda: 0.75 },
    ];
    for (const f of fixtures) {
      const { pitch, reasons } = explain(f, { leagueType: "dynasty" });
      expect(pitch.startsWith("Hey!")).toBe(true);
      expect(pitch).not.toMatch(/\b(I need|helps? me|my (lineup|team|odds|roster)|for me|I'd gain|I get)\b/i);
      expect(pitch).not.toMatch(/percentage point|long-term|risky/i);
      for (const r of reasons) if (r.startsWith("Your ") || r.startsWith("Raises your")) expect(pitch).not.toContain(r);
    }
  });
});

describe("the star premium (planner addendum to Checkpoint 3, §1; lead decision N7)", () => {
  const TOP = config.acceptance.starPremium.eliteTop;
  const EXTRA = "so expect them to want a little extra.";
  /** The ending when, counting the premium, they still come out ahead (one player, several). */
  const AHEAD = "but even if they rate him a bit above his trade value, they'd still come out ahead.";
  const AHEAD_THEM = "but even if they rate them a bit above their trade value, they'd still come out ahead.";
  /** β_gain: the value term of a perceived gain g is β_gain × g (inside the clamp). */
  const GAIN = config.acceptance.beta.gain;
  /**
   * I give Bijan Robinson for `get` (default Justin Jefferson) at even market value (FantasyCalc's own values agree with the
   * model's g_mkt(P) unless `ctxOver` says otherwise); the premium moved their value term to `perceived`.
   */
  const premiumReasons = (facts: PremiumFact[], over: EvaluationFixture = {}, perceived = -0.82, ctxOver?: Partial<ExplainContext>) => {
    const get = over.get ?? ["jefferson"];
    const gain = over.gPartner ?? 0;
    return reasonsOf({ give: ["bijan"], get: ["jefferson"], ...over, detail: { premium: facts, terms: acceptanceTerms({ value: perceived }), ...over.detail } }, ctxOver ?? fcGain(["bijan"], get, gain));
  };
  const premiumLineOf = (r: readonly string[]) => r.find((x) => x.endsWith(EXTRA) || x.endsWith(AHEAD) || x.endsWith(AHEAD_THEM)) ?? null;

  it("names the player and which part applies: their best or second-best player, a top-12 player, or both", () => {
    const line = (fact: PremiumFact) => premiumReasons([fact]);
    expect(line(premiumFact("jefferson"))).toEqual([BARE, `Justin Jefferson is their best player, ${EXTRA}`, EVEN]);
    expect(line(premiumFact("jefferson", { rank: 2 }))[1]).toBe(`Justin Jefferson is their second-best player, ${EXTRA}`);
    expect(line(premiumFact("jefferson", { rank: 4, elite: true }))[1]).toBe(`Justin Jefferson is a top-${TOP} player by trade value, ${EXTRA}`);
    expect(line(premiumFact("jefferson", { rank: 1, elite: true }))[1]).toBe(`Justin Jefferson is their best player and a top-${TOP} player by trade value, ${EXTRA}`);
    expect(line(premiumFact("jefferson", { rank: 2, elite: true }))[1]).toBe(`Justin Jefferson is their second-best player and a top-${TOP} player by trade value, ${EXTRA}`);
    // The dynasty rebuilding halving changes e, not the words.
    expect(line(premiumFact("jefferson", { rank: 1, elite: true, e: 0.1 }))[1]).toBe(`Justin Jefferson is their best player and a top-${TOP} player by trade value, ${EXTRA}`);
  });

  it("says nothing when no player they give has a premium (e = 0), or without premium facts (before the addendum)", () => {
    expect(premiumReasons([premiumFact("jefferson", { rank: 3 })], {}, 0)).toEqual([BARE, EVEN]);
    expect(premiumReasons([], {}, 0)).toEqual([BARE, EVEN]);
    expect(reasonsOf({ give: ["bijan"], get: ["jefferson"] })).toEqual([BARE, EVEN]);
  });

  it("lists several players, the most attached first (larger e, then the better rank, then the trade's order)", () => {
    const line = (facts: PremiumFact[], get = ["nacua", "jefferson"]) => premiumLineOf(premiumReasons(facts, { get }));
    expect(line([premiumFact("nacua", { rank: 2 }), premiumFact("jefferson", { rank: 1, elite: true })])).toBe(
      `They'd give up Justin Jefferson (their best player and a top-${TOP} player by trade value) and Puka Nacua (their second-best player), ${EXTRA}`,
    );
    // Equal premiums: the better rank first.
    expect(line([premiumFact("jefferson", { rank: 4, elite: true }), premiumFact("nacua", { rank: 1 })])).toBe(
      `They'd give up Puka Nacua (their best player) and Justin Jefferson (a top-${TOP} player by trade value), ${EXTRA}`,
    );
    // Equal premiums and ranks (inconsistent data): the trade's order, not the facts'.
    expect(line([premiumFact("jefferson"), premiumFact("nacua")])).toBe(`They'd give up Puka Nacua (their best player) and Justin Jefferson (their best player), ${EXTRA}`);
    // Only players with a premium are named: one is singular.
    expect(line([premiumFact("nacua", { rank: 3 }), premiumFact("jefferson", { rank: 2 })])).toBe(`Justin Jefferson is their second-best player, ${EXTRA}`);
    expect(line([premiumFact("jsn", { rank: 1, elite: true }), premiumFact("nacua", { rank: 2 }), premiumFact("jefferson", { rank: 5, elite: true })], ["jsn", "nacua", "jefferson"])).toBe(
      `They'd give up Jaxon Smith-Njigba (their best player and a top-${TOP} player by trade value), Justin Jefferson (a top-${TOP} player by trade value) and Puka Nacua (their second-best player), ${EXTRA}`,
    );
  });

  it("ignores facts it can't use; an e > 0 neither part explains reads as one of their most valuable players", () => {
    const line = (facts: PremiumFact[], get = ["jefferson"]) => premiumLineOf(premiumReasons(facts, { get }));
    expect(line([premiumFact("allen")])).toBeNull(); // a player not in the trade
    expect(line([premiumFact("jefferson", { e: Number.NaN })])).toBeNull();
    expect(line([premiumFact("jefferson", { e: 0 })])).toBeNull();
    expect(line([premiumFact("jefferson", { e: -0.1 })])).toBeNull();
    expect(line([premiumFact("jefferson", { e: Number.POSITIVE_INFINITY })])).toBeNull();
    // Once per player: the first readable fact.
    expect(line([premiumFact("jefferson", { e: Number.NaN }), premiumFact("jefferson", { rank: 2 }), premiumFact("jefferson", { rank: 1, elite: true })])).toBe(`Justin Jefferson is their second-best player, ${EXTRA}`);
    expect(line([premiumFact("jefferson", { rank: Number.NaN, elite: true })])).toBe(`Justin Jefferson is a top-${TOP} player by trade value, ${EXTRA}`);
    expect(line([premiumFact("jefferson", { rank: 3, e: 0.03 })])).toBe(`Justin Jefferson is one of their most valuable players, ${EXTRA}`);
    expect(line([premiumFact("jefferson", { rank: 0, e: 0.1 })])).toBe(`Justin Jefferson is one of their most valuable players, ${EXTRA}`);
    expect(line([premiumFact("zz9")], ["zz9"])).toBe(`Unknown player (zz9) is their best player, ${EXTRA}`);
    // Malformed lists.
    expect(line([null as unknown as PremiumFact, { playerId: 7 } as unknown as PremiumFact, premiumFact("jefferson")])).toBe(`Justin Jefferson is their best player, ${EXTRA}`);
    expect(reasonsOf({ give: ["bijan"], get: ["jefferson"], detail: { premium: "x" as unknown as PremiumFact[] } })).toEqual([BARE, EVEN]);
  });

  it("weighs the line by what the premium moved the estimate, and the value line by the market reading alone (Parker's Smith-Njigba question)", () => {
    // 3 RBs (4,000 + 3,500 + 3,500) for their best, top-12 player (9,000), W 752, a contender, n = 0.6, a hole filled:
    // +4.7% on market values (even), −10.6% in their eyes. The terms are the model's: z gives the planner's 23.4% (51.3% before).
    const jsnTrade = (withPremium: boolean): EvaluationFixture => ({
      give: ["bijan", "kyren", "jacobs"],
      get: ["jsn"],
      gMine: 10504 / 11000 - 1,
      partnerDeltaLineup: 3,
      features: { g: withPremium ? -0.106 : 0.0472, n: 0.6, h: 1, c: 2, a: 0, hist: null, ctx: 0.108, hot: 0, urg: 0, z: withPremium ? -1.186 : 0.051 },
      detail: {
        holesFilled: ["RB2"],
        partnerSlots: [{ key: "RB2", before: 6.2, after: 11.5, rank: 9 }],
        context: contextTerm({ contender: true, ctx: 0.108 }),
        terms: acceptanceTerms({ value: withPremium ? -0.9538 : 0.2833, need: 0.36, hole: 0.4, complexity: -0.5, context: 0.108 }),
        ...(withPremium ? { premium: [premiumFact("jsn", { rank: 1, elite: true })] } : {}),
      },
    });
    const hole = "They're 9th of 10 at RB2, and this gives them a starter.";
    const contender = "They're contending (over 60% to make the playoffs), so lineup help counts extra.";
    // The value line words the model's package (two roster spots charged at W): +4.7%, under valueEven, so about even
    // (FantasyCalc's plain sums, 11,000 for 9,000, aren't read: planner reply to Checkpoint 7a, 5.4).
    const raw = fc({ bijan: 4000, kyren: 3500, jacobs: 3500, jsn: 9000 });
    const value = EVEN;
    // The premium moved the estimate 1.24 (logit units), the hole 0.76, the market reading 0.28: the contender line is left out.
    expect(reasonsOf(jsnTrade(true), raw)).toEqual([BARE, `Jaxon Smith-Njigba is their best player and a top-${TOP} player by trade value, ${EXTRA}`, hole, value]);
    expect(reasonsOf(jsnTrade(false), raw)).toEqual([BARE, hole, value, contender]);
  });

  it("an even trade's value line yields to stronger reasons once the premium takes its weight", () => {
    const detail = {
      premium: [premiumFact("jefferson", { rank: 1, elite: true })],
      activity: activitySummary({ a: 1, rule: "active" as const, trades: 3 }),
      history: { trades: 3, average: 0.1 },
      terms: acceptanceTerms({ value: -1.5, activity: 0.35, history: -0.3 }),
    };
    expect(reasonsOf({ give: ["bijan"], get: ["jefferson"], detail })).toEqual([
      BARE,
      `Justin Jefferson is their best player and a top-${TOP} player by trade value, ${EXTRA}`,
      "Active trader: 3 trades this season.",
      "They tend to win their trades on value this season, so they may want more.",
    ]);
  });

  it("drops 'which makes a yes more likely' from the value line when, counting the premium, they no longer clearly come out ahead (under valueEven in their eyes)", () => {
    const valueOf = (perceived: number, gPartner: number, facts = [premiumFact("nacua", { rank: 2, elite: true })]) =>
      reasonsOf(
        { give: ["jefferson"], get: ["nacua", "kyren"], gPartner, gMine: 1 / (1 + gPartner) - 1, detail: { premium: facts, terms: acceptanceTerms({ value: perceived }) } },
        fcGain(["jefferson"], ["nacua", "kyren"], gPartner),
      ).find((r) => r.startsWith("They come out ahead on trade value"));
    // +6.4% on market values, −5.7% in their eyes (Puka Nacua: their #2 and top-12, e = 0.15).
    expect(valueOf(-0.51, 0.064)).toBe(AHEAD_ONLY);
    expect(valueOf(0, 0.064)).toBe(AHEAD_ONLY);
    // Still a gain in their eyes, but under valueEven (+12% on the market, +3% counting the premium): to them it's about even.
    const even = config.explain.valueEven;
    expect(valueOf(GAIN * 0.03, 0.12)).toBe(AHEAD_ONLY);
    expect(valueOf(GAIN * (even - 0.001), 0.12)).toBe(AHEAD_ONLY);
    // At valueEven or more in their eyes (+30% on the market, +24% with their #2's premium): the clause stays.
    expect(valueOf(GAIN * even, 0.12)).toBe(AHEAD_YES);
    expect(valueOf(1.43, 0.3, [premiumFact("nacua", { rank: 2 })])).toBe(AHEAD_YES);
    // Without a premium the value line is as before, whatever the term.
    expect(valueOf(-0.51, 0.064, [])).toBe(AHEAD_YES);
  });

  it("says they'd still come out ahead, not that they'll want more, when counting the premium they still gain at least valueEven (addendum review)", () => {
    const even = config.explain.valueEven;
    const facts = [premiumFact("nacua", { rank: 2 })];
    // Parker's league: they'd get 44% more on market values and still 39% more counting their #2's premium (Est. 70%):
    // "expect them to want a little extra" would contradict the value line and suggest sweetening an offer they'd like.
    const flowers = premiumReasons(facts, { get: ["nacua"], gPartner: 0.44, gMine: 1 / 1.44 - 1 }, GAIN * 0.386);
    expect(flowers).toEqual([BARE, AHEAD_YES, `Puka Nacua is their second-best player, ${AHEAD}`]);
    expect(flowers.join(" ")).not.toContain("a little extra");
    // Phase 7b (planner reply to Checkpoint 7a, 5.4): FantasyCalc's plain sums aren't read any more (Phase 4c needed them to
    // agree, since the value line quoted them): even on them, or with a player FantasyCalc doesn't value, the model's words.
    const evenOnFc = premiumReasons(facts, { get: ["nacua"], gPartner: 0.44, gMine: 1 / 1.44 - 1 }, GAIN * 0.386, fcGain(["bijan"], ["nacua"], 0.02));
    expect(evenOnFc).toEqual(flowers);
    expect(premiumLineOf(premiumReasons(facts, { get: ["nacua"], gPartner: 0.44, gMine: 1 / 1.44 - 1 }, GAIN * 0.386, fc({ nacua: 4000 })))).toBe(`Puka Nacua is their second-best player, ${AHEAD}`);
    // The cut is valueEven in their eyes (the value line's "even" band): at it they still come out ahead; under it the planner's words.
    const at = (perceivedG: number) => premiumLineOf(premiumReasons(facts, { get: ["nacua"], gPartner: 0.12, gMine: 1 / 1.12 - 1 }, GAIN * perceivedG));
    expect(at(even)).toBe(`Puka Nacua is their second-best player, ${AHEAD}`);
    expect(at(0.1)).toBe(`Puka Nacua is their second-best player, ${AHEAD}`);
    expect(at(even - 0.001)).toBe(`Puka Nacua is their second-best player, ${EXTRA}`);
    expect(at(0)).toBe(`Puka Nacua is their second-best player, ${EXTRA}`);
    expect(at(-0.2)).toBe(`Puka Nacua is their second-best player, ${EXTRA}`);
    // Several players.
    const two = premiumLineOf(premiumReasons([premiumFact("nacua", { rank: 2 }), premiumFact("jefferson", { rank: 1 })], { get: ["nacua", "jefferson"], gPartner: 0.5, gMine: 1 / 1.5 - 1 }, GAIN * 0.3));
    expect(two).toBe(`They'd give up Justin Jefferson (their best player) and Puka Nacua (their second-best player), ${AHEAD_THEM}`);
    // Their perceived gain unreadable: the planner's words.
    expect(premiumLineOf(premiumReasons(facts, { get: ["nacua"], gPartner: 0.44, gMine: 1 / 1.44 - 1 }, Number.NaN))).toBe(`Puka Nacua is their second-best player, ${EXTRA}`);
  });

  it("always has a place among the partnerReasons lines (lead decision N7): left out by weight, it takes the place of the lowest-weight line other than the value line", () => {
    // They get 60% more on market values either way: the clamp (±0.5) leaves the premium nothing to move (weight 0), and it's still said.
    const clampedFixture: EvaluationFixture = { give: ["bijan"], get: ["nacua"], gMine: 1 / 1.6 - 1, detail: { premium: [premiumFact("nacua", { rank: 2 })], terms: acceptanceTerms({ value: 3 }) } };
    const fc60 = fcGain(["bijan"], ["nacua"], 0.6);
    expect(reasonsOf(clampedFixture, fc60)).toEqual([BARE, AHEAD_YES, `Puka Nacua is their second-best player, ${AHEAD}`]);
    // Three lines moved the estimate more than it (their #2 at even value: 0.43): it takes the history line's place (0.45).
    const crowded = reasonsOf({
      give: ["bijan"],
      get: ["nacua"],
      detail: {
        premium: [premiumFact("nacua", { rank: 2 })],
        context: contextTerm({ checkedOut: true, ctx: -0.8 }),
        activity: activitySummary({ a: -2, rule: "inactive", transactions: 4 }),
        history: { trades: 2, average: 0.15 },
        terms: acceptanceTerms({ value: config.acceptance.beta.loss * (1 / 1.05 - 1), context: -0.8, activity: -0.7, history: -0.45 }),
      },
    });
    expect(crowded).toEqual([
      BARE,
      "They're all but out of the playoff race (under 5% to make it), so they may have checked out.",
      `Quiet lately: no moves in ${config.acceptance.activity.inactiveWeeks} weeks.`,
      `Puka Nacua is their second-best player, ${EXTRA}`,
    ]);
    // Parker's league with week 4 under way (addendum review, Team 10's cards): they get 37% more on market values (33%
    // counting their #2's premium); the value line (2.22), their lineup loss (0.47) and activity (0.35) moved the
    // estimate more than the premium (0.26), which takes the activity line's place, never the value line's.
    const team10 = reasonsOf({
      give: ["wilson", "nix"],
      get: ["nacua", "kyren"],
      gMine: 1 / 1.37 - 1,
      partnerDeltaLineup: -3.9,
      detail: {
        premium: [premiumFact("kyren", { rank: 2 })],
        activity: activitySummary({ a: 1, rule: "active", trades: 1, recentTrades: 1 }),
        history: { trades: 2, average: 0.09 },
        terms: acceptanceTerms({ value: GAIN * 0.327, need: -0.47, activity: 0.35, history: -0.27 }),
      },
    }, fcGain(["wilson", "nix"], ["nacua", "kyren"], 0.37));
    expect(team10).toEqual([
      BARE,
      AHEAD_YES,
      "It costs their starting lineup 3.9 projected points per week, a harder sell.",
      `Kyren Williams is their second-best player, ${AHEAD}`,
    ]);
    // The Analyzer's Garrett Wilson for Jaxon Smith-Njigba: they'd give up 2.1 times what they get, past the clamp either
    // way (the premium's weight 0), and three lines outweigh it: it takes the contender line's place.
    const analyzer = reasonsOf({
      give: ["wilson"],
      get: ["jsn"],
      gMine: 1.1,
      dPPW: 3.9,
      partnerDeltaLineup: -4.5,
      features: { g: -0.5, n: -0.9, h: 0, c: 0, a: 0, hist: null, ctx: -0.16, hot: 0, urg: 0, z: -5.8 },
      detail: {
        premium: [premiumFact("jsn", { rank: 1, elite: true })],
        context: contextTerm({ contender: true, ctx: -0.16 }),
        terms: acceptanceTerms({ value: -4.5, need: -0.54, context: -0.16 }),
      },
    }, fcGain(["wilson"], ["jsn"], 1 / 2.1 - 1));
    expect(analyzer).toEqual([
      "Your starting lineup gains 3.9 projected points per week.",
      BEHIND,
      "It costs their starting lineup 4.5 projected points per week, a harder sell.",
      `Jaxon Smith-Njigba is their best player and a top-${TOP} player by trade value, ${EXTRA}`,
    ]);
    // With one partner line, the value line's place when it's the only one kept; none at all with none.
    expect(reasonsOf(clampedFixture, fc60, { ...config.explain, partnerReasons: 1 })).toEqual([BARE, `Puka Nacua is their second-best player, ${AHEAD}`]);
    expect(reasonsOf({ ...clampedFixture, detail: { ...clampedFixture.detail, terms: acceptanceTerms({ value: 3, activity: 0.35 }), activity: activitySummary({ a: 1, rule: "active", trades: 2 }) } }, fc60, { ...config.explain, partnerReasons: 2 })).toEqual([
      BARE,
      AHEAD_YES,
      `Puka Nacua is their second-best player, ${AHEAD}`,
    ]);
    expect(reasonsOf(clampedFixture, fc60, { ...config.explain, partnerReasons: 0 })).toEqual([BARE]);
    // Without a premium, the partnerReasons lines are the heaviest, as before.
    expect(premiumLineOf(reasonsOf({ ...clampedFixture, detail: { ...clampedFixture.detail, premium: [] } }, fc60))).toBeNull();
  });

  it("takes the player's name from the context, and stays out of the pitch", () => {
    const ctx: Partial<ExplainContext> = { player: (id) => (id === "a" ? { name: "Player A", pos: "WR", nflTeam: null } : id === "b" ? { name: "Player B", pos: "RB", nflTeam: null } : null), ...fc({ a: 5000, b: 5000 }) };
    const { reasons, pitch } = explain({ give: ["b"], get: ["a"], partnerDeltaLineup: 2, detail: { premium: [premiumFact("a", { rank: 1, elite: true })], terms: acceptanceTerms({ value: -1.5 }) } }, ctx);
    expect(reasons).toContain(`Player A is their best player and a top-${TOP} player by trade value, ${EXTRA}`);
    expect(reasons.join(" ")).not.toMatch(/Jefferson|Kelce|Bijan|Team \d/);
    expect(pitch).toBe("Hey! This adds about 2 projected points a week to your starting lineup. Would you trade Player A for Player B? Let me know what you think!");
    expect(pitch).not.toMatch(/best player|top-\d|a little extra/i);
    // Plain words: no symbols, no mention of the premium or of the "Protect my trade value" setting.
    expect([...reasons, pitch].join(" ")).not.toMatch(/premium|protect|setting|κ|kappa|\be\b|NaN|undefined/i);
    // The same when they'd still come out ahead.
    const ahead = explain({ give: ["b"], get: ["a"], gMine: 1 / 1.4 - 1, partnerDeltaLineup: 2, detail: { premium: [premiumFact("a", { rank: 1 })], terms: acceptanceTerms({ value: GAIN * 0.3 }) } }, { ...ctx, ...fc({ a: 5000, b: 7000 }) });
    expect(ahead.reasons).toContain(`Player A is their best player, ${AHEAD}`);
    expect(ahead.pitch).not.toMatch(/best player|come out ahead|rate (him|them)|a little extra/i);
    expect([...ahead.reasons, ahead.pitch].join(" ")).not.toMatch(/premium|protect|setting|κ|kappa|\be\b|NaN|undefined/i);
  });
});

describe("the pitch with steps (planner addendum to Checkpoint 3, §4; lead decision N7)", () => {
  const words = (e: TradeEvaluation, ctxOver: Partial<ExplainContext> = {}) => explainTrade(e, explainContext(ctxOver));
  /** The ranked trade: Travis Kelce and Bo Nix for Bijan Robinson, with Bo Nix filling their QB hole. */
  const kelceAndNix = (over: EvaluationFixture = {}) =>
    tradeEvaluation({ give: ["kelce", "nix"], get: ["bijan"], ...over, detail: { holesFilled: ["QB1"], partnerSlots: [{ key: "QB1", before: 9, after: 17, rank: 9 }], terms: acceptanceTerms({ hole: 0.4 }), ...over.detail } });
  const teHole = { holesFilled: ["TE1"], partnerSlots: [{ key: "TE1", before: 4, after: 11, rank: 8 }] };

  it("names the offer-first version, with its own facts, when the ranked trade is the full one; never the throw-in", () => {
    const ranked = kelceAndNix();
    expect(words(ranked).pitch).toBe("Hey! Looks like you could use help at QB, and Bo Nix would start for you there. Would you trade Bijan Robinson for Travis Kelce and Bo Nix? Let me know what you think!");
    const e = withSteps(ranked, "nix", { offerFirst: { detail: teHole } });
    expect(e.steps.ranked).toBe("full");
    const { pitch, reasons } = words(e);
    expect(pitch).toBe("Hey! Looks like you could use help at TE, and Travis Kelce would start for you there. Would you trade Bijan Robinson for Travis Kelce? Let me know what you think!");
    expect(pitch).not.toMatch(/Bo Nix|QB|say no|throw/i);
    // The reasons stay the ranked trade's: they explain the card's numbers.
    expect(reasons).toEqual(words(ranked).reasons);
    expect(reasons).toContain("They're 9th of 10 at QB, and this gives them a starter.");
  });

  it("keeps the ranked trade's words when the offer first is the ranked trade (the throw-in is held back)", () => {
    const ranked = tradeEvaluation({ give: ["kelce"], get: ["bijan"], detail: teHole });
    const e = withSteps(ranked, "nix", { full: { detail: { holesFilled: ["QB1"], partnerSlots: [{ key: "QB1", before: 9, after: 17, rank: 9 }] } } });
    expect(e.steps.ranked).toBe("offerFirst");
    expect(words(e)).toEqual(words(ranked));
    expect(words(e).pitch).not.toContain("Bo Nix");
    // The same assets in another order are the same trade.
    const reordered = { ...e, steps: { ...e.steps, offerFirst: { ...e.steps.offerFirst, proposal: { ...ranked.proposal, give: [...ranked.proposal.give].reverse() } } } };
    expect(words(reordered).pitch).toBe(words(ranked).pitch);
  });

  it("reads the offer-first version's lineup change back from its need term (and, since the planner's reply to Checkpoint 7a, 5.4, never its trade value)", () => {
    // Ranked: Puka Nacua and Bo Nix for Kyren Williams; by FantasyCalc's values they'd get 30% more trade value. Offer first:
    // Nacua alone, 10% more. Neither is said.
    const values = fc({ nacua: 5500, nix: 1000, kyren: 5000 });
    const ranked = tradeEvaluation({ give: ["nacua", "nix"], get: ["kyren"], gMine: 1 / 1.3 - 1, partnerDeltaLineup: 4, detail: { terms: acceptanceTerms({ need: 0.48 }) } });
    expect(words(ranked, values).pitch).toBe("Hey! This adds about 4 projected points a week to your starting lineup. Would you trade Kyren Williams for Puka Nacua and Bo Nix? Let me know what you think!");
    const need = (delta: number) => config.acceptance.beta.need * (delta / config.acceptance.nScale);
    const lean = (detail: EvaluationFixture["detail"], ctx: Partial<ExplainContext> = values) => words(withSteps(ranked, "nix", { offerFirst: { gMine: 1 / 1.1 - 1, detail } }), ctx).pitch;
    const ask = "Would you trade Kyren Williams for Puka Nacua? Let me know what you think!";
    expect(lean({ terms: acceptanceTerms({ need: need(1.3) }) })).toBe(`Hey! This adds about 1.3 projected points a week to your starting lineup. ${ask}`);
    expect(lean({ terms: acceptanceTerms({ need: need(2.2) }), partnerSlots: [{ key: "WR2", before: 7, after: 12.4, rank: 7 }] })).toBe(
      `Hey! Puka Nacua would upgrade your WR2 spot from 7 to 12.4 projected points a week. ${ask}`,
    );
    // A change under lineupChangeMin, or one it can't read back, says nothing (even value: nothing about value either).
    const even = fc({ nacua: 5000, nix: 1000, kyren: 5000 });
    expect(lean({ terms: acceptanceTerms({ need: need(0.3) }) }, even)).toBe(`Hey! ${ask}`);
    expect(lean({ terms: acceptanceTerms({ need: Number.NaN }) }, even)).toBe(`Hey! ${ask}`);
    // ⚠️ At the n clamp (±2) the clamp's value (the file header).
    expect(lean({ terms: acceptanceTerms({ need: config.acceptance.beta.need * config.acceptance.nClamp[1] }) }, even)).toContain("This adds about 10 projected points a week");
  });

  it("reads the lineup change back with the league type's β_need: a dynasty league's 0.6, not redraft's 1.2 (planner reply to Checkpoint 4, change 2)", () => {
    expect(betaNeed("dynasty")).toBe(config.acceptance.beta.needDynasty);
    expect(betaNeed("dynasty")).not.toBe(betaNeed("redraft"));
    const ranked = tradeEvaluation({ give: ["nacua", "nix"], get: ["kyren"], partnerDeltaLineup: 4, detail: { terms: acceptanceTerms({ need: 0.48 }) } });
    // The offer-first version's need term as acceptance.ts writes it in each league type: β_need × ΔLineup_P / nScale.
    const lean = (leagueType: "redraft" | "keeper" | "dynasty") => {
      const need = betaNeed(leagueType) * (1.3 / config.acceptance.nScale);
      return words(withSteps(ranked, "nix", { offerFirst: { gMine: 0, detail: { terms: acceptanceTerms({ need }) } } }), { leagueType }).pitch;
    };
    // +1.3 a week in every league type (before the fix, a dynasty pitch read half of it: "0.7").
    for (const leagueType of ["redraft", "keeper", "dynasty"] as const) expect(lean(leagueType), leagueType).toContain("This adds about 1.3 projected points a week to your starting lineup.");
    expect(deltaLineupFromTerms({ need: 0.6 * (2 / config.acceptance.nScale) }, "dynasty")).toBeCloseTo(2, 12);
    expect(deltaLineupFromTerms({ need: 1.2 * (2 / config.acceptance.nScale) }, "redraft")).toBeCloseTo(2, 12);
    expect(deltaLineupFromTerms({ need: Number.NaN }, "dynasty")).toBeNaN();
    expect(deltaLineupFromTerms(undefined, "redraft")).toBeNaN();
  });

  it("ignores steps that don't fit the trade, and copes with a step missing its facts", () => {
    const ranked = kelceAndNix();
    const base = words(ranked).pitch;
    const { steps } = withSteps(ranked, "nix");
    const variant = (offerFirst: Partial<TradeStep>) => words({ ...ranked, steps: { ...steps, offerFirst: { ...steps.offerFirst, ...offerFirst } } }).pitch;
    expect(variant({ proposal: { ...steps.offerFirst.proposal, partnerId: "9" } })).toBe(base); // another partner
    expect(variant({ proposal: { partnerId: ranked.proposal.partnerId, give: [], get: [] } })).toBe(base); // no assets
    expect(variant({ proposal: { partnerId: ranked.proposal.partnerId, give: [null as unknown as TradeAsset], get: ranked.proposal.get } })).toBe(base); // an unreadable asset
    expect(variant({ proposal: { partnerId: ranked.proposal.partnerId, give: [{ kind: "pick" } as unknown as TradeAsset], get: ranked.proposal.get } })).toBe(base);
    // A readable pick is named from the partner's side.
    expect(variant({ proposal: { partnerId: ranked.proposal.partnerId, give: [{ kind: "pick", season: 2027, round: 2, originalTeamId: "3" }], get: ranked.proposal.get }, detail: undefined as unknown as TradeDetail })).toBe(
      "Hey! Would you trade Bijan Robinson for my 2027 2nd-round pick? Let me know what you think!",
    );
    expect(variant({ proposal: undefined as unknown as TradeProposal })).toBe(base);
    // Without its detail (and g) it still names the offer-first version, with nothing to lead with.
    expect(variant({ detail: undefined as unknown as TradeDetail, gPartner: Number.NaN })).toBe("Hey! Would you trade Bijan Robinson for Travis Kelce? Let me know what you think!");
    expect(words({ ...ranked, steps: undefined as unknown as TradeSteps }).pitch).toBe(base);
    expect(words({ ...ranked, steps: {} as TradeSteps }).pitch).toBe(base);
    // An illegal trade has no pitch, steps or not.
    expect(words({ ...ranked, steps, illegal: "Team 7 can have at most 4 QBs." })).toEqual({ reasons: ["Team 7 can have at most 4 QBs."], pitch: "" });
  });

  it("takes every name from the context", () => {
    const people: Record<string, { name: string; pos: Pos; nflTeam: string | null }> = {
      a: { name: "Player A", pos: "TE", nflTeam: null },
      b: { name: "Player B", pos: "QB", nflTeam: null },
      c: { name: "Player C", pos: "RB", nflTeam: null },
    };
    const e = withSteps(tradeEvaluation({ give: ["a", "b"], get: ["c"] }), "b", { offerFirst: { detail: teHole } });
    expect(words(e, { player: (id) => people[id] ?? null }).pitch).toBe("Hey! Looks like you could use help at TE, and Player A would start for you there. Would you trade Player C for Player A? Let me know what you think!");
  });
});

describe("names, missing data and plain words", () => {
  it("takes every name from the context: placeholders work, and unknown players read as such", () => {
    const ctx: Partial<ExplainContext> = {
      player: (id) => (id === "a" ? { name: "Player A", pos: "TE", nflTeam: null } : id === "b" ? { name: "Player B", pos: "RB", nflTeam: "XXX" } : null),
      teamName: (id) => `Placeholder ${id}`,
    };
    const { pitch, reasons } = explain(
      {
        give: ["a"],
        get: ["b", "zz9"],
        flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: ["b"] },
        detail: { holesFilled: ["TE1"], hotReceived: ["a"], terms: acceptanceTerms({ hot: 0.15, hole: 0.4 }) },
      },
      ctx,
    );
    expect(pitch).toBe("Hey! Looks like you could use help at TE over the next 3 weeks, and Player A would start for you there. Would you trade Player B and Unknown player (zz9) for Player A? Let me know what you think!");
    expect(reasons.join(" ")).toContain("They'd get Player A, who has scored");
    expect(reasons.join(" ")).toContain("Depends on an injured player: Player B is injured");
    expect(reasons.join(" ")).not.toMatch(/Travis|Kelce|Bijan/);
  });

  it("works with missing numbers and an empty detail (null B and odds, NaN, no slots, no context slots)", () => {
    const e = tradeEvaluation({
      b: null,
      dPO: null,
      dCH: null,
      dEW: null,
      dPPW: Number.NaN,
      dPPWPlayoffs: Number.NaN,
      gMine: Number.NaN,
      gPartner: Number.NaN,
      partnerDeltaLineup: Number.NaN,
      stage: "screened",
      sims: 0,
      detail: { teams: Number.NaN, terms: acceptanceTerms({ value: Number.NaN, need: Number.NaN }), activity: activitySummary({ rule: "active", trades: Number.NaN, recentTrades: Number.NaN }) },
    });
    const out = explainTrade(e, explainContext({ slots: [] }));
    expect(out.reasons[0]).toBe("Barely changes your starting lineup.");
    expect(out.pitch).toBe("Hey! Would you trade Travis Kelce for Bo Nix? Let me know what you think!");
    expect([...out.reasons, out.pitch].join(" ")).not.toMatch(/NaN|undefined|null|Infinity/);
  });

  it("an illegal trade's reasons are its reason alone, with no pitch", () => {
    expect(explain({ illegal: "Team 7 can have at most 4 QBs." })).toEqual({ reasons: ["Team 7 can have at most 4 QBs."], pitch: "" });
  });

  it("uses plain words and the League page's numbers: no jargon, a real minus sign, no trailing zeros", () => {
    const fixtures: EvaluationFixture[] = [
      {
        dPPW: 3.04,
        dPO: 0.061,
        dCH: -0.012,
        gMine: 0.3,
        partnerDeltaLineup: -0.9,
        flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: ["jacobs"] },
        detail: {
          mySlots: [{ key: "WR1", before: 14.96, after: 18.04 }, { key: "TE1", before: 10, after: 7.5 }],
          vetoRisk: true,
          riskyWeeks: [13],
          weekly: [{ week: 13, before: 100, after: 96.5 }],
          urgency: 0.2,
          terms: acceptanceTerms({ value: -3, need: -0.11, urgency: 0.2 }),
          activity: activitySummary({ a: -2, rule: "inactive" }),
        },
      },
      { b: -1, dPPW: -2, gMine: -0.5 },
    ];
    for (const f of fixtures) {
      const { reasons, pitch } = explain(f);
      const text = [...reasons, pitch].join(" ");
      expect(text).not.toMatch(/\bEV\b|V\*|σ|g_mkt|Δ|\bCRN\b|logit|lambda|λ|NaN|undefined|Infinity/);
      expect(text).not.toMatch(/\d\.\d0\b/); // no trailing decimal zero
      expect(text).not.toMatch(/(^|\s)-\d/); // a real minus sign, never a hyphen
    }
    const first = explain(fixtures[0] as EvaluationFixture).reasons;
    expect(first[0]).toBe("Your WR1 spot goes from 15 to 18 projected points per week.");
    expect(first).toContain("Weakens your risky week 13: −3.5 projected points that week.");
  });

  it("is deterministic", () => {
    const f: EvaluationFixture = { dPPW: 2, gMine: 0.05, detail: { holesFilled: ["TE1"], activity: activitySummary({ rule: "active", a: 1, trades: 2 }), terms: acceptanceTerms({ activity: 0.35, hole: 0.4 }) } };
    expect(explain(f)).toEqual(explain(f));
  });
});

describe("injuryTags (TradeEvaluation.flags.tagged; planner reply to Checkpoint 4, change 6)", () => {
  /** Fixture players with made-up statuses (FIXTURE_PLAYERS' own: McCaffrey IR, Jacobs OUT), and return weeks. */
  const players: Record<string, Pick<PlayerInfo, "injury" | "injuryReturnWeek">> = {
    nix: { injury: "QUESTIONABLE" },
    kelce: { injury: "ACTIVE" },
    cmc: { injury: "IR", injuryReturnWeek: 9 },
    jacobs: { injury: "OUT" },
    nacua: { injury: "SUSPENDED", injuryReturnWeek: 7 },
    jsn: { injury: "NA" },
    kyren: { injury: "PUP", injuryReturnWeek: 19 },
    bijan: { injury: "PROBABLE", injuryReturnWeek: 8.5 },
  };
  const player = (id: string): TradeAsset => ({ kind: "player", id });

  it("tags every player on either side whose status isn't ACTIVE, mine first, each side in the trade's order, with his return week when whole", () => {
    const proposal = { give: [player("nix"), player("kelce"), player("nacua")], get: [player("cmc"), player("jacobs"), player("kyren"), player("bijan"), player("jsn")] };
    expect(injuryTags(proposal, players)).toEqual([
      { playerId: "nix", side: "give", status: "QUESTIONABLE" },
      { playerId: "nacua", side: "give", status: "SUSPENDED", returnWeek: 7 },
      { playerId: "cmc", side: "get", status: "IR", returnWeek: 9 },
      { playerId: "jacobs", side: "get", status: "OUT" },
      // ESPN's out-for-season marker stays a week (the card words it).
      { playerId: "kyren", side: "get", status: "PUP", returnWeek: 19 },
      // A return week that isn't a whole number is left out.
      { playerId: "bijan", side: "get", status: "PROBABLE" },
      { playerId: "jsn", side: "get", status: "NA" },
    ]);
  });

  it("leaves out picks, unknown players, healthy ones, statuses it doesn't know, and a player listed twice", () => {
    const pick: TradeAsset = { kind: "pick", season: 2027, round: 1, originalTeamId: "3" };
    const odd = { ...players, weird: { injury: "SORE" as never } };
    expect(injuryTags({ give: [pick, player("ghost"), player("kelce"), player("weird")], get: [player("nix"), player("nix")] }, odd)).toEqual([{ playerId: "nix", side: "get", status: "QUESTIONABLE" }]);
    expect(injuryTags({ give: [], get: [] }, players)).toEqual([]);
  });

  it("keeps a return week only where the projection counts on it, by §6 step 3's rules (review of track F)", () => {
    const one = (injury: PlayerInfo["injury"], week: number, ctx: Parameters<typeof injuryTags>[2] = { currentWeek: 6 }) => injuryTags({ give: [], get: [player("x")] }, { x: { injury, injuryReturnWeek: week } }, ctx)[0]?.returnWeek;
    // OUT: from next week on; a date this week or earlier gets the OUT table, so it isn't said ("expected back week 3" in week 6).
    expect([3, 6, 7, 19].map((w) => one("OUT", w))).toEqual([undefined, undefined, 7, 19]);
    // IR, PUP and SUSPENDED miss this week: a date after it.
    for (const s of ["IR", "PUP", "SUSPENDED"] as const) expect([5, 6, 7].map((w) => one(s, w))).toEqual([undefined, undefined, 7]);
    // NA never plays: no week.
    expect(one("NA", 9)).toBeUndefined();
    // Probable, Questionable and Doubtful: only a far date (2+ weeks out) his projection follows (Josh Jacobs's case).
    const follows = { currentWeek: 6, followsReturnDate: (id: string) => id === "x" };
    for (const s of ["PROBABLE", "QUESTIONABLE", "DOUBTFUL"] as const) {
      expect(one(s, 9, follows)).toBe(9);
      expect(one(s, 9)).toBeUndefined(); // stale (Sleeper projects him) or unknown: not said
      expect(one(s, 7, follows)).toBeUndefined(); // next week isn't a conflict: §6 ignores the date
      expect(one(s, 19, follows)).toBe(19); // out for the season, by ESPN's date
    }
    expect(one("QUESTIONABLE", 9, { currentWeek: 6, followsReturnDate: () => false })).toBeUndefined();
    // "Far" is availability's own rule (config.projections.returnConflictWeeks), so the tag and the projection agree.
    for (let w = 6; w <= 10; w++) expect(one("QUESTIONABLE", w, follows) === w, `week ${w}`).toBe(farReturnWeek(w, 6));
    // Without the week now, a followed far date and any OUT, IR, PUP or SUSPENDED date stay.
    expect(one("QUESTIONABLE", 9, { followsReturnDate: () => true })).toBe(9);
    expect(one("OUT", 3, {})).toBe(3);
  });
});
