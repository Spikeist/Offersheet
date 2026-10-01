import { describe, expect, it } from "vitest";
import { config } from "./config";
import { mulberry32, streamFor } from "./rng";
import {
  bracketGames,
  bracketOrder,
  SEASON_STREAM,
  simNormals,
  simulateSeason,
  standingsOrder,
  type SimGame,
  type SimNormals,
  type SimPlayedGame,
  type SimResult,
  type SimSetup,
  type SimTeam,
  type SimTiebreaker,
} from "./sim";

/** The tests' own seed: re-seeding config.simulation.seed must not move a statistical check. */
const SEED = 20_260_930;

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const sum = (xs: ArrayLike<number>): number => Array.from(xs).reduce((s, x) => s + x, 0);

function team(i: number, over: Partial<SimTeam> = {}): SimTeam {
  return { id: `team-${i + 1}`, w: 0, l: 0, t: 0, pointsFor: 0, pointsAgainst: 0, division: null, ...over };
}

type Fill = (team: number, week: number) => number;

/** A setup with defaults (no games, no playoffs, fixed bracket, points-for tiebreaker); means and SDs from functions. */
function makeSetup(over: Partial<SimSetup> & Pick<SimSetup, "teams" | "weeks">, mean: Fill = () => 100, sd: Fill = () => 0): SimSetup {
  return {
    mean: over.teams.map((_, t) => Float64Array.from(over.weeks, (w) => mean(t, w))),
    sd: over.teams.map((_, t) => Float64Array.from(over.weeks, (w) => sd(t, w))),
    games: [],
    medianWeeks: [],
    played: [],
    pointsOnly: false,
    playoffTeams: 0,
    byes: 0,
    rounds: [],
    reseed: false,
    divisionWinnersFirst: false,
    tiebreaker: "pointsFor",
    playoffResults: [],
    ...over,
  };
}

/** A round robin (circle method) over the given weeks, repeating the rounds when there are more weeks than rounds. */
function roundRobin(T: number, weeks: number[]): SimGame[] {
  const others = range(1, T - 1);
  return weeks.flatMap((week, r) => {
    const k = r % (T - 1);
    const row = [0, ...others.slice(k), ...others.slice(0, k)];
    return range(0, T / 2 - 1).map((i) => ({ weeks: [week], a: row[i] as number, b: row[T - 1 - i] as number }));
  });
}

/** Teams whose records seed them in index order: team i is seed i + 1 (the regular season is over). */
function seededTeams(T: number): SimTeam[] {
  return range(0, T - 1).map((i) => team(i, { w: 20 - i, l: i, pointsFor: 2000 - 10 * i }));
}

/** Deterministic weekly scores: table[week][team], 0 when missing. */
const scores =
  (table: Record<number, Record<number, number>>): Fill =>
  (t, w) =>
    table[w]?.[t] ?? 0;

/** Seed order (team indexes, seed 1 first) when every sim gives the same standings. */
function fixedOrder(res: SimResult): number[] {
  const T = res.teams.length;
  return range(0, T - 1).map((k) => {
    const t = res.teams.findIndex((o) => o.seedDist[k] === 1);
    expect(t, `seed ${k + 1} isn't the same team in every sim`).toBeGreaterThanOrEqual(0);
    return t;
  });
}

const run = (setup: SimSetup, sims = 1, seed = SEED): SimResult => simulateSeason(setup, { sims, seed });
const titles = (res: SimResult): number[] => res.teams.map((o) => o.pTitle);

/** Parker-sized: 10 teams, regular weeks 4–14 (a round robin), playoffs 15–17 (6 teams, 2 byes), means 95–130, SDs 20–30. */
function parkerSized(over: Partial<SimSetup> = {}): SimSetup {
  const T = 10;
  const regular = range(4, 14);
  const rand = mulberry32(99);
  const base = range(0, T - 1).map(() => 95 + 35 * rand());
  const teams = range(0, T - 1).map((i) => team(i, { w: Math.floor(4 * rand()), l: 0, pointsFor: 300 + 100 * rand(), division: i % 2 }));
  teams.forEach((tm) => (tm.l = 3 - tm.w));
  return makeSetup(
    {
      teams,
      weeks: range(4, 17),
      games: roundRobin(T, regular),
      playoffTeams: 6,
      byes: 2,
      rounds: [{ weeks: [15] }, { weeks: [16] }, { weeks: [17] }],
      ...over,
    },
    (t, w) => (base[t] as number) * (w === 13 && t === 2 ? 0.8 : 1),
    (t) => 20 + t,
  );
}

describe("simNormals: the common-random-numbers matrix (CLAUDE.md §8)", () => {
  it("sim n is Box–Muller over streamFor(seed, 'season', n): u1 for the radius, u2 for the angle, cosine then sine, week-major then team", () => {
    const W = 3;
    const T = 4;
    const { z, sims, weeks, teams } = simNormals(SEED, 9, W, T);
    expect([sims, weeks, teams, z.length]).toEqual([9, W, T, 9 * W * T]);
    for (const n of [0, 1, 8]) {
      const rand = streamFor(SEED, SEASON_STREAM, n);
      const expected: number[] = [];
      while (expected.length < W * T) {
        const radius = Math.sqrt(-2 * Math.log(1 - rand()));
        const angle = 2 * Math.PI * rand();
        expected.push(radius * Math.cos(angle), radius * Math.sin(angle));
      }
      expect(Array.from(z.subarray(n * W * T, (n + 1) * W * T)), `sim ${n}`).toEqual(expected);
    }
  });

  it("an odd count per sim drops the last sine, and the next sim starts its own stream", () => {
    const { z } = simNormals(SEED, 2, 1, 3);
    for (const n of [0, 1]) {
      const rand = streamFor(SEED, SEASON_STREAM, n);
      const r1 = Math.sqrt(-2 * Math.log(1 - rand()));
      const a1 = 2 * Math.PI * rand();
      const r2 = Math.sqrt(-2 * Math.log(1 - rand()));
      const a2 = 2 * Math.PI * rand();
      expect(Array.from(z.subarray(3 * n, 3 * n + 3))).toEqual([r1 * Math.cos(a1), r1 * Math.sin(a1), r2 * Math.cos(a2)]);
    }
  });

  it("the first k sims of an n-sim matrix are the k-sim matrix (a screening run reads the final run's prefix)", () => {
    const big = simNormals(SEED, 50, 14, 10);
    const small = simNormals(SEED, 20, 14, 10);
    expect(Array.from(big.z.subarray(0, small.z.length))).toEqual(Array.from(small.z));
    expect(Array.from(simNormals(SEED + 1, 20, 14, 10).z)).not.toEqual(Array.from(small.z));
  });

  it("draws standard normals: mean ≈ 0, variance ≈ 1, no correlation between neighbors or sims", () => {
    const { z } = simNormals(SEED, 4000, 10, 10); // 400,000 draws
    const n = z.length;
    const mean = sum(z) / n;
    const variance = z.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
    expect(Math.abs(mean)).toBeLessThan(0.01); // SD of the mean ≈ 0.0016
    expect(Math.abs(variance - 1)).toBeLessThan(0.01); // SD ≈ 0.0022
    const within4 = z.filter((x) => Math.abs(x) < 4).length / n;
    expect(within4).toBeGreaterThan(0.9998); // P(|Z| ≥ 4) ≈ 0.00006
    let neighbor = 0; // z[k]·z[k+1]: the pair's cosine and sine, and the pairs' boundaries
    let acrossSims = 0; // the same cell of consecutive sims
    for (let k = 0; k + 1 < n; k++) neighbor += (z[k] as number) * (z[k + 1] as number);
    for (let k = 0; k + 100 < n; k++) acrossSims += (z[k] as number) * (z[k + 100] as number);
    expect(Math.abs(neighbor / n)).toBeLessThan(0.01);
    expect(Math.abs(acrossSims / n)).toBeLessThan(0.01);
  });

  it("rejects negative or fractional sizes", () => {
    expect(() => simNormals(SEED, -1, 2, 2)).toThrow(RangeError);
    expect(() => simNormals(SEED, 2, 1.5, 2)).toThrow(RangeError);
  });
});

describe("bracketOrder: the standard single-elimination seeding", () => {
  it("pairs 1–B, then keeps the halves apart", () => {
    expect(bracketOrder(1)).toEqual([1]);
    expect(bracketOrder(2)).toEqual([1, 2]);
    expect(bracketOrder(4)).toEqual([1, 4, 2, 3]);
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(bracketOrder(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
  });
});

describe("simulateSeason: sanity (CLAUDE.md §16)", () => {
  it("every sim crowns exactly one champion, sends exactly playoffTeams teams and gives exactly `byes` byes", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const res = run(parkerSized(), 1, seed);
      expect(sum(titles(res)), `seed ${seed}`).toBe(1);
      expect(sum(res.teams.map((o) => o.pPlayoffs))).toBe(6);
      expect(sum(res.teams.map((o) => o.pBye))).toBe(2);
      expect(res.teams.every((o) => [0, 1].includes(o.pTitle))).toBe(true);
    }
    const res = run(parkerSized(), 3000);
    expect(sum(titles(res))).toBeCloseTo(1, 12);
    expect(sum(res.teams.map((o) => o.pPlayoffs))).toBeCloseTo(6, 12);
    expect(sum(res.teams.map((o) => o.pBye))).toBeCloseTo(2, 12);
    // Every team takes exactly one seed and every seed exactly one team.
    for (const o of res.teams) expect(sum(o.seedDist)).toBeCloseTo(1, 12);
    for (let k = 0; k < 10; k++) expect(sum(res.teams.map((o) => o.seedDist[k] as number))).toBeCloseTo(1, 12);
    // P(playoffs) and P(bye) are the seed distribution's top 6 and top 2.
    for (const o of res.teams) {
      expect(o.pPlayoffs).toBeCloseTo(sum(o.seedDist.slice(0, 6)), 12);
      expect(o.pBye).toBeCloseTo(sum(o.seedDist.slice(0, 2)), 12);
      expect(o.pTitle).toBeLessThanOrEqual(o.pPlayoffs);
    }
    expect(res.playoffsKnown).toBe(true);
    expect(res.sims).toBe(3000);
  });

  it("no-op check: identical inputs give identical results, bit for bit (a trade that changes nothing moves no odds)", () => {
    const before = parkerSized();
    const copy: SimSetup = { ...before, teams: before.teams.map((t) => ({ ...t })), mean: before.mean.map((m) => Float64Array.from(m)), sd: before.sd.map((s) => Float64Array.from(s)), games: before.games.map((g) => ({ ...g, weeks: [...g.weeks] })) };
    const normals = simNormals(config.simulation.seed, 1000, before.weeks.length, before.teams.length);
    const a = simulateSeason(before, { sims: 1000, seed: config.simulation.seed, normals });
    const b = simulateSeason(copy, { sims: 1000, seed: config.simulation.seed, normals });
    expect(b).toEqual(a);
    // Drawing the matrix inside gives the same numbers as passing it.
    expect(simulateSeason(before, { sims: 1000, seed: config.simulation.seed })).toEqual(a);
  });

  it("a screening run on the final run's matrix equals a run on its own smaller matrix (the CRN prefix property)", () => {
    const setup = parkerSized();
    const big = simNormals(SEED, 2000, setup.weeks.length, setup.teams.length);
    expect(simulateSeason(setup, { sims: 500, seed: SEED, normals: big })).toEqual(simulateSeason(setup, { sims: 500, seed: SEED }));
  });

  it("common random numbers: a better team never wins less, and its rivals never win more (sim by sim)", () => {
    const before = parkerSized({ medianWeeks: range(4, 14) });
    const after: SimSetup = { ...before, mean: before.mean.map((m, t) => (t === 3 ? m.map((x) => x + 8) : m)) };
    const normals = simNormals(SEED, 2000, before.weeks.length, before.teams.length);
    const a = simulateSeason(before, { sims: 2000, seed: SEED, normals });
    const b = simulateSeason(after, { sims: 2000, seed: SEED, normals });
    expect(b.teams[3]!.expWins).toBeGreaterThan(a.teams[3]!.expWins + 0.5);
    // By win % then points for, a team that only gains can't fall in any sim's standings.
    expect(b.teams[3]!.pPlayoffs).toBeGreaterThanOrEqual(a.teams[3]!.pPlayoffs);
    b.teams.forEach((o, t) => {
      if (t !== 3) expect(o.expWins, `team ${t}`).toBeLessThanOrEqual(a.teams[t]!.expWins);
    });
  });

  it("a dominant team wins the title almost always", () => {
    const T = 8;
    const setup = makeSetup(
      { teams: range(0, T - 1).map((i) => team(i)), weeks: range(5, 13), games: roundRobin(T, range(5, 11)), playoffTeams: 4, byes: 0, rounds: [{ weeks: [12] }, { weeks: [13] }] },
      (t) => (t === 0 ? 200 : 100),
      () => 20,
    );
    const res = run(setup, 2000);
    expect(res.teams[0]!.pTitle).toBeGreaterThan(0.99);
    expect(res.teams[0]!.pPlayoffs).toBe(1);
    expect(res.teams[0]!.expWins).toBeGreaterThan(6.99);
  });

  it("symmetric teams get symmetric odds", () => {
    const T = 8;
    const weeks = range(1, 14);
    const setup = makeSetup(
      { teams: range(0, T - 1).map((i) => team(i)), weeks: [...weeks, 15, 16], games: roundRobin(T, weeks), playoffTeams: 4, byes: 0, rounds: [{ weeks: [15] }, { weeks: [16] }] },
      () => 110,
      () => 25,
    );
    const res = run(setup, 4000);
    for (const o of res.teams) {
      expect(Math.abs(o.pPlayoffs - 0.5)).toBeLessThan(0.04); // SE ≈ 0.008
      expect(Math.abs(o.pTitle - 1 / 8)).toBeLessThan(0.03); // SE ≈ 0.005
      expect(Math.abs(o.expWins - 7)).toBeLessThan(0.15);
      expect(o.pBye).toBe(0);
    }
  });
});

describe("simulateSeason: regular season (CLAUDE.md §8)", () => {
  it("expected wins = current wins + game wins + median wins", () => {
    const teams = [team(0, { w: 2, l: 1, pointsFor: 300 }), team(1, { w: 1, l: 2 }), team(2, { w: 0, l: 3 }), team(3, { w: 3, l: 0 })];
    const setup = makeSetup(
      {
        teams,
        weeks: [5, 6],
        games: [
          { weeks: [5], a: 0, b: 1 },
          { weeks: [5], a: 2, b: 3 },
          { weeks: [6], a: 0, b: 2 },
          { weeks: [6], a: 1, b: 3 },
        ],
        medianWeeks: [5, 6],
      },
      (t) => 100 + 10 * t,
    );
    const res = run(setup);
    // Team 0 loses both games and both median games; team 3 wins all four; teams 2 and 3 are the top half.
    expect(res.teams.map((o) => o.expWins)).toEqual([2, 2, 3, 7]);
    expect(res.teams.map((o) => o.expLosses)).toEqual([5, 5, 4, 0]);
    expect(res.teams.map((o) => o.expTies)).toEqual([0, 0, 0, 0]);
    expect(res.weekly.map((wk) => wk.week)).toEqual([5, 6]);
    expect(Array.from(res.weekly[0]!.pWin)).toEqual([0, 1, 0, 1]);
    expect(Array.from(res.weekly[1]!.pWin)).toEqual([0, 0, 1, 1]);
    expect(Array.from(res.weekly[0]!.pMedianWin as Float64Array)).toEqual([0, 0, 1, 1]);
  });

  it("median games: the top ⌊N/2⌋ win, so with 5 teams the middle team loses; equal scores rank by team index", () => {
    const five = run(makeSetup({ teams: range(0, 4).map((i) => team(i)), weeks: [5], medianWeeks: [5] }, (t) => 100 + t));
    expect(five.teams.map((o) => o.expWins)).toEqual([0, 0, 0, 1, 1]);
    expect(five.teams.map((o) => o.expLosses)).toEqual([1, 1, 1, 0, 0]);
    // A median week without games is still listed: no game (NaN), a median game.
    expect(five.weekly.map((wk) => wk.week)).toEqual([5]);
    expect(Array.from(five.weekly[0]!.pWin).every(Number.isNaN)).toBe(true);
    expect(Array.from(five.weekly[0]!.pMedianWin as Float64Array)).toEqual([0, 0, 0, 1, 1]);
    const equal = run(makeSetup({ teams: range(0, 3).map((i) => team(i)), weeks: [5], medianWeeks: [5] }));
    expect(equal.teams.map((o) => o.expWins)).toEqual([1, 1, 0, 0]);
  });

  it("points for and against: each game adds the team's own score and the opponent's", () => {
    const setup = makeSetup({ teams: [team(0), team(1), team(2), team(3)], weeks: [5, 6], games: roundRobin(4, [5, 6]) }, (t, w) => 10 * t + w);
    // Week 5: 3 beats 0, 2 beats 1; week 6: 1 beats 0, 3 beats 2. By win % then PF: 3 (2–0), 2 (1–1, PF 51), 1 (1–1, PF 31), 0.
    expect(fixedOrder(run(setup))).toEqual([3, 2, 1, 0]);
    // Teams 0 and 1 both win with 100 points; team 1's opponent scored more, and more points against ranks higher.
    const pa = makeSetup(
      {
        teams: [team(0), team(1), team(2), team(3)],
        weeks: [5],
        games: [
          { weeks: [5], a: 0, b: 2 },
          { weeks: [5], a: 1, b: 3 },
        ],
      },
      scores({ 5: { 0: 100, 1: 100, 2: 50, 3: 60 } }),
    );
    expect(fixedOrder(run(pa))).toEqual([1, 0, 3, 2]);
  });

  it("exactly equal scores are a tie: a T for both, no win for either", () => {
    const res = run(makeSetup({ teams: [team(0), team(1)], weeks: [5], games: [{ weeks: [5], a: 0, b: 1 }] }));
    expect(res.teams.map((o) => [o.expWins, o.expLosses, o.expTies])).toEqual([
      [0, 0, 1],
      [0, 0, 1],
    ]);
    expect(Array.from(res.weekly[0]!.pWin)).toEqual([0, 0]);
  });

  it("a multi-week game sums its weeks and counts in its first week; a week that's over adds nothing", () => {
    const table = { 5: { 0: 30, 1: 20 }, 6: { 0: 0, 1: 20 } };
    const both = run(makeSetup({ teams: [team(0), team(1)], weeks: [5, 6], games: [{ weeks: [5, 6], a: 0, b: 1 }] }, scores(table)));
    expect(both.teams.map((o) => o.expWins)).toEqual([0, 1]); // 30 + 0 < 20 + 20
    expect(both.weekly.map((wk) => wk.week)).toEqual([5]);
    // Week 5 already played (not drawn): only week 6 decides, and the game is listed under week 6.
    const rest = run(makeSetup({ teams: [team(0), team(1)], weeks: [6], games: [{ weeks: [5, 6], a: 0, b: 1 }] }, scores(table)));
    expect(rest.teams.map((o) => o.expWins)).toEqual([0, 1]);
    expect(rest.weekly.map((wk) => wk.week)).toEqual([6]);
    // A remaining game none of whose weeks is drawn can't be decided. It throws rather than drop off both
    // teams' records (decided games belong in `played`).
    expect(() => run(makeSetup({ teams: [team(0), team(1)], weeks: [6], games: [{ weeks: [4], a: 0, b: 1 }] }, scores(table)))).toThrow(/no week in weeks/);
  });

  it("a bye game adds nothing, and its team's win chance that week is NaN", () => {
    const res = run(
      makeSetup({
        teams: [team(0), team(1), team(2)],
        weeks: [5],
        games: [
          { weeks: [5], a: 0, b: 1 },
          { weeks: [5], a: 2, b: null },
        ],
      }, (t) => 100 - t),
    );
    expect(res.teams.map((o) => o.expWins + o.expLosses + o.expTies)).toEqual([1, 1, 0]);
    const pWin = Array.from(res.weekly[0]!.pWin);
    expect(pWin.slice(0, 2)).toEqual([1, 0]);
    expect(pWin[2]).toBeNaN();
    expect(res.weekly[0]!.pMedianWin).toBeNull();
  });

  it("weekly win chances follow the score distributions (P(N(100,10) > N(90,10)) ≈ 0.760)", () => {
    const res = run(makeSetup({ teams: [team(0), team(1)], weeks: [5], games: [{ weeks: [5], a: 0, b: 1 }] }, (t) => (t === 0 ? 100 : 90), () => 10), 20_000);
    const [p0, p1] = Array.from(res.weekly[0]!.pWin) as [number, number];
    expect(Math.abs(p0 - 0.7602)).toBeLessThan(0.015); // SE ≈ 0.003
    expect(p0 + p1).toBeCloseTo(1, 12);
    expect(res.teams[0]!.expWins).toBeCloseTo(p0, 12);
  });

  it("points-only leagues: standings by points for alone, from every regular-season week (playoff weeks excluded); games add no W/L", () => {
    const teams = [team(0, { pointsFor: 300 }), team(1, { pointsFor: 320 }), team(2, { pointsFor: 310 }), team(3, { pointsFor: 290 })];
    const perWeek = [100, 80, 96, 120];
    const setup = makeSetup(
      { teams, weeks: [5, 6, 7], pointsOnly: true, games: [{ weeks: [5], a: 0, b: 1 }], medianWeeks: [5, 6], playoffTeams: 2, byes: 0, rounds: [{ weeks: [7] }] },
      (t, w) => (w === 7 ? (t === 1 ? 1000 : 0) : (perWeek[t] as number)),
    );
    const res = run(setup);
    // PF: 500, 480, 502, 530 (week 7 is the final, not PF).
    expect(fixedOrder(res)).toEqual([3, 2, 0, 1]);
    expect(res.teams.map((o) => o.expWins + o.expLosses + o.expTies)).toEqual([0, 0, 0, 0]);
    expect(res.teams.map((o) => o.pPlayoffs)).toEqual([0, 0, 1, 1]);
    // No median games in a points-only league; the game still reports who outscored whom.
    expect(res.weekly.map((wk) => wk.week)).toEqual([5]);
    expect(res.weekly[0]!.pMedianWin).toBeNull();
    expect(Array.from(res.weekly[0]!.pWin).slice(0, 2)).toEqual([1, 0]);
  });
});

describe("simulateSeason: seeding tiebreakers (CLAUDE.md §8; espn-api standings as the reference)", () => {
  /** Regular season over: standings from records and played games alone. */
  const standingsOf = (teams: SimTeam[], played: SimPlayedGame[], tiebreaker: SimTiebreaker, over: Partial<SimSetup> = {}): number[] =>
    fixedOrder(run(makeSetup({ teams, weeks: [], played, tiebreaker, ...over })));

  it("pointsFor: win %, then points for (head-to-head only after that); headToHead: win %, then head-to-head", () => {
    const teams = [team(0, { w: 8, l: 6, pointsFor: 1400 }), team(1, { w: 8, l: 6, pointsFor: 1500 }), team(2, { w: 5, l: 9, pointsFor: 1600 }), team(3, { w: 7, l: 7 })];
    const played: SimPlayedGame[] = [{ a: 0, b: 1, winner: 0 }];
    expect(standingsOf(teams, played, "pointsFor")).toEqual([1, 0, 3, 2]);
    expect(standingsOf(teams, played, "headToHead")).toEqual([0, 1, 3, 2]);
    // Win % counts a tie as half a win: 8–6 (.571) is below 8–5–1 (.607).
    const withTie = teams.map((t, i) => (i === 0 ? { ...t, l: 5, t: 1 } : t));
    expect(standingsOf(withTie, played, "pointsFor")).toEqual([0, 1, 3, 2]);
  });

  it("headToHead with three tied teams: used only when every pair met equally often, else skipped (points for decides)", () => {
    const teams = [team(0, { w: 7, l: 7, pointsFor: 1000 }), team(1, { w: 7, l: 7, pointsFor: 1100 }), team(2, { w: 7, l: 7, pointsFor: 1200 })];
    const equal: SimPlayedGame[] = [
      { a: 0, b: 1, winner: 0 },
      { a: 0, b: 2, winner: 0 },
      { a: 1, b: 2, winner: 1 },
    ];
    expect(standingsOf(teams, equal, "headToHead")).toEqual([0, 1, 2]);
    const unequal: SimPlayedGame[] = [
      { a: 0, b: 1, winner: 0 },
      { a: 0, b: 1, winner: 0 },
      { a: 1, b: 2, winner: 1 },
      { a: 2, b: 0, winner: 2 },
    ];
    expect(standingsOf(teams, unequal, "headToHead")).toEqual([2, 1, 0]);
  });

  it("a group still tied after head-to-head moves on to the next criterion, not back to head-to-head between the two", () => {
    // Every pair met twice. Group wins: team 2 has 3, teams 0 and 1 have 1.5 each, though team 0 got the better of team 1.
    const teams = [team(0, { w: 7, l: 7, pointsFor: 1000 }), team(1, { w: 7, l: 7, pointsFor: 1100 }), team(2, { w: 7, l: 7, pointsFor: 900 })];
    const played: SimPlayedGame[] = [
      { a: 0, b: 1, winner: 0 },
      { a: 0, b: 1, winner: null },
      { a: 0, b: 2, winner: 2 },
      { a: 0, b: 2, winner: 2 },
      { a: 1, b: 2, winner: 1 },
      { a: 1, b: 2, winner: 2 },
    ];
    expect(standingsOf(teams, played, "headToHead")).toEqual([2, 1, 0]);
  });

  it("divisionRecord: win %, then division record, then head-to-head", () => {
    // Teams 0, 1 and 2 share division 0. Team 0 beat team 1 but is 1–2 in the division; team 1 is 2–1.
    const teams = [team(0, { w: 8, l: 6, pointsFor: 1500, division: 0 }), team(1, { w: 8, l: 6, pointsFor: 1400, division: 0 }), team(2, { w: 3, l: 11, division: 0 }), team(3, { w: 6, l: 8, division: 1 })];
    const played: SimPlayedGame[] = [
      { a: 0, b: 1, winner: 0 },
      { a: 1, b: 2, winner: 1 },
      { a: 1, b: 2, winner: 1 },
      { a: 2, b: 0, winner: 2 },
      { a: 2, b: 0, winner: 2 },
    ];
    expect(standingsOf(teams, played, "divisionRecord")).toEqual([1, 0, 3, 2]);
    expect(standingsOf(teams, played, "pointsFor")).toEqual([0, 1, 3, 2]);
    expect(standingsOf(teams, played, "headToHead")).toEqual([0, 1, 3, 2]);
  });

  it("division record compares each tied team's own division record, even across divisions (espn-api's code, not its docstring)", () => {
    // Division records: team 0 2–0 (beat team 2 twice), team 1 0–1 (lost to team 3), team 2 0–2, team 3 1–0.
    // Team 1 beat team 0, but that's a cross-division game.
    const cross = [team(0, { w: 8, l: 6, pointsFor: 1500, division: 0 }), team(1, { w: 8, l: 6, pointsFor: 1400, division: 1 }), team(2, { w: 3, l: 11, division: 0 }), team(3, { w: 3, l: 11, division: 1 })];
    const crossPlayed: SimPlayedGame[] = [
      { a: 1, b: 0, winner: 1 },
      { a: 0, b: 2, winner: 0 },
      { a: 0, b: 2, winner: 0 },
      { a: 1, b: 3, winner: 3 },
    ];
    // divisionRecord: 1.0 beats 0 for teams 0 and 1 (head-to-head never comes up), and 1.0 beats 0 for teams 3 and 2.
    expect(standingsOf(cross, crossPlayed, "divisionRecord")).toEqual([0, 1, 3, 2]);
    // headToHead: team 1 won the meeting. Teams 2 and 3 never met and have equal points for, so division record, the 4th criterion, decides.
    expect(standingsOf(cross, crossPlayed, "headToHead")).toEqual([1, 0, 3, 2]);
    // pointsFor: points for splits teams 0 and 1. For teams 2 and 3, head-to-head (never met) passes to division record.
    expect(standingsOf(cross, crossPlayed, "pointsFor")).toEqual([0, 1, 3, 2]);
    // A team without a division has no division games, so its record counts 0: team 1 (1–1 in its division) ranks above team 0, which beat it.
    const noDivision = [team(0, { w: 8, l: 6, pointsFor: 1500 }), team(1, { w: 8, l: 6, pointsFor: 1400, division: 0 }), team(2, { w: 3, l: 11, division: 0 })];
    const noDivisionPlayed: SimPlayedGame[] = [
      { a: 0, b: 1, winner: 0 },
      { a: 1, b: 2, winner: 1 },
      { a: 2, b: 1, winner: 2 },
    ];
    expect(standingsOf(noDivision, noDivisionPlayed, "divisionRecord")).toEqual([1, 0, 2]);
    expect(standingsOf(noDivision, noDivisionPlayed, "headToHead")).toEqual([0, 1, 2]);
  });

  it("points against breaks what points for can't (more points against ranks higher), then team index", () => {
    const teams = [team(0, { w: 7, l: 7, pointsFor: 1000, pointsAgainst: 900 }), team(1, { w: 7, l: 7, pointsFor: 1000, pointsAgainst: 950 }), team(2, { w: 7, l: 7, pointsFor: 1000, pointsAgainst: 900 })];
    expect(standingsOf(teams, [], "pointsFor")).toEqual([1, 0, 2]);
  });

  it("simulated games count in head-to-head: the winner of the last game takes the tie though he has fewer points", () => {
    // 7–6 beats 8–5 in the last game: both finish 8–6, team 0 with fewer points for (1100 < 1190).
    const teams = [team(0, { w: 7, l: 6, pointsFor: 1000 }), team(1, { w: 8, l: 5, pointsFor: 1100 })];
    const setup = (tiebreaker: SimTiebreaker) => makeSetup({ teams, weeks: [14], games: [{ weeks: [14], a: 0, b: 1 }], tiebreaker }, (t) => (t === 0 ? 100 : 90));
    const h2h = run(setup("headToHead"));
    expect(h2h.teams.map((o) => o.expWins)).toEqual([8, 8]);
    expect(fixedOrder(h2h)).toEqual([0, 1]);
    expect(fixedOrder(run(setup("pointsFor")))).toEqual([1, 0]);
  });

  it("division winners first: each division's best team takes the top seeds, then everyone else", () => {
    const teams = [team(0, { w: 10, l: 4, division: 7 }), team(1, { w: 9, l: 5, division: 7 }), team(2, { w: 6, l: 8, division: 3 }), team(3, { w: 5, l: 9, division: 3 })];
    expect(standingsOf(teams, [], "pointsFor", { divisionWinnersFirst: true })).toEqual([0, 2, 1, 3]);
    expect(standingsOf(teams, [], "pointsFor", { divisionWinnersFirst: false })).toEqual([0, 1, 2, 3]);
    // One division (or none): nothing to put first.
    const oneDivision = teams.map((t) => ({ ...t, division: 0 }));
    expect(standingsOf(oneDivision, [], "pointsFor", { divisionWinnersFirst: true })).toEqual([0, 1, 2, 3]);
    // Division winners are ordered among themselves by the hierarchy: the 6–8 winner of the other division ranks below a 10–4 winner.
    const twoDivisionsFlipped = [team(0, { w: 6, l: 8, division: 1 }), team(1, { w: 9, l: 5, division: 2 }), team(2, { w: 10, l: 4, division: 2 }), team(3, { w: 2, l: 12, division: 1 })];
    expect(standingsOf(twoDivisionsFlipped, [], "pointsFor", { divisionWinnersFirst: true })).toEqual([2, 0, 1, 3]);
  });
});

describe("standingsOrder: today's standings by the league's rules (TeamOdds.rank)", () => {
  it("is the simulator's final order of a season with nothing left to play", () => {
    const teams = [team(0, { w: 8, l: 6, pointsFor: 1400 }), team(1, { w: 8, l: 6, pointsFor: 1500 }), team(2, { w: 5, l: 9, pointsFor: 1600 }), team(3, { w: 7, l: 7 })];
    const played: SimPlayedGame[] = [{ a: 0, b: 1, winner: 0 }];
    for (const tiebreaker of ["pointsFor", "headToHead", "divisionRecord"] as SimTiebreaker[]) {
      const setup = makeSetup({ teams, weeks: [], played, tiebreaker });
      expect(standingsOrder(setup), tiebreaker).toEqual(fixedOrder(run(setup)));
    }
    expect(standingsOrder(makeSetup({ teams, weeks: [], played, tiebreaker: "pointsFor" }))).toEqual([1, 0, 3, 2]);
  });

  it("reads records and played games alone: remaining games, draws and the bracket don't move it", () => {
    // Team 1 trails by a game with a 100-point mean against team 0's 50 in the last game: the final order flips, today's doesn't.
    const teams = [team(0, { w: 8, l: 5, pointsFor: 1000 }), team(1, { w: 7, l: 6, pointsFor: 1100 })];
    const setup = makeSetup({ teams, weeks: [14, 15], games: [{ weeks: [14], a: 0, b: 1 }], playoffTeams: 1, rounds: [{ weeks: [15] }] }, (t) => (t === 1 ? 100 : 50), () => 5);
    expect(fixedOrder(run(setup))).toEqual([1, 0]);
    expect(standingsOrder(setup)).toEqual([0, 1]);
    // Head-to-head among three tied teams counts today's meetings: unequal so far (0–1 met twice), so points for decides.
    const three = [team(0, { w: 7, l: 7, pointsFor: 1000 }), team(1, { w: 7, l: 7, pointsFor: 1100 }), team(2, { w: 7, l: 7, pointsFor: 1200 })];
    const played: SimPlayedGame[] = [
      { a: 0, b: 1, winner: 0 },
      { a: 0, b: 1, winner: 0 },
      { a: 1, b: 2, winner: 1 },
      { a: 2, b: 0, winner: 2 },
    ];
    expect(standingsOrder(makeSetup({ teams: three, weeks: [], played, tiebreaker: "headToHead" }))).toEqual([2, 1, 0]);
  });

  it("puts division winners first when the league seeds them so, and ranks points-only leagues by points for", () => {
    const teams = [team(0, { w: 10, l: 4, division: 7 }), team(1, { w: 9, l: 5, division: 7 }), team(2, { w: 6, l: 8, division: 3 }), team(3, { w: 5, l: 9, division: 3 })];
    expect(standingsOrder(makeSetup({ teams, weeks: [], divisionWinnersFirst: true }))).toEqual([0, 2, 1, 3]);
    expect(standingsOrder(makeSetup({ teams, weeks: [], divisionWinnersFirst: false }))).toEqual([0, 1, 2, 3]);
    const pf = [team(0, { pointsFor: 900 }), team(1, { pointsFor: 1200 }), team(2, { pointsFor: 1000 })];
    expect(standingsOrder(makeSetup({ teams: pf, weeks: [], pointsOnly: true }))).toEqual([1, 2, 0]);
    expect(standingsOrder(makeSetup({ teams: [], weeks: [] }))).toEqual([]);
  });
});

describe("simulateSeason: playoffs (CLAUDE.md §8)", () => {
  // 8 teams, team i = seed i + 1; 6 make it (2 byes). Round 1 (week 15): 4–5 and 3–6; round 2 (16); final (17).
  const table = {
    15: { 3: 10, 4: 20, 2: 10, 5: 20 }, // seeds 5 and 6 win
    16: { 0: 20, 1: 20, 4: 25, 5: 15 },
    17: { 0: 5, 1: 30, 4: 10 },
  };
  const sixTeamBracket = (over: Partial<SimSetup> = {}): SimSetup =>
    makeSetup({ teams: seededTeams(8), weeks: [15, 16, 17], playoffTeams: 6, byes: 2, rounds: [{ weeks: [15] }, { weeks: [16] }, { weeks: [17] }], ...over }, scores(table));

  it("fixed 6-team bracket (ESPN): seed 1 meets the 4/5 winner and seed 2 the 3/6 winner", () => {
    const res = run(sixTeamBracket());
    expect(fixedOrder(res)).toEqual(range(0, 7));
    expect(res.teams.map((o) => o.pPlayoffs)).toEqual([1, 1, 1, 1, 1, 1, 0, 0]);
    expect(res.teams.map((o) => o.pBye)).toEqual([1, 1, 0, 0, 0, 0, 0, 0]);
    // Week 16: seed 5 (25) beats seed 1 (20); seed 2 (20) beats seed 6 (15). Final: seed 2 (30) beats seed 5 (10).
    expect(titles(res)).toEqual([0, 1, 0, 0, 0, 0, 0, 0]);
  });

  it("re-seeding: the survivors are re-sorted before each later round, best against worst", () => {
    // Week 16: seed 1 (20) beats seed 6 (15); seed 5 (25) beats seed 2 (20). Final: seed 5 (10) beats seed 1 (5).
    expect(titles(run(sixTeamBracket({ reseed: true })))).toEqual([0, 0, 0, 0, 1, 0, 0, 0]);
  });

  it("the bracket's byes are B − N whatever `byes` says", () => {
    const res = run(sixTeamBracket({ byes: 0 }));
    expect(res.teams.map((o) => o.pBye)).toEqual([1, 1, 0, 0, 0, 0, 0, 0]);
    expect(titles(res)).toEqual([0, 1, 0, 0, 0, 0, 0, 0]);
  });

  it("5 playoff teams: 3 byes, round 1 is 4–5, then 1 vs the 4/5 winner and 2 vs 3", () => {
    const five = { 15: { 3: 10, 4: 20 }, 16: { 0: 15, 4: 20, 1: 10, 2: 30 }, 17: { 4: 25, 2: 20 } };
    const setup = makeSetup({ teams: seededTeams(6), weeks: [15, 16, 17], playoffTeams: 5, byes: 3, rounds: [{ weeks: [15] }, { weeks: [16] }, { weeks: [17] }] }, scores(five));
    const res = run(setup);
    expect(res.teams.map((o) => o.pBye)).toEqual([1, 1, 1, 0, 0, 0]);
    expect(res.teams.map((o) => o.pPlayoffs)).toEqual([1, 1, 1, 1, 1, 0]);
    expect(titles(res)).toEqual([0, 0, 0, 0, 1, 0]);
  });

  it("7 playoff teams: 1 bye, round 1 is 4–5, 2–7 and 3–6, then 1 vs the 4/5 winner and the 2/7 winner vs the 3/6 winner", () => {
    const seven = { 15: { 1: 10, 6: 20, 2: 20, 5: 10, 3: 20, 4: 10 }, 16: { 0: 10, 3: 20, 6: 20, 2: 10 }, 17: { 3: 10, 6: 20 } };
    const setup = makeSetup({ teams: seededTeams(8), weeks: [15, 16, 17], playoffTeams: 7, byes: 1, rounds: [{ weeks: [15] }, { weeks: [16] }, { weeks: [17] }] }, scores(seven));
    const res = run(setup);
    expect(res.teams.map((o) => o.pBye)).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(res.teams.map((o) => o.pPlayoffs)).toEqual([1, 1, 1, 1, 1, 1, 1, 0]);
    expect(titles(res)).toEqual([0, 0, 0, 0, 0, 0, 1, 0]);
  });

  it("a multi-week round sums its weeks", () => {
    // 4 teams, no byes: round 1 (week 15) 1–4 and 2–3 go to seeds 1 and 2; the final spans weeks 16 and 17.
    const final = (w16: [number, number], w17: [number, number]) =>
      titles(
        run(
          makeSetup(
            { teams: seededTeams(4), weeks: [15, 16, 17], playoffTeams: 4, byes: 0, rounds: [{ weeks: [15] }, { weeks: [16, 17] }] },
            scores({ 15: { 0: 50, 1: 50 }, 16: { 0: w16[0], 1: w16[1] }, 17: { 0: w17[0], 1: w17[1] } }),
          ),
        ),
      );
    expect(final([30, 20], [5, 20])).toEqual([0, 1, 0, 0]); // 35 < 40, though seed 1 won week 16
    expect(final([5, 20], [30, 20])).toEqual([0, 1, 0, 0]); // 35 < 40, though seed 1 won week 17
    expect(final([30, 20], [15, 20])).toEqual([1, 0, 0, 0]); // 45 > 40
  });

  it("extra rounds are ignored; a round under way is decided by its weeks still to play", () => {
    // 2 playoff teams need 1 round; the second listed round is ignored.
    const extra = makeSetup({ teams: seededTeams(4), weeks: [15, 16], playoffTeams: 2, byes: 0, rounds: [{ weeks: [15] }, { weeks: [16] }] }, scores({ 15: { 1: 10 }, 16: { 0: 99 } }));
    expect(titles(run(extra))).toEqual([0, 1, 0, 0]);
    // A two-week final whose first week (15) is over: only week 16 has draws, and it decides.
    const underWay = makeSetup({ teams: seededTeams(4), weeks: [16], playoffTeams: 2, byes: 0, rounds: [{ weeks: [15, 16] }] }, scores({ 16: { 1: 10 } }));
    const res = run(underWay);
    expect(res.playoffsKnown).toBe(true);
    expect(titles(res)).toEqual([0, 1, 0, 0]);
  });

  it("an exactly tied playoff game goes to the better seed", () => {
    const setup = makeSetup({ teams: seededTeams(4), weeks: [15, 16], playoffTeams: 4, byes: 0, rounds: [{ weeks: [15] }, { weeks: [16] }] });
    expect(titles(run(setup))).toEqual([1, 0, 0, 0]);
  });

  it("replays decided playoff games (either order) and simulates the rest", () => {
    // Round 1 (week 15) is over: seed 4 upset seed 1, seed 2 beat seed 3. The final (week 16) is still to play.
    const setup = makeSetup(
      {
        teams: seededTeams(4),
        weeks: [16],
        playoffTeams: 4,
        byes: 0,
        rounds: [{ weeks: [15] }, { weeks: [16] }],
        playoffResults: [
          { a: 3, b: 0, winner: 3 },
          { a: 1, b: 2, winner: 1 },
          { a: 0, b: 2, winner: 2 }, // a consolation game: not in the bracket, ignored
        ],
      },
      (t) => (t === 3 ? 90 : 100),
      () => 10,
    );
    const res = run(setup, 20_000);
    expect(res.playoffsKnown).toBe(true);
    expect(res.teams[0]!.pTitle).toBe(0);
    expect(res.teams[2]!.pTitle).toBe(0);
    expect(Math.abs(res.teams[1]!.pTitle - 0.7602)).toBeLessThan(0.015);
    expect(res.teams[1]!.pTitle + res.teams[3]!.pTitle).toBeCloseTo(1, 12);
    expect(res.weekly).toEqual([]);
  });

  it("a round already played without a matching result: playoffsKnown false, title and bye odds NaN", () => {
    const setup = makeSetup({ teams: seededTeams(8), weeks: [16, 17], playoffTeams: 6, byes: 2, rounds: [{ weeks: [15] }, { weeks: [16] }, { weeks: [17] }], playoffResults: [{ a: 3, b: 4, winner: 4 }] });
    const res = run(setup, 10);
    expect(res.playoffsKnown).toBe(false);
    expect(res.teams.every((o) => Number.isNaN(o.pTitle) && Number.isNaN(o.pBye))).toBe(true);
    expect(res.teams.map((o) => o.pPlayoffs)).toEqual([1, 1, 1, 1, 1, 1, 0, 0]);
    // With both round-1 results it's known again.
    const known = run({ ...setup, playoffResults: [{ a: 3, b: 4, winner: 4 }, { a: 2, b: 5, winner: 2 }] }, 10);
    expect(known.playoffsKnown).toBe(true);
    expect(sum(titles(known))).toBeCloseTo(1, 12);
    expect(known.teams[3]!.pTitle).toBe(0);
  });

  it("fewer rounds than the bracket needs: playoff and bye odds only, title odds NaN", () => {
    const res = run(sixTeamBracket({ rounds: [{ weeks: [15] }, { weeks: [16] }] }));
    expect(res.playoffsKnown).toBe(true);
    expect(res.teams.every((o) => Number.isNaN(o.pTitle))).toBe(true);
    expect(res.teams.map((o) => o.pBye)).toEqual([1, 1, 0, 0, 0, 0, 0, 0]);
    expect(res.teams.map((o) => o.pPlayoffs)).toEqual([1, 1, 1, 1, 1, 1, 0, 0]);
  });

  it("no playoffs (or one playoff team): the top of the final standings is the champion", () => {
    const none = run(makeSetup({ teams: seededTeams(4), weeks: [] }));
    expect(titles(none)).toEqual([1, 0, 0, 0]);
    expect(none.teams.map((o) => o.pPlayoffs)).toEqual([0, 0, 0, 0]);
    expect(none.teams.map((o) => o.pBye)).toEqual([0, 0, 0, 0]);
    const one = run(makeSetup({ teams: seededTeams(4), weeks: [], playoffTeams: 1 }));
    expect(titles(one)).toEqual([1, 0, 0, 0]);
    expect(one.teams.map((o) => o.pPlayoffs)).toEqual([1, 0, 0, 0]);
  });

  it("more playoff teams than teams: everyone makes it", () => {
    const res = run(makeSetup({ teams: seededTeams(4), weeks: [15, 16], playoffTeams: 6, byes: 2, rounds: [{ weeks: [15] }, { weeks: [16] }] }, (t) => 100 + t));
    expect(res.teams.map((o) => o.pPlayoffs)).toEqual([1, 1, 1, 1]);
    expect(sum(titles(res))).toBe(1);
  });

  it("the regular season and the playoffs in one run: Parker-sized odds are coherent", () => {
    const res = run(parkerSized(), 2000);
    for (const o of res.teams) {
      expect(o.pBye).toBeLessThanOrEqual(o.pPlayoffs);
      expect(o.pTitle).toBeLessThanOrEqual(o.pPlayoffs);
      expect(o.expWins + o.expLosses + o.expTies).toBeCloseTo(3 + 11, 12);
    }
    // Each regular week lists every team's game, and the two sides' chances add up to 1.
    expect(res.weekly.map((wk) => wk.week)).toEqual(range(4, 14));
    for (const wk of res.weekly) expect(sum(wk.pWin)).toBeCloseTo(5, 12);
  });

  it("shows a bye-crunch week's risk: a 20% lower week-13 mean lowers that week's win chance, and only that week's", () => {
    const crunch = parkerSized(); // team 2's week-13 mean is 80% of its usual
    const i13 = crunch.weeks.indexOf(13);
    const normal: SimSetup = { ...crunch, mean: crunch.mean.map((m, t) => (t === 2 ? m.map((x, i) => (i === i13 ? x / 0.8 : x)) : m)) };
    const normals = simNormals(SEED, 4000, crunch.weeks.length, crunch.teams.length);
    const a = simulateSeason(normal, { sims: 4000, seed: SEED, normals });
    const b = simulateSeason(crunch, { sims: 4000, seed: SEED, normals });
    const pWin = (res: SimResult, week: number) => res.weekly.find((wk) => wk.week === week)!.pWin[2] as number;
    expect(pWin(b, 13)).toBeLessThan(pWin(a, 13) - 0.1);
    for (const week of range(4, 14)) if (week !== 13) expect(pWin(b, week), `week ${week}`).toBe(pWin(a, week));
    expect(b.teams[2]!.expWins).toBeLessThan(a.teams[2]!.expWins);
  });
});

describe("bracketGames: the games the seeds and the results already pin down (season.ts checks the league's own playoff schedule against them)", () => {
  const base = { teams: seededTeams(8), playoffTeams: 6, reseed: false, playoffResults: [] as SimSetup["playoffResults"] };
  const order = range(0, 7);

  it("6 teams (2 byes): round 1 is 4–5 and 3–6; then 1 vs the 4/5 winner and 2 vs the 3/6 winner, or, re-seeded, 1 vs the worst left", () => {
    expect(bracketGames(base, order)).toEqual([
      [
        [3, 4],
        [2, 5],
      ],
    ]);
    // Seed 6 beat seed 3 and seed 4 beat seed 5 (either order in the results).
    const results = [
      { a: 5, b: 2, winner: 5 },
      { a: 3, b: 4, winner: 3 },
    ];
    expect(bracketGames({ ...base, playoffResults: results }, order)).toEqual([
      [
        [3, 4],
        [2, 5],
      ],
      [
        [0, 3],
        [1, 5],
      ],
    ]);
    expect(bracketGames({ ...base, reseed: true, playoffResults: results }, order)[1]).toEqual([
      [0, 5],
      [1, 3],
    ]);
    // One round-1 result missing: round 2 isn't known yet.
    expect(bracketGames({ ...base, playoffResults: results.slice(0, 1) }, order)).toHaveLength(1);
    // The seeds are `order`'s, not the team indexes.
    expect(bracketGames(base, [7, 6, 5, 4, 3, 2, 1, 0])[0]).toEqual([
      [4, 3],
      [5, 2],
    ]);
    // No bracket below 2 playoff teams.
    expect(bracketGames({ ...base, playoffTeams: 1 }, order)).toEqual([]);
  });

  it("pairs every round the way simulateSeason plays it: with each of its games' results given, the simulator replays the whole bracket", () => {
    const rand = mulberry32(2026);
    for (let trial = 0; trial < 300; trial++) {
      const T = 2 + Math.floor(rand() * 11);
      const N = 2 + Math.floor(rand() * (T - 1));
      const reseed = rand() < 0.5;
      const teams = seededTeams(T);
      const seeds = standingsOrder(makeSetup({ teams, weeks: [] }));
      let B = 1;
      while (B < N) B *= 2;
      const R = Math.round(Math.log2(B));
      // Decide the bracket round by round from bracketGames alone, a random winner each game.
      const results: SimSetup["playoffResults"] = [];
      for (let r = 0; r < R; r++) {
        const games = bracketGames({ teams, playoffTeams: N, reseed, playoffResults: results }, seeds)[r] ?? [];
        for (const [a, b] of games) results.push({ a, b, winner: rand() < 0.5 ? a : b });
      }
      const rounds = bracketGames({ teams, playoffTeams: N, reseed, playoffResults: results }, seeds);
      expect(rounds, `trial ${trial}`).toHaveLength(R);
      // Every round over (nothing drawn): the simulator must find a result for each of its games.
      const res = run(makeSetup({ teams, weeks: [], playoffTeams: N, byes: B - N, reseed, rounds: range(1, R).map((w) => ({ weeks: [w] })), playoffResults: results }));
      expect(res.playoffsKnown, `trial ${trial}: ${T} teams, ${N} in, reseed ${reseed}`).toBe(true);
      const final = results.at(-1) as SimSetup["playoffResults"][number];
      expect(res.teams[final.winner]?.pTitle, `trial ${trial}`).toBe(1);
    }
  });
});

describe("simulateSeason: input checks", () => {
  const base = () => makeSetup({ teams: [team(0), team(1)], weeks: [5, 6], games: [{ weeks: [5], a: 0, b: 1 }] });

  it("rejects a normals matrix of the wrong shape (common random numbers would silently break)", () => {
    const setup = base();
    const wrong: SimNormals[] = [simNormals(SEED, 10, 3, 2), simNormals(SEED, 10, 2, 3), simNormals(SEED, 5, 2, 2)];
    for (const normals of wrong) expect(() => simulateSeason(setup, { sims: 10, seed: SEED, normals })).toThrow(RangeError);
    expect(() => simulateSeason(setup, { sims: 10, seed: SEED, normals: simNormals(SEED, 12, 2, 2) })).not.toThrow();
  });

  it("rejects bad shapes, team indexes, weeks, scores and sim counts", () => {
    expect(() => run({ ...base(), mean: [new Float64Array(2)] })).toThrow(RangeError);
    expect(() => run({ ...base(), sd: [new Float64Array(2), new Float64Array(3)] })).toThrow(RangeError);
    expect(() => run({ ...base(), sd: [Float64Array.of(1, -1), new Float64Array(2)] })).toThrow(RangeError);
    expect(() => run({ ...base(), mean: [Float64Array.of(1, Number.NaN), new Float64Array(2)] })).toThrow(RangeError);
    expect(() => run({ ...base(), weeks: [6, 5] })).toThrow(RangeError);
    expect(() => run({ ...base(), games: [{ weeks: [5], a: 0, b: 2 }] })).toThrow(RangeError);
    expect(() => run({ ...base(), games: [{ weeks: [5], a: 1, b: 1 }] })).toThrow(RangeError);
    expect(() => run({ ...base(), played: [{ a: 0, b: 1, winner: 3 }] })).toThrow(RangeError);
    expect(() => run({ ...base(), playoffResults: [{ a: 0, b: 1, winner: 2 }] })).toThrow(RangeError);
    expect(() => run({ ...base(), teams: [team(0, { w: Number.NaN }), team(1)] })).toThrow(RangeError);
    expect(() => simulateSeason(base(), { sims: 0, seed: SEED })).toThrow(RangeError);
    expect(() => simulateSeason(base(), { sims: 2.5, seed: SEED })).toThrow(RangeError);
  });

  it("rejects a game, median week or playoff round week that's neither drawn nor over (it would silently drop off the records)", () => {
    // A game day with the week under way (5) left out of `weeks` while its games have no result yet.
    const gameDay = makeSetup({
      teams: [team(0), team(1)],
      weeks: [6, 7],
      games: [
        { weeks: [5], a: 0, b: 1 },
        { weeks: [6], a: 0, b: 1 },
      ],
      medianWeeks: [6],
    });
    expect(() => run(gameDay)).toThrow(/the game 0–1 \(weeks 5\) has no week in weeks \(6, 7\)/);
    // And its median game.
    expect(() => run({ ...gameDay, games: [{ weeks: [6], a: 0, b: 1 }], medianWeeks: [5, 6] })).toThrow(/median week 5 isn't in weeks/);
    // A game with no weeks, or a week after the first drawn week missing from `weeks` (5 and 6 are drawn).
    expect(() => run({ ...base(), games: [{ weeks: [], a: 0, b: 1 }] })).toThrow(RangeError);
    expect(() => run({ ...base(), games: [{ weeks: [6, 7], a: 0, b: 1 }] })).toThrow(/needs week 7/);
    expect(() => run({ ...base(), games: [{ weeks: [5, Number.NaN], a: 0, b: 1 }] })).toThrow(/needs week NaN/);
    // Median weeks after the drawn ones, in points-only leagues too (they're ignored there, but a missing
    // regular-season week would drop its points for).
    expect(() => run({ ...base(), medianWeeks: [7] })).toThrow(/median week 7/);
    expect(() => run({ ...base(), medianWeeks: [7], pointsOnly: true })).toThrow(/median week 7/);
    // A playoff round the bracket uses: a missing week after the first drawn week, or no weeks at all.
    expect(() => run({ ...base(), playoffTeams: 2, rounds: [{ weeks: [6, 7] }] })).toThrow(/playoff round 1 \(weeks 6, 7\) needs week 7/);
    expect(() => run({ ...base(), playoffTeams: 2, rounds: [{ weeks: [] }] })).toThrow(/playoff round 1 has no weeks/);
    // Still fine: a game under way (its first week before the first drawn week), and a bye game in any week.
    expect(() => run({ ...base(), games: [{ weeks: [4, 5], a: 0, b: 1 }, { weeks: [9], a: 1, b: null }] })).not.toThrow();
    // A round that's over needs results, not draws (without them the playoffs are unknown), and a round
    // the bracket doesn't use (2 teams play 1 round) isn't checked.
    const final = makeSetup({ teams: seededTeams(2), weeks: [16], playoffTeams: 2, rounds: [{ weeks: [15] }, { weeks: [17] }] });
    expect(run(final).playoffsKnown).toBe(false);
    expect(titles(run({ ...final, playoffResults: [{ a: 0, b: 1, winner: 1 }] }))).toEqual([0, 1]);
  });

  it("an empty league gives an empty result", () => {
    const res = run(makeSetup({ teams: [], weeks: [5] }), 3);
    expect(res).toEqual({ sims: 3, teams: [], weekly: [], playoffsKnown: true });
  });
});

describe("performance (CLAUDE.md §8 defaults: 5,000 final sims, 1,000 screening sims)", () => {
  it("Parker-sized league (10 teams, 11 regular weeks, 3 playoff rounds): well within the budget", () => {
    const setup = parkerSized({ medianWeeks: [] });
    const W = setup.weeks.length;
    const T = setup.teams.length;
    const { finalSims, screeningSims, seed } = config.simulation;
    simulateSeason(setup, { sims: 200, seed }); // warm up the JIT
    const t0 = performance.now();
    const normals = simNormals(seed, finalSims, W, T);
    const t1 = performance.now();
    const final = simulateSeason(setup, { sims: finalSims, seed, normals });
    const t2 = performance.now();
    const screening = simulateSeason(setup, { sims: screeningSims, seed, normals });
    const t3 = performance.now();
    const withMedian = simulateSeason({ ...setup, medianWeeks: range(4, 14) }, { sims: finalSims, seed, normals });
    const t4 = performance.now();
    const ms = (x: number) => `${x.toFixed(1)} ms`;
    console.log(
      `[perf] sim, ${T} teams × ${W} weeks: normals (${finalSims} sims) ${ms(t1 - t0)}; ${finalSims} sims ${ms(t2 - t1)}; ${screeningSims} sims ${ms(t3 - t2)}; ${finalSims} sims with median games ${ms(t4 - t3)}`,
    );
    expect(t2 - t0).toBeLessThan(1000); // target: well under 100 ms
    expect(t3 - t2).toBeLessThan(250); // target: well under 25 ms
    expect(sum(titles(final))).toBeCloseTo(1, 12);
    expect(sum(titles(screening))).toBeCloseTo(1, 12);
    expect(sum(titles(withMedian))).toBeCloseTo(1, 12);
  });
});
