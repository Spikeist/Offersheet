import { describe, expect, it } from "vitest";
import {
  acceptance,
  acceptanceFeatures,
  acceptanceLabel,
  activity,
  complexityFeature,
  contextTerm,
  displayAcceptance,
  gFeature,
  holeFeature,
  hotPlayers,
  hotTerm,
  hotWeeks,
  involves,
  isHole,
  isHot,
  logistic,
  median,
  needFeature,
  partnerLineupDelta,
  partnerProfile,
  pastProjection,
  pAcceptFromLogit,
  quickAcceptance,
  tradeDeadlinePassed,
  tradeHistory,
  transactionWeek,
  urgencyTerm,
  vetoApplies,
  type AcceptanceConfig,
  type AcceptanceLeague,
  type ActivitySummary,
  type HoleSlot,
  type PartnerProfile,
  type ReceivedStarter,
  type TradeAcceptanceInput,
} from "./acceptance";
import { tradePackage } from "./benefit";
import { config } from "./config";
import type { PlayerInputs } from "./inputs";
import { lineupTotal, prepareRoster, prepareSlots, type LineupPlayer } from "./lineup";
import { marketGain } from "./market";
import type { DraftPick, Pos, SlotDef, Transaction } from "./model";
import { instanceIndex, instancePointsInto, slotInstances } from "./needs";
import { eliteIds, perceivedPackage, teamPremiums } from "./premium";

const REDRAFT: AcceptanceLeague = { leagueType: "redraft", tradeReview: "none" };
const VOTE: AcceptanceLeague = { leagueType: "redraft", tradeReview: "league_vote" };
const DYNASTY: AcceptanceLeague = { leagueType: "dynasty", tradeReview: "none" };

const activitySummary = (a: number): ActivitySummary => ({ a, rule: a === 1 ? "active" : a === -2 ? "inactive" : a === -1 ? "quiet" : "normal", trades: 0, recentTrades: 0, transactions: 0, lastWeek: null });

/** A partner with the given activity, history and baseline P(playoffs) (0.4: no season context). */
function profile(over: { a?: number; hist?: number | null; pPlayoffs?: number | null } = {}): PartnerProfile {
  const hist = over.hist ?? null;
  return {
    teamId: "2",
    activity: activitySummary(over.a ?? 0),
    history: { hist, average: hist, trades: 0, used: hist === null ? 0 : 1, skipped: 0, perTrade: [] },
    pPlayoffs: over.pPlayoffs === undefined ? 0.4 : over.pPlayoffs,
  };
}

/** A 1-for-1 with even value and nothing else, unless overridden. */
const trade = (over: Partial<TradeAcceptanceInput> = {}): TradeAcceptanceInput => ({ gPartner: 0, deltaLineup: 0, h: 0, assets: 2, partnerReceives: [], ...over });

let txSeq = 0;
/** A transaction for tests: `teams` defaults to every team its moves touch. */
function tx(type: Transaction["type"], week: number, moves: Transaction["moves"], extra: Partial<Transaction> = {}): Transaction {
  const teams = new Set<string>();
  for (const m of moves) for (const id of [m.from, m.to]) if (id) teams.add(id);
  txSeq += 1;
  return { id: `t${txSeq}`, type, week, timestamp: `2026-09-${String(10 + (txSeq % 15)).padStart(2, "0")}T12:00:00.000Z`, teams: [...teams], moves, ...extra };
}
const leg = (playerId: string, from: string, to: string) => ({ playerId, from, to });
const add = (teamId: string, week: number, playerId = `fa${week}`) => tx("add", week, [{ playerId, from: null, to: teamId }]);

/** Within ±1 percentage point (§11: the required tolerance). */
function expectWithinOnePoint(p: number, percent: number): void {
  expect(Math.abs(p * 100 - percent)).toBeLessThanOrEqual(1);
}

// A standard lineup and the real lineup machinery, so the hole feature reads slot instances the way the engine
// fills them: lineup.ts seats the starters, needs.instancePointsInto sorts them by points within a slot name.
const LINEUP: SlotDef[] = [
  { slot: "QB", count: 1, eligible: ["QB"] },
  { slot: "RB", count: 2, eligible: ["RB"] },
  { slot: "WR", count: 2, eligible: ["WR"] },
  { slot: "TE", count: 1, eligible: ["TE"] },
  { slot: "RB/WR/TE", count: 1, eligible: ["RB", "WR", "TE"] },
];
const SLOTS = prepareSlots(LINEUP);
const INSTANCES = slotInstances(LINEUP);
const FLEX1 = "RB/WR/TE1";
const pl = (id: string, pos: Pos, points: number): LineupPlayer => ({ id, pos, eligible: [pos], points });

/** One week's best lineup by slot instance (the real solver's seats, then needs.instancePointsInto) and who starts. */
function lineupByInstance(players: readonly LineupPlayer[]): { total: number; points: Record<string, number>; starters: Set<string> } {
  const roster = prepareRoster(players, SLOTS);
  const points = Float64Array.from(players, (p) => p.points);
  const seat = new Int32Array(players.length);
  const total = lineupTotal(roster, points, null, seat);
  const index = instanceIndex(INSTANCES, SLOTS);
  const byInstance = instancePointsInto(index, seat, points, null, players.length, new Float64Array(index.size));
  return {
    total,
    points: Object.fromEntries(INSTANCES.map((inst, i) => [inst.key, byInstance[i] as number])),
    starters: new Set(players.filter((_, k) => (seat[k] as number) >= 0).map((p) => p.id)),
  };
}

/**
 * holeFeature's inputs for P from its rosters before and after a trade (one week standing in for the hole weeks)
 * and the league medians by instance (an instance without one gets P's own starter: no hole there).
 */
function holeInputs(before: readonly LineupPlayer[], after: readonly LineupPlayer[], received: readonly string[], medians: Readonly<Record<string, number>>) {
  const b = lineupByInstance(before);
  const a = lineupByInstance(after);
  const eligibleOf = (slot: string): Pos[] => LINEUP.find((d) => d.slot === slot)?.eligible ?? [];
  const slots: HoleSlot[] = INSTANCES.map((inst) => {
    const starter = b.points[inst.key] ?? 0;
    return { key: inst.key, eligible: eligibleOf(inst.slot), starter, after: a.points[inst.key] ?? 0, median: medians[inst.key] ?? starter };
  });
  // LineupPlayer has a ReceivedStarter's fields (pos, eligible), and the id the tests check.
  const receivedStarters: LineupPlayer[] = after.filter((p) => received.includes(p.id) && a.starters.has(p.id));
  return { slots, receivedStarters, before: b, after: a };
}

describe("§11 required anchor tests (default coefficients, within ±1 point)", () => {
  // The planner's table (CLAUDE.md §11): scenario → P_accept. Features not named are 0 (g even, a = 0, no
  // history, no hole, a 1-for-1, no context, hot and urg 0); n is given through ΔLineup_P = n × nScale.
  const anchors: { name: string; g?: number; n?: number; h?: 0 | 1; a?: number; c?: number; percent: number }[] = [
    { name: "Even value; n = 0.5; fills a hole; active (a = +1)", n: 0.5, h: 1, a: 1, percent: 61.1 },
    { name: "Even value; nothing else", percent: 35.4 },
    { name: "g = −0.10; n = 0.5; fills a hole", g: -0.1, n: 0.5, h: 1, percent: 31.0 },
    { name: "g = −0.20; nothing else", g: -0.2, percent: 8.3 },
    { name: "g = +0.15; n = −0.3", g: 0.15, n: -0.3, percent: 53.0 },
    { name: "Even value; inactive (a = −2)", a: -2, percent: 21.4 },
    { name: "3-for-1 (c = 2); even value", c: 2, percent: 25.0 },
    { name: "g = +0.30; n = 0.5", g: 0.3, n: 0.5, percent: 81.8 },
  ];
  for (const s of anchors) {
    it(`${s.name} → ${s.percent}%`, () => {
      const r = acceptance(REDRAFT, profile({ a: s.a ?? 0 }), trade({ gPartner: s.g ?? 0, deltaLineup: (s.n ?? 0) * config.acceptance.nScale, h: s.h ?? 0, assets: (s.c ?? 0) + 2 }));
      expectWithinOnePoint(r.pAccept, s.percent);
      expect(r.pComplete).toBe(r.pAccept); // no review in this league: no veto
      expect(quickAcceptance(REDRAFT, profile({ a: s.a ?? 0 }), trade({ gPartner: s.g ?? 0, deltaLineup: (s.n ?? 0) * config.acceptance.nScale, h: s.h ?? 0, assets: (s.c ?? 0) + 2 }))).toBe(r.pAccept);
    });
  }

  it("the anchors hold when every feature is built from raw league data (values, lineups, holes, transactions)", () => {
    const W = 100;
    // m1 + m2 + m3 = 5,200 = big (5,000) + 2 open spots × W (100): an even 3-for-1 for the partner.
    const values = { mine: 5000, theirs: 5000, x1: 3000, y1: 3000, x2: 2000, y2: 2000, m1: 1700, m2: 1700, m3: 1800, big: 5000 };
    // Team 2 traded twice this season, both even at today's values: active (a = +1), hist 0.
    const txs = [tx("trade", 1, [leg("x1", "2", "5"), leg("y1", "5", "2")]), tx("trade", 2, [leg("x2", "2", "7"), leg("y2", "7", "2")]), add("2", 3)];
    const active = partnerProfile({ teamId: "2", transactions: txs, week: 4, values, W, pPlayoffs: 0.4 });
    expect(active.activity.a).toBe(1);
    expect(active.history.hist).toBe(0);
    // Team 2 starts a 4-point TE (the league median there is 10: a hole) and gets "mine", a 6.5-point TE, for
    // "theirs", a bench WR: +2.5 points a week in both windows (n = 0.5), and the TE hole gets a better starter.
    const partnerBefore = [pl("qb", "QB", 18), pl("rb1", "RB", 15), pl("rb2", "RB", 13), pl("wr1", "WR", 14), pl("wr2", "WR", 12), pl("wr3", "WR", 11), pl("te", "TE", 4), pl("theirs", "WR", 3)];
    const partnerAfter = [...partnerBefore.filter((p) => p.id !== "theirs"), pl("mine", "TE", 6.5)];
    const lineups = holeInputs(partnerBefore, partnerAfter, ["mine"], { TE1: 10 });
    expect(lineups.after.total - lineups.before.total).toBe(2.5);
    const delta = partnerLineupDelta(Array(6).fill(lineups.before.total), Array(6).fill(lineups.after.total), 0);
    expect(needFeature(delta.blended)).toBe(0.5);
    const hole = holeFeature(lineups.slots, lineups.receivedStarters);
    expect(hole).toStrictEqual({ h: 1, holes: ["TE1"], filled: ["TE1"] });
    const g = marketGain(["mine"], ["theirs"], values, W); // the partner receives mine, gives theirs
    expect(g).toBe(0);
    const anchor1 = acceptance(REDRAFT, active, { gPartner: g, deltaLineup: delta.blended, h: hole.h, assets: 2, partnerReceives: [{ pos: "TE", age: 25 }] });
    expectWithinOnePoint(anchor1.pAccept, 61.1);

    // Team 4 added a free agent in week 1 and nothing since; in week 8 that's inactive (a = −2), no trades (hist null).
    const quiet = partnerProfile({ teamId: "4", transactions: [add("4", 1)], week: 8, values, W, pPlayoffs: 0.4 });
    expect(quiet.activity).toMatchObject({ a: -2, rule: "inactive" });
    expect(quiet.history.hist).toBeNull();
    expectWithinOnePoint(acceptance(REDRAFT, quiet, trade()).pAccept, 21.4);

    // 3-for-1 at even value: the partner receives three players for one, so its side gives the waiver credit for two spots.
    const g31 = marketGain(["m1", "m2", "m3"], ["big"], values, W);
    expect(g31).toBeCloseTo(0, 12);
    const neutral = partnerProfile({ teamId: "9", transactions: [add("9", 7)], week: 8, values, W, pPlayoffs: 0.4 });
    expect(neutral.activity.a).toBe(0);
    expectWithinOnePoint(acceptance(REDRAFT, neutral, trade({ gPartner: g31, assets: 4 })).pAccept, 25.0);
  });
});

describe("the star premium's anchor tests (planner addendum to Checkpoint 3, §1: default coefficients, W = 752, within ±0.5 points)", () => {
  // Through the real functions: premium.eliteIds and teamPremiums give each player's e from the FantasyCalc list and the
  // partner's roster, premium.perceivedPackage the partner's perceived g (v′ = v × (1 + e) on what it gives, W unchanged),
  // benefit.tradePackage the raw g, and acceptance() / quickAcceptance() the estimate. Ten players above 9,000 plus the
  // partner's star (9,000) and one of mine (9,000; "star" sorts first at the tie) are FantasyCalc's top 12.
  const W = 752;
  const values: Record<string, number> = { star: 9000, you9000: 9000, p2: 5000, p3: 4000, p4: 3000, p5: 2500, p6: 2000, p7: 1000, best: 5000, b2: 3000, you2000: 2000, you5000: 5000, you6500: 6500, r4000: 4000, r3500a: 3500, r3500b: 3500 };
  for (let i = 1; i <= 10; i++) values[`x${String(i).padStart(2, "0")}`] = 9000 + 100 * i;
  const elite = eliteIds({ format: { isDynasty: false, numQbs: 1, numTeams: 10, ppr: 0.5, substitutions: [] }, fetchedAt: "2026-10-01T00:00:00.000Z", values, knownIds: Object.keys(values), topValue: 10_000 });
  const roster = (ids: string[]) => teamPremiums({ players: ids.map((id) => ({ id, value: values[id] ?? 0, ros: 0 })), elite, leagueType: "redraft", pPlayoffs: 0.7 });
  // Partner A: its #1 is the 9,000 top-12 star, its #2 and #6 aren't top-12. Partner B: its #1 (5,000) isn't top-12.
  const partnerA = roster(["star", "p2", "p3", "p4", "p5", "p6", "p7"]);
  const partnerB = roster(["best", "b2"]);
  const contender = profile({ pPlayoffs: 0.7 });
  const other = profile({ pPlayoffs: 0.4 });

  /** The partner receives `recv` (my side) and gives `give` (its players, with its premiums). */
  function estimate(partner: PartnerProfile, premiums: Record<string, { e: number }>, recv: string[], give: string[], over: Partial<TradeAcceptanceInput> = {}) {
    const gPartner = tradePackage({ players: recv }, { players: give }, values, W).g;
    const gPerceived = perceivedPackage({ players: recv }, { players: give }, values, W, (id) => premiums[id]?.e ?? 0).g;
    const input: TradeAcceptanceInput = { gPartner, gPerceived, deltaLineup: 0, h: 0, assets: recv.length + give.length, partnerReceives: [], ...over };
    const full = acceptance(REDRAFT, partner, input);
    expect(quickAcceptance(REDRAFT, partner, input)).toBe(full.pAccept); // no hot, urg or veto here
    return { full, gPartner, gPerceived, before: acceptance(REDRAFT, partner, { ...input, gPerceived: undefined }).pAccept };
  }
  const withinHalfPoint = (p: number, percent: number) => expect(Math.abs(p * 100 - percent)).toBeLessThanOrEqual(0.5);

  it("the premiums behind the table: #1 and top-12 0.20, #2 0.05, #6 0, a #1 outside the top 12 0.10", () => {
    expect(elite.has("star")).toBe(true);
    expect(elite.size).toBe(12);
    expect(partnerA.star).toMatchObject({ rank: 1, elite: true, harderToGet: true });
    expect(partnerA.star?.e).toBeCloseTo(0.2, 12);
    expect(partnerA.p2).toMatchObject({ rank: 2, elite: false, e: 0.05, harderToGet: false });
    expect(partnerA.p6).toMatchObject({ rank: 6, elite: false, e: 0, harderToGet: false });
    expect(partnerB.best).toMatchObject({ rank: 1, elite: false, e: 0.1, harderToGet: false });
  });

  it("1-for-1, equal raw value; partner's #1; top-12; contender; no lineup change → 10.9%", () => {
    const r = estimate(contender, partnerA, ["you9000"], ["star"]);
    expect(r.gPartner).toBe(0);
    expect(r.full.features.g).toBeCloseTo(-0.2 / 1.2, 12);
    withinHalfPoint(r.full.pAccept, 10.9);
  });

  it("1-for-1, equal raw value; partner's #6; not top-12 → 35.4% (unchanged)", () => {
    const r = estimate(other, partnerA, ["you2000"], ["p6"]);
    withinHalfPoint(r.full.pAccept, 35.4);
    expect(r.full.pAccept).toBe(r.before);
  });

  it("partner gets 4,000 + 3,500 + 3,500 for their #1 top-12 player (9,000); contender; n = 0.6; fills a hole → 23.4% (51.3% before)", () => {
    const r = estimate(contender, partnerA, ["r4000", "r3500a", "r3500b"], ["star"], { deltaLineup: 0.6 * config.acceptance.nScale, h: 1 });
    // W counts on the side receiving fewer players (the partner's give side here), unchanged by the premium.
    expect(r.gPerceived).toBeCloseTo((11_000 - (9000 * 1.2 + 2 * W)) / (9000 * 1.2 + 2 * W), 12);
    expect(r.full.features.c).toBe(2);
    withinHalfPoint(r.full.pAccept, 23.4);
    withinHalfPoint(r.before, 51.3);
  });

  it("the same trade, where the RBs help them twice as much (n = 1.2) → 32.8%", () => {
    const r = estimate(contender, partnerA, ["r4000", "r3500a", "r3500b"], ["star"], { deltaLineup: 1.2 * config.acceptance.nScale, h: 1 });
    withinHalfPoint(r.full.pAccept, 32.8);
  });

  it("1-for-1, equal raw value; partner's #2; not top-12 → 26.3%", () => {
    const r = estimate(other, partnerA, ["you5000"], ["p2"]);
    withinHalfPoint(r.full.pAccept, 26.3);
  });

  it("1-for-1; partner's #1, not top-12; contender; partner gets 30% more raw value → 62.0%", () => {
    const r = estimate(contender, partnerB, ["you6500"], ["best"]);
    expect(r.gPartner).toBeCloseTo(0.3, 12);
    withinHalfPoint(r.full.pAccept, 62.0);
  });

  it("the veto reads the raw g, never the perceived one", () => {
    // The partner gives its top-12 #1 (9,000) for 7,200 in a league that votes on trades: the market reads −20% (above
    // the −30% veto line), the partner perceives −33%. Only the g feature reads the perceived g.
    const pkg = { ...values, you7200: 7200 };
    const gPartner = tradePackage({ players: ["you7200"] }, { players: ["star"] }, pkg, W).g;
    const gPerceived = perceivedPackage({ players: ["you7200"] }, { players: ["star"] }, pkg, W, (id) => partnerA[id]?.e ?? 0).g;
    expect(gPartner).toBeCloseTo(-0.2, 12);
    expect(gPerceived).toBeCloseTo(-1 / 3, 12);
    const kept = acceptance(VOTE, contender, trade({ gPartner, gPerceived }));
    expect(kept.features.g).toBeCloseTo(-1 / 3, 12);
    expect(kept.vetoRisk).toBe(false);
    expect(kept.pComplete).toBe(kept.pAccept);
    // The other way round: a raw g below −0.30 is vetoed whatever the perceived g says.
    const vetoed = acceptance(VOTE, contender, trade({ gPartner: -0.35, gPerceived: -0.2 }));
    expect(vetoed.vetoRisk).toBe(true);
    expect(vetoed.features.g).toBe(-0.2);
    expect(vetoed.pComplete).toBe(vetoed.pAccept * config.acceptance.veto.factor);
    // Without a perceived g (the pre-addendum model), the g feature is the raw g.
    expect(acceptance(VOTE, contender, trade({ gPartner })).features.g).toBe(gPartner);
  });
});

describe("the model (§11)", () => {
  it("z is the sum of the terms; P_accept = clamp(σ(z)); quick drops hot and urg only", () => {
    const partner = profile({ a: -1, hist: 0.1, pPlayoffs: 0.7 });
    const t = trade({ gPartner: -0.12, deltaLineup: 3, h: 1, assets: 3, hot: 0.15, urg: 0.2 });
    const { features, terms } = acceptanceFeatures(REDRAFT, partner, t);
    const sum = Object.values(terms).reduce((s, x) => s + x, 0);
    expect(features.z).toBeCloseTo(sum, 12);
    const b = config.acceptance.beta;
    const expected = b.b0 + b.loss * -0.12 + b.need * 0.6 + b.hole - b.complexity * 1 + b.activity * -1 - b.history * 0.1 + b.need * 0.6 * (config.acceptance.context.contenderNeedFactor - 1) + 0.15 + 0.2;
    expect(features.z).toBeCloseTo(expected, 12);
    const full = acceptance(REDRAFT, partner, t);
    expect(full.pAccept).toBeCloseTo(logistic(expected), 12);
    expect(quickAcceptance(REDRAFT, partner, t)).toBeCloseTo(logistic(expected - 0.15 - 0.2), 12);
  });

  it("stores n before the contender factor and carries the factor's extra in ctx (logit units)", () => {
    const contender = acceptanceFeatures(REDRAFT, profile({ pPlayoffs: 0.75 }), trade({ deltaLineup: 5 }));
    expect(contender.features.n).toBe(1);
    expect(contender.context.contender).toBe(true);
    expect(contender.features.ctx).toBeCloseTo(config.acceptance.beta.need * 1 * 0.3, 12);
    // Same z as multiplying n by 1.3.
    expect(contender.features.z).toBeCloseTo(config.acceptance.beta.b0 + config.acceptance.beta.need * 1.3, 12);
  });

  it("clamps P_accept to [0.02, 0.95]", () => {
    expect(pAcceptFromLogit(10)).toBe(0.95);
    expect(pAcceptFromLogit(-10)).toBe(0.02);
    expect(pAcceptFromLogit(Number.POSITIVE_INFINITY)).toBe(0.95);
    expect(pAcceptFromLogit(Number.NEGATIVE_INFINITY)).toBe(0.02);
    expect(pAcceptFromLogit(Number.NaN)).toBe(0.5);
    const huge = acceptance(REDRAFT, profile({ a: 1, pPlayoffs: 0.9 }), trade({ gPartner: 5, deltaLineup: 50, h: 1, hot: 0.15, urg: 0.2 }));
    expect(huge.pAccept).toBe(0.95);
    const hopeless = acceptance(REDRAFT, profile({ a: -2, hist: 0.15, pPlayoffs: 0.01 }), trade({ gPartner: -0.9, deltaLineup: -20, assets: 6 }));
    expect(hopeless.pAccept).toBe(0.02);
  });

  it("veto risk: a reviewed league halves P_complete when g < −0.30 (only then), and the quick variant ignores it", () => {
    expect(vetoApplies("league_vote", -0.31)).toBe(true);
    expect(vetoApplies("commissioner", -0.31)).toBe(true);
    expect(vetoApplies("none", -0.5)).toBe(false);
    expect(vetoApplies("league_vote", -0.3)).toBe(false);
    expect(vetoApplies("league_vote", Number.NaN)).toBe(false);
    const t = trade({ gPartner: -0.32, deltaLineup: 20, h: 1 });
    const vetoed = acceptance(VOTE, profile({ a: 1 }), t);
    expect(vetoed.vetoRisk).toBe(true);
    expect(vetoed.pComplete).toBeCloseTo(vetoed.pAccept * config.acceptance.veto.factor, 12);
    expect(vetoed.shown.complete).toBe(displayAcceptance(vetoed.pComplete));
    const open = acceptance(REDRAFT, profile({ a: 1 }), t);
    expect(open.vetoRisk).toBe(false);
    expect(open.pComplete).toBe(open.pAccept);
    expect(open.pAccept).toBe(vetoed.pAccept);
    expect(quickAcceptance(VOTE, profile({ a: 1 }), t)).toBe(vetoed.pAccept);
  });

  it("is deterministic and doesn't mutate its inputs", () => {
    const partner = profile({ a: 1, hist: -0.05, pPlayoffs: 0.2 });
    const t = trade({ gPartner: 0.07, deltaLineup: 1.7, h: 1, assets: 3, partnerReceives: [{ pos: "RB", age: 29 }], hot: -0.15, urg: 0.2 });
    const snapshot = JSON.stringify({ partner, t });
    const a = acceptance(DYNASTY, partner, t);
    const b = acceptance(DYNASTY, partner, t);
    expect(a).toStrictEqual(b);
    expect(JSON.stringify({ partner, t })).toBe(snapshot);
  });

  it("accepts a widened config (a refit's coefficients)", () => {
    const refit: AcceptanceConfig = { ...config.acceptance, beta: { ...config.acceptance.beta, b0: 0 } };
    expect(acceptance(REDRAFT, profile(), trade(), refit).pAccept).toBe(0.5);
  });
});

describe("g, n, h and c (the trade's features)", () => {
  it("g: clamped to ±0.5; +∞ (nothing of value given) clamps; NaN counts 0", () => {
    expect(gFeature(0.2)).toBe(0.2);
    expect(gFeature(0.7)).toBe(0.5);
    expect(gFeature(-0.8)).toBe(-0.5);
    expect(gFeature(Number.POSITIVE_INFINITY)).toBe(0.5);
    expect(gFeature(Number.NaN)).toBe(0);
    // g⁺ uses β_gain, g⁻ β_loss (losses weigh more).
    const up = acceptanceFeatures(REDRAFT, profile(), trade({ gPartner: 0.1 })).terms.value;
    const down = acceptanceFeatures(REDRAFT, profile(), trade({ gPartner: -0.1 })).terms.value;
    expect(up).toBeCloseTo(0.6, 12);
    expect(down).toBeCloseTo(-0.9, 12);
  });

  it("n: ΔLineup_P / 5, clamped to ±2", () => {
    expect(needFeature(2.5)).toBe(0.5);
    expect(needFeature(-1.5)).toBeCloseTo(-0.3, 12);
    expect(needFeature(12)).toBe(2);
    expect(needFeature(-15)).toBe(-2);
    expect(needFeature(Number.NaN)).toBe(0);
  });

  it("ΔLineup_P blends the next 4 weeks and the rest of the season 50/50, from the first week that counts", () => {
    const before = [10, 10, 10, 10, 10, 10, 10, 10];
    const after = [20, 20, 10, 10, 10, 10, 10, 10];
    // The default config blends 50/50 (§11).
    expect(partnerLineupDelta(before, after, 0)).toStrictEqual({ next: 5, ros: 2.5, blended: 3.75, nextWeeks: 4, rosWeeks: 8 });
    // The weight is a config number (nBlendWeight, on the next weeks): 1 → the next weeks only, 0 → the rest of the season only.
    const weighted = (w: number): number => partnerLineupDelta(before, after, 0, { ...config.acceptance, nBlendWeight: w }).blended;
    expect(weighted(0.5)).toBe(3.75);
    expect(weighted(1)).toBe(5);
    expect(weighted(0)).toBe(2.5);
    expect(weighted(0.25)).toBeCloseTo(0.25 * 5 + 0.75 * 2.5, 12);
    // A week in progress is skipped (TeamWeeks.from = 1).
    const skipped = partnerLineupDelta(before, after, 1);
    expect(skipped.next).toBe(2.5);
    expect(skipped.ros).toBeCloseTo(10 / 7, 12);
    expect(skipped.blended).toBeCloseTo((2.5 + 10 / 7) / 2, 12);
    // Fewer weeks left than the window: both windows are the same weeks.
    expect(partnerLineupDelta([5, 5], [8, 6], 0)).toStrictEqual({ next: 2, ros: 2, blended: 2, nextWeeks: 2, rosWeeks: 2 });
    // Nothing left.
    expect(partnerLineupDelta([], [], 0).blended).toBe(0);
    expect(partnerLineupDelta([1, 2], [3, 4], 5).blended).toBe(0);
    // Typed arrays (teamValue's per-week values) work too.
    expect(partnerLineupDelta(Float64Array.from([1, 1]), Float64Array.from([2, 3]), 0).blended).toBe(1.5);
  });

  it("median: the middle value, the mean of the middle two, null when empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([Number.NaN, 5])).toBe(5);
  });

  it("h: a hole is a starter below 60% of the league median (strictly); h = 1 when its starter improves and a received starter can play the slot", () => {
    expect(isHole(5.9, 10)).toBe(true);
    expect(isHole(6, 10)).toBe(false);
    expect(isHole(0, 0)).toBe(false);
    expect(isHole(-1, 0)).toBe(false);
    expect(isHole(Number.NaN, 10)).toBe(false);
    const rb2 = (after: number): HoleSlot => ({ key: "RB2", eligible: ["RB"], starter: 3, after, median: 9 });
    const rb: ReceivedStarter = { pos: "RB", eligible: ["RB"] };
    const wr: ReceivedStarter = { pos: "WR", eligible: ["WR"] };
    // Unchanged, or worse: not filled.
    expect(holeFeature([rb2(3)], [rb])).toStrictEqual({ h: 0, holes: ["RB2"], filled: [] });
    expect(holeFeature([rb2(2)], [rb]).h).toBe(0);
    expect(holeFeature([rb2(Number.NaN)], [rb]).h).toBe(0);
    // A better starter and a received RB starts: filled, whichever RB instance he sits in.
    expect(holeFeature([rb2(15)], [rb])).toStrictEqual({ h: 1, holes: ["RB2"], filled: ["RB2"] });
    // Better but still under the cut (4 < 5.4) counts: the trade gives P a starter there.
    expect(holeFeature([rb2(4)], [rb]).h).toBe(1);
    // Improved, but no received starter can play RB (a free agent P's re-optimization added did it), or none starts.
    expect(holeFeature([rb2(15)], [wr]).h).toBe(0);
    expect(holeFeature([rb2(15)], []).h).toBe(0);
    // A multi-position player counts through his eligible positions; a flex slot takes any position it lists.
    expect(holeFeature([rb2(15)], [{ pos: "WR", eligible: ["RB", "WR"] }]).h).toBe(1);
    expect(holeFeature([{ key: FLEX1, eligible: ["RB", "WR", "TE"], starter: 4, after: 12, median: 10 }], [wr])).toStrictEqual({ h: 1, holes: [FLEX1], filled: [FLEX1] });
    // Not a hole: nothing to fill.
    expect(holeFeature([{ key: "WR1", eligible: ["WR"], starter: 15, after: 20, median: 16 }], [wr])).toStrictEqual({ h: 0, holes: [], filled: [] });
    expect(
      holeFeature(
        [rb2(3), { key: "TE1", eligible: ["TE"], starter: 2, after: 9, median: 8 }],
        [{ pos: "TE", eligible: ["TE"] }],
      ),
    ).toStrictEqual({ h: 1, holes: ["RB2", "TE1"], filled: ["TE1"] });
    expect(holeFeature([], [rb]).h).toBe(0);
  });

  it("h with the real lineup solver: a received RB better than P's RB1 fills the RB2 hole by pushing the old RB1 down", () => {
    // Review finding: instances are sorted by points, so the received RB (18) takes RB1 and the old RB1 (15)
    // drops into the RB2 hole. No received player sits in RB2, yet the hole is filled.
    const before = [pl("qb", "QB", 18), pl("rbA", "RB", 15), pl("rbB", "RB", 3), pl("wr1", "WR", 14), pl("wr2", "WR", 12), pl("wr3", "WR", 4), pl("te", "TE", 8), pl("wrGive", "WR", 11)];
    const after = [...before.filter((p) => p.id !== "wrGive"), pl("rbC", "RB", 18)];
    const x = holeInputs(before, after, ["rbC"], { RB2: 9 });
    expect([x.before.points.RB1, x.before.points.RB2]).toStrictEqual([15, 3]);
    expect([x.after.points.RB1, x.after.points.RB2]).toStrictEqual([18, 15]); // rbC at RB1, the old RB1 at RB2
    expect(holeFeature(x.slots, x.receivedStarters)).toStrictEqual({ h: 1, holes: ["RB2"], filled: ["RB2"] });
  });

  it("h with the real lineup solver: a received WR fills a FLEX hole by pushing P's old WR2 into FLEX", () => {
    const before = [pl("qb", "QB", 18), pl("rb1", "RB", 16), pl("rb2", "RB", 13), pl("rb3", "RB", 3), pl("wr1", "WR", 14), pl("wr2", "WR", 12), pl("wr3", "WR", 4), pl("te", "TE", 9), pl("te2", "TE", 2), pl("benchGive", "RB", 1)];
    const after = [...before.filter((p) => p.id !== "benchGive"), pl("wrNew", "WR", 16)];
    const x = holeInputs(before, after, ["wrNew"], { [FLEX1]: 10 });
    expect(x.before.points[FLEX1]).toBe(4);
    expect([x.after.points.WR1, x.after.points.WR2, x.after.points[FLEX1]]).toStrictEqual([16, 14, 12]); // wrNew at WR1, the old WR2 in FLEX
    expect(holeFeature(x.slots, x.receivedStarters)).toStrictEqual({ h: 1, holes: [FLEX1], filled: [FLEX1] });
  });

  it("h with the real lineup solver: nothing filled when the received player sits, or when only a free agent fills the hole", () => {
    const before = [pl("qb", "QB", 15), pl("rb1", "RB", 16), pl("rb2", "RB", 13), pl("wr1", "WR", 14), pl("wr2", "WR", 12), pl("wr3", "WR", 11), pl("te", "TE", 2), pl("benchGive", "RB", 1)];
    // A received TE who doesn't start (worse than P's 2-point TE): the hole stays as it was.
    const sits = holeInputs(before, [...before.filter((p) => p.id !== "benchGive"), pl("teBad", "TE", 1)], ["teBad"], { TE1: 9 });
    expect(sits.receivedStarters).toStrictEqual([]);
    expect(holeFeature(sits.slots, sits.receivedStarters)).toStrictEqual({ h: 0, holes: ["TE1"], filled: [] });
    // A received QB who starts, while P's re-optimized roster swaps its old QB for a free-agent TE that fills the
    // TE hole: the trade gave P no starter there.
    const viaFreeAgent = holeInputs(before, [...before.filter((p) => p.id !== "benchGive" && p.id !== "qb"), pl("qbNew", "QB", 20), pl("faTe", "TE", 8)], ["qbNew"], { TE1: 9 });
    expect(viaFreeAgent.after.points.TE1).toBe(8);
    expect(viaFreeAgent.receivedStarters.map((p) => p.id)).toStrictEqual(["qbNew"]);
    expect(holeFeature(viaFreeAgent.slots, viaFreeAgent.receivedStarters)).toStrictEqual({ h: 0, holes: ["TE1"], filled: [] });
  });

  it("c: assets − 2 (picks count), never below 0", () => {
    expect(complexityFeature(2)).toBe(0);
    expect(complexityFeature(3)).toBe(1);
    expect(complexityFeature(4)).toBe(2);
    expect(complexityFeature(1)).toBe(0);
    expect(complexityFeature(0)).toBe(0);
    expect(complexityFeature(Number.NaN)).toBe(0);
  });
});

describe("a: activity (first matching rule, by week)", () => {
  const T = "2";
  it("+1 for 2+ trades this season, even with nothing recent (rule 1 comes first)", () => {
    const s = activity([tx("trade", 1, [leg("p1", T, "5"), leg("p2", "5", T)]), tx("trade", 2, [leg("p3", T, "6"), leg("p4", "6", T)])], T, 9);
    expect(s).toStrictEqual({ a: 1, rule: "active", trades: 2, recentTrades: 0, transactions: 2, lastWeek: 2 });
  });

  it("+1 for one trade in the last 4 weeks; one 4 weeks back no longer counts", () => {
    expect(activity([tx("trade", 6, [leg("p1", T, "5"), leg("p2", "5", T)])], T, 9)).toMatchObject({ a: 1, recentTrades: 1 });
    // Week 5 at week 9: not in the last 4 weeks (6–9), but in the last 5 (5–9), and not in the last 3 (7–9).
    expect(activity([tx("trade", 5, [leg("p1", T, "5"), leg("p2", "5", T)])], T, 9)).toMatchObject({ a: -1, rule: "quiet", trades: 1, recentTrades: 0 });
  });

  it("−2 with no transaction in the last 5 weeks, −1 with none in the last 3, else 0", () => {
    expect(activity([add(T, 4)], T, 9)).toMatchObject({ a: -2, rule: "inactive" });
    expect(activity([add(T, 5)], T, 9)).toMatchObject({ a: -1, rule: "quiet" });
    expect(activity([add(T, 6)], T, 9)).toMatchObject({ a: -1, rule: "quiet" });
    expect(activity([add(T, 7)], T, 9)).toMatchObject({ a: 0, rule: "normal" });
    expect(activity([], T, 9)).toStrictEqual({ a: -2, rule: "inactive", trades: 0, recentTrades: 0, transactions: 0, lastWeek: null });
    // Early in the season the windows cover every week so far.
    expect(activity([add(T, 1)], T, 2)).toMatchObject({ a: 0 });
  });

  it("counts every type, the current week and later weeks (ESPN waiver runs), and only the team's own transactions", () => {
    const drop = tx("drop", 9, [{ playerId: "p9", from: T, to: null }]);
    expect(activity([drop], T, 9)).toMatchObject({ a: 0 });
    const waiverNextWeek = tx("waiver", 10, [{ playerId: "p10", from: null, to: T }]);
    expect(activity([waiverNextWeek], T, 9)).toMatchObject({ a: 0, lastWeek: 10 });
    expect(activity([add("3", 9), add("4", 9)], T, 9)).toMatchObject({ a: -2, transactions: 0 });
  });

  it("finds a trade through its moves when the teams list misses the team, and counts a repeated id once", () => {
    const t = tx("trade", 8, [leg("p1", T, "5"), leg("p2", "5", T)], { teams: ["5"] });
    expect(involves(t, T)).toBe(true);
    expect(activity([t, t], T, 9)).toMatchObject({ a: 1, trades: 1, transactions: 1 });
    // A trade ESPN hid (no moves) still counts when its teams list names the team.
    expect(activity([tx("trade", 3, [], { teams: [T, "5"] }), tx("trade", 4, [], { teams: [T, "6"] })], T, 9)).toMatchObject({ a: 1, trades: 2 });
  });

  it("uses the configured windows", () => {
    const cfg: AcceptanceConfig = { ...config.acceptance, activity: { ...config.acceptance.activity, quietWeeks: 1 } };
    expect(activity([add(T, 8)], T, 9, cfg)).toMatchObject({ a: -1 });
  });

  it("counts weeks in the platform's league week when it has one (Sleeper's leg), else the NFL week", () => {
    expect(transactionWeek({ currentWeek: 5, leagueWeek: 4 })).toBe(4);
    expect(transactionWeek({ currentWeek: 5 })).toBe(5);
  });
});

describe("hist: the partner's past trades at current values", () => {
  const T = "2";
  const W = 400;
  const values = { a: 6000, b: 5000, c: 1000, d: 2000, e: 3000, f: 3000 };

  it("averages each trade's g_mkt(P) as it is, then clamps only the average to ±0.15 (§11)", () => {
    const t1 = tx("trade", 2, [leg("a", T, "5"), leg("b", "5", T)]); // gives 6000, gets 5000: −1/6
    const t2 = tx("trade", 3, [leg("c", T, "6"), leg("d", "6", T)]); // gives 1000, gets 2000: +1.0
    const h = tradeHistory([t1, t2], T, values, W);
    expect(h.trades).toBe(2);
    expect(h.used).toBe(2);
    expect(h.perTrade.map((x) => x.g)).toStrictEqual([-1 / 6, 1]);
    expect(h.average).toBeCloseTo((1 - 1 / 6) / 2, 12);
    expect(h.hist).toBe(0.15);
    // One losing trade: inside the clamp.
    expect(tradeHistory([tx("trade", 4, [leg("e", T, "5"), leg("d", "5", T)])], T, values, W).hist).toBe(-0.15);
    expect(tradeHistory([tx("trade", 4, [leg("e", T, "5"), leg("f", "5", T)])], T, values, W).hist).toBe(0);
  });

  it("no clamp on each trade: one big win outweighs two modest losses, as §11's average says (review finding)", () => {
    // Gave 1,000 for 2,200 (+1.2), then twice 5,000 for 3,500 (−0.3 each): the average is +0.2 → +0.15. Clamping
    // each trade to ±0.5 first gave (0.5 − 0.3 − 0.3) / 3 = −0.033, the opposite sign.
    const v = { a: 1000, b: 2200, c: 5000, d: 3500, e: 5000, f: 3500 };
    const txs = [tx("trade", 1, [leg("a", T, "5"), leg("b", "5", T)]), tx("trade", 2, [leg("c", T, "5"), leg("d", "5", T)]), tx("trade", 3, [leg("e", T, "6"), leg("f", "6", T)])];
    const h = tradeHistory(txs, T, v, 0);
    expect(h.perTrade.map((x) => x.g)).toEqual([expect.closeTo(1.2, 12), expect.closeTo(-0.3, 12), expect.closeTo(-0.3, 12)]);
    expect(h.average).toBeCloseTo(0.2, 12);
    expect(h.hist).toBe(0.15);
    // On an even 1-for-1 that history lowers the estimate (three trades also make Team 2 active: a = +1).
    const p = partnerProfile({ teamId: T, transactions: txs, week: 4, values: v, W: 0, pPlayoffs: 0.4 });
    expect(p.activity.a).toBe(1);
    const beta = config.acceptance.beta;
    expect(acceptance(REDRAFT, p, trade()).pAccept).toBeCloseTo(logistic(beta.b0 + beta.activity - beta.history * 0.15), 12);
  });

  it("a trade where P gave nothing of value (g = +∞) makes the average +∞, which clamps to +0.15", () => {
    const v = { zero: 0, star: 4000, a: 6000, b: 3000 };
    const free = tx("trade", 2, [leg("zero", T, "5"), leg("star", "5", T)]);
    const loss = tx("trade", 3, [leg("a", T, "6"), leg("b", "6", T)]); // −0.5
    const h = tradeHistory([free, loss], T, v, 0);
    expect(h.perTrade.map((x) => x.g)).toStrictEqual([Number.POSITIVE_INFINITY, -0.5]);
    expect(h.average).toBe(Number.POSITIVE_INFINITY);
    expect(h.hist).toBe(0.15);
    expect(acceptanceFeatures(REDRAFT, partnerProfile({ teamId: T, transactions: [free, loss], week: 4, values: v, W: 0, pPlayoffs: 0.4 }), trade()).features.hist).toBe(0.15);
  });

  it("uses §9's package values: the side receiving fewer players gets the waiver credit", () => {
    const t = tx("trade", 2, [leg("a", T, "5"), leg("b", "5", T), leg("c", "5", T)]); // gets 5000 + 1000, gives 6000 + one spot
    const h = tradeHistory([t], T, values, W);
    expect(h.perTrade[0]?.g).toBeCloseTo(marketGain(["b", "c"], ["a"], values, W), 12);
    expect(h.perTrade[0]?.g).toBeCloseTo((6000 - 6400) / 6400, 12);
  });

  it("is null without completed trades; adds, drops and other teams' trades don't count", () => {
    const h = tradeHistory([add(T, 2), tx("trade", 3, [leg("a", "5", "6"), leg("b", "6", "5")])], T, values, W);
    expect(h).toStrictEqual({ hist: null, average: null, trades: 0, used: 0, skipped: 0, perTrade: [] });
  });

  it("leaves out trades it can't value: no players, one side missing, a player without a value", () => {
    const hidden = tx("trade", 2, [], { teams: [T, "5"] }); // ESPN hid the players
    const oneSided = tx("trade", 3, [leg("b", "5", T)]); // a refilled trade whose other side was since dropped
    const unvalued = tx("trade", 4, [leg("a", T, "5"), leg("zz", "5", T)]);
    const h = tradeHistory([hidden, oneSided, unvalued], T, values, W);
    expect(h).toMatchObject({ hist: null, trades: 3, used: 0, skipped: 3 });
  });

  it("ignores drops riding along with a trade, and uses refilled ESPN trades", () => {
    const t = tx("trade", 5, [leg("e", T, "5"), leg("f", "5", T), { playerId: "c", from: T, to: null }], { refilled: true });
    expect(tradeHistory([t], T, values, W)).toMatchObject({ hist: 0, used: 1 });
  });

  it("values picks only when the caller can (2-team trades): the pick takes no roster spot", () => {
    const pick: DraftPick = { season: 2027, round: 1, originalTeamId: "5", ownerTeamId: T };
    const t = tx("trade", 6, [leg("a", T, "5")], { teams: [T, "5"], picks: [pick] });
    expect(tradeHistory([t], T, values, W)).toMatchObject({ hist: null, skipped: 1 });
    const h = tradeHistory([t], T, values, W, { pickValue: () => 5500 });
    // Receives the pick (5500) plus the credit for the open spot (400); gives 6000.
    expect(h.perTrade[0]?.g).toBeCloseTo((5900 - 6000) / 6000, 12);
    // The other side of the same trade gave the pick.
    expect(tradeHistory([t], "5", values, W, { pickValue: () => 5500 }).perTrade[0]?.g).toBeCloseTo((6000 - 5900) / 5900, 12);
    // A three-team trade with picks: who gave the pick is unknown.
    const threeWay = tx("trade", 6, [leg("a", T, "5"), leg("b", "6", T)], { teams: [T, "5", "6"], picks: [pick] });
    expect(tradeHistory([threeWay], T, values, W, { pickValue: () => 5500 })).toMatchObject({ skipped: 1 });
    expect(tradeHistory([t], T, values, W, { pickValue: () => null })).toMatchObject({ skipped: 1 });
  });

  it("partnerProfile wraps activity, history and P(playoffs)", () => {
    const txs = [tx("trade", 2, [leg("e", T, "5"), leg("f", "5", T)]), add(T, 8)];
    const p = partnerProfile({ teamId: T, transactions: txs, week: 9, values, W, pPlayoffs: Number.NaN });
    expect(p.activity).toMatchObject({ a: 0, trades: 1 });
    expect(p.history).toMatchObject({ hist: 0, used: 1 });
    expect(p.pPlayoffs).toBeNull();
  });
});

describe("ctx: season context", () => {
  const receives = [
    { pos: "RB" as const, age: 28 },
    { pos: "WR" as const, age: 31 },
    { pos: "WR" as const, age: 27 },
    { pos: "TE" as const, age: 32 },
    { pos: "RB" as const },
  ];

  it("redraft and keeper: a partner below 5% has checked out (−0.8); exactly 5% hasn't", () => {
    expect(contextTerm({ leagueType: "redraft", pPlayoffs: 0.04, partnerReceives: [], n: 0 })).toStrictEqual({ ctx: -0.8, checkedOut: true, agingPlayers: 0, contender: false });
    expect(contextTerm({ leagueType: "keeper", pPlayoffs: 0.01, partnerReceives: [], n: 0 }).ctx).toBe(-0.8);
    expect(contextTerm({ leagueType: "redraft", pPlayoffs: 0.05, partnerReceives: [], n: 0 }).ctx).toBe(0);
  });

  it("dynasty: a rebuilding partner (below 25%) docks 0.25 per RB or WR aged 28+ it receives; never 'checked out'", () => {
    const r = contextTerm({ leagueType: "dynasty", pPlayoffs: 0.01, partnerReceives: receives, n: 0 });
    expect(r).toStrictEqual({ ctx: -0.5, checkedOut: false, agingPlayers: 2, contender: false });
    expect(contextTerm({ leagueType: "dynasty", pPlayoffs: 0.25, partnerReceives: receives, n: 0 }).ctx).toBe(0);
    // Redraft leagues don't use ages.
    expect(contextTerm({ leagueType: "redraft", pPlayoffs: 0.2, partnerReceives: receives, n: 0 }).ctx).toBe(0);
  });

  it("any league: a contender (above 60%) counts n 1.3 times, either sign; exactly 60% isn't one", () => {
    const need = config.acceptance.beta.need;
    expect(contextTerm({ leagueType: "redraft", pPlayoffs: 0.61, partnerReceives: [], n: 0.5 }).ctx).toBeCloseTo(need * 0.5 * 0.3, 12);
    expect(contextTerm({ leagueType: "dynasty", pPlayoffs: 0.9, partnerReceives: receives, n: -1 }).ctx).toBeCloseTo(need * -1 * 0.3, 12);
    expect(contextTerm({ leagueType: "redraft", pPlayoffs: 0.6, partnerReceives: [], n: 0.5 })).toMatchObject({ ctx: 0, contender: false });
  });

  it("no simulation (P(playoffs) unknown): no context", () => {
    expect(contextTerm({ leagueType: "redraft", pPlayoffs: null, partnerReceives: receives, n: 2 })).toStrictEqual({ ctx: 0, checkedOut: false, agingPlayers: 0, contender: false });
  });

  it("feeds z: a checked-out redraft partner's estimate drops", () => {
    const out = acceptance(REDRAFT, profile({ pPlayoffs: 0.02 }), trade());
    expect(out.features.ctx).toBe(-0.8);
    expect(out.pAccept).toBeCloseTo(logistic(config.acceptance.beta.b0 - 0.8), 12);
  });
});

describe("hot: recency", () => {
  const inputs = (sleeper: Record<number, number | null>, actual: Record<number, number>, espn?: Record<number, number | null>): PlayerInputs => ({ sleeper, actual, ...(espn ? { espn } : {}) });

  it("the last 2 completed weeks, latest first; none until two have been played", () => {
    expect(hotWeeks(4)).toStrictEqual([3, 2]);
    expect(hotWeeks(3)).toStrictEqual([2, 1]);
    expect(hotWeeks(2)).toStrictEqual([]);
    expect(hotWeeks(1)).toStrictEqual([]);
  });

  it("hot = at least 1.5× his projection in each of those weeks (exactly 1.5× counts)", () => {
    const weeks = hotWeeks(4);
    expect(isHot(inputs({ 2: 10, 3: 8 }, { 2: 15, 3: 12 }), weeks)).toBe(true);
    expect(isHot(inputs({ 2: 10, 3: 8 }, { 2: 14.9, 3: 12 }), weeks)).toBe(false);
    expect(isHot(inputs({ 2: 10, 3: 8 }, { 2: 30 }), weeks)).toBe(false); // week 3: a bye or didn't play
    expect(isHot(inputs({ 2: 10, 3: null }, { 2: 30, 3: 30 }), weeks)).toBe(false); // no projection week 3
    expect(isHot(inputs({ 2: 10, 3: null }, { 2: 30, 3: 30 }, { 3: 8 }), weeks)).toBe(true); // ESPN's projection stands in
    expect(isHot(undefined, weeks)).toBe(false);
    expect(isHot(inputs({ 2: 10, 3: 8 }, { 2: 15, 3: 12 }), [])).toBe(false);
    expect(isHot(inputs({ 2: 10, 3: 8 }, { 2: 15, 3: 12 }), [3])).toBe(false); // fewer weeks than the rule needs
  });

  it("past projections: Sleeper's when positive, else ESPN's, else none", () => {
    expect(pastProjection({ sleeper: { 3: 12 }, espn: { 3: 9 } }, 3)).toBe(12);
    expect(pastProjection({ sleeper: { 3: 0 }, espn: { 3: 9 } }, 3)).toBe(9);
    expect(pastProjection({ sleeper: {}, espn: { 3: null } }, 3)).toBeNull();
  });

  it("+0.15 when the partner receives a hot player, −0.15 when it gives one up, 0 for both", () => {
    const players: Record<string, PlayerInputs> = {
      hotOne: inputs({ 2: 10, 3: 10 }, { 2: 20, 3: 25 }),
      coldOne: inputs({ 2: 10, 3: 10 }, { 2: 9, 3: 25 }),
    };
    const hot = hotPlayers(players, hotWeeks(4));
    expect([...hot]).toStrictEqual(["hotOne"]);
    expect(hotTerm(["hotOne"], ["coldOne"], hot)).toBe(0.15);
    expect(hotTerm(["coldOne"], ["hotOne"], hot)).toBe(-0.15);
    expect(hotTerm(["hotOne"], ["hotOne"], hot)).toBe(0);
    expect(hotTerm([], [], hot)).toBe(0);
    expect(hotPlayers(players, [])).toStrictEqual(new Set());
  });
});

describe("urg: the trade deadline", () => {
  const deadline = { date: "2026-12-02T17:00:00.000Z", week: 13 };
  const at = Date.parse(deadline.date);
  const DAY = 86_400_000;

  it("+0.2 from 7 days before the deadline through the deadline, when its date is known", () => {
    expect(urgencyTerm(deadline, new Date(at - 7 * DAY), 12)).toBe(0.2);
    expect(urgencyTerm(deadline, new Date(at), 13)).toBe(0.2);
    expect(urgencyTerm(deadline, new Date(at - 7 * DAY - 1), 12)).toBe(0);
    expect(urgencyTerm(deadline, new Date(at + 1), 13)).toBe(0);
    expect(urgencyTerm(deadline, new Date("2026-09-30T20:00:00.000Z"), 4)).toBe(0);
  });

  it("with only a week: the deadline week and the week before", () => {
    const now = new Date("2026-11-20T00:00:00.000Z");
    expect(urgencyTerm({ week: 13 }, now, 12)).toBe(0.2);
    expect(urgencyTerm({ week: 13 }, now, 13)).toBe(0.2);
    expect(urgencyTerm({ week: 13 }, now, 11)).toBe(0);
    expect(urgencyTerm({ week: 13 }, now, 14)).toBe(0);
    // An unreadable date falls back to the week.
    expect(urgencyTerm({ date: "not a date", week: 13 }, now, 12)).toBe(0.2);
    expect(urgencyTerm(null, now, 12)).toBe(0);
    expect(urgencyTerm({}, now, 12)).toBe(0);
  });

  it("tradeDeadlinePassed: after the date, else past the week (Sleeper: trades complete through league week D)", () => {
    expect(tradeDeadlinePassed(deadline, new Date(at + 1), 13)).toBe(true);
    expect(tradeDeadlinePassed(deadline, new Date(at), 13)).toBe(false);
    expect(tradeDeadlinePassed({ week: 13 }, new Date(at), 13)).toBe(false);
    expect(tradeDeadlinePassed({ week: 13 }, new Date(at), 14)).toBe(true);
    expect(tradeDeadlinePassed(null, new Date(at), 20)).toBe(false);
  });
});

describe("display and labels (§11: 'Est.', the nearest 5%)", () => {
  it("rounds to the nearest 5%, half up, never down to 0% for a positive estimate", () => {
    expect(displayAcceptance(0.354)).toBe(0.35);
    expect(displayAcceptance(0.149)).toBe(0.15);
    expect(displayAcceptance(0.124)).toBe(0.1);
    expect(displayAcceptance(0.125)).toBe(0.15);
    expect(displayAcceptance(0.175)).toBe(0.2);
    expect(displayAcceptance(0.02)).toBe(0.05);
    expect(displayAcceptance(0.95)).toBe(0.95);
    expect(displayAcceptance(0.611)).toBe(0.6);
    expect(displayAcceptance(0)).toBe(0);
    expect(displayAcceptance(Number.NaN)).toBe(0);
  });

  it("labels follow §11's table, judged on the shown value", () => {
    expect(acceptanceLabel(0.1)).toBe("Long shot");
    expect(acceptanceLabel(0.124)).toBe("Long shot");
    expect(acceptanceLabel(0.149)).toBe("Possible"); // shown as 15%
    expect(acceptanceLabel(0.3)).toBe("Possible");
    expect(acceptanceLabel(0.35)).toBe("Decent");
    expect(acceptanceLabel(0.5249)).toBe("Decent");
    expect(acceptanceLabel(0.525)).toBe("Likely"); // shown as 55%
    expect(acceptanceLabel(0.95)).toBe("Likely");
    expect(acceptanceLabel(0.02)).toBe("Long shot");
  });

  it("the result carries the label of P_accept and the shown values", () => {
    const r = acceptance(REDRAFT, profile(), trade());
    expect(r.label).toBe("Decent");
    expect(r.shown).toStrictEqual({ accept: 0.35, complete: 0.35 });
  });
});
