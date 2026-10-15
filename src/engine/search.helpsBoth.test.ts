/**
 * Checkpoint 7c (planner reply to Checkpoint 7b, §7): the "Helps both" list of the trade search (search.ts finalistsOf's
 * extras, finish's second list; TradeSearchResult.helpsBoth). Every card helps both teams on its final numbers, in Helps-you
 * order, with the minimum chance and §13's caps; the extras are the top config.search.helpsBothFinalists screening trades
 * that help both, checked again on the final run; a card on both lists is one evaluation; no Plan B box names a card of a
 * list its card is on; the review's findings (HB-1 to HB-5): the Overall list is what it is without the second list, a card
 * that helps both falls back only on trades that help both and (since Checkpoint 7e, offers.ts) offers only such versions in
 * its "How to offer it", the list shows no filler of its own cards; a
 * lower minimum's suggestion; re-filtering equals a fresh search; one partner and must-include players. Checkpoint 7d
 * (planner reply to Checkpoint 7c, answer 2): the helps-both lane (search.ts helpsBothLaneOf), its condition, order, cap,
 * skipping, lean companions, one partner, must-include players, the report switch, that it changes nothing when no screened
 * trade qualifies, and that it never takes a final run another trade would have had (LANE-2, ENG-7D-1).
 * Synthetic leagues (trade.testing.ts smallLeague: made-up players, placeholder teams); which seeds show what is a fact of
 * the synthetic data, said where a test leans on it.
 */
import { describe, expect, it } from "vitest";
import { helpsBoth } from "./benefit";
import { config } from "./config";
import { analyzeTrade, assetValue, buildTradeContext, proposalKey, tradeInternals, tradeVersion, type Screened, type SimState, type TeamState, type TradeContext, type TradeInternals } from "./evaluate";
import { ladderCandidates, ladderJobOfSearch, offerLadderOfProposal, offerLadderOfSearch } from "./offers";
import { assetId, meetsMinChance, rankTrades } from "./rank";
import {
  atMostWaiverCredit,
  bothLineupsGain,
  buildPools,
  helpsBothLaneOf,
  helpsBothPoolOf,
  leanCompanions,
  partnerCandidates,
  rankCaps,
  runRefilter,
  runTradeSearch,
  screeningRules,
  searchStateOf,
  shortlistOf,
  type SearchState,
} from "./search";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { TradeAsset, TradeEvaluation, TradeEvaluationCore, TradeSearchResult } from "./tradeModel";

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
/**
 * A search (shared): the all-teams search at 10% fresh, another minimum re-filtered from it (a fresh search's result exactly:
 * the re-filtering test below and search.refilter.test.ts check it), a one-partner or settings variant fresh.
 */
function search(seed: number, minChance: number, opts: { partnerId?: string | null; settings?: Partial<TradeSettings> } = {}): TradeSearchResult {
  const key = `${seed}|${minChance}|${opts.partnerId ?? "all"}|${JSON.stringify(opts.settings ?? {})}`;
  let r = searches.get(key);
  if (!r) {
    const plain = !opts.partnerId && !opts.settings;
    r = plain && minChance !== 0.1 ? runRefilter(contextOf(seed), stateOf(search(seed, 0.1)), { minChance }) : runTradeSearch(contextOf(seed), { settings: at(minChance, opts.settings), partnerId: opts.partnerId ?? null });
    searches.set(key, r);
  }
  return r;
}
const stateOf = (r: TradeSearchResult) => searchStateOf(r) as SearchState;
const listOf = (r: TradeSearchResult): TradeEvaluation[] => r.helpsBoth?.trades ?? [];
const keys = (ts: readonly { key: string }[]) => ts.map((t) => t.key);
const given = (t: Pick<TradeEvaluation, "proposal">) => t.proposal.give.flatMap((a) => (a.kind === "player" ? [a.id] : []));

/** A side's highest-value asset (rank.ts's core rule: ties and unknown values to the smaller id). */
function coreOf(assets: readonly TradeAsset[], value: (a: TradeAsset) => number): string {
  let best = "";
  let v = Number.NEGATIVE_INFINITY;
  for (const a of assets) {
    const x = Number.isFinite(value(a)) ? value(a) : Number.NEGATIVE_INFINITY;
    const id = assetId(a);
    if (best === "" || x > v || (x === v && id < best)) {
      best = id;
      v = x;
    }
  }
  return best;
}

/** Hidden by default at these numbers (§10 guards): B ≤ 0 or unknown, or the market guard. */
const hidden = (c: Pick<TradeEvaluationCore, "b" | "flags">) => c.b === null || !(c.b > 0) || c.flags.hiddenByMarket;

const SEEDS = [8, 11, 23, 58, 67];

describe("the “Helps both” list (TradeSearchResult.helpsBoth)", { timeout: 120_000 }, () => {
  it("every card helps both teams on its final numbers, in Helps-you order, at least the minimum chance as printed, within §13's caps", () => {
    let cards = 0;
    for (const seed of SEEDS) {
      for (const minChance of [0, 0.1, 0.3]) {
        const r = search(seed, minChance);
        const list = listOf(r);
        const st = stateOf(r);
        const value = assetValue(st.I);
        const label = `seed ${seed} at ${minChance}`;
        expect(r.helpsBoth, label).toBeDefined();
        expect(list.length, label).toBeLessThanOrEqual(config.search.resultsShown);
        expect(r.helpsBoth?.qualifying ?? 0, label).toBeGreaterThanOrEqual(list.length);
        const finals = new Map(st.finals.map((c) => [c.key, c]));
        for (const t of list) {
          expect(t.stage, `${label} ${t.key}`).toBe("final");
          expect(finals.has(t.key), `${label} ${t.key}`).toBe(true);
          expect(helpsBoth(t), `${label} ${t.key}`).toBe(true);
          // Helps you at least the minimum too (planner reply to Checkpoint 7c, answer 5: above 0 at Checkpoint 7c).
          expect(t.tradeScore as number, `${label} ${t.key}`).toBeGreaterThanOrEqual(config.benefit.helpsThemMin);
          expect(t.them?.helps as number, `${label} ${t.key}`).toBeGreaterThanOrEqual(config.benefit.helpsThemMin);
          expect(meetsMinChance(t.pComplete, minChance), `${label} ${t.key}`).toBe(true);
          expect(t.flags.hiddenByMarket, `${label} ${t.key}`).toBe(false);
        }
        for (let i = 1; i < list.length; i++) expect((list[i] as TradeEvaluation).b as number, label).toBeLessThanOrEqual((list[i - 1] as TradeEvaluation).b as number);
        expect(new Set(keys(list)).size, label).toBe(list.length);
        // §13's caps in the list's own order: partner and given player in the top 20, core over the list.
        const top = list.slice(0, config.ranking.partnerCapTop);
        const count = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
        for (const n of count(top.map((t) => t.proposal.partnerId)).values()) expect(n, label).toBeLessThanOrEqual(config.ranking.perPartnerInTop20);
        for (const n of count(top.flatMap(given)).values()) expect(n, label).toBeLessThanOrEqual(config.ranking.perGivenPlayerInTop20);
        for (const n of count(list.map((t) => `${coreOf(t.proposal.give, value)}|${coreOf(t.proposal.get, value)}`)).values()) expect(n, label).toBeLessThanOrEqual(config.ranking.perCore);
        // The minimum's hidden count for this list: the finalists that help both, pass the guards and miss the minimum.
        const under = st.finals.filter((c) => !hidden(c) && helpsBoth(c) && !meetsMinChance(c.pComplete, minChance)).length;
        expect(r.helpsBoth?.byChance, label).toBe(under);
        cards += list.length;
      }
    }
    expect(cards).toBeGreaterThan(0); // a fact of the synthetic data: the check isn't empty
  });

  it("the extras: the first helpsBothFinalists exact trades by B on the screening block that help both and aren't hidden join the final simulation (since Checkpoint 7d one more for each from the helps-both lane: LANE-2)", () => {
    let extras = 0;
    let widened = 0;
    for (const seed of [...SEEDS, 77]) {
      const r = search(seed, 0.1);
      const st = stateOf(r);
      const screened = [...st.exactByKey.keys()].map((k) => st.versions.get(k)?.screen as TradeEvaluationCore);
      const lane = new Set([...st.lane.trades, ...st.lane.companions]);
      const candidates = screened.filter((c) => !hidden(c) && helpsBoth(c)).sort((a, b) => (b.b as number) - (a.b as number) || (a.key < b.key ? -1 : 1));
      const fromLane = candidates.filter((c) => lane.has(c.key)).length;
      widened += fromLane;
      const top = candidates.slice(0, config.search.helpsBothFinalists + fromLane);
      // The search's own pool holds the same trades (helpsBothPoolOf: trade-report's section 10 counts it; ties on B go by EG
      // there, by the key here).
      expect(keys(helpsBothPoolOf(screened, lane).pool).sort(), `seed ${seed}`).toEqual(keys(top).sort());
      const finals = new Set(keys(st.finals));
      for (const c of top) expect(finals.has(c.key), `seed ${seed} ${c.key}`).toBe(true);
      // The extras: the pool's trades the ranking hadn't picked, then (Checkpoint 7d, ENG-7D-1) the finalists the lane
      // displaced, outside the pool (the lane test below).
      const topKeys = new Set(keys(top));
      const poolExtras = st.helpsBothExtras.slice(0, st.helpsBothExtras.length - st.laneDisplaced.length);
      expect(st.helpsBothExtras.slice(poolExtras.length), `seed ${seed}`).toEqual(st.laneDisplaced);
      for (const k of poolExtras) expect(topKeys.has(k), `seed ${seed} ${k}`).toBe(true);
      for (const k of st.laneDisplaced) expect(topKeys.has(k), `seed ${seed} ${k}`).toBe(false);
      // The finalists the ranking picked, then the extras: at most finalists of the former, and every final simulated once.
      expect(st.finals.length - st.helpsBothExtras.length, `seed ${seed}`).toBeLessThanOrEqual(config.search.finalists);
      expect(r.counts.simFinal, `seed ${seed}`).toBe(st.finals.length);
      expect(finals.size, `seed ${seed}`).toBe(st.finals.length);
      extras += st.helpsBothExtras.length;
    }
    expect(extras).toBeGreaterThan(0); // a fact of the synthetic data
    expect(widened).toBeGreaterThan(0); // a fact of the synthetic data: the lane's room is tested
  });

  it("re-checked on the final run: an extra that doesn't help both on its final numbers stays off the list (smallLeague(13))", () => {
    // smallLeague(13) with Checkpoint 7d's bar (Helps you at least 10 too) and its helps-both lane: 8 of its 22 extras (the one
    // finalist the lane displaced among them) don't help both on the final run.
    const r = search(13, 0.1);
    const st = stateOf(r);
    const out = st.finals.filter((c) => st.helpsBothExtras.includes(c.key) && !helpsBoth(c));
    expect(out.length).toBeGreaterThan(0); // a fact of the synthetic data
    for (const c of out) expect(keys(listOf(r))).not.toContain(c.key);
  });

  it("one evaluation per card: a card on both lists is the very same object (one set of steps, one Plan B, one set of words)", () => {
    let shared = 0;
    for (const seed of SEEDS) {
      for (const minChance of [0, 0.1]) {
        const r = search(seed, minChance);
        for (const t of listOf(r)) {
          const same = r.trades.find((x) => x.key === t.key);
          if (!same) continue;
          shared++;
          expect(t, `seed ${seed} ${t.key}`).toBe(same);
        }
      }
    }
    expect(shared).toBeGreaterThan(0); // a fact of the synthetic data
  });

  it("no Plan B box names a card of a list its card is on; ⚠️ an Overall card's box may be a card only the “Helps both” list shows (HB-2: the page shows one list at a time)", () => {
    let boxes = 0;
    let otherList = 0;
    for (const seed of [...SEEDS, 40]) {
      for (const minChance of [0, 0.1]) {
        const r = search(seed, minChance);
        const lists = [r.trades, listOf(r)];
        // (Until Checkpoint 7e nor a version its list's steps showed: the cards carry no steps since.)
        const bars = lists.map((list) => new Set(keys(list)));
        for (const c of new Set([...r.trades, ...listOf(r)])) {
          if (!c.planB) continue;
          boxes++;
          lists.forEach((list, i) => {
            if (list.includes(c)) expect(bars[i]?.has(c.planB?.key as string), `seed ${seed} ${c.key} → ${c.planB?.key}`).toBe(false);
          });
          if (!listOf(r).includes(c) && keys(listOf(r)).includes(c.planB.key)) otherList++;
          expect(c.planB.proposal.partnerId).toBe(c.proposal.partnerId);
          // No card carries steps (Checkpoint 7e: "How to offer it" is worked out when it's opened, offers.ts).
          expect(c.steps).toBeUndefined();
        }
      }
    }
    expect(boxes).toBeGreaterThan(0); // a fact of the synthetic data
    expect(otherList).toBeGreaterThan(0); // smallLeague(40): a fact of the synthetic data
  });

  it("⚠️ the Overall list is what it is without the second list (HB-2, HB-5): with every partner's scale unknown, so that no trade helps both, the same cards, boxes, words, `few`, pattern note and counts but the final runs", () => {
    let wouldEnter = 0;
    for (const seed of [8, 12, 13, 40]) {
      const r = search(seed, 0.1);
      const st = stateOf(r);
      // Only the second list ranks the extras.
      for (const t of r.trades) expect(st.helpsBothExtras, `seed ${seed}`).not.toContain(t.key);
      // ... which the Overall ranking would otherwise have kept (smallLeague(8), (12) and (13): facts of the synthetic data).
      const every = rankTrades(st.finals.map((c) => ({ ...c, reasons: [], pitch: "" })), assetValue(st.I), rankCaps({ relaxed: false, onePartner: false }), { minChance: 0.1 });
      wouldEnter += every.trades.filter((t) => st.helpsBothExtras.includes(t.key)).length;
      // The same league with no partner's calibration run: Helps them unknown everywhere, no extras, an empty second list.
      const league = smallLeague(seed);
      const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
      const sim = tradeInternals(ctx).sim as SimState;
      // On both blocks (Checkpoint 7e: the ranking block's runs score the search's choice, the shown block's the cards).
      for (const t of tradeInternals(ctx).teams) for (const runs of [sim.partners, sim.rank.partners]) runs.set(t.id, null);
      const plain = runTradeSearch(ctx, { settings: at(0.1) });
      expect(listOf(plain), `seed ${seed}`).toEqual([]);
      expect(stateOf(plain).helpsBothExtras, `seed ${seed}`).toEqual([]);
      // The final runs, and the shown pass's count (the second list's cards are shown too), are the second list's own.
      const strip = (x: TradeSearchResult) => ({ ...x, trades: x.trades.map(({ them: _them, ...t }) => (void _them, t)), counts: { ...x.counts, simFinal: 0, simShown: 0 }, helpsBoth: undefined });
      expect(strip(r), `seed ${seed}`).toEqual(strip(plain));
    }
    expect(wouldEnter).toBeGreaterThan(0);
  });

  it("⚠️ a card that helps both teams, on either list, has a box that helps both (HB-4) and since Checkpoint 7e offers only versions that help both in its “How to offer it” (HB-1, offers.ts); smallLeague(20): the rule keeps a card's lean version out", () => {
    let tagged = 0;
    for (const seed of [...SEEDS, 20, 32, 36]) {
      for (const minChance of [0, 0.1]) {
        const r = search(seed, minChance);
        const st = stateOf(r);
        for (const c of new Set([...r.trades, ...listOf(r)])) {
          if (!helpsBoth(c)) continue;
          tagged++;
          if (c.planB) expect(helpsBoth(st.finalByKey.get(c.planB.key) as TradeEvaluationCore), `seed ${seed} ${c.key} → ${c.planB.key}`).toBe(true);
          for (const s of offerLadderOfSearch(r, c.key)?.steps ?? []) expect(helpsBoth(s.evaluation), `seed ${seed} ${c.key}: ${s.kind} ${s.evaluation.key}`).toBe(true);
        }
      }
    }
    expect(tagged).toBeGreaterThan(0);
    // smallLeague(20): a card that helps both whose lean version helps me but not them (a fact of the synthetic data): the
    // steps' case 1 offered it first until Checkpoint 7c's HB-1; the ladder never offers it. The Analyzer says the same.
    const r = search(20, 0.1);
    const st = stateOf(r);
    const settings = at(0.1);
    let found: { card: TradeEvaluation; lean: string } | null = null;
    for (const t of listOf(r)) {
      const lean = ladderCandidates(ladderJobOfSearch(st, t)).find((x) => x.kind === "lean");
      if (!lean) continue;
      const v = tradeVersion(st.I, lean.proposal, { settings, maxPerSide: settings.maxPerSide, versions: st.versions });
      if (v && (v.screen.b as number) > 0 && !helpsBoth(v.screen)) {
        found = { card: t, lean: lean.key };
        break;
      }
    }
    expect(found).not.toBeNull();
    const { card: c, lean } = found as { card: TradeEvaluation; lean: string };
    expect(c.steps).toBeUndefined();
    expect((offerLadderOfSearch(r, c.key)?.steps ?? []).map((s) => s.evaluation.key)).not.toContain(lean);
    const a = analyzeTrade(contextOf(20), c.proposal, { settings }).evaluation as TradeEvaluation;
    expect(helpsBoth(a)).toBe(true);
    expect(a.steps).toBeUndefined();
    for (const s of offerLadderOfProposal(contextOf(20), c.proposal, { settings }).steps) {
      expect(helpsBoth(s.evaluation), s.evaluation.key).toBe(true);
      expect(s.evaluation.key).not.toBe(lean);
    }
    // The pitch names the card's own trade: every player of mine in it, the throw-in too.
    for (const id of given(c)) expect(c.pitch, id).toContain(st.I.snapshot.players[id]?.name as string);
  });

  it("⚠️ the list shows no card that is filler of another card it shows, judged as the Overall order does (HB-3); smallLeague(12): a variant ahead by B leaves for its smaller trade", () => {
    const sub = (a: Pick<TradeEvaluation, "proposal">, b: Pick<TradeEvaluation, "proposal">) => {
      const ids = (t: Pick<TradeEvaluation, "proposal">) => new Set([...t.proposal.give.map((x) => `g:${assetId(x)}`), ...t.proposal.get.map((x) => `r:${assetId(x)}`)]);
      const x = ids(a);
      const y = ids(b);
      return a.proposal.partnerId === b.proposal.partnerId && x.size < y.size && [...x].every((v) => y.has(v));
    };
    const f = config.ranking.fillerCutoffFraction;
    const filler = (big: TradeEvaluationCore, small: TradeEvaluationCore) =>
      sub(small, big) && (Math.abs((big.b as number) - (small.b as number)) < f * (small.b as number) || ((big.b as number) <= (small.b as number) && big.pComplete < small.pComplete)) && (big.b as number) * big.pComplete < (small.b as number) * small.pComplete;
    let aheadByB = 0;
    for (const seed of [...SEEDS, 12]) {
      for (const minChance of [0, 0.1]) {
        const r = search(seed, minChance);
        const list = listOf(r);
        for (const big of list) for (const small of list) expect(big !== small && filler(big, small), `seed ${seed} ${big.key} / ${small.key}`).toBe(false);
        // A finalist that qualifies for the list, ahead of a card of it by B, left off as its filler.
        for (const big of stateOf(r).finals) {
          if (list.some((t) => t.key === big.key) || hidden(big) || !helpsBoth(big) || !meetsMinChance(big.pComplete, minChance)) continue;
          if (list.some((small) => filler(big, small) && (big.b as number) > (small.b as number))) aheadByB++;
        }
      }
    }
    expect(aheadByB).toBeGreaterThan(0); // smallLeague(12): a fact of the synthetic data
  });

  it("lowerWouldAdd: the same finalists at Any would show more trades that help both; never at Any (smallLeague(31) at 10%)", () => {
    let suggested = 0;
    for (const seed of [...SEEDS, 31]) {
      const any = runRefilter(contextOf(seed), stateOf(search(seed, 0.1)), { minChance: 0 });
      expect(any.helpsBoth?.lowerWouldAdd, `seed ${seed} at Any`).toBe(false);
      for (const minChance of [0.1, 0.3, 0.5]) {
        const r = runRefilter(contextOf(seed), stateOf(search(seed, 0.1)), { minChance });
        const more = listOf(any).length > listOf(r).length;
        expect(r.helpsBoth?.lowerWouldAdd, `seed ${seed} at ${minChance}`).toBe(more);
        if (more) suggested++;
      }
    }
    expect(suggested).toBeGreaterThan(0); // a fact of the synthetic data
    // 4 under the minimum since Checkpoint 7d's helps-both lane (1 before): 3 of the lane's trades that help both are long
    // shots here, 2% to 5%, and "Helps both" extras.
    expect(search(31, 0.1).helpsBoth).toMatchObject({ lowerWouldAdd: true, byChance: 4 });
  });

  it("re-filtering at another minimum gives exactly a fresh search's result, the “Helps both” list included", () => {
    for (const seed of [23, 31]) {
      const base = search(seed, 0.1);
      for (const minChance of [0, 0.3]) {
        const fresh = runTradeSearch(contextOf(seed), { settings: at(minChance) });
        expect(runRefilter(contextOf(seed), stateOf(base), { minChance }), `seed ${seed}: 0.1 → ${minChance}`).toEqual(fresh);
        expect(fresh.helpsBoth, `seed ${seed} at ${minChance}`).toEqual(search(seed, minChance).helpsBoth);
      }
    }
  });

  it("deterministic, and its result survives a structured clone (a worker's postMessage)", () => {
    const r = search(23, 0.1);
    expect(runTradeSearch(contextOf(23), { settings: at(0.1) })).toEqual(r);
    const copy = structuredClone(r);
    expect(copy).toEqual(r);
    // A card on both lists stays one object within the message.
    const shared = listOf(copy).find((t) => copy.trades.includes(t));
    if (listOf(r).some((t) => r.trades.includes(t))) expect(shared).toBeDefined();
  });

  it("one partner: only that partner's trades, no partner cap; must-include players of mine: in every card, outside the given-player cap", () => {
    const st = stateOf(search(23, 0.1));
    const partner = listOf(search(23, 0))[0]?.proposal.partnerId ?? st.I.teams.find((t) => t !== st.I.me)?.id;
    const one = search(23, 0, { partnerId: partner as string });
    for (const t of listOf(one)) expect(t.proposal.partnerId).toBe(partner);
    expect(one.helpsBoth?.dropped.partnerCap).toBe(0);
    // My player most often given in the all-teams list, made must-include.
    const counts = new Map<string, number>();
    for (const t of listOf(search(23, 0))) for (const id of given(t)) counts.set(id, (counts.get(id) ?? 0) + 1);
    const forced = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
    expect(forced).toBeDefined();
    const must = search(23, 0, { settings: { mustInclude: [forced as string] } });
    for (const t of listOf(must)) expect(given(t)).toContain(forced);
    for (const t of must.trades) expect(given(t)).toContain(forced);
  });

  it("an empty list is still a list (smallLeague(41): no trade helps both); a search stopped before ranking has none", () => {
    // Checkpoint 7f: `merged` counts the trades merged into another card (none here).
    expect(search(41, 0.1).helpsBoth).toEqual({ trades: [], qualifying: 0, byChance: 0, lowerWouldAdd: false, dropped: { partnerCap: 0, core: 0, filler: 0, givenPlayer: 0, merged: 0 } });
    const league = smallLeague(23);
    const none = runTradeSearch(buildTradeContext({ ...league.snapshot, myTeamId: null }, league.inputs, { now: TEST_NOW, scenarios: 0 }), { settings: at(0.1) });
    expect(none.helpsBoth).toBeUndefined();
  });

  it("each partner's calibration run is made once, before the screening simulation, for the partners of the exact trades", () => {
    const league = smallLeague(58);
    const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
    const I = tradeInternals(ctx);
    const sim = I.sim as SimState;
    expect(sim.partners.size).toBe(0);
    const r = runTradeSearch(ctx, { settings: at(0.1) });
    const partners = new Set([...stateOf(r).exactByKey.values()].map((x) => x.partner.id));
    expect(new Set(sim.partners.keys())).toEqual(partners);
    expect([...sim.partners.values()].every((run) => run !== null)).toBe(true);
    expect(partners.has((I.me as TeamState).id)).toBe(false);
    // Every simulated card carries its partner's numbers, scored on that partner's one scale.
    const scales = new Map<string, number>();
    for (const t of [...r.trades, ...listOf(r)]) {
      expect(t.them, t.key).toBeDefined();
      const b3 = t.them?.b3 as number;
      const seen = scales.get(t.proposal.partnerId);
      if (seen !== undefined) expect(b3, t.key).toBe(seen);
      scales.set(t.proposal.partnerId, b3);
    }
  });
});

function drain<T>(it: Generator<void, T, void>): T {
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/**
 * A search's helps-both lane rebuilt from its pieces, as the search makes it: every partner's candidates (buildPools,
 * partnerCandidates), the shortlist and its lean companions (shortlistOf, leanCompanions), then the lane (helpsBothLaneOf,
 * those taken) and its own lean companions.
 */
function laneRebuilt(I: TradeInternals, settings: TradeSettings, partnerId: string | null = null) {
  const pools = buildPools(I, settings, partnerId);
  const lists = pools.partners.map((p) => {
    const h = pools.get.get(p.id) as { pool: string[]; forced: string[] };
    return drain(partnerCandidates(I, p, { give: pools.give, forcedGive: pools.forcedGive, get: h.pool, forcedGet: h.forced }, settings.maxPerSide, { screened: 0 }));
  });
  const cheap = atMostWaiverCredit(I);
  const shortlist = shortlistOf(lists, cheap);
  const companions = drain(leanCompanions(I, shortlist, lists, pools));
  const taken = new Set(keys([...shortlist, ...companions]));
  const lane = helpsBothLaneOf(lists, taken, cheap);
  const laneCompanions = drain(leanCompanions(I, lane.trades, lists, pools, { screened: 0 }, taken));
  return { pools, lists, cheap, shortlist, companions, taken, lane, laneCompanions };
}

describe("the helps-both lane (Checkpoint 7d; planner reply to Checkpoint 7c, answer 2: search.ts helpsBothLaneOf)", { timeout: 120_000 }, () => {
  const asPlayers = (ids: readonly string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));
  /** A made-up screen with the search's key (proposalKey: each side sorted). */
  const screen = (partnerId: string, give: string[], get: string[], objective: number, myDelta: number, partnerDelta: number, gPartner = 0): Screened => ({
    key: proposalKey({ partnerId, give: asPlayers(give), get: asPlayers(get) }),
    partnerId,
    give,
    get,
    objective,
    myDelta,
    partnerDelta,
    pQuick: 0.5,
    gPartner,
  });

  it("config: up to 40 trades (the planner's number)", () => {
    expect(config.search.helpsBothLane).toBe(40);
  });

  it("helpsBothLaneOf: both lineups gain (above 0, float noise aside), inside the g window, past the dominance pruning, outside what's taken; best objective first, ties by key; at most `max` (0: none); the counts", () => {
    const [, hi] = config.search.screeningGWindow;
    const a = screen("2", ["a"], ["x"], 5, 10, 1.5);
    const b = screen("2", ["b"], ["x"], 7, 14, 0.2);
    const tieA = screen("3", ["c"], ["y"], 4, 8, 0.1);
    const tieB = screen("2", ["d"], ["y"], 4, 8, 0.1);
    const mineZero = screen("2", ["e"], ["x"], 0, 0, 2); // my ΔROS 0
    const theirsZero = screen("2", ["f"], ["x"], 3, 6, 0); // their lineup gains nothing
    const theirsNoise = screen("2", ["g"], ["x"], 3, 6, 1e-12); // float noise
    const theirsLoss = screen("3", ["h"], ["y"], 6, 12, -0.5); // their lineup loses
    const mineLoss = screen("3", ["n"], ["y"], -1, -2, 3); // mine loses
    const outside = screen("2", ["i"], ["x"], 9, 18, 2, hi + 0.01); // outside the g window
    const nan = screen("2", ["j"], ["x"], 9, 18, 2, Number.NaN);
    const taken = screen("3", ["k"], ["y"], 8, 16, 3); // on the shortlist already: counted, skipped
    // A variant with a player of mine worth at most W ("t…"), dominated by its lean version, which screened better.
    const lean = screen("3", ["m"], ["z"], 2, 4, 1);
    const variant = screen("3", ["m", "t1"], ["z"], 1.5, 3, 1.2);
    const cheap = (id: string) => id.startsWith("t");
    const lists = [
      [a, b, tieB, mineZero, theirsZero, theirsNoise, outside, nan],
      [tieA, theirsLoss, mineLoss, taken, lean, variant],
    ];
    const skip = new Set([taken.key]);
    const out = helpsBothLaneOf(lists, skip, cheap);
    // Ties on the objective by key: Team 2's before Team 3's.
    expect(tieB.key < tieA.key).toBe(true);
    expect(keys(out.trades)).toEqual(keys([b, a, tieB, tieA, lean]));
    expect(out).toMatchObject({ qualifying: 6, onShortlist: 1 });
    for (const x of [mineZero, theirsZero, theirsNoise, theirsLoss, mineLoss]) expect(bothLineupsGain(x), x.key).toBe(false);
    for (const x of [a, b, tieA, tieB, taken, lean, variant, outside]) expect(bothLineupsGain(x), x.key).toBe(true);
    // Screening's rules are the shortlist's own: the window, then the pruning (without it, null, the variant qualifies too).
    expect(keys(screeningRules(lists[1] as Screened[], cheap))).toEqual(keys([tieA, theirsLoss, mineLoss, taken, lean]));
    expect(keys(helpsBothLaneOf(lists, skip, null).trades)).toEqual(keys([b, a, tieB, tieA, lean, variant]));
    // At most max, the first by the objective; 0 or less: none, the counts still made.
    expect(keys(helpsBothLaneOf(lists, skip, cheap, 2).trades)).toEqual(keys([b, a]));
    expect(helpsBothLaneOf(lists, skip, cheap, 0)).toEqual({ trades: [], qualifying: 6, onShortlist: 1 });
    expect(helpsBothLaneOf(lists, skip, cheap, -3).trades).toEqual([]);
    // Nothing taken: the best qualifying trade leads.
    expect(helpsBothLaneOf(lists, new Set(), cheap).trades[0]?.key).toBe(taken.key);
    expect(helpsBothLaneOf([], skip, cheap)).toEqual({ trades: [], qualifying: 0, onShortlist: 0 });
  });

  it("in the search: helpsBothLaneOf on the search's own candidates, the shortlist and its companions taken, with the lane's own lean companions; evaluated exactly after them, then simulated like every exact trade", () => {
    let full = 0;
    let withCompanions = 0;
    for (const seed of [8, 23, 58]) {
      const r = search(seed, 0.1);
      const st = stateOf(r);
      const settings = at(0.1);
      const { lists, cheap, taken, lane, laneCompanions } = laneRebuilt(st.I, settings);
      expect(st.lane, `seed ${seed}`).toEqual({ trades: keys(lane.trades), companions: keys(laneCompanions), qualifying: lane.qualifying, onShortlist: lane.onShortlist });
      // Its condition and its cap: every qualifying trade outside what's taken, but for the cap, the lane's last no better than
      // any it leaves out.
      const outside = lists.flatMap((l) => screeningRules(l, cheap)).filter((x) => bothLineupsGain(x) && !taken.has(x.key));
      expect(lane.trades.length, `seed ${seed}`).toBe(Math.min(outside.length, config.search.helpsBothLane));
      expect(lane.qualifying - lane.onShortlist, `seed ${seed}`).toBe(outside.length);
      const last = lane.trades.at(-1) as Screened;
      for (const x of outside) if (!st.lane.trades.includes(x.key)) expect(x.objective, `seed ${seed} ${x.key}`).toBeLessThanOrEqual(last.objective + 1e-9);
      for (const x of lane.trades) expect(taken.has(x.key) || !bothLineupsGain(x), `seed ${seed} ${x.key}`).toBe(false);
      // Its companions are lean versions no trade chosen before brought.
      for (const k of st.lane.companions) expect(taken.has(k) || st.lane.trades.includes(k), `seed ${seed} ${k}`).toBe(false);
      // Evaluated exactly after the shortlist and its companions (the exact trades in evaluation order), each one simulated.
      const order = [...st.exactByKey.keys()];
      const fromLane = new Set([...st.lane.trades, ...st.lane.companions]);
      const firstLane = order.findIndex((k) => fromLane.has(k));
      expect(firstLane, `seed ${seed}`).toBeGreaterThan(0);
      expect(order.slice(firstLane).every((k) => fromLane.has(k)), `seed ${seed}`).toBe(true);
      for (const k of order) expect(st.versions.get(k)?.screen.key, `seed ${seed} ${k}`).toBe(k);
      expect(r.counts.simScreen, `seed ${seed}`).toBe(r.counts.exact);
      if (outside.length > config.search.helpsBothLane) full++;
      if (st.lane.companions.length) withCompanions++;
    }
    // Facts of the synthetic data: the cap binds (smallLeague(58)), and the lane brings lean companions (smallLeague(8), (23)).
    expect(full).toBeGreaterThan(0);
    expect(withCompanions).toBeGreaterThan(0);
  });

  it("then the same rules as every exact trade: the finalists' rules (so the Overall list too) and the “Helps both” extras", () => {
    const tally = { finalists: 0, extras: 0, list: 0, overall: 0 };
    for (const seed of [...SEEDS, 12]) {
      const r = search(seed, 0.1);
      const st = stateOf(r);
      const fromLane = new Set([...st.lane.trades, ...st.lane.companions]);
      const extras = new Set(st.helpsBothExtras);
      tally.finalists += st.finals.filter((c) => fromLane.has(c.key) && !extras.has(c.key)).length;
      tally.extras += st.helpsBothExtras.filter((k) => fromLane.has(k)).length;
      tally.list += listOf(r).filter((t) => fromLane.has(t.key)).length;
      tally.overall += r.trades.filter((t) => fromLane.has(t.key)).length;
    }
    // Facts of the synthetic data: the lane's trades are finalists, extras and cards of both lists.
    for (const [k, n] of Object.entries(tally)) expect(n, k).toBeGreaterThan(0);
  });

  it("the report switch (helpsBothLane false): the shortlist and its companions alone, the same screening; the qualifying trades still counted", () => {
    const on = search(23, 0.1);
    const off = runTradeSearch(contextOf(23), { settings: at(0.1), helpsBothLane: false });
    const s = stateOf(on);
    const so = stateOf(off);
    expect(s.lane.trades.length).toBeGreaterThan(0); // a fact of the synthetic data
    expect(so.lane).toEqual({ trades: [], companions: [], qualifying: s.lane.qualifying, onShortlist: s.lane.onShortlist });
    const fromLane = new Set([...s.lane.trades, ...s.lane.companions]);
    expect([...so.exactByKey.keys()]).toEqual([...s.exactByKey.keys()].filter((k) => !fromLane.has(k)));
    expect(off.counts.screened).toBe(on.counts.screened);
    expect(on.counts.exact).toBe(off.counts.exact + [...fromLane].filter((k) => s.exactByKey.has(k)).length);
    expect(so.companions).toEqual(s.companions);
  });

  it("never takes a final run another trade would have had: every trade the search without the lane simulates on the final block, its Helps them known, gets its final run with it (LANE-2: each lane trade widens the extras' room by one; ENG-7D-1: a finalist its trades push out keeps its final run, for the “Helps both” list only)", () => {
    let widened = 0;
    let displaced = 0;
    for (const seed of [...SEEDS, 12, 13, 42]) {
      const on = stateOf(search(seed, 0.1));
      const off = stateOf(runTradeSearch(contextOf(seed), { settings: at(0.1), helpsBothLane: false }));
      const finals = new Set(keys(on.finals));
      for (const c of off.finals) if (Number.isFinite(c.them?.helps)) expect(finals.has(c.key), `seed ${seed} ${c.key}`).toBe(true);
      // The displaced: finalists the ranking picked without the lane, not with it, ranked on the "Helps both" list only.
      const pickedOff = new Set(keys(off.finals).filter((k) => !off.helpsBothExtras.includes(k)));
      for (const k of on.laneDisplaced) {
        expect(pickedOff.has(k), `seed ${seed} ${k}`).toBe(true);
        expect(on.helpsBothExtras, `seed ${seed} ${k}`).toContain(k);
        expect(Number.isFinite(on.versions.get(k)?.screen.them?.helps), `seed ${seed} ${k}`).toBe(true);
      }
      expect(off.laneDisplaced, `seed ${seed}`).toEqual([]);
      if (on.helpsBothExtras.length - on.laneDisplaced.length > off.helpsBothExtras.length) widened++;
      displaced += on.laneDisplaced.length;
    }
    // Facts of the synthetic data: smallLeague(13) is the case LANE-2 found; the lane's trades displace finalists.
    expect(widened).toBeGreaterThan(0);
    expect(displaced).toBeGreaterThan(0);
    // smallLeague(42) (facts of the synthetic data; smallLeague(45) until Checkpoint 7e, whose automatic playoff weight, measured
    // on the shown block's 20,000 seasons, moved its finalists): the lane's trades take finalists' places, and one finalist they
    // push out helps both only on its final numbers (Helps them 3 on the screening run, 12 on the final one), so the "Helps
    // both" pool never held it. At 20%, where the lane's long shots are under the minimum, the list without the lane shows it,
    // at 30%; with its final run kept the list with the lane shows every card the list without it does.
    const on42 = stateOf(search(42, 0.1));
    const kept = on42.laneDisplaced.filter((k) => !helpsBoth(on42.versions.get(k)?.screen as TradeEvaluationCore) && helpsBoth(on42.finals.find((c) => c.key === k) as TradeEvaluationCore));
    expect(kept).toHaveLength(1);
    const off42 = runTradeSearch(contextOf(42), { settings: at(0.2), helpsBothLane: false });
    const on20 = runRefilter(contextOf(42), on42, { minChance: 0.2 });
    expect(keys(listOf(off42))).toContain(kept[0]);
    for (const t of listOf(off42)) expect(keys(listOf(on20)), t.key).toContain(t.key);
    // The Overall list keeps to the ranking's finalists: the displaced finalist isn't a card of it.
    expect(keys(on20.trades)).not.toContain(kept[0]);
  });

  it("changes nothing when no screened trade qualifies outside the shortlist: the same result as without the lane", () => {
    // smallLeague(8) with Team 3: no screened trade gains both lineups; with Team 6, and smallLeague(23) with Team 5 one a
    // side, every one that does is on the shortlist already (facts of the synthetic data).
    const cases = [
      { seed: 8, partnerId: "3", maxPerSide: 2, qualifying: 0 },
      { seed: 8, partnerId: "6", maxPerSide: 2, qualifying: 2 },
      { seed: 23, partnerId: "5", maxPerSide: 1, qualifying: 5 },
    ];
    for (const c of cases) {
      const settings = at(0.1, { maxPerSide: c.maxPerSide });
      const r = runTradeSearch(contextOf(c.seed), { settings, partnerId: c.partnerId });
      const st = stateOf(r);
      expect(st.lane, `seed ${c.seed} Team ${c.partnerId}`).toEqual({ trades: [], companions: [], qualifying: c.qualifying, onShortlist: c.qualifying });
      expect(runTradeSearch(contextOf(c.seed), { settings, partnerId: c.partnerId, helpsBothLane: false }), `seed ${c.seed} Team ${c.partnerId}`).toEqual(r);
    }
    // The last one shows a card that helps both: the lane had nothing to add to it.
    expect(listOf(runTradeSearch(contextOf(23), { settings: at(0.1, { maxPerSide: 1 }), partnerId: "5" })).length).toBeGreaterThan(0);
  });

  it("one partner: the lane holds that partner's trades only, chosen among its own candidates", () => {
    const settings = at(0.1);
    const r = runTradeSearch(contextOf(23), { settings, partnerId: "2" });
    const st = stateOf(r);
    const { lane, laneCompanions } = laneRebuilt(st.I, settings, "2");
    expect(st.lane.trades.length).toBeGreaterThan(0); // a fact of the synthetic data
    expect(st.lane.trades).toEqual(keys(lane.trades));
    expect(st.lane.companions).toEqual(keys(laneCompanions));
    for (const x of [...lane.trades, ...laneCompanions]) expect(x.partnerId).toBe("2");
    for (const k of st.exactByKey.keys()) expect(st.exactByKey.get(k)?.partner.id).toBe("2");
  });

  it("must-include players of mine: every trade of the lane and its companions gives them", () => {
    const st23 = stateOf(search(23, 0.1));
    // The player of mine the all-teams lane gives most often (ties: the smaller id).
    const counts = new Map<string, number>();
    for (const k of st23.lane.trades) for (const id of st23.exactByKey.get(k)?.evaluation.proposal.give.flatMap((a) => (a.kind === "player" ? [a.id] : [])) ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    const forced = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] as string;
    expect(forced).toBeDefined();
    const settings = at(0.1, { mustInclude: [forced] });
    const r = runTradeSearch(contextOf(23), { settings });
    const st = stateOf(r);
    const { lane, laneCompanions } = laneRebuilt(st.I, settings);
    expect(st.lane.trades).toEqual(keys(lane.trades));
    expect(st.lane.companions).toEqual(keys(laneCompanions));
    expect(lane.trades.length).toBeGreaterThan(0); // a fact of the synthetic data
    for (const x of [...lane.trades, ...laneCompanions]) expect(x.give, x.key).toContain(forced);
    for (const t of [...r.trades, ...listOf(r)]) expect(given(t)).toContain(forced);
  });

  it("deterministic: a fresh context gives the same lane and result; a re-filter keeps the search's lane and equals a fresh search", () => {
    const league = smallLeague(58);
    const fresh = runTradeSearch(buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 }), { settings: at(0.1) });
    const r = search(58, 0.1);
    expect(fresh).toEqual(r);
    expect(stateOf(fresh).lane).toEqual(stateOf(r).lane);
    const again = runRefilter(contextOf(58), stateOf(r), { minChance: 0.3 });
    expect(stateOf(again).lane).toEqual(stateOf(r).lane);
    expect(again).toEqual(runTradeSearch(contextOf(58), { settings: at(0.3) }));
  });
});
