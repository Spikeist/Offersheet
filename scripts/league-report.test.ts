/**
 * The league report's offline logic (scripts/league-report.ts buildReport and the Phase 3 checks behind it),
 * on Parker's committed sanitized ESPN fixture with synthetic model inputs: no network, no .env.local.
 */
import { describe, expect, it } from "vitest";
import { normalizeEspnLeague } from "@/adapters/espn/normalize";
import { NOW, PARKER, fakeResolver, parkerBundle } from "@/adapters/espn/test-helpers";
import { config } from "@/engine/config";
import type { ModelInputs } from "@/engine/inputs";
import { buildLeagueModel, leagueMarginals } from "@/engine/league";
import type { LeagueModel } from "@/engine/leagueModel";
import { buildSimSetup, seasonOdds } from "@/engine/season";
import { simNormals } from "@/engine/sim";
import { syntheticInputs } from "@/engine/testLeague";
import { RISKY_BYES, RISKY_WIN_CHANCE, likelyStarters } from "@/lib/leagueView";
import {
  OPTIMIZER_EXAMPLES,
  SCALE_GAINS,
  SE_BATCHES,
  bRefFor,
  batchRuns,
  batchSe,
  benefitWin,
  buildReport,
  noOpCheck,
  optimizerJudging,
  optimizerJudgingText,
  optimizerReport,
  pct,
  placeholders,
  remainingSchedule,
  rosterScorer,
  scaleCheck,
  seasonReport,
  simTiming,
  titleUnknownReason,
  tradeScore,
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
  it("B = 100 × (0.35 ΔPO + 0.65 ΔCH) from config.benefit.weights", () => {
    expect(benefitWin(0.1, 0.05)).toBeCloseTo(100 * (config.benefit.weights.playoffs * 0.1 + config.benefit.weights.title * 0.05), 12);
    expect(benefitWin(0.1, 0.05)).toBeCloseTo(6.75, 12);
  });

  it("the Trade Score matches §10's sample values (B_ref 6 since Checkpoint 3), and is hidden (null) for B ≤ 0", () => {
    expect(config.benefit.bRef).toBe(6);
    expect([1, 2, 3, 5, 8, 10].map((B) => tradeScore(B))).toEqual([15, 28, 39, 57, 74, 81]);
    // The planner's check in Parker's league (Checkpoint 3): B ≈ 2.05, 6.3 and 12.4 for +1, +3 and +6 a week score 29, 65 and 87.
    expect([2.05, 6.3, 12.4].map((B) => tradeScore(B))).toEqual([29, 65, 87]);
    // The old B_ref 5 gave §10's earlier samples.
    expect([1, 2, 3, 5, 8, 10].map((B) => tradeScore(B, 5))).toEqual([18, 33, 45, 63, 80, 86]);
    expect(tradeScore(0)).toBeNull();
    expect(tradeScore(-2)).toBeNull();
    expect(tradeScore(Number.NaN)).toBeNull();
  });

  it("bRefFor gives the B_ref that maps a B to a score: −B / ln 0.37 for 63", () => {
    expect(bRefFor(5, 63)).toBeCloseTo(-5 / Math.log(0.37), 12);
    for (const B of [1.7, 4.2, 9]) expect(tradeScore(B, bRefFor(B, 63) as number)).toBe(63);
    expect(bRefFor(0, 63)).toBeNull();
    expect(bRefFor(-1, 63)).toBeNull();
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

  it("has odds for every team from the model's own simulation", () => {
    const odds = season.odds as NonNullable<SeasonReport["odds"]>;
    expect(odds).not.toBeNull();
    expect(odds.sims).toBe(config.simulation.finalSims);
    expect(odds.teams.map((t) => t.rank).sort((a, b) => a - b)).toEqual(range(1, 10));
    expect(sum(odds.teams.map((t) => t.pPlayoffs))).toBeCloseTo(odds.playoffTeams, 9);
    expect(sum(odds.teams.map((t) => t.pTitle as number))).toBeCloseTo(1, 9);
  });

  it("lists every remaining regular-season game of mine with the simulator's scores, my win chance and the page's risk rule", () => {
    const rows = season.schedule as NonNullable<SeasonReport["schedule"]>;
    expect(rows.map((r) => r.week)).toEqual(range(4, 14));
    const my = model.teams.find((t) => t.id === me) as LeagueModel["teams"][number];
    const starters = new Set(likelyStarters(snapshot, model, me));
    const team = snapshot.teams.find((t) => t.id === me) as (typeof snapshot.teams)[number];
    for (const r of rows) {
      const wi = model.weeks.indexOf(r.week);
      expect(r.weeks).toEqual([r.week]);
      expect(r.mine.mean).toBe(my.score.mean[wi]);
      expect(r.mine.sd).toBeCloseTo(my.score.sd[wi] as number, 12);
      const game = season.odds?.weekly.find((w) => w.week === r.week)?.games.find((g) => g.teamId === me);
      expect(r.opponentId).toBe(game?.opponentId);
      expect(r.pWin).toBe(game?.pWin);
      const opp = model.teams.find((t) => t.id === r.opponentId);
      expect(r.theirs?.mean).toBe(opp?.score.mean[wi]);
      // On bye: exactly my active-roster players whose bye is this week; starters flagged by the page's own rule.
      const expected = team.roster.filter((id) => model.players[id]?.ros.bye.status === "upcoming" && model.players[id]?.ros.bye.week === r.week);
      expect(r.byes.map((b) => b.id).sort()).toEqual([...expected].sort());
      for (const b of r.byes) expect(b.starter).toBe(starters.has(b.id));
      const low = Math.round((r.pWin as number) * 100) < Math.round(RISKY_WIN_CHANCE * 100);
      const many = r.byes.filter((b) => b.starter).length >= RISKY_BYES;
      expect(r.risk.some((x) => x.includes("to win"))).toBe(low);
      expect(r.risk.some((x) => x.includes("on bye"))).toBe(many);
      expect(r.underWay).toBe(false);
    }
  });

  // With common random numbers, more points in every week never cost a game, so P(playoffs) and expected wins
  // can't fall; title odds rise here too (not a theorem per season: a better seed changes the bracket path).
  it("the scale check: more lineup points raise my odds on the shared matrix, and B and the score follow §10", () => {
    const check = season.scale as NonNullable<SeasonReport["scale"]>;
    expect(season.scaleMatchesModel).toBe(true);
    const rows = check.rows as NonNullable<typeof check.rows>;
    expect(rows.map((r) => r.gain)).toEqual([...SCALE_GAINS]);
    let last = { dPO: 0, dCH: 0, dEW: 0, B: 0 };
    for (const r of rows) {
      expect(r.dPO).toBeGreaterThanOrEqual(last.dPO);
      expect(r.dCH).toBeGreaterThanOrEqual(last.dCH);
      expect(r.dEW).toBeGreaterThan(last.dEW);
      expect(r.B).toBeGreaterThan(last.B);
      expect(r.B).toBeCloseTo(benefitWin(r.dPO, r.dCH), 12);
      expect(r.score).toBe(tradeScore(r.B));
      // Every change carries its Monte Carlo standard error (batch means), which a real gain makes positive.
      for (const k of ["dPO", "dCH", "dEW", "B"] as const) expect(r.se[k]).toBeGreaterThanOrEqual(0);
      expect(r.se.B).toBeGreaterThan(0);
      last = r;
    }
    expect([check.batches, check.batchSims]).toEqual([SE_BATCHES, config.simulation.finalSims / SE_BATCHES]);
    expect(check.titleUnknown).toBeNull();
    const at3 = rows.find((r) => r.gain === 3) as (typeof rows)[number];
    expect(check.bRefAtToyGain).toBeCloseTo(bRefFor(at3.B, 63) as number, 12);
    // B_ref is B(+3) times a constant (−1 / ln 0.37 = bRefFor(1, 63)), and so is its standard error.
    expect(check.bRefSe).toBeCloseTo(at3.se.B * (bRefFor(1, 63) as number), 12);
    // A zero gain moves nothing on the shared matrix, in the whole run or in any batch.
    const built = buildSimSetup(snapshot, model) as NonNullable<ReturnType<typeof buildSimSetup>>;
    const seed = config.simulation.seed;
    const run = { sims: 1000, seed, normals: simNormals(seed, 1000, built.setup.weeks.length, built.setup.teams.length) };
    const my = model.teams.find((t) => t.id === me) as LeagueModel["teams"][number];
    const zero = scaleCheck(snapshot, model, me, my.score, run, [0]);
    expect(zero?.rows?.[0]).toMatchObject({ dPO: 0, dCH: 0, dEW: 0, B: 0, score: null, se: { dPO: 0, dCH: 0, dEW: 0, B: 0 } });
  });

  describe("the scale check's standard errors (review: 5,000 seasons still leave Monte Carlo error)", () => {
    const built = buildSimSetup(snapshot, model) as NonNullable<ReturnType<typeof buildSimSetup>>;
    const W = built.setup.weeks.length;
    const T = built.setup.teams.length;
    const my = model.teams.find((t) => t.id === me) as LeagueModel["teams"][number];
    const runOf = (seed: number, sims: number): SharedRun => ({ sims, seed, normals: simNormals(seed, sims, W, T) });
    const row3 = (run: SharedRun) => scaleCheck(snapshot, model, me, my.score, run, [3])?.rows?.[0] as NonNullable<NonNullable<ReturnType<typeof scaleCheck>>["rows"]>[number];

    it("come from batches that replay the run's own seasons: the batch values average to the run's, and SE = their SD / √batches", () => {
      const run = runOf(config.simulation.seed, 2000);
      const plus3 = { ...model, teams: model.teams.map((t) => (t.id === me ? { ...t, score: { mean: t.score.mean.map((m) => m + 3), sd: t.score.sd } } : t)) };
      const mine = (m: typeof model, r: SharedRun) => seasonOdds(snapshot, m, { sims: r.sims, seed: r.seed, normals: r.normals })?.teams.find((t) => t.teamId === me) as NonNullable<LeagueModel["odds"]>["teams"][number];
      const parts = batchRuns(run);
      const before = parts.map((p) => mine(model, p));
      const after = parts.map((p) => mine(plus3, p));
      const full = mine(model, run);
      expect(mean(before.map((o) => o.pPlayoffs))).toBeCloseTo(full.pPlayoffs, 12);
      expect(mean(before.map((o) => o.pTitle as number))).toBeCloseTo(full.pTitle as number, 12);
      expect(mean(before.map((o) => o.expWins))).toBeCloseTo(full.expWins, 12);
      const Bs = parts.map((_, j) => {
        const [b, a] = [before[j], after[j]] as [typeof full, typeof full];
        return benefitWin(a.pPlayoffs - b.pPlayoffs, (a.pTitle as number) - (b.pTitle as number));
      });
      const row = row3(run);
      expect(row.B).toBeCloseTo(mean(Bs), 10);
      expect(row.se.B).toBeCloseTo(sd(Bs) / Math.sqrt(SE_BATCHES), 12);
    });

    // An SD from 24 seeds is itself good to about ±15%, so the band sits about 3 of those from 1 each side: it
    // catches a standard error off by a missing √batches (4.5×) or taken from one batch, not sampling noise.
    it("measure what another seed would change: B(+3)'s spread over 24 seeds is about its standard error", () => {
      const rows = range(1, 24).map((seed) => row3(runOf(seed, 1000)));
      const ratio = sd(rows.map((r) => r.B)) / mean(rows.map((r) => r.se.B));
      expect(ratio).toBeGreaterThan(0.5);
      expect(ratio).toBeLessThan(2);
    });
  });

  it("the free-agent baseline (V*: all my pickups) re-prices the roster exactly as the model priced it, or says why it's skipped", () => {
    const wv = season.vstar as NonNullable<SeasonReport["vstar"]>;
    expect(wv).not.toBeNull();
    const my = model.teams.find((t) => t.id === me) as LeagueModel["teams"][number];
    if (my.faMoves.length === 0) {
      expect(wv).toEqual({ skipped: expect.stringContaining("no free-agent pickup") });
      return;
    }
    if ("skipped" in wv) throw new Error(`skipped: ${wv.skipped}`);
    expect(wv.moves).toEqual(my.faMoves);
    expect(wv.reproduced).toBe(0);
    expect(Math.abs(wv.rosDiff)).toBeLessThan(1e-6);
    expect(wv.check.rows?.map((r) => r.gain)).toEqual([...SCALE_GAINS]);
    // The pickups alone: the V* baseline against the roster as it is, on the same matrix.
    const cur = (season.scale as NonNullable<SeasonReport["scale"]>).base;
    const move = wv.move as NonNullable<typeof wv.move>;
    expect(move.dPO).toBe(wv.check.base.pPlayoffs - cur.pPlayoffs);
    expect(move.dCH).toBe((wv.check.base.pTitle as number) - (cur.pTitle as number));
    expect(move.dEW).toBe(wv.check.base.expWins - cur.expWins);
    expect(move.B).toBeCloseTo(benefitWin(move.dPO, move.dCH), 12);
    expect(move.score).toBe(tradeScore(move.B));
    // The V* roster really differs: its baseline odds moved.
    expect(wv.check.base).not.toEqual(cur);
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

  it("re-prices every team's weekly scores exactly as the model did, the week in progress from before kickoff", () => {
    expect(model.inProgressWeek).toBe(4);
    const scoreOf = rosterScorer(snapshot, live, model, NOW);
    for (const t of snapshot.teams) {
      const tm = model.teams.find((x) => x.id === t.id) as LeagueModel["teams"][number];
      expect(scoreOf(t.roster, t.id)).toEqual(tm.score);
    }
    // And the same without scenarios (expected-value lineups).
    const ev = buildLeagueModel(snapshot, live, { now: NOW, scenarios: 0, sims: 0 });
    const evScore = rosterScorer(snapshot, live, ev, NOW);
    for (const t of snapshot.teams) expect(evScore(t.roster, t.id)).toEqual(ev.teams.find((x) => x.id === t.id)?.score);
    // My team streams (K and D/ST by default): its scores need its streaming rows, which the re-pricing adds.
    expect(model.streaming.byTeam[PARKER.myTeamId]?.positions.length).toBeGreaterThan(0);
  });

  it("the schedule marks the week under way, and the report says the scale check includes it", () => {
    const odds = model.odds as NonNullable<LeagueModel["odds"]>;
    const built = buildSimSetup(snapshot, model) as NonNullable<ReturnType<typeof buildSimSetup>>;
    const rows = remainingSchedule(snapshot, model, odds, built) as NonNullable<ReturnType<typeof remainingSchedule>>;
    expect(rows[0]).toMatchObject({ week: 4, underWay: true });
    expect(rows.slice(1).every((r) => !r.underWay)).toBe(true);
    const { doc } = buildReport(snapshot, live, { now: NOW, clock, scenarios: S, runs: 1, warmups: 0, buildRuns: 0 });
    expect(doc).toContain("week 4 in progress included");
    expect(doc).toContain("| 4 (under way: projected as if no game had started) |");
    expect(doc).toContain("a week in progress as if none of its games had started, with today's rosters and injury news");
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
      "## Trade Score scale check",
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
    expect(doc.match(/\*\*Pass\.\*\*/g)).toHaveLength(2);
    expect(doc).not.toContain("FAIL");
    expect(doc).toContain("Σ P(playoffs) = 6.000 (6 playoff teams) · Σ P(bye) = 2.000 (2 byes) · Σ P(title) = 1.000.");
    expect(doc).toContain("| +3 pt/wk |");
    expect(doc).toContain("B_ref that maps this league's +3 to a Trade Score of 63");
    // The scale check owns up to its Monte Carlo error: no "not noise" claim, ± on every change, B_ref to one decimal.
    expect(doc).not.toContain("not noise");
    expect(doc).toContain(`± is its Monte Carlo standard error, by batch means: the 5,000 seasons split into ${SE_BATCHES} batches of 250`);
    expect(doc).toMatch(/\| \+3 pt\/wk \| [+-]\d\.\d{4} ± \d\.\d{4} \| [+-]\d\.\d{4} ± \d\.\d{4} \| [+-]\d+\.\d{3} ± \d+\.\d{3} \| -?\d+\.\d{2} ± \d+\.\d{2} \|/);
    expect(doc).toMatch(/−B\(\+3\) \/ ln 0\.37 = \*\*\d+\.\d ± \d+\.\d\*\* \(± its Monte Carlo standard error, as B\(\+3\)'s; two standard errors span \d+\.\d–\d+\.\d\)/);
    const wv = season.vstar;
    if (wv && !("skipped" in wv) && wv.move) expect(doc).toMatch(/The pickups alone, against your roster as it is: ΔPO [+-]\d\.\d{4} ± \d\.\d{4}, ΔCH [+-]\d\.\d{4} ± \d\.\d{4}, Δ expected wins [+-]\d+\.\d{3} ± \d+\.\d{3}, B -?\d+\.\d{2} ± \d+\.\d{2}/);
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
    // The rule the words state is the one V* follows: every move clears faMinGain in scenario lineups.
    for (const t of model.teams) for (const m of t.faMoves) expect(m.gainScen as number).toBeGreaterThanOrEqual(config.freeAgentOptimizer.faMinGain - 1e-9);
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
    const unknown = (reason: string) => `Title odds are unknown (${reason}; see the notes under Standings and playoff odds), so B can't be computed.`;
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

  it("says why there are no odds when the rest of the schedule didn't load", () => {
    const partial = { ...snapshot, schedule: snapshot.schedule.filter((m) => m.decided) };
    const { doc, season } = buildReport(partial, inputs, { now: NOW, clock, scenarios: 0, runs: 1, warmups: 0, buildRuns: 0 });
    expect(season.odds).toBeNull();
    expect(doc).toContain("No odds: The schedule has no matchups for the rest of the regular season (weeks 4–14)");
    expect(doc).toContain("No odds, so no schedule (above).");
    expect(doc).not.toContain("FAIL");
  });
});
