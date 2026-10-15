/**
 * Throw-ins, versions of a trade and the Last offer's throw-in (planner addendum to Checkpoint 3, §4; lead decision N4; since
 * Checkpoint 7e, planner reply to Checkpoint 7d, item 4.1, for "How to offer it": offers.ts, which replaced "Offer first / if
 * they say no", whose case 2 is the Last offer's rule): throw-ins (their lineup cost in scenario lineups), the Last offer's
 * candidates (lastOfferVersions: the throw-ins the trade doesn't give, the highest P_complete first, then B, keeping B at least
 * minBShare of the trade's and above 0), the per-side maximum (the search's, the Analyzer's), legality, the pre-screen (with
 * the veto rule), nothing for a trade that doesn't help (review of the addendum, engine findings 1 and 10), versions in the
 * order asked for, the planner's numbers, and since Checkpoint 7e no steps from the search or the Analyzer. Hand leagues (EV
 * lineups unless a test says otherwise), each built for the rule it tests:
 * - the qx1 league: my team carries a backup QB worth more than the waiver credit, a player whose loss costs my lineup
 *   nothing (a throw-in);
 * - the steps league: the qx1 league with my WR2 worth 3,800 and the backup QB 3,000, where my WR2 and the backup QB for
 *   Team 3's WR1 helps me (the trade "Offer first / if they say no" split in two);
 * - the tie league: two backup QBs Team 2 sees as the same player (the Last offer's ties), one sharing my QB's bye;
 * - the veto league: a league that votes on trades, Team 2 a contender without a QB, so the veto rule halves P_complete.
 * The market blend (§6 step 8; planner reply to Checkpoint 4, change 1) is off in this file (config mocked: weight 0):
 * these leagues set trade values apart from points on purpose (a player worth more or less than his projection says), to
 * put the value rules on either side of their thresholds, and the blend would move those projections toward the values.
 * The rules tested here are about values and the chance they accept, not projections; blend.test.ts and the league and
 * search tests cover the blend.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  const c = actual.config;
  return { ...actual, config: { ...c, marketBlend: { ...c.marketBlend, weight: 0 } } };
});

import { vetoApplies } from "./acceptance";
import { config } from "./config";
import {
  DEADLINE_PASSED_NOTE,
  addCandidates,
  analyzeTrade,
  buildTradeContext,
  evaluateExact,
  lastOfferVersions,
  preScreenOrder,
  proposalKey,
  rewardFor,
  screenTrade,
  simulateTrade,
  stepConfig,
  throwIns,
  tradeInternals,
  tradeVersion,
  type StepConfig,
  type TeamState,
  type TradeContext,
  type TradeContextOptions,
  type TradeInternals,
  type TradeVersion,
} from "./evaluate";
import { runTradeSearch } from "./search";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW, type TestLeagueSpec, type TestPlayer } from "./testLeague";
import { flat, handLeague, smallLeague, withWaiverStash, type SeasonSpec } from "./trade.testing";
import type { TradeAsset, TradeEvaluation, TradeProposal } from "./tradeModel";

const p = (...ids: string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));
const trade = (partnerId: string, give: string[], get: string[]): TradeProposal => ({ partnerId, give: p(...give), get: p(...get) });
const SETTINGS = defaultTradeSettings();
const settingsWith = (x: Partial<TradeSettings>): TradeSettings => ({ ...SETTINGS, ...x });
/** Thresholds that keep any qualifying version (to test the choice itself), and every candidate evaluated. */
const permissive = (x: Partial<StepConfig> = {}): StepConfig => ({ ...stepConfig(), minAcceptGain: Number.NEGATIVE_INFINITY, minOfferFirst: 0, preScreen: Number.POSITIVE_INFINITY, ...x });
const sideIds = (xs: readonly TradeAsset[]): string[] => xs.flatMap((a) => (a.kind === "player" ? [a.id] : []));
/**
 * Every context here keeps the fallback playoff weight (league.ts step 5c: TradeContextOptions.playoffWeightSims 0, the weight
 * before the planner's reply to Checkpoint 7a, §6.1): these hand leagues' thresholds (throw-ins' lineup costs, each version's
 * numbers) were measured with it, and the rules tested don't depend on how the weight is set.
 */
const FIXED_OMEGA = { playoffWeightSims: 0 } as const;

function swapPlayer(spec: TestLeagueSpec, teamId: string, id: string, by: TestPlayer): void {
  const team = spec.teams.find((t) => t.id === teamId);
  const i = team ? team.roster.findIndex((x) => x.id === id) : -1;
  if (!team || i < 0) throw new Error(`no player ${id} on team ${teamId}`);
  team.roster[i] = by;
}

/** The qx1 league: the hand league with my backup QB qx1 (15 points a week, value 5,625; the waiver credit is 900) in place of my bench WR. */
function context(edit: (spec: TestLeagueSpec) => void = () => undefined, season: SeasonSpec = {}, opts: Partial<TradeContextOptions> = {}): TradeContext {
  const { snapshot, inputs } = handLeague((spec) => {
    swapPlayer(spec, "1", "wc1", flat("qx1", "QB", 15));
    edit(spec);
  }, season);
  return buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0, ...FIXED_OMEGA, ...opts });
}

/**
 * The steps league: the qx1 league with my WR2 (11 points) worth 3,800 and my backup QB worth `qxValue` (3,000: the trade
 * of both for Team 3's WR1 gives up less than 35% more value than it gets, so the Trade Finder could show it).
 */
function stepsContext(qxValue = 3000, season: SeasonSpec = {}, opts: Partial<TradeContextOptions> = {}, edit: (spec: TestLeagueSpec) => void = () => undefined): TradeContext {
  return context(
    (spec) => {
      swapPlayer(spec, "1", "qx1", flat("qx1", "QB", 15, { value: qxValue }));
      swapPlayer(spec, "1", "wb1", flat("wb1", "WR", 11, { value: 3800 }));
      edit(spec);
    },
    season,
    opts,
  );
}

/** The trade as a card shows it: its exact evaluation and its numbers on the screening block. */
function ranked(I: TradeInternals, proposal: TradeProposal, settings: TradeSettings = SETTINGS): TradeVersion {
  const x = evaluateExact(I, proposal, 4);
  if ("illegal" in x) throw new Error(x.illegal);
  return { x, screen: simulateTrade(I, x, "screen", settings.lambda, settings.protectValue) };
}

const ctx = context();
const I = tradeInternals(ctx);
const me = I.me as TeamState;
const cost = (id: string) => {
  const pv = I.model.teams[me.index]?.players[id];
  return pv ? (pv.mvLoseScen ?? pv.mvLoseEv) : Number.POSITIVE_INFINITY;
};

const S1 = stepsContext();
const I1 = tradeInternals(S1);
/** The steps league's trade with a throw-in: my WR2 and my backup QB (a throw-in) for Team 3's WR1. */
const CASE1 = trade("3", ["wb1", "qx1"], ["wa3"]);

describe("throw-ins (my players whose loss costs my lineup at most throwInMaxCost)", () => {
  it("by default only the backup QB: his loss costs nothing, and he's worth more than the waiver credit", () => {
    expect(cost("qx1")).toBeLessThanOrEqual(config.search.throwInMaxCost);
    expect(throwIns(I, SETTINGS)).toEqual(["qx1"]);
    expect(I.values.qx1).toBeGreaterThan(I.credit);
  });

  it("cheapest value first; never untouchable, must-include, a player without a model, nor a K or D/ST unless included", () => {
    const cfg = { throwInMaxCost: 30 };
    const allowed = (id: string, kdef: boolean) => cost(id) <= 30 && I.league.table.rows.has(id) && (kdef || !["K", "DEF"].includes(I.league.posOf(id) as string));
    const want = (kdef: boolean) => me.roster.filter((id) => allowed(id, kdef)).sort((a, b) => (I.values[a] ?? 0) - (I.values[b] ?? 0) || (a < b ? -1 : 1));
    const all = throwIns(I, SETTINGS, cfg);
    expect(all).toEqual(want(false));
    expect(all.length).toBeGreaterThan(2);
    expect(all.some((id) => ["k1", "d1"].includes(id))).toBe(false);
    const withKDef = throwIns(I, settingsWith({ includeKDefIdp: true }), cfg);
    expect(withKDef).toEqual(want(true));
    expect(withKDef.some((id) => ["k1", "d1"].includes(id))).toBe(true);
    const first = all[0] as string;
    expect(throwIns(I, settingsWith({ untouchables: [first] }), cfg)).toEqual(all.filter((id) => id !== first));
    expect(throwIns(I, settingsWith({ mustInclude: [first] }), cfg)).toEqual(all.filter((id) => id !== first));
    // No team picked: none.
    expect(throwIns(tradeInternals(context((spec) => void (spec.myTeamId = null))), SETTINGS)).toEqual([]);
  });

  describe("the cost is measured in scenario lineups, so a backup who covers injuries and byes isn't free (§4 of the addendum)", () => {
    // 8 scenarios: my QB misses games, and the backup QB plays them.
    const I8 = tradeInternals(context(() => undefined, {}, { scenarios: 8 }));
    const me8 = I8.me as TeamState;
    const value = (id: string) => I8.model.teams[me8.index]?.players[id] as { mvLoseEv: number; mvLoseScen: number | null };

    it("the backup QB costs nothing in average lineups but more than throwInMaxCost in scenario lineups: not a throw-in", () => {
      const qx = value("qx1");
      expect(qx.mvLoseEv).toBeLessThanOrEqual(config.search.throwInMaxCost);
      expect(qx.mvLoseScen as number).toBeGreaterThan(config.search.throwInMaxCost);
      expect(throwIns(I8, SETTINGS)).not.toContain("qx1");
      // The other way round: my starting QB costs less in scenario lineups (his backup covers his missed games) than in
      // average ones, and a cap between the two makes him a throw-in by his scenario cost alone.
      const q = value("q1");
      expect(q.mvLoseScen as number).toBeLessThan(q.mvLoseEv);
      const between = ((q.mvLoseScen as number) + q.mvLoseEv) / 2;
      expect(throwIns(I8, SETTINGS, { throwInMaxCost: between })).toContain("q1");
    });

    it("a player whose cost is exactly the cap is a throw-in; a hair below the cap he isn't", () => {
      const at = value("qx1").mvLoseScen as number;
      expect(throwIns(I8, SETTINGS, { throwInMaxCost: at })).toContain("qx1");
      expect(throwIns(I8, SETTINGS, { throwInMaxCost: at - 1e-6 })).not.toContain("qx1");
    });
  });
});

describe("the Last offer's throw-in (lastOfferVersions; until Checkpoint 7e the steps' case 2)", () => {
  // My bench RB for their RB2 (B well above 0); with throwInMaxCost 30 my starting QB and my bench RB are throw-ins too.
  // minBShare 0.7 rather than the planner's 0.8 (the tie test below keeps 0.8): since Phase 4c ("Win the title" weights,
  // the neutral throw-in rule) the backup QB keeps about 78% of the trade's B here, and these tests are about the rule's
  // mechanics, which need one candidate above the share and one below it.
  const offer = trade("2", ["rc1"], ["rb2"]);
  const cfg = permissive({ throwInMaxCost: 30, minBShare: 0.7 });

  /** Every candidate's version, and the ones the rule keeps, in its order: the highest P_complete with B ≥ minBShare × the trade's B (and above 0); ties: the higher B, then the smaller id. */
  function expected(c: StepConfig, I2: TradeInternals = I, proposal: TradeProposal = offer, maxPerSide = 2) {
    const r = ranked(I2, proposal);
    const bOffer = r.screen.b as number;
    const give = sideIds(proposal.give);
    const all = throwIns(I2, SETTINGS, c)
      .filter((id) => !give.includes(id))
      .map((id) => ({ id, v: tradeVersion(I2, { ...proposal, give: [...proposal.give, { kind: "player", id }] }, { settings: SETTINGS, maxPerSide }) }));
    const ok = all.filter((x): x is { id: string; v: TradeVersion } => x.v !== null && (x.v.screen.b as number) > 0 && (x.v.screen.b as number) >= c.minBShare * bOffer - 1e-9);
    ok.sort((a, b) => b.v.screen.pComplete - a.v.screen.pComplete || (b.v.screen.b as number) - (a.v.screen.b as number) || (a.id < b.id ? -1 : 1));
    return { r, all, ok, best: ok[0] ?? null, bOffer };
  }

  it("the highest P_complete first among the candidates that keep B at least minBShare of the trade's (every candidate evaluated)", () => {
    const { r, all, ok, best, bOffer } = expected(cfg);
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(bOffer).toBeGreaterThan(0);
    // Some candidate gives up too much of B (my starting QB): the filter matters here.
    expect(all.some((x) => x.v !== null && (x.v.screen.b as number) < cfg.minBShare * bOffer)).toBe(true);
    const got = lastOfferVersions(I, r, { settings: SETTINGS, maxPerSide: 2, cfg });
    expect(best).not.toBeNull();
    expect(got.map((x) => x.add)).toEqual(ok.map((x) => x.id));
    expect(got[0]?.version.screen).toEqual(best?.v.screen);
    // Each version is the trade plus its throw-in, on the screening block.
    for (const x of got) {
      expect(sideIds(x.version.screen.proposal.give)).toEqual([...sideIds(offer.give), x.add]);
      expect(x.version.screen.sims).toBe(config.simulation.screeningSims);
    }
  });

  it("each version's B reads the market term on g_mkt(me), every player at max(v, W) (planner reply to Checkpoint 4, change 4)", () => {
    const kappa = config.benefit.protectValue[SETTINGS.protectValue];
    const [lo, hi] = config.benefit.marketSanityClamp;
    /**
     * My g by hand: when `floor`, first the neutral throw-ins (Phase 4c, planner reply to Checkpoint 4b, change 2: on the
     * side moving more players, up to the difference of its players worth at most W, lowest value first, are left out with
     * their roster spots), then each player at max(v, W); else every player at v. W per open spot on the side receiving
     * fewer players (no IR player moves here: every player takes or opens an active spot).
     */
    const gByHand = (I2: TradeInternals, get0: string[], give0: string[], floor: boolean) => {
      const W = I2.credit;
      const v = (id: string) => I2.values[id] ?? 0;
      const neutral = (side: string[], d: number) => {
        const out = new Set([...side].filter((id) => v(id) <= W).sort((a, b) => v(a) - v(b) || (a < b ? -1 : 1)).slice(0, d));
        return side.filter((id) => !out.has(id));
      };
      const give = floor && give0.length > get0.length ? neutral(give0, give0.length - get0.length) : give0;
      const get = floor && get0.length > give0.length ? neutral(get0, get0.length - give0.length) : get0;
      const sum = (ids: string[]) => ids.reduce((s, id) => s + (floor ? Math.max(v(id), W) : v(id)), 0);
      const r = sum(get) + Math.max(0, give.length - get.length) * W;
      const g = sum(give) + Math.max(0, get.length - give.length) * W;
      return (r - g) / g;
    };
    /**
     * Every version lastOfferVersions evaluated (tradeVersion) reads g_mkt(me) floored on both sides (after the neutral
     * throw-ins) in B's market term, as the search does; the floor moves g (so the unfloored g would give another B) on those
     * with a player worth less than W.
     */
    const floorsAll = (I2: TradeInternals, versions: Map<string, TradeVersion>) => {
      let moved = 0;
      for (const v of versions.values()) {
        const give = sideIds(v.screen.proposal.give);
        const get = sideIds(v.screen.proposal.get);
        const floored = gByHand(I2, get, give, true);
        expect(v.screen.gMine, v.screen.key).toBeCloseTo(floored, 12);
        // The term priced on the version's own scale (planner reply to Checkpoint 7a, §2 question 5): (B₃ / 3) × κ × clamp(g).
        expect(v.screen.b as number, v.screen.key).toBeCloseTo((v.screen.bWin as number) + ((v.screen.b3 as number) / config.benefit.helpsGain) * kappa * Math.min(hi, Math.max(lo, floored)), 12);
        if ([...give, ...get].some((id) => (I2.values[id] ?? 0) < I2.credit)) {
          expect(Math.abs(gByHand(I2, get, give, false) - floored), v.screen.key).toBeGreaterThan(0.01);
          moved++;
        }
      }
      expect(moved).toBeGreaterThan(0);
    };
    // The trade gives my bench RB (worth 420, below the waiver credit), so every version with a throw-in does.
    expect(I.values.rc1 as number).toBeLessThan(I.credit);
    const versions = new Map<string, TradeVersion>();
    const got = lastOfferVersions(I, ranked(I, offer), { settings: SETTINGS, maxPerSide: 2, versions, cfg });
    expect(versions.size).toBeGreaterThanOrEqual(2);
    floorsAll(I, versions);
    // The rule's first version is one of them.
    expect(got[0]?.version.screen.b).toBe(versions.get(got[0]?.version.screen.key as string)?.screen.b);
    // A throw-in worth less than W added to a trade that gives none (the steps league with a bench WR worth 240 in place
    // of my D/ST): his version leaves him out (Phase 4c's neutral throw-in), so its g is the trade's.
    const Ic = tradeInternals(stepsContext(3000, {}, {}, (spec) => swapPlayer(spec, "1", "d1", flat("wc1", "WR", 3.1))));
    expect(Ic.values.wc1 as number).toBeLessThan(Ic.credit);
    const offerC = trade("3", ["wb1"], ["wa3"]);
    expect(sideIds(offerC.give).every((id) => (Ic.values[id] as number) >= Ic.credit)).toBe(true);
    const versionsC = new Map<string, TradeVersion>();
    lastOfferVersions(Ic, ranked(Ic, offerC), { settings: SETTINGS, maxPerSide: 2, versions: versionsC, cfg });
    expect(versionsC.has(proposalKey(trade("3", ["wb1", "wc1"], ["wa3"])))).toBe(true);
    floorsAll(Ic, versionsC);
  });

  it("minBShare: a candidate that gives up too much of B is never kept, even with the best P_complete", () => {
    const { r, best, bOffer } = expected(cfg);
    const top = best as { id: string; v: TradeVersion };
    // Raise the share just above the top candidate's B: he's out, the next one in by the same rule (or none).
    const share = (top.v.screen.b as number) / bOffer + 1e-6;
    const stricter = { ...cfg, minBShare: share };
    const next = expected(stricter).best;
    const got = lastOfferVersions(I, r, { settings: SETTINGS, maxPerSide: 2, cfg: stricter });
    expect(got[0]?.add ?? null).toBe(next?.id ?? null);
    expect(got.map((x) => x.add)).not.toContain(top.id);
  });

  describe("the choice among several candidates that keep B (review of the addendum, engine finding 2)", () => {
    /**
     * The tie league: my QB shares his bye (week 6) with one of my two backup QBs (qb1), not the other (qa1); both are worth
     * 1,200, score 12 and never start for Team 2 (its QB has no bye), so Team 2 sees them as the same player: the same
     * P_complete, bit for bit. Losing qa1 costs me week 6 (the free-agent QB, 11 points and worth 900, steps in), losing
     * qb1 costs nothing: qb1's B is higher. My bench WR (worth 240) is a third candidate, with a lower P_complete.
     */
    const { snapshot, inputs } = handLeague((spec) => {
      spec.byeWeek = { B6: 6 };
      swapPlayer(spec, "1", "q1", flat("q1", "QB", 20, { nflTeam: "B6" }));
      swapPlayer(spec, "1", "wb1", flat("wb1", "WR", 11, { value: 4225 }));
      swapPlayer(spec, "1", "k1", flat("qa1", "QB", 12, { value: 1200 }));
      swapPlayer(spec, "1", "d1", flat("qb1", "QB", 12, { value: 1200, nflTeam: "B6" }));
      spec.freeAgents = (spec.freeAgents ?? []).map((f) => (f.id === "fq" ? flat("fq", "QB", 11, { value: 900 }) : f));
    });
    const It = tradeInternals(buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0, ...FIXED_OMEGA }));
    // My WR2 for Team 2's WR1; minBShare stays the planner's 0.8.
    const tieOffer = trade("2", ["wb1"], ["wa2"]);
    const wide = permissive({ throwInMaxCost: 30 });

    it("the highest P_complete first; a tie on P_complete goes to the higher B, ahead of the smaller id", () => {
      expect(wide.minBShare).toBe(config.search.steps.minBShare);
      const { r, all, ok, bOffer } = expected(wide, It, tieOffer);
      expect(bOffer).toBeGreaterThan(0);
      const at = (id: string) => all.find((x) => x.id === id)?.v as TradeVersion;
      // The candidates that keep B: the two backup QBs and the bench WR, at two different P_complete.
      expect(ok.map((x) => x.id).sort()).toEqual(["qa1", "qb1", "wc1"]);
      expect(new Set(ok.map((x) => x.v.screen.pComplete)).size).toBe(2);
      expect(at("wc1").screen.pComplete).toBeLessThan(at("qa1").screen.pComplete);
      // The tie: the same P_complete exactly, a different B.
      expect(at("qa1").screen.pComplete).toBe(at("qb1").screen.pComplete);
      expect(at("qb1").screen.b as number).toBeGreaterThan((at("qa1").screen.b as number) + 0.1);
      const got = lastOfferVersions(It, r, { settings: SETTINGS, maxPerSide: 2, cfg: wide });
      expect(got.map((x) => x.add)).toEqual(["qb1", "qa1", "wc1"]);
      expect(got[0]?.version.screen).toEqual(at("qb1").screen);
      // Without the tied pair, the bench WR: my bench RB ties him on P_complete (both worth less than W, so each counts W in
      // Team 2's package, and neither starts there: planner reply to Checkpoint 4, change 4) but gives up too much of B.
      const rc = at("rc1");
      expect(rc.screen.pComplete).toBe(at("wc1").screen.pComplete);
      expect(rc.screen.b as number).toBeLessThan(wide.minBShare * bOffer);
      const rest = lastOfferVersions(It, r, { settings: settingsWith({ untouchables: ["qa1", "qb1"] }), maxPerSide: 2, cfg: wide });
      expect(rest.map((x) => x.add)).toEqual(["wc1"]);
    });
  });

  it("my side never goes past the per-side maximum (the search's maxPerSide; the Analyzer's larger one)", () => {
    const r = ranked(I, offer);
    expect(lastOfferVersions(I, r, { settings: SETTINGS, maxPerSide: 1, cfg })).toEqual([]);
    const two = lastOfferVersions(I, r, { settings: SETTINGS, maxPerSide: 2, cfg });
    expect(two[0]?.version.screen.proposal.give).toHaveLength(2);
    expect(lastOfferVersions(I, r, { settings: SETTINGS, maxPerSide: 4, cfg })).toEqual(two);
  });

  it("a candidate legality rejects is never kept (every roster rule re-checked for each version)", () => {
    // Two QBs at least, and no free-agent QB: trading the backup QB away is illegal.
    const strict = context((spec) => void (spec.freeAgents = (spec.freeAgents ?? []).filter((f) => f.pos !== "QB")), { rosterMinimums: { QB: 2 } });
    const I2 = tradeInternals(strict);
    expect(tradeVersion(I2, trade("2", ["rb1", "qx1"], ["wa2"]), { settings: SETTINGS, maxPerSide: 2 })).toBeNull();
    const { r, ok } = expected(cfg, I2);
    const got = lastOfferVersions(I2, r, { settings: SETTINGS, maxPerSide: 2, cfg });
    expect(got.map((x) => x.add)).not.toContain("qx1");
    expect(got.map((x) => x.add)).toEqual(ok.map((x) => x.id));
  });

  it("the pre-screen: candidates in the screening's quick order, and only the best preScreen evaluated exactly", () => {
    const all = throwIns(I, SETTINGS, cfg).filter((id) => id !== "rc1");
    expect(all.length).toBeGreaterThanOrEqual(2);
    const order = addCandidates(I, offer, throwIns(I, SETTINGS, cfg), { preScreen: Number.POSITIVE_INFINITY });
    expect(order).toEqual(all); // no pre-screen: every candidate not in the trade, cheapest value first
    const partner = I.byId.get("2") as TeamState;
    const quick = (id: string) => {
      const s = screenTrade(I, partner, ["rc1", id], ["rb2"]);
      return s ? s.pQuick : Number.NEGATIVE_INFINITY; // no veto rule in this league
    };
    const pre = addCandidates(I, offer, throwIns(I, SETTINGS, cfg), { preScreen: 1 });
    expect(pre).toHaveLength(1);
    const sorted = [...all].sort((a, b) => quick(b) - quick(a) || (a < b ? -1 : 1));
    expect(pre).toEqual(sorted.slice(0, 1));
    // lastOfferVersions evaluates exactly the candidates the pre-screen keeps, no more.
    const versions = new Map<string, TradeVersion>();
    lastOfferVersions(I, ranked(I, offer), { settings: SETTINGS, maxPerSide: 2, versions, cfg: { ...cfg, preScreen: 1 } });
    expect([...versions.keys()]).toEqual([proposalKey(trade("2", ["rc1", pre[0] as string], ["rb2"]))]);
  });
});

/**
 * The veto league (a league that votes on trades): Team 2 is a contender (4-0) without a QB (its free-agent-optimized
 * roster picks up the free-agent QB, 6 points), so my backup QB (16.5 points, worth 970) fills a hole there; a recent add
 * keeps it from counting as inactive. My TE is weak (2 points, worth 475, less than the waiver credit 900: a package counts
 * him at 900, or, on the side giving more players, leaves him out with his roster spot: Phase 4c's neutral throw-ins), its
 * TE starts (7.5) ahead of a backup (7), and my bench WR (3 points) is worth `wtValue`; Team 2's two
 * TEs' values can be set (`te2`, `tf2`: their own 25 × points² by default). The values put the trades below on either side
 * of the veto rule (Team 2's raw g below −30%: P_complete = P_accept × the veto factor). Since A3 (planner reply to
 * Checkpoint 4c) W is the best free agent the allocation leaves unclaimed, and Team 2 claims the free-agent QB (900): a
 * free agent nobody can use, worth 900 (withWaiverStash), keeps W at 900. Teams 3 and 4, with no transaction, are inactive
 * (A4: no pickups), which moves none of the numbers here.
 */
function vetoInternals(wtValue: number, values: { te2?: number; tf2?: number } = {}): TradeInternals {
  const { snapshot, inputs } = withWaiverStash(
    handLeague(
      (spec) => {
        swapPlayer(spec, "1", "te1", flat("te1", "TE", 2, { value: 475 }));
        swapPlayer(spec, "1", "wc1", flat("qx1", "QB", 16.5, { value: 970 }));
        swapPlayer(spec, "1", "k1", flat("wt1", "WR", 3, { value: wtValue }));
        swapPlayer(spec, "2", "q2", flat("wz2", "WR", 2));
        swapPlayer(spec, "2", "wc2", flat("tf2", "TE", 7, values.tf2 !== undefined ? { value: values.tf2 } : {}));
        if (values.te2 !== undefined) swapPlayer(spec, "2", "te2", flat("te2", "TE", 7.5, { value: values.te2 }));
      },
      { tradeReview: "league_vote", pastWinnersOrder: ["2", "1", "3", "4"] },
    ),
    900,
  );
  snapshot.transactions = [{ id: "add-1", type: "add", week: 4, timestamp: "2026-09-27T12:00:00.000Z", teams: ["2"], moves: [{ playerId: "wz2", from: null, to: "2" }] }];
  return tradeInternals(buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0, ...FIXED_OMEGA }));
}

describe("the veto rule (on P_complete, the card's chance they accept)", () => {
  it("a version the veto rule halves reads its P_complete: the ladder's chance (offers.ts) is P_complete, as the steps' was", () => {
    // My backup QB and my bench WR (worth 950: above the waiver credit, 900, so no neutral throw-in, Phase 4c; below the
    // backup QB, 970, so the lean version is the backup QB alone) for Team 2's TE (worth 1,700 here): the lean version
    // gives Team 2 43% less value than it gives up, so the veto rule halves it, while the backup QB fills its QB hole.
    const IV = vetoInternals(950, { te2: 1700 });
    expect(IV.snapshot.settings.tradeReview).toBe("league_vote");
    expect(IV.profiles.get("2")?.pPlayoffs as number).toBeGreaterThan(config.acceptance.context.contenderAbove);
    expect(throwIns(IV, SETTINGS)).toEqual(["te1", "wt1", "qx1"]);
    const full = ranked(IV, trade("2", ["qx1", "wt1"], ["te2"]));
    const lean = tradeVersion(IV, trade("2", ["qx1"], ["te2"]), { settings: SETTINGS, maxPerSide: 2 }) as TradeVersion;
    expect(full.screen.b).toBeGreaterThan(0);
    expect(lean.screen.b).toBeGreaterThan(0);
    expect(vetoApplies("league_vote", lean.screen.gPartner)).toBe(true);
    expect(lean.screen.detail.vetoRisk).toBe(true);
    expect(lean.screen.pComplete).toBeCloseTo(lean.screen.pAccept * config.acceptance.veto.factor, 12);
    expect(full.screen.detail.vetoRisk).toBe(false);
  });

  it("the pre-screen orders candidates by P_complete as the veto rule leaves it, not by P_accept", () => {
    // My weak TE for Team 2's backup TE (worth 1,450 here), plus one of: my backup QB (fills Team 2's QB hole, but its value
    // leaves Team 2's raw g below −30%: vetoed) or my bench WR (worth 1,550, starts nowhere there: no veto). My TE, worth
    // less than the waiver credit on the side giving more players, is left out of both packages with his roster spot
    // (Phase 4c's neutral throw-ins; Phase 4b counted him at the waiver credit, 900, with tf2 at 1,900 and the WR at 2,100).
    const IV = vetoInternals(1550, { tf2: 1450 });
    const partner = IV.byId.get("2") as TeamState;
    const quick = (id: string) => screenTrade(IV, partner, ["te1", id], ["tf2"]) as NonNullable<ReturnType<typeof screenTrade>>;
    const qb = quick("qx1");
    const wr = quick("wt1");
    expect(vetoApplies("league_vote", qb.gPartner)).toBe(true);
    expect(vetoApplies("league_vote", wr.gPartner)).toBe(false);
    // Quick P_accept puts the backup QB first; halved by the veto rule he falls behind the bench WR.
    expect(qb.pQuick).toBeGreaterThan(wr.pQuick * 1.2);
    expect(wr.pQuick).toBeGreaterThan(qb.pQuick * config.acceptance.veto.factor * 1.2);
    expect(preScreenOrder(IV, partner, ["te1"], ["tf2"], ["qx1", "wt1"])).toEqual(["wt1", "qx1"]);
    expect(addCandidates(IV, trade("2", ["te1"], ["tf2"]), ["qx1", "wt1"], { preScreen: 1 })).toEqual(["wt1"]);
  });
});

describe("nothing for a trade that doesn't help me (review of the addendum, engine findings 1 and 10)", () => {
  /**
   * The steps league with a bench WR (3.1 points, worth 240, below the waiver credit) in place of my D/ST (streamed) and a
   * free-agent WR (4.4 points) who'd start at my FLEX (4.1) but gains too little for my free-agent-optimized roster to pick
   * him up: a spot a throw-in opens takes him (the forced fill has no minimum gain), so the throw-in's version helps me.
   */
  const Ic = tradeInternals(
    stepsContext(3000, {}, {}, (spec) => {
      swapPlayer(spec, "1", "d1", flat("wc1", "WR", 3.1));
      spec.freeAgents = [...(spec.freeAgents ?? []), flat("fx", "WR", 4.4)];
    }),
  );

  it("a trade with B ≤ 0 has no Last offer, even when a throw-in keeps B at least minBShare of it (that would demand a better B)", () => {
    // My FLEX RB (4.1 points) for Team 4's bench RB at 4.0 points (both worth less than the waiver credit, so even at market:
    // each counts W): my FLEX loses a tenth of a point a week, B < 0. Adding my bench WR opens a spot the free-agent WR
    // fills (4.4 points, at my FLEX): B > 0.
    const I4 = tradeInternals(
      stepsContext(3000, {}, {}, (spec) => {
        swapPlayer(spec, "1", "d1", flat("wc1", "WR", 3.1));
        spec.freeAgents = [...(spec.freeAgents ?? []), flat("fx", "WR", 4.4)];
        swapPlayer(spec, "4", "rc4", flat("rc4", "RB", 4));
      }),
    );
    expect((I4.me as TeamState).vstar.moves).toEqual([]);
    expect([I4.values.rc1, I4.values.rc4].every((v) => (v as number) < I4.credit)).toBe(true);
    const r = ranked(I4, trade("4", ["rc1"], ["rc4"]));
    expect(r.screen.gMine).toBe(0);
    const bOffer = r.screen.b as number;
    expect(bOffer).toBeLessThan(0);
    const cfg = permissive({ throwInMaxCost: 30 });
    const plus = tradeVersion(I4, trade("4", ["rc1", "wc1"], ["rc4"]), { settings: SETTINGS, maxPerSide: 2 }) as TradeVersion;
    expect(plus.screen.required.me.adds).toEqual(["fx"]);
    expect(plus.screen.b as number).toBeGreaterThan(0);
    expect(plus.screen.b as number).toBeGreaterThanOrEqual(cfg.minBShare * bOffer);
    expect(throwIns(I4, SETTINGS, cfg)).toContain("wc1");
    expect(lastOfferVersions(I4, r, { settings: SETTINGS, maxPerSide: 2, cfg })).toEqual([]);
  });

  it("a trade that doesn't help (B = 0) has no Last offer, even when a throw-in's version would help me", () => {
    // My RB2 for Team 4's RB1, the same player in all but name (B = 0 exactly); adding the bench WR fills his spot with the
    // free-agent WR (B > 0) and keeps "B ≥ minBShare × the trade's B", but the trade itself wouldn't help.
    const r = ranked(Ic, trade("4", ["rb1"], ["ra4"]));
    expect(r.screen.b).toBe(0);
    const cfg = permissive({ throwInMaxCost: 30 });
    const plus = tradeVersion(Ic, trade("4", ["rb1", "wc1"], ["ra4"]), { settings: SETTINGS, maxPerSide: 2 }) as TradeVersion;
    expect(plus.screen.b).toBeGreaterThan(0);
    expect(throwIns(Ic, SETTINGS, cfg)).toContain("wc1");
    expect(lastOfferVersions(Ic, r, { settings: SETTINGS, maxPerSide: 2, cfg })).toEqual([]);
  });

  it("a throw-in whose version doesn't help me is never kept, even where minBShare would let it in", () => {
    // My TE for Team 2's RB1 (B > 0); with my starting QB as a throw-in Team 2 is likeliest to say yes, but I'd lose (B < 0).
    const r = ranked(I, trade("2", ["te1"], ["ra2"]));
    expect(r.screen.b).toBeGreaterThan(0);
    const cfg = permissive({ throwInMaxCost: 30, minBShare: Number.NEGATIVE_INFINITY });
    const version = (id: string) => tradeVersion(I, trade("2", ["te1", id], ["ra2"]), { settings: SETTINGS, maxPerSide: 2 }) as TradeVersion;
    const others = throwIns(I, SETTINGS, cfg).filter((id) => id !== "q1");
    expect(others.length).toBeGreaterThan(0);
    expect(version("q1").screen.b as number).toBeLessThan(0);
    for (const id of others) expect(version("q1").screen.pComplete).toBeGreaterThan(version(id).screen.pComplete);
    const got = lastOfferVersions(I, r, { settings: SETTINGS, maxPerSide: 2, cfg });
    expect(got.map((x) => x.add)).not.toContain("q1");
    for (const x of got) expect(x.version.screen.b).toBeGreaterThan(0);
  });
});

describe("determinism, versions, the Analyzer and the search", () => {
  it("the same inputs give the same Last offer's versions (and a fresh context too)", () => {
    const cfg = permissive({ throwInMaxCost: 30, minBShare: 0.7 });
    const offer = trade("2", ["rc1"], ["rb2"]);
    const a = lastOfferVersions(I, ranked(I, offer), { settings: SETTINGS, maxPerSide: 2, cfg });
    expect(a.length).toBeGreaterThan(0);
    expect(lastOfferVersions(I, ranked(I, offer), { settings: SETTINGS, maxPerSide: 2, cfg })).toEqual(a);
    const fresh = tradeInternals(context());
    expect(lastOfferVersions(fresh, ranked(fresh, offer), { settings: SETTINGS, maxPerSide: 2, cfg })).toEqual(a);
  });

  it("⚠️ a version comes back in the order it's asked for, whatever order it was cached in; one not cached yet is evaluated in key order (verification of the final review, finding VF-2)", () => {
    const versions = new Map<string, TradeVersion>();
    const opts = { settings: SETTINGS, maxPerSide: 2, versions };
    const ab = tradeVersion(I1, trade("3", ["wb1", "qx1"], ["wa3"]), opts) as TradeVersion;
    const ba = tradeVersion(I1, trade("3", ["qx1", "wb1"], ["wa3"]), opts) as TradeVersion;
    expect(sideIds(ab.screen.proposal.give)).toEqual(["wb1", "qx1"]);
    expect(sideIds(ab.x.evaluation.proposal.give)).toEqual(["wb1", "qx1"]);
    expect(sideIds(ba.screen.proposal.give)).toEqual(["qx1", "wb1"]);
    expect(sideIds(ba.x.evaluation.proposal.give)).toEqual(["qx1", "wb1"]);
    // One evaluation, cached once: the same numbers whichever order asks.
    expect(versions.size).toBe(1);
    expect({ ...ba.screen, proposal: null }).toEqual({ ...ab.screen, proposal: null });
    // It was evaluated in key order ("qx1" before "wb1"), so asking in that order returns the cached object itself, and its
    // numbers are an evaluation in that order's.
    const cached = versions.get(ab.screen.key) as TradeVersion;
    expect(sideIds(cached.screen.proposal.give)).toEqual(["qx1", "wb1"]);
    expect(ba).toBe(cached);
    const keyOrder = evaluateExact(I1, trade("3", ["qx1", "wb1"], ["wa3"]), 2);
    if ("illegal" in keyOrder) throw new Error(keyOrder.illegal);
    expect(ab.screen.b).toBe(simulateTrade(I1, keyOrder, "screen", SETTINGS.lambda, SETTINGS.protectValue, rewardFor(I1, SETTINGS)).b);
  });

  it("since Checkpoint 7e the Analyzer gives no steps: its pitch names the trade itself (the card's \"How to offer it\" is worked out when it's opened)", () => {
    const a = analyzeTrade(S1, CASE1);
    expect(a.evaluation?.b).toBeGreaterThan(0);
    expect(a.evaluation?.steps).toBeUndefined();
    const name = (id: string) => I1.snapshot.players[id]?.name as string;
    expect(a.evaluation?.pitch).toContain(name("wb1"));
    expect(a.evaluation?.pitch).toContain(name("qx1"));
    expect(a.evaluation?.sims).toBe(config.simulation.shownSims);
    // A context note that stops the search: the Analyzer still evaluates.
    const late = stepsContext(3000, { tradeDeadline: { date: "2026-09-01T00:00:00.000Z" } });
    const b = analyzeTrade(late, CASE1);
    expect(b.notes[0]).toBe(DEADLINE_PASSED_NOTE);
    expect(b.evaluation?.stage).toBe("final");
    expect(b.evaluation?.steps).toBeUndefined();
  });

  // Seed 67: its default search showed cards with steps until Checkpoint 7e (a fact of the synthetic data).
  it("the search's cards carry no steps, their pitch the card's own trade; deterministic", { timeout: 30_000 }, () => {
    const league = smallLeague(67);
    const c = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8, ...FIXED_OMEGA });
    const result = runTradeSearch(c, {});
    expect(result.trades.length).toBeGreaterThan(0);
    for (const t of [...result.trades, ...(result.helpsBoth?.trades ?? [])] as TradeEvaluation[]) {
      expect(t.steps, t.key).toBeUndefined();
      for (const a of t.proposal.get) if (a.kind === "player") expect(t.pitch).toContain(league.snapshot.players[a.id]?.name as string);
    }
    expect(runTradeSearch(c, {})).toEqual(result);
  });
});

describe("the planner's numbers (addendum to Checkpoint 3, §2 and §4; config.search)", () => {
  it("throw-ins cost at most 5 ROS lineup points; offers need +5 points of acceptance, and the Last offer keeps 80% of B", () => {
    expect(config.search.throwInMaxCost).toBe(5);
    expect(config.search.steps.minAcceptGain).toBe(0.05);
    expect(config.search.steps.minOfferFirst).toBe(0.1);
    expect(config.search.steps.minBShare).toBe(0.8);
    expect(stepConfig()).toMatchObject({ throwInMaxCost: 5, minAcceptGain: 0.05, minOfferFirst: 0.1, minBShare: 0.8 });
  });
});
