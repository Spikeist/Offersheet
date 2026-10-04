/**
 * The league report's offline logic (scripts/league-report.ts buildReport and the Phase 3 checks behind it),
 * on Parker's committed sanitized ESPN fixture with synthetic model inputs: no network, no .env.local.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeEspnLeague } from "@/adapters/espn/normalize";
import { NOW, PARKER, fakeResolver, parkerBundle } from "@/adapters/espn/test-helpers";
import { helpsScale, tradeScore } from "@/engine/benefit";
import { config } from "@/engine/config";
import type { ModelInputs } from "@/engine/inputs";
import { buildLeagueModel, leagueMarginals, nearTieRos, teamWeeks } from "@/engine/league";
import type { FaMove, LeagueModel } from "@/engine/leagueModel";
import type { LeagueSnapshot, Pos } from "@/engine/model";
import { returnersOf } from "@/engine/optimizer";
import { finalLineups } from "@/engine/returners";
import { buildSimSetup, pickupSeasonModel, seasonOdds } from "@/engine/season";
import { GOALS } from "@/engine/settings";
import { simNormals } from "@/engine/sim";
import { syntheticInputs } from "@/engine/testLeague";
import { waiverOrderText } from "@/lib/importReport";
import { RISKY_BYES, RISKY_WIN_CHANCE, buildLeagueView, lastNflWeekOf, likelyStarters, rosterAfterPickups } from "@/lib/leagueView";
import { reportArgs } from "./lib/runMode";
import {
  FANTASYCALC_PLAYERS_UNAVAILABLE,
  GOAL_WORDS,
  OPTIMIZER_EXAMPLES,
  SCALE_GAINS,
  SE_BATCHES,
  asWeeklyResetData,
  b3Words,
  batchRuns,
  batchSe,
  benefitWin,
  blendLines,
  buildReport,
  byGoal,
  calibrationMatches,
  commandText,
  displayPath,
  dumpNote,
  duplicatePickups,
  fantasyCalcPlayersRead,
  flagValue,
  loadDump,
  noOpCheck,
  optimizerJudging,
  optimizerJudgingText,
  optimizerReport,
  ordinal,
  parseLeagueReport,
  pct,
  pickupsEffect,
  placeholders,
  pre4cText,
  remainingSchedule,
  resetWaiverOrder,
  scaleCheck,
  scaleFrom,
  seasonReport,
  simTiming,
  statusShort,
  titleUnknownReason,
  waiverOrderNote,
  waiverRanksPre4c,
  type SeasonReport,
  type SharedRun,
} from "./league-report";

const S = 8; // availability scenarios: fewer than the app's 32 keeps the suite quick; every rule is the same
const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);
const mean = (xs: readonly number[]) => sum(xs) / xs.length;
/** Sample SD (n − 1). */
const sd = (xs: readonly number[]) => Math.sqrt(sum(xs.map((x) => (x - mean(xs)) ** 2)) / (xs.length - 1));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const snapshot = placeholders(normalizeEspnLeague(parkerBundle(), { leagueId: PARKER.leagueId, resolver: fakeResolver(), now: NOW, swid: PARKER.swid }).snapshot);
const inputs = syntheticInputs(snapshot);
const clock = () => performance.now();

/** Week 4 under way at NOW: one NFL team kicked off an hour before, every other team plays later. */
function inProgressInputs(): ModelInputs {
  const teams = [...new Set(Object.values(snapshot.players).flatMap((p) => (p.nflTeam ? [p.nflTeam] : [])))].sort();
  const kickoffs: Record<string, string> = {};
  teams.forEach((t, i) => (kickoffs[t] = i === 0 ? "2026-09-29T19:00:00.000Z" : "2026-10-04T17:00:00.000Z"));
  return { ...inputs, nfl: { ...inputs.nfl, kickoffs: { 4: kickoffs } } };
}

describe("league report: the Trade Score arithmetic (CLAUDE.md §10)", () => {
  it("B = 100 × (w_PO ΔPO + w_CH ΔCH) under each goal's weights (config.benefit.goals; the default goal's without one)", () => {
    for (const g of GOALS) expect(benefitWin(0.1, 0.05, g)).toBeCloseTo(100 * (config.benefit.goals[g].playoffs * 0.1 + config.benefit.goals[g].title * 0.05), 12);
    // Win the title 0.15 / 0.85, Balanced 0.35 / 0.65 (the weights before Phase 4c), Make the playoffs 0.70 / 0.30.
    expect([benefitWin(0.1, 0.05, "title"), benefitWin(0.1, 0.05, "balanced"), benefitWin(0.1, 0.05, "playoffs")].map((x) => Number(x.toFixed(9)))).toEqual([5.75, 6.75, 8.5]);
    expect(config.benefit.goalDefault).toBe("title");
    expect(benefitWin(0.1, 0.05)).toBe(benefitWin(0.1, 0.05, "title"));
    expect(byGoal((g) => GOAL_WORDS[g])).toEqual({ title: "Win the title", balanced: "Balanced", playoffs: "Make the playoffs" });
  });

  it("Helps you on the self-calibrating scale (planner reply to Checkpoint 4c, A2): B₃ reads 63, a third of it 28, twice it 86, wherever B₃ is; hidden (null) for B ≤ 0", () => {
    // The planner's check in Parker's league (Checkpoint 3): B ≈ 2.05, 6.3 and 12.4 for +1, +3 and +6 a week; on B₃ = B(+3) they read 28, 63 and 86.
    expect([2.05, 6.3, 12.4].map((B) => tradeScore(B, 6.3))).toEqual([28, 63, 86]);
    for (const b3 of [0.5, 5.04, 9]) expect([b3 / 3, b3, 2 * b3].map((B) => tradeScore(B, b3))).toEqual([28, 63, 86]);
    expect(tradeScore(0, 6)).toBeNull();
    expect(tradeScore(-2, 6)).toBeNull();
    expect(tradeScore(Number.NaN, 6)).toBeNull();
  });

  it("prints probabilities with a decimal, exact 0% and 100% only when exact", () => {
    expect([0, 1, 0.0002, 0.9996, 0.1234, 0.5].map(pct)).toEqual(["0%", "100%", "<0.1%", ">99.9%", "12.3%", "50.0%"]);
    expect(pct(null)).toBe("–");
    expect(pct(Number.NaN)).toBe("–");
  });

  it("batchSe: the batches' SD × √(seasons per batch / seasons in the run), the batch-means standard error", () => {
    // 1, 2, 3, 4: SD √(5/3); four batches of 10 cover a 40-season run, so ÷ √4.
    expect(batchSe([1, 2, 3, 4], 10, 40)).toBeCloseTo(Math.sqrt(5 / 3) / 2, 12);
    // A remainder left out (3 batches of 3 from 10 seasons) still scales to the whole run: SD 1 × √(3 / 10).
    expect(batchSe([1, 2, 3], 3, 10)).toBeCloseTo(Math.sqrt(3 / 10), 12);
    expect(batchSe([5, 5, 5], 10, 30)).toBe(0);
    expect(batchSe([1], 10, 10)).toBeNaN();
    expect(batchSe([1, Number.NaN], 10, 20)).toBeNaN();
  });

  it("batchRuns: consecutive batches of the run's own seasons, as views into its matrix", () => {
    const W = 2;
    const T = 3;
    const run: SharedRun = { sims: 103, seed: 7, normals: simNormals(7, 103, W, T) };
    const parts = batchRuns(run, 20);
    expect(parts).toHaveLength(20);
    const per = 5 * W * T; // ⌊103 / 20⌋ = 5 seasons a batch; the last 3 seasons are left out
    parts.forEach((p, j) => {
      expect(p.sims).toBe(5);
      expect(p.normals).toMatchObject({ sims: 5, weeks: W, teams: T });
      expect(p.normals.z.buffer).toBe(run.normals.z.buffer);
      expect(p.normals.z.byteOffset).toBe(j * per * Float64Array.BYTES_PER_ELEMENT);
      expect(p.normals.z.length).toBe(per);
    });
    expect(batchRuns({ ...run, normals: simNormals(7, 7, W, T), sims: 7 }, 20).map((p) => p.sims)).toEqual(new Array(7).fill(1));
    expect(batchRuns({ ...run, sims: 1 })).toEqual([]);
    expect(batchRuns(run, 1)).toEqual([]);
  });
});

describe("league report: Parker's league (committed sanitized fixture) with synthetic inputs", () => {
  const model = buildLeagueModel(snapshot, inputs, { now: NOW, scenarios: S });
  const season: SeasonReport = seasonReport(snapshot, inputs, model, { now: NOW, clock, runs: 1, warmups: 0, buildRuns: 0 });
  const me = PARKER.myTeamId;

  it("has odds for every team from the model's own simulation: the headline with pickups, and as rosters stand", () => {
    const odds = season.odds as NonNullable<SeasonReport["odds"]>;
    expect(odds).not.toBeNull();
    // Phase 4c's one baseline: the report's odds are the League model's, the headline with every team's pickups.
    expect(odds).toBe(model.odds);
    expect(season.stand).toBe(model.oddsAsRostersStand);
    for (const o of [odds, season.stand as NonNullable<SeasonReport["stand"]>]) {
      expect(o.sims).toBe(config.simulation.finalSims);
      expect(o.teams.map((t) => t.rank).sort((a, b) => a - b)).toEqual(range(1, 10));
      expect(sum(o.teams.map((t) => t.pPlayoffs))).toBeCloseTo(o.playoffTeams, 9);
      expect(sum(o.teams.map((t) => t.pTitle as number))).toBeCloseTo(1, 9);
    }
    // The simulator's setup is the headline's: every team's scoreWithPickups.
    const built = season.built as NonNullable<SeasonReport["built"]>;
    expect(built.setup.teams.length).toBe(snapshot.teams.length);
    expect(buildSimSetup(snapshot, pickupSeasonModel(model))).toEqual(built);
  });

  it("lists every remaining regular-season game of mine with the simulator's scores with pickups, both win chances and the page's risk rule", () => {
    const rows = season.schedule as NonNullable<SeasonReport["schedule"]>;
    expect(rows.map((r) => r.week)).toEqual(range(4, 14));
    const my = model.teams.find((t) => t.id === me) as LeagueModel["teams"][number];
    const mine = my.scoreWithPickups as NonNullable<typeof my.scoreWithPickups>;
    expect(mine).toBeDefined();
    // The League page's bye rule (review POL-1): likely starters on the roster after my free-agent pickups, as the odds
    // count it, and none at a position I stream (K and D/ST by default).
    const streamed = new Set<Pos>(model.streaming.byTeam[me]?.positions ?? []);
    expect([...streamed].sort()).toEqual(["DEF", "K"]);
    const likely = likelyStarters(snapshot, model, me, { afterPickups: true });
    const starters = new Set(likely.filter((id) => !streamed.has(snapshot.players[id]?.pos as Pos)));
    const team = snapshot.teams.find((t) => t.id === me) as (typeof snapshot.teams)[number];
    expect(my.faMoves.length).toBeGreaterThan(0); // the pickups change the roster here, so "after pickups" is checked
    // The players who can be listed: the roster after my pickups and my IR returners (Alec Pierce: back in week 7, his
    // bye is week 13, so his NFL team's bye week is the one that counts).
    const pool = [...rosterAfterPickups(team.roster, my.faMoves), ...team.ir.filter((id) => my.players[id] !== undefined)].filter((id) => model.players[id] !== undefined);
    // My kicker is one of my likely starters, but I stream K: his week-6 bye is listed, never counted.
    const kicker = likely.find((id) => snapshot.players[id]?.pos === "K") as string;
    expect(snapshot.players[kicker]?.name).toBe("Trey Smack");
    expect(model.players[kicker]?.ros.bye.week).toBe(6);
    expect(rows.find((r) => r.week === 6)?.byes).toContainEqual({ id: kicker, starter: false });
    for (const r of rows) {
      const wi = model.weeks.indexOf(r.week);
      expect(r.weeks).toEqual([r.week]);
      expect(r.mine.mean).toBe(mine.mean[wi]);
      expect(r.mine.sd).toBeCloseTo(mine.sd[wi] as number, 12);
      const game = season.odds?.weekly.find((w) => w.week === r.week)?.games.find((g) => g.teamId === me);
      expect(r.opponentId).toBe(game?.opponentId);
      expect(r.pWin).toBe(game?.pWin);
      expect(r.pWinStand).toBe(season.stand?.weekly.find((w) => w.week === r.week)?.games.find((g) => g.teamId === me)?.pWin);
      const opp = model.teams.find((t) => t.id === r.opponentId);
      expect(r.theirs?.mean).toBe(opp?.scoreWithPickups?.mean[wi]);
      // On bye: exactly those players whose bye is this week; starters flagged by the page's own rule, listed first.
      const expected = pool.filter((id) => model.players[id]?.ros.bye.status === "upcoming" && model.players[id]?.ros.bye.week === r.week);
      expect(r.byes.map((b) => b.id).sort()).toEqual([...expected].sort());
      for (const b of r.byes) expect(b.starter).toBe(starters.has(b.id));
      const flagged = r.byes.map((b) => b.starter);
      expect(flagged).toEqual([...flagged].sort((a, b) => Number(b) - Number(a)));
      const low = Math.round((r.pWin as number) * 100) < Math.round(RISKY_WIN_CHANCE * 100);
      const many = r.byes.filter((b) => b.starter).length >= RISKY_BYES;
      expect(r.risk.some((x) => x.includes("to win"))).toBe(low);
      expect(r.risk.some((x) => x.includes("on bye"))).toBe(many);
      expect(r.underWay).toBe(false);
    }
  });

  // With common random numbers, more points in every week never cost a game, so P(playoffs) and expected wins
  // can't fall; title odds rise here too (not a theorem per season: a better seed changes the bracket path).
  it("the scale check from the one baseline: more lineup points raise my odds on the shared matrix, and B, B₃ and Helps you follow §10 under each goal", () => {
    const check = season.scale as NonNullable<SeasonReport["scale"]>;
    // Both baselines reproduce the model's own odds bit for bit: the headline (with pickups) and as rosters stand; and the
    // +3 row is the League model's own "Helps you" calibration run (step 8c), bit for bit.
    expect(season.scaleMatchesModel).toEqual({ pickups: true, stand: true, calibration: true });
    expect(check.from).toBe(0); // no week under way in this fixture
    expect(scaleFrom(model)).toBe(0);
    const rows = check.rows as NonNullable<typeof check.rows>;
    expect(rows.map((r) => r.gain)).toEqual([...SCALE_GAINS]);
    let last = { dPO: 0, dCH: 0, dEW: 0, B: byGoal(() => 0) };
    for (const r of rows) {
      expect(r.dPO).toBeGreaterThanOrEqual(last.dPO);
      expect(r.dCH).toBeGreaterThanOrEqual(last.dCH);
      expect(r.dEW).toBeGreaterThan(last.dEW);
      for (const g of GOALS) {
        expect(r.B[g]).toBeGreaterThan(last.B[g]);
        expect(r.B[g]).toBeCloseTo(benefitWin(r.dPO, r.dCH, g), 12);
        expect(r.score[g]).toBe(tradeScore(r.B[g], check.b3[g].value));
        // Every change carries its Monte Carlo standard error (batch means), which a real gain makes positive.
        expect(r.se.B[g]).toBeGreaterThan(0);
      }
      for (const k of ["dPO", "dCH", "dEW"] as const) expect(r.se[k]).toBeGreaterThanOrEqual(0);
      last = r;
    }
    expect([check.batches, check.batchSims]).toEqual([SE_BATCHES, config.simulation.finalSims / SE_BATCHES]);
    expect(check.titleUnknown).toBeNull();
    const at3 = rows.find((r) => r.gain === 3) as (typeof rows)[number];
    expect(check.calibration).toEqual({ dPO: at3.dPO, dCH: at3.dCH });
    expect(calibrationMatches(check, model.helpsCalibration)).toBe(true);
    expect(calibrationMatches(check, { ...(model.helpsCalibration as NonNullable<LeagueModel["helpsCalibration"]>), dPO: at3.dPO + 1e-9 })).toBe(false);
    expect(calibrationMatches(null, model.helpsCalibration)).toBeNull();
    for (const g of GOALS) {
      // B₃ is B(+3) under the goal (floored at helpsFloor: not here), with B(+3)'s standard error; +3 reads 63 by construction.
      expect(check.b3[g]).toEqual({ raw: at3.B[g], value: at3.B[g], floored: false, playoffOnly: false, se: at3.se.B[g] });
      expect(at3.score[g]).toBe(63);
      expect(rows.find((r) => r.gain === 1)?.score[g]).toBeLessThan(63);
      expect(rows.find((r) => r.gain === 6)?.score[g]).toBeGreaterThan(63);
    }
    // Without a +3 row among the gains, B₃ comes from its own run (no standard error), the same number.
    const pick3 = pickupSeasonModel(model);
    const built3 = buildSimSetup(snapshot, pick3) as NonNullable<ReturnType<typeof buildSimSetup>>;
    const odds = model.odds as NonNullable<LeagueModel["odds"]>;
    const run3 = { sims: odds.sims, seed: odds.seed, normals: simNormals(odds.seed, odds.sims, built3.setup.weeks.length, built3.setup.teams.length) };
    const mine3 = model.teams.find((t) => t.id === me) as LeagueModel["teams"][number];
    const only1 = scaleCheck(snapshot, pick3, me, mine3.scoreWithPickups as NonNullable<typeof mine3.scoreWithPickups>, run3, { gains: [1] });
    for (const g of GOALS) expect(only1?.b3[g]).toEqual({ ...check.b3[g], se: null });
    expect(only1?.rows?.[0]?.score).toEqual(rows.find((r) => r.gain === 1)?.score);
    // A zero gain moves nothing on the shared matrix, in the whole run or in any batch; nor does a gain from past the last week.
    const pick = pickupSeasonModel(model);
    const built = buildSimSetup(snapshot, pick) as NonNullable<ReturnType<typeof buildSimSetup>>;
    const seed = config.simulation.seed;
    const run = { sims: 1000, seed, normals: simNormals(seed, 1000, built.setup.weeks.length, built.setup.teams.length) };
    const my = model.teams.find((t) => t.id === me) as LeagueModel["teams"][number];
    const zeroes = { dPO: 0, dCH: 0, dEW: 0, B: byGoal(() => 0), score: byGoal(() => null), se: { dPO: 0, dCH: 0, dEW: 0, B: byGoal(() => 0) } };
    expect(scaleCheck(snapshot, pick, me, my.scoreWithPickups as NonNullable<typeof my.scoreWithPickups>, run, { gains: [0] })?.rows?.[0]).toMatchObject(zeroes);
    expect(scaleCheck(snapshot, pick, me, my.scoreWithPickups as NonNullable<typeof my.scoreWithPickups>, run, { gains: [3], from: model.weeks.length })?.rows?.[0]).toMatchObject(zeroes);
  });

  describe("the scale check's standard errors (review: 5,000 seasons still leave Monte Carlo error)", () => {
    const pick = pickupSeasonModel(model);
    const built = buildSimSetup(snapshot, pick) as NonNullable<ReturnType<typeof buildSimSetup>>;
    const W = built.setup.weeks.length;
    const T = built.setup.teams.length;
    const my = model.teams.find((t) => t.id === me) as LeagueModel["teams"][number];
    const base = my.scoreWithPickups as NonNullable<typeof my.scoreWithPickups>;
    const runOf = (seed: number, sims: number): SharedRun => ({ sims, seed, normals: simNormals(seed, sims, W, T) });
    const row3 = (run: SharedRun) => scaleCheck(snapshot, pick, me, base, run, { gains: [3] })?.rows?.[0] as NonNullable<NonNullable<ReturnType<typeof scaleCheck>>["rows"]>[number];

    it("come from batches that replay the run's own seasons: the batch values average to the run's, and SE = their SD / √batches", () => {
      const run = runOf(config.simulation.seed, 2000);
      const plus3 = { ...pick, teams: pick.teams.map((t) => (t.id === me ? { ...t, score: { mean: t.score.mean.map((m) => m + 3), sd: t.score.sd } } : t)) };
      const mine = (m: typeof pick, r: SharedRun) => seasonOdds(snapshot, m, { sims: r.sims, seed: r.seed, normals: r.normals })?.teams.find((t) => t.teamId === me) as NonNullable<LeagueModel["odds"]>["teams"][number];
      const parts = batchRuns(run);
      const before = parts.map((p) => mine(pick, p));
      const after = parts.map((p) => mine(plus3, p));
      const full = mine(pick, run);
      expect(mean(before.map((o) => o.pPlayoffs))).toBeCloseTo(full.pPlayoffs, 12);
      expect(mean(before.map((o) => o.pTitle as number))).toBeCloseTo(full.pTitle as number, 12);
      expect(mean(before.map((o) => o.expWins))).toBeCloseTo(full.expWins, 12);
      const row = row3(run);
      for (const g of GOALS) {
        const Bs = parts.map((_, j) => {
          const [b, a] = [before[j], after[j]] as [typeof full, typeof full];
          return benefitWin(a.pPlayoffs - b.pPlayoffs, (a.pTitle as number) - (b.pTitle as number), g);
        });
        expect(row.B[g]).toBeCloseTo(mean(Bs), 10);
        expect(row.se.B[g]).toBeCloseTo(sd(Bs) / Math.sqrt(SE_BATCHES), 12);
      }
    });

    // An SD from 24 seeds is itself good to about ±15%, so the band sits about 3 of those from 1 each side: it
    // catches a standard error off by a missing √batches (4.5×) or taken from one batch, not sampling noise.
    it("measure what another seed would change: B(+3)'s spread over 24 seeds is about its standard error", () => {
      const rows = range(1, 24).map((seed) => row3(runOf(seed, 1000)));
      const ratio = sd(rows.map((r) => r.B.title)) / mean(rows.map((r) => r.se.B.title));
      expect(ratio).toBeGreaterThan(0.5);
      expect(ratio).toBeLessThan(2);
    });
  });

  it("the scale check as rosters stand (the second line), and every team's pickups' own effect paired on the same seasons", () => {
    const pickups = season.scale as NonNullable<SeasonReport["scale"]>;
    const stand = season.scaleStand as NonNullable<SeasonReport["scaleStand"]>;
    const mineStand = season.stand?.teams.find((t) => t.teamId === me);
    expect(stand.base).toEqual({ pPlayoffs: mineStand?.pPlayoffs, pTitle: mineStand?.pTitle, expWins: mineStand?.expWins });
    expect(stand.rows?.map((r) => r.gain)).toEqual([...SCALE_GAINS]);
    // Every team's pickups move my odds (a fact of the fixture: some team picks someone up), and their effect is the
    // difference of the two baselines, with a standard error from the same batches paired.
    const p = season.pickups as NonNullable<SeasonReport["pickups"]>;
    expect(p).toEqual(pickupsEffect(pickups, stand, config.simulation.finalSims));
    expect(p.dPO).toBe(pickups.base.pPlayoffs - stand.base.pPlayoffs);
    expect(p.dCH).toBe((pickups.base.pTitle as number) - (stand.base.pTitle as number));
    expect(p.dEW).toBe(pickups.base.expWins - stand.base.expWins);
    expect(model.teams.some((t) => t.faMoves.length > 0)).toBe(true);
    expect(pickups.base).not.toEqual(stand.base);
    for (const k of ["dPO", "dCH", "dEW"] as const) expect(Number.isFinite(p.se[k])).toBe(true);
    // Unknown title odds: no effect.
    expect(pickupsEffect({ ...pickups, base: { ...pickups.base, pTitle: null } }, stand, config.simulation.finalSims)).toBeNull();
  });

  it("the free-agent optimizer: moves per team and their count distribution, and the named examples by the model's own rules (leagueMarginals)", () => {
    const marginals = leagueMarginals(snapshot, inputs, { now: NOW, scenarios: S });
    const opt = optimizerReport(snapshot, model, marginals);
    expect(opt.moves.map((m) => m.teamId)).toEqual(model.teams.map((t) => t.id));
    expect(opt.distribution).toHaveLength(config.freeAgentOptimizer.faMaxMoves + 1);
    expect(opt.distribution.reduce((a, b) => a + b, 0)).toBe(model.teams.length);
    opt.distribution.forEach((n, k) => expect(n, `${k} moves`).toBe(model.teams.filter((t) => t.faMoves.length === k).length));
    expect(opt.examples.map((e) => e.name)).toEqual(OPTIMIZER_EXAMPLES.map((e) => e.name));
    for (const ex of opt.examples) {
      // Both are on a roster in Parker's fixture.
      expect(ex.playerId, ex.name).not.toBeNull();
      expect(ex.teamId, ex.name).not.toBeNull();
      const tm = model.teams.find((t) => t.id === ex.teamId) as LeagueModel["teams"][number];
      const x = tm.players[ex.playerId as string] as NonNullable<(typeof tm.players)[string]>;
      expect(ex.cost).toEqual({ ev: x.mvLoseEv, scen: x.mvLoseScen, autoAdd: x.autoAdd });
      expect(ex.adds.map((a) => a.teamId)).not.toContain(ex.teamId);
      // A chip's maxOther is the best of these (floored at 0), and its gap what the report prints.
      if (ex.chip) {
        const best = Math.max(...ex.adds.map((a) => Math.max(0, a.scen as number)));
        expect(ex.chip.maxOther).toBeCloseTo(best, 9);
        expect(ex.chip.gap).toBeCloseTo(ex.chip.maxOther - ex.chip.cost, 9);
      }
    }
    expect(opt.examples[0]?.focusTeamId).toBe("1");
  });

  it("the no-op check: one setup twice is bitwise identical, and a rebuilt model moves nothing", () => {
    const n = season.noOp as NonNullable<SeasonReport["noOp"]>;
    expect(n.sameSetup.compared).toBeGreaterThan(10 * 10);
    expect(n.sameSetup.differing).toBe(0);
    expect(n.rebuilt).toEqual({ pPlayoffs: 0, pBye: 0, pTitle: 0, expWins: 0, score: 0, nulls: 0 });
    // Odds that really differ are caught: numbers from another simulation seed, labeled with the model's seed.
    const other = buildLeagueModel(snapshot, inputs, { now: NOW, scenarios: S, simSeed: 1 }).odds as NonNullable<LeagueModel["odds"]>;
    const built = buildSimSetup(snapshot, model) as NonNullable<ReturnType<typeof buildSimSetup>>;
    const moved = noOpCheck(snapshot, inputs, { ...model, odds: { ...other, seed: model.odds?.seed ?? config.simulation.seed } }, built, NOW);
    expect(moved.rebuilt?.pPlayoffs).toBeGreaterThan(0);
    expect(moved.rebuilt?.expWins).toBeGreaterThan(0);
    expect(moved.rebuilt?.score).toBe(0); // the weekly scores themselves are the same
  });

  it("times the simulator at 1,000 and 5,000 seasons", () => {
    expect(season.simTimings.map((t) => t.sims)).toEqual([config.simulation.screeningSims, config.simulation.finalSims]);
    for (const t of season.simTimings) for (const x of [t.normals, t.simulate, t.total]) expect(x).toBeGreaterThanOrEqual(0);
    // Medians of the timed runs, after the warm-ups: a clock that ticks 1 per call gives exactly 1, 1 and 2.
    let tick = 0;
    const built = season.built as NonNullable<SeasonReport["built"]>;
    expect(simTiming(built.setup, 1, 10, () => tick++, 3, 1)).toEqual({ sims: 10, normals: 1, simulate: 1, total: 2 });
    expect(tick).toBe(4 * 3);
  });
});

describe("league report: a week in progress", () => {
  const live = inProgressInputs();
  const model = buildLeagueModel(snapshot, live, { now: NOW, scenarios: S });

  it("the headline holds the week under way at its score as rosters stand, and the scale check's gain starts the week after", () => {
    expect(model.inProgressWeek).toBe(4);
    expect(scaleFrom(model)).toBe(1);
    // TeamModel.scoreWithPickups keeps the as-stands score for the week in progress (the model plays a week under way with today's rosters).
    for (const t of model.teams) {
      const p = t.scoreWithPickups as NonNullable<typeof t.scoreWithPickups>;
      expect([p.mean[0], p.sd[0]]).toEqual([t.score.mean[0], t.score.sd[0]]);
    }
    const season = seasonReport(snapshot, live, model, { now: NOW, clock, runs: 1, warmups: 0, buildRuns: 0 });
    expect(season.scale?.from).toBe(1);
    expect(season.scaleMatchesModel).toEqual({ pickups: true, stand: true, calibration: true });
    expect(model.helpsCalibration?.from).toBe(1);
    // A gain only in the week under way moves nothing: it's never added there.
    const pick = pickupSeasonModel(model);
    const built = buildSimSetup(snapshot, pick) as NonNullable<ReturnType<typeof buildSimSetup>>;
    const seed = config.simulation.seed;
    const run = { sims: 500, seed, normals: simNormals(seed, 500, built.setup.weeks.length, built.setup.teams.length) };
    const my = model.teams.find((t) => t.id === PARKER.myTeamId) as LeagueModel["teams"][number];
    const base = my.scoreWithPickups as NonNullable<typeof my.scoreWithPickups>;
    const fromWeek1 = scaleCheck(snapshot, pick, PARKER.myTeamId, base, run, { gains: [3], from: 1 })?.rows?.[0];
    const everyWeek = scaleCheck(snapshot, pick, PARKER.myTeamId, base, run, { gains: [3], from: 0 })?.rows?.[0];
    expect(fromWeek1?.dEW).toBeGreaterThan(0);
    expect(fromWeek1?.dEW).toBeLessThan(everyWeek?.dEW as number);
  });

  it("the schedule marks the week under way, and the report says the scale check starts the week after it", () => {
    const odds = model.odds as NonNullable<LeagueModel["odds"]>;
    const built = buildSimSetup(snapshot, pickupSeasonModel(model)) as NonNullable<ReturnType<typeof buildSimSetup>>;
    const rows = remainingSchedule(snapshot, model, odds, built, model.oddsAsRostersStand ?? null, lastNflWeekOf(live)) as NonNullable<ReturnType<typeof remainingSchedule>>;
    expect(rows[0]).toMatchObject({ week: 4, underWay: true });
    expect(rows.slice(1).every((r) => !r.underWay)).toBe(true);
    const { doc } = buildReport(snapshot, live, { now: NOW, clock, scenarios: S, runs: 1, warmups: 0, buildRuns: 0 });
    expect(doc).toContain("weeks 5–17: regular season and playoffs; week 4 is under way, and a trade's evaluation holds a week under way at its score as rosters stand, so the gain starts the week after");
    expect(doc).toContain("| 4 (under way: projected as if no game had started) |");
    expect(doc).toContain("a week in progress as if none of its games had started, with today's rosters and injury news");
  });
});

describe("league report: the remaining schedule's byes and risky weeks are the League page's (review POL-1)", () => {
  /**
   * The report's rows against the League page's (buildLeagueView's schedule) for one model: the same games, the same
   * likely starters on bye (the page's "On bye" names, in its order, are the report's bold ones) and the same risky weeks
   * and reasons. Returns how many listed players at a position the team streams are likely starters (excluded, never bold)
   * and how many weeks are flagged, so the callers can check the comparison isn't empty.
   */
  function compareWithPage(mine: LeagueSnapshot, modelInputs: ModelInputs, model: LeagueModel, label: string): { excluded: number; flagged: number } {
    const me = mine.myTeamId as string;
    const odds = model.odds as NonNullable<LeagueModel["odds"]>;
    const built = buildSimSetup(mine, pickupSeasonModel(model)) as NonNullable<ReturnType<typeof buildSimSetup>>;
    const rows = remainingSchedule(mine, model, odds, built, model.oddsAsRostersStand ?? null, lastNflWeekOf(modelInputs)) as NonNullable<ReturnType<typeof remainingSchedule>>;
    const page = buildLeagueView({ snapshot: mine, model, inputs: modelInputs, myTeamSource: "you", timeZone: "UTC", now: NOW.toISOString() }).schedule?.rows ?? [];
    expect(rows.map((r) => r.week), label).toEqual(page.map((p) => p.week));
    const streamed = new Set<Pos>(model.streaming.byTeam[me]?.positions ?? []);
    const likely = new Set(likelyStarters(mine, model, me, { afterPickups: true }));
    let excluded = 0;
    let flagged = 0;
    rows.forEach((r, k) => {
      const p = page[k];
      const at = `${label}, week ${r.week}`;
      const bold = r.byes.filter((b) => b.starter).map((b) => mine.players[b.id]?.name ?? b.id);
      expect(bold.join(", "), at).toBe(p?.byes?.title ?? "");
      expect(bold.length, at).toBe(p?.byes?.count ?? 0);
      expect(r.risk.length > 0, at).toBe(p?.risk !== null);
      expect(r.risk.some((x) => x.includes("likely starters on bye")), at).toBe(p?.risk?.reasons.includes("starters on bye") ?? false);
      expect(r.risk.some((x) => x.includes("to win")), at).toBe(p?.risk?.reasons.includes("to win") ?? false);
      for (const b of r.byes) {
        if (!streamed.has(mine.players[b.id]?.pos as Pos)) continue;
        expect(b.starter, `${at}: ${b.id} plays a position I stream`).toBe(false);
        if (likely.has(b.id)) excluded++;
      }
      if (r.risk.length) flagged++;
    });
    return { excluded, flagged };
  }

  it("for every team as mine: the same likely starters on bye, in the same order, and the same risky weeks; a streamed kicker or D/ST who's a likely starter is listed, never counted", () => {
    let excluded = 0;
    let flagged = 0;
    for (const t of snapshot.teams) {
      const mine: LeagueSnapshot = { ...snapshot, myTeamId: t.id };
      const got = compareWithPage(mine, inputs, buildLeagueModel(mine, inputs, { now: NOW, scenarios: 0 }), `team ${t.id}`);
      excluded += got.excluded;
      flagged += got.flagged;
    }
    // Not empty: weeks are flagged, and streamed likely starters on bye are left out (Trey Smack's week 6 on Parker's team).
    expect(flagged).toBeGreaterThan(0);
    expect(excluded).toBeGreaterThan(0);
  });

  it("on game day too, the week under way included (the page flags it as the report does)", () => {
    const live = inProgressInputs();
    const mine: LeagueSnapshot = { ...snapshot, myTeamId: PARKER.myTeamId };
    const model = buildLeagueModel(mine, live, { now: NOW, scenarios: 0 });
    expect(model.inProgressWeek).toBe(4);
    expect(compareWithPage(mine, live, model, "game day").flagged).toBeGreaterThan(0);
  });
});

describe("league report: conflicting ESPN signals when Sleeper's projections for this week didn't load (review AVAIL-4)", () => {
  it("prints the outage as \"didn't load\", not as Sleeper not projecting him", () => {
    const down = structuredClone(inputs);
    for (const p of Object.values(down.players)) delete p.sleeper[snapshot.currentWeek];
    const model = buildLeagueModel(snapshot, down, { now: NOW, scenarios: 0, sims: 0 });
    const noted = Object.values(model.players).filter((m) => m.availabilityNote);
    expect(noted.length).toBeGreaterThan(0);
    expect(noted.every((m) => m.availabilityNote?.sleeperUnavailable === true)).toBe(true);
    const { doc } = buildReport(snapshot, down, { now: NOW, clock, scenarios: 0, runs: 1, warmups: 0, buildRuns: 0 });
    const table = doc.slice(doc.indexOf("## Conflicting ESPN signals"), doc.indexOf("## FantasyCalc match rates"));
    expect(table).toContain("| didn't load |");
    expect(table).not.toContain("| not projected |");
  });
});

describe("league report: the whole offline report", () => {
  it("renders every Phase 3 section and keeps the Phase 2 and wave-1 sections", () => {
    const { doc, season, timing } = buildReport(snapshot, inputs, { now: NOW, clock, scenarios: S, runs: 1, warmups: 0, buildRuns: 1 });
    for (const heading of [
      "## Standings and playoff odds",
      "## Your remaining schedule",
      "## “Helps you” scale check",
      "## No-op check",
      "## Timings",
      "### Season simulation runtime",
      "## Projected starting-lineup points per week",
      "## Streaming positions",
      "## The free-agent optimizer (V*)",
      "## Needs and trade chips, every team",
      "## Conflicting ESPN signals: far return dates on game-time tags",
      "## FantasyCalc match rates (rostered QB/RB/WR/TE)",
      "## Depth: a bench player's value to his team, EV lineups vs scenario lineups",
      "## Rest-of-season and weekly projected points, every rostered player",
    ])
      expect(doc).toContain(heading);
    expect(doc).toContain(`Team ${PARKER.myTeamId} (you)`);
    // The schedule's byes are the League page's (review POL-1): after my pickups, my streamed kicker listed, not bold.
    expect(doc).toContain(`**Bold** = a likely starter whose bye counts, the League page's "On bye" rule (src/lib/leagueView.ts scheduleByeRule, the same code): in your best lineup after your free-agent pickups in at least half the weeks he plays, never one at a position you stream (K, D/ST: the streaming replacement covers his bye).`);
    const schedule = doc.slice(doc.indexOf("## Your remaining schedule"), doc.indexOf("## “Helps you” scale check"));
    expect(schedule).toMatch(/\n\| 6 \| [^\n]*\bTrey Smack\b[^\n]*\|\n/);
    expect(schedule).not.toContain("**Trey Smack**");
    expect(doc.match(/\*\*Pass\.\*\*/g)).toHaveLength(2);
    expect(doc).not.toContain("FAIL");
    expect(doc).toContain("Σ P(playoffs) = 6.000 (6 playoff teams) · Σ P(bye) = 2.000 (2 byes) · Σ P(title) = 1.000.");
    expect(doc).toContain("| +3 pt/wk |");
    expect(doc).toContain("B₃, the B of +3 points a week, under each goal (± B(+3)'s Monte Carlo standard error): Win the title **");
    // The scale check owns up to its Monte Carlo error: no "not noise" claim, ± on every change and on B₃,
    // B and Helps you under every goal, twice (the one baseline, and as rosters stand).
    expect(doc).not.toContain("not noise");
    expect(doc).toContain(`± is its Monte Carlo standard error, by batch means: the 5,000 seasons split into ${SE_BATCHES} batches of 250`);
    expect(doc).toContain("| Lineup gain | ΔPO | ΔCH | Δ expected wins | Win the title: B / Helps you | Balanced: B / Helps you | Make the playoffs: B / Helps you | Toy league B / score |");
    // +3 reads 63 under every goal, on both bases (each its own B₃).
    const row3 = /\| \+3 pt\/wk \| [+-]\d\.\d{4} ± \d\.\d{4} \| [+-]\d\.\d{4} ± \d\.\d{4} \| [+-]\d+\.\d{3} ± \d+\.\d{3} \| (-?\d+\.\d{2} ± \d+\.\d{2} \/ 63 \| ){3}≈ 5 \/ ≈ 63 \|/g;
    expect(doc.match(row3)).toHaveLength(2);
    expect(doc).toMatch(/: Win the title \*\*\d+\.\d{2} ± \d+\.\d{2}\*\*; Balanced \*\*\d+\.\d{2} ± \d+\.\d{2}\*\*; Make the playoffs \*\*\d+\.\d{2} ± \d+\.\d{2}\*\*\./);
    expect(doc).toContain("**From the one baseline (every team after its free-agent pickups)**");
    expect(doc).toContain("**As rosters stand** (TeamModel.score: every team as it is today, Checkpoint 4b's basis; Helps you on this basis's own B₃, its +3 row)");
    expect(doc).toContain("Baseline check: the baseline run reproduces the League model's own odds for your team bit for bit (LeagueModel.odds; same seed, same matrix), and so does the as-rosters-stand run (LeagueModel.oddsAsRostersStand). The +3 row is the League model's own \"Helps you\" calibration run bit for bit (LeagueModel.helpsCalibration: ΔPO and ΔCH).");
    if (season.pickups) expect(doc).toMatch(/Every team's free-agent pickups, for your team \(the one baseline against as rosters stand, the same seasons\): ΔPO [+-]\d\.\d{4} ± \d\.\d{4}, ΔCH [+-]\d\.\d{4} ± \d\.\d{4}, Δ expected wins [+-]\d+\.\d{3} ± \d+\.\d{3}\./);
    // Build timings: EV lineups and S scenarios, each without and with the simulation.
    expect(season.buildTimings.map((b) => [b.scenarios, b.sims])).toEqual([
      [0, 0],
      [0, config.simulation.finalSims],
      [S, 0],
      [S, config.simulation.finalSims],
    ]);
    expect(season.buildTimings.filter((b) => b.sims > 0).every((b) => b.simulation !== null)).toBe(true);
    expect(season.buildTimings.filter((b) => b.sims === 0).every((b) => b.simulation === null)).toBe(true);
    expect(Object.keys(timing)).toEqual(["engine, expected-value lineups only (season simulation included)", `engine, with ${S} availability scenarios (season simulation included)`]);
    // Placeholders only: the fixture's team names never reach the report.
    for (const t of snapshot.teams) expect(t.name).toBe(`Team ${t.id}`);
  });

  it("reports the free-agent optimizer (Phase 4): every team's pickups with both gains, how many moves teams make, and the named examples with their chip gaps", () => {
    const { doc, model, optimizer } = buildReport(snapshot, inputs, { now: NOW, clock, scenarios: S, runs: 1, warmups: 0, buildRuns: 0 });
    const section = doc.slice(doc.indexOf("## The free-agent optimizer (V*)"), doc.indexOf("## Needs and trade chips, every team"));
    expect(section).toContain(`while it gains at least ${config.freeAgentOptimizer.faMinGain}, at most ${config.freeAgentOptimizer.faMaxMoves} moves`);
    // What V* decides by (review finding: the report said EV after V* became scenario-judged): scenario lineups here.
    expect(optimizerJudging(snapshot, model)).toBe("scenario");
    expect(section).toContain(`Moves are judged by their gain in scenario lineups (S = ${S}), the lineups B and the lineup costs are measured in`);
    expect(section).toContain("The re-runs behind the lineup costs and MV_add below (from a team's optimized roster after a player leaves or joins) judge their moves by the expected-value gain.");
    expect(section).not.toContain("EV is what the optimizer decides by");
    expect(section).not.toContain("projected (expected-value) lineup pts");
    expect(section).toContain("| Team | # | Move | Gain, EV (for reference) | Gain, scenarios (decides) |");
    // The rule the words state is the one V* follows: every move clears faMinGain in scenario lineups, but for a near-tie cut
    // (optimizer.ts's header: the best move's free agent for a cheaper player, within config.lineups.dropNearTieWeekly a week
    // of its gain; since A3, planner reply to Checkpoint 4c, W is the best free agent left unclaimed, lower, so more cuts are
    // worth more than W and here one move gains less than faMinGain).
    const weights = teamWeeks(model, model.inProgressWeek, { ...config.lineups, playoffWeight: model.playoffWeight }).weights;
    const nearTie = nearTieRos(config.lineups.dropNearTieWeekly, weights);
    for (const t of model.teams) for (const m of t.faMoves) expect(m.gainScen as number).toBeGreaterThanOrEqual(config.freeAgentOptimizer.faMinGain - nearTie - 1e-9);
    expect(section).toMatch(/\*\*How many moves teams make:\*\* 0 moves: \d+ teams? · 1 move: \d+ teams? · /);
    const rows = section.split("\n").filter((l) => /^\| (Team \d+( \(you\))?)? \| \d \| add /.test(l));
    expect(rows).toHaveLength(model.teams.reduce((n, t) => n + t.faMoves.length, 0));
    for (const t of model.teams) for (const m of t.faMoves) expect(section).toContain(` | +${m.gainEv.toFixed(1)} | ${m.gainScen === null ? "–" : `${m.gainScen < 0 ? "-" : "+"}${Math.abs(m.gainScen).toFixed(1)}`} |`);
    // Bo Nix → Team 1: his MV_add there is printed, with the drop that makes room (or an open spot), and his chip status.
    const nix = optimizer.examples[0] as (typeof optimizer.examples)[number];
    expect(section).toContain(`- **Bo Nix (QB, `);
    const toOne = nix.adds.find((a) => a.teamId === "1");
    if (toOne) expect(section).toContain(`to Team 1: ${(toOne.scen as number) < 0 ? "-" : "+"}${Math.abs(toOne.scen as number).toFixed(1)}`);
    expect(section).toMatch(/- \*\*Bo Nix \(QB, [A-Z]+\)\*\*: on Team \d+.*; (a trade chip: gap|not a trade chip: gap)/);
    expect(section).toMatch(/- \*\*Christian McCaffrey \(RB, [A-Z]+\)\*\*: on Team \d+.*; (a trade chip: gap|not a trade chip: gap)/);
    // Team 1 either takes him (its row is marked) or the report says why it can't.
    if (toOne) expect(section).toContain("| Team 1 ← | ");
    else expect(section).toMatch(/Team 1 (can't take him: |is his own team)/);
    expect(nix.focusBlocked === null).toBe(toOne !== undefined);
    // Here it takes him. (Review of track A2: the first version reported "Team 1 can't take him" on these inputs, when
    // Team 1's own pickups filled its QB limit.) When its V* is at the QB limit it makes room at QB (L7); since V* judges
    // its moves in scenario lineups (review of track E, item 1) Team 1's pickups differ, so the drop is checked only then.
    expect(nix.focusBlocked).toBeNull();
    const team1 = model.teams.find((t) => t.id === "1");
    const vstar1 = (team1?.faMoves ?? []).reduce<string[]>((r, m) => (m.drop === null ? [...r, m.add] : r.map((id) => (id === m.drop ? m.add : id))), [...(snapshot.teams.find((t) => t.id === "1")?.roster ?? [])]);
    const qbLimit = snapshot.settings.positionLimits?.QB;
    if (qbLimit !== undefined && vstar1.filter((id) => snapshot.players[id]?.pos === "QB").length >= qbLimit) expect(snapshot.players[toOne?.drop ?? ""]?.pos).toBe("QB");
  });

  it("says what V* judges its moves by: expected value without scenarios, scenario lineups with them, expected value under starter limits", () => {
    expect(optimizerJudging(snapshot, { scenarios: 0 })).toBe("ev");
    expect(optimizerJudging(snapshot, { scenarios: S })).toBe("scenario");
    const limited = { ...snapshot, settings: { ...snapshot.settings, starterLimits: { QB: { min: 1, max: 1 } } } };
    expect(optimizerJudging(limited, { scenarios: S })).toBe("evLimits");
    expect(optimizerJudgingText("ev", 0)).toBe("by their expected-value gain (this run has no availability scenarios)");
    expect(optimizerJudgingText("evLimits", S)).toContain("by their expected-value gain (⚠️ under starter limits");
    const { doc } = buildReport(snapshot, inputs, { now: NOW, clock, scenarios: 0, runs: 1, warmups: 0, buildRuns: 0 });
    const section = doc.slice(doc.indexOf("## The free-agent optimizer (V*)"), doc.indexOf("## Needs and trade chips, every team"));
    expect(section).toContain("Moves are judged by their expected-value gain (this run has no availability scenarios).");
    expect(section).not.toContain("The re-runs behind");
    expect(section).toContain("| Team | # | Move | Gain, EV (decides) | Gain, scenarios |");
  });

  it("reports streaming (Phase 4): who streams what and why, each streamed position's replacement per week, this week's picks; chips with their cost a week and the starter tag", () => {
    const { doc, model } = buildReport(snapshot, inputs, { now: NOW, clock, scenarios: 0, runs: 1, warmups: 0, buildRuns: 0 });
    const section = doc.slice(doc.indexOf("## Streaming positions"), doc.indexOf("## Needs and trade chips, every team"));
    expect(section).toContain("the 3rd-best free agent at that position that week");
    // One row per team, as the model decided: my setting (K and D/ST by default), the others from their adds this season.
    for (const t of snapshot.teams) {
      const x = model.streaming.byTeam[t.id] as NonNullable<(typeof model.streaming.byTeam)[string]>;
      const why = x.source === "setting" ? "your setting" : x.positions.length ? "detected (2+ adds)" : "–";
      expect(section).toContain(`| Team ${t.id}${t.id === PARKER.myTeamId ? " (you)" : ""} | ${x.positions.join(", ") || "–"} | ${why} | K ${x.adds.K ?? 0}, DEF ${x.adds.DEF ?? 0}, QB ${x.adds.QB ?? 0}, TE ${x.adds.TE ?? 0} |`);
    }
    expect(model.streaming.byTeam[PARKER.myTeamId]).toMatchObject({ positions: ["K", "DEF"], source: "setting" });
    // Each streamed position's replacement, week by week, with its average.
    for (const pos of ["K", "DEF"] as const) {
      const rep = model.streaming.replacement[pos] as number[];
      expect(rep).toHaveLength(model.weeks.length);
      expect(section).toContain(`| ${pos} | ${rep.map((x) => x.toFixed(1)).join(" | ")} | ${(rep.reduce((a, b) => a + b, 0) / rep.length).toFixed(1)} |`);
    }
    // This week's picks: three kickers and three D/STs (the synthetic inputs have no opponents: "unknown").
    expect(model.streaming.picks.map((p) => p.pos)).toEqual(["K", "K", "K", "DEF", "DEF", "DEF"]);
    for (const pick of model.streaming.picks) expect(section).toContain(`| ${pick.pos} | ${snapshot.players[pick.playerId]?.name} (${pick.pos}, `);
    expect(section).toContain("| unknown | ");
    // Trade chips: their cost a week and the starter tag, read from the model.
    expect(doc).toContain("| Team | Player | Gap | Cost | Cost/wk | Starter | maxOther | Best team |");
    const chips = model.teams.flatMap((t) => t.chips);
    for (const c of chips) expect(doc).toContain(` | ${c.gap.toFixed(1)} | ${c.cost.toFixed(1)} | ${c.costPerWeek.toFixed(1)} | ${c.starter ? "starter" : "–"} | ${c.maxOther.toFixed(1)} | `);
  });

  it("after the regular season: playoff odds only, my team certainly out, and §8's season-over message", () => {
    // Every regular-season game decided (Team 3 loses all of its remaining ones), records recounted, week 15 now.
    const mine: string = PARKER.myTeamId;
    const finished = structuredClone(snapshot);
    finished.currentWeek = 15;
    for (const m of finished.schedule) {
      if (m.isPlayoff || m.decided || m.teamB === null) continue;
      const winnerId = m.teamB === mine ? m.teamA : m.teamA === mine ? m.teamB : m.teamA;
      m.decided = true;
      m.result = { pointsA: winnerId === m.teamA ? 110 : 90, pointsB: winnerId === m.teamA ? 90 : 110, winnerId };
    }
    for (const t of finished.teams) {
      const games = finished.schedule.filter((m) => !m.isPlayoff && m.result && m.teamB !== null && (m.teamA === t.id || m.teamB === t.id));
      const w = games.filter((m) => m.result?.winnerId === t.id).length;
      const ties = games.filter((m) => m.result?.winnerId === null).length;
      t.record = { w, l: games.length - w - ties, t: ties };
    }
    const { doc, season, model } = buildReport(finished, syntheticInputs(finished), { now: NOW, clock, scenarios: 0, runs: 1, warmups: 0, buildRuns: 0 });
    expect(model.weeks).toEqual([15, 16, 17]);
    expect(season.odds?.weekly).toEqual([]);
    expect(season.odds?.teams.find((t) => t.teamId === mine)?.eliminated).toBe(true);
    expect(doc).toContain(`Team ${mine} (you) (out)`);
    expect(doc).toContain("**Your season's over — no trade helps this year.**");
    expect(doc).toContain("The regular season is over: the standings are final, and only the playoffs are simulated.");
    expect(doc).toContain("No regular-season games of yours are left to simulate.");
    expect(doc.match(/\*\*Pass\.\*\*/g)).toHaveLength(2);
  });

  it("gives the reason title odds are unknown only when it can tell: too few playoff rounds, or a playoff game played without a result", () => {
    const opts = { now: NOW, clock, scenarios: 0, runs: 1, warmups: 0, buildRuns: 0 };
    const unknown = (reason: string) => `Title odds are unknown (${reason}; see the notes under Standings and playoff odds), so the rows' B can't be computed.`;
    // Two playoff weeks for a 6-team bracket, which needs 3 rounds (review: this used to blame a round played without a result).
    const short = structuredClone(snapshot);
    short.settings.playoffWeeks = [15, 16];
    short.schedule = short.schedule.filter((m) => m.week !== 17);
    const a = buildReport(short, syntheticInputs(short), opts);
    const rounds = "the league's playoff schedule has fewer rounds than a bracket of 6 teams needs";
    expect(a.season.odds?.playoffsKnown).toBe(true);
    expect(a.season.scale?.rows).toBeNull();
    expect(a.season.scale?.titleUnknown).toBe(rounds);
    expect(a.doc).toContain(unknown(rounds));
    expect(a.doc).not.toContain("a playoff game already played");
    const explained = (r: { season: SeasonReport }) => r.season.odds?.notes.some((n) => /title odds are unknown/i.test(n));
    expect(explained(a)).toBe(true); // the notes the message points to say why
    // Week 16, the regular season decided, and no result for the week-15 playoff games.
    const late = structuredClone(snapshot);
    late.currentWeek = 16;
    for (const m of late.schedule) {
      if (m.isPlayoff || m.decided || m.teamB === null) continue;
      m.decided = true;
      m.result = { pointsA: 100, pointsB: 90, winnerId: m.teamA };
    }
    const b = buildReport(late, syntheticInputs(late), opts);
    const unplayed = "a playoff game already played has no result we can read or match to the bracket";
    expect(b.season.odds?.playoffsKnown).toBe(false);
    expect(b.season.scale?.titleUnknown).toBe(unplayed);
    expect(b.doc).toContain(unknown(unplayed));
    expect(b.doc).not.toContain(rounds);
    expect(explained(b)).toBe(true);
    // Neither reason holds: no reason is made up (the page points to the notes alone).
    const odds = b.season.odds as NonNullable<SeasonReport["odds"]>;
    const mine = { pPlayoffs: 0.5, pTitle: null, expWins: 7 };
    expect(titleUnknownReason(snapshot, { ...odds, playoffsKnown: true }, mine)).toBeNull(); // Parker's 3 playoff weeks: enough rounds for 6 teams
    expect(titleUnknownReason(short, { ...odds, playoffsKnown: true }, mine)).toBe(rounds);
    expect(titleUnknownReason(short, odds, { ...mine, pTitle: 0.1 })).toBeNull(); // title odds known
  });

  it("title odds unknown: B₃ is still the app's, from the +3 run's ΔPO alone, and the +3 run is still the League model's (review of track SC, SC-3)", () => {
    const opts = { now: NOW, clock, scenarios: 0, runs: 1, warmups: 0, buildRuns: 0 };
    // Two playoff weeks for a 6-team bracket, which needs 3 rounds: every team's title odds are unknown.
    const short = structuredClone(snapshot);
    short.settings.playoffWeeks = [15, 16];
    short.schedule = short.schedule.filter((m) => m.week !== 17);
    const r = buildReport(short, syntheticInputs(short), opts);
    const check = r.season.scale as NonNullable<SeasonReport["scale"]>;
    expect(check.rows).toBeNull();
    const cal = r.model.helpsCalibration as NonNullable<LeagueModel["helpsCalibration"]>;
    expect(cal.dCH).toBeNull();
    expect(check.calibration).toEqual({ dPO: cal.dPO, dCH: null });
    expect(calibrationMatches(check, cal)).toBe(true);
    expect(r.season.scaleMatchesModel?.calibration).toBe(true);
    const myP = r.model.odds?.teams.find((t) => t.teamId === r.model.myTeamId)?.pPlayoffs ?? null;
    for (const g of GOALS) {
      // The app's own B₃ (evaluate.helpsScaleOf reads the same run through benefit.helpsScale): 100 × ΔPO₃ under every goal.
      const app = helpsScale(cal, { leagueType: short.settings.leagueType, myPPlayoffs: myP, goal: g, dynastyTotal: null });
      expect(app?.raw, g).toBeCloseTo(100 * cal.dPO, 12);
      expect(check.b3[g], g).toEqual({ raw: app?.raw, value: app?.b3, floored: app?.floored, playoffOnly: true, se: null });
    }
    expect(r.doc).toContain("by the rule every card's B follows when title odds are unknown: Win the title **");
    expect(b3Words(check)).toContain(`Win the title **${(check.b3.title.value as number).toFixed(2)}** (playoff odds only: title odds unknown)`);
    expect(r.doc).not.toContain("none (title odds unknown)");
  });

  it("measures the FantasyCalc ID match only when its player list was read, which the data shows (review of track R, R-7), and says why not otherwise", () => {
    const market = inputs.market as NonNullable<ModelInputs["market"]>;
    const opts = { now: NOW, clock, scenarios: 0, runs: 1, warmups: 0, buildRuns: 0 };
    const rates = (doc: string) => doc.slice(doc.indexOf("## FantasyCalc match rates"), doc.indexOf("## Depth"));
    // The player list read: knownIds names a player beyond the value rows (FantasyCalc lists him without a value).
    const read: ModelInputs = { ...inputs, market: { ...market, knownIds: [...market.knownIds, "fc-only"] } };
    expect(fantasyCalcPlayersRead(read.market as NonNullable<ModelInputs["market"]>)).toBe(true);
    const fresh = rates(buildReport(snapshot, read, opts).doc);
    expect(fresh).toContain("- ID match (FantasyCalc knows the player): ");
    expect(fresh).toContain("(target ≥ 98%)");
    expect(fresh).toContain("- Has a value in this format: ");
    // A saved list while another list came fresh (a dynasty league's season list, a keeper league's redraft list): the
    // server read the player list, so the match is measured (it said "wasn't asked" before).
    const savedRead: ModelInputs = { ...read, market: { ...(read.market as NonNullable<ModelInputs["market"]>), fallback: { kind: "saved", listDate: "2026-09-27T09:00:00.000Z" } } };
    const both = rates(buildReport(snapshot, savedRead, opts).doc);
    expect(both).toContain("- ID match (FantasyCalc knows the player): ");
    expect(both).toContain("- Has a value in the list from 2026-09-27T09:00:00.000Z: ");
    // Every list a saved copy: knownIds is the value rows only, so no match, and why.
    const saved: ModelInputs = { ...inputs, market: { ...market, fallback: { kind: "saved", listDate: "2026-09-27T09:00:00.000Z" } } };
    expect(fantasyCalcPlayersRead(saved.market as NonNullable<ModelInputs["market"]>)).toBe(false);
    const { doc } = buildReport(snapshot, saved, opts);
    expect(rates(doc)).toContain(
      "- ID match: not measured. MarketInputs.knownIds names no player beyond FantasyCalc's value lists, so its player list wasn't read in this build (or added nobody), and the match would only repeat the value rate below. FantasyCalc didn't answer this build (a saved list stands in, from 2026-09-27T09:00:00.000Z), and its player list is asked only when it serves a list fresh.",
    );
    expect(rates(doc)).not.toContain("(target ≥ 98%)");
    expect(rates(doc)).toContain("- Has a value in the list from 2026-09-27T09:00:00.000Z: ");
    // The data line names the fallback in the app's own words (market.fantasyCalcFallbackText).
    expect(doc).toContain("(⚠️ Trade values from Sep 27: FantasyCalc didn't answer.)");
    // FantasyCalc answered but its player list failed: its warning is the reason.
    const failed: ModelInputs = { ...inputs, warnings: [...inputs.warnings, { code: FANTASYCALC_PLAYERS_UNAVAILABLE, message: "FantasyCalc's player list couldn't be loaded (timeout).", platformPath: "players" }] };
    expect(rates(buildReport(snapshot, failed, opts).doc)).toContain(`Its player list couldn't be loaded (the \`${FANTASYCALC_PLAYERS_UNAVAILABLE}\` warning above).`);
    // Other value lists count as value rows too.
    expect(fantasyCalcPlayersRead({ knownIds: ["a", "b"], values: { a: 1 }, seasonValues: { b: 2 } })).toBe(false);
    expect(fantasyCalcPlayersRead({ knownIds: ["a", "c"], values: { a: 1 }, redraftValues: { b: 2 } })).toBe(true);
  });

  it("says why there are no odds when the rest of the schedule didn't load", () => {
    const partial = { ...snapshot, schedule: snapshot.schedule.filter((m) => m.decided) };
    const { doc, season } = buildReport(partial, inputs, { now: NOW, clock, scenarios: 0, runs: 1, warmups: 0, buildRuns: 0 });
    expect(season.odds).toBeNull();
    expect(doc).toContain("No odds: The schedule has no matchups for the rest of the regular season (weeks 4–14)");
    expect(doc).toContain("No odds, so no schedule (above).");
    expect(doc).not.toContain("FAIL");
  });
});

describe("league report: Phase 4b (the market blend, one free agent one team, IR returners, the offline mode)", () => {
  const report = buildReport(snapshot, inputs, { now: NOW, clock, scenarios: S, runs: 1, warmups: 0, buildRuns: 0, mode: "offline", dataNote: "Offline: a test dump.", generatedAt: new Date("2026-10-03T12:00:00.000Z") });
  const { doc, model, context } = report;
  const section = (heading: string): string => {
    const start = doc.indexOf(`\n## ${heading}`);
    if (start < 0) return "";
    const next = doc.indexOf("\n## ", start + 1);
    return doc.slice(start + 1, next < 0 ? undefined : next);
  };

  it("the header names the offline command (offline is the default since Phase 7a's A5), the day it was written and the data line", () => {
    expect(doc).toContain("Generated by `npm run league:report` on 2026-10-03 through the real adapters");
    expect(doc).toContain("**Data**\n\n- Offline: a test dump.\n");
  });

  it("the header prints the command line it ran with (review of track R: a bare command reads the newest dump, not the report's)", () => {
    const { doc: withCommand } = buildReport(snapshot, inputs, { now: NOW, clock, scenarios: 0, runs: 1, warmups: 0, buildRuns: 0, mode: "offline", command: "npm run league:report -- --dump data-local/parker-league-dev --team 3" });
    expect(withCommand).toContain("Generated by `npm run league:report -- --dump data-local/parker-league-dev --team 3` on ");
    const { doc: live } = buildReport(snapshot, inputs, { now: NOW, clock, scenarios: 0, runs: 1, warmups: 0, buildRuns: 0, mode: "live" });
    expect(live).toContain("Generated by `npm run league:report -- --live` on ");
    expect(commandText("league:report", [])).toBe("npm run league:report");
    expect(commandText("league:report", ["--dump data-local/x", null, undefined, false, "--team 3"])).toBe("npm run league:report -- --dump data-local/x --team 3");
    const root = path.join(tmpdir(), "repo");
    expect(displayPath(root, path.join(root, "data-local", "x"))).toBe("data-local/x");
    expect(displayPath(root, path.join(tmpdir(), "elsewhere", "dump"))).toBe("dump");
  });

  it("reads its own team and roster tables back (parseLeagueReport: the trade report's data changes since a checkpoint)", () => {
    const t = parseLeagueReport(doc);
    expect([...t.teams.keys()].sort()).toEqual(snapshot.teams.map((x) => x.id).sort());
    for (const team of model.teams) {
      const st = snapshot.teams.find((x) => x.id === team.id);
      const row = t.teams.get(team.id);
      expect(row?.ppw).toBe(Number((team.scen ?? team.ev).ppw.toFixed(1)));
      expect(row?.record).toBe(`${st?.record.w}-${st?.record.l}${st?.record.t ? `-${st.record.t}` : ""}`);
      expect(row?.pointsFor).toBe(Number(st?.pointsFor.toFixed(1)));
    }
    for (const st of snapshot.teams) {
      const roster = t.rosters.get(st.id);
      expect(roster?.size).toBe(st.roster.length + st.ir.length + st.taxi.length);
      for (const id of [...st.roster, ...st.ir, ...st.taxi]) {
        const p = snapshot.players[id];
        const got = roster?.get(p?.name ?? id);
        expect(got?.status).toBe(statusShort(p?.injury));
        expect(got?.slot).toBe(st.ir.includes(id) ? "ir" : st.taxi.includes(id) ? "taxi" : "active");
        const ros = model.players[id]?.ros.total;
        expect(got?.ros).toBe(ros === undefined ? null : Number(ros.toFixed(1)));
      }
    }
    // Tolerant: other tables and headings don't leak in; an empty document has nothing.
    expect(parseLeagueReport("").teams.size).toBe(0);
    expect(parseLeagueReport("### Team 4\n\n| Player | Pos | NFL | St | ROS |\n|---|---|---|---|---|\n| A B (IR) | WR | NYJ | IR | no projection |\n").rosters.get("4")?.get("A B")).toEqual({ status: "IR", ros: null, slot: "ir" });
  });

  it("the waiver order used (planner reply to Checkpoint 4b, answer 2), and the ⚠️ on data from before the 4c adapter with the weekly reset order", () => {
    const reset = resetWaiverOrder(model) as string[];
    const ranks = new Map((model.odds?.teams ?? []).map((x) => [x.teamId, x.rank]));
    expect(reset).toHaveLength(snapshot.teams.length);
    for (let i = 1; i < reset.length; i++) expect(ranks.get(reset[i - 1] as string) as number).toBeGreaterThan(ranks.get(reset[i] as string) as number);
    expect(resetWaiverOrder({ odds: null })).toBeNull();
    const name = (id: string) => `Team ${id}${id === PARKER.myTeamId ? " (you)" : ""}`;
    const order = model.faAllocation?.order ?? [];
    // The fixture through the 4c adapter: its order resets weekly, so waiverRank is the reset order (reverse standings),
    // the same as today's standings reversed, and the note names it as the Import Report does.
    expect(snapshot.settings.waiverOrderUsed).toBe("weeklyReset");
    expect(waiverRanksPre4c(snapshot)).toBe(false);
    expect(order).toEqual(reset);
    const note = waiverOrderNote(snapshot, order, reset, PARKER.myTeamId, name);
    expect(note).toBe(`Waiver order used: ${waiverOrderText(snapshot)}: ${order.map(name).join(" > ")}; you claim ${ordinal(order.indexOf(PARKER.myTeamId) + 1)}.`);
    expect(section("The free-agent optimizer (V*)")).toContain(note);
    expect(doc).toContain(`- Waiver order used: ${waiverOrderText(snapshot)}\n`);
    // Data from before the 4c adapter (no waiverOrderUsed, every team ranked: ESPN's live order then): the ⚠️ and the reset order.
    const { waiverOrderUsed: _used, ...settings } = snapshot.settings;
    void _used;
    const old = { ...snapshot, settings };
    expect(waiverRanksPre4c(old)).toBe(true);
    expect(waiverRanksPre4c({ ...old, teams: old.teams.map((t, i) => (i === 0 ? { ...t, waiverRank: undefined } : t)) })).toBe(false);
    const live = [...order].reverse();
    const warned = waiverOrderNote(old, live, reset, PARKER.myTeamId, name);
    expect(warned).toMatch(/^⚠️ This data comes from before the 4c adapter: its waiver ranks are ESPN's live order on the day of the import \(/);
    expect(warned).toContain(`The weekly reset order from today's standings (reverse standings): ${reset.map(name).join(" > ")}; you would claim ${ordinal(reset.indexOf(PARKER.myTeamId) + 1)}.`);
    expect(waiverOrderNote(old, reset, reset, PARKER.myTeamId, name)).toContain("Today the two orders are the same.");
    expect(waiverOrderNote(old, live, null, PARKER.myTeamId, name)).not.toContain("reset order from today's standings");
    expect([ordinal(1), ordinal(2), ordinal(3), ordinal(4), ordinal(11), ordinal(12), ordinal(21), ordinal(103)]).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "21st", "103rd"]);
  });

  it("puts a dump from before the 4c adapter on the weekly reset order first (asWeeklyResetData; review of track R, R-4): the model, the data line and the allocation line", () => {
    const name = (id: string) => `Team ${id}${id === PARKER.myTeamId ? " (you)" : ""}`;
    // The fixture through the 4c adapter: its waiverRank is the reset order (ESPN's playoff seeds reversed).
    const reset = model.faAllocation?.order ?? [];
    expect(reset).toHaveLength(snapshot.teams.length);
    // The same data as a dump from before the 4c adapter: no waiverOrderUsed, no live rank apart, ESPN's live order in waiverRank.
    const live = [...reset].reverse();
    const { waiverOrderUsed: _used, ...settings } = snapshot.settings;
    void _used;
    const old: LeagueSnapshot = {
      ...snapshot,
      settings,
      teams: snapshot.teams.map((t) => {
        const { liveWaiverRank: _live, ...rest } = t;
        void _live;
        return { ...rest, waiverRank: live.indexOf(t.id) + 1 };
      }),
    };
    expect(waiverRanksPre4c(old)).toBe(true);
    const conv = asWeeklyResetData(old);
    // The dump carries no playoff seeds, so the reset order is the overall standings reversed (worst win %, then fewer points
    // for): in this league, seeded by points for, the adapter's own order.
    expect(conv.pre4c).toEqual({ live, used: reset, waiverOrderUsed: "weeklyReset" });
    expect(conv.snapshot.settings.waiverOrderUsed).toBe("weeklyReset");
    expect(conv.snapshot.teams.map((t) => [t.waiverRank, t.liveWaiverRank])).toEqual(snapshot.teams.map((t) => [reset.indexOf(t.id) + 1, live.indexOf(t.id) + 1]));
    const b = buildReport(old, inputs, { now: NOW, clock, scenarios: 0, runs: 1, warmups: 0, buildRuns: 0 });
    expect(b.pre4c).toEqual(conv.pre4c);
    expect(b.snapshot).toEqual(conv.snapshot);
    expect(b.model.faAllocation?.order).toEqual(reset);
    const p = conv.pre4c as NonNullable<typeof conv.pre4c>;
    const text = pre4cText(p, PARKER.myTeamId, name);
    expect(text).toMatch(/^⚠️ This dump comes from before the 4c adapter, so its waiver ranks are ESPN's live order on the day of the import \(/);
    expect(text).toContain(`every number here runs on the weekly reset order from today's standings: ${reset.map(name).join(" > ")}; you claim ${ordinal(reset.indexOf(PARKER.myTeamId) + 1)},`);
    expect(b.doc).toContain(`- Waiver order used: Weekly reset (reverse standings). ${text}\n`);
    expect(b.doc).toContain(`${waiverOrderNote(b.snapshot, reset, resetWaiverOrder(b.model), PARKER.myTeamId, name, p)}`);
    expect(waiverOrderNote(b.snapshot, reset, resetWaiverOrder(b.model), PARKER.myTeamId, name, p)).toBe(`Waiver order used: Weekly reset (reverse standings): ${reset.map(name).join(" > ")}; you claim ${ordinal(reset.indexOf(PARKER.myTeamId) + 1)}. ${text}`);
    // Data from the 4c adapter comes through unchanged.
    expect(asWeeklyResetData(snapshot)).toEqual({ snapshot, pre4c: null });
    expect(report.pre4c).toBeNull();
    expect(report.snapshot).toBe(snapshot);
  });

  it("the market blend: the build's own blend per position, the players it moved, and the League page's breakdown lines", () => {
    const b = report.blend;
    const blend = context.lp.blend;
    expect(b.weight).toBe(config.marketBlend.weight);
    expect(b.positions).toEqual(blend.positions);
    expect(b.positions.some((p) => p.blended)).toBe(true); // a fact of the synthetic inputs
    expect(b.reached).toBe(blend.factors.size);
    expect(b.scaled).toBe([...blend.factors.values()].filter((f) => f.ours > 0).length);
    expect(b.moved).toBe(Object.values(model.players).filter((pm) => pm.blend).length);
    expect(b.moved).toBeGreaterThan(0);
    const view = buildLeagueView({ snapshot, model, inputs, myTeamSource: "you", timeZone: "UTC", now: NOW.toISOString() });
    expect(b.rosterLines).toBe(view.rosters.flatMap((r) => r.players).filter((p) => p.blend).length);
    expect(b.freeAgentLines).toBe(view.freeAgents.flatMap((g) => g.players).filter((p) => p.blend).length);
    // The page's "no comparison" lines are players whose market number is their own; the page lists some of them.
    expect(b.noComparison).toBeLessThanOrEqual(b.ownPoint);
    const s = section("Market-blended projections");
    expect(s).toContain("| Position | Players with a real value | Curve points (healthy, a game left) | Blended |");
    for (const p of b.positions) expect(s).toContain(`| ${p.pos} | ${p.players} | ${p.fit} | ${p.blended ? "yes" : "no (under 10 curve points)"} |`);
    expect(s).toContain(`- Players the blend reaches: **${b.reached}** (${b.scaled} with a base rate above 0); players whose rest-of-season points it moved (PlayerModel.blend): **${b.moved}**.`);
    expect(s).toContain(`**${b.rosterLines + b.freeAgentLines}** lines, ${b.rosterLines} on the rosters and ${b.freeAgentLines} in the free-agent lists; **${b.noComparison}** of them read "Trade market: no comparison"`);
    // The clamp (Phase 4c, planner change 4; review of track R, R-6): in the formula, and every factor it cut.
    const [lo, hi] = config.marketBlend.factorClamp;
    expect(b.clamp).toEqual(config.marketBlend.factorClamp);
    expect(s).toContain(`Then the factor f = b′ / b is clamped to [${lo}, ${hi}] (config.marketBlend.factorClamp; Phase 4c, planner reply to Checkpoint 4b, change 4`);
    expect(b.clamped.map((c) => c.id).sort()).toEqual([...blend.factors].filter(([, f]) => f.clamped).map(([id]) => id).sort());
    for (const c of b.clamped) expect(c.f).toBe(c.bound === "high" ? hi : lo);
    expect(s).toContain(b.clamped.length ? `- The clamp cut **${b.clamped.length}** factor` : `- The clamp cut no factor (every f within [${lo}, ${hi}]).`);
    // A clamped factor is listed with its factor before and after the clamp, the most extreme first.
    const [id, f] = [...blend.factors].find(([, x]) => x.ours > 0) as [string, NonNullable<ReturnType<typeof blend.factors.get>>];
    const cut = new Map(blend.factors);
    cut.set(id, { ...f, fRaw: 2, f: hi, used: f.ours * hi, clamped: "high" });
    cut.set("zz-low", { ...f, fRaw: 0.7, f: lo, used: f.ours * lo, clamped: "low" });
    const lines = blendLines(snapshot, inputs, model, { lp: { ...context.lp, blend: { ...blend, factors: cut } } }, NOW);
    expect(lines.clamped).toContainEqual({ id, fRaw: 2, f: hi, bound: "high" });
    expect(lines.clamped).toContainEqual({ id: "zz-low", fRaw: 0.7, f: lo, bound: "low" });
    const far = (x: number) => Math.abs(Math.log(x));
    for (let i = 1; i < lines.clamped.length; i++) expect(far((lines.clamped[i - 1] as (typeof lines.clamped)[number]).fRaw)).toBeGreaterThanOrEqual(far((lines.clamped[i] as (typeof lines.clamped)[number]).fRaw));
  });

  it("one free agent, one team: the allocation's basis and order, and no free agent in two teams' pickups", () => {
    expect(model.faAllocation?.basis).toBe("waiver"); // the fixture's teams carry waiver ranks (the 4c adapter: the weekly reset order)
    expect(model.faAllocation?.order).toHaveLength(snapshot.teams.length);
    expect(duplicatePickups(model.teams)).toEqual([]);
    const s = section("The free-agent optimizer (V*)");
    expect(s).toContain(`**One free agent, one team** (§7; planner reply to Checkpoint 4, change 3): teams claim free agents in the league's waiver order (Team.waiverRank): ${(model.faAllocation?.order ?? []).map((id) => `Team ${id}${id === PARKER.myTeamId ? " (you)" : ""}`).join(" > ")};`);
    expect(s).toContain("Free agents in two or more teams' pickups: **0**.");
    expect(s).not.toContain("Each team is optimized on its own");
    // Each team counted once, most teams first.
    const move = (add: string): FaMove => ({ add, drop: null, gainEv: 5, gainScen: 5 });
    expect(duplicatePickups([{ id: "1", faMoves: [move("a"), move("a"), move("b")] }, { id: "2", faMoves: [move("a")] }, { id: "3", faMoves: [move("b"), move("a")] }])).toEqual([
      { playerId: "a", teamIds: ["1", "2", "3"] },
      { playerId: "b", teamIds: ["1", "3"] },
    ]);
  });

  it("IR returners: every IR player with his expected return week, whether he rejoins, and the drop his return forces as the team stands", () => {
    const rows = report.ir;
    expect(rows.map((r) => r.playerId).sort()).toEqual(context.work.flatMap((t) => t.ir).sort());
    expect(rows.length).toBeGreaterThan(0); // Parker's fixture has IR players
    for (const r of rows) {
      const t = context.work.find((w) => w.team.id === r.teamId);
      if (!t) throw new Error(`no team ${r.teamId}`);
      expect(r.R).toBe(context.returnWeek(r.playerId));
      expect(r.returner).toBe(returnersOf(t.stream).some((x) => x.id === r.playerId));
      expect(r.status).toBe(snapshot.players[r.playerId]?.injury ?? null);
      const final = finalLineups(context.returnerSetup, t.ids, t.stream, { ev: t.solved, scen: t.scen });
      const d = final.displaced.find((x) => x.returner === r.playerId);
      expect(r.drop).toEqual(d ? { playerId: d.id, week: context.lp.weeks.weeks[d.from], self: d.id === r.playerId } : null);
    }
    expect(rows.some((r) => r.drop)).toBe(true); // a fact of the fixture: some team is full at a return
    const s = section("IR returners");
    expect(s).toContain("| Team | IR player | Status | ESPN return week | Expected return week R | Rejoins the lineups | From R, the team as it stands drops |");
    expect(s.split("\n").filter((l) => /^\| Team \d+/.test(l))).toHaveLength(rows.length);
  });

  it("the offline dump: --dump <dir> (--offline its alias) and --team, the loader (placeholders again, waiver ranks filled in) and the data line", () => {
    expect(flagValue(["--team", "3"], "--team")).toBe("3");
    expect(flagValue(["--team", "--offline"], "--team")).toBeUndefined();
    expect(flagValue([], "--team")).toBeUndefined();
    const dir = mkdtempSync(path.join(tmpdir(), "league-report-"));
    try {
      const raw = { ...snapshot, name: "Secret League", teams: snapshot.teams.map((t) => ({ ...t, name: `Real Name ${t.id}`, waiverRank: undefined })) };
      writeFileSync(path.join(dir, "snapshot.json"), JSON.stringify(raw));
      writeFileSync(path.join(dir, "inputs.json"), JSON.stringify(inputs));
      writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ now: NOW.toISOString() }));
      writeFileSync(path.join(dir, "waiver-ranks.json"), JSON.stringify({ readAt: "2026-10-03T18:04:58.416Z", ranks: Object.fromEntries(snapshot.teams.map((t, i) => [t.id, i + 1])) }));
      // The command line names the folder (scripts/lib/runMode.ts reportArgs): --dump, or --offline, its alias.
      expect(reportArgs(["--dump", dir, "--team", "3"], path.dirname(dir), { env: {} })).toEqual({ dump: dir, newest: false, team: "3", cookies: null });
      expect(reportArgs(["--offline", path.basename(dir)], path.dirname(dir), { env: {} })).toMatchObject({ dump: dir, newest: false });
      const d = loadDump(dir, "3");
      expect(d.now.toISOString()).toBe(NOW.toISOString());
      expect(d.snapshot.name).toBe("League 1");
      expect(d.snapshot.teams.every((t) => t.name === `Team ${t.id}`)).toBe(true);
      expect(d.snapshot.myTeamId).toBe("3");
      expect(d.snapshot.teams.map((t) => t.waiverRank)).toEqual(snapshot.teams.map((_, i) => i + 1));
      expect(d.waiverRanks).toEqual({ readAt: "2026-10-03T18:04:58.416Z", teams: snapshot.teams.length });
      expect(dumpNote(path.dirname(dir), dir, d)).toBe(
        `Offline: the git-ignored dump in ${path.basename(dir)}/ (made by the app's own import and model-inputs builder at ${NOW.toISOString()}, team and owner names placeholders); the engine's "now" is that moment. Waiver ranks for ${snapshot.teams.length} teams come from the dump folder's waiver-ranks.json (read from ESPN at 2026-10-03T18:04:58.416Z): the dump was made before the adapter read them.`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
