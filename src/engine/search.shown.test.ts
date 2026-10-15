/**
 * Checkpoint 7e (planner reply to Checkpoint 7d, item 1.1: "raise the final simulation for the cards shown to 10,000 or 20,000
 * seasons"; the lead's design, "Item 1.1, as built"): the ranking block and the shown block (config.simulation.finalSims and
 * shownSims; evaluate.ts, the three blocks; search.ts, "The shown pass"). The shown block's baseline is LeagueModel.odds; the
 * ranking block is its first finalSims seasons (a finalist's numbers are a finalSims-season evaluation's); every number a card
 * or a Plan B box prints comes from the shown block; the rules the lists and the boxes are chosen by hold on those numbers
 * (the review of the track: SHOWN-1, a card's "Helps both" rules for its box and, since item 4.1, its "How to offer it" read
 * its printed tag, so they and its pitch are the Analyzer's; SHOWN-2, every box passes planB.ts's rules on its printed numbers; SHOWN-3, each list is rank.ts's
 * ranking of its own cards on their printed numbers, §13's caps in the printed top 20 included); re-filtering equals a fresh
 * search; the Analyzer reads the shown block; the search is deterministic, its progress only moves forward; and with the
 * shown block at the ranking block's seasons the pass takes the ranking numbers as they are.
 * Synthetic leagues (trade.testing.ts smallLeague: made-up players, placeholder teams); which seeds show what is a fact of the
 * synthetic data, said where a test leans on it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { helpsBoth } from "./benefit";
import { config } from "./config";
import { analyzeTrade, assetValue, buildTradeContext, helpsScaleOf, rewardFor, simCounts, simulateTrade, tradeInternals, type ExactTrade, type SimState, type TeamState, type TradeContext } from "./evaluate";
import { buildLeagueModel } from "./league";
import { offerLadderOfProposal, offerLadderOfSearch } from "./offers";
import type { SeasonOdds } from "./leagueModel";
import { dominatedByCard, planBPasses } from "./planB";
import { prizeOddsOf } from "./reward";
import { rankTrades, sortTrades } from "./rank";
import { rankCaps, runRefilter, runTradeSearch, searchStateOf, type SearchState } from "./search";
import { seasonOdds, type SeasonModel } from "./season";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { OfferLadder, PlanB, TradeEvaluation, TradeEvaluationCore, TradeSearchProgress, TradeSearchResult } from "./tradeModel";

const at = (minChance: number, x: Partial<TradeSettings> = {}): TradeSettings => ({ ...defaultTradeSettings(), ...x, minChance });

const contexts = new Map<number, TradeContext>();
function contextOf(seed: number): TradeContext {
  let ctx = contexts.get(seed);
  if (!ctx) {
    const league = smallLeague(seed);
    ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
    contexts.set(seed, ctx);
  }
  return ctx;
}
const searches = new Map<string, TradeSearchResult>();
/** The search at a minimum chance, with the shown pass (`pass`, the app's) or without it (TradeSearchOptions.shownPass false), fresh and shared. */
function search(seed: number, minChance = 0.1, pass = true): TradeSearchResult {
  const key = `${seed}|${minChance}|${pass}`;
  let r = searches.get(key);
  if (!r) {
    r = runTradeSearch(contextOf(seed), { settings: at(minChance), ...(pass ? {} : { shownPass: false }) });
    searches.set(key, r);
  }
  return r;
}
const stateOf = (r: TradeSearchResult) => searchStateOf(r) as SearchState;
const keys = (ts: readonly { key: string }[]) => ts.map((t) => t.key);
const listOf = (r: TradeSearchResult): TradeEvaluation[] => r.helpsBoth?.trades ?? [];
const cardsOf = (r: TradeSearchResult): TradeEvaluation[] => [...new Map([...r.trades, ...listOf(r)].map((t) => [t.key, t])).values()];
/** What the cards print that comes from a simulation (and the scale it's scored on). */
const printed = (e: TradeEvaluationCore) => ({ b: e.b, b3: e.b3, tradeScore: e.tradeScore, overall: e.overall, dPO: e.dPO, dCH: e.dCH, dPrizes: e.dPrizes, them: e.them, winChance: e.detail.winChance, sims: e.sims });
const boxPrinted = (b: PlanB) => ({ b: b.b, tradeScore: b.tradeScore, overall: b.overall, dPO: b.dPO, dCH: b.dCH, dPrizes: b.dPrizes, winChance: b.winChance });

/** The season model with my row and the trade partner's replaced by the trade's (evaluate.ts runSim's rows, as season.seasonOdds plays them). */
function afterModel(sim: SimState, me: TeamState, x: ExactTrade): SeasonModel {
  return {
    ...sim.season,
    teams: sim.season.teams.map((t) => {
      const score = t.id === me.id ? x.mine.score : t.id === x.partner.id ? x.theirs.score : t.score;
      return { id: t.id, score: { mean: Array.from(score.mean), sd: Array.from(score.sd) } };
    }),
  };
}

describe("the shown block and the ranking block (evaluate.ts; config.simulation)", { timeout: 120_000 }, () => {
  it("the shown block's baseline is LeagueModel.odds exactly, on shownSims seasons; its calibration the League model's; the search's baseline and B₃ are it", () => {
    const { snapshot, inputs } = smallLeague(23);
    const model = buildLeagueModel(snapshot, inputs, { now: TEST_NOW, scenarios: 8 });
    const I = tradeInternals(contextOf(23));
    const sim = I.sim as SimState;
    expect(config.simulation.shownSims).toBe(20_000);
    expect(model.odds?.sims).toBe(config.simulation.shownSims);
    expect(sim.blocks.shown.sims).toBe(config.simulation.shownSims);
    expect(sim.odds).toEqual(model.odds);
    expect(JSON.stringify(sim.odds)).toBe(JSON.stringify(model.odds));
    expect(sim.calibration).toEqual(model.helpsCalibration);
    // The cards' "before": the search's baseline is my headline.
    const r = search(23);
    const mine = model.odds?.teams.find((t) => t.teamId === model.myTeamId);
    expect(r.baseline).toEqual({ pPlayoffs: mine?.pPlayoffs, pTitle: mine?.pTitle, expWins: mine?.expWins, prizes: prizeOddsOf(mine as NonNullable<typeof mine>) });
    // Every card and box is scored on the shown block's B₃, the result's own scale.
    const settings = at(0.1);
    const b3 = helpsScaleOf(I, settings.lambda, rewardFor(I, settings))?.b3;
    expect(r.helpsScale?.b3).toBe(b3);
    for (const t of cardsOf(r)) expect(t.b3, t.key).toBe(b3);
    expect(b3).not.toBe(helpsScaleOf(I, settings.lambda, rewardFor(I, settings), "final")?.b3);
  });

  it("the ranking block is the shown block's first finalSims seasons: a finalist's ranking numbers are a finalSims-season evaluation's, drawn afresh from the seed", () => {
    const r = search(23);
    const st = stateOf(r);
    const I = st.I;
    const sim = I.sim as SimState;
    const me = I.me as TeamState;
    const { final } = simCounts();
    expect(final).toBe(config.simulation.finalSims);
    // seasonOdds draws its own matrix of `final` seasons from the seed when given no normals: the ranking block's seasons.
    const fresh = (model: SeasonModel) => seasonOdds(I.snapshot, model, { sims: final, seed: sim.seed, highScores: sim.highScores }) as SeasonOdds;
    const before = fresh(sim.season);
    expect(before).toEqual(sim.rank.odds);
    const mine = (o: SeasonOdds) => o.teams.find((t) => t.teamId === me.id) as SeasonOdds["teams"][number];
    let n = 0;
    for (const t of cardsOf(r)) {
      const ranked = st.finalByKey.get(t.key) as TradeEvaluationCore;
      const x = st.exactByKey.get(t.key) as ExactTrade;
      expect(ranked.sims, t.key).toBe(final);
      const after = fresh(afterModel(sim, me, x));
      expect(Object.is(ranked.dPO, mine(after).pPlayoffs - mine(before).pPlayoffs), t.key).toBe(true);
      expect(Object.is(ranked.dCH, (mine(after).pTitle as number) - (mine(before).pTitle as number)), t.key).toBe(true);
      n++;
    }
    expect(n).toBeGreaterThan(0);
  });
});

describe("the shown pass (search.ts): every number a card or a box prints comes from the shown block", { timeout: 120_000 }, () => {
  it("every card of either list: its numbers and words are its simulation's on the shown block (the Analyzer's too), its lists' rules hold on them", () => {
    for (const seed of [23, 40]) {
      const r = search(seed);
      const st = stateOf(r);
      const I = st.I;
      const settings = at(0.1);
      const reward = rewardFor(I, settings);
      expect(cardsOf(r).length, `seed ${seed}`).toBeGreaterThan(0);
      for (const t of cardsOf(r)) {
        const x = st.exactByKey.get(t.key) as ExactTrade;
        const shown = simulateTrade(I, x, "shown", settings.lambda, settings.protectValue, reward);
        expect(t.sims, t.key).toBe(config.simulation.shownSims);
        expect(printed(t), t.key).toEqual(printed(shown));
        expect(st.shownByKey.get(t.key), t.key).toEqual(shown);
        // The ranking block's run is another (its seasons and its own scale).
        expect(st.finalByKey.get(t.key)?.b, t.key).not.toBe(t.b);
        // The Analyzer evaluates on the shown block: a card opened there reads the very numbers it printed.
        const a = analyzeTrade(contextOf(seed), t.proposal, { settings }).evaluation as TradeEvaluation;
        expect(printed(a), t.key).toEqual(printed(t));
        expect(a.reasons, t.key).toEqual(t.reasons);
        // The lists' own rules on the shown numbers: every card helps me, every "Helps both" card helps both.
        expect(t.b as number, t.key).toBeGreaterThan(0);
      }
      for (const t of listOf(r)) expect(helpsBoth(t), t.key).toBe(true);
    }
  });

  it("every Plan B box: its B, Helps you, Overall, odds and weekly line from its own simulation on the shown block, its chance and acceptance numbers from its exact evaluation", () => {
    let boxes = 0;
    for (const seed of [23, 40]) {
      const r = search(seed);
      const st = stateOf(r);
      const I = st.I;
      const settings = at(0.1);
      for (const t of cardsOf(r)) {
        if (!t.planB) continue;
        boxes++;
        const shown = simulateTrade(I, st.exactByKey.get(t.planB.key) as ExactTrade, "shown", settings.lambda, settings.protectValue, rewardFor(I, settings));
        expect(boxPrinted(t.planB), t.planB.key).toEqual({ b: shown.b, tradeScore: shown.tradeScore, overall: shown.overall, dPO: shown.dPO, dCH: shown.dCH, dPrizes: shown.dPrizes, winChance: shown.detail.winChance });
        expect(st.shownByKey.get(t.planB.key), t.planB.key).toEqual(shown);
        expect([t.planB.pAccept, t.planB.pComplete, t.planB.acceptLabel, t.planB.features, t.planB.gPartner], t.planB.key).toEqual([shown.pAccept, shown.pComplete, shown.acceptLabel, shown.features, shown.gPartner]);
      }
    }
    expect(boxes).toBeGreaterThan(0); // a fact of the synthetic data
  });

  it("⚠️ SHOWN-2: every box passes planB.ts's rules on the numbers it prints, against its card's and its list's (half the card's Helps you, helping both under a card tagged “Helps both”, no card of its list matching or beating it)", () => {
    // smallLeague 74 and 99 under the default goal, 9 under "Several prizes" 60 / 30 / 10: facts of the synthetic data, each
    // with a box the ranking block chose whose printed numbers broke one of the rules before the fix (74: a card of its list
    // matched it on Helps you and beat it on the chance; 99: under a card tagged "Helps both" its Helps them printed 9; 9: its
    // Helps you printed 17 under a card printing 42).
    const prizes = { goal: "prizes" as const, prizes: { first: 60, second: 30, third: 10, weeklyHigh: null, pointsLeader: null } };
    let boxes = 0;
    for (const [seed, extra] of [[74, {}], [99, {}], [9, prizes]] as const) {
      const settings = at(0.1, extra);
      const league = smallLeague(seed);
      const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8, settings });
      const r = runTradeSearch(ctx, { settings });
      const st = stateOf(r);
      const overall = new Set(keys(r.trades));
      const both = new Set(keys(listOf(r)));
      for (const [name, cards] of [["overall", r.trades], ["both", listOf(r)]] as const) {
        for (const t of cards) {
          if (!t.planB) continue;
          boxes++;
          const printedBox = st.shownByKey.get(t.planB.key) as TradeEvaluationCore;
          const listCards = overall.has(t.key) && both.has(t.key) ? cardsOf(r) : name === "overall" ? r.trades : listOf(r);
          expect(planBPasses(printedBox, t, st.planBCfg), `seed ${seed} ${t.key} → ${t.planB.key}`).toBe(true);
          expect(dominatedByCard(t.planB, listCards), `seed ${seed} ${t.key} → ${t.planB.key}`).toBe(false);
          if (helpsBoth(t)) expect(helpsBoth(printedBox), `seed ${seed} ${t.key} → ${t.planB.key}`).toBe(true);
        }
      }
    }
    expect(boxes).toBeGreaterThan(0);
  });

  it("⚠️ SHOWN-1: a card's “Helps both” rules for its box and its “How to offer it” read its printed numbers, so its pitch and its offers are the Analyzer's (smallLeague 127)", () => {
    // A fact of the synthetic data: the card Helps them 10 on the ranking block (so it helped both there), 8 as printed. Before
    // the fix its steps were held to the rule its ranking numbers set: no lean offer first (that version doesn't help Team 6),
    // no box either, and a pitch for the whole trade, while the Analyzer, on the shown block, offered the lean version first.
    // Since Checkpoint 7e (planner reply to Checkpoint 7d, item 4.1) no card has steps: its "How to offer it" (offers.ts)
    // reads the printed tag too, and opens with the lean version, as the Analyzer's does.
    const key = "6|give:1008,1011|get:1062,1064";
    const r = search(127);
    const st = stateOf(r);
    const card = r.trades.find((t) => t.key === key) as TradeEvaluation;
    expect(card).toBeDefined();
    expect(helpsBoth(st.finalByKey.get(key) as TradeEvaluationCore)).toBe(true);
    expect([card.them?.helps, helpsBoth(card)]).toEqual([8, false]);
    const a = analyzeTrade(contextOf(127), card.proposal, { settings: at(0.1) }).evaluation as TradeEvaluation;
    expect(helpsBoth(a)).toBe(false);
    expect(card.steps).toBeUndefined();
    expect(card.pitch).toBe(a.pitch);
    expect(card.reasons).toEqual(a.reasons);
    const said = (l: OfferLadder | null) => l?.steps.map((s) => ({ kind: s.kind, key: s.evaluation.key, tradeScore: s.evaluation.tradeScore, pComplete: s.evaluation.pComplete }));
    const ladder = offerLadderOfSearch(r, key);
    expect(said(ladder)).toEqual(said(offerLadderOfProposal(contextOf(127), card.proposal, { settings: at(0.1) })));
    // It opens with the lean version, which doesn't help both: a rule only a card tagged "Helps both" reads.
    const open = ladder?.steps[0];
    expect([open?.kind, open?.evaluation.key]).toEqual(["open", "6|give:1008|get:1062,1064"]);
    expect(helpsBoth(open?.evaluation as TradeEvaluation)).toBe(false);
  });
});

describe("each list is rank.ts's ranking of its own cards on their printed numbers (against the same search without the pass)", { timeout: 120_000 }, () => {
  it("nothing comes in; each list in its own order on the printed numbers, §13's rules holding on them; the search's counts", () => {
    let reordered = 0;
    let leftBoth = 0;
    for (const seed of [8, 23, 40]) {
      const on = search(seed);
      const off = search(seed, 0.1, false);
      const st = stateOf(on);
      const value = assetValue(st.I);
      const caps = rankCaps({ relaxed: false, onePartner: st.onePartner });
      // Without the pass every card keeps its ranking numbers (Checkpoint 7d's cards).
      for (const t of cardsOf(off)) expect(t.sims, t.key).toBe(config.simulation.finalSims);
      // The Overall list: the ranking's cards (here every one: none fails §10's guard or §13's rules on the shown block, a fact
      // of the synthetic data), in Overall order on the printed numbers, and rank.ts takes nothing more out of it.
      expect([...keys(on.trades)].sort(), `seed ${seed}`).toEqual([...keys(off.trades)].sort());
      expect(keys(on.trades), `seed ${seed}`).toEqual(keys(sortTrades(on.trades, "overall")));
      expect(keys(rankTrades(on.trades, value, caps, { minChance: 0.1, givenCapExempt: st.forcedGive }).trades), `seed ${seed}`).toEqual(keys(on.trades));
      if (keys(on.trades).join() !== keys(off.trades).join()) reordered++;
      // The "Helps both" list: the ranking's cards but those whose printed numbers don't help both (the lead's call), by B.
      const shownOf = (k: string) => st.shownByKey.get(k) as TradeEvaluationCore;
      expect(keys(listOf(on)), `seed ${seed}`).toEqual(keys(sortTrades(listOf(on), "helps")));
      expect([...keys(listOf(on))].sort(), `seed ${seed}`).toEqual(keys(listOf(off)).filter((k) => helpsBoth(shownOf(k))).sort());
      expect(keys(rankTrades(listOf(on), value, caps, { minChance: 0.1, givenCapExempt: st.forcedGive, order: "helps", keep: helpsBoth }).trades), `seed ${seed}`).toEqual(keys(listOf(on)));
      leftBoth += listOf(off).length - listOf(on).length;
      // Each card's "Helps both" status is the same on both blocks here (a fact of the synthetic data), and no card has steps
      // (Checkpoint 7e: "How to offer it" is worked out when it's opened, offers.ts).
      for (const t of cardsOf(on)) {
        const plain = cardsOf(off).find((c) => c.key === t.key) as TradeEvaluation;
        expect(helpsBoth(t), t.key).toBe(helpsBoth(plain));
        expect([t.steps, plain.steps], t.key).toEqual([undefined, undefined]);
      }
      // The search's own counts and filter are the same; a card the "Helps both" list loses isn't hidden from the Overall
      // list; the pass's count is its own.
      const searched = (r: TradeSearchResult) => ({ ...r.counts, simShown: undefined });
      expect(searched(on), `seed ${seed}`).toEqual(searched(off));
      expect(on.hidden, `seed ${seed}`).toEqual(off.hidden);
      expect(on.filter, `seed ${seed}`).toEqual(off.filter);
      expect(on.counts.simShown, `seed ${seed}`).toBe(new Set(cardsOf(on).flatMap((t) => [t.key, ...(t.planB ? [t.planB.key] : [])])).size);
      expect(off.counts.simShown, `seed ${seed}`).toBe(0);
    }
    // Facts of the synthetic data: the shown numbers reorder a list (smallLeague 8 and 40), and a card leaves the "Helps both"
    // list (smallLeague 23 and 40: on the shown block its Helps them prints under config.benefit.helpsThemMin).
    expect(reordered).toBeGreaterThan(0);
    expect(leftBoth).toBeGreaterThan(0);
  });

  it("⚠️ SHOWN-3: §13's caps hold in the printed top 20, the card that would break one taken out (smallLeague 10, 12 teams, at Any)", () => {
    // A fact of the synthetic data: before the fix, the shown numbers moved 4|give:1002|get:1044 from the ranking's 22nd place
    // to the 18th, giving Team 4 a 4th card in the top 20 and player 1002 a 4th too.
    const settings = at(0);
    const league = smallLeague(10, {}, 12);
    const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8, settings });
    const on = runTradeSearch(ctx, { settings });
    const off = runTradeSearch(ctx, { settings, shownPass: false });
    const st = stateOf(on);
    expect(off.trades.length).toBeGreaterThan(config.ranking.partnerCapTop);
    const perPartner = new Map<string, number>();
    const perGiven = new Map<string, number>();
    for (const t of on.trades.slice(0, config.ranking.partnerCapTop)) {
      perPartner.set(t.proposal.partnerId, (perPartner.get(t.proposal.partnerId) ?? 0) + 1);
      for (const a of t.proposal.give) if (a.kind === "player") perGiven.set(a.id, (perGiven.get(a.id) ?? 0) + 1);
    }
    expect(Math.max(...perPartner.values())).toBeLessThanOrEqual(config.ranking.perPartnerInTop20);
    expect(Math.max(...perGiven.values())).toBeLessThanOrEqual(config.ranking.perGivenPlayerInTop20);
    // Nothing comes in, a card the rules drop counts among the dropped, and the list is in Overall order on its printed numbers.
    expect(keys(on.trades).every((k) => keys(off.trades).includes(k))).toBe(true);
    const lost = off.trades.length - on.trades.length;
    expect(lost).toBeGreaterThan(0);
    const dropped = (r: TradeSearchResult) => Object.values(r.dropped ?? {}).reduce((s, n) => s + n, 0);
    expect(dropped(on) + on.hidden.byBenefit).toBe(dropped(off) + off.hidden.byBenefit + lost);
    expect(keys(on.trades)).toEqual(keys(sortTrades(on.trades, "overall")));
    expect(keys(rankTrades(on.trades, assetValue(st.I), rankCaps({ relaxed: false, onePartner: st.onePartner }), { givenCapExempt: st.forcedGive }).trades)).toEqual(keys(on.trades));
  });

  it("⚠️ the exits (ours): a card whose shown B isn't above 0 leaves both lists, counted as hidden by benefit; a box whose shown B isn't above 0 is turned down; a card whose shown numbers don't help both leaves that list alone", () => {
    // A search of its own (its shown numbers forged below), re-filtered at its own minimum: the ranking is the same, the pass reads the forged numbers.
    const ctx = contextOf(23);
    const r = runTradeSearch(ctx, { settings: at(0.1) });
    const st = stateOf(r);
    const card = r.trades.find((t) => !t.planB) as TradeEvaluation;
    const boxed = r.trades.find((t) => t.planB && t.key !== card.key) as TradeEvaluation;
    const box = boxed.planB as PlanB;
    const forge = (key: string, edit: Partial<TradeEvaluationCore>) => st.shownByKey.set(key, { ...(st.shownByKey.get(key) as TradeEvaluationCore), ...edit });
    forge(card.key, { b: -0.05, tradeScore: null, overall: null });
    forge(box.key, { b: 0, tradeScore: null, overall: null });
    const again = runRefilter(ctx, st, { minChance: 0.1 });
    expect(keys(again.trades)).not.toContain(card.key);
    expect(again.trades).toHaveLength(r.trades.length - 1);
    expect(keys(listOf(again))).not.toContain(card.key);
    expect(again.hidden.byBenefit).toBe(r.hidden.byBenefit + 1);
    // The box's printed numbers fail planB.ts's rules (B ≤ 0): its card shows another candidate or none.
    expect(again.trades.find((t) => t.key === boxed.key)?.planB?.key).not.toBe(box.key);
    // A "Helps both" card whose shown Helps them falls under the bar: off that list, on the Overall list still when it's there.
    const both = listOf(r)[0] as TradeEvaluation;
    const s = st.shownByKey.get(both.key) as TradeEvaluationCore;
    forge(both.key, { them: { ...(s.them as NonNullable<TradeEvaluationCore["them"]>), helps: 0 } });
    const third = runRefilter(ctx, st, { minChance: 0.1 });
    expect(keys(listOf(third))).not.toContain(both.key);
    expect(keys(third.trades).includes(both.key)).toBe(keys(again.trades).includes(both.key));
  });
});

describe("re-filtering, determinism and the shown block at the ranking block's seasons", { timeout: 120_000 }, () => {
  it("re-filtering equals a fresh search, and simulates on the shown block only the trades no earlier list held", () => {
    const ctx = contextOf(40);
    const first = runTradeSearch(ctx, { settings: at(0.1) });
    const st = stateOf(first);
    const before = new Set(st.shownByKey.keys());
    const any = runRefilter(ctx, st, { minChance: 0 });
    expect(any).toEqual(runTradeSearch(ctx, { settings: at(0) }));
    // Every trade the lists at Any show is simulated on the shown block, once (shownByKey), and the 10% lists' trades weren't
    // simulated again (their runs are the very objects the first search made).
    const at10 = new Set(cardsOf(first).flatMap((t) => [t.key, ...(t.planB ? [t.planB.key] : [])]));
    const atAny = new Set(cardsOf(any).flatMap((t) => [t.key, ...(t.planB ? [t.planB.key] : [])]));
    for (const k of atAny) expect(st.shownByKey.has(k), k).toBe(true);
    const added = [...st.shownByKey.keys()].filter((k) => !before.has(k));
    expect(added.length).toBeGreaterThanOrEqual([...atAny].filter((k) => !at10.has(k)).length);
    expect(added.length).toBeGreaterThan(0); // a fact of the synthetic data: Any shows more
    for (const k of added) expect(at10.has(k), k).toBe(false);
    // And back: the first search's result, exactly, with no new run.
    const runs = st.shownByKey.size;
    expect(runRefilter(ctx, stateOf(any), { minChance: 0.1 })).toEqual(first);
    expect(st.shownByKey.size).toBe(runs);
  });

  it("progress: under the \"rank\" stage only moving forward, marked part \"shown\" while the pass plays the ideas out (\"offers\" while the merge works a ladder out, since Checkpoint 7f), ending done", () => {
    const progress: TradeSearchProgress[] = [];
    const league = smallLeague(23);
    const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
    runTradeSearch(ctx, { settings: at(0.1) }, (p) => progress.push(p));
    const rank = progress.filter((p) => p.stage === "rank");
    expect(rank[0]).toEqual({ stage: "rank", done: 0, total: 1 });
    const rest = rank.slice(1);
    expect(rest.length).toBeGreaterThan(1);
    // "offers" while the merge works a ladder out (Checkpoint 7f; search.merge.test.ts pins it on leagues that merge).
    for (const p of rest) {
      expect(["shown", "offers"]).toContain(p.part);
      expect(p.done).toBeLessThanOrEqual(p.total);
    }
    // The bar's share of the stage never goes back (the review's SHOWN-5: the pass restarted it at 0).
    for (let i = 1; i < rest.length; i++) {
      const a = rest[i - 1] as TradeSearchProgress;
      const b = rest[i] as TradeSearchProgress;
      expect(b.done / b.total, `step ${i}`).toBeGreaterThanOrEqual(a.done / a.total - 1e-12);
    }
    const last = rest.at(-1) as TradeSearchProgress;
    expect(last.done).toBe(last.total);
    expect(last.part).toBe("shown");
  });

  it("deterministic: the same search on a fresh context gives the same result", () => {
    const league = smallLeague(8);
    const fresh = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
    expect(runTradeSearch(fresh, { settings: at(0.1) })).toEqual(search(8));
  });

  describe("config.simulation.shownSims at finalSims: one block, Checkpoint 7d's search", () => {
    const simulation = config.simulation as { shownSims: number };
    const shownSims = simulation.shownSims;
    beforeAll(() => {
      simulation.shownSims = config.simulation.finalSims;
    });
    afterAll(() => {
      simulation.shownSims = shownSims;
    });

    it("the shown block is the ranking block (one baseline, one calibration), and the pass takes every card's ranking numbers as they are", () => {
      const league = smallLeague(23);
      const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
      const sim = tradeInternals(ctx).sim as SimState;
      expect(sim.blocks.shown).toBe(sim.blocks.final);
      expect(sim.rank.odds).toBe(sim.odds);
      expect(sim.rank.calibration).toBe(sim.calibration);
      expect(sim.rank.partners).toBe(sim.partners);
      const on = runTradeSearch(ctx, { settings: at(0.1) });
      const off = runTradeSearch(ctx, { settings: at(0.1), shownPass: false });
      expect({ ...on, counts: { ...on.counts, simShown: 0 } }).toEqual(off);
      const st = stateOf(on);
      for (const t of cardsOf(on)) {
        expect(t.sims, t.key).toBe(config.simulation.finalSims);
        expect(st.shownByKey.get(t.key), t.key).toBe(st.finalByKey.get(t.key));
      }
    });
  });
});
