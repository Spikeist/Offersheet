/**
 * The Trade Finder's pattern note (src/engine/pattern.ts; planner reply to Checkpoint 4b, change 6): when at least
 * patternMinCount of the uncapped top patternTop give one player of mine, a line says so, with the drivers that hold in at
 * least half of those trades (never one that doesn't), in the order byeCover, incomingByes, slotGain, injuryCover, at most
 * 3. Synthetic trades (tradeTestFixtures: public NFL names, made-up numbers; teams are placeholders).
 */
import { describe, expect, it } from "vitest";
import { config } from "./config";
import { patternConfig, patternNote, type PatternInputs } from "./pattern";
import { FIXTURE_PLAYERS, tradeEvaluation, type EvaluationFixture } from "./tradeTestFixtures";
import type { SlotChange, TradeDetail, TradeEvaluation } from "./tradeModel";

/** NFL bye weeks of the fixture players (made up): Wilson's in week 13, my riskiest week below. */
const BYES: Record<string, number> = { wilson: 13, nix: 12, kyren: 8, jsn: 8, jefferson: 6, kelce: 10, laporta: 5, nacua: 3, bijan: 9, allen: 7, steelers: 13 };

/** My weekly win chances before any trade, weeks 5–14 (week 13 the lowest, 42%); weeks 6, 8, 9 and 10 favored. */
const BEFORE: Record<number, number> = { 5: 0.45, 6: 0.6, 7: 0.48, 8: 0.66, 9: 0.55, 10: 0.58, 11: 0.47, 12: 0.49, 13: 0.42, 14: 0.5 };

/** winChance with the before numbers above and `gain` added after the trade in the weeks it names. */
function winChance(gain: Record<number, number> = {}): NonNullable<TradeDetail["winChance"]> {
  return Object.entries(BEFORE).map(([w, before]) => ({ week: Number(w), before, after: before + (gain[Number(w)] ?? 0) }));
}

/** My slot instances, all even, but `gains` (key → points a week). */
function slots(gains: Record<string, number> = {}): SlotChange[] {
  return ["QB", "RB1", "RB2", "WR1", "WR2", "TE", "FLEX"].map((key) => ({ key, before: 10, after: 10 + (gains[key] ?? 0) }));
}

/** A trade for the list: gives `give`, gets `get`, with the facts the drivers read. */
function trade(give: string[], get: string[], d: Partial<TradeDetail> = {}, o: EvaluationFixture = {}): TradeEvaluation {
  return tradeEvaluation({ give, get, detail: { winChance: winChance(), mySlots: slots(), ...d }, ...o });
}

/** Wilson for two players whose byes (week 8: Kyren Williams and Jaxon Smith-Njigba) fall in weeks I'm favored, covering his week-13 bye. */
const wilsonDeal = (d: Partial<TradeDetail> = {}) => trade(["wilson"], ["kyren", "jsn"], { winChance: winChance({ 13: 0.11, 8: -0.04 }), ...d });

const inputs = (ranked: readonly TradeEvaluation[], over: Partial<PatternInputs> = {}): PatternInputs => ({
  ranked,
  player: (id) => {
    const p = FIXTURE_PLAYERS[id];
    return p ? { name: p.name, pos: p.pos } : null;
  },
  byeWeek: (id) => BYES[id] ?? null,
  firstWeek: 5,
  slotLabel: (key) => key,
  ...over,
});

/** `n` trades that give other players of mine (no common player), to fill a list. */
const others = (n: number) => Array.from({ length: n }, (_, i) => trade([`other${i}`], [`theirs${i}`]));

describe("config (§15)", () => {
  it("reads config.explain: 5 of the top 10, drivers in half of his trades, at most 3, the weekly line's 3 points, a 1-point slot change, 0.5 points of depth", () => {
    expect(patternConfig()).toEqual({ patternMinCount: 5, patternTop: 10, driverShare: 0.5, driversMax: 3, weeklyLineMin: 0.03, slotChangeMin: config.explain.slotChangeMin, depthCoverMin: 0.5 });
  });
});

describe("when the note shows", () => {
  it("at least patternMinCount of the first patternTop give the same player: his id, the count, the list's size", () => {
    const list = [wilsonDeal(), ...others(2), wilsonDeal({}), wilsonDeal(), ...others(1), wilsonDeal(), wilsonDeal(), ...others(4)].map((t, i) => ({ ...t, key: `k${i}` }));
    const note = patternNote(inputs(list));
    expect(note).toMatchObject({ playerId: "wilson", count: 5, of: 10 });
    // Only the first patternTop count: a 6th Wilson trade 11th changes nothing.
    expect(patternNote(inputs([...list, wilsonDeal()]))?.count).toBe(5);
  });

  it("⚠️ says how many of his trades the list itself shows, when that's fewer (final review of Phase 4c, finding R7)", () => {
    const list = [wilsonDeal(), wilsonDeal(), wilsonDeal(), wilsonDeal(), wilsonDeal(), wilsonDeal(), ...others(4)].map((t, i) => ({ ...t, key: `k${i}` }));
    const base = patternNote(inputs(list))?.text as string;
    expect(base).toMatch(/^Most of your best ideas trade Garrett Wilson: /);
    // The list (the given-player cap applied) shows 3 of them.
    const shown = [list[0], list[1], list[2], ...others(3)] as TradeEvaluation[];
    expect(patternNote(inputs(list, { shown }))?.text).toBe(`${base} The list shows 3 ideas that trade him, to make room for other ideas.`);
    expect(patternNote(inputs(list, { shown: [list[0] as TradeEvaluation, ...others(3)] }))?.text).toBe(`${base} The list shows 1 idea that trades him, to make room for other ideas.`);
    expect(patternNote(inputs(list, { shown: others(3) }))?.text).toBe(`${base} The list shows none of them, to make room for other ideas.`);
    // As many as the count (or more), or no list given: nothing more.
    expect(patternNote(inputs(list, { shown: list }))?.text).toBe(base);
    expect(patternNote(inputs(list))?.text).toBe(base);
    // A D/ST is "it".
    const dst = [...Array.from({ length: 6 }, () => trade(["steelers"], ["kelce"])), ...others(4)].map((t, i) => ({ ...t, key: `d${i}` }));
    expect(patternNote(inputs(dst, { shown: [dst[0] as TradeEvaluation] }))?.text).toMatch(/ The list shows 1 idea that trades it, to make room for other ideas\.$/);
  });

  it("fewer than patternMinCount: no note (a 2-for-1 counts for both of my players)", () => {
    const four = [...Array.from({ length: 4 }, () => wilsonDeal()), ...others(6)];
    expect(patternNote(inputs(four))).toBeNull();
    const withPair = [...Array.from({ length: 4 }, () => wilsonDeal()), trade(["nix", "wilson"], ["kelce"]), ...others(5)];
    expect(patternNote(inputs(withPair))?.playerId).toBe("wilson");
    expect(patternNote(inputs([]))).toBeNull();
  });

  it("two players at the same count: the one in the better-ranked trade, then the smaller id", () => {
    const list = [trade(["nix"], ["kelce"]), trade(["wilson"], ["jsn"]), ...Array.from({ length: 4 }, () => trade(["nix", "wilson"], ["laporta"])), ...others(4)];
    expect(patternNote(inputs(list))).toMatchObject({ playerId: "nix", count: 5 });
    const tied = [...Array.from({ length: 5 }, () => trade(["wilson", "nix"], ["laporta"])), ...others(5)];
    expect(patternNote(inputs(tied))?.playerId).toBe("nix");
  });

  it("⚠️ never names a must-include player of mine (every trade gives him): the most-given of my others, if enough", () => {
    // Every trade gives Wilson (must-include); six also give Nix, two Kyren Williams (review of track SR, finding 1).
    const list = [...Array.from({ length: 6 }, () => trade(["wilson", "nix"], ["kelce"])), ...Array.from({ length: 2 }, () => trade(["wilson", "kyren"], ["kelce"])), ...Array.from({ length: 2 }, () => trade(["wilson"], ["kelce"]))];
    expect(patternNote(inputs(list))?.playerId).toBe("wilson");
    const note = patternNote(inputs(list, { forced: ["wilson"] }));
    expect(note).toMatchObject({ playerId: "nix", count: 6, of: 10 });
    expect(note?.text).toMatch(/^Most of your best ideas trade Bo Nix/);
    // Under patternMinCount among the others: no note at all.
    const few = [...Array.from({ length: 4 }, () => trade(["wilson", "nix"], ["kelce"])), ...Array.from({ length: 6 }, () => trade(["wilson"], ["kelce"]))];
    expect(patternNote(inputs(few, { forced: ["wilson"] }))).toBeNull();
    // An empty list of forced players changes nothing.
    expect(patternNote(inputs(list, { forced: [] }))).toEqual(patternNote(inputs(list)));
  });

  it("says Half for exactly half of the list, Most above it, and the counts below half (so the words stay true)", () => {
    const half = [...Array.from({ length: 5 }, () => trade(["wilson"], ["laporta"])), ...others(5)];
    expect(patternNote(inputs(half))?.text).toBe("Half of your best ideas trade Garrett Wilson.");
    const most = [...Array.from({ length: 6 }, () => trade(["wilson"], ["laporta"])), ...others(4)];
    expect(patternNote(inputs(most))?.text).toBe("Most of your best ideas trade Garrett Wilson.");
    const wide = [...Array.from({ length: 5 }, () => trade(["wilson"], ["laporta"])), ...others(7)];
    expect(patternNote(inputs(wide), { ...patternConfig(), patternTop: 12 })?.text).toBe("5 of your 12 best ideas trade Garrett Wilson.");
  });
});

describe("the drivers: each read off the trades' own numbers, named when it holds in at least half of his trades", () => {
  const list = (ts: readonly TradeEvaluation[]) => [...ts, ...others(10 - ts.length)];

  it("the planner's example: his bye in my riskiest week, covered, and the players I'd get have byes in weeks I'm favored", () => {
    const note = patternNote(inputs(list(Array.from({ length: 7 }, () => wilsonDeal()))));
    expect(note?.drivers).toEqual(["byeCover", "incomingByes"]);
    expect(note?.text).toBe("Most of your best ideas trade Garrett Wilson: his bye is in week 13, your riskiest week, and the players you'd get have byes in weeks you're favored to win.");
  });

  it("byeCover: the trade must raise my win chance in his bye week by at least weeklyLineMin; riskiest only when it is (tied: one of)", () => {
    const small = (gain: number) => trade(["wilson"], ["laporta"], { winChance: winChance({ 13: gain }) });
    // laporta's bye (week 5) is in a week I'm not favored: incomingByes doesn't hold.
    expect(patternNote(inputs(list(Array.from({ length: 6 }, () => small(0.029)))))?.drivers).toEqual([]);
    expect(patternNote(inputs(list(Array.from({ length: 6 }, () => small(0.03)))))?.drivers).toEqual(["byeCover"]);
    // Week 13 tied with week 11 as my riskiest.
    const tied = winChance({ 13: 0.1 }).map((c) => (c.week === 11 ? { ...c, before: 0.42, after: 0.42 } : c));
    expect(patternNote(inputs(list(Array.from({ length: 6 }, () => trade(["wilson"], ["laporta"], { winChance: tied })))))?.text).toBe(
      "Most of your best ideas trade Garrett Wilson: his bye is in week 13, one of your riskiest weeks.",
    );
    // Not the riskiest: Nix's bye in week 12 (49%) when week 13 is lower.
    const nix = trade(["nix"], ["laporta"], { winChance: winChance({ 12: 0.05 }) });
    expect(patternNote(inputs(list(Array.from({ length: 6 }, () => nix))))?.text).toBe("Most of your best ideas trade Bo Nix: his bye is in week 12.");
  });

  it("byeCover never holds for a bye already passed, an unknown bye, or without win chances (no odds)", () => {
    const passed = trade(["wilson"], ["laporta"], { winChance: winChance({ 13: 0.1 }) });
    expect(patternNote(inputs(list(Array.from({ length: 6 }, () => passed)), { firstWeek: 14 }))?.drivers).not.toContain("byeCover");
    expect(patternNote(inputs(list(Array.from({ length: 6 }, () => passed)), { byeWeek: () => null }))?.drivers).toEqual([]);
    const noOdds = trade(["wilson"], ["kyren", "jsn"], { winChance: undefined });
    expect(patternNote(inputs(list(Array.from({ length: 6 }, () => noOdds))))?.drivers).toEqual([]);
  });

  it("incomingByes: worded for what holds: all ahead, all done, or some of each", () => {
    // Firstweek 9: Kyren Williams's and JSN's byes (week 8) are done; Kelce's (10) is ahead in a favored week.
    const done = patternNote(inputs(list(Array.from({ length: 6 }, () => trade(["wilson"], ["kyren", "jsn"]))), { firstWeek: 9 }));
    expect(done?.drivers).toEqual(["incomingByes"]);
    expect(done?.text).toBe("Most of your best ideas trade Garrett Wilson: the players you'd get have had their byes.");
    const mixed = patternNote(inputs(list(Array.from({ length: 6 }, () => trade(["wilson"], ["kyren", "kelce"]))), { firstWeek: 9 }));
    expect(mixed?.text).toBe("Most of your best ideas trade Garrett Wilson: the players you'd get have byes that are done or in weeks you're favored to win.");
    const ahead = patternNote(inputs(list(Array.from({ length: 6 }, () => trade(["wilson"], ["kelce"]))), { firstWeek: 9 }));
    expect(ahead?.text).toBe("Most of your best ideas trade Garrett Wilson: the players you'd get have byes in weeks you're favored to win.");
  });

  it("incomingByes fails for a bye in a week I'm not favored, in a week without a game, or unknown", () => {
    const at = (get: string[]) => patternNote(inputs(list(Array.from({ length: 6 }, () => trade(["wilson"], get)))))?.drivers ?? [];
    expect(at(["kelce"])).toEqual(["incomingByes"]); // week 10: 58%
    expect(at(["kelce", "laporta"])).toEqual([]); // laporta's week 5: 45%
    expect(at(["kelce", "allen"])).toEqual([]); // allen's week 7: 48%
    expect(at(["kelce", "nobody"])).toEqual([]); // no known bye
    const noGame = patternNote(inputs(list(Array.from({ length: 6 }, () => trade(["wilson"], ["kelce"], { winChance: winChance().filter((c) => c.week !== 10) })))));
    expect(noGame?.drivers).toEqual([]);
  });

  it("the half rule: a driver that holds in fewer than half of his trades is never named", () => {
    const covering = () => wilsonDeal();
    const notCovering = () => trade(["wilson"], ["laporta"], { winChance: winChance() });
    // 3 of 7 cover his bye: not named; 4 of 7 (half or more) cover: named.
    expect(patternNote(inputs(list([covering(), covering(), covering(), notCovering(), notCovering(), notCovering(), notCovering()])))?.drivers).toEqual([]);
    expect(patternNote(inputs(list([covering(), covering(), covering(), covering(), notCovering(), notCovering(), notCovering()])))?.drivers).toEqual(["byeCover", "incomingByes"]);
    // Exactly half (3 of 6) counts.
    expect(patternNote(inputs(list([covering(), covering(), covering(), notCovering(), notCovering(), notCovering()])))?.drivers).toEqual(["byeCover", "incomingByes"]);
    // The share is config's (patternDriverShare): at three quarters, 4 of 7 is too few, 6 of 7 enough.
    const strict = { ...patternConfig(), driverShare: 0.75 };
    expect(patternNote(inputs(list([covering(), covering(), covering(), covering(), notCovering(), notCovering(), notCovering()])), strict)?.drivers).toEqual([]);
    expect(patternNote(inputs(list([...Array.from({ length: 6 }, covering), notCovering()])), strict)?.drivers).toEqual(["byeCover", "incomingByes"]);
  });

  it("slotGain: the same largest slot gain (at least slotChangeMin) in most of them, named by its label", () => {
    const flex = (gain: number) => trade(["wilson"], ["laporta"], { mySlots: slots({ FLEX: gain, WR2: gain / 2 }) });
    const note = patternNote(inputs(list(Array.from({ length: 6 }, () => flex(2.5))), { slotLabel: (k) => (k === "FLEX" ? "RB/WR/TE" : k) }));
    expect(note?.drivers).toEqual(["slotGain"]);
    expect(note?.text).toBe("Most of your best ideas trade Garrett Wilson: the biggest gain is usually at your RB/WR/TE spot.");
    // Under slotChangeMin: nothing to name.
    expect(patternNote(inputs(list(Array.from({ length: 6 }, () => flex(0.9)))))?.drivers).toEqual([]);
    // Spread over different slots: no one slot in half of them.
    const spread = ["QB", "RB1", "RB2", "WR1", "TE", "FLEX"].map((k) => trade(["wilson"], ["laporta"], { mySlots: slots({ [k]: 2 }) }));
    expect(patternNote(inputs(list(spread)))?.drivers).toEqual([]);
  });

  it("injuryCover: depthCover at least patternDepthCoverMin; never without scenarios (no depthCover)", () => {
    const deep = (d: number | undefined) => trade(["wilson"], ["laporta"], d === undefined ? {} : { depthCover: d });
    const note = patternNote(inputs(list(Array.from({ length: 6 }, () => deep(0.5)))));
    expect(note?.drivers).toEqual(["injuryCover"]);
    expect(note?.text).toBe("Most of your best ideas trade Garrett Wilson: part of the gain is depth that covers injuries and byes.");
    expect(patternNote(inputs(list(Array.from({ length: 6 }, () => deep(0.49)))))?.drivers).toEqual([]);
    expect(patternNote(inputs(list(Array.from({ length: 6 }, () => deep(undefined)))))?.drivers).toEqual([]);
  });

  it("at most 3 drivers, in the order byeCover, incomingByes, slotGain, injuryCover; three are joined with semicolons", () => {
    const all = wilsonDeal({ mySlots: slots({ FLEX: 3 }), depthCover: 1.2 });
    const note = patternNote(inputs(list(Array.from({ length: 6 }, () => all))));
    expect(note?.drivers).toEqual(["byeCover", "incomingByes", "slotGain"]);
    expect(note?.text).toBe("Most of your best ideas trade Garrett Wilson: his bye is in week 13, your riskiest week; the players you'd get have byes in weeks you're favored to win; and the biggest gain is usually at your FLEX spot.");
    // Without the bye drivers, slotGain and injuryCover.
    const two = trade(["wilson"], ["laporta"], { mySlots: slots({ RB2: 3 }), depthCover: 1.2 });
    expect(patternNote(inputs(list(Array.from({ length: 6 }, () => two))))?.text).toBe("Most of your best ideas trade Garrett Wilson: the biggest gain is usually at your RB2 spot, and part of the gain is depth that covers injuries and byes.");
    // The most is config's (patternDriversMax): 1 keeps the first that holds, 4 all four.
    expect(patternNote(inputs(list(Array.from({ length: 6 }, () => all))), { ...patternConfig(), driversMax: 1 })?.text).toBe("Most of your best ideas trade Garrett Wilson: his bye is in week 13, your riskiest week.");
    expect(patternNote(inputs(list(Array.from({ length: 6 }, () => all))), { ...patternConfig(), driversMax: 4 })?.drivers).toEqual(["byeCover", "incomingByes", "slotGain", "injuryCover"]);
  });

  it("names a D/ST with 'its'; an unknown player as 'this player' (never a team's name)", () => {
    const dst = trade(["steelers"], ["kelce"], { winChance: winChance({ 13: 0.05 }) });
    expect(patternNote(inputs(list(Array.from({ length: 6 }, () => dst))))?.text).toBe("Most of your best ideas trade Steelers D/ST: its bye is in week 13, your riskiest week, and the players you'd get have byes in weeks you're favored to win.");
    const ghost = trade(["ghost"], ["kelce"]);
    expect(patternNote(inputs(list(Array.from({ length: 6 }, () => ghost))))?.text).toBe("Most of your best ideas trade this player: the players you'd get have byes in weeks you're favored to win.");
  });
});
