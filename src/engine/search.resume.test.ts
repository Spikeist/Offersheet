/**
 * Checkpoint 7f (planner reply to Checkpoint 7e, answer 2: "simulate only the 15,000 seasons the ranking run doesn't already
 * cover"; evaluate.ts runSim and SimState.resume, sim.ts's "Continuing a run"): in a trade context, every run on the shown
 * block whose rows had a run on the ranking block continues it, and every number a page prints is the number a context that
 * plays every run on the shown block in full prints (TradeContextOptions.resume false), bit for bit: the context's baselines
 * (the shown block's still LeagueModel.odds) and calibrations, a whole search (both lists, every card, Plan B box and
 * partner's scale), re-filters, every card's "now or after this week", "How to offer it" and the Analyzer on its trade, the
 * Analyzer before any search, and the weekly high scores' runs. Synthetic leagues (trade.testing.ts smallLeague: made-up
 * players, placeholder teams).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "./config";
import { analyzeTrade, buildTradeContext, laterNumbers, rankProgressOf, simCounts, tradeInternals, type ExactTrade, type SimState, type TradeContext } from "./evaluate";
import { buildLeagueModel } from "./league";
import { offerLadderOfSearch } from "./offers";
import { runRefilter, runTradeSearch, searchStateOf, type SearchState } from "./search";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { TradeEvaluation, TradeSearchResult } from "./tradeModel";

const at = (minChance: number, x: Partial<TradeSettings> = {}): TradeSettings => ({ ...defaultTradeSettings(), ...x, minChance });
const stateOf = (r: TradeSearchResult) => searchStateOf(r) as SearchState;
const simOf = (ctx: TradeContext) => tradeInternals(ctx).sim as SimState;
/** Every card of either list, once. */
const cardsOf = (r: TradeSearchResult): TradeEvaluation[] => [...new Map([...r.trades, ...(r.helpsBoth?.trades ?? [])].map((t) => [t.key, t])).values()];

/** One league's two contexts, alike but for TradeContextOptions.resume, and the League model built with the same settings. */
function pair(seed: number, settings: TradeSettings) {
  const league = smallLeague(seed);
  const opts = { now: TEST_NOW, scenarios: 8, settings };
  return {
    league,
    on: buildTradeContext(league.snapshot, league.inputs, opts),
    off: buildTradeContext(league.snapshot, league.inputs, { ...opts, resume: false }),
    model: () => buildLeagueModel(league.snapshot, league.inputs, opts),
  };
}

const PRIZES: Partial<TradeSettings> = { goal: "prizes", prizes: { first: 50, second: 20, third: 10, weeklyHigh: 1, pointsLeader: 6 } };
const CASES: { label: string; seed: number; extra: Partial<TradeSettings> }[] = [
  { label: "smallLeague 23", seed: 23, extra: {} },
  { label: "smallLeague 40", seed: 40, extra: {} },
  { label: "smallLeague 9 under “Several prizes” with a weekly high score (its runs simulate the high scores)", seed: 9, extra: PRIZES },
];

describe("every number a page prints is the full runs' (TradeContextOptions.resume false), bit for bit", { timeout: 300_000 }, () => {
  for (const c of CASES) {
    it(c.label, () => {
      const settings = at(0.1, c.extra);
      const { on, off, model } = pair(c.seed, settings);
      const simOn = simOf(on);
      const simOff = simOf(off);
      const { final } = simCounts();
      expect([simOn.resume, simOff.resume]).toEqual([true, false]);
      expect(simOn.highScores).toBe(c.extra === PRIZES);

      // The context: the shown block's baseline is LeagueModel.odds, number for number; every baseline, calibration and
      // reading of them is the full runs'.
      const m = model();
      expect(simOn.odds).toEqual(m.odds);
      expect(JSON.stringify(simOn.odds)).toBe(JSON.stringify(m.odds));
      expect(simOn.calibration).toEqual(m.helpsCalibration);
      expect([simOn.odds, simOn.rank.odds, simOn.base, simOn.calibration, simOn.rank.calibration]).toEqual([simOff.odds, simOff.rank.odds, simOff.base, simOff.calibration, simOff.rank.calibration]);

      // A whole search: both lists, every card, box, count and note.
      const rOn = runTradeSearch(on, { settings });
      const rOff = runTradeSearch(off, { settings });
      expect(rOn).toEqual(rOff);
      expect(cardsOf(rOn).length).toBeGreaterThan(0);
      // The resume was taken: every card's and box's rows had a ranking run that kept its progress, and every partner whose
      // scale the shown block needed had its ranking calibration's; the full context kept none.
      const sOn = stateOf(rOn);
      const sOff = stateOf(rOff);
      let boxes = 0;
      for (const t of cardsOf(rOn)) {
        for (const key of [t.key, ...(t.planB ? [t.planB.key] : [])]) {
          if (key !== t.key) boxes++;
          const x = sOn.exactByKey.get(key) as ExactTrade;
          expect(rankProgressOf(simOn, x.mine, x.theirs)?.sims, key).toBe(final);
          const y = sOff.exactByKey.get(key) as ExactTrade;
          expect(rankProgressOf(simOff, y.mine, y.theirs), key).toBeUndefined();
        }
      }
      expect(boxes).toBeGreaterThan(0); // a fact of the synthetic data
      expect(simOn.partners.size).toBeGreaterThan(0);
      for (const id of simOn.partners.keys()) {
        expect(simOn.rank.partners.has(id), id).toBe(true);
        expect(simOn.partnerProgress.get(id)?.sims, id).toBe(final);
      }
      expect(simOff.partnerProgress.size).toBe(0);
      expect([...simOn.partners]).toEqual([...simOff.partners]);
      expect([...simOn.rank.partners]).toEqual([...simOff.rank.partners]);

      // Re-filters: to Any (more cards on the shown block) and back.
      const anyOn = runRefilter(on, sOn, { minChance: 0 });
      expect(anyOn).toEqual(runRefilter(off, sOff, { minChance: 0 }));
      expect(runRefilter(on, stateOf(anyOn), { minChance: 0.1 })).toEqual(rOn);

      // Every card's "now or after this week", "How to offer it" and the Analyzer on its trade.
      for (const t of cardsOf(rOn)) {
        const xOn = sOn.exactByKey.get(t.key) as ExactTrade;
        const xOff = sOff.exactByKey.get(t.key) as ExactTrade;
        expect(laterNumbers(sOn.I, xOn, settings), t.key).toEqual(laterNumbers(sOff.I, xOff, settings));
        expect(offerLadderOfSearch(rOn, t.key), t.key).toEqual(offerLadderOfSearch(rOff, t.key));
        expect(analyzeTrade(on, t.proposal, { settings }), t.key).toEqual(analyzeTrade(off, t.proposal, { settings }));
      }
    });
  }

  it("the Analyzer before any search: nothing to continue, so its runs play every season; after the search ranked its trade, they continue the ranking runs", () => {
    const settings = at(0.1);
    const { league, on, off } = pair(23, settings);
    const scout = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8, settings });
    const card = runTradeSearch(scout, { settings }).trades[0] as TradeEvaluation;
    const first = analyzeTrade(on, card.proposal, { settings });
    expect(first).toEqual(analyzeTrade(off, card.proposal, { settings }));
    // Runs on the shown block keep nothing: no ranking run was made yet.
    expect(simOf(on).partnerProgress.size).toBe(0);
    const r = runTradeSearch(on, { settings });
    expect(r).toEqual(runTradeSearch(off, { settings }));
    const x = stateOf(r).exactByKey.get(card.key) as ExactTrade;
    expect(rankProgressOf(simOf(on), x.mine, x.theirs)?.sims).toBe(simCounts().final);
    expect(analyzeTrade(on, card.proposal, { settings })).toEqual(first);
  });
});

describe("config.simulation.shownSims at finalSims: one block, nothing continued or kept", () => {
  const simulation = config.simulation as { shownSims: number };
  const shownSims = simulation.shownSims;
  beforeAll(() => {
    simulation.shownSims = config.simulation.finalSims;
  });
  afterAll(() => {
    simulation.shownSims = shownSims;
  });

  it("SimState.resume is false, and the search is the one a context without the resume makes", { timeout: 120_000 }, () => {
    const settings = at(0.1);
    const { on, off } = pair(23, settings);
    const sim = simOf(on);
    expect(sim.blocks.shown).toBe(sim.blocks.final);
    expect(sim.resume).toBe(false);
    const r = runTradeSearch(on, { settings });
    expect(r).toEqual(runTradeSearch(off, { settings }));
    const st = stateOf(r);
    for (const t of cardsOf(r)) {
      const x = st.exactByKey.get(t.key) as ExactTrade;
      expect(rankProgressOf(sim, x.mine, x.theirs), t.key).toBeUndefined();
    }
    expect(sim.partnerProgress.size).toBe(0);
  });
});
