/**
 * "Offer first / if they say no" (planner addendum to Checkpoint 3, §4; lead decision N4): throw-ins (their lineup cost
 * in scenario lineups), case 1 (the lowest-value throw-in held back), case 2 (the best throw-in added, by P_complete, then
 * B, keeping B at least minBShare of the offer's), the two thresholds (on P_complete, not P_accept; Phase 4c: the offer first as
 * the card prints it, and in case 1 at least the user's minimum chance too), the per-side maximum
 * (the search's, the Analyzer's), legality, the pre-screen (with the veto rule), no steps for a trade that doesn't help
 * (review of the addendum, engine findings 1 and 10), determinism, the planner's numbers, and the steps in the search
 * (the pitch names the offer-first version) and the Analyzer. Hand leagues (EV lineups unless a test says otherwise),
 * each built for the rule it tests:
 * - the qx1 league: my team carries a backup QB worth more than the waiver credit, a player whose loss costs my lineup
 *   nothing (a throw-in);
 * - the steps league: the qx1 league with my WR2 worth 3,800 and the backup QB 3,000, where my WR2 and the backup QB for
 *   Team 3's WR1 helps me and gets both steps with the planner's thresholds;
 * - the tie league: two backup QBs Team 2 sees as the same player (case 2's ties), one sharing my QB's bye;
 * - the veto league: a league that votes on trades, Team 2 a contender without a QB, so the veto rule halves P_complete.
 * The market blend (§6 step 8; planner reply to Checkpoint 4, change 1) is off in this file (config mocked: weight 0):
 * these leagues set trade values apart from points on purpose (a player worth more or less than his projection says), to
 * put the steps' value rules on either side of their thresholds, and the blend would move those projections toward the
 * values. The rules tested here are about values and the chance they accept, not projections; blend.test.ts and the
 * league and search tests cover the blend.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  const c = actual.config;
  return { ...actual, config: { ...c, marketBlend: { ...c.marketBlend, weight: 0 } } };
});

import { displayAcceptance, vetoApplies } from "./acceptance";
import { config } from "./config";
import {
  DEADLINE_PASSED_NOTE,
  addCandidates,
  analyzeTrade,
  buildTradeContext,
  evaluateExact,
  offerFirstBar,
  preScreenOrder,
  proposalKey,
  screenTrade,
  simulateTrade,
  stepConfig,
  throwIns,
  tradeInternals,
  tradeSteps,
  tradeVersion,
  withWords,
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
import type { TradeAsset, TradeEvaluation, TradeProposal, TradeStep } from "./tradeModel";

const p = (...ids: string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));
const trade = (partnerId: string, give: string[], get: string[]): TradeProposal => ({ partnerId, give: p(...give), get: p(...get) });
const SETTINGS = defaultTradeSettings();
const settingsWith = (x: Partial<TradeSettings>): TradeSettings => ({ ...SETTINGS, ...x });
/** Thresholds that keep any qualifying version (to test the choice itself), and every candidate evaluated. */
const permissive = (x: Partial<StepConfig> = {}): StepConfig => ({ ...stepConfig(), minAcceptGain: Number.NEGATIVE_INFINITY, minOfferFirst: 0, preScreen: Number.POSITIVE_INFINITY, ...x });
const sideIds = (xs: readonly TradeAsset[]): string[] => xs.flatMap((a) => (a.kind === "player" ? [a.id] : []));
/**
 * Every context here keeps the fallback playoff weight (league.ts step 5c: TradeContextOptions.playoffWeightSims 0, the weight
 * before the planner's reply to Checkpoint 7a, §6.1): these hand leagues' thresholds (throw-ins' lineup costs, each step's
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

/** The trade as ranked: its exact evaluation and its numbers on the screening block. */
function ranked(I: TradeInternals, proposal: TradeProposal, settings: TradeSettings = SETTINGS): TradeVersion {
  const x = evaluateExact(I, proposal, 4);
  if ("illegal" in x) throw new Error(x.illegal);
  return { x, screen: simulateTrade(I, x, "screen", settings.lambda, settings.protectValue) };
}

/** A version's step, as tradeSteps builds it (Phase 4c: with the version's acceptance features, for feedback). */
const stepOf = (v: TradeVersion): TradeStep => {
  const c = v.screen;
  return { proposal: c.proposal, key: c.key, b: c.b, tradeScore: c.tradeScore, pAccept: c.pAccept, pComplete: c.pComplete, acceptLabel: c.acceptLabel, gMine: c.gMine, gPartner: c.gPartner, required: c.required, detail: c.detail, features: c.features };
};

const ctx = context();
const I = tradeInternals(ctx);
const me = I.me as TeamState;
const cost = (id: string) => {
  const pv = I.model.teams[me.index]?.players[id];
  return pv ? (pv.mvLoseScen ?? pv.mvLoseEv) : Number.POSITIVE_INFINITY;
};

const S1 = stepsContext();
const I1 = tradeInternals(S1);
/** The steps league's case-1 trade: my WR2 and my backup QB (a throw-in) for Team 3's WR1. */
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

describe("case 1: the ranked trade gives a throw-in", () => {
  it("offer first without it; if they say no, add it back (the ranked trade); both versions help me, on the screening block", () => {
    const r = ranked(I1, CASE1);
    expect(throwIns(I1, SETTINGS)).toEqual(["qx1"]);
    expect(r.screen.b).toBeGreaterThan(0);
    const steps = tradeSteps(I1, r, { settings: SETTINGS, maxPerSide: 2 });
    expect(steps).not.toBeNull();
    expect(steps?.ranked).toBe("full");
    expect(steps?.ifNo.add).toBe("qx1");
    expect(steps?.ifNo.full).toEqual(stepOf(r));
    const lean = tradeVersion(I1, trade("3", ["wb1"], ["wa3"]), { settings: SETTINGS, maxPerSide: 2 }) as TradeVersion;
    expect(steps?.offerFirst).toEqual(stepOf(lean));
    expect(steps?.offerFirst.key).toBe(proposalKey(trade("3", ["wb1"], ["wa3"])));
    expect(steps?.offerFirst.b).toBeGreaterThan(0);
    // Each step carries its own version's acceptance features (Phase 4c, change 7: feedback stores the version sent).
    expect(steps?.offerFirst.features).toEqual(lean.screen.features);
    expect(steps?.ifNo.full.features).toEqual(r.screen.features);
    expect(steps?.offerFirst.features).not.toEqual(steps?.ifNo.full.features);
    // The planner's thresholds hold: the throw-in raises P_complete by at least minAcceptGain, from at least minOfferFirst.
    const gain = (steps?.ifNo.full.pComplete as number) - (steps?.offerFirst.pComplete as number);
    expect(gain).toBeGreaterThanOrEqual(config.search.steps.minAcceptGain);
    expect(steps?.offerFirst.pComplete).toBeGreaterThanOrEqual(config.search.steps.minOfferFirst);
    expect(r.screen.sims).toBe(config.simulation.screeningSims);
  });

  it("two throw-ins in the trade: the lower-value one is held back", () => {
    const cfg = permissive({ throwInMaxCost: 30 });
    const both = throwIns(I, SETTINGS, cfg).filter((id) => id !== "qx1" && I.league.posOf(id) !== "QB");
    const cheap = both[0] as string;
    expect(I.values[cheap] ?? 0).toBeLessThan(I.values.qx1 as number);
    const r = ranked(I, trade("2", [cheap, "qx1"], ["wa2"]));
    // Permissive thresholds and the minimum chance at Any (case 1's offer first is held to it too, Phase 4c).
    const steps = tradeSteps(I, r, { settings: settingsWith({ minChance: 0 }), maxPerSide: 2, cfg });
    expect(steps?.ranked).toBe("full");
    expect(steps?.ifNo.add).toBe(cheap);
    expect(steps?.offerFirst.key).toBe(proposalKey(trade("2", ["qx1"], ["wa2"])));
    expect(steps?.offerFirst.b).toBeGreaterThan(0);
  });

  it("a side is never emptied: a trade giving only a throw-in goes to case 2", () => {
    // Only qx1 is a throw-in by default: case 2 has nobody to add.
    expect(tradeSteps(I, ranked(I, trade("2", ["qx1"], ["wb2"])), { settings: SETTINGS, maxPerSide: 2 })).toBeNull();
    const cfg = permissive({ throwInMaxCost: 30 });
    const steps = tradeSteps(I, ranked(I, trade("2", ["qx1"], ["wb2"])), { settings: SETTINGS, maxPerSide: 2, cfg });
    expect(steps?.ranked).toBe("offerFirst");
    expect(steps?.offerFirst.key).toBe(proposalKey(trade("2", ["qx1"], ["wb2"])));
    expect(steps?.ifNo.add).not.toBe("qx1");
    expect(steps?.ifNo.full.proposal.give).toHaveLength(2);
  });
});

describe("case 2: the throw-in added if they say no", () => {
  // My bench RB for their RB2 (B well above 0); with throwInMaxCost 30 my starting QB and my bench RB are throw-ins too.
  // minBShare 0.7 rather than the planner's 0.8 (the tie test below keeps 0.8): since Phase 4c ("Win the title" weights,
  // the neutral throw-in rule) the backup QB keeps about 78% of the offer's B here, and these tests are about the rule's
  // mechanics, which need one candidate above the share and one below it.
  const offer = trade("2", ["rc1"], ["rb2"]);
  const cfg = permissive({ throwInMaxCost: 30, minBShare: 0.7 });

  /** Every candidate's version, and the one the rule picks: the highest P_complete with B ≥ minBShare × the offer's B (and above 0); ties: the higher B, then the smaller id. */
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

  it("the highest P_complete among the candidates that keep B at least minBShare of the offer's (every candidate evaluated)", () => {
    const { r, all, best, bOffer } = expected(cfg);
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(bOffer).toBeGreaterThan(0);
    // Some candidate gives up too much of B (my starting QB): the filter matters here.
    expect(all.some((x) => x.v !== null && (x.v.screen.b as number) < cfg.minBShare * bOffer)).toBe(true);
    const steps = tradeSteps(I, r, { settings: SETTINGS, maxPerSide: 2, cfg });
    expect(best).not.toBeNull();
    expect(steps?.ranked).toBe("offerFirst");
    expect(steps?.offerFirst).toEqual(stepOf(r));
    expect(steps?.ifNo.add).toBe(best?.id);
    expect(steps?.ifNo.full).toEqual(stepOf(best?.v as TradeVersion));
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
     * Every version tradeSteps evaluated (tradeVersion) reads g_mkt(me) floored on both sides (after the neutral throw-ins)
     * in B's market term, as the search does; the floor moves g (so the unfloored g would give another B) on those with a
     * player worth less than W.
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
    // The offer gives my bench RB (worth 420, below the waiver credit), so every full version does.
    expect(I.values.rc1 as number).toBeLessThan(I.credit);
    const versions = new Map<string, TradeVersion>();
    const steps = tradeSteps(I, ranked(I, offer), { settings: SETTINGS, maxPerSide: 2, versions, cfg });
    expect(versions.size).toBeGreaterThanOrEqual(2);
    floorsAll(I, versions);
    // The step's full version is one of them.
    expect(steps?.ifNo.full.b).toBe(versions.get(steps?.ifNo.full.key as string)?.screen.b);
    // A throw-in worth less than W added to an offer that gives none (the steps league with a bench WR worth 240 in place
    // of my D/ST): his full version leaves him out (Phase 4c's neutral throw-in), so its g is the offer's.
    const Ic = tradeInternals(stepsContext(3000, {}, {}, (spec) => swapPlayer(spec, "1", "d1", flat("wc1", "WR", 3.1))));
    expect(Ic.values.wc1 as number).toBeLessThan(Ic.credit);
    const offerC = trade("3", ["wb1"], ["wa3"]);
    expect(sideIds(offerC.give).every((id) => (Ic.values[id] as number) >= Ic.credit)).toBe(true);
    const versionsC = new Map<string, TradeVersion>();
    tradeSteps(Ic, ranked(Ic, offerC), { settings: SETTINGS, maxPerSide: 2, versions: versionsC, cfg });
    expect(versionsC.has(proposalKey(trade("3", ["wb1", "wc1"], ["wa3"])))).toBe(true);
    floorsAll(Ic, versionsC);
  });

  it("minBShare: a candidate that gives up too much of B is never added, even with the best P_complete", () => {
    const { r, best, bOffer } = expected(cfg);
    const top = best as { id: string; v: TradeVersion };
    // Raise the share just above the top candidate's B: he's out, the next one in by the same rule (or none).
    const share = (top.v.screen.b as number) / bOffer + 1e-6;
    const stricter = { ...cfg, minBShare: share };
    const next = expected(stricter).best;
    const steps = tradeSteps(I, r, { settings: SETTINGS, maxPerSide: 2, cfg: stricter });
    expect(steps?.ifNo.add ?? null).toBe(next?.id ?? null);
    expect(steps?.ifNo.add).not.toBe(top.id);
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

    it("the highest P_complete wins; a tie on P_complete goes to the higher B, ahead of the smaller id", () => {
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
      const steps = tradeSteps(It, r, { settings: SETTINGS, maxPerSide: 2, cfg: wide });
      expect(steps?.ifNo.add).toBe("qb1");
      expect(steps?.ifNo.full).toEqual(stepOf(at("qb1")));
      // Without the tied pair, the bench WR: my bench RB ties him on P_complete (both worth less than W, so each counts W in
      // Team 2's package, and neither starts there: planner reply to Checkpoint 4, change 4) but gives up too much of B.
      const rc = at("rc1");
      expect(rc.screen.pComplete).toBe(at("wc1").screen.pComplete);
      expect(rc.screen.b as number).toBeLessThan(wide.minBShare * bOffer);
      const rest = tradeSteps(It, r, { settings: settingsWith({ untouchables: ["qa1", "qb1"] }), maxPerSide: 2, cfg: wide });
      expect(rest?.ifNo.add).toBe("wc1");
    });
  });

  it("my side never goes past the per-side maximum (the search's maxPerSide; the Analyzer passes its larger one)", () => {
    const r = ranked(I, offer);
    expect(tradeSteps(I, r, { settings: SETTINGS, maxPerSide: 1, cfg })).toBeNull();
    const two = tradeSteps(I, r, { settings: SETTINGS, maxPerSide: 2, cfg });
    expect(two?.ifNo.full.proposal.give).toHaveLength(2);
    expect(tradeSteps(I, r, { settings: SETTINGS, maxPerSide: 4, cfg })).toEqual(two);
  });

  it("a candidate legality rejects is never added (every roster rule re-checked for each version)", () => {
    // Two QBs at least, and no free-agent QB: trading the backup QB away is illegal.
    const strict = context((spec) => void (spec.freeAgents = (spec.freeAgents ?? []).filter((f) => f.pos !== "QB")), { rosterMinimums: { QB: 2 } });
    const I2 = tradeInternals(strict);
    expect(tradeVersion(I2, trade("2", ["rb1", "qx1"], ["wa2"]), { settings: SETTINGS, maxPerSide: 2 })).toBeNull();
    const { r, best } = expected(cfg, I2);
    const steps = tradeSteps(I2, r, { settings: SETTINGS, maxPerSide: 2, cfg });
    expect(steps?.ifNo.add).not.toBe("qx1");
    expect(steps?.ifNo.add ?? null).toBe(best?.id ?? null);
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
    // tradeSteps evaluates exactly the candidates the pre-screen keeps, no more.
    const versions = new Map<string, TradeVersion>();
    tradeSteps(I, ranked(I, offer), { settings: SETTINGS, maxPerSide: 2, versions, cfg: { ...cfg, preScreen: 1 } });
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

describe("the thresholds (on P_complete, the card's chance they accept)", () => {
  const r = ranked(I1, CASE1);
  const base = tradeSteps(I1, r, { settings: SETTINGS, maxPerSide: 2 });
  const offer = base?.offerFirst.pComplete as number;
  const gain = (base?.ifNo.full.pComplete as number) - offer;

  it("shown only when the full version is at least minAcceptGain more likely …", () => {
    expect(base).not.toBeNull();
    expect(tradeSteps(I1, r, { settings: SETTINGS, maxPerSide: 2, cfg: { ...stepConfig(), minAcceptGain: gain + 1e-6 } })).toBeNull();
    expect(tradeSteps(I1, r, { settings: SETTINGS, maxPerSide: 2, cfg: { ...stepConfig(), minAcceptGain: gain - 1e-6 } })).toEqual(base);
  });

  it("… and the offer first, as the card prints it, is at least minOfferFirst likely (Phase 4c: the minimum chance's own rule)", () => {
    // The lean version is 23.3% likely and prints 25% (the nearest 5%).
    const shown = displayAcceptance(offer);
    expect(offer).toBeCloseTo(0.2331, 4);
    expect(shown).toBe(0.25);
    expect(tradeSteps(I1, r, { settings: SETTINGS, maxPerSide: 2, cfg: { ...stepConfig(), minOfferFirst: shown + 1e-6 } })).toBeNull();
    expect(tradeSteps(I1, r, { settings: SETTINGS, maxPerSide: 2, cfg: { ...stepConfig(), minOfferFirst: shown } })).toEqual(base);
    // A bar between the model's number and the printed one: the printed one decides (Phase 4b compared the raw number).
    expect(tradeSteps(I1, r, { settings: SETTINGS, maxPerSide: 2, cfg: { ...stepConfig(), minOfferFirst: 0.24 } })).toEqual(base);
  });

  it("⚠️ case 1: the offer first prints at least the user's minimum chance too (Phase 4c lead decision), whatever minOfferFirst", () => {
    // Its 25% meets every minimum up to 20%; at 30% the step would advise offering a version the list's minimum keeps out.
    for (const minChance of config.ranking.minChanceOptions) {
      const steps = tradeSteps(I1, r, { settings: settingsWith({ minChance }), maxPerSide: 2 });
      expect(steps, String(minChance)).toEqual(minChance <= 0.25 ? base : null);
    }
    expect(offerFirstBar("full", 0.3)).toBe(0.3);
    expect(offerFirstBar("full", 0)).toBe(config.search.steps.minOfferFirst);
    // The card itself (the full version, 77%) is above every minimum: only its offer-first version is held to it.
    expect(displayAcceptance(r.screen.pComplete)).toBeGreaterThanOrEqual(0.5);
    // The Analyzer applies it with its own settings: the same trade at 30% gets no steps, at 20% the steps above.
    expect(analyzeTrade(S1, CASE1, { settings: settingsWith({ minChance: 0.3 }) }).evaluation?.steps).toBeUndefined();
    expect(analyzeTrade(S1, CASE1, { settings: settingsWith({ minChance: 0.2 }) }).evaluation?.steps?.offerFirst.key).toBe(base?.offerFirst.key);
  });

  it("⚠️ case 2: the offer first is the card itself, held to minOfferFirst only (the list's minimum already holds the card)", () => {
    // My RB1 and bench RB for Team 2's RB2 and WR2 (17.6%, printed 20%); the backup QB added if they say no (52%).
    const two = ranked(I1, trade("2", ["ra1", "rc1"], ["rb2", "wb2"]));
    expect(displayAcceptance(two.screen.pComplete)).toBe(0.2);
    const at = (minChance: number) => tradeSteps(I1, two, { settings: settingsWith({ minChance }), maxPerSide: 4 });
    const plain = at(0.1);
    expect(plain?.ranked).toBe("offerFirst");
    expect(plain?.ifNo.add).toBe("qx1");
    for (const minChance of config.ranking.minChanceOptions) expect(at(minChance), String(minChance)).toEqual(plain);
    expect(offerFirstBar("offerFirst", 0.5)).toBe(config.search.steps.minOfferFirst);
  });

  it("a throw-in that lowers the chance they accept gives no steps (a cheap player costs them a roster spot worth the waiver credit)", () => {
    // The steps league with a bench WR (3.1 points, worth 240) in place of my D/ST (streamed): his loss costs me nothing.
    const Ic = tradeInternals(stepsContext(3000, {}, {}, (spec) => swapPlayer(spec, "1", "d1", flat("wc1", "WR", 3.1))));
    expect(throwIns(Ic, SETTINGS)[0]).toBe("wc1");
    expect(Ic.values.wc1 as number).toBeLessThan(Ic.credit);
    const r2 = ranked(Ic, trade("3", ["wb1", "wc1"], ["wa3"]));
    const lean = tradeVersion(Ic, trade("3", ["wb1"], ["wa3"]), { settings: SETTINGS, maxPerSide: 2 }) as TradeVersion;
    // Both versions help me: only the chance they accept stops the steps.
    expect(r2.screen.b).toBeGreaterThan(0);
    expect(lean.screen.b).toBeGreaterThan(0);
    expect(lean.screen.pComplete).toBeGreaterThanOrEqual(config.search.steps.minOfferFirst);
    expect(r2.screen.pComplete).toBeLessThan(lean.screen.pComplete + config.search.steps.minAcceptGain);
    expect(tradeSteps(Ic, r2, { settings: SETTINGS, maxPerSide: 2 })).toBeNull();
  });

  it("in a league that votes, the veto rule's halving counts: on P_accept the steps would show, on P_complete they don't", () => {
    // My backup QB and my bench WR (worth 950: above the waiver credit, 900, so no neutral throw-in, Phase 4c; below the
    // backup QB, 970, so the lean version is the backup QB alone) for Team 2's TE (worth 1,700 here): the lean version
    // gives Team 2 43% less value than it gives up, so the veto rule halves it, while the backup QB fills its QB hole
    // (n at β_need 1.2 lifts P_accept to about 14%).
    const IV = vetoInternals(950, { te2: 1700 });
    expect(IV.snapshot.settings.tradeReview).toBe("league_vote");
    expect(IV.profiles.get("2")?.pPlayoffs as number).toBeGreaterThan(config.acceptance.context.contenderAbove);
    expect(throwIns(IV, SETTINGS)).toEqual(["te1", "wt1", "qx1"]);
    const full = ranked(IV, trade("2", ["qx1", "wt1"], ["te2"]));
    const lean = tradeVersion(IV, trade("2", ["qx1"], ["te2"]), { settings: SETTINGS, maxPerSide: 2 }) as TradeVersion;
    const { minAcceptGain, minOfferFirst } = config.search.steps;
    expect(full.screen.b).toBeGreaterThan(0);
    expect(lean.screen.b).toBeGreaterThan(0);
    expect(vetoApplies("league_vote", lean.screen.gPartner)).toBe(true);
    expect(lean.screen.detail.vetoRisk).toBe(true);
    expect(lean.screen.pComplete).toBeCloseTo(lean.screen.pAccept * config.acceptance.veto.factor, 12);
    expect(full.screen.detail.vetoRisk).toBe(false);
    // On P_accept both thresholds pass …
    expect(lean.screen.pAccept).toBeGreaterThanOrEqual(minOfferFirst + 0.02);
    expect(full.screen.pAccept - lean.screen.pAccept).toBeGreaterThanOrEqual(minAcceptGain + 0.02);
    // … on P_complete the offer first is under minOfferFirst: no steps.
    expect(lean.screen.pComplete).toBeLessThan(minOfferFirst - 0.02);
    expect(tradeSteps(IV, full, { settings: SETTINGS, maxPerSide: 2 })).toBeNull();
    // With the offer-first threshold out of the way (and, case 1, the minimum chance at Any), they show: the halving is
    // what stops them.
    expect(tradeSteps(IV, full, { settings: settingsWith({ minChance: 0 }), maxPerSide: 2, cfg: { ...stepConfig(), minOfferFirst: 0 } })?.ifNo.add).toBe("wt1");
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

describe("no steps for a trade that doesn't help me (review of the addendum, engine findings 1 and 10)", () => {
  // My RB1 and my backup QB for Team 2's WR1: B < 0, and the lean version's too.
  const bad = trade("2", ["ra1", "qx1"], ["wa2"]);

  it("the Analyzer: a trade with B ≤ 0 gets no steps, though its versions would pass the chance-they-accept thresholds", () => {
    const a = analyzeTrade(ctx, bad);
    expect(a.evaluation?.b as number).toBeLessThanOrEqual(0);
    expect(a.evaluation?.flags.hiddenByBenefit).toBe(true);
    expect(a.evaluation?.steps).toBeUndefined();
    // Case 1's lean version doesn't help me either, so tradeSteps itself offers nothing …
    const r = ranked(I, bad);
    const lean = tradeVersion(I, trade("2", ["ra1"], ["wa2"]), { settings: SETTINGS, maxPerSide: 4 }) as TradeVersion;
    expect(lean.screen.b as number).toBeLessThanOrEqual(0);
    expect(tradeSteps(I, r, { settings: SETTINGS, maxPerSide: 4 })).toBeNull();
    // … though the thresholds alone would pass.
    expect(lean.screen.pComplete).toBeGreaterThanOrEqual(config.search.steps.minOfferFirst);
    expect(r.screen.pComplete - lean.screen.pComplete).toBeGreaterThanOrEqual(config.search.steps.minAcceptGain);
  });

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

  it("case 2: an offer with B ≤ 0 gets no steps, even when a throw-in keeps B at least minBShare of it (that would demand a better B)", () => {
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
    expect(tradeSteps(I4, r, { settings: SETTINGS, maxPerSide: 2, cfg })).toBeNull();
  });

  it("case 2: an offer that doesn't help (B = 0) gets no steps, even when a throw-in's version would help me", () => {
    // My RB2 for Team 4's RB1, the same player in all but name (B = 0 exactly); adding the bench WR fills his spot with the
    // free-agent WR (B > 0) and keeps "B ≥ minBShare × the offer's B", but the opening offer itself wouldn't help.
    const r = ranked(Ic, trade("4", ["rb1"], ["ra4"]));
    expect(r.screen.b).toBe(0);
    const cfg = permissive({ throwInMaxCost: 30 });
    const plus = tradeVersion(Ic, trade("4", ["rb1", "wc1"], ["ra4"]), { settings: SETTINGS, maxPerSide: 2 }) as TradeVersion;
    expect(plus.screen.b).toBeGreaterThan(0);
    expect(throwIns(Ic, SETTINGS, cfg)).toContain("wc1");
    expect(tradeSteps(Ic, r, { settings: SETTINGS, maxPerSide: 2, cfg })).toBeNull();
  });

  it("case 2: a throw-in whose version doesn't help me is never added, even where minBShare would let it in", () => {
    // My TE for Team 2's RB1 (B > 0); with my starting QB as a throw-in Team 2 is likeliest to say yes, but I'd lose (B < 0).
    const r = ranked(I, trade("2", ["te1"], ["ra2"]));
    expect(r.screen.b).toBeGreaterThan(0);
    const cfg = permissive({ throwInMaxCost: 30, minBShare: Number.NEGATIVE_INFINITY });
    const version = (id: string) => tradeVersion(I, trade("2", ["te1", id], ["ra2"]), { settings: SETTINGS, maxPerSide: 2 }) as TradeVersion;
    const others = throwIns(I, SETTINGS, cfg).filter((id) => id !== "q1");
    expect(others.length).toBeGreaterThan(0);
    expect(version("q1").screen.b as number).toBeLessThan(0);
    for (const id of others) expect(version("q1").screen.pComplete).toBeGreaterThan(version(id).screen.pComplete);
    const steps = tradeSteps(I, r, { settings: SETTINGS, maxPerSide: 2, cfg });
    expect(steps?.ifNo.add).not.toBe("q1");
    expect(steps?.ifNo.full.b).toBeGreaterThan(0);
  });

  it("the Analyzer: a trade the Trade Finder hides by the market guard (I give 35% more value) gets no steps", () => {
    // The steps league's case-1 trade with the backup QB worth 5,625: it still helps me, but I'd give up too much value.
    const S2 = stepsContext(5625);
    const a = analyzeTrade(S2, CASE1).evaluation as TradeEvaluation;
    expect(a.b).toBeGreaterThan(0);
    expect(a.flags.hiddenByMarket).toBe(true);
    expect(a.steps).toBeUndefined();
    // tradeSteps alone would give it steps: the Analyzer's rule (a trade the Trade Finder could show) is what stops them.
    const I2 = tradeInternals(S2);
    expect(tradeSteps(I2, ranked(I2, CASE1), { settings: SETTINGS, maxPerSide: 4 })?.ranked).toBe("full");
  });
});

describe("determinism, the Analyzer and the search", () => {
  it("the same inputs give the same steps (and a fresh context too)", () => {
    const a = tradeSteps(I1, ranked(I1, CASE1), { settings: SETTINGS, maxPerSide: 2 });
    expect(a).not.toBeNull();
    expect(tradeSteps(I1, ranked(I1, CASE1), { settings: SETTINGS, maxPerSide: 2 })).toEqual(a);
    const fresh = tradeInternals(stepsContext());
    expect(tradeSteps(fresh, ranked(fresh, CASE1), { settings: SETTINGS, maxPerSide: 2 })).toEqual(a);
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
    expect(ab.screen.b).toBe(simulateTrade(I1, keyOrder, "screen", SETTINGS.lambda, SETTINGS.protectValue, SETTINGS.goal).b);
  });

  it("the Analyzer gives the analyzed trade its steps; the pitch names the offer-first version, never the throw-in held back", () => {
    const a = analyzeTrade(S1, CASE1);
    expect(a.evaluation?.b).toBeGreaterThan(0);
    const steps = a.evaluation?.steps;
    expect(steps?.ranked).toBe("full");
    expect(steps?.ifNo.add).toBe("qx1");
    const name = (id: string) => I1.snapshot.players[id]?.name as string;
    expect(a.evaluation?.pitch).toContain(name("wb1"));
    expect(a.evaluation?.pitch).not.toContain(name("qx1"));
    // The card's numbers stay the analyzed trade's (5,000 seasons); the steps are on the screening block.
    expect(a.evaluation?.sims).toBe(config.simulation.finalSims);
    expect(steps?.ifNo.full.pComplete).toBe(a.evaluation?.pComplete);
  });

  it("the Analyzer's steps use its own per-side maximum: a 2-for-2 gets a third player of mine (past the search's maxPerSide)", () => {
    // My RB1 and bench RB for Team 2's RB2 and WR2; the backup QB added if they say no.
    const a = analyzeTrade(S1, trade("2", ["ra1", "rc1"], ["rb2", "wb2"])).evaluation as TradeEvaluation;
    expect(a.b).toBeGreaterThan(0);
    expect(a.steps?.ranked).toBe("offerFirst");
    expect(a.steps?.ifNo.add).toBe("qx1");
    const mine = sideIds(a.steps?.ifNo.full.proposal.give ?? []);
    expect(mine).toEqual(["ra1", "rc1", "qx1"]);
    expect(mine.length).toBeGreaterThan(SETTINGS.maxPerSide);
    expect(mine.length).toBeLessThanOrEqual(config.search.analyzerMaxPerSide);
  });

  it("no steps when a context note stops the search (the Analyzer still evaluates)", () => {
    // The same trade gets steps in the steps league as it is.
    expect(analyzeTrade(S1, CASE1).evaluation?.steps).toBeDefined();
    const late = stepsContext(3000, { tradeDeadline: { date: "2026-09-01T00:00:00.000Z" } });
    const a = analyzeTrade(late, CASE1);
    expect(a.notes[0]).toBe(DEADLINE_PASSED_NOTE);
    expect(a.evaluation?.stage).toBe("final");
    expect(a.evaluation?.steps).toBeUndefined();
  });

  describe("the search", () => {
    // Seed 67: its default search shows cards with steps, some holding a throw-in back (seed 11's shows none since the
    // value floor and β_need 1.2 of the planner's reply to Checkpoint 4, and seed 12's none since its given-player cap,
    // answer 7, left out the variants selling the same player again: facts of the synthetic data, deterministic).
    const league = smallLeague(67);
    const c = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8, ...FIXED_OMEGA });
    const I2 = tradeInternals(c);
    let cached: ReturnType<typeof runTradeSearch> | null = null;
    /** The default search, run once. */
    const search = () => (cached ??= runTradeSearch(c, {}));

    // Two whole searches and every step's version again: about 2 s alone, past the default 5 s under the suite's parallel load.
    it("steps on shown trades, each fitting its trade; the ranked numbers unchanged; deterministic", { timeout: 30_000 }, () => {
      const result = search();
      const withSteps = result.trades.filter((t) => t.steps);
      expect(withSteps.length).toBeGreaterThan(0);
      for (const t of withSteps) {
        const s = t.steps as NonNullable<typeof t.steps>;
        const rankedKey = s.ranked === "full" ? s.ifNo.full.key : s.offerFirst.key;
        expect(rankedKey).toBe(t.key);
        // Acceptance doesn't depend on the seasons simulated: the ranked version's step has the card's P_complete.
        expect(s.ranked === "full" ? s.ifNo.full.pComplete : s.offerFirst.pComplete).toBe(t.pComplete);
        expect(s.ifNo.full.pComplete - s.offerFirst.pComplete).toBeGreaterThanOrEqual(config.search.steps.minAcceptGain - 1e-9);
        expect(s.offerFirst.b).toBeGreaterThan(0);
        // Each version is the exact evaluation and screening simulation of its proposal.
        const other = s.ranked === "full" ? s.offerFirst : s.ifNo.full;
        expect(other).toEqual(stepOf(tradeVersion(I2, other.proposal, { settings: SETTINGS, maxPerSide: SETTINGS.maxPerSide }) as TradeVersion));
      }
      expect(runTradeSearch(c, {})).toEqual(result);
    });

    it("the pitch names the offer-first version: the words come after the steps, and never name the throw-in held back", () => {
      const held = search().trades.filter((t) => t.steps?.ranked === "full");
      expect(held.length).toBeGreaterThan(0);
      for (const t of held) {
        const s = t.steps as NonNullable<typeof t.steps>;
        expect(t.pitch).not.toContain(I2.snapshot.players[s.ifNo.add]?.name as string);
        for (const id of sideIds(s.offerFirst.proposal.give)) expect(t.pitch).toContain(I2.snapshot.players[id]?.name as string);
        const { reasons: _reasons, pitch: _pitch, ...core } = t;
        void _reasons;
        void _pitch;
        expect(t.pitch).toBe(withWords(I2, core).pitch);
      }
    });

    it("the steps stay within the search's per-side maximum (maxPerSide 1: no case-2 step can add a player)", () => {
      const one = runTradeSearch(c, { settings: settingsWith({ maxPerSide: 1 }) });
      expect(one.trades.length).toBeGreaterThan(0);
      for (const t of one.trades) {
        for (const step of t.steps ? [t.steps.offerFirst, t.steps.ifNo.full] : []) {
          expect(sideIds(step.proposal.give).length).toBeLessThanOrEqual(1);
          expect(sideIds(step.proposal.get).length).toBeLessThanOrEqual(1);
        }
      }
      expect(one.trades.some((t) => t.steps)).toBe(false);
      // A larger per-side maximum would have given some of these trades steps: the setting is what holds them back.
      const opened = one.trades.filter((t) => tradeSteps(I2, tradeVersion(I2, t.proposal, { settings: SETTINGS, maxPerSide: 2 }) as TradeVersion, { settings: SETTINGS, maxPerSide: 2 }) !== null);
      expect(opened.length).toBeGreaterThan(0);
    });
  });
});

describe("the planner's numbers (addendum to Checkpoint 3, §2 and §4; config.search)", () => {
  it("throw-ins cost at most 5 ROS lineup points; steps need +5 points of acceptance from at least 10%, and keep 80% of B", () => {
    expect(config.search.throwInMaxCost).toBe(5);
    expect(config.search.steps.minAcceptGain).toBe(0.05);
    expect(config.search.steps.minOfferFirst).toBe(0.1);
    expect(config.search.steps.minBShare).toBe(0.8);
    expect(stepConfig()).toMatchObject({ throwInMaxCost: 5, minAcceptGain: 0.05, minOfferFirst: 0.1, minBShare: 0.8 });
  });
});
