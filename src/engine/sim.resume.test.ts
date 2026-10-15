/**
 * Checkpoint 7f (planner reply to Checkpoint 7e, answer 2: "simulate only the 15,000 seasons the ranking run doesn't already
 * cover"; sim.ts's header, "Continuing a run"): simulateSeason continues a run from its progress (SimOptions.keep, resume) and
 * gives the full run's result bit for bit, on every kind of setup sim.ts plays (fixed and re-seeding brackets with byes,
 * median weeks, divisions first, every tiebreaker, weekly high scores, every 3rd-place rule, points-only leagues, multi-week
 * games and rounds, rounds already played, exact ties, no playoffs), in both title modes and at every exactReseedTeams; a
 * progress continues only its own run (another setup, another matrix or start, fewer seasons than it holds, or no normals
 * throw an Error that isn't a RangeError, which callers would read as a setup they can't simulate). Teams are placeholders.
 */
import { describe, expect, it } from "vitest";
import { mulberry32 } from "./rng";
import { simNormals, simulateSeason, type SimGame, type SimNormals, type SimOptions, type SimProgress, type SimResult, type SimSetup, type SimTeam } from "./sim";

/** The tests' own seed. */
const SEED = 20_260_930;
const N = 700;

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

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

const weeklyPeriods = (from = 4, to = 14): number[][] => range(from, to).map((w) => [w]);

/** A Parker-sized season: T teams in 2 divisions, weeks 4–14 regular (round robin), 6 playoff teams in weeks 15–17. */
function parkerSized(over: Partial<SimSetup> = {}, T = 10): SimSetup {
  const regular = range(4, 14);
  const rand = mulberry32(99 + T);
  const base = range(0, T - 1).map(() => 95 + 35 * rand());
  const teams = range(0, T - 1).map((i) => team(i, { w: Math.floor(4 * rand()), l: 0, pointsFor: 300 + 100 * rand(), division: i % 2 }));
  teams.forEach((tm) => (tm.l = 3 - tm.w));
  return makeSetup(
    { teams, weeks: range(4, 17), games: roundRobin(T, regular), playoffTeams: 6, byes: 2, rounds: [{ weeks: [15] }, { weeks: [16] }, { weeks: [17] }], ...over },
    (t, w) => (base[t] as number) * (w === 13 && t === 2 ? 0.8 : 1),
    (t) => 20 + t,
  );
}

/** The regular season over: T teams seeded in index order, N of them in a bracket from week 15 (round r lasting roundWeeks[r] weeks). */
function playoffsOnly(T: number, n: number, over: Partial<SimSetup> = {}, roundWeeks: number[] = []): SimSetup {
  let B = 1;
  while (B < n) B *= 2;
  const R = Math.round(Math.log2(B));
  let w = 15;
  const rounds = range(0, R - 1).map((r) => {
    const len = roundWeeks[r] ?? 1;
    const weeks = range(w, w + len - 1);
    w += len;
    return { weeks };
  });
  const rand = mulberry32(1000 * T + n);
  const base = range(0, T - 1).map(() => 90 + 40 * rand());
  return makeSetup({ teams: seededTeams(T), weeks: range(15, w - 1), playoffTeams: n, byes: B - n, rounds, ...over }, (t) => (base[t] as number) + 5 * rand(), () => 15 + 15 * rand());
}

/** A bit-exact serialization of a result (every number by Object.is: -0 and NaN told apart), its progress left out. */
function exactJson(r: SimResult): string {
  const { progress: _p, ...rest } = r;
  void _p;
  return JSON.stringify(rest, (_k, v: unknown) => {
    if (typeof v === "number") return Object.is(v, -0) ? "-0" : Number.isNaN(v) ? "NaN" : v;
    if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>, (x) => (Object.is(x, -0) ? "-0" : Number.isNaN(x) ? "NaN" : x));
    return v;
  });
}

/** A progress's carried state, serialized (to check a resume leaves it as it was). */
const progressJson = (p: SimProgress): string => JSON.stringify({ ...p, buffer: null, acc: Object.fromEntries(Object.entries(p.acc).map(([k, a]) => [k, Array.from(a)])), medianOrder: Array.from(p.medianOrder) });

/** The matrix's first k seasons: the same buffer and start (the trade context's ranking block of its shown block). */
const head = (m: SimNormals, k: number): SimNormals => ({ sims: k, weeks: m.weeks, teams: m.teams, z: m.z.subarray(0, k * m.weeks * m.teams) });

/** Exact ties in every season: teams 0–4 score exactly 110 every week (SD 0), so high scores, median games and points for tie. */
const ties = parkerSized({ medianWeeks: range(4, 14), highScorePeriods: weeklyPeriods() });
for (let t = 0; t < 5; t++) {
  ties.mean[t] = Float64Array.from(ties.weeks, () => 110);
  ties.sd[t] = Float64Array.from(ties.weeks, () => 0);
}

const SETUPS: [string, SimSetup, Partial<SimOptions>[]][] = [
  ["fixed 6 of 10, byes", parkerSized(), [{}, { titleMode: "sampled" }]],
  ["re-seeding 6 of 10", parkerSized({ reseed: true }), [{}, { titleMode: "sampled" }]],
  ["median weeks, divisions first, weekly high scores", parkerSized({ medianWeeks: range(4, 14), divisionWinnersFirst: true, highScorePeriods: weeklyPeriods() }), [{}, { titleMode: "sampled" }]],
  ["3rd by seed, high scores", parkerSized({ highScorePeriods: weeklyPeriods(), thirdPlace: "bySeed" }), [{}, { titleMode: "sampled" }]],
  ["3rd split", parkerSized({ thirdPlace: "split" }), [{}]],
  ["head-to-head tiebreaker", parkerSized({ tiebreaker: "headToHead" }), [{}]],
  ["division-record tiebreaker", parkerSized({ tiebreaker: "divisionRecord", divisionWinnersFirst: true }), [{}]],
  ["points only, high scores", parkerSized({ pointsOnly: true, highScorePeriods: weeklyPeriods() }), [{}, { titleMode: "sampled" }]],
  [
    "12 teams, two-week games and a two-week high-score period",
    parkerSized({ games: [...roundRobin(12, range(4, 12)), ...roundRobin(12, [13]).map((g) => ({ ...g, weeks: [13, 14] }))], medianWeeks: [4, 13], highScorePeriods: [...weeklyPeriods(4, 12), [13, 14]] }, 12),
    [{}, { titleMode: "sampled" }],
  ],
  ["re-seeding 12 of 14", playoffsOnly(14, 12, { reseed: true }), [{ exactReseedTeams: 8 }, { exactReseedTeams: 4 }, { exactReseedTeams: 2 }, { titleMode: "sampled" }]],
  ["re-seeding 8 of 10, multi-week rounds", playoffsOnly(10, 8, { reseed: true }, [2, 1, 1]), [{}, { exactReseedTeams: 2 }]],
  ["fixed 5 of 8", playoffsOnly(8, 5), [{}, { titleMode: "sampled" }]],
  ["3 playoff teams", playoffsOnly(6, 3), [{}, { titleMode: "sampled" }]],
  ["2 playoff teams (no semifinal)", playoffsOnly(6, 2), [{}, { titleMode: "sampled" }]],
  [
    // Seeds 1–4 are teams 0–3; the semifinals (week 14) are over and replayed, the final and the 3rd-place game drawn in week 15.
    "a round played: its results replayed",
    makeSetup(
      { teams: seededTeams(6), weeks: [15], playoffTeams: 4, rounds: [{ weeks: [14] }, { weeks: [15] }], playoffResults: [{ a: 0, b: 3, winner: 0 }, { a: 1, b: 2, winner: 2 }] },
      (t) => 100 + 3 * t,
      () => 18,
    ),
    [{}, { titleMode: "sampled" }],
  ],
  ["exact ties: equal means at SD 0 for half the teams", ties, [{}, { titleMode: "sampled" }]],
  ["no playoffs", parkerSized({ playoffTeams: 0, byes: 0, rounds: [], weeks: range(4, 14) }), [{}]],
];

describe("simulateSeason continues a run bit for bit (SimOptions.keep and resume; sim.ts, \"Continuing a run\")", () => {
  for (const [name, setup, optsList] of SETUPS) {
    for (const opts of optsList) {
      it(`${name} ${JSON.stringify(opts)}`, () => {
        const M = simNormals(SEED, N, setup.weeks.length, setup.teams.length);
        const full = simulateSeason(setup, { sims: N, seed: SEED, normals: M, ...opts });
        expect(full.progress).toBeUndefined();
        for (const k of [1, 175, 699, N]) {
          const part = simulateSeason(setup, { sims: k, seed: SEED, normals: head(M, k), keep: true, ...opts });
          expect(part.progress?.sims).toBe(k);
          // Keeping changes nothing: the prefix run is the plain k-season run.
          expect(exactJson(part)).toBe(exactJson(simulateSeason(setup, { sims: k, seed: SEED, normals: head(M, k), ...opts })));
          const progress = part.progress as SimProgress;
          const kept = progressJson(progress);
          expect(exactJson(simulateSeason(setup, { sims: N, seed: SEED, normals: M, resume: progress, ...opts })), `from ${k}`).toBe(exactJson(full));
          // The progress is as it was: continued again, the same full run.
          expect(progressJson(progress)).toBe(kept);
          expect(exactJson(simulateSeason(setup, { sims: N, seed: SEED, normals: M, resume: progress, ...opts })), `again from ${k}`).toBe(exactJson(full));
        }
        // A chain: 100 seasons kept, continued to 350 and kept, continued to all 700.
        const a = simulateSeason(setup, { sims: 100, seed: SEED, normals: head(M, 100), keep: true, ...opts });
        const b = simulateSeason(setup, { sims: 350, seed: SEED, normals: head(M, 350), resume: a.progress, keep: true, ...opts });
        expect(b.progress?.sims).toBe(350);
        expect(exactJson(b)).toBe(exactJson(simulateSeason(setup, { sims: 350, seed: SEED, normals: head(M, 350), ...opts })));
        expect(exactJson(simulateSeason(setup, { sims: N, seed: SEED, normals: M, resume: b.progress, ...opts }))).toBe(exactJson(full));
        // A copy of the setup, number for number (evaluate.ts builds its rows afresh for every run), continues it too.
        expect(exactJson(simulateSeason(structuredClone(setup), { sims: N, seed: SEED, normals: M, resume: a.progress, ...opts }))).toBe(exactJson(full));
      });
    }
  }

  it("on a matrix that starts inside a longer one (the same buffer, another start): continued there, and only there", () => {
    const setup = parkerSized();
    const per = setup.weeks.length * setup.teams.length;
    const all = simNormals(SEED, 300 + N, setup.weeks.length, setup.teams.length);
    const late: SimNormals = { sims: N, weeks: all.weeks, teams: all.teams, z: all.z.subarray(300 * per) };
    const full = simulateSeason(setup, { sims: N, seed: SEED, normals: late });
    const part = simulateSeason(setup, { sims: 200, seed: SEED, normals: head(late, 200), keep: true });
    expect(exactJson(simulateSeason(setup, { sims: N, seed: SEED, normals: late, resume: part.progress }))).toBe(exactJson(full));
    // A progress of the buffer's first seasons is another matrix's: another start in the same buffer.
    const early = simulateSeason(setup, { sims: 200, seed: SEED, normals: head(all, 200), keep: true });
    expect(() => simulateSeason(setup, { sims: N, seed: SEED, normals: late, resume: early.progress })).toThrow(/another matrix/);
  });

  it("the sticky flags carry over: an unknown 3rd place, and unknown playoffs", () => {
    // Every round over, the 3rd-place game (seeds 1 and 4's semifinal losers) without a result: 3rd can't be known.
    const eight = makeSetup({
      teams: seededTeams(8),
      weeks: [],
      playoffTeams: 8,
      reseed: true,
      rounds: [{ weeks: [15] }, { weeks: [16] }, { weeks: [17] }],
      playoffResults: [
        { a: 0, b: 7, winner: 0 },
        { a: 3, b: 4, winner: 4 },
        { a: 1, b: 6, winner: 1 },
        { a: 2, b: 5, winner: 5 },
        { a: 0, b: 5, winner: 5 },
        { a: 1, b: 4, winner: 1 },
        { a: 1, b: 5, winner: 5 },
      ],
    });
    const M = simNormals(SEED, 6, 0, 8);
    const part = simulateSeason(eight, { sims: 2, seed: SEED, normals: head(M, 2), keep: true });
    expect([part.progress?.thirdUnknown, part.progress?.unknownPlayoffs]).toEqual([true, false]);
    const resumed = simulateSeason(eight, { sims: 6, seed: SEED, normals: M, resume: part.progress });
    expect(exactJson(resumed)).toBe(exactJson(simulateSeason(eight, { sims: 6, seed: SEED, normals: M })));
    expect(resumed.thirdKnown).toBe(false);
    // A round over without its results: unknown playoffs.
    const unknown = makeSetup({ teams: seededTeams(4), weeks: [16], playoffTeams: 4, byes: 0, rounds: [{ weeks: [15] }, { weeks: [16] }], playoffResults: [{ a: 0, b: 3, winner: 0 }] });
    const M4 = simNormals(SEED, 5, 1, 4);
    const p = simulateSeason(unknown, { sims: 2, seed: SEED, normals: head(M4, 2), keep: true });
    expect(p.progress?.unknownPlayoffs).toBe(true);
    const r = simulateSeason(unknown, { sims: 5, seed: SEED, normals: M4, resume: p.progress });
    expect(r.playoffsKnown).toBe(false);
    expect(exactJson(r)).toBe(exactJson(simulateSeason(unknown, { sims: 5, seed: SEED, normals: M4 })));
  });

  it("the flags come from the progress, not from the seasons played after it; the median order's start changes nothing", () => {
    // Above, every season sets its flag, so a flag left behind would be set again: here none does, and a progress that saw
    // one (made by hand) must keep its run unknown.
    const setup = parkerSized({ medianWeeks: range(4, 14) });
    const M = simNormals(SEED, 60, setup.weeks.length, setup.teams.length);
    const full = simulateSeason(setup, { sims: 60, seed: SEED, normals: M });
    const part = simulateSeason(setup, { sims: 20, seed: SEED, normals: head(M, 20), keep: true });
    const p = part.progress as SimProgress;
    expect([p.unknownPlayoffs, p.thirdUnknown, full.playoffsKnown, full.thirdKnown]).toEqual([false, false, true, true]);
    const playoffs = simulateSeason(setup, { sims: 60, seed: SEED, normals: M, resume: { ...p, unknownPlayoffs: true } });
    expect([playoffs.playoffsKnown, playoffs.thirdKnown]).toEqual([false, false]);
    expect(playoffs.teams.every((o) => Number.isNaN(o.pTitle) && Number.isNaN(o.pBye))).toBe(true);
    const third = simulateSeason(setup, { sims: 60, seed: SEED, normals: M, resume: { ...p, thirdUnknown: true } });
    expect([third.playoffsKnown, third.thirdKnown]).toEqual([true, false]);
    expect(third.teams.every((o) => Number.isNaN(o.pThird))).toBe(true);
    expect(third.teams.map((o) => o.pTitle)).toEqual(full.teams.map((o) => o.pTitle));
    // The median sort's start: its order (score, then index) is total, so any start gives the full run (sim.ts's header).
    const reversed = Int32Array.from(p.medianOrder).reverse();
    expect(exactJson(simulateSeason(setup, { sims: 60, seed: SEED, normals: M, resume: { ...p, medianOrder: reversed } }))).toBe(exactJson(full));
  });
});

describe("a progress continues only its own run", () => {
  const setup = parkerSized({ reseed: true, medianWeeks: [4, 5], highScorePeriods: weeklyPeriods(4, 8) });
  const W = setup.weeks.length;
  const T = setup.teams.length;
  const M = simNormals(SEED, 300, W, T);
  const part = simulateSeason(setup, { sims: 100, seed: SEED, normals: head(M, 100), keep: true });
  /** The error a mismatch throws: an Error, never a RangeError (callers read a RangeError as a setup they can't simulate). */
  const thrown = (run: () => unknown): Error => {
    try {
      run();
    } catch (err) {
      return err as Error;
    }
    throw new Error("didn't throw");
  };
  const moved = (rows: Float64Array[], t: number, w: number, by: number) => rows.map((r, i) => (i === t ? Float64Array.from(r, (x, j) => (j === w ? x + by : x)) : r));

  it("another setup: any number, rule or list simulateOne reads", () => {
    const others: [string, SimSetup, Partial<SimOptions>][] = [
      ["a mean moved by 1e-9", { ...setup, mean: moved(setup.mean, 3, 5, 1e-9) }, {}],
      ["an SD moved by 1e-9", { ...setup, sd: moved(setup.sd, 7, 0, 1e-9) }, {}],
      ["the high scores left out", { ...setup, highScorePeriods: [] }, {}],
      ["another high-score period", { ...setup, highScorePeriods: weeklyPeriods(4, 9) }, {}],
      ["the median weeks left out", { ...setup, medianWeeks: [] }, {}],
      ["another tiebreaker", { ...setup, tiebreaker: "headToHead" }, {}],
      ["divisions first", { ...setup, divisionWinnersFirst: true }, {}],
      ["another division", { ...setup, teams: setup.teams.map((tm, i) => (i === 0 ? { ...tm, division: 1 } : tm)) }, {}],
      ["another record", { ...setup, teams: setup.teams.map((tm, i) => (i === 4 ? { ...tm, w: tm.w + 1 } : tm)) }, {}],
      ["a played game", { ...setup, played: [{ a: 0, b: 1, winner: 0 }] }, {}],
      ["a fixed bracket", { ...setup, reseed: false }, {}],
      ["another 3rd-place rule", { ...setup, thirdPlace: "bySeed" }, {}],
      ["fewer playoff teams", { ...setup, playoffTeams: 4, byes: 0 }, {}],
      ["the sampled title mode", setup, { titleMode: "sampled" }],
      ["another exactReseedTeams", setup, { exactReseedTeams: 2 }],
    ];
    for (const [what, other, opts] of others) {
      const err = thrown(() => simulateSeason(other, { sims: 300, seed: SEED, normals: M, resume: part.progress, ...opts }));
      expect(err.message, what).toMatch(/another setup/);
      expect(err instanceof RangeError, what).toBe(false);
    }
  });

  it("another matrix (the same numbers drawn again), none given, or more seasons than asked", () => {
    const redrawn = simNormals(SEED, 300, W, T);
    for (const [what, run] of [
      ["redrawn", () => simulateSeason(setup, { sims: 300, seed: SEED, normals: redrawn, resume: part.progress })],
      ["none given", () => simulateSeason(setup, { sims: 300, seed: SEED, resume: part.progress })],
      ["more seasons than asked", () => simulateSeason(setup, { sims: 99, seed: SEED, normals: head(M, 99), resume: part.progress })],
    ] as const) {
      const err = thrown(run);
      expect(err.message, what).toMatch(what === "more seasons than asked" ? /can't continue a progress of 100 seasons to 99/ : /matrix/);
      expect(err instanceof RangeError, what).toBe(false);
    }
    // As many seasons as it holds: nothing left to play, the run itself.
    expect(exactJson(simulateSeason(setup, { sims: 100, seed: SEED, normals: head(M, 100), resume: part.progress }))).toBe(exactJson(part));
  });
});
