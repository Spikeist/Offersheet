/**
 * Checkpoint 7f (planner reply to Checkpoint 7e, answer 2; sim.ts's "Continuing a run"): which runs continue another, counted
 * at sim.ts's door (simulateSeason wrapped to log each call's seasons, where it starts and whether it keeps its progress).
 * - The trade context: its baseline and my "Helps you" calibration on the ranking block keep their progress, and their runs
 *   on the shown block continue them; with TradeContextOptions.resume false, every run on the shown block plays all its
 *   seasons and nothing is kept.
 * - A search: every card's, box's and partner scale's run on the shown block continues its ranking run (each has one:
 *   rankProgressOf, SimState.partnerProgress), and so do a re-filter's new cards' and boxes' and the Analyzer's on a trade
 *   the search ranked, while a ladder offer the search never ranked (the merge's, offers.ts) plays every season; so the
 *   shown block's runs are checked card by card, box by box and scale by scale, not all at once (the review of the speed
 *   track, SPEED-3: at 3 players a side on Parker's league, Oct 15, 2 of the search's 26 runs there played every season).
 *   "Now or after this week" (rows of its own) and the Analyzer before any search play every season.
 * - The waiver rating (league.ts rateWaiverUpgrades, waiverRating.ts): every finishing run continues its screening run.
 * The numbers these runs give are the full runs', bit for bit: sim.resume.test.ts and search.resume.test.ts. Synthetic leagues
 * (trade.testing.ts smallLeague: made-up players, placeholder teams).
 */
import { describe, expect, it, vi } from "vitest";
import type { SimOptions, SimSetup } from "./sim";

/** Every simulateSeason call from outside sim.ts: its seasons, the season it starts from (a resume's), and whether it keeps. */
const log = vi.hoisted(() => ({ runs: [] as { sims: number; from: number; keep: boolean }[] }));
vi.mock("./sim", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sim")>();
  return {
    ...actual,
    simulateSeason: (setup: SimSetup, opts: SimOptions) => {
      log.runs.push({ sims: opts.sims, from: opts.resume?.sims ?? 0, keep: opts.keep === true });
      return actual.simulateSeason(setup, opts);
    },
  };
});

import { config } from "./config";
import { analyzeTrade, buildTradeContext, laterNumbers, rankProgressOf, simCounts, tradeInternals, type ExactTrade, type SimState } from "./evaluate";
import { buildLeagueModelWithContext, rateWaiverUpgrades, type LeagueModelConfig } from "./league";
import { runRefilter, runTradeSearch, searchStateOf, type SearchState } from "./search";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";

const at = (minChance: number): TradeSettings => ({ ...defaultTradeSettings(), minChance });
const { final, shown } = simCounts();
type Run = { sims: number; from: number; keep: boolean };
/** What `run` gives, and the runs logged while it ran. */
function logged<T>(run: () => T): { value: T; runs: Run[] } {
  log.runs = [];
  const value = run();
  return { value, runs: log.runs };
}
const onShown = (runs: readonly Run[]) => runs.filter((r) => r.sims === shown);

describe("which runs continue another (simulateSeason's calls, counted)", { timeout: 300_000 }, () => {
  const league = smallLeague(23);
  const opts = { now: TEST_NOW, scenarios: 8 };

  it("the trade context: its baseline and calibration on the shown block continue their ranking-block runs; resume false plays all", () => {
    expect(final).toBeLessThan(shown);
    const on = logged(() => buildTradeContext(league.snapshot, league.inputs, opts)).runs;
    const off = logged(() => buildTradeContext(league.snapshot, league.inputs, { ...opts, resume: false })).runs;
    // The ranking block's baseline and calibration keep their progress; the shown block's continue them. (The automatic
    // playoff weight's runs, the League model's step 5c, play every season: nothing on the ranking block to continue.)
    expect(on.filter((r) => r.sims === final)).toEqual([
      { sims: final, from: 0, keep: true },
      { sims: final, from: 0, keep: true },
    ]);
    expect(onShown(on).filter((r) => r.from === final)).toHaveLength(2);
    expect(onShown(on).filter((r) => r.from !== final).every((r) => r.from === 0 && !r.keep)).toBe(true);
    // Without the resume: the same runs, every one from the first season, nothing kept.
    expect(off.map((r) => r.sims)).toEqual(on.map((r) => r.sims));
    expect(off.every((r) => r.from === 0 && !r.keep)).toBe(true);
  });

  it("a search: every card's, box's and partner scale's run on the shown block continues its ranking run; a re-filter's and the Analyzer's on a ranked trade too", () => {
    const ctx = buildTradeContext(league.snapshot, league.inputs, opts);
    const sim = tradeInternals(ctx).sim as SimState;
    const { value: r, runs } = logged(() => runTradeSearch(ctx, { settings: at(0.1) }));
    const st = searchStateOf(r) as SearchState;
    // Runs on the ranking block keep their progress (the finalists', Plan B's candidates', the partners' scales); the
    // screening block's don't.
    for (const x of runs) expect(x.keep, JSON.stringify(x)).toBe(x.sims === final);
    // Every trade the shown pass simulated (SearchState.shownByKey: the cards and boxes shown, and those their printed numbers
    // took off a list or out of a box) had a ranking run that kept its progress, so its run on the shown block continued it;
    // and so did every partner's scale there.
    expect(st.shownByKey.size).toBeGreaterThan(r.counts.simShown ?? 0); // a fact of the synthetic data: one left
    for (const key of st.shownByKey.keys()) {
      const x = st.exactByKey.get(key) as ExactTrade;
      expect(rankProgressOf(sim, x.mine, x.theirs)?.sims, key).toBe(final);
    }
    expect(sim.partners.size).toBeGreaterThan(0);
    for (const id of sim.partners.keys()) expect(sim.partnerProgress.get(id)?.sims, id).toBe(final);
    // At sim.ts's door: those runs from the ranking block's last season, and any other run on the shown block (a ladder offer
    // the merge printed that the search never ranked) from the first; none keeps its progress.
    const shownRuns = onShown(runs);
    expect(shownRuns.filter((x) => x.from === final).length).toBeGreaterThanOrEqual(st.shownByKey.size + sim.partners.size);
    for (const x of shownRuns) {
      expect([final, 0], JSON.stringify(x)).toContain(x.from);
      expect(x.keep).toBe(false);
    }
    // Re-filtering to Any: the new cards and boxes continue their ranking runs too.
    const before = new Set(st.shownByKey.keys());
    const any = onShown(logged(() => runRefilter(ctx, st, { minChance: 0 })).runs);
    const added = [...st.shownByKey.keys()].filter((k) => !before.has(k));
    expect(added.length).toBeGreaterThan(0); // a fact of the synthetic data: Any shows more
    for (const key of added) {
      const x = st.exactByKey.get(key) as ExactTrade;
      expect(rankProgressOf(sim, x.mine, x.theirs)?.sims, key).toBe(final);
    }
    expect(any.filter((x) => x.from === final).length).toBeGreaterThanOrEqual(added.length);
    for (const x of any) expect([final, 0], JSON.stringify(x)).toContain(x.from);
    // The Analyzer on a card's trade: its run continues the search's ranking run; its "now or after this week" (rows of its
    // own: this week as before the trade) plays every season.
    const card = r.trades[0];
    if (!card) throw new Error("no card");
    expect(laterNumbers(st.I, st.exactByKey.get(card.key) as ExactTrade, at(0.1))).not.toBeNull(); // a fact of the synthetic data
    const analyzed = onShown(logged(() => analyzeTrade(ctx, card.proposal, { settings: at(0.1) })).runs);
    expect(analyzed).toEqual([
      { sims: shown, from: final, keep: false },
      { sims: shown, from: 0, keep: false },
    ]);
  });

  it("the Analyzer before any search plays every season", () => {
    const ctx = buildTradeContext(league.snapshot, league.inputs, opts);
    const scout = runTradeSearch(buildTradeContext(league.snapshot, league.inputs, opts), { settings: at(0.1) });
    const card = scout.trades[0];
    if (!card) throw new Error("no card");
    const runs = onShown(logged(() => analyzeTrade(ctx, card.proposal, { settings: at(0.1), later: false })).runs);
    // The trade's run and its partner's scale, both on the shown block, both from the first season.
    expect(runs).toEqual([
      { sims: shown, from: 0, keep: false },
      { sims: shown, from: 0, keep: false },
    ]);
  });
});

describe("the waiver rating: every finishing run continues its screening run (⚠️ ours)", () => {
  it("screening runs keep their progress; finishing runs, on all the seasons, continue them", { timeout: 120_000 }, () => {
    const l = smallLeague(11);
    const cfg: LeagueModelConfig = { ...config, waivers: { ...config.waivers, ratingScreenSims: 100, ratingFinishRows: 2 } };
    const o = { now: TEST_NOW, sims: 400, waiverRating: false };
    const built = buildLeagueModelWithContext(l.snapshot, l.inputs, o, cfg);
    const { value: rated, runs } = logged(() => rateWaiverUpgrades(built, l.inputs, o));
    const rating = rated?.ros?.rating;
    expect(rating?.finished).toBe(2);
    const screen = runs.filter((r) => r.sims === 100);
    const finish = runs.filter((r) => r.sims === 400);
    expect(screen.length).toBe(rating?.runs?.screen);
    expect(finish.length).toBe(rating?.runs?.shown);
    expect(screen.every((r) => r.from === 0 && r.keep)).toBe(true);
    expect(finish.every((r) => r.from === 100 && !r.keep)).toBe(true);
    expect(runs).toHaveLength(screen.length + finish.length);
  });
});
