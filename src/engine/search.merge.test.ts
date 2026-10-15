/**
 * Merged cards (Checkpoint 7f; planner reply to Checkpoint 7e, decision 3: "When one card's offer list contains another card's
 * trade, merge them: Keep only the card with the higher Overall in the list. The other trade appears only inside that card's
 * offer list. Fill the freed slot with the next idea, under the usual diversity rules."; search.ts, "Merged cards"), on
 * synthetic leagues that merge (smallLeague: made-up players, placeholder teams; which seeds merge is a fact of the synthetic
 * data): each merged trade is an offer of a card above it on its list and no card or box of that list; no card's offers hold a
 * card of its list below it; each list is the finalists ranked by hand without the merged trades, which the filler rule reads
 * as kept (rank.ts RankOptions.shownElsewhere), then ranked again on the numbers its cards print; a re-filter equals a fresh
 * search at both minimums; TradeSearchOptions.mergeCards false gives Checkpoint 7e's lists, worked out by hand the same way
 * (until Checkpoint 7e search.fold.test.ts: the folding of cards whose steps named another card, gone with the steps); the
 * ladder the search kept for a card is the one worked out on demand from its state and from its trade on a fresh context, its
 * offers' versions evaluated in the key's order or in another (the review of the merge, MERGE-4), deep-equal; and the "rank"
 * stage's progress ends at its own count, every unit done, reading part "offers" while the merge works a ladder out.
 * search.merge.release.test.ts drives the release rule (a merged trade given back), which no search here takes.
 */
import { describe, expect, it } from "vitest";
import { helpsBoth } from "./benefit";
import { assetValue, buildTradeContext, evaluateExact, rewardFor, simulateTrade, tradeInternals, type TradeContext } from "./evaluate";
import { buildOfferLadder, ladderJobOfProposal, ladderJobOfSearch, offerLadderOfProposal, offerLadderOfSearch, type LadderJob } from "./offers";
import { compareOverall, rankTrades } from "./rank";
import { rankCaps, runRefilter, runTradeSearch, searchStateOf, type SearchState } from "./search";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { MergedTrade, OfferLadder, TradeEvaluation, TradeEvaluationCore, TradeSearchProgress, TradeSearchResult } from "./tradeModel";

const bare = (c: TradeEvaluationCore): TradeEvaluation => ({ ...c, reasons: [], pitch: "" });
const at = (minChance: number): TradeSettings => ({ ...defaultTradeSettings(), minChance });
const keysOf = (ts: readonly { key: string }[]) => ts.map((t) => t.key);

/** The leagues that merge (smallLeague seed, teams, the minimum chance), 8 availability scenarios. */
const LEAGUES = [
  { seed: 48, teams: 6, minChance: 0.1 },
  { seed: 57, teams: 6, minChance: 0.1 },
  { seed: 59, teams: 6, minChance: 0.1 },
  { seed: 8, teams: 12, minChance: 0 },
];

const contexts = new Map<string, TradeContext>();
function contextOf(seed: number, teams: number): TradeContext {
  const key = `${seed}|${teams}`;
  let ctx = contexts.get(key);
  if (!ctx) {
    const league = smallLeague(seed, {}, teams);
    ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
    contexts.set(key, ctx);
  }
  return ctx;
}

/** Each list with its merged trades (TradeSearchResult.merged). */
const listsOf = (r: TradeSearchResult): { name: string; cards: TradeEvaluation[]; merged: MergedTrade[] }[] => [
  { name: "overall", cards: r.trades, merged: r.merged?.overall ?? [] },
  { name: "helpsBoth", cards: r.helpsBoth?.trades ?? [], merged: r.merged?.helpsBoth ?? [] },
];

/** No card's offers hold a card of its list below it on Overall (one above it, the holder below, stays: policy (a)). */
function expectNoneBelowHeld(r: TradeSearchResult, where: string): number {
  let above = 0;
  for (const list of listsOf(r)) {
    const cards = new Map(list.cards.map((t) => [t.key, t]));
    for (const c of list.cards) {
      for (const s of (offerLadderOfSearch(r, c.key) as OfferLadder).steps) {
        const other = s.kind === "suggested" ? undefined : cards.get(s.evaluation.key);
        if (!other) continue;
        expect(compareOverall(other, c), `${where} ${list.name} ${c.key} ${s.kind} ${other.key}`).toBeLessThan(0);
        above++;
      }
    }
  }
  return above;
}

/**
 * Both lists by hand from a search's state (search.ts finish): the finalists ranked on the ranking block (the Overall list
 * without the "Helps both" extras; the "Helps both" list in Helps-you order, the trades that help both), without `merged`'s
 * trades, which the filler rule reads as kept, then ranked again on the numbers the cards print.
 */
function byHand(st: SearchState, minChance: number, merged: { overall: readonly string[]; helpsBoth: readonly string[] }): { overall: string[]; helpsBoth: string[] } {
  const value = assetValue(st.I);
  const caps = rankCaps({ relaxed: false, onePartner: st.onePartner });
  const extras = new Set(st.helpsBothExtras);
  const all = st.finals.map(bare);
  const printed = (t: TradeEvaluation) => bare(st.shownByKey.get(t.key) ?? t);
  const list = (pool: TradeEvaluation[], gone: readonly string[], opts: Parameters<typeof rankTrades>[3]) => {
    const out = new Set(gone);
    const elsewhere = all.filter((t) => out.has(t.key));
    const ranking = rankTrades(
      pool.filter((t) => !out.has(t.key)),
      value,
      caps,
      { ...opts, shownElsewhere: elsewhere },
    );
    return keysOf(rankTrades(ranking.trades.map(printed), value, caps, { ...opts, shownElsewhere: elsewhere.map(printed) }).trades);
  };
  const base = { minChance, givenCapExempt: st.forcedGive };
  return {
    overall: list(
      all.filter((t) => !extras.has(t.key)),
      merged.overall,
      base,
    ),
    helpsBoth: list(all, merged.helpsBoth, { ...base, order: "helps", keep: (t) => helpsBoth(t) }),
  };
}

describe("merged cards (Checkpoint 7f; planner reply to Checkpoint 7e, decision 3)", { timeout: 600_000 }, () => {
  for (const lg of LEAGUES) {
    it(`smallLeague(${lg.seed}, ${lg.teams} teams) at ${lg.minChance ? `${100 * lg.minChance}%` : "Any"}: each merged trade an offer of a card above it, no card holding a card below it, the lists by hand, re-filters, the switch, the kept ladders`, () => {
      const ctx = contextOf(lg.seed, lg.teams);
      const progress: TradeSearchProgress[] = [];
      const r = runTradeSearch(ctx, { settings: at(lg.minChance) }, (p) => progress.push(p));
      const st = searchStateOf(r) as SearchState;
      const merged = r.merged;
      if (!merged) throw new Error("no merge");
      // 0. Progress: the "rank" stage's bar never goes back though later rounds and the ladders' steps add units (each one
      // counted as planned and done at once), and ends done: its last event is the count itself, since a card the rounds took
      // off its list left its Plan B's unit out of the total (the review of the merge: the bar stood at 79 of 82 before a last
      // event set it done). While the merge works a ladder out the bar reads part "offers" (the review of the speed track:
      // it read "shown", the ideas being played out); otherwise "shown", the pass having a block of its own.
      const rank = progress.filter((p) => p.stage === "rank");
      for (let i = 1; i < rank.length; i++) {
        const a = rank[i - 1] as TradeSearchProgress;
        const b = rank[i] as TradeSearchProgress;
        expect(b.done / b.total, `${lg.seed} step ${i}`).toBeGreaterThanOrEqual(a.done / a.total - 1e-12);
      }
      const last = rank.at(-1) as TradeSearchProgress;
      expect(last.done).toBe(last.total);
      expect(last.part).toBe("shown");
      for (const p of rank.slice(1)) expect(["shown", "offers"]).toContain(p.part);
      expect(rank.some((p) => p.part === "offers"), `${lg.seed}: a ladder worked out`).toBe(true); // a fact of the synthetic data
      // Something merged (a fact of the synthetic data) and nothing given back; the counts.
      expect(merged.overall.length + merged.helpsBoth.length).toBeGreaterThan(0);
      expect(merged.released).toBe(0);
      expect(r.dropped?.merged).toBe(merged.overall.length);
      expect(r.helpsBoth?.dropped.merged).toBe(merged.helpsBoth.length);
      expect(st.ladders?.size).toBeLessThanOrEqual(merged.ladders);

      // 1. Each merged trade is an offer of its card, which is on the list above it with its ladder kept, and no card or box
      // of the list.
      for (const list of listsOf(r)) {
        const cards = new Map(list.cards.map((t) => [t.key, t]));
        for (const m of list.merged) {
          const w = `${list.name} ${m.key} into ${m.into}`;
          const keeper = cards.get(m.into);
          expect(keeper, w).toBeDefined();
          expect(st.ladders?.has(m.into), w).toBe(true);
          const step = (offerLadderOfSearch(r, m.into) as OfferLadder).steps.find((s) => s.evaluation.key === m.key);
          expect(step?.kind, w).toBe(m.kind);
          expect(compareOverall(keeper as TradeEvaluation, step?.evaluation as TradeEvaluation), w).toBeLessThan(0);
          expect(cards.has(m.key), w).toBe(false);
          // No box is it, nor one it matches or beats on both numbers as printed (planB.ts dominatedByCard reads it as a card).
          const printed = st.shownByKey.get(m.key) as TradeEvaluationCore;
          for (const c of list.cards) {
            const box = c.planB;
            if (!box) continue;
            expect(box.key, w).not.toBe(m.key);
            if (box.proposal.partnerId === printed.proposal.partnerId) expect((printed.tradeScore as number) >= box.tradeScore && printed.pComplete >= box.pComplete - 1e-9, `${w}: box ${box.key}`).toBe(false);
          }
        }
      }
      // 2. No card's offers hold a card of its list below it.
      expectNoneBelowHeld(r, `${lg.seed}`);
      // 3. Each list by hand: the finalists without the merged trades (filler references), ranked again as printed.
      const hand = byHand(st, lg.minChance, { overall: keysOf(merged.overall), helpsBoth: keysOf(merged.helpsBoth) });
      expect(keysOf(r.trades)).toEqual(hand.overall);
      expect(keysOf(r.helpsBoth?.trades ?? [])).toEqual(hand.helpsBoth);
      // The merged trades qualified (each was a card), so they count among the qualifying ones, as without the merge.
      const plain = runTradeSearch(ctx, { settings: at(lg.minChance), mergeCards: false });
      expect(r.filter?.qualifying).toBe(plain.filter?.qualifying);
      expect(r.helpsBoth?.qualifying).toBe(plain.helpsBoth?.qualifying);

      // 4. A re-filter equals a fresh search at both minimums, its kept ladders too (there and back).
      const other = lg.minChance === 0 ? 0.1 : 0;
      const there = runRefilter(ctx, st, { minChance: other });
      expect(there).toEqual(runTradeSearch(ctx, { settings: at(other) }));
      const back = runRefilter(ctx, searchStateOf(there) as SearchState, { minChance: lg.minChance });
      expect(back).toEqual(r);
      expect(searchStateOf(back)?.ladders).toEqual(st.ladders);

      // 5. The switch off: Checkpoint 7e's lists, by hand with nothing merged, and nothing said of a merge.
      const unmerged = byHand(searchStateOf(plain) as SearchState, lg.minChance, { overall: [], helpsBoth: [] });
      expect(keysOf(plain.trades)).toEqual(unmerged.overall);
      expect(keysOf(plain.helpsBoth?.trades ?? [])).toEqual(unmerged.helpsBoth);
      expect(plain.merged).toBeUndefined();
      expect(plain.dropped && "merged" in plain.dropped).toBe(false);
      expect(searchStateOf(plain)?.ladders?.size).toBe(0);

      // 6. Each kept ladder is the one worked out on demand from the state and from the card's trade on a fresh context, and
      // (the review of the merge, MERGE-4) on a fresh context whose versions of its offers were evaluated in another order,
      // each side's players reversed: deep-equal, every offer's per-player facts in its own order (evaluate.ts coreInOrder).
      const league = smallLeague(lg.seed, {}, lg.teams);
      const fresh = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
      const cards = [...r.trades, ...(r.helpsBoth?.trades ?? [])];
      const settings = at(lg.minChance);
      let reordered = 0;
      for (const [key, kept] of st.ladders ?? new Map<string, OfferLadder>()) {
        const card = cards.find((t) => t.key === key) as TradeEvaluation;
        expect(buildOfferLadder(ladderJobOfSearch(st, card)), key).toEqual(kept);
        expect(offerLadderOfProposal(fresh, card.proposal, { settings, page: "finder" }), key).toEqual(kept);
        const other = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
        const job = ladderJobOfProposal(other, card.proposal, { settings, page: "finder" }) as LadderJob;
        const I = tradeInternals(other);
        for (const s of kept.steps) {
          if (s.kind === "suggested") continue;
          const p = s.evaluation.proposal;
          if (p.give.length > 1 || p.get.length > 1) reordered++;
          const x = evaluateExact(I, { partnerId: p.partnerId, give: [...p.give].reverse(), get: [...p.get].reverse() }, job.legalMax);
          if ("illegal" in x) throw new Error(`${key}: ${x.illegal}`);
          job.store.versions.set(s.evaluation.key, { x, screen: simulateTrade(I, x, "screen", settings.lambda, settings.protectValue, rewardFor(I, settings)) });
        }
        expect(buildOfferLadder(job), `${key} (versions in another order)`).toEqual(kept);
      }
      // Offers whose players were reversed on a side (two or more there): a fact of the synthetic data.
      expect(reordered, `smallLeague ${lg.seed}: offers with two players on a side`).toBeGreaterThan(0);
    });
  }

  it("on leagues the folding of Checkpoint 4c's steps was measured on (smallLeague 30 and 67, at Any and 10%), no card holds a card of its list below it, and offers above a card still occur (the holder below keeps its label)", () => {
    let above = 0;
    for (const seed of [30, 67]) for (const minChance of [0, 0.1]) above += expectNoneBelowHeld(runTradeSearch(contextOf(seed, 6), { settings: at(minChance) }), `${seed} at ${minChance}`);
    expect(above).toBeGreaterThan(0);
  });
});
