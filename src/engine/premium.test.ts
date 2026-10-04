/**
 * The star premium (planner addendum to Checkpoint 3, §1–§2; lead decisions N1 and N2): ranks and their ties, the
 * top-12 cut, e and the "Harder to get" tag, the dynasty rebuilding rule, the perceived package, and TeamModel.premiums
 * in the League model. The planner's six acceptance anchors run in acceptance.test.ts.
 */
import { describe, expect, it } from "vitest";
import { tradePackage } from "./benefit";
import { config } from "./config";
import type { FantasyCalcFormat, MarketInputs } from "./inputs";
import { buildLeagueModel } from "./league";
import { eliteIds, isHarderToGet, leaguePremiums, perceivedPackage, premiumFacts, rankPremium, rebuildingDiscount, teamPremiums, type PremiumPlayer, type StarPremiumConfig } from "./premium";
import { buildTestLeague, TEST_NOW } from "./testLeague";
import { flat, smallLeague } from "./trade.testing";

const FORMAT: FantasyCalcFormat = { isDynasty: false, numQbs: 1, numTeams: 10, ppr: 0.5, substitutions: [] };
const market = (values: Record<string, number>, redraftValues?: Record<string, number>): MarketInputs => ({
  format: FORMAT,
  fetchedAt: "2026-10-01T00:00:00.000Z",
  values,
  ...(redraftValues ? { redraftValues } : {}),
  knownIds: Object.keys(values),
  topValue: Math.max(...Object.values(values)),
});
const player = (id: string, value: number, ros = 0, extra: Partial<PremiumPlayer> = {}): PremiumPlayer => ({ id, value, ros, ...extra });
const NONE = new Set<string>();

describe("the top-12 list (eliteIds)", () => {
  it("takes the top eliteTop by FantasyCalc value, ties at the cut by the smaller id", () => {
    const values: Record<string, number> = {};
    for (let i = 1; i <= 11; i++) values[`a${String(i).padStart(2, "0")}`] = 10_000 - i;
    // Three players tie for the 12th spot: the smallest id gets it.
    Object.assign(values, { m: 5000, k: 5000, z: 5000, low: 100 });
    const elite = eliteIds(market(values));
    expect(config.acceptance.starPremium.eliteTop).toBe(12);
    expect(elite.size).toBe(12);
    expect(elite.has("k")).toBe(true);
    expect(elite.has("m")).toBe(false);
    expect(elite.has("z")).toBe(false);
    expect(elite.has("low")).toBe(false);
  });

  it("FantasyCalc values only: non-positive and non-finite values never count; no market, nobody", () => {
    const elite = eliteIds(market({ a: 0, b: -5, c: Number.NaN, d: Number.POSITIVE_INFINITY, e: 10 }));
    expect([...elite]).toEqual(["e"]);
    expect(eliteIds(null).size).toBe(0);
    expect(eliteIds(undefined).size).toBe(0);
  });

  it("reads the perception list: a keeper league's redraft values", () => {
    const elite = eliteIds(market({ dyn: 9000, both: 5000 }, { red: 8000, both: 7000 }), { ...config.acceptance.starPremium, eliteTop: 1 });
    expect([...elite]).toEqual(["red"]);
  });

  it("the curve fallback (Phase 4c): the model's own values rank the top players, never the weeks-old list; without them nobody is elite", () => {
    const values = { old1: 9000, old2: 8000 };
    const old: MarketInputs = { ...market(values), fallback: { kind: "curve", listDate: "2026-09-10T00:00:00.000Z" } };
    const two = { ...config.acceptance.starPremium, eliteTop: 2 };
    expect(eliteIds(old, two).size).toBe(0);
    const model: Record<string, number> = { a: 3000, b: 5000, c: 0, old1: 100 };
    // Each id once; a value of 0 never counts.
    expect([...eliteIds(old, two, { ids: ["a", "b", "c", "old1", "a"], value: (id) => model[id] ?? 0 })].sort()).toEqual(["a", "b"]);
    // A saved list (kind "saved") is FantasyCalc's own: read as usual, and the model's values aren't asked.
    const saved: MarketInputs = { ...market(values), fallback: { kind: "saved", listDate: "2026-09-30T00:00:00.000Z" } };
    expect([...eliteIds(saved, { ...two, eliteTop: 1 }, { ids: ["a"], value: () => 99_999 })]).toEqual(["old1"]);
  });
});

describe("one team's premiums (teamPremiums)", () => {
  it("ranks by value on the roster; ties: more ROS points, then the smaller id; #1 0.10, #2 0.05, the rest 0", () => {
    const p = teamPremiums({ players: [player("c", 3000, 50), player("b", 5000, 10), player("a", 5000, 10), player("d", 5000, 90), player("e", 1000)], elite: NONE, leagueType: "redraft", pPlayoffs: 0.5 });
    // 5,000 three times: d has the most ROS points; a and b tie on both, a is the smaller id.
    expect([p.d?.rank, p.a?.rank, p.b?.rank, p.c?.rank, p.e?.rank]).toEqual([1, 2, 3, 4, 5]);
    expect([p.d?.e, p.a?.e, p.b?.e, p.c?.e, p.e?.e]).toEqual([0.1, 0.05, 0, 0, 0]);
    expect(rankPremium(1)).toBe(0.1);
    expect(rankPremium(2)).toBe(0.05);
    expect(rankPremium(3)).toBe(0);
    expect(rankPremium(0)).toBe(0);
  });

  it("counts a repeated id once, and a player without a value as 0 (ranked by ROS points among the 0s)", () => {
    const p = teamPremiums({ players: [player("x", 0, 30), player("v", 2000), player("v", 2000), player("y", Number.NaN, 40)], elite: NONE, leagueType: "redraft", pPlayoffs: null });
    expect(Object.keys(p).sort()).toEqual(["v", "x", "y"]);
    expect([p.v?.rank, p.y?.rank, p.x?.rank]).toEqual([1, 2, 3]);
  });

  it("e = e_rank + e_elite; the tag at e ≥ 0.15: a top-12 player who is his team's #1 or #2", () => {
    const elite = new Set(["s1", "s2", "s3", "o1"]);
    const team = teamPremiums({ players: [player("s1", 9000), player("s2", 8000), player("s3", 7000), player("n4", 100)], elite, leagueType: "redraft", pPlayoffs: 0.5 });
    expect(team.s1).toMatchObject({ rank: 1, elite: true, harderToGet: true });
    expect(team.s1?.e).toBeCloseTo(0.2, 12);
    expect(team.s2).toMatchObject({ rank: 2, elite: true, harderToGet: true });
    expect(team.s2?.e).toBeCloseTo(0.15, 12);
    expect(team.s3).toMatchObject({ rank: 3, elite: true, e: 0.1, harderToGet: false });
    expect(team.n4).toMatchObject({ rank: 4, elite: false, e: 0, harderToGet: false });
    // A #1 outside the top 12: 0.10, not tagged.
    const other = teamPremiums({ players: [player("t1", 4000), player("o1", 3000)], elite: new Set(["zz"]), leagueType: "redraft", pPlayoffs: 0.5 });
    expect(other.t1).toMatchObject({ rank: 1, elite: false, e: 0.1, harderToGet: false });
    expect(config.acceptance.starPremium.harderToGetMin).toBe(0.15);
    expect(isHarderToGet(0.15)).toBe(true);
    expect(isHarderToGet(0.1 + 0.05)).toBe(true);
    expect(isHarderToGet(0.1499)).toBe(false);
    expect(isHarderToGet(Number.NaN)).toBe(false);
  });

  it("dynasty: a rebuilding team (P(playoffs) below 25%) halves e for its RBs and WRs aged 27 or older", () => {
    const elite = new Set(["rb", "wr"]);
    const players = [player("rb", 9000, 0, { pos: "RB", age: 27 }), player("wr", 8000, 0, { pos: "WR", age: 30 })];
    const rebuilding = teamPremiums({ players, elite, leagueType: "dynasty", pPlayoffs: 0.2 });
    expect(rebuilding.rb?.e).toBeCloseTo(0.1, 12);
    expect(rebuilding.wr?.e).toBeCloseTo(0.075, 12);
    // Halved below the tag's threshold: not "Harder to get" from a rebuilding team.
    expect(rebuilding.rb?.harderToGet).toBe(false);
    const full = (over: Partial<PremiumPlayer>, leagueType: "dynasty" | "keeper" | "redraft" = "dynasty", pPlayoffs: number | null = 0.2) => teamPremiums({ players: [player("rb", 9000, 0, { pos: "RB", age: 27, ...over })], elite, leagueType, pPlayoffs }).rb?.e;
    expect(full({ age: 26 })).toBeCloseTo(0.2, 12); // younger
    expect(full({ pos: "QB", age: 33 })).toBeCloseTo(0.2, 12); // not an RB or WR
    expect(full({ pos: "TE", age: 33 })).toBeCloseTo(0.2, 12);
    expect(teamPremiums({ players: [player("rb", 9000, 0, { pos: "RB" })], elite, leagueType: "dynasty", pPlayoffs: 0.2 }).rb?.e).toBeCloseTo(0.2, 12); // unknown age
    expect(full({}, "dynasty", 0.25)).toBeCloseTo(0.2, 12); // "below 25%" is strict
    expect(full({}, "dynasty", null)).toBeCloseTo(0.2, 12); // unknown P(playoffs)
    expect(full({}, "redraft")).toBeCloseTo(0.2, 12);
    expect(full({}, "keeper")).toBeCloseTo(0.2, 12);
    expect(rebuildingDiscount("dynasty", 0.1, { pos: "WR", age: 27 })).toBe(true);
    expect(rebuildingDiscount("dynasty", 0.1, { pos: "WR", age: 26.9 })).toBe(false);
  });

  it("reads a widened config (Phase 6 calibration)", () => {
    const cfg: StarPremiumConfig = { ...config.acceptance.starPremium, rank: [0.3, 0.2, 0.1], elite: 0 };
    const p = teamPremiums({ players: [player("a", 3), player("b", 2), player("c", 1)], elite: new Set(["a"]), leagueType: "redraft", pPlayoffs: 0.5 }, cfg);
    expect([p.a?.e, p.b?.e, p.c?.e]).toEqual([0.3, 0.2, 0.1]);
  });
});

describe("the partner's perceived package (perceivedPackage)", () => {
  const values = { mine: 5000, theirs: 5000, t2: 2000, m2: 1000 };

  it("equals tradePackage exactly when every e is 0", () => {
    for (const [recv, give, W] of [
      [["mine"], ["theirs"], 0],
      [["mine", "m2"], ["theirs"], 400],
      [["mine"], ["theirs", "t2"], 752],
    ] as [string[], string[], number][]) {
      expect(perceivedPackage({ players: recv }, { players: give }, values, W, () => 0)).toStrictEqual(tradePackage({ players: recv }, { players: give }, values, W));
    }
  });

  it("scales what the partner gives by 1 + e; what it receives, the waiver credit and picks don't change", () => {
    const e = (id: string) => ({ theirs: 0.2, t2: 0.05, mine: 0.5 })[id] ?? 0;
    // The partner receives mine + m2 (6,000) for theirs + t2: 5,000 × 1.2 + 2,000 × 1.05 = 8,100.
    const two = perceivedPackage({ players: ["mine", "m2"] }, { players: ["theirs", "t2"] }, values, 752, e);
    expect(two.recv).toBe(6000);
    expect(two.give).toBeCloseTo(8100, 9);
    expect(two.g).toBeCloseTo((6000 - 8100) / 8100, 12);
    // A 2-for-1 for the partner: W on its give side, unscaled; a pick it gives keeps its value.
    const credit = perceivedPackage({ players: ["mine", "m2"] }, { players: ["theirs"], pickValues: [300] }, values, 752, e);
    expect(credit.give).toBeCloseTo(5000 * 1.2 + 752 + 300, 9);
    // A non-finite e counts 0.
    expect(perceivedPackage({ players: ["mine"] }, { players: ["theirs"] }, values, 0, () => Number.NaN).g).toBe(0);
  });

  it("the premium sits on the floored value: v′ = max(v, W) × (1 + e) (planner reply to Checkpoint 4, change 4)", () => {
    const cheap = { ...values, junk: 300, scrap: 120 };
    const W = 752;
    // The partner gives "junk" (300 < W, e 0.1) for my "mine" (5,000): nobody worth at most W on my side to pair him with,
    // so he stays in, standing for the roster spot the partner fills: it gives 752 × 1.1, gets 5,000.
    const p = perceivedPackage({ players: ["mine"] }, { players: ["junk"] }, cheap, W, (id) => (id === "junk" ? 0.1 : 0));
    expect(p.give).toBeCloseTo(W * 1.1, 9);
    expect(p.recv).toBe(5000);
    expect(p.g).toBeCloseTo(5000 / (W * 1.1) - 1, 12);
    // With e 0 it is the floored package exactly.
    expect(perceivedPackage({ players: ["mine"] }, { players: ["junk"] }, cheap, W, () => 0)).toStrictEqual(tradePackage({ players: ["mine"] }, { players: ["junk"] }, cheap, W));
    expect(tradePackage({ players: ["mine"] }, { players: ["junk"] }, cheap, W)).toStrictEqual({ recv: 5000, give: W, g: 5000 / W - 1 });
    // Two players worth less than W swapped are a matched pair (Phase 4c), left out on the raw values whatever the premium:
    // even (Checkpoint 4b: W × 1.1 against W).
    expect(perceivedPackage({ players: ["scrap"] }, { players: ["junk"] }, cheap, W, (id) => (id === "junk" ? 0.1 : 0))).toStrictEqual({ recv: 0, give: 0, g: 0 });
    // Above W nothing changes: the premium on the player's own value.
    expect(perceivedPackage({ players: ["mine"] }, { players: ["theirs"] }, cheap, W, () => 0.2).give).toBeCloseTo(5000 * 1.2, 9);
  });

  it("leaves out the raw package's neutral throw-ins, chosen on raw values whatever the premium (Phase 4c: the same players on every side)", () => {
    const cheap = { ...values, junk: 300 };
    const W = 752;
    // The partner gives theirs (e 0.2) and junk (300, at most W; a toy premium of 0.1 lifts v′ to 827.2, over W) for mine:
    // a 2-for-1, so junk is its neutral throw-in, left out with his spot, as on my side.
    const e = (id: string) => (id === "junk" ? 0.1 : id === "theirs" ? 0.2 : 0);
    const p = perceivedPackage({ players: ["mine"] }, { players: ["theirs", "junk"] }, cheap, W, e);
    expect(p.recv).toBe(5000);
    expect(p.give).toBeCloseTo(5000 * 1.2, 9);
    expect(p.g).toBeCloseTo(-1000 / 6000, 12);
    // The raw packages leave him out too, and mirror each other.
    expect(tradePackage({ players: ["mine"] }, { players: ["theirs", "junk"] }, cheap, W)).toStrictEqual({ recv: 5000, give: 5000, g: 0 });
    expect(tradePackage({ players: ["theirs", "junk"] }, { players: ["mine"] }, cheap, W)).toStrictEqual({ recv: 5000, give: 5000, g: 0 });
    // With every e 0 it is the raw package exactly.
    expect(perceivedPackage({ players: ["mine"] }, { players: ["theirs", "junk"] }, cheap, W, () => 0)).toStrictEqual(tradePackage({ players: ["mine"] }, { players: ["theirs", "junk"] }, cheap, W));
  });

  it("premiumFacts: one per player, a player without a premium at e 0", () => {
    const premiums = { a: { e: 0.2, rank: 1, elite: true, harderToGet: true } };
    expect(premiumFacts(["a", "z"], premiums)).toStrictEqual([
      { playerId: "a", e: 0.2, rank: 1, elite: true, harderToGet: true },
      { playerId: "z", e: 0, rank: 0, elite: false, harderToGet: false },
    ]);
    expect(premiumFacts([], undefined)).toStrictEqual([]);
  });
});

describe("TeamModel.premiums (the League model, step 9)", () => {
  it("covers every rostered player of every team (active, IR and taxi) with the same function the trade context uses", () => {
    const { snapshot, inputs } = buildTestLeague({
      teams: [
        { id: "1", roster: [flat("q1", "QB", 20), flat("r1", "RB", 14), flat("w1", "WR", 12)], ir: [flat("ir1", "RB", 15, { injury: "IR" })], taxi: [flat("tx1", "WR", 3)] },
        { id: "2", roster: [flat("q2", "QB", 18), flat("r2", "RB", 16), flat("w2", "WR", 9)] },
      ],
      freeAgents: [flat("fa", "WR", 2)],
    });
    const model = buildLeagueModel(snapshot, inputs, { now: TEST_NOW, scenarios: 0, sims: 200 });
    const t1 = model.teams.find((t) => t.id === "1");
    expect(Object.keys(t1?.premiums ?? {}).sort()).toEqual(["ir1", "q1", "r1", "tx1", "w1"]);
    // Ranked by value (25 × points²): the QB, then the IR RB (15 points), then the active RB.
    expect(t1?.premiums?.q1).toMatchObject({ rank: 1, e: 0.2, elite: true, harderToGet: true });
    expect(t1?.premiums?.ir1).toMatchObject({ rank: 2, elite: true, harderToGet: true });
    expect(t1?.premiums?.r1?.rank).toBe(3);
    const expected = leaguePremiums({
      snapshot,
      market: inputs.market,
      value: (id) => model.players[id]?.value?.value ?? 0,
      ros: (id) => model.players[id]?.ros.total ?? 0,
      pPlayoffs: (teamId) => model.odds?.teams.find((o) => o.teamId === teamId)?.pPlayoffs ?? null,
    });
    for (const t of model.teams) expect(t.premiums, `team ${t.id}`).toStrictEqual(expected.get(t.id));
  });

  it("a random league: one premium per rostered player, at most two tagged a team, elite flags from the top-12 list", () => {
    const { snapshot, inputs } = smallLeague(11);
    const model = buildLeagueModel(snapshot, inputs, { now: TEST_NOW, scenarios: 4, sims: 200 });
    for (const t of model.teams) {
      const ids = new Set(snapshot.teams.find((x) => x.id === t.id)?.roster ?? []);
      expect(Object.keys(t.premiums ?? {}).length).toBe(ids.size);
      // At most two tagged players a team (#1 and #2 only can reach e ≥ 0.15).
      expect(Object.values(t.premiums ?? {}).filter((p) => p.harderToGet).length).toBeLessThanOrEqual(2);
    }
    // The league's top-12 players are spread over its teams: each team's elite players are among the 12.
    const elite = eliteIds(inputs.market);
    const flagged = model.teams.flatMap((t) => Object.entries(t.premiums ?? {}).filter(([, p]) => p.elite).map(([id]) => id));
    for (const id of flagged) expect(elite.has(id)).toBe(true);
  });

  it("the curve fallback (Phase 4c): the elite flags follow the model's own values, the same function the trade context uses", () => {
    const { snapshot, inputs } = smallLeague(11);
    const curveInputs = { ...inputs, market: { ...(inputs.market as MarketInputs), fallback: { kind: "curve" as const, listDate: "2026-09-10T00:00:00.000Z" } } };
    const model = buildLeagueModel(snapshot, curveInputs, { now: TEST_NOW, scenarios: 0, sims: 0 });
    // No value is FantasyCalc's own now.
    expect(Object.values(model.players).some((p) => p.value?.source === "fantasycalc")).toBe(false);
    const elite = eliteIds(curveInputs.market, config.acceptance.starPremium, { ids: Object.keys(snapshot.players), value: (id) => model.players[id]?.value?.value ?? 0 });
    expect(elite.size).toBe(config.acceptance.starPremium.eliteTop);
    const flagged = model.teams.flatMap((t) => Object.entries(t.premiums ?? {}).filter(([, p]) => p.elite).map(([id]) => id));
    expect(flagged.length).toBeGreaterThan(0);
    for (const id of flagged) expect(elite.has(id)).toBe(true);
  });
});
