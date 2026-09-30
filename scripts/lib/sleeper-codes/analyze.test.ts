import { describe, expect, it } from "vitest";
import {
  advancement,
  classifyRoundPattern,
  codeLike,
  crossTab,
  divisionWinnersFirst,
  gamesCheck,
  groupsInPlayers,
  median,
  nameKeywords,
  optimalLineupShare,
  pointsOrder,
  positionLimitChecks,
  predictBracket,
  recordOrder,
  rosterGroupsOf,
  roundWeeks,
  seedRuleEvidence,
  seedingFits,
  spearman,
  standardByes,
  standingsFromRosters,
  summarizeBracket,
  tally,
  toWeekScores,
  topSeedRound2,
  waiverVsStandings,
  weekPairs,
  type BracketMatch,
  type MatchupLite,
  type Standing,
} from "./analyze";

/** Six-team bracket shaped like Sleeper's (seeds = roster ids here): byes for 1 and 2. */
const SIX: BracketMatch[] = [
  { r: 1, m: 1, t1: 3, t2: 6, w: 6, l: 3 },
  { r: 1, m: 2, t1: 4, t2: 5, w: 4, l: 5 },
  { r: 2, m: 3, t1: 1, t2: 4, w: 1, l: 4, t2_from: { w: 2 } },
  { r: 2, m: 4, t1: 2, t2: 6, w: 6, l: 2, t2_from: { w: 1 } },
  { r: 2, m: 5, t1: 3, t2: 5, w: 5, l: 3, t1_from: { l: 1 }, t2_from: { l: 2 }, p: 5 },
  { r: 3, m: 6, t1: 1, t2: 6, w: 1, l: 6, t1_from: { w: 3 }, t2_from: { w: 4 }, p: 1 },
  { r: 3, m: 7, t1: 4, t2: 2, w: 2, l: 4, t1_from: { l: 3 }, t2_from: { l: 4 }, p: 3 },
];

function week(pairs: Array<[number, number, number, number]>): MatchupLite[] {
  // [rosterA, rosterB, pointsA, pointsB]
  return pairs.flatMap(([a, b, pa, pb], i) => [
    { roster_id: a, matchup_id: i + 1, points: pa },
    { roster_id: b, matchup_id: i + 1, points: pb },
  ]);
}

function standing(rosterId: number, wins: number, losses: number, fpts: number, extra: Partial<Standing> = {}): Standing {
  return { rosterId, wins, losses, ties: 0, fpts, reserve: 0, taxi: 0, players: 15, ...extra };
}

describe("tally / crossTab / median", () => {
  it("counts values with absent and numeric ordering", () => {
    expect(tally([2, 0, 10, 0, undefined, null])).toEqual({ "0": 2, "2": 1, "10": 1, absent: 2 });
    expect(Object.keys(tally([10, 2, 1]))).toEqual(["1", "2", "10"]);
  });
  it("cross-tabulates", () => {
    const rows = [
      { t: 0, x: 1 },
      { t: 0, x: 0 },
      { t: 2, x: 1 },
    ];
    expect(crossTab(rows, (r) => r.t, (r) => r.x)).toEqual({ "0": { "0": 1, "1": 1 }, "2": { "1": 1 } });
  });
  it("takes medians", () => {
    expect(median([])).toBeUndefined();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("brackets", () => {
  it("summarizes teams, byes, round-1 pairs and placements", () => {
    const s = summarizeBracket(SIX);
    expect(s.teams).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.byes).toEqual([1, 2]);
    expect(s.round1Pairs).toEqual(["3-6", "4-5"]);
    expect(s.placements).toEqual([1, 3, 5]);
    expect(s.rounds).toBe(3);
    expect(s.complete).toBe(true);
    expect(s.fromLinks).toEqual({ w: 4, l: 4 });
  });

  it("predicts standard seeding and checks the fit", () => {
    expect(predictBracket([1, 2, 3, 4, 5, 6, 7], 6)).toEqual({ teams: [1, 2, 3, 4, 5, 6], byes: [1, 2], round1Pairs: ["3-6", "4-5"] });
    expect(predictBracket([1, 2, 3, 4], 4)?.round1Pairs).toEqual(["1-4", "2-3"]);
    expect(predictBracket([1, 2, 3, 4, 5, 6, 7, 8], 8)?.byes).toEqual([]);
    expect(predictBracket([1, 2], 3)).toBeUndefined();
    const s = summarizeBracket(SIX);
    expect(seedingFits(s, [1, 2, 3, 4, 5, 6, 7, 8], 6)).toBe(true);
    expect(seedingFits(s, [2, 1, 4, 3, 5, 6, 7, 8], 6)).toBe(false);
  });

  it("reports the top seed's round-2 opponent against re-seeding", () => {
    // 6 upset 3, so a re-seeded bracket gives seed 1 the 6 seed; this bracket gave it the 4v5 winner.
    const t = topSeedRound2(SIX, [1, 2, 3, 4, 5, 6], 6);
    expect(t).toEqual({ opponentSeed: 4, lowestRemainingSeed: 6, fixedOpponentSeed: 4, fromGame: "4v5" });
    expect(t && seedRuleEvidence(t)).toBe("fixed");
    // No bye for the top seed → no round-2 evidence.
    expect(topSeedRound2(SIX, [1, 2, 3, 4, 5, 6, 7, 8], 8)).toBeUndefined();
  });

  it("tells re-seeding from a fixed bracket only when a lower seed won round 1", () => {
    const reseeded: BracketMatch[] = SIX.map((m) => (m.m === 3 ? { ...m, t2: 6, w: 1, l: 6 } : m.m === 4 ? { ...m, t2: 4, w: 2, l: 4 } : m));
    const t = topSeedRound2(reseeded, [1, 2, 3, 4, 5, 6], 6);
    expect(t?.opponentSeed).toBe(6);
    expect(t && seedRuleEvidence(t)).toBe("reseed");
    // Favourites win round 1: both rules give seed 1 the 4 seed, so the bracket says nothing.
    const chalk: BracketMatch[] = SIX.map((m) => (m.m === 1 ? { ...m, w: 3, l: 6 } : m));
    const c = topSeedRound2(chalk, [1, 2, 3, 4, 5, 6], 6);
    expect(c && seedRuleEvidence(c)).toBe("same");
  });

  it("counts standard byes", () => {
    expect([4, 6, 7, 8, 12].map(standardByes)).toEqual([0, 2, 1, 0, 4]);
  });
});

describe("position limits", () => {
  const pos: Record<string, string> = { q1: "QB", q2: "QB", q3: "QB", q4: "QB", r1: "RB", r2: "RB" };
  const positionOf = (id: string) => pos[id];

  it("counts the active roster apart from IR and taxi", () => {
    // Roster A: 3 active QBs + 1 QB on IR (players[] lists IR players too); roster B: 2 QBs.
    const rosters = [
      { players: ["q1", "q2", "q3", "q4", "r1"], reserve: ["q4"], taxi: [] },
      { players: ["q1", "q2", "r2"], reserve: [], taxi: [] },
    ];
    const [qb] = positionLimitChecks({ position_limit_qb: 3, type: 0 }, rosters, positionOf);
    expect(qb).toEqual({ pos: "QB", limit: 3, maxAll: 4, maxActive: 3, atLimitActive: true, exceededActive: false, overOnlyViaReserve: 1, overOnlyViaTaxi: 0 });
    const [strict] = positionLimitChecks({ position_limit_qb: 2 }, rosters, positionOf);
    expect(strict?.exceededActive).toBe(true);
    expect(groupsInPlayers(rosters)).toEqual({ reserve: 1, reserveInPlayers: 1, taxi: 0, taxiInPlayers: 0 });
  });

  it("copies roster ID lists", () => {
    expect(rosterGroupsOf([{ roster_id: 1, players: ["a", "b"], reserve: ["b"], taxi: null }])).toEqual([{ players: ["a", "b"], reserve: ["b"], taxi: [] }]);
  });
});

describe("matchups and round weeks", () => {
  const w15 = week([
    [3, 6, 90, 100],
    [4, 5, 110, 80],
  ]);
  const w16 = week([
    [1, 4, 120, 100],
    [2, 6, 90, 95],
  ]);
  const w17 = week([[1, 6, 130, 110]]);
  const w18 = week([[1, 6, 100, 90]]);

  it("finds pairs in a week", () => {
    const scores = toWeekScores(new Map([[15, w15]]));
    expect([...weekPairs(scores.get(15) ?? new Map())].sort()).toEqual(["3-6", "4-5"]);
  });

  it("classifies one-week rounds and a two-week final", () => {
    const one = toWeekScores(
      new Map([
        [15, w15],
        [16, w16],
        [17, w17],
      ]),
    );
    const rwOne = roundWeeks(SIX, one);
    expect(rwOne.map((x) => x.weeks)).toEqual([[15], [16], [17]]);
    expect(classifyRoundPattern(rwOne)).toBe("1-week rounds");
    const twoFinal = toWeekScores(
      new Map([
        [15, w15],
        [16, w16],
        [17, w17],
        [18, w18],
      ]),
    );
    expect(classifyRoundPattern(roundWeeks(SIX, twoFinal))).toBe("2-week final");
  });

  it("classifies two-week rounds", () => {
    const two = toWeekScores(
      new Map([
        [13, w15],
        [14, w15],
        [15, w16],
        [16, w16],
        [17, w17],
        [18, w18],
      ]),
    );
    expect(classifyRoundPattern(roundWeeks(SIX, two))).toBe("2-week rounds");
    expect(classifyRoundPattern([])).toBe("unclear");
    expect(classifyRoundPattern([{ round: 1, weeks: [15, 17] }])).toBe("unclear");
    expect(classifyRoundPattern([{ round: 1, weeks: [17] }])).toBe("single round");
  });

  it("tells whether the bracket winner is the higher or lower scorer", () => {
    const scores = toWeekScores(
      new Map([
        [15, w15],
        [16, w16],
        [17, w17],
      ]),
    );
    // In SIX every recorded winner outscored the opponent in the week they met.
    expect(advancement(SIX, scores)).toEqual({ higherScorer: 7 - 2, lowerScorer: 0, unknown: 2 });
    // A toilet bowl: the recorded "winner" is the lower scorer.
    const toilet: BracketMatch[] = [{ r: 1, m: 1, t1: 3, t2: 6, w: 3, l: 6 }];
    expect(advancement(toilet, scores)).toEqual({ higherScorer: 0, lowerScorer: 1, unknown: 0 });
  });
});

describe("standings", () => {
  it("parses rosters with decimal points", () => {
    const [s] = standingsFromRosters([
      {
        roster_id: 7,
        settings: { wins: 9, losses: 5, ties: 0, fpts: 1500, fpts_decimal: 25, ppts: 1700, ppts_decimal: 5, division: 2, waiver_position: 3, waiver_budget_used: 42 },
        reserve: ["1"],
        taxi: null,
        players: ["1", "2"],
        metadata: { record: "WWLWLWWLWWLWWL" },
      },
    ]);
    expect(s).toEqual({ rosterId: 7, wins: 9, losses: 5, ties: 0, fpts: 1500.25, ppts: 1700.05, division: 2, waiverPosition: 3, waiverBudgetUsed: 42, reserve: 1, taxi: 0, players: 2, recordLength: 14 });
  });

  it("orders seeds by record then points, by points, and division winners first", () => {
    const st = [standing(1, 8, 6, 1400, { division: 1 }), standing(2, 10, 4, 1300, { division: 1 }), standing(3, 8, 6, 1500, { division: 2 }), standing(4, 5, 9, 1600, { division: 2 })];
    expect(recordOrder(st)).toEqual([2, 3, 1, 4]);
    expect(pointsOrder(st)).toEqual([4, 3, 1, 2]);
    expect(divisionWinnersFirst(st)).toEqual([2, 3, 1, 4]);
    expect(divisionWinnersFirst(st.map((s) => ({ ...s, division: undefined })))).toBeUndefined();
  });

  it("checks games played against regular-season weeks", () => {
    const st = [standing(1, 7, 7, 1), standing(2, 20, 8, 1), standing(3, 3, 3, 1)];
    expect(gamesCheck(st, 14)).toEqual({ teams: 3, once: 1, twice: 1, other: 1 });
  });

  it("finds optimal lineups (actual = potential points)", () => {
    const st = [standing(1, 1, 1, 100.5, { ppts: 100.5 }), standing(2, 1, 1, 90, { ppts: 99 }), standing(3, 1, 1, 90)];
    expect(optimalLineupShare(st)).toEqual({ teams: 3, withPotential: 2, optimal: 1 });
  });

  it("correlates waiver order with standings", () => {
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeUndefined();
    const reverse = [1, 2, 3, 4, 5].map((i) => standing(i, 10 - i, i, 1000, { waiverPosition: 6 - i }));
    expect(waiverVsStandings(reverse)).toBeCloseTo(-1);
  });
});

describe("names and codes", () => {
  it("flags keywords without keeping the name", () => {
    expect(nameKeywords("The Dynasty Keeper League")).toEqual(["dynasty", "keeper"]);
    expect(nameKeywords("Best Ball Mania")).toEqual(["bestBall"]);
    expect(nameKeywords(undefined)).toEqual([]);
  });
  it("only passes short code-like strings", () => {
    expect(codeLike("dynasty_ppr")).toBe("dynasty_ppr");
    expect(codeLike("My League")).toBeUndefined();
    expect(codeLike(3)).toBeUndefined();
  });
});
