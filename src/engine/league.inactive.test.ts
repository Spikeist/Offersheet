/**
 * Inactive teams (planner reply to Checkpoint 4c, A4: "Teams with no transactions in the last 5 weeks (or none this season,
 * if fewer than 5 weeks have passed) make no baseline pickups"; acceptance.inactiveTeams, league.ts step 5, evaluate.ts):
 * the rule on the activity feature's own window, the League model (no pickups, no claims, no refill in lineup costs, the
 * pinned MV_add, no streaming, leagueMarginals), and the trade evaluation (no V*(after) move and no legality rule-4 add for
 * an inactive partner, rule 3 still; an inactive team between the two isn't "a team between them"). Made-up leagues
 * (CLAUDE.md §16); teams are placeholders.
 */
import { describe, expect, it } from "vitest";
import { TRANSACTIONS_INCOMPLETE_CODES, activity, inactiveRuleBlock, inactiveTeams, transactedWithin, withinLastWeeks } from "./acceptance";
import { config } from "./config";
import { buildTradeContext, tradeInternals, tradeSides, type TeamState } from "./evaluate";
import { buildLeagueModel, buildLeagueModelWithContext, leagueMarginals, streamedPositions, type BuildLeagueModelOptions, type LeagueModelConfig } from "./league";
import type { LeagueModel, TeamModel } from "./leagueModel";
import type { ImportWarning, LeagueSnapshot, Pos, SlotDef, Transaction } from "./model";
import { defaultTradeSettings } from "./settings";
import { TEST_NOW, buildTestLeague, type TestPlayer } from "./testLeague";
import { flat, withSeason } from "./trade.testing";

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const ZERO_MISS: Record<Pos, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, P: 0, DEF: 0, DL: 0, LB: 0, DB: 0 };
const NO_RISK: LeagueModelConfig = { ...config, projections: { ...config.projections, injuryRisk: { ...config.projections.injuryRisk, missShare: ZERO_MISS } } };
const N = config.allocation.inactiveWeeks;

/** A transaction of team `teamId` in `week` (a drop: it counts for activity, never for streaming detection). */
const move = (teamId: string, week: number, type: Transaction["type"] = "drop", extra: Partial<Transaction> = {}): Transaction => ({
  id: `${teamId}-${type}-${week}-${extra.id ?? ""}`,
  type,
  week,
  timestamp: "2026-09-20T00:00:00.000Z",
  teams: [teamId],
  moves: type === "drop" ? [{ playerId: `x${teamId}`, from: teamId, to: null }] : [{ playerId: `x${teamId}`, from: null, to: teamId }],
  ...extra,
});
const teamOf = (m: LeagueModel, id: string): TeamModel => m.teams.find((t) => t.id === id) as TeamModel;

describe("the rule (acceptance.inactiveTeams): the activity feature's window, never my team, nobody without transactions", () => {
  const teams = ["1", "2", "3", "4"].map((id) => ({ id }));
  const at = (currentWeek: number, transactions: Transaction[], leagueWeek?: number) => ({ teams, transactions, warnings: [] as ImportWarning[], currentWeek, ...(leagueWeek !== undefined ? { leagueWeek } : {}) });

  it("no transaction in the last 5 weeks: transactions whose week is above the league week − 5 (with fewer weeks played, none this season)", () => {
    // Week 4: every week of the season is in the window (> −1); Team 3 made none, Team 4 one in week 1.
    expect(inactiveTeams(at(4, [move("2", 4), move("4", 1)]), "1", N)).toEqual(["3"]);
    // Week 9: only weeks 5–9 count, so Team 4's week-4 drop is too old.
    expect(inactiveTeams(at(9, [move("2", 5), move("3", 9), move("4", 4)]), "1", N)).toEqual(["4"]);
    // A later week counts (ESPN can give a waiver run the next week's number).
    expect(inactiveTeams(at(9, [move("2", 10), move("3", 9), move("4", 9)]), "1", N)).toEqual([]);
    // Sleeper numbers transactions by league week, which can lag the NFL week: the window reads it (league week 8: weeks
    // above 3, Team 2's week-4 drop in; league week 9: above 4, out).
    expect(inactiveTeams(at(9, [move("2", 4), move("3", 9), move("4", 9)], 8), "1", N)).toEqual([]);
    expect(inactiveTeams(at(10, [move("2", 4), move("3", 9), move("4", 9)], 9), "1", N)).toEqual(["2"]);
    // A move to or from a team makes the transaction its own, whatever its `teams` list says (a trade's other side).
    expect(inactiveTeams(at(4, [{ ...move("2", 3), moves: [{ playerId: "p", from: "2", to: "3" }] }, move("4", 2)]), "1", N)).toEqual([]);
  });

  it("⚠️ never my team; nobody when the snapshot holds no transaction at all, or when the rule is off", () => {
    expect(inactiveTeams(at(4, [move("2", 4)]), "1", N)).toEqual(["3", "4"]);
    expect(inactiveTeams(at(4, [move("2", 4)]), null, N)).toEqual(["1", "3", "4"]);
    expect(inactiveTeams(at(4, []), null, N)).toEqual([]);
    for (const off of [0, -1, Number.NaN]) expect(inactiveTeams(at(4, [move("2", 4)]), "1", off), String(off)).toEqual([]);
  });

  it("⚠️ nobody when the window's transactions may be incomplete (review of track AL, finding AL-1): a week that didn't load, rows that couldn't be read", () => {
    const warn = (code: string, platformPath?: string): ImportWarning => ({ code, message: "…", ...(platformPath !== undefined ? { platformPath } : {}) });
    // Week 9: the window is weeks 5–9; Team 4's only move came in week 4.
    const txs = [move("2", 8), move("3", 9), move("4", 4)];
    const withWarnings = (warnings: ImportWarning[], leagueWeek?: number) => ({ ...at(9, txs, leagueWeek), warnings });
    expect(inactiveRuleBlock(withWarnings([]), N)).toBeNull();
    expect(inactiveTeams(withWarnings([]), "1", N)).toEqual(["4"]);
    // ESPN: a week that didn't load (the fetch names only the first that failed, so even an old one may hide later ones), or
    // a response or rows that couldn't be read (their week unknown).
    for (const w of [warn("ESPN_TRANSACTIONS_UNAVAILABLE", "view=mTransactions2&scoringPeriodId=1"), warn("ESPN_TRANSACTIONS_UNREADABLE", "mTransactions2[]"), warn("ESPN_TRANSACTIONS_UNREADABLE", "mTransactions2[3]")]) {
      expect(inactiveRuleBlock(withWarnings([w]), N), w.platformPath).toBe("missing");
      expect(inactiveTeams(withWarnings([w]), "1", N), w.platformPath).toEqual([]);
    }
    // Sleeper names each league week: one inside the window (above 9 − 5) hides moves the rule reads, one before it doesn't.
    expect(inactiveRuleBlock(withWarnings([warn("TRANSACTIONS_MISSING", "transactions/6")]), N)).toBe("missing");
    expect(inactiveRuleBlock(withWarnings([warn("TRANSACTIONS_UNREADABLE", "transactions/9[2].adds")]), N)).toBe("missing");
    expect(inactiveTeams(withWarnings([warn("TRANSACTIONS_MISSING", "transactions/4"), warn("TRANSACTIONS_UNREADABLE", "transactions/3[0]")]), "1", N)).toEqual(["4"]);
    // … by the league week the transactions are numbered in (league week 8: weeks above 3, so its week 4 is in the window).
    expect(inactiveRuleBlock(withWarnings([warn("TRANSACTIONS_MISSING", "transactions/4")], 8), N)).toBe("missing");
    // A Sleeper warning without a week to read counts as inside (the cautious reading); other data that didn't load doesn't count.
    expect(inactiveRuleBlock(withWarnings([warn("TRANSACTIONS_MISSING")]), N)).toBe("missing");
    expect(inactiveTeams(withWarnings([warn("ESPN_FREE_AGENTS_UNAVAILABLE"), warn("MATCHUPS_MISSING", "matchups/8"), warn("ESPN_TRADES_UNVERIFIED")]), "1", N)).toEqual(["4"]);
    // The reasons, first that holds: the rule off, a gap (even with no transaction left), no transaction at all.
    expect(inactiveRuleBlock(withWarnings([warn("ESPN_TRANSACTIONS_UNAVAILABLE")]), 0)).toBe("off");
    expect(inactiveRuleBlock({ ...at(9, []), warnings: [warn("ESPN_TRANSACTIONS_UNAVAILABLE")] }, N)).toBe("missing");
    expect(inactiveRuleBlock(at(9, []), N)).toBe("noTransactions");
    expect(TRANSACTIONS_INCOMPLETE_CODES).toEqual(["ESPN_TRANSACTIONS_UNAVAILABLE", "ESPN_TRANSACTIONS_UNREADABLE", "TRANSACTIONS_MISSING", "TRANSACTIONS_UNREADABLE"]);
  });

  it("⚠️ nobody when a completed trade in the window lists fewer than 2 teams (ESPN: its other side unknown): a team that traded may be hidden", () => {
    const trade = (week: number, teams: string[], moves: Transaction["moves"] = []): Transaction => ({ id: `t${week}${teams.join("")}`, type: "trade", week, timestamp: "2026-10-01T00:00:00.000Z", teams, moves });
    // Week 9: Team 4 made no move of its own in weeks 5–9.
    const base = [move("2", 8), move("3", 9)];
    expect(inactiveTeams(at(9, base), "1", N)).toEqual(["4"]);
    // Team 2's trade in week 7, listed without its other side (ESPN_TRADE_PARTNER_UNKNOWN): maybe Team 4's.
    expect(inactiveRuleBlock(at(9, [...base, trade(7, ["2"])]), N)).toBe("partnerUnknown");
    expect(inactiveTeams(at(9, [...base, trade(7, ["2"], [{ playerId: "p", from: null, to: "2" }])]), "1", N)).toEqual([]);
    // Before the window, it hides nothing the rule reads; a trade whose other side a move names is complete.
    expect(inactiveTeams(at(9, [...base, trade(3, ["2"])]), "1", N)).toEqual(["4"]);
    expect(inactiveTeams(at(9, [...base, trade(7, ["2"], [{ playerId: "p", from: "3", to: "2" }])]), "1", N)).toEqual(["4"]);
    expect(inactiveTeams(at(9, [...base, trade(7, ["2", "4"])]), "1", N)).toEqual([]);
    expect(inactiveRuleBlock(at(9, [...base, trade(7, ["2", "4"])]), N)).toBeNull();
  });

  it("one window with the activity feature (a): its −2 'inactive' rule is the same team set at the same number of weeks", () => {
    const txs = [move("2", 7), move("3", 3), move("4", 5)];
    for (const week of [4, 6, 9, 12]) {
      const ours = inactiveTeams(at(week, txs), null, config.acceptance.activity.inactiveWeeks);
      const theirs = teams.filter((t) => activity(txs, t.id, week).rule === "inactive").map((t) => t.id);
      expect(ours, `week ${week}`).toEqual(theirs);
      for (const t of teams) expect(transactedWithin(txs, t.id, week, N)).toBe(!inactiveTeams(at(week, txs), null, N).includes(t.id));
    }
    expect([withinLastWeeks(4, 9, 5), withinLastWeeks(5, 9, 5), withinLastWeeks(Number.NaN, 9, 5), withinLastWeeks(5, Number.NaN, 5)]).toEqual([false, true, false, false]);
  });
});

describe("the League model: an inactive team makes no pickups", () => {
  const OPTS: BuildLeagueModelOptions = { now: TEST_NOW, scenarios: 8, sims: 0, settings: { ...defaultTradeSettings(), streamPositions: [] } };
  const p = (id: string, pos: Pos, points: number): TestPlayer => ({ id, pos, points });
  /** Team 1 (mine), 2 and 3: a 10-point QB on Team 3 (a 16-point free-agent QB is +6 a week to it), the waiver order 3 > 2 > 1. */
  const roster = (t: string, qb: number): TestPlayer[] => [p(`${t}-qb`, "QB", qb), p(`${t}-rb1`, "RB", 15), p(`${t}-rb2`, "RB", 13), p(`${t}-wr1`, "WR", 15), p(`${t}-wr2`, "WR", 13), p(`${t}-te`, "TE", 10), p(`${t}-flex`, "WR", 11), p(`${t}-k`, "K", 8), p(`${t}-def`, "DEF", 7)];
  const league = (transactions: Transaction[]) => {
    const built = buildTestLeague({ teams: [{ id: "1", roster: roster("1", 20) }, { id: "2", roster: roster("2", 12) }, { id: "3", roster: roster("3", 10) }], freeAgents: [p("fa-qb", "QB", 16)] });
    const teams = built.snapshot.teams.map((t) => ({ ...t, waiverRank: { "3": 1, "2": 2, "1": 3 }[t.id] as number }));
    return { ...built, snapshot: { ...built.snapshot, teams, transactions } };
  };

  it("V*(T) = T and no claim: the free agent it would have taken goes to the next team in the order; it keeps its place", () => {
    const active = league([move("2", 3), move("3", 3)]);
    const a = buildLeagueModel(active.snapshot, active.inputs, OPTS, NO_RISK);
    expect(teamOf(a, "3").faMoves.map((m) => m.add)).toEqual(["fa-qb"]);
    expect(teamOf(a, "2").faMoves).toEqual([]);
    // Team 3 made no transaction this season: inactive. The QB goes to Team 2 (+4 a week over its 12-point QB).
    const quiet = league([move("2", 3)]);
    const { model, context } = buildLeagueModelWithContext(quiet.snapshot, quiet.inputs, OPTS, NO_RISK);
    expect([...context.inactive]).toEqual(["3"]);
    expect(teamOf(model, "3").faMoves).toEqual([]);
    expect(teamOf(model, "2").faMoves.map((m) => m.add)).toEqual(["fa-qb"]);
    expect(model.faAllocation).toEqual({ basis: "waiver", order: ["3", "2", "1"] });
    const w3 = context.work.find((t) => t.team.id === "3");
    expect([w3?.inactive, w3?.claimed, w3?.vstar.roster]).toEqual([true, [], w3?.ids]);
    // My team never: it made no transaction either, and still counts (it has nothing to pick up here).
    expect(context.work.find((t) => t.team.id === "1")?.inactive).toBe(false);
  });

  it("its later runs make no move either: lineup costs refill nothing, MV_add to it is the pinned formula, leagueMarginals.optimize makes none", () => {
    const quiet = league([move("2", 3)]);
    const { model, context, bases } = buildLeagueModelWithContext(quiet.snapshot, quiet.inputs, { ...OPTS, scenarios: 0 }, NO_RISK);
    // Losing its QB costs his whole 10 a week (an active team would refill the spot with the free-agent QB: 6 less).
    const omega = rosOmega(model);
    expect(teamOf(model, "3").players["3-qb"]).toMatchObject({ mvLoseEv: expect.closeTo(10 * omega, 6), autoAdd: null });
    const activeLeague = league([move("2", 3), move("3", 3)]);
    // (Active, Team 3 picks the QB up itself: its own QB is then a backup who costs nothing.)
    expect(teamOf(buildLeagueModel(activeLeague.snapshot, activeLeague.inputs, { ...OPTS, scenarios: 0 }, NO_RISK), "3").players["3-qb"]?.mvLoseEv).toBeCloseTo(0, 6);
    const idx = context.work.findIndex((t) => t.team.id === "3");
    expect(bases[idx]?.base?.extraEv).toBe(0);
    const marginals = leagueMarginals(quiet.snapshot, quiet.inputs, { ...OPTS, scenarios: 0 }, NO_RISK);
    expect(marginals.optimize("3", context.work[idx]?.ids ?? [])?.moves).toEqual([]);
    expect(marginals.optimize("2", context.work.find((t) => t.team.id === "2")?.ids ?? [])?.moves.map((m) => m.add)).toEqual(["fa-qb"]);
  });

  it("⚠️ it streams nothing, whatever its adds (streaming is a pickup every week); an active team with the same adds streams", () => {
    // Week 10: Team 2's two kicker adds came in weeks 2 and 3, nothing since (inactive); Team 3's in weeks 8 and 9.
    const k = (teamId: string, week: number) => move(teamId, week, "add", { id: `k${week}`, moves: [{ playerId: `k-${teamId}-${week}`, from: null, to: teamId, pos: "K" }] });
    const built = buildTestLeague({ currentWeek: 10, teams: [{ id: "1", roster: roster("1", 20) }, { id: "2", roster: roster("2", 12) }, { id: "3", roster: roster("3", 10) }], freeAgents: [p("fk1", "K", 9), p("fk2", "K", 8), p("fk3", "K", 7)] });
    const snapshot: LeagueSnapshot = { ...built.snapshot, transactions: [k("2", 2), k("2", 3), k("3", 8), k("3", 9)] };
    const model = buildLeagueModel(snapshot, built.inputs, OPTS, NO_RISK);
    expect(model.streaming.byTeam["2"]).toEqual({ positions: [], source: "detected", adds: { K: 2 } });
    expect(model.streaming.byTeam["3"]).toEqual({ positions: ["K"], source: "detected", adds: { K: 2 } });
    expect(streamedPositions(snapshot, "1", defaultTradeSettings())["2"]?.positions).toEqual(["K"]); // without the inactive set
    // faAllocation "independent" (Checkpoint 4's rule): nobody is inactive.
    const each = buildLeagueModelWithContext(snapshot, built.inputs, { ...OPTS, faAllocation: "independent" }, NO_RISK);
    expect(each.context.inactive.size).toBe(0);
    expect(each.model.streaming.byTeam["2"]?.positions).toEqual(["K"]);
  });

  it("⚠️ a league whose transactions may be incomplete judges nobody inactive (finding AL-1): a fetch failure never becomes 'no pickups'", () => {
    // Team 3 looks quiet only because a week's transactions didn't load (ESPN's warning): it keeps its pickup, as without the rule.
    const quiet = league([move("2", 3)]);
    const gap: LeagueSnapshot = { ...quiet.snapshot, warnings: [...quiet.snapshot.warnings, { code: "ESPN_TRANSACTIONS_UNAVAILABLE", message: "…", platformPath: "view=mTransactions2&scoringPeriodId=2" }] };
    const { model, context } = buildLeagueModelWithContext(gap, quiet.inputs, OPTS, NO_RISK);
    expect(context.inactive.size).toBe(0);
    expect(teamOf(model, "3").faMoves.map((m) => m.add)).toEqual(["fa-qb"]);
    const off = buildLeagueModel(quiet.snapshot, quiet.inputs, OPTS, { ...NO_RISK, allocation: { ...NO_RISK.allocation, inactiveWeeks: 0 } });
    expect(model.teams.map((t) => t.faMoves)).toEqual(off.teams.map((t) => t.faMoves));
    // The trade context reads the same teams (TeamState.inactive).
    const trades = (snap: LeagueSnapshot) => tradeInternals(buildTradeContext(snap, quiet.inputs, { now: TEST_NOW, scenarios: 0, ...(OPTS.settings ? { settings: OPTS.settings } : {}) }));
    expect(trades(gap).byId.get("3")?.inactive).toBe(false);
    expect(trades(quiet.snapshot).byId.get("3")?.inactive).toBe(true);
  });

  it("a league without any transaction judges nobody inactive: the same model as before the rule", () => {
    const none = league([]);
    const { model, context } = buildLeagueModelWithContext(none.snapshot, none.inputs, OPTS, NO_RISK);
    expect(context.inactive.size).toBe(0);
    expect(teamOf(model, "3").faMoves.map((m) => m.add)).toEqual(["fa-qb"]);
    const off = buildLeagueModel(league([move("2", 3)]).snapshot, none.inputs, OPTS, { ...NO_RISK, allocation: { ...NO_RISK.allocation, inactiveWeeks: 0 } });
    expect(off.teams.map((t) => t.faMoves)).toEqual(model.teams.map((t) => t.faMoves));
  });
});

/** Σ ω over the model's weeks (no week in progress): the regular-season weeks and the playoff weeks at the playoff weight. */
function rosOmega(m: LeagueModel): number {
  return m.weeks.reduce((s, w) => s + (m.playoffWeeks.includes(w) ? m.playoffWeight : m.regularWeeks.includes(w) ? 1 : 0), 0);
}

describe("the trade evaluation: an inactive partner makes no free-agent move after the trade", () => {
  /** QB, RB, WR, TE and a FLEX: no K or D/ST, so nobody streams. */
  const LINEUP: SlotDef[] = [
    { slot: "QB", count: 1, eligible: ["QB"] },
    { slot: "RB", count: 1, eligible: ["RB"] },
    { slot: "WR", count: 1, eligible: ["WR"] },
    { slot: "TE", count: 1, eligible: ["TE"] },
    { slot: "FLEX", count: 1, eligible: ["RB", "WR", "TE"] },
  ];
  /**
   * evaluate.allocation.test.ts's league: four full 6-player rosters; Team 2 (a 2-point TE) picks up the 7-point free-agent
   * TE, Team 3 (a 3-point WR) the 9-point free-agent WR; the waiver order `order`; a transaction this season for the teams
   * in `active` (and me), none for the others.
   */
  function context(order: readonly string[], active: readonly string[], rosterMinimums?: Partial<Record<Pos, number>>) {
    const roster = (t: string, te: number, flexRb: number, wr: number, bench: number): TestPlayer[] => [flat(`q${t}`, "QB", 20), flat(`r${t}`, "RB", 15), flat(`w${t}`, "WR", wr), flat(`t${t}`, "TE", te), flat(`f${t}`, "RB", flexRb), flat(`b${t}`, "RB", bench)];
    const built = withSeason(
      buildTestLeague({
        lineup: LINEUP,
        currentWeek: 5,
        regularSeasonWeeks: range(1, 8),
        playoffWeeks: [9],
        teams: [
          { id: "1", roster: roster("1", 8, 10, 15, 1) },
          { id: "2", roster: roster("2", 2, 12, 15, 3) },
          { id: "3", roster: roster("3", 8, 10, 3, 1) },
          { id: "4", roster: roster("4", 8, 10, 15, 1) },
        ],
        freeAgents: [flat("zt", "TE", 7), flat("zw", "WR", 9)],
      }),
      { regular: range(1, 8), playoff: [9], playoffTeams: 2, ...(rosterMinimums ? { rosterMinimums } : {}) },
    );
    const snapshot: LeagueSnapshot = {
      ...built.snapshot,
      teams: built.snapshot.teams.map((t) => ({ ...t, waiverRank: order.indexOf(t.id) + 1 })),
      transactions: ["1", ...active].map((id) => move(id, 4)),
    };
    const I = tradeInternals(buildTradeContext(snapshot, built.inputs, { now: TEST_NOW, scenarios: 0 }));
    return { I, me: I.me as TeamState, two: I.byId.get("2") as TeamState };
  }
  const adds = (run: { moves: readonly { add: string }[] }) => run.moves.map((m) => m.add);

  it("a 1-for-2 that opens its roster spot: an active partner fills it (legality's rule 4), an inactive one leaves it open and makes no V* move", () => {
    // My 8-point TE for Team 2's FLEX RB and bench RB: Team 2 gives two and gets one.
    const trade = { give: ["t1"], get: ["f2", "b2"] };
    const on = context(["2", "1", "3", "4"], ["2", "3", "4"]);
    const a = tradeSides(on.I, on.me, on.two, trade.give, trade.get, "Team 2");
    if ("illegal" in a) throw new Error(a.illegal);
    expect(on.two.inactive).toBe(false);
    expect(a.theirLegal.change.adds).toHaveLength(1);
    const off = context(["2", "1", "3", "4"], ["3", "4"]);
    expect(off.two.inactive).toBe(true);
    expect(adds(off.two.vstar)).toEqual([]);
    const b = tradeSides(off.I, off.me, off.two, trade.give, trade.get, "Team 2");
    if ("illegal" in b) throw new Error(b.illegal);
    expect(b.theirLegal.change.adds).toEqual([]);
    expect(b.theirLegal.roster).toHaveLength(off.two.roster.length - 1);
    expect(adds(b.theirs)).toEqual([]);
    // Its baseline claimed nothing, so the free-agent TE it would have taken is open to me (I have the TE spot to fill).
    expect(adds(b.mine)).toEqual(["zt"]);
  });

  it("roster minimums still apply to an inactive partner (a platform rule, legality's rule 3)", () => {
    // Team 2 gives its only TE for my bench RB, in a league that requires a TE.
    const off = context(["2", "1", "3", "4"], ["3", "4"], { TE: 1 });
    const s = tradeSides(off.I, off.me, off.two, ["b1"], ["t2"], "Team 2");
    if ("illegal" in s) throw new Error(s.illegal);
    expect(s.theirLegal.change.adds).toEqual(["zt"]);
  });

  it("⚠️ an inactive team between me and the partner isn't 'a team between them': I'm next in line for a pickup the partner gives up", () => {
    // My 8-point TE for Team 2's bench RB: Team 2 no longer wants its baseline TE pickup. Team 3 sits between us in the order.
    const release = { give: ["t1"], get: ["b2"] };
    const busy = context(["2", "3", "1", "4"], ["2", "3", "4"]);
    const a = tradeSides(busy.I, busy.me, busy.two, release.give, release.get, "Team 2");
    if ("illegal" in a) throw new Error(a.illegal);
    expect(adds(a.mine)).toEqual([]); // Team 3 would claim him first (evaluate.allocation.test.ts)
    const idle = context(["2", "3", "1", "4"], ["2", "4"]);
    expect(idle.I.byId.get("3")?.inactive).toBe(true);
    const b = tradeSides(idle.I, idle.me, idle.two, release.give, release.get, "Team 2");
    if ("illegal" in b) throw new Error(b.illegal);
    expect(b.first).toBe("partner");
    expect(adds(b.mine)).toEqual(["zt"]);
  });
});
