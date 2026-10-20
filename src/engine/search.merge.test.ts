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
 * search.merge.release.test.ts drives the release rule (a merged trade given back) through a made-up plan. Since Checkpoint 7g
 * (planner reply to Checkpoint 7f, answer 3) the lists by hand leave out the versions dropped for a better one too, as filler
 * references (search.dominated.test.ts has that rule's own tests), the kept ladders are worked out with the preference the
 * search recorded (SearchState.prefers: search.prefer.test.ts), and smallLeague 48 gives one trade back: a dropped card held
 * it (the lead's D18).
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
import type { MergedTrade, OfferLadder, PromotedTrade, TradeEvaluation, TradeEvaluationCore, TradeSearchProgress, TradeSearchResult } from "./tradeModel";

const bare = (c: TradeEvaluationCore): TradeEvaluation => ({ ...c, reasons: [], pitch: "" });
const at = (minChance: number): TradeSettings => ({ ...defaultTradeSettings(), minChance });
const keysOf = (ts: readonly { key: string }[]) => ts.map((t) => t.key);

/** The leagues that merge (smallLeague seed, teams, the minimum chance), 8 availability scenarios. */
const LEAGUES = [
  { seed: 48, teams: 6, minChance: 0.1, released: 1 },
  { seed: 57, teams: 6, minChance: 0.1, released: 0 },
  { seed: 59, teams: 6, minChance: 0.1, released: 0 },
  { seed: 8, teams: 12, minChance: 0, released: 0 },
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

/**
 * A ladder with the partner's numbers (`them`) to 12 significant digits, every other number as it is. ⚠️ Since Checkpoint 7h
 * every card's ladder is kept (search.ts, "Promoted Last offers"), not only those the merge read, and on smallLeague 8 (12 teams,
 * Any) one card's ladder on a fresh context differs from the search's in the last bits of the partner's odds changes
 * (them.dCH and them.dPrizes, 3e-18): the search's run on the shown block continues its ranking run (Checkpoint 7f), the fresh
 * context's plays all 20,000 seasons, and the partner's numbers aren't bit for bit there (the same with the promotions off,
 * when that ladder is worked out on demand: a finding of Checkpoint 7h's track "answers", for the lead). The printed Helps them
 * is the same.
 */
function ulpsInThem(ladder: OfferLadder | null): unknown {
  const round = (v: unknown): unknown =>
    typeof v === "number" && Number.isFinite(v) ? Number(v.toPrecision(12)) : Array.isArray(v) ? v.map(round) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v;
  return JSON.parse(JSON.stringify(ladder, (k, v) => (k === "them" ? round(v) : v)));
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
function byHand(
  st: SearchState,
  minChance: number,
  merged: { overall: readonly string[]; helpsBoth: readonly string[] },
  promoted: readonly PromotedTrade[] = [],
): { overall: string[]; helpsBoth: string[] } {
  // Checkpoint 7h (search.ts, "Promoted Last offers"): each list ranks its promoted Last offers too (their ranking numbers, which
  // the search keeps in finalByKey), each never filler of the idea it came from (rank.ts RankOptions.fillerExempt).
  const promotedOf = (name: PromotedTrade["list"]) => promoted.filter((p) => p.list === name);
  // `merged`: each list's trades out of its rankings (merged into a card, or since Checkpoint 7g dropped for a better version).
  const value = assetValue(st.I);
  const caps = rankCaps({ relaxed: false, onePartner: st.onePartner });
  const extras = new Set(st.helpsBothExtras);
  const all = st.finals.map(bare);
  const printed = (t: TradeEvaluation) => bare(st.shownByKey.get(t.key) ?? t);
  const list = (base: TradeEvaluation[], gone: readonly string[], opts: Parameters<typeof rankTrades>[3], ups: readonly PromotedTrade[]) => {
    const out = new Set(gone);
    const known = new Set(base.map((t) => t.key));
    const pool = [...base, ...ups.filter((p) => !known.has(p.key)).map((p) => bare(st.finalByKey.get(p.key) as TradeEvaluationCore))];
    const elsewhere = all.filter((t) => out.has(t.key));
    const exempt = ups.length ? { fillerExempt: new Map(ups.map((p) => [p.key, p.from])) } : {};
    const ranking = rankTrades(
      pool.filter((t) => !out.has(t.key)),
      value,
      caps,
      { ...opts, shownElsewhere: elsewhere, ...exempt },
    );
    return keysOf(rankTrades(ranking.trades.map(printed), value, caps, { ...opts, shownElsewhere: elsewhere.map(printed), ...exempt }).trades);
  };
  const base = { minChance, givenCapExempt: st.forcedGive };
  return {
    overall: list(
      all.filter((t) => !extras.has(t.key)),
      merged.overall,
      base,
      promotedOf("overall"),
    ),
    helpsBoth: list(all, merged.helpsBoth, { ...base, order: "helps", keep: (t) => helpsBoth(t) }, promotedOf("helpsBoth")),
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
      // Something merged (a fact of the synthetic data) and, but on smallLeague 48 (a dropped card held a merged trade, which
      // comes back: Checkpoint 7g, the lead's D18), nothing given back; the counts.
      expect(merged.overall.length + merged.helpsBoth.length).toBeGreaterThan(0);
      expect(merged.released).toBe(lg.released);
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
      const dropped = (list: string) => keysOf((merged.dominated ?? []).filter((d) => d.list === list));
      // Since Checkpoint 7h with the promoted Last offers (no idea left out by a chain of them on these leagues: a fact of the
      // synthetic data, so the lists by hand need no keys of theirs).
      expect(merged.superseded ?? 0).toBe(0);
      const hand = byHand(st, lg.minChance, { overall: [...keysOf(merged.overall), ...dropped("overall")], helpsBoth: [...keysOf(merged.helpsBoth), ...dropped("helpsBoth")] }, merged.promoted ?? []);
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
        const prefer = st.prefers?.get(key);
        const open = st.opens?.get(key);
        expect(buildOfferLadder(ladderJobOfSearch(st, card, prefer, open)), key).toEqual(kept);
        expect(ulpsInThem(offerLadderOfProposal(fresh, card.proposal, { settings, page: "finder", ...(prefer ? { prefer } : {}), ...(open ? { open } : {}) })), key).toEqual(ulpsInThem(kept));
        const other = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
        const job = ladderJobOfProposal(other, card.proposal, { settings, page: "finder", ...(prefer ? { prefer } : {}), ...(open ? { open } : {}) }) as LadderJob;
        const I = tradeInternals(other);
        for (const s of kept.steps) {
          if (s.kind === "suggested") continue;
          const p = s.evaluation.proposal;
          if (p.give.length > 1 || p.get.length > 1) reordered++;
          const x = evaluateExact(I, { partnerId: p.partnerId, give: [...p.give].reverse(), get: [...p.get].reverse() }, job.legalMax);
          if ("illegal" in x) throw new Error(`${key}: ${x.illegal}`);
          job.store.versions.set(s.evaluation.key, { x, screen: simulateTrade(I, x, "screen", settings.lambda, settings.protectValue, rewardFor(I, settings)) });
        }
        expect(ulpsInThem(buildOfferLadder(job)), `${key} (versions in another order)`).toEqual(ulpsInThem(kept));
      }
      // Offers whose players were reversed on a side (two or more there): a fact of the synthetic data.
      expect(reordered, `smallLeague ${lg.seed}: offers with two players on a side`).toBeGreaterThan(0);
    });
  }

  it("on leagues the folding of Checkpoint 4c's steps was measured on (smallLeague 30 and 67, at Any and 10%), no card holds a card of its list below it, and offers above a card still occur (the holder below keeps its label: smallLeague 3 and 12 at 10% since Checkpoint 7g, whose rules settle 30's and 67's)", () => {
    for (const seed of [30, 67]) for (const minChance of [0, 0.1]) expectNoneBelowHeld(runTradeSearch(contextOf(seed, 6), { settings: at(minChance) }), `${seed} at ${minChance}`);
    let above = 0;
    for (const seed of [3, 12]) above += expectNoneBelowHeld(runTradeSearch(contextOf(seed, 6), { settings: at(0.1) }), `${seed} at 10%`);
    expect(above).toBeGreaterThan(0);
  });
});
