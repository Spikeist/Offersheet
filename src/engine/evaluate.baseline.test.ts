/**
 * Phase 4c, track EV (planner reply to Checkpoint 4b, changes 7, 8 and 9): one baseline everywhere (the trade context's
 * baseline odds on its final block are LeagueModel.odds exactly, every team after its free-agent pickups; the odds as
 * rosters stand as the second number), the order of the two blocks of seasons (the final block first: the League model's
 * own seasons), my win chance by week before and after a trade (TradeDetail.winChance), the depth cover
 * (TradeDetail.depthCover), the goal passed to benefit() ("What matters most"), and the IR players who move without an
 * active roster spot (ActiveSpots.inactive). Each step's acceptance features: evaluate.steps.test.ts. Random leagues
 * with free agents (seeded), and hand leagues (trade.testing.ts handLeague) for the rules that need an obvious answer.
 * Teams are placeholders and players made up.
 */
import { describe, expect, it } from "vitest";
import { benefit, protectValueWeight, tradePackage } from "./benefit";
import { config } from "./config";
import { tradeActiveSpots } from "./irSlots";
import {
  analyzeTrade,
  buildTradeContext,
  evaluateExact,
  simCounts,
  simulateTrade,
  spotsOf,
  legalSide,
  tradeInternals,
  tradeVersion,
  winChanceOf,
  type ExactTrade,
  type SimState,
  type TeamState,
  type TradeContext,
  type TradeContextOptions,
} from "./evaluate";
import { buildLeagueModel, type BuildLeagueModelOptions } from "./league";
import type { SeasonOdds } from "./leagueModel";
import type { LeagueSnapshot, Matchup } from "./model";
import type { ModelInputs } from "./inputs";
import { seasonOdds, type SeasonModel } from "./season";
import { GOALS, defaultTradeSettings } from "./settings";
import { simNormals } from "./sim";
import { TEST_NOW, randomLeague, type TestLeagueSpec, type TestPlayer, type TestTeam } from "./testLeague";
import { flat, handLeague, roundRobin, withSeason, type SeasonSpec } from "./trade.testing";
import type { TradeAsset, TradeProposal } from "./tradeModel";

const p = (...ids: string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));
const trade = (partnerId: string, give: string[], get: string[]): TradeProposal => ({ partnerId, give: p(...give), get: p(...get) });
const range = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

const EARLY = "2026-09-29T17:00:00.000Z"; // before TEST_NOW (20:00Z)
const LATE = "2026-09-30T00:15:00.000Z";

/**
 * A seeded random league with a season (trade.testing.ts withSeason: weeks 1–8, playoffs 9–10 for 4 of 6 teams, weeks 1–5
 * decided by `order`), free agents at every position, injuries; `ir` moves each team's IR-tagged players to its IR (they
 * come back within the season: returners, with the roster spot each needs from his week); `live` puts half the NFL's week-6
 * games before TEST_NOW (a week in progress).
 */
function randomSeason(seed: number, opts: { ir?: boolean; live?: boolean } = {}): { snapshot: LeagueSnapshot; inputs: ModelInputs } {
  const base = randomLeague({ teams: 6, seed, rosterSize: 13, freeAgentsPerPosition: 5, currentWeek: 6, injuries: true });
  if (opts.ir) {
    base.snapshot.teams = base.snapshot.teams.map((t) => {
      const ir = t.roster.filter((id) => base.snapshot.players[id]?.injury === "IR");
      return { ...t, roster: t.roster.filter((id) => !ir.includes(id)), ir };
    });
  }
  if (opts.live) {
    const nfl = base.inputs.nfl as NonNullable<ModelInputs["nfl"]>;
    nfl.kickoffs = { 6: Object.fromEntries(range(1, 32).map((i) => [`T${String(i).padStart(2, "0")}`, i % 2 === 1 ? EARLY : LATE])) };
  }
  return withSeason(base, { pastWinnersOrder: ["3", "1", "5", "2", "6", "4"] });
}

/** My team's game in each week of a season's odds: { week, pWin } for the weeks I have one with an opponent. */
function myWeeks(odds: SeasonOdds, me: string): { week: number; pWin: number | null }[] {
  return odds.weekly.flatMap((wk) => {
    const g = wk.games.find((x) => x.teamId === me);
    return g && g.opponentId !== null ? [{ week: wk.week, pWin: g.pWin }] : [];
  });
}

function exact(ctx: TradeContext, proposal: TradeProposal, maxPerSide = 4): ExactTrade {
  const x = evaluateExact(tradeInternals(ctx), proposal, maxPerSide);
  if ("illegal" in x) throw new Error(x.illegal);
  return x;
}

function hand(edit: (spec: TestLeagueSpec) => void = () => undefined, season: SeasonSpec = {}, opts: Partial<TradeContextOptions> = {}): TradeContext {
  const { snapshot, inputs } = handLeague(edit, season);
  return buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0, ...opts });
}

describe("one baseline everywhere: the trade context's baseline odds are LeagueModel.odds exactly (planner reply to Checkpoint 4b, change 9)", () => {
  const cases: { label: string; seed: number; ir?: boolean; live?: boolean; scenarios: number }[] = [
    { label: "EV lineups", seed: 31, scenarios: 0 },
    { label: "scenario lineups", seed: 32, scenarios: 8 },
    { label: "IR returners and the roster spot each needs", seed: 33, ir: true, scenarios: 8 },
    { label: "a week in progress", seed: 34, live: true, scenarios: 8 },
    { label: "IR returners and a week in progress, EV lineups", seed: 35, ir: true, live: true, scenarios: 0 },
  ];
  for (const c of cases) {
    it(`${c.label} (seed ${c.seed}): every team's odds, weekly win chances and notes, bit for bit`, () => {
      const { snapshot, inputs } = randomSeason(c.seed, c);
      const opts: BuildLeagueModelOptions = { now: TEST_NOW, scenarios: c.scenarios };
      const model = buildLeagueModel(snapshot, inputs, opts);
      const ctx = buildTradeContext(snapshot, inputs, opts);
      const I = tradeInternals(ctx);
      const sim = I.sim as SimState;
      expect(model.odds).not.toBeNull();
      expect(sim).not.toBeNull();
      if (c.live) expect(model.inProgressWeek).toBe(6);
      if (c.ir) expect(I.teams.some((t) => t.base.displaced.length > 0 || t.ir.length > 0)).toBe(true);
      // Somebody picks up a free agent, so the two baselines can differ at all.
      expect(I.teams.some((t) => t.vstar.moves.length > 0)).toBe(true);
      const odds = model.odds as SeasonOdds;
      expect(sim.odds).toEqual(odds);
      expect(JSON.stringify(sim.odds)).toBe(JSON.stringify(odds));
      for (const t of odds.teams) {
        const u = sim.odds.teams.find((x) => x.teamId === t.teamId);
        for (const k of ["pPlayoffs", "pBye", "pTitle", "expWins"] as const) expect(Object.is(u?.[k], t[k]), `${t.teamId} ${k}`).toBe(true);
      }
      // The baseline's scores are TeamModel.scoreWithPickups, and my odds on the final block are the model's.
      I.teams.forEach((t, i) => {
        const w = model.teams[i]?.scoreWithPickups;
        expect(Array.from(t.base.score.mean), t.id).toEqual(w?.mean);
        expect(Array.from(t.base.score.sd), t.id).toEqual(w?.sd);
      });
      const me = I.me as TeamState;
      const mine = odds.teams.find((t) => t.teamId === me.id);
      expect(sim.base.final.pPlayoffs).toBe(mine?.pPlayoffs);
      expect(sim.base.final.pTitle).toBe(mine?.pTitle);
      expect(sim.base.final.expWins).toBe(mine?.expWins);
      expect(sim.base.final.weekly.filter((w) => w.pWin !== null)).toEqual(myWeeks(odds, me.id));
      // The odds as rosters stand: every team's TeamModel.score on the same seasons; another number when pickups matter.
      const stand = model.oddsAsRostersStand as SeasonOdds;
      const standModel: SeasonModel = { weeks: model.weeks, regularWeeks: model.regularWeeks, playoffWeeks: model.playoffWeeks, inProgressWeek: model.inProgressWeek, teams: model.teams.map((t) => ({ id: t.id, score: t.score })) };
      expect(stand).toEqual(seasonOdds(snapshot, standModel, { sims: config.simulation.finalSims, seed: config.simulation.seed }));
      expect(JSON.stringify(stand.teams)).not.toBe(JSON.stringify(odds.teams));
      // The week in progress: the model plays it with today's rosters, so both scores keep the team's week as it stands.
      if (c.live) for (const t of model.teams) expect([t.scoreWithPickups?.mean[0], t.scoreWithPickups?.sd[0]], t.id).toEqual([t.score.mean[0], t.score.sd[0]]);
    });
  }

  it("the premium's P(playoffs) and the partners' context read the same odds (the League page's tags are the search's)", () => {
    const { snapshot, inputs } = randomSeason(36);
    const model = buildLeagueModel(snapshot, inputs, { now: TEST_NOW, scenarios: 0 });
    const I = tradeInternals(buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0 }));
    for (const t of model.teams) expect(I.premiums.get(t.id) ?? {}, t.id).toEqual(t.premiums ?? {});
    for (const [teamId, profile] of I.profiles) expect(profile.pPlayoffs, teamId).toBe(model.odds?.teams.find((o) => o.teamId === teamId)?.pPlayoffs);
  });

  it("no simulation (sims 0): neither odds; the scores with pickups are there all the same", () => {
    const { snapshot, inputs } = randomSeason(37);
    const model = buildLeagueModel(snapshot, inputs, { now: TEST_NOW, scenarios: 0, sims: 0 });
    expect(model.odds).toBeNull();
    expect(model.oddsAsRostersStand).toBeNull();
    for (const t of model.teams) expect(t.scoreWithPickups?.mean).toHaveLength(model.weeks.length);
  });
});

describe("the two blocks of seasons: the final block first (the League model's own seasons), then the screening block", () => {
  it("final = seasons [0, finalSims) of the seed's matrix, screening = the next screeningSims", () => {
    const ctx = hand();
    const sim = tradeInternals(ctx).sim as SimState;
    const { final, screen } = simCounts();
    const { weeks: Wk, teams: T } = sim.blocks.final;
    const per = Wk * T;
    expect(sim.blocks.final.sims).toBe(final);
    expect(sim.blocks.screen.sims).toBe(screen);
    const all = simNormals(sim.seed, final + screen, Wk, T);
    expect(sim.blocks.final.z).toEqual(simNormals(sim.seed, final, Wk, T).z);
    expect(sim.blocks.final.z).toEqual(all.z.subarray(0, final * per));
    expect(sim.blocks.screen.z).toEqual(all.z.subarray(final * per, (final + screen) * per));
    // The screening block is other seasons: its baseline isn't the final one's.
    expect(sim.base.screen.pPlayoffs).not.toBe(sim.base.final.pPlayoffs);
  });
});

describe("win chance by week (TradeDetail.winChance; planner reply to Checkpoint 4b, change 9)", () => {
  const ctx = hand(() => undefined, {}, { scenarios: 8 });
  const I = tradeInternals(ctx);
  const me = I.me as TeamState;
  const sim = I.sim as SimState;
  // My bench WR for Team 2's starting RB: an upgrade for me, a loss for Team 2.
  const x = exact(ctx, trade("2", ["wc1"], ["ra2"]));

  /** My weekly win chances when my row and the partner's are swapped for the trade's, as season.seasonOdds plays them. */
  const afterOdds = (stage: "final" | "screen"): SeasonOdds => {
    const model: SeasonModel = {
      weeks: I.league.lp.weeks.weeks,
      regularWeeks: I.league.lp.weeks.regularWeeks,
      playoffWeeks: I.league.lp.weeks.playoffWeeks,
      inProgressWeek: I.league.tw.inProgressWeek,
      teams: I.teams.map((t) => {
        const score = t === me ? x.mine.score : t === x.partner ? x.theirs.score : t.base.score;
        return { id: t.id, score: { mean: Array.from(score.mean), sd: Array.from(score.sd) } };
      }),
    };
    const n = simCounts()[stage];
    return seasonOdds(I.snapshot, model, { sims: n, seed: sim.seed, normals: sim.blocks[stage] }) as SeasonOdds;
  };

  it("a final trade: before = the baseline's (LeagueModel.odds), after = the trade's run, both on the final block, every week I have a game", () => {
    const final = simulateTrade(I, x, "final", null);
    const before = myWeeks(sim.odds, me.id);
    const after = myWeeks(afterOdds("final"), me.id);
    expect(before.length).toBeGreaterThan(1);
    expect(final.detail.winChance).toEqual(before.map((b, k) => ({ week: b.week, before: b.pWin, after: after[k]?.pWin ?? null })));
    // The trade helps me: some week's chance moves up.
    expect(final.detail.winChance?.some((w) => (w.after as number) > (w.before as number))).toBe(true);
  });

  it("a screened run: the screening block's numbers, before and after", () => {
    const screen = simulateTrade(I, x, "screen", null);
    const before = sim.base.screen.weekly.filter((w) => w.pWin !== null);
    const after = myWeeks(afterOdds("screen"), me.id);
    expect(screen.detail.winChance).toEqual(before.map((b, k) => ({ week: b.week, before: b.pWin, after: after[k]?.pWin ?? null })));
    expect(screen.detail.winChance).not.toEqual(simulateTrade(I, x, "final", null).detail.winChance);
  });

  it("the Analyzer's card carries the final block's lines; a step's version its screening block's", () => {
    const a = analyzeTrade(ctx, trade("2", ["wc1"], ["ra2"])).evaluation;
    expect(a?.detail.winChance).toEqual(simulateTrade(I, x, "final", null).detail.winChance);
    const v = tradeVersion(I, trade("2", ["wc1"], ["ra2"]), { settings: defaultTradeSettings(), maxPerSide: 2 });
    expect(v?.screen.detail.winChance).toEqual(simulateTrade(I, x, "screen", null).detail.winChance);
  });

  it("a week without an opponent (a bye) is left out; a multi-week game at its first week", () => {
    expect(
      winChanceOf(
        { weekly: [{ week: 5, pWin: 0.5 }, { week: 6, pWin: null }, { week: 7, pWin: 0.25 }] },
        { weekly: [{ week: 5, pWin: 0.6 }, { week: 6, pWin: null }, { week: 7, pWin: 0.2 }] },
      ),
    ).toEqual([
      { week: 5, before: 0.5, after: 0.6 },
      { week: 7, before: 0.25, after: 0.2 },
    ]);
    // Five teams: every week one team has a bye (roundRobin), mine among them.
    const fifth: TestTeam = { id: "5", roster: [flat("q5", "QB", 16), flat("ra5", "RB", 11), flat("rb5", "RB", 8), flat("wa5", "WR", 10), flat("wb5", "WR", 7), flat("te5", "TE", 6), flat("k5", "K", 7), flat("d5", "DEF", 6), flat("rc5", "RB", 4.5), flat("wc5", "WR", 3.5)] };
    const odd = hand((spec) => spec.teams.push(fifth));
    const Io = tradeInternals(odd);
    const bye = Io.snapshot.schedule.find((m) => !m.isPlayoff && m.week >= 5 && m.teamA === "1" && m.teamB === null);
    expect(bye).toBeDefined();
    const lines = simulateTrade(Io, exact(odd, trade("2", ["wc1"], ["ra2"])), "final", null).detail.winChance ?? [];
    expect(lines.map((w) => w.week)).not.toContain(bye?.week);
    expect(lines.length).toBeGreaterThan(0);
    for (const w of lines) expect([w.before, w.after].every((p) => p !== null)).toBe(true);
    // Weeks 6–7 one matchup: one line at week 6, none at week 7.
    const { snapshot, inputs } = handLeague();
    const ids = snapshot.teams.map((t) => t.id);
    const schedule: Matchup[] = roundRobin(ids, [5, 6, 8]).map((m) => (m.week === 6 ? { ...m, weeks: [6, 7] } : m));
    const two = buildTradeContext({ ...snapshot, schedule }, inputs, { now: TEST_NOW, scenarios: 0 });
    const weeks = (simulateTrade(tradeInternals(two), exact(two, trade("2", ["wc1"], ["ra2"])), "final", null).detail.winChance ?? []).map((w) => w.week);
    expect(weeks).toEqual([5, 6, 8]);
  });

  it("a points-only league: no lines (its games don't change the standings), though the trade is simulated and the League page lists the games", () => {
    // The same league and trade, ranked by points for: the schedule still lists head-to-head matchups, which sim.ts plays
    // (points against) and the League page shows with a note, but a win there changes nothing (review of track EV, EV-1).
    const { snapshot, inputs } = handLeague();
    const po = buildTradeContext({ ...snapshot, settings: { ...snapshot.settings, pointsOnly: true } }, inputs, { now: TEST_NOW, scenarios: 8 });
    const Ip = tradeInternals(po);
    const simP = Ip.sim as SimState;
    expect(simP).not.toBeNull();
    expect(myWeeks(simP.odds, (Ip.me as TeamState).id).length).toBeGreaterThan(1);
    expect(simP.base.final.weekly).toEqual([]);
    expect(simP.base.screen.weekly).toEqual([]);
    const xp = exact(po, trade("2", ["wc1"], ["ra2"]));
    const final = simulateTrade(Ip, xp, "final", null);
    expect(final.b).not.toBeNull();
    expect(final.detail.winChance).toEqual([]);
    expect(simulateTrade(Ip, xp, "screen", null).detail.winChance).toEqual([]);
    expect(analyzeTrade(po, trade("2", ["wc1"], ["ra2"])).evaluation?.detail.winChance).toEqual([]);
    // The same trade where the games count has its lines.
    expect(simulateTrade(I, x, "final", null).detail.winChance?.length).toBeGreaterThan(1);
  });

  it("absent without odds (the schedule didn't load: no simulation)", () => {
    const { snapshot, inputs } = handLeague();
    const none = buildTradeContext({ ...snapshot, schedule: [] }, inputs, { now: TEST_NOW, scenarios: 0 });
    expect(tradeInternals(none).sim).toBeNull();
    const s = simulateTrade(tradeInternals(none), exact(none, trade("2", ["wc1"], ["ra2"])), "final", null);
    expect(s.detail.winChance).toBeUndefined();
    expect(s.b).toBeNull();
  });
});

describe("the depth cover (TradeDetail.depthCover): my ΔPPW in scenario lineups minus my ΔPPW in EV lineups", () => {
  it("a backup QB who never starts in EV lineups but plays when my QB misses games: all of the gain is depth cover", () => {
    // Team 2's 15-point backup QB (in its bench WR's place) for my bench WR: EV lineups see nothing (neither starts), the
    // scenarios see the games my QB misses. My QB is questionable this week (out in some scenarios, still my EV starter at
    // 0.85 × 20), and my bench WR scores 0.5 (giving him away costs no lineup, average or scenario, to speak of).
    const ctx = hand(
      (spec) => {
        const one = spec.teams[0] as TestTeam;
        one.roster = one.roster.map((pl) => (pl.id === "q1" ? flat("q1", "QB", 20, { injury: "QUESTIONABLE" }) : pl.id === "wc1" ? flat("wc1", "WR", 0.5) : pl));
        const two = spec.teams[1] as TestTeam;
        two.roster = two.roster.map((pl) => (pl.id === "wc2" ? flat("qb2", "QB", 15) : pl));
      },
      {},
      { scenarios: 32 },
    );
    const I = tradeInternals(ctx);
    const me = I.me as TeamState;
    const x = exact(ctx, trade("2", ["wc1"], ["qb2"]));
    const weeks = I.league.lp.weeks.weeks;
    const avg = (lv: Float64Array) => I.regIdx.reduce((s, w) => s + (lv[w] as number), 0) / I.regIdx.length;
    const evGain = avg(x.mine.ev.lv) - avg(me.base.ev.lv);
    expect(weeks.length).toBeGreaterThan(0);
    expect(Math.abs(evGain)).toBeLessThan(1e-9);
    expect(x.evaluation.dPPW).toBeGreaterThan(0.1);
    expect(x.evaluation.detail.depthCover).toBeCloseTo(x.evaluation.dPPW - evGain, 12);
    expect(x.evaluation.detail.depthCover).toBeCloseTo(x.evaluation.dPPW, 9);
  });

  it("a starter upgrade: mostly lineup, some cover; absent without scenarios", () => {
    const ctx = hand(() => undefined, {}, { scenarios: 16 });
    const I = tradeInternals(ctx);
    const me = I.me as TeamState;
    const x = exact(ctx, trade("2", ["wc1"], ["ra2"]));
    const avg = (lv: Float64Array) => I.regIdx.reduce((s, w) => s + (lv[w] as number), 0) / I.regIdx.length;
    expect(x.evaluation.detail.depthCover).toBeCloseTo(x.evaluation.dPPW - (avg(x.mine.ev.lv) - avg(me.base.ev.lv)), 12);
    expect(Math.abs(x.evaluation.detail.depthCover as number)).toBeLessThan(Math.abs(x.evaluation.dPPW));
    const ev = exact(hand(), trade("2", ["wc1"], ["ra2"]));
    expect(ev.evaluation.detail.depthCover).toBeUndefined();
    expect("depthCover" in ev.evaluation.detail).toBe(false);
  });
});

describe("the goal reaches benefit() (\"What matters most\", planner reply to Checkpoint 4b, change 8)", () => {
  const ctx = hand(() => undefined, {}, { scenarios: 8 });
  const I = tradeInternals(ctx);
  const sim = I.sim as SimState;
  const proposal = trade("2", ["wc1"], ["ra2"]);
  const x = exact(ctx, proposal);

  it("B is benefit() with the call's goal; the context's settings' goal when the call passes none", () => {
    const bs = GOALS.map((goal) => {
      const s = simulateTrade(I, x, "final", null, undefined, goal);
      const b = benefit({ leagueType: "redraft", dPO: s.dPO, dCH: s.dCH, gMine: s.gMine, dynasty: null, myPPlayoffs: sim.base.final.pPlayoffs, lambda: null, kappa: protectValueWeight(I.settings.protectValue), goal });
      expect(s.b, goal).toBe(b.b);
      expect(s.bWin, goal).toBe(b.bWin);
      const w = config.benefit.goals[goal];
      expect(s.bWin as number, goal).toBeCloseTo(100 * (w.playoffs * (s.dPO as number) + w.title * (s.dCH as number)), 9);
      return s.b as number;
    });
    // The goals weigh ΔPO and ΔCH differently, and this trade moves them by different amounts.
    expect(new Set(bs).size).toBe(GOALS.length);
    expect(simulateTrade(I, x, "final", null).b).toBe(simulateTrade(I, x, "final", null, undefined, I.settings.goal).b);
  });

  it("the Analyzer and the steps' versions use the settings' goal", () => {
    for (const goal of GOALS) {
      const settings = { ...defaultTradeSettings(), goal };
      expect(analyzeTrade(ctx, proposal, { settings }).evaluation?.b, goal).toBe(simulateTrade(I, x, "final", settings.lambda, settings.protectValue, goal).b);
      expect(tradeVersion(I, proposal, { settings, maxPerSide: 2 })?.screen.b, goal).toBe(simulateTrade(I, x, "screen", settings.lambda, settings.protectValue, goal).b);
    }
  });
});

describe("IR players who move without an active roster spot (ActiveSpots.inactive, the neutral throw-in rule's input)", () => {
  /** An IR RB of team t, back in week 7. */
  const irRb = (t: number, extra: Partial<TestPlayer> = {}): TestPlayer => flat(`ir${t}`, "RB", 9, { injury: "IR", injuryReturnWeek: 7, ...extra });
  const withIr = (teams: Record<number, TestPlayer>) => (spec: TestLeagueSpec) => {
    for (const [t, player] of Object.entries(teams)) (spec.teams[Number(t) - 1] as { ir?: TestPlayer[] }).ir = [player];
  };

  it("one received into my open IR slot is inactive for me; given from Team 2's IR, inactive for Team 2; each side's own set", () => {
    const ctx = hand(withIr({ 2: irRb(2) }));
    const I = tradeInternals(ctx);
    const me = I.me as TeamState;
    const two = I.byId.get("2") as TeamState;
    const mine = legalSide(I, me, me.roster, ["wc1"], ["ir2"], "exact", "You");
    const theirs = legalSide(I, two, two.roster, ["ir2"], ["wc1"], "exact", "Team 2");
    if ("illegal" in mine || "illegal" in theirs) throw new Error("illegal");
    expect(mine.toIR).toEqual(["ir2"]);
    const my = spotsOf(mine, ["wc1"], ["ir2"]);
    expect(my).toMatchObject({ give: 1, recv: 0 });
    expect([...(my.inactive ?? [])]).toEqual(["ir2"]);
    const their = spotsOf(theirs, ["ir2"], ["wc1"]);
    expect(their).toMatchObject({ give: 0, recv: 1 });
    expect([...(their.inactive ?? [])]).toEqual(["ir2"]);
  });

  it("no IR player moving: no inactive set (every player moves with an active spot)", () => {
    const ctx = hand(withIr({ 2: irRb(2) }));
    const I = tradeInternals(ctx);
    const me = I.me as TeamState;
    const mine = legalSide(I, me, me.roster, ["wc1"], ["ra2"], "exact", "You");
    if ("illegal" in mine) throw new Error(mine.illegal);
    const s = spotsOf(mine, ["wc1"], ["ra2"]);
    expect(s).toEqual({ give: 1, recv: 1 });
    expect("inactive" in s).toBe(false);
  });

  it("one received from Team 2's IR onto my active roster (no open IR slot) moves with a spot: not inactive for me", () => {
    const ctx = hand(withIr({ 1: irRb(1), 2: irRb(2) }));
    const I = tradeInternals(ctx);
    const me = I.me as TeamState;
    const mine = legalSide(I, me, me.roster, ["wc1"], ["ir2"], "exact", "You");
    if ("illegal" in mine) throw new Error(mine.illegal);
    expect(mine.toIR).toEqual([]);
    expect("inactive" in spotsOf(mine, ["wc1"], ["ir2"])).toBe(false);
  });

  it("Phase 4c: a reader outside the engine (irSlots.tradeActiveSpots on the snapshot, benefit.tradePackage) gets the evaluation's packages exactly, the neutral throw-in's inactive spot included", () => {
    // Team 2 gives its RB1 and a cheap IR RB (worth 225, at most W) for my WR1: the IR RB goes into my open IR slot, so he
    // moves without an active spot on both sides, and the neutral throw-in rule leaves him out without a spot credit.
    const ctx = hand(withIr({ 2: irRb(2, { value: 225 }) }));
    const I = tradeInternals(ctx);
    expect(I.values.ir2).toBe(225);
    expect(I.values.ir2 as number).toBeLessThanOrEqual(I.credit);
    const ros = (id: string) => I.league.lp.players[id]?.ros.total ?? 0;
    const shapes: [string[], string[]][] = [
      [["wa1"], ["ra2", "ir2"]],
      [["wa1", "wc1"], ["ra2", "ir2"]],
      [["wc1"], ["ir2"]],
      [["wa1"], ["ra2"]],
    ];
    let differs = 0;
    for (const [give, get] of shapes) {
      const e = analyzeTrade(ctx, trade("2", give, get)).evaluation;
      if (!e) throw new Error(`no evaluation for ${give} → ${get}`);
      const mine = tradeActiveSpots(I.snapshot, "1", "2", give, get, ros).spots;
      const theirs = tradeActiveSpots(I.snapshot, "2", "1", get, give, ros).spots;
      const my = tradePackage({ players: get }, { players: give }, I.values, I.credit, config.market, mine);
      const their = tradePackage({ players: give }, { players: get }, I.values, I.credit, config.market, theirs);
      expect(e.value, `${give} → ${get}`).toEqual({ given: my.give, received: my.recv });
      expect(e.gMine, `${give} → ${get}`).toBe(my.g);
      expect(e.gPartner, `${give} → ${get}`).toBe(their.g);
      // The Analyzer's "Details" prints these very fields (tradeView.ts detailsView reads gMine, gPartner, features.g).
      // Without the inactive set, a reader would credit a roster spot the cheap IR RB never took.
      const blind = (s: typeof mine) => ({ give: s.give, recv: s.recv });
      const old = tradePackage({ players: get }, { players: give }, I.values, I.credit, config.market, blind(mine));
      if (old.g !== my.g) differs++;
    }
    // The check isn't empty: in the trades that move the cheap IR RB as a throw-in, the inactive set changes the packages.
    expect(differs).toBeGreaterThan(0);
  });
});
