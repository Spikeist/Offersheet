/**
 * The minimum chance in the search and re-filtering (src/engine/search.ts; planner reply to Checkpoint 4b, change 10:
 * "Chance they accept: at least …", applied before the diversity caps on the chance as printed, re-filtered instantly
 * from the finalists, `few` on the cards shown; the offer-first steps held to it too, a Phase 4c lead decision, and since
 * Checkpoint 7e the Open of "How to offer it", offers.ts), and the
 * pattern note's wiring (change 6), with my must-include players
 * outside the given-player cap and the note (review of track SR). Synthetic leagues (smallLeague: made-up players,
 * placeholder teams).
 */
import { describe, expect, it } from "vitest";
import { displayAcceptance } from "./acceptance";
import { config } from "./config";
import { assetValue, buildTradeContext, tradeInternals, type TeamState } from "./evaluate";
import { offerLadderOfSearch, openBar } from "./offers";
import { patternNote } from "./pattern";
import { rankTrades } from "./rank";
import { patternInputsOf, rankCaps, refilterSearch, runRefilter, runTradeSearch, searchStateOf, type SearchState } from "./search";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { TradeEvaluation, TradeSearchProgress, TradeSearchResult } from "./tradeModel";

const league = smallLeague(23);
const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
const I = tradeInternals(ctx);
const at = (minChance: number, x: Partial<TradeSettings> = {}): TradeSettings => ({ ...defaultTradeSettings(), ...x, minChance });

/** Fresh searches by minimum chance (shared). */
const fresh = new Map<string, TradeSearchResult>();
function search(minChance: number, partnerId: string | null = null): TradeSearchResult {
  const key = `${minChance}|${partnerId}`;
  let r = fresh.get(key);
  if (!r) {
    r = runTradeSearch(ctx, { settings: at(minChance), partnerId });
    fresh.set(key, r);
  }
  return r;
}
const stateOf = (r: TradeSearchResult) => searchStateOf(r) as SearchState;

/** The `few` rule (search.ts's header): a minimum above Any, fewer than minChanceFew cards, and Any (`any`) shows more. */
const fewByRule = (r: TradeSearchResult, any: TradeSearchResult): boolean => (r.filter?.minChance ?? 0) > 0 && r.trades.length < config.ranking.minChanceFew && any.trades.length > r.trades.length;

describe("the minimum chance in the search", { timeout: 60_000 }, () => {
  it("default 10%: every shown trade's P_complete, as printed, at least the minimum; the filter says how many qualified", () => {
    expect(config.ranking.minChanceDefault).toBe(0.1);
    expect(config.ranking.minChanceOptions).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
    const r = search(0.1);
    expect(r.trades.length).toBeGreaterThan(0);
    for (const t of r.trades) expect(displayAcceptance(t.pComplete)).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(r.filter?.minChance).toBe(0.1);
    expect(r.filter?.qualifying).toBeGreaterThanOrEqual(r.trades.length);
    expect(r.filter?.few).toBe(fewByRule(r, search(0)));
    expect(r.hidden.byChance).toBeDefined();
  });

  it("chosen after the finalists: the same counts, finalists and guards' counts at any minimum; only the shown list moves", () => {
    const any = search(0);
    const high = search(0.4);
    // The search's own counts (Checkpoint 7e: simShown, the trades the lists show on the shown block, follows each list).
    const searched = (r: TradeSearchResult) => ({ ...r.counts, simShown: undefined });
    expect(searched(high)).toEqual(searched(any));
    expect(stateOf(high).finals.map((c) => c.key)).toEqual(stateOf(any).finals.map((c) => c.key));
    expect([high.hidden.byBenefit, high.hidden.byMarket]).toEqual([any.hidden.byBenefit, any.hidden.byMarket]);
    expect(any.hidden.byChance).toBe(0);
    expect(high.hidden.byChance).toBeGreaterThan(0); // a fact of the synthetic data: the minimum binds
    expect(high.filter?.qualifying).toBeLessThan(any.filter?.qualifying ?? 0);
    for (const t of high.trades) expect(displayAcceptance(t.pComplete)).toBeGreaterThanOrEqual(0.4 - 1e-9);
    const top = search(0.5);
    expect(top.filter?.few).toBe(fewByRule(top, any));
  });

  it("⚠️ few: the list shows fewer than minChanceFew ideas and a lower setting would show more (review of track SR, finding 2)", () => {
    // Every partner (one-partner searches, re-filtered: the same as fresh ones) and every minimum.
    const cases: { partnerId: string | null; minChance: number; r: TradeSearchResult; any: TradeSearchResult }[] = [];
    for (const partnerId of [null, ...I.teams.filter((t) => t !== I.me).map((t) => t.id)]) {
      const base = search(0.1, partnerId);
      const any = runRefilter(ctx, stateOf(base), { minChance: 0 });
      for (const minChance of config.ranking.minChanceOptions) cases.push({ partnerId, minChance, r: minChance === 0.1 ? base : runRefilter(ctx, stateOf(base), { minChance }), any });
    }
    for (const { partnerId, minChance, r, any } of cases) {
      const at = `partner ${partnerId ?? "all"} at ${minChance}`;
      expect(r.filter?.few, at).toBe(fewByRule(r, any));
      // Any (no lower setting) is never "few".
      if (minChance === 0) expect(r.filter?.few, at).toBe(false);
    }
    // Facts of the synthetic data: the rule fires where enough finalists qualify but the caps leave fewer cards (what
    // reading `qualifying` missed), and a short list that a lower setting wouldn't lengthen gets no hint.
    expect(cases.some((c) => c.r.filter?.few && (c.r.filter?.qualifying ?? 0) >= config.ranking.minChanceFew)).toBe(true);
    expect(cases.some((c) => c.minChance > 0 && c.r.trades.length < config.ranking.minChanceFew && c.r.filter?.few === false)).toBe(true);
  });
});

describe("refilterSearch: the finalists ranked again with another minimum (no new search)", { timeout: 60_000 }, () => {
  it("gives exactly what a fresh search with that minimum gives (deep equal), whichever minimum it started from", () => {
    const base = search(0.1);
    for (const x of [0, 0.2, 0.4, 0.5]) {
      const again = runRefilter(ctx, stateOf(base), { minChance: x });
      expect(again, `0.1 → ${x}`).toEqual(search(x));
    }
    // Chained: 0.1 → 0.5 → 0, and the same minimum again.
    const half = runRefilter(ctx, stateOf(base), { minChance: 0.5 });
    expect(runRefilter(ctx, stateOf(half), { minChance: 0 })).toEqual(search(0));
    expect(runRefilter(ctx, stateOf(base), { minChance: 0.1 })).toEqual(base);
  });

  it("⚠️ the same down to the order of a step's players, whatever versions an earlier minimum's cards cached (verification of the final review, finding VF-2): smallLeague(8)", () => {
    // At 30% a card's failed case-2 attempt cached a version listing my players [1011, 1003]; at 10% and 20% another card
    // (new on those lists) asks for the same version as [1003, 1011]. A cached version came back in its cached order.
    const lg = smallLeague(8);
    const c8 = buildTradeContext(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios: 8 });
    const run = (minChance: number) => runTradeSearch(c8, { settings: at(minChance) });
    for (const from of [0.3, 0.4]) {
      const st = searchStateOf(run(from)) as SearchState;
      for (const to of [0.1, 0.2]) expect(runRefilter(c8, st, { minChance: to }), `${from} → ${to}`).toEqual(run(to));
    }
  });

  it("Phase 4c (change 9): every Plan B box carries its odds from its own simulation on the shown block (Checkpoint 7e), the card's basis, from the card's own before", () => {
    let boxes = 0;
    for (const r of [search(0.1), search(0)]) {
      const st = stateOf(r);
      for (const t of r.trades) {
        if (!t.planB) continue;
        boxes++;
        // Chosen on the ranking block (its final run there), printed from its shown pass, as its card is.
        expect(st.finalByKey.get(t.planB.key)?.stage, t.planB.key).toBe("final");
        const fin = st.shownByKey.get(t.planB.key);
        expect(fin?.sims, t.planB.key).toBe(config.simulation.shownSims);
        expect([t.planB.b, t.planB.tradeScore, t.planB.overall], t.planB.key).toEqual([fin?.b, fin?.tradeScore, fin?.overall]);
        expect(t.planB.dPO, t.planB.key).toBe(fin?.dPO);
        expect(t.planB.dCH, t.planB.key).toBe(fin?.dCH);
        expect(t.planB.winChance, t.planB.key).toEqual(fin?.detail.winChance);
        // The same block as the card's runs, so the same "before" every week.
        for (const w of t.planB.winChance ?? []) expect(w.before, `${t.planB.key} week ${w.week}`).toBe(t.detail.winChance?.find((x) => x.week === w.week)?.before);
      }
    }
    expect(boxes).toBeGreaterThan(0);
  });

  it("a one-partner search too, and the Plan Bs it shows are the fresh search's", () => {
    const one = search(0.1, "4");
    expect(one.trades.length).toBeGreaterThan(0);
    const anyOne = runRefilter(ctx, stateOf(one), { minChance: 0 });
    expect(anyOne).toEqual(search(0, "4"));
    const all = search(0.1);
    expect(all.trades.some((t) => t.planB)).toBe(true); // something to recompute
  });

  it("⚠️ a card's “How to offer it” follows the minimum (its Open prints at least the minimum when that's above 15%: offers.ts), the same from a re-filter as from a fresh search", () => {
    // smallLeague(67): its cards' ladders open with versions under 30% at the lowest minimums (a fact of the synthetic data).
    // Until Checkpoint 7e the steps' case 1 came and went with the minimum the same way (Phase 4c lead decision).
    const league67 = smallLeague(67);
    const c67 = buildTradeContext(league67.snapshot, league67.inputs, { now: TEST_NOW, scenarios: 8 });
    const any = runTradeSearch(c67, { settings: at(0) });
    const results = new Map(config.ranking.minChanceOptions.map((m) => [m, m === 0 ? any : runRefilter(c67, stateOf(any), { minChance: m })]));
    let moved = 0;
    for (const t of any.trades) {
      const atAny = offerLadderOfSearch(any, t.key)?.steps.find((s) => s.kind === "open");
      for (const [m, r] of results) {
        if (!r.trades.some((x) => x.key === t.key)) continue; // the card itself is under the minimum
        const open = offerLadderOfSearch(r, t.key)?.steps.find((s) => s.kind === "open");
        if (open) expect(displayAcceptance(open.evaluation.pComplete), `${t.key} at ${m}`).toBeGreaterThanOrEqual(openBar(m) - 1e-9);
        if (atAny && open?.evaluation.key !== atAny.evaluation.key) moved++;
      }
    }
    expect(moved).toBeGreaterThan(0);
    for (const m of [0.3, 0.5]) {
      const fresh = runTradeSearch(c67, { settings: at(m) });
      const re = results.get(m) as TradeSearchResult;
      expect(re, String(m)).toEqual(fresh);
      for (const t of re.trades) expect(offerLadderOfSearch(re, t.key), `${t.key} at ${m}`).toEqual(offerLadderOfSearch(fresh, t.key));
    }
  });

  it("progress under the rank stage only, ending at the shown pass's count; stoppable; the timings its own", () => {
    const progress: TradeSearchProgress[] = [];
    let tick = 0;
    const r = runRefilter(ctx, stateOf(search(0.1)), { minChance: 0.2, clock: () => tick++ }, (p) => progress.push(p));
    expect(new Set(progress.map((p) => p.stage))).toEqual(new Set(["rank"]));
    // Checkpoint 7e: the shown pass comes last, one unit per trade the lists show (every card of either list and every Plan B
    // box, each once; a trade the search showed already is read from its numbers then, shownByKey), so at least the cards.
    const last = progress.at(-1) as TradeSearchProgress;
    expect(last.done).toBe(last.total);
    expect(last.total).toBeGreaterThanOrEqual(new Set([...r.trades, ...(r.helpsBoth?.trades ?? [])].map((t) => t.key)).size);
    for (const t of [...r.trades, ...(r.helpsBoth?.trades ?? [])]) for (const k of [t.key, ...(t.planB ? [t.planB.key] : [])]) expect(stateOf(r).shownByKey.has(k), k).toBe(true);
    expect(Object.keys(r.timings)).toEqual(["rank", "steps", "shown", "total"]);
    const it = refilterSearch(ctx, stateOf(search(0.1)), { minChance: 0.3 });
    expect(it.next().value).toEqual({ stage: "rank", done: 0, total: 1 });
    expect(it.return({} as TradeSearchResult).done).toBe(true);
  });

  it("a search stopped before ranking has no state (its result holds for any minimum); another context is refused", () => {
    const none = runTradeSearch(buildTradeContext({ ...league.snapshot, myTeamId: null }, league.inputs, { now: TEST_NOW, scenarios: 0 }), { settings: at(0.3) });
    expect(searchStateOf(none)).toBeNull();
    expect(none.filter).toBeUndefined();
    expect(none.hidden).toEqual({ byBenefit: 0, byMarket: 0, byChance: 0 });
    // A copy that crossed a message boundary isn't the result object: no state.
    expect(searchStateOf(structuredClone(search(0.1)))).toBeNull();
    const other = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
    expect(() => runRefilter(other, stateOf(search(0.1)), { minChance: 0.2 })).toThrow(/another trade context/);
  });
});

describe("the pattern note's wiring (planner reply to Checkpoint 4b, change 6)", { timeout: 60_000 }, () => {
  it("is the note of the same finalists ranked without the given-player cap (the other rules and the minimum as shown)", () => {
    for (const minChance of [0, 0.1, 0.3]) {
      const r = search(minChance);
      const value = assetValue(I);
      const uncapped = rankTrades(
        stateOf(r).finals.map((c) => ({ ...c, reasons: [], pitch: "" })),
        value,
        { ...rankCaps({ relaxed: false, onePartner: false }), perGivenPlayerInTop20: Number.POSITIVE_INFINITY },
        { minChance },
      );
      // The list itself too (final review of Phase 4c, finding R7): the note says how many of his trades it shows.
      const expected = patternNote({ ...patternInputsOf(I, uncapped.trades), shown: r.trades });
      expect(r.pattern ?? null, `minChance ${minChance}`).toEqual(expected);
      if (r.pattern) {
        expect(r.pattern.count).toBeGreaterThanOrEqual(config.explain.patternMinCount);
        expect(r.pattern.text).toContain(I.snapshot.players[r.pattern.playerId]?.name as string);
        const shownGiving = r.trades.filter((t) => t.proposal.give.some((a) => a.kind === "player" && a.id === r.pattern?.playerId)).length;
        expect(shownGiving).toBeLessThan(r.pattern.count);
        expect(r.pattern.text).toMatch(new RegExp(`\\. The list shows ${shownGiving} ideas? that trades? him, to make room for other ideas\\.$`));
      }
    }
  });

  it("⚠️ a must-include player of mine: outside the given-player cap, never named by the note (review of track SR, finding 1)", () => {
    const me = I.me as TeamState;
    const value = assetValue(I);
    const cap = config.ranking.perGivenPlayerInTop20;
    const gives = (t: TradeEvaluation) => t.proposal.give.flatMap((a) => (a.kind === "player" ? [a.id] : []));
    // My first player (by id) whose must-include search shows more cards than the cap would let through.
    let found: { id: string; r: TradeSearchResult } | null = null;
    for (const id of me.roster.filter((x) => I.league.table.rows.has(x)).sort()) {
      const r = runTradeSearch(ctx, { settings: at(0.1, { mustInclude: [id] }) });
      if (r.trades.length > cap) {
        found = { id, r };
        break;
      }
    }
    expect(found).not.toBeNull();
    const { id, r } = found as { id: string; r: TradeSearchResult };
    for (const t of r.trades) expect(gives(t)).toContain(id);
    // Counting him, the cap would cut the same cards to `cap`; my other players are still held to it in the top 20.
    expect(rankTrades(r.trades, value, rankCaps({ relaxed: false, onePartner: false }), { minChance: 0.1 }).trades).toHaveLength(cap);
    const others = new Map<string, number>();
    for (const t of r.trades.slice(0, config.ranking.partnerCapTop)) for (const g of gives(t)) if (g !== id) others.set(g, (others.get(g) ?? 0) + 1);
    for (const [g, n] of others) expect(n, g).toBeLessThanOrEqual(cap);
    // The note: the uncapped ranking's, never naming him.
    const st = stateOf(r);
    expect(st.forcedGive).toEqual([id]);
    expect(r.pattern?.playerId).not.toBe(id);
    const uncapped = rankTrades(st.finals.map((c) => ({ ...c, reasons: [], pitch: "" })), value, { ...rankCaps({ relaxed: false, onePartner: false }), perGivenPlayerInTop20: Number.POSITIVE_INFINITY }, { minChance: 0.1, givenCapExempt: [id] });
    expect(r.pattern ?? null).toEqual(patternNote({ ...patternInputsOf(I, uncapped.trades, [id]), shown: r.trades }));
    // Re-filtering keeps him outside the cap: the same as a fresh search.
    expect(runRefilter(ctx, st, { minChance: 0 })).toEqual(runTradeSearch(ctx, { settings: at(0, { mustInclude: [id] }) }));
  });

  it("the inputs: names, byes by NFL team, the first counted week, the slot labels", () => {
    const x = patternInputsOf(I, []);
    const someone = Object.values(I.snapshot.players).find((p) => p.nflTeam && I.inputs.nfl.byeWeek[p.nflTeam] !== undefined);
    expect(someone).toBeDefined();
    if (someone) {
      expect(x.player(someone.id)).toEqual({ name: someone.name, pos: someone.pos });
      expect(x.byeWeek(someone.id)).toBe(I.inputs.nfl.byeWeek[someone.nflTeam as string]);
    }
    expect(x.byeWeek("nobody")).toBeNull();
    expect(x.firstWeek).toBe(I.league.lp.weeks.weeks[I.from]);
    const inst = I.instances[0];
    if (inst) expect(x.slotLabel(inst.key)).toBe(inst.label);
  });
});
