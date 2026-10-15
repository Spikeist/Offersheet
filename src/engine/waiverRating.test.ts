/**
 * "Rest of season" rated by Helps you (Checkpoint 7e; planner reply to Checkpoint 7d, item 3.4; src/engine/waiverRating.ts,
 * waivers.ts, league.ts step 10b): every row's B against an independent computation (my roster as it stands and with the one
 * move priced by league.teamRosterScorer, each season run by season.seasonOdds on the same seed's first seasons, B by
 * benefit.benefit with the market term), the drop with the best B among the candidates, the finishing of the best rows on
 * the shown block, the order by Helps you, the one-week lists naming the season's drop, the switch that leaves the list in
 * points, determinism, and the rater on its own: a move that changes nothing has B_win 0 exactly, moves with the same score
 * share one run, and ties go to the lower keep value, then the smaller drop id. Made-up leagues (CLAUDE.md §16); teams are
 * placeholders.
 */
import { describe, expect, it } from "vitest";
import { benefit, helpsScale, protectValueWeight, tradeScore } from "./benefit";
import { config } from "./config";
import { buildLeagueModel, buildLeagueModelWithContext, rateWaiverUpgrades, teamRosterScorer, type BuildLeagueModelOptions, type LeagueModelConfig } from "./league";
import type { LeagueModel, WaiverRow } from "./leagueModel";
import { marketGain } from "./market";
import { prizeOddsOf, runPrizeDeltas } from "./reward";
import { buildSimSetup, pickupSeasonModel, seasonOdds, type SeasonModel } from "./season";
import { defaultTradeSettings } from "./settings";
import { simNormals } from "./sim";
import type { TableRow, WeeklyScore } from "./teamValue";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import { createWaiverRater, type WaiverRunChange } from "./waiverRating";
import { compareRatedRows } from "./waivers";

const SIMS = 400;
/** Screening on the first 100 seasons, the best 2 rows finished on all 400. */
const CFG: LeagueModelConfig = { ...config, waivers: { ...config.waivers, ratingScreenSims: 100, ratingFinishRows: 2 } };
/** Rated in the build (BuildLeagueModelOptions.waiverRating: the default leaves the list in points). */
const OPTS: BuildLeagueModelOptions = { now: TEST_NOW, sims: SIMS, waiverRating: true };
const league = smallLeague(11);

/** My team's model and its season's pieces, as the rater reads them (the file header). */
function context(model: LeagueModel) {
  const me = model.myTeamId as string;
  const mine = model.odds?.teams.find((t) => t.teamId === me);
  const myTeam = model.teams.find((t) => t.id === me);
  if (!mine || !myTeam || !model.helpsCalibration || !model.reward) throw new Error("no odds");
  const scale = helpsScale(model.helpsCalibration, { leagueType: "redraft", myPPlayoffs: mine.pPlayoffs, reward: model.reward, dynastyTotal: null });
  if (!scale) throw new Error("no scale");
  const values: Record<string, number> = {};
  for (const [id, pm] of Object.entries(model.players)) if (pm.value) values[id] = pm.value.value;
  /** The before season (every team after its pickups, mine as it stands) with my score replaced by `score`. */
  const season = (score: { mean: number[]; sd: number[] }): SeasonModel => ({ ...pickupSeasonModel(model), teams: model.teams.map((t) => ({ id: t.id, score: t.id === me ? score : (t.scoreWithPickups ?? t.score) })) });
  return { me, mine, myTeam, scale, values, season };
}

describe("the season list rated by Helps you, end to end (a made-up league, 400 seasons)", () => {
  const built = buildLeagueModelWithContext(league.snapshot, league.inputs, OPTS, CFG);
  const model = built.model;
  const w = model.waiverUpgrades;
  const ros = w?.ros;
  const c = context(model);
  const scorer = teamRosterScorer(league.snapshot, league.inputs, OPTS, CFG);
  const rated = (ros?.rows ?? []).filter((r) => r.rating);
  /** My roster with the move (the drop out, the pickup in its place; an open spot: him last). */
  const rosterWith = (r: WaiverRow): string[] => {
    const roster = league.snapshot.teams.find((t) => t.id === c.me)?.roster ?? [];
    return r.drop === null ? [...roster, r.playerId] : roster.map((id) => (id === r.drop ? r.playerId : id));
  };
  /** B for a move by hand: the two seasons on the seed's first `sims` seasons, B under the reward with the market term. */
  const bOf = (add: string, drop: string | null, roster: readonly string[], sims: number): number | null => {
    const after = scorer(roster, c.me);
    if (!after) throw new Error("no score");
    const run = (score: { mean: number[]; sd: number[] }) => seasonOdds(league.snapshot, c.season(score), { sims, seed: config.simulation.seed })?.teams.find((t) => t.teamId === c.me);
    const before = run(c.myTeam.score);
    const now = run(after);
    if (!before || !now) throw new Error("no odds");
    const dPrizes = runPrizeDeltas(prizeOddsOf(before), prizeOddsOf(now), false);
    return benefit({
      leagueType: "redraft",
      dPO: now.pPlayoffs - before.pPlayoffs,
      dCH: now.pTitle !== null && before.pTitle !== null ? now.pTitle - before.pTitle : null,
      dPrizes,
      gMine: marketGain([add], drop === null ? [] : [drop], c.values, model.market.waiverCredit),
      dynasty: null,
      myPPlayoffs: c.mine.pPlayoffs,
      lambda: null,
      kappa: protectValueWeight(defaultTradeSettings().protectValue),
      b3: c.scale.b3,
      reward: model.reward ?? null,
    }).b;
  };

  it("rates the list: B₃ the League model's, 100 seasons to screen and the best 2 rows on all 400, trade value weighed", () => {
    expect(ros?.rating).toEqual({ b3: c.scale.b3, screenSims: 100, shownSims: SIMS, finished: 2, weighs: "tradeValue", runs: { screen: expect.any(Number), shown: expect.any(Number) } });
    // The before run and at most one run per move on each block; the finishing at most the before and 2 rows.
    expect(ros?.rating?.runs?.shown).toBeLessThanOrEqual(3);
    expect(ros?.rating?.runs?.screen).toBeGreaterThan(1);
    expect(rated.length).toBeGreaterThan(2);
    expect(rated.filter((r) => r.rating?.sims === SIMS)).toHaveLength(2);
    expect(rated.filter((r) => r.rating?.sims === 100)).toHaveLength(rated.length - 2);
    // A row that can't be made has no rating; every other row has one.
    for (const r of ros?.rows ?? []) expect(r.rating !== undefined).toBe(r.gain !== null);
  });

  it("every row's B is the move's own: my roster as it stands against it with the one move, the same seasons, B with the market term", () => {
    for (const r of rated) {
      const b = bOf(r.playerId, r.drop, rosterWith(r), r.rating?.sims as number);
      expect(r.rating?.b, r.playerId).toBeCloseTo(b as number, 12);
      expect(r.rating?.helps, r.playerId).toBe(tradeScore(b, c.scale.b3));
    }
  });

  it("the drop is the candidate with the best B on the screening seasons (here every player of mine at his position can go)", () => {
    const roster = league.snapshot.teams.find((t) => t.id === c.me)?.roster ?? [];
    for (const r of rated.filter((x) => x.drop !== null)) {
      const pos = league.snapshot.players[r.playerId]?.pos;
      const candidates = roster.filter((id) => league.snapshot.players[id]?.pos === pos && model.players[id]);
      const chosen = bOf(r.playerId, r.drop, rosterWith(r), 100) as number;
      for (const k of candidates) {
        const b = bOf(r.playerId, k, roster.map((id) => (id === k ? r.playerId : id)), 100) as number;
        expect(chosen, `${r.playerId}: ${r.drop} against ${k}`).toBeGreaterThanOrEqual(b - 1e-12);
      }
    }
  });

  it("the rows go by Helps you as printed, then the lineup gain, points and id (compareRatedRows)", () => {
    const rows = ros?.rows ?? [];
    for (let i = 1; i < rows.length; i++) expect(compareRatedRows(rows[i - 1] as WaiverRow, rows[i] as WaiverRow, config.waivers.gainDecimals)).toBeLessThanOrEqual(0);
  });

  it("the one-week list names the season list's drop for the same free agent", () => {
    for (const r of w?.week?.rows ?? []) {
      const season = ros?.rows.find((x) => x.playerId === r.playerId);
      if (season && season.gain !== null) expect(r.drop, r.playerId).toBe(season.drop);
    }
  });

  it("is deterministic, and without the switch (the default) the list stays in points with the drop order's drops", () => {
    expect(buildLeagueModel(league.snapshot, league.inputs, OPTS, CFG).waiverUpgrades).toEqual(w);
    const plain = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, sims: SIMS }, CFG).waiverUpgrades;
    expect(plain?.ros?.rating).toBeNull();
    expect(plain?.ros?.rows.every((r) => r.rating === undefined)).toBe(true);
    // The same free agents, with or without the rating.
    expect(new Set(plain?.ros?.rows.map((r) => r.playerId))).toEqual(new Set(ros?.rows.map((r) => r.playerId)));
    expect(buildLeagueModel(league.snapshot, league.inputs, { ...OPTS, waiverRating: false }, CFG).waiverUpgrades).toEqual(plain);
  });

  it("a build that rates it times the rating's runs apart (screening, finishing); a build without it has no such stage", () => {
    let t = 0;
    const clock = () => (t += 1);
    const timed = Object.keys(buildLeagueModel(league.snapshot, league.inputs, { ...OPTS, clock }, CFG).timings);
    expect(timed.slice(-4)).toEqual(["star premium", "waiver rating: screening", "waiver rating: finishing", "total"]);
    expect(timed).toContain("waiver upgrades");
    const plain = Object.keys(buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, sims: SIMS, clock }, CFG).timings);
    expect(plain.filter((k) => k === "star premium" || k.startsWith("waiver rating"))).toEqual([]);
    expect(plain).toContain("waiver upgrades");
  });

  it("rated on its own request: a build made without the rating, rated afterwards (the League page's worker), gives these very lists", () => {
    const unrated = buildLeagueModelWithContext(league.snapshot, league.inputs, { ...OPTS, waiverRating: false }, CFG);
    expect(unrated.model.waiverUpgrades?.ros?.rating).toBeNull();
    expect(rateWaiverUpgrades(unrated, league.inputs, { ...OPTS, waiverRating: false })).toEqual(w);
    // Without my team, or a build without the lists: none.
    expect(rateWaiverUpgrades(unrated, league.inputs, { ...OPTS, waiverUpgrades: false })).toBeNull();
    expect(built.model.myTeamId).not.toBeNull();
  });

  it("a move's season the simulator refuses (a score that isn't a number) leaves the list in points: rateWaiverUpgrades answers null, never throws (review of wave C, RC-ENG-7)", () => {
    const fresh = buildLeagueModelWithContext(league.snapshot, league.inputs, { ...OPTS, waiverRating: false }, CFG);
    const id = fresh.model.waiverUpgrades?.ros?.rows.find((r) => r.gain !== null)?.playerId;
    const row = id === undefined ? undefined : fresh.context.table.rows.get(id);
    if (id === undefined || !row) throw new Error("no row to rate");
    // He starts every week (points no lineup tops), with a weekly spread that isn't a number: his move's season can't be drawn.
    const big = (xs: Float64Array) => Float64Array.from(xs, () => 1000);
    const nan = (xs: Float64Array) => Float64Array.from(xs, () => Number.NaN);
    (fresh.context.table.rows as Map<string, TableRow>).set(id, { ...row, ev: big(row.ev), cond: big(row.cond), evSd: nan(row.evSd), condSd: nan(row.condSd) });
    expect(rateWaiverUpgrades(fresh, league.inputs, { ...OPTS, waiverRating: false })).toBeNull();
  });

  it("no rating without a season simulated (sims 0) or without odds", () => {
    expect(buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, sims: 0, waiverRating: true }, CFG).waiverUpgrades?.ros?.rating).toBeNull();
    const unscheduled = buildLeagueModel({ ...league.snapshot, schedule: [] }, league.inputs, OPTS, CFG);
    expect(unscheduled.odds).toBeNull();
    expect(unscheduled.waiverUpgrades?.ros?.rating).toBeNull();
  });
});

describe("the rater on its own (createWaiverRater)", () => {
  const model = buildLeagueModel(league.snapshot, league.inputs, { ...OPTS, waiverRating: false }, CFG);
  const c = context(model);
  const built = buildSimSetup(league.snapshot, c.season(c.myTeam.score));
  if (!built) throw new Error("no setup");
  const myIndex = built.teamIds.indexOf(c.me);
  const normals = simNormals(config.simulation.seed, SIMS, built.setup.weeks.length, built.setup.teams.length);
  const before: WeeklyScore = { mean: Float64Array.from(c.myTeam.score.mean), sd: Float64Array.from(c.myTeam.score.sd) };
  const plus = (by: number): WeeklyScore => ({ mean: Float64Array.from(c.myTeam.score.mean, (m) => m + by), sd: Float64Array.from(c.myTeam.score.sd) });
  const make = (scoreAfter: (add: string, drop: string | null) => WeeklyScore | null, seen: WaiverRunChange[] = [], b: (add: string, drop: string | null, ch: WaiverRunChange) => number = (_a, _d, ch) => 100 * ch.dPO) =>
    createWaiverRater(
      {
        built,
        myIndex,
        normals,
        seed: config.simulation.seed,
        highScores: false,
        scoreAfter,
        benefitOf: (add, drop, ch) => {
          seen.push(ch);
          return { b: b(add, drop, ch) };
        },
        b3: c.scale.b3,
        weighs: null,
      },
      { waivers: { ratingScreenSims: 100, ratingFinishRows: 1 } },
    );

  it("a move that changes nothing: every change exactly 0, B_win 0 (common random numbers), and its run is the before run's", () => {
    const seen: WaiverRunChange[] = [];
    const result = make(() => before, seen).rate([{ playerId: "x", points: 1, options: [{ drop: null, keep: 0 }] }]);
    expect(seen.length).toBe(2);
    for (const ch of seen) {
      expect(ch.dPO).toBe(0);
      expect(ch.dCH).toBe(0);
      for (const v of Object.values(ch.dPrizes)) expect(v === null || v === 0).toBe(true);
    }
    expect(result.rows[0]?.rating).toEqual({ b: 0, bWin: null, helps: null, sims: SIMS });
    // Only the before runs were made: one per block.
    expect(result.runs).toEqual({ screen: 1, shown: 1 });
  });

  it("moves with the same score share one run; a better score has the higher B; the best row is finished on the shown block", () => {
    const result = make((add) => (add === "up" ? plus(5) : add === "down" ? plus(-5) : before)).rate([
      { playerId: "down", points: 1, options: [{ drop: "a", keep: 0 }] },
      { playerId: "up", points: 1, options: [{ drop: "a", keep: 0 }] },
      { playerId: "same", points: 1, options: [{ drop: "a", keep: 0 }] },
      { playerId: "up2", points: 1, options: [{ drop: "b", keep: 0 }] },
    ]);
    const [down, up, same] = result.rows;
    expect((up?.rating.b as number) > 0).toBe(true);
    expect((down?.rating.b as number) < 0).toBe(true);
    expect(same?.rating.b).toBe(0);
    expect(up?.rating.sims).toBe(SIMS);
    expect(down?.rating.sims).toBe(100);
    // "up2" scores as the before ("same"): no new run. Screening: before, down, up; shown: before, up.
    expect(result.runs).toEqual({ screen: 3, shown: 2 });
    expect(result.info).toEqual({ b3: c.scale.b3, screenSims: 100, shownSims: SIMS, finished: 1, weighs: null });
  });

  it("finishes no row screened below the floor (review of wave C, RC-ENG-5: it prints no gain either way), and keeps each row's B_win (UI-C-2)", () => {
    const rater = createWaiverRater(
      {
        built,
        myIndex,
        normals,
        seed: config.simulation.seed,
        highScores: false,
        scoreAfter: (add) => (add === "up" ? plus(5) : add === "down" ? plus(-5) : before),
        benefitOf: (_add, _drop, ch) => ({ b: 100 * ch.dPO, bWin: 50 * ch.dPO }),
        b3: c.scale.b3,
        weighs: null,
      },
      { waivers: { ratingScreenSims: 100, ratingFinishRows: 3, ratingFinishFloor: -0.1 } },
    );
    const result = rater.rate([
      { playerId: "down", points: 1, options: [{ drop: "a", keep: 0 }] },
      { playerId: "up", points: 1, options: [{ drop: "a", keep: 0 }] },
      { playerId: "same", points: 1, options: [{ drop: "a", keep: 0 }] },
    ]);
    const [down, up, same] = result.rows;
    expect((down?.rating.b as number) < -0.1 * c.scale.b3).toBe(true);
    // Room for 3, but the row far below 0 keeps its screened number: the other two are finished.
    expect(result.info.finished).toBe(2);
    expect([down?.rating.sims, up?.rating.sims, same?.rating.sims]).toEqual([100, SIMS, SIMS]);
    for (const r of [down, up, same]) expect(r?.rating.bWin).toBeCloseTo((r?.rating.b as number) / 2, 12);
    // Without the floor (absent from the config) every row of the room is finished, as before.
    const all = createWaiverRater(
      { built, myIndex, normals, seed: config.simulation.seed, highScores: false, scoreAfter: (add) => (add === "down" ? plus(-5) : before), benefitOf: (_a, _d, ch) => ({ b: 100 * ch.dPO }), b3: c.scale.b3, weighs: null },
      { waivers: { ratingScreenSims: 100, ratingFinishRows: 3 } },
    ).rate([{ playerId: "down", points: 1, options: [{ drop: "a", keep: 0 }] }]);
    expect(all.rows[0]?.rating.sims).toBe(SIMS);
    expect(all.rows[0]?.rating.bWin).toBeNull();
    expect(config.waivers.ratingFinishFloor).toBe(-0.1);
  });

  it("each row takes its best option; ties go to the lower keep value, then the smaller drop id; a move it can't price is left out", () => {
    const rater = make(
      (_add, drop) => (drop === "none" ? null : before),
      [],
      (_a, drop) => (drop === "best" ? 2 : 1),
    );
    const result = rater.rate([
      {
        playerId: "p",
        points: 1,
        options: [
          { drop: "low", keep: 0 },
          { drop: "best", keep: 5 },
        ],
      },
      {
        playerId: "q",
        points: 1,
        options: [
          { drop: "zz", keep: 1 },
          { drop: "yy", keep: 1 },
          { drop: "xx", keep: 3 },
        ],
      },
      { playerId: "r", points: 1, options: [{ drop: "none", keep: 0 }] },
    ]);
    expect(result.rows[0]?.option).toBe(1);
    expect(result.rows[1]?.option).toBe(1);
    expect(result.rows[2]).toBeNull();
  });
});
