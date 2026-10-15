/**
 * "Waiver upgrades" (planner reply to Checkpoint 7a, §6.2; src/engine/waivers.ts, league.ts step 10): who's listed in each
 * list, the lineup gain (exact against lineups solved here), the drop (open spot, roster legality's rules, the same in
 * every list), "depth only", the order, the caps, and the one-week list's week. Review of the Phase 7b lists: my players who
 * don't play in a list's weeks aren't compared (a bye listed every free agent at the position), rows are ordered by the
 * gain as the page prints it, and while a week is under way its games still to play get a "This week" list of their own,
 * my players whose games have started held where my lineup before kickoff had them. Made-up leagues (CLAUDE.md §16);
 * teams are placeholders.
 */
import { describe, expect, it } from "vitest";
import { config } from "./config";
import { buildLeagueModel, buildProjectionTable, tableWithStreaming, type BuildLeagueModelOptions, type LeagueModelConfig } from "./league";
import type { LeagueModel, WaiverList, WaiverRow } from "./leagueModel";
import { prepareLeagueSlots } from "./lineup";
import type { Pos } from "./model";
import { defaultTradeSettings } from "./settings";
import { rosValue, scenarioValues, tableRows, teamEval } from "./teamValue";
import { TEST_NOW, buildTestLeague, type TestLeagueSpec, type TestPlayer } from "./testLeague";
import { compareWaiverRows, gainSteps, waiverRatingPending } from "./waivers";

const ZERO_MISS: Record<Pos, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, P: 0, DEF: 0, DL: 0, LB: 0, DB: 0 };
/** No future injury risk: every healthy player plays every week of every scenario, so gains are plain arithmetic. */
const NO_RISK: LeagueModelConfig = { ...config, projections: { ...config.projections, injuryRisk: { ...config.projections.injuryRisk, missShare: ZERO_MISS } } };
const OPTS: BuildLeagueModelOptions = { now: TEST_NOW, sims: 0 };
/** buildTestLeague's default weeks: current week 4, regular season 1–14, playoffs 15–17: weeks 4–17 are left. */
const WEEKS_LEFT = 14;

const p = (id: string, pos: Pos, points: TestPlayer["points"], extra: Partial<TestPlayer> = {}): TestPlayer => ({ id, pos, points, ...extra });

/** My team: QB, three RBs, three WRs, a TE, a K and a D/ST (10 players: six open spots of 16). w3 (7) starts at FLEX. */
const MINE: TestPlayer[] = [p("q1", "QB", 20), p("r1", "RB", 15), p("r2", "RB", 12), p("r3", "RB", 6), p("w1", "WR", 14), p("w2", "WR", 11), p("w3", "WR", 7), p("t1", "TE", 8), p("k1", "K", 8), p("d1", "DEF", 7)];
const THEM: TestPlayer[] = [p("q2", "QB", 18), p("r4", "RB", 14), p("r5", "RB", 10), p("w4", "WR", 13), p("w5", "WR", 9), p("t2", "TE", 7), p("k2", "K", 7), p("d2", "DEF", 6)];
/** 16 players: MINE plus six bench players who never start. */
const FULL: TestPlayer[] = [...MINE, p("b1", "RB", 1), p("b2", "RB", 1.5), p("b3", "WR", 2), p("b4", "WR", 2.5), p("b5", "QB", 3), p("b6", "TE", 1)];

type Spec = Omit<Partial<TestLeagueSpec>, "teams"> & { mine?: TestPlayer[] };

function league(spec: Spec) {
  const { mine, ...rest } = spec;
  return buildTestLeague({ ...rest, teams: [{ id: "1", roster: mine ?? MINE }, { id: "2", roster: THEM }], freeAgents: spec.freeAgents ?? [] });
}

function build(spec: Spec, cfg: LeagueModelConfig = NO_RISK, opts: Partial<BuildLeagueModelOptions> = {}) {
  const l = league(spec);
  return { ...l, model: buildLeagueModel(l.snapshot, l.inputs, { ...OPTS, ...opts }, cfg) };
}

const rowOf = (list: WaiverList | null | undefined, id: string): WaiverRow | undefined => list?.rows.find((r) => r.playerId === id);
const ids = (list: WaiverList | null | undefined) => list?.rows.map((r) => r.playerId) ?? [];
const waivers = (m: LeagueModel) => m.waiverUpgrades ?? null;

describe("who's listed (the planner's rule: more points than one of my players at his position)", () => {
  const { model } = build({ freeAgents: [p("fa1", "RB", 13), p("fa2", "RB", 5), p("fa3", "WR", 12), p("fa4", "QB", 19), p("fk", "K", 9), p("fd", "DEF", 6)] });
  const w = waivers(model);

  it("rest of season: a free agent who beats one of my players there, with every one of my players he beats, most points first", () => {
    expect(w?.ros?.weeks).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(rowOf(w?.ros, "fa1")?.betterThan).toEqual(["r2", "r3"]);
    expect(rowOf(w?.ros, "fa1")?.points).toBeCloseTo(13 * WEEKS_LEFT, 6);
    expect(rowOf(w?.ros, "fa3")?.betterThan).toEqual(["w2", "w3"]);
    // fa2 (5 a week) beats none of my RBs; fa4 (19) not my QB (20).
    expect(ids(w?.ros)).not.toContain("fa2");
    expect(ids(w?.ros)).not.toContain("fa4");
  });

  it("rest of season leaves out the positions I stream (K and D/ST by default); this week lists them", () => {
    expect(w?.ros?.positions).toEqual(["QB", "RB", "WR", "TE"]);
    expect(ids(w?.ros)).not.toContain("fk");
    expect(w?.week?.positions).toEqual(["QB", "RB", "WR", "TE", "K", "DEF"]);
    expect(w?.week?.weeks).toEqual([4]);
    expect(rowOf(w?.week, "fk")?.betterThan).toEqual(["k1"]);
    // The D/ST free agent (6) doesn't beat mine (7).
    expect(ids(w?.week)).not.toContain("fd");
    expect(w?.ros?.streaming).toBe(true);
    expect(w?.week?.streaming).toBe(false);
  });

  it("a position I don't stream is in the rest-of-season list (a kicker I hold)", () => {
    const held = build({ freeAgents: [p("fk", "K", 9)] }, NO_RISK, { settings: { ...defaultTradeSettings(), streamPositions: ["DEF"] } });
    expect(waivers(held.model)?.ros?.positions).toEqual(["QB", "RB", "WR", "TE", "K"]);
    expect(rowOf(waivers(held.model)?.ros, "fk")?.gain).toBeCloseTo(1 * WEEKS_LEFT, 6);
  });

  it("nothing without my team, or when the build skips it", () => {
    const l = league({ freeAgents: [p("fa1", "RB", 13)] });
    expect(buildLeagueModel({ ...l.snapshot, myTeamId: null }, l.inputs, OPTS, NO_RISK).waiverUpgrades).toBeNull();
    expect(buildLeagueModel(l.snapshot, l.inputs, { ...OPTS, waiverUpgrades: false }, NO_RISK).waiverUpgrades).toBeNull();
    expect(buildLeagueModel(l.snapshot, l.inputs, OPTS, NO_RISK).waiverUpgrades?.teamId).toBe("1");
  });
});

describe("the lineup gain: unweighted lineup points over the list's weeks, my roster as it stands", () => {
  it("an open roster spot: no drop, and the gain is what he adds to my starting lineup (by hand: RB2 13 for a FLEX 7)", () => {
    const { model } = build({ freeAgents: [p("fa1", "RB", 13)] });
    const w = waivers(model);
    const r = rowOf(w?.ros, "fa1");
    expect(r?.drop).toBeNull();
    // He starts at RB (13), r2 (12) moves to FLEX in place of w3 (7): +6 a week, every week, each counted once.
    expect(r?.gain).toBeCloseTo(6 * WEEKS_LEFT, 6);
    expect(r?.depthOnly).toBe(false);
    expect(rowOf(w?.week, "fa1")?.gain).toBeCloseTo(6, 6);
  });

  it("playoff weeks count once, whatever the automatic playoff weight (§6.1: the ROS points users see stay unweighted)", () => {
    const { model } = build({ freeAgents: [p("fa1", "RB", 13)] }, NO_RISK, { sims: 200 });
    expect(rowOf(waivers(model)?.ros, "fa1")?.gain).toBeCloseTo(6 * WEEKS_LEFT, 6);
  });

  it("a full roster drops the player whose loss costs the lineup least (a bench player who never starts), named in both lists", () => {
    const { model } = build({ mine: FULL, freeAgents: [p("fa1", "RB", 13)] });
    const w = waivers(model);
    const r = rowOf(w?.ros, "fa1");
    expect(["b1", "b2", "b3", "b4", "b5", "b6", "r3", "w3"]).toContain(r?.drop);
    expect(r?.gain).toBeCloseTo(6 * WEEKS_LEFT, 6);
    expect(rowOf(w?.week, "fa1")?.drop).toBe(r?.drop);
  });

  it("is exact: the scenario lineups of R + him − the drop against R's, solved here from the projection table (injury risk on)", () => {
    const l = league({ mine: FULL, freeAgents: [p("fa1", "RB", 13), p("fa3", "WR", 12), p("fa5", "RB", 7)] });
    const model = buildLeagueModel(l.snapshot, l.inputs, OPTS);
    const table = tableWithStreaming(buildProjectionTable(l.snapshot, l.inputs, OPTS), model);
    const slots = prepareLeagueSlots(l.snapshot.settings);
    const weights = Float64Array.from(model.weeks, () => 1);
    const roster = [...(l.snapshot.teams[0]?.roster ?? []), "stream:K", "stream:DEF"];
    const ros = (list: readonly string[]) => rosValue(scenarioValues(teamEval(tableRows(list, table), slots), model.weeks.length, model.scenarios).mean, weights);
    const before = ros(roster);
    const rows = waivers(model)?.ros?.rows ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.gain, r.playerId).toBeCloseTo(ros([...roster.filter((id) => id !== r.drop), r.playerId]) - before, 6);
  });

  it("this week prices the same move in its one week against my roster without the streamers (a kicker fills my kicker's bye)", () => {
    // My kicker is on bye in week 4 (team BYE); a free-agent kicker scores 9 that week.
    const mine = MINE.map((x) => (x.id === "k1" ? { ...x, nflTeam: "BYE" } : x));
    const { model } = build({ mine, byeWeek: { BYE: 4 }, freeAgents: [p("fk", "K", 9)] });
    const w = waivers(model);
    const r = rowOf(w?.week, "fk");
    // Six open spots: no drop; against my roster as it stands his 9 points fill the empty K spot.
    expect(r?.drop).toBeNull();
    expect(r?.gain).toBeCloseTo(9, 6);
    // My kicker doesn't play that week, so he isn't one a free agent is "better than": the list says why instead.
    expect(r?.betterThan).toEqual([]);
    expect(w?.week?.idle).toEqual([{ playerId: "k1", pos: "K", why: "bye" }]);
  });
});

describe("the drop: roster legality's rules for one pickup", () => {
  it("a position at its limit drops at that position (here the RB who costs least), even with an open spot", () => {
    const { model } = build({ positionLimits: { RB: 3 }, freeAgents: [p("fa1", "RB", 13)] });
    const r = rowOf(waivers(model)?.ros, "fa1");
    expect(r?.drop).toBe("r3");
    // He starts at RB2, r2 at FLEX (over w3): +6; r3 (6) never started: nothing lost.
    expect(r?.gain).toBeCloseTo(6 * WEEKS_LEFT, 6);
  });

  it("never the last player at a position I stream, nor one the starting lineup needs: the next one in drop order goes", () => {
    // A full roster where, by id, the first two in drop order can't go: "a1", my only kicker (a free agent kicker is the
    // streaming replacement, so mine never starts: he costs nothing), and "aa", my only TE, out for the season (costs
    // nothing, but the TE slot needs him). b1 is next. With "Drop from the same position" off (Checkpoint 7e), so every
    // position's players are candidates.
    const anyPosition = { settings: { ...defaultTradeSettings(), waiverSamePosition: false } };
    const mine = [
      p("q1", "QB", 20),
      p("r1", "RB", 15),
      p("r2", "RB", 12),
      p("r3", "RB", 6),
      p("w1", "WR", 14),
      p("w2", "WR", 11),
      p("w3", "WR", 7),
      p("aa", "TE", 8, { injury: "IR", injuryReturnWeek: 30 }),
      p("a1", "K", 8),
      p("d1", "DEF", 7),
      p("b1", "RB", 1),
      p("b2", "RB", 1.5),
      p("b3", "WR", 2),
      p("b4", "WR", 2.5),
      p("b5", "QB", 3),
      p("b7", "WR", 0.5),
    ];
    const { model } = build({ mine, nflLastWeek: 18, freeAgents: [p("fa1", "RB", 13), p("fk", "K", 10)] }, NO_RISK, anyPosition);
    // The preconditions: "aa" scores nothing, and the streamed kicker (the free agent's 10) beats "a1" every week.
    expect(model.players.aa?.ros.total).toBe(0);
    expect(model.streaming.replacement.K?.every((x) => x === 10)).toBe(true);
    const r = rowOf(waivers(model)?.ros, "fa1");
    expect(r?.drop).toBe("b1");
    expect(r?.gain).toBeCloseTo(6 * WEEKS_LEFT, 6);
    // With a second TE on the roster, "aa" is the one who goes (the lineup no longer needs him).
    const spare = build({ mine: [...mine.filter((x) => x.id !== "b7"), p("t9", "TE", 4)], nflLastWeek: 18, freeAgents: [p("fa1", "RB", 13), p("fk", "K", 10)] }, NO_RISK, anyPosition);
    expect(rowOf(waivers(spare.model)?.ros, "fa1")?.drop).toBe("aa");
    // "Drop from the same position" on (the default): an RB for an RB, so "aa" (a TE) never goes for him.
    expect(rowOf(waivers(build({ mine: [...mine.filter((x) => x.id !== "b7"), p("t9", "TE", 4)], nflLastWeek: 18, freeAgents: [p("fa1", "RB", 13), p("fk", "K", 10)] }).model)?.ros, "fa1")?.drop).toBe("b1");
  });

  it("with long-term values (dynasty), the keep value adds them, as roster legality's does: a stash worth 9000 stays", () => {
    // An 11-player roster, full: b1 (RB, 1 a week, worth 9000) never starts; r3 starts once (week 6: r2 and w3 on bye) and w3
    // once (week 7: w1 on bye), so in lineup points alone b1 costs least.
    const valued = (x: TestPlayer): TestPlayer => ({ ...x, value: 500, ...(x.id === "r2" || x.id === "w3" ? { nflTeam: "T6" } : x.id === "w1" ? { nflTeam: "T7" } : {}) });
    const mine = [...MINE.map(valued), p("b1", "RB", 1, { value: 9000 })];
    const spec: Spec = { mine, byeWeek: { T6: 6, T7: 7 }, freeAgents: [p("fa1", "RB", 13, { value: 500 })] };
    const run = (leagueType: "redraft" | "dynasty") => {
      const l = league({ ...spec, leagueType });
      const settings = { ...l.snapshot.settings, maxRosterSize: 11 };
      const market = l.inputs.market ? { ...l.inputs.market, format: { ...l.inputs.market.format, isDynasty: leagueType === "dynasty" } } : null;
      return rowOf(buildLeagueModel({ ...l.snapshot, settings }, { ...l.inputs, market }, OPTS, NO_RISK).waiverUpgrades?.ros, "fa1");
    };
    expect(run("redraft")?.drop).toBe("b1");
    const dyn = run("dynasty");
    expect(dyn?.drop).toBe("r3");
    // The gain is still lineup points: what he adds less what r3's one start was worth (6, b1's 1 taking his place).
    expect(dyn?.gain).toBeCloseTo((run("redraft")?.gain ?? Number.NaN) - 5, 6);
  });

  it("a kicker for my kicker: the old one can go (two at the position after the add)", () => {
    const { model } = build({ positionLimits: { K: 1 }, freeAgents: [p("fk", "K", 9)] });
    const r = rowOf(waivers(model)?.week, "fk");
    expect(r?.drop).toBe("k1");
    expect(r?.gain).toBeCloseTo(1, 6);
  });

  it("at a position's limit the drop is at that position: a QB for my QB", () => {
    const { model } = build({ positionLimits: { QB: 1 }, freeAgents: [p("fq", "QB", 25)] });
    const q = rowOf(waivers(model)?.ros, "fq");
    expect(q?.drop).toBe("q1");
    expect(q?.gain).toBeCloseTo(5 * WEEKS_LEFT, 6);
  });

  it("nobody who can make room (the only QB at the limit has no projections): no gain, no drop", () => {
    const mine = MINE.map((x) => (x.id === "q1" ? { ...x, noInputs: true } : x));
    const { model } = build({ mine, positionLimits: { QB: 1 }, freeAgents: [p("fq", "QB", 25)] });
    const q = rowOf(waivers(model)?.ros, "fq");
    // No QB with projections on my roster: the best free agents there are listed, with nobody to beat.
    expect(q?.betterThan).toEqual([]);
    expect(q?.gain).toBeNull();
    expect(q?.drop).toBeNull();
    expect(q?.depthOnly).toBe(false);
    expect(waivers(model)?.ros?.rows.at(-1)?.playerId).toBe("fq");
  });
});

describe("depth only, the order and the caps", () => {
  it("'depth only': he wouldn't start in an expected week, his gain only covering injuries; a starter isn't", () => {
    // w3 (7) is my FLEX; fa5 (6.5) beats r3 (6) but starts nowhere.
    const { model } = build({ mine: FULL, freeAgents: [p("fa5", "RB", 6.5), p("fa1", "RB", 13)] }, config);
    const w = waivers(model);
    expect(rowOf(w?.ros, "fa5")?.depthOnly).toBe(true);
    expect(rowOf(w?.ros, "fa1")?.depthOnly).toBe(false);
  });

  it("most lineup gain first as the page prints it, then more points, then the smaller id", () => {
    const { model } = build({ freeAgents: [p("fa1", "RB", 13), p("fa3", "WR", 12), p("fa6", "WR", 7.5), p("fa7", "RB", 6.5)] });
    const rows = waivers(model)?.ros?.rows ?? [];
    expect(rows.length).toBe(4);
    const shown = (r: WaiverRow) => (r.gain === null ? -1 : Math.max(0, gainSteps(r.gain, config.waivers.gainDecimals)));
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1] as WaiverRow;
      const b = rows[i] as WaiverRow;
      expect(shown(a) > shown(b) || (shown(a) === shown(b) && (a.points > b.points || (a.points === b.points && a.playerId < b.playerId))), `${a.playerId} before ${b.playerId}`).toBe(true);
    }
    expect(rows[0]?.playerId).toBe("fa1");
  });

  it("gains that print the same tie, and every gain that prints as none is one tie: points decide (review: float noise did)", () => {
    // config.waivers.gainDecimals 1: the page rounds as format.ts fmtNum does (half away from zero).
    expect(config.waivers.gainDecimals).toBe(1);
    expect(gainSteps(2.25, 1)).toBe(23);
    expect(gainSteps(0.04, 1)).toBe(0);
    expect(gainSteps(-0.04, 1)).toBe(0);
    expect(gainSteps(-0.36, 1)).toBe(-4);
    const row = (playerId: string, gain: number | null, points: number) => ({ playerId, gain, points });
    const order = (...rows: ReturnType<typeof row>[]) => [...rows].sort((a, b) => compareWaiverRows(a, b, 1)).map((r) => r.playerId);
    // Equal but for float noise (−0.367916949936 and the same less 1.4e-14, on Parker's data): more points first.
    expect(order(row("moore", -0.367916949936, 0.7), row("lemon", -0.367916949936 - 1.4e-14, 5.5))).toEqual(["lemon", "moore"]);
    // Hidden losses don't order rows that all read "No gain": an exact 0 and a loss of 0.36 tie.
    expect(order(row("mitchell", -0.3599, 3.5), row("andrews", -0.3679, 7.3), row("zero", 0, 1))).toEqual(["andrews", "mitchell", "zero"]);
    // Two gains that print +0.3 tie; +0.4 comes first; a move that can't be made is last, whatever its points.
    expect(order(row("b", 0.25, 2), row("a", 0.3000000000000001, 1), row("c", 0.35, 0.5), row("none", null, 50))).toEqual(["c", "b", "a", "none"]);
    // Equal shown gains and points: the smaller id.
    expect(order(row("y", 0.31, 4), row("x", 0.29, 4))).toEqual(["x", "y"]);
  });

  it("at most config.waivers.perPositionCap kickers (the best this week), and the best few where I roster nobody", () => {
    const kickers = Array.from({ length: 6 }, (_, i) => p(`fk${i}`, "K", 8.5 + i * 0.1));
    const tes = Array.from({ length: 5 }, (_, i) => p(`ft${i}`, "TE", 3 + i));
    const { model } = build({ mine: MINE.filter((x) => x.id !== "t1"), freeAgents: [...kickers, ...tes] });
    const w = waivers(model);
    const cap = config.waivers.perPositionCap;
    expect(ids(w?.week).filter((id) => id.startsWith("fk"))).toEqual(["fk5", "fk4", "fk3", "fk2", "fk1", "fk0"].slice(0, cap));
    // No TE on my roster: the best TEs by points, with nobody to beat, each filling the empty TE spot.
    const listed = (w?.ros?.rows ?? []).filter((r) => r.playerId.startsWith("ft"));
    expect(listed.map((r) => r.playerId)).toEqual(["ft4", "ft3", "ft2", "ft1", "ft0"].slice(0, cap));
    for (const r of listed) expect(r.betterThan).toEqual([]);
    expect(rowOf(w?.ros, "ft4")?.gain).toBeCloseTo(7 * WEEKS_LEFT, 6);
  });
});

describe("my players who don't play aren't compared (review: one bye listed every free agent at the position)", () => {
  it("one week: a free agent must beat one of mine who plays that week; the one on bye is named instead", () => {
    // w3 (my FLEX, 7) is on bye in week 4. Before the review every free-agent WR "beat" his 0 points that week.
    const mine = MINE.map((x) => (x.id === "w3" ? { ...x, nflTeam: "BYE" } : x));
    const { model } = build({ mine, byeWeek: { BYE: 4 }, freeAgents: [p("fw1", "WR", 12), p("fw2", "WR", 6), p("fw3", "WR", 1)] });
    const w = waivers(model)?.week;
    expect(ids(w)).toEqual(["fw1"]);
    expect(rowOf(w, "fw1")?.betterThan).toEqual(["w2"]);
    // r3 (6) fills the FLEX that week; fw1 takes WR2 and w2 the FLEX: 12 + 11 − 11 − 6.
    expect(rowOf(w, "fw1")?.gain).toBeCloseTo(6, 6);
    expect(w?.idle).toEqual([{ playerId: "w3", pos: "WR", why: "bye" }]);
    // The rest of the season knows no single week: w3 (7 a week, 13 games) still counts there.
    expect(waivers(model)?.ros?.idle).toEqual([]);
  });

  it("where none of mine at a position plays that week, the best few there are listed, each beating nobody", () => {
    const mine = MINE.map((x) => (x.id === "t1" ? { ...x, nflTeam: "BYE" } : x));
    const tes = Array.from({ length: 5 }, (_, i) => p(`ft${i}`, "TE", 1 + i));
    const { model } = build({ mine, byeWeek: { BYE: 4 }, freeAgents: tes });
    const w = waivers(model)?.week;
    const listed = (w?.rows ?? []).filter((r) => r.playerId.startsWith("ft"));
    expect(listed.map((r) => r.playerId)).toEqual(["ft4", "ft3", "ft2", "ft1", "ft0"].slice(0, config.waivers.perPositionCap));
    for (const r of listed) expect(r.betterThan).toEqual([]);
    // The best fills my empty TE spot that week.
    expect(rowOf(w, "ft4")?.gain).toBeCloseTo(5, 6);
    expect(w?.idle).toEqual([{ playerId: "t1", pos: "TE", why: "bye" }]);
  });

  it("⚠️ rest of season: a player of mine out for the season is beaten by the best few free agents there, he the drop (the final review of Checkpoint 7e, ENG-7E-3)", () => {
    // w3 is out for the season (no points left). Until the final review he wasn't compared at all, so a free agent had to beat
    // a WR of mine who still plays: with the user's own "Out for the season" (item 3.5) the list had no row at his position.
    // Now the best perPositionCap who beat only him are listed too, each dropping him; "Better than" names him.
    // A full roster (16) whose WRs are w1 (14), w2 (11) and w3, out: the bench WRs made an RB and a QB.
    const mine = FULL.map((x) => (x.id === "w3" ? { ...x, injury: "IR" as const, injuryReturnWeek: 30 } : x.id === "b3" ? p("b3", "RB", 1.2) : x.id === "b4" ? p("b4", "QB", 2.5) : x));
    const wrs = [p("fw1", "WR", 12), ...Array.from({ length: 5 }, (_, i) => p(`fx${i}`, "WR", 2 + i))];
    const { model } = build({ mine, nflLastWeek: 18, freeAgents: wrs });
    const w = waivers(model);
    const ros = w?.ros;
    expect(model.players.w3?.ros.total).toBe(0);
    expect(rowOf(ros, "fw1")?.betterThan).toEqual(["w2", "w3"]);
    const spentOnly = ["fx4", "fx3", "fx2", "fx1", "fx0"].slice(0, config.waivers.perPositionCap);
    expect(ids(ros).filter((id) => id.startsWith("fx"))).toEqual(spentOnly);
    for (const id of spentOnly) {
      expect(rowOf(ros, id)?.betterThan).toEqual(["w3"]);
      // He's the drop: losing him costs my lineup nothing (the lowest keep value at WR).
      expect(rowOf(ros, id)?.drop).toBe("w3");
      expect(rowOf(ros, id)?.gain).toBeGreaterThanOrEqual(0);
    }
    expect(ros?.idle).toEqual([{ playerId: "w3", pos: "WR", why: "out" }]);
    // One week: he's idle as before, so a free agent must beat a WR of mine who plays that week (fw1 does, no fx).
    expect(ids(w?.week).filter((id) => id.startsWith("f"))).toEqual(["fw1"]);
    expect(w?.week?.idle).toEqual([{ playerId: "w3", pos: "WR", why: "out" }]);
  });

  it("⚠️ an untouchable out for the season adds nobody, and neither does one where none of mine scores (the rule for none: the best few, beating nobody)", () => {
    const mine = MINE.map((x) => (x.id === "w3" ? { ...x, injury: "IR" as const, injuryReturnWeek: 30 } : x));
    const free = [p("fw1", "WR", 12), p("fw2", "WR", 6)];
    const locked = build({ mine, nflLastWeek: 18, freeAgents: free }, NO_RISK, { settings: { ...defaultTradeSettings(), untouchables: ["w3"] } });
    expect(ids(waivers(locked.model)?.ros)).toEqual(["fw1"]);
    expect(rowOf(waivers(locked.model)?.ros, "fw1")?.betterThan).toEqual(["w2"]);
    // My only TE out for the season: none of mine at TE scores, so the best few there, each beating nobody, as before.
    const te = MINE.map((x) => (x.id === "t1" ? { ...x, injury: "IR" as const, injuryReturnWeek: 30 } : x));
    const tes = build({ mine: te, nflLastWeek: 18, freeAgents: [p("ft1", "TE", 5), p("ft2", "TE", 3)] });
    for (const id of ["ft1", "ft2"]) expect(rowOf(waivers(tes.model)?.ros, id)?.betterThan).toEqual([]);
  });
});

describe("the one-week lists while the current week is under way", () => {
  it("next week is the week after it (its lineups are locking), and the rest of season starts there too", () => {
    const kick = new Date(TEST_NOW.getTime() - 3_600_000).toISOString();
    const { model } = build({ kickoffs: { 4: { AAA: kick } }, freeAgents: [p("fa1", "RB", 13)] });
    const w = waivers(model);
    expect(model.inProgressWeek).toBe(4);
    expect(w?.week?.weeks).toEqual([5]);
    expect(w?.ros?.weeks[0]).toBe(5);
    expect(rowOf(w?.ros, "fa1")?.gain).toBeCloseTo(6 * (WEEKS_LEFT - 1), 6);
    // Every game of week 4 has kicked off (AAA is every team here): no list for it.
    expect(w?.underWay).toBeNull();
  });

  it("no list for a week under way when none is (a week whose games are all still to play is 'This week' itself)", () => {
    const { model } = build({ kickoffs: { 4: { LAT: new Date(TEST_NOW.getTime() + 86_400_000).toISOString() } }, freeAgents: [p("fa1", "RB", 13)] });
    expect(model.inProgressWeek).toBeNull();
    expect(waivers(model)?.underWay).toBeNull();
    expect(waivers(model)?.week?.weeks).toEqual([4]);
  });

  describe("'This week' from its games still to play (review: the week 'Streaming picks this week' lists)", () => {
    // EAR played an hour ago, LAT plays tomorrow. My RB1 (r1) and my kicker (k1) played: they hold their slots.
    const EAR = new Date(TEST_NOW.getTime() - 3_600_000).toISOString();
    const LAT = new Date(TEST_NOW.getTime() + 86_400_000).toISOString();
    const early = new Set(["r1", "k1", "b1"]);
    const team = (x: TestPlayer): TestPlayer => ({ ...x, nflTeam: early.has(x.id) ? "EAR" : "LAT" });
    const mine = [p("q1", "QB", 20), p("r1", "RB", 15), p("r2", "RB", 12), p("r3", "RB", 2), p("w1", "WR", 14), p("w2", "WR", 11), p("w3", "WR", 7), p("t1", "TE", 8), p("k1", "K", 8), p("d1", "DEF", 7)].map(team);
    const fas = [p("fa1", "RB", 13), p("fw", "WR", 12), p("fk", "K", 9), p("fe", "RB", 20, { nflTeam: "EAR" })].map((x) => (x.id === "fe" ? x : team(x)));
    const { model } = build({ mine, kickoffs: { 4: { EAR, LAT } }, freeAgents: fas });
    const w = waivers(model);

    it("counts only the week under way, with every position the lineup starts, and names my players whose games have started", () => {
      expect(model.inProgressWeek).toBe(4);
      expect(w?.underWay?.weeks).toEqual([4]);
      expect(w?.underWay?.positions).toEqual(["QB", "RB", "WR", "TE", "K", "DEF"]);
      expect(w?.underWay?.streaming).toBe(false);
      expect(w?.underWay?.idle).toEqual([
        { playerId: "r1", pos: "RB", why: "started" },
        { playerId: "k1", pos: "K", why: "started" },
      ]);
      // The other lists as before: next week is week 5.
      expect(w?.week?.weeks).toEqual([5]);
    });

    it("holds a starter whose game has started in a starting slot: the RB adds 6, not the 11 an empty RB slot would give", () => {
      const r = rowOf(w?.underWay, "fa1");
      // r1 played: his slot is taken (his points are in). fa1 (13) takes RB2 and r2 (12) the FLEX from w3 (7): 13 + 12 − 12 − 7.
      // Had r1's slot counted as empty (he scores 0 now), fa1 would have added 13 + 12 + 7 − 12 − 2 − 7 = 11.
      expect(r?.gain).toBeCloseTo(6, 6);
      expect(r?.drop).toBeNull();
      // Compared with my RBs who still play.
      expect(r?.betterThan).toEqual(["r2", "r3"]);
      // fw (12) takes WR2 and w2 (11) the FLEX from w3: 12 + 11 − 11 − 7.
      expect(rowOf(w?.underWay, "fw")?.gain).toBeCloseTo(5, 6);
    });

    it("lists no free agent whose game has started, and none at a position whose slot one of mine holds (the kicker)", () => {
      expect(ids(w?.underWay)).not.toContain("fe");
      // My kicker played: the K slot is locked, so a kicker still to play adds nothing this week and isn't listed …
      expect(ids(w?.underWay)).not.toContain("fk");
      // … while next week he beats mine (9 against 8).
      expect(rowOf(w?.week, "fk")?.gain).toBeCloseTo(1, 6);
    });

    it("never drops a player whose game has started (he's locked): the next one in the drop order goes, this week only", () => {
      // A full roster whose bench players never start: b1 (whose game has started) is first in the drop order, b2 next.
      const bench = [p("b1", "RB", 1), p("b2", "RB", 1.5), p("b3", "WR", 2), p("b4", "WR", 2.5), p("b5", "QB", 3), p("b6", "TE", 1)].map(team);
      const full = build({ mine: [...mine, ...bench], kickoffs: { 4: { EAR, LAT } }, freeAgents: fas });
      const fw = waivers(full.model);
      expect(rowOf(fw?.ros, "fa1")?.drop).toBe("b1");
      expect(rowOf(fw?.week, "fa1")?.drop).toBe("b1");
      expect(rowOf(fw?.underWay, "fa1")?.drop).toBe("b2");
      expect(rowOf(fw?.underWay, "fa1")?.gain).toBeCloseTo(6, 6);
    });

    it("⚠️ a locked starter counts in whichever slot he fits that leaves the most room (the lineup actually set isn't read)", () => {
      // w3 started in the FLEX before kickoff (7, over r3's 2) and played. Counted at WR2 instead, w2 (still to play) can
      // move to the FLEX, so fa1 takes RB2 and r2 the FLEX: 13 + 12 − 12 − 11 = 2 (1 if w3 is held in the FLEX itself).
      const flexEarly = (x: TestPlayer): TestPlayer => ({ ...x, nflTeam: x.id === "w3" ? "EAR" : "LAT" });
      const m = build({ mine: mine.map(flexEarly), kickoffs: { 4: { EAR, LAT } }, freeAgents: fas.map((x) => (x.id === "fe" ? x : flexEarly(x))) });
      expect(rowOf(waivers(m.model)?.underWay, "fa1")?.gain).toBeCloseTo(2, 6);
    });
  });

  it("nothing once no week is left", () => {
    const { model } = build({ currentWeek: 18, freeAgents: [p("fa1", "RB", 13)] });
    expect(model.weeks).toEqual([]);
    expect(waivers(model)).toEqual({ teamId: "1", ros: null, underWay: null, week: null, samePosition: true, untouchables: [] });
  });
});

describe("one number in both places: the League page's pickup gain is Waiver upgrades' (planner reply to Checkpoint 7b, Q6)", () => {
  // Injury risk on (config's), so the scenario lineups aren't the expected-value ones; sims 0, so ω is its fallback (1.25)
  // and the optimizer's own gains weigh the playoff weeks more.
  const cases: { name: string; spec: Spec }[] = [
    { name: "an open roster spot", spec: { freeAgents: [p("fa1", "RB", 13)] } },
    {
      // Full (16): an RB out for the season (no points in any week) is both rules' drop.
      name: "a full roster",
      spec: { mine: [...FULL.filter((x) => x.id !== "b6"), p("bz", "RB", 8, { injury: "IR", injuryReturnWeek: 30 })], nflLastWeek: 18, freeAgents: [p("fa1", "RB", 13)] },
    },
  ];

  /** The model with my team claiming free agents first (the waiver order: team 2, whose FLEX is empty, would gain more). */
  const mineFirst = (spec: Spec, cfg: LeagueModelConfig): LeagueModel => {
    const l = league(spec);
    const snapshot = { ...l.snapshot, teams: l.snapshot.teams.map((t) => ({ ...t, waiverRank: t.id === "1" ? 1 : 2 })) };
    return buildLeagueModel(snapshot, l.inputs, OPTS, cfg);
  };

  it.each(cases)("$name: my first pickup's plain scenario gain is the rest-of-season row for the same free agent and drop", ({ spec }) => {
    const model = mineFirst(spec, config);
    expect(model.faAllocation?.order[0]).toBe("1");
    expect(model.playoffWeight).toBe(config.lineups.playoffWeight);
    const move = model.teams.find((t) => t.id === "1")?.faMoves[0];
    if (!move) throw new Error("expected a pickup");
    const row = rowOf(waivers(model)?.ros, move.add);
    // The same pickup with the same drop, from my roster as it stands …
    expect(row?.drop).toBe(move.drop);
    // … adds the same lineup points, each week counted once (the row is solved on its own: waivers.ts).
    expect(move.gainScenPlain as number).toBeCloseTo(row?.gain as number, 9);
    // The optimizer's own gain weighs the playoff weeks by ω: more, so it isn't the number either page shows.
    expect(move.gainScen as number).toBeGreaterThan((move.gainScenPlain as number) + 1);
    expect(move.gainEv).toBeGreaterThan(move.gainEvPlain + 1);
  });

  it("⚠️ a later pickup is counted after the ones above it (the optimizer's order), so its row, priced alone from my roster as it stands, can read differently (review of Q6)", () => {
    // Two RBs for my open spots: each would start alone, but after the first the second competes with him.
    const model = mineFirst({ freeAgents: [p("fa1", "RB", 13), p("fa2", "RB", 12.5)] }, config);
    const moves = model.teams.find((t) => t.id === "1")?.faMoves ?? [];
    expect(moves.map((m) => [m.add, m.drop])).toEqual([
      ["fa1", null],
      ["fa2", null],
    ]);
    const [first, second] = moves;
    const w = waivers(model);
    // The first pickup is the row's number …
    expect(first?.gainScenPlain as number).toBeCloseTo(rowOf(w?.ros, "fa1")?.gain as number, 9);
    // … the second adds much less after the first than his row says he adds alone, with the same open spot.
    expect(rowOf(w?.ros, "fa2")?.drop).toBeNull();
    expect(rowOf(w?.ros, "fa2")?.gain as number).toBeGreaterThan((second?.gainScenPlain as number) + 10);
  });

  it("with ω at 1 the plain gains are the weighted ones, to the bit", () => {
    const plain: LeagueModelConfig = { ...config, lineups: { ...config.lineups, playoffWeight: 1 } };
    for (const { spec } of cases) {
      const model = mineFirst(spec, plain);
      expect(model.playoffWeight).toBe(1);
      const moves = model.teams.flatMap((t) => t.faMoves);
      expect(moves.length).toBeGreaterThan(0);
      for (const m of moves) {
        expect(m.gainEvPlain).toBe(m.gainEv);
        expect(m.gainScenPlain).toBe(m.gainScen);
      }
    }
  });
});

describe("Checkpoint 7e: one move per row, “Drop from the same position” and untouchables (planner reply to Checkpoint 7d, items 3.1–3.3)", () => {
  /** My settings with "Drop from the same position" and the untouchables given. */
  const settings = (samePosition: boolean, untouchables: string[] = []) => ({ settings: { ...defaultTradeSettings(), waiverSamePosition: samePosition, untouchables } });

  it("each row carries the drop's points in the list's terms (3.1: “outscores B by 18”): rest-of-season points, the week's projection", () => {
    const { model } = build({ mine: FULL, freeAgents: [p("fa1", "RB", 13)] });
    const w = waivers(model);
    const ros = rowOf(w?.ros, "fa1");
    expect(ros?.drop).not.toBeNull();
    expect(ros?.dropPoints).toBeCloseTo(model.players[ros?.drop as string]?.ros.total as number, 9);
    const week = rowOf(w?.week, "fa1");
    expect(week?.dropPoints).toBeCloseTo(model.players[week?.drop as string]?.weekly[0]?.p as number, 9);
    // An open spot has no drop's points; nor does a row that can't be made.
    expect(rowOf(waivers(build({ freeAgents: [p("fa1", "RB", 13)] }).model)?.ros, "fa1")?.dropPoints).toBeNull();
  });

  it("3.2, on (the default): the drop plays his position; off: any position (the drop order's lowest), in every list", () => {
    // FULL's six bench players never start: each costs the lineup nothing, so the smaller id goes among them.
    const on = waivers(build({ mine: FULL, freeAgents: [p("fa3", "WR", 12)] }).model);
    expect(on?.samePosition).toBe(true);
    expect(rowOf(on?.ros, "fa3")?.drop).toBe("b3");
    expect(rowOf(on?.week, "fa3")?.drop).toBe("b3");
    const off = waivers(build({ mine: FULL, freeAgents: [p("fa3", "WR", 12)] }, NO_RISK, settings(false)).model);
    expect(off?.samePosition).toBe(false);
    expect(rowOf(off?.ros, "fa3")?.drop).toBe("b1");
    expect(rowOf(off?.week, "fa3")?.drop).toBe("b1");
    // The same lineup gain either way: neither bench player ever starts.
    expect(rowOf(off?.ros, "fa3")?.gain).toBeCloseTo(rowOf(on?.ros, "fa3")?.gain as number, 9);
  });

  it("3.3: an untouchable is never the drop; the next one in drop order goes, and the lists name my untouchables", () => {
    const w = waivers(build({ mine: FULL, freeAgents: [p("fa3", "WR", 12)] }, NO_RISK, settings(true, ["b3", "q1"])).model);
    expect(rowOf(w?.ros, "fa3")?.drop).toBe("b4");
    expect(rowOf(w?.week, "fa3")?.drop).toBe("b4");
    // Roster order; only my active players with a model (an untouchable id not on my roster is no drop candidate anyway).
    expect(w?.untouchables).toEqual(["q1", "b3"]);
  });

  it("3.3: every candidate at his position untouchable: the row says so, names them, and says a player at another position could go", () => {
    const wrs = ["w1", "w2", "w3", "b3", "b4"];
    const w = waivers(build({ mine: FULL, freeAgents: [p("fa3", "WR", 12)] }, NO_RISK, settings(true, wrs)).model);
    const r = rowOf(w?.ros, "fa3");
    expect(r?.gain).toBeNull();
    expect(r?.drop).toBeNull();
    expect(r?.dropPoints).toBeNull();
    expect(r?.blocked).toEqual({ why: "untouchable", atPosition: true, otherPosition: true, untouchable: wrs });
    expect(rowOf(w?.week, "fa3")?.blocked).toEqual(r?.blocked);
    // With the switch off a bench RB makes room: no message.
    const off = waivers(build({ mine: FULL, freeAgents: [p("fa3", "WR", 12)] }, NO_RISK, settings(false, wrs)).model);
    expect(rowOf(off?.ros, "fa3")?.drop).toBe("b1");
    expect(rowOf(off?.ros, "fa3")?.blocked).toBeNull();
  });

  it("3.3, the switch off: every player who could go untouchable reads “all the players you could drop”, no suggestion", () => {
    const all = FULL.map((x) => x.id);
    const w = waivers(build({ mine: FULL, freeAgents: [p("fa3", "WR", 12)] }, NO_RISK, settings(false, all)).model);
    const r = rowOf(w?.ros, "fa3");
    expect(r?.gain).toBeNull();
    expect(r?.blocked?.why).toBe("untouchable");
    expect(r?.blocked?.atPosition).toBe(false);
    expect(r?.blocked?.otherPosition).toBe(false);
    // The ones who could otherwise go: never the last at a position I stream (my K and D/ST), nor one the lineup needs.
    expect(r?.blocked?.untouchable).not.toContain("k1");
    expect(r?.blocked?.untouchable).not.toContain("d1");
    expect(r?.blocked?.untouchable).toContain("b1");
  });

  it("no room at his position (no TE of mine to drop): “room”, and turning the switch off would let a bench player go", () => {
    // FULL without its TEs, two bench players in their place: still 16, no TE on my roster.
    const noTe = [...FULL.filter((x) => x.pos !== "TE"), p("b8", "RB", 0.5), p("b9", "WR", 0.4)];
    const w = waivers(build({ mine: noTe, freeAgents: [p("ft", "TE", 9)] }).model);
    const r = rowOf(w?.ros, "ft");
    expect(r?.gain).toBeNull();
    expect(r?.blocked).toEqual({ why: "room", atPosition: true, otherPosition: true, untouchable: [] });
    const off = waivers(build({ mine: noTe, freeAgents: [p("ft", "TE", 9)] }, NO_RISK, settings(false)).model);
    expect(rowOf(off?.ros, "ft")?.gain).not.toBeNull();
    expect(rowOf(off?.ros, "ft")?.blocked).toBeNull();
  });

  it("3.3, who's listed: a free agent must out-project one of mine a row could drop, so locking weak players lists no move that drops a better one (review of wave C, RC-ENG-2)", () => {
    // My RBs: r1 15, r2 12, r3 6, b1 1, b2 1.5 a week. fa5 (8) and fa6 (7) beat r3, b1 and b2; fa8 (2) only b1 and b2.
    const fas = [p("fa5", "RB", 8), p("fa6", "RB", 7), p("fa7", "RB", 6.5), p("fa8", "RB", 2)];
    const open = waivers(build({ mine: FULL, freeAgents: fas }).model);
    expect(ids(open?.ros)).toEqual(["fa5", "fa6", "fa7", "fa8"]);
    // r3, b1 and b2 locked: every RB of mine a row could drop (r1, r2) out-projects them all, so none is listed (each would
    // have dropped r2, who scores more than he does).
    const weak = waivers(build({ mine: FULL, freeAgents: fas }, NO_RISK, settings(true, ["r3", "b1", "b2"])).model);
    expect(ids(weak?.ros)).toEqual([]);
    expect(ids(weak?.week)).toEqual([]);
    // Without the switch too: the rule compares players at his position, the planner's.
    expect(ids(waivers(build({ mine: FULL, freeAgents: fas }, NO_RISK, settings(false, ["r3", "b1", "b2"])).model)?.ros)).toEqual([]);
    // Every RB of mine locked: the best few who beat one of them (config.waivers.perPositionCap), each saying why it can't be
    // made; "Better than" names the locked players he beats.
    const all = waivers(build({ mine: FULL, freeAgents: fas }, NO_RISK, settings(true, ["r1", "r2", "r3", "b1", "b2"])).model);
    expect(ids(all?.ros)).toEqual(["fa5", "fa6", "fa7"].slice(0, config.waivers.perPositionCap));
    expect(rowOf(all?.ros, "fa5")?.blocked?.why).toBe("untouchable");
    expect(rowOf(all?.ros, "fa5")?.betterThan).toEqual(["r3", "b2", "b1"]);
    // One RB unlocked who scores less than fa5: listed again, dropping him.
    const one = waivers(build({ mine: FULL, freeAgents: fas }, NO_RISK, settings(true, ["r1", "r2", "r3", "b2"])).model);
    expect(ids(one?.ros)).toEqual(["fa5", "fa6", "fa7", "fa8"]);
    expect(rowOf(one?.ros, "fa8")?.drop).toBe("b1");
  });

  it("waiverRatingPending: a season list to rate (a move that can be made, not rated yet) and the odds to rate it on (review of wave C, RC-ENG-6)", () => {
    const ros = (rows: { gain: number | null }[], rating: unknown = null) => ({ waiverUpgrades: { ros: { rows, rating } } }) as unknown as Pick<LeagueModel, "waiverUpgrades">;
    const odds = { odds: {}, helpsCalibration: {} } as unknown as Pick<LeagueModel, "odds" | "helpsCalibration">;
    expect(waiverRatingPending({ ...ros([{ gain: 1 }, { gain: null }]), ...odds })).toBe(true);
    expect(waiverRatingPending({ ...ros([{ gain: null }]), ...odds })).toBe(false);
    expect(waiverRatingPending({ ...ros([]), ...odds })).toBe(false);
    expect(waiverRatingPending({ ...ros([{ gain: 1 }], { b3: 1 }), ...odds })).toBe(false);
    expect(waiverRatingPending({ ...ros([{ gain: 1 }]), odds: null, helpsCalibration: odds.helpsCalibration })).toBe(false);
    expect(waiverRatingPending({ ...ros([{ gain: 1 }]), odds: odds.odds, helpsCalibration: null })).toBe(false);
    expect(waiverRatingPending({ waiverUpgrades: null, ...odds })).toBe(false);
  });

  it("an unrated build (no season simulated here) has no rating on its season list", () => {
    const w = waivers(build({ mine: FULL, freeAgents: [p("fa1", "RB", 13)] }).model);
    expect(w?.ros?.rating).toBeNull();
    expect(rowOf(w?.ros, "fa1")?.rating).toBeUndefined();
    expect(w?.week).not.toHaveProperty("rating");
  });
});
