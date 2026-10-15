/**
 * The lean companions (src/engine/search.ts, "Lean companions"; ⚠️ a Phase 4c lead decision in the spirit of the planner's
 * reply to Checkpoint 4b, change 2): every shortlisted trade whose packages leave players out under the neutral throw-in
 * rule (market.neutralThrowIns) brings the same trade without them to exact evaluation too, on top of exactEvaluationMax,
 * and the funnel decides between them; a Plan B box never offers a card plus players worth at most W unless they make it
 * minAcceptGain likelier (barredFromBoxes; review of NT, finding 1). Synthetic leagues (smallLeague: made-up players,
 * placeholder teams) and hand-made values.
 */
import { describe, expect, it } from "vitest";
import { config } from "./config";
import { buildTradeContext, proposalKey, tradeInternals, type TeamState, type TradeInternals } from "./evaluate";
import { neutralThrowIns } from "./market";
import { planBPasses } from "./planB";
import { atMostWaiverCredit, barredFromBoxes, buildPools, extraPlayersOf, helpsBothLaneOf, leanCompanions, leanVersionOf, partnerCandidates, refilterSearch, runRefilter, runTradeSearch, searchStateOf, shortlistOf, type SearchState } from "./search";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague, withWaiverStash } from "./trade.testing";
import type { TradeAsset, TradeEvaluation, TradeEvaluationCore, TradeProposal, TradeSearchProgress, TradeSearchResult } from "./tradeModel";

const players = (ids: readonly string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));
const ids = (p: Pick<TradeProposal, "give" | "get">, side: "give" | "get") => p[side].flatMap((a) => (a.kind === "player" ? [a.id] : []));
const keyOf = (partnerId: string, give: readonly string[], get: readonly string[]) => proposalKey({ partnerId, give: players(give), get: players(get) });
const settingsWith = (x: Partial<TradeSettings> = {}): TradeSettings => ({ ...defaultTradeSettings(), ...x });
const stateOf = (r: TradeSearchResult) => searchStateOf(r) as SearchState;

function drain<T>(it: Generator<void, T, void>): T {
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/**
 * The search's shortlist and lean companions rebuilt from its pieces (buildPools, partnerCandidates, shortlistOf,
 * leanCompanions), and since Checkpoint 7d its helps-both lane with the lane's own companions (helpsBothLaneOf, skipping the
 * shortlist and its companions).
 */
function rebuild(I: TradeInternals, settings: TradeSettings) {
  const pools = buildPools(I, settings, null);
  const lists = pools.partners.map((p) => {
    const H = pools.get.get(p.id) as { pool: string[]; forced: string[] };
    return drain(partnerCandidates(I, p, { give: pools.give, forcedGive: pools.forcedGive, get: H.pool, forcedGet: H.forced }, settings.maxPerSide, { screened: 0 }));
  });
  const shortlist = shortlistOf(lists, atMostWaiverCredit(I));
  const tally = { screened: 0 };
  const companions = drain(leanCompanions(I, shortlist, lists, pools, tally));
  const taken = new Set([...shortlist, ...companions].map((x) => x.key));
  const lane = helpsBothLaneOf(lists, taken, atMostWaiverCredit(I)).trades;
  const laneCompanions = drain(leanCompanions(I, lane, lists, pools, { screened: 0 }, taken));
  return { pools, lists, shortlist, companions, tally, lane, laneCompanions };
}

// smallLeague(6), EV lineups: its search shortlists Team 2's 1006 + 1012 → 1018 (1006 worth at most W, a neutral
// throw-in) but not 1012 → 1018, whose screen the free-agent add in the roster spot 1006 opens beats. These narratives were
// measured with W the best free agent's value (Checkpoint 4c's rule): a free agent nobody can use, worth that much
// (withWaiverStash), keeps it, where A3's W (the best one left unclaimed) is lower in these leagues. And with the fallback
// playoff weight (FIXED_OMEGA: league.ts step 5c not measured, 1.25, the weight before the planner's reply to Checkpoint 7a,
// §6.1), which these leagues' shortlists and Plan B boxes were measured with.
const FIXED_OMEGA = { playoffWeightSims: 0 } as const;
const league6 = withWaiverStash(smallLeague(6));
const ctx6 = buildTradeContext(league6.snapshot, league6.inputs, { now: TEST_NOW, scenarios: 0, ...FIXED_OMEGA });
const I6 = tradeInternals(ctx6);
const settings = settingsWith();
const withCompanions = runTradeSearch(ctx6, { settings });
const without = runTradeSearch(ctx6, { settings, leanCompanions: false });
const FULL = keyOf("2", ["1006", "1012"], ["1018"]);
const LEAN = keyOf("2", ["1012"], ["1018"]);

describe("the lean companions (search.ts)", { timeout: 60_000 }, () => {
  it("a lean version wins: the same trade without its neutral throw-in, which the shortlist missed, takes his card's place", () => {
    // The full trade: 1006 is worth at most W, so the neutral rule leaves him out of both packages.
    expect(I6.values["1006"] as number).toBeLessThanOrEqual(I6.credit);
    expect(leanVersionOf(I6, ["1006", "1012"], ["1018"])).toEqual({ give: ["1012"], get: ["1018"], removed: ["1006"] });
    // Without the companions: the full trade is a card and the lean one was never evaluated exactly.
    expect(without.trades.map((t) => t.key)).toContain(FULL);
    expect(stateOf(without).exactByKey.has(LEAN)).toBe(false);
    expect(stateOf(without).companions).toEqual([]);
    // With them: the lean version comes in as a companion and takes the card's place; the full trade isn't shown.
    const s = stateOf(withCompanions);
    expect(s.companions).toContain(LEAN);
    expect(s.exactByKey.has(FULL)).toBe(true);
    const cards = withCompanions.trades.map((t) => t.key);
    expect(cards).toContain(LEAN);
    expect(cards).not.toContain(FULL);
    expect(cards.indexOf(LEAN)).toBe(without.trades.findIndex((t) => t.key === FULL));
    // The same g on both sides (he was neutral). Here he raises the chance they accept through their lineup (n), not
    // through value: the full trade is likelier (17.9% against 13.6%), but the lean one helps me more (B 3.95 against
    // 2.91), and wins on the expected gain the list ranks by (B × P_complete, 0.536 against 0.521): the funnel decided.
    const full = s.exactByKey.get(FULL)?.evaluation;
    const lean = s.exactByKey.get(LEAN)?.evaluation;
    expect(full && lean).toBeTruthy();
    expect([lean?.gMine, lean?.gPartner]).toEqual([full?.gMine, full?.gPartner]);
    expect(lean?.partnerDeltaLineup as number).toBeLessThan(full?.partnerDeltaLineup as number);
    const final = (k: string) => s.finals.find((f) => f.key === k);
    const eg = (k: string) => (final(k)?.b as number) * (final(k)?.pComplete as number);
    expect(final(FULL) && final(LEAN)).toBeTruthy();
    expect(final(LEAN)?.b as number).toBeGreaterThan(final(FULL)?.b as number);
    expect(eg(LEAN)).toBeGreaterThan(eg(FULL));
    // Every other card stays, with the same numbers, in the same order; one more comes in (#13, Team 6's 1006 + 1007 →
    // 1063 + 1066): without the full trade, 1006 is given in two cards of the top 20, under the given-player cap.
    const rest = (r: TradeSearchResult, k: string) => r.trades.filter((t) => t.key !== k).map((t) => `${t.key}:${t.b}:${t.pComplete}`);
    const shownWithout = rest(without, FULL);
    const shownWith = rest(withCompanions, LEAN);
    expect(shownWith.filter((x) => shownWithout.includes(x))).toEqual(shownWithout);
    expect(shownWith.length).toBe(shownWithout.length + 1);
    const extra = withCompanions.trades.find((t) => !without.trades.some((u) => u.key === t.key) && t.key !== LEAN);
    expect(extra?.key).toBe(keyOf("6", ["1006", "1007"], ["1063", "1066"]));
    expect(without.trades.filter((t) => ids(t.proposal, "give").includes("1006"))).toHaveLength(config.ranking.perGivenPlayerInTop20);
  });

  it("every companion is the lean version of a shortlisted trade, outside the shortlist, legal under the search's filters, once; every such lean version is one", () => {
    for (const [seed, scenarios] of [
      [6, 0],
      [8, 0],
      [11, 4],
    ] as const) {
      const lg = seed === 6 ? league6 : withWaiverStash(smallLeague(seed));
      const ctx = seed === 6 ? ctx6 : buildTradeContext(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios, ...FIXED_OMEGA });
      const I = tradeInternals(ctx);
      const r = seed === 6 ? withCompanions : runTradeSearch(ctx, { settings });
      const s = stateOf(r);
      const { shortlist, companions, pools, lists, lane, laneCompanions } = rebuild(I, settings);
      // The search's companions are the rebuilt ones, in the same order (Checkpoint 7d: the helps-both lane's apart).
      expect(s.companions, `seed ${seed}`).toEqual(companions.map((c) => c.key));
      expect(companions.length, `seed ${seed}`).toBeGreaterThan(0);
      expect(s.lane.trades, `seed ${seed}`).toEqual(lane.map((c) => c.key));
      expect(s.lane.companions, `seed ${seed}`).toEqual(laneCompanions.map((c) => c.key));
      const short = new Set(shortlist.map((x) => x.key));
      // The exact trades are the shortlist and its companions, then the helps-both lane and its own, but for the illegal ones.
      const chosen = new Set([...short, ...s.companions, ...s.lane.trades, ...s.lane.companions]);
      for (const k of s.exactByKey.keys()) expect(chosen.has(k), `seed ${seed} ${k}`).toBe(true);
      expect(chosen.size, `seed ${seed}`).toBe(shortlist.length + companions.length + lane.length + laneCompanions.length);
      expect(r.counts.exact).toBeLessThanOrEqual(chosen.size);
      expect(new Set(s.companions).size).toBe(s.companions.length);
      const [gLo, gHi] = config.search.screeningGWindow;
      const leans = new Map<string, string[]>();
      for (const x of shortlist) {
        const lean = leanVersionOf(I, x.give, x.get);
        if (!lean || !lean.give.length || !lean.get.length) continue;
        const k = keyOf(x.partnerId, lean.give, lean.get);
        leans.set(k, [...(leans.get(k) ?? []), x.key]);
      }
      for (const c of companions) {
        expect(short.has(c.key), `seed ${seed} ${c.key}`).toBe(false);
        expect(leans.has(c.key), `seed ${seed} ${c.key}: a shortlisted trade's lean version`).toBe(true);
        expect(c.give.length && c.get.length).toBeTruthy();
        expect(c.gPartner).toBeGreaterThanOrEqual(gLo - 1e-9);
        expect(c.gPartner).toBeLessThanOrEqual(gHi + 1e-9);
        expect(pools.forcedGive.every((id) => c.give.includes(id))).toBe(true);
        // The rule leaves nobody else out of the lean version (no IR moves here: it's the rule's fixed point), unless the
        // lean version is the planner's step alone because both steps would empty a side (final review, finding R5):
        // then what the rule would still leave out empties a side.
        const rest = neutralThrowIns(c.get, c.give, I.values, I.credit).removed;
        if (rest.length) expect(c.give.every((id) => rest.includes(id)) || c.get.every((id) => rest.includes(id)), `seed ${seed} ${c.key}`).toBe(true);
      }
      // Every shortlisted trade's lean version is shortlisted or a companion, unless its screen is illegal or outside the window.
      const screened = new Map(lists.flat().map((x) => [x.key, x]));
      for (const k of leans.keys()) {
        if (short.has(k) || s.companions.includes(k)) continue;
        const x = screened.get(k);
        if (x) expect(x.gPartner < gLo - 1e-9 || x.gPartner > gHi + 1e-9, `seed ${seed} ${k}: outside the window`).toBe(true);
      }
    }
  });

  it("must-include players: a lean version that would drop one is no companion", () => {
    // 1006 must be included: every candidate gives him, so the lean version without him can't be offered.
    const forced = runTradeSearch(ctx6, { settings: settingsWith({ mustInclude: ["1006"] }) });
    const s = stateOf(forced);
    for (const k of s.companions) expect(s.exactByKey.get(k)?.evaluation.proposal.give.some((a) => a.kind === "player" && a.id === "1006") ?? true, k).toBe(true);
    expect(s.companions).not.toContain(LEAN);
    for (const t of forced.trades) expect(ids(t.proposal, "give")).toContain("1006");
  });

  it("the report switch: leanCompanions false evaluates the shortlist alone (since Checkpoint 7d with the helps-both lane, which brings none either)", () => {
    const s = stateOf(without);
    const { shortlist } = rebuild(I6, settings);
    expect(s.companions).toEqual([]);
    expect(s.lane.companions).toEqual([]);
    expect([...s.exactByKey.keys()].every((k) => shortlist.some((x) => x.key === k) || s.lane.trades.includes(k))).toBe(true);
    expect(without.counts.exact - s.lane.trades.filter((k) => s.exactByKey.has(k)).length).toBeLessThanOrEqual(config.search.exactEvaluationMax);
    // Screening is the same: the companions' screens are the candidates' own (every lean version a 1-for-1 seed here).
    expect(withCompanions.counts.screened).toBe(without.counts.screened);
    // Without the lane (it's chosen outside what the shortlist and its companions hold, so it can differ between the two),
    // exactly the companions more.
    const lean = runTradeSearch(ctx6, { settings, helpsBothLane: false });
    const alone = runTradeSearch(ctx6, { settings, helpsBothLane: false, leanCompanions: false });
    expect(lean.counts.exact).toBe(alone.counts.exact + stateOf(lean).companions.length);
    expect(stateOf(lean).companions).toEqual(stateOf(withCompanions).companions);
  });

  it("deterministic, and re-filtering a search with companions equals a fresh search at that minimum", () => {
    expect(runTradeSearch(ctx6, { settings })).toEqual(withCompanions);
    for (const m of [0, 0.2, 0.4]) expect(runRefilter(ctx6, stateOf(withCompanions), { minChance: m }), String(m)).toEqual(runTradeSearch(ctx6, { settings: settingsWith({ minChance: m }) }));
    // The re-filter keeps the companions (the state is the search's).
    const again = refilterSearch(ctx6, stateOf(withCompanions), { minChance: 0.2 });
    let r = again.next();
    while (!r.done) r = again.next();
    expect(stateOf(r.value).companions).toEqual(stateOf(withCompanions).companions);
  });

  it("progress: the exact stage counts the shortlist and its companions (since Checkpoint 7d the helps-both lane and its own too); the companions are found during screening", () => {
    const progress: TradeSearchProgress[] = [];
    const r = runTradeSearch(ctx6, { settings }, (p) => progress.push(p));
    const exact = progress.filter((p) => p.stage === "exact");
    expect(exact.at(-1)).toEqual({ stage: "exact", done: exact.length, total: exact.length });
    const s = stateOf(r);
    expect(exact.length).toBe(rebuild(I6, settings).shortlist.length + s.companions.length + s.lane.trades.length + s.lane.companions.length);
    const stages = progress.map((p) => p.stage);
    expect(stages.indexOf("exact")).toBeGreaterThan(stages.lastIndexOf("screening"));
  });

  describe("a Plan B box never offers a card plus players worth at most W who don't make it minAcceptGain likelier (barredFromBoxes; review of NT, finding 1)", () => {
    // By hand: W 600; A–D worth more, the rest at most W.
    const hand = { values: { A: 3000, B: 2500, C: 2000, D: 1800, x: 200, y: 300, c: 100, r: 511, m: 578, d: 390 }, credit: 600 };
    const GAIN = config.search.steps.minAcceptGain;
    const at = (partnerId: string, give: string[], get: string[], pComplete: number, extra: TradeAsset[] = []) => ({
      key: keyOf(partnerId, give, get) + (extra.length ? "+pick" : ""),
      proposal: { partnerId, give: [...players(give), ...extra], get: players(get) },
      pComplete,
    });
    const barred = (pool: ReturnType<typeof at>[], cards: ReturnType<typeof at>[], gain?: number) => [...barredFromBoxes(pool, cards, gain)].sort();

    it("the card plus a cheap player on either side, no likelier by minAcceptGain: barred; likelier by at least that: kept", () => {
      const card = at("2", ["A"], ["B"], 0.4);
      const mine = at("2", ["A", "x"], ["B"], 0.38);
      const theirs = at("2", ["A"], ["B", "c"], 0.3);
      expect(barred([mine, theirs], [card])).toEqual([card.key, mine.key, theirs.key].sort());
      // Just under the bar: barred; at it (float noise aside) or above: kept ("add him, they need him").
      expect(barred([at("2", ["A", "x"], ["B"], 0.4 + GAIN - 0.001)], [card])).toEqual([card.key, mine.key].sort());
      expect(barred([at("2", ["A", "x"], ["B"], 0.4 + GAIN)], [card])).toEqual([card.key]);
      expect(barred([at("2", ["A"], ["B", "c"], 0.6)], [card])).toEqual([card.key]);
      // Another bar: a trade 6 points likelier clears 5 but not 10.
      expect(barred([at("2", ["A", "x"], ["B"], 0.46)], [card], 0.1)).toEqual([card.key, mine.key].sort());
      expect(barred([at("2", ["A", "x"], ["B"], 0.46)], [card])).toEqual([card.key]);
    });

    it("the review's shape: every player worth at most W, so the neutral rule leaves all of them out and the first bar (the card plus every player left out) let the box through", () => {
      // Rico Dowdle ([value]) → Jordan Mason ([value]) is the card; Dowdle → Mason + Kalif Raymond ([value]) the box, 40.8% against 47.0%.
      const card = at("2", ["d"], ["m"], 0.47);
      const box = at("2", ["d"], ["m", "r"], 0.408);
      // Both steps leave all three out (an empty lean version): since the final review (finding R5) the lean version is the
      // planner's step alone, Raymond (the cheaper of the side moving one more player) left out: the card itself.
      expect(neutralThrowIns(["m", "r"], ["d"], hand.values, hand.credit).removed).toEqual(["d", "r", "m"]);
      expect(leanVersionOf(hand, ["d"], ["m", "r"])).toEqual({ give: ["d"], get: ["m"], removed: ["r"] });
      expect(barred([box], [card])).toEqual([card.key, box.key].sort());
      // The live order's shape: the card Dowdle → Raymond (50.4%) plus a player of mine worth at most W (Marvin Harrison Jr.,
      // [value] ≤ W [value] there), 43.3%.
      expect(barred([at("2", ["d", "y"], ["r"], 0.433)], [at("2", ["d"], ["r"], 0.504)])).toEqual([keyOf("2", ["d", "y"], ["r"]), keyOf("2", ["d"], ["r"])].sort());
    });

    it("a player worth at most W the neutral rule leaves in (a stand-in for a roster-spot credit) counts too: he moves no g either", () => {
      // A + x → B + C reads as A → B + C (x stands in for the spot the 1-for-2 fills): leanVersionOf leaves nobody out.
      expect(leanVersionOf(hand, ["A", "x"], ["B", "C"])).toBeNull();
      const card = at("2", ["A"], ["B", "C"], 0.3);
      expect(barred([at("2", ["A", "x"], ["B", "C"], 0.33)], [card])).toEqual([card.key, keyOf("2", ["A", "x"], ["B", "C"])].sort());
      expect(barred([at("2", ["A", "x"], ["B", "C"], 0.36)], [card])).toEqual([card.key]);
    });

    it("never a trade missing a player of the card, another partner's, or one with a pick beyond it", () => {
      const card = at("2", ["A"], ["B"], 0.4);
      const pool = [
        at("2", ["x"], ["B"], 0.3), // A missing: no superset of the card
        at("2", ["B"], ["A", "c"], 0.3), // the card's players on the other sides
        at("3", ["A", "x"], ["B"], 0.3), // another partner
        at("2", ["A"], ["B"], 0.3, [{ kind: "pick", season: 2027, round: 2, originalTeamId: "1" }]), // a pick beyond it
      ];
      expect(barred(pool, [card])).toEqual([card.key]);
      // The cards themselves always; nothing without cards.
      expect(barred([card], [card])).toEqual([card.key]);
      expect(barred(pool, [])).toEqual([]);
    });

    it("the card plus a player worth more than W counts too: barred unless minAcceptGain likelier (final review, findings R2 and PAGES-1)", () => {
      // Puka Nacua → Zay Flowers + Omarion Hampton (25.1%) was a card; the box offered it with Kyle Monangai ([value] > W [value]) at
      // 23.2%: through value he adds something, but the box is no easier to say yes to than a card the list shows.
      const card = at("2", ["A"], ["B"], 0.4);
      const dear = at("2", ["A", "D"], ["B"], 0.4); // D is worth more than W, the same chance
      const both = at("2", ["A", "x"], ["B", "D"], 0.2); // x is cheap, D isn't
      expect(barred([dear, both], [card])).toEqual([card.key, dear.key, both.key].sort());
      // Just under the bar: barred; at it: kept (he makes the trade easier to say yes to).
      expect(barred([at("2", ["A", "D"], ["B"], 0.4 + GAIN - 0.001)], [card])).toEqual([card.key, keyOf("2", ["A", "D"], ["B"])].sort());
      expect(barred([at("2", ["A", "D"], ["B"], 0.4 + GAIN)], [card])).toEqual([card.key]);
    });

    it("extraPlayersOf: the players beyond a proper part, side by side; null otherwise", () => {
      const p = (give: string[], get: string[]) => ({ give: players(give), get: players(get) });
      expect(extraPlayersOf(p(["A"], ["B"]), p(["A", "x"], ["B", "c"]))).toEqual(["x", "c"]);
      expect(extraPlayersOf(p(["A"], ["B"]), p(["A"], ["B"]))).toBeNull();
      expect(extraPlayersOf(p(["A"], ["B"]), p(["x"], ["B", "A"]))).toBeNull();
      expect(extraPlayersOf(p(["A"], ["B"]), { give: [...players(["A"]), { kind: "pick", season: 2027, round: 1, originalTeamId: "2" }], get: players(["B"]) })).toBeNull();
    });

    it("smallLeague(6): the full trade (17.9%) is the lean card (13.6%) plus 1006, worth at most W, under 5 points likelier: barred", () => {
      const s = stateOf(withCompanions);
      const full = s.planBPool.find((c) => c.key === FULL);
      const lean = withCompanions.trades.find((t) => t.key === LEAN);
      expect(full && lean).toBeTruthy();
      expect((full?.pComplete as number) - (lean?.pComplete as number)).toBeGreaterThan(0);
      expect((full?.pComplete as number) - (lean?.pComplete as number)).toBeLessThan(GAIN);
      expect(barredFromBoxes(s.planBPool, withCompanions.trades).has(FULL)).toBe(true);
    });

    // In the searches (EV lineups; run once, on first use): no box is a card, nor a card plus players worth at most W under the bar.
    // Under Plan B's rule before the review of wave D (the report switch otherTargetOnly false: the same players of theirs
    // first), whose boxes these facts were measured on, so barredFromBoxes' bar on a card plus a player of mine is exercised;
    // since that review a box is a different target only (planB.ts), the last test below (`now`: the app's own search). `r`
    // without Checkpoint 7f's merge (the report switch mergeCards false: the lists those facts were measured on; the merged
    // trades' own bar is search.merge.test.ts's).
    type Searched = { seed: number; I: TradeInternals; r: TradeSearchResult; now: TradeSearchResult };
    let memo: Searched[] | null = null;
    const searched = (): Searched[] =>
      (memo ??= [6, 8, 12, 18, 59].map((seed) => {
        if (seed === 6) return { seed, I: I6, r: runTradeSearch(ctx6, { settings, planB: { otherTargetOnly: false }, mergeCards: false }), now: withCompanions };
        const lg = smallLeague(seed);
        const ctx = buildTradeContext(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios: 0, ...FIXED_OMEGA });
        return { seed, I: tradeInternals(ctx), r: runTradeSearch(ctx, { settings, planB: { otherTargetOnly: false }, mergeCards: false }), now: runTradeSearch(ctx, { settings }) };
      }));
    const seedRun = (seed: number): Searched => searched().find((x) => x.seed === seed) as Searched;

    it("in the searches: every box is no card (no card has steps since Checkpoint 7e), never matched or beaten on both numbers by a card with its partner, and, when it's a card plus more players, at least minAcceptGain likelier than that card", () => {
      let likelierBoxes = 0;
      for (const { seed, r } of searched()) {
        const cards = new Map(r.trades.map((t) => [t.key, t]));
        for (const t of r.trades) {
          expect(t.steps, `seed ${seed}`).toBeUndefined();
          if (!t.planB) continue;
          expect(cards.has(t.planB.key), `seed ${seed}`).toBe(false);
          for (const c of r.trades) {
            if (c.proposal.partnerId !== t.planB.proposal.partnerId) continue;
            // dominatedByCard (planB.ts): no card with its partner as helpful (as printed) and at least as likely.
            expect((c.tradeScore as number) >= t.planB.tradeScore && c.pComplete >= t.planB.pComplete - 1e-9, `seed ${seed}: box ${t.planB.key} under card ${c.key}`).toBe(false);
            const extras = extraPlayersOf(c.proposal, t.planB.proposal);
            if (!extras) continue;
            expect(t.planB.pComplete, `seed ${seed}: box ${t.planB.key} = card ${c.key} + ${extras.join(", ")}`).toBeGreaterThanOrEqual(c.pComplete + GAIN - 1e-9);
            likelierBoxes++;
          }
        }
      }
      // The gate is exercised: smallLeague(18)'s box below.
      expect(likelierBoxes).toBeGreaterThan(0);
    });

    it("smallLeague(59): the box the third card had, the first card plus 1065 (worth at most W), 65.6% against that card's 77.5%, is barred now", () => {
      const { I, r } = seedRun(59);
      const host = r.trades.find((t) => t.key === keyOf("6", ["1006", "1011"], ["1068", "1072"]));
      const card = r.trades.find((t) => t.key === keyOf("6", ["1006", "1011"], ["1063"]));
      const old = stateOf(r).planBPool.find((c) => c.key === keyOf("6", ["1006", "1011"], ["1063", "1065"]));
      expect(host && card && old).toBeTruthy();
      expect(I.values["1065"] as number).toBeLessThanOrEqual(I.credit);
      // It still passes Plan B's own rules for that card (the first bar's miss: its lean version leaves 1006 out too, and
      // 1011 → 1063 isn't a card) …
      expect(leanVersionOf(I, ["1006", "1011"], ["1063", "1065"])?.removed).toEqual(expect.arrayContaining(["1006", "1065"]));
      expect(planBPasses(old as TradeEvaluationCore, host as TradeEvaluation)).toBe(true);
      // … but it's the card plus 1065, far less likely: barred, and the card gets another box.
      expect((old?.pComplete as number) < (card?.pComplete as number)).toBe(true);
      expect(barredFromBoxes(stateOf(r).planBPool, r.trades).has(old?.key as string)).toBe(true);
      expect(host?.planB?.key).not.toBe(old?.key);
    });

    it("smallLeague(18): a card's own box may be the card plus a player worth at most W when he makes it 10 points likelier (the first bar removed it)", () => {
      const { I, r } = seedRun(18);
      const card = r.trades.find((t) => t.key === keyOf("6", ["1011"], ["1066"]));
      expect(card?.planB?.key).toBe(keyOf("6", ["1005", "1011"], ["1066"]));
      expect(I.values["1005"] as number).toBeLessThanOrEqual(I.credit);
      // 22.0% → 32.1% (no steps on the card: the full version's B, 3.5 against 5.8, is under 80% of the offer's).
      expect((card?.planB?.pComplete as number) - (card?.pComplete as number)).toBeGreaterThan(2 * GAIN - 0.01);
      // The first bar's test: the box's lean version (1005 left out) is that very card.
      const lean = leanVersionOf(I, ["1005", "1011"], ["1066"]);
      expect(keyOf("6", lean?.give ?? [], lean?.get ?? [])).toBe(card?.key);
    });

    it("since the review of wave D (D-ENG-5; planner reply to Checkpoint 7d, item 4.1: \"a different target\"): no box asks for its card's own players of theirs, and smallLeague(18)'s card plus 1005 is no box", () => {
      const sorted = (p: Pick<TradeProposal, "give" | "get">) => ids(p, "get").sort().join(",");
      let boxes = 0;
      for (const { seed, now } of searched()) {
        for (const t of now.trades) {
          if (!t.planB) continue;
          boxes++;
          expect(t.planB.kind, `seed ${seed} ${t.key}`).toBe("otherTarget");
          expect(sorted(t.planB.proposal), `seed ${seed} ${t.key}`).not.toBe(sorted(t.proposal));
        }
      }
      expect(boxes).toBeGreaterThan(0);
      const card = seedRun(18).now.trades.find((t) => t.key === keyOf("6", ["1011"], ["1066"]));
      expect(card?.planB?.key).not.toBe(keyOf("6", ["1005", "1011"], ["1066"]));
    });
  });

  it("leanVersionOf: the players the rule leaves out on either side, the same trade from either side; null when nobody is", () => {
    const me = I6.me as TeamState;
    expect(me).toBeTruthy();
    const W = I6.credit;
    const cheap = Object.keys(I6.values).filter((id) => (I6.values[id] as number) <= W);
    const dear = Object.keys(I6.values).filter((id) => (I6.values[id] as number) > W);
    expect(cheap.length).toBeGreaterThan(2);
    expect(dear.length).toBeGreaterThan(2);
    const [c1, c2] = cheap as [string, string];
    const [d1, d2] = dear as [string, string];
    expect(leanVersionOf(I6, [d1], [d2])).toBeNull();
    // A matched pair: one cheap player on each side.
    const pair = leanVersionOf(I6, [d1, c1], [d2, c2]);
    expect(pair?.give).toEqual([d1]);
    expect(pair?.get).toEqual([d2]);
    expect([...(pair?.removed ?? [])].sort()).toEqual([c1, c2].sort());
    // Nothing left: both sides empty (no companion then).
    expect(leanVersionOf(I6, [c1], [c2])).toEqual({ give: [], get: [], removed: neutralThrowIns([c2], [c1], I6.values, W).removed });
  });
});
